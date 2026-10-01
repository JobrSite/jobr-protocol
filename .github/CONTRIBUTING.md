# Contributing to Jobr

Thanks for helping. A few ground rules keep the project tidy.

## Setup

```
npm install
npm run build
npm run gates
```

Both commands should exit 0 before you open a pull request.

## House rules

- **Facts are records.** External facts live in `src/js/registry.js` with a state of stated, absent or unconfirmed. Never link or display something unstated.
- **Colours live in one file.** Literals belong only in `src/css/tokens.css`.
- **Do not reject real hex.** Address checks judge shape, never pattern.
- **Respect motion preferences.** Every animation needs a reduced-motion fallback.
- **48px tap targets** and no horizontal overflow from 360 to 1440 wide.
- **Original copy.** Write your own words.

## Pull requests

1. Branch from the default branch.
2. Keep changes focused and explain the why.
3. Add or update a gate when behaviour changes.
4. Wait for review before merging.

## Issues

Include what you expected, what happened and how to reproduce it. For security matters use [SECURITY.md](SECURITY.md) instead.
