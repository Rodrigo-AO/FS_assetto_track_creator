import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ll, ovalProject, rampTerrain } from '../test/fixtures';
import { encodeDds } from './binary/dds';
import { createImage } from './binary/image';
import { encodePng } from './binary/png';
import { parseTerrain } from '../domain/presets/terrain';
import { buildTrackFiles, exportWarnings, presetKn5Name, PROJECT_FILE, trackIdFromName, validateForExport, zipTrackFiles } from './trackPackage';
import { buildScene } from '../domain/project/scene';
import { boundingSphere, writeKn5, type Kn5Mesh } from './ac/kn5';

const readKn5NodeNames = (data: Uint8Array): string[] => readKn5Nodes(data).map((n) => n.name);

interface Kn5NodeInfo {
  name: string;
  matrix?: number[];
  /** Mallas: radio de la esfera envolvente y si se dibuja. */
  radius?: number;
  renderable?: boolean;
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
      skip(44);
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
