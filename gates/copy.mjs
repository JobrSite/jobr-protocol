import { createHash } from 'node:crypto';

export const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 10);

/* Function words never count as shared vocabulary. */
export const STOP = new Set(('a an and are as at be been being but by can do does for from get got had has have how i if in into is it its ' +
  'let me more most no not of on one only or our out over so some such than that the their them then there these they this to too up us ' +
  'was we were what when where which while who why will with within without you your yours all any each every also just very via per').split(' '));

/* Words that belong to the chain itself and have no synonym. */
export const ALLOW = new Set(['robinhood', 'chain', 'gas', 'jobr']);

/* The chain's own name is a proper noun, the one pair allowed to repeat. */
export const ALLOW_PAIRS = new Set(['robinhood chain']);

export const words =text => (text.toLowerCase().match(/[a-z][a-z'-]*/g) || []).map(w => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);

export const bigrams = text => {
  const out = new Set();
  for (const chunk of text.toLowerCase().split(/[.!?;:\n|·•]+/)) {
    const w = words(chunk);
    for (let i = 0; i < w.length - 1; i++) out.add(w[i] + ' ' + w[i + 1]);
  }
  return out;
};

export function fingerprint(text) {
  return {
    words: [...new Set(words(text).filter(w => !STOP.has(w)))].map(hash).sort(),
    bigrams: [...bigrams(text)].map(hash).sort(),
  };
}

/* Visible and spoken copy of a built page plus the labels its script renders. */
export function copyOf(html, js) {
  const attrs = [...html.matchAll(/(?:aria-label|title|content|alt)="([^"]{3,})"/g)].map(m => m[1]);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const lits = [...js.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){4,})\1/g)].map(m => m[2]).filter(s => /^[A-Za-z][A-Za-z ,.'—-]+$/.test(s) && s.includes(' '));
  const pills = [...js.matchAll(/(?:connecting|live|delayed|offline):\s*'([^']+)'/g)].map(m => m[1]);
  return [text, ...attrs, ...lits, ...pills].join('\n');
}
