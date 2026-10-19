import { describe, expect, it } from 'vitest';
import { anchor, ll, ovalProject } from '../test/fixtures';
import { GeoreferencedProjection, LocalProjection } from './geo/projection';
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

  it('georreferenciada: ida y vuelta, y aplica escala, giro y desplazamiento', () => {
    const origin = { lat: 41.57, lng: 2.26 };
    const g = new GeoreferencedProjection({ origin, scale: 1.01, rotationDeg: 30, offset: [-200, 50] });
    const back = g.toLocal(g.toLatLng(vec(310.5, -42.25)));
    expect(back.x).toBeCloseTo(310.5, 5);
    expect(back.y).toBeCloseTo(-42.25, 5);
    // El origen del circuito cae en `offset` metros (este, norte) del origen geográfico.
    const tangent = new LocalProjection(origin);
    const zero = tangent.toLocal(g.toLatLng(vec(0, 0)));
    expect(zero.x).toBeCloseTo(-200, 5);
    expect(zero.y).toBeCloseTo(50, 5);
    // 100 m hacia +x del circuito → 101 m girados 30° en el plano este-norte.
    const east = tangent.toLocal(g.toLatLng(vec(100, 0)));
    expect(east.x - zero.x).toBeCloseTo(101 * Math.cos(Math.PI / 6), 4);
    expect(east.y - zero.y).toBeCloseTo(101 * Math.sin(Math.PI / 6), 4);
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

describe('ancho de pista', () => {
  it('el ancho elegido antes de trazar se aplica al primer punto y a los siguientes', async () => {
    const { appendAnchors, appendBezierAnchor, clearTrack, setTrackWidth, trackWidth } = await import('./project/actions');
    const { createEmptyProject } = await import('./project/types');
    const area = [ll(-50, -50), ll(50, -50), ll(50, 50), ll(-50, 50)];
    let p = setTrackWidth({ ...createEmptyProject(), area }, 7.5);
    expect(trackWidth(p)).toBe(7.5);
    p = appendAnchors(p, [ll(0, 0), ll(10, 0)]);
    expect(p.track.anchors.map((a) => a.widthLeft + a.widthRight)).toEqual([7.5, 7.5]);
    // Bézier también, y al borrar el trazado se conserva para el próximo.
    const bezier = appendBezierAnchor(setTrackWidth({ ...createEmptyProject(), area }, 5), ll(0, 0), ll(5, 0));
    expect(bezier.track.anchors[0].widthLeft + bezier.track.anchors[0].widthRight).toBe(5);
    expect(trackWidth(clearTrack(p))).toBe(7.5);
    // Proyectos antiguos sin el campo: 3 m.
    const { width: _w, ...oldTrack } = createEmptyProject().track;
    expect(trackWidth({ ...createEmptyProject(), track: oldTrack })).toBe(3);
  });
});
