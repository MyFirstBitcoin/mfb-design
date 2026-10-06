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
// are kept exactly as they were before the build moved into this repository, so a release
// changes only what it means to change.

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
  'highlighter-coverage': '--sg-highlighter-coverage',
  'highlighter-aspect':   '--sg-highlighter-aspect',
  'highlighter-offset':   '--sg-highlighter-offset',
  'highlighter-shape':    '--sg-highlighter-shape',
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
// Halftone colours (geometry group, $type color): book-specified values that are deliberately
// NOT palette tokens, so they get their own --mfb-halftone-* names and stay out of the
// Tailwind colour utilities. supergraphics.css reads them in .sg-halftone-cutout.
const halftone = Object.entries(tokens.geometry || {})
  .filter(([k, tok]) => k.startsWith('halftone-') && tok.$type === 'color')
  .map(([k, tok]) => [`--mfb-${k}`, tok.$value]);
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
for (const [cssVar, v] of halftone) css += `  ${cssVar}: ${v};\n`;
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
// The canon's type classes (.sg-headline, .sg-cta ...) read the font, size and weight
// variables, so the prelude carries them. Deprecated families (mono) are left out: nothing in
// the canon uses them, and brand.css still serves them for compatibility.
const isDeprecated = (tok) => /^DEPRECATED/i.test(String(tok?.$status || ''));
for (const [k, v] of Object.entries(fontFamily)) {
  const tok = tokens.fontFamily[k] || tokens.fontFamily.body; // `sans` mirrors body
  if (!isDeprecated(tok)) sgPrelude += `  --mfb-font-${k}: ${ff(v)};\n`;
}
for (const [k, tok] of Object.entries(tokens.fontSize || {})) sgPrelude += `  --mfb-size-${k}: ${tok.$value};\n`;
for (const [k, v] of Object.entries(fontWeight)) sgPrelude += `  --mfb-weight-${k}: ${v};\n`;
for (const [cssVar, v] of halftone) sgPrelude += `  ${cssVar}: ${v};\n`;
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
// The README is published, so its prose follows the public conventions in AGENTS.md (no
// em-dashes, "My First Bitcoin" in full). Brand values in it (angles, weights) are read from
// tokens.json, like every other output, so the README cannot disagree with the tokens.
const deg = (name) => String(tokens.geometry[name].$value).replace('deg', '°');
const ANGLE = deg('angle-base');
const ANGLE_ALT = deg('angle-alt');
const FENCE = '```';
const code = (s) => '`' + s + '`';
const weightList = Object.entries(fontWeight)
  .map(([k, v]) => `${code(`--mfb-weight-${k}`)} (${v})`)
  .join(', ');
