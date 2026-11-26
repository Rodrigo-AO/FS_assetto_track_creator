import { describe, expect, it } from 'vitest';
import { buildTrackFiles, exportWarnings, validateForExport } from '../../export/trackPackage';
import { gridPoses } from '../../export/ac/trackScene';
import { readKn5 } from '../../export/ac/kn5Reader';
import { openTrackZip } from '../../export/projectFile';
import { zipTrackFiles } from '../../export/trackPackage';
import { parseTerrain } from '../presets/terrain';
import { ll } from '../../test/fixtures';
import { distance, vec } from '../geometry/vec2';
import { pointInRing } from '../geometry/polygon';
import { buildScene } from '../project/scene';
import { createEmptyProject, type TrackProject } from '../project/types';
import { presetById } from '../presets/presets';
import { ACCELERATION, ACCELERATION_START_M } from './acceleration';
import { SKIDPAD, SKIDPAD_START_M } from './skidpad';
import { applyTrackPreset, applyTrackPresetAtHome, placer, presetFits, presetOutline, TRACK_PRESETS, trackPresetById } from './trackPresets';

const skidpad = trackPresetById('skidpad')!;
const at = (p: readonly [number, number]) => vec(p[0], p[1]);
const area = [ll(-60, -60), ll(60, -60), ll(60, 60), ll(-60, 60)];
const freeMap = (): TrackProject => ({ ...createEmptyProject(), area });

describe('skidpad (FS Rules 2026, D4.1)', () => {
  const centers = [vec(SKIDPAD.centerDistance / 2, 0), vec(-SKIDPAD.centerDistance / 2, 0)];

  it('17 conos por dentro de cada círculo interior y 13 por fuera de cada exterior', () => {
    expect(distance(centers[0], centers[1])).toBe(18.25);
    for (const c of centers) {
      // Conos de este círculo (los del otro lado del ocho quedan fuera).
      const d = skidpad.layout.cones.filter((k) => k.color !== 'orange' && k.p[0] * c.x > 0).map((k) => distance(at(k.p), c));
      const inner = d.filter((v) => v < SKIDPAD.innerDiameter / 2);
      expect(inner).toHaveLength(17);
      expect(Math.max(...inner)).toBeLessThan(15.25 / 2); // por dentro de la línea
      const outer = d.filter((v) => Math.abs(v - SKIDPAD.outerDiameter / 2) < 0.2);
      expect(outer).toHaveLength(13);
      expect(Math.min(...outer)).toBeGreaterThan(21.25 / 2); // por fuera
    }
    // Más las cuatro de las puertas de entrada y salida, a 3 m.
    const gates = skidpad.layout.cones.filter((c) => c.color === 'orange');
    expect(gates).toHaveLength(4);
    expect(skidpad.layout.cones).toHaveLength(2 * (17 + 13) + 4);
    expect(gates.every((c) => Math.abs(c.p[0]) > 1.5 && Math.abs(c.p[0]) < 1.7)).toBe(true);
  });

  it('los conos no invaden el carril de 3 m ni se duplican en el cruce', () => {
    const scene = buildScene(applyTrackPreset(freeMap(), skidpad, { center: area[0], rotationDeg: 0 }))!;
    for (const c of scene.cones) {
      const d = Math.min(...scene.track!.samples.map((m) => distance(m.position, c.position)));
      expect(d).toBeGreaterThan(1.5);
    }
    const cones = skidpad.layout.cones;
    cones.forEach((a, i) => cones.slice(i + 1).forEach((b) => expect(distance(at(a.p), at(b.p))).toBeGreaterThan(0.6)));
  });

  it('el recorrido es entrada, círculo derecho, círculo izquierdo y salida, y cada círculo mide π·18,25', () => {
    const { length } = presetOutline(skidpad.layout);
    expect(length).toBeCloseTo(44 + 27 + 2 * Math.PI * 18.25, 0);
    const scene = buildScene(applyTrackPreset(freeMap(), skidpad, { center: area[0], rotationDeg: 0 }))!;
    const s = scene.track!.samples;
    const far = s.reduce((best, m) => (m.position.x > best.position.x ? m : best));
    const left = s.reduce((best, m) => (m.position.x < best.position.x ? m : best));
    expect(far.s).toBeLessThan(left.s); // primero la derecha
    expect(s[s.length - 1].position.y - s[0].position.y).toBeCloseTo(71, 0);
  });

  it('marca los círculos con líneas y la parrilla sale en la recta de entrada, a 15 m', () => {
    const p = applyTrackPreset(freeMap(), skidpad, { center: ll(0, 0), rotationDeg: 0 });
    expect(p.markings.length).toBe(8);
    const scene = buildScene(p)!;
    const [first, second] = gridPoses(scene, scene.startFinish!, 2, p.track.startOffset);
    expect(p.track.startOffset).toBe(SKIDPAD_START_M);
    expect(first.position.x).toBeCloseTo(0, 1);
    expect(first.position.y).toBeCloseTo(-15, 0);
    expect(second.position.y).toBeCloseTo(-23, 0);
    expect(first.forward.y).toBeGreaterThan(0.99); // entra perpendicular al ocho
  });

  it('girado y exportado: líneas pintadas, conos y sin errores', () => {
    const p = applyTrackPreset(freeMap(), skidpad, { center: ll(0, 5), rotationDeg: 90 });
    const scene = buildScene(p)!;
    expect(validateForExport(p, scene)).toEqual([]);
    const gate = scene.startFinish!;
    expect(Math.abs(gate.left.x - gate.right.x)).toBeLessThan(0.01); // la línea gira con el preset
    const files = buildTrackFiles(p, { trackId: 'atc_sk', perimeterWalls: false, satellite: null });
    const names = readKn5(files['atc_sk.kn5']).root.children.map((n) => n.name);
    expect(names).toContain('LINE_MARKINGS_0');
    // «Editar circuito» lo recupera con sus líneas.
    const opened = openTrackZip(zipTrackFiles(files, 'atc_sk'));
    expect(opened.ok && opened.project.markings).toEqual(p.markings);
  });
});

