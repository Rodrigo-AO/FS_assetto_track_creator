/**
 * Mapa de superficies de un circuito de AC para la capa del editor: imagen norte arriba, en el
 * plano este-norte de la georreferencia (para superponerla al satélite con Leaflet), con un color
 * por clase de superficie (asfalto, piano, césped…). La misma imagen sirve para validar el trazado:
 * el navegador lee la clase de cada píxel por su color.
 */
import type { Georef } from '../src/domain/geo/projection';
import { SURFACE_CLASS_COLORS, type SurfaceClass } from '../src/domain/presets/circuit';
import { encodePng } from '../src/export/binary/png';

export interface SurfaceMap {
  /** Origen de la georreferencia: el plano este-norte de la imagen es el tangente en este punto. */
  readonly origin: { readonly lat: number; readonly lng: number };
  /** Rectángulo de la imagen en metros este-norte (x0, y0 = esquina suroeste). */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly cell: number;
  readonly width: number;
  readonly height: number;
  /** PNG en base64 (píxeles transparentes donde no hay suelo físico). */
  readonly png: string;
}

export interface GroundSource {
  /** Triángulos de suelo en el plano del circuito: (x, y, altura) × 3. */
  readonly ground: Float32Array;
  readonly triangleClass: (triangle: number) => SurfaceClass;
}

const MARGIN_M = 5;
/** Límite de píxeles de la imagen: si no cabe con la celda pedida, se agranda la celda. */
const MAX_PIXELS = 8_000_000;

/**
 * Rasteriza el suelo del circuito (la superficie más alta en cada píxel) en el plano este-norte.
 * `clip` (rectángulo este-norte, p. ej. el contorno del preset) recorta superficies enormes como
 * el plano de césped base de algunos mods.
 */
export function rasterizeSurfaceMap(
  source: GroundSource,
  georef: Georef,
  clip?: readonly [number, number, number, number],
  cell = 0.5,
): Omit<SurfaceMap, 'png'> & { readonly pixels: Uint8Array } {
  const { scale, offset } = georef;
  const cos = Math.cos((georef.rotationDeg * Math.PI) / 180);
  const sin = Math.sin((georef.rotationDeg * Math.PI) / 180);
  const t = source.ground;
  const enu = new Float32Array(t.length);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) {
    const e = scale * (cos * t[i] - sin * t[i + 1]) + offset[0];
    const n = scale * (sin * t[i] + cos * t[i + 1]) + offset[1];
    enu[i] = e;
    enu[i + 1] = n;
    enu[i + 2] = t[i + 2];
    x0 = Math.min(x0, e);
    x1 = Math.max(x1, e);
    y0 = Math.min(y0, n);
    y1 = Math.max(y1, n);
  }
  [x0, y0, x1, y1] = [x0 - MARGIN_M, y0 - MARGIN_M, x1 + MARGIN_M, y1 + MARGIN_M];
  if (clip) [x0, y0, x1, y1] = [Math.max(x0, clip[0]), Math.max(y0, clip[1]), Math.min(x1, clip[2]), Math.min(y1, clip[3])];
  while (((x1 - x0) / cell) * ((y1 - y0) / cell) > MAX_PIXELS) cell *= 1.25;
  const width = Math.ceil((x1 - x0) / cell);
  const height = Math.ceil((y1 - y0) / cell);
  x1 = x0 + width * cell;
  y1 = y0 + height * cell;

  const top = new Float32Array(width * height).fill(-Infinity);
  const winner = new Int32Array(width * height).fill(-1);
  for (let k = 0; k < enu.length; k += 9) {
    const ax = enu[k], ay = enu[k + 1], ah = enu[k + 2];
    const bx = enu[k + 3], by = enu[k + 4], bh = enu[k + 5];
    const cx = enu[k + 6], cy = enu[k + 7], ch = enu[k + 8];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    // Píxel (i, j): centro en (x0 + (i + ½)·cell, y1 − (j + ½)·cell); fila 0 al norte.
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cell - 0.5));
    const i1 = Math.min(width - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell - 0.5));
    const j0 = Math.max(0, Math.ceil((y1 - Math.max(ay, by, cy)) / cell - 0.5));
    const j1 = Math.min(height - 1, Math.floor((y1 - Math.min(ay, by, cy)) / cell - 0.5));
    for (let j = j0; j <= j1; j++) {
      const y = y1 - (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * cell;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const h = l1 * ah + l2 * bh + l3 * ch;
        const p = j * width + i;
        if (h > top[p]) {
          top[p] = h;
          winner[p] = k / 9;
        }
      }
    }
  }

  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < winner.length; p++) {
    if (winner[p] < 0) continue;
    const [r, g, b] = SURFACE_CLASS_COLORS[source.triangleClass(winner[p])];
    data.set([r, g, b, 255], p * 4);
  }
  return { origin: { lat: georef.origin.lat, lng: georef.origin.lng }, x0, y0, x1, y1, cell, width, height, pixels: data };
}

/** Mapa de superficies listo para enviar al navegador (PNG en base64). */
export function buildSurfaceMap(source: GroundSource, georef: Georef, clip?: readonly [number, number, number, number], cell = 0.5): SurfaceMap {
  const { pixels, ...meta } = rasterizeSurfaceMap(source, georef, clip, cell);
  return { ...meta, png: Buffer.from(encodePng({ width: meta.width, height: meta.height, data: pixels })).toString('base64') };
}
