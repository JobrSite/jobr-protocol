import { ms } from './clock.js';
import { activeRecords, caView, hrefOf, handleOf } from './registry.js';
import * as live from './live.js';
import { setLive, reveal, scrollFx } from './motion.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const net = (...a) => fetch(...a);
const recs = activeRecords();

/* ---- contract address slot: inert until stated */
function hydrateCa() {
  const slot = $('#ca-slot'), text = $('#ca-text'), act = $('#ca-act');
  const v = caView(recs.ca);
  if (!v.live) return;
  text.dataset.state = 'stated';
  text.textContent = v.text;
  slot.disabled = false;
  slot.removeAttribute('aria-disabled');
  slot.setAttribute('aria-label', 'Coin address ' + v.text + '. Click to copy.');
  let timer = 0;
  slot.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(v.text); ok = true; } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: v.text });
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { /* no clipboard at all */ }
      ta.remove();
    }
    act.textContent = ok ? 'Copied' : 'Select it';
    slot.classList.toggle('copied', ok);
    clearTimeout(timer);
    timer = setTimeout(() => { act.textContent = 'Copy'; slot.classList.remove('copied'); }, ms(1600));
  });
}

/* ---- socials: an anchor only when the record is stated, derived handle in the label */
function hydrateSocials() {
  for (const [id, name] of [['x', 'X'], ['github', 'GitHub']]) {
    const el = $('#soc-' + id), r = recs[id], href = hrefOf(r);
    if (!el || !href) continue;
    const a = document.createElement('a');
    a.className = el.className;
    a.id = el.id;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const h = handleOf(r.url);
    a.setAttribute('aria-label', h ? `${name} ${h}` : name);
    a.innerHTML = el.innerHTML;
    el.replaceWith(a);
  }
}

/* ---- status pill */
const PILL = { connecting: 'Connecting', live: 'Live', delayed: 'Delayed', offline: 'Offline' };
let lastOk = 0;
const t0 = performance.now();
function pill(state) {
  $$('[data-pill]').forEach(p => { p.dataset.state = state; $('[data-pill-text]', p).textContent = PILL[state]; });
}
function health() {
  if (!lastOk) { if (performance.now() - t0 > ms(8000)) pill('offline'); return; }
  const age = performance.now() - lastOk;
  pill(age < ms(20000) ? 'live' : age < ms(60000) ? 'delayed' : 'offline');
}

/* ---- live slots */
const slots = {
  block: $('[data-live="block"]'), gwei: $('[data-live="gwei"]'), tvl: $('[data-live="tvl"]'),
  tvl2: $('[data-live="tvl2"]'), tvlNote: $('[data-live="tvl-note"]'), pairCount: $('[data-live="pair-count"]'),
};
const fail = el => { if (el && !el._v) { el.textContent = '—'; el.title = 'Source unavailable'; } };

async function pollChain() {
  const d = await live.fetchChain(net);
  if (d) { lastOk = performance.now(); setLive(slots.block, d.block, live.fmtInt); setLive(slots.gwei, d.gwei, live.fmtGwei); }
  else { fail(slots.block); fail(slots.gwei); }
  health();
}
async function pollTvl() {
  const [now, hist] = await Promise.all([live.fetchTvl(net), live.fetchTvlHistory(net)]);
  if (now) { setLive(slots.tvl, now.tvl, live.fmtUsdCompact); setLive(slots.tvl2, now.tvl, live.fmtUsdCompact); }
  else { fail(slots.tvl); fail(slots.tvl2); }
  drawSpark(hist);
  slots.tvlNote.textContent = hist ? `${hist.length} daily points` : 'History unavailable';
}
function drawSpark(vals) {
  const box = $('#spark');
  if (!vals) { box.innerHTML = '<p class="empty">The history feed did not answer. Retrying shortly.</p>'; return; }
  const W = 600, H = 140, max = Math.max(...vals), min = Math.min(...vals), flat = max === min;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, flat ? H / 2 : H - 8 - ((v - min) / (max - min)) * (H - 24)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const last = pts[pts.length - 1];
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="area" d="${d}L${W} ${H}L0 ${H}Z"/><path class="line" pathLength="1" d="${d}"/>${flat ? '' : `<circle class="end" cx="${last[0]}" cy="${last[1]}" r="4"/>`}</svg>`;
  box.setAttribute('aria-label', `Value locked over the last ${vals.length} days, from ${live.fmtUsdCompact(vals[0])} to ${live.fmtUsdCompact(vals[vals.length - 1])}`);
  box.classList.remove('drawn'); void box.offsetWidth; box.classList.add('drawn');
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function pollPairs() {
  const d = await live.fetchPairs(net);
  const list = $('#pairs');
  if (!d || !d.rows.length) {
    list.innerHTML = `<li class="pair"><p class="empty">${d ? 'No pairs found for this chain yet.' : 'The pair feed did not answer. Retrying shortly.'}</p></li>`;
    fail(slots.pairCount);
    $$('[data-pairs-lane]').forEach(l => { l.innerHTML = '<li class="chip">Pair feed quiet</li>'; });
    return;
  }
  setLive(slots.pairCount, d.total, live.fmtInt);
  list.innerHTML = d.rows.map(r => {
    const inner = `<span class="sym">${esc(r.base)}<small>/ ${esc(r.quote)}</small></span><span class="px">${live.fmtPrice(r.priceUsd)}</span><span class="ch ${r.change24h > 0 ? 'up' : ''}">${live.fmtChange(r.change24h)}</span>`;
    return r.url
      ? `<li class="pair"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>`
      : `<li class="pair"><div class="row">${inner}</div></li>`;
  }).join('');
  const chips = d.rows.map(r => `<li class="chip">${esc(r.base)}<em>/ ${esc(r.quote)}</em><em class="${r.change24h > 0 ? 'up' : 'dn'}">${live.fmtPrice(r.priceUsd)}</em></li>`).join('');
  $$('[data-pairs-lane]').forEach(l => { l.innerHTML = chips + chips; });
}

function every(fn, ms0) {
  fn();
  setInterval(() => { if (!document.hidden) fn(); }, ms(ms0));
}

hydrateCa();
hydrateSocials();
reveal();
scrollFx();
pill('connecting');
every(pollChain, 5000);
every(pollTvl, 90000);
every(pollPairs, 45000);
setInterval(health, ms(2000));
