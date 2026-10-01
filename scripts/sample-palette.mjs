/* Samples the palette from the real brand and slide pixels and writes src/css/tokens.css plus scripts/favicon-grid.json.
   Method: pixels are binned to 5 bits per channel, each bin weighted by sqrt(count) so the flat background cannot
   swallow the accents, k-means (k-means++ seed 7) runs over the bins, and every centroid is snapped to the real pixel
   whose colour is nearest to it. The snapped pixel's file and coordinate are written beside the literal. */
import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { alphaReport, decode, hex, kmeans, resizeBox, sha1 } from './pixels.mjs';

const root = join(import.meta.dirname, '..');
const rel = f => relative(root, f).split('\\').join('/');
const files = ['brand', 'reference'].flatMap(d => readdirSync(join(root, d)).map(n => join(root, d, n)));

function collect(file, { region, minAlpha = 250 } = {}) {
  const img = decode(file), bins = new Map();
  const [x0, y0, x1, y1] = region || [0, 0, img.width, img.height];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) * 4, d = img.data;
    if (d[i + 3] < minAlpha) continue;
    const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    let b = bins.get(key);
    if (!b) bins.set(key, (b = { n: 0, r: 0, g: 0, b: 0, px: [] }));
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    if (b.px.length < 24 && (x * 7 + y * 13) % 11 === 0) b.px.push([x, y, d[i], d[i + 1], d[i + 2]]);
  }
  return { file, bins };
}

function sampleSet(sets, k) {
  const points = [], exemplars = [];
  for (const s of sets) for (const b of s.bins.values()) {
    const mean = [b.r / b.n, b.g / b.n, b.b / b.n];
    const px = b.px.length ? b.px.reduce((a, p) => (dist(p.slice(2), mean) < dist(a.slice(2), mean) ? p : a)) : null;
    if (!px) continue;
    points.push([...mean, Math.sqrt(b.n), exemplars.length]);
    exemplars.push({ file: s.file, x: px[0], y: px[1], rgb: px.slice(2) });
  }
  return kmeans(points, k).map(c => {
    const e = exemplars.reduce((a, p) => (dist(p.rgb, c.centre) < dist(a.rgb, c.centre) ? p : a));
    return { ...c, snap: e, hex: hex(...e.rgb) };
  });
}
const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);

/* ---- palette: logos (opaque pixels only) and the six slides */
const logoPng = join(root, 'brand', 'LOGO JOBR PNG.png');
const logoAlpha = join(root, 'brand', 'LOGO JOBR PNG...png');
const slides = files.filter(f => /JOBR \d/.test(f));
const cover = files.find(f => /SAMPUL/.test(f));
const main = sampleSet([logoPng, logoAlpha, ...slides].map(f => collect(f)), 8);
const notes = sampleSet([collect(cover, { region: [985, 25, 1495, 450] })], 6);

const by = (list, score) => list.reduce((a, c) => (score(c) > score(a) ? c : a));
const pick = {
  bg: by(main.slice(0, 4), c => -luma(c.snap.rgb)),
  accent: by(main, c => chroma(c.snap.rgb) * (luma(c.snap.rgb) > 120 ? 1 : 0)),
  ink: by(main, c => (chroma(c.snap.rgb) < 30 ? luma(c.snap.rgb) : -1)),
  moss: by(main.filter(c => luma(c.snap.rgb) > 40 && luma(c.snap.rgb) < 170 && c !== null), c => chroma(c.snap.rgb) * (c.snap.rgb[1] > c.snap.rgb[0] ? 1 : 0)),
  paper: by(notes, c => (c.snap.rgb[0] > c.snap.rgb[2] ? luma(c.snap.rgb) : -1)),
  paperInk: by(notes, c => -luma(c.snap.rgb)),
  stamp: by(notes, c => (c.snap.rgb[2] > c.snap.rgb[0] + 30 ? chroma(c.snap.rgb) : -1)),
};

/* ---- report */
console.log('main clusters:'); main.forEach(c => console.log(' ', c.hex, rel(c.snap.file), c.snap.x + ',' + c.snap.y, 'w=' + Math.round(c.weight)));
console.log('note clusters:'); notes.forEach(c => console.log(' ', c.hex, rel(c.snap.file), c.snap.x + ',' + c.snap.y, 'w=' + Math.round(c.weight)));
console.log('roles:', Object.fromEntries(Object.entries(pick).map(([k, v]) => [k, v.hex])));

