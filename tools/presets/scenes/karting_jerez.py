"""Karting Jerez (Jerez Neumáticos): pista de karting con muros de neumáticos y explanada.

Referencias (2026-11-24): ortofoto PNOA, Esri y Google Maps. Los muros de neumáticos se extrajeron
de la ortofoto (líneas oscuras finas, karting_jerez_walls.json) y se abren por donde pasa el circuito
de AutoX «Jerez Neumáticos» de Notion, que en las pruebas también los cruza. Pendiente: MDT05 (≈2,7 %).
Los píxeles PX se midieron sobre una ortofoto PNOA de 1964 px a 4,464 px/m centrada en CENTER.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from shapely import LineString, Polygon
from shapely.ops import unary_union

from geo import ROOT
from scenes.common import MaterialDef, Scene, box, left, unit, value_noise, wall_along
from scenes.jerez import Site, Trees, common_materials, ground_textures, surroundings

sys.path.insert(0, str(ROOT / "tools" / "track_presets"))
import digitize  # noqa: E402

SITE = "karting_jerez"
SLOPE = (0.0245, -0.0124)
CENTER, PPM = (36.70805, -6.02895), 5 / 1.12
HALF_W, HALF_H = 1100 / 1.12, 1050 / 1.12
TYRE_H, TYRE_W = 0.62, 0.62
CORRIDOR_MARGIN_M = 0.2   # holgura a cada lado del circuito al abrir los muros


def tyre_texture() -> np.ndarray:
    """Neumáticos apilados vistos de lado (2,4 m × 0,62 m): negros, con alguno pintado de blanco."""
    h, w = 256, 1024
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    pitch = w / 4
    u = (xx % pitch) / pitch * 2 - 1
    row = np.floor(yy / (h / 3))
    v = (yy % (h / 3)) / (h / 3) * 2 - 1
    shade = np.sqrt(np.clip(1 - (u * 0.92) ** 2, 0, 1)) * (0.55 + 0.45 * np.sqrt(np.clip(1 - (v * 0.9) ** 2, 0, 1)))
    img = np.ones((h, w, 3), np.float32) * np.array([66, 66, 68], np.float32)
    img[(np.floor(xx / pitch) == 2) & (row == 1) & (u * u + v * v < 0.75)] = [176, 176, 172]
    img *= (shade * (0.85 + 0.15 * value_noise(h, w, 40, 5)))[..., None]
    img[np.abs(v) > 0.95] *= 0.5
    return img


def armco_texture() -> np.ndarray:
    """Barrera blanca y azul del circuito (módulos de 2 m)."""
    img = np.ones((128, 512, 3), np.float32) * np.array([216, 216, 212], np.float32)
    img[:, 256:] = [70, 116, 170]
    img[60:68] *= 0.8
    return img


def build() -> None:
    s = Site(SITE, SLOPE)
    sc = Scene(SITE)

    def px(x, y):
        k = math.cos(math.radians(CENTER[0]))
        lat = CENTER[0] + math.degrees((HALF_H - y) / PPM / digitize.R)
        return s.local(lat, CENTER[1] + math.degrees((x - HALF_W) / PPM / (digitize.R * k)))

    pts = lambda *q: [px(*p) for p in q]
    area = lambda *q: Polygon(pts(*q))

    # La explanada de hormigón con coches y carpas se deja sin marcas (en la ortofoto son falsas líneas).
    clutter = unary_union([area((800, 780), (900, 740), (1080, 740), (1130, 930), (1080, 1110), (960, 1130), (860, 960)), area((1080, 960), (1200, 870), (1215, 960), (1100, 1080))])
    base, (x0, y0, size) = ground_textures(s, tolerance=13.0, paint_threshold=18.0, paint_mask=s.poly.buffer(-3.5).difference(clutter))
    sc.textures["lot_base.png"] = base
    common_materials(sc, size)
    sc.textures["tyres.png"] = tyre_texture()
    sc.textures["armco.png"] = armco_texture()
    sc.textures["roof.png"] = np.ones((16, 16, 3)) * np.array([222, 222, 216])
    sc.materials["ATC_TYRES"] = MaterialDef("tyres.png", roughness=0.95)
    sc.materials["ATC_ARMCO"] = MaterialDef("armco.png", roughness=0.5)
    sc.materials["ATC_ROOF"] = MaterialDef("roof.png", roughness=0.7)
    sc.mesh("1ROAD_LOT", "ATC_LOT").flat_polygon(s.poly, s.zf(), lambda x, y: ((x - x0) / size, (y - y0) / size))

    # Muros de neumáticos, abiertos por donde pasa el circuito de AutoX
    data = json.loads(digitize.OUT.read_text())["jerez_neumaticos"]
    f_origin = s.local(*data["origin"])
    quads = []
    n = len(data["anchors"])
    for i, a in enumerate(data["anchors"]):
        b = data["anchors"][(i + 1) % n]
        q = digitize.bezier(*(np.array(v, float) for v in (a["p"], a["out"], b["in"], b["p"])), np.linspace(0, 1, 16))
        half = (a["left"] + a["right"] + b["left"] + b["right"]) / 4 + CORRIDOR_MARGIN_M
        quads.append(LineString(q + f_origin).buffer(half))
    corridor = unary_union(quads)
    tyres = sc.mesh("1WALL_TYRES", "ATC_TYRES")
    for poly in json.loads((Path(__file__).parent / "karting_jerez_walls.json").read_text()):
        rest = LineString([s.local(*p) for p in poly]).intersection(s.poly).difference(corridor)
        for part in getattr(rest, "geoms", [rest]):
            if part.is_empty or part.geom_type != "LineString" or part.length < 1.5:
                continue
            path = [np.array(c) for c in part.coords]
            wall_along(tyres, path, s.zf(-0.05), s.zf(TYRE_H), 2.4, TYRE_H + 0.05, thickness=TYRE_W)
            for a, b in ((path[1], path[0]), (path[-2], path[-1])):  # remates de los extremos
                d = unit(b - a)
                r, l = b - left(d) * TYRE_W / 2, b + left(d) * TYRE_W / 2
                tyres.quad(s.p3(r, -0.05), s.p3(l, -0.05), s.p3(l, TYRE_H), s.p3(r, TYRE_H), (0, 0), (0.26, 0), (0.26, 1), (0, 1))

    # Circuito de Jerez alrededor: pista, escapatorias, vía de servicio y barreras
    track = LineString(pts((-60, 165), (0, 185), (162, 243), (487, 300), (909, 349), (1250, 386), (1396, 406), (1526, 487), (1623, 600), (1660, 714), (1666, 800),
                           (1662, 900), (1640, 985), (1600, 1060), (1560, 1110), (1510, 1155), (1400, 1248), (1240, 1382), (1060, 1529), (900, 1662), (760, 1778), (560, 1945)))
    service = s.poly.buffer(7.0).intersection(area((380, 480), (1100, 440), (1500, 540), (1640, 800), (1600, 1050), (1500, 1260), (1000, 1600), (900, 1480), (1480, 900), (900, 520)))
    gravel_out = track.buffer(42, single_sided=False).difference(track.buffer(6.2))
    paddock = area((0, 480), (330, 600), (410, 565), (480, 690), (350, 720), (160, 830), (0, 860))
    south = area((760, 1620), (570, 1440), (440, 1600), (300, 1800), (150, 1960), (560, 1980), (900, 1720))
    surroundings(sc, s, 55, [("1ROAD_TRACK", "ATC_STREET", track.buffer(6.2)), ("1ROAD_SERVICE", "ATC_STREET", service.union(paddock).union(south)),
                             ("1GRAVEL_RUNOFF", "ATC_SAND", gravel_out)])
    armco = sc.mesh("1WALL_ARMCO", "ATC_ARMCO")
    for path in (pts((405, 495), (520, 507), (640, 508), (780, 492), (900, 476), (1140, 470)),
                 pts((1150, 478), (1250, 497), (1350, 540), (1440, 610), (1520, 700), (1555, 790), (1566, 860)),
                 pts((1566, 860), (1545, 930), (1509, 1006), (1440, 1120), (1355, 1225), (1200, 1350), (1063, 1460), (974, 1525), (860, 1615))):
        wall_along(armco, path, s.zf(-0.05), s.zf(0.95), 4.0, 1.0, thickness=0.2)

    # Marquesina de la explanada
    canopy = px(990, 1445)
    box(sc.mesh("1WALL_CANOPY", "ATC_ROOF"), canopy, 15.0, 6.0, s.z(*canopy) + 2.6, s.z(*canopy) + 2.9, math.radians(40))

    trees = Trees(sc, s, 9)
    trees.fill(area((300, 725), (400, 690), (470, 745), (560, 835), (700, 890), (790, 930), (835, 1000), (850, 1100), (838, 1230), (700, 1340), (640, 1400), (690, 1200), (600, 1080),
                    (500, 930), (380, 860)), 6.0, (5, 8), (2.6, 4.0))
    trees.fill(area((100, 850), (300, 740), (380, 870), (300, 1000), (250, 1200), (180, 1230), (160, 1000)), 7.0, (4, 7), (2.4, 3.6))
    for x, y, r in ((1395, 1068, 4.2), (1322, 1128, 2.6), (1282, 1178, 2.2), (1475, 960, 2.4), (1462, 1000, 2.2), (1245, 1225, 1.6), (1195, 1300, 1.4)):
        trees.tree(px(x, y), 2.2 + r * 1.1, r, "dark")
    trees.fill(area((1400, 1860), (1964, 1500), (1964, 1700), (1500, 1964)), 9.0, (5, 8), (3, 4))
    trees.fill(area((300, 20), (1700, 120), (1650, 260), (1100, 290), (400, 200)), 13.0, (2, 4), (1.8, 3.0), trunk=False)

    f = digitize.Frame("neum")
    eye = s.local(*f.latlng(f.world([(1005, 278)])[0]))
    look = s.local(*f.latlng(f.world([(700, 285)])[0]))
    c = s.poly.centroid
    sc.meta = {"preview_target": [float(c.x) + 25, float(c.y)], "preview_extent": 230.0,
               "preview_eye": [float(eye[0]), float(eye[1]), s.z(*eye) + 1.3], "preview_look": [float(look[0]), float(look[1]), s.z(*look) + 0.8]}
    sc.save()


if __name__ == "__main__":
    build()
