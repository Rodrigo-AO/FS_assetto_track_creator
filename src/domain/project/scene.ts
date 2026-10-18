import { GeoreferencedProjection, LocalProjection, type Projection } from '../geo/projection';
import { circuitPresetById } from '../presets/presets';
import type { Vec2 } from '../geometry/vec2';
import { generateEdgeCones, type PlacedCone } from '../track/autoCones';
import { buildTrackGeometry, type LocalAnchor, type TrackGeometry } from '../track/centerline';
import { alignGateToTrack, orderSectors, type LocalGate } from '../track/gates';
import type { Gate, TrackAnchor, TrackProject } from './types';
import type { LocalDirtStroke } from '../dirt/dirt';
import type { LocalReliefStroke } from '../relief/relief';

export interface SceneSector {
  readonly id: string;
  readonly gate: LocalGate;
}

/**
 * Vista geométrica del proyecto en metros locales. Es la fuente única que usan tanto el
 * mapa (para dibujar) como el exportador, de modo que lo que se ve es lo que se exporta.
 */
export interface Scene {
  readonly projection: Projection;
  readonly area: readonly Vec2[];
  readonly track: TrackGeometry | null;
  readonly cones: readonly PlacedCone[];
  /** Trazos del Brush en el plano local. */
  readonly dirt: readonly LocalDirtStroke[];
  /** Trazos del Desnivelador en el plano local. */
  readonly relief: readonly LocalReliefStroke[];
  readonly autoCones: readonly PlacedCone[];
  /** Líneas orientadas en el sentido de la pista (si existe). */
  readonly startFinish: LocalGate | null;
  /** Sectores ordenados por su posición en pista desde la salida/meta. */
  readonly sectors: readonly SceneSector[];
}

export function toLocalGate(projection: Projection, g: Gate): LocalGate {
  return { left: projection.toLocal(g.left), right: projection.toLocal(g.right) };
}

export function toLocalAnchor(projection: Projection, a: TrackAnchor): LocalAnchor {
  return {
    position: projection.toLocal(a.position),
    handleIn: a.handleIn && projection.toLocal(a.handleIn),
    handleOut: a.handleOut && projection.toLocal(a.handleOut),
    widthLeft: a.widthLeft,
    widthRight: a.widthRight,
  };
}

/**
 * Plano local del proyecto. Sobre un circuito de AC es el del propio circuito (georreferenciado);
 * si no, el plano tangente centrado en el área.
 */
export function projectionFor(project: Pick<TrackProject, 'area' | 'preset'>): Projection {
  const circuit = circuitPresetById(project.preset);
  if (circuit) return new GeoreferencedProjection(circuit.georef);
  return LocalProjection.centeredOn(project.area ?? []);
}

export function buildScene(project: TrackProject): Scene | null {
  if (!project.area || project.area.length < 3) return null;
  const projection = projectionFor(project);
  const track = buildTrackGeometry(
    project.track.anchors.map((a) => toLocalAnchor(projection, a)),
    project.track.closed,
  );
  const localGate = (g: Gate): LocalGate => alignGateToTrack(track, toLocalGate(projection, g));
  const startFinish = project.startFinish && localGate(project.startFinish);
  const sectors = project.sectors.map((g) => ({ id: g.id, gate: localGate(g) }));
  const autoCones = track && project.track.autoCones ? generateEdgeCones(track, project.track.coneSpacing, startFinish) : [];
  return {
    projection,
    area: project.area.map((p) => projection.toLocal(p)),
    track,
    cones: project.cones.map((c) => ({ position: projection.toLocal(c.position), color: c.color })),
    relief: (project.relief ?? []).map((r) => ({ direction: r.direction, radius: r.radius, points: r.points.map((p) => projection.toLocal(p)) })),
    dirt: (project.dirt ?? []).map((d) => ({ material: d.material, radius: d.radius, points: d.points.map((p) => projection.toLocal(p)) })),
    autoCones,
    startFinish,
    sectors: orderSectors(track, startFinish, sectors, (s) => s.gate),
  };
}
