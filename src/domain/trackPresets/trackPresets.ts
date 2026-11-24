/**
 * Track presets: circuitos completos (trazado, conos, salida y marcas) que se añaden al proyecto de
 * una vez. Los de AutoX están georreferenciados y se cargan en su sitio real; todos se pueden colocar
 * también donde se quiera, girados. Los datos de AutoX salen de tools/track_presets/.
 */
import { LocalProjection, type LatLng } from '../geo/projection';
import { pointInRing } from '../geometry/polygon';
import { applyPreset, newId } from '../project/actions';
import { createEmptyProject, type TrackProject } from '../project/types';
import { PRESETS, presetById } from '../presets/presets';
import { buildTrackGeometry } from '../track/centerline';
import autocross from './autocross.json';
import { skidpadLayout } from './skidpad';
import type { PresetLayout, XY } from './types';

export interface TrackPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly layout: PresetLayout;
  /** Sitio real: preset de mapa sobre el que se carga y posición del origen del plano del preset. */
  readonly home: { readonly presetId: string; readonly origin: LatLng } | null;
}

interface AutocrossJson extends PresetLayout {
  readonly origin: readonly number[];
}

const DATA = autocross as unknown as Record<string, AutocrossJson>;

function autocrossPreset(id: string, name: string, presetId: string, description: string): TrackPreset {
  const { origin, anchors, closed, cones, gate } = DATA[id];
  return { id, name, description, layout: { anchors, closed, cones, gate }, home: { presetId, origin: { lat: origin[0], lng: origin[1] } } };
}

export const TRACK_PRESETS: readonly TrackPreset[] = [
  {
    id: 'skidpad',
    name: 'Skidpad',
    description: 'Prueba de skidpad de Formula Student (FS Rules 2026, D4.1): dos círculos de 15,25 / 21,25 m a 18,25 m entre centros.',
    layout: skidpadLayout(),
    home: null,
  },
  autocrossPreset('jerez_parking', 'Jerez Parking', 'parking_jerez', 'AutoX sobre el trazado pintado del parking del Circuito de Jerez, con barreras de conos que estrechan el carril.'),
  autocrossPreset('jerez_neumaticos', 'Jerez Neumáticos', 'karting_jerez', 'AutoX en el karting de Jerez Neumáticos, con chicanes de conos en las rectas y lazo en el parking.'),
  autocrossPreset('isla_magica_pruebas', 'Isla Mágica Pruebas de Piloto', 'isla_magica', 'AutoX de las pruebas de piloto en el parking de Isla Mágica, con cruce de skidpad.'),
];

export const trackPresetById = (id: string | null | undefined): TrackPreset | null => TRACK_PRESETS.find((t) => t.id === id) ?? null;

/** Dónde se coloca un preset: origen de su plano y giro antihorario (grados). */
export interface Placement {
  readonly center: LatLng;
  readonly rotationDeg: number;
}

/** Lleva puntos del plano del preset al mapa. */
export function placer({ center, rotationDeg }: Placement): (p: XY) => LatLng {
  const projection = new LocalProjection(center);
  const a = (rotationDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return ([x, y]) => projection.toLatLng({ x: c * x - s * y, y: s * x + c * y });
}

/** Eje y bordes del preset para dibujarlo (vista previa y fantasma en el mapa), en su plano. */
export function presetOutline(layout: PresetLayout): { left: XY[]; right: XY[]; length: number } {
  const v = ([x, y]: XY) => ({ x, y });
  const track = buildTrackGeometry(
    layout.anchors.map((a) => ({ position: v(a.p), handleIn: v(a.in), handleOut: v(a.out), widthLeft: a.left, widthRight: a.right })),
    layout.closed,
    1,
  );
  const pts = (list: readonly { x: number; y: number }[]): XY[] => list.map((p) => [p.x, p.y]);
  return track ? { left: pts(track.leftEdge), right: pts(track.rightEdge), length: track.length } : { left: [], right: [], length: 0 };
}

/** ¿Caben todos los conos y la salida dentro del área? (el carril de entrada puede sobresalir) */
export function presetFits(layout: PresetLayout, placement: Placement, area: readonly LatLng[]): boolean {
  const at = placer(placement);
  const ring = area.map((p) => ({ x: p.lng, y: p.lat }));
  return [...layout.cones.map((c) => c.p), layout.gate.left, layout.gate.right].every((p) => {
    const q = at(p);
    return pointInRing({ x: q.lng, y: q.lat }, ring);
  });
}

/** ¿El nombre lo puso la app (por defecto, del preset de mapa o de otro Track preset)? */
const isDefaultName = (p: TrackProject): boolean =>
  [createEmptyProject().name, ...PRESETS.map((s) => s.name), ...TRACK_PRESETS.map((t) => t.name)].includes(p.name);

/** Sustituye trazado, conos, líneas de tiempo y marcas por los del preset. Lo demás se conserva. */
export function applyTrackPreset(p: TrackProject, preset: TrackPreset, placement: Placement): TrackProject {
  const at = placer(placement);
  const { layout } = preset;
  return {
    ...p,
    name: isDefaultName(p) ? preset.name : p.name,
    track: {
      ...p.track,
      anchors: layout.anchors.map((a) => ({
        id: newId(),
        position: at(a.p),
        handleIn: at(a.in),
        handleOut: at(a.out),
        widthLeft: a.left,
        widthRight: a.right,
      })),
      closed: layout.closed,
      symmetric: layout.anchors.every((a) => a.left === a.right),
      // Los conos del preset son los de verdad: los automáticos se sumarían encima.
      autoCones: false,
      startOffset: layout.startOffset,
    },
    cones: layout.cones.map((c) => ({ id: newId(), position: at(c.p), color: c.color })),
    startFinish: { id: newId(), left: at(layout.gate.left), right: at(layout.gate.right) },
    sectors: [],
    markings: (layout.markings ?? []).map((m) => ({ id: newId(), points: m.points.map(at), width: m.width })),
  };
}

/** Carga un preset georreferenciado en su sitio: elige su preset de mapa y lo coloca donde es. */
export function applyTrackPresetAtHome(p: TrackProject, preset: TrackPreset): TrackProject {
  const site = preset.home && presetById(preset.home.presetId);
  if (!preset.home || !site) return p;
  const onSite = p.preset === site.id ? p : applyPreset(p, site);
  return applyTrackPreset(onSite, preset, { center: preset.home.origin, rotationDeg: 0 });
}
