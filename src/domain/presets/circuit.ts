import { LocalProjection, type LatLng } from '../geo/projection';
import type { Vec2 } from '../geometry/vec2';
import type { Scene } from '../project/scene';
import type { TerrainGrid } from './terrain';

/** Modelo de un circuito de AC tal como aparece en su models.ini. */
export interface CircuitModel {
  readonly file: string;
  /** Valores sin tocar del models.ini del circuito (p. ej. `270.3,-15.15,-45.8`). */
  readonly position: string;
  readonly rotation: string;
}

/** Lo que la exportación necesita de un circuito instalado (lo resuelve el servidor local). */
export interface CircuitEnvironment {
  /** Carpeta del circuito en content/tracks (la pista exportada carga `../<acTrack>/<kn5>`). */
  readonly acTrack: string;
  readonly models: readonly CircuitModel[];
  /** surfaces.ini del trazado del circuito: sus mallas físicas usan esas claves. */
  readonly surfacesIni: string;
  /** Suelo físico del circuito en el área (plano del circuito, alturas = Y de AC). */
  readonly terrain: TerrainGrid;
  /** Texto de la dependencia para ui_track.json. */
  readonly requirement: string;
}

const KEY = /^\s*KEY\s*=\s*(\S+)/m;

/**
 * surfaces.ini de la pista exportada: las superficies del circuito y, detrás, las de la app cuya
 * clave no exista ya (las zonas dibujadas usan ROAD, GRASS y GRAVEL).
 */
export function mergeSurfacesIni(circuitIni: string, ownIni: string): string {
  const sections = (ini: string): string[] =>
    ini.split(/\r?\n(?=\s*\[SURFACE_\d+\])/).map((s) => s.trim()).filter((s) => /^\[SURFACE_\d+\]/.test(s));
  const circuit = sections(circuitIni);
  const keys = new Set(circuit.map((s) => KEY.exec(s)?.[1]));
  const merged = [...circuit, ...sections(ownIni).filter((s) => !keys.has(KEY.exec(s)?.[1]))];
  return merged.map((s, i) => s.replace(/^\[SURFACE_\d+\]/, `[SURFACE_${i}]`).replace(/\r?\n/g, '\r\n')).join('\r\n\r\n') + '\r\n';
}

// --------------------------------------------------------------------------- superficies del circuito

/** Tipo de suelo de una superficie física de AC, para pintarla en el mapa y validar el trazado. */
export type SurfaceClass = 'road' | 'kerb' | 'pit' | 'runoff' | 'grass' | 'gravel';

export const SURFACE_CLASSES: readonly SurfaceClass[] = ['road', 'kerb', 'pit', 'runoff', 'grass', 'gravel'];

export const SURFACE_CLASS_LABELS: Readonly<Record<SurfaceClass, string>> = {
  road: 'Asfalto de pista',
  kerb: 'Piano',
  pit: 'Pit lane',
  runoff: 'Escapatoria asfaltada',
  grass: 'Césped',
  gravel: 'Grava',
};

/** Colores de la capa del circuito (también sirven para leer la clase de cada píxel). */
export const SURFACE_CLASS_COLORS: Readonly<Record<SurfaceClass, readonly [number, number, number]>> = {
  road: [40, 120, 255],
  kerb: [235, 50, 60],
  pit: [150, 90, 255],
  runoff: [0, 205, 215],
  grass: [70, 210, 80],
  gravel: [245, 170, 30],
};

/** Clases por las que se puede circular (el resto cuenta como fuera del trazado). */
export const PAVED_CLASSES: ReadonlySet<SurfaceClass> = new Set(['road', 'kerb', 'pit', 'runoff']);

export interface SurfaceProps {
  readonly friction: number;
  readonly isValidTrack: boolean;
  readonly isPitlane: boolean;
  readonly wav: string;
}