describe('acceleration (FS Rules 2026, D5.1)', () => {
  const acceleration = trackPresetById('acceleration')!;
  const longArea = [ll(-30, -80), ll(30, -80), ll(30, 130), ll(-30, 130)];
  const place = (rotationDeg = 0): TrackProject => applyTrackPreset({ ...createEmptyProject(), area: longArea }, acceleration, { center: ll(0, 0), rotationDeg });

  it('recta de 75 m entre salida y meta, 3 m de ancho y conos cada 5 m', () => {
    const scene = buildScene(place())!;
    const start = scene.startFinish!;
    const [finish] = scene.sectors;
    expect(distance(start.left, finish.gate.left)).toBeCloseTo(ACCELERATION.length, 1);
    expect(distance(start.left, start.right)).toBeCloseTo(3, 3);
    expect(Math.min(...scene.track!.samples.map((m) => m.widthLeft + m.widthRight))).toBeCloseTo(ACCELERATION.width, 3);
    const side = acceleration.layout.cones.filter((c) => c.color === 'blue').map((c) => c.p[1]);
    expect(side).toHaveLength(14);
    side.slice(1).forEach((y, i) => expect(y - side[i]).toBeCloseTo(ACCELERATION.coneSpacing, 5));
    expect(acceleration.layout.cones.filter((c) => c.color === 'orangeBig')).toHaveLength(4);
    // Ningún cono invade el carril.
    for (const c of scene.cones) expect(Math.abs(c.position.x)).toBeGreaterThan(1.5);
  });

  it('el coche sale con el morro 0,30 m antes de la línea y la meta es el primer sector', () => {
    const p = place();
    const scene = buildScene(p)!;
    const [first] = gridPoses(scene, scene.startFinish!, 1, p.track.startOffset);
    expect(p.track.startOffset).toBe(ACCELERATION_START_M);
    expect(scene.startFinish!.left.y - first.position.y).toBeCloseTo(ACCELERATION_START_M, 1);
    expect(first.forward.y).toBeGreaterThan(0.99);
    expect(p.sectors).toHaveLength(1);
    expect(exportWarnings(p, scene).filter((w) => /sector|salida|área/i.test(w))).toEqual([]);
  });

  it('girado y exportado: salida, meta y conos giran con el preset', () => {
    const p = place(90);
    const scene = buildScene(p)!;
    expect(validateForExport(p, scene)).toEqual([]);
    expect(Math.abs(scene.sectors[0].gate.left.x - scene.sectors[0].gate.right.x)).toBeLessThan(0.01); // la meta gira con el preset
    const files = buildTrackFiles(p, { trackId: 'atc_acc', perimeterWalls: false, satellite: null });
    const names = readKn5(files['atc_acc.kn5']).root.children.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['AC_TIME_0_L', 'AC_TIME_1_L', 'AC_TIME_1_R', 'AC_START_0', 'LINE_MARKINGS_0']));
    expect(presetFits(acceleration.layout, { center: ll(0, 0), rotationDeg: 0 }, longArea)).toBe(true);
    expect(presetFits(acceleration.layout, { center: ll(0, 0), rotationDeg: 0 }, area)).toBe(false);
  });
});

