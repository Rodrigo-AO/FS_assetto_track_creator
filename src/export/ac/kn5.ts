/**
 * Escritura del formato .kn5 (versión 5) de Assetto Corsa. Port del escritor de `acgen`
 * (proyecto ART-26D), que ya se validó cargando modelos en AC y Content Manager.
 *
 *  "sc6969", int32 versión
 *  texturas:   int32 n; {int32 activa, str nombre, int32 tamaño, bytes}
 *  materiales: int32 n; {str nombre, str shader, u8 blend, u8 alphaTested, int32 depthMode,
 *                        int32 nProps {str, f32 A, f32[2] B, f32[3] C, f32[4] D},
 *                        int32 nTex {str muestreador, int32 slot, str textura}}
 *  nodo (recursivo): int32 clase (1 dummy, 2 malla), str nombre, int32 nHijos, u8 activo,
 *     dummy: f32[16] matriz por filas (fila 0 = izquierda, 1 = arriba, 2 = avance, 3 = posición)
 *     malla: u8 sombras, u8 visible, u8 transparente, int32 nVert {pos3, normal3, uv2, tangente3},
 *            int32 nIdx u16[], int32 material, int32 capa, f32 lodIn, f32 lodOut,
 *            f32[3] centro de la esfera, f32 radio, u8 renderizable
 *
 * Sistema de AC: Y arriba, metros, dextrógiro (X × Y = Z).
 */
import { ByteWriter } from '../binary/byteWriter';

export const KN5_MAX_VERTICES = 65535;

export interface Kn5Texture {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface Kn5MaterialProperty {
  readonly name: string;
  readonly a?: number;
  readonly b?: readonly [number, number];
  readonly c?: readonly [number, number, number];
  readonly d?: readonly [number, number, number, number];
}

export interface Kn5Material {
  readonly name: string;
  readonly shader: string;
  readonly properties: readonly Kn5MaterialProperty[];
  /** (muestreador, slot, nombre de textura) */
  readonly textures: ReadonlyArray<readonly [string, number, string]>;
  readonly blend?: number;
  readonly alphaTested?: boolean;
  readonly depthMode?: number;
}

export interface Kn5Mesh {
  /** xyz por vértice. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** uv por vértice. */
  readonly uvs: Float32Array;
  readonly tangents: Float32Array;
  readonly indices: Uint16Array;
  readonly material: number;
  readonly castShadows: boolean;
  /** false oculta la malla en el render (se sigue usando para la física). */
  readonly renderable: boolean;
}

export interface Kn5Node {
  readonly name: string;
  readonly matrix?: readonly number[];
  readonly mesh?: Kn5Mesh;
  readonly children: readonly Kn5Node[];
}

export interface Kn5Model {
  readonly textures: readonly Kn5Texture[];
  readonly materials: readonly Kn5Material[];
  readonly root: Kn5Node;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Margen (m) que se suma al radio de las mallas no renderizables. AC deja de dibujar una malla
 * visible cuando una invisible tiene casi la misma esfera envolvente (los conos azules
 * desaparecían por su malla de colisión, que ocupa lo mismo). Una malla que no se dibuja no
 * pierde nada con una esfera más holgada.
 */
export const HIDDEN_SPHERE_MARGIN_M = 1;

export function boundingSphere(positions: Float32Array): { center: [number, number, number]; radius: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], positions[i + c]);
      max[c] = Math.max(max[c], positions[i + c]);
    }
  }
  const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    radius = Math.max(radius, Math.hypot(positions[i] - center[0], positions[i + 1] - center[1], positions[i + 2] - center[2]));
  }
  return { center, radius };
}

function writeNode(w: ByteWriter, node: Kn5Node): void {
  w.i32(node.mesh ? 2 : 1).string(node.name).i32(node.children.length).u8(1);
  const mesh = node.mesh;
  if (!mesh) {
    w.f32s(node.matrix ?? IDENTITY);
  } else {
    const count = mesh.positions.length / 3;
    if (count > KN5_MAX_VERTICES) throw new Error(`${node.name}: más de ${KN5_MAX_VERTICES} vértices`);
    w.u8(mesh.castShadows ? 1 : 0).u8(1).u8(0).i32(count);
    for (let v = 0; v < count; v++) {
      w.f32(mesh.positions[v * 3]).f32(mesh.positions[v * 3 + 1]).f32(mesh.positions[v * 3 + 2]);
      w.f32(mesh.normals[v * 3]).f32(mesh.normals[v * 3 + 1]).f32(mesh.normals[v * 3 + 2]);
      w.f32(mesh.uvs[v * 2]).f32(mesh.uvs[v * 2 + 1]);
      w.f32(mesh.tangents[v * 3]).f32(mesh.tangents[v * 3 + 1]).f32(mesh.tangents[v * 3 + 2]);
    }
    w.i32(mesh.indices.length);
    for (const idx of mesh.indices) w.u16(idx);
    const { center, radius } = boundingSphere(mesh.positions);
    const sphereRadius = mesh.renderable ? radius : radius + HIDDEN_SPHERE_MARGIN_M;
    w.i32(mesh.material).i32(0).f32(0).f32(0).f32s(center).f32(sphereRadius).u8(mesh.renderable ? 1 : 0);
  }
  for (const child of node.children) writeNode(w, child);
}

export function writeKn5(model: Kn5Model): Uint8Array {
  const w = new ByteWriter().ascii('sc6969').i32(5);
  w.i32(model.textures.length);
  for (const t of model.textures) w.i32(1).string(t.name).i32(t.data.length).bytes(t.data);
  w.i32(model.materials.length);
  for (const m of model.materials) {
    w.string(m.name).string(m.shader).u8(m.blend ?? 0).u8(m.alphaTested ? 1 : 0).i32(m.depthMode ?? 0);
    w.i32(m.properties.length);
    for (const p of m.properties) {
      w.string(p.name).f32(p.a ?? 0).f32s(p.b ?? [0, 0]).f32s(p.c ?? [0, 0, 0]).f32s(p.d ?? [0, 0, 0, 0]);
    }
    w.i32(m.textures.length);
    for (const [sampler, slot, texture] of m.textures) w.string(sampler).i32(slot).string(texture);
  }
  writeNode(w, model.root);
  return w.toUint8Array();
}
