/**
 * Lectura de un circuito instalado en Assetto Corsa para usarlo como preset: qué kn5 cargar
 * (y cuáles saltar porque traen sus propios puntos de salida), sus superficies y la rejilla de
 * alturas de su suelo. Nada de esto se guarda en el repositorio: se calcula en local a partir de
 * la instalación de AC del usuario.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classifySurface, parseSurfaceProps, type CircuitModel, type SurfaceClass } from '../src/domain/presets/circuit';

/** Dummies que fijan dónde salen los coches y dónde se cronometra (los pone la capa de la app). */
const SPAWN_DUMMY = /^AC_(START|PIT|TIME|HOTLAP_START|AB_START|AB_FINISH)_/;
const MISSING = -32768;
/** Componente vertical mínima de la normal para tomar un triángulo visual como suelo (pendientes de hasta 60°: taludes sí, paredes no). */
const FLAT_NORMAL_Y = 0.5;

// --------------------------------------------------------------------------- kn5

export interface Kn5Scan {
  /** Nombres de los dummies y mallas. */
  readonly names: string[];
  /** Triángulos de las mallas de suelo físico: 9 floats por triángulo (X, Y, Z de AC). */
  readonly groundTriangles: Float32Array;
  /** Índice de superficie de cada triángulo de suelo (lo que devuelve `isGround`). */
  readonly groundKeys: Uint16Array;
  /** Triángulos casi horizontales de las mallas visibles sin física (suelo solo visual). */
  readonly visualFlatTriangles: Float32Array;
}

