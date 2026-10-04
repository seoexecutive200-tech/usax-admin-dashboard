// Generates PNG icons with no dependencies:  node tools/make-icons.js
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };

function png(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4); const s = size / 512;
  const radius = maskable ? 0 : 112 * s; const ringR = (maskable ? 118 : 150) * s; const ringW = (maskable ? 28 : 34) * s; const coreR = (maskable ? 58 : 74) * s;
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4; const dx = x + 0.5 - c; const dy = y + 0.5 - c; const d = Math.hypot(dx, dy);
    // rounded-square coverage
    const qx = Math.abs(dx) - (c - radius); const qy = Math.abs(dy) - (c - radius);
    const sd = radius ? Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius : -1;
    const inside = Math.min(1, Math.max(0, 0.5 - sd));
    // background gradient
    let r = 13; let g = 17; let b = 24;
    // orb gradient (violet top-left → blue → dark)
    const gx = (x / size - 0.35) ; const gy = (y / size - 0.3); const gd = Math.min(1, Math.hypot(gx, gy) / 0.8);
    const mix = (a, bb, t) => a + (bb - a) * t;
    const gr = gd < 0.55 ? [mix(124, 59, gd / 0.55), mix(92, 130, gd / 0.55), mix(252, 246, gd / 0.55)] : [mix(59, 13, (gd - 0.55) / 0.45), mix(130, 17, (gd - 0.55) / 0.45), mix(246, 24, (gd - 0.55) / 0.45)];
    const ringCov = Math.min(1, Math.max(0, ringW / 2 + 0.5 - Math.abs(d - ringR)));
    const coreCov = Math.min(1, Math.max(0, coreR + 0.5 - d));
    const cov = Math.max(ringCov, coreCov);
    r = mix(r, gr[0], cov); g = mix(g, gr[1], cov); b = mix(b, gr[2], cov);
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(255 * inside);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = new URL('../assets/', import.meta.url).pathname;
writeFileSync(`${out}icon-192.png`, png(192)); writeFileSync(`${out}icon-512.png`, png(512));
writeFileSync(`${out}icon-maskable-512.png`, png(512, { maskable: true })); writeFileSync(`${out}apple-touch-icon.png`, png(180, { maskable: true }));
console.log('icons written');
