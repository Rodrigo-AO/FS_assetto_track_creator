"""Referencia visual de un preset: ortofoto PNOA del entorno y conversión píxel ↔ metros locales.

    tools/presets/.venv/Scripts/python tools/presets/reference.py <id> [crop x0 y0 x1 y1 escala]

Los modelos de los presets se digitalizan a mano sobre esta ortofoto (y se contrastan con Google
Maps / Street View): las coordenadas de los elementos se anotan en píxeles de la ortofoto y
`ortho_px_to_local` las pasa al plano local de la app.
"""

from __future__ import annotations

import io
import json
import sys

import numpy as np
import requests
from PIL import Image, ImageDraw

from geo import BUILD_DIR, LocalFrame, load_sites

ORTHO_PX = 4096
MARGIN_M = 40.0
# Encuadre con el que se digitalizaron los píxeles de scenes/etsi.py (PX_*): fijarlo hace que la
# ortofoto vuelva a descargarse idéntica aunque cambie MARGIN_M.
PINNED_ROI = {"etsi": (-140.5, 88.5, -90.0, 142.5)}


def roi_for(frame: LocalFrame, polygon) -> tuple[float, float, float, float]:
    lat = np.array([p[0] for p in polygon])
    lng = np.array([p[1] for p in polygon])
    x, y = frame.latlng_to_local(lat, lng)
    return (float(np.floor(x.min() - MARGIN_M)), float(np.ceil(x.max() + MARGIN_M)),
            float(np.floor(y.min() - MARGIN_M)), float(np.ceil(y.max() + MARGIN_M)))


def fetch(site_id: str) -> dict:
    """Descarga la ortofoto (si no está) y guarda la afín local ↔ píxel."""
    site = load_sites()[site_id]
    frame = LocalFrame(site.polygon)
    out = BUILD_DIR / site_id
    out.mkdir(parents=True, exist_ok=True)
    meta_path = out / "reference.json"
    if meta_path.exists() and (out / "ortho.jpg").exists():
        return json.loads(meta_path.read_text())
    x0, x1, y0, y1 = PINNED_ROI.get(site_id) or roi_for(frame, site.polygon)
    ce, cn = frame.local_to_utm(np.array([x0, x1, x1, x0]), np.array([y0, y0, y1, y1]))
    bbox = (float(ce.min()), float(cn.min()), float(ce.max()), float(cn.max()))
    if not (out / "ortho.jpg").exists():
        params = dict(SERVICE="WMS", VERSION="1.3.0", REQUEST="GetMap", LAYERS="OI.OrthoimageCoverage", STYLES="",
                      CRS="EPSG:25829", BBOX=",".join(f"{v:.2f}" for v in bbox), WIDTH=ORTHO_PX, HEIGHT=ORTHO_PX, FORMAT="image/jpeg")
        r = requests.get("https://www.ign.es/wms-inspire/pnoa-ma", params=params, timeout=300)
        r.raise_for_status()
        Image.open(io.BytesIO(r.content)).convert("RGB").save(out / "ortho.jpg", quality=93)
    # Afín local → píxel (ajuste por mínimos cuadrados sobre una malla de puntos)
    gx, gy = np.meshgrid(np.linspace(x0, x1, 9), np.linspace(y0, y1, 9))
    e, n = frame.local_to_utm(gx.ravel(), gy.ravel())
    px = (e - bbox[0]) / (bbox[2] - bbox[0]) * ORTHO_PX
    py = (bbox[3] - n) / (bbox[3] - bbox[1]) * ORTHO_PX
    A = np.column_stack([gx.ravel(), gy.ravel(), np.ones(gx.size)])
    to_px = np.vstack([np.linalg.lstsq(A, px, rcond=None)[0], np.linalg.lstsq(A, py, rcond=None)[0]])
    meta = {"to_px": to_px.tolist(), "roi": [x0, x1, y0, y1], "bbox_utm29": bbox}
    meta_path.write_text(json.dumps(meta, indent=2))
    return meta


def local_to_px(meta, x, y):
    m = np.array(meta["to_px"])
    return m[:, 0] * x + m[:, 1] * y + m[:, 2]


def ortho_px_to_local(meta, px, py):
    m = np.array(meta["to_px"])
    return np.linalg.solve(m[:, :2], np.array([px, py], float) - m[:, 2])


