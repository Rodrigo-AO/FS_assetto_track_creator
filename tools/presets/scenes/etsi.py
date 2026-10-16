"""Pistas ETSI, modeladas a mano a partir de imágenes.

Descripción de Rodrigo: «una pista de suelo verde pintado, que llegado cierto punto pasa bajo un
puente y luego desemboca a otro círculo pintado de verde».

Referencias (2026-10-16):
- Ortofoto PNOA (píxeles anotados abajo) y Google Maps satélite: contorno de la pista de fútbol sala,
  puente de la C/ del Agua (banda curva concéntrica con el círculo), círculo con gradas y 4 mástiles
  (sus sombras, a ~18 m del centro).
- Street View en la C/ del Agua: valla de barrotes blancos de ~2 m, gradas que bajan al círculo,
  mástiles con red/cables sobre él, farolas azules de tres globos (Expo 92), aceras de adoquín.
- Niveles: calle a z = 0 y pistas hundidas a z = −3,6 m (gradas de 8 escalones de 0,45 m y gálibo
  de unos 3 m bajo el puente, coherente con las fotos).
"""

from __future__ import annotations

import math

import numpy as np
from shapely import Point, Polygon
from shapely import box as sbox

import reference
from geo import ROOT, LocalFrame, load_sites
from scenes.common import (MaterialDef, Scene, box, cylinder, draw_lines, left, load_rgb, normalized_detail, segment, unit,
                           v2, value_noise, wall_along)

SITE = "etsi"
CC0 = ROOT / "presets" / "common" / "cc0"
COMMON = ROOT / "presets" / "common" / "textures"

# Medidas en píxeles de la ortofoto PNOA (tools/presets/build/etsi/ortho.jpg, 4096², 5,8 cm/px)
PX_COURT = [(1596, 1530), (1900, 1596), (2410, 2216), (2204, 2404)]  # pista verde: NO-oeste, NO-este, SE-este, SE-oeste
PX_CIRCLE_CENTER = (2837, 2837)
PX_CIRCLE_EDGE_E = (3310, 2837)                                        # borde superior de las gradas
PX_MASTS = [(2810, 2523), (3143, 2863), (2877, 3137), (2517, 2790)]  # base de las sombras de los mástiles

Z_COURT = -3.6
Z_DECK_UNDER = -0.65
N_TIERS = 8
R_FLOOR = 17.5          # suelo verde del círculo
R_FENCE_EXTRA = 1.9     # pasillo entre lo alto de las gradas y la valla
R_DECK = 44.0           # borde del puente del lado de la pista de fútbol sala
WALKWAY_W = 3.0         # paseo de adoquín junto a la pista (lado este)
BANK_W, BANK_E, RAMP_L = 17.0, 16.0, 20.0
FENCE_H = 2.0


def line_circle(p, d, c, r, prefer_positive=True):
    """Parámetro t de la intersección de p + t·d (d unitario) con la circunferencia (c, r)."""
    f = p - c
    b = 2 * np.dot(f, d)
    disc = b * b - 4 * (np.dot(f, f) - r * r)
    if disc < 0:
        return None
    ts = sorted([(-b - math.sqrt(disc)) / 2, (-b + math.sqrt(disc)) / 2])
    return ts[0] if not prefer_positive else min((t for t in ts if t > -1e-6), default=ts[-1])


def arc(c, r, a0, a1, step_deg=3.0):
    n = max(2, int(abs(a1 - a0) / math.radians(step_deg)) + 1)
    return [c + r * np.array([math.cos(a), math.sin(a)]) for a in np.linspace(a0, a1, n)]


def short_arc(c, r, a0, a1, step_deg=3.0):
    """Arco por el camino corto entre dos ángulos (sin dar la vuelta por ±180°)."""
    d = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    return arc(c, r, a0, a0 + d, step_deg)


def ang(c, p):
    return math.atan2(p[1] - c[1], p[0] - c[0])


def quad_up(m, a, b, c, d, uvf):
    """Cuadrilátero no vertical orientado hacia arriba."""
    n = np.cross(b - a, d - a)
    pts = [a, b, c, d] if n[2] >= 0 else [d, c, b, a]
    m.quad(*pts, *(uvf(p) for p in pts))


