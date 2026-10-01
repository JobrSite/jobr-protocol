/* One place for time. The gates set window.__JOBR_TEST__.scale to run the page on a fast clock. */
const t = typeof window !== 'undefined' ? window.__JOBR_TEST__ : null;
export const scale = t && t.scale > 0 ? t.scale : 1;
export const ms = n => n / scale;
export const calm = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

if (typeof document !== 'undefined') document.documentElement.style.setProperty('--ts', String(1 / scale));
