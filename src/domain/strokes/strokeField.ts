/**
 * Campo de un trazo de pincel difuminado (Brush, Desnivelador): para cada píxel de una rejilla
 * fija por casillas, cuánto aporta el trazo (1 en el núcleo, 0 en el borde). Cada pincel decide
 * cómo combina los aportes de sus pasadas.
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

/** Fracción del radio con aporte pleno; de ahí al borde se difumina. */
const BRUSH_CORE = 0.35;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Aporte de un trazo a distancia `d` de su eje (1 en el núcleo, 0 en el borde). */
export const brushFalloff = (d: number, radius: number): number => 1 - smoothstep(BRUSH_CORE * radius, radius, d);

export function distanceToSegment(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Clave de casilla `ix:iy`. */
export const cellKey = (ix: number, iy: number): string => `${ix}:${iy}`;

/**
 * Aporte (0–1) de un trazo por casillas. Dentro del trazo manda el máximo sobre sus segmentos:
 * ir y volver por el mismo sitio en una misma pasada no suma.
 */
export function strokeField(stroke: FieldStroke): Map<string, { ix: number; iy: number; value: Float32Array }> {
  const out = new Map<string, { ix: number; iy: number; value: Float32Array }>();
  if (!stroke.points.length || stroke.radius <= 0) return out;
  const pts = stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points;
  const r = stroke.radius;
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const gx0 = Math.floor((Math.min(a.x, b.x) - r) / FIELD_PX_M);
    const gx1 = Math.ceil((Math.max(a.x, b.x) + r) / FIELD_PX_M);
    const gy0 = Math.floor((Math.min(a.y, b.y) - r) / FIELD_PX_M);
    const gy1 = Math.ceil((Math.max(a.y, b.y) + r) / FIELD_PX_M);
    // Casillas que toca el segmento y, dentro de cada una, sus píxeles.
    for (let iy = Math.floor(gy0 / FIELD_TILE_PX); iy <= Math.floor(gy1 / FIELD_TILE_PX); iy++) {
      for (let ix = Math.floor(gx0 / FIELD_TILE_PX); ix <= Math.floor(gx1 / FIELD_TILE_PX); ix++) {
        const key = cellKey(ix, iy);
        let cell = out.get(key);
        if (!cell) {
          cell = { ix, iy, value: new Float32Array(FIELD_TILE_PX * FIELD_TILE_PX) };
          out.set(key, cell);
        }
        const c = cell.value;
        const y0 = Math.max(gy0, iy * FIELD_TILE_PX);
        const y1 = Math.min(gy1, (iy + 1) * FIELD_TILE_PX - 1);
        const x0 = Math.max(gx0, ix * FIELD_TILE_PX);
        const x1 = Math.min(gx1, (ix + 1) * FIELD_TILE_PX - 1);
        for (let gy = y0; gy <= y1; gy++) {
          for (let gx = x0; gx <= x1; gx++) {
            const d = distanceToSegment((gx + 0.5) * FIELD_PX_M, (gy + 0.5) * FIELD_PX_M, a, b);
            if (d >= r) continue;
            const k = (gy - iy * FIELD_TILE_PX) * FIELD_TILE_PX + (gx - ix * FIELD_TILE_PX);
            c[k] = Math.max(c[k], brushFalloff(d, r));
          }
        }
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
