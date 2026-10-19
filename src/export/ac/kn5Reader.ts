/**
 * Lectura del formato .kn5 (versiones 5 y 6) al mismo modelo que escribe `writeKn5`. Sirve para
 * retocar los escenarios 3D de los presets (kn5 propios de la app) al exportar; ver el formato en
 * `kn5.ts`. Los indicadores de malla que el modelo no guarda (visible, transparente, capa, LOD) se
 * escriben siempre igual en los kn5 de la app, así que leer y volver a escribir no pierde nada.
 */
import type { Kn5Material, Kn5MaterialProperty, Kn5Mesh, Kn5Model, Kn5Node, Kn5Texture } from './kn5';

export function readKn5(data: Uint8Array): Kn5Model {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dec = new TextDecoder('latin1');
  let p = 0;
  const i32 = (): number => {
    const v = view.getInt32(p, true);
    p += 4;
    return v;
  };
  const u8 = (): number => data[p++];
  const f32 = (): number => {
    const v = view.getFloat32(p, true);
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

  const textures: Kn5Texture[] = [];
  for (let t = i32(); t > 0; t--) {
    i32();
    const name = str();
    const size = i32();
    textures.push({ name, data: data.slice(p, p + size) });
    p += size;
  }

  const materials: Kn5Material[] = [];
  for (let m = i32(); m > 0; m--) {
    const name = str();
    const shader = str();
    const blend = u8();
    const alphaTested = u8() === 1;
    const depthMode = i32();
    const properties: Kn5MaterialProperty[] = [];
    for (let k = i32(); k > 0; k--) {
      const prop = str();
      const a = f32();
      const b: [number, number] = [f32(), f32()];
      const c: [number, number, number] = [f32(), f32(), f32()];
      const d: [number, number, number, number] = [f32(), f32(), f32(), f32()];
      properties.push({ name: prop, a, b, c, d });
    }
    const samplers: Array<readonly [string, number, string]> = [];
    for (let k = i32(); k > 0; k--) samplers.push([str(), i32(), str()]);
    materials.push({ name, shader, properties, textures: samplers, blend, alphaTested, depthMode });
  }

  const node = (): Kn5Node => {
    const cls = i32();
    const name = str();
    const count = i32();
    p += 1; // activo
    let matrix: number[] | undefined;
    let mesh: Kn5Mesh | undefined;
    if (cls === 1) {
      matrix = Array.from({ length: 16 }, f32);
    } else if (cls === 2) {
      const castShadows = u8() === 1;
      p += 2; // visible, transparente
      const n = i32();
      const positions = new Float32Array(n * 3);
      const normals = new Float32Array(n * 3);
      const uvs = new Float32Array(n * 2);
      const tangents = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        positions.set([f32(), f32(), f32()], v * 3);
        normals.set([f32(), f32(), f32()], v * 3);
        uvs.set([f32(), f32()], v * 2);
        tangents.set([f32(), f32(), f32()], v * 3);
      }
      const nIdx = i32();
      const indices = new Uint16Array(nIdx);
      for (let k = 0; k < nIdx; k++) indices[k] = view.getUint16(p + k * 2, true);
      p += nIdx * 2;
      const material = i32();
      p += 4 + 8 + 16; // capa, LOD, esfera (se recalcula al escribir)
      const renderable = u8() === 1;
      mesh = { positions, normals, uvs, tangents, indices, material, castShadows, renderable };
    } else {
      throw new Error(`Nodo kn5 de tipo ${cls} no soportado (${name})`);
    }
    const children: Kn5Node[] = [];
    for (let c = 0; c < count; c++) children.push(node());
    return { name, matrix, mesh, children };
  };
  return { textures, materials, root: node() };
}
