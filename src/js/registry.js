/* Register: every external fact is one record with a state.
   stated      confirmed by the owner, may be shown and linked
   absent      known not to exist yet, shown as an inert slot
   unconfirmed seen somewhere but not confirmed, shown as such and never linked */

export const STATES = ['stated', 'absent', 'unconfirmed'];

export const records = {
  domain: { id: 'domain', state: 'stated', value: 'jobr.site' },
  chain: {
    id: 'chain',
    state: 'stated',
    value: { name: 'Robinhood Chain', id: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com' },
  },
  ca: { id: 'ca', state: 'absent', value: null },
  x: { id: 'x', state: 'absent', url: 'https://x.com/Jobr_Site' },
  github: { id: 'github', state: 'absent', url: null },
  launch: { id: 'launch', state: 'absent', value: null },
};

/* Brand assets that exist only as stand-ins. Surfaced in the footer so nobody mistakes them for sampled art. */
export const assets = { palette: 'unsampled', favicon: 'placeholder' };

export function validateRecord(r) {
  if (!r || typeof r !== 'object') return 'record must be an object';
  if (typeof r.id !== 'string' || !r.id) return 'record needs an id';
  if (!STATES.includes(r.state)) return `bad state "${r.state}" on ${r.id}`;
  if (r.state === 'stated' && r.url == null && r.value == null) return `stated record ${r.id} carries nothing`;
  return null;
}

/* Hex is hex. A 0x string of 40 digits is accepted whatever its case, its leading zeros or its repeats.
   Rejecting by pattern ("looks fake", "all zeros", "mixed case") would throw out real addresses. */
export function isAddress(v) {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
}

/* Store the URL, derive the handle. */
export function handleOf(url) {
  if (typeof url !== 'string') return null;
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg : null;
  } catch {
    return null;
  }
}

/* An href exists only for a stated record that has a URL. */
export function hrefOf(record) {
  return record && record.state === 'stated' && typeof record.url === 'string' ? record.url : null;
}

export function caView(record) {
  if (record.state === 'stated' && isAddress(record.value)) return { live: true, text: record.value };
  return { live: false, text: null };
}

export function activeRecords() {
  const fx = typeof window !== 'undefined' && window.__JOBR_TEST__ && window.__JOBR_TEST__.records;
  return fx ? { ...records, ...fx } : records;
}
