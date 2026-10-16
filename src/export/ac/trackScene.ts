import { CONE_COLORS, CONE_SPECS } from '../../domain/cones/coneSpecs';
import { leftNormal, scale, sub, type Vec2 } from '../../domain/geometry/vec2';
import type { Scene } from '../../domain/project/scene';
import type { SurfaceType, TrackProject } from '../../domain/project/types';
import { SURFACES } from '../../domain/surfaces/surfaceTypes';
import { sampleAt } from '../../domain/track/centerline';
import { gateCenter, gateForward, gateTrackPosition, type LocalGate } from '../../domain/track/gates';
import { encodeDds } from '../binary/dds';
import type { RgbaImage } from '../binary/image';
import type { Kn5Material, Kn5Model, Kn5Node, Kn5Texture } from './kn5';
import { appendBox, appendCone, appendGround, appendStripe, appendWall, MeshData } from './meshes';
import { layoutSurfaces } from './surfaceLayout';
import { coneTexture, solidTexture, SURFACE_TILE_METERS, surfaceTexture } from './textures';

export interface SatelliteTexture {
  readonly image: RgbaImage;
  /** Extensión que cubre la imagen en metros locales. */
  readonly min: Vec2;
  readonly max: Vec2;
}

export interface SceneOptions {
  readonly pitCount: number;
  readonly perimeterWalls: boolean;
  readonly satellite: SatelliteTexture | null;
}

export interface Pose {
  readonly position: Vec2;
  /** Dirección de avance unitaria. */
  readonly forward: Vec2;
}

const GRID_FIRST_OFFSET_M = 4;
const GRID_SPACING_M = 8;
const HOTLAP_OFFSET_M = 20;
const DUMMY_HEIGHT_M = 0.2;
const WALL_HEIGHT_M = 1.5;

// --------------------------------------------------------------------------- posiciones de salida

/** Parrilla detrás de la línea de salida/meta, siguiendo la pista si existe. */
export function gridPoses(scene: Scene, gate: LocalGate, count: number, firstOffset = GRID_FIRST_OFFSET_M): Pose[] {
  return Array.from({ length: count }, (_, i) => {
    const back = firstOffset + i * GRID_SPACING_M;
    if (scene.track) {
      const m = sampleAt(scene.track, gateTrackPosition(scene.track, gate) - back);
      return { position: m.position, forward: m.tangent };
    }
    const forward = gateForward(gate);
    return { position: sub(gateCenter(gate), scale(forward, back)), forward };
  });
}

/** Matriz de dummy de AC: filas izquierda, arriba, avance y posición. */
function dummyMatrix(position: Vec2, forward: Vec2): number[] {
  const left = leftNormal(forward);
  return [left.x, 0, -left.y, 0, 0, 1, 0, 0, forward.x, 0, -forward.y, 0, position.x, DUMMY_HEIGHT_M, -position.y, 1];
}

const dummy = (name: string, pose: Pose): Kn5Node => ({ name, matrix: dummyMatrix(pose.position, pose.forward), children: [] });

function timingDummies(index: number, gate: LocalGate): Kn5Node[] {
  const forward = gateForward(gate);
  return [dummy(`AC_TIME_${index}_L`, { position: gate.left, forward }), dummy(`AC_TIME_${index}_R`, { position: gate.right, forward })];
}

// --------------------------------------------------------------------------- materiales

class MaterialLibrary {
  readonly textures: Kn5Texture[] = [];
  readonly materials: Kn5Material[] = [];
  private readonly index = new Map<string, number>();

  /** Material ksPerPixel con una textura difusa; devuelve su índice. */
  diffuse(name: string, image: () => RgbaImage, specular = 0.05): number {
    const existing = this.index.get(name);
    if (existing !== undefined) return existing;
    const texture = `${name.toLowerCase()}.dds`;
    this.textures.push({ name: texture, data: encodeDds(image()) });
    this.materials.push({
      name,
      shader: 'ksPerPixel',
      properties: [
        { name: 'ksAmbient', a: 0.4 }, { name: 'ksDiffuse', a: 0.45 }, { name: 'ksSpecular', a: specular },
        { name: 'ksSpecularEXP', a: 20 }, { name: 'ksEmissive', a: 0 }, { name: 'ksAlphaRef', a: 0 },
      ],
      textures: [['txDiffuse', 0, texture]],
    });
    this.index.set(name, this.materials.length - 1);
    return this.materials.length - 1;
  }
}

