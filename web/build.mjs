// Build step (runs on Vercel): copies the static site into /public,
// adds the QR library from npm and draws the app icons as PNGs.
import fs from "node:fs";
import zlib from "node:zlib";

const OUT = "public";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/icons`, { recursive: true });
for (const f of ["index.html", "p.html", "admin.html", "config.js", "frames.js", "sw.js", "manifest.webmanifest"]) {
  fs.copyFileSync(f, `${OUT}/${f}`);
}
fs.copyFileSync("node_modules/qrcode-generator/qrcode.js", `${OUT}/qrcode.js`);

// ---- tiny PNG encoder ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size);
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const INK = [14, 14, 18], CORAL = [255, 90, 54], CREAM = [245, 239, 230];
const inRR = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const icon = (x, y, s) => {
  const d = Math.hypot(x - s / 2, y - s * 0.53);
  if (d <= s * 0.09) return CREAM;
  if (d <= s * 0.15) return INK;
  if (inRR(x, y, s * 0.18, s * 0.3, s * 0.82, s * 0.76, s * 0.08)) return CORAL;
  if (inRR(x, y, s * 0.36, s * 0.22, s * 0.64, s * 0.34, s * 0.03)) return CORAL;
  return INK;
};
for (const s of [180, 192, 512]) fs.writeFileSync(`${OUT}/icons/icon-${s}.png`, png(s, icon));
console.log("Built", fs.readdirSync(OUT));
