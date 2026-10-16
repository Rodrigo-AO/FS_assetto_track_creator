"""Paso 2 del pipeline: escena modelada (scenes/<id>.py) → presets/<id>/<id>.blend editable.

    blender -b --factory-startup --python tools/presets/blender_scene.py -- <id>

Convenciones del .blend (las usa blender_export.py):
- Coordenadas = plano local de la app (x este, y norte, z arriba), metros; z = 0 a nivel de calle.
- Nombre del objeto = nodo kn5 (física de Kunos: `1ROAD_…`, `1GRASS_…`, `1WALL_…`).
- Objeto con `ac_renderable = 0` → solo física; con `ac_heightfield = 0` → no cuenta como suelo para
  apoyar conos (p. ej. el tablero del puente sobre el túnel).
- Material con `ac_alpha = 1` → recorte por alfa; con `ac_detail` → textura de detalle multiplicada
  (`ac_detail_mult` repeticiones por unidad de UV) y máscara en el alfa de la base.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EARTH_RADIUS_M = 6378137.0


def log(*a):
    print("[blender_scene]", *a, flush=True)


def local_polygon(site_id: str) -> list[list[float]]:
    """Polígono del preset en el plano local (misma fórmula que LocalProjection de la app)."""
    sites = json.loads((ROOT / "src" / "domain" / "presets" / "sites.json").read_text(encoding="utf-8"))
    poly = next(s for s in sites if s["id"] == site_id)["polygon"]
    lat0 = sum(p[0] for p in poly) / len(poly)
    lng0 = sum(p[1] for p in poly) / len(poly)
    k = EARTH_RADIUS_M * math.pi / 180
    return [[(lng - lng0) * k * math.cos(math.radians(lat0)), (lat - lat0) * k] for lat, lng in poly]


def make_material(name: str, spec: dict, tex_dir: Path):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    base = nt.nodes.new("ShaderNodeTexImage")
    base.image = bpy.data.images.load(str(tex_dir / spec["image"]), check_existing=True)
    bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.85)
    bsdf.inputs["Metallic"].default_value = spec.get("metallic", 0.0)
    color = base.outputs["Color"]
    if spec.get("detail"):
        # color = base · mezcla(detalle, 1, alfa_base): igual que ksPerPixelMultiMap_NMDetail en AC
        uv = nt.nodes.new("ShaderNodeTexCoord")
        mapping = nt.nodes.new("ShaderNodeMapping")
        mult = spec["detail_mult"]
        mapping.inputs["Scale"].default_value = (mult, mult, 1)
        nt.links.new(uv.outputs["UV"], mapping.inputs["Vector"])
        detail = nt.nodes.new("ShaderNodeTexImage")
        detail.image = bpy.data.images.load(str(tex_dir / spec["detail"]), check_existing=True)
        nt.links.new(mapping.outputs["Vector"], detail.inputs["Vector"])
        mask = nt.nodes.new("ShaderNodeMix")
        mask.data_type = "RGBA"
        nt.links.new(base.outputs["Alpha"], mask.inputs["Factor"])
        nt.links.new(detail.outputs["Color"], mask.inputs["A"])
        mask.inputs["B"].default_value = (1, 1, 1, 1)
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(base.outputs["Color"], mul.inputs["A"])
        nt.links.new(mask.outputs["Result"], mul.inputs["B"])
        color = mul.outputs["Result"]
        mat["ac_detail"] = spec["detail"]
        mat["ac_detail_mult"] = float(mult)
    nt.links.new(color, bsdf.inputs["Base Color"])
    if spec.get("alpha"):
        nt.links.new(base.outputs["Alpha"], bsdf.inputs["Alpha"])
        for attr, value in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
            try:
                setattr(mat, attr, value)
            except (AttributeError, TypeError):
                pass
        mat["ac_alpha"] = 1
    return mat


def make_object(name: str, verts: np.ndarray, uvs: np.ndarray, mat, col, renderable: bool, heightfield: bool):
    tris = np.arange(len(verts)).reshape(-1, 3)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.astype(np.float64), [], tris)
    uv = me.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", uvs.ravel())
    me.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)  # malla soldada: más cómoda de editar
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if not renderable:
        ob["ac_renderable"] = 0
        ob.hide_render = True
        ob.display_type = "WIRE"
    if not heightfield:
        ob["ac_heightfield"] = 0
    return ob


def render_previews(target: Vector, extent: float, eye: Vector | None, look: Vector | None, out_dir: Path):
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.image_settings.file_format = "JPEG"
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("Cielo")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.6, 0.9, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.world = world
    sun = bpy.data.objects.new("Sol", bpy.data.lights.new("Sol", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(1.0)
    sun.rotation_euler = (math.radians(35), 0, math.radians(140))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cámara", bpy.data.cameras.new("Cámara"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 28
    cam.location = target + Vector((-0.7, -0.9, 0.55)).normalized() * extent
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(out_dir / "preview.jpg")
    bpy.ops.render.render(write_still=True)
    if eye is not None:
        cam.location = eye
        cam.data.lens = 22
        cam.rotation_euler = (look - eye).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(out_dir / "preview_ground.jpg")
        bpy.ops.render.render(write_still=True)


def main(site_id: str):
    build = HERE / "build" / site_id
    spec = json.loads((build / "scene.json").read_text(encoding="utf-8"))
    data = np.load(build / "scene.npz")
    out_dir = ROOT / "presets" / site_id
    tex_dir = out_dir / "textures"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    mats = {name: make_material(name, m, tex_dir) for name, m in spec["materials"].items()}
    collections = {}
    for o in spec["objects"]:
        group = "Física invisible" if not o["renderable"] else o["name"].split("_")[0].lstrip("1") or "Escenario"
        if group not in collections:
            collections[group] = bpy.data.collections.new(group)
            bpy.context.scene.collection.children.link(collections[group])
        make_object(o["name"], data[f"v{o['key']}"], data[f"uv{o['key']}"], mats[o["material"]], collections[group],
                    o["renderable"], o.get("heightfield", True))
    log(f"{len(spec['objects'])} objetos, {len(mats)} materiales")

    scene = bpy.context.scene
    scene["atc_site"] = site_id
    scene["atc_z_ref"] = 0.0
    scene["atc_polygon"] = [c for p in local_polygon(site_id) for c in p]
    blend = out_dir / f"{site_id}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_mainfile()
    meta = spec.get("meta", {})
    t = meta.get("preview_target", [0, 0])
    eye = Vector(meta["preview_eye"]) if "preview_eye" in meta else None
    look = Vector(meta["preview_look"]) if "preview_look" in meta else None
    render_previews(Vector((t[0], t[1], 0)), meta.get("preview_extent", 150.0), eye, look, out_dir)
    bpy.ops.wm.save_mainfile()
    log(f"Guardado {blend}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1])
