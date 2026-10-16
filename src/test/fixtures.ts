import { LocalProjection, type LatLng } from '../domain/geo/projection';
import { vec, type Vec2 } from '../domain/geometry/vec2';
import type { TerrainJson } from '../domain/presets/terrain';
import { createEmptyProject, type TrackAnchor, type TrackProject } from '../domain/project/types';

/** Origen de referencia de los tests (Sevilla). */
export const ORIGIN: LatLng = { lat: 37.4, lng: -6.0 };
const projection = new LocalProjection(ORIGIN);

export const ll = (x: number, y: number): LatLng => projection.toLatLng(vec(x, y));

export function anchor(id: string, p: Vec2, width = 3): TrackAnchor {
  return { id, position: ll(p.x, p.y), handleIn: null, handleOut: null, widthLeft: width / 2, widthRight: width / 2 };
}

/** Rejilla de terreno sintética: h = 0,1·x (rampa del 10 % hacia el este), en cm. */
export function rampTerrain(): TerrainJson {
  const nx = 41;
  const ny = 41;
  const heights = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = Math.round((-100 + i * 5) * 0.1 * 100);
  heights[0] = -32768; // un hueco sin dato
  const bytes = new Uint8Array(heights.buffer);
  return { x0: -100, y0: -100, cell: 5, nx, ny, heights: btoa(String.fromCharCode(...bytes)) };
}

/** Área cuadrada de 200 m centrada en el origen con un óvalo de unos 60×120 m. */
export function ovalProject(): TrackProject {
  const base = createEmptyProject();
  const ring = [vec(0, -60), vec(30, -40), vec(30, 40), vec(0, 60), vec(-30, 40), vec(-30, -40)];
  return {
    ...base,
    name: 'Óvalo de prueba',
    area: [ll(-100, -100), ll(100, -100), ll(100, 100), ll(-100, 100)],
    track: { ...base.track, anchors: ring.map((p, i) => anchor(`a${i}`, p)) },
    startFinish: { id: 'sf', left: ll(-34, 0), right: ll(-26, 0) },
    cones: [{ id: 'c1', position: ll(60, 60), color: 'orange' }],
    zones: [{ id: 'z1', type: 'gravel', polygon: [ll(40, -20), ll(70, -20), ll(70, 20), ll(40, 20)] }],
  };
}