# --------------------------------------------------------------------------- texturas

def court_texture(green, x0, y0, size, axis, court, circle_c, px=4096):
    """Pintura verde de las pistas con las líneas de fútbol sala (franja) y baloncesto (círculo)."""
    rgb = np.ones((px, px, 3), np.float32) * np.array([152, 206, 176], np.float32)  # verde agua pálido (× detalle ≈ 0,75)
    rgb *= (0.9 + 0.1 * value_noise(px, px, 14, 5) + 0.06 * (value_noise(px, px, 70, 6) - 0.5))[..., None]
    alpha = np.zeros((px, px), np.float32)
    to_px = lambda p: np.array([(p[0] - x0) / size * px, (1 - (p[1] - y0) / size) * px])
    ppm = px / size
    n = left(axis)
    lines = []

    def rect(center, half_l, half_w):
        cs = [center + axis * su * half_l + n * sv * half_w for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        return [(cs[i], cs[(i + 1) % 4]) for i in range(4)]

    def circle_lines(center, r, a0=0, a1=2 * math.pi, rot=0.0):
        pts = [center + r * (math.cos(t + rot) * axis + math.sin(t + rot) * n) for t in np.linspace(a0, a1, 48)]
        return list(zip(pts[:-1], pts[1:]))

    # Fútbol sala en la franja: 38 × 14 m centrado en la parte ancha de la pista
    nw_mid, se_mid = (court[0] + court[1]) / 2, (court[2] + court[3]) / 2
    fc = se_mid + (nw_mid - se_mid) * 0.42
    lines += rect(fc, 19, 7)
    lines += [(fc - n * 7, fc + n * 7)]
    lines += circle_lines(fc, 3.0)
    for s in (1, -1):  # áreas: semicírculos de 6 m en cada portería
        lines += circle_lines(fc + axis * 19 * s, 6.0, math.pi / 2, 3 * math.pi / 2, rot=0 if s > 0 else math.pi)
    # Baloncesto en el círculo: 28 × 15 m
    lines += rect(circle_c, 14, 7.5)
    lines += [(circle_c - n * 7.5, circle_c + n * 7.5)]
    lines += circle_lines(circle_c, 1.8)
    for s in (1, -1):
        lines += circle_lines(circle_c + axis * 14 * s, 6.75, math.pi / 2, 3 * math.pi / 2, rot=0 if s > 0 else math.pi)
        lines += rect(circle_c + axis * s * (14 - 2.9), 2.9, 2.45)
    draw_lines(alpha, rgb, lines, to_px, 0.08, ppm, color=(238, 240, 236))
    alpha *= 0.75 + 0.25 * value_noise(px, px, 120, 7)  # líneas gastadas
    return np.dstack([rgb, alpha])


def tinted(path, size, mult, tile_bright=1.0):
    return np.clip(load_rgb(path, size) * np.array(mult, np.float32) * tile_bright, 0, 255)


# --------------------------------------------------------------------------- escena

def build() -> None:
    site = load_sites()[SITE]
    meta_ref = reference.fetch(SITE)
    to_local = lambda p: v2(*reference.ortho_px_to_local(meta_ref, *p))
    sc = Scene(SITE)

    court = [to_local(p) for p in PX_COURT]          # I0 = NO-oeste, I1 = NO-este, SE-este, SE-oeste
    C = to_local(PX_CIRCLE_CENTER)
    R_TOP = float(np.linalg.norm(to_local(PX_CIRCLE_EDGE_E) - C))
    R_FENCE = R_TOP + R_FENCE_EXTRA
    masts = [to_local(p) for p in PX_MASTS]
    nw_mid, se_mid = (court[0] + court[1]) / 2, (court[2] + court[3]) / 2
    a = unit(se_mid - nw_mid)                        # eje de la franja (NO → SE)
    n = left(a)                                      # hacia el este
    off_w = float(np.dot(court[3] - se_mid, n))
    off_e = float(np.dot(court[2] - se_mid, n)) + WALKWAY_W

    # Contornos interior (fondo, z = Z_COURT) y exterior (coronación de taludes, z = 0)
    I = [court[0], court[1] + n * WALKWAY_W, court[2] + n * WALKWAY_W, court[3]]
    O0 = I[0] - n * BANK_W - a * RAMP_L
    O1 = I[1] + n * BANK_E - a * RAMP_L
    pw = I[3] - n * BANK_W
    O3 = pw + a * line_circle(pw, a, C, R_DECK, prefer_positive=False) if line_circle(pw, a, C, R_DECK, False) is not None else pw
    pe = I[2] + n * BANK_E
    O2 = pe + a * line_circle(pe, a, C, R_DECK, prefer_positive=False)
    # Los extremos SE del fondo, sobre el arco del puente
    I[3] = se_mid + n * off_w + a * line_circle(se_mid + n * off_w, a, C, R_DECK, False)
    I[2] = se_mid + n * off_e + a * line_circle(se_mid + n * off_e, a, C, R_DECK, False)

    def strip(t0, t1):
        return Polygon([se_mid + n * off_w + a * t0, se_mid + n * off_e + a * t0, se_mid + n * off_e + a * t1, se_mid + n * off_w + a * t1])

    tunnel_band = strip(-5, float(np.dot(C - se_mid, a)))  # solo hasta el centro: no corta las gradas del otro lado
    disk = lambda r: Point(*C).buffer(r, 128)
    deck_arc = short_arc(C, R_DECK, ang(C, O3), ang(C, O2))
    trench_top = Polygon([O0, O1, O2, *deck_arc[::-1], O3]).buffer(0)

    # Extensión del modelo y textura de la pintura
    poly_local = [v2(*map(float, LocalFrame(site.polygon).latlng_to_local(*p))) for p in site.polygon]
    xs = [p[0] for p in poly_local] + [O0[0], O1[0]]
    ys = [p[1] for p in poly_local] + [O0[1], O1[1]]
    gx0, gx1, gy0, gy1 = min(xs) - 45, max(xs) + 45, min(ys) - 45, max(ys) + 45
    floor_union = Polygon(court).union(tunnel_band.intersection(disk(R_DECK + 0.5))).union(disk(R_FLOOR))
    walkway = Polygon([court[1], court[1] + n * WALKWAY_W, court[2] + n * WALKWAY_W, court[2]]).difference(disk(R_DECK + 0.5))
    green = floor_union.difference(walkway)
    fx0, fy0, fx1, fy1 = green.bounds
    fsize = max(fx1 - fx0, fy1 - fy0) + 2
    fx0, fy0 = (fx0 + fx1 - fsize) / 2, (fy0 + fy1 - fsize) / 2

    sc.textures["etsi_court_base.png"] = court_texture(green, fx0, fy0, fsize, a, court, C)
    sc.textures["court_detail.png"] = normalized_detail(CC0 / "concrete_floor_worn_001_diff.jpg", 1024, 0.75)
    sc.textures["pavers.png"] = tinted(CC0 / "brick_pavement_02_diff.jpg", 1024, (1.32, 1.02, 0.96))
    sc.textures["grass.png"] = tinted(CC0 / "leafy_grass_diff.jpg", 1024, (0.85, 1.05, 0.8))
    sc.textures["concrete.png"] = tinted(CC0 / "concrete_floor_worn_001_diff.jpg", 1024, (1.05, 1.03, 1.0))
    sc.textures["road.png"] = tinted(CC0 / "asphalt_02_diff.jpg", 1024, (0.62, 0.62, 0.63))
    for name in ("fence.png", "net.png", "metal_white.png", "lamp_blue.png", "glass_globe.png", "bark.png", "leaves.png", "leaves_dark.png"):
        sc.textures[name] = COMMON / name
    sc.textures["horizon.png"] = np.ones((8, 8, 3)) * np.array([118, 116, 104])

    sc.materials = {
        "ATC_COURT": MaterialDef("etsi_court_base.png", detail="court_detail.png", detail_mult=fsize / 3.0, roughness=0.7),
        "ATC_PAVERS": MaterialDef("pavers.png"),
        "ATC_GRASS": MaterialDef("grass.png", roughness=0.95),
        "ATC_CONCRETE": MaterialDef("concrete.png"),
        "ATC_ROAD": MaterialDef("road.png", roughness=0.9),
        "ATC_FENCE": MaterialDef("fence.png", alpha=True, roughness=0.4, metallic=0.3),
        "ATC_NET": MaterialDef("net.png", alpha=True),
        "ATC_METAL_WHITE": MaterialDef("metal_white.png", roughness=0.4, metallic=0.5),
        "ATC_LAMP_BLUE": MaterialDef("lamp_blue.png", roughness=0.4, metallic=0.4),
        "ATC_GLOBE": MaterialDef("glass_globe.png", roughness=0.2),
        "ATC_BARK": MaterialDef("bark.png"),
        "ATC_LEAVES": MaterialDef("leaves.png", alpha=True, roughness=0.7),
        "ATC_LEAVES_DARK": MaterialDef("leaves_dark.png", alpha=True, roughness=0.7),
        "ATC_HORIZON": MaterialDef("horizon.png"),
    }
    court_uv = lambda x, y: ((x - fx0) / fsize, (y - fy0) / fsize)
    tile = lambda s: (lambda p: (p[0] / s, p[1] / s))
    tile_xy = lambda s: (lambda x, y: (x / s, y / s))

    # Fondo de las pistas (franja + túnel + círculo) y paseo
    sc.mesh("1ROAD_COURT", "ATC_COURT").flat_polygon(green, Z_COURT, court_uv)
    sc.mesh("1ROAD_WALKWAY", "ATC_PAVERS").flat_polygon(walkway, Z_COURT, tile_xy(4))

    # Taludes de césped y rampa de adoquín hasta la plaza
    P3 = lambda p, z: np.array([p[0], p[1], z])
    banks = sc.mesh("1GRASS_BANKS", "ATC_GRASS")
    quad_up(banks, P3(I[0], Z_COURT), P3(I[3], Z_COURT), P3(O3, 0), P3(O0, 0), tile(5))
    quad_up(banks, P3(I[1], Z_COURT), P3(O1, 0), P3(O2, 0), P3(I[2], Z_COURT), tile(5))
    quad_up(sc.mesh("1ROAD_RAMP", "ATC_PAVERS"), P3(I[0], Z_COURT), P3(O0, 0), P3(O1, 0), P3(I[1], Z_COURT), tile(4))

    # Gradas del círculo (cortadas por el túnel)
    rise = -Z_COURT / N_TIERS
    depth = (R_TOP - R_FLOOR) / N_TIERS
    stands = sc.mesh("1ROAD_STANDS", "ATC_CONCRETE")
    for k in range(N_TIERS):
        r0, r1 = R_FLOOR + k * depth, R_FLOOR + (k + 1) * depth
        z = Z_COURT + (k + 1) * rise
        stands.flat_polygon(disk(r1).difference(disk(r0)).difference(tunnel_band), z, tile_xy(3))
        ring = Polygon(arc(C, r0, 0, 2 * math.pi, 2.0)).exterior.coords
        pts = [np.array(p) for p in ring]
        run = []
        for p in pts:  # contrahuellas, interrumpidas en el corte del túnel
            if tunnel_band.contains(Point(*p)):
                if len(run) > 1:
                    wall_along(stands, run, z - rise, z, 3, 3)
                run = []
            else:
                run.append(p)
        if len(run) > 1:
            wall_along(stands, run, z - rise, z, 3, 3)

    # Túnel bajo el puente: paredes, techo y muros de la boca
    tunnel = sc.mesh("1WALL_TUNNEL", "ATC_CONCRETE")
    for off in (off_w, off_e):
        p = se_mid + n * off
        t_deck = line_circle(p, a, C, R_DECK, False)
        t_top = line_circle(p, a, C, R_TOP)
        wall_along(tunnel, [p + a * t_deck, p + a * t_top], Z_COURT, Z_DECK_UNDER, 3, 3)
        for k in range(N_TIERS):  # paredes del corte entre gradas
            r0, r1 = R_FLOOR + k * depth, R_FLOOR + (k + 1) * depth
            t0, t1 = line_circle(p, a, C, r1), line_circle(p, a, C, r0)
            if t0 is not None and t1 is not None:
                wall_along(tunnel, [p + a * t0, p + a * t1], Z_COURT, Z_COURT + (k + 1) * rise, 3, 3)
    ceiling = tunnel_band.intersection(disk(R_DECK)).difference(disk(R_TOP))
    sc.mesh("TUNNEL_CEILING", "ATC_CONCRETE").flat_polygon(ceiling, Z_DECK_UNDER, tile_xy(3), up=False)
    # Dinteles sobre las dos bocas y muro curvo del puente sobre los taludes
    wall_along(tunnel, short_arc(C, R_DECK, ang(C, I[3]), ang(C, I[2]), 2), Z_DECK_UNDER, 0.0, 3, 3)
    t_tw = line_circle(se_mid + n * off_w, a, C, R_TOP)
    t_te = line_circle(se_mid + n * off_e, a, C, R_TOP)
    wall_along(tunnel, short_arc(C, R_TOP, ang(C, se_mid + n * off_w + a * t_tw), ang(C, se_mid + n * off_e + a * t_te), 2),
               Z_DECK_UNDER, 0.0, 3, 3)
    for (pa, pin) in ((O3, I[3]), (O2, I[2])):  # sobre los taludes: del suelo inclinado a la calle
        pts = short_arc(C, R_DECK, ang(C, pa), ang(C, pin), 2)
        span = float(np.linalg.norm(pin - pa)) or 1.0
        zb = lambda x, y, pa=pa, span=span: Z_COURT * min(1.0, float(np.linalg.norm(np.array([x, y]) - pa)) / span)
        wall_along(tunnel, pts, zb, 0.0, 3, 3)

    # Calle (z = 0): plaza y aceras, calzada de la C/ del Agua (incluye el puente) y pasillo del círculo
    ground = sbox(gx0, gy0, gx1, gy1).difference(trench_top).difference(disk(R_TOP))
    road_ring = disk(R_DECK).difference(disk(R_FENCE + 1.0)).intersection(ground)
    walk_ring = disk(R_FENCE + 1.0).intersection(ground)
    plaza = ground.difference(disk(R_DECK))
    sc.mesh("1ROAD_STREET_ROAD", "ATC_ROAD", heightfield=False).flat_polygon(road_ring, 0.0, tile_xy(6))
    sc.mesh("1ROAD_STREET_WALK", "ATC_CONCRETE", heightfield=False).flat_polygon(walk_ring, 0.0, tile_xy(3))
    sc.mesh("1ROAD_STREET_PLAZA", "ATC_PAVERS", heightfield=False).flat_polygon(plaza, 0.0, tile_xy(4))
    S = 1500
    sc.mesh("HORIZON", "ATC_HORIZON", heightfield=False).flat_polygon(
        sbox(-S, -S, S, S).difference(sbox(gx0 + 1, gy0 + 1, gx1 - 1, gy1 - 1)), -0.05, tile_xy(50))

    # Vallas de barrotes: círculo, coronación de los taludes y borde del puente sobre la franja
    fence = sc.mesh("1WALL_FENCE", "ATC_FENCE")
    wall_along(fence, arc(C, R_FENCE, 0, 2 * math.pi, 2.0), 0.0, FENCE_H, 2, 2)
    wall_along(fence, [O0, O3], 0.0, FENCE_H, 2, 2)
    wall_along(fence, [O1, O2], 0.0, FENCE_H, 2, 2)
    wall_along(fence, deck_arc, 0.0, 1.1, 2, 2)

    # Mástiles con la red sobre el círculo
    mast_m, net = sc.mesh("1WALL_MASTS", "ATC_METAL_WHITE"), sc.mesh("NET", "ATC_NET")
    tops = []
    for p in masts:
        h = 14.0
        zb = Z_COURT + max(0, math.ceil((np.linalg.norm(p - C) - R_FLOOR) / depth)) * rise
        cylinder(mast_m, p, 0.16, 0.1, zb - 0.2, h, sides=10)
        tops.append(np.array([p[0], p[1], h - 0.5]))
    order = sorted(range(4), key=lambda i: ang(C, masts[i]))
    ring_tops = [tops[i] for i in order]
    center = np.array([C[0], C[1], 9.5])  # la red cuelga hacia el centro
    for i in range(4):
        t0, t1 = ring_tops[i], ring_tops[(i + 1) % 4]
        segment(mast_m, t0, t1, 0.02, 4)  # cable perimetral
        for j in range(6):  # gajo de red en abanico hacia el centro
            s0, s1 = j / 6, (j + 1) / 6
            e0, e1 = t0 + (t1 - t0) * s0, t0 + (t1 - t0) * s1
            sag = lambda p, w: p + (center - p) * w
            for w0, w1 in ((0, 0.5), (0.5, 1.0)):
                A, B, Cc, D = sag(e0, w0), sag(e1, w0), sag(e1, w1), sag(e0, w1)
                net.quad_double(A, B, Cc, D, *((q[0] / 1.0, q[1] / 1.0) for q in (A, B, Cc, D)))

    # Farolas Expo 92 (fuste azul y tres globos)
    lamps, globes = sc.mesh("1WALL_LAMPS", "ATC_LAMP_BLUE"), sc.mesh("LAMP_GLOBES", "ATC_GLOBE")
    lamp_pts = [C + (R_FENCE + 1.2) * np.array([math.cos(t), math.sin(t)]) for t in np.radians(np.arange(22.5, 360, 45))]
    for s in np.linspace(0.15, 0.85, 3):
        lamp_pts += [O0 + (O3 - O0) * s - n * 1.2, O1 + (O2 - O1) * s + n * 1.2]
    for p in lamp_pts:
        cylinder(lamps, p, 0.08, 0.06, -0.1, 4.2, 8)
        for k in range(3):
            t = 2 * math.pi * k / 3 + 0.4
            g = p + 0.55 * np.array([math.cos(t), math.sin(t)])
            segment(lamps, np.array([*p, 4.0]), np.array([*g, 4.35]), 0.03, 4)
            box(globes, g, 0.42, 0.42, 4.35, 4.77, t)

    # Algunos árboles en los taludes (Google: hilera en el talud este y alguno al oeste)
    trunks, crowns = sc.mesh("1WALL_TREE_TRUNKS", "ATC_BARK"), sc.mesh("TREE_CROWNS", "ATC_LEAVES")
    rng = np.random.default_rng(4)
    tree_pts = [(I[1] + (I[2] - I[1]) * s, O1 + (O2 - O1) * s, 0.7) for s in (0.15, 0.35, 0.55, 0.8)]
    tree_pts += [(I[0] + (I[3] - I[0]) * s, O0 + (O3 - O0) * s, 0.75) for s in (0.3, 0.7)]
    for pin, pout, w in tree_pts:
        p = pin + (pout - pin) * w
        z = Z_COURT * (1 - w)
        h, r = rng.uniform(7, 10), rng.uniform(2.6, 3.6)
        cylinder(trunks, p, 0.18, 0.1, z - 0.3, z + h * 0.55, 8)
        rot = rng.uniform(0, math.pi)
        for k in range(4):
            t = rot + k * math.pi / 4
            d = np.array([math.cos(t), math.sin(t)]) * r
            crowns.quad_double(np.array([*(p - d), z + h * 0.3]), np.array([*(p + d), z + h * 0.3]),
                               np.array([*(p + d), z + h]), np.array([*(p - d), z + h]), (0, 0), (1, 0), (1, 1), (0, 1))

    eye = nw_mid + a * 8
    sc.meta = {"preview_target": [float(C[0] - 20), float(C[1] + 25)], "preview_extent": 150.0,
               "preview_eye": [float(eye[0]), float(eye[1]), Z_COURT + 1.1],
               "preview_look": [float(se_mid[0]), float(se_mid[1]), Z_COURT + 1.0],
               "levels": {"court": Z_COURT, "deck_under": Z_DECK_UNDER}, "circle": [float(C[0]), float(C[1]), R_TOP]}
    sc.save()


if __name__ == "__main__":
    build()