/** Clave de superficie de una malla física de AC (`10TRM-BRC006` → `TRM-BRC`), o null. */
export function surfaceKeyOf(meshName: string, keys: readonly string[]): string | null {
  const m = /^(\d+)(.+)$/.exec(meshName);
  if (!m) return null;
  let best: string | null = null;
  for (const key of keys) if (m[2].startsWith(key) && (!best || key.length > best.length)) best = key;
  return best;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Producto de matrices 4×4 por filas (convención de AC: v' = v · M). */
function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return out;
}

/**
 * Recorre un kn5 (versiones 5 y 6) y devuelve, ya en coordenadas de mundo, los triángulos de las
 * mallas de suelo físico (`isGround`) y los triángulos casi horizontales de las mallas visibles que
 * no son físicas (`isPhysics` falso), con los que se estima el suelo donde no hay malla física.
 */
export function scanKn5(
  data: Uint8Array,
  isGround: (meshName: string) => boolean | number,
  isPhysics: (meshName: string) => boolean = (n) => groundIndex(isGround(n)) >= 0,
): Kn5Scan {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dec = new TextDecoder('latin1');
  let p = 0;
  const i32 = (): number => {
    const v = view.getInt32(p, true);
    p += 4;
    return v;
  };
  const str = (): string => {
    const n = i32();
    const s = dec.decode(data.subarray(p, p + n));
    p += n;
    return s;
  };
  if (dec.decode(data.subarray(0, 6)) !== 'sc6969') throw new Error('No es un archivo kn5');
  p = 6;
  if (i32() > 5) i32();
  for (let t = i32(); t > 0; t--) {
    i32();
    str();
    const size = i32(); // no `p += i32()`: leería `p` antes de que i32() lo avance
    p += size;
  }
  for (let m = i32(); m > 0; m--) {
    str();
    str();
    p += 6;
    for (let k = i32(); k > 0; k--) {
      str();
      p += 40;
    }
    for (let k = i32(); k > 0; k--) {
      str();
      i32();
      str();
    }
  }

  const names: string[] = [];
  const ground: number[] = [];
  const keys: number[] = [];
  const flat: number[] = [];
  const node = (parent: readonly number[]): void => {
    const cls = i32();
    const name = str();
    names.push(name);
    const children = i32();
    p += 1;
    let world = parent;
    if (cls === 1) {
      const local = Array.from({ length: 16 }, (_, k) => view.getFloat32(p + k * 4, true));
      p += 64;
      world = multiply(local, parent);
    } else if (cls === 2) {
      const visible = data[p + 1] === 1 && data[p + 2] === 0; // visible y no transparente
      p += 3;
      const count = i32();
      const base = p;
      p += count * 44;
      const nIdx = i32();
      const idxBase = p;
      p += nIdx * 2 + 16 + 16;
      const renderable = data[p] === 1;
      p += 1;
      const w = world;
      const vertex = (i: number): [number, number, number] => {
        const o = base + i * 44;
        const x = view.getFloat32(o, true);
        const y = view.getFloat32(o + 4, true);
        const z = view.getFloat32(o + 8, true);
        return [x * w[0] + y * w[4] + z * w[8] + w[12], x * w[1] + y * w[5] + z * w[9] + w[13], x * w[2] + y * w[6] + z * w[10] + w[14]];
      };
      const index = (k: number): number => view.getUint16(idxBase + k * 2, true);
      const surface = groundIndex(isGround(name));
      if (surface >= 0) {
        for (let k = 0; k < nIdx; k++) ground.push(...vertex(index(k)));
        for (let k = 0; k + 2 < nIdx; k += 3) keys.push(surface);
      } else if (!isPhysics(name) && visible && renderable && !name.startsWith('AC_')) {
        for (let k = 0; k + 2 < nIdx; k += 3) {
          const a = vertex(index(k));
          const b = vertex(index(k + 1));
          const c = vertex(index(k + 2));
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
          const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const len = Math.hypot(nx, ny, nz);
          if (len > 1e-9 && Math.abs(ny) / len >= FLAT_NORMAL_Y) flat.push(...a, ...b, ...c);
        }
      }
    } else {
      throw new Error(`Nodo kn5 de tipo ${cls} no soportado (${name})`);
    }
    for (let c = 0; c < children; c++) node(world);
  };
  node(IDENTITY);
  return { names, groundTriangles: Float32Array.from(ground), groundKeys: Uint16Array.from(keys), visualFlatTriangles: Float32Array.from(flat) };
}

/** `isGround` puede devolver true/false o el índice de la superficie (−1 si no es suelo). */
const groundIndex = (v: boolean | number): number => (v === true ? 0 : v === false ? -1 : v);

// --------------------------------------------------------------------------- ini

/** Bloques `[MODEL_n]` de un models.ini (los objetos dinámicos se ignoran). */
export function parseModelsIni(text: string): CircuitModel[] {
  const models: CircuitModel[] = [];
  for (const block of text.split(/\r?\n(?=\s*\[)/)) {
    if (!/^\s*\[MODEL_\d+\]/.test(block)) continue;
    const get = (key: string, fallback: string): string => new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm').exec(block)?.[1] ?? fallback;
    models.push({ file: get('FILE', ''), position: get('POSITION', '0,0,0'), rotation: get('ROTATION', '0,0,0') });
  }
  return models.filter((m) => m.file);
}

export const surfaceKeys = (ini: string): string[] => [...ini.matchAll(/^\s*KEY\s*=\s*(\S+)/gm)].map((m) => m[1]);

// --------------------------------------------------------------------------- circuito

export interface CircuitInfo {
  readonly models: CircuitModel[];
  /** kn5 del trazado que no se cargan porque traen sus propios dummies de salida. */
  readonly skipped: string[];
  readonly surfacesIni: string;
}

interface LoadedCircuit extends CircuitInfo {
  readonly stamp: string;
  /** Triángulos de suelo físico de los modelos cargados, en el plano (X, −Z) con altura Y. */
  readonly ground: Float32Array;
  /** Superficie de cada triángulo de `ground` (índice) y su clase. */
  readonly groundKeys: Uint16Array;
  readonly triangleClass: (triangle: number) => SurfaceClass;
  /** Triángulos horizontales solo visuales (mismo plano), para el suelo donde no hay física. */
  readonly visual: Float32Array;
}

const NAME = /^[A-Za-z0-9_.-]+$/;
const cache = new Map<string, LoadedCircuit>();

function layoutPaths(trackDir: string, layout: string): { models: string; surfaces: string } {
  const models = join(trackDir, layout ? `models_${layout}.ini` : 'models.ini');
  const surfaces = join(trackDir, layout, 'data', 'surfaces.ini');
  return { models: existsSync(models) ? models : join(trackDir, 'models.ini'), surfaces: existsSync(surfaces) ? surfaces : join(trackDir, 'data', 'surfaces.ini') };
}

/** Pasa triángulos de coordenadas de AC al plano del circuito (x = X, y = −Z, altura = Y). */
function toPlane(t: Float32Array, [px, py, pz]: readonly number[]): Float32Array {
  const plane = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    plane[i] = t[i] + px;
    plane[i + 1] = -(t[i + 2] + pz);
    plane[i + 2] = t[i + 1] + py;
  }
  return plane;
}

function concat(parts: readonly Float32Array[]): Float32Array {
  const all = new Float32Array(parts.reduce((s, g) => s + g.length, 0));
  let offset = 0;
  for (const g of parts) {
    all.set(g, offset);
    offset += g.length;
  }
  return all;
}

/** Carga (y guarda en memoria) el circuito `track` con su trazado `layout`; null si no está instalado. */
export function loadCircuit(tracksDir: string, track: string, layout: string): LoadedCircuit | null {
  if (!NAME.test(track) || (layout && !NAME.test(layout)) || track.includes('..') || layout.includes('..')) throw new Error('Nombre de circuito no válido');
  const trackDir = join(tracksDir, track);
  const paths = layoutPaths(trackDir, layout);
  if (!existsSync(paths.models) || !existsSync(paths.surfaces)) return null;
  const models = parseModelsIni(readFileSync(paths.models, 'utf8'));
  const files = models.map((m) => join(trackDir, m.file));
  if (files.some((f) => !existsSync(f))) return null;
  const stamp = [paths.models, paths.surfaces, ...files].map((f) => `${f}:${statSync(f).mtimeMs}`).join('|');
  const key = `${track}/${layout}`;
  const hit = cache.get(key);
  if (hit?.stamp === stamp) return hit;

  const surfacesIni = readFileSync(paths.surfaces, 'utf8');
  const systemPath = join(tracksDir, '..', '..', 'system', 'data', 'surfaces.ini');
  const systemIni = existsSync(systemPath) ? readFileSync(systemPath, 'utf8') : '';
  const keys = [...new Set([...surfaceKeys(surfacesIni), ...surfaceKeys(systemIni)])];
  // Las propiedades del circuito mandan sobre las de sistema (ROAD, GRASS, KERB, SAND).
  const props = { ...parseSurfaceProps(systemIni), ...parseSurfaceProps(surfacesIni) };
  const keyClasses = keys.map((k) => classifySurface(k, props[k]));
  const isPhysics = (name: string): boolean => surfaceKeyOf(name, keys) !== null;
  const groundKey = (name: string): number => {
    const k = surfaceKeyOf(name, keys);
    return k === null || k === 'WALL' ? -1 : keys.indexOf(k);
  };

  const kept: CircuitModel[] = [];
  const skipped: string[] = [];
  const ground: Float32Array[] = [];
  const groundKeys: Uint16Array[] = [];
  const visual: Float32Array[] = [];
  for (const model of models) {
    const scan = scanKn5(readFileSync(join(trackDir, model.file)), groundKey, isPhysics);
    if (scan.names.some((n) => SPAWN_DUMMY.test(n))) {
      skipped.push(model.file);
      continue;
    }
    kept.push(model);
    // El suelo solo se toma de modelos sin giro (en los circuitos soportados, los girados son decorado).
    if (model.rotation.split(',').some((v) => Number(v) !== 0)) continue;
    const position = model.position.split(',').map((v) => Number(v) || 0);
    ground.push(toPlane(scan.groundTriangles, position));
    groundKeys.push(scan.groundKeys);
    visual.push(toPlane(scan.visualFlatTriangles, position));
  }
  const allKeys = new Uint16Array(groundKeys.reduce((s, g) => s + g.length, 0));
  groundKeys.reduce((offset, g) => (allKeys.set(g, offset), offset + g.length), 0);
  const loaded: LoadedCircuit = {
    stamp, models: kept, skipped, surfacesIni,
    ground: concat(ground), groundKeys: allKeys, triangleClass: (t) => keyClasses[allKeys[t]],
    visual: concat(visual),
  };
  cache.set(key, loaded);
  return loaded;
}

// --------------------------------------------------------------------------- rejilla de alturas

export interface TerrainRequest {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly cell: number;
}

/** Máximo de nodos de una rejilla pedida (si no cabe, se agranda la celda). */
const MAX_NODES = 4_000_000;

/** Altura de los triángulos en cada nodo: la más alta (`max`) o la más baja (`min`); ±Infinity sin dato. */
function rasterize(triangles: Float32Array, req: TerrainRequest, cell: number, nx: number, ny: number, mode: 'max' | 'min'): Float32Array {
  const heights = new Float32Array(nx * ny).fill(mode === 'max' ? -Infinity : Infinity);
  for (let t = 0; t < triangles.length; t += 9) {
    const ax = triangles[t], ay = triangles[t + 1], ah = triangles[t + 2];
    const bx = triangles[t + 3], by = triangles[t + 4], bh = triangles[t + 5];
    const cx = triangles[t + 6], cy = triangles[t + 7], ch = triangles[t + 8];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - req.x0) / cell));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - req.x0) / cell));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - req.y0) / cell));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - req.y0) / cell));
    if (i0 > i1 || j0 > j1) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    for (let j = j0; j <= j1; j++) {
      const y = req.y0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = req.x0 + i * cell;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const h = l1 * ah + l2 * bh + l3 * ch;
        const k = j * nx + i;
        if (mode === 'max' ? h > heights[k] : h < heights[k]) heights[k] = h;
      }
    }
  }
  return heights;
}

