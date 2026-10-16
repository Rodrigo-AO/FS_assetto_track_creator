import type { ConeSpec } from '../../domain/cones/coneSpecs';
import { triangulate, type MultiPolygon, type Ring } from '../../domain/geometry/polygon';
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

/** Cono de Formula Student: placa base cuadrada y cuerpo troncocónico. UV v = 1 − altura relativa. */
export function appendCone(mesh: MeshData, center: Vec2, spec: ConeSpec): void {
  appendBox(mesh, center, spec.baseSize, 0, CONE_PLATE_HEIGHT, [0.5, 1]);
  const r0 = spec.baseSize * 0.42;
  const r1 = spec.baseSize * 0.07;
  const y0 = CONE_PLATE_HEIGHT;
  const y1 = spec.height;
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

/** Muro vertical de doble cara a lo largo de un anillo cerrado (límite del área). */
export function appendWall(mesh: MeshData, ring: Ring, height: number): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = -(b.y - a.y);
    const len = Math.hypot(dx, dz) || 1;
    for (const side of [1, -1]) {
      const n: Vec3 = [(side * -dz) / len, 0, (side * dx) / len];
      const quad = [toAc(a, 0), toAc(b, 0), toAc(b, height), toAc(a, height)].map((p) => mesh.vertex(p, n, [0, 0]));
      mesh.quad(quad[0], quad[1], quad[2], quad[3], n);
    }
  }
}

/** Franja plana entre dos puntos (línea pintada de salida/meta). */
export function appendStripe(mesh: MeshData, from: Vec2, to: Vec2, width: number, height: number): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = { x: (-dy / len) * (width / 2), y: (dx / len) * (width / 2) };
  const corners: Vec2[] = [
    { x: from.x + off.x, y: from.y + off.y },
    { x: to.x + off.x, y: to.y + off.y },
    { x: to.x - off.x, y: to.y - off.y },
    { x: from.x - off.x, y: from.y - off.y },
  ];
  const [a, b, c, d] = corners.map((v, i) => mesh.vertex(toAc(v, height), UP, [i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0]));
  mesh.quad(a, b, c, d, UP);
}
