/**
 * Desnivelador: pincel que sube o baja el suelo por donde se arrastra. Cada pasada aporta
 * ±RELIEF_STEP_M en el eje del trazo, difuminado hacia el borde; las pasadas se suman en orden y
 * el desnivel nunca baja de RELIEF_MIN_M (hacia arriba no hay límite).
 */
import type { Vec2 } from '../geometry/vec2';
import type { ReliefDirection } from '../project/types';
import { cellKey, FIELD_PX_M, FIELD_TILE_PX, strokeField, type FieldStroke } from '../strokes/strokeField';

export interface LocalReliefStroke extends FieldStroke {
  readonly direction: ReliefDirection;
}

/** Desnivel que deja una pasada en el eje del trazo (m). */
export const RELIEF_STEP_M = 0.1;
/** Desnivel mínimo acumulado (m): el pincel no hunde más de medio metro. */
export const RELIEF_MIN_M = -0.5;

export interface ReliefTile {
  readonly ix: number;
  readonly iy: number;
  /** Desnivel por píxel (m), fila 0 al sur. */
  readonly offset: Float32Array;
}

export type ReliefField = ReadonlyMap<string, ReliefTile>;

/**
 * Desnivel por casillas. Las pasadas se aplican en orden y el mínimo se impone tras cada una:
 * hundir de más no se «guarda», y subir después parte de −0,5 m.
 */
export function rasterizeRelief(strokes: readonly LocalReliefStroke[]): ReliefField {
  const tiles = new Map<string, ReliefTile>();
  for (const stroke of strokes) {
    const sign = stroke.direction === 'raise' ? 1 : -1;
    for (const { ix, iy, value } of strokeField(stroke).values()) {
      const key = cellKey(ix, iy);
      let tile = tiles.get(key);
      if (!tile) {
        tile = { ix, iy, offset: new Float32Array(FIELD_TILE_PX * FIELD_TILE_PX) };
        tiles.set(key, tile);
      }
      for (let k = 0; k < value.length; k++) {
        if (value[k] > 0) tile.offset[k] = Math.max(RELIEF_MIN_M, tile.offset[k] + sign * RELIEF_STEP_M * value[k]);
      }
    }
  }
  return tiles;
}

/** Desnivel del píxel global (gx, gy), 0 fuera de las casillas con datos. */
function pixel(field: ReliefField, gx: number, gy: number): number {
  const ix = Math.floor(gx / FIELD_TILE_PX);
  const iy = Math.floor(gy / FIELD_TILE_PX);
  const tile = field.get(cellKey(ix, iy));
  return tile ? tile.offset[(gy - iy * FIELD_TILE_PX) * FIELD_TILE_PX + (gx - ix * FIELD_TILE_PX)] : 0;
}

/** Desnivel en un punto del plano local (m), interpolado entre centros de píxel. */
export function reliefAt(field: ReliefField, p: Vec2): number {
  if (!field.size) return 0;
  const fx = p.x / FIELD_PX_M - 0.5;
  const fy = p.y / FIELD_PX_M - 0.5;
  const gx = Math.floor(fx);
  const gy = Math.floor(fy);
  const tx = fx - gx;
  const ty = fy - gy;
  const a = pixel(field, gx, gy) * (1 - tx) + pixel(field, gx + 1, gy) * tx;
  const b = pixel(field, gx, gy + 1) * (1 - tx) + pixel(field, gx + 1, gy + 1) * tx;
  return a * (1 - ty) + b * ty;
}

/** ¿Hay desnivel no nulo en la casilla que contiene `p`? (para afinar la malla solo ahí) */
export function reliefTileHasData(field: ReliefField, p: Vec2): boolean {
  const ix = Math.floor(p.x / FIELD_PX_M / FIELD_TILE_PX);
  const iy = Math.floor(p.y / FIELD_PX_M / FIELD_TILE_PX);
  return field.has(cellKey(ix, iy));
}

/** Rango del desnivel pintado (m); {0, 0} sin desniveles. */
export function reliefRange(field: ReliefField): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const tile of field.values()) {
    for (const v of tile.offset) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max };
}
