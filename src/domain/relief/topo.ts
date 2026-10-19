/**
 * Vista topográfica del área: desnivel respecto al suelo original en una rejilla alineada con
 * latitud y longitud, y la escala de color fija con la que se pinta (azul −1 m, verde 0, rojo 5 m).
 */
import type { LatLng, Projection } from '../geo/projection';
import { pointInRing } from '../geometry/polygon';
import type { Vec2 } from '../geometry/vec2';
import { RELIEF_MAX_M, RELIEF_MIN_M } from './relief';

export interface TopoRaster {
  readonly width: number;
  readonly height: number;
  /** Altura (m) por píxel, fila 0 al norte; NaN fuera del área. */
  readonly heights: Float32Array;
  /** Esquinas suroeste y noreste. */
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Rejilla de la vista: dónde cae cada píxel en el plano local (se calcula una vez por área). */
export interface TopoGrid {
  readonly width: number;
  readonly height: number;
  /** x, y locales de cada píxel (fila 0 al norte); NaN fuera del área. */
  readonly local: Float64Array;
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Rejilla alineada con latitud y longitud con `maxSide` píxeles en el lado mayor del área. */
export function topoGrid(area: readonly LatLng[], projection: Projection, localArea: readonly Vec2[], maxSide = 600): TopoGrid {
  const lats = area.map((p) => p.lat);
  const lngs = area.map((p) => p.lng);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  // Proporción en metros: la longitud se acorta con el coseno de la latitud.
  const aspect = ((east - west) * Math.cos((((south + north) / 2) * Math.PI) / 180)) / (north - south || 1e-9);
  const width = Math.max(1, Math.round(aspect >= 1 ? maxSide : maxSide * aspect));
  const height = Math.max(1, Math.round(aspect >= 1 ? maxSide / aspect : maxSide));
  const local = new Float64Array(width * height * 2).fill(NaN);
  for (let j = 0; j < height; j++) {
    const lat = north - ((j + 0.5) / height) * (north - south);
    for (let i = 0; i < width; i++) {
      const p = projection.toLocal({ lat, lng: west + ((i + 0.5) / width) * (east - west) });
      if (!pointInRing(p, localArea)) continue;
      local[(j * width + i) * 2] = p.x;
      local[(j * width + i) * 2 + 1] = p.y;
    }
  }
  return { width, height, local, south, west, north, east };
}

/** Alturas de la rejilla; `heightAt` da la del suelo en un punto del plano local. */
export function topoHeights(grid: TopoGrid, heightAt: (p: Vec2) => number): TopoRaster {
  const heights = new Float32Array(grid.width * grid.height).fill(NaN);
  const p = { x: 0, y: 0 };
  for (let k = 0; k < heights.length; k++) {
    p.x = grid.local[k * 2];
    if (Number.isNaN(p.x)) continue;
    p.y = grid.local[k * 2 + 1];
    heights[k] = heightAt(p);
  }
  const { width, height, south, west, north, east } = grid;
  return { width, height, heights, south, west, north, east };
}

/** Rejilla y alturas de una vez (ver `topoGrid`). */
export function topoRaster(area: readonly LatLng[], projection: Projection, localArea: readonly Vec2[], heightAt: (p: Vec2) => number, maxSide = 600): TopoRaster {
  return topoHeights(topoGrid(area, projection, localArea, maxSide), heightAt);
}

/** Extremos fijos de la escala (m): los límites del Desnivelador. */
export const TOPO_MIN_M = RELIEF_MIN_M;
export const TOPO_MAX_M = RELIEF_MAX_M;
/** Posición del 0 (verde) en la escala: el tercio inferior es para lo que baja. */
export const TOPO_ZERO_T = 1 / 3;

/**
 * Posición (0–1) de una altura en la escala. Cada lado va con la raíz de la altura relativa para
 * que los desniveles de pocos centímetros se distingan del suelo original pese a la escala de 5 m.
 */
export function topoT(h: number): number {
  if (h >= 0) return TOPO_ZERO_T + (1 - TOPO_ZERO_T) * Math.sqrt(Math.min(1, h / TOPO_MAX_M));
  return TOPO_ZERO_T * (1 - Math.sqrt(Math.min(1, h / TOPO_MIN_M)));
}

/** Alturas rotuladas en la barra de escala (m). */
export const TOPO_TICKS = [5, 2, 1, 0.25, 0, -0.25, -1] as const;

/** Paleta topográfica de lo más bajo (azul) a lo más alto (rojo), con el verde en el 0. */
export const TOPO_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [43, 78, 168]],
  [TOPO_ZERO_T / 2, [47, 181, 201]],
  [TOPO_ZERO_T, [92, 195, 90]],
  [TOPO_ZERO_T + (1 - TOPO_ZERO_T) / 3, [242, 210, 69]],
  [TOPO_ZERO_T + (2 * (1 - TOPO_ZERO_T)) / 3, [240, 138, 44]],
  [1, [210, 65, 44]],
];

/** Color de la paleta para t en [0, 1]. */
export function topoColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let k = 1; k < TOPO_STOPS.length; k++) {
    const [t1, c1] = TOPO_STOPS[k];
    if (x <= t1) {
      const [t0, c0] = TOPO_STOPS[k - 1];
      const f = (x - t0) / (t1 - t0);
      return [0, 1, 2].map((i) => Math.round(c0[i] + (c1[i] - c0[i]) * f)) as [number, number, number];
    }
  }
  return [...TOPO_STOPS[TOPO_STOPS.length - 1][1]] as [number, number, number];
}

/** Píxeles RGBA de la vista (transparente fuera del área). */
export function topoPixels(raster: TopoRaster): Uint8ClampedArray {
  const out = new Uint8ClampedArray(raster.width * raster.height * 4);
  const { heights } = raster;
  for (let k = 0; k < heights.length; k++) {
    const h = heights[k];
    if (Number.isNaN(h)) continue;
    // El suelo original (0) es lo más frecuente: va directo.
    const lut = h === 0 ? ZERO_COLOR : LUT;
    const i = h === 0 ? 0 : Math.round(topoT(h) * LUT_STEPS) * 3;
    out[k * 4] = lut[i];
    out[k * 4 + 1] = lut[i + 1];
    out[k * 4 + 2] = lut[i + 2];
    out[k * 4 + 3] = 255;
  }
  return out;
}

/** Paleta precalculada (la vista se repinta en cada fotograma mientras se pinta). */
const LUT_STEPS = 1024;
const LUT = new Uint8Array((LUT_STEPS + 1) * 3);
for (let i = 0; i <= LUT_STEPS; i++) LUT.set(topoColor(i / LUT_STEPS), i * 3);
const ZERO_COLOR = Uint8Array.from(topoColor(TOPO_ZERO_T));
