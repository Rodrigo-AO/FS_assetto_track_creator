import { ByteWriter } from './byteWriter';
import type { RgbaImage } from './image';

const DDSD_FLAGS = 0x1 | 0x2 | 0x4 | 0x8 | 0x1000 | 0x20000; // CAPS|HEIGHT|WIDTH|PITCH|PIXELFORMAT|MIPMAPCOUNT
const DDPF_RGB_ALPHA = 0x41;
const DDSCAPS = 0x8 | 0x1000 | 0x400000; // COMPLEX|TEXTURE|MIPMAP

/** Reduce a la mitad con filtro de caja (dimensiones potencia de dos). */
function halve(img: RgbaImage): RgbaImage {
  const width = Math.max(1, img.width >> 1);
  const height = Math.max(1, img.height >> 1);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(x * 2, img.width - 1);
      const sy = Math.min(y * 2, img.height - 1);
      const sx1 = Math.min(sx + 1, img.width - 1);
      const sy1 = Math.min(sy + 1, img.height - 1);
      for (let c = 0; c < 4; c++) {
        const sum =
          img.data[(sy * img.width + sx) * 4 + c] + img.data[(sy * img.width + sx1) * 4 + c] +
          img.data[(sy1 * img.width + sx) * 4 + c] + img.data[(sy1 * img.width + sx1) * 4 + c];
        data[(y * width + x) * 4 + c] = (sum + 2) >> 2;
      }
    }
  }
  return { width, height, data };
}

/**
 * DDS A8R8G8B8 sin comprimir con la cadena completa de mipmaps
 * (mismo formato que el `write_dds` del proyecto ART-26D, ya validado en AC).
 */
export function encodeDds(img: RgbaImage): Uint8Array {
  const levels = [img];
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) levels.push(halve(levels[levels.length - 1]));

  const w = new ByteWriter().ascii('DDS ');
  w.u32(124).u32(DDSD_FLAGS).u32(img.height).u32(img.width).u32(img.width * 4).u32(0).u32(levels.length);
  for (let i = 0; i < 11; i++) w.u32(0);
  w.u32(32).u32(DDPF_RGB_ALPHA).u32(0).u32(32).u32(0x00ff0000).u32(0x0000ff00).u32(0x000000ff).u32(0xff000000);
  w.u32(DDSCAPS).u32(0).u32(0).u32(0).u32(0);
  for (const lvl of levels) {
    const bgra = new Uint8Array(lvl.data.length);
    for (let i = 0; i < bgra.length; i += 4) {
      bgra[i] = lvl.data[i + 2];
      bgra[i + 1] = lvl.data[i + 1];
      bgra[i + 2] = lvl.data[i];
      bgra[i + 3] = lvl.data[i + 3];
    }
    w.bytes(bgra);
  }
  return w.toUint8Array();
}
