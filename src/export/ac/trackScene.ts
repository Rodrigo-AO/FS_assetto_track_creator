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
import { appendBox, appendCone, appendDraped, appendGridDraped, appendGround, appendStripe, appendWall, FLAT_GROUND, MeshData, type Ground } from './meshes';
import { layoutSurfaces } from './surfaceLayout';
import { appendDirtDecal, appendDirtPhysics, dirtDecalImage } from './dirtMeshes';
import { appendReliefPatch } from './reliefMeshes';
import { rasterizeRelief, reliefAt, reliefTileHasData } from '../../domain/relief/relief';
import { DIRT_MATERIALS, DIRT_SPECS, rasterizeDirt } from '../../domain/dirt/dirt';
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
  /**
   * Escenario 3D de un preset o circuito de AC: aporta el suelo físico y el relieve. El kn5 de la
   * pista solo lleva entonces conos, líneas, muros y dummies apoyados en `ground`, más las zonas
   * dibujadas si `zones` no es false (sobre un circuito no se genera ningún suelo).
   */
  readonly environment?: { readonly ground: Ground; readonly zones?: boolean } | null;
}

/** Lado de los triángulos del suelo propio donde hay desniveles (m). */
const RELIEF_DRAPE_STEP_M = 0.5;

/** Lado de las casillas en que se agrupan los conos en mallas (m). */
const CONE_TILE_M = 25;

/** Elevación de las zonas dibujadas sobre el suelo de un preset (evita coincidir con él). */
const ZONE_LIFT_M = 0.02;

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
function dummyMatrix(position: Vec2, forward: Vec2, y: number): number[] {
  const left = leftNormal(forward);
  return [left.x, 0, -left.y, 0, 0, 1, 0, 0, forward.x, 0, -forward.y, 0, position.x, y, -position.y, 1];
}

const dummy = (name: string, pose: Pose, ground: Ground): Kn5Node => ({
  name,
  matrix: dummyMatrix(pose.position, pose.forward, ground(pose.position) + DUMMY_HEIGHT_M),
  children: [],
});

function timingDummies(index: number, gate: LocalGate, ground: Ground): Kn5Node[] {
  const forward = gateForward(gate);
  return [
    dummy(`AC_TIME_${index}_L`, { position: gate.left, forward }, ground),
    dummy(`AC_TIME_${index}_R`, { position: gate.right, forward }, ground),
  ];
}

// --------------------------------------------------------------------------- materiales

/** Suelos generados por la app (texturas oscuras, calibradas con estos valores). */
const SURFACE_LIGHT = { ambient: 0.4, diffuse: 0.45 };
/** Conos: valores de Kunos para objetos; con los de suelo el naranja se veía amarillo in-game. */
const CONE_LIGHT = { ambient: 0.3, diffuse: 0.25 };

class MaterialLibrary {
  readonly textures: Kn5Texture[] = [];
  readonly materials: Kn5Material[] = [];
  private readonly index = new Map<string, number>();

  /** Material ksPerPixel con una textura difusa; devuelve su índice. */
  diffuse(name: string, image: () => RgbaImage, specular = 0.05, light: Readonly<{ ambient: number; diffuse: number }> = SURFACE_LIGHT): number {
    const existing = this.index.get(name);
    if (existing !== undefined) return existing;
    const texture = `${name.toLowerCase()}.dds`;
    this.textures.push({ name: texture, data: encodeDds(image()) });
    this.materials.push({
      name,
      shader: 'ksPerPixel',
      properties: [
        { name: 'ksAmbient', a: light.ambient }, { name: 'ksDiffuse', a: light.diffuse }, { name: 'ksSpecular', a: specular },
        { name: 'ksSpecularEXP', a: 20 }, { name: 'ksEmissive', a: 0 }, { name: 'ksAlphaRef', a: 0 },
      ],
      textures: [['txDiffuse', 0, texture]],
    });
    this.index.set(name, this.materials.length - 1);
    return this.materials.length - 1;
  }

