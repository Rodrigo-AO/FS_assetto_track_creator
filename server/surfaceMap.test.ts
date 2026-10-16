import { describe, expect, it } from 'vitest';
import { GeoreferencedProjection, type Georef } from '../src/domain/geo/projection';
import { surfaceAt, type SurfaceClass } from '../src/domain/presets/circuit';
import { buildSurfaceMap, rasterizeSurfaceMap } from './surfaceMap';

/** Cuadrado [x0, x0 + size] × [y0, y0 + size] del plano del circuito a altura h (dos triángulos). */
const square = (x0: number, y0: number, size: number, h: number): number[] => [
  x0, y0, h, x0 + size, y0, h, x0 + size, y0 + size, h,
  x0, y0, h, x0 + size, y0 + size, h, x0, y0 + size, h,
];

describe('mapa de superficies del circuito', () => {
  // Asfalto en [0, 10]², césped en [10, 20] × [0, 10] y un piano más alto sobre el asfalto en [2, 4]².
  const ground = Float32Array.from([...square(0, 0, 10, 0), ...square(10, 0, 10, 0), ...square(2, 2, 2, 0.1)]);
  const classes: SurfaceClass[] = ['road', 'road', 'grass', 'grass', 'kerb', 'kerb'];
  const georef: Georef = { origin: { lat: 41.57, lng: 2.26 }, scale: 1, rotationDeg: 90, offset: [100, 50] };
  const source = { ground, triangleClass: (t: number) => classes[t] };
  const at = (x: number, y: number, raster = rasterizeSurfaceMap(source, georef, undefined, 0.25)) =>
    surfaceAt(raster, new GeoreferencedProjection(georef).toLatLng({ x, y }));

  it('pinta cada superficie en su sitio, ya georreferenciada (giro de 90°)', () => {
    expect(at(7, 7)).toBe('road');
    expect(at(15, 5)).toBe('grass');
    expect(at(3, 3)).toBe('kerb'); // la superficie más alta manda
    expect(at(5, 15)).toBeNull(); // sin suelo físico
  });

  it('recorta al rectángulo pedido y codifica un PNG', () => {
    // Giro de 90°: el plano del circuito (x, y) cae en este-norte como (100 − y, 50 + x).
    const clipped = rasterizeSurfaceMap(source, georef, [80, 40, 100, 60], 0.25);
    expect(clipped.x0).toBeGreaterThanOrEqual(80);
    expect(clipped.y1).toBeLessThanOrEqual(60 + 0.25);
    const png = Buffer.from(buildSurfaceMap(source, georef).png, 'base64');
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  });
});
