import type { Georef, LatLng } from '../geo/projection';
import sites from './sites.json';

interface PresetBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Escenario: área fija del modelo. Circuito: contorno del circuito (encuadre y referencia). */
  readonly polygon: readonly LatLng[];
}

/**
 * Ubicación con escenario 3D modelado en Blender (kn5 propio en public/presets/<id>/).
 * El área queda fijada al polígono del preset para que el trazado encaje con el modelo.
 */
export interface ScenePreset extends PresetBase {
  readonly kind: 'scene';
}

/** Mod o pista de AC que hay que tener instalado para usar un preset de circuito. */
export interface PresetRequirement {
  readonly name: string;
  readonly author: string;
  readonly url: string | null;
  /** Copia del mod incluida en el repositorio (ruta desde la raíz), para instalarlo sin buscarlo. */
  readonly bundled?: string;
}

/**
 * Circuito ya instalado en Assetto Corsa. El área se delimita libremente sobre él; al exportar,
 * la pista carga los kn5 del circuito instalado (`../<acTrack>/…`) y se apoya en su suelo.
 */
export interface CircuitPreset extends PresetBase {
  readonly kind: 'circuit';
  /** Carpeta en content/tracks y trazado (layout) cuyos modelos se cargan. */
  readonly acTrack: string;
  readonly layout: string;
  readonly requires: PresetRequirement;
  readonly georef: Georef;
}

export type PresetSite = ScenePreset | CircuitPreset;

interface SiteJson {
  id: string;
  name: string;
  description: string;
  kind?: string;
  polygon: number[][];
  acTrack?: string;
  layout?: string;
  requires?: PresetRequirement;
  georef?: { origin: number[]; scale: number; rotationDeg: number; offset: number[] };
}

function toPreset(s: SiteJson): PresetSite {
  const base = { id: s.id, name: s.name, description: s.description, polygon: s.polygon.map(([lat, lng]) => ({ lat, lng })) };
  if (s.kind !== 'circuit') return { ...base, kind: 'scene' };
  const g = s.georef!;
  return {
    ...base,
    kind: 'circuit',
    acTrack: s.acTrack!,
    layout: s.layout!,
    requires: s.requires!,
    georef: { origin: { lat: g.origin[0], lng: g.origin[1] }, scale: g.scale, rotationDeg: g.rotationDeg, offset: [g.offset[0], g.offset[1]] },
  };
}

export const PRESETS: readonly PresetSite[] = (sites as SiteJson[]).map(toPreset);

export function presetById(id: string | null | undefined): PresetSite | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}

export function circuitPresetById(id: string | null | undefined): CircuitPreset | null {
  const preset = presetById(id);
  return preset?.kind === 'circuit' ? preset : null;
}

/** Rutas de los recursos que genera tools/presets (servidos desde public/). */
export const presetAssets = (id: string) => ({
  kn5: `/presets/${id}/${id}.kn5`,
  terrain: `/presets/${id}/terrain.json`,
  manifest: `/presets/${id}/manifest.json`,
  preview: `/presets/${id}/preview.jpg`,
});

export interface PresetManifest {
  readonly id: string;
  readonly kn5: string;
  readonly kn5Bytes: number;
  readonly zRef: number;
  readonly attribution: readonly string[];
}
