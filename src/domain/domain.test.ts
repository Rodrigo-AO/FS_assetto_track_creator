import { describe, expect, it } from 'vitest';
import { anchor, ll, ovalProject } from '../test/fixtures';
import { LocalProjection } from './geo/projection';
import { multiPolygonArea } from './geometry/polygon';
import { resample, simplify } from './geometry/polyline';
import { distance, vec } from './geometry/vec2';
import { buildScene } from './project/scene';
import { generateEdgeCones } from './track/autoCones';
import { buildTrackGeometry, type LocalAnchor } from './track/centerline';
import { gateForward, snapGateToTrack } from './track/gates';
import { layoutSurfaces } from '../export/ac/surfaceLayout';

const local = (x: number, y: number, wl = 1.5, wr = 1.5): LocalAnchor => ({ position: vec(x, y), handleIn: null, handleOut: null, widthLeft: wl, widthRight: wr });

describe('proyección local', () => {
  it('ida y vuelta conserva la posición y 1 m ≈ 1 m', () => {
    const p = new LocalProjection({ lat: 37.4, lng: -6 });
    const back = p.toLocal(p.toLatLng(vec(123.4, -56.7)));
    expect(back.x).toBeCloseTo(123.4, 6);
    expect(back.y).toBeCloseTo(-56.7, 6);
  });
});

describe('polilíneas', () => {
  it('remuestrea a paso constante', () => {
    const pts = resample([vec(0, 0), vec(10, 0)], 2.5, false);
    expect(pts.map((p) => p.x)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('simplifica una línea recta a sus extremos', () => {
    const line = Array.from({ length: 50 }, (_, i) => vec(i, 0.001 * Math.sin(i)));
    expect(simplify(line, 0.05)).toHaveLength(2);
  });
});

describe('eje de la pista', () => {
  it('recta de 100 m hacia el norte: longitud, bordes a 1.5 m y azul a la izquierda (oeste)', () => {
    const g = buildTrackGeometry([local(0, 0), local(0, 100)], false)!;
    expect(g.length).toBeCloseTo(100, 1);
    expect(g.leftEdge[10].x).toBeCloseTo(-1.5, 5);
    expect(g.rightEdge[10].x).toBeCloseTo(1.5, 5);
  });

  it('interpola anchos asimétricos entre nodos', () => {
    const g = buildTrackGeometry([local(0, 0, 1, 1), local(0, 100, 3, 1)], false)!;
    const mid = g.samples[Math.floor(g.samples.length / 2)];
    expect(mid.widthLeft).toBeGreaterThan(1.8);
    expect(mid.widthLeft).toBeLessThan(2.2);
    expect(mid.widthRight).toBeCloseTo(1, 5);
  });

  it('un circuito cerrado vuelve al inicio', () => {
    const g = buildTrackGeometry([local(0, 0), local(50, 0), local(50, 50), local(0, 50)], true)!;
    expect(g.closed).toBe(true);
    expect(distance(g.samples[0].position, g.samples[g.samples.length - 1].position)).toBeLessThan(1);
    expect(g.length).toBeGreaterThan(150);
  });
});

describe('conos automáticos', () => {
  it('cada 5 m en cada lateral: azules a la izquierda, amarillos a la derecha', () => {
    const g = buildTrackGeometry([local(0, 0), local(0, 100)], false)!;
    const cones = generateEdgeCones(g, 5, null);
    const blue = cones.filter((c) => c.color === 'blue');
    const yellow = cones.filter((c) => c.color === 'yellow');
    expect(blue).toHaveLength(21);
    expect(yellow).toHaveLength(21);
    expect(blue.every((c) => c.position.x < 0)).toBe(true);
    expect(yellow.every((c) => c.position.x > 0)).toBe(true);
    expect(distance(blue[1].position, blue[2].position)).toBeCloseTo(5, 5);
  });

  it('marca la salida/meta con conos naranjas grandes', () => {
    const g = buildTrackGeometry([local(0, 0), local(0, 100)], false)!;
    const gate = snapGateToTrack(g, vec(0, 50))!;
    const cones = generateEdgeCones(g, 5, gate);
    expect(cones.filter((c) => c.color === 'orangeBig')).toHaveLength(4);
  });
});

describe('líneas de cronometraje', () => {
  it('se ajustan perpendiculares a la pista y miran en el sentido de la marcha', () => {
    const g = buildTrackGeometry([local(0, 0), local(0, 100)], false)!;
    const gate = snapGateToTrack(g, vec(3, 40))!;
    expect(gate.left.x).toBeLessThan(0);
    expect(gateForward(gate).y).toBeCloseTo(1, 5);
    expect(snapGateToTrack(g, vec(80, 40))).toBeNull();
  });
});

describe('escena y superficies', () => {
  it('la escena del óvalo tiene pista cerrada, conos y salida/meta', () => {
    const scene = buildScene(ovalProject())!;
    expect(scene.track?.closed).toBe(true);
    expect(scene.autoCones.length).toBeGreaterThan(40);
    expect(scene.startFinish).not.toBeNull();
  });

  it('las capas de superficie cubren el área sin solaparse', () => {
    const project = ovalProject();
    const scene = buildScene(project)!;
    const layers = layoutSurfaces(project, scene);
    const total = layers.reduce((s, l) => s + multiPolygonArea(l.area), 0);
    expect(total).toBeCloseTo(200 * 200, -1);
    expect(layers.map((l) => l.role).sort()).toEqual(['base', 'track', 'zones']);
  });

  it('orienta una salida/meta dibujada al revés según el sentido de la pista', () => {
    // En el óvalo de prueba el lado oeste se recorre hacia el sur; la línea se dibujó mirando al norte.
    const scene = buildScene(ovalProject())!;
    expect(gateForward(scene.startFinish!).y).toBeLessThan(-0.9);
  });

  it('sin área no hay escena', () => {
    expect(buildScene({ ...ovalProject(), area: null })).toBeNull();
  });

  it('el ancho por defecto de un nodo es 3 m simétrico', () => {
    const a = anchor('x', vec(0, 0));
    expect(a.widthLeft + a.widthRight).toBe(3);
    expect(ll(0, 0).lat).toBeCloseTo(37.4, 9);
  });
});
