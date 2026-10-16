import { resampleWeighted, type WeightedPoint } from '../geometry/polyline';
import { add, distance, leftNormal, normalize, scale, sub, vec, type Vec2 } from '../geometry/vec2';

/** Nodo del trazado ya proyectado a metros. */
export interface LocalAnchor {
  readonly position: Vec2;
  readonly handleIn: Vec2 | null;
  readonly handleOut: Vec2 | null;
  readonly widthLeft: number;
  readonly widthRight: number;
}

export interface CenterlineSample {
  readonly position: Vec2;
  readonly tangent: Vec2;
  /** Normal unitaria hacia la izquierda del sentido de la marcha. */
  readonly normal: Vec2;
  /** Distancia recorrida desde el primer nodo (m). */
  readonly s: number;
  readonly widthLeft: number;
  readonly widthRight: number;
}

export interface TrackGeometry {
  readonly closed: boolean;
  readonly length: number;
  readonly samples: readonly CenterlineSample[];
  readonly leftEdge: readonly Vec2[];
  readonly rightEdge: readonly Vec2[];
  /** Índice de la muestra más cercana a cada nodo. */
  readonly anchorSamples: readonly number[];
}

export const SAMPLE_STEP_M = 0.5;
const DENSE_STEP_M = 0.1;

interface BezierSegment {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
  readonly from: LocalAnchor;
  readonly to: LocalAnchor;
}

/** Manejadores Catmull-Rom para los nodos sin manejadores explícitos. */
function resolveHandles(anchors: readonly LocalAnchor[], closed: boolean): Array<{ in: Vec2; out: Vec2 }> {
  const n = anchors.length;
  return anchors.map((a, i) => {
    if (a.handleIn && a.handleOut) return { in: a.handleIn, out: a.handleOut };
    const prev = i > 0 ? anchors[i - 1].position : closed ? anchors[n - 1].position : null;
    const next = i < n - 1 ? anchors[i + 1].position : closed ? anchors[0].position : null;
    const tangent =
      prev && next ? scale(sub(next, prev), 1 / 6) : next ? scale(sub(next, a.position), 1 / 3) : prev ? scale(sub(a.position, prev), 1 / 3) : vec(0, 0);
    return { in: a.handleIn ?? sub(a.position, tangent), out: a.handleOut ?? add(a.position, tangent) };
  });
}

function bezierSegments(anchors: readonly LocalAnchor[], closed: boolean): BezierSegment[] {
  const handles = resolveHandles(anchors, closed);
  const count = closed ? anchors.length : anchors.length - 1;
  const segments: BezierSegment[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % anchors.length;
    segments.push({ p0: anchors[i].position, p1: handles[i].out, p2: handles[j].in, p3: anchors[j].position, from: anchors[i], to: anchors[j] });
  }
  return segments;
}

function cubic(seg: BezierSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return vec(
    a * seg.p0.x + b * seg.p1.x + c * seg.p2.x + d * seg.p3.x,
    a * seg.p0.y + b * seg.p1.y + c * seg.p2.y + d * seg.p3.y,
  );
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

function denseSamples(segments: readonly BezierSegment[]): WeightedPoint[] {
  const out: WeightedPoint[] = [];
  segments.forEach((seg, k) => {
    const approxLen = distance(seg.p0, seg.p1) + distance(seg.p1, seg.p2) + distance(seg.p2, seg.p3);
    const n = Math.max(4, Math.ceil(approxLen / DENSE_STEP_M));
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const t = i / n;
      const w = smoothstep(t);
      out.push({
        position: cubic(seg, t),
        values: [seg.from.widthLeft + (seg.to.widthLeft - seg.from.widthLeft) * w, seg.from.widthRight + (seg.to.widthRight - seg.from.widthRight) * w],
      });
    }
  });
  return out;
}

/** Eje de la pista muestreado cada `step` metros, con sus bordes izquierdo y derecho. */
export function buildTrackGeometry(anchors: readonly LocalAnchor[], closed: boolean, step = SAMPLE_STEP_M): TrackGeometry | null {
  const isClosed = closed && anchors.length >= 3;
  if (anchors.length < 2) return null;
  const dense = denseSamples(bezierSegments(anchors, isClosed));
  if (isClosed) dense.pop(); // el último punto denso coincide con el primero
  const pts = resampleWeighted(dense, step, isClosed);
  if (pts.length < 2) return null;

  const n = pts.length;
  let s = 0;
  const samples: CenterlineSample[] = pts.map((p, i) => {
    const prev = i > 0 ? pts[i - 1].position : isClosed ? pts[n - 1].position : p.position;
    const next = i < n - 1 ? pts[i + 1].position : isClosed ? pts[0].position : p.position;
    if (i > 0) s += distance(pts[i - 1].position, p.position);
    const tangent = normalize(sub(next, prev));
    return { position: p.position, tangent, normal: leftNormal(tangent), s, widthLeft: p.values[0], widthRight: p.values[1] };
  });
  const length = isClosed ? s + distance(pts[n - 1].position, pts[0].position) : s;

  return {
    closed: isClosed,
    length,
    samples,
    leftEdge: samples.map((m) => add(m.position, scale(m.normal, m.widthLeft))),
    rightEdge: samples.map((m) => sub(m.position, scale(m.normal, m.widthRight))),
    anchorSamples: anchors.map((a) => nearestSampleIndex(samples, a.position)),
  };
}

export function nearestSampleIndex(samples: readonly CenterlineSample[], p: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  samples.forEach((m, i) => {
    const d = distance(m.position, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Muestra situada a una distancia `s` del inicio (con vuelta en circuitos cerrados). */
export function sampleAt(geometry: TrackGeometry, s: number): CenterlineSample {
  const { samples, length, closed } = geometry;
  const target = closed ? ((s % length) + length) % length : Math.min(Math.max(s, 0), length);
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].s <= target) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo];
}
