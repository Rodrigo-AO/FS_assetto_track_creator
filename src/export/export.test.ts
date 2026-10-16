import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ll, ovalProject } from '../test/fixtures';
import { encodeDds } from './binary/dds';
import { createImage } from './binary/image';
import { encodePng } from './binary/png';
import { buildTrackFiles, exportWarnings, PROJECT_FILE, trackIdFromName, validateForExport, zipTrackFiles } from './trackPackage';
import { buildScene } from '../domain/project/scene';

/** Lector mínimo de kn5 para comprobar la estructura escrita. */
function readKn5NodeNames(data: Uint8Array): string[] {
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
  const names: string[] = [];
  const node = (): void => {
    const cls = i32();
    names.push(str());
    const children = i32();
    p += 1;
    if (cls === 1) p += 64;
    else {
      p += 3;
      skip(44);
      skip(2);
      p += 16 + 16 + 1;
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
    for (const expected of ['1ROAD_TRACK_0', '1ROAD_BASE_0', '1GRAVEL_ZONES_0', '1WALL_CONES_0', '1WALL_LIMIT_0', 'CONES_BLUE_0',
      'CONES_YELLOW_0', 'AC_START_0', 'AC_PIT_3', 'AC_HOTLAP_START_0', 'AC_TIME_0_L', 'AC_TIME_0_R']) {
      expect(names).toContain(expected);
    }
    const ini = new TextDecoder().decode(files['data/surfaces.ini']);
    expect(ini).toContain('KEY=GRAVEL');
    expect(Object.keys(unzipSync(zipTrackFiles(files, 'atc_test')))).toContain('atc_test/atc_test.kn5');
  });
});