const halftoneList = halftone.map(([cssVar]) => code(cssVar)).join(', ');
const readme = [
  `# @myfirstbitcoin/design`,
  ``,
  `The My First Bitcoin brand as code: a Tailwind preset, CSS variables, the supergraphics primitives, the raw design tokens and the written brand specification. ` +
    `Every file is generated by ${code('scripts/build-design-package.mjs')} in [MyFirstBitcoin/mfb-design](https://github.com/MyFirstBitcoin/mfb-design), ` +
    `from that repository's ${code('tokens.json')}, which mirrors the Brand Book in Figma and changes only by pull request. Do not edit generated files by hand.`,
  ``,
  `## Install (git dependency)`,
  ``,
  `${FENCE}json\n"dependencies": { "@myfirstbitcoin/design": "github:MyFirstBitcoin/mfb-design#v${VERSION}" }\n${FENCE}`,
  ``,
  `Pin a tag. A new release reaches your project only when you raise the pin (and refresh the lockfile).`,
  ``,
  `## Use - Tailwind 3`,
  ``,
  `${FENCE}js\n// tailwind.config.mjs\nimport mfb from '@myfirstbitcoin/design/tailwind';\nexport default { presets: [mfb], content: ['./src/**/*.{astro,html,js,ts}'] };\n${FENCE}`,
  ``,
  `## Use - Tailwind 4`,
  ``,
  `${FENCE}css\n/* global.css */\n@import '@myfirstbitcoin/design/theme.css';\n${FENCE}`,
  ``,
  `## Use - plain CSS variables`,
  ``,
  `${FENCE}css\n@import '@myfirstbitcoin/design/brand.css';  /* var(--mfb-purple-400), var(--mfb-weight-medium) ... */\n${FENCE}`,
  ``,
  `## Use - supergraphics (brand geometry primitives)`,
  ``,
  `${FENCE}css\n@import '@myfirstbitcoin/design/supergraphics.css';\n${FENCE}`,
  ``,
  `The signature My First Bitcoin shapes as ready-made classes: ${code('sg-para')} / ${code('sg-para-frame')} (${ANGLE} parallelograms), ${code('sg-para-pattern')}, ` +
    `${code('sg-spotlight')} / ${code('sg-spotlight-frame')} (${ANGLE}+${ANGLE_ALT} corner cuts), ${code('sg-book')} / ${code('sg-book-frame')} / ${code('sg-book-stack')}, ` +
    `${code('sg-cover')}, ${code('sg-halftone-cutout')}, and the ${code('highlighter')}. ` +
    `**Never hand-roll these shapes in a page**: the brand angle is exactly ${ANGLE} (${code('--sg-angle-base')}) and hand-rolled copies drift. ` +
    `The file is standalone (token prelude included), so it works with theme.css-only Tailwind 4 setups.`,
  ``,
  `### Set --sg-aspect on every frame`,
  ``,
  `${code('sg-spotlight-frame')}, ${code('sg-book-frame')}, ${code('sg-halftone-cutout')} and ${code('sg-para-frame')} compute their cuts (and the parallelogram frame its photo scale) ` +
    `from ${code('--sg-aspect')}, the frame's width divided by its height. The default, ${tokens.geometry.aspect.$value}, is right only for a frame of that shape. ` +
    `Set it to the frame's real ratio, for example ${code('style="--sg-aspect: 0.75"')} on a 3:4 frame; otherwise the cuts are not at ${ANGLE} and ${ANGLE_ALT}, ` +
    `and a parallelogram frame's photo may not cover the frame.`,
  ``,
  `### The highlighter`,
  ``,
  `Wrap the one word you emphasize in a heading: ${code('<h2>Open Source <span class="highlighter">Education</span></h2>')}. ` +
    `It draws the Brand Book's highlighter (Figma node 918:2874): a thin line at the baseline, behind the letters, under ${tokens.geometry['highlighter-coverage'].$value} of the word, centred. ` +
    `It is orange-300, and white inside ${code('sg-bg-orange')}, ${code('sg-spotlight--orange')}, ${code('sg-cover--orange')} and ${code('sg-bg-gray')}; ` +
    `on another orange or grey surface, set ${code('--sg-highlighter-color: var(--mfb-white)')} on the section. One word per heading, never more. ` +
    `The span becomes ${code('inline-block')}. If your project draws its own ${code('.highlighter')} band, delete it when you move to this version, or the two draw on top of each other. ` +
    `Its measurements are the ${code('--sg-highlighter-*')} variables (coverage, aspect, offset, shape), from the geometry tokens of the same names.`,
  ``,
  `## Variables`,
  ``,
  `Plain CSS variables are namespaced ${code('--mfb-*')} (brand values) and ${code('--sg-*')} (geometry) to avoid collisions. ${code('brand.css')} has all of them; ${code('supergraphics.css')} repeats what its classes need.`,
  ``,
  `- **Colours:** ${code('--mfb-<name>')}, for example ${code('--mfb-purple-300')}, ${code('--mfb-orange-300')}, ${code('--mfb-gray-900')}`,
  `- **Font families:** ${code('--mfb-font-heading')}, ${code('--mfb-font-body')}, ${code('--mfb-font-sans')} (IBM Plex Sans, then Arial, the Brand Book's system fallback)`,
  `- **Font sizes:** ${code('--mfb-size-<level>')}, for example ${code('--mfb-size-h1')}, ${code('--mfb-size-body')}`,
  `- **Font weights:** ${weightList}. Tailwind 4 (${code('theme.css')}) and Tailwind 3 (the preset) get the same names as ${code('font-regular')}, ${code('font-medium')} and ${code('font-semibold')}, ` +
    `plus ${code('font-normal')} with the regular value; they extend Tailwind's scale rather than replace it`,
  `- **Halftone colours:** ${halftoneList} (highlight for cutout portraits, highlight for full portraits, shadow). They are book-specified values, not palette colours, so they have no Tailwind utilities`,
  `- **Geometry:** ${Object.values(GEOM_VARS).map(code).join(', ')}`,
  ``,
  `Both utility conventions are served: top-level (preferred for new pages) and mfb- prefixed (legacy, e.g. roadmap). Utilities use the brand palette at the top level (e.g. ${code('bg-purple-400')}, ${code('text-orange-300')}, ${code('text-gray-900')}, ${code('text-h1')}), overriding Tailwind's default purple/orange/gray with the brand values. Other defaults (red, blue, etc.) are untouched.`,
  ``,
  `## Deprecated (still shipped for compatibility)`,
  ``,
  `These are not in the Brand Book. They stay until a major release so that pages using them keep working; do not use them in new work.`,
  ``,
  `- **The brand gradient:** ${code('--mfb-gradient-brand')} (brand.css), ${code('--mfb-gradient')} (supergraphics.css), ${code('bg-brand-gradient')} (Tailwind 3 preset) and ${code('.sg-bg-gradient')}. ` +
    `Use a solid palette fill instead, for example purple-300 or purple-400 (${code('.sg-bg-purple')}).`,
  `- **${code('.sg-photo-zone')}:** a gradient placeholder. Put the photo itself (an ${code('img')}) in the frame, or a solid palette fill while it is missing.`,
  `- **The mono font:** ${code('--mfb-font-mono')}, ${code('--font-mono')} (Tailwind 4) and ${code('font-mono')} (Tailwind 3). IBM Plex Mono is not in the Brand Book. ` +
    `Use the brand sans (${code('--mfb-font-body')}, ${code('font-sans')}), whose system fallback is Arial (Brand Book 918:2375).`,
  ``,
  `## Brand rules`,
  ``,
  `${code('brand-spec.md')} ships in this package: the written brand specification, generated from the same tokens. Read it at ${code('node_modules/@myfirstbitcoin/design/brand-spec.md')}. ` +
    `The Brand Book in Figma wins any conflict with it.`,
  ``,
  `## Heavy brand assets`,
  ``,
  `Logos, badges, and the brand book PDF live in [MyFirstBitcoin/mfb-brand](https://github.com/MyFirstBitcoin/mfb-brand).`,
  ``,
].join('\n');
write('README.md', readme);

console.log(`Built @myfirstbitcoin/design v${VERSION} -> ${OUT_DIR}`);
console.log('Files written:', written.sort().join(', '));
