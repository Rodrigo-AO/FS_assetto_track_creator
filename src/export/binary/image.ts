/** Imagen RGBA de 8 bits por canal, filas de arriba abajo. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export type Rgba = readonly [number, number, number, number];

export function createImage(width: number, height: number, fill: Rgba = [0, 0, 0, 0]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

/** Pinta un disco con mezcla alfa (base del trazado de líneas gruesas). */
export function fillDisc(img: RgbaImage, cx: number, cy: number, radius: number, color: Rgba): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + radius));
  const a = color[3] / 255;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(color[c] * a + img.data[i + c] * (1 - a));
      img.data[i + 3] = Math.max(img.data[i + 3], color[3]);
    }
  }
}

/** Polilínea gruesa: discos cada medio píxel a lo largo de cada segmento. */
export function strokePolyline(img: RgbaImage, points: ReadonlyArray<readonly [number, number]>, width: number, color: Rgba, closed: boolean): void {
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      fillDisc(img, ax + (bx - ax) * t, ay + (by - ay) * t, width / 2, color);
    }
  }
}
