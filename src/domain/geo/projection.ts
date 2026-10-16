import { vec, type Vec2 } from '../geometry/vec2';

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_RADIUS_M = 6378137;
const DEG = Math.PI / 180;

/** Conversión entre coordenadas geográficas y el plano local en metros de un proyecto. */
export interface Projection {
  readonly origin: LatLng;
  toLocal(p: LatLng): Vec2;
  toLatLng(v: Vec2): LatLng;
}

/**
 * Proyección equirectangular alrededor de un origen: convierte coordenadas geográficas en
 * metros sobre un plano tangente (x este, y norte). El error es despreciable en áreas de pocos km.
 */
export class LocalProjection implements Projection {
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

/**
 * Georreferencia de un circuito de Assetto Corsa: semejanza que lleva el plano del circuito
 * (x = X de AC, y = −Z de AC) al plano tangente en `origin` (x este, y norte):
 * `enu = scale · R(rotationDeg) · ac + offset`. La calcula tools/presets/georef_circuit.py.
 */
export interface Georef {
  readonly origin: LatLng;
  readonly scale: number;
  readonly rotationDeg: number;
  readonly offset: readonly [number, number];
}

/**
 * Proyección cuyo plano local es el del circuito de AC: lo que se dibuja sobre el satélite cae
 * en las coordenadas del modelo del circuito sin más transformaciones al exportar.
 */
export class GeoreferencedProjection implements Projection {
  readonly origin: LatLng;
  private readonly tangent: LocalProjection;
  private readonly cos: number;
  private readonly sin: number;

  constructor(private readonly georef: Georef) {
    this.origin = georef.origin;
    this.tangent = new LocalProjection(georef.origin);
    this.cos = Math.cos(georef.rotationDeg * DEG);
    this.sin = Math.sin(georef.rotationDeg * DEG);
  }

  toLocal(p: LatLng): Vec2 {
    const e = this.tangent.toLocal(p);
    const { scale, offset } = this.georef;
    const dx = (e.x - offset[0]) / scale;
    const dy = (e.y - offset[1]) / scale;
    return vec(this.cos * dx + this.sin * dy, -this.sin * dx + this.cos * dy);
  }

  toLatLng(v: Vec2): LatLng {
    const { scale, offset } = this.georef;
    return this.tangent.toLatLng(
      vec(scale * (this.cos * v.x - this.sin * v.y) + offset[0], scale * (this.sin * v.x + this.cos * v.y) + offset[1]),
    );
  }
}
