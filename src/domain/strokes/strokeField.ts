/**
 * Campo de un trazo de pincel difuminado (Brush, Desnivelador), como el pincel de máscaras de
 * Lightroom: el trazo deja «toques» seguidos a lo largo de su recorrido y cada toque suma un poco.
 * Repasar un sitio en la misma pasada (sin soltar) vuelve a sumar. Cada pincel decide cómo
 * combina sus pasadas.
 */
import type { Vec2 } from '../geometry/vec2';

export interface FieldStroke {
  /** Radio del pincel (m). */
  readonly radius: number;
  readonly points: readonly Vec2[];
}

/** Casillas del campo (m) y su resolución (píxeles por lado): 0,125 m por píxel. */
export const FIELD_TILE_M = 32;
export const FIELD_TILE_PX = 256;
export const FIELD_PX_M = FIELD_TILE_M / FIELD_TILE_PX;

/**
 * Aporte de una pasada recta en su eje: el 75 % de una pasada «completa». El pincel no tiene
 * núcleo pleno; se difumina desde el centro hasta el borde.
 */
export const BRUSH_CENTER = 0.75;

/** Separación entre toques a lo largo del trazo, como fracción del radio. */
const DAB_SPACING = 0.125;

/**
 * Suma de los perfiles de los toques de una pasada recta, medida en su eje:
 * (2r / separación) · ∫₀¹ (1 − smoothstep(t)) dt = (2 / 0,125) · 0,5 = 8, sea cual sea el radio.
 */
const DABS_PER_PASS = (2 / DAB_SPACING) * 0.5;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Perfil de un toque a distancia `d` de su centro: 1 en el centro, 0 en el borde. */
export const brushFalloff = (d: number, radius: number): number => 1 - smoothstep(0, radius, d);

export function distanceToSegment(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Clave de casilla `ix:iy`. */
export const cellKey = (ix: number, iy: number): string => `${ix}:${iy}`;

export interface FieldCell {
  readonly ix: number;
  readonly iy: number;
  /** Aporte por píxel, fila 0 al sur. */
  readonly value: Float32Array;
}

export type StrokeField = ReadonlyMap<string, FieldCell>;

/** Centros de los toques: uno cada `spacing` metros de recorrido, empezando en el primer punto. */
export function strokeDabs(points: readonly Vec2[], spacing: number): Vec2[] {
  if (!points.length) return [];
  const dabs: Vec2[] = [points[0]];
  // Recorrido que falta para el siguiente toque.
  let next = spacing;
  for (let s = 0; s + 1 < points.length; s++) {
    const a = points[s];
    const b = points[s + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let at = next;
    while (at <= len) {
      const t = at / len;
      dabs.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      at += spacing;
    }
    next = at - len;
  }
  return dabs;
}

/**
 * Aporte de un trazo por casillas. Una pasada recta deja BRUSH_CENTER en su eje; repasar (incluso
 * en la misma pasada) suma. Un clic sin arrastrar deja un solo toque con la fuerza de una pasada.
 */
export function strokeField(stroke: FieldStroke): StrokeField {
  const out = new Map<string, FieldCell>();
  const r = stroke.radius;
  if (!stroke.points.length || r <= 0) return out;
  const single = stroke.points.every((p) => p.x === stroke.points[0].x && p.y === stroke.points[0].y);
  const dabs = single ? [stroke.points[0]] : strokeDabs(stroke.points, DAB_SPACING * r);
  const amount = single ? BRUSH_CENTER : BRUSH_CENTER / DABS_PER_PASS;
  const rPx = r / FIELD_PX_M;
  let cell: FieldCell | undefined;
  for (const c of dabs) {
    const cx = c.x / FIELD_PX_M;
    const cy = c.y / FIELD_PX_M;
    const gx0 = Math.floor(cx - rPx);
    const gx1 = Math.ceil(cx + rPx);
    const gy0 = Math.floor(cy - rPx);
    const gy1 = Math.ceil(cy + rPx);
    for (let gy = gy0; gy <= gy1; gy++) {
      const iy = Math.floor(gy / FIELD_TILE_PX);
      const dy = gy + 0.5 - cy;
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = gx + 0.5 - cx;
        const d = Math.hypot(dx, dy) * FIELD_PX_M;
        if (d >= r) continue;
        const ix = Math.floor(gx / FIELD_TILE_PX);
        if (!cell || cell.ix !== ix || cell.iy !== iy) {
          const key = cellKey(ix, iy);
          cell = out.get(key);
          if (!cell) {
            cell = { ix, iy, value: new Float32Array(FIELD_TILE_PX * FIELD_TILE_PX) };
            out.set(key, cell);
          }
        }
        cell.value[(gy - iy * FIELD_TILE_PX) * FIELD_TILE_PX + (gx - ix * FIELD_TILE_PX)] += amount * brushFalloff(d, r);
      }
    }
  }
  return out;
}

/** ¿La goma (círculo de radio `eraserRadius` en `p`) toca el trazo? */
export function strokeTouches(stroke: FieldStroke, p: Vec2, eraserRadius: number): boolean {
  const pts = stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points;
  for (let s = 0; s + 1 < pts.length; s++) {
    if (distanceToSegment(p.x, p.y, pts[s], pts[s + 1]) < stroke.radius + eraserRadius) return true;
  }
  return false;
}
