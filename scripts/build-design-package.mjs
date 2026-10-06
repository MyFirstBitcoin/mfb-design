#!/usr/bin/env node
// Builds the @myfirstbitcoin/design package from this repository's tokens.json.
//
// Sources (all in this repository):
//   tokens.json                    the design tokens, the single source of every value
//   package.json                   hand-maintained; only its version is read here (install pin in README)
//   src/supergraphics.canon.css    the supergraphics canon, the origin of the primitives; it began
//                                  as a byte copy of supergraphics.css in @mfb/shared, which keeps
//                                  an identical copy (see CONTRIBUTING.md); appended unchanged
//
// Usage: node scripts/build-design-package.mjs [OUT_DIR]
//   OUT_DIR defaults to the repository root. scripts/check.mjs passes a temporary directory.
//
// Emits into OUT_DIR: tailwind.js (Tailwind 3 preset), theme.css (Tailwind 4 @theme),
// brand.css (plain CSS variables), supergraphics.css, index.js, README.md, and tokens.json
// (a verbatim copy, skipped when OUT_DIR is the repository root because it is the source).
// It does NOT write package.json: the version, exports and files list are edited by hand in a
// pull request, and a version bump is what releases (see .github/workflows/design.yml).
//
// The emitted header strings ("by build-design-package.mjs", "Canon: shared/supergraphics.css")
// are kept exactly as they were before the build moved into this repository, so the published
// files stay byte-identical.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(process.argv[2] || ROOT);
const TOKENS_PATH = path.join(ROOT, 'tokens.json');
const SG_SRC = path.join(ROOT, 'src', 'supergraphics.canon.css');

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(String(VERSION))) {
  console.error(`REFUSING TO BUILD: package.json version "${VERSION}" is not of the form X.Y.Z.`);
  process.exit(1);
}

const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
const sgCanon = fs.readFileSync(SG_SRC, 'utf8');

