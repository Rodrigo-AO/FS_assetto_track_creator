import { describe, expect, it } from 'vitest';
import { vec } from '../geometry/vec2';
import { addReliefStroke, clearRelief } from '../project/actions';
import { createEmptyProject, type ReliefDirection } from '../project/types';
import { rasterizeRelief, RELIEF_MIN_M, RELIEF_STEP_M, reliefAt, reliefRange, reliefTileHasData, type LocalReliefStroke } from './relief';

const pass = (direction: ReliefDirection, radius = 2): LocalReliefStroke => ({ direction, radius, points: [vec(0, 0), vec(20, 0)] });
const times = (n: number, direction: ReliefDirection) => Array.from({ length: n }, () => pass(direction));

describe('Desnivelador', () => {
  it('cada pasada sube o baja RELIEF_STEP_M en el eje y se difumina hasta 0 en el borde', () => {
    const up = rasterizeRelief([pass('raise')]);
    expect(reliefAt(up, vec(10, 0))).toBeCloseTo(RELIEF_STEP_M, 2);
    const side = reliefAt(up, vec(10, 1.4));
    expect(side).toBeGreaterThan(0);
    expect(side).toBeLessThan(RELIEF_STEP_M);
    expect(reliefAt(up, vec(10, 2.2))).toBeCloseTo(0, 4);
    expect(reliefAt(rasterizeRelief([pass('lower')]), vec(10, 0))).toBeCloseTo(-RELIEF_STEP_M, 2);
  });

  it('suma las pasadas sin límite hacia arriba y nunca baja de −0,5 m', () => {
    expect(reliefAt(rasterizeRelief(times(25, 'raise')), vec(10, 0))).toBeCloseTo(25 * RELIEF_STEP_M, 1);
    expect(reliefAt(rasterizeRelief(times(12, 'lower')), vec(10, 0))).toBeCloseTo(RELIEF_MIN_M, 3);
    // El mínimo se impone tras cada pasada: hundir de más no se acumula.
    const afterFloor = rasterizeRelief([...times(12, 'lower'), pass('raise')]);
    expect(reliefAt(afterFloor, vec(10, 0))).toBeCloseTo(RELIEF_MIN_M + RELIEF_STEP_M, 2);
    expect(reliefRange(afterFloor).min).toBeGreaterThanOrEqual(RELIEF_MIN_M - 1e-6);
  });

  it('interpola con suavidad, también a través de casillas y en coordenadas negativas', () => {
    const field = rasterizeRelief([{ direction: 'raise', radius: 3, points: [vec(-40, -5), vec(40, -5)] }]);
    for (const x of [-32.01, -0.01, 0.01, 31.99, 32.01]) expect(reliefAt(field, vec(x, -5))).toBeCloseTo(RELIEF_STEP_M, 2);
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
