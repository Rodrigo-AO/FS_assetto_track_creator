import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ll, ovalProject, rampTerrain } from '../test/fixtures';
import { encodeDds } from './binary/dds';
import { createImage } from './binary/image';
import { encodePng } from './binary/png';
import { parseTerrain } from '../domain/presets/terrain';
import { buildTrackFiles, exportWarnings, presetKn5Name, PROJECT_FILE, trackIdFromName, validateForExport, zipTrackFiles } from './trackPackage';
import { buildScene } from '../domain/project/scene';
import { readFileSync } from 'node:fs';
import { boundingSphere, writeKn5, type Kn5Mesh, type Kn5Node } from './ac/kn5';
import { readKn5 } from './ac/kn5Reader';
import { buildTrackModel } from './ac/trackScene';

const flattenNodes = (node: Kn5Node): Kn5Node[] => [node, ...node.children.flatMap(flattenNodes)];

/** Escenario mínimo como los de la tubería de presets: suelo de 200 m con textura y un muro. */
function fakeSceneKn5(): Uint8Array {
  const corners = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
  const ground: Kn5Mesh = {
    positions: Float32Array.from(corners.flatMap(([x, z]) => [x, 0, z])),
    normals: Float32Array.from(corners.flatMap(() => [0, 1, 0])),
    uvs: Float32Array.from(corners.flatMap(([x, z]) => [(x + 100) / 200, (z + 100) / 200])),
    tangents: Float32Array.from(corners.flatMap(() => [1, 0, 0])),
    indices: Uint16Array.from([0, 2, 1, 0, 3, 2]),
    material: 0, castShadows: false, renderable: true,
  };
  const wall: Kn5Mesh = {
    positions: Float32Array.from([50, 0, 50, 60, 0, 50, 60, 2, 50]),
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array(6), tangents: new Float32Array(9),
    indices: Uint16Array.from([0, 1, 2]), material: 0, castShadows: true, renderable: true,
  };
  return writeKn5({
    textures: [{ name: 'parking.dds', data: new Uint8Array([1, 2, 3, 4]) }],
    materials: [{ name: 'ATC_PARKING', shader: 'ksPerPixel', properties: [{ name: 'ksDiffuse', a: 0.4 }], textures: [['txDiffuse', 0, 'parking.dds']] }],
    root: { name: 'ATC_SCENE', children: [
      { name: '1ROAD_PARKING_0', mesh: ground, children: [] },
      { name: '1WALL_BASE_0', mesh: wall, children: [] },
    ] },
  });
}

const readKn5NodeNames = (data: Uint8Array): string[] => readKn5Nodes(data).map((n) => n.name);

interface Kn5NodeInfo {
  name: string;
  matrix?: number[];
  /** Mallas: radio de la esfera envolvente y si se dibuja. */
  radius?: number;
  renderable?: boolean;
  /** Mallas: altura (Y de AC) mínima y máxima de sus vértices. */
  minY?: number;
  maxY?: number;
}

