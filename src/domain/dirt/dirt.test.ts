import { describe, expect, it } from 'vitest';
import { addDirtStroke, clearDirt, removeDirtStrokes } from '../project/actions';
import { createEmptyProject } from '../project/types';
import { vec } from '../geometry/vec2';
import { BRUSH_STRENGTH, DIRT_SPECS, dirtAt, dirtLevel, rasterizeDirt, strokeTouches, type LocalDirtStroke } from './dirt';

const line = (y: number, material: LocalDirtStroke['material'] = 'sand', radius = 1): LocalDirtStroke => ({
  material,
  radius,
  points: [vec(0, y), vec(10, y)],
});

describe('Brush: suciedad difuminada', () => {
  it('deja una ligera cantidad en el eje que se difumina hasta cero en el borde', () => {
    const tiles = rasterizeDirt([line(0)]);
    expect(dirtAt(tiles, 'sand', vec(5, 0))).toBeCloseTo(BRUSH_STRENGTH, 2);
    const mid = dirtAt(tiles, 'sand', vec(5, 0.7));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(BRUSH_STRENGTH);
    expect(dirtAt(tiles, 'sand', vec(5, 1.1))).toBe(0);
    expect(dirtAt(tiles, 'gravel', vec(5, 0))).toBe(0);
  });

  it('acumula las pasadas superpuestas sin pasar de 1 y un trazo no se suma consigo mismo', () => {
    const one = dirtAt(rasterizeDirt([line(0)]), 'sand', vec(5, 0));
    const two = dirtAt(rasterizeDirt([line(0), line(0)]), 'sand', vec(5, 0));
    expect(two).toBeCloseTo(1 - (1 - one) ** 2, 4);
    const many = dirtAt(rasterizeDirt(Array.from({ length: 30 }, () => line(0))), 'sand', vec(5, 0));
    expect(many).toBeLessThanOrEqual(1);
    // Ida y vuelta en el mismo trazo: igual que una pasada.
    const zigzag = rasterizeDirt([{ material: 'sand', radius: 1, points: [vec(0, 0), vec(10, 0), vec(0, 0)] }]);
    expect(dirtAt(zigzag, 'sand', vec(5, 0))).toBeCloseTo(one, 4);
  });

  it('cruza casillas sin cortes y admite coordenadas negativas', () => {
    const tiles = rasterizeDirt([{ material: 'gravel', radius: 2, points: [vec(-40, -3), vec(40, -3)] }]);
    expect(tiles.size).toBeGreaterThanOrEqual(3);
    for (const x of [-31.9, -0.05, 0.05, 31.95, 32.05]) expect(dirtAt(tiles, 'gravel', vec(x, -3))).toBeCloseTo(BRUSH_STRENGTH, 2);
  });

  it('pasa de densidad a nivel de agarre: una pasada ligera, varias más fuertes', () => {
    expect(dirtLevel(0)).toBe(0);
    expect(dirtLevel(BRUSH_STRENGTH)).toBe(1);
    expect(dirtLevel(1 - (1 - BRUSH_STRENGTH) ** 2)).toBe(2);
    expect(dirtLevel(1 - (1 - BRUSH_STRENGTH) ** 4)).toBe(3);
    for (const spec of Object.values(DIRT_SPECS)) {
      const f = spec.levels.map((l) => l.friction);
      expect(f[0]).toBeLessThan(0.98); // menos agarre que el asfalto
      expect(f[1]).toBeLessThan(f[0]);
      expect(f[2]).toBeLessThan(f[1]);
      expect(spec.levels.every((l) => l.dirtAdditive > 0 && l.isValidTrack === 1 && l.key.startsWith('DIRT'))).toBe(true);
    }
  });

  it('la goma detecta los trazos bajo el cursor y las acciones los añaden y quitan', () => {
    expect(strokeTouches(line(0), vec(5, 1.5), 1)).toBe(true);
    expect(strokeTouches(line(0), vec(5, 2.5), 1)).toBe(false);
    let p = addDirtStroke(createEmptyProject(), 'sand', 1, [{ lat: 37.4, lng: -6 }]);
    p = addDirtStroke(p, 'gravel', 2, [{ lat: 37.4, lng: -6 }, { lat: 37.4001, lng: -6 }]);
    expect(p.dirt.map((d) => d.material)).toEqual(['sand', 'gravel']);
    expect(addDirtStroke(p, 'sand', 1, [])).toBe(p);
    expect(removeDirtStrokes(p, new Set([p.dirt[0].id])).dirt.map((d) => d.material)).toEqual(['gravel']);
    expect(clearDirt(p).dirt).toEqual([]);
  });
});
