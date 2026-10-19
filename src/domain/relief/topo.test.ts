import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../geo/projection';
import { vec } from '../geometry/vec2';
import { TOPO_STOPS, TOPO_ZERO_T, topoColor, topoPixels, topoRaster, topoT } from './topo';

const projection = new LocalProjection({ lat: 37.4, lng: -6 });
const square = [vec(-20, -10), vec(20, -10), vec(20, 10), vec(-20, 10)];
const area = square.map((p) => projection.toLatLng(p));

describe('vista topográfica', () => {
  it('muestrea la altura dentro del área, norte arriba y con la proporción del área', () => {
    // Rampa hacia el este: 0 m en x = −20, 4 m en x = 20.
    const raster = topoRaster(area, projection, square, (p) => (p.x + 20) / 10, 200);
    expect(raster.width).toBe(200);
    expect(raster.height).toBeCloseTo(100, -1);
    const row = Math.floor(raster.height / 2) * raster.width;
    expect(raster.heights[row]).toBeLessThan(raster.heights[row + raster.width - 1]);
  });

  it('deja fuera del área sin dato (transparente)', () => {
    const triangle = [vec(-20, -10), vec(20, -10), vec(-20, 10)];
    const raster = topoRaster(triangle.map((p) => projection.toLatLng(p)), projection, triangle, () => 0.3, 100);
    expect(Number.isNaN(raster.heights[raster.width - 1])).toBe(true); // esquina noreste, fuera
    const px = topoPixels(raster);
    expect(px[(raster.width - 1) * 4 + 3]).toBe(0);
  });

  it('la paleta va de azul (bajo) a rojo (alto) pasando por sus paradas', () => {
    expect(topoColor(0)).toEqual([...TOPO_STOPS[0][1]]);
    expect(topoColor(1)).toEqual([...TOPO_STOPS[TOPO_STOPS.length - 1][1]]);
    expect(topoColor(-5)).toEqual(topoColor(0));
    expect(topoColor(TOPO_ZERO_T)).toEqual([...TOPO_STOPS[2][1]]);
  });

  it('escala fija: azul en −1 m, verde en el suelo original y rojo en 5 m', () => {
    expect(topoT(-1)).toBe(0);
    expect(topoT(-3)).toBe(0);
    expect(topoT(0)).toBeCloseTo(TOPO_ZERO_T, 9);
    expect(topoT(5)).toBe(1);
    expect(topoT(8)).toBe(1);
    // Monótona y con los pocos centímetros bien visibles.
    const hs = [-1, -0.5, -0.1, 0, 0.075, 0.5, 2, 5];
    hs.slice(1).forEach((h, i) => expect(topoT(h)).toBeGreaterThan(topoT(hs[i])));
    expect(topoT(0.075) - TOPO_ZERO_T).toBeGreaterThan(0.05);
  });
});
