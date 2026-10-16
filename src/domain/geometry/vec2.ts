/** Vector 2D en metros sobre el plano local: x hacia el este, y hacia el norte. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => vec(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => vec(a.x - b.x, a.y - b.y);
export const scale = (a: Vec2, k: number): Vec2 => vec(a.x * k, a.y * k);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len > 1e-12 ? scale(a, 1 / len) : vec(0, 0);
}

/** Normal a la izquierda de una dirección (giro de 90° antihorario). */
export const leftNormal = (dir: Vec2): Vec2 => vec(-dir.y, dir.x);
