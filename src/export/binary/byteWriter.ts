const utf8 = new TextEncoder();

/** Escritor binario little-endian con crecimiento automático. */
export class ByteWriter {
  private buffer = new Uint8Array(1 << 16);
  private view = new DataView(this.buffer.buffer);
  private pos = 0;

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.pos + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.pos));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
    return this;
  }

  f32s(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.f32(values[i]);
    return this;
  }

  bytes(data: Uint8Array): this {
    this.ensure(data.length);
    this.buffer.set(data, this.pos);
    this.pos += data.length;
    return this;
  }

  ascii(s: string): this {
    return this.bytes(utf8.encode(s));
  }

  /** Cadena con prefijo de longitud int32 (formato kn5). */
  string(s: string): this {
    const data = utf8.encode(s);
    return this.i32(data.length).bytes(data);
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.pos);
  }
}
