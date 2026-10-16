"""Escritura de kn5 (v5) y DDS con numpy, para usar desde el Python de Blender.

Mismo formato que src/export/ac/kn5.ts (y que acgen/kn5.py del ART-26D, validado en AC).
DDS: BC1/DXT1 con mipmaps para texturas opacas grandes (ortofoto) y A8R8G8B8 para las de alfa.
"""

from __future__ import annotations

import io
import struct
from dataclasses import dataclass, field

import numpy as np

KN5_MAX_VERTICES = 65535
HIDDEN_SPHERE_MARGIN_M = 1.0


@dataclass
class Texture:
    name: str
    data: bytes


@dataclass
class Material:
    name: str
    shader: str
    properties: list[tuple[str, float]]
    textures: list[tuple[str, int, str]]
    alpha_tested: bool = False


@dataclass
class Mesh:
    positions: np.ndarray  # (n,3) float32, coordenadas de AC
    normals: np.ndarray
    uvs: np.ndarray        # (n,2)
    indices: np.ndarray    # (m,) uint16
    material: int
    cast_shadows: bool = True
    renderable: bool = True


@dataclass
class Node:
    name: str
    mesh: Mesh | None = None
    children: list["Node"] = field(default_factory=list)


def _str(buf: io.BytesIO, s: str) -> None:
    b = s.encode("utf-8")
    buf.write(struct.pack("<i", len(b)))
    buf.write(b)


def _write_node(buf: io.BytesIO, n: Node) -> None:
    buf.write(struct.pack("<i", 2 if n.mesh is not None else 1))
    _str(buf, n.name)
    buf.write(struct.pack("<iB", len(n.children), 1))
    if n.mesh is None:
        buf.write(np.eye(4, dtype="<f4").tobytes())
    else:
        m = n.mesh
        count = len(m.positions)
        if count > KN5_MAX_VERTICES:
            raise ValueError(f"{n.name}: {count} vértices (máx. {KN5_MAX_VERTICES})")
        buf.write(struct.pack("<BBB", int(m.cast_shadows), 1, 0))
        tangents = np.tile(np.array([1, 0, 0], np.float32), (count, 1))
        verts = np.hstack([m.positions, m.normals, m.uvs, tangents]).astype("<f4")
        buf.write(struct.pack("<i", count))
        buf.write(verts.tobytes())
        idx = np.asarray(m.indices, dtype="<u2")
        buf.write(struct.pack("<i", len(idx)))
        buf.write(idx.tobytes())
        center = (m.positions.max(0) + m.positions.min(0)) / 2
        radius = float(np.linalg.norm(m.positions - center, axis=1).max())
        if not m.renderable:
            # AC deja de dibujar una malla visible si una invisible tiene casi su misma esfera
            # (igual que HIDDEN_SPHERE_MARGIN_M en src/export/ac/kn5.ts).
            radius += HIDDEN_SPHERE_MARGIN_M
        buf.write(struct.pack("<iiff", m.material, 0, 0.0, 0.0))
        buf.write(struct.pack("<3ff", *center.astype(float), radius))
        buf.write(struct.pack("<B", int(m.renderable)))
    for c in n.children:
        _write_node(buf, c)


def write_kn5(textures: list[Texture], materials: list[Material], root: Node) -> bytes:
    buf = io.BytesIO()
    buf.write(b"sc6969")
    buf.write(struct.pack("<i", 5))
    buf.write(struct.pack("<i", len(textures)))
    for t in textures:
        buf.write(struct.pack("<i", 1))
        _str(buf, t.name)
        buf.write(struct.pack("<i", len(t.data)))
        buf.write(t.data)
    buf.write(struct.pack("<i", len(materials)))
    for m in materials:
        _str(buf, m.name)
        _str(buf, m.shader)
        buf.write(struct.pack("<BBi", 0, int(m.alpha_tested), 0))
        buf.write(struct.pack("<i", len(m.properties)))
        for name, value in m.properties:
            _str(buf, name)
            buf.write(struct.pack("<f2f3f4f", value, 0, 0, 0, 0, 0, 0, 0, 0, 0))
        buf.write(struct.pack("<i", len(m.textures)))
        for sampler, slot, tex in m.textures:
            _str(buf, sampler)
            buf.write(struct.pack("<i", slot))
            _str(buf, tex)
    _write_node(buf, root)
    return buf.getvalue()


