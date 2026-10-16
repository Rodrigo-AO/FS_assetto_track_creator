"""Georreferencia de un circuito de Assetto Corsa ya instalado (presets de tipo «circuit»).

    python georef_circuit.py <id>

Ajusta el eje de la pista de AC (línea de IA `fast_lane.ai` desplazada con sus anchos laterales)
sobre el trazado de OpenStreetMap (`highway=raceway`) con ICP y una semejanza (escala, giro y
traslación). Escribe en `sites.json` la georreferencia (`georef`), el contorno (`polygon`) y las
vías de OSM usadas, y genera:
  - build/<id>/check_georef.jpg: bordes de la pista de AC sobre Esri World Imagery (revisión visual).
  - public/presets/<id>/preview.jpg: dibujo del trazado para el desplegable de presets.

El plano del circuito es (x, y) = (X, −Z) de AC, el mismo que usa la app para un circuito
(`GeoreferencedProjection` en src/domain/geo/projection.ts): enu = scale · R · (x, y) + offset.
"""

from __future__ import annotations

import io
import json
import math
import os
import struct
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageDraw
from shapely.geometry import MultiPoint

from geo import BUILD_DIR, DEG, EARTH_RADIUS_M, ROOT, SITES_JSON
from reference import ESRI, mercator_px

OVERPASS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
STEAM_AC = [Path(r"C:\Program Files (x86)\Steam\steamapps\common\assettocorsa"),
            Path(r"C:\Program Files\Steam\steamapps\common\assettocorsa")]


def ac_tracks_dir() -> Path:
    """content/tracks de AC (ATC_AC_PATH o la biblioteca de Steam por defecto, como la app)."""
    candidates = [Path(os.environ["ATC_AC_PATH"])] if os.environ.get("ATC_AC_PATH") else STEAM_AC
    for c in candidates:
        if (c / "acs.exe").exists():
            return c / "content" / "tracks"
    raise SystemExit("No se encontró Assetto Corsa (define ATC_AC_PATH)")


