import type { ConeSpec } from '../../domain/cones/coneSpecs';
import { intersection, pointInRing, triangulate, type MultiPolygon, type Ring } from '../../domain/geometry/polygon';
import type { Vec2 } from '../../domain/geometry/vec2';
import { KN5_MAX_VERTICES, type Kn5Mesh } from './kn5';

export type Vec3 = readonly [number, number, number];

/** Plano local (x este, y norte) → AC (X este, Y arriba, Z sur). */
export const toAc = (v: Vec2, height: number): Vec3 => [v.x, height, -v.y];

const UP: Vec3 = [0, 1, 0];

/** Geometría acumulada sin límite de vértices; se trocea al convertirla a kn5. */
export class MeshData {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly tangents: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  vertex(p: Vec3, n: Vec3, uv: readonly [number, number], tangent: Vec3 = [1, 0, 0]): number {
    this.positions.push(...p);
    this.normals.push(...n);
    this.uvs.push(...uv);
    this.tangents.push(...tangent);
    return this.vertexCount - 1;
  }

  /** Añade un triángulo orientado para que su normal geométrica apunte hacia `facing`. */
  triangle(a: number, b: number, c: number, facing: Vec3): void {
    const p = (i: number): Vec3 => [this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]];
    const [p0, p1, p2] = [p(a), p(b), p(c)];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ok = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] >= 0;
    this.indices.push(...(ok ? [a, b, c] : [a, c, b]));
  }

  quad(a: number, b: number, c: number, d: number, facing: Vec3): void {
    this.triangle(a, b, c, facing);
    this.triangle(a, c, d, facing);
  }

  /** Trocea por triángulos en mallas de como máximo 65 535 vértices. */
  toKn5Meshes(material: number, options: { castShadows: boolean; renderable: boolean }): Kn5Mesh[] {
    const meshes: Kn5Mesh[] = [];
    let remap = new Map<number, number>();
    let chunk: number[] = [];
    const flush = (): void => {
      if (chunk.length === 0) return;
      const order = [...remap.entries()].sort((x, y) => x[1] - y[1]).map(([src]) => src);
      const pick = (arr: number[], size: number): Float32Array => {
        const out = new Float32Array(order.length * size);
        order.forEach((src, i) => out.set(arr.slice(src * size, src * size + size), i * size));
        return out;
      };
      meshes.push({
        positions: pick(this.positions, 3), normals: pick(this.normals, 3), uvs: pick(this.uvs, 2), tangents: pick(this.tangents, 3),
        indices: Uint16Array.from(chunk), material, ...options,
      });
      remap = new Map();
      chunk = [];
    };
    for (let t = 0; t < this.indices.length; t += 3) {
      const tri = this.indices.slice(t, t + 3);
      const fresh = tri.filter((i) => !remap.has(i)).length;
      if (remap.size + fresh > KN5_MAX_VERTICES) flush();
      for (const i of tri) {
        if (!remap.has(i)) remap.set(i, remap.size);
        chunk.push(remap.get(i)!);
      }
    }
    flush();
    return meshes;
  }
}

/** Suelo plano a la altura dada con UV planares. */
export function appendGround(mesh: MeshData, area: MultiPolygon, height: number, uvOf: (v: Vec2) => readonly [number, number]): void {
  const { vertices, indices } = triangulate(area);
  const base = mesh.vertexCount;
  for (const v of vertices) mesh.vertex(toAc(v, height), UP, uvOf(v));
  for (let i = 0; i < indices.length; i += 3) mesh.triangle(base + indices[i], base + indices[i + 1], base + indices[i + 2], UP);
}

const CONE_SEGMENTS = 16;
const CONE_PLATE_HEIGHT = 0.012;

/** Cota del suelo (Y de AC) en un punto del plano local. */
export type Ground = (v: Vec2) => number;
export const FLAT_GROUND: Ground = () => 0;

/** Cono de Formula Student: placa base cuadrada y cuerpo troncocónico. UV v = 1 − altura relativa. */
export function appendCone(mesh: MeshData, center: Vec2, spec: ConeSpec, baseY = 0): void {
  appendBox(mesh, center, spec.baseSize, baseY, baseY + CONE_PLATE_HEIGHT, [0.5, 1]);
  const r0 = spec.baseSize * 0.42;
  const r1 = spec.baseSize * 0.07;
  const y0 = baseY + CONE_PLATE_HEIGHT;
  const y1 = baseY + spec.height;
  const slope = (r0 - r1) / (y1 - y0);
  const ring = (r: number, y: number, hf: number): number[] =>
    Array.from({ length: CONE_SEGMENTS + 1 }, (_, j) => {
      const a = (j / CONE_SEGMENTS) * Math.PI * 2;
      const dir: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      const nLen = Math.hypot(1, slope);
      const normal: Vec3 = [dir[0] / nLen, slope / nLen, dir[2] / nLen];
      return mesh.vertex([center.x + dir[0] * r, y, -center.y + dir[2] * r], normal, [j / CONE_SEGMENTS, 1 - hf], [-dir[2], 0, dir[0]]);
    });
  const bottom = ring(r0, y0, 0);
  const top = ring(r1, y1, 1);
  for (let j = 0; j < CONE_SEGMENTS; j++) {
    const a = (j / CONE_SEGMENTS) * Math.PI * 2 + Math.PI / CONE_SEGMENTS;
    mesh.quad(bottom[j], bottom[j + 1], top[j + 1], top[j], [Math.cos(a), slope, Math.sin(a)]);
  }
  const tip = mesh.vertex([center.x, y1, -center.y], UP, [0.5, 0]);
  for (let j = 0; j < CONE_SEGMENTS; j++) mesh.triangle(top[j], top[j + 1], tip, UP);
}

