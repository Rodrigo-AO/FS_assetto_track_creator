"""Parking Isla Mágica, modelado a mano a partir de imágenes.

Referencias (2026-10-16):
- Google Maps (satélite) a zoom 19-21: contorno del parking, farolas (por su sombra; la base es el
  extremo de la sombra), caseta de seguridad y marcas viales. La esquina sureste es aparcamiento en
  Google (en la ortofoto PNOA y en Esri ya aparece el parque acuático): se sigue Google, como pidió Rodrigo.
- Street View (C/ Juan Bautista Muñoz y rotonda de José de Gálvez): paredes de chapa grecada pintada
  con murales, sobre un murete de bloque de ~0,6 m; altura total ~2,6 m. Rodean el parking.
- Coordenada de la caseta facilitada por Rodrigo: 37.409735, −5.998275.

El suelo es plano (z = 0): el parking no tiene desniveles apreciables y así no hay baches.
"""

from __future__ import annotations

import math

import numpy as np
from shapely import Point, Polygon
from shapely import box as sbox

from geo import ROOT, LocalFrame, load_sites
from scenes.common import (MaterialDef, Scene, box, clip_segment, cylinder, draw_lines, left, normalized_detail, segment,
                           unit, v2, value_noise, wall_along)

SITE = "isla_magica"
CC0 = ROOT / "presets" / "common" / "cc0"
COMMON = ROOT / "presets" / "common" / "textures"

# Farolas (báculo de doble brazo) medidas en Google: extremo de la sombra a zoom 20/21.
LAMPS = [(37.409843, -5.998100), (37.409507, -5.997660), (37.409088, -5.997188), (37.408681, -5.996832), (37.409479, -5.996955)]
BOOTH = (37.409735, -5.998275)
WALL_BEHIND_L5_M = 1.5   # en Google la pared noreste pasa ~1,5 m por detrás de la farola L5
LAMP_HEIGHT = 10.0
WALL_BASE_H, WALL_TOP_H = 0.6, 2.6
STALL_W, STALL_DEPTH, STALL_ANGLE = 2.6, 4.8, math.radians(60)
ROW_PITCH = 17.0          # doble fila de plazas (≈ 8 m) + pasillo (≈ 9 m)
MURAL_M = 32.0            # metros de pared que cubre la textura del mural


def intersect(p, d, a, b):
    """Intersección de la recta p + t·d con la recta que pasa por a y b."""
    m = np.array([d, a - b]).T
    t, _ = np.linalg.solve(m, a - p)
    return p + t * d


def lot_polygon(frame: LocalFrame, site) -> tuple[Polygon, np.ndarray]:
    P = [v2(*map(float, frame.latlng_to_local(lat, lng))) for lat, lng in site.polygon]
    d = unit(P[0] - P[5])                       # dirección de la C/ Juan Bautista Muñoz (lado noreste)
    l5 = v2(*map(float, frame.latlng_to_local(*LAMPS[4])))
    anchor = l5 + left(d) * WALL_BEHIND_L5_M     # la pared noreste, paralela a la calle
    north = intersect(anchor, d, P[4], P[5])
    east = intersect(anchor, d, P[0], P[1])
    return Polygon([east, P[1], P[2], P[3], P[4], north]), d


# --------------------------------------------------------------------------- texturas

def mural_texture(seed=3) -> np.ndarray:
    """Chapa grecada con murales de colores (como en Street View): 32 m × 2 m a 128 px/m."""
    rng = np.random.default_rng(seed)
    h, w = 256, 4096
    palette = np.array([[38, 72, 168], [242, 132, 44], [244, 204, 64], [222, 92, 142], [64, 164, 176],
                        [236, 236, 230], [118, 172, 226], [30, 40, 90]], np.float32)
    img = np.zeros((h, w, 3), np.float32)
    x = 0
    while x < w:  # bandas verticales de color
        bw = int(rng.uniform(0.4, 2.2) * 128)
        img[:, x:x + bw] = palette[rng.integers(0, len(palette))]
        x += bw
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for _ in range(70):  # manchas y trazos grandes
        cx, cy = rng.uniform(0, w), rng.uniform(-40, h + 40)
        rx, ry = rng.uniform(60, 420), rng.uniform(40, 200)
        ang = rng.uniform(0, math.pi)
        dx, dy = xx - cx, yy - cy
        u = (dx * math.cos(ang) + dy * math.sin(ang)) / rx
        v = (-dx * math.sin(ang) + dy * math.cos(ang)) / ry
        a = np.clip(6.0 - 6.0 * (u * u + v * v), 0, 1)[..., None] * rng.uniform(0.75, 1.0)  # bordes nítidos de spray
        img = img * (1 - a) + palette[rng.integers(0, len(palette))] * a
    pitch = 0.076 * 128  # greca cada 7,6 cm
    shade = 0.84 + 0.16 * np.cos(2 * math.pi * xx / pitch)
    grime = 0.92 + 0.08 * value_noise(h, w, 24, seed)
    bottom = np.clip(0.75 + yy / h * 0.5, 0.75, 1.0)  # suciedad abajo
    return img * (shade * grime * bottom)[..., None]


