/**
 * Acceleration de Formula Student (FS Rules 2026 v1.1, D5.1). Plano propio en metros: el centro de
 * la recta cronometrada en el origen y el coche avanza hacia +y.
 */
import type { PresetAnchor, PresetCone, PresetLayout, XY } from './types';

/** D5.1.1: recta de 75 m entre salida y meta, al menos 3 m de ancho, conos cada unos 5 m. */
export const ACCELERATION = {
  length: 75,
  width: 3,
  coneSpacing: 5,
  /** Zona de frenada tras la meta (D5.2.4, modo autónomo: pararse antes de 75 m). */
  brakeZone: 75,
} as const;

/** D5.2.3: la parte delantera del coche queda 0,30 m antes de la línea. AC coloca el centro del coche
 *  en el punto de salida, así que se suma media longitud de un FS (~1,5 m). */
export const ACCELERATION_START_M = 0.3 + 1.5;
/** Recta antes de la salida, para la parrilla (sus huecos van cada 8 m). */
const ENTRY_M = 20;

const HALF = ACCELERATION.width / 2;
const START_Y = -ACCELERATION.length / 2;
const FINISH_Y = ACCELERATION.length / 2;
/** Los conos van por fuera del carril, con la base pegada a su borde. */
const SMALL = HALF + 0.114;
const BIG = HALF + 0.1425;

const xy = (x: number, y: number): XY => [x + 0, y + 0];

function anchors(): PresetAnchor[] {
  const from = START_Y - ENTRY_M;
  const to = FINISH_Y + ACCELERATION.brakeZone;
  const third = (to - from) / 3;
  return [
    { p: xy(0, from), in: xy(0, from - 5), out: xy(0, from + third), left: HALF, right: HALF },
    { p: xy(0, to), in: xy(0, to - third), out: xy(0, to + 5), left: HALF, right: HALF },
  ];
}

function cones(): PresetCone[] {
  const out: PresetCone[] = [];
  const { coneSpacing: step, length, brakeZone } = ACCELERATION;
  // Recta cronometrada: azules a la izquierda y amarillos a la derecha; las líneas, con conos grandes.
  for (let d = step; d < length; d += step) {
    out.push({ p: xy(-SMALL, START_Y + d), color: 'blue' }, { p: xy(SMALL, START_Y + d), color: 'yellow' });
  }
  for (const y of [START_Y, FINISH_Y]) out.push({ p: xy(-BIG, y), color: 'orangeBig' }, { p: xy(BIG, y), color: 'orangeBig' });
  // Zona de frenada: naranjas.
  for (let d = step; d <= brakeZone; d += step) {
    out.push({ p: xy(-SMALL, FINISH_Y + d), color: 'orange' }, { p: xy(SMALL, FINISH_Y + d), color: 'orange' });
  }
  return out;
}

export function accelerationLayout(): PresetLayout {
  return {
    anchors: anchors(),
    closed: false,
    cones: cones(),
    // La salida es la línea de vuelta de AC y la meta, su primer sector: el parcial es el tiempo de la prueba.
    gate: { left: xy(-HALF, START_Y), right: xy(HALF, START_Y) },
    sectors: [{ left: xy(-HALF, FINISH_Y), right: xy(HALF, FINISH_Y) }],
    markings: [{ points: [xy(-HALF, FINISH_Y), xy(HALF, FINISH_Y)], width: 0.3 }],
    startOffset: ACCELERATION_START_M,
  };
}