/** Caja de base cuadrada con caras hacia fuera (placa de cono o hitbox). */
export function appendBox(mesh: MeshData, center: Vec2, size: number, y0: number, y1: number, uv: readonly [number, number] = [0.5, 0.5]): void {
  const h = size / 2;
  const cx = center.x;
  const cz = -center.y;
  const faces: Array<{ n: Vec3; corners: Vec3[] }> = [
    { n: [0, 1, 0], corners: [[cx - h, y1, cz - h], [cx + h, y1, cz - h], [cx + h, y1, cz + h], [cx - h, y1, cz + h]] },
    { n: [0, -1, 0], corners: [[cx - h, y0, cz - h], [cx - h, y0, cz + h], [cx + h, y0, cz + h], [cx + h, y0, cz - h]] },
    { n: [1, 0, 0], corners: [[cx + h, y0, cz - h], [cx + h, y0, cz + h], [cx + h, y1, cz + h], [cx + h, y1, cz - h]] },
    { n: [-1, 0, 0], corners: [[cx - h, y0, cz - h], [cx - h, y1, cz - h], [cx - h, y1, cz + h], [cx - h, y0, cz + h]] },
    { n: [0, 0, 1], corners: [[cx - h, y0, cz + h], [cx - h, y1, cz + h], [cx + h, y1, cz + h], [cx + h, y0, cz + h]] },
    { n: [0, 0, -1], corners: [[cx - h, y0, cz - h], [cx + h, y0, cz - h], [cx + h, y1, cz - h], [cx - h, y1, cz - h]] },
  ];
  for (const { n, corners } of faces) {
    const [a, b, c, d] = corners.map((p) => mesh.vertex(p, n, uv));
    mesh.quad(a, b, c, d, n);
  }
}

/** Paso con el que se adaptan al relieve los muros, líneas y zonas (m). */
const DRAPE_STEP_M = 1;

/** Muro vertical de doble cara a lo largo de un anillo cerrado (límite del área), apoyado en el suelo. */
export function appendWall(mesh: MeshData, ring: Ring, height: number, ground: Ground = FLAT_GROUND): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = -(b.y - a.y);
    const len = Math.hypot(dx, dz) || 1;
    const steps = Math.max(1, Math.ceil(len / DRAPE_STEP_M));
    for (let k = 0; k < steps; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      const q = { x: a.x + ((b.x - a.x) * (k + 1)) / steps, y: a.y + ((b.y - a.y) * (k + 1)) / steps };
      const gp = ground(p) - 0.3;
      const gq = ground(q) - 0.3;
      for (const side of [1, -1]) {
        const n: Vec3 = [(side * -dz) / len, 0, (side * dx) / len];
        const quad = [toAc(p, gp), toAc(q, gq), toAc(q, gq + height), toAc(p, gp + height)].map((v) => mesh.vertex(v, n, [0, 0]));
        mesh.quad(quad[0], quad[1], quad[2], quad[3], n);
      }
    }
  }
}

/** Franja entre dos puntos (línea pintada de salida/meta), a `lift` metros sobre el suelo. */
export function appendStripe(mesh: MeshData, from: Vec2, to: Vec2, width: number, lift: number, ground: Ground = FLAT_GROUND): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = { x: (-dy / len) * (width / 2), y: (dx / len) * (width / 2) };
  const steps = Math.max(1, Math.ceil(len / (DRAPE_STEP_M / 2)));
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps;
    const t1 = (k + 1) / steps;
    const at = (t: number, s: number): Vec2 => ({ x: from.x + dx * t + off.x * s, y: from.y + dy * t + off.y * s });
    const corners = [at(t0, 1), at(t1, 1), at(t1, -1), at(t0, -1)];
    const uvs: Array<[number, number]> = [[t0, 0], [t1, 0], [t1, 1], [t0, 1]];
    const [a, b, c, d] = corners.map((v, i) => mesh.vertex(toAc(v, ground(v) + lift), UP, uvs[i]));
    mesh.quad(a, b, c, d, UP);
  }
}

/** Zonas donde el suelo se subdivide más fino (p. ej. donde hay desniveles pintados). */
export interface DrapeRefinement {
  readonly step: number;
  readonly where: (p: Vec2) => boolean;
}

/**
 * Suelo que sigue el relieve: triangula y subdivide hasta lados de ~1 m (o `refine.step` donde
 * `refine.where`), a `lift` metros sobre el terreno.
 */
