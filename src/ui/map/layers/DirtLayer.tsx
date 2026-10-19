import { useMemo, useRef } from 'react';
import { DIRT_MATERIALS, DIRT_SPECS, DIRT_TILE_M, DIRT_TILE_PX, rasterizeDirt, tileKey, type DirtTile } from '../../../domain/dirt/dirt';
import type { Projection } from '../../../domain/geo/projection';
import type { StrokeField } from '../../../domain/strokes/strokeField';
import { useProjectStore } from '../../../state/projectStore';
import { useScene } from '../../editor/sceneContext';
import { RasterOverlay, type Raster } from '../RasterOverlay';
import { cachedFieldOf } from '../strokeFields';

/** Resolución de la imagen en el mapa (m por píxel): la del campo de suciedad. */
const PX_M = DIRT_TILE_M / DIRT_TILE_PX;
/** Opacidad para una densidad: una pasada se ve, varias tapan el satélite. */
const alphaFor = (density: number): number => Math.min(0.9, 2.2 * density);

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const COLORS = DIRT_MATERIALS.map((m) => rgb(DIRT_SPECS[m].mapColor));

/** Identificador estable de cada campo, para saber qué casillas han cambiado. */
const fieldIds = new WeakMap<StrokeField, number>();
let nextFieldId = 1;
function fieldId(field: StrokeField): number {
  let id = fieldIds.get(field);
  if (!id) fieldIds.set(field, (id = nextFieldId++));
  return id;
}

/**
 * Imagen de una casilla de 32 m alineada con latitud y longitud. El plano local puede estar girado
 * (circuitos de AC), así que se muestrea el recuadro lat/lng que la contiene; fuera de la casilla
 * queda transparente (lo pinta la vecina).
 */
function tileRaster(tiles: ReadonlyMap<string, DirtTile>, ix: number, iy: number, projection: Projection): Raster {
  const corners = [
    [ix, iy],
    [ix + 1, iy],
    [ix, iy + 1],
    [ix + 1, iy + 1],
  ].map(([a, b]) => projection.toLatLng({ x: a * DIRT_TILE_M, y: b * DIRT_TILE_M }));
  const lats = corners.map((c) => c.lat);
  const lngs = corners.map((c) => c.lng);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const mPerLat = 111320;
  const mPerLng = mPerLat * Math.cos((((south + north) / 2) * Math.PI) / 180);
  const width = Math.ceil(((east - west) * mPerLng) / PX_M);
  const height = Math.ceil(((north - south) * mPerLat) / PX_M);
  const layers = DIRT_MATERIALS.map((m) => tiles.get(tileKey(m, ix, iy))?.density);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) {
    const lat = north - ((j + 0.5) / height) * (north - south);
    for (let i = 0; i < width; i++) {
      const p = projection.toLocal({ lat, lng: west + ((i + 0.5) / width) * (east - west) });
      const gx = Math.floor(p.x / PX_M) - ix * DIRT_TILE_PX;
      const gy = Math.floor(p.y / PX_M) - iy * DIRT_TILE_PX;
      if (gx < 0 || gy < 0 || gx >= DIRT_TILE_PX || gy >= DIRT_TILE_PX) continue;
      // Un material encima del otro (operador «over»).
      let [r, g, b, a] = [0, 0, 0, 0];
      layers.forEach((density, m) => {
        const d = density?.[gy * DIRT_TILE_PX + gx] ?? 0;
        if (d <= 0) return;
        const am = alphaFor(d);
        const out = am + a * (1 - am);
        const [cr, cg, cb] = COLORS[m];
        r = (cr * am + r * a * (1 - am)) / out;
        g = (cg * am + g * a * (1 - am)) / out;
        b = (cb * am + b * a * (1 - am)) / out;
        a = out;
      });
      if (a > 0) data.set([r, g, b, a * 255], (j * width + i) * 4);
    }
  }
  return { image: new ImageData(data, width, height), south, west, north, east };
}

/**
 * Suciedad del Brush en el mapa: la densidad real (la misma que va a AC), con el color del
 * material y más opaca cuanto más cargada. Se actualiza mientras se pinta; solo se redibujan las
 * casillas que han cambiado.
 */
export function DirtLayer() {
  const scene = useScene();
  const project = useProjectStore((s) => s.project);
  const images = useRef(new Map<string, { sig: string; raster: Raster }>());
  const rasters = useMemo(() => {
    if (!scene || !scene.dirt.length) {
      images.current = new Map();
      return [];
    }
    const base = cachedFieldOf(project, project.dirt, scene.dirt);
    // Firma de cada casilla: los campos que la tocan. Si no cambia, la imagen sirve.
    const sigs = new Map<string, string>();
    const tiles = rasterizeDirt(scene.dirt, (stroke) => {
      const field = base(stroke);
      for (const key of field.keys()) sigs.set(key, `${sigs.get(key) ?? ''}${stroke.material}${fieldId(field)},`);
      return field;
    });
    const next = new Map<string, { sig: string; raster: Raster }>();
    for (const [key, sig] of sigs) {
      const prev = images.current.get(key);
      const [ix, iy] = key.split(':').map(Number);
      next.set(key, prev && prev.sig === sig ? prev : { sig, raster: tileRaster(tiles, ix, iy, scene.projection) });
    }
    images.current = next;
    return [...next.entries()];
  }, [scene]);

  return (
    <>
      {rasters.map(([key, { raster }]) => (
        <RasterOverlay key={key} raster={raster} pane="zones" className="dirt-image" />
      ))}
    </>
  );
}
