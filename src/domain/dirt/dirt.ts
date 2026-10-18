/**
 * Suciedad pintada con el Brush: arena o grava esparcida sobre el circuito. Cada pasada es un
 * trazo con un radio; su aporte se difumina hacia el borde y las pasadas se acumulan. La densidad
 * resultante (0–1) se traduce en niveles de agarre para la física de AC y en una calca visual.
 */
import type { Vec2 } from '../geometry/vec2';
import { brushFalloff, FIELD_PX_M, FIELD_TILE_M, FIELD_TILE_PX, strokeField, strokeTouches } from '../strokes/strokeField';
import type { DirtMaterial } from '../project/types';
import type { SurfacePhysics } from '../surfaces/surfaceTypes';

export interface LocalDirtStroke {
  readonly material: DirtMaterial;
  /** Radio del pincel (m). */
  readonly radius: number;
  readonly points: readonly Vec2[];
}

/** Densidad que deja una pasada en el centro del trazo: «una ligera cantidad». */
export const BRUSH_STRENGTH = 0.3;

/** Casillas en que se guarda la densidad (las del campo de trazos: 32 m, 0,125 m por píxel). */
export const DIRT_TILE_M = FIELD_TILE_M;
export const DIRT_TILE_PX = FIELD_TILE_PX;
const PX_M = FIELD_PX_M;

export interface DirtTile {
  readonly material: DirtMaterial;
  /** Índices de la casilla: cubre [ix·32, (ix+1)·32) × [iy·32, (iy+1)·32) en el plano local. */
  readonly ix: number;
  readonly iy: number;
  /** Densidad por píxel, fila 0 al sur (y creciente). */
  readonly density: Float32Array;
}

export const tileKey = (material: DirtMaterial, ix: number, iy: number): string => `${material}:${ix}:${iy}`;

export { brushFalloff, strokeTouches };

/**
 * Densidad de suciedad por casillas. Dentro de un trazo manda el aporte máximo (un trazo no se
 * acumula consigo mismo); entre trazos se combina como capas: 1 − (1 − a)(1 − b).
 */
export function rasterizeDirt(strokes: readonly LocalDirtStroke[]): Map<string, DirtTile> {
  const tiles = new Map<string, DirtTile>();
  for (const stroke of strokes) {
    for (const { ix, iy, value } of strokeField(stroke).values()) {
      const key = tileKey(stroke.material, ix, iy);
      let tile = tiles.get(key);
      if (!tile) {
        tile = { material: stroke.material, ix, iy, density: new Float32Array(DIRT_TILE_PX * DIRT_TILE_PX) };
        tiles.set(key, tile);
      }
      for (let k = 0; k < value.length; k++) {
        if (value[k] > 0) tile.density[k] = 1 - (1 - tile.density[k]) * (1 - BRUSH_STRENGTH * value[k]);
      }
    }
  }
  return tiles;
}

/** Densidad en un punto del plano local (0 si no hay suciedad de ese material). */
export function dirtAt(tiles: ReadonlyMap<string, DirtTile>, material: DirtMaterial, p: Vec2): number {
  const gx = Math.floor(p.x / PX_M);
  const gy = Math.floor(p.y / PX_M);
  const ix = Math.floor(gx / DIRT_TILE_PX);
  const iy = Math.floor(gy / DIRT_TILE_PX);
  const tile = tiles.get(tileKey(material, ix, iy));
  return tile ? tile.density[(gy - iy * DIRT_TILE_PX) * DIRT_TILE_PX + (gx - ix * DIRT_TILE_PX)] : 0;
}

// --------------------------------------------------------------------------- física

/**
 * Umbrales de densidad de cada nivel (ligero, medio, fuerte). Una pasada (0,3 en el centro) queda
 * en el nivel 1; dos pasadas superpuestas, en el 2; cuatro o más, en el 3.
 */
export const DIRT_LEVEL_THRESHOLDS = [0.05, 0.4, 0.7] as const;

/** Nivel de suciedad (1–3) para una densidad; 0 si es despreciable. */
export function dirtLevel(density: number): 0 | 1 | 2 | 3 {
  if (density >= DIRT_LEVEL_THRESHOLDS[2]) return 3;
  if (density >= DIRT_LEVEL_THRESHOLDS[1]) return 2;
  if (density >= DIRT_LEVEL_THRESHOLDS[0]) return 1;
  return 0;
}

export interface DirtMaterialSpec {
  readonly material: DirtMaterial;
  readonly label: string;
  /** Color de previsualización sobre el mapa. */
  readonly mapColor: string;
  /** Color base y del grano de la calca en AC. */
  readonly color: readonly [number, number, number];
  readonly grain: readonly [number, number, number];
  /** Física por nivel (1, 2, 3). */
  readonly levels: readonly [SurfacePhysics, SurfacePhysics, SurfacePhysics];
}

const dirty = (key: string, friction: number, dirtAdditive: number, vibrationGain: number): SurfacePhysics => ({
  key, friction, damping: 0, wav: '', wavPitch: 0, ffEffect: 'NULL', dirtAdditive,
  // Sigue siendo pista válida: ensuciarla no cuenta como salirse.
  isValidTrack: 1, blackFlagTime: 0, sinHeight: 0, sinLength: 0, isPitlane: 0, vibrationGain, vibrationLength: 0.6,
});

/*
 * Agarre: el asfalto de la app tiene fricción 0,98 y la grava de escapatoria de Kunos 0,75.
 * La suciedad queda en medio y ensucia los neumáticos (DIRT_ADDITIVE); la grava además vibra algo.
 * Claves que no contienen ninguna otra: AC busca la clave como subcadena del nombre de la malla y,
 * con «ATCSAND1», encontraba también SAND (de sistema) y daba la malla por ambigua.
 */
export const DIRT_SPECS: Readonly<Record<DirtMaterial, DirtMaterialSpec>> = {
  sand: {
    material: 'sand',
    label: 'Arena',
    mapColor: '#D9BE82',
    color: [196, 170, 120],
    grain: [150, 124, 84],
    levels: [dirty('DIRTSA1', 0.93, 0.3, 0), dirty('DIRTSA2', 0.87, 0.6, 0), dirty('DIRTSA3', 0.8, 1, 0.05)],
  },
  gravel: {
    material: 'gravel',
    label: 'Grava',
    mapColor: '#9C9184',
    color: [150, 142, 130],
    grain: [92, 86, 78],
    levels: [dirty('DIRTGV1', 0.92, 0.4, 0.1), dirty('DIRTGV2', 0.85, 0.7, 0.2), dirty('DIRTGV3', 0.78, 1, 0.3)],
  },
};

export const DIRT_MATERIALS: readonly DirtMaterial[] = ['sand', 'gravel'];
