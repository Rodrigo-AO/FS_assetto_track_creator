/**
 * Suciedad del Brush en el kn5: por cada casilla con arena o grava, una calca semitransparente
 * (como las manchas de los circuitos de Kunos: ksPerPixel con mezcla alfa y profundidad de solo
 * lectura) y, por debajo, mallas físicas invisibles con menos agarre según la densidad.
 */
import { DIRT_SPECS, DIRT_TILE_M, DIRT_TILE_PX, dirtLevel, type DirtTile } from '../../domain/dirt/dirt';
import type { Vec2 } from '../../domain/geometry/vec2';
import type { RgbaImage } from '../binary/image';
import { MeshData, toAc, type Ground } from './meshes';

/** Altura de la calca y de su física sobre el suelo (m): por encima del asfalto, sin escalón notable. */
export const DIRT_DECAL_LIFT_M = 0.012;
export const DIRT_PHYSICS_LIFT_M = 0.01;
/** Celda de la física de la suciedad (m) y tramo máximo que se fusiona en una fila. */
const PHYSICS_CELL_PX = 4;
const MAX_RUN_CELLS = 4;
/** Opacidad máxima de la calca y ganancia de densidad a opacidad. */
const MAX_ALPHA = 0.85;
const ALPHA_GAIN = 2.2;

const PX_M = DIRT_TILE_M / DIRT_TILE_PX;
const UP = [0, 1, 0] as const;

/** Ruido determinista por píxel global (el grano no cambia de una exportación a otra). */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Rectángulo de píxeles con suciedad de la casilla (null si está vacía). */
export function tileExtent(tile: DirtTile): { x0: number; y0: number; x1: number; y1: number } | null {
  let [x0, y0, x1, y1] = [DIRT_TILE_PX, DIRT_TILE_PX, -1, -1];
  for (let j = 0; j < DIRT_TILE_PX; j++) {
    for (let i = 0; i < DIRT_TILE_PX; i++) {
      if (tile.density[j * DIRT_TILE_PX + i] <= 0) continue;
      x0 = Math.min(x0, i);
      x1 = Math.max(x1, i);
      y0 = Math.min(y0, j);
      y1 = Math.max(y1, j);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Textura de la calca: color del material con grano y opacidad según la densidad. La grava es más
 * granulada (piedras sueltas); la arena, un velo más uniforme. Fila 0 de la imagen = borde norte.
 */
export function dirtDecalImage(tile: DirtTile): RgbaImage {
  const spec = DIRT_SPECS[tile.material];
  const gravel = tile.material === 'gravel';
  const data = new Uint8Array(DIRT_TILE_PX * DIRT_TILE_PX * 4);
  for (let row = 0; row < DIRT_TILE_PX; row++) {
    const j = DIRT_TILE_PX - 1 - row;
    for (let i = 0; i < DIRT_TILE_PX; i++) {
      const d = tile.density[j * DIRT_TILE_PX + i];
      if (d <= 0) continue;
      const gx = tile.ix * DIRT_TILE_PX + i;
      const gy = tile.iy * DIRT_TILE_PX + j;
      const n = hash(gx, gy, gravel ? 7 : 3);
      const coarse = hash(gx >> 2, gy >> 2, gravel ? 11 : 5);
      // Grano: mezcla del color base con el oscuro; en la grava, piedras sueltas más marcadas.
      const t = gravel ? (n > 0.7 ? 0.85 : n * 0.35) : n * 0.45 + coarse * 0.15;
      const rgb = spec.color.map((c, k) => Math.round(c * (1 - t) + spec.grain[k] * t));
      const grain = gravel ? 0.55 + 0.45 * (n > 0.45 ? 1 : n / 0.45) : 0.8 + 0.2 * coarse;
      const a = Math.min(MAX_ALPHA, d * ALPHA_GAIN) * grain;
      data.set([rgb[0], rgb[1], rgb[2], Math.round(a * 255)], (row * DIRT_TILE_PX + i) * 4);
    }
  }
  return { width: DIRT_TILE_PX, height: DIRT_TILE_PX, data };
}

/** Malla de la calca sobre el rectángulo con suciedad de la casilla, apoyada en el suelo. */
export function appendDirtDecal(mesh: MeshData, tile: DirtTile, ground: Ground): boolean {
  const ext = tileExtent(tile);
  if (!ext) return false;
  const ox = tile.ix * DIRT_TILE_M;
  const oy = tile.iy * DIRT_TILE_M;
  // Rejilla de 1 m (como los demás elementos apoyados en el relieve), con UV de la casilla entera.
  const step = Math.max(1, Math.round(1 / PX_M));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = ext.x0; i <= ext.x1 + 1; i += step) xs.push(i);
  if (xs[xs.length - 1] !== ext.x1 + 1) xs.push(ext.x1 + 1);
  for (let j = ext.y0; j <= ext.y1 + 1; j += step) ys.push(j);
  if (ys[ys.length - 1] !== ext.y1 + 1) ys.push(ext.y1 + 1);
  const index: number[][] = ys.map((j) =>
    xs.map((i) => {
      const p: Vec2 = { x: ox + i * PX_M, y: oy + j * PX_M };
      return mesh.vertex(toAc(p, ground(p) + DIRT_DECAL_LIFT_M), UP, [i / DIRT_TILE_PX, 1 - j / DIRT_TILE_PX]);
    }),
  );
  for (let r = 0; r + 1 < ys.length; r++) {
    for (let c = 0; c + 1 < xs.length; c++) mesh.quad(index[r][c], index[r][c + 1], index[r + 1][c + 1], index[r + 1][c], UP);
  }
  return true;
}

/**
 * Física de la casilla: celdas de 0,5 m con el nivel de su densidad media, fusionadas por filas
 * (hasta 2 m) en la malla de su nivel. `meshes[n]` recibe las celdas de nivel n + 1.
 */
export function appendDirtPhysics(meshes: readonly [MeshData, MeshData, MeshData], tile: DirtTile, ground: Ground): void {
  const cells = DIRT_TILE_PX / PHYSICS_CELL_PX;
  const cellM = PHYSICS_CELL_PX * PX_M;
  const ox = tile.ix * DIRT_TILE_M;
  const oy = tile.iy * DIRT_TILE_M;
  const level = (ci: number, cj: number): number => {
    let sum = 0;
    for (let j = cj * PHYSICS_CELL_PX; j < (cj + 1) * PHYSICS_CELL_PX; j++) {
      for (let i = ci * PHYSICS_CELL_PX; i < (ci + 1) * PHYSICS_CELL_PX; i++) sum += tile.density[j * DIRT_TILE_PX + i];
    }
    return dirtLevel(sum / (PHYSICS_CELL_PX * PHYSICS_CELL_PX));
  };
  const at = (x: number, y: number): readonly [number, number, number] => {
    const p = { x, y };
    return toAc(p, ground(p) + DIRT_PHYSICS_LIFT_M);
  };
  for (let cj = 0; cj < cells; cj++) {
    let ci = 0;
    while (ci < cells) {
      const lv = level(ci, cj);
      if (lv === 0) {
        ci++;
        continue;
      }
      let end = ci + 1;
      while (end < cells && end - ci < MAX_RUN_CELLS && level(end, cj) === lv) end++;
      const mesh = meshes[lv - 1];
      const [x0, x1] = [ox + ci * cellM, ox + end * cellM];
      const [y0, y1] = [oy + cj * cellM, oy + (cj + 1) * cellM];
      const v = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)].map((p) => mesh.vertex(p, UP, [0, 0]));
      mesh.quad(v[0], v[1], v[2], v[3], UP);
      ci = end;
    }
  }
}
