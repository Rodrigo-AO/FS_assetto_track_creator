/**
 * Desnivelador: pincel que sube o baja el suelo por donde se arrastra. Lo pintado se suma
 * progresivamente (también al repasar en la misma pasada): una pasada recta deja el 75 % de
 * ±RELIEF_STEP_M en su eje, difuminado hacia el borde. El desnivel queda entre RELIEF_MIN_M y
 * RELIEF_MAX_M.
 */
import type { Vec2 } from '../geometry/vec2';
import type { ReliefDirection } from '../project/types';
import { cellKey, FIELD_PX_M, FIELD_TILE_PX, strokeField, type FieldStroke, type StrokeField } from '../strokes/strokeField';

export interface LocalReliefStroke extends FieldStroke {
  readonly direction: ReliefDirection;
}

/** Desnivel de una pasada «completa» en el eje del trazo (m); una pasada real deja el 75 %. */
export const RELIEF_STEP_M = 0.1;
/** Límites del desnivel acumulado (m): los extremos de la vista topográfica. */
export const RELIEF_MIN_M = -1;
export const RELIEF_MAX_M = 5;

export interface ReliefTile {
  readonly ix: number;
  readonly iy: number;
  /** Desnivel por píxel (m), fila 0 al sur. */
  readonly offset: Float32Array;
}

export type ReliefField = ReadonlyMap<string, ReliefTile>;

/**
 * Desnivel por casillas. Las pasadas se aplican en orden y los límites se imponen tras cada una
 * (una pasada solo sube o solo baja): pasarse no se «guarda», y bajar después parte del máximo.
 * `fieldOf` permite reutilizar campos ya calculados.
 */
export function rasterizeRelief(strokes: readonly LocalReliefStroke[], fieldOf: (s: LocalReliefStroke) => StrokeField = strokeField): ReliefField {
  const tiles = new Map<string, ReliefTile>();
  for (const stroke of strokes) {
    const sign = stroke.direction === 'raise' ? 1 : -1;
    for (const { ix, iy, value } of fieldOf(stroke).values()) {
      const key = cellKey(ix, iy);
      let tile = tiles.get(key);
      if (!tile) {
        tile = { ix, iy, offset: new Float32Array(FIELD_TILE_PX * FIELD_TILE_PX) };
        tiles.set(key, tile);
      }
      for (let k = 0; k < value.length; k++) {
        if (value[k] > 0) tile.offset[k] = Math.min(RELIEF_MAX_M, Math.max(RELIEF_MIN_M, tile.offset[k] + sign * RELIEF_STEP_M * value[k]));
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

/**
 * Muestreador rápido del desnivel para recorrer muchos puntos seguidos (vista topográfica):
 * recuerda la última casilla y evita construir claves en cada píxel. Con `nearest` toma el píxel
 * más cercano en vez de interpolar (basta para pintar en pantalla).
 */
export function reliefSampler(field: ReliefField, nearest = false): (p: Vec2) => number {
  if (!field.size) return () => 0;
  let last: ReliefTile | undefined;
  const px = (gx: number, gy: number): number => {
    const ix = Math.floor(gx / FIELD_TILE_PX);
    const iy = Math.floor(gy / FIELD_TILE_PX);
    if (!last || last.ix !== ix || last.iy !== iy) {
      const t = field.get(cellKey(ix, iy));
      if (!t) return 0;
      last = t;
    }
    return last.offset[(gy - iy * FIELD_TILE_PX) * FIELD_TILE_PX + (gx - ix * FIELD_TILE_PX)];
  };
  if (nearest) return (p) => px(Math.floor(p.x / FIELD_PX_M), Math.floor(p.y / FIELD_PX_M));
  return (p) => {
    const fx = p.x / FIELD_PX_M - 0.5;
    const fy = p.y / FIELD_PX_M - 0.5;
    const gx = Math.floor(fx);
    const gy = Math.floor(fy);
    const tx = fx - gx;
    const ty = fy - gy;
    const a = px(gx, gy) * (1 - tx) + px(gx + 1, gy) * tx;
    const b = px(gx, gy + 1) * (1 - tx) + px(gx + 1, gy + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
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
