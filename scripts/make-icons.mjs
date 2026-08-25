// Generates the toolbar icons without external dependencies so the repository
// stays buildless while still shipping a real action icon.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "icons");
const SIZES = [16, 32, 48, 128];
const BACKGROUND = [109, 94, 247, 255];
const FOREGROUND = [255, 255, 255, 255];

// A 9x16 bitmap of the question mark, kept horizontally symmetric so it stays
// centred at every icon size.
const GLYPH = [
  "..#####..",
  ".#######.",
  "###...###",
  "##.....##",
  "##.....##",
  "......###",
  ".....###.",
  "....###..",
  "...###...",
  "...###...",
  "...###...",
  "...###...",
  ".........",
  "...###...",
  "...###...",
  "........."
];

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC = crcTable();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function cornerRadius(size) {
  return Math.max(2, Math.round(size * 0.22));
}

function insideRoundedSquare(x, y, size) {
  const r = cornerRadius(size);
  const inset = size <= 16 ? 0 : 1;
  if (x < inset || y < inset || x >= size - inset || y >= size - inset) return false;
  const cx = x < r ? r : (x >= size - r ? size - r - 1 : x);
  const cy = y < r ? r : (y >= size - r ? size - r - 1 : y);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
}

function glyphPixel(x, y, size) {
  const glyphHeight = GLYPH.length;
  const glyphWidth = GLYPH[0].length;
  const scale = (size * 0.62) / glyphHeight;
  const offsetX = (size - glyphWidth * scale) / 2;
  const offsetY = (size - glyphHeight * scale) / 2;
  const gx = Math.floor((x - offsetX) / scale);
  const gy = Math.floor((y - offsetY) / scale);
  if (gy < 0 || gy >= glyphHeight || gx < 0 || gx >= glyphWidth) return false;
  return GLYPH[gy][gx] === "#";
}

function renderIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let cursor = 0;
  for (let y = 0; y < size; y += 1) {
    raw[cursor] = 0;
    cursor += 1;
    for (let x = 0; x < size; x += 1) {
      let pixel = [0, 0, 0, 0];
      if (insideRoundedSquare(x, y, size)) {
        pixel = glyphPixel(x, y, size) ? FOREGROUND : BACKGROUND;
      }
      raw[cursor] = pixel[0];
      raw[cursor + 1] = pixel[1];
      raw[cursor + 2] = pixel[2];
      raw[cursor + 3] = pixel[3];
      cursor += 4;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

fs.mkdirSync(outputDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outputDir, `icon-${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log(`wrote ${path.relative(root, file)}`);
}
