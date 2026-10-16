import type { Vec2 } from '../../domain/geometry/vec2';
import type { Scene } from '../../domain/project/scene';
import { SURFACES, SURFACE_TYPES } from '../../domain/surfaces/surfaceTypes';
import { createImage, strokePolyline, type Rgba, type RgbaImage } from '../binary/image';

export function surfacesIni(): string {
  return SURFACE_TYPES.map((type, i) => {
    const p = SURFACES[type].physics;
    return [
      `[SURFACE_${i}]`, `KEY=${p.key}`, `FRICTION=${p.friction}`, `DAMPING=${p.damping}`, `WAV=${p.wav}`, `WAV_PITCH=${p.wavPitch}`,
      `FF_EFFECT=${p.ffEffect}`, `DIRT_ADDITIVE=${p.dirtAdditive}`, `IS_VALID_TRACK=${p.isValidTrack}`, `BLACK_FLAG_TIME=${p.blackFlagTime}`,
      `SIN_HEIGHT=${p.sinHeight}`, `SIN_LENGTH=${p.sinLength}`, `IS_PITLANE=${p.isPitlane}`, `VIBRATION_GAIN=${p.vibrationGain}`,
      `VIBRATION_LENGTH=${p.vibrationLength}`,
    ].join('\r\n');
  }).join('\r\n\r\n') + '\r\n';
}

export interface UiTrackInfo {
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly lengthM: number;
  readonly widthM: number;
  readonly pitboxes: number;
}

export function uiTrackJson(info: UiTrackInfo): string {
  return JSON.stringify(
    {
      name: info.name,
      description: 'Circuito creado con Assetto Track Creator.',
      tags: ['circuit', 'formula student', 'cones', 'original'],
      geotags: [info.lat.toFixed(6), info.lng.toFixed(6)],
      country: '',
      city: '',
      length: String(Math.round(info.lengthM)),
      width: String(info.widthM),
      pitboxes: String(info.pitboxes),
      run: 'clockwise',
    },
    null,
    2,
  );
}

// --------------------------------------------------------------------------- minimapa

const MAP_MARGIN_PX = 20;
const MAP_MAX_SIZE_PX = 1600;

export interface MapAssets {
  readonly mapPng: RgbaImage;
  readonly mapIni: string;
  readonly outline: RgbaImage;
  readonly preview: RgbaImage;
}

/** Puntos a dibujar: la pista si existe; si no, el contorno del área. */
function mapPath(scene: Scene): { points: readonly Vec2[]; closed: boolean } {
  return scene.track
    ? { points: scene.track.samples.map((m) => m.position), closed: scene.track.closed }
    : { points: scene.area, closed: true };
}

/**
 * map.png y map.ini para el minimapa de AC. Convención (comprobada en drift, imola y magione):
 * WIDTH/HEIGHT son el tamaño de map.png y píxel = (coordenada AC + OFFSET) / SCALE_FACTOR.
 */
export function mapAssets(scene: Scene): MapAssets {
  const { points, closed } = mapPath(scene);
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => -p.y);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const scale = Math.max(1, Math.max(maxX - minX, maxZ - minZ) / (MAP_MAX_SIZE_PX - 2 * MAP_MARGIN_PX));
  const width = Math.ceil((maxX - minX) / scale) + 2 * MAP_MARGIN_PX;
  const height = Math.ceil((maxZ - minZ) / scale) + 2 * MAP_MARGIN_PX;
  const xOffset = -minX + MAP_MARGIN_PX * scale;
  const zOffset = -minZ + MAP_MARGIN_PX * scale;
  const px = points.map((p) => [(p.x + xOffset) / scale, (-p.y + zOffset) / scale] as const);

  const draw = (bg: Rgba, fg: Rgba, lineWidth: number): RgbaImage => {
    const img = createImage(width, height, bg);
    strokePolyline(img, px, lineWidth, fg, closed);
    return img;
  };
  const mapIni = [
    '[PARAMETERS]', `WIDTH=${width}`, `HEIGHT=${height}`, `MARGIN=${MAP_MARGIN_PX}`, `SCALE_FACTOR=${scale.toFixed(4)}`,
    `MAX_SIZE=${MAP_MAX_SIZE_PX}`, `X_OFFSET=${xOffset.toFixed(3)}`, `Z_OFFSET=${zOffset.toFixed(3)}`, 'DRAWING_SIZE=10',
  ].join('\r\n') + '\r\n';
  return {
    mapPng: draw([0, 0, 0, 0], [255, 255, 255, 255], 6),
    mapIni,
    outline: draw([0, 0, 0, 0], [255, 255, 255, 255], 4),
    preview: draw([239, 242, 244, 255], [75, 184, 232, 255], 8),
  };
}