export function appendDraped(
  mesh: MeshData,
  area: MultiPolygon,
  ground: Ground,
  lift: number,
  uvOf: (v: Vec2) => readonly [number, number],
  refine?: DrapeRefinement,
): void {
  const { vertices, indices } = triangulate(area);
  const tris: Array<[Vec2, Vec2, Vec2]> = [];
  for (let i = 0; i < indices.length; i += 3) tris.push([vertices[indices[i]], vertices[indices[i + 1]], vertices[indices[i + 2]]]);
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const edge = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
  const limit = (a: Vec2, b: Vec2, c: Vec2): number =>
    refine && (refine.where(a) || refine.where(b) || refine.where(c)) ? refine.step : DRAPE_STEP_M;
  while (tris.length) {
    const [a, b, c] = tris.pop()!;
    if (Math.max(edge(a, b), edge(b, c), edge(c, a)) > limit(a, b, c)) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      tris.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      continue;
    }
    const [i, j, k] = [a, b, c].map((v) => mesh.vertex(toAc(v, ground(v) + lift), UP, uvOf(v)));
    mesh.triangle(i, j, k, UP);
  }
}

/** Celda gruesa de la malla en rejilla (m). */
const GRID_COARSE_M = 2;

function insideMultiPolygon(p: Vec2, mp: MultiPolygon): boolean {
  return mp.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((hole) => pointInRing(p, hole)));
}

/**
 * Suelo en rejilla regular con vértices compartidos (para el suelo con desniveles): celdas de 2 m,
 * divididas en celdas de `refine.step` donde `refine.where` (en el centro de la celda gruesa). Las
 * celdas que cruza el borde del polígono se recortan con él y se subdividen como `appendDraped`.
 * A diferencia de subdividir la triangulación del polígono, no multiplica las astillas finas.
 */
export function appendGridDraped(
  mesh: MeshData,
  area: MultiPolygon,
  ground: Ground,
  lift: number,
  uvOf: (v: Vec2) => readonly [number, number],
  refine?: DrapeRefinement,
): void {
  const all = area.flatMap((poly) => poly.flat());
  if (!all.length) return;
  const x0 = Math.floor(Math.min(...all.map((p) => p.x)) / GRID_COARSE_M) * GRID_COARSE_M;
  const y0 = Math.floor(Math.min(...all.map((p) => p.y)) / GRID_COARSE_M) * GRID_COARSE_M;
  const nx = Math.ceil((Math.max(...all.map((p) => p.x)) - x0) / GRID_COARSE_M);
  const ny = Math.ceil((Math.max(...all.map((p) => p.y)) - y0) / GRID_COARSE_M);

  // Celdas gruesas que toca algún lado del polígono: esas se recortan; el resto, dentro o fuera.
  const edgeCells = new Set<number>();
  for (const poly of area) {
    for (const ring of poly) {
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % ring.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (GRID_COARSE_M / 16)));
        for (let s = 0; s <= steps; s++) {
          const x = a.x + ((b.x - a.x) * s) / steps;
          const y = a.y + ((b.y - a.y) * s) / steps;
          const ci = Math.floor((x - x0) / GRID_COARSE_M);
          const cj = Math.floor((y - y0) / GRID_COARSE_M);
          edgeCells.add(cj * (nx + 1) + ci);
        }
      });
    }
  }

  const shared = new Map<string, number>();
  const vertex = (p: Vec2): number => {
    const key = `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
    let v = shared.get(key);
    if (v === undefined) {
      v = mesh.vertex(toAc(p, ground(p) + lift), UP, uvOf(p));
      shared.set(key, v);
    }
    return v;
  };
  for (let cj = 0; cj < ny; cj++) {
    for (let ci = 0; ci < nx; ci++) {
      const cx = x0 + ci * GRID_COARSE_M;
      const cy = y0 + cj * GRID_COARSE_M;
      const center = { x: cx + GRID_COARSE_M / 2, y: cy + GRID_COARSE_M / 2 };
      const fine = refine?.where(center) ?? false;
      const step = fine ? refine!.step : GRID_COARSE_M;
      if (edgeCells.has(cj * (nx + 1) + ci)) {
        const cell: MultiPolygon = [[[{ x: cx, y: cy }, { x: cx + GRID_COARSE_M, y: cy }, { x: cx + GRID_COARSE_M, y: cy + GRID_COARSE_M }, { x: cx, y: cy + GRID_COARSE_M }]]];
        const piece = intersection(cell, area);
        if (piece.length) appendDraped(mesh, piece, ground, lift, uvOf, fine ? refine : undefined);
        continue;
      }
      if (!insideMultiPolygon(center, area)) continue;
      const n = Math.round(GRID_COARSE_M / step);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const q = (di: number, dj: number) => vertex({ x: cx + (i + di) * step, y: cy + (j + dj) * step });
          mesh.quad(q(0, 0), q(1, 0), q(1, 1), q(0, 1), UP);
        }
      }
    }
  }
}
