"""Utilidades para modelar a mano los escenarios de los presets (lado Python normal, sin Blender).

Cada sitio (scenes/<id>.py) describe su geometría con primitivas limpias —polígonos planos,
superficies regladas, anillos, cajas— a partir de medidas tomadas sobre imágenes (Google Maps,
Street View y la ortofoto PNOA). El resultado se guarda en tools/presets/build/<id>/scene.npz +
scene.json y blender_scene.py lo convierte en un .blend editable.

Convenciones: coordenadas del plano local de la app (x este, y norte, z arriba, metros) y UV de
Blender (v hacia arriba). Las caras apuntan hacia fuera / hacia arriba (sentido antihorario).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
from shapely import LineString, Polygon
from shapely.geometry import MultiPolygon

from geo import BUILD_DIR, ROOT

Vec = np.ndarray


def v2(x, y) -> Vec:
    return np.array([x, y], float)


def unit(v: Vec) -> Vec:
    return v / (np.linalg.norm(v) + 1e-12)


def left(v: Vec) -> Vec:
    """Normal a la izquierda (giro antihorario de 90°)."""
    return np.array([-v[1], v[0]])


# --------------------------------------------------------------------------- mallas

@dataclass
class Mesh:
    """Sopa de triángulos con UV por esquina (el exportador une vértices iguales)."""

    name: str
    material: str
    renderable: bool = True
    heightfield: bool = True   # False: no cuenta como suelo para apoyar conos (tablero sobre un túnel)
    verts: list = field(default_factory=list)
    uvs: list = field(default_factory=list)

    def tri(self, a, b, c, ua, ub, uc) -> None:
        self.verts += [a, b, c]
        self.uvs += [ua, ub, uc]

    def quad(self, a, b, c, d, ua, ub, uc, ud) -> None:
        """Cuadrilátero a-b-c-d en sentido antihorario visto desde la cara visible."""
        self.tri(a, b, c, ua, ub, uc)
        self.tri(a, c, d, ua, uc, ud)

    def quad_double(self, a, b, c, d, ua, ub, uc, ud) -> None:
        self.quad(a, b, c, d, ua, ub, uc, ud)
        self.quad(d, c, b, a, ud, uc, ub, ua)

    def flat_polygon(self, poly: Polygon | MultiPolygon, z, uv_of, up: bool = True) -> None:
        """Polígono horizontal (con agujeros) triangulado; `z` constante o función z(x, y)."""
        for p in getattr(poly, "geoms", [poly]):
            if p.is_empty or p.area < 1e-6:
                continue
            rings = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
            pts = np.vstack(rings)
            ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
            idx = earcut.triangulate_float64(pts, ends).reshape(-1, 3)
            zf = z if callable(z) else (lambda x, y, zz=z: zz)
            for i, j, k in idx:
                a, b, c = pts[i], pts[j], pts[k]
                ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0
                if ccw != up:
                    b, c = c, b
                self.tri(*(np.array([q[0], q[1], zf(q[0], q[1])]) for q in (a, b, c)), *(uv_of(q[0], q[1]) for q in (a, b, c)))

    def to_arrays(self):
        return np.asarray(self.verts, np.float32).reshape(-1, 3), np.asarray(self.uvs, np.float32).reshape(-1, 2)


# --------------------------------------------------------------------------- primitivas

def subdivide(a: Vec, b: Vec, step: float) -> list[Vec]:
    n = max(1, int(math.ceil(np.linalg.norm(b - a) / step)))
    return [a + (b - a) * k / n for k in range(n + 1)]


def wall_along(mesh: Mesh, path: list[Vec], z0, z1, u_scale: float, v_scale: float, thickness: float = 0.0,
               v_offset: float = 0.0, closed: bool = False) -> None:
    """Muro vertical a lo largo de una polilínea (doble cara; con espesor si thickness > 0).

    z0/z1 constantes o funciones z(x, y). UV: u = distancia/u_scale, v = (altura − z0 + v_offset)/v_scale.
    """
    pts = list(path) + ([path[0]] if closed else [])
    zf0 = z0 if callable(z0) else (lambda x, y: z0)
    zf1 = z1 if callable(z1) else (lambda x, y: z1)
    s = 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        L = float(np.linalg.norm(b - a))
        if L < 1e-6:
            continue
        nl = left(unit(b - a)) * thickness / 2
        u0, u1 = s / u_scale, (s + L) / u_scale
        ha0, ha1, hb0, hb1 = zf0(*a), zf1(*a), zf0(*b), zf1(*b)
        uv = [(u0, v_offset / v_scale), (u1, v_offset / v_scale),
              (u1, (hb1 - hb0 + v_offset) / v_scale), (u0, (ha1 - ha0 + v_offset) / v_scale)]

        def face(off):
            pa, pb = a + off, b + off
            return [np.array([*pa, ha0]), np.array([*pb, hb0]), np.array([*pb, hb1]), np.array([*pa, ha1])]

        if thickness == 0:
            mesh.quad_double(*face(nl), *uv)  # el orden a→b mira a la derecha; quad_double añade la otra cara
        else:
            A, B, C, D = face(-nl)                 # cara derecha
            mesh.quad(A, B, C, D, *uv)
            A, B, C, D = face(nl)                  # cara izquierda (orden invertido)
            mesh.quad(B, A, D, C, uv[1], uv[0], uv[3], uv[2])
            ar, br, bl, al = a - nl, b - nl, b + nl, a + nl  # remate superior
            mesh.quad(np.array([*ar, ha1]), np.array([*br, hb1]), np.array([*bl, hb1]), np.array([*al, ha1]),
                      (u0, 0), (u1, 0), (u1, 0.05), (u0, 0.05))
        s += L


def box(mesh: Mesh, center: Vec, size_u: float, size_v: float, z0: float, z1: float, angle: float, uv_scale: float = 1.0,
        top: bool = True) -> None:
    """Caja orientada (ángulo en radianes respecto al eje x) con caras hacia fuera."""
    du = np.array([math.cos(angle), math.sin(angle)]) * size_u / 2
    dv = np.array([-math.sin(angle), math.cos(angle)]) * size_v / 2
    c = [center - du - dv, center + du - dv, center + du + dv, center - du + dv]
    perim = 0.0
    for i in range(4):
        a, b = c[i], c[(i + 1) % 4]
        L = float(np.linalg.norm(b - a))
        mesh.quad(np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z1]), np.array([*a, z1]),
                  (perim / uv_scale, 0), ((perim + L) / uv_scale, 0), ((perim + L) / uv_scale, (z1 - z0) / uv_scale), (perim / uv_scale, (z1 - z0) / uv_scale))
        perim += L
    if top:
        mesh.quad(*(np.array([*p, z1]) for p in c), (0, 0), (1, 0), (1, 1), (0, 1))


def cylinder(mesh: Mesh, center: Vec, r0: float, r1: float, z0: float, z1: float, sides: int = 10) -> None:
    for k in range(sides):
        a0, a1 = 2 * math.pi * k / sides, 2 * math.pi * (k + 1) / sides
        p = lambda a, r, z: np.array([center[0] + math.cos(a) * r, center[1] + math.sin(a) * r, z])
        mesh.quad(p(a0, r0, z0), p(a1, r0, z0), p(a1, r1, z1), p(a0, r1, z1),
                  (k / sides, 0), ((k + 1) / sides, 0), ((k + 1) / sides, 1), (k / sides, 1))


def segment(mesh: Mesh, a3: Vec, b3: Vec, radius: float, sides: int = 6) -> None:
    """Tubo entre dos puntos 3D (brazos de farola, cables)."""
    axis = unit(b3 - a3)
    ref = np.array([0, 0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0, 0])
    e1 = unit(np.cross(axis, ref))
    e2 = np.cross(axis, e1)
    for k in range(sides):
        t0, t1 = 2 * math.pi * k / sides, 2 * math.pi * (k + 1) / sides
        o0 = (math.cos(t0) * e1 + math.sin(t0) * e2) * radius
        o1 = (math.cos(t1) * e1 + math.sin(t1) * e2) * radius
        mesh.quad(a3 + o0, a3 + o1, b3 + o1, b3 + o0, (k / sides, 0), ((k + 1) / sides, 0), ((k + 1) / sides, 1), (k / sides, 1))


# --------------------------------------------------------------------------- escena

@dataclass
class MaterialDef:
    image: str                    # archivo en presets/<id>/textures/
    detail: str | None = None     # textura de detalle (multiplicada; máscara = alfa de `image`)
    detail_mult: float = 1.0      # repeticiones del detalle por unidad de UV
    alpha: bool = False           # recorte por alfa (vallas, hojas)
    roughness: float = 0.85
    metallic: float = 0.0


class Scene:
    def __init__(self, site_id: str):
        self.site_id = site_id
        self.meshes: list[Mesh] = []
        self.materials: dict[str, MaterialDef] = {}
        self.textures: dict[str, np.ndarray | Path] = {}  # nombre → imagen (array RGBA/RGB) o archivo a copiar
        self.meta: dict = {}

    def mesh(self, name: str, material: str, renderable: bool = True, heightfield: bool = True) -> Mesh:
        m = Mesh(name, material, renderable, heightfield)
        self.meshes.append(m)
        return m

    def save(self) -> Path:
        from PIL import Image

        out = BUILD_DIR / self.site_id
        tex_dir = ROOT / "presets" / self.site_id / "textures"
        tex_dir.mkdir(parents=True, exist_ok=True)
        for old in tex_dir.iterdir():
            old.unlink()
        for name, src in self.textures.items():
            if isinstance(src, Path):
                Image.open(src).save(tex_dir / name)
            else:
                Image.fromarray(np.clip(src, 0, 255).astype(np.uint8)).save(tex_dir / name)
        arrays, objects = {}, []
        for i, m in enumerate(self.meshes):
            if not m.verts:
                continue
            v, uv = m.to_arrays()
            arrays[f"v{i}"], arrays[f"uv{i}"] = v, uv
            objects.append({"name": m.name, "material": m.material, "renderable": m.renderable, "heightfield": m.heightfield,
                            "key": i, "tris": len(v) // 3})
        np.savez_compressed(out / "scene.npz", **arrays)
        (out / "scene.json").write_text(json.dumps({
            "site": self.site_id,
            "objects": objects,
            "materials": {k: vars(v) for k, v in self.materials.items()},
            "meta": self.meta,
        }, indent=2), encoding="utf-8")
        print(f"[scene] {self.site_id}: {len(objects)} objetos, {sum(o['tris'] for o in objects):,} triángulos")
        return out


# --------------------------------------------------------------------------- texturas

def load_rgb(path: Path, size: int | None = None) -> np.ndarray:
    from PIL import Image

    im = Image.open(path).convert("RGB")
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im, np.float32)


def normalized_detail(path: Path, size: int = 1024, mean: float = 0.82) -> np.ndarray:
    """Textura de detalle en escala de grises con media fija: al multiplicarla no oscurece la base."""
    rgb = load_rgb(path, size)
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    lum = lum / lum.mean() * mean * 255
    return np.repeat(np.clip(lum, 0, 255)[..., None], 3, axis=2)


def value_noise(h: int, w: int, cells: int, seed: int) -> np.ndarray:
    from PIL import Image

    rng = np.random.default_rng(seed)
    small = rng.random((cells, cells)).astype(np.float32)
    return np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255


def draw_lines(img_alpha: np.ndarray, img_rgb: np.ndarray, lines: list[tuple[Vec, Vec]], to_px, width_m: float,
               px_per_m: float, color=(236, 236, 228)) -> None:
    """Pinta segmentos (en metros locales) sobre una textura RGBA con antialias simple."""
    from PIL import Image, ImageDraw

    h, w = img_alpha.shape
    scale = 4  # sobremuestreo para el antialias
    mask = Image.new("L", (w * scale, h * scale), 0)
    d = ImageDraw.Draw(mask)
    lw = max(1, int(round(width_m * px_per_m * scale)))
    for a, b in lines:
        pa, pb = to_px(a) * scale, to_px(b) * scale
        d.line([tuple(pa), tuple(pb)], fill=255, width=lw)
    m = np.asarray(mask.resize((w, h), Image.BOX), np.float32) / 255
    img_alpha[:] = np.maximum(img_alpha, m * 255)
    img_rgb[:] = img_rgb * (1 - m[..., None]) + np.array(color, np.float32) * m[..., None]


def polygon_lines(poly: Polygon) -> list[tuple[Vec, Vec]]:
    c = np.asarray(poly.exterior.coords)
    return [(c[i], c[i + 1]) for i in range(len(c) - 1)]


def clip_segment(a: Vec, b: Vec, poly: Polygon) -> list[tuple[Vec, Vec]]:
    g = LineString([a, b]).intersection(poly)
    out = []
    for part in getattr(g, "geoms", [g]):
        if part.is_empty or part.geom_type != "LineString":
            continue
        c = np.asarray(part.coords)
        out.append((c[0], c[-1]))
    return out
