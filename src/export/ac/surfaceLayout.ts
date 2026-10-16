import { difference, intersection, union, type MultiPolygon, type Polygon } from '../../domain/geometry/polygon';
import { resampleWeighted } from '../../domain/geometry/polyline';
import { add, scale, sub, type Vec2 } from '../../domain/geometry/vec2';
import type { Scene } from '../../domain/project/scene';
import type { SurfaceType, TrackProject } from '../../domain/project/types';
import type { TrackGeometry } from '../../domain/track/centerline';

/** Paso con el que se trocea la cinta de la pista para la malla (m). */
const RIBBON_STEP_M = 1;

export interface SurfaceLayer {
  readonly type: SurfaceType;
  readonly role: 'base' | 'zones' | 'track';
  readonly area: MultiPolygon;
}

/**
 * Cinta de asfalto como unión de cuadriláteros entre muestras consecutivas. La unión resuelve
 * los solapes de las curvas cerradas, donde el borde interior se pliega sobre sí mismo.
 */
export function trackRibbon(track: TrackGeometry): MultiPolygon {
  const pts = resampleWeighted(
    track.samples.map((m) => ({ position: m.position, values: [m.normal.x, m.normal.y, m.widthLeft, m.widthRight] })),
    RIBBON_STEP_M,
    track.closed,
  );
  const left = pts.map((p) => add(p.position, scale({ x: p.values[0], y: p.values[1] }, p.values[2])));
  const right = pts.map((p) => sub(p.position, scale({ x: p.values[0], y: p.values[1] }, p.values[3])));
  const count = track.closed ? pts.length : pts.length - 1;
  const triangles: Polygon[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % pts.length;
    triangles.push([[left[i], left[j], right[i]]], [[left[j], right[j], right[i]]]);
  }
  return union(triangles.filter((t) => Math.abs(cross3(t[0])) > 1e-6));
}

function cross3([a, b, c]: readonly Vec2[]): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Reparte el área en capas de superficie sin solapes (la física de AC lanza rayos hacia abajo
 * y dos mallas coplanarias darían un resultado indefinido). Prioridad: pista > zonas
 * (la última dibujada gana) > suelo base.
 */
export function layoutSurfaces(project: TrackProject, scene: Scene): SurfaceLayer[] {
  const area: MultiPolygon = [[scene.area]];
  const track = scene.track ? intersection(trackRibbon(scene.track), area) : [];
  const layers: SurfaceLayer[] = [];
  if (track.length) layers.push({ type: 'asphalt', role: 'track', area: track });

  let covered = track;
  const zonesByType = new Map<SurfaceType, MultiPolygon[]>();
  for (const zone of [...project.zones].reverse()) {
    const local: MultiPolygon = [[zone.polygon.map((p) => scene.projection.toLocal(p))]];
    const visible = difference(intersection(local, area), covered);
    if (!visible.length) continue;
    zonesByType.set(zone.type, [...(zonesByType.get(zone.type) ?? []), visible]);
    covered = covered.length ? union([...covered, ...visible]) : visible;
  }
  for (const [type, parts] of zonesByType) layers.push({ type, role: 'zones', area: parts.flat() });

  const base = difference(area, covered);
  if (base.length) layers.push({ type: project.baseSurface, role: 'base', area: base });
  return layers;
}
