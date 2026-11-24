"""Parking Jerez: aparcamiento del Circuito de Jerez con el trazado pintado en el asfalto.

Referencias (2026-11-24): ortofoto PNOA y Esri/Google (satélite). El trazado pintado (bordes blancos
y bandas azules por fuera de las curvas) sale de la misma digitalización que el Track preset
«Jerez Parking» (tools/track_presets/digitize.py). Pendiente del suelo: MDT05 del IGN (≈1,3 %).
Los píxeles PX se midieron sobre una ortofoto PNOA de 1920 px a 4 px/m centrada en CENTER.
"""

from __future__ import annotations

import math
import sys

import numpy as np
from scipy import ndimage
from shapely import LineString, Polygon

from geo import ROOT
from scenes.common import Scene, v2
from scenes.jerez import Site, Trees, common_materials, ground_textures, lamp_post, ribbon, surroundings

sys.path.insert(0, str(ROOT / "tools" / "track_presets"))
import digitize  # noqa: E402

SITE = "parking_jerez"
SLOPE = (0.0104, -0.0079)
CENTER, PPM, HALF = (36.71195, -6.0377), 4.0, 960.0
BLUE_RADIUS_M = 38.0      # curvas con menos radio llevan banda azul por fuera
PAINT_LIFT = 0.009


def build() -> None:
    s = Site(SITE, SLOPE)
    sc = Scene(SITE)

    def px(x, y):
        k = math.cos(math.radians(CENTER[0]))
        lat = CENTER[0] + math.degrees((HALF - y) / PPM / digitize.R)
        return s.local(lat, CENTER[1] + math.degrees((x - HALF) / PPM / (digitize.R * k)))

    line = lambda *pts: LineString([px(*p) for p in pts])
    area = lambda *pts: Polygon([px(*p) for p in pts])

    # Trazado pintado: bordes blancos continuos y bandas azules en las curvas
    f = digitize.Frame("parking")
    pairs = [p for _, ps in digitize.PARK for p in ps]
    to_local = lambda w: np.array([s.local(*f.latlng(q)) for q in w])
    edges = {}
    for side in (0, 1):
        ctrl = to_local(f.world([p[side] for p in pairs]))
        c = np.c_[ctrl, np.zeros(len(ctrl)), np.arange(len(ctrl))]
        dense, step = digitize.resample_closed(digitize.catmull(c), 0.6)
        edges[side] = digitize.smooth_closed(dense[:, :2], 1.0, step)
    # Los bordes del trazado van como cintas nítidas: en la textura se quitan para no verlos dobles.
    road = LineString(np.vstack([edges[0], edges[0][:1]])).buffer(1.6).union(LineString(np.vstack([edges[1], edges[1][:1]])).buffer(1.6))
    base, (x0, y0, size) = ground_textures(s, paint_threshold=20.0, paint_mask=s.poly.buffer(-9.0).difference(road))
    sc.textures["lot_base.png"] = base
    common_materials(sc, size)
    sc.mesh("1ROAD_LOT", "ATC_LOT").flat_polygon(s.poly, s.zf(), lambda x, y: ((x - x0) / size, (y - y0) / size))
    white, blue = sc.mesh("LINES_WHITE", "ATC_PAINT_WHITE"), sc.mesh("LINES_BLUE", "ATC_PAINT_BLUE")
    for side, e in edges.items():
        ribbon(white, s, e, 0.15, PAINT_LIFT, closed=True)
        k = 10
        a, b = e - np.roll(e, k, axis=0), np.roll(e, -k, axis=0) - e
        turn = np.arctan2(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0], (a * b).sum(1))
        radius = (np.linalg.norm(a, axis=1) + 1e-6) / np.maximum(np.abs(turn), 1e-6)
        # Lado izquierdo (0): es el exterior cuando la curva gira a la derecha, y al revés.
        outside = (turn < 0) if side == 0 else (turn > 0)
        on = ndimage.binary_closing(np.pad(outside & (radius < BLUE_RADIUS_M), 20, mode="wrap"), iterations=8)[20:-20]
        off = 0.6 if side == 0 else -0.6
        i = 0
        while i < len(e):
            if not on[i]:
                i += 1
                continue
            j = i
            while j < len(e) and on[j]:
                j += 1
            if j - i > 8:
                ribbon(blue, s, e[i:j], 0.9, PAINT_LIFT - 0.004, offset=off)
            i = j

    # Alrededores: avenidas, hierba seca y cañaveral
    avenue = line((620, 1920), (760, 1780), (1000, 1480), (1250, 1180), (1480, 900), (1620, 690), (1735, 470), (1745, 330), (1690, 210)).buffer(6.5)
    north = line((-60, 375), (250, 290), (700, 195), (1100, 120), (1400, 70)).buffer(4.2)
    west = line((-40, 560), (60, 760), (230, 1080), (420, 1440), (600, 1700), (680, 1790)).buffer(6.0)
    school = area((935, 960), (1205, 1208), (990, 1450), (800, 1720), (690, 1760), (600, 1690), (590, 1590), (520, 1500), (506, 1430), (745, 1165))
    pad = area((60, 400), (150, 385), (170, 490), (110, 520), (60, 505))
    surroundings(sc, s, 60, [("1ROAD_AVENUES", "ATC_STREET", avenue.union(north).union(west)), ("1ROAD_SCHOOL", "ATC_STREET", school.union(pad))])

    trees = Trees(sc, s)
    trees.fill(area((1120, 130), (1330, 100), (1450, 110), (1500, 160), (1640, 200), (1700, 300), (1690, 340), (1600, 240), (1480, 210), (1340, 150), (1140, 165)), 4.0, (2.5, 4.0), (1.8, 2.6), trunk=False)
    trees.fill(area((1790, 380), (1920, 300), (1920, 900), (1700, 820), (1690, 700), (1720, 560)), 6.5, (7, 11), (3, 4.5))
    trees.fill(area((1380, 1080), (1520, 950), (1640, 1010), (1600, 1120), (1480, 1200), (1400, 1380), (1370, 1200)), 6.0, (7, 10), (3, 4.2))
    trees.fill(area((500, 170), (620, 150), (640, 190), (520, 195)), 4.0, (2.5, 4.0), (2, 2.8), trunk=False)
    trees.fill(area((165, 390), (215, 390), (235, 480), (210, 545), (120, 550), (190, 500)), 3.2, (2.2, 3.2), (1.6, 2.2), "light", trunk=False)
    for x, y, r in ((175, 350, 5.5), (665, 138, 6.0), (755, 138, 6.5), (1660, 300, 4.5)):
        trees.tree(px(x, y), 9.0, r, "dark")
    lamp_post(sc, s, [px(978, 1000)], 14.0)

    eye = s.local(*f.latlng(f.world([(560, 541)])[0]))
    look = s.local(*f.latlng(f.world([(300, 530)])[0]))
    c = s.poly.centroid
    sc.meta = {"preview_target": [float(c.x), float(c.y)], "preview_extent": 330.0,
               "preview_eye": [float(eye[0]), float(eye[1]), s.z(*eye) + 1.2], "preview_look": [float(look[0]), float(look[1]), s.z(*look) + 0.8]}
    sc.save()


if __name__ == "__main__":
    build()
