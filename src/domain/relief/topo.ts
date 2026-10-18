/**
 * Vista topográfica del área: altura del suelo (base del entorno + desniveles pintados) en una
 * rejilla alineada con latitud y longitud, y la paleta de color con la que se pinta.
 */
import type { LatLng, Projection } from '../geo/projection';
import { pointInRing } from '../geometry/polygon';
import type { Vec2 } from '../geometry/vec2';

export interface TopoRaster {
  readonly width: number;
  readonly height: number;
  /** Altura (m) por píxel, fila 0 al norte; NaN fuera del área. */
  readonly heights: Float32Array;
  /** Rango de la escala de color (m). */
  readonly min: number;
  readonly max: number;
  /** Esquinas suroeste y noreste. */
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Rango mínimo de la escala (m): un área plana no se pinta con todo el arco de colores. */
const MIN_SPAN_M = 0.1;

/**
 * Alturas del área con `maxSide` píxeles en el lado mayor. `heightAt` da la altura del suelo en
 * un punto del plano local del proyecto.
 */
export function topoRaster(area: readonly LatLng[], projection: Projection, localArea: readonly Vec2[], heightAt: (p: Vec2) => number, maxSide = 600): TopoRaster {
  const lats = area.map((p) => p.lat);
  const lngs = area.map((p) => p.lng);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  // Proporción en metros: la longitud se acorta con el coseno de la latitud.
  const aspect = ((east - west) * Math.cos((((south + north) / 2) * Math.PI) / 180)) / (north - south || 1e-9);
  const width = Math.max(1, Math.round(aspect >= 1 ? maxSide : maxSide * aspect));
  const height = Math.max(1, Math.round(aspect >= 1 ? maxSide / aspect : maxSide));
  const heights = new Float32Array(width * height).fill(NaN);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < height; j++) {
    const lat = north - ((j + 0.5) / height) * (north - south);
    for (let i = 0; i < width; i++) {
      const p = projection.toLocal({ lat, lng: west + ((i + 0.5) / width) * (east - west) });
      if (!pointInRing(p, localArea)) continue;
      const h = heightAt(p);
      heights[j * width + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  if (!Number.isFinite(lo)) [lo, hi] = [0, 0];
  if (hi - lo < MIN_SPAN_M) {
    const mid = (hi + lo) / 2;
    [lo, hi] = [mid - MIN_SPAN_M / 2, mid + MIN_SPAN_M / 2];
  }
  return { width, height, heights, min: lo, max: hi, south, west, north, east };
}

/** Paleta topográfica de lo más bajo (azul) a lo más alto (rojo). */
export const TOPO_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [43, 78, 168]],
  [0.2, [47, 181, 201]],
  [0.4, [92, 195, 90]],
  [0.6, [242, 210, 69]],
  [0.8, [240, 138, 44]],
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
  const span = raster.max - raster.min;
  raster.heights.forEach((h, k) => {
    if (Number.isNaN(h)) return;
    const [r, g, b] = topoColor((h - raster.min) / span);
    out.set([r, g, b, 255], k * 4);
  });
  return out;
}