/** Lector mínimo de kn5 para comprobar la estructura escrita (nombres, matrices de dummies y esferas). */
function readKn5Nodes(data: Uint8Array): Kn5NodeInfo[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dec = new TextDecoder();
  let p = 6;
  const i32 = (): number => {
    const v = view.getInt32(p, true);
    p += 4;
    return v;
  };
  const str = (): string => {
    const n = i32();
    const s = dec.decode(data.subarray(p, p + n));
    p += n;
    return s;
  };
  // Ojo: `p += i32()` leería `p` antes de que i32() lo avance.
  const skip = (bytesPerItem: number): void => {
    const n = i32();
    p += n * bytesPerItem;
  };
  expect(dec.decode(data.subarray(0, 6))).toBe('sc6969');
  expect(i32()).toBe(5);
  for (let t = i32(); t > 0; t--) {
    i32();
    str();
    skip(1);
  }
  for (let m = i32(); m > 0; m--) {
    str();
    str();
    p += 6;
    for (let k = i32(); k > 0; k--) {
      str();
      p += 40;
    }
    for (let k = i32(); k > 0; k--) {
      str();
      i32();
      str();
    }
  }
  const names: Kn5NodeInfo[] = [];
  const node = (): void => {
    const cls = i32();
    const entry: Kn5NodeInfo = { name: str() };
    names.push(entry);
    const children = i32();
    p += 1;
    if (cls === 1) {
      entry.matrix = Array.from({ length: 16 }, (_, k) => view.getFloat32(p + k * 4, true));
      p += 64;
    } else {
      p += 3;
      const count = i32();
      entry.minY = Infinity;
      entry.maxY = -Infinity;
      for (let k = 0; k < count; k++) {
        const y = view.getFloat32(p + k * 44 + 4, true);
        entry.minY = Math.min(entry.minY, y);
        entry.maxY = Math.max(entry.maxY, y);
      }
      p += count * 44;
      skip(2);
      p += 16 + 12;
      entry.radius = view.getFloat32(p, true);
      entry.renderable = data[p + 4] === 1;
      p += 5;
    }
    for (let c = 0; c < children; c++) node();
  };
  node();
  expect(p).toBe(data.length);
  return names;
}

describe('formatos binarios', () => {
  it('PNG con firma y cabecera correctas', () => {
    const png = encodePng(createImage(3, 2, [255, 0, 0, 255]));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('kn5: una malla invisible no comparte esfera envolvente con una visible idéntica', () => {
    // Con la misma esfera, AC dejaba de dibujar los conos azules (su hitbox ocupa lo mismo).
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]);
    const mesh = (renderable: boolean): Kn5Mesh => ({
      positions, normals: new Float32Array(9), uvs: new Float32Array(6), tangents: new Float32Array(9),
      indices: Uint16Array.from([0, 1, 2]), material: 0, castShadows: false, renderable,
    });
    const kn5 = writeKn5({
      textures: [], materials: [],
      root: { name: 'ROOT', children: [{ name: 'VISIBLE', mesh: mesh(true), children: [] }, { name: 'HIDDEN', mesh: mesh(false), children: [] }] },
    });
    const [, visible, hidden] = readKn5Nodes(kn5);
    expect(visible.radius).toBeCloseTo(boundingSphere(positions).radius, 5);
    expect(hidden.radius! - visible.radius!).toBeGreaterThanOrEqual(0.5);
  });

  it('DDS con cabecera de 128 bytes y mipmaps completos', () => {
    const dds = encodeDds(createImage(4, 4, [1, 2, 3, 4]));
    // 4x4 + 2x2 + 1x1 píxeles de 4 bytes
    expect(dds.length).toBe(128 + (16 + 4 + 1) * 4);
    expect(new DataView(dds.buffer).getUint32(28, true)).toBe(3);
  });
});

