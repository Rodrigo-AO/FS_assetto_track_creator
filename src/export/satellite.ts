/**
 * Descarga la imagen satélite del área (Esri World Imagery) para usarla como textura del suelo.
 * Solo funciona en el navegador (usa fetch, createImageBitmap y canvas).
 */
import type { Scene } from '../domain/project/scene';
import type { SatelliteTexture } from './ac/trackScene';

const TILE_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const TILE_SIZE = 256;
const MAX_ZOOM = 19;
/** 2048² con mipmaps ≈ 22 MB en el kn5: buen compromiso entre detalle y tamaño. */
const MAX_TEXTURE_SIZE = 2048;

/** Coordenadas de píxel Web Mercator a un zoom dado. */
function toPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

const floorPow2 = (n: number): number => 2 ** Math.floor(Math.log2(Math.max(1, n)));

async function loadTile(z: number, x: number, y: number): Promise<ImageBitmap> {
  const res = await fetch(TILE_URL(z, x, y), { mode: 'cors' });
  if (!res.ok) throw new Error(`Tesela ${z}/${x}/${y}: HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

export async function fetchSatelliteTexture(scene: Scene): Promise<SatelliteTexture> {
  const xs = scene.area.map((p) => p.x);
  const ys = scene.area.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const max = { x: Math.max(...xs), y: Math.max(...ys) };
  const nw = scene.projection.toLatLng({ x: min.x, y: max.y });
  const se = scene.projection.toLatLng({ x: max.x, y: min.y });

  // Mayor zoom cuyo recorte no supere el doble del tamaño final (luego se reescala).
  let zoom = MAX_ZOOM;
  let a = toPixel(nw.lat, nw.lng, zoom);
  let b = toPixel(se.lat, se.lng, zoom);
  while (zoom > 1 && Math.max(b.x - a.x, b.y - a.y) > MAX_TEXTURE_SIZE * 2) {
    zoom--;
    a = toPixel(nw.lat, nw.lng, zoom);
    b = toPixel(se.lat, se.lng, zoom);
  }

  const tx0 = Math.floor(a.x / TILE_SIZE);
  const ty0 = Math.floor(a.y / TILE_SIZE);
  const tx1 = Math.floor(b.x / TILE_SIZE);
  const ty1 = Math.floor(b.y / TILE_SIZE);
  const mosaic = document.createElement('canvas');
  mosaic.width = (tx1 - tx0 + 1) * TILE_SIZE;
  mosaic.height = (ty1 - ty0 + 1) * TILE_SIZE;
  const mctx = mosaic.getContext('2d')!;
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(loadTile(zoom, tx, ty).then((bmp) => mctx.drawImage(bmp, (tx - tx0) * TILE_SIZE, (ty - ty0) * TILE_SIZE)));
    }
  }
  await Promise.all(jobs);

  const width = Math.min(MAX_TEXTURE_SIZE, floorPow2(b.x - a.x));
  const height = Math.min(MAX_TEXTURE_SIZE, floorPow2(b.y - a.y));
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mosaic, a.x - tx0 * TILE_SIZE, a.y - ty0 * TILE_SIZE, b.x - a.x, b.y - a.y, 0, 0, width, height);
  const data = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
  return { image: { width, height, data }, min, max };
}
