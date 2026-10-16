import { distance, dot, lerp, sub, type Vec2 } from './vec2';

/** Punto de una polilínea con datos interpolables asociados (p. ej. anchos de pista). */
export interface WeightedPoint {
  readonly position: Vec2;
  readonly values: readonly number[];
}

function lerpValues(a: readonly number[], b: readonly number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/**
 * Remuestrea una polilínea a intervalos constantes de longitud de arco.
 * En polilíneas cerradas el último punto no repite el primero.
 */
export function resampleWeighted(points: readonly WeightedPoint[], step: number, closed: boolean): WeightedPoint[] {
  if (points.length < 2) return [...points];
  const path = closed ? [...points, points[0]] : points;
  const out: WeightedPoint[] = [path[0]];
  let carried = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = distance(a.position, b.position);
    let d = step - carried;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ position: lerp(a.position, b.position, t), values: lerpValues(a.values, b.values, t) });
      d += step;
    }
    carried = segLen - (d - step);
  }
  const last = path[path.length - 1];
  if (closed) {
    if (out.length > 1 && distance(out[out.length - 1].position, path[0].position) < step * 0.5) out.pop();
  } else if (distance(out[out.length - 1].position, last.position) > step * 0.25) {
    out.push(last);
  }
  return out;
}

export function resample(points: readonly Vec2[], step: number, closed: boolean): Vec2[] {
  return resampleWeighted(points.map((position) => ({ position, values: [] })), step, closed).map((p) => p.position);
}

export function polylineLength(points: readonly Vec2[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  if (closed && points.length > 2) total += distance(points[points.length - 1], points[0]);
  return total;
}

export interface NearestPoint {
  /** Índice del primer vértice del segmento más cercano. */
  readonly index: number;
  readonly point: Vec2;
  readonly distance: number;
}

export function nearestOnPolyline(points: readonly Vec2[], p: Vec2, closed: boolean): NearestPoint | null {
  let best: NearestPoint | null = null;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
    const q = lerp(a, b, t);
    const d = distance(p, q);
    if (!best || d < best.distance) best = { index: i, point: q, distance: d };
  }
  return best;
}

/** Simplificación Ramer–Douglas–Peucker (para el trazado a mano alzada). */
export function simplify(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first];
    const ab = sub(points[last], a);
    const len = Math.hypot(ab.x, ab.y);
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const ap = sub(points[i], a);
      const d = len > 0 ? Math.abs(ab.x * ap.y - ab.y * ap.x) / len : Math.hypot(ap.x, ap.y);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