/** Propiedades de cada clave de un surfaces.ini. */
export function parseSurfaceProps(ini: string): Record<string, SurfaceProps> {
  const out: Record<string, SurfaceProps> = {};
  for (const section of ini.split(/\r?\n(?=\s*\[)/)) {
    const get = (k: string): string | undefined => new RegExp(`^\\s*${k}\\s*=\\s*([^;\\r\\n]*?)\\s*$`, 'm').exec(section)?.[1];
    const key = get('KEY');
    if (!key) continue;
    out[key] = {
      friction: Number(get('FRICTION') ?? 1),
      isValidTrack: get('IS_VALID_TRACK') === '1',
      isPitlane: get('IS_PITLANE') === '1',
      wav: (get('WAV') ?? '').toLowerCase(),
    };
  }
  return out;
}

/**
 * Clase de una superficie por su clave y propiedades. Los nombres de los pianos, el césped y la
 * grava no están normalizados entre circuitos: se combinan patrones de nombre, sonido y agarre.
 */
export function classifySurface(key: string, props: SurfaceProps | undefined): SurfaceClass {
  const k = key.toUpperCase();
  if (/KERB|CURB|RUMBLE/.test(k)) return 'kerb';
  if (/SAND|GRAVEL|TRAP/.test(k)) return 'gravel';
  if (/GRASS|^GR_|CARPET|CRPCUT|AST_CUT|TURF/.test(k) || /grass|turf/.test(props?.wav ?? '') || (props?.friction ?? 1) < 0.75) return 'grass';
  if (props?.isPitlane) return 'pit';
  if (props?.isValidTrack ?? k === 'ROAD') return 'road';
  return 'runoff';
}

/** Clase a partir del color de un píxel de la capa (null si es transparente o no coincide). */
export function classFromColor(r: number, g: number, b: number, a: number): SurfaceClass | null {
  if (a < 128) return null;
  return SURFACE_CLASSES.find((c) => {
    const [cr, cg, cb] = SURFACE_CLASS_COLORS[c];
    return Math.abs(cr - r) + Math.abs(cg - g) + Math.abs(cb - b) < 12;
  }) ?? null;
}

export interface CircuitCheck {
  /** Fracción del eje del trazado sobre suelo pavimentado del circuito (0–1); null sin trazado. */
  readonly trackOnPaved: number | null;
  /** Conos en césped, grava o sin suelo físico. */
  readonly conesOff: number;
  readonly cones: number;
  /** Por cada muestra del eje: true si está fuera del pavimento. */
  readonly offSamples: readonly boolean[];
}

/** Comprueba el trazado y los conos contra las superficies del circuito de AC. */
export function checkAgainstCircuit(scene: Scene, classAt: (p: Vec2) => SurfaceClass | null): CircuitCheck {
  const paved = (p: Vec2): boolean => {
    const c = classAt(p);
    return c !== null && PAVED_CLASSES.has(c);
  };
  const cones = [...scene.cones, ...scene.autoCones];
  const offSamples = scene.track?.samples.map((m) => !paved(m.position)) ?? [];
  return {
    trackOnPaved: offSamples.length ? offSamples.filter((off) => !off).length / offSamples.length : null,
    conesOff: cones.filter((c) => !paved(c.position)).length,
    cones: cones.length,
    offSamples,
  };
}

/** Mapa de superficies del circuito ya decodificado (píxeles RGBA, fila 0 al norte). */
export interface SurfaceRaster {
  /** Origen del plano este-norte de la imagen. */
  readonly origin: LatLng;
  readonly x0: number;
  readonly y1: number;
  readonly cell: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray | Uint8Array;
}

/** Clase de superficie en un punto geográfico (null fuera del mapa o sin suelo físico). */
export function surfaceAt(raster: SurfaceRaster, p: LatLng, tangent = new LocalProjection(raster.origin)): SurfaceClass | null {
  const e = tangent.toLocal(p);
  const i = Math.floor((e.x - raster.x0) / raster.cell);
  const j = Math.floor((raster.y1 - e.y) / raster.cell);
  if (i < 0 || j < 0 || i >= raster.width || j >= raster.height) return null;
  const k = (j * raster.width + i) * 4;
  const px = raster.pixels;
  return classFromColor(px[k], px[k + 1], px[k + 2], px[k + 3]);
}

/** Avisos de exportación a partir de la comprobación contra el circuito (vacío si todo cae en pavimento). */
export function circuitCheckWarnings(check: CircuitCheck): string[] {
  const warnings: string[] = [];
  if (check.trackOnPaved !== null && check.trackOnPaved < 1) {
    const off = Math.max(1, Math.round((1 - check.trackOnPaved) * 100));
    warnings.push(`El ${off} % del trazado cae fuera del pavimento del circuito de AC (en rojo en el mapa).`);
  }
  if (check.conesOff > 0) {
    warnings.push(`${check.conesOff} ${check.conesOff === 1 ? 'cono cae' : 'conos caen'} en césped, grava o sin suelo del circuito (borde rojo en el mapa).`);
  }
  return warnings;
}
