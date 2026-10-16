import type { ConeSpec } from '../../domain/cones/coneSpecs';
import type { SurfaceType } from '../../domain/project/types';
import type { RgbaImage } from '../binary/image';

/** Metros que cubre una repetición de la textura de cada superficie. */
export const SURFACE_TILE_METERS: Readonly<Record<SurfaceType, number>> = { asphalt: 4, grass: 6, gravel: 3 };

const TEXTURE_SIZE = 512;

/** Generador pseudoaleatorio determinista (mulberry32): mismas texturas en cada exportación. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ruido de valor periódico (la textura se repite sin costuras). */
function tileableNoise(size: number, cells: number, random: () => number): Float32Array {
  const grid = Array.from({ length: cells * cells }, random);
  const at = (x: number, y: number): number => grid[((y + cells) % cells) * cells + ((x + cells) % cells)];
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = (gx - x0) ** 2 * (3 - 2 * (gx - x0));
      const ty = (gy - y0) ** 2 * (3 - 2 * (gy - y0));
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

interface SurfaceLook {
  readonly base: readonly [number, number, number];
  /** Amplitud del ruido grueso y del grano fino (0–255). */
  readonly blotch: number;
  readonly grain: number;
  readonly seed: number;
}

const LOOKS: Readonly<Record<SurfaceType, SurfaceLook>> = {
  asphalt: { base: [62, 62, 64], blotch: 14, grain: 22, seed: 11 },
  grass: { base: [70, 104, 46], blotch: 26, grain: 18, seed: 23 },
  gravel: { base: [158, 142, 116], blotch: 18, grain: 46, seed: 37 },
};

export function surfaceTexture(type: SurfaceType): RgbaImage {
  const look = LOOKS[type];
  const random = rng(look.seed);
  const coarse = tileableNoise(TEXTURE_SIZE, 8, random);
  const medium = tileableNoise(TEXTURE_SIZE, 32, random);
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let i = 0; i < TEXTURE_SIZE * TEXTURE_SIZE; i++) {
    const shade = (coarse[i] - 0.5) * 2 * look.blotch + (medium[i] - 0.5) * look.blotch + (random() - 0.5) * look.grain;
    // El césped varía más en el verde; el resto, en luminancia.
    const tint = type === 'grass' ? [0.6, 1, 0.5] : [1, 1, 1];
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(look.base[c] + shade * tint[c])));
    data[i * 4 + 3] = 255;
  }
  return { width: TEXTURE_SIZE, height: TEXTURE_SIZE, data };
}

/**
 * Textura vertical del cono con sus franjas. La fila superior es la punta: la malla usa
 * v = 1 − altura relativa (en DirectX v = 0 es la fila superior de la imagen).
 */
export function coneTexture(spec: ConeSpec): RgbaImage {
  const height = 64;
  const width = 4;
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const heightFraction = 1 - (row + 0.5) / height;
    const inStripe = spec.stripes.some(([from, to]) => heightFraction >= from && heightFraction <= to);
    const rgb = inStripe ? spec.stripe : spec.body;
    for (let x = 0; x < width; x++) data.set([...rgb, 255], (row * width + x) * 4);
  }
  return { width, height, data };
}

export function solidTexture(rgb: readonly [number, number, number]): RgbaImage {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([...rgb, 255], i * 4);
  return { width: 4, height: 4, data };
}
