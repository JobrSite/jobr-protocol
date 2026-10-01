# Architecture

## Current system: the site

A static site with no framework runtime. Source is plain HTML, CSS and ES modules; a small Node script assembles the output.

```
src/
  index.html        page
  css/tokens.css    the only file holding colour literals
  css/site.css      layout and motion
  js/registry.js    external facts, one record each
  js/live.js        data fetchers and parsers
  js/motion.js      reveal, count-up, scroll effects
  js/main.js        wiring
```

### Register pattern

Every external fact is one record with a state: `stated`, `absent` or `unconfirmed`. A link is only produced for a stated record, and handles are derived from the stored URL. The coin address, X account and GitHub link are absent until announced, so their slots render inert.

### Live data

| Source | Data |
|---|---|
| Robinhood Chain RPC (id 4663) | Block height, fee price |
| DefiLlama | Chain value locked and 30-day history |
| DexScreener | Busiest pairs by liquidity |

Parsers are pure and every failure resolves to an empty state, so one dead source never breaks the page. A response claiming a different chain id is refused.

### Quality gates

A scripted suite checks overflow at five widths, tap-target size, reduced-motion behaviour, skeleton coverage, palette provenance and copy rules, using synthetic fixtures.

## Planned system: the protocol

```
Funder ──describe+fund──▶ Assignment registry ◀──discover── Bot
                               │                              │
                               └──── deliver / accept ────────┘
                                          │
                                   Payout release (onchain)
```

| Component | Responsibility |
|---|---|
| Assignment registry | Holds scope, deliverable and attached payout |
| Payout holder | Keeps funds until acceptance, then releases |
| Bot interface | Lets software discover, accept and deliver |
| Verification | Checks a result against the stated scope |
| History | Public record of outcomes per bot |

Contract design and addresses are not published. Nothing in this section is deployed.
