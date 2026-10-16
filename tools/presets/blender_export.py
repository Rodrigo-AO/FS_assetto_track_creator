"""Paso 3 del pipeline: exporta un .blend de preset a los archivos que usa la app.

    blender -b presets/<id>/<id>.blend --python tools/presets/blender_export.py -- <id>

El .blend es la fuente de verdad: se puede retocar a mano en Blender (respetando las convenciones
de blender_scene.py) y volver a exportar. Genera en public/presets/<id>/:
- <id>.kn5        escenario completo (suelos físicos, muros, farolas, árboles…) en coordenadas de AC.
- terrain.json    rejilla de alturas del suelo físico (para apoyar conos, líneas y coches de la app).
- manifest.json   metadatos (altura de referencia, tamaño, atribuciones).
- preview.jpg     vista previa del menú de presets.
"""

from __future__ import annotations

import base64
import json
import shutil
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from kn5_writer import Material, Mesh, Node, Texture, dds_bc1, dds_bc3, dds_rgba, write_kn5  # noqa: E402

GROUND_PREFIXES = ("1ROAD", "1GRASS", "1GRAVEL", "1SAND")
TRIS_PER_CHUNK = 65535 // 3
ALPHA_TEXTURE_MAX = 512
HEIGHT_CELL_M = 0.5
HEIGHT_MARGIN_M = 15.0
ATTRIBUTION = [
    "Escenario modelado a mano a partir de Google Maps, Street View y la ortofoto PNOA (CC-BY 4.0 scne.es).",
    "Texturas CC0 de Poly Haven (polyhaven.com).",
]


def log(*a):
    print("[blender_export]", *a, flush=True)


def image_rgba(img, max_size=None) -> np.ndarray:
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    arr = np.flipud((px.reshape(h, w, 4) * 255 + 0.5).clip(0, 255).astype(np.uint8))  # Blender: abajo → arriba
    while max_size and max(arr.shape[:2]) > max_size:
        a = arr.astype(np.float32)
        arr = ((a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4 + 0.5).astype(np.uint8)
    return arr


class Library:
    """Materiales y texturas del kn5, sin duplicados."""

    def __init__(self):
        self.textures: list[Texture] = []
        self.materials: list[Material] = []
        self.by_name: dict[str, int] = {}
        self.tex_names: set[str] = set()

    def texture(self, image, encoding: str, max_size=None) -> str:
        """Añade una imagen de Blender como DDS (rgba | dxt1 | dxt5) y devuelve su nombre."""
        # bpy.path.abspath: en Windows, Path("//textures/x.png") se interpreta como ruta de red.
        tex = Path(bpy.path.abspath(image.filepath)).stem.lower() + ".dds"
        if tex not in self.tex_names:
            rgba = image_rgba(image, max_size)
            data = {"rgba": lambda: dds_rgba(rgba), "dxt5": lambda: dds_bc3(rgba), "dxt1": lambda: dds_bc1(rgba[..., :3])}[encoding]()
            self.textures.append(Texture(tex, data))
            self.tex_names.add(tex)
            log(f"Textura {tex} {rgba.shape[1]}×{rgba.shape[0]} {encoding.upper()}")
        return tex

    def solid(self, name: str, rgba) -> str:
        if name not in self.tex_names:
            self.textures.append(Texture(name, dds_rgba(np.tile(np.array(rgba, np.uint8), (4, 4, 1)))))
            self.tex_names.add(name)
        return name

    def material(self, bmat) -> int:
        key = bmat.name if bmat else "ATC_DEFAULT"
        if key in self.by_name:
            return self.by_name[key]
        images = [n.image for n in bmat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image] if bmat else []
        alpha = bool(bmat and bmat.get("ac_alpha", 0))
        detail_name = bmat.get("ac_detail") if bmat else None
        if detail_name:
            # Base con máscara en el alfa (DXT5) × detalle repetido, como el suelo de las pistas de Kunos.
            detail = next(i for i in images if Path(bpy.path.abspath(i.filepath)).name == detail_name)
            base = next(i for i in images if i is not detail)
            flat = self.solid("atc_flat_nm.dds", (128, 128, 255, 255))
            maps = self.solid("atc_maps.dds", (60, 60, 0, 255))
            textures = [("txDiffuse", 0, self.texture(base, "dxt5")), ("txNormal", 1, flat), ("txMaps", 2, maps),
                        ("txDetail", 3, self.texture(detail, "dxt1")), ("txNormalDetail", 4, flat)]
            props = [("ksAmbient", 0.3), ("ksDiffuse", 0.25), ("ksSpecular", 0.05), ("ksSpecularEXP", 15.0), ("ksEmissive", 0.0),
                     ("ksAlphaRef", 0.0), ("fresnelC", 0.0), ("fresnelEXP", 2.0), ("fresnelMaxLevel", 0.0), ("isAdditive", 0.0),
                     ("useDetail", 1.0), ("detailUVMultiplier", float(bmat["ac_detail_mult"])), ("shadowBiasMult", 0.0),
                     ("detailNormalBlend", 0.0)]
            self.materials.append(Material(key, "ksPerPixelMultiMap_NMDetail", props, textures, False))
        else:
            textures = [("txDiffuse", 0, self.texture(images[0], "rgba" if alpha else "dxt1", ALPHA_TEXTURE_MAX if alpha else None))] if images else []
            props = [("ksAmbient", 0.3), ("ksDiffuse", 0.3), ("ksSpecular", 0.08), ("ksSpecularEXP", 20.0),
                     ("ksEmissive", 0.0), ("ksAlphaRef", 0.5 if alpha else 0.0)]
            self.materials.append(Material(key, "ksPerPixelAT" if alpha else "ksPerPixel", props, textures, alpha))
        self.by_name[key] = len(self.materials) - 1
        return self.by_name[key]


def to_ac(v: np.ndarray) -> np.ndarray:
    """Blender (x este, y norte, z arriba) → AC (X este, Y arriba, Z sur). Es una rotación: conserva el giro."""
    return np.column_stack([v[:, 0], v[:, 2], -v[:, 1]]).astype(np.float32)


def object_nodes(ob, depsgraph, lib: Library) -> list[Node]:
    ev = ob.evaluated_get(depsgraph)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    if nt == 0:
        ev.to_mesh_clear()
        return []
    tri_loops = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tri_loops)
    tri_mat = np.empty(nt, np.int32)
    me.loop_triangles.foreach_get("material_index", tri_mat)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    loop_vert = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", loop_vert)
    nrm = np.empty(len(me.loops) * 3, np.float32)
    me.corner_normals.foreach_get("vector", nrm)
    uv = np.zeros(len(me.loops) * 2, np.float32)
    if me.uv_layers.active:
        me.uv_layers.active.data.foreach_get("uv", uv)
    mw = np.array(ob.matrix_world, np.float32)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    nrm = nrm.reshape(-1, 3) @ np.linalg.inv(mw[:3, :3]).T
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    uv = uv.reshape(-1, 2)
    mats = [s.material for s in ob.material_slots] or [None]
    renderable = not ob.get("ac_renderable", 1) == 0
    shadows = renderable and not ob.name.startswith(GROUND_PREFIXES + ("HORIZON",))
    nodes = []
    tris = tri_loops.reshape(-1, 3)
    for m in np.unique(tri_mat):
        sel = tris[tri_mat == m]
        mat_idx = lib.material(mats[min(m, len(mats) - 1)])
        suffix = f"_{mats[min(m, len(mats) - 1)].name}" if len(mats) > 1 and mats[0] else ""
        for k, start in enumerate(range(0, len(sel), TRIS_PER_CHUNK)):
            corners = sel[start:start + TRIS_PER_CHUNK].ravel()
            data = np.hstack([to_ac(co[loop_vert[corners]]), to_ac(nrm[corners]),
                              np.column_stack([uv[corners, 0], 1 - uv[corners, 1]])])
            uniq, inv = np.unique(np.round(data, 5), axis=0, return_inverse=True)
            mesh = Mesh(uniq[:, 0:3].astype(np.float32), uniq[:, 3:6].astype(np.float32), uniq[:, 6:8].astype(np.float32),
                        inv.ravel().astype(np.uint16), mat_idx, cast_shadows=shadows, renderable=renderable)
            nodes.append(Node(f"{ob.name}{suffix}_{k}", mesh))
    ev.to_mesh_clear()
    return nodes


