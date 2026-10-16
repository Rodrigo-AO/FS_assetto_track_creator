import type { ConeColor } from '../project/types';

export type Rgb = readonly [number, number, number];

export interface ConeSpec {
  readonly color: ConeColor;
  readonly label: string;
  /** Lado de la base cuadrada (m). También es el lado de la hitbox. */
  readonly baseSize: number;
  readonly height: number;
  readonly body: Rgb;
  readonly stripe: Rgb;
  /** Franjas como fracciones de la altura [desde, hasta]. */
  readonly stripes: ReadonlyArray<readonly [number, number]>;
  readonly mapColor: string;
}

/*
 * Conos de Formula Student según el FSG Competition Handbook (al que remite la regla D2.4.1):
 * pequeños 228×228×325 mm (azul con franja blanca, amarillo con franja negra, naranja con
 * franja blanca) y grandes naranjas 285×285×505 mm con dos franjas blancas.
 */
export const CONE_SPECS: Readonly<Record<ConeColor, ConeSpec>> = {
  blue: {
    color: 'blue', label: 'Azul', baseSize: 0.228, height: 0.325,
    body: [0, 87, 184], stripe: [255, 255, 255], stripes: [[0.45, 0.62]], mapColor: '#0057B8',
  },
  yellow: {
    color: 'yellow', label: 'Amarillo', baseSize: 0.228, height: 0.325,
    body: [255, 209, 0], stripe: [20, 20, 20], stripes: [[0.45, 0.62]], mapColor: '#FFD100',
  },
  orange: {
    color: 'orange', label: 'Naranja', baseSize: 0.228, height: 0.325,
    body: [255, 106, 19], stripe: [255, 255, 255], stripes: [[0.45, 0.62]], mapColor: '#FF6A13',
  },
  orangeBig: {
    color: 'orangeBig', label: 'Naranja grande', baseSize: 0.285, height: 0.505,
    body: [255, 106, 19], stripe: [255, 255, 255], stripes: [[0.38, 0.5], [0.62, 0.74]], mapColor: '#FF6A13',
  },
};

export const CONE_COLORS: readonly ConeColor[] = ['blue', 'yellow', 'orange', 'orangeBig'];
