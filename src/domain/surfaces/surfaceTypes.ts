import type { SurfaceType } from '../project/types';

/** Parámetros de una entrada [SURFACE_n] de `data/surfaces.ini`. */
export interface SurfacePhysics {
  readonly key: string;
  readonly friction: number;
  readonly damping: number;
  readonly wav: string;
  readonly wavPitch: number;
  readonly ffEffect: string;
  /** 1 = levanta polvo/suciedad (ensucia el coche y genera partículas). */
  readonly dirtAdditive: number;
  readonly isValidTrack: number;
  readonly blackFlagTime: number;
  /** Ondulación del terreno: amplitud y longitud de onda (m). */
  readonly sinHeight: number;
  readonly sinLength: number;
  readonly isPitlane: number;
  readonly vibrationGain: number;
  readonly vibrationLength: number;
}

export interface SurfaceDefinition {
  readonly type: SurfaceType;
  readonly label: string;
  /** Color de previsualización sobre el mapa. */
  readonly mapColor: string;
  readonly physics: SurfacePhysics;
}

/*
 * Valores tomados de las pistas oficiales de Kunos instaladas (content/tracks/<pista>/data/surfaces.ini):
 * - ROAD: mediana de los asfaltos Kunos (0.97–1.00).
 * - GRASS: el césped más repetido en Kunos (fricción 0.6, ondulación 0.017 m / 0.21 m).
 * - GRAVEL: grava de escapatoria Kunos (fricción 0.75, amortiguación 0.04, fuera de pista).
 */
export const SURFACES: Readonly<Record<SurfaceType, SurfaceDefinition>> = {
  asphalt: {
    type: 'asphalt',
    label: 'Asfalto',
    mapColor: '#3B3B3D',
    physics: {
      key: 'ROAD', friction: 0.98, damping: 0, wav: '', wavPitch: 0, ffEffect: 'NULL', dirtAdditive: 0,
      isValidTrack: 1, blackFlagTime: 0, sinHeight: 0, sinLength: 0, isPitlane: 0, vibrationGain: 0, vibrationLength: 0,
    },
  },
  grass: {
    type: 'grass',
    label: 'Césped',
    mapColor: '#4E8F3A',
    physics: {
      key: 'GRASS', friction: 0.6, damping: 0.021, wav: 'grass.wav', wavPitch: 0, ffEffect: 'NULL', dirtAdditive: 1,
      isValidTrack: 0, blackFlagTime: 0, sinHeight: 0.017, sinLength: 0.21, isPitlane: 0, vibrationGain: 0.2,
      vibrationLength: 0.6,
    },
  },
  gravel: {
    type: 'gravel',
    label: 'Grava',
    mapColor: '#C9B48A',
    physics: {
      key: 'GRAVEL', friction: 0.75, damping: 0.04, wav: 'grass.wav', wavPitch: 0, ffEffect: 'NULL', dirtAdditive: 1,
      isValidTrack: 0, blackFlagTime: 0, sinHeight: 0.03, sinLength: 0.5, isPitlane: 0, vibrationGain: 0.5,
      vibrationLength: 0.6,
    },
  },
};

export const SURFACE_TYPES: readonly SurfaceType[] = ['asphalt', 'grass', 'gravel'];
