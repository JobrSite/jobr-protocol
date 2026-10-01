import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { ALLOW, ALLOW_PAIRS, STOP, bigrams, copyOf, hash, words } from './copy.mjs';
import * as fx from './fixtures.mjs';
import * as live from '../src/js/live.js';
import { alphaReport, decode, hex, resizeBox, sha1 } from '../scripts/pixels.mjs';
import { handleOf, hrefOf, isAddress, records, validateRecord } from '../src/js/registry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const read = p => readFileSync(join(root, p), 'utf8');
const MAX_GATES = 30;

/* ------------------------------------------------------------------ helpers */
function walk(dir, skip = () => false, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (skip(n, p)) continue;
    if (statSync(p).isDirectory()) walk(p, skip, out); else out.push(p);
  }
  return out;
}
const rel = p => relative(root, p).split(sep).join('/');
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sleep = t => new Promise(r => setTimeout(r, t));

const srcFiles = () => walk(join(root, 'src')).filter(p => /\.(css|js|html)$/.test(p));
const tokensPath = join(root, 'src', 'css', 'tokens.css');

/* ------------------------------------------------------------------ local server and network fixtures */
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
let origin = '';
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  if (!f.startsWith(dist) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
});

const EDGE = [process.env.CHROME_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
let browser;

async function open({ scale = 20, records: recs, hold, fail = false, width = 1440, height = 900, reduce = false } = {}) {
  const page = await browser.newPage();
  const log = { errors: [], rpc: 0 };
  page.on('pageerror', e => log.errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '') && !/ERR_FAILED|net::/.test(m.text())) log.errors.push('console: ' + m.text()); });
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((scale, recs) => {
    window.__JOBR_TEST__ = { scale, records: recs };
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true });
    window.__seen = [];
    new MutationObserver(ms => {
      for (const m of ms) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const slot = el && el.closest && el.closest('[data-live="block"]');
        if (slot && /\d/.test(slot.textContent)) window.__seen.push(slot.textContent);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, scale, recs || null);
  await page.setRequestInterception(true);
  page.on('request', async req => {
    const u = req.url(), m = req.method();
    if (u.startsWith(origin)) return req.continue();
    if (/fonts\.g/.test(u)) return req.abort();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (m === 'OPTIONS') return req.respond({ status: 204, headers: cors });
    if (hold) await hold;
    const send = body => (fail ? req.respond({ status: 500, headers: cors, body: '{}' }) : req.respond({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    if (u.includes('rpc.mainnet.chain.robinhood.com')) { log.rpc++; return send(fx.rpcBatch(log.rpc)); }
    if (u.includes('historicalChainTvl')) return send(fx.llamaHistory);
    if (u.includes('api.llama.fi/v2/chains')) return send(fx.llamaChains);
    if (u.includes('api.dexscreener.com')) return send(fx.dex);
    return req.abort();
  });
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  page.log = log;
  return page;
}
const settled = (page, t = 8000) => page.waitForFunction(() => !document.querySelector('.sk'), { timeout: t });
const withPage = async (opts, fn) => { const p = await open(opts); try { return await fn(p); } finally { await p.close(); } };

/* ------------------------------------------------------------------ gates */
const gates = [];
const gate = (name, fn) => gates.push([name, fn]);

/* ---- static and unit */
gate('build output present', () => {
  for (const f of ['index.html', 'favicon.svg', 'css/tokens.css', 'css/site.css', 'js/main.js', 'js/live.js', 'js/registry.js', 'js/motion.js', 'js/clock.js']) assert(existsSync(join(dist, f)), 'missing dist/' + f);
});

gate('repo hygiene: no agent files, no machine attribution', () => {
  const skip = n => ['node_modules', '.git'].includes(n);
  const all = walk(root, skip);
  assert(!all.some(p => new RegExp('(^|/)CLA' + 'UDE\\.md$', 'i').test(rel(p))), 'agent memory file present');
  assert(!existsSync(join(root, '.' + 'cla' + 'ude')), 'agent config directory present');
  const bad = [new RegExp('Co-Authored' + '-By', 'i'), new RegExp('Generated ' + 'with', 'i'), new RegExp('cla' + 'ude', 'i'), new RegExp('anthr' + 'opic', 'i'), new RegExp('\\bAI[- ]generated\\b', 'i')];
  for (const p of all.filter(p => !/\.(png|jpe?g|jpeg|ico|woff2?)$/i.test(p))) {
    const t = readFileSync(p, 'utf8');
    for (const re of bad) assert(!re.test(t), `${rel(p)} matches ${re}`);
  }
});

const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const NAMED = /:\s*[^;{}]*\b(white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|silver|navy|teal|cyan|magenta|lime|maroon|olive|aqua|fuchsia|gold|brown)\b/i;
gate('palette: colour literals live only in tokens.css', () => {
  const files = [...srcFiles(), ...walk(join(root, 'scripts')), ...walk(join(root, 'gates'), (n, p) => n === 'fixtures' || p.endsWith('run.mjs'))];
  for (const p of files) {
    if (p === tokensPath) continue;
    const t = readFileSync(p, 'utf8');
    assert(!(t.match(HEX) || []).length, `${rel(p)} has hex literal ${(t.match(HEX) || [])[0]}`);
    assert(!/(^|[^-\w])(rgba?|hsla?|hwb|oklab|oklch|lab|lch)\(/i.test(t), `${rel(p)} has colour function`);
    if (p.endsWith('.css')) assert(!NAMED.test(t), `${rel(p)} uses a named colour`);
  }
  const tokens = readFileSync(tokensPath, 'utf8');
  assert((tokens.match(HEX) || []).length >= 7, 'tokens.css should define the palette');
  assert(/SAMPLED PALETTE/.test(tokens) && !/UNSAMPLED|placeholder/i.test(tokens), 'tokens.css must state the palette as sampled');
});

gate('palette provenance: every literal is the exact real pixel it cites, favicon from the logo grid', () => {
  const t = readFileSync(tokensPath, 'utf8');
  assert(!COLOR_FN.test(t), 'tokens.css uses a colour function; use plain hex');
  assert(/k-means/.test(t) && /snapped to\s+the real pixel/.test(t), 'method must be stated in the provenance comment');
  const rows = [...t.matchAll(/\/\* sampled: (.+?) @ (\d+),(\d+) \*\/\s*--([\w-]+):\s*(#[0-9a-f]{6});/g)];
  eq(rows.length, (t.match(HEX) || []).length, 'every colour literal carries a provenance comment');
  const cache = new Map();
  for (const [, file, x, y, name, lit] of rows) {
    if (!cache.has(file)) cache.set(file, decode(join(root, file)));
    const img = cache.get(file), i = (Number(y) * img.width + Number(x)) * 4;
    eq(hex(img.data[i], img.data[i + 1], img.data[i + 2]), lit, `--${name} vs ${file} @ ${x},${y}`);
  }
  const grid = JSON.parse(read('scripts/favicon-grid.json'));
  eq(grid.sourceSha1, sha1(join(root, grid.source)), 'favicon grid matches the current logo file');
  assert(grid.premultiplied === true && alphaReport(decode(join(root, grid.source))).blackTransparent > 0, 'transparent black pixels were found, so the resize must be premultiplied');
  const svg = read('dist/favicon.svg'), lits = new Set(rows.map(r => r[5]));
  const used = new Set(svg.match(HEX) || []);
  assert(used.size >= 3 && [...used].every(c => lits.has(c)), 'favicon colours must all come from the sampled tokens');
  assert((svg.match(/<rect /g) || []).length > 20, 'favicon should be built from the pixel grid');
});

gate('premultiplied resize: transparent black carries no colour', () => {
  const lime = [179, 234, 59];
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([...lime, 255, 0, 0, 0, 0]) };
  const good = resizeBox(img, 1, 1, { premultiply: true }), bad = resizeBox(img, 1, 1, { premultiply: false });
  for (let c = 0; c < 3; c++) assert(Math.abs(good.data[c] - lime[c]) <= 1, `premultiplied channel ${c} drifted: ${good.data[c]}`);
  assert(Math.abs(good.data[3] - 127.5) <= 1, 'alpha should be the area average');
  assert(bad.data[0] < 100, 'the naive resize should visibly darken, proving the fixture is sharp enough');
  const solid = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) };
  eq(Array.from(resizeBox(solid, 1, 1).data), [200, 200, 200, 200], 'opaque pixels are untouched');
});

gate('no ch units anywhere in styles', () => {
  for (const p of [...srcFiles(), join(dist, 'css', 'site.css')]) {
    const t = readFileSync(p, 'utf8');
    assert(!/(?<![\w-])\d*\.?\d+ch\b/.test(t), `${rel(p)} uses a ch unit`);
  }
});

gate('register: records validate, bad shapes are refused', () => {
  for (const r of Object.values(records)) eq(validateRecord(r), null, 'record ' + r.id);
  assert(validateRecord({ id: 'a', state: 'maybe' }), 'bad state accepted');
  assert(validateRecord({ state: 'stated', value: 1 }), 'missing id accepted');
  assert(validateRecord({ id: 'a', state: 'stated' }), 'empty stated record accepted');
  assert(validateRecord(null), 'null accepted');
  for (const id of ['ca', 'x', 'github', 'launch']) eq(records[id].state, 'absent', id + ' state');
  eq(records.chain.value.id, 4663, 'chain id');
});

gate('link rule: href only when stated, handle derived from url', () => {
  eq(hrefOf({ state: 'absent', url: 'https://x.com/a' }), null, 'absent');
  eq(hrefOf({ state: 'unconfirmed', url: 'https://x.com/a' }), null, 'unconfirmed');
  eq(hrefOf({ state: 'stated', url: 'https://x.com/a' }), 'https://x.com/a', 'stated');
  eq(hrefOf({ state: 'stated', value: 'x' }), null, 'stated without url');
  eq(hrefOf(records.x), null, 'registry x');
  eq(handleOf(records.x.url), '@Jobr_Site', 'derived handle');
  eq(handleOf('https://github.com/some-org/repo'), '@some-org', 'github handle');
  eq(handleOf('not a url'), null, 'junk url');
  eq(handleOf(null), null, 'null url');
});

gate('hex gate: real 0x hex is never blanket-rejected', () => {
  for (const [k, v] of Object.entries(fx.ADDR)) assert(isAddress(v), `${k} (${v}) was rejected`);
  for (const v of fx.BAD_ADDR) assert(!isAddress(v), `malformed ${JSON.stringify(v)} was accepted`);
});

const ref = JSON.parse(read('gates/fixtures/ref-fingerprint.json'));
const ownCopy = () => copyOf(readFileSync(join(dist, 'index.html'), 'utf8'), readFileSync(join(dist, 'js', 'main.js'), 'utf8'));
gate('copy: zero shared word pairs with the reference', () => {
  const refSet = new Set(ref.bigrams);
  const hits = [...bigrams(ownCopy())].filter(b => refSet.has(hash(b)) && !ALLOW_PAIRS.has(b));
  assert(!hits.length, 'shared pairs: ' + hits.slice(0, 8).join(' | '));
});

gate('copy: zero shared vocabulary with the reference', () => {
  const refSet = new Set(ref.words);
  const hits = [...new Set(words(ownCopy()))].filter(w => !STOP.has(w) && !ALLOW.has(w) && refSet.has(hash(w)));
  assert(!hits.length, 'shared words: ' + hits.join(', '));
});

gate('live parsers and formatters: fixtures, wrong chain, garbage, failures', async () => {
  formatChecks();
  const c = live.parseRpcBatch(fx.rpcBatch(3));
  eq(c.block, 1_000_021, 'block'); eq(Math.round(c.gwei * 1000), 23, 'gwei');
  eq(live.parseRpcBatch(fx.rpcWrongChain), null, 'wrong chain');
  eq(live.parseLlamaChains(fx.llamaChains), { tvl: 123456789.5 }, 'tvl');
  const h = live.parseLlamaHistory(fx.llamaHistory); eq(h.length, 30, 'history keeps 30'); assert(h[29] > h[0], 'history order');
  const d = live.parseDex(fx.dex);
  eq(d.rows.map(r => r.base), ['BBB', 'CCC', 'DDD', 'AAA'], 'dex rank, chain filter, junk dropped');
  eq(d.rows[1].url, null, 'untrusted pair url dropped');
  eq(d.rows[3].priceUsd, 0.001636, 'price parsed');
  eq(d.rows[2].priceUsd, null, 'null price kept null');
  for (const g of [null, undefined, {}, [], 'x', 7, [{ id: 3, result: '0xzz' }]]) {
    for (const fn of [live.parseRpcBatch, live.parseLlamaChains, live.parseLlamaHistory, live.parseDex]) eq(fn(g), null, `${fn.name}(${JSON.stringify(g)})`);
  }
  for (const f of [() => Promise.reject(new Error('down')), () => Promise.resolve({ ok: false }), () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad')) })]) {
    eq(await live.fetchChain(f), null, 'fetchChain failure'); eq(await live.fetchTvl(f), null, 'fetchTvl failure');
    eq(await live.fetchTvlHistory(f), null, 'fetchTvlHistory failure'); eq(await live.fetchPairs(f), null, 'fetchPairs failure');
  }
});

const formatChecks = () => {
  eq(live.fmtInt(1234567.4), '1,234,567', 'int');
  eq(live.fmtUsdCompact(1036497512.87), '$1.04B', 'billions'); eq(live.fmtUsdCompact(2_500_000), '$2.50M', 'millions'); eq(live.fmtUsdCompact(1500), '$1.50K', 'thousands'); eq(live.fmtUsdCompact(null), '—', 'null');
  eq(live.fmtGwei(0.0201), '0.020', 'small gwei'); eq(live.fmtGwei(3.456), '3.46', 'gwei'); eq(live.fmtGwei(0.004), '0.0040', 'tiny gwei');
  eq(live.fmtPrice(0.001636), '$0.00164', 'tiny price'); eq(live.fmtPrice(12.3456), '$12.35', 'price');
  eq(live.fmtChange(12.25), '+12.3%', 'up'); eq(live.fmtChange(-3.44), '-3.4%', 'down'); eq(live.fmtChange(null), '—', 'null change');
};

gate('static dom: address slot first, no social links, no dates, no address', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  assert(html.indexOf('id="ca"') > 0 && html.indexOf('id="ca"') < html.indexOf('<header'), 'address slot must precede the header');
  assert(html.indexOf('id="ca-slot"') < html.indexOf('<a '), 'address slot must be the first interactive element');
  assert(!/<a [^>]*href="https?:\/\/(x|twitter|github)\./i.test(html), 'social href present for unstated record');
  assert(!/0x[0-9a-fA-F]{40}/.test(html), 'address baked into markup');
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  assert(!/\b(19|20)\d{2}\b/.test(text), 'a year appears in the copy');
  assert(!/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i.test(text), 'a date appears in the copy');
  assert(!/\b(launch(es|ed|ing)? (on|in)|coming (on|in))\b/i.test(text), 'a launch date claim appears');
});

/* ---- browser: behaviour */
gate('page loads clean: no console or page errors, data lands', () => withPage({}, async p => {
  await settled(p);
  await sleep(300);
  eq(p.log.errors, [], 'errors');
}));

gate('address slot: inert while absent, full address and copy when stated', async () => {
  await withPage({}, async p => {
    await settled(p);
    const s = await p.evaluate(() => {
      const b = document.getElementById('ca-slot'), r = b.getBoundingClientRect(); b.click();
      return { dis: b.disabled, aria: b.getAttribute('aria-disabled'), top: r.top, text: document.getElementById('ca').textContent, copied: window.__copied.length };
    });
    assert(s.dis && s.aria === 'true', 'slot must be disabled');
    assert(s.top <= 1, 'slot must sit at the very top');
    assert(!/0x[0-9a-fA-F]{40}/.test(s.text) && /Not stated/.test(s.text), 'absent slot shows no address');
    eq(s.copied, 0, 'clicks must not copy');
  });
  for (const a of [fx.ADDR.zero, fx.ADDR.mixed, fx.ADDR.ones]) {
    await withPage({ scale: 2, records: { ca: { id: 'ca', state: 'stated', value: a } } }, async p => {
      await settled(p);
      await p.click('#ca-slot');
      await sleep(60);
      const s = await p.evaluate(() => ({ text: document.getElementById('ca-text').textContent, dis: document.getElementById('ca-slot').disabled, copied: window.__copied.slice(), act: document.getElementById('ca-act').textContent }));
      eq(s.text, a, 'full address shown'); assert(!s.dis, 'slot enabled'); eq(s.copied, [a], 'clipboard got the full address'); eq(s.act, 'Copied', 'feedback');
    });
  }
  await withPage({ records: { ca: { id: 'ca', state: 'unconfirmed', value: fx.ADDR.lower } } }, async p => {
    const dis = await p.evaluate(() => document.getElementById('ca-slot').disabled);
    assert(dis, 'unconfirmed address must stay inert');
  });
});

gate('socials: icon-only, inert until stated, derived handle when stated', async () => {
  await withPage({}, async p => {
    const s = await p.evaluate(() => ['soc-x', 'soc-github'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { tag: e.tagName, href: e.getAttribute('href'), w: r.width, h: r.height, text: e.textContent.trim(), right: r.right, top: r.top }; }));
    for (const e of s) { eq(e.tag, 'SPAN', 'inert element'); eq(e.href, null, 'no href'); assert(e.w >= 48 && e.h >= 48, 'icon 48px'); eq(e.text, '', 'icon only'); }
    assert(s[1].right > 1200 && s[1].top < 100, 'top-right placement');
  });
  await withPage({ records: { x: { id: 'x', state: 'stated', url: 'https://x.com/Example_Handle' }, github: { id: 'github', state: 'unconfirmed', url: 'https://github.com/example' } } }, async p => {
    const s = await p.evaluate(() => ({
      xTag: document.getElementById('soc-x').tagName, xHref: document.getElementById('soc-x').getAttribute('href'), xLabel: document.getElementById('soc-x').getAttribute('aria-label'),
      gTag: document.getElementById('soc-github').tagName, gHref: document.getElementById('soc-github').getAttribute('href'),
    }));
    eq(s.xTag, 'A', 'stated x is a link'); eq(s.xHref, 'https://x.com/Example_Handle', 'stored url'); eq(s.xLabel, 'X @Example_Handle', 'derived handle');
    eq(s.gTag, 'SPAN', 'unconfirmed github inert'); eq(s.gHref, null, 'unconfirmed github has no href');
  });
});

gate('skeletons cover every live slot, then clear', () => withPage({ hold: new Promise(r => (globalThis.__release = r)) }, async p => {
  const slots = ['[data-live="block"]', '[data-live="gwei"]', '[data-live="tvl"]', '[data-live="tvl2"]', '[data-live="pair-count"]', '#spark', '#pairs', '[data-pairs-lane]'];
  await sleep(500);
  const res = await p.evaluate(sel => sel.map(s => { const e = document.querySelector(s), k = e.querySelector('.sk'); return [s, !!k, k ? getComputedStyle(k).animationName : '']; }), slots);
  for (const [s, has, anim] of res) { assert(has, `${s} has no skeleton`); assert(/sk/.test(anim), `${s} skeleton is not shimmering`); }
  globalThis.__release();
  await settled(p);
}));

gate('count-up ramps on first value, lands exactly', () => withPage({ scale: 1 }, async p => {
  await settled(p, 10000);
  await sleep(1900);
  const seen = await p.evaluate(() => window.__seen);
  const first = seen.findIndex(t => t === '1,000,007');
  assert(first >= 0, 'final value never shown: ' + JSON.stringify(seen.slice(0, 6)));
  const ramp = new Set(seen.slice(0, first).filter(t => t !== '—'));
  assert(ramp.size >= 3, `count-up showed only ${ramp.size} intermediate values`);
}));

gate('value change flashes and updates', () => withPage({}, async p => {
  await settled(p);
  await p.waitForFunction(() => document.querySelector('[data-live="block"]').classList.contains('flash'), { timeout: 8000 });
  const a = await p.evaluate(() => Number(document.querySelector('[data-live="block"]').dataset.value));
  await sleep(700);
  const b = await p.evaluate(() => Number(document.querySelector('[data-live="block"]').dataset.value));
  assert(b > a, `value did not advance (${a} -> ${b})`);
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('[data-live="block"]')).animationName);
  assert(/flash|none/.test(anim), 'flash animation missing');
}));

gate('status pill: connecting, then live with pulsing dot, offline when sources fail', async () => {
  await withPage({ scale: 5, hold: new Promise(r => (globalThis.__rel2 = r)) }, async p => {
    await sleep(300);
    const c = await p.evaluate(() => { const e = document.querySelector('.top [data-pill]'); return [e.dataset.state, getComputedStyle(e.querySelector('i')).animationName]; });
    eq(c[0], 'connecting', 'initial state');
    globalThis.__rel2();
    await p.waitForFunction(() => document.querySelector('.top [data-pill]').dataset.state === 'live', { timeout: 8000 });
    const l = await p.evaluate(() => { const i = document.querySelector('.top [data-pill] i'), s = getComputedStyle(i); return [s.animationName, s.animationIterationCount, document.querySelector('.top [data-pill-text]').textContent]; });
    assert(/ping/.test(l[0]) && l[1] === 'infinite', 'live dot must pulse forever'); eq(l[2], 'Live', 'label');
  });
  await withPage({ fail: true }, async p => {
    await p.waitForFunction(() => document.querySelector('.top [data-pill]').dataset.state === 'offline', { timeout: 8000 });
    await settled(p, 4000);
  });
});

gate('scroll progress bar tracks the page', () => withPage({}, async p => {
  await settled(p);
  const top = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--p')));
  eq(top, 0, 'progress at top');
  await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await sleep(250);
  const end = await p.evaluate(() => ({ p: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--p')), m: getComputedStyle(document.querySelector('#progress i')).transform }));
  assert(end.p > 0.98, 'progress at bottom is ' + end.p);
  assert(/^matrix\(0\.9/.test(end.m) || end.m === 'matrix(1, 0, 0, 1, 0, 0)', 'bar not scaled: ' + end.m);
}));

gate('scroll reveal and staggered entrance', () => withPage({}, async p => {
  await settled(p);
  const before = await p.evaluate(() => { const e = document.getElementById('how'); return [e.classList.contains('seen'), getComputedStyle(e).opacity]; });
  eq(before, [false, '0'], 'below-fold section starts hidden');
  await p.evaluate(() => document.getElementById('how').scrollIntoView({ behavior: 'instant' }));
  await p.waitForFunction(() => document.getElementById('how').classList.contains('seen'), { timeout: 4000 });
  await sleep(1200);
  const after = await p.evaluate(() => ({ o: getComputedStyle(document.getElementById('how')).opacity, d: [...document.querySelectorAll('#how .steps > li')].map(l => parseFloat(getComputedStyle(l).transitionDelay)), o2: [...document.querySelectorAll('#how .steps > li')].map(l => getComputedStyle(l).opacity) }));
  eq(after.o, '1', 'section visible'); assert(after.d[0] < after.d[1] && after.d[1] < after.d[2], 'stagger delays not increasing: ' + after.d); eq(after.o2, ['1', '1', '1', '1'], 'steps visible');
}));

gate('parallax depth moves with scroll', () => withPage({}, async p => {
  await settled(p);
  const t0 = await p.evaluate(() => getComputedStyle(document.querySelector('.ring.r1')).transform);
  await p.evaluate(() => scrollTo(0, 600));
  await sleep(300);
  const r = await p.evaluate(() => ({ y: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--y')), a: getComputedStyle(document.querySelector('.ring.r1')).transform, b: getComputedStyle(document.querySelector('.ring.r2')).transform }));
  assert(r.y > 500, '--y did not follow scroll'); assert(r.a !== t0, 'ring 1 did not move'); assert(r.a !== r.b, 'layers move at one speed');
}));

gate('reduced motion: nothing animates, everything final at once', () => withPage({ reduce: true, scale: 1 }, async p => {
  await settled(p);
  await sleep(300);
  const r = await p.evaluate(() => ({
    anims: document.getAnimations().filter(a => a.playState !== 'finished').length,
    hidden: [...document.querySelectorAll('[data-rise],[data-stagger] > *')].filter(e => getComputedStyle(e).opacity !== '1').length,
    first: window.__seen[0],
    dup: [...document.querySelectorAll('.chips.dup')].every(e => getComputedStyle(e).display === 'none'),
    pill: getComputedStyle(document.querySelector('.top [data-pill] i')).animationName,
  }));
  eq(r.anims, 0, 'running animations'); eq(r.hidden, 0, 'hidden reveal targets'); eq(r.first, '1,000,007', 'first value lands without a ramp'); assert(r.dup, 'marquee copy must be hidden'); eq(r.pill, 'none', 'pill dot');
}));

gate('hover states: every interactive element transitions and moves', () => withPage({ records: { ca: { id: 'ca', state: 'stated', value: fx.ADDR.lower }, x: { id: 'x', state: 'stated', url: 'https://x.com/a' }, github: { id: 'github', state: 'stated', url: 'https://github.com/a' } } }, async p => {
  await settled(p);
  await p.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)));
  const miss = await p.evaluate(() => [...document.querySelectorAll('a[href], button:not(:disabled), summary')].filter(e => e.getBoundingClientRect().width > 0).filter(e => {
    const has = n => n && getComputedStyle(n).transitionDuration.split(',').some(d => parseFloat(d) > 0);
    return !(has(e) || [...e.querySelectorAll('*')].some(has) || has(e.parentElement));
  }).map(e => e.outerHTML.slice(0, 60)));
  eq(miss, [], 'interactive elements without transitions');
  const sig = (e, c) => [e, c ? e.querySelector(c) : null].filter(Boolean).map(n => { const s = getComputedStyle(n); return [s.transform, s.backgroundColor, s.opacity, s.boxShadow, s.color].join('|'); }).join('#');
  for (const [sel, child] of [['.btn.solid', null], ['.btn.ghost', null], ['.logo', '.logo-mark'], ['#ca-slot', '.ca-text']]) {
    const before = await p.$eval(sel, sig, child);
    await p.hover(sel); await sleep(350);
    const after = await p.$eval(sel, sig, child);
    assert(before !== after, `${sel} has no visible hover change`);
  }
}));

/* ---- browser: five breakpoints */
for (const w of [360, 390, 430, 1366, 1440]) {
  gate(`breakpoint ${w}: no overflow, 48px taps, address slot pinned and whole`, async () => {
    const h = w < 500 ? 800 : 768;
    for (const recs of [null, { ca: { id: 'ca', state: 'stated', value: fx.ADDR.mixed }, x: { id: 'x', state: 'stated', url: 'https://x.com/a' }, github: { id: 'github', state: 'stated', url: 'https://github.com/a' } }]) {
      await withPage({ width: w, height: h, records: recs }, async p => {
        await settled(p);
        await sleep(600);
        const m = await p.evaluate(() => {
          const vw = innerWidth, out = { vw, doc: document.documentElement.scrollWidth, wide: [], small: [] };
          for (const e of document.body.querySelectorAll('*')) {
            if (e.closest('.hero-fx, .lane, svg, .sr-only')) continue;
            const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
            if (!r.width || !r.height || cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (r.right > vw + 0.5 || r.left < -0.5) out.wide.push(e.tagName + '.' + e.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
          }
          for (const e of document.querySelectorAll('a[href], button, summary, .icon-btn')) {
            const r = e.getBoundingClientRect();
            if (r.width && r.height && getComputedStyle(e).display !== 'none' && (r.width < 47.99 || r.height < 47.99)) out.small.push(e.tagName + '.' + e.className + ' ' + r.width.toFixed(1) + 'x' + r.height.toFixed(1));
          }
          const t = document.getElementById('ca-text'), s = document.getElementById('ca-slot').getBoundingClientRect();
          out.ca = { top: s.top, h: s.height, right: s.right, clipped: t.scrollWidth > t.clientWidth + 1, text: t.textContent };
          return out;
        });
        assert(m.doc <= m.vw, `page scrolls sideways: ${m.doc} > ${m.vw}`);
        eq(m.wide, [], 'elements outside the viewport'); eq(m.small, [], 'tap targets under 48px');
        assert(m.ca.top <= 1 && m.ca.h >= 48 && m.ca.right <= m.vw + 0.5, 'address slot geometry ' + JSON.stringify(m.ca));
        assert(!m.ca.clipped, 'address text clipped');
        if (recs) eq(m.ca.text, fx.ADDR.mixed, 'full address visible');
        await p.evaluate(() => scrollTo(0, 1500));
        await sleep(200);
        const pinned = await p.evaluate(() => { const r = document.getElementById('ca-slot').getBoundingClientRect(); return [r.top, r.height]; });
        assert(pinned[0] <= 1 && pinned[1] >= 48, 'address slot not pinned after scroll: ' + pinned);
      });
    }
  });
}

/* ------------------------------------------------------------------ runner */
if (gates.length > MAX_GATES) { console.error(`too many gates: ${gates.length} > ${MAX_GATES}`); process.exit(2); }
const t0 = Date.now();
let failed = 0, ran = 0;
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
  if (!EDGE) throw new Error('no Chromium-family browser found; set CHROME_PATH');
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--disable-gpu', '--no-first-run'] });
} catch (e) {
  console.error('browser launch failed: ' + e.message);
}
for (const [i, [name, fn]] of gates.entries()) {
  const n = String(i + 1).padStart(2, '0');
  if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
  ran++;
  const g0 = Date.now();
  try {
    if (!existsSync(join(dist, 'index.html'))) throw new Error('dist missing: run npm run build first');
    if (!browser && /^(page|address|socials|skeletons|count|value|status|scroll|parallax|reduced|hover|breakpoint)/.test(name)) throw new Error('browser unavailable');
    await Promise.race([Promise.resolve().then(fn), new Promise((_, rj) => setTimeout(() => rj(new Error('timeout 40s')), 40000))]);
    console.log(`PASS ${n} ${name} (${Date.now() - g0}ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${n} ${name}\n     ${String(e.message).split('\n')[0].slice(0, 400)}`);
  }
}
if (browser) await browser.close();
server.close();
console.log(`\n${ran - failed}/${ran} gates passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
