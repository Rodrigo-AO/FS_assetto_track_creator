/**
 * Operaciones puras sobre el proyecto (proyecto → proyecto nuevo). La UI solo las encadena;
 * así toda la lógica de edición es testeable sin navegador.
 */
import type { LatLng, Projection } from '../geo/projection';
import { add, scale, sub, type Vec2 } from '../geometry/vec2';
import type { PresetSite } from '../presets/presets';
import { projectionFor } from './scene';
import {
  createEmptyProject,
  DEFAULT_TRACK_WIDTH,
  type ConeColor,
  type DirtMaterial,
  type ReliefDirection,
  type Gate,
  type SurfaceType,
  type TrackAnchor,
  type TrackLayout,
  type TrackProject,
} from './types';

export const newId = (): string => crypto.randomUUID();

const MIN_HALF_WIDTH_M = 0.5;
const MAX_HALF_WIDTH_M = 15;
const clampHalfWidth = (w: number): number => Math.min(MAX_HALF_WIDTH_M, Math.max(MIN_HALF_WIDTH_M, w));

const withTrack = (p: TrackProject, track: Partial<TrackLayout>): TrackProject => ({ ...p, track: { ...p.track, ...track } });

const mapAnchor = (p: TrackProject, id: string, f: (a: TrackAnchor) => TrackAnchor): TrackProject =>
  withTrack(p, { anchors: p.track.anchors.map((a) => (a.id === id ? f(a) : a)) });

function projectionOf(p: TrackProject): Projection {
  return projectionFor(p);
}

// --------------------------------------------------------------------------- general

export const setName = (p: TrackProject, name: string): TrackProject => ({ ...p, name });

export const setArea = (p: TrackProject, area: readonly LatLng[]): TrackProject => ({ ...p, area });

/**
 * Escenario: fija el área a su polígono (el modelo 3D está hecho exactamente ahí).
 * Circuito de AC: el área se delimita después sobre el circuito; se descarta la anterior.
 */
export function applyPreset(p: TrackProject, preset: PresetSite): TrackProject {
  const name = p.name === createEmptyProject().name ? preset.name : p.name;
  return { ...p, name, preset: preset.id, area: preset.kind === 'scene' ? preset.polygon : null };
}

/** Vuelve al mapa libre conservando el área como editable. */
export const clearPreset = (p: TrackProject): TrackProject => ({ ...p, preset: null });

export function moveAreaVertex(p: TrackProject, index: number, position: LatLng): TrackProject {
  return p.area ? { ...p, area: p.area.map((v, i) => (i === index ? position : v)) } : p;
}

export function removeAreaVertex(p: TrackProject, index: number): TrackProject {
  return p.area && p.area.length > 3 ? { ...p, area: p.area.filter((_, i) => i !== index) } : p;
}

// --------------------------------------------------------------------------- conos

export const addCone = (p: TrackProject, position: LatLng, color: ConeColor): TrackProject => ({
  ...p,
  cones: [...p.cones, { id: newId(), position, color }],
});

export const moveCone = (p: TrackProject, id: string, position: LatLng): TrackProject => ({
  ...p,
  cones: p.cones.map((c) => (c.id === id ? { ...c, position } : c)),
});

export const removeCone = (p: TrackProject, id: string): TrackProject => ({ ...p, cones: p.cones.filter((c) => c.id !== id) });

export const clearCones = (p: TrackProject): TrackProject => ({ ...p, cones: [] });

export const setConesCollidable = (p: TrackProject, conesCollidable: boolean): TrackProject => ({ ...p, conesCollidable });

// --------------------------------------------------------------------------- superficies

export const addZone = (p: TrackProject, polygon: readonly LatLng[], type: SurfaceType): TrackProject => ({
  ...p,
  zones: [...p.zones, { id: newId(), type, polygon }],
});

export const setZoneType = (p: TrackProject, id: string, type: SurfaceType): TrackProject => ({
  ...p,
  zones: p.zones.map((z) => (z.id === id ? { ...z, type } : z)),
});

export const removeZone = (p: TrackProject, id: string): TrackProject => ({ ...p, zones: p.zones.filter((z) => z.id !== id) });

