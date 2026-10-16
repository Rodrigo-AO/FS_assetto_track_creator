import type { LatLng } from '../geo/projection';

export type SurfaceType = 'asphalt' | 'grass' | 'gravel';
export type ConeColor = 'blue' | 'yellow' | 'orange' | 'orangeBig';

export interface Cone {
  readonly id: string;
  readonly position: LatLng;
  readonly color: ConeColor;
}

export interface SurfaceZone {
  readonly id: string;
  readonly type: SurfaceType;
  readonly polygon: readonly LatLng[];
}

/** Línea de cronometraje; izquierda y derecha según el sentido de la marcha. */
export interface Gate {
  readonly id: string;
  readonly left: LatLng;
  readonly right: LatLng;
}

/**
 * Punto de paso del trazado. Sin manejadores, la curva se suaviza automáticamente
 * (Catmull-Rom); con manejadores, se comporta como un nodo Bézier de un editor de fotos.
 */
export interface TrackAnchor {
  readonly id: string;
  readonly position: LatLng;
  readonly handleIn: LatLng | null;
  readonly handleOut: LatLng | null;
  /** Semiancho a cada lado del eje, en metros. */
  readonly widthLeft: number;
  readonly widthRight: number;
}

export interface TrackLayout {
  readonly anchors: readonly TrackAnchor[];
  readonly closed: boolean;
  readonly symmetric: boolean;
  readonly autoCones: boolean;
  /** Separación entre conos de un mismo lateral, en metros. */
  readonly coneSpacing: number;
}

export interface TrackProject {
  readonly version: 1;
  readonly name: string;
  /** Ubicación con escenario 3D (ver domain/presets); fija el área a su polígono. */
  readonly preset: string | null;
  readonly area: readonly LatLng[] | null;
  readonly baseSurface: SurfaceType;
  readonly zones: readonly SurfaceZone[];
  readonly cones: readonly Cone[];
  readonly conesCollidable: boolean;
  readonly track: TrackLayout;
  readonly startFinish: Gate | null;
  readonly sectors: readonly Gate[];
}

export const DEFAULT_TRACK_WIDTH = 3;
export const DEFAULT_CONE_SPACING = 5;

export function createEmptyProject(): TrackProject {
  return {
    version: 1,
    name: 'Nuevo circuito',
    preset: null,
    area: null,
    baseSurface: 'asphalt',
    zones: [],
    cones: [],
    conesCollidable: false,
    track: { anchors: [], closed: true, symmetric: true, autoCones: true, coneSpacing: DEFAULT_CONE_SPACING },
    startFinish: null,
    sectors: [],
  };
}
