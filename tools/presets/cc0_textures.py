"""Descarga las texturas CC0 de Poly Haven que usan los escenarios de los presets.

    tools/presets/.venv/Scripts/python tools/presets/cc0_textures.py

Poly Haven publica sus texturas bajo CC0 (dominio público): se pueden incluir en las pistas
sin atribución. Se guardan en presets/common/cc0/<id>_diff.jpg (y _nor_gl.jpg si se pide).
"""

from __future__ import annotations

import requests

from geo import ROOT

OUT = ROOT / "presets" / "common" / "cc0"
RES = "2k"

# id de Poly Haven → uso en los escenarios
TEXTURES = {
    "clean_asphalt": "asfalto del parking (detalle de grano, sin grietas que se repitan)",
    "asphalt_02": "asfalto de las calles exteriores",
    "asphalt_track": "asfalto de calles y del puente (detalle)",
    "concrete_floor_worn_001": "hormigón de gradas, muros y aceras",
    "concrete_block_wall": "murete de bloque bajo la chapa",
    "corrugated_iron_02": "chapa grecada (relieve de las paredes)",
    "brick_pavement_02": "adoquín rojizo de los paseos de la ETSI",
    "concrete_floor_painted": "pista pintada (detalle)",
    "leafy_grass": "césped de los taludes de la ETSI",
}


def download(asset: str) -> None:
    files = requests.get(f"https://api.polyhaven.com/files/{asset}", timeout=60).json()
    url = files["Diffuse"][RES]["jpg"]["url"]
    data = requests.get(url, timeout=300).content
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{asset}_diff.jpg").write_bytes(data)
    print(f"{asset}: {len(data) / 1e6:.1f} MB · {TEXTURES[asset]}")


if __name__ == "__main__":
    for asset in TEXTURES:
        download(asset)
    (OUT / "LICENSE.txt").write_text(
        "Texturas de Poly Haven (https://polyhaven.com), licencia CC0 1.0 (dominio público).\n"
        + "\n".join(f"- {a}: https://polyhaven.com/a/{a}" for a in TEXTURES) + "\n",
        encoding="utf-8",
    )
