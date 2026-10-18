import { describe, expect, it } from 'vitest';
import { LocalProjection } from '../geo/projection';
import { vec } from '../geometry/vec2';
import { TOPO_STOPS, topoColor, topoPixels, topoRaster } from './topo';

const projection = new LocalProjection({ lat: 37.4, lng: -6 });
const square = [vec(-20, -10), vec(20, -10), vec(20, 10), vec(-20, 10)];
const area = square.map((p) => projection.toLatLng(p));

describe('vista topográfica', () => {
  it('muestrea la altura dentro del área, norte arriba y con la proporción del área', () => {
    // Rampa hacia el este: 0 m en x = −20, 4 m en x = 20.
    const raster = topoRaster(area, projection, square, (p) => (p.x + 20) / 10, 200);
    expect(raster.width).toBe(200);
    expect(raster.height).toBeCloseTo(100, -1);
    expect(raster.min).toBeCloseTo(0, 1);
    expect(raster.max).toBeCloseTo(4, 1);
    const row = Math.floor(raster.height / 2) * raster.width;
    expect(raster.heights[row]).toBeLessThan(raster.heights[row + raster.width - 1]);
  });

  it('deja fuera del área sin dato y no estira la escala en un área plana', () => {
    const triangle = [vec(-20, -10), vec(20, -10), vec(-20, 10)];
    const raster = topoRaster(triangle.map((p) => projection.toLatLng(p)), projection, triangle, () => 0.3, 100);
    expect(Number.isNaN(raster.heights[raster.width - 1])).toBe(true); // esquina noreste, fuera
    expect(raster.max - raster.min).toBeCloseTo(0.1, 5);
    const px = topoPixels(raster);
    expect(px[(raster.width - 1) * 4 + 3]).toBe(0);
  });

  it('la paleta va de azul (bajo) a rojo (alto) pasando por sus paradas', () => {
    expect(topoColor(0)).toEqual([...TOPO_STOPS[0][1]]);
    expect(topoColor(1)).toEqual([...TOPO_STOPS[TOPO_STOPS.length - 1][1]]);
    expect(topoColor(-5)).toEqual(topoColor(0));
    expect(topoColor(0.4)).toEqual([...TOPO_STOPS[2][1]]);
  });
});
