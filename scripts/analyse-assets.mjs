import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alphaReport, decode, hex, ihdr } from './pixels.mjs';

const root = join(import.meta.dirname, '..');
for (const dir of ['brand', 'reference']) {
  for (const n of readdirSync(join(root, dir))) {
    const f = join(root, dir, n), buf = readFileSync(f), img = decode(f), a = alphaReport(img);
    const h = ihdr(buf);
    console.log(`\n${dir}/${n}  ${img.kind} ${img.width}x${img.height} ${buf.length}B`);
    if (h) console.log(`  IHDR bitDepth=${h.bitDepth} colourType=${h.colourType} (${h.colourName}) interlace=${h.interlace}`);
    else console.log('  no IHDR (JPEG: no alpha channel)');
    console.log(`  alpha buckets(0-31..224-255): ${a.buckets.join(' ')}  transparent=${a.transparent} pureBlackTransparent=${a.blackTransparent}`);
    const count = new Map();
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] < 8) continue;
      const k = hex(img.data[i] & 0xf8, img.data[i + 1] & 0xf8, img.data[i + 2] & 0xf8);
      count.set(k, (count.get(k) || 0) + 1);
    }
    const top = [...count].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k} ${(100 * v / a.pixels).toFixed(1)}%`);
    console.log('  dominant (5-bit bins): ' + top.join('  '));
  }
}
