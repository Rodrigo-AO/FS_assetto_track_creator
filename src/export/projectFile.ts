/**
 * Proyecto guardado dentro de la pista exportada (`atc/project.json`), para volver a abrirla con
 * «Editar circuito». Lleva la firma de la app y una versión de formato; los ZIP exportados antes
 * de la firma (solo el proyecto) también se aceptan.
 */
import { unzipSync } from 'fflate';
import { presetById } from '../domain/presets/presets';
import { createEmptyProject, type TrackProject } from '../domain/project/types';

/** Ruta del proyecto dentro de la carpeta de la pista. */
export const PROJECT_FILE = 'atc/project.json';
export const APP_ID = 'assetto-track-creator';
/** Versión del formato de `project.json`; subirla si cambia de forma incompatible. */
export const PROJECT_FORMAT = 1;

interface ProjectFileJson {
  readonly app: typeof APP_ID;
  readonly format: number;
  readonly trackId: string;
  readonly exportedAt: string;
  readonly project: TrackProject;
}

export function projectFileJson(project: TrackProject, trackId: string, now = new Date()): string {
  const file: ProjectFileJson = { app: APP_ID, format: PROJECT_FORMAT, trackId, exportedAt: now.toISOString(), project };
  return JSON.stringify(file, null, 2);
}

export type OpenedTrack = { readonly ok: true; readonly project: TrackProject; readonly trackId: string | null } | { readonly ok: false; readonly error: string };

const NOT_OURS = 'Este .zip no es un circuito creado con Assetto Track Creator.';

/** Lee el proyecto de un ZIP de pista (el de «Descargar ZIP» o la carpeta de la pista comprimida). */
export function openTrackZip(zip: Uint8Array): OpenedTrack {
  let entries: Record<string, Uint8Array>;
  try {
    // Solo hace falta el proyecto: el resto (kn5, texturas) ni se descomprime.
    entries = unzipSync(zip, { filter: (f) => f.name === PROJECT_FILE || f.name.endsWith(`/${PROJECT_FILE}`) });
  } catch {
    return { ok: false, error: 'El archivo no es un .zip válido.' };
  }
  const names = Object.keys(entries).sort((a, b) => a.length - b.length);
  if (!names.length) return { ok: false, error: NOT_OURS };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(entries[names[0]]));
  } catch {
    return { ok: false, error: `${NOT_OURS} (su atc/project.json está dañado)` };
  }
  return projectFromJson(json);
}

export function projectFromJson(json: unknown): OpenedTrack {
  const file = json as Partial<ProjectFileJson> | null;
  let raw: unknown;
  let trackId: string | null = null;
  if (file && typeof file === 'object' && 'app' in file) {
    if (file.app !== APP_ID) return { ok: false, error: NOT_OURS };
    if (typeof file.format !== 'number' || file.format > PROJECT_FORMAT) {
      return { ok: false, error: 'Este circuito se creó con una versión más reciente de Assetto Track Creator: actualiza la app para abrirlo.' };
    }
    raw = file.project;
    trackId = typeof file.trackId === 'string' ? file.trackId : null;
  } else {
    raw = json; // exportaciones anteriores a la firma: solo el proyecto
  }
  const project = normalizeProject(raw);
  if (!project) return { ok: false, error: `${NOT_OURS} (no contiene un proyecto válido)` };
  if (project.preset && !presetById(project.preset)) {
    return { ok: false, error: `El circuito usa el preset «${project.preset}», que esta versión de la app no tiene.` };
  }
  return { ok: true, project, trackId };
}

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isLatLng = (v: unknown): boolean =>
  !!v && typeof v === 'object' && Number.isFinite((v as { lat?: unknown }).lat) && Number.isFinite((v as { lng?: unknown }).lng);

/**
 * Comprueba la forma del proyecto y completa los campos que añadieron versiones posteriores (como
 * al cargar un borrador antiguo). Devuelve null si no es un proyecto de la app.
 */
function normalizeProject(raw: unknown): TrackProject | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const track = p.track as Record<string, unknown> | undefined;
  if (p.version !== 1 || typeof p.name !== 'string') return null;
  if (!(p.area === null || (isArray(p.area) && p.area.every(isLatLng)))) return null;
  if (!track || typeof track !== 'object' || !isArray(track.anchors)) return null;
  if (!track.anchors.every((a) => !!a && typeof a === 'object' && isLatLng((a as { position?: unknown }).position))) return null;
  for (const key of ['zones', 'dirt', 'relief', 'cones', 'sectors'] as const) if (key in p && !isArray(p[key])) return null;
  const empty = createEmptyProject();
  return { ...empty, ...(p as Partial<TrackProject>), track: { ...empty.track, ...(track as Partial<TrackProject['track']>) } };
}