/**
 * Rejilla de alturas (formato terrain.json de la app) en un rectángulo del plano del circuito.
 * Manda el suelo físico (la superficie más alta si hay varias). Donde el circuito no tiene malla
 * física (p. ej. el paddock de Barcelona) se toma la superficie visual horizontal más baja y el
 * nodo se marca en `virtual` (para que los conos tengan altura y la app avise de que AC no deja circular ahí).
 */
export function rasterizeGround(triangles: Float32Array, req: TerrainRequest, visual?: Float32Array) {
  let cell = req.cell;
  const size = (c: number) => ({ nx: Math.floor((req.x1 - req.x0) / c) + 2, ny: Math.floor((req.y1 - req.y0) / c) + 2 });
  while (size(cell).nx * size(cell).ny > MAX_NODES) cell *= 1.5;
  const { nx, ny } = size(cell);
  const physics = rasterize(triangles, req, cell, nx, ny, 'max');
  const fallback = visual?.length ? rasterize(visual, req, cell, nx, ny, 'min') : null;
  const heights = new Float32Array(nx * ny);
  const virtual = new Uint8Array(Math.ceil((nx * ny) / 8));
  const markVirtual = (k: number): void => {
    virtual[k >> 3] |= 1 << (k & 7);
  };
  let anyVirtual = false;
  for (let k = 0; k < nx * ny; k++) {
    heights[k] = physics[k];
    if (!Number.isFinite(physics[k]) && fallback && Number.isFinite(fallback[k])) {
      heights[k] = fallback[k];
      markVirtual(k);
      anyVirtual = true;
    }
  }
  // Huecos sin ninguna superficie (bajo árboles, estructuras…): altura del nodo con dato más
  // cercano (búsqueda en anchura). Solo si hay suelo visual: sin él no se inventa suelo.
  if (anyVirtual) {
    const queue: number[] = [];
    for (let k = 0; k < nx * ny; k++) if (Number.isFinite(heights[k])) queue.push(k);
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      const i = k % nx;
      for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
        if (n < 0 || n >= nx * ny || Number.isFinite(heights[n])) continue;
        heights[n] = heights[k];
        markVirtual(n);
        queue.push(n);
      }
    }
  }
  const bytes = new Uint8Array(nx * ny * 2);
  const out = new DataView(bytes.buffer);
  heights.forEach((h, k) => out.setInt16(k * 2, Number.isFinite(h) ? Math.max(-32767, Math.min(32767, Math.round(h * 100))) : MISSING, true));
  return {
    x0: req.x0,
    y0: req.y0,
    cell,
    nx,
    ny,
    heights: Buffer.from(bytes).toString('base64'),
    ...(anyVirtual ? { virtual: Buffer.from(virtual).toString('base64') } : {}),
  };
}
