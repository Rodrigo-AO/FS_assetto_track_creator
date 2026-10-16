import { resample } from '../geometry/polyline';
import { add, distance, scale, sub, type Vec2 } from '../geometry/vec2';
import type { ConeColor } from '../project/types';
import type { TrackGeometry } from './centerline';
import { gateForward, type LocalGate } from './gates';

export interface PlacedCone {
  readonly position: Vec2;
  readonly color: ConeColor;
}

/** Medio paso entre los dos conos naranjas que marcan cada extremo de la línea (m). */
const TIMING_CONE_HALF_GAP_M = 0.6;

/** Descarta conos demasiado juntos (aparecen en curvas cerradas donde el borde interior se pliega). */
function dropCrowded(points: readonly Vec2[], minDistance: number): Vec2[] {
  const kept: Vec2[] = [];
  for (const p of points) {
    if (kept.every((q) => distance(p, q) >= minDistance)) kept.push(p);
  }
  return kept;
}

/** Dos conos naranjas grandes en cada extremo de la línea de salida/meta, como en Formula Student. */
function timingCones(gate: LocalGate): PlacedCone[] {
  const offset = scale(gateForward(gate), TIMING_CONE_HALF_GAP_M);
  return [gate.left, gate.right].flatMap((end) => [
    { position: add(end, offset), color: 'orangeBig' as const },
    { position: sub(end, offset), color: 'orangeBig' as const },
  ]);
}

/**
 * Conos a lo largo de los bordes: azules a la izquierda y amarillos a la derecha,
 * separados `spacing` metros medidos sobre cada borde.
 */
export function generateEdgeCones(geometry: TrackGeometry, spacing: number, startFinish: LocalGate | null): PlacedCone[] {
  const timing = startFinish ? timingCones(startFinish) : [];
  const nearTiming = (p: Vec2): boolean => timing.some((c) => distance(c.position, p) < 1.5);
  const edge = (points: readonly Vec2[], color: ConeColor): PlacedCone[] =>
    dropCrowded(resample(points, spacing, geometry.closed), spacing * 0.5)
      .filter((p) => !nearTiming(p))
      .map((position) => ({ position, color }));
  return [...edge(geometry.leftEdge, 'blue'), ...edge(geometry.rightEdge, 'yellow'), ...timing];
}
