/**
 * Skidpad de Formula Student (FS Rules 2026 v1.1, D4.1). Plano propio en metros: el centro de la
 * línea de salida/meta en el origen y el coche entra hacia +y (perpendicular al ocho).
 */
import type { PresetAnchor, PresetCone, PresetLayout, PresetMarking, XY } from './types';

/** D4.1.2: distancia entre centros y diámetros de los círculos interior y exterior (m). */
export const SKIDPAD = {
  centerDistance: 18.25,
  innerDiameter: 15.25,
  outerDiameter: 21.25,
  /** D4.1.3: conos por dentro de cada círculo interior y por fuera de cada exterior. */
  innerCones: 17,
  outerCones: 13,
  /** D4.1.5: ancho del carril y de las puertas de entrada y salida (m). */
  pathWidth: 3,
} as const;

const CX = SKIDPAD.centerDistance / 2;
const RI = SKIDPAD.innerDiameter / 2;
const RO = SKIDPAD.outerDiameter / 2;
const HALF = SKIDPAD.pathWidth / 2;
/** Los conos van pegados a la línea, por dentro (interior) o por fuera (exterior). */
const CONE_HALF_BASE = 0.114;

/**
 * Ángulos de los conos en la figura 21 (0° hacia el otro círculo, simétricos arriba y abajo): los
 * interiores cada 22,5° salvo los dos que flanquean la línea; los exteriores cada 22,5° hasta el
 * cruce, con uno más en cada esquina de las puertas.
 */
const INNER_ANGLES = [6, 22.5, 45, 67.5, 90, 112.5, 135, 157.5];
const OUTER_ANGLES = [57.5, 67.5, 90, 112.5, 135, 157.5];
const mirrored = (angles: readonly number[]): number[] => [...angles, 180, ...angles.map((a) => -a)];

/** Distancia de las puertas de entrada y salida a la línea (m); en la figura, algo más allá del círculo exterior. */
const GATE_Y = 12;
/** D4.2.4: el coche se coloca 15 m antes de la línea. */
export const SKIDPAD_START_M = 15;
/** Recta de entrada (parrilla incluida) y de salida (D4.2.5: pararse antes de 25 m). */
const ENTRY_M = 44;
const EXIT_M = 27;

const K = (4 / 3) * Math.tan(Math.PI / 8); // manejadores de un cuarto de círculo
const round = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
const xy = (x: number, y: number): XY => [round(x), round(y)];

function anchors(): PresetAnchor[] {
  const r = CX; // radio del eje del carril: los dos círculos se tocan en el origen
  const node = (p: XY, hin: XY, out: XY): PresetAnchor => ({ p, in: hin, out, left: HALF, right: HALF });
  /** Tres nodos intermedios de un círculo recorrido desde el origen (s = 1 derecha en horario, −1 izquierda). */
  const loop = (s: 1 | -1): PresetAnchor[] => [
    node(xy(s * r, r), xy(s * (r - K * r), r), xy(s * (r + K * r), r)),
    node(xy(s * 2 * r, 0), xy(s * 2 * r, K * r), xy(s * 2 * r, -K * r)),
    node(xy(s * r, -r), xy(s * (r + K * r), -r), xy(s * (r - K * r), -r)),
  ];
  const origin = (hin: number, out: number): PresetAnchor => node(xy(0, 0), xy(0, -hin), xy(0, out));
  return [
    node(xy(0, -ENTRY_M), xy(0, -ENTRY_M - 10), xy(0, -ENTRY_M + ENTRY_M / 3)),
    origin(ENTRY_M / 3, K * r),
    ...loop(1),
    origin(K * r, K * r),
    ...loop(-1),
    origin(K * r, EXIT_M / 3),
    node(xy(0, EXIT_M), xy(0, EXIT_M - EXIT_M / 3), xy(0, EXIT_M + 5)),
  ];
}

function cones(): PresetCone[] {
  const out: PresetCone[] = [];
  for (const s of [1, -1] as const) {
    // Derecha (horario): el círculo interior queda a la derecha (amarillo) y el exterior a la izquierda (azul).
    const ring = (angles: readonly number[], radius: number, color: PresetCone['color']): void => {
      for (const deg of mirrored(angles)) {
        const a = (deg * Math.PI) / 180;
        out.push({ p: xy(s * (CX - Math.cos(a) * radius), Math.sin(a) * radius), color });
      }
    };
    ring(INNER_ANGLES, RI - CONE_HALF_BASE, s === 1 ? 'yellow' : 'blue');
    ring(OUTER_ANGLES, RO + CONE_HALF_BASE, s === 1 ? 'blue' : 'yellow');
  }
  for (const y of [-GATE_Y, GATE_Y]) for (const x of [-1, 1]) out.push({ p: xy(x * (HALF + CONE_HALF_BASE), y), color: 'orange' });
  return out;
}

/** D4.1.4: líneas de los círculos (la exterior, abierta en las puertas) y bordes de entrada y salida. */
function markings(): PresetMarking[] {
  const STEP = 3;
  const width = 0.1;
  const out: PresetMarking[] = [];
  const corner = (Math.acos((CX - HALF) / RO) * 180) / Math.PI; // donde el círculo exterior corta el borde de la puerta
  const cornerY = Math.sin((corner * Math.PI) / 180) * RO;
  for (const s of [1, -1] as const) {
    const arc = (radius: number, from: number, to: number): XY[] => {
      const n = Math.ceil((to - from) / STEP);
      return Array.from({ length: n + 1 }, (_, i) => {
        const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
        return xy(s * (CX - Math.cos(a) * radius), Math.sin(a) * radius);
      });
    };
    out.push({ points: arc(RI, 0, 360), width }, { points: arc(RO, corner, 360 - corner), width });
    for (const dir of [1, -1]) out.push({ points: [xy(s * HALF, dir * cornerY), xy(s * HALF, dir * (GATE_Y + 3))], width });
  }
  return out;
}

export function skidpadLayout(): PresetLayout {
  return {
    anchors: anchors(),
    closed: false,
    cones: cones(),
    // D4.1.6: la línea entre los centros es la salida/meta; cada paso cierra una vuelta a un círculo.
    gate: { left: xy(-HALF, 0), right: xy(HALF, 0) },
    markings: markings(),
    startOffset: SKIDPAD_START_M,
  };
}