def block_texture() -> np.ndarray:
    rgb = np.asarray(__import__("PIL.Image", fromlist=["Image"]).open(CC0 / "concrete_block_wall_diff.jpg").convert("RGB").resize((1024, 1024)), np.float32)
    lum = rgb.mean(axis=2, keepdims=True)
    return np.clip((lum / lum.mean()) * np.array([150, 148, 142], np.float32), 0, 255)  # bloque gris claro


def booth_texture() -> np.ndarray:
    """Caseta: paneles blancos, banda de ventanas corrida y puerta (una vuelta = perímetro)."""
    h, w = 512, 2048
    img = np.ones((h, w, 3), np.float32) * np.array([238, 238, 234], np.float32)
    img *= (0.95 + 0.05 * value_noise(h, w, 16, 9))[..., None]
    for k in range(0, w, 128):  # juntas de panel
        img[:, k:k + 3] *= 0.85
    img[int(h * 0.30):int(h * 0.55), 40:w - 40] = [52, 66, 80]       # ventanas
    img[int(h * 0.30):int(h * 0.55), ::160] = [210, 210, 210]        # montantes
    img[int(h * 0.30):, 300:430] = [200, 200, 196]                   # puerta
    img[int(h * 0.92):] *= 0.7                                       # zócalo sucio
    return img


def lot_base_texture(lot: Polygon, axis: np.ndarray, lamps, booth, x0, y0, size, px=4096):
    """Base del parking: tono casi blanco con manchas (se multiplica por el detalle de asfalto)
    y marcas viales en blanco con alfa = 255 (el detalle no se aplica sobre la pintura)."""
    rgb = np.ones((px, px, 3), np.float32) * np.array([240, 241, 243], np.float32)
    # variación a gran escala (zonas más oscuras de rodadura y manchas de aceite)
    rgb *= (0.86 + 0.14 * value_noise(px, px, 10, 1) - 0.08 * np.clip(value_noise(px, px, 90, 2) - 0.7, 0, 1) * 3)[..., None]
    alpha = np.zeros((px, px), np.float32)
    to_px = lambda p: np.array([(p[0] - x0) / size * px, (1 - (p[1] - y0) / size) * px])
    ppm = px / size

    inner = lot.buffer(-1.2).difference(Point(*booth).buffer(6.0))  # sin marcas alrededor de la caseta
    u, v = axis, left(axis)
    proj_u = [float(np.dot(np.array(c), u)) for c in lot.exterior.coords]
    proj_v = [float(np.dot(np.array(c), v)) for c in lot.exterior.coords]
    lines = []
    ne_v = max(proj_v)  # la pared noreste
    centers = [ne_v - 2.0 - STALL_DEPTH * math.sin(STALL_ANGLE) - k * ROW_PITCH for k in range(12)]
    step = u * STALL_W
    slant = u * STALL_DEPTH * math.cos(STALL_ANGLE)
    for k, c in enumerate(centers):
        if c < min(proj_v):
            break
        base = v * c
        start = u * (min(proj_u) - 5)
        end = u * (max(proj_u) + 5)
        lines += clip_segment(base + start, base + end, inner)  # línea central de la doble fila
        n = int((max(proj_u) - min(proj_u) + 10) / STALL_W)
        sides = (1, -1) if k > 0 else (1,)  # junto a la pared, fila simple
        for s in sides:
            for i in range(n):
                a = base + start + step * i
                b = a + slant + v * s * STALL_DEPTH * math.sin(STALL_ANGLE)
                lines += clip_segment(a, b, inner)
    draw_lines(alpha, rgb, lines, to_px, 0.12, ppm)
    wear = 0.78 + 0.22 * value_noise(px, px, 140, 4)  # pintura gastada
    alpha *= wear
    return np.dstack([rgb, alpha])


# --------------------------------------------------------------------------- escena

