/**
 * Desnivelador sobre un escenario 3D de preset (kn5 propio de la app): se deforma su propio suelo,
 * hacia arriba y hacia abajo. Los triángulos de las mallas de suelo (`1ROAD_…`, `1GRASS_…`…) que
 * tocan casillas con desnivel se rehacen: lo que cae fuera de esas casillas queda plano como era y
 * lo de dentro pasa a una rejilla fina que sigue el plano del triángulo más el desnivel. Las UV y
 * las normales se interpolan del triángulo original, así que la textura del escenario no cambia.
 * El resto del escenario (muros, farolas, árboles) no se toca.
 */
import { difference, intersection, triangulate, union, type MultiPolygon } from '../../domain/geometry/polygon';
import type { Vec2 } from '../../domain/geometry/vec2';
import { reliefAt, type ReliefField } from '../../domain/relief/relief';
import { cellKey, FIELD_TILE_M } from '../../domain/strokes/strokeField';
import type { Kn5Mesh, Kn5Model, Kn5Node } from './kn5';
import { appendGridDraped, MeshData, toAc, type Vec3 } from './meshes';

/** Mallas de suelo de los escenarios (prefijos de `tools/presets/blender_export.py`). */
export const SCENE_GROUND_PREFIXES = ['1ROAD', '1GRASS', '1GRAVEL', '1SAND'] as const;

/** Lado de la rejilla donde hay desnivel (m); el resto de la casilla va en celdas de 2 m. */
const RELIEF_CELL_M = 0.5;
/** Desnivel a partir del cual una celda de 2 m se afina (m). */
const RELIEF_EPS_M = 0.001;
/** Área mínima en planta para rehacer un triángulo (m²): los verticales se dejan como están. */
const MIN_PLAN_AREA = 1e-4;

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (m: readonly number[]): boolean => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

/**
 * Devuelve el modelo con el suelo deformado (el mismo objeto si no hay desnivel). Solo se tocan
 * mallas sin transformación acumulada, como las que escribe la tubería de presets.
 */
export function deformSceneGround(model: Kn5Model, relief: ReliefField): Kn5Model {
  if (!relief.size) return model;
  const visit = (node: Kn5Node, plain: boolean): Kn5Node[] => {
    const flat = plain && (!node.matrix || isIdentity(node.matrix));
    const children = node.children.flatMap((c) => visit(c, flat));
    if (!node.mesh || !flat || !SCENE_GROUND_PREFIXES.some((k) => node.name.startsWith(k))) return [{ ...node, children }];
    return deformMesh(node.name, node.mesh, relief, children);
  };
  return { ...model, root: visit(model.root, true)[0] };
}

/** Casillas con desnivel que toca el recuadro en planta del triángulo. */
function touchedTiles(pts: readonly Vec2[], relief: ReliefField): Array<[number, number]> {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const out: Array<[number, number]> = [];
  for (let iy = Math.floor(Math.min(...ys) / FIELD_TILE_M); iy <= Math.floor(Math.max(...ys) / FIELD_TILE_M); iy++) {
    for (let ix = Math.floor(Math.min(...xs) / FIELD_TILE_M); ix <= Math.floor(Math.max(...xs) / FIELD_TILE_M); ix++) {
      if (relief.has(cellKey(ix, iy))) out.push([ix, iy]);
    }
  }
  return out;
}

