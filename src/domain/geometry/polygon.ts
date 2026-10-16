import earcut from 'earcut';
import polygonClipping, { type MultiPolygon as ClipMultiPolygon, type Polygon as ClipPolygon } from 'polygon-clipping';
import { vec, type Vec2 } from './vec2';

/** Anillo abierto (el último vértice no repite el primero). */
export type Ring = readonly Vec2[];
/** Polígono con agujeros: el primer anillo es el exterior. */
export type Polygon = readonly Ring[];
export type MultiPolygon = readonly Polygon[];

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function multiPolygonArea(mp: MultiPolygon): number {
  return mp.reduce((sum, poly) => sum + poly.reduce((s, ring, i) => s + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0), 0);
}

export function pointInRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// --------------------------------------------------------------------------- operaciones booleanas

const toClipRing = (ring: Ring): [number, number][] => ring.map((p) => [p.x, p.y]);
const toClip = (poly: Polygon): ClipPolygon => poly.map(toClipRing);

function fromClip(mp: ClipMultiPolygon): MultiPolygon {
  return mp.map((poly) =>
    poly.map((ring) => {
      const pts = ring.map(([x, y]) => vec(x, y));
      const closedTwice = pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y;
      return closedTwice ? pts.slice(0, -1) : pts;
    }),
  );
}

const toClipMulti = (mp: MultiPolygon): ClipMultiPolygon => mp.map(toClip);

export function union(polygons: MultiPolygon): MultiPolygon {
  if (polygons.length === 0) return [];
  const [first, ...rest] = polygons.map(toClip);
  return fromClip(polygonClipping.union(first, ...rest));
}

export function intersection(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  if (a.length === 0 || b.length === 0) return [];
  return fromClip(polygonClipping.intersection(toClipMulti(a), toClipMulti(b)));
}

export function difference(subject: MultiPolygon, ...clips: MultiPolygon[]): MultiPolygon {
  const nonEmpty = clips.filter((c) => c.length > 0).map(toClipMulti);
  if (subject.length === 0) return [];
  if (nonEmpty.length === 0) return subject;
  return fromClip(polygonClipping.difference(toClipMulti(subject), ...nonEmpty));
}

// --------------------------------------------------------------------------- triangulación

export interface Triangulation {
  readonly vertices: Vec2[];
  /** Tríos de índices sobre `vertices`. */
  readonly indices: number[];
}

export function triangulate(mp: MultiPolygon): Triangulation {
  const vertices: Vec2[] = [];
  const indices: number[] = [];
  for (const poly of mp) {
    const flat: number[] = [];
    const holes: number[] = [];
    poly.forEach((ring, i) => {
      if (i > 0) holes.push(flat.length / 2);
      for (const p of ring) flat.push(p.x, p.y);
    });
    const base = vertices.length;
    for (let i = 0; i < flat.length; i += 2) vertices.push(vec(flat[i], flat[i + 1]));
    for (const idx of earcut(flat, holes, 2)) indices.push(base + idx);
  }
  return { vertices, indices };
}
