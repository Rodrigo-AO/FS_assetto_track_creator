"""Sistemas de coordenadas compartidos por el pipeline de presets y la app.

- UTM 29N (EPSG:25829): sistema de la ortofoto PNOA que se usa como referencia.
- Plano local de la app: equirectangular centrado en el centroide de los vértices del
  polígono, x este / y norte en metros. Es *exactamente* `LocalProjection` de
  `src/domain/geo/projection.ts`, para que el kn5 del preset y el que genera la app encajen.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
SITES_JSON = ROOT / "src" / "domain" / "presets" / "sites.json"
BUILD_DIR = Path(__file__).resolve().parent / "build"

EARTH_RADIUS_M = 6378137.0
DEG = math.pi / 180

_TO_LATLNG = Transformer.from_crs(25829, 4326, always_xy=True)
_TO_UTM = Transformer.from_crs(4326, 25829, always_xy=True)


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    description: str
    polygon: list[tuple[float, float]]  # (lat, lng), sin repetir el primer vértice


def load_sites() -> dict[str, Site]:
    raw = json.loads(SITES_JSON.read_text(encoding="utf-8"))
    return {s["id"]: Site(s["id"], s["name"], s["description"], [tuple(p) for p in s["polygon"]]) for s in raw}


class LocalFrame:
    """Plano tangente de la app (ver LocalProjection.centeredOn)."""

    def __init__(self, polygon: list[tuple[float, float]]):
        self.lat0 = sum(p[0] for p in polygon) / len(polygon)
        self.lng0 = sum(p[1] for p in polygon) / len(polygon)
        self.m_lat = EARTH_RADIUS_M * DEG
        self.m_lng = EARTH_RADIUS_M * DEG * math.cos(self.lat0 * DEG)

    def latlng_to_local(self, lat, lng):
        return (np.asarray(lng) - self.lng0) * self.m_lng, (np.asarray(lat) - self.lat0) * self.m_lat

    def local_to_latlng(self, x, y):
        return self.lat0 + np.asarray(y) / self.m_lat, self.lng0 + np.asarray(x) / self.m_lng

    def utm_to_local(self, ex, ny):
        lng, lat = _TO_LATLNG.transform(np.asarray(ex, dtype=float), np.asarray(ny, dtype=float))
        return self.latlng_to_local(lat, lng)

    def local_to_utm(self, x, y):
        lat, lng = self.local_to_latlng(x, y)
        return _TO_UTM.transform(np.asarray(lng, dtype=float), np.asarray(lat, dtype=float))
