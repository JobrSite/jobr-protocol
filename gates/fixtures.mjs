/* Synthetic fixtures only. Nothing here was copied from a live response. */

export const ADDR = {
  zero: '0x0000000000000000000000000000000000000000',
  lowLead: '0x0000000000000000000000000000000000000abc',
  lower: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  upperDigits: '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD',
  mixed: '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01',
  ones: '0xffffffffffffffffffffffffffffffffffffffff',
  repeat: '0x1111111111111111111111111111111111111111',
};
export const BAD_ADDR = ['0x', '0x123', '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'abcdefabcdefabcdefabcdefabcdefabcdefabcd', ' ' + ADDR.lower, ADDR.lower + '00', null, 42];

export const rpcBatch = n => [
  { jsonrpc: '2.0', id: 1, result: '0x' + (1_000_000 + n * 7).toString(16) },
  { jsonrpc: '2.0', id: 2, result: '0x' + (20_000_000 + n * 1_000_000).toString(16) },
  { jsonrpc: '2.0', id: 3, result: '0x1237' },
];
export const rpcWrongChain = [
  { jsonrpc: '2.0', id: 1, result: '0x10' }, { jsonrpc: '2.0', id: 2, result: '0x10' }, { jsonrpc: '2.0', id: 3, result: '0x1' },
];

export const llamaChains = [
  { name: 'Alpha Net', chainId: 1, tvl: 5 },
  { name: 'Robinhood Chain', chainId: 4663, tvl: 123456789.5 },
];
export const llamaHistory = Array.from({ length: 40 }, (_, i) => ({ date: 1_700_000_000 + i * 86400, tvl: 1000 + i * i * 50 }));

const pair = (chainId, base, quote, liq, extra = {}) => ({
  chainId, url: `https://dexscreener.com/${chainId}/${base}`, baseToken: { symbol: base, address: ADDR.lower }, quoteToken: { symbol: quote, address: ADDR.zero },
  priceUsd: '0.001636', priceChange: { h24: -3.4 }, liquidity: { usd: liq }, ...extra,
});
export const dex = {
  pairs: [
    pair('robinhood', 'AAA', 'ETH', 500),
    pair('other', 'ZZZ', 'ETH', 9_999_999),
    pair('robinhood', 'BBB', 'ETH', 90_000, { priceChange: { h24: 12.25 } }),
    pair('robinhood', 'CCC', 'ETH', 20_000, { url: 'https://evil.example/x' }),
    pair('robinhood', 'DDD', 'ETH', 7_000, { priceUsd: null, priceChange: null }),
    { chainId: 'robinhood', baseToken: null },
  ],
};
