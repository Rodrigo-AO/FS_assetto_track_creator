import type { Vec2 } from '../geometry/vec2';

/**
 * Rejilla de alturas del suelo físico de un preset (terrain.json), en el plano local de la app.
 * Nodo (i, j) en (x0 + i·cell, y0 + j·cell); alturas en cm relativas a la cota de referencia
 * del escenario, es decir, directamente la Y de Assetto Corsa.
 */
export interface TerrainGrid {
  readonly x0: number;
  readonly y0: number;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  readonly heights: Int16Array;
  /**
   * Un bit por nodo (orden de `heights`): 1 donde la altura no viene de una malla física sino de
   * la superficie visual del circuito: ahí AC no tiene suelo por el que circular.
   */
  readonly virtual?: Uint8Array;
}

export interface TerrainJson {
  readonly x0: number;
  readonly y0: number;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  readonly heights: string;
  readonly virtual?: string;
}

const MISSING = -32768;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseTerrain(json: TerrainJson): TerrainGrid {
  const bytes = base64ToBytes(json.heights);
  const view = new DataView(bytes.buffer);
  const heights = new Int16Array(json.nx * json.ny);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getInt16(i * 2, true);
  const virtual = json.virtual ? base64ToBytes(json.virtual) : undefined;
  return { x0: json.x0, y0: json.y0, cell: json.cell, nx: json.nx, ny: json.ny, heights, ...(virtual ? { virtual } : {}) };
}

/** ¿El suelo en `p` es solo visual (sin malla física del circuito)? Nodo más cercano. */
export function isVirtualAt(grid: TerrainGrid, p: Vec2): boolean {
  if (!grid.virtual) return false;
  const i = Math.round((p.x - grid.x0) / grid.cell);
  const j = Math.round((p.y - grid.y0) / grid.cell);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return false;
  const k = j * grid.nx + i;
  return (grid.virtual[k >> 3] & (1 << (k & 7))) !== 0;
}

/** Altura (m) por interpolación bilineal; null fuera de la rejilla o sin datos. */
export function heightAt(grid: TerrainGrid, p: Vec2): number | null {
  const fx = (p.x - grid.x0) / grid.cell;
  const fy = (p.y - grid.y0) / grid.cell;
  if (fx < 0 || fy < 0 || fx > grid.nx - 1 || fy > grid.ny - 1) return null;
  const i = Math.min(Math.floor(fx), grid.nx - 2);
  const j = Math.min(Math.floor(fy), grid.ny - 2);
  const tx = fx - i;
  const ty = fy - j;
  const corners = [
    [grid.heights[j * grid.nx + i], (1 - tx) * (1 - ty)],
    [grid.heights[j * grid.nx + i + 1], tx * (1 - ty)],
    [grid.heights[(j + 1) * grid.nx + i], (1 - tx) * ty],
    [grid.heights[(j + 1) * grid.nx + i + 1], tx * ty],
  ].filter(([h]) => h !== MISSING);
  if (!corners.length) return null;
  const weight = corners.reduce((s, [, w]) => s + w, 0);
  if (weight < 1e-9) return corners[0][0] / 100;
  return corners.reduce((s, [h, w]) => s + h * w, 0) / weight / 100;
}

/** Función de suelo para el exportador: altura del terreno o 0 si no hay dato. */
export const groundFromTerrain = (grid: TerrainGrid) => (p: Vec2): number => heightAt(grid, p) ?? 0;

export function terrainRange(grid: TerrainGrid): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const h of grid.heights) {
    if (h === MISSING) continue;
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  return { min: min / 100, max: max / 100 };
}
