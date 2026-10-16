import { zipSync } from 'fflate';
import { pointInRing } from '../domain/geometry/polygon';
import { nearestOnPolyline } from '../domain/geometry/polyline';
import { buildScene, type Scene } from '../domain/project/scene';
import type { LocalGate } from '../domain/track/gates';
import type { TrackProject } from '../domain/project/types';
import { encodePng } from './binary/png';
import { writeKn5 } from './ac/kn5';
import { mapAssets, surfacesIni, uiTrackJson } from './ac/trackFiles';
import { buildTrackModel, type SatelliteTexture } from './ac/trackScene';

/** Archivo que identifica la pista como creada por esta app (permite reeditarla y reinstalarla). */
export const PROJECT_FILE = 'atc/project.json';
export const PIT_COUNT = 4;

export interface ExportOptions {
  readonly trackId: string;
  readonly perimeterWalls: boolean;
  readonly satellite: SatelliteTexture | null;
}

export type TrackFiles = Record<string, Uint8Array>;

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Identificador de carpeta válido para AC a partir del nombre visible. */
export function trackIdFromName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `atc_${slug || 'circuito'}`;
}

/** Problemas que impiden exportar una pista jugable. */
export function validateForExport(project: TrackProject, scene: Scene | null): string[] {
  const errors: string[] = [];
  if (!scene) return ['Delimita primero el área de trabajo.'];
  if (!project.name.trim()) errors.push('Ponle un nombre al circuito.');
  if (!project.startFinish) errors.push('Coloca la línea de salida/meta: AC necesita saber dónde situar los coches y cronometrar.');
  return errors;
}

/** Distancia máxima entre una línea de cronometraje y el eje para considerar que lo cruza (m). */
const GATE_ON_TRACK_M = 1;

/** Avisos que no bloquean la exportación. */
export function exportWarnings(project: TrackProject, scene: Scene): string[] {
  const warnings: string[] = [];
  const { track } = scene;
  if (!track) warnings.push('No hay trazado: se exportará solo el suelo, los conos y las líneas.');
  if (track && !track.closed) warnings.push('El trazado está abierto: AC lo cronometrará como un circuito de vueltas.');
  if (track && track.samples.some((m) => !pointInRing(m.position, scene.area))) {
    warnings.push('Parte del trazado sale del área: esa parte no tendrá asfalto.');
  }
  const offTrack = (g: LocalGate): boolean =>
    !!track && track.samples.every((m) => (nearestOnPolyline([g.left, g.right], m.position, false)?.distance ?? 0) > GATE_ON_TRACK_M);
  if (scene.startFinish && offTrack(scene.startFinish)) warnings.push('La salida/meta no está sobre el trazado actual: vuelve a colocarla.');
  if (scene.sectors.some((s) => offTrack(s.gate))) warnings.push('Algún sector no está sobre el trazado actual.');
  if (project.sectors.length === 0) warnings.push('Sin sectores: AC mostrará solo el tiempo por vuelta.');
  return warnings;
}

/** Todos los archivos de la carpeta `content/tracks/<id>` (rutas relativas a esa carpeta). */
export function buildTrackFiles(project: TrackProject, options: ExportOptions): TrackFiles {
  const scene = buildScene(project);
  const errors = validateForExport(project, scene);
  if (errors.length || !scene) throw new Error(errors.join(' '));

  const model = buildTrackModel(project, scene, { pitCount: PIT_COUNT, perimeterWalls: options.perimeterWalls, satellite: options.satellite });
  const maps = mapAssets(scene);
  const widths = scene.track?.samples.map((m) => m.widthLeft + m.widthRight) ?? [0];
  return {
    [`${options.trackId}.kn5`]: writeKn5(model),
    'data/surfaces.ini': text(surfacesIni()),
    'data/map.ini': text(maps.mapIni),
    'map.png': encodePng(maps.mapPng),
    'ui/ui_track.json': text(
      uiTrackJson({
        name: project.name,
        lat: scene.projection.origin.lat,
        lng: scene.projection.origin.lng,
        lengthM: scene.track?.length ?? 0,
        widthM: Math.round(Math.max(...widths) * 10) / 10,
        pitboxes: PIT_COUNT,
      }),
    ),
    'ui/outline.png': encodePng(maps.outline),
    'ui/preview.png': encodePng(maps.preview),
    [PROJECT_FILE]: text(JSON.stringify(project, null, 2)),
  };
}

/** ZIP con las rutas bajo `prefix/` (vacío para instalar directamente en la carpeta de la pista). */
export function zipTrackFiles(files: TrackFiles, prefix = ''): Uint8Array {
  const entries = Object.fromEntries(Object.entries(files).map(([path, data]) => [prefix ? `${prefix}/${path}` : path, data]));
  return zipSync(entries, { level: 6 });
}
