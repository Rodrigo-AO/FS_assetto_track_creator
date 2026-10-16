import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeKn5, type Kn5Mesh } from '../src/export/ac/kn5';
import { heightAt, isVirtualAt, parseTerrain } from '../src/domain/presets/terrain';
import { loadCircuit, parseModelsIni, rasterizeGround, scanKn5, surfaceKeyOf } from './acCircuit';

/** Malla plana de un triángulo grande a la altura `h` (coordenadas de AC). */
function flat(h: number): Kn5Mesh {
  return {
    positions: new Float32Array([-50, h, 50, 50, h, 50, 0, h, -50]),
    normals: new Float32Array(9),
    uvs: new Float32Array(6),
    tangents: new Float32Array(9),
    indices: Uint16Array.from([0, 1, 2]),
    material: 0,
    castShadows: false,
    renderable: true,
  };
}

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('circuito de AC instalado', () => {
  it('reconoce la clave de superficie de una malla física', () => {
    const keys = ['ROAD', 'TRM-BRC', 'KERB', 'WALL'];
    expect(surfaceKeyOf('10TRM-BRC006', keys)).toBe('TRM-BRC');
    expect(surfaceKeyOf('1ROAD', keys)).toBe('ROAD');
    expect(surfaceKeyOf('Box053', keys)).toBeNull();
    expect(surfaceKeyOf('3SAND', keys)).toBeNull();
  });

  it('lee los modelos de models.ini e ignora los objetos dinámicos', () => {
    const ini = [
      '[MODEL_0]', 'FILE=1.kn5', 'POSITION=0,0,0', 'ROTATION=0,0,0', '',
      '[MODEL_1]', 'FILE=100.kn5', 'POSITION=270.3,-15.15,-45.8', 'ROTATION=213,0,0', '',
      '[DYNAMIC_OBJECT_0]', 'FILE=11.kn5', '',
    ].join('\r\n');
    expect(parseModelsIni(ini)).toEqual([
      { file: '1.kn5', position: '0,0,0', rotation: '0,0,0' },
      { file: '100.kn5', position: '270.3,-15.15,-45.8', rotation: '213,0,0' },
    ]);
  });

  it('aplica las matrices de los dummies a las mallas de suelo', () => {
    const lifted = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 2, 0, 1]; // +10 en X, +2 en Y
    const kn5 = writeKn5({
      textures: [],
      materials: [],
      root: {
        name: 'ROOT',
        children: [{ name: 'GROUP', matrix: lifted, children: [{ name: '1ROAD', mesh: flat(1), children: [] }, { name: 'Tree', mesh: flat(9), children: [] }] }],
      },
    });
    const scan = scanKn5(kn5, (n) => n === '1ROAD');
    expect(scan.names).toEqual(['ROOT', 'GROUP', '1ROAD', 'Tree']);
    expect(scan.groundTriangles.length).toBe(9);
    expect(scan.groundTriangles[0]).toBeCloseTo(-40);
    expect(scan.groundTriangles[1]).toBeCloseTo(3);
  });

  it('rasteriza el suelo tomando la superficie más alta y deja huecos sin dato', () => {
    // Plano del circuito: x = X, y = −Z, altura = Y.
    const tris = new Float32Array([0, 0, 1, 10, 0, 1, 0, 10, 1, 0, 0, 2, 4, 0, 2, 0, 4, 2]);
    const grid = parseTerrain(rasterizeGround(tris, { x0: -2, y0: -2, x1: 12, y1: 12, cell: 0.5 }));
    expect(heightAt(grid, { x: 1, y: 1 })).toBeCloseTo(2);
    expect(heightAt(grid, { x: 7, y: 1 })).toBeCloseTo(1);
    expect(heightAt(grid, { x: -1.5, y: -1.5 })).toBeNull();
  });

  it('sin malla física usa la superficie visual más baja y marca esos nodos como virtuales', () => {
    const physics = new Float32Array([0, 0, 1, 4, 0, 1, 0, 4, 1]);
    // Dos superficies visuales sobre (6, 6): un suelo a 0,5 y un tejado a 3.
    const visual = new Float32Array([0, 0, 0.5, 20, 0, 0.5, 0, 20, 0.5, 4, 4, 3, 12, 4, 3, 4, 12, 3]);
    const grid = parseTerrain(rasterizeGround(physics, { x0: 0, y0: 0, x1: 10, y1: 10, cell: 1 }, visual));
    expect(heightAt(grid, { x: 1, y: 1 })).toBeCloseTo(1); // manda la física
    expect(heightAt(grid, { x: 6, y: 6 })).toBeCloseTo(0.5); // el suelo, no el tejado
    expect(isVirtualAt(grid, { x: 1, y: 1 })).toBe(false);
    expect(isVirtualAt(grid, { x: 6, y: 6 })).toBe(true);
    // (25, 25) no tiene ninguna superficie: toma la del nodo con dato más cercano.
    const wide = parseTerrain(rasterizeGround(physics, { x0: 0, y0: 0, x1: 30, y1: 30, cell: 1 }, visual));
    expect(heightAt(wide, { x: 25, y: 25 })).toBeCloseTo(0.5);
    expect(isVirtualAt(wide, { x: 25, y: 25 })).toBe(true);
    // Sin superficies visuales no hay máscara.
    expect(rasterizeGround(physics, { x0: 0, y0: 0, x1: 10, y1: 10, cell: 1 }).virtual).toBeUndefined();
  });

  it('salta los kn5 con sus propios dummies de salida y extrae el suelo de los demás', () => {
    const tracks = mkdtempSync(join(tmpdir(), 'atc-circuit-'));
    dirs.push(tracks);
    const dir = join(tracks, 'ks_test');
    mkdirSync(join(dir, 'gp', 'data'), { recursive: true });
    const model = (file: string, i: number) => [`[MODEL_${i}]`, `FILE=${file}`, 'POSITION=0,0,0', 'ROTATION=0,0,0'].join('\r\n');
    writeFileSync(join(dir, 'models_gp.ini'), [model('track.kn5', 0), model('spawn.kn5', 1)].join('\r\n\r\n'));
    writeFileSync(join(dir, 'gp', 'data', 'surfaces.ini'), '[SURFACE_0]\r\nKEY=ASPH\r\n');
    const track = { name: 'R', children: [{ name: '1ASPH_0', mesh: flat(4), children: [] }, { name: '1WALL', mesh: flat(8), children: [] }] };
    writeFileSync(join(dir, 'track.kn5'), writeKn5({ textures: [], materials: [], root: track }));
    writeFileSync(join(dir, 'spawn.kn5'), writeKn5({ textures: [], materials: [], root: { name: 'R', children: [{ name: 'AC_START_0', children: [] }] } }));

    const circuit = loadCircuit(tracks, 'ks_test', 'gp')!;
    expect(circuit.models.map((m) => m.file)).toEqual(['track.kn5']);
    expect(circuit.skipped).toEqual(['spawn.kn5']);
    expect(circuit.surfacesIni).toContain('KEY=ASPH');
    const grid = parseTerrain(rasterizeGround(circuit.ground, { x0: -5, y0: -5, x1: 5, y1: 5, cell: 1 }));
    expect(heightAt(grid, { x: 0, y: 0 })).toBeCloseTo(4); // el muro no cuenta como suelo
    expect(loadCircuit(tracks, 'no_existe', 'gp')).toBeNull();
    expect(() => loadCircuit(tracks, '..', 'gp')).toThrow();
  });
});
