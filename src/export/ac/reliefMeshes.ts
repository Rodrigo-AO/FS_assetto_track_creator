/**
 * Desnivelador sobre un escenario 3D o un circuito de AC: su suelo no se puede tocar, así que
 * donde el desnivel sube se añade un parche físico (y visible) que sigue el suelo original más el
 * desnivel. Lo que baja del suelo original no se puede representar y se ignora.
 */
import type { Vec2 } from '../../domain/geometry/vec2';
import { reliefAt, type ReliefField } from '../../domain/relief/relief';
import { FIELD_TILE_M } from '../../domain/strokes/strokeField';
import { MeshData, toAc, type Ground } from './meshes';

/** Celda del parche (m) y desnivel mínimo para que una celda forme parte de él (m). */
const PATCH_CELL_M = 0.25;
const PATCH_MIN_M = 0.005;
const UP = [0, 1, 0] as const;

/**
 * Parche de las casillas con desnivel positivo: celdas de 0,25 m cuyo desnivel supera 5 mm, con
 * vértices compartidos y alturas `ground(p) + desnivel`. Devuelve si se añadió algo.
 */
export function appendReliefPatch(mesh: MeshData, field: ReliefField, ground: Ground, uvOf: (v: Vec2) => readonly [number, number]): boolean {
  const cells = Math.round(FIELD_TILE_M / PATCH_CELL_M);
  let added = false;
  for (const tile of field.values()) {
    const ox = tile.ix * FIELD_TILE_M;
    const oy = tile.iy * FIELD_TILE_M;
    const raised = (ci: number, cj: number): boolean => reliefAt(field, { x: ox + (ci + 0.5) * PATCH_CELL_M, y: oy + (cj + 0.5) * PATCH_CELL_M }) > PATCH_MIN_M;
    const index = new Map<number, number>();
    const vertex = (vi: number, vj: number): number => {
      const key = vj * (cells + 1) + vi;
      let v = index.get(key);
      if (v === undefined) {
        const p = { x: ox + vi * PATCH_CELL_M, y: oy + vj * PATCH_CELL_M };
        v = mesh.vertex(toAc(p, ground(p) + Math.max(0, reliefAt(field, p))), UP, uvOf(p));
        index.set(key, v);
      }
      return v;
    };
    for (let cj = 0; cj < cells; cj++) {
      for (let ci = 0; ci < cells; ci++) {
        if (!raised(ci, cj)) continue;
        mesh.quad(vertex(ci, cj), vertex(ci + 1, cj), vertex(ci + 1, cj + 1), vertex(ci, cj + 1), UP);
        added = true;
      }
    }
  }
  return added;
}
