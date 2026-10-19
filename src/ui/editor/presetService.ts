import type { CircuitEnvironment, CircuitModel, SurfaceRaster } from '../../domain/presets/circuit';
import { LocalProjection, type LatLng } from '../../domain/geo/projection';
import { presetAssets, type CircuitPreset, type PresetManifest } from '../../domain/presets/presets';
import type { Scene } from '../../domain/project/scene';
import { parseTerrain, type TerrainGrid, type TerrainJson } from '../../domain/presets/terrain';
import type { PresetEnvironment } from '../../export/trackPackage';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export const fetchPresetManifest = (id: string): Promise<PresetManifest> => getJson<PresetManifest>(presetAssets(id).manifest);

/** Descarga el escenario 3D (kn5) y el terreno de un preset para exportar. */
export async function loadPresetEnvironment(id: string): Promise<PresetEnvironment> {
  const assets = presetAssets(id);
  const [manifest, terrain, kn5] = await Promise.all([
    fetchPresetManifest(id),
    getJson<TerrainJson>(assets.terrain),
    fetch(assets.kn5).then(async (res) => {
      if (!res.ok) throw new Error(`No se pudo cargar el escenario 3D (HTTP ${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  ]);
  return { id, kn5, terrain: parseTerrain(terrain), attribution: manifest.attribution };
}

interface CircuitStatusJson {
  readonly installed: boolean;
  readonly acFound: boolean;
  readonly models?: CircuitModel[];
  readonly surfacesIni?: string;
  readonly error?: string;
}

const circuitQuery = (c: CircuitPreset): string => `track=${encodeURIComponent(c.acTrack)}&layout=${encodeURIComponent(c.layout)}`;

/** ¿Está el circuito instalado en AC? (false también si no hay servidor local o AC). */
export async function fetchCircuitStatus(c: CircuitPreset): Promise<boolean> {
  try {
    const res = await fetch(`/api/ac/circuit?${circuitQuery(c)}`);
    return res.ok && ((await res.json()) as CircuitStatusJson).installed;
  } catch {
    return false;
  }
}

/** Texto de la dependencia (ui_track.json y mensajes de error). */
export function requirementText(c: CircuitPreset): string {
  const { name, author, url, bundled } = c.requires;
  const source = bundled ? ` (descomprime ${bundled} del repositorio en content/tracks)` : url ? `: ${url}` : '';
  return `Requiere el circuito «${name}» (${author}) instalado en content/tracks/${c.acTrack}${source}.`;
}

/** Margen alrededor del área para el suelo (m) y tamaño de celda de la rejilla. */
const TERRAIN_MARGIN_M = 5;
const TERRAIN_CELL_M = 0.25;

/**
 * Datos del circuito instalado para exportar: modelos, superficies y suelo bajo el área.
 * Lo calcula el servidor local leyendo los kn5 del circuito en la instalación de AC.
 */
export async function loadCircuitEnvironment(c: CircuitPreset, scene: Scene): Promise<CircuitEnvironment> {
  const status = await getJson<CircuitStatusJson>(`/api/ac/circuit?${circuitQuery(c)}`);
  if (!status.acFound) throw new Error('No se encontró Assetto Corsa en este equipo (define ATC_AC_PATH al arrancar la app).');
  if (!status.installed || !status.models || status.surfacesIni === undefined) throw new Error(`Falta el circuito. ${requirementText(c)}`);
  const terrain = await fetchCircuitTerrain(c, scene);
  return { acTrack: c.acTrack, models: status.models, surfacesIni: status.surfacesIni, terrain, requirement: requirementText(c) };
}

/** Suelo del circuito instalado bajo el área (plano del circuito), calculado por el servidor local. */
export async function fetchCircuitTerrain(c: CircuitPreset, scene: Scene, cell = TERRAIN_CELL_M): Promise<TerrainGrid> {
  const xs = scene.area.map((p) => p.x);
  const ys = scene.area.map((p) => p.y);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const terrain = await getJson<TerrainJson>(
    `/api/ac/circuit-terrain?${circuitQuery(c)}&x0=${box[0] - TERRAIN_MARGIN_M}&y0=${box[1] - TERRAIN_MARGIN_M}` +
      `&x1=${box[2] + TERRAIN_MARGIN_M}&y1=${box[3] + TERRAIN_MARGIN_M}&cell=${cell}`,
  );
  return parseTerrain(terrain);
}

interface SurfaceMapJson {
  readonly origin: LatLng;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly cell: number;
  readonly width: number;
  readonly height: number;
  readonly png: string;
}

/** Superficies del circuito de AC listas para pintarlas en el mapa y consultarlas punto a punto. */
export interface CircuitSurfaces {
  readonly imageUrl: string;
  /** Esquinas suroeste y noreste de la imagen. */
  readonly bounds: readonly [LatLng, LatLng];
  readonly raster: SurfaceRaster;
}

const surfacesCache = new Map<string, Promise<CircuitSurfaces>>();

/** Descarga (una vez por circuito) el mapa de superficies y lo decodifica para leer sus píxeles. */
export function fetchCircuitSurfaces(c: CircuitPreset): Promise<CircuitSurfaces> {
  const cached = surfacesCache.get(c.id);
  if (cached) return cached;
  const promise = (async () => {
    const map = await getJson<SurfaceMapJson>(`/api/ac/circuit-surfaces?id=${encodeURIComponent(c.id)}`);
    const imageUrl = `data:image/png;base64,${map.png}`;
    // onload y no img.decode(): con imágenes grandes decode() puede no resolverse nunca en Chromium.
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('No se pudo decodificar el mapa de superficies'));
      img.src = imageUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = map.width;
    canvas.height = map.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, map.width, map.height).data;
    const tangent = new LocalProjection(map.origin);
    const bounds = [tangent.toLatLng({ x: map.x0, y: map.y0 }), tangent.toLatLng({ x: map.x1, y: map.y1 })] as const;
    return { imageUrl, bounds, raster: { origin: map.origin, x0: map.x0, y1: map.y1, cell: map.cell, width: map.width, height: map.height, pixels } };
  })();
  surfacesCache.set(c.id, promise);
  promise.catch(() => surfacesCache.delete(c.id)); // reintentar si falló (p. ej. circuito sin instalar)
  return promise;
}
