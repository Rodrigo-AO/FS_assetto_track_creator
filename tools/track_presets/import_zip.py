"""Sustituye un circuito de src/domain/trackPresets/autocross.json por el de un .zip exportado con la app.

Lee el proyecto editable del .zip (atc/project.json) y guarda su trazado, conos y salida en el plano
del preset (mismo origen que ya tenía). El preset de mapa no cambia.

    tools/presets/.venv/Scripts/python.exe tools/track_presets/import_zip.py jerez_parking ruta/atc_jerez_parking.zip
"""

from __future__ import annotations

import json
import math
import sys
import zipfile

from digitize import OUT, R, bezier, save
import numpy as np


def length_of(anchors: list[dict], closed: bool) -> float:
    n = len(anchors)
    total = 0.0
    for i in range(n if closed else n - 1):
        a, b = anchors[i], anchors[(i + 1) % n]
        q = bezier(*(np.array(v, float) for v in (a["p"], a["out"], b["in"], b["p"])), np.linspace(0, 1, 64))
        total += float(np.linalg.norm(np.diff(q, axis=0), axis=1).sum())
    return total


def layout_from_project(project: dict, origin: list[float]) -> dict:
    lat0, lng0 = origin
    k = R * math.cos(math.radians(lat0))

    def rel(q: dict) -> list[float]:
        return [round(math.radians(q["lng"] - lng0) * k, 2), round(math.radians(q["lat"] - lat0) * R, 2)]

    track, gate = project["track"], project["startFinish"]
    unsupported = [key for key in ("zones", "dirt", "relief", "sectors", "markings") if project.get(key)]
    if unsupported or track["autoCones"]:
        raise SystemExit(f"El preset no puede guardar: {', '.join(unsupported) or 'conos automáticos'}")
    anchors = [
        {"p": rel(a["position"]), "in": rel(a["handleIn"]), "out": rel(a["handleOut"]), "left": round(a["widthLeft"], 2), "right": round(a["widthRight"], 2)}
        for a in track["anchors"]
    ]
    return {"origin": origin, "length": round(length_of(anchors, track["closed"]), 1), "closed": track["closed"], "anchors": anchors,
            "cones": [{"p": rel(c["position"]), "color": c["color"]} for c in project["cones"]],
            "gate": {"left": rel(gate["left"]), "right": rel(gate["right"])}}


def main(preset_id: str, zip_path: str) -> None:
    data = json.loads(OUT.read_text(encoding="utf-8"))
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith("/atc/project.json"))
        project = json.loads(z.read(name))["project"]
    data[preset_id] = layout_from_project(project, data[preset_id]["origin"])
    save(data)


if __name__ == "__main__":
    main(*sys.argv[1:3])