// --------------------------------------------------------------------------- Brush (suciedad)

/** Añade una pasada del Brush (un solo punto vale: deja una mancha redonda). */
export const addDirtStroke = (p: TrackProject, material: DirtMaterial, radius: number, points: readonly LatLng[]): TrackProject =>
  points.length ? { ...p, dirt: [...p.dirt, { id: newId(), material, radius, points }] } : p;

/** Quita las pasadas indicadas (goma del Brush). */
export const removeDirtStrokes = (p: TrackProject, ids: ReadonlySet<string>): TrackProject =>
  ids.size ? { ...p, dirt: p.dirt.filter((d) => !ids.has(d.id)) } : p;

export const clearDirt = (p: TrackProject): TrackProject => ({ ...p, dirt: [] });

// --------------------------------------------------------------------------- Desnivelador

/** Añade una pasada del Desnivelador. */
export const addReliefStroke = (p: TrackProject, direction: ReliefDirection, radius: number, points: readonly LatLng[]): TrackProject =>
  points.length ? { ...p, relief: [...p.relief, { id: newId(), direction, radius, points }] } : p;

export const clearRelief = (p: TrackProject): TrackProject => ({ ...p, relief: [] });

export const setBaseSurface = (p: TrackProject, baseSurface: SurfaceType): TrackProject => ({ ...p, baseSurface });

// --------------------------------------------------------------------------- trazado

/** Ancho del último nodo, o el ancho por defecto si es el primero. */
function nextWidths(p: TrackProject): Pick<TrackAnchor, 'widthLeft' | 'widthRight'> {
  const last = p.track.anchors[p.track.anchors.length - 1];
  return last ? { widthLeft: last.widthLeft, widthRight: last.widthRight } : { widthLeft: DEFAULT_TRACK_WIDTH / 2, widthRight: DEFAULT_TRACK_WIDTH / 2 };
}

export function appendAnchors(p: TrackProject, positions: readonly LatLng[]): TrackProject {
  const widths = nextWidths(p);
  const fresh = positions.map((position) => ({ id: newId(), position, handleIn: null, handleOut: null, ...widths }));
  return withTrack(p, { anchors: [...p.track.anchors, ...fresh] });
}

/** Nodo Bézier con manejadores simétricos (herramienta pluma). */
export function appendBezierAnchor(p: TrackProject, position: LatLng, handleOut: LatLng): TrackProject {
  const proj = projectionOf(p);
  const pos = proj.toLocal(position);
  const out = proj.toLocal(handleOut);
  const anchor: TrackAnchor = {
    id: newId(),
    position,
    handleOut,
    handleIn: proj.toLatLng(sub(pos, sub(out, pos))),
    ...nextWidths(p),
  };
  return withTrack(p, { anchors: [...p.track.anchors, anchor] });
}

/** Mueve un nodo arrastrando sus manejadores con él. */
export function moveAnchor(p: TrackProject, id: string, position: LatLng): TrackProject {
  const proj = projectionOf(p);
  return mapAnchor(p, id, (a) => {
    const delta = sub(proj.toLocal(position), proj.toLocal(a.position));
    const shift = (h: LatLng | null): LatLng | null => h && proj.toLatLng(add(proj.toLocal(h), delta));
    return { ...a, position, handleIn: shift(a.handleIn), handleOut: shift(a.handleOut) };
  });
}

/** Mueve un manejador y refleja el opuesto (nodo suave, como en los editores de fotos). */
export function moveHandle(p: TrackProject, id: string, which: 'in' | 'out', position: LatLng): TrackProject {
  const proj = projectionOf(p);
  return mapAnchor(p, id, (a) => {
    const center = proj.toLocal(a.position);
    const moved = proj.toLocal(position);
    const mirrored = proj.toLatLng(sub(center, sub(moved, center)));
    return which === 'out' ? { ...a, handleOut: position, handleIn: mirrored } : { ...a, handleIn: position, handleOut: mirrored };
  });
}

