import { describe, expect, it } from 'vitest';
import { ovalProject } from '../../test/fixtures';
import { buildScene } from '../project/scene';
import {
  checkAgainstCircuit,
  circuitCheckWarnings,
  classFromColor,
  classifySurface,
  parseSurfaceProps,
  SURFACE_CLASS_COLORS,
  SURFACE_CLASSES,
} from './circuit';

/** surfaces.ini reales de ks_barcelona (layout_gp) y t78_hockenheimring (gp), resumidos. */
const SECTION = (key: string, friction: number, valid: number, pit = 0, wav = ''): string =>
  [`[SURFACE_X]`, `KEY=${key}`, `FRICTION=${friction}`, `WAV=${wav}`, `IS_VALID_TRACK=${valid}`, `IS_PITLANE=${pit}`, ''].join('\r\n');
const BARCELONA = [
  SECTION('PITS', 0.98, 1, 1), SECTION('TRM-BRC', 0.97, 1), SECTION('CONCRETE', 0.9, 1), SECTION('OUT', 0.9, 0),
  SECTION('KERB', 0.95, 1, 0, 'kerb.wav'), SECTION('CARPET', 0.65, 1, 0, 'extraturf.wav'), SECTION('CNCCUT', 0.9, 0),
].join('\r\n');
const HOCKENHEIM = [
  SECTION('ROAD', 0.98, 1), SECTION('OFFTRACKF', 0.95, 0), SECTION('PITHOCK', 0.95, 1, 1), SECTION('GRASS', 0.6, 0, 0, 'grass.wav'),
  SECTION('RD_CUT', 0.85, 0), SECTION('GR_CUT3_', 0.6, 0, 0, 'grass.wav'), SECTION('AST_CUT5_', 0.6, 0, 0, 'extraturf.wav'),
].join('\r\n');

describe('superficies de un circuito de AC', () => {
  it('clasifica las superficies de Barcelona y Hockenheim', () => {
    const classify = (ini: string) => {
      const props = parseSurfaceProps(ini);
      return Object.fromEntries(Object.keys(props).map((k) => [k, classifySurface(k, props[k])]));
    };
    expect(classify(BARCELONA)).toEqual({
      PITS: 'pit', 'TRM-BRC': 'road', CONCRETE: 'road', OUT: 'runoff', KERB: 'kerb', CARPET: 'grass', CNCCUT: 'runoff',
    });
    expect(classify(HOCKENHEIM)).toEqual({
      ROAD: 'road', OFFTRACKF: 'runoff', PITHOCK: 'pit', GRASS: 'grass', RD_CUT: 'runoff', GR_CUT3_: 'grass', AST_CUT5_: 'grass',
    });
    // Claves de sistema sin propiedades del circuito.
    expect(classifySurface('SAND', undefined)).toBe('gravel');
    expect(classifySurface('ROAD', undefined)).toBe('road');
  });

  it('recupera la clase desde el color de la capa', () => {
    for (const c of SURFACE_CLASSES) expect(classFromColor(...SURFACE_CLASS_COLORS[c], 255)).toBe(c);
    expect(classFromColor(40, 120, 255, 0)).toBeNull();
    expect(classFromColor(0, 0, 0, 255)).toBeNull();
  });

  it('cuenta el trazado y los conos fuera del pavimento y lo convierte en avisos', () => {
    const scene = buildScene(ovalProject())!;
    const allPaved = checkAgainstCircuit(scene, () => 'road');
    expect(allPaved.trackOnPaved).toBe(1);
    expect(allPaved.conesOff).toBe(0);
    expect(circuitCheckWarnings(allPaved)).toEqual([]);

    // Mitad oeste (x < 0) en césped.
    const half = checkAgainstCircuit(scene, (p) => (p.x < 0 ? 'grass' : 'kerb'));
    expect(half.trackOnPaved!).toBeGreaterThan(0.3);
    expect(half.trackOnPaved!).toBeLessThan(0.7);
    expect(half.conesOff).toBe([...scene.cones, ...scene.autoCones].filter((c) => c.position.x < 0).length);
    expect(half.offSamples.filter(Boolean).length).toBeGreaterThan(0);
    const warnings = circuitCheckWarnings(half);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^El \d+ % del trazado/);
  });
});
