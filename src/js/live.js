/* Live data: pure parsers plus fetchers that take an injected fetch. Every failure resolves to null. */

export const CHAIN_ID = 4663;
export const RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const LLAMA_CHAINS = 'https://api.llama.fi/v2/chains';
export const LLAMA_HISTORY = 'https://api.llama.fi/v2/historicalChainTvl/Robinhood%20Chain';
export const DEX_SEARCH = 'https://api.dexscreener.com/latest/dex/search?q=robinhood';
export const DEX_CHAIN = 'robinhood';

const num = v => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const hex = v => (typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v) ? Number(BigInt(v)) : null);

export function parseRpcBatch(json) {
  if (!Array.isArray(json)) return null;
  const by = {};
  for (const r of json) if (r && typeof r === 'object') by[r.id] = r.result;
  if (hex(by[3]) !== CHAIN_ID) return null;
  const block = hex(by[1]);
  const gasWei = hex(by[2]);
  if (block == null || gasWei == null) return null;
  return { block, gwei: gasWei / 1e9 };
}

export function parseLlamaChains(json) {
  if (!Array.isArray(json)) return null;
  const c = json.find(x => x && (x.chainId === CHAIN_ID || x.name === 'Robinhood Chain'));
  const tvl = c ? num(c.tvl) : null;
  return tvl == null ? null : { tvl };
}

export function parseLlamaHistory(json, keep = 30) {
  if (!Array.isArray(json)) return null;
  const pts = json.map(p => num(p && p.tvl)).filter(v => v != null);
  return pts.length >= 2 ? pts.slice(-keep) : null;
}

export function parseDex(json, limit = 8) {
  const list = json && Array.isArray(json.pairs) ? json.pairs : null;
  if (!list) return null;
  const rows = list
    .filter(p => p && p.chainId === DEX_CHAIN && p.baseToken && p.quoteToken)
    .map(p => ({
      base: String(p.baseToken.symbol || '').slice(0, 12),
      quote: String(p.quoteToken.symbol || '').slice(0, 12),
      priceUsd: num(p.priceUsd),
      change24h: num(p.priceChange && p.priceChange.h24),
      liqUsd: num(p.liquidity && p.liquidity.usd) || 0,
      url: typeof p.url === 'string' && p.url.startsWith('https://dexscreener.com/') ? p.url : null,
    }))
    .filter(r => r.base)
    .sort((a, b) => b.liqUsd - a.liqUsd);
  return { total: rows.length, rows: rows.slice(0, limit) };
}

async function json(f, url, init) {
  try {
    const r = await f(url, init);
    return r && r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export const fetchChain = f =>
  json(f, RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_gasPrice', params: [] },
      { jsonrpc: '2.0', id: 3, method: 'eth_chainId', params: [] },
    ]),
  }).then(parseRpcBatch);

export const fetchTvl = f => json(f, LLAMA_CHAINS).then(parseLlamaChains);
export const fetchTvlHistory = f => json(f, LLAMA_HISTORY).then(j => parseLlamaHistory(j));
export const fetchPairs = f => json(f, DEX_SEARCH).then(j => parseDex(j));

/* ---- formatting */
export function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}
export function fmtUsdCompact(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const [d, s] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  return '$' + (n / d).toFixed(s ? 2 : 2) + s;
}
export function fmtGwei(g) {
  if (g == null) return '—';
  return g >= 1 ? g.toFixed(2) : g >= 0.01 ? g.toFixed(3) : g.toFixed(4);
}
export function fmtPrice(p) {
  if (p == null) return '—';
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toPrecision(3);
}
export function fmtChange(c) {
  if (c == null) return '—';
  return (c > 0 ? '+' : '') + c.toFixed(1) + '%';
}