function deformMesh(name: string, mesh: Kn5Mesh, relief: ReliefField, children: Kn5Node[]): Kn5Node[] {
  const { positions: P, normals: N, uvs: U } = mesh;
  const plan = (i: number): Vec2 => ({ x: P[i * 3], y: -P[i * 3 + 2] });
  const keep: number[] = [];
  const out = new MeshData();
  // Una celda de 2 m se afina si hay desnivel en alguno de sus nueve puntos de muestra.
  const nearRelief = (c: Vec2): boolean => {
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (Math.abs(reliefAt(relief, { x: c.x + dx, y: c.y + dy })) > RELIEF_EPS_M) return true;
    return false;
  };

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ids = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    const [a, b, c] = ids.map(plan);
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    const tiles = Math.abs(d) / 2 < MIN_PLAN_AREA ? [] : touchedTiles([a, b, c], relief);
    if (!tiles.length) {
      keep.push(...ids);
      continue;
    }
    // Interpolación lineal en planta de cualquier atributo de los tres vértices.
    const weights = (p: Vec2): [number, number, number] => {
      const l1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / d;
      const l2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / d;
      return [l1, l2, 1 - l1 - l2];
    };
    const lerp = (arr: Float32Array, size: number, k: number, p: Vec2): number => {
      const w = weights(p);
      return w[0] * arr[ids[0] * size + k] + w[1] * arr[ids[1] * size + k] + w[2] * arr[ids[2] * size + k];
    };
    const height = (p: Vec2): number => lerp(P, 3, 1, p);
    const uvAt = (p: Vec2): readonly [number, number] => [lerp(U, 2, 0, p), lerp(U, 2, 1, p)];
    const normalAt = (p: Vec2): Vec3 => {
      const n = [0, 1, 2].map((k) => lerp(N, 3, k, p));
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      return [n[0] / len, n[1] / len, n[2] / len];
    };
    // Orientación original del triángulo (su normal geométrica).
    const [p0, p1, p2] = ids.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const facing: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];

    const tri: MultiPolygon = [[[a, b, c]]];
    const region = union(
      tiles.map(([ix, iy]) => {
        const [x0, y0, x1, y1] = [ix * FIELD_TILE_M, iy * FIELD_TILE_M, (ix + 1) * FIELD_TILE_M, (iy + 1) * FIELD_TILE_M];
        return [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
      }),
    );
    // Fuera de las casillas con desnivel: el mismo plano, triangulado de nuevo.
    const outside = triangulate(difference(tri, region));
    const base = out.vertexCount;
    for (const v of outside.vertices) out.vertex(toAc(v, height(v)), normalAt(v), uvAt(v));
    for (let k = 0; k < outside.indices.length; k += 3) {
      out.triangle(base + outside.indices[k], base + outside.indices[k + 1], base + outside.indices[k + 2], facing);
    }
    // Dentro: rejilla que sigue el plano más el desnivel.
    const inside = intersection(tri, region);
    if (inside.length) appendGridDraped(out, inside, (p) => height(p) + reliefAt(relief, p), 0, uvAt, { step: RELIEF_CELL_M, where: nearRelief });
  }

  if (out.isEmpty) return [{ name, mesh, children }];
  const options = { castShadows: mesh.castShadows, renderable: mesh.renderable };
  const fresh = out.toKn5Meshes(mesh.material, options).map((m, i): Kn5Node => ({ name: `${name}_R${i}`, mesh: m, children: [] }));
  if (!keep.length) return [{ ...fresh[0], children }, ...fresh.slice(1)];
  return [{ name, mesh: subset(mesh, keep), children }, ...fresh];
}

/** La malla con solo los triángulos indicados (y sus vértices). */
function subset(mesh: Kn5Mesh, indices: readonly number[]): Kn5Mesh {
  const remap = new Map<number, number>();
  for (const i of indices) if (!remap.has(i)) remap.set(i, remap.size);
  const pick = (arr: Float32Array, size: number): Float32Array => {
    const out = new Float32Array(remap.size * size);
    for (const [src, dst] of remap) out.set(arr.subarray(src * size, src * size + size), dst * size);
    return out;
  };
  return {
    ...mesh,
    positions: pick(mesh.positions, 3),
    normals: pick(mesh.normals, 3),
    uvs: pick(mesh.uvs, 2),
    tangents: pick(mesh.tangents, 3),
    indices: Uint16Array.from(indices, (i) => remap.get(i)!),
  };
}