describe('exportación a Assetto Corsa', () => {
  it('genera un id de carpeta válido', () => {
    expect(trackIdFromName('Circuito Ñandú 2026!')).toBe('atc_circuito_nandu_2026');
    expect(trackIdFromName('***')).toBe('atc_circuito');
  });

  it('avisa si la salida/meta no está sobre el trazado', () => {
    const project = ovalProject();
    const onTrack = exportWarnings(project, buildScene(project)!);
    expect(onTrack.some((w) => w.includes('salida/meta'))).toBe(false);
    const moved = { ...project, startFinish: { id: 'sf', left: ll(60, 0), right: ll(64, 0) } };
    expect(exportWarnings(moved, buildScene(moved)!).some((w) => w.includes('salida/meta'))).toBe(true);
  });

  it('exige área y salida/meta', () => {
    const project = { ...ovalProject(), startFinish: null };
    expect(validateForExport(project, buildScene(project))).toHaveLength(1);
    expect(validateForExport(project, null)).toHaveLength(1);
  });

  it('produce una pista completa con mallas físicas y dummies de AC', () => {
    const files = buildTrackFiles({ ...ovalProject(), conesCollidable: true }, { trackId: 'atc_test', perimeterWalls: true, satellite: null });
    expect(Object.keys(files).sort()).toEqual(
      ['atc_test.kn5', 'data/map.ini', 'data/surfaces.ini', 'map.png', PROJECT_FILE, 'ui/outline.png', 'ui/preview.png', 'ui/ui_track.json'].sort(),
    );
    const names = readKn5NodeNames(files['atc_test.kn5']);
    for (const expected of ['1ROAD_TRACK_0', '1ROAD_BASE_0', '1GRAVEL_ZONES_0', '1WALL_CONES_0', '1WALL_LIMIT_0', 'CONES_BLUE_0_0',
      'CONES_YELLOW_0_0', 'AC_START_0', 'AC_PIT_3', 'AC_HOTLAP_START_0', 'AC_TIME_0_L', 'AC_TIME_0_R']) {
      expect(names).toContain(expected);
    }
    const ini = new TextDecoder().decode(files['data/surfaces.ini']);
    expect(ini).toContain('KEY=GRAVEL');
    expect(readKn5Nodes(files['atc_test.kn5']).find((n) => n.name === '1WALL_CONES_0')!.renderable).toBe(false);
    // Conos troceados en mallas pequeñas (casillas de 25 m): ninguna abarca todo el circuito.
    const coneMeshes = readKn5Nodes(files['atc_test.kn5']).filter((n) => n.name.startsWith('CONES_'));
    expect(coneMeshes.filter((n) => n.name.startsWith('CONES_BLUE_')).length).toBeGreaterThan(1);
    expect(Math.max(...coneMeshes.map((n) => n.radius!))).toBeLessThan(20);
    expect(Object.keys(unzipSync(zipTrackFiles(files, 'atc_test')))).toContain('atc_test/atc_test.kn5');
  });

  it('Desnivelador en mapa libre: el suelo propio sube y baja, y los conos lo siguen', () => {
    // Óvalo: recta este en x = 30. Tres pasadas subiendo allí (7,5 cm cada una) y quince bajando en la oeste.
    const up = (id: string) => ({ id, direction: 'raise' as const, radius: 3, points: [ll(30, -20), ll(30, 20)] });
    const down = (id: string) => ({ id, direction: 'lower' as const, radius: 3, points: [ll(-30, -20), ll(-30, 20)] });
    const relief = [up('a'), up('b'), up('c'), ...Array.from({ length: 15 }, (_, i) => down(`d${i}`))];
    const files = buildTrackFiles({ ...ovalProject(), relief }, { trackId: 'atc_test', perimeterWalls: false, satellite: null });
    const nodes = readKn5Nodes(files['atc_test.kn5']);
    const ground = nodes.filter((n) => /^1ROAD_(BASE|TRACK)_/.test(n.name));
    expect(Math.max(...ground.map((n) => n.maxY!))).toBeCloseTo(0.225, 1);
    expect(Math.min(...ground.map((n) => n.minY!))).toBeCloseTo(-1, 1); // nunca más de un metro
    const cones = nodes.filter((n) => n.name.startsWith('CONES_'));
    expect(Math.min(...cones.map((n) => n.minY!))).toBeLessThan(-0.25); // en el borde de la pista, lejos del eje
    expect(nodes.some((n) => n.name.includes('_RELIEF'))).toBe(false);
  });

  it('Desnivelador sobre un escenario 3D: deforma su suelo hacia arriba y hacia abajo, con su textura', () => {
    // Tres pasadas subiendo en la recta este (x = 30) y tres bajando en la oeste (x = −30).
    const pass = (id: string, direction: 'raise' | 'lower', x: number) => ({ id, direction, radius: 3, points: [ll(x, -20), ll(x, 20)] });
    const relief = [pass('u1', 'raise', 30), pass('u2', 'raise', 30), pass('u3', 'raise', 30), pass('d1', 'lower', -30), pass('d2', 'lower', -30), pass('d3', 'lower', -30)];
    const project = { ...ovalProject(), preset: 'etsi', relief };
    const scenery = fakeSceneKn5();
    const flat = parseTerrain({ ...rampTerrain(), heights: Buffer.from(new Int16Array(41 * 41).buffer).toString('base64') });
    const files = buildTrackFiles(project, {
      trackId: 'atc_test', perimeterWalls: false, satellite: null,
      preset: { id: 'etsi', kn5: scenery, terrain: flat, attribution: [] },
    });
    const deformed = readKn5(files[presetKn5Name('etsi')]);
    const nodes = flattenNodes(deformed.root);
    const ground = nodes.filter((n) => n.name.startsWith('1ROAD_PARKING') && n.mesh);
    expect(ground.length).toBeGreaterThan(0);
    const ys = ground.flatMap((n) => [...n.mesh!.positions].filter((_, i) => i % 3 === 1));
    expect(Math.max(...ys)).toBeCloseTo(0.225, 1);
    expect(Math.min(...ys)).toBeCloseTo(-0.225, 1);
    // La textura del escenario sigue igual: UV interpoladas del triángulo original.
    for (const n of ground) {
      const m = n.mesh!;
      for (let v = 0; v < m.positions.length / 3; v += 97) {
        expect(m.uvs[v * 2]).toBeCloseTo((m.positions[v * 3] + 100) / 200, 4);
        expect(m.uvs[v * 2 + 1]).toBeCloseTo((m.positions[v * 3 + 2] + 100) / 200, 4);
      }
    }
    // Lo que no es suelo no se toca, y se conservan texturas y materiales.
    const wall = nodes.find((n) => n.name === '1WALL_BASE_0')!;
    expect([...wall.mesh!.positions]).toEqual([...flattenNodes(readKn5(scenery).root).find((n) => n.name === '1WALL_BASE_0')!.mesh!.positions]);
    expect(deformed.textures.map((t) => t.name)).toEqual(['parking.dds']);
    expect(deformed.materials[0].textures).toEqual([['txDiffuse', 0, 'parking.dds']]);
    // La pista sigue el suelo nuevo y no lleva parche; sin aviso de lo que baja.
    const track = readKn5Nodes(files['atc_test.kn5']);
    expect(track.some((n) => n.name.includes('_RELIEF'))).toBe(false);
    expect(Math.min(...track.filter((n) => n.name.startsWith('CONES_')).map((n) => n.minY!))).toBeLessThan(-0.05);
    expect(exportWarnings(project, buildScene(project)!).some((w) => w.includes('Desnivelador'))).toBe(false);
  });

  it('Desnivelador sobre un circuito de AC: solo sube, con un parche, y avisa de lo que baja', () => {
    const relief = [
      { id: 'u', direction: 'raise' as const, radius: 3, points: [ll(30, -20), ll(30, 20)] },
      { id: 'd', direction: 'lower' as const, radius: 3, points: [ll(-30, -20), ll(-30, 20)] },
    ];
    const project = { ...ovalProject(), preset: 'montmelo', relief };
    const scene = buildScene(project)!;
    const model = buildTrackModel(project, scene, { pitCount: 1, perimeterWalls: false, satellite: null, environment: { ground: () => 0, zones: false } });
    const patch = flattenNodes(model.root).filter((n) => n.name.startsWith('1ROAD_RELIEF') && n.mesh);
    expect(patch.length).toBeGreaterThan(0);
    const ys = patch.flatMap((n) => [...n.mesh!.positions].filter((_, i) => i % 3 === 1));
    expect(Math.min(...ys)).toBeGreaterThan(0); // nunca por debajo del suelo
    expect(Math.max(...ys)).toBeCloseTo(0.075, 1);
    expect(exportWarnings(project, scene).some((w) => w.includes('Desnivelador'))).toBe(true);
  });

  it('lee un kn5 y lo vuelve a escribir igual (escenario de Isla Mágica)', () => {
    // Sin toEqual: comparar 26 MB en el informe de error agota la memoria. Solo pueden cambiar
    // los últimos bits del radio de alguna esfera envolvente, que se recalcula al escribir.
    const changedBytes = (x: Uint8Array, y: Uint8Array): number => {
      let n = Math.abs(x.length - y.length);
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++;
      return n;
    };
    const data = new Uint8Array(readFileSync('public/presets/isla_magica/isla_magica.kn5'));
    expect(changedBytes(writeKn5(readKn5(data)), data)).toBeLessThan(8);
    const small = fakeSceneKn5();
    expect(changedBytes(writeKn5(readKn5(small)), small)).toBe(0);
  });

  it('Brush: calca visual y superficies físicas con menos agarre según las pasadas', () => {
    // Una pasada de arena a lo largo de la recta este y tres de grava superpuestas en la oeste.
    const sand = { id: 's', material: 'sand' as const, radius: 1.5, points: [ll(30, -20), ll(30, 20)] };
    const gravel = (id: string) => ({ id, material: 'gravel' as const, radius: 1.5, points: [ll(-30, -20), ll(-30, 20)] });
    const files = buildTrackFiles({ ...ovalProject(), dirt: [sand, gravel('g1'), gravel('g2'), gravel('g3')] }, { trackId: 'atc_test', perimeterWalls: false, satellite: null });
    const nodes = readKn5Nodes(files['atc_test.kn5']);
    const names = nodes.map((n) => n.name);
    // Una pasada: solo el nivel ligero; tres: aparece el medio en el centro del trazo.
    expect(names).toContain('1DIRTSA1_0');
    expect(names).not.toContain('1DIRTSA2_0');
    expect(names).toContain('1DIRTGV2_0');
    expect(nodes.filter((n) => /^1DIRT/.test(n.name)).every((n) => n.renderable === false)).toBe(true);
    expect(nodes.filter((n) => n.name.startsWith('DIRT_')).every((n) => n.renderable === true)).toBe(true);
    expect(names.some((n) => n.startsWith('DIRT_SAND_'))).toBe(true);
    const ini = new TextDecoder().decode(files['data/surfaces.ini']);
    for (const key of ['DIRTSA1', 'DIRTSA3', 'DIRTGV1', 'DIRTGV3']) expect(ini).toContain(`KEY=${key}`);
  });

  it('cada malla física contiene una sola clave de superficie (AC las busca como subcadena)', () => {
    // Con «ATCSAND1», AC encontraba también SAND y daba la malla por ambigua («CAN BE: ATCSAND1 SAND»).
    const sand = { id: 's', material: 'sand' as const, radius: 1.5, points: [ll(30, -20), ll(30, 20)] };
    const gravel = { id: 'g', material: 'gravel' as const, radius: 1.5, points: [ll(-30, -20), ll(-30, 20)] };
    const relief = [{ id: 'r', direction: 'raise' as const, radius: 3, points: [ll(0, 40), ll(0, 60)] }];
    const files = buildTrackFiles(
      { ...ovalProject(), conesCollidable: true, dirt: [sand, sand, sand, sand, gravel, gravel, gravel, gravel], relief },
      { trackId: 'atc_test', perimeterWalls: true, satellite: null },
    );
    const ini = new TextDecoder().decode(files['data/surfaces.ini']);
    const keys = [...[...ini.matchAll(/KEY=(\S+)/g)].map((m) => m[1]), 'ROAD', 'GRASS', 'KERB', 'SAND', 'WALL'];
    const physics = readKn5NodeNames(files['atc_test.kn5']).filter((n) => /^\d/.test(n));
    expect(physics.length).toBeGreaterThan(5);
    for (const name of physics) expect([name, [...new Set(keys.filter((k) => name.includes(k)))]]).toEqual([name, [expect.any(String)]]);
  });

  it('sobre un circuito: carga sus kn5 instalados con rutas relativas, después de la capa de la app', () => {
    const files = buildTrackFiles(ovalProject(), {
      trackId: 'atc_test',
      perimeterWalls: false,
      satellite: null,
      circuit: {
        acTrack: 'ks_barcelona',
        models: [
          { file: '1.kn5', position: '0,0,0', rotation: '0,0,0' },
          { file: '100.kn5', position: '270.3,-15.15,-45.8', rotation: '213,0,0' },
        ],
        surfacesIni: ['[SURFACE_0]', 'KEY=TRM-BRC', 'FRICTION=0.99', ''].join('\r\n'),
        terrain: parseTerrain(rampTerrain()),
        requirement: 'Requiere el circuito «Barcelona».',
      },
    });
    const models = new TextDecoder().decode(files['models.ini']);
    expect([...models.matchAll(/FILE=(.+)/g)].map((m) => m[1].trim())).toEqual(['atc_test.kn5', '../ks_barcelona/1.kn5', '../ks_barcelona/100.kn5']);
    expect(models).toContain('POSITION=270.3,-15.15,-45.8');
    expect(models).toContain('ROTATION=213,0,0');
    expect(Object.keys(files).some((f) => f.startsWith('preset_'))).toBe(false);
    const surfaces = new TextDecoder().decode(files['data/surfaces.ini']);
    expect(surfaces.indexOf('KEY=TRM-BRC')).toBeLessThan(surfaces.indexOf('KEY=ROAD'));
    expect(new TextDecoder().decode(files['ui/ui_track.json'])).toContain('Barcelona');
    // Ningún suelo propio (ni base, ni pista, ni las zonas dibujadas): solo conos, líneas y dummies.
    const names = readKn5NodeNames(files['atc_test.kn5']);
    expect(names.some((n) => /^1(ROAD|GRASS|GRAVEL)_/.test(n))).toBe(false);
    expect(names).toContain('CONES_BLUE_0_0');
    expect(names).toContain('AC_START_0');
  });

  it('con preset: incluye el escenario, models.ini y apoya los elementos en el relieve', () => {
    const terrain = parseTerrain(rampTerrain());
    const presetKn5 = new Uint8Array([1, 2, 3]);
    const files = buildTrackFiles(
      { ...ovalProject(), preset: 'etsi' },
      { trackId: 'atc_test', perimeterWalls: true, satellite: null, preset: { id: 'etsi', kn5: presetKn5, terrain, attribution: ['CC-BY 4.0 scne.es'] } },
    );
    expect(files[presetKn5Name('etsi')]).toBe(presetKn5);
    const models = new TextDecoder().decode(files['models.ini']);
    expect(models).toContain('FILE=preset_etsi.kn5');
    expect(models).toContain('FILE=atc_test.kn5');
    const nodes = readKn5Nodes(files['atc_test.kn5']);
    const names = nodes.map((n) => n.name);
    expect(names.some((n) => n.startsWith('1ROAD_BASE') || n.startsWith('1ROAD_TRACK'))).toBe(false);
    expect(names).toContain('1GRAVEL_ZONES_0');
    // AC_TIME_0_L en x = −34 (o −26 tras orientar la línea): rampa h = 0,1·x → y = h + 0,2
    const left = nodes.find((n) => n.name === 'AC_TIME_0_L')!.matrix!;
    expect(left[13]).toBeCloseTo(left[12] * 0.1 + 0.2, 1);
    expect(new TextDecoder().decode(files['ui/ui_track.json'])).toContain('scne.es');
  });
});