// GEOMETRY GATE. It runs before ANY file is written, so a refusal never leaves a
// half-written package (tailwind.js and theme.css are written first, so a gate placed
// later would have left them behind).
//
// The canon declares its own --sg-* geometry in a :root block, and because the canon is
// appended AFTER the token prelude, its values win in the cascade. Emitting geometry without
// checking would produce a package whose prelude and body disagree, silently. So the build
// REFUSES when the canon and tokens.json disagree: geometry has one origin (the tokens.json
// geometry group) and the canon may not drift from it. An audit once found pages hand-rolling
// a 10 degree slant instead of 13; this gate is what stops the next one.
const GEOM_VARS = {
  'angle-base':   '--sg-angle-base',
  'angle-alt':    '--sg-angle-alt',
  'aspect':       '--sg-aspect',
  'logo-icon-h':  '--sg-logo-icon-h',
  'base-h-ratio': '--sg-base-h-ratio',
};
const geomMismatch = [];
for (const [tokenName, cssVar] of Object.entries(GEOM_VARS)) {
  const tok = (tokens.geometry || {})[tokenName];
  if (!tok) { geomMismatch.push(`${tokenName}: absent from tokens.json geometry group`); continue; }
  // Anchor to a line start: the variable NAME also appears mid-line inside var() references
  // (e.g. `transform: skewX(calc(-1 * var(--sg-angle-base)))`), and an unanchored match
  // finds the first reference rather than the declaration.
  const m = sgCanon.match(new RegExp(`^\\s*${cssVar}\\s*:\\s*([^;]+);`, 'm'));
  if (!m) { geomMismatch.push(`${cssVar}: not declared in the canon`); continue; }
  const canonVal = m[1].trim();
  const tokenVal = String(tok.$value).trim();
  if (canonVal !== tokenVal) {
    geomMismatch.push(`${cssVar}: canon says "${canonVal}", tokens.json says "${tokenVal}"`);
  }
}
if (geomMismatch.length) {
  console.error('REFUSING TO BUILD: geometry canon disagrees with tokens.json.');
  console.error('  tokens.json is the origin. Correct the canon, or the token, then rebuild.');
  for (const m of geomMismatch) console.error(`  - ${m}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const written = [];
const write = (name, content) => {
  fs.writeFileSync(path.join(OUT_DIR, name), content);
  written.push(name);
};

// ---- Build nested color tree: mfb.purple.400, mfb.gray.900, mfb.black ... ----
const mfb = {};
for (const [name, tok] of Object.entries(tokens.color)) {
  const m = name.match(/^(purple|orange|gray)-(\d+)$/);
  if (m) {
    const [, fam, shade] = m;
    (mfb[fam] = mfb[fam] || {})[shade] = tok.$value;
  } else {
    mfb[name] = tok.$value; // black, white
  }
}
const fontFamily = {};
for (const [k, tok] of Object.entries(tokens.fontFamily || {})) fontFamily[k] = tok.$value;
// `sans` mirrors the body font (IBM Plex Sans) so `font-sans` yields the brand font,
// matching how My First Bitcoin pages are written (they override Tailwind's default sans).
if (fontFamily.body) fontFamily.sans = fontFamily.body;
const fontSize = {};
for (const [k, tok] of Object.entries(tokens.fontSize || {})) fontSize[k] = tok.$value;
// Font weights as numbers (400, 500, 600). Tailwind calls 400 `normal`, tokens.json calls it
// `regular`: the Tailwind outputs carry both names with the same value (as `sans` mirrors
// `body` above), so `font-regular` and `font-normal` both give the brand's regular weight.
// The weights EXTEND Tailwind's scale; they never replace it, so font-bold and the rest keep working.
const fontWeight = {};
for (const [k, tok] of Object.entries(tokens.fontWeight || {})) fontWeight[k] = tok.$value;
const twFontWeight = {};
for (const [k, v] of Object.entries(fontWeight)) twFontWeight[k] = String(v);
if (fontWeight.regular !== undefined && !('normal' in fontWeight)) twFontWeight.normal = String(fontWeight.regular);
const gradient = tokens.gradient?.brand?.$value;
const ff = (arr) => arr.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');

// ---- 1. tailwind.js - Tailwind 3 preset (also usable in TW4 via @config) ----
const preset = {
  theme: {
    extend: {
      colors: { ...mfb, mfb }, // both conventions: bg-purple-400 and bg-mfb-purple-400
      fontFamily,
      fontSize,
      fontWeight: twFontWeight,
      ...(gradient ? { backgroundImage: { 'brand-gradient': gradient } } : {}),
    },
  },
};
write(
  'tailwind.js',
  `// Generated from tokens.json by build-design-package.mjs - DO NOT EDIT BY HAND.\n/** @type {import('tailwindcss').Config} */\nexport default ${JSON.stringify(preset, null, 2)};\n`
);

// ---- 2. theme.css - Tailwind 4 @theme block ----
let theme = '/* Generated from tokens.json - DO NOT EDIT BY HAND. Tailwind 4 @theme. */\n@theme {\n';
for (const [name, tok] of Object.entries(tokens.color)) {
  theme += `  --color-${name}: ${tok.$value};\n`;         // top-level convention (bg-purple-400)
  theme += `  --color-mfb-${name}: ${tok.$value};\n`;     // mfb- prefixed convention (bg-mfb-purple-400)
}
for (const [k, v] of Object.entries(fontFamily)) theme += `  --font-${k}: ${ff(v)};\n`;
for (const [k, tok] of Object.entries(tokens.fontSize || {})) theme += `  --text-${k}: ${tok.$value};\n`;
for (const [k, v] of Object.entries(twFontWeight)) theme += `  --font-weight-${k}: ${v};\n`;
theme += '}\n';
write('theme.css', theme);

// ---- 3. brand.css - framework-agnostic CSS custom properties ----
let css = '/* Generated from tokens.json - DO NOT EDIT BY HAND. Plain CSS variables. */\n:root {\n';
for (const [name, tok] of Object.entries(tokens.color)) css += `  --mfb-${name}: ${tok.$value};\n`;
if (gradient) css += `  --mfb-gradient-brand: ${gradient};\n`;
for (const [k, v] of Object.entries(fontFamily)) css += `  --mfb-font-${k}: ${ff(v)};\n`;
for (const [k, tok] of Object.entries(tokens.fontSize || {})) css += `  --mfb-size-${k}: ${tok.$value};\n`;
for (const [k, v] of Object.entries(fontWeight)) css += `  --mfb-weight-${k}: ${v};\n`;
for (const [tokenName, cssVar] of Object.entries(GEOM_VARS)) css += `  ${cssVar}: ${tokens.geometry[tokenName].$value};\n`;
css += '}\n';
write('brand.css', css);

// ---- 4. tokens.json (verbatim copy of the source; nothing to do when building in place) ----
if (path.join(OUT_DIR, 'tokens.json') !== TOKENS_PATH) {
  fs.copyFileSync(TOKENS_PATH, path.join(OUT_DIR, 'tokens.json'));
  written.push('tokens.json');
}

// ---- 4b. supergraphics.css - brand geometry primitives (13 degree system) ----
// The canon (src/supergraphics.canon.css) is shipped verbatim, PLUS a token-derived :root
// prelude so the file is standalone: Tailwind 4 consumers import theme.css (which only
// defines --color-*), so the --mfb-* variables the supergraphics reference must be
// self-provided. Public pages cannot reach @mfb/shared, so this package is how they get the
// primitives instead of hand-rolling wrong angles.
let sgPrelude =
  '/* Generated by build-design-package.mjs - DO NOT EDIT BY HAND.\n' +
  '   Canon: shared/supergraphics.css (@mfb/shared) + token prelude from tokens.json.\n' +
  '   Geometry below is asserted equal to the canon at build time; a mismatch fails the build. */\n' +
  ':root {\n';
for (const [name, tok] of Object.entries(tokens.color)) sgPrelude += `  --mfb-${name}: ${tok.$value};\n`;
if (gradient) sgPrelude += `  --mfb-gradient: ${gradient};\n`;
for (const [k, v] of Object.entries(fontWeight)) sgPrelude += `  --mfb-weight-${k}: ${v};\n`;
for (const [tokenName, cssVar] of Object.entries(GEOM_VARS)) {
  sgPrelude += `  ${cssVar}: ${tokens.geometry[tokenName].$value};\n`;
}
sgPrelude += '}\n\n';
write('supergraphics.css', sgPrelude + sgCanon);

// ---- 5. index.js - programmatic access ----
write(
  'index.js',
  `// @myfirstbitcoin/design - programmatic access to MFB brand tokens.\n` +
    `export { default as tailwindPreset } from './tailwind.js';\n` +
    `export const colors = ${JSON.stringify(mfb, null, 2)};\n` +
    `export const fontFamily = ${JSON.stringify(fontFamily, null, 2)};\n` +
    `export const fontSize = ${JSON.stringify(fontSize, null, 2)};\n` +
    `export const fontWeight = ${JSON.stringify(fontWeight, null, 2)};\n` +
    (gradient ? `export const gradientBrand = ${JSON.stringify(gradient)};\n` : '')
);

// ---- 6. package.json is hand-maintained and no longer written here. ----

// ---- 7. README.md ----
// This template is unchanged from before the move, so the published README stays
// byte-identical. Its one dash in the supergraphics paragraph is written as a unicode
// escape (backslash, u, 2014) so that this source file itself carries no literal em-dash; rewording it is a
// published change and belongs in a release pull request.
write(
  'README.md',
  `# @myfirstbitcoin/design\n\n` +
    `The My First Bitcoin brand as code: a Tailwind preset, CSS variables, and raw design tokens. ` +
    `Generated from the canonical \`tokens.json\` (Figma → \`sync-brand.js\`). Do not edit generated files by hand.\n\n` +
    `## Install (git dependency)\n\n` +
    `\`\`\`json\n"dependencies": { "@myfirstbitcoin/design": "github:MyFirstBitcoin/mfb-design#v${VERSION}" }\n\`\`\`\n\n` +
    `## Use - Tailwind 3\n\n` +
    `\`\`\`js\n// tailwind.config.mjs\nimport mfb from '@myfirstbitcoin/design/tailwind';\nexport default { presets: [mfb], content: ['./src/**/*.{astro,html,js,ts}'] };\n\`\`\`\n\n` +
    `## Use - Tailwind 4\n\n` +
    `\`\`\`css\n/* global.css */\n@import '@myfirstbitcoin/design/theme.css';\n\`\`\`\n\n` +
    `## Use - plain CSS variables\n\n` +
    `\`\`\`css\n@import '@myfirstbitcoin/design/brand.css';  /* var(--mfb-purple-400), var(--mfb-gradient-brand) ... */\n\`\`\`\n\n` +
    `## Use - supergraphics (brand geometry primitives)\n\n` +
    `\`\`\`css\n@import '@myfirstbitcoin/design/supergraphics.css';\n\`\`\`\n\n` +
    `The signature MFB shapes as ready-made classes: \`sg-para\` / \`sg-para-frame\` (13° parallelograms), ` +
    `\`sg-spotlight\` / \`sg-spotlight-frame\` (13°+24° corner cuts), \`sg-book\` / \`sg-book-frame\` / \`sg-book-stack\`, ` +
    `\`sg-cover\`, \`sg-halftone-cutout\`, \`sg-para-pattern\`, \`highlighter\` band. ` +
    `**Never hand-roll these shapes in a page** \u2014 the brand angle is exactly 13° (\`--sg-angle-base\`) and hand-rolled copies drift. ` +
    `The file is standalone (token prelude included), so it works with theme.css-only Tailwind 4 setups.\n\n` +
    `Both utility conventions are served: top-level (preferred for new pages) and mfb- prefixed (legacy, e.g. roadmap). Utilities use the brand palette at the top level (e.g. \`bg-purple-400\`, \`text-orange-300\`, \`text-gray-900\`, \`text-h1\`), overriding Tailwind's default purple/orange/gray with MFB brand values. Other defaults (red, blue, etc.) are untouched. Plain CSS variables are namespaced \`--mfb-*\` to avoid collisions.\n\n` +
    `## Heavy brand assets\n\nLogos, badges, and the brand book PDF live in [MyFirstBitcoin/mfb-brand](https://github.com/MyFirstBitcoin/mfb-brand).\n`
);

console.log(`Built @myfirstbitcoin/design v${VERSION} -> ${OUT_DIR}`);
console.log('Files written:', written.sort().join(', '));