def track_axis(ai_file: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Eje de la pista y bordes izquierdo/derecho en el plano (X, −Z) a partir de fast_lane.ai."""
    d = ai_file.read_bytes()
    n = struct.unpack_from("<i", d, 4)[0]
    pts = np.frombuffer(d, np.dtype([("p", "<f4", 3), ("l", "<f4"), ("i", "<i4")]), n, 16)
    extra = np.frombuffer(d, "<f4", n * 18, 16 + n * 20 + 4).reshape(n, 18)  # [5] lado izq., [6] lado der.
    xy = np.column_stack([pts["p"][:, 0], -pts["p"][:, 2]]).astype(np.float64)
    fwd = np.roll(xy, -1, 0) - np.roll(xy, 1, 0)
    fwd /= np.linalg.norm(fwd, axis=1)[:, None]
    left = np.column_stack([-fwd[:, 1], fwd[:, 0]])
    # Mediana móvil (±7 puntos, cerrada): algunos fast_lane.ai traen saltos sueltos en los anchos.
    roll = lambda a: np.median(np.lib.stride_tricks.sliding_window_view(np.concatenate([a[-7:], a, a[:7]]), 15), axis=1)
    side_l, side_r = roll(extra[:, 5].astype(np.float64)), roll(extra[:, 6].astype(np.float64))
    center = xy + left * ((side_l - side_r) / 2)[:, None]
    return center, xy + left * side_l[:, None], xy - left * side_r[:, None]


def overpass(query: str) -> dict:
    for attempt in range(6):
        for url in OVERPASS:
            try:
                r = requests.post(url, data={"data": query}, headers={"User-Agent": "assetto-track-creator/1.0"}, timeout=120)
                if r.status_code == 200:
                    return r.json()
            except requests.RequestException:
                pass
        time.sleep(10 * (attempt + 1))
    raise SystemExit("Overpass no responde; vuelve a intentarlo más tarde")


def enu(origin, lat, lng):
    lat0, lng0 = origin
    return np.column_stack([(np.asarray(lng) - lng0) * EARTH_RADIUS_M * DEG * math.cos(lat0 * DEG),
                            (np.asarray(lat) - lat0) * EARTH_RADIUS_M * DEG])


def enu_to_latlng(origin, xy):
    lat0, lng0 = origin
    return lat0 + xy[:, 1] / (EARTH_RADIUS_M * DEG), lng0 + xy[:, 0] / (EARTH_RADIUS_M * DEG * math.cos(lat0 * DEG))


def densify(origin, ways, step=3.0) -> np.ndarray:
    out = []
    for w in ways:
        g = enu(origin, [p["lat"] for p in w["geometry"]], [p["lon"] for p in w["geometry"]])
        for a, b in zip(g[:-1], g[1:]):
            k = max(1, int(np.linalg.norm(b - a) / step))
            out.append(a + (b - a) * (np.arange(k)[:, None] / k))
    return np.vstack(out)


def nearest(src, dst, chunk=400):
    idx = np.empty(len(src), int)
    for i in range(0, len(src), chunk):
        d2 = ((src[i:i + chunk, None, :] - dst[None, :, :]) ** 2).sum(-1)
        idx[i:i + chunk] = d2.argmin(1)
    return dst[idx], np.linalg.norm(src - dst[idx], axis=1)


def similarity(a, b, with_scale):
    """Semejanza (Umeyama) que lleva a → b por mínimos cuadrados."""
    ma, mb = a.mean(0), b.mean(0)
    u, s, vt = np.linalg.svd((b - mb).T @ (a - ma) / len(a))
    d = np.diag([1.0, np.sign(np.linalg.det(u @ vt))])
    r = u @ d @ vt
    k = (s * np.diag(d)).sum() / (a - ma).var(0).sum() if with_scale else 1.0
    return k, r, mb - k * r @ ma


def icp(src, dst, k, r, t, iters, trim, with_scale):
    for _ in range(iters):
        match, dist = nearest((k * (r @ src.T)).T + t, dst)
        keep = dist <= np.quantile(dist, trim)
        k, r, t = similarity(src[keep], match[keep], with_scale)
    return k, r, t, nearest((k * (r @ src.T)).T + t, dst)[1]


def fit(axis: np.ndarray, target: np.ndarray):
    """Búsqueda gruesa de giro (sin escala) y refinado con escala sobre los puntos de OSM cercanos."""
    sub = axis[::20]
    best = None
    for deg in range(0, 360, 3):
        th = deg * DEG
        r = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
        k, r, t, dist = icp(sub, target, 1.0, r, target.mean(0) - r @ sub.mean(0), 12, 0.8, False)
        if best is None or np.quantile(dist, 0.8) < best[0]:
            best = (np.quantile(dist, 0.8), k, r, t)
    _, k, r, t = best
    k, r, t, _ = icp(axis[::3], target, k, r, t, 25, 0.8, False)
    placed = (k * (r @ axis.T)).T + t
    near = target[nearest(target, placed[::2])[1] < 15]
    k, r, t, dist = icp(axis[::3], near, k, r, t, 25, 0.9, True)
    back = nearest(near, (k * (r @ axis.T)).T + t)[1]
    return k, r, t, dist, back


def check_image(site_id, origin, place, edges, z=17):
    """Bordes de la pista de AC (rojo) sobre Esri World Imagery para revisar el ajuste."""
    lat, lng = enu_to_latlng(origin, np.vstack([place(e) for e in edges]))
    px0, py0 = mercator_px(lat.max() + 0.0006, lng.min() - 0.0008, z)
    px1, py1 = mercator_px(lat.min() - 0.0006, lng.max() + 0.0008, z)
    tx0, ty0, tx1, ty1 = int(px0 // 256), int(py0 // 256), int(px1 // 256), int(py1 // 256)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            r = requests.get(ESRI.format(z=z, x=tx, y=ty), timeout=60)
            r.raise_for_status()
            mosaic.paste(Image.open(io.BytesIO(r.content)).convert("RGB"), ((tx - tx0) * 256, (ty - ty0) * 256))
    d = ImageDraw.Draw(mosaic)
    for e in edges:
        la, ln = enu_to_latlng(origin, place(e))
        d.line([tuple(np.array(mercator_px(a, b, z)) - (tx0 * 256, ty0 * 256)) for a, b in zip(la, ln)], fill=(255, 40, 40), width=1)
    out = BUILD_DIR / site_id / "check_georef.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    mosaic.save(out, quality=90)
    return out


def preview_image(site_id, edges_enu):
    """Dibujo del trazado (norte arriba) para la tarjeta del preset."""
    w, h, pad = 640, 400, 24
    pts = np.vstack(edges_enu)
    lo, hi = pts.min(0), pts.max(0)
    s = min((w - 2 * pad) / (hi[0] - lo[0]), (h - 2 * pad) / (hi[1] - lo[1]))
    off = np.array([(w - s * (hi[0] - lo[0])) / 2, (h - s * (hi[1] - lo[1])) / 2])
    to_px = lambda p: [(off[0] + (x - lo[0]) * s, h - off[1] - (y - lo[1]) * s) for x, y in p]
    img = Image.new("RGB", (w * 2, h * 2), (38, 52, 40))
    d = ImageDraw.Draw(img)
    left, right = edges_enu
    center = (left + right) / 2
    # Trazo grueso (más ancho que la pista real) para que se lea en la miniatura del desplegable.
    line = [(x * 2, y * 2) for x, y in to_px(np.vstack([center, center[:1]]))]
    d.line(line, fill=(236, 236, 230), width=22, joint="curve")
    d.line(line, fill=(92, 94, 98), width=14, joint="curve")
    out = ROOT / "public" / "presets" / site_id / "preview.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.resize((w, h), Image.LANCZOS).save(out, quality=88)
    return out


def main(site_id: str) -> None:
    sites = json.loads(SITES_JSON.read_text(encoding="utf-8"))
    site = next(s for s in sites if s["id"] == site_id)
    assert site.get("kind") == "circuit", "solo para presets de tipo circuit"
    track_dir = ac_tracks_dir() / site["acTrack"]
    center, left, right = track_axis(track_dir / site["layout"] / "ai" / "fast_lane.ai")

    osm_cfg = site["osm"]
    cache = BUILD_DIR / site_id / "osm.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
    else:
        if osm_cfg.get("ways"):
            q = f'[out:json][timeout:90];way(id:{",".join(map(str, osm_cfg["ways"]))});out tags geom;'
        else:
            lat, lng, radius = osm_cfg["around"]
            q = f'[out:json][timeout:90];way["highway"="raceway"](around:{radius},{lat},{lng});out tags geom;'
        data = overpass(q)
        cache.write_text(json.dumps(data), encoding="utf-8")
    ways = data["elements"]
    origin = tuple(osm_cfg["around"][:2]) if osm_cfg.get("around") else None
    if origin is None:
        g = ways[0]["geometry"]
        origin = (float(np.mean([p["lat"] for p in g])), float(np.mean([p["lon"] for p in g])))
    origin = (round(origin[0], 6), round(origin[1], 6))

    target = densify(origin, ways)
    k, r, t, dist, back = fit(center, target)
    rot = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    print(f"{site_id}: escala {k:.5f} · giro {rot:.3f}° · eje→OSM p50 {np.median(dist):.2f} m p90 {np.quantile(dist, .9):.2f} m"
          f" · OSM→eje p50 {np.median(back):.2f} m p90 {np.quantile(back, .9):.2f} m")
    place = lambda p: (k * (r @ p.T)).T + t

    # Vías de OSM que forman este trazado (para que la siguiente ejecución sea reproducible).
    placed = place(center)
    used = [w["id"] for w in ways if np.mean(nearest(densify(origin, [w]), placed[::2])[1] < 15) > 0.6]

    hull = MultiPoint(np.vstack([place(left), place(right)])).convex_hull.buffer(40).simplify(8)
    hx, hy = np.array(hull.exterior.coords[:-1]).T
    hlat, hlng = enu_to_latlng(origin, np.column_stack([hx, hy]))
    site["georef"] = {"origin": list(origin), "scale": round(float(k), 6), "rotationDeg": round(rot, 4),
                      "offset": [round(float(t[0]), 3), round(float(t[1]), 3)]}
    site["polygon"] = [[round(float(a), 6), round(float(b), 6)] for a, b in zip(hlat, hlng)]
    site["osm"] = {"ways": used}
    SITES_JSON.write_text(json.dumps(sites, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("vías OSM:", used)
    print(check_image(site_id, origin, place, [left, right]))
    print(preview_image(site_id, [place(left), place(right)]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
