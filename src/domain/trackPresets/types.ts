import type { ConeColor } from '../project/types';

/** Punto en el plano propio del preset (m): x este, y norte con giro 0. */
export type XY = readonly [number, number];

export interface PresetAnchor {
  readonly p: XY;
  readonly in: XY;
  readonly out: XY;
  readonly left: number;
  readonly right: number;
}

export interface PresetCone {
  readonly p: XY;
  readonly color: ConeColor;
}

export interface PresetMarking {
  readonly points: readonly XY[];
  /** Ancho de la línea pintada (m). */
  readonly width: number;
}

/** Circuito completo en su plano propio. */
export interface PresetLayout {
  readonly anchors: readonly PresetAnchor[];
  readonly closed: boolean;
  readonly cones: readonly PresetCone[];
  readonly gate: { readonly left: XY; readonly right: XY };
  readonly markings?: readonly PresetMarking[];
  /** Distancia del primer coche a la línea de salida (m). */
  readonly startOffset?: number;
}
