import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyPreset, clearPreset } from '../project/actions';
import { createEmptyProject } from '../project/types';
import { circuitPresetById, PRESETS, presetById } from './presets';
import { mergeSurfacesIni } from './circuit';
import { buildScene, projectionFor } from '../project/scene';
import { GeoreferencedProjection } from '../geo/projection';
import { rampTerrain } from '../../test/fixtures';
import { heightAt, parseTerrain, terrainRange } from './terrain';

describe('presets', () => {
  it('incluye los escenarios 3D y los circuitos de AC', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['isla_magica', 'etsi', 'montmelo', 'hockenheim']);
    expect(PRESETS.map((p) => p.kind)).toEqual(['scene', 'scene', 'circuit', 'circuit']);
    expect(circuitPresetById('montmelo')).toMatchObject({ acTrack: 'ks_barcelona', layout: 'layout_gp' });
    expect(circuitPresetById('hockenheim')?.requires.url).toContain('racedepartment');
    // El mod de Hockenheim va en el repositorio (Git LFS) para no tener que buscarlo.
    const bundled = circuitPresetById('hockenheim')!.requires.bundled!;
    expect(existsSync(fileURLToPath(new URL(`../../../${bundled}`, import.meta.url)))).toBe(true);
    expect(circuitPresetById('etsi')).toBeNull();
    expect(presetById('etsi')?.polygon).toHaveLength(11);
    expect(presetById('nada')).toBeNull();
  });

  it('aplicar un preset fija el área a su polígono y le da nombre', () => {
    const preset = presetById('isla_magica')!;
    const p = applyPreset(createEmptyProject(), preset);
    expect(p.preset).toBe('isla_magica');
    expect(p.area).toEqual(preset.polygon);
    expect(p.name).toBe('Parking Isla Mágica');
    expect(clearPreset(p).preset).toBeNull();
  });

  it('un circuito deja el área libre y trabaja en el plano georreferenciado del circuito', () => {
    const preset = circuitPresetById('montmelo')!;
    const p = applyPreset({ ...createEmptyProject(), area: presetById('etsi')!.polygon }, preset);
    expect(p.area).toBeNull();
    expect(projectionFor(p)).toBeInstanceOf(GeoreferencedProjection);
    // Un área dibujada sobre el circuito queda en coordenadas del modelo de AC.
    const projection = new GeoreferencedProjection(preset.georef);
    const square = [[-20, -20], [20, -20], [20, 20], [-20, 20]].map(([x, y]) => projection.toLatLng({ x, y }));
    const scene = buildScene({ ...p, area: square })!;
    expect(scene.area[0].x).toBeCloseTo(-20, 4);
    expect(scene.area[2].y).toBeCloseTo(20, 4);
  });

  it('la georreferencia de los circuitos es una semejanza casi sin escala', () => {
    for (const id of ['montmelo', 'hockenheim']) {
      const circuit = circuitPresetById(id)!;
      expect(Math.abs(circuit.georef.scale - 1)).toBeLessThan(0.01);
      expect(circuit.polygon.length).toBeGreaterThan(3);
    }
  });
});

describe('superficies de un circuito', () => {
  it('conserva las del circuito y añade las de la app que falten, renumeradas', () => {
    const circuit = ['[SURFACE_0]', 'KEY=TRM-BRC', 'FRICTION=0.99', '', '[SURFACE_1]', 'KEY=GRASS', 'FRICTION=0.6', ''].join('\r\n');
    const own = ['[SURFACE_0]', 'KEY=ROAD', '', '[SURFACE_1]', 'KEY=GRASS', 'FRICTION=0.5', '', '[SURFACE_2]', 'KEY=GRAVEL', ''].join('\n');
    const merged = mergeSurfacesIni(circuit, own);
    expect([...merged.matchAll(/KEY=(\S+)/g)].map((m) => m[1])).toEqual(['TRM-BRC', 'GRASS', 'ROAD', 'GRAVEL']);
    expect([...merged.matchAll(/\[SURFACE_(\d+)\]/g)].map((m) => m[1])).toEqual(['0', '1', '2', '3']);
    expect(merged).toContain('FRICTION=0.6'); // la del circuito manda
    expect(merged).not.toContain('FRICTION=0.5');
  });
});

describe('terreno de preset', () => {
  const grid = parseTerrain(rampTerrain());

  it('interpola bilinealmente entre nodos', () => {
    expect(heightAt(grid, { x: 12.5, y: 3 })!).toBeCloseTo(1.25, 2);
    expect(heightAt(grid, { x: -50, y: 50 })!).toBeCloseTo(-5, 2);
  });

  it('devuelve null fuera de la rejilla e ignora huecos sin dato', () => {
    expect(heightAt(grid, { x: 500, y: 0 })).toBeNull();
    expect(heightAt(grid, { x: -99, y: -99 })).not.toBeNull();
    expect(terrainRange(grid).max).toBeCloseTo(10, 2);
  });
});
