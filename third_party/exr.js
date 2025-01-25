export function createEXR(width, height, channels, f32data) {
  let tHeader = 258 + 18 * channels + 1;
  let tTable = 8 * height;
  let tScanlines = height * (4 + 4 + channels * 4 * width);
  let tTotal = tHeader + tTable + tScanlines;

  let buffer = new ArrayBuffer(tTotal);
  let stream = new DataStream(buffer);

  stream.write([
    { buf: [0x76, 0x2f, 0x31, 0x01] }, // header
    { i32: [2] }, // version

    { str: ['channels', 'chlist'] },
    { i32: [18 * channels + 1] },
    { str: ['B'] }, { i32: [2, 1, 1, 1] }, // Float (2), Plinear, X sampling, Y sampling
    { str: ['G'] }, { i32: [2, 1, 1, 1] },
    { str: ['R'] }, { i32: [2, 1, 1, 1] },
    { buf: [0] },

    { str: ['compression', 'compression'] },
    { i32: [1] }, { buf: [0] }, // attr size, attr value

    { str: ['dataWindow', 'box2i'] },
    { i32: [16, 0, 0, width - 1, height - 1] },

    { str: ['displayWindow', 'box2i'] },
    { i32: [16, 0, 0, width - 1, height - 1] },

    { str: ['lineOrder', 'lineOrder'] },
    { i32: [1] }, { buf: [0] },

    { str: ['PixelAspectRatio', 'float'] },
    { i32: [4] }, { f32: [1.0] },

    { str: ['screenWindowCenter', 'v2f'] },
    { i32: [8, 0, 0] },

    { str: ['screenWindowWidth', 'float'] },
    { i32: [4] }, { f32: [1.0] },

    { buf: [0] },
  ]);

  let imgOffset = stream.offset + height * 8;
  for (let y = 0; y < height; y++) {
    let jump = imgOffset + y * (8 + width * 4 * channels);
    stream.writeInt(jump);
    stream.writeInt(0);
  }

  let scanline = new Float32Array(width);
  let scanlineBytes = new Uint8Array(scanline.buffer);

  for (let y = 0; y < height; y++) {
    stream.writeInt(y);
    stream.writeInt(width * channels * 4);

    for (let ch = channels - 1; ch >= 0; ch--) {
      for (let x = 0; x < width; x++) {
        let index = (height - 1 - y) * width + x;
        scanline[x] = f32data[index * 4 + ch];
      }

      stream.writeBuf(scanlineBytes);
    }
  }

  return new Blob([buffer], { type: 'image/x-exr' });
}

class DataStream {
  constructor(buffer) {
    this.bytes = new Uint8Array(buffer);
    this.data = new DataView(buffer);
    this.offset = 0;
  }

  write(items) {
    for (let i of items) {
      for (let s of i.str || [])
        this.writeStr(s);
      for (let x of i.i32 || [])
        this.writeInt(x);
      for (let x of i.f32 || [])
        this.writeFloat(x);
      if (i.buf)
        this.writeBuf(i.buf);
    }
  }

  writeFloat(v) {
    this.data.setFloat32(this.offset, v, true);
    this.offset += 4;
  }

  writeInt(i) {
    this.data.setUint32(this.offset, i, true);
    this.offset += 4;
  }

  writeBuf(bytes) {
    this.bytes.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeStr(s) {
    for (let i = 0; i < s.length; i++)
      this.data.setUint8(this.offset++, s.charCodeAt(i));
    this.data.setUint8(this.offset++, 0);
  }
}