def height_grid(depsgraph, polygon: np.ndarray):
    """Rejilla de alturas del suelo físico (rayos verticales, impacto más alto)."""
    # ac_heightfield = 0: superficies que no sirven para apoyar conos (p. ej. el tablero sobre un túnel)
    trees = [BVHTree.FromObject(ob, depsgraph) for ob in bpy.context.scene.objects
             if ob.type == "MESH" and ob.name.startswith(GROUND_PREFIXES) and ob.get("ac_heightfield", 1) != 0]
    x0, y0 = np.floor(polygon.min(0) - HEIGHT_MARGIN_M)
    x1, y1 = np.ceil(polygon.max(0) + HEIGHT_MARGIN_M)
    nx, ny = int((x1 - x0) / HEIGHT_CELL_M) + 1, int((y1 - y0) / HEIGHT_CELL_M) + 1
    heights = np.full((ny, nx), -32768, np.int16)
    down = Vector((0, 0, -1))
    for j in range(ny):
        for i in range(nx):
            origin = Vector((x0 + i * HEIGHT_CELL_M, y0 + j * HEIGHT_CELL_M, 200.0))
            best = None
            for t in trees:
                hit = t.ray_cast(origin, down)[0]
                if hit is not None and (best is None or hit.z > best):
                    best = hit.z
            if best is not None:
                heights[j, i] = int(round(best * 100))
    return {"x0": float(x0), "y0": float(y0), "cell": HEIGHT_CELL_M, "nx": nx, "ny": ny, "unit": "cm",
            "heights": base64.b64encode(heights.astype("<i2").tobytes()).decode("ascii")}


def main(site_id: str):
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lib = Library()
    children = []
    for ob in scene.objects:
        if ob.type == "MESH":
            nodes = object_nodes(ob, depsgraph, lib)
            children.extend(nodes)
            log(f"{ob.name}: {len(nodes)} malla(s)")
    out = ROOT / "public" / "presets" / site_id
    out.mkdir(parents=True, exist_ok=True)
    kn5 = write_kn5(lib.textures, lib.materials, Node(f"ATC_PRESET_{site_id.upper()}", None, children))
    (out / f"{site_id}.kn5").write_bytes(kn5)
    polygon = np.array(scene["atc_polygon"], float).reshape(-1, 2)
    (out / "terrain.json").write_text(json.dumps(height_grid(depsgraph, polygon)), encoding="utf-8")
    (out / "manifest.json").write_text(json.dumps({
        "id": site_id, "kn5": f"{site_id}.kn5", "kn5Bytes": len(kn5), "zRef": float(scene["atc_z_ref"]),
        "attribution": ATTRIBUTION,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    preview = ROOT / "presets" / site_id / "preview.jpg"
    if preview.exists():
        shutil.copy(preview, out / "preview.jpg")
    log(f"kn5 {len(kn5) / 1e6:.1f} MB · {len(children)} nodos · {len(lib.materials)} materiales → {out}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1])
