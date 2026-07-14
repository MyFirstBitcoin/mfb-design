# @myfirstbitcoin/design

The My First Bitcoin brand as code: a Tailwind preset, CSS variables, and raw design tokens. Generated from the canonical `tokens.json` (Figma → `sync-brand.js`). Do not edit generated files by hand.

## Install (git dependency)

```json
"dependencies": { "@myfirstbitcoin/design": "github:MyFirstBitcoin/mfb-design#v1.1.0" }
```

## Use - Tailwind 3

```js
// tailwind.config.mjs
import mfb from '@myfirstbitcoin/design/tailwind';
export default { presets: [mfb], content: ['./src/**/*.{astro,html,js,ts}'] };
```

## Use - Tailwind 4

```css
/* global.css */
@import '@myfirstbitcoin/design/theme.css';
```

## Use - plain CSS variables

```css
@import '@myfirstbitcoin/design/brand.css';  /* var(--mfb-purple-400), var(--mfb-gradient-brand) ... */
```

Both utility conventions are served: top-level (preferred for new pages) and mfb- prefixed (legacy, e.g. roadmap). Utilities use the brand palette at the top level (e.g. `bg-purple-400`, `text-orange-300`, `text-gray-900`, `text-h1`), overriding Tailwind's default purple/orange/gray with MFB brand values. Other defaults (red, blue, etc.) are untouched. Plain CSS variables are namespaced `--mfb-*` to avoid collisions.

## Heavy brand assets

Logos, badges, and the brand book PDF live in [MyFirstBitcoin/mfb-brand](https://github.com/MyFirstBitcoin/mfb-brand).