describe('Track presets de AutoX', () => {
  it('incluye skidpad, acceleration y los tres circuitos de Notion', () => {
    expect(TRACK_PRESETS.map((t) => t.name)).toEqual(['Skidpad', 'Acceleration', 'Jerez Parking', 'Jerez Neumáticos', 'Isla Mágica Pruebas de Piloto']);
    expect(TRACK_PRESETS.map((t) => t.home?.presetId ?? null)).toEqual([null, null, 'parking_jerez', 'karting_jerez', 'isla_magica']);
  });

  for (const t of TRACK_PRESETS.filter((q) => q.home)) {
    it(`«${t.name}» se carga en su preset de mapa, entero dentro del área`, () => {
      const p = applyTrackPresetAtHome(createEmptyProject(), t);
      const site = presetById(t.home!.presetId)!;
      expect(p.preset).toBe(site.id);
      expect(p.area).toEqual(site.polygon);
      expect(p.name).toBe(t.name);
      expect(presetFits(t.layout, { center: t.home!.origin, rotationDeg: 0 }, site.polygon)).toBe(true);
      const scene = buildScene(p)!;
      expect(validateForExport(p, scene)).toEqual([]);
      expect(scene.track!.closed).toBe(true);
      expect(scene.track!.samples.every((m) => pointInRing(m.position, scene.area))).toBe(true);
      expect(exportWarnings(p, scene).filter((w) => /trazado|salida/i.test(w))).toEqual([]);
      // Curva suave: entre muestras consecutivas (0,5 m) no hay giros imposibles.
      const s = scene.track!.samples;
      const turn = s.map((m, i) => Math.acos(Math.min(1, m.tangent.x * s[(i + 1) % s.length].tangent.x + m.tangent.y * s[(i + 1) % s.length].tangent.y)));
      expect(Math.max(...turn)).toBeLessThan(0.35);
      // Ancho siempre transitable y ningún cono duplicado.
      expect(Math.min(...s.map((m) => m.widthLeft + m.widthRight))).toBeGreaterThan(3);
      scene.cones.forEach((a, i) => scene.cones.slice(i + 1).forEach((b) => expect(distance(a.position, b.position)).toBeGreaterThan(0.8)));
    });
  }

  it('los de Jerez son los retocados por Rodrigo en la app, con sus conos', () => {
    const count = (id: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const c of trackPresetById(id)!.layout.cones) out[c.color] = (out[c.color] ?? 0) + 1;
      return out;
    };
    expect(count('jerez_parking')).toEqual({ orange: 370 });
    expect(count('jerez_neumaticos')).toEqual({ orange: 55, blue: 125, yellow: 132 });
  });

  it('conserva los anchos asimétricos: al editarlos no se igualan los dos lados', () => {
    const load = (id: string): TrackProject => applyTrackPresetAtHome(createEmptyProject(), trackPresetById(id)!);
    expect(load('jerez_parking').track.symmetric).toBe(true);
    const { track } = load('jerez_neumaticos');
    expect(track.symmetric).toBe(false);
    expect(track.anchors.some((a) => a.widthLeft !== a.widthRight)).toBe(true);
  });

  it('exporta sobre su escenario con los conos apoyados en el suelo inclinado', () => {
    const t = trackPresetById('jerez_neumaticos')!;
    const p = applyTrackPresetAtHome(createEmptyProject(), t);
    const grid = { x0: -300, y0: -300, cell: 10, nx: 61, ny: 61 };
    const heights = new Int16Array(61 * 61);
    for (let j = 0; j < 61; j++) for (let i = 0; i < 61; i++) heights[j * 61 + i] = Math.round((-300 + i * 10) * 2.45);
    const terrain = parseTerrain({ ...grid, heights: Buffer.from(heights.buffer).toString('base64') });
    const files = buildTrackFiles(p, { trackId: 'atc_n', perimeterWalls: false, satellite: null, preset: { id: 'karting_jerez', kn5: new Uint8Array([1]), terrain, attribution: [] } });
    expect(Object.keys(files)).toContain('models.ini');
  });
});

describe('colocación', () => {
  it('gira alrededor de su origen y comprueba si cabe', () => {
    const p = placer({ center: ll(10, 20), rotationDeg: 90 })([5, 0]);
    expect(p.lat).toBeCloseTo(ll(10, 25).lat, 7);
    expect(p.lng).toBeCloseTo(ll(10, 25).lng, 7);
    expect(presetFits(skidpad.layout, { center: ll(0, 0), rotationDeg: 0 }, area)).toBe(true);
    expect(presetFits(skidpad.layout, { center: ll(50, 0), rotationDeg: 0 }, area)).toBe(false);
  });

  it('el nombre puesto por la app cambia con el preset; el del usuario se respeta', () => {
    const [parking, neumaticos] = TRACK_PRESETS.filter((t) => t.home?.presetId.includes('jerez'));
    const p = applyTrackPresetAtHome(applyTrackPresetAtHome(createEmptyProject(), parking), neumaticos);
    expect(p.name).toBe('Jerez Neumáticos');
    expect(p.preset).toBe('karting_jerez');
    expect(applyTrackPresetAtHome({ ...p, name: 'Entreno 3' }, parking).name).toBe('Entreno 3');
  });

  it('sustituye trazado, conos y líneas, y conserva el resto del proyecto', () => {
    const before: TrackProject = { ...freeMap(), name: 'Mi pista', baseSurface: 'grass', sectors: [{ id: 's', left: ll(0, 0), right: ll(1, 0) }], cones: [{ id: 'c', position: ll(1, 1), color: 'blue' }] };
    const p = applyTrackPreset(before, skidpad, { center: ll(0, 0), rotationDeg: 0 });
    expect(p.name).toBe('Mi pista');
    expect(p.baseSurface).toBe('grass');
    expect(p.sectors).toEqual([]);
    expect(p.cones).toHaveLength(64);
    expect(p.track.autoCones).toBe(false);
    expect(buildScene(p)!.autoCones).toEqual([]);
  });
});
