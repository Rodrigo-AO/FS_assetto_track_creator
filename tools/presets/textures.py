"""Texturas procedurales compartidas por los presets (lo que no sale de la ortofoto).

    tools/presets/.venv/Scripts/python tools/presets/textures.py

Se generan en presets/common/textures/ y el paso de Blender las copia junto a cada .blend.
Todas son deterministas (semilla fija).
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from geo import ROOT

OUT = ROOT / "presets" / "common" / "textures"
rng = np.random.default_rng(7)


def noise(h, w, scale, amp):
    small = rng.normal(0, 1, (max(2, h // scale), max(2, w // scale)))
    img = Image.fromarray(((small - small.min()) / np.ptp(small) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return (np.asarray(img, dtype=np.float32) / 255 - 0.5) * 2 * amp


def save(name, arr):
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(OUT / name)
    print("textura", name, arr.shape)


def facade(name="facade.png", base=(226, 216, 196)):
    """Un módulo de fachada: 4 m de ancho × 3,2 m (una planta), revoco con una ventana."""
    h, w = 512, 640  # 160 px/m
    base = np.array(base, np.float32)
    img = np.ones((h, w, 3), np.float32) * base + (noise(h, w, 8, 10) + noise(h, w, 64, 8))[..., None]
    px = lambda m: int(m * 160)
    x0, x1 = px(1.1), px(2.9)
    y0, y1 = h - px(2.45), h - px(0.95)  # ventana entre 0,95 y 2,45 m
    img[y0 - 6:y1 + 6, x0 - 6:x1 + 6] = [205, 205, 205]  # marco/alféizar claro
    glass = np.linspace(70, 40, y1 - y0)[:, None, None] * np.array([0.8, 0.9, 1.0])
    img[y0:y1, x0:x1] = glass + noise(y1 - y0, x1 - x0, 16, 6)[..., None]
    img[y0:y1, (x0 + x1) // 2 - 3:(x0 + x1) // 2 + 3] = [190, 190, 190]  # parteluz
    img[y1 + 6:y1 + 14, x0 - 14:x1 + 14] = [185, 180, 170]                 # alféizar
    img[h - px(0.12):] *= 0.85                                              # línea de forjado
    save(name, img)


def facade_panel():
    """Nave: chapa grecada vertical gris claro (4 m × 3,2 m), sin ventanas."""
    h, w = 512, 640
    x = np.arange(w)
    ribs = 14 * np.sin(x / w * 2 * np.pi * 20) ** 8  # grecas cada 20 cm
    img = np.array([196, 200, 204], np.float32) + ribs[None, :, None] - 7 + noise(h, w, 32, 5)[..., None]
    img[:24] *= 0.8  # remate superior
    save("facade_panel.png", img)


def bark():
    h, w = 512, 256
    streaks = noise(h, w // 8, 4, 25).repeat(8, axis=1)[:, :w]
    img = np.array([88, 72, 58], np.float32) + streaks[..., None] + noise(h, w, 4, 12)[..., None]
    save("bark.png", img)


def leaves(name="leaves.png", tone=(58, 92, 40)):
    """Racimos de hojas con alfa recortable (copas de cruces de planos)."""
    s = 1024
    rgba = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(rgba)
    cx = cy = s / 2
    for _ in range(14000):
        r = abs(rng.normal(0, 0.22)) * s
        a = rng.uniform(0, 2 * np.pi)
        x, y = cx + np.cos(a) * r, cy + np.sin(a) * r * 0.9
        if r > s * 0.48:
            continue
        size = rng.uniform(5, 13)
        shade = rng.uniform(0.55, 1.1)
        g = (int(tone[0] * shade), int(tone[1] * shade + rng.uniform(-8, 8)), int(tone[2] * shade))
        ang = rng.uniform(0, np.pi)
        pts = [(x + np.cos(ang) * size * k, y + np.sin(ang) * size * k * 0.45) for k in (-1, 1)]
        d.ellipse([min(p[0] for p in pts) - 2, min(p[1] for p in pts) - 2, max(p[0] for p in pts) + 2, max(p[1] for p in pts) + 2],
                  fill=g + (255,))
    arr = np.asarray(rgba.filter(ImageFilter.SMOOTH)).astype(np.float32)
    arr[..., 3] = np.where(arr[..., 3] > 128, 255, 0)
    save(name, arr)


def net():
    """Malla de protección: hilos oscuros cada 10 cm (1 tile = 1 m)."""
    s = 256
    a = np.zeros((s, s, 4), np.float32)
    a[..., :3] = 45
    for k in range(0, s, s // 10):
        a[k:k + 2, :, 3] = 200
        a[:, k:k + 2, 3] = 200
    save("net.png", a)


def fence():
    """Valla de barrotes blancos: 2 m de ancho × 2 m de alto, barrote cada 12 cm."""
    h, w = 256, 256
    a = np.zeros((h, w, 4), np.float32)
    a[..., :3] = [236, 238, 238]
    bar = int(w / (2 / 0.12))
    for x in range(0, w, bar):
        a[:, x:x + max(3, bar // 3), 3] = 255
    a[6:14, :, 3] = 255          # pasamanos superior
    a[h - 30:h - 22, :, 3] = 255  # travesaño inferior
    a[..., :3] -= np.linspace(0, 25, h)[:, None, None]
    save("fence.png", a)


def solid(name, rgb):
    save(name, np.ones((8, 8, 3), np.float32) * np.array(rgb, np.float32))


if __name__ == "__main__":
    facade()
    facade("facade_white.png", (238, 238, 234))
    facade_panel()
    bark()
    leaves()
    leaves("leaves_dark.png", (44, 74, 34))
    net()
    fence()
    solid("metal_white.png", (232, 234, 236))
    solid("metal_grey.png", (120, 124, 128))
    solid("lamp_blue.png", (38, 70, 160))
    solid("glass_globe.png", (245, 245, 238))
    solid("horizon.png", (118, 116, 100))
