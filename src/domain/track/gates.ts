import { add, distance, dot, normalize, scale, sub, vec, type Vec2 } from '../geometry/vec2';
import { nearestSampleIndex, type TrackGeometry } from './centerline';

/** Línea de cronometraje en metros locales. */
export interface LocalGate {
  readonly left: Vec2;
  readonly right: Vec2;
}

/** Margen que sobresale la línea a cada lado del borde de pista (m). */
export const GATE_MARGIN_M = 1;
/** Distancia máxima al eje para que un clic se ajuste a la pista (m). */
export const SNAP_DISTANCE_M = 15;

export const gateCenter = (g: LocalGate): Vec2 => scale(add(g.left, g.right), 0.5);

/** Sentido de la marcha: giro antihorario de 90° del vector izquierda→derecha. */
export function gateForward(g: LocalGate): Vec2 {
  const r = sub(g.right, g.left);
  return normalize(vec(-r.y, r.x));
}

/** Línea perpendicular a la pista en la muestra más cercana al punto, o null si está lejos. */
export function snapGateToTrack(geometry: TrackGeometry, p: Vec2): LocalGate | null {
  const i = nearestSampleIndex(geometry.samples, p);
  const m = geometry.samples[i];
  if (distance(m.position, p) > SNAP_DISTANCE_M + Math.max(m.widthLeft, m.widthRight)) return null;
  return {
    left: add(m.position, scale(m.normal, m.widthLeft + GATE_MARGIN_M)),
    right: sub(m.position, scale(m.normal, m.widthRight + GATE_MARGIN_M)),
  };
}

/** Intercambia izquierda y derecha si la línea mira en sentido contrario a la pista. */
export function alignGateToTrack(geometry: TrackGeometry | null, g: LocalGate): LocalGate {
  if (!geometry) return g;
  const m = geometry.samples[nearestSampleIndex(geometry.samples, gateCenter(g))];
  return dot(gateForward(g), m.tangent) < 0 ? { left: g.right, right: g.left } : g;
}

/** Distancia a lo largo de la pista del centro de una línea. */
export function gateTrackPosition(geometry: TrackGeometry, g: LocalGate): number {
  return geometry.samples[nearestSampleIndex(geometry.samples, gateCenter(g))].s;
}

/**
 * Ordena los sectores según su distancia por pista desde la salida/meta.
 * Sin pista, se respeta el orden de creación.
 */
export function orderSectors<T>(geometry: TrackGeometry | null, startFinish: LocalGate | null, sectors: readonly T[], toLocal: (g: T) => LocalGate): T[] {
  if (!geometry || !startFinish) return [...sectors];
  const s0 = gateTrackPosition(geometry, startFinish);
  const offset = (g: T): number => {
    const ds = gateTrackPosition(geometry, toLocal(g)) - s0;
    return geometry.closed ? ((ds % geometry.length) + geometry.length) % geometry.length : ds;
  };
  return [...sectors].sort((a, b) => offset(a) - offset(b));
}
