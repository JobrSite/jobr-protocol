import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const tokens = readFileSync(join(src, 'css', 'tokens.css'), 'utf8');
const token = name => {
  const m = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`tokens.css has no sampled --${name}`);
  return m[1];
};
const swatch = { bg: token('bg'), ink: token('ink'), accent: token('accent') };
const fill = s => s.replace(/\{\{(bg|ink|accent)\}\}/g, (_, k) => swatch[k]);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(src, dist, { recursive: true });

const html = join(dist, 'index.html');
writeFileSync(html, fill(readFileSync(html, 'utf8')));

/* Open-graph cover: the supplied cover image, copied as is. */
const coverSrc = readdirSync(join(root, 'reference')).find(n => /^SAMPUL/i.test(n));
if (coverSrc) {
  mkdirSync(join(dist, 'assets'), { recursive: true });
  cpSync(join(root, 'reference', coverSrc), join(dist, 'assets', 'cover.jpg'));
}

/* Favicon: the 64x64 grid sampled from the real logo pixels (scripts/sample-palette.mjs), runs merged into rects. */
const grid = JSON.parse(readFileSync(join(root, 'scripts', 'favicon-grid.json'), 'utf8'));
const fillOf = { i: swatch.ink, a: swatch.accent };
let rects = '';
grid.rows.forEach((row, y) => {
  for (let x = 0; x < row.length;) {
    const c = row[x];
    if (c === '.') { x++; continue; }
    let e = x;
    while (e < row.length && row[e] === c) e++;
    rects += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${fillOf[c]}"/>`;
    x = e;
  }
});
writeFileSync(
  join(dist, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.size} ${grid.size}" shape-rendering="crispEdges"><rect width="${grid.size}" height="${grid.size}" rx="12" fill="${swatch.bg}"/>${rects}</svg>\n`,
);

let files = 0, bytes = 0;
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n), s = statSync(p);
    if (s.isDirectory()) walk(p); else { files++; bytes += s.size; }
  }
})(dist);
console.log(`build ok: ${files} files, ${(bytes / 1024).toFixed(1)} KB -> dist/`);
