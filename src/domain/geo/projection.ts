import { vec, type Vec2 } from '../geometry/vec2';

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_RADIUS_M = 6378137;
const DEG = Math.PI / 180;

/**
 * Proyección equirectangular alrededor de un origen: convierte coordenadas geográficas en
 * metros sobre un plano tangente (x este, y norte). El error es despreciable en áreas de pocos km.
 */
export class LocalProjection {
  private readonly metersPerDegLat: number;
  private readonly metersPerDegLng: number;

  constructor(readonly origin: LatLng) {
    this.metersPerDegLat = EARTH_RADIUS_M * DEG;
    this.metersPerDegLng = EARTH_RADIUS_M * DEG * Math.cos(origin.lat * DEG);
  }

  toLocal(p: LatLng): Vec2 {
    return vec((p.lng - this.origin.lng) * this.metersPerDegLng, (p.lat - this.origin.lat) * this.metersPerDegLat);
  }

  toLatLng(v: Vec2): LatLng {
    return { lat: this.origin.lat + v.y / this.metersPerDegLat, lng: this.origin.lng + v.x / this.metersPerDegLng };
  }

  /** Proyección centrada en el centroide de los vértices de un polígono. */
  static centeredOn(points: readonly LatLng[]): LocalProjection {
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    return new LocalProjection({ lat, lng });
  }
}