/* ---- tokens.css */
const prov = c => `${rel(c.snap.file)} @ ${c.snap.x},${c.snap.y}`;
const tokens = `/* The only file in the project allowed to contain colour literals.
   SAMPLED PALETTE. Source: brand/ logos and the six reference slides, notes region of the cover for the paper pair.
   Method: k-means (k-means++ seed 7) over 5-bit colour bins weighted by sqrt(count); each centroid was then snapped to
   the real pixel nearest to it, so every literal below is an exact pixel from a real file, coordinate given.
   Regenerate with: node scripts/sample-palette.mjs. Verified by a gate that re-reads each pixel. */
:root {
  color-scheme: dark;

  /* sampled: ${prov(pick.bg)} */
  --bg: ${pick.bg.hex};
  /* sampled: ${prov(pick.accent)} */
  --accent: ${pick.accent.hex};
  /* sampled: ${prov(pick.ink)} */
  --ink: ${pick.ink.hex};
  /* sampled: ${prov(pick.moss)} */
  --moss: ${pick.moss.hex};
  /* sampled: ${prov(pick.paper)} */
  --paper: ${pick.paper.hex};
  /* sampled: ${prov(pick.paperInk)} */
  --paper-ink: ${pick.paperInk.hex};
  /* sampled: ${prov(pick.stamp)} */
  --stamp: ${pick.stamp.hex};

  /* derived by mixing the sampled values, no new literals */
  --accent-ink: var(--bg);
  --surface: color-mix(in srgb, var(--bg) 94%, var(--ink));
  --surface-2: color-mix(in srgb, var(--bg) 89%, var(--ink));
  --surface-3: color-mix(in srgb, var(--bg) 83%, var(--ink));
  --ink-2: color-mix(in srgb, var(--ink) 78%, var(--bg));
  --muted: color-mix(in srgb, var(--ink) 56%, var(--bg));
  --dim: color-mix(in srgb, var(--ink) 36%, var(--bg));
  --mask: var(--ink);
}
`;
writeFileSync(join(root, 'src', 'css', 'tokens.css'), tokens);

/* ---- favicon grid from the transparent logo: premultiplied resize because its transparent pixels are pure black */
const logo = decode(logoAlpha), ar = alphaReport(logo);
console.log(`transparent logo: ${ar.transparent} transparent px, ${ar.blackTransparent} of them pure black -> premultiplied resize`);
let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
for (let y = 0; y < logo.height; y++) for (let x = 0; x < logo.width; x++) if (logo.data[(y * logo.width + x) * 4 + 3] > 127) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const side = Math.max(maxX - minX, maxY - minY) + 1, pad = Math.round(side * 0.10), box = side + pad * 2;
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, bx = Math.round(cx - box / 2), by0 = Math.round(cy - box / 2);
const N = 64, small = resizeBox(logo, N, N, { premultiply: ar.blackTransparent > 0, x0: bx, y0: by0, cw: box, ch: box });
const roles = [['ink', pick.ink.snap.rgb], ['accent', pick.accent.snap.rgb]];
const cells = [];
for (let y = 0; y < N; y++) { let row = ''; for (let x = 0; x < N; x++) {
  const o = (y * N + x) * 4, a = small.data[o + 3] / 255;
  if (a < 0.5) { row += '.'; continue; }
  const rgb = [small.data[o], small.data[o + 1], small.data[o + 2]];
  row += dist(rgb, roles[1][1]) < dist(rgb, roles[0][1]) ? 'a' : 'i';
} cells.push(row); }
writeFileSync(join(root, 'scripts', 'favicon-grid.json'), JSON.stringify({
  note: 'Cells from the real logo pixels: crop to the mark with 10% padding, premultiplied box resize to 64x64, then each cell is ink (i), accent (a) or empty (.).',
  source: rel(logoAlpha), sourceSha1: sha1(logoAlpha), crop: { x: bx, y: by0, size: box }, premultiplied: ar.blackTransparent > 0, size: N, rows: cells,
}, null, 1));
console.log(cells.join('\n'));
