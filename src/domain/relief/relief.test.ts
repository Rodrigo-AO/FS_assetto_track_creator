import { describe, expect, it } from 'vitest';
import { vec } from '../geometry/vec2';
import { addReliefStroke, clearRelief } from '../project/actions';
import { createEmptyProject, type ReliefDirection } from '../project/types';
import { BRUSH_CENTER } from '../strokes/strokeField';
import { rasterizeRelief, RELIEF_MAX_M, RELIEF_MIN_M, RELIEF_STEP_M, reliefAt, reliefRange, reliefSampler, reliefTileHasData, type LocalReliefStroke } from './relief';

const pass = (direction: ReliefDirection, radius = 2): LocalReliefStroke => ({ direction, radius, points: [vec(0, 0), vec(20, 0)] });
const times = (n: number, direction: ReliefDirection) => Array.from({ length: n }, () => pass(direction));
/** Desnivel de una pasada recta en su eje. */
const ONE = BRUSH_CENTER * RELIEF_STEP_M;

describe('Desnivelador', () => {
  it('cada pasada sube o baja el 75 % de RELIEF_STEP_M en el eje y se difumina hasta 0 en el borde', () => {
    const up = rasterizeRelief([pass('raise')]);
    expect(reliefAt(up, vec(10, 0))).toBeCloseTo(ONE, 2);
    const side = reliefAt(up, vec(10, 1.2));
    expect(side).toBeGreaterThan(0);
    expect(side).toBeLessThan(ONE);
    expect(reliefAt(up, vec(10, 2.2))).toBeCloseTo(0, 4);
    expect(reliefAt(rasterizeRelief([pass('lower')]), vec(10, 0))).toBeCloseTo(-ONE, 2);
    // Repasar sin soltar suma, como el pincel de Lightroom.
    const zigzag = rasterizeRelief([{ direction: 'raise', radius: 2, points: [vec(0, 0), vec(20, 0), vec(0, 0)] }]);
    expect(reliefAt(zigzag, vec(10, 0))).toBeCloseTo(2 * ONE, 2);
  });

  it('suma las pasadas entre −1 m y 5 m', () => {
    expect(reliefAt(rasterizeRelief(times(20, 'raise')), vec(10, 0))).toBeCloseTo(20 * ONE, 1);
    expect(reliefAt(rasterizeRelief(times(80, 'raise')), vec(10, 0))).toBeCloseTo(RELIEF_MAX_M, 3);
    expect(reliefAt(rasterizeRelief(times(20, 'lower')), vec(10, 0))).toBeCloseTo(RELIEF_MIN_M, 3);
    // Los límites se imponen tras cada pasada: pasarse no se acumula.
    const afterFloor = rasterizeRelief([...times(20, 'lower'), pass('raise')]);
    expect(reliefAt(afterFloor, vec(10, 0))).toBeCloseTo(RELIEF_MIN_M + ONE, 2);
    expect(reliefRange(afterFloor).min).toBeGreaterThanOrEqual(RELIEF_MIN_M - 1e-6);
  });

  it('interpola con suavidad, también a través de casillas y en coordenadas negativas', () => {
    const field = rasterizeRelief([{ direction: 'raise', radius: 3, points: [vec(-40, -5), vec(40, -5)] }]);
    const sample = reliefSampler(field);
    for (const x of [-32.01, -0.01, 0.01, 31.99, 32.01]) {
      expect(reliefAt(field, vec(x, -5))).toBeCloseTo(ONE, 2);
      expect(sample(vec(x, -5))).toBeCloseTo(reliefAt(field, vec(x, -5)), 6);
      expect(reliefSampler(field, true)(vec(x, -5))).toBeCloseTo(ONE, 2);
    }
    const profile = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((d) => reliefAt(field, vec(5, -5 + d)));
    profile.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(profile[i] + 1e-6));
    expect(reliefTileHasData(field, vec(5, -5))).toBe(true);
    expect(reliefTileHasData(field, vec(5, 100))).toBe(false);
    expect(reliefAt(new Map(), vec(1, 1))).toBe(0);
  });

  it('las acciones añaden y quitan pasadas', () => {
    let p = addReliefStroke(createEmptyProject(), 'raise', 2, [{ lat: 37.4, lng: -6 }]);
    p = addReliefStroke(p, 'lower', 4, [{ lat: 37.4, lng: -6 }, { lat: 37.4001, lng: -6 }]);
    expect(p.relief.map((r) => r.direction)).toEqual(['raise', 'lower']);
    expect(addReliefStroke(p, 'raise', 2, [])).toBe(p);
    expect(clearRelief(p).relief).toEqual([]);
  });
});
