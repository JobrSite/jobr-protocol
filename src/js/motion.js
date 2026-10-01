import { ms, calm } from './clock.js';

const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ease = k => 1 - Math.pow(1 - k, 3);

/* Tween a number into an element. Reduced motion lands on the final value at once. */
export function tween(el, from, to, format, dur, done) {
  if (calm() || from === to) { el.textContent = format(to); done && done(); return; }
  const t0 = performance.now(), d = ms(dur);
  const step = t => {
    const k = Math.max(0, Math.min(1, (t - t0) / d));
    el.textContent = format(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step); else { el.textContent = format(to); done && done(); }
  };
  requestAnimationFrame(step);
}

/* Show a live value: first arrival counts up from zero, later changes tween and flash. */
export function setLive(el, value, format) {
  const prev = el._v;
  el._v = value;
  if (value == null) { el.textContent = '—'; return; }
  el.dataset.value = String(value);
  if (prev == null) { tween(el, 0, value, format, 1300); return; }
  if (prev === value) return;
  tween(el, prev, value, format, 500);
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

/* Rise into view once, staggered children follow one after another. */
export function reveal() {
  const targets = $$('[data-rise],[data-stagger]');
  targets.forEach(g => g.hasAttribute('data-stagger') && [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
  const show = el => el.classList.add('seen');
  if (calm() || !('IntersectionObserver' in window)) { targets.forEach(show); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  targets.forEach(el => io.observe(el));
}

/* Scroll progress bar and parallax depth share one rAF-throttled listener. */
export function scrollFx() {
  const root = document.documentElement;
  const depth = $$('[data-depth]');
  depth.forEach(el => el.style.setProperty('--k', el.dataset.depth));
  let queued = false;
  const update = () => {
    queued = false;
    const max = Math.max(1, root.scrollHeight - innerHeight);
    root.style.setProperty('--p', Math.min(1, scrollY / max).toFixed(4));
    if (!calm()) root.style.setProperty('--y', Math.min(scrollY, 1400) + 'px');
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
}