// --------------------------------------------------------------------------- escena

function meshNodes(prefix: string, mesh: MeshData, material: number, physics: boolean, renderable = true): Kn5Node[] {
  if (mesh.isEmpty) return [];
  return mesh
    .toKn5Meshes(material, { castShadows: renderable && !physics, renderable })
    .map((m, i) => ({ name: `${prefix}_${i}`, mesh: m, children: [] }));
}

function surfaceUv(type: SurfaceType): (v: Vec2) => readonly [number, number] {
  const tile = SURFACE_TILE_METERS[type];
  return (v) => [v.x / tile, -v.y / tile];
}

/**
 * Construye el modelo kn5 de la pista. Las mallas físicas siguen la convención de Kunos:
 * un número seguido de la clave de superficie (`1ROAD_…`, `1GRASS_…`, `1WALL_…`).
 */
export function buildTrackModel(project: TrackProject, scene: Scene, options: SceneOptions): Kn5Model {
  const lib = new MaterialLibrary();
  const children: Kn5Node[] = [];

  for (const layer of layoutSurfaces(project, scene)) {
    const key = SURFACES[layer.type].physics.key;
    const useSatellite = layer.role === 'base' && options.satellite !== null;
    const mesh = new MeshData();
    if (useSatellite) {
      const { min, max, image } = options.satellite!;
      appendGround(mesh, layer.area, 0, (v) => [(v.x - min.x) / (max.x - min.x), (max.y - v.y) / (max.y - min.y)]);
      children.push(...meshNodes(`1${key}_BASE`, mesh, lib.diffuse('ATC_SATELLITE', () => image), true));
    } else {
      appendGround(mesh, layer.area, 0, surfaceUv(layer.type));
      const material = lib.diffuse(`ATC_${layer.type.toUpperCase()}`, () => surfaceTexture(layer.type));
      children.push(...meshNodes(`1${key}_${layer.role.toUpperCase()}`, mesh, material, true));
    }
  }

  const allCones = [...scene.cones, ...scene.autoCones];
  for (const color of CONE_COLORS) {
    const spec = CONE_SPECS[color];
    const mesh = new MeshData();
    for (const cone of allCones.filter((c) => c.color === color)) appendCone(mesh, cone.position, spec);
    children.push(...meshNodes(`CONES_${color.toUpperCase()}`, mesh, lib.diffuse(`ATC_CONE_${color.toUpperCase()}`, () => coneTexture(spec), 0.2), false));
  }

  const hiddenMaterial = lib.diffuse('ATC_WHITE', () => solidTexture([255, 255, 255]));
  if (project.conesCollidable && allCones.length) {
    const hitboxes = new MeshData();
    for (const cone of allCones) {
      const spec = CONE_SPECS[cone.color];
      appendBox(hitboxes, cone.position, spec.baseSize, 0, spec.height);
    }
    children.push(...meshNodes('1WALL_CONES', hitboxes, hiddenMaterial, true, false));
  }
  if (options.perimeterWalls) {
    const walls = new MeshData();
    appendWall(walls, scene.area, WALL_HEIGHT_M);
    children.push(...meshNodes('1WALL_LIMIT', walls, hiddenMaterial, true, false));
  }

  if (scene.startFinish) {
    const line = new MeshData();
    appendStripe(line, scene.startFinish.left, scene.startFinish.right, 0.3, 0.004);
    children.push(...meshNodes('LINE_START_FINISH', line, hiddenMaterial, false));
    const grid = gridPoses(scene, scene.startFinish, options.pitCount);
    grid.forEach((pose, i) => children.push(dummy(`AC_START_${i}`, pose), dummy(`AC_PIT_${i}`, pose)));
    const [hotlap] = gridPoses(scene, scene.startFinish, 1, HOTLAP_OFFSET_M);
    children.push(dummy('AC_HOTLAP_START_0', hotlap));
    children.push(...timingDummies(0, scene.startFinish));
    scene.sectors.forEach((sector, i) => children.push(...timingDummies(i + 1, sector.gate)));
  }

  return { textures: lib.textures, materials: lib.materials, root: { name: 'ATC_ROOT', children } };
}