def build() -> None:
    site = load_sites()[SITE]
    frame = LocalFrame(site.polygon)
    sc = Scene(SITE)
    lot, d_ne = lot_polygon(frame, site)
    lamps = [v2(*map(float, frame.latlng_to_local(*ll))) for ll in LAMPS]
    booth = v2(*map(float, frame.latlng_to_local(*BOOTH)))
    axis = d_ne  # las filas de plazas son paralelas a la calle Juan Bautista Muñoz
    ang = math.atan2(axis[1], axis[0])

    minx, miny, maxx, maxy = lot.bounds
    size = max(maxx - minx, maxy - miny) + 4
    x0, y0 = (minx + maxx - size) / 2, (miny + maxy - size) / 2
    lot_uv = lambda x, y: ((x - x0) / size, (y - y0) / size)

    # Texturas
    sc.textures["isla_lot_base.png"] = lot_base_texture(lot, axis, lamps, booth, x0, y0, size)
    # Detalle con media 0,6: tanto si AC lo multiplica por la base (≈240) como si lo usa tal cual,
    # el asfalto queda en un gris medio (≈145 sRGB), como el del parking en las fotos.
    sc.textures["asphalt_detail.png"] = normalized_detail(CC0 / "clean_asphalt_diff.jpg", 1024, 0.6)
    street = np.asarray(__import__("PIL.Image", fromlist=["Image"]).open(CC0 / "asphalt_02_diff.jpg").convert("RGB").resize((1024, 1024)), np.float32) * 0.62
    sc.textures["street.png"] = street
    sc.textures["wall_mural.png"] = mural_texture()
    sc.textures["wall_block.png"] = block_texture()
    sc.textures["booth.png"] = booth_texture()
    sc.textures["metal_grey.png"] = COMMON / "metal_grey.png"
    sc.textures["horizon.png"] = np.ones((8, 8, 3)) * np.array([112, 112, 106])

    sc.materials = {
        "ATC_PARKING": MaterialDef("isla_lot_base.png", detail="asphalt_detail.png", detail_mult=size / 4.0, roughness=0.9),
        "ATC_STREET": MaterialDef("street.png", roughness=0.9),
        "ATC_WALL_SHEET": MaterialDef("wall_mural.png", roughness=0.5, metallic=0.4),
        "ATC_WALL_BLOCK": MaterialDef("wall_block.png", roughness=0.95),
        "ATC_BOOTH": MaterialDef("booth.png", roughness=0.6),
        "ATC_METAL": MaterialDef("metal_grey.png", roughness=0.4, metallic=0.7),
        "ATC_HORIZON": MaterialDef("horizon.png"),
    }

    # Suelo: parking y alrededores (plano)
    sc.mesh("1ROAD_PARKING", "ATC_PARKING").flat_polygon(lot, 0.0, lot_uv)
    outside = sbox(minx - 40, miny - 40, maxx + 40, maxy + 40).difference(lot)
    sc.mesh("1ROAD_OUTSIDE", "ATC_STREET").flat_polygon(outside, -0.01, lambda x, y: (x / 6, y / 6))
    S = 1500
    sc.mesh("HORIZON", "ATC_HORIZON").flat_polygon(sbox(-S, -S, S, S).difference(sbox(minx - 39, miny - 39, maxx + 39, maxy + 39)),
                                                   -0.05, lambda x, y: (0, 0))

    # Paredes: murete de bloque + chapa con murales, alrededor de todo el parking
    ring = [np.array(c) for c in lot.exterior.coords[:-1]]
    if Polygon(ring).exterior.is_ccw is False:
        ring = ring[::-1]
    wall_along(sc.mesh("1WALL_BASE", "ATC_WALL_BLOCK"), ring, 0.0, WALL_BASE_H, 1.6, 1.6, thickness=0.22, closed=True)
    wall_along(sc.mesh("1WALL_SHEET", "ATC_WALL_SHEET"), ring, WALL_BASE_H, WALL_TOP_H, MURAL_M, WALL_TOP_H - WALL_BASE_H,
               thickness=0.06, closed=True)

    # Farolas: báculo cónico de 10 m con dos brazos y luminarias planas
    poles, heads = sc.mesh("1WALL_LAMPS", "ATC_METAL"), sc.mesh("LAMP_HEADS", "ATC_METAL")
    across = left(axis)
    for p in lamps:
        cylinder(poles, p, 0.12, 0.07, -0.1, LAMP_HEIGHT, sides=12)
        top = np.array([*p, LAMP_HEIGHT - 0.3])
        for s in (1, -1):
            tip = np.array([*(p + across * s * 1.5), LAMP_HEIGHT + 0.15])
            segment(heads, top, tip, 0.045)
            box(heads, tip[:2] + across * s * 0.35, 0.3, 0.75, LAMP_HEIGHT + 0.02, LAMP_HEIGHT + 0.16, ang)

    # Caseta de seguridad (cubo con cubierta)
    booth_mesh = sc.mesh("1WALL_BOOTH", "ATC_BOOTH")
    box(booth_mesh, booth, 3.2, 2.4, 0.0, 2.7, ang, uv_scale=11.2, top=False)
    box(sc.mesh("BOOTH_ROOF", "ATC_WALL_BLOCK"), booth, 3.6, 2.8, 2.7, 2.85, ang)

    eye = booth + axis * 8 - left(axis) * 6  # junto a la caseta, mirando hacia el sureste a lo largo del parking
    sc.meta = {"lot_polygon": [list(map(float, c)) for c in lot.exterior.coords[:-1]], "lamps": [p.tolist() for p in lamps],
               "booth": booth.tolist(), "preview_target": [float(lot.centroid.x), float(lot.centroid.y)], "preview_extent": 190.0,
               "preview_eye": [float(eye[0]), float(eye[1]), 1.1], "preview_look": [*map(float, eye + axis * 40), 0.9]}
    sc.save()


if __name__ == "__main__":
    build()