/** Alterna entre nodo automático (suavizado) y nodo Bézier con manejadores editables. */
export function toggleAnchorMode(p: TrackProject, id: string): TrackProject {
  const proj = projectionOf(p);
  const anchors = p.track.anchors;
  const i = anchors.findIndex((a) => a.id === id);
  if (i < 0) return p;
  const a = anchors[i];
  if (a.handleIn || a.handleOut) return mapAnchor(p, id, (x) => ({ ...x, handleIn: null, handleOut: null }));
  const n = anchors.length;
  const prev = anchors[i > 0 ? i - 1 : p.track.closed ? n - 1 : i].position;
  const next = anchors[i < n - 1 ? i + 1 : p.track.closed ? 0 : i].position;
  const center = proj.toLocal(a.position);
  let tangent: Vec2 = scale(sub(proj.toLocal(next), proj.toLocal(prev)), 1 / 6);
  if (Math.hypot(tangent.x, tangent.y) < 0.5) tangent = { x: 0, y: 5 };
  return mapAnchor(p, id, (x) => ({ ...x, handleIn: proj.toLatLng(sub(center, tangent)), handleOut: proj.toLatLng(add(center, tangent)) }));
}

export const removeAnchor = (p: TrackProject, id: string): TrackProject =>
  withTrack(p, { anchors: p.track.anchors.filter((a) => a.id !== id) });

/** Ajusta el semiancho de un lado; en modo simétrico ajusta los dos. */
export function setAnchorWidth(p: TrackProject, id: string, side: 'left' | 'right', halfWidth: number): TrackProject {
  const w = clampHalfWidth(halfWidth);
  return mapAnchor(p, id, (a) =>
    p.track.symmetric ? { ...a, widthLeft: w, widthRight: w } : side === 'left' ? { ...a, widthLeft: w } : { ...a, widthRight: w },
  );
}

/** Aplica un ancho total a todo el trazado. */
export function setTrackWidth(p: TrackProject, total: number): TrackProject {
  const half = clampHalfWidth(total / 2);
  return withTrack(p, { anchors: p.track.anchors.map((a) => ({ ...a, widthLeft: half, widthRight: half })) });
}

export function setSymmetric(p: TrackProject, symmetric: boolean): TrackProject {
  const anchors = symmetric
    ? p.track.anchors.map((a) => {
        const half = (a.widthLeft + a.widthRight) / 2;
        return { ...a, widthLeft: half, widthRight: half };
      })
    : p.track.anchors;
  return withTrack(p, { symmetric, anchors });
}

export const setTrackOptions = (p: TrackProject, options: Partial<Pick<TrackLayout, 'closed' | 'autoCones' | 'coneSpacing'>>): TrackProject =>
  withTrack(p, options);

const flipGate = (g: Gate): Gate => ({ ...g, left: g.right, right: g.left });

/** Invierte el sentido de la marcha: nodos, manejadores, anchos y líneas de cronometraje. */
export function reverseTrack(p: TrackProject): TrackProject {
  const anchors = [...p.track.anchors]
    .reverse()
    .map((a) => ({ ...a, handleIn: a.handleOut, handleOut: a.handleIn, widthLeft: a.widthRight, widthRight: a.widthLeft }));
  return {
    ...withTrack(p, { anchors }),
    startFinish: p.startFinish && flipGate(p.startFinish),
    sectors: p.sectors.map(flipGate),
  };
}

export const clearTrack = (p: TrackProject): TrackProject => withTrack(p, { anchors: [] });

// --------------------------------------------------------------------------- cronometraje

export const setStartFinish = (p: TrackProject, left: LatLng, right: LatLng): TrackProject => ({
  ...p,
  startFinish: { id: p.startFinish?.id ?? newId(), left, right },
});

export const removeStartFinish = (p: TrackProject): TrackProject => ({ ...p, startFinish: null });

export const addSector = (p: TrackProject, left: LatLng, right: LatLng): TrackProject => ({
  ...p,
  sectors: [...p.sectors, { id: newId(), left, right }],
});

export const removeSector = (p: TrackProject, id: string): TrackProject => ({ ...p, sectors: p.sectors.filter((s) => s.id !== id) });