# --------------------------------------------------------------------------- DDS

def _mips(img: np.ndarray, min_size: int = 1) -> list[np.ndarray]:
    levels = [img]
    while min(levels[-1].shape[:2]) > min_size:
        a = levels[-1].astype(np.float32)
        h, w = a.shape[:2]
        a = a[: h - h % 2, : w - w % 2]
        a = (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4
        levels.append(np.clip(a + 0.5, 0, 255).astype(np.uint8))
    return levels


def _header(w: int, h: int, mips: int, fourcc: bytes | None, linear_size: int) -> bytes:
    if fourcc:
        flags = 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000  # …|MIPMAPCOUNT|LINEARSIZE
        pf = struct.pack("<2I4s5I", 32, 0x4, fourcc, 0, 0, 0, 0, 0)
    else:
        flags = 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x8
        pf = struct.pack("<2I4s5I", 32, 0x41, b"\0\0\0\0", 32, 0x00FF0000, 0x0000FF00, 0x000000FF, 0xFF000000)
    head = struct.pack("<4s7I44x", b"DDS ", 124, flags, h, w, linear_size, 0, mips)
    caps = struct.pack("<5I", 0x1000 | 0x400000 | 0x8, 0, 0, 0, 0)
    return head + pf + caps


def dds_rgba(rgba: np.ndarray) -> bytes:
    """A8R8G8B8 sin comprimir con mipmaps (texturas con alfa)."""
    levels = _mips(rgba)
    body = b"".join(l[..., [2, 1, 0, 3]].tobytes() for l in levels)
    return _header(rgba.shape[1], rgba.shape[0], len(levels), None, rgba.shape[1] * 4) + body


def _to565(c: np.ndarray) -> np.ndarray:
    c = c.astype(np.uint32)
    return ((c[..., 0] >> 3) << 11) | ((c[..., 1] >> 2) << 5) | (c[..., 2] >> 3)


def _from565(v: np.ndarray) -> np.ndarray:
    r = ((v >> 11) & 31) * 255 // 31
    g = ((v >> 5) & 63) * 255 // 63
    b = (v & 31) * 255 // 31
    return np.stack([r, g, b], -1).astype(np.float32)


def _bc1(rgb: np.ndarray) -> bytes:
    h, w = rgb.shape[:2]
    ph, pw = (h + 3) // 4 * 4, (w + 3) // 4 * 4
    img = np.pad(rgb, ((0, ph - h), (0, pw - w), (0, 0)), mode="edge")
    blocks = img.reshape(ph // 4, 4, pw // 4, 4, 3).transpose(0, 2, 1, 3, 4).reshape(-1, 16, 3)
    step = 65536  # por lotes: la matriz de distancias a la paleta es grande
    return b"".join(_bc1_blocks(blocks[i:i + step].astype(np.float32)) for i in range(0, len(blocks), step))


def _bc1_blocks(blocks: np.ndarray) -> bytes:
    # Extremos: proyección sobre el eje de máxima varianza de cada bloque (aprox. por la diagonal de su caja).
    mean = blocks.mean(1, keepdims=True)
    axis = blocks.max(1) - blocks.min(1)
    axis /= np.linalg.norm(axis, axis=1, keepdims=True) + 1e-6
    proj = np.einsum("bpc,bc->bp", blocks - mean, axis)
    c0 = mean[:, 0] + axis * proj.max(1, keepdims=True)
    c1 = mean[:, 0] + axis * proj.min(1, keepdims=True)
    e0, e1 = _to565(np.clip(c0, 0, 255)), _to565(np.clip(c1, 0, 255))
    swap = e0 < e1
    e0, e1 = np.where(swap, e1, e0), np.where(swap, e0, e1)
    p0, p1 = _from565(e0), _from565(e1)
    palette = np.stack([p0, p1, (2 * p0 + p1) / 3, (p0 + 2 * p1) / 3], 1)  # (b,4,3)
    dist = ((blocks[:, :, None, :] - palette[:, None, :, :]) ** 2).sum(-1)
    idx = dist.argmin(-1).astype(np.uint32)
    idx[e0 == e1] = 0
    bits = np.zeros(len(blocks), np.uint32)
    for p in range(16):
        bits |= idx[:, p] << (2 * p)
    out = np.zeros((len(blocks), 2), np.uint32)
    out[:, 0] = e0 | (e1 << 16)
    out[:, 1] = bits
    return out.astype("<u4").tobytes()


def _bc3_alpha(alpha: np.ndarray) -> np.ndarray:
    """Bloques de alfa de BC3 (8 bytes por bloque de 4×4) para un array (b, 16) de alfas."""
    a0 = alpha.max(1)
    a1 = alpha.min(1)
    # Paleta de 8 valores (modo a0 > a1): a0, a1 y seis interpolados.
    pal = np.empty((len(alpha), 8), np.float32)
    pal[:, 0], pal[:, 1] = a0, a1
    for k in range(1, 7):
        pal[:, k + 1] = ((7 - k) * a0 + k * a1) / 7
    idx = np.abs(alpha[:, :, None] - pal[:, None, :]).argmin(-1).astype(np.uint64)
    idx[a0 == a1] = 0
    bits = np.zeros(len(alpha), np.uint64)
    for p in range(16):
        bits |= idx[:, p] << np.uint64(3 * p)
    out = np.zeros((len(alpha), 8), np.uint8)
    out[:, 0] = a0.astype(np.uint8)
    out[:, 1] = a1.astype(np.uint8)
    for b in range(6):
        out[:, 2 + b] = ((bits >> np.uint64(8 * b)) & np.uint64(0xFF)).astype(np.uint8)
    return out


def _bc3(rgba: np.ndarray) -> bytes:
    h, w = rgba.shape[:2]
    ph, pw = (h + 3) // 4 * 4, (w + 3) // 4 * 4
    img = np.pad(rgba, ((0, ph - h), (0, pw - w), (0, 0)), mode="edge")
    blocks = img.reshape(ph // 4, 4, pw // 4, 4, 4).transpose(0, 2, 1, 3, 4).reshape(-1, 16, 4)
    out = []
    for i in range(0, len(blocks), 65536):
        b = blocks[i:i + 65536].astype(np.float32)
        alpha = _bc3_alpha(b[:, :, 3])
        color = np.frombuffer(_bc1_blocks(b[:, :, :3]), np.uint8).reshape(-1, 8)
        out.append(np.hstack([alpha, color]).tobytes())
    return b"".join(out)


def dds_bc3(rgba: np.ndarray) -> bytes:
    """DXT5 con mipmaps (texturas con alfa grandes: p. ej. la máscara de detalle de una base)."""
    levels = _mips(rgba)
    body = b"".join(_bc3(l) for l in levels)
    w, h = rgba.shape[1], rgba.shape[0]
    return _header(w, h, len(levels), b"DXT5", max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * 16) + body


def dds_bc1(rgb: np.ndarray) -> bytes:
    """DXT1 con mipmaps (texturas opacas)."""
    levels = _mips(rgb[..., :3])
    body = b"".join(_bc1(l) for l in levels)
    w, h = rgb.shape[1], rgb.shape[0]
    return _header(w, h, len(levels), b"DXT1", max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * 8) + body
