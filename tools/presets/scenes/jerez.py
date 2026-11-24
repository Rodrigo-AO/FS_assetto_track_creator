"""Piezas comunes de los dos escenarios del Circuito de Jerez (Parking y Karting).

- El suelo es un plano inclinado: el que mejor ajusta al MDT05 del IGN dentro del área (error típico
  ~0,4 m, con el MDT redondeado al metro). Así tiene la pendiente real sin baches.
- La base del asfalto lleva el tono real (parches claros y oscuros) sacado de la ortofoto PNOA en
  gris y sin objetos: cada píxel se limita a ±tolerancia de la mediana de su entorno. Las marcas
  viales finas (plazas, líneas) salen de la misma ortofoto y van al alfa, como en Isla Mágica.
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely import Point, Polygon
from shapely import box as sbox

import reference
from geo import BUILD_DIR, ROOT, LocalFrame, load_sites
from scenes.common import MaterialDef, Scene, cylinder, left, load_rgb, normalized_detail, unit, v2, value_noise

CC0 = ROOT / "presets" / "common" / "cc0"
COMMON = ROOT / "presets" / "common" / "textures"


class Site:
    """Área, plano local, ortofoto y plano del suelo de un escenario de Jerez."""

    def __init__(self, site_id: str, slope: tuple[float, float]):
        self.id = site_id
        self.site = load_sites()[site_id]
        self.frame = LocalFrame(self.site.polygon)
        self.poly = Polygon([self.local(*p) for p in self.site.polygon])
        self.slope = slope
        self.ref = reference.fetch(site_id)
        self.ortho = np.asarray(Image.open(BUILD_DIR / site_id / "ortho.jpg").convert("L"), np.float32)

    def local(self, lat, lng) -> np.ndarray:
        return v2(*map(float, self.frame.latlng_to_local(lat, lng)))

    def z(self, x, y) -> float:
        return self.slope[0] * x + self.slope[1] * y

    def p3(self, p, dz=0.0) -> np.ndarray:
        return np.array([p[0], p[1], self.z(p[0], p[1]) + dz])

    def zf(self, dz=0.0):
        return lambda x, y: self.z(x, y) + dz


def ground_textures(s: Site, px=4096, tolerance=15.0, paint_threshold=16.0, paint_mask: Polygon | None = None):
    """Base RGBA del asfalto del área y su encuadre (x0, y0, lado)."""
    minx, miny, maxx, maxy = s.poly.bounds
    size = max(maxx - minx, maxy - miny) + 4
    x0, y0 = (minx + maxx - size) / 2, (miny + maxy - size) / 2

    m_px = 1 / abs(s.ref["to_px"][0][0])  # metros por píxel de la ortofoto
    g = s.ortho
    small = ndimage.zoom(ndimage.gaussian_filter(g, 4), 1 / 8, order=1)
    med = ndimage.median_filter(small, size=max(3, int(9.0 / (m_px * 8)) | 1))
    med = ndimage.zoom(med, np.array(g.shape) / np.array(med.shape), order=1)
    tone = np.clip(g, med - tolerance, med + tolerance * 0.6)
    tone = ndimage.gaussian_filter(tone, 0.25 / m_px)
    k = max(3, int(round(1.1 / m_px)))
    hat = ndimage.gaussian_filter(ndimage.white_tophat(g, size=(k, k)), 0.6)

    # Muestreo en la textura (fila 0 = norte)
    c = (np.arange(px) + 0.5) / px * size
    gx, gy = np.meshgrid(x0 + c, y0 + size - c)
    to = np.array(s.ref["to_px"])
    u = to[0, 0] * gx + to[0, 1] * gy + to[0, 2]
    v = to[1, 0] * gx + to[1, 1] * gy + to[1, 2]
    sample = lambda a: ndimage.map_coordinates(a, [v, u], order=1, mode="nearest")
    t = sample(tone)
    inside = np.zeros((px, px), bool)
    from PIL import ImageDraw

    def raster(poly):
        im = Image.new("1", (px, px), 0)
        d = ImageDraw.Draw(im)
        for q in getattr(poly, "geoms", [poly]):
            for ring, fill in [(q.exterior, 1)] + [(r, 0) for r in q.interiors]:
                d.polygon([((x - x0) / size * px, (1 - (y - y0) / size) * px) for x, y in ring.coords], fill=fill)
        return np.asarray(im)

    inside = raster(s.poly)
    t = t / t[inside].mean()
    base = np.clip(t, 0.72, 1.18) * 212
    base *= 0.97 + 0.06 * value_noise(px, px, 60, 11)
    rgb = base[..., None] * np.array([1.0, 0.985, 0.96], np.float32)  # asfalto viejo, gris algo cálido
    paint = np.clip((sample(hat) - paint_threshold) / 14, 0, 1)
    # Cerca del borde del área la ortofoto tiene maleza y coches: ahí no se pinta nada.
    paint = paint * raster(s.poly.buffer(-5.0) if paint_mask is None else paint_mask)
    paint *= inside * (0.7 + 0.3 * value_noise(px, px, 160, 4))
    rgb = rgb * (1 - paint[..., None]) + np.array([228, 226, 218], np.float32) * paint[..., None]
    return np.dstack([rgb, paint * 235]), (x0, y0, size)


def common_materials(sc: Scene, size: float) -> None:
    sc.textures["asphalt_detail.png"] = normalized_detail(CC0 / "clean_asphalt_diff.jpg", 1024, 0.68)
    sc.textures["street.png"] = load_rgb(CC0 / "asphalt_02_diff.jpg", 1024) * 0.7
    grass = load_rgb(CC0 / "leafy_grass_diff.jpg", 1024)
    lum = grass.mean(axis=2, keepdims=True)
    sc.textures["dry_grass.png"] = np.clip((lum / lum.mean()) ** 0.7 * np.array([142, 122, 92], np.float32), 0, 255)
    noise = (0.85 + 0.15 * value_noise(512, 512, 64, 2) + 0.1 * (value_noise(512, 512, 200, 3) - 0.5))[..., None]
    sc.textures["sand.png"] = noise * np.array([168, 148, 118], np.float32)
    sc.textures["paint_white.png"] = np.ones((16, 16, 3)) * np.array([214, 214, 208])
    sc.textures["paint_blue.png"] = np.ones((16, 16, 3)) * np.array([88, 116, 150])
    for name in ("metal_grey.png", "bark.png", "leaves.png", "leaves_dark.png"):
        sc.textures[name] = COMMON / name
    sc.textures["horizon.png"] = np.ones((8, 8, 3)) * np.array([134, 120, 94])
    sc.materials.update({
        "ATC_LOT": MaterialDef("lot_base.png", detail="asphalt_detail.png", detail_mult=size / 4.0, roughness=0.9),
        "ATC_STREET": MaterialDef("street.png", roughness=0.9),
        "ATC_DRY_GRASS": MaterialDef("dry_grass.png", roughness=1.0),
        "ATC_SAND": MaterialDef("sand.png", roughness=1.0),
        "ATC_PAINT_WHITE": MaterialDef("paint_white.png", roughness=0.8),
        "ATC_PAINT_BLUE": MaterialDef("paint_blue.png", roughness=0.8),
        "ATC_METAL": MaterialDef("metal_grey.png", roughness=0.4, metallic=0.7),
        "ATC_BARK": MaterialDef("bark.png"),
        "ATC_LEAVES": MaterialDef("leaves.png", alpha=True, roughness=0.7),
        "ATC_LEAVES_DARK": MaterialDef("leaves_dark.png", alpha=True, roughness=0.7),
        "ATC_HORIZON": MaterialDef("horizon.png"),
    })


def ribbon(mesh, s: Site, pts, width: float, dz: float, offset: float = 0.0, closed=False) -> None:
    """Cinta pintada a lo largo de una polilínea (desplazada `offset` m a la izquierda)."""
    p = np.asarray(pts, float)
    if closed:
        p = np.vstack([p, p[:1]])
    t = np.gradient(p, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    n = np.c_[-t[:, 1], t[:, 0]]
    if closed:
        n[0] = n[-1] = unit(n[0] + n[-1])
    a, b = p + n * (offset - width / 2), p + n * (offset + width / 2)
    for i in range(len(p) - 1):
        mesh.quad(s.p3(a[i], dz), s.p3(a[i + 1], dz), s.p3(b[i + 1], dz), s.p3(b[i], dz), (0, 0), (1, 0), (1, 1), (0, 1))


def surroundings(sc: Scene, s: Site, margin: float, layers: list[tuple[str, str, object]]) -> None:
    """Suelo de alrededor: capas (nombre, material, polígono) sin solaparse y, al fondo, hierba seca
    que se va aplanando hasta el horizonte."""
    minx, miny, maxx, maxy = s.poly.bounds
    x0, y0, x1, y1 = minx - margin, miny - margin, maxx + margin, maxy + margin
    rest = sbox(x0, y0, x1, y1).difference(s.poly)
    for name, mat, poly in layers:
        piece = poly.intersection(rest)
        rest = rest.difference(piece)
        sc.mesh(name, mat).flat_polygon(piece, s.zf(-0.01), lambda x, y: (x / 6, y / 6))
    sc.mesh("1GRASS_AROUND", "ATC_DRY_GRASS").flat_polygon(rest, s.zf(-0.01), lambda x, y: (x / 8, y / 8))
    # Falda: del borde inclinado a un plano horizontal, y horizonte
    far = 420.0
    inner = [v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)]
    outer = [v2(x0 - far, y0 - far), v2(x1 + far, y0 - far), v2(x1 + far, y1 + far), v2(x0 - far, y1 + far)]
    skirt = sc.mesh("SKIRT", "ATC_DRY_GRASS", heightfield=False)
    low = min(s.z(*c) for c in inner) - 1.0
    for i in range(4):
        j = (i + 1) % 4
        a, b, c, d = outer[i], outer[j], inner[j], inner[i]
        skirt.quad(np.array([*a, low]), np.array([*b, low]), s.p3(c, -0.02), s.p3(d, -0.02), *[tuple(q / 8) for q in (a, b, c, d)])
    S = 2000.0
    hole = sbox(outer[0][0] + 1, outer[0][1] + 1, outer[2][0] - 1, outer[2][1] - 1)
    sc.mesh("HORIZON", "ATC_HORIZON", heightfield=False).flat_polygon(sbox(-S, -S, S, S).difference(hole), low - 0.05, lambda x, y: (x / 50, y / 50))


class Trees:
    def __init__(self, sc: Scene, s: Site, seed=4):
        self.s = s
        self.trunks = sc.mesh("1WALL_TREE_TRUNKS", "ATC_BARK")
        self.crowns = {"light": sc.mesh("TREE_CROWNS", "ATC_LEAVES"), "dark": sc.mesh("TREE_CROWNS_DARK", "ATC_LEAVES_DARK")}
        self.rng = np.random.default_rng(seed)

    def tree(self, p, h: float, r: float, kind="dark", trunk=True) -> None:
        z = self.s.z(*p)
        if trunk:
            cylinder(self.trunks, p, 0.16, 0.09, z - 0.3, z + h * 0.5, 6)
        rot = self.rng.uniform(0, math.pi)
        z0 = z + (h * 0.22 if trunk else -0.1)
        for k in range(3):
            t = rot + k * math.pi / 3
            d = np.array([math.cos(t), math.sin(t)]) * r
            self.crowns[kind].quad_double(np.array([*(p - d), z0]), np.array([*(p + d), z0]), np.array([*(p + d), z + h]), np.array([*(p - d), z + h]),
                                          (0, 0), (1, 0), (1, 1), (0, 1))

    def fill(self, poly: Polygon, spacing: float, h=(5, 8), r=(2.2, 3.4), kind="dark", trunk=True) -> None:
        """Árboles o arbustos repartidos por un polígono (fuera del área de conducción)."""
        x0, y0, x1, y1 = poly.bounds
        placed = []
        for _ in range(int(poly.area / spacing**2 * 12)):
            p = v2(self.rng.uniform(x0, x1), self.rng.uniform(y0, y1))
            if not poly.contains(Point(*p)) or self.s.poly.buffer(2.5).contains(Point(*p)):
                continue
            if any(np.linalg.norm(p - q) < spacing for q in placed):
                continue
            placed.append(p)
            self.tree(p, self.rng.uniform(*h), self.rng.uniform(*r), kind, trunk)


def lamp_post(sc: Scene, s: Site, points, height=12.0) -> None:
    poles = sc.mesh("1WALL_LAMPS", "ATC_METAL")
    for p in points:
        z = s.z(*p)
        cylinder(poles, p, 0.16, 0.08, z - 0.2, z + height, 10)


__all__ = ["CC0", "COMMON", "Site", "Trees", "common_materials", "ground_textures", "lamp_post", "left", "ribbon", "surroundings"]