def crop(site_id: str, x0: int, y0: int, x1: int, y1: int, scale: float = 1.0) -> None:
    """Recorte de la ortofoto con el polígono y una cuadrícula de píxeles cada 100 px (para digitalizar)."""
    meta = fetch(site_id)
    site = load_sites()[site_id]
    frame = LocalFrame(site.polygon)
    img = Image.open(BUILD_DIR / site_id / "ortho.jpg").crop((x0, y0, x1, y1))
    d = ImageDraw.Draw(img)
    for gx in range((x0 // 100 + 1) * 100, x1, 100):
        d.line([(gx - x0, 0), (gx - x0, y1 - y0)], fill=(255, 0, 255), width=1)
        d.text((gx - x0 + 2, 2), str(gx), fill=(255, 0, 255))
    for gy in range((y0 // 100 + 1) * 100, y1, 100):
        d.line([(0, gy - y0), (x1 - x0, gy - y0)], fill=(255, 0, 255), width=1)
        d.text((2, gy - y0 + 2), str(gy), fill=(255, 0, 255))
    lat = np.array([p[0] for p in site.polygon])
    lng = np.array([p[1] for p in site.polygon])
    lx, ly = frame.latlng_to_local(lat, lng)
    pts = [tuple(local_to_px(meta, a, b) - np.array([x0, y0])) for a, b in zip(lx, ly)]
    d.polygon(pts, outline=(75, 184, 232))
    if scale != 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)))
    path = BUILD_DIR / site_id / f"crop_{x0}_{y0}.jpg"
    img.save(path, quality=92)
    print(path)


ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"


def mercator_px(lat, lng, z):
    s = np.sin(np.radians(lat))
    scale = 256 * 2 ** z
    return (lng + 180) / 360 * scale, (0.5 - np.log((1 + s) / (1 - s)) / (4 * np.pi)) * scale


def mercator_latlng(px, py, z):
    scale = 256 * 2 ** z
    lng = px / scale * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py / scale))))
    return lat, lng


def esri_mosaic(site_id: str, z: int = 19, margin_m: float = 15.0) -> None:
    """Mosaico Esri World Imagery (Maxar) del polígono con cuadrícula cada 100 px.

    Sirve para digitalizar elementos que en la ortofoto PNOA no se ven (p. ej. farolas por su sombra).
    Píxel (u, v) del mosaico → lat/lng con `mercator_latlng(x0 + u, y0 + v, z)` (x0, y0 en el .json).
    """
    site = load_sites()[site_id]
    lat = np.array([p[0] for p in site.polygon])
    lng = np.array([p[1] for p in site.polygon])
    pad = margin_m / 111_000
    px0, py0 = mercator_px(lat.max() + pad, lng.min() - pad * 1.3, z)
    px1, py1 = mercator_px(lat.min() - pad, lng.max() + pad * 1.3, z)
    tx0, ty0, tx1, ty1 = int(px0 // 256), int(py0 // 256), int(px1 // 256), int(py1 // 256)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            r = requests.get(ESRI.format(z=z, x=tx, y=ty), timeout=60)
            r.raise_for_status()
            mosaic.paste(Image.open(io.BytesIO(r.content)).convert("RGB"), ((tx - tx0) * 256, (ty - ty0) * 256))
    x0, y0 = tx0 * 256, ty0 * 256
    d = ImageDraw.Draw(mosaic)
    for gx in range(100, mosaic.width, 100):
        d.line([(gx, 0), (gx, mosaic.height)], fill=(255, 0, 255))
        d.text((gx + 2, 2), str(gx), fill=(255, 0, 255))
    for gy in range(100, mosaic.height, 100):
        d.line([(0, gy), (mosaic.width, gy)], fill=(255, 0, 255))
        d.text((2, gy + 2), str(gy), fill=(255, 0, 255))
    pts = [tuple(np.array(mercator_px(a, b, z)) - (x0, y0)) for a, b in site.polygon]
    d.polygon(pts, outline=(75, 184, 232))
    out = BUILD_DIR / site_id
    mosaic.save(out / f"esri_z{z}.jpg", quality=92)
    (out / f"esri_z{z}.json").write_text(json.dumps({"z": z, "x0": x0, "y0": y0, "w": mosaic.width, "h": mosaic.height}))
    print(out / f"esri_z{z}.jpg", mosaic.size)


if __name__ == "__main__":
    sid = sys.argv[1]
    if len(sys.argv) > 2 and sys.argv[2] == "esri":
        esri_mosaic(sid, int(sys.argv[3]) if len(sys.argv) > 3 else 19)
        sys.exit()
    meta = fetch(sid)
    if len(sys.argv) > 2:
        crop(sid, *map(int, sys.argv[2:6]), float(sys.argv[6]) if len(sys.argv) > 6 else 1.0)
    else:
        site = load_sites()[sid]
        frame = LocalFrame(site.polygon)
        for lat, lng in site.polygon:
            x, y = frame.latlng_to_local(lat, lng)
            print(f"({lat}, {lng}) → local ({float(x):.1f}, {float(y):.1f}) → px {local_to_px(meta, float(x), float(y)).round(0)}")
