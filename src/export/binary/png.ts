import { zlibSync } from 'fflate';
import { ByteWriter } from './byteWriter';
import type { RgbaImage } from './image';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(out: ByteWriter, type: string, body: Uint8Array): void {
  const typed = new ByteWriter().ascii(type).bytes(body).toUint8Array();
  const len = new DataView(new ArrayBuffer(4));
  len.setUint32(0, body.length, false);
  const crc = new DataView(new ArrayBuffer(4));
  crc.setUint32(0, crc32(typed), false);
  out.bytes(new Uint8Array(len.buffer)).bytes(typed).bytes(new Uint8Array(crc.buffer));
}

/** Codifica una imagen RGBA como PNG (sin filtros, compresión zlib). */
export function encodePng(img: RgbaImage): Uint8Array {
  const header = new DataView(new ArrayBuffer(13));
  header.setUint32(0, img.width, false);
  header.setUint32(4, img.height, false);
  header.setUint8(8, 8); // bits por canal
  header.setUint8(9, 6); // RGBA
  const stride = img.width * 4;
  const raw = new Uint8Array((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);

  const out = new ByteWriter().bytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunk(out, 'IHDR', new Uint8Array(header.buffer));
  chunk(out, 'IDAT', zlibSync(raw, { level: 6 }));
  chunk(out, 'IEND', new Uint8Array(0));
  return out.toUint8Array();
}