  /**
   * Calca semitransparente sobre el suelo, como las manchas de los circuitos de Kunos: ksPerPixel
   * con mezcla alfa (blend 1) y profundidad de solo lectura (depthMode 1).
   */
  decal(name: string, image: RgbaImage): number {
    const index = this.diffuse(name, () => image, 0.02, CONE_LIGHT);
    this.materials[index] = { ...this.materials[index], blend: 1, depthMode: 1 };
    return index;
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
  const env = options.environment ?? null;
  // Desnivelador: en mapa libre deforma el propio suelo (sube y baja); sobre un escenario o un
  // circuito solo puede subir, con un parche encima de su suelo.
  const relief = rasterizeRelief(scene.relief);
  const base: Ground = env?.ground ?? FLAT_GROUND;
  const ground: Ground = !relief.size ? base : env ? (p) => base(p) + Math.max(0, reliefAt(relief, p)) : (p) => reliefAt(relief, p);
  const refine = relief.size ? { step: RELIEF_DRAPE_STEP_M, where: (p: Vec2) => reliefTileHasData(relief, p) } : undefined;

  const layers = env?.zones === false ? [] : layoutSurfaces(project, scene, env === null);
  for (const layer of layers) {
    const key = SURFACES[layer.type].physics.key;
    const useSatellite = layer.role === 'base' && options.satellite !== null;
    const mesh = new MeshData();
    // Suelo propio plano salvo que haya desniveles: entonces sigue el desnivel, más fino donde lo hay.
    const lay = (uv: (v: Vec2) => readonly [number, number], lift = 0): void =>
      relief.size
        ? appendGridDraped(mesh, layer.area, ground, lift, uv, refine)
        : env
          ? appendDraped(mesh, layer.area, ground, lift, uv)
          : appendGround(mesh, layer.area, 0, uv);
    if (env) {
      lay(surfaceUv(layer.type), ZONE_LIFT_M);
      const material = lib.diffuse(`ATC_${layer.type.toUpperCase()}`, () => surfaceTexture(layer.type));
      children.push(...meshNodes(`1${key}_${layer.role.toUpperCase()}`, mesh, material, true));
    } else if (useSatellite) {
      const { min, max, image } = options.satellite!;
      lay((v) => [(v.x - min.x) / (max.x - min.x), (max.y - v.y) / (max.y - min.y)]);
      children.push(...meshNodes(`1${key}_BASE`, mesh, lib.diffuse('ATC_SATELLITE', () => image), true));
    } else {
      lay(surfaceUv(layer.type));
      const material = lib.diffuse(`ATC_${layer.type.toUpperCase()}`, () => surfaceTexture(layer.type));
      children.push(...meshNodes(`1${key}_${layer.role.toUpperCase()}`, mesh, material, true));
    }
  }

  if (env && relief.size) {
    const surface = project.baseSurface;
    const patch = new MeshData();
    if (appendReliefPatch(patch, relief, base, surfaceUv(surface))) {
      const material = lib.diffuse(`ATC_${surface.toUpperCase()}`, () => surfaceTexture(surface));
      children.push(...meshNodes(`1${SURFACES[surface].physics.key}_RELIEF`, patch, material, true));
    }
  }

  const hiddenMaterial = lib.diffuse('ATC_WHITE', () => solidTexture([255, 255, 255]));

  // Suciedad del Brush: calca visual por casilla y física invisible por nivel de densidad.
  const dirtTiles = [...rasterizeDirt(scene.dirt).values()];
  for (const material of DIRT_MATERIALS) {
    const physics: [MeshData, MeshData, MeshData] = [new MeshData(), new MeshData(), new MeshData()];
    let decals = 0;
    for (const tile of dirtTiles.filter((t) => t.material === material)) {
      const decal = new MeshData();
      if (!appendDirtDecal(decal, tile, ground)) continue;
      const name = `ATC_DIRT_${material.toUpperCase()}_${tile.ix}_${tile.iy}`;
      const index = lib.decal(name, dirtDecalImage(tile));
      decal.toKn5Meshes(index, { castShadows: false, renderable: true }).forEach((mesh, i) =>
        children.push({ name: `DIRT_${material.toUpperCase()}_${decals}_${i}`, mesh, children: [] }),
      );
      decals++;
      appendDirtPhysics(physics, tile, ground);
    }
    physics.forEach((mesh, level) => children.push(...meshNodes(`1${DIRT_SPECS[material].levels[level].key}`, mesh, hiddenMaterial, true, false)));
  }

  // Conos en mallas por casillas de CONE_TILE_M, como trocea Kunos sus pistas: con una sola malla
  // de ~50 m por color, AC dejaba a veces de dibujar la azul (la sombra sí salía).
  const allCones = [...scene.cones, ...scene.autoCones];
  for (const color of CONE_COLORS) {
    const spec = CONE_SPECS[color];
    const material = lib.diffuse(`ATC_CONE_${color.toUpperCase()}`, () => coneTexture(spec), 0.2, CONE_LIGHT);
    const tiles = new Map<string, MeshData>();
    for (const cone of allCones.filter((c) => c.color === color)) {
      const key = `${Math.floor(cone.position.x / CONE_TILE_M)}_${Math.floor(cone.position.y / CONE_TILE_M)}`;
      if (!tiles.has(key)) tiles.set(key, new MeshData());
      appendCone(tiles.get(key)!, cone.position, spec, ground(cone.position));
    }
    [...tiles.values()].forEach((mesh, i) => children.push(...meshNodes(`CONES_${color.toUpperCase()}_${i}`, mesh, material, false)));
  }

  if (project.conesCollidable && allCones.length) {
    const hitboxes = new MeshData();
    for (const cone of allCones) {
      const spec = CONE_SPECS[cone.color];
      const g = ground(cone.position);
      appendBox(hitboxes, cone.position, spec.baseSize, g, g + spec.height);
    }
    children.push(...meshNodes('1WALL_CONES', hitboxes, hiddenMaterial, true, false));
  }
  if (options.perimeterWalls) {
    const walls = new MeshData();
    appendWall(walls, scene.area, WALL_HEIGHT_M, ground);
    children.push(...meshNodes('1WALL_LIMIT', walls, hiddenMaterial, true, false));
  }

  if (scene.startFinish) {
    const line = new MeshData();
    appendStripe(line, scene.startFinish.left, scene.startFinish.right, 0.3, env ? 0.012 : 0.004, ground);
    children.push(...meshNodes('LINE_START_FINISH', line, hiddenMaterial, false));
    const grid = gridPoses(scene, scene.startFinish, options.pitCount);
    grid.forEach((pose, i) => children.push(dummy(`AC_START_${i}`, pose, ground), dummy(`AC_PIT_${i}`, pose, ground)));
    const [hotlap] = gridPoses(scene, scene.startFinish, 1, HOTLAP_OFFSET_M);
    children.push(dummy('AC_HOTLAP_START_0', hotlap, ground));
    children.push(...timingDummies(0, scene.startFinish, ground));
    scene.sectors.forEach((sector, i) => children.push(...timingDummies(i + 1, sector.gate, ground)));
  }

  return { textures: lib.textures, materials: lib.materials, root: { name: 'ATC_ROOT', children } };
}
