import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export const sha1 = file => createHash('sha1').update(readFileSync(file)).digest('hex');

/* Straight IHDR read, so the report does not depend on a decoder's opinion. */
export function ihdr(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  const names = { 0: 'greyscale', 2: 'truecolour', 3: 'indexed', 4: 'greyscale+alpha', 6: 'truecolour+alpha' };
  const ct = buf[25];
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colourType: ct, colourName: names[ct], interlace: buf[28] };
}

/* Decode to straight (non-premultiplied) RGBA. */
export function decode(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) === 0x89504e47) {
    const p = PNG.sync.read(buf);
    return { width: p.width, height: p.height, data: p.data, kind: 'png', hasAlphaChannel: ihdr(buf).colourType === 6 || ihdr(buf).colourType === 4 };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: j.width, height: j.height, data: j.data, kind: 'jpeg', hasAlphaChannel: false };
}

export const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

/* Alpha histogram in 8 buckets plus the count of fully transparent pixels whose colour is pure black. */
export function alphaReport(img) {
  const buckets = new Array(8).fill(0);
  let transparent = 0, blackTransparent = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    buckets[d[i + 3] >> 5]++;
    if (d[i + 3] === 0) { transparent++; if (!d[i] && !d[i + 1] && !d[i + 2]) blackTransparent++; }
  }
  return { buckets, transparent, blackTransparent, pixels: d.length / 4 };
}

/* Box-filter resize. With `premultiply` colour is weighted by alpha, so transparent pixels carry no colour at all. */
export function resizeBox(img, w, h, { premultiply = true, x0 = 0, y0 = 0, cw = img.width - x0, ch = img.height - y0 } = {}) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let oy = 0; oy < h; oy++) {
    const ys = y0 + (oy * ch) / h, ye = y0 + ((oy + 1) * ch) / h;
    for (let ox = 0; ox < w; ox++) {
      const xs = x0 + (ox * cw) / w, xe = x0 + ((ox + 1) * cw) / w;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let y = Math.floor(ys); y < Math.ceil(ye); y++) {
        const wy = Math.min(ye, y + 1) - Math.max(ys, y);
        for (let x = Math.floor(xs); x < Math.ceil(xe); x++) {
          const wt = wy * (Math.min(xe, x + 1) - Math.max(xs, x));
          const i = (Math.min(img.height - 1, y) * img.width + Math.min(img.width - 1, x)) * 4;
          const al = img.data[i + 3] / 255;
          const k = premultiply ? wt * al : wt;
          r += img.data[i] * k; g += img.data[i + 1] * k; b += img.data[i + 2] * k;
          a += wt * al; wsum += wt;
        }
      }
      const o = (oy * w + ox) * 4, div = premultiply ? a || 1 : wsum || 1;
      out[o] = r / div; out[o + 1] = g / div; out[o + 2] = b / div; out[o + 3] = (a / wsum) * 255;
    }
  }
  return { width: w, height: h, data: out };
}

/* Deterministic PRNG so the sampled palette is reproducible. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* k-means (k-means++ seeding) over [r,g,b,weight,srcIndex] points. */
export function kmeans(points, k, { iters = 30, seed = 7 } = {}) {
  const rand = rng(seed), d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const cent = [points[Math.floor(rand() * points.length)].slice(0, 3)];
  while (cent.length < k) {
    const dist = points.map(p => Math.min(...cent.map(c => d2(p, c))) * p[3]);
    const total = dist.reduce((a, b) => a + b, 0);
    let r = rand() * total, i = 0;
    for (; i < dist.length - 1; i++) { r -= dist[i]; if (r <= 0) break; }
    cent.push(points[i].slice(0, 3));
  }
  let assign = new Int32Array(points.length);
  for (let it = 0; it < iters; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = d2(p, cent[c]); if (d < bd) { bd = d; best = c; } }
      assign[i] = best;
      const s = sum[best]; s[0] += p[0] * p[3]; s[1] += p[1] * p[3]; s[2] += p[2] * p[3]; s[3] += p[3];
    });
    sum.forEach((s, c) => { if (s[3]) cent[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const weight = new Array(k).fill(0);
  points.forEach((p, i) => (weight[assign[i]] += p[3]));
  return cent.map((c, i) => ({ centre: c, weight: weight[i] })).sort((a, b) => b.weight - a.weight);
}
