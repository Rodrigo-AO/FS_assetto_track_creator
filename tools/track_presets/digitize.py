"""Digitalización de los circuitos de AutoX de la página de Notion «Circuitos de autoX».

Cada dibujo (píxeles de la imagen) se lleva al terreno con una semejanza calculada contra la
ortofoto PNOA: emparejando rasgos (Jerez) o con las farolas L1-L3 del parking (Isla Mágica). El
trazado se define con pares (borde izquierdo, borde derecho) en el sentido de la marcha; de ellos
salen el eje, los anchos y los conos. Genera «Isla Mágica Pruebas de Piloto» en
src/domain/trackPresets/autocross.json; los dos circuitos de Jerez, retocados a mano en la app, se
importan con import_zip.py. PARK y las georreferencias de Jerez las usan los escenarios.

    tools/presets/.venv/Scripts/python.exe tools/track_presets/digitize.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "domain" / "trackPresets" / "autocross.json"
R = 6378137.0

# Semejanza píxel → plano tangente en (lat0, lng0): z·(x − i·y) + t, en metros (este + i·norte).
GEOREF = json.loads((Path(__file__).parent / "georef.json").read_text())

CONE_STEP_M = 5.0      # separación de los conos de borde (la habitual de la app)
MAX_ANCHOR_M = 18.0    # separación máxima entre puntos de paso
MIN_HALF_M = 1.5       # ancho mínimo de pista del reglamento (3 m)
TOLERANCE_M = 0.12     # error máximo del eje al simplificarlo


def arc(c, r_out, r_in, degs):
    """Pares (exterior, interior) de un anillo recorrido en horario (grados de pantalla, y hacia abajo)."""
    out = []
    for d in degs:
        a = math.radians(d)
        out.append(((c[0] + r_out * math.cos(a), c[1] + r_out * math.sin(a)), (c[0] + r_in * math.cos(a), c[1] + r_in * math.sin(a))))
    return out


def lane(points, half):
    """Tramo sin bordes dibujados (slalom): pares a `half` píxeles del eje."""
    p = np.array(points, float)
    t = np.gradient(p, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    n = np.c_[t[:, 1], -t[:, 0]]  # izquierda en pantalla (y hacia abajo)
    return [(tuple(a + b * half), tuple(a - b * half)) for a, b in zip(p, n)]


def P(text):
    """'x,y-x,y  x,y-x,y …' → pares (izquierda, derecha)."""
    return [tuple(tuple(map(float, q.split(","))) for q in pair.split("-")) for pair in text.split()]


# --------------------------------------------------------------------------- Isla Mágica Pruebas de Piloto
# (la variante amarilla del dibujo no se incluye: se sigue el trazado negro)

ISLA = [
    ("edge", P("""
        68,237-138,240 75,180-138,182 84,130-146,150 99,80-163,115 125,48-190,82 165,22-235,67 240,9-255,66 350,8-350,66
        450,7-450,66 550,7-550,66 650,9-650,66 725,12-725,66 772,20-757,76 802,46-778,100 830,66-800,126 860,73-850,130
        892,73-893,130 922,62-922,127 950,43-944,108 972,22-966,82 994,15-993,67 1032,30-1022,76 1058,62-1038,102
        1080,122-1049,150 1096,195-1058,205 1105,260-1066,268 1114,325-1074,325 1119,382-1074,370 1110,425-1066,405
        1094,460-1054,438 1066,486-1034,456 1030,497-1005,458 985,501-972,460""")),
    ("edge", [((984, 535), (925, 515))] + arc((862, 510), 125, 62, [25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 272])),
    ("edge", P("""
        897,390-885,450 925,402-925,456 944,384-960,437 967,342-993,364 980,305-1020,312 988,262-1029,262 986,241-1033,212
        972,231-1019,184 955,228-975,166 930,238-942,172 900,262-903,200 870,291-868,229 843,322-832,270 800,345-797,300
        760,362-752,308 722,369-715,314 690,369-699,298 660,340-681,270 641,305-659,250 620,277-630,228 590,272-600,219
        555,282-555,222 500,290-500,243 440,289-440,225 398,280-397,203 366,262-368,182 345,232-350,150 330,205-336,124
        317,182-312,117 306,196-272,128 297,217-247,150 291,235-222,205 290,243-214,245""")),
    ("slalom", lane([(238, 290), (255, 338), (305, 352), (355, 365), (378, 400), (388, 445), (425, 478), (485, 484), (540, 480)], 22)),
    ("edge", [((561, 458), (560, 509)), ((585, 425), (600, 500))] + arc((673, 510), 125, 62, [228, 250, 272, 295, 320, 345, 10, 35, 60, 85])),
    ("edge", P("""
        640,633-652,567 605,620-605,558 550,611-550,555 490,611-490,555 440,612-445,557 392,607-400,548 358,599-380,530
        325,568-362,508 297,546-342,491 258,526-298,478 215,516-250,472 165,511-205,466 130,497-180,453 104,465-158,427
        80,425-143,395 62,380-135,365 54,330-130,322 49,280-128,278""")),
]
ISLA_CONES = [("orange", [(70, 237), (138, 238), (215, 247), (290, 245), (273, 308), (341, 386), (432, 442)])]

# --------------------------------------------------------------------------- Jerez Parking (carretera pintada del escenario)

PARK = [("road", P("""
    515,550-515,529 450,549-450,527 390,548-390,526 330,547-330,524 292,544-292,522 264,537-275,521 246,522-264,512 238,503-259,498
    241,485-263,484 255,465-275,472 280,440-303,444 300,415-321,424 313,393-332,402 318,378-338,385 317,362-338,362 312,340-333,340
    305,312-326,312 298,285-318,282 290,258-311,251 284,238-304,233 275,222-298,214 266,213-289,200 256,209-271,190 248,209-251,186
    238,216-229,193 220,232-206,217 200,250-183,241 176,273-160,261 160,289-146,276 140,308-127,291 119,317-113,297 95,314-96,295
    70,304-75,284 46,292-54,272 28,279-42,263 19,262-38,253 18,245-40,241 25,225-48,231 37,206-58,214 58,173-77,181 75,145-94,152
    95,114-112,121 115,83-132,90 135,52-150,62 150,29-166,39 167,12-178,28 190,5-193,24 220,5-220,25 250,6-250,27 285,8-283,29
    310,10-303,30 330,18-316,36 343,33-324,47 350,52-330,62 354,80-335,84 360,110-341,113 367,150-349,152 374,190-356,192
    381,230-362,232 388,262-368,263 394,294-373,294 401,330-380,331 407,365-386,366 412,400-391,403 415,421-394,426 416,426-401,443
    417,428-417,453 418,426-433,443 419,421-440,423 417,395-440,398 416,350-439,350 415,310-438,310 414,270-437,270 413,235-435,235
    412,200-434,200 414,174-434,180 419,153-436,168 430,141-441,161 448,137-450,160 463,143-456,163 478,158-467,175 496,179-482,191
    515,200-500,211 530,216-512,222 537,232-518,233 536,249-515,245 524,265-505,252 509,275-490,263 500,286-482,276 498,302-478,298
    498,330-477,330 499,355-479,356 501,375-482,380 507,392-487,398 521,403-502,414 545,418-530,432 572,433-557,447 602,451-588,467
    622,464-606,479 634,481-615,492 639,500-619,502 635,520-616,512 625,536-607,523 610,546-595,529 592,551-572,531 555,552-555,531"""))]

# --------------------------------------------------------------------------- geometría

class Frame:
    def __init__(self, key):
        g = GEOREF[key]
        self.z, self.t = complex(*g["z"]), complex(*g["t"])
        self.lat0, self.lng0 = g["lat0"], g["lng0"]

    def world(self, pts):
        """Píxeles → metros (este, norte) respecto a (lat0, lng0)."""
        p = np.atleast_2d(np.array(pts, float))
        w = self.z * (p[:, 0] - 1j * p[:, 1]) + self.t
        return np.c_[w.real, w.imag]

    def pixel(self, xy):
        q = (complex(*xy) - self.t) / self.z
        return q.real, -q.imag

    def latlng(self, xy):
        return self.lat0 + math.degrees(xy[1] / R), self.lng0 + math.degrees(xy[0] / (R * math.cos(math.radians(self.lat0))))


def smooth_closed(a, sigma, step):
    k = int(4 * sigma / step)
    w = np.exp(-0.5 * (np.arange(-k, k + 1) * step / sigma) ** 2)
    w /= w.sum()
    pad = np.vstack([a[-k:], a, a[:k]])
    return np.array([np.convolve(pad[:, c], w, "valid") for c in range(a.shape[1])]).T


def catmull(p, per=24):
    """Spline de Catmull-Rom centrípeta cerrada, muestreada."""
    out = []
    n = len(p)
    for i in range(n):
        P0, P1, P2, P3 = p[i - 1], p[i], p[(i + 1) % n], p[(i + 2) % n]
        t = [0.0]
        for a, b in ((P0, P1), (P1, P2), (P2, P3)):
            t.append(t[-1] + max(np.linalg.norm((b - a)[:2]), 1e-3) ** 0.5)
        for u in np.linspace(t[1], t[2], per, endpoint=False):
            A1 = P0 + (P1 - P0) * (u - t[0]) / (t[1] - t[0])
            A2 = P1 + (P2 - P1) * (u - t[1]) / (t[2] - t[1])
            A3 = P2 + (P3 - P2) * (u - t[2]) / (t[3] - t[2])
            B1 = A1 + (A2 - A1) * (u - t[0]) / (t[2] - t[0])
            B2 = A2 + (A3 - A2) * (u - t[1]) / (t[3] - t[1])
            out.append(np.r_[(B1 + (B2 - B1) * (u - t[1]) / (t[2] - t[1]))[:3], P1[3]])
    return np.array(out)


def resample_closed(a, step):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([a, a[:1]])[:, :2], axis=0), axis=1))]
    n = int(round(d[-1] / step))
    s = np.arange(n) * d[-1] / n
    full = np.vstack([a, a[:1]])
    cols = [np.interp(s, d, full[:, c]) for c in range(3)]
    which = a[np.clip(np.searchsorted(d, s, side="right") - 1, 0, len(a) - 1), 3]
    return np.c_[np.array(cols).T, which], d[-1] / n


def bezier(p0, h0, h1, p1, t):
    u = 1 - t
    return (u**3)[:, None] * p0 + (3 * u * u * t)[:, None] * h0 + (3 * u * t * t)[:, None] * h1 + (t**3)[:, None] * p1


def fit_anchors(c, step):
    """Nodos Bézier que siguen el eje `c` (cerrado, muestreado cada `step`) con error < TOLERANCE_M."""
    n = len(c)
    tan = np.roll(c, -1, axis=0) - np.roll(c, 1, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    idx = [0]
    tt = np.linspace(0, 1, 60)
    while True:
        i, best = idx[-1], idx[-1] + 4
        for m in range(4, int(MAX_ANCHOR_M / step) + 1):
            j = i + m
            if j > n:
                break
            a, b = c[i % n], c[j % n]
            L = m * step / 3
            q = bezier(a, a + tan[i % n] * L, b - tan[j % n] * L, b, tt)
            seg = c[np.arange(i, j + 1) % n]
            err = ((q[:, None, :] - seg[None, :, :]) ** 2).sum(2)
            if math.sqrt(err.min(0).max()) > TOLERANCE_M:
                break
            best = j
        if best >= n:
            break
        idx.append(best)
    if n - idx[-1] < 4:
        idx.pop()
    out = []
    for k, i in enumerate(idx):
        nxt = idx[(k + 1) % len(idx)] + (n if k == len(idx) - 1 else 0)
        prv = idx[k - 1] - (n if k == 0 else 0)
        out.append((i, c[i], c[i] - tan[i] * (i - prv) * step / 3, c[i] + tan[i] * (nxt - i) * step / 3))
    return out


def build(key, parts, cone_groups, start_pair, edge_cones=True):
    f = Frame(key)
    pairs, kinds = [], []
    for kind, ps in parts:
        pairs += ps
        kinds += [kind] * len(ps)
    left, right = f.world([p[0] for p in pairs]), f.world([p[1] for p in pairs])
    ctrl = np.c_[(left + right) / 2, np.linalg.norm(left - right, axis=1) / 2, np.arange(len(pairs))]
    c, step = resample_closed(catmull(ctrl), 0.25)
    c[:, :3] = smooth_closed(c[:, :3], 0.9, step)
    axis, half, which = c[:, :2], np.maximum(c[:, 2], MIN_HALF_M), c[:, 3].astype(int)
    tan = np.roll(axis, -1, axis=0) - np.roll(axis, 1, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    nl = np.c_[-tan[:, 1], tan[:, 0]]

    origin = axis.mean(axis=0)
    lat, lng = f.latlng(origin)

    def rel(p):
        return [round(float(p[0] - origin[0]), 2), round(float(p[1] - origin[1]), 2)]

    anchors = []
    for i, p, hin, hout in fit_anchors(axis, step):
        w = round(float(half[i]), 2)
        anchors.append({"p": rel(p), "in": rel(hin), "out": rel(hout), "left": w, "right": w})

    cones, taken = [], []

    def put(color, p, gap=0.0):
        if any(np.linalg.norm(p - q) < gap for q in taken):
            return
        taken.append(p)
        cones.append({"p": rel(p), "color": color})

    for color, px in cone_groups:
        for p in f.world(px):
            put(color, p)
    n = len(axis)
    s = np.arange(n) * step
    total = n * step
    if edge_cones:
        # Conos en las líneas negras del dibujo: azules a la izquierda y amarillos a la derecha.
        for side, color in ((1, "blue"), (-1, "yellow")):
            edge = axis + nl * half[:, None] * side
            acc = CONE_STEP_M
            for i in range(n):
                acc += float(np.linalg.norm(edge[i] - edge[i - 1])) if i else 0.0
                if kinds[which[i]] != "edge" or acc < CONE_STEP_M:
                    continue
                # Fuera del carril de cualquier otro tramo (cruces y anillos que se solapan).
                ds = np.abs(s - s[i])
                ds = np.minimum(ds, total - ds)
                d = np.linalg.norm(axis - edge[i], axis=1)
                if np.any((ds > 12) & (d < half - 0.2)) or np.any(d < half * 0.8):
                    continue
                put(color, edge[i], 1.8)
                acc = 0.0

    sp = f.world(start_pair)
    return {"origin": [round(lat, 7), round(lng, 7)], "length": round(float(total), 1), "closed": True, "anchors": anchors, "cones": cones,
            "gate": {"left": rel(sp[0]), "right": rel(sp[1])}}


def save(data):
    """Escribe autocross.json, un circuito por línea."""
    body = ",\n".join(f'  "{k}": ' + json.dumps(v, separators=(",", ":")) for k, v in data.items())
    OUT.write_text("{\n" + body + "\n}\n", encoding="utf-8", newline="\n")
    for k, v in data.items():
        print(k, v["length"], "m ·", len(v["anchors"]), "puntos ·", len(v["cones"]), "conos · origen", v["origin"])


def main():
    data = json.loads(OUT.read_text(encoding="utf-8"))
    data["isla_magica_pruebas"] = build("isla", ISLA, ISLA_CONES, [(68, 237), (138, 240)])
    save(data)


if __name__ == "__main__":
    main()
