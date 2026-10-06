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
// The emitted header strings ("by build-design-package.mjs") are kept as they were before the
// build moved into this repository, so a release changes only what it means to change. The
// supergraphics.css header names the canon in this repository (src/supergraphics.canon.css)
// since v1.4.0.

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

// Geometry the canon does not read yet. These tokens record what the Brand Book draws, but the
// canon still uses other values (a 10px pattern gap, 1.25 and 1.55 row steps), so they are NOT
// emitted as --sg-* variables: a prelude value the canon ignores would be a package that
// disagrees with itself. Each one is listed here with its reason, and the build refuses any
// geometry token that is neither gated against the canon (GEOM_VARS), a halftone color, nor
// listed here, so no new geometry reaches the package unseen.
const GEOM_TOKEN_ONLY = {
  'para-edge-ratio': 'the base shape; the canon sizes parallelograms by their container',
  'pattern-row-step': 'the canon steps progressive rows by 1.25 and 1.55',
  'pattern-row-gap': 'the canon separates pattern rows by 10px',
  'halftone-scale': 'a setting of the tool that makes the halftone, not a CSS value',
};

// ---- GROUP MAP AND NAMING GATE ----
// One table: each tokens.json group added after v1.3.0 -> its Tailwind 4 theme.css prefix -> its
// Tailwind 3 theme.extend key and key prefix -> its brand.css prefix. null means "not emitted
// there". Keys in tokens.json are bare; the prefix is added per output. The build refuses a
// tokens.json group that is in neither this table nor ORIGINAL_GROUPS, so a group added later
// cannot leak into a Tailwind namespace unseen.
//
// Naming rules (they keep every Tailwind default intact in Tailwind 3 and 4):
//   - every new utility key starts with mfb-, except type levels (text-h1-fluid, leading-h1,
//     tracking-h1) and color roles (text-heading-on-light), whose names no Tailwind default has;
//   - no breakpoints, screens, bare roots (--spacing, --radius, --shadow, --container), --default-*
//     or sub-properties of an existing key are emitted;
//   - existing keys (colors, fontSize, fontWeight) are never changed.
const ORIGINAL_GROUPS = ['color', 'gradient', 'geometry', 'fontFamily', 'fontWeight', 'fontSize'];
const GROUP_MAP = {
  //               Tailwind 4 namespace            Tailwind 3 key              key prefix  suffix      brand.css prefix
  lineHeight:    { tw4: '--leading-',              tw3: 'lineHeight',          twKey: '',     suffix: '',       css: '--mfb-leading-' },
  letterSpacing: { tw4: '--tracking-',             tw3: 'letterSpacing',       twKey: '',     suffix: '',       css: '--mfb-tracking-' },
  fontSizeFluid: { tw4: '--text-',               tw3: 'fontSize',            twKey: '',     suffix: '-fluid', css: '--mfb-size-' },
  colorRole:     { tw4: '--color-',                tw3: 'colors',              twKey: '',     suffix: '',       css: '--mfb-' },
  shapeTone:     { tw4: null,                      tw3: null,                  twKey: '',     suffix: '',       css: '--mfb-shape-on-' },
  logo:          { tw4: null,                      tw3: null,                  twKey: '',     suffix: '',       css: '--mfb-logo-' },
  spaceScale:    { tw4: null,                      tw3: null,                  twKey: '',     suffix: '',       css: '--mfb-space-' },
  space:         { tw4: '--spacing-',              tw3: 'spacing',             twKey: 'mfb-', suffix: '',       css: '--mfb-space-' },
  radius:        { tw4: '--radius-',               tw3: 'borderRadius',        twKey: 'mfb-', suffix: '',       css: '--mfb-radius-' },
  shadow:        { tw4: '--shadow-',               tw3: 'boxShadow',           twKey: 'mfb-', suffix: '',       css: '--mfb-shadow-' },
  easing:        { tw4: '--ease-',                 tw3: 'transitionTimingFunction', twKey: 'mfb-', suffix: '',  css: '--mfb-ease-' },
  duration:      { tw4: '--transition-duration-',     tw3: 'transitionDuration', twKey: 'mfb-', suffix: '',     css: '--mfb-duration-' },
  container:     { tw4: '--container-',            tw3: 'maxWidth',            twKey: 'mfb-', suffix: '',       css: '--mfb-container-' },
  zIndex:        { tw4: null,                      tw3: null,                  twKey: '',     suffix: '',       css: '--mfb-z-' },
  mediaRatio:    { tw4: null,                      tw3: null,                  twKey: '',     suffix: '',       css: '--mfb-ratio-' },
  ui:            { tw4: null,                      tw3: null,                  twKey: '',     suffix: '',       css: '--mfb-ui-' },
};
// Keys of a mapped group that stay out of Tailwind, with the reason.
const TW_SKIP = { radius: { pill: 'Tailwind already has rounded-full' } };

// Tailwind defaults a new key must never equal (Tailwind 4.3.3 theme and Tailwind 3.4.19 config).
const TW4_DEFAULTS = {
  '--radius-': 'xs sm md lg xl 2xl 3xl 4xl',
  '--shadow-': '2xs xs sm md lg xl 2xl inner',
  '--ease-': 'in out in-out',
  '--container-': '3xs 2xs xs sm md lg xl 2xl 3xl 4xl 5xl 6xl 7xl',
  '--leading-': 'tight snug normal relaxed loose',
  '--tracking-': 'tighter tight normal wide wider widest',
  '--text-': 'xs sm base lg xl 2xl 3xl 4xl 5xl 6xl 7xl 8xl 9xl',
  '--transition-duration-': '',
  '--spacing-': '',
  '--color-': '',
};
const TW3_DEFAULTS = {
  borderRadius: 'none sm DEFAULT md lg xl 2xl 3xl full',
  boxShadow: 'sm DEFAULT md lg xl 2xl inner none',
  transitionDuration: 'DEFAULT 0 75 100 150 200 300 500 700 1000',
  transitionTimingFunction: 'DEFAULT linear in out in-out',
  lineHeight: '3 4 5 6 7 8 9 10 none tight snug normal relaxed loose',
  letterSpacing: 'tighter tight normal wide wider widest',
  maxWidth: '0 none xs sm md lg xl 2xl 3xl 4xl 5xl 6xl 7xl full min max fit prose',
  fontSize: 'xs sm base lg xl 2xl 3xl 4xl 5xl 6xl 7xl 8xl 9xl',
  spacing: 'px',
  colors: 'inherit current transparent black white',
};
const STATIC_KEYWORDS = new Set('full none px auto screen min max fit prose DEFAULT inner linear inherit current transparent'.split(' '));
const TW_COLOR_FAMILIES = ('red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink ' +
  'rose slate gray zinc neutral stone mauve olive mist taupe').split(' ');

// Value helpers for the new groups. A role or a shape tone is an alias of a palette color, and a
// shadow's color is too: the build resolves the alias and refuses one that is not in tokens.color.
const gateProblems = [];
const aliasOf = (v) => (typeof v === 'string' ? v.match(/^\{color\.([\w-]+)\}$/)?.[1] : undefined);
const paletteRef = (where, v) => {
  const name = aliasOf(v);
  if (!name || !tokens.color[name]) {
    gateProblems.push(`${where}: "${typeof v === 'string' ? v : JSON.stringify(v)}" is not an alias of a palette color ({color.<name>})`);
    return null;
  }
  return name;
};
const pct = (opacity) => `${Math.round(Number(opacity) * 100)}%`;
const shadowValue = (where, v, target) => {
  const name = paletteRef(`${where}.color`, v?.color);
  const o = Number(v?.opacity);
  if (!(o > 0 && o <= 1)) gateProblems.push(`${where}.opacity: ${v?.opacity} is not between 0 and 1`);
  if (!name) return '';
  const color = target === 'css' ? `var(--mfb-${name})` : tokens.color[name].$value;
  return `${v.offsetX} ${v.offsetY} ${v.blur} ${v.spread} color-mix(in srgb, ${color} ${pct(o)}, transparent)`;
};
const remOf = (px) => {
  const m = String(px).match(/^(\d+(?:\.\d+)?)px$/);
  return m ? `${Number(m[1]) / 16}rem` : null;
};
// The value of a token of a mapped group, for one output: 'css' (brand.css: palette by var()),
// 'tw' (theme.css and tailwind.js: palette as a literal hex, containers in rem) or 'raw'
// (index.js: resolved values, containers in px as in tokens.json).
const valueFor = (group, key, tok, target) => {
  const where = `${group}.${key}`;
  if (group === 'colorRole' || group === 'shapeTone') {
    const name = paletteRef(where, tok.$value);
    if (!name) return '';
    return target === 'css' ? `var(--mfb-${name})` : tokens.color[name].$value;
  }
  if (group === 'shadow') return shadowValue(where, tok.$value, target === 'css' ? 'css' : 'tw');
  if (group === 'easing') {
    const v = tok.$value;
    if (!Array.isArray(v) || v.length !== 4 || v.some((n) => typeof n !== 'number')) {
      gateProblems.push(`${where}: a cubicBezier token needs four numbers`);
      return '';
    }
    return `cubic-bezier(${v.join(', ')})`;
  }
  if (group === 'container' && target === 'tw') {
    const rem = remOf(tok.$value);
    if (!rem) gateProblems.push(`${where}: "${tok.$value}" is not a px value (Tailwind 4 sorts px containers before rem ones)`);
    return rem || '';
  }
  return target === 'raw' && typeof tok.$value === 'number' ? tok.$value : String(tok.$value);
};

// R1: every group is known.
for (const group of Object.keys(tokens).filter((k) => !k.startsWith('$'))) {
  if (!ORIGINAL_GROUPS.includes(group) && !GROUP_MAP[group]) {
    gateProblems.push(`tokens.json group "${group}" has no entry in GROUP_MAP (scripts/build-design-package.mjs): say where it is emitted before adding it`);
  }
}
for (const group of Object.keys(GROUP_MAP)) {
  if (!tokens[group] || typeof tokens[group] !== 'object') gateProblems.push(`GROUP_MAP names "${group}", which tokens.json lacks`);
  for (const [k, tok] of Object.entries(tokens[group] || {})) {
    if (k.startsWith('$')) gateProblems.push(`${group}.${k}: groups are flat; no $-keys inside a group`);
    else if (!tok || typeof tok !== 'object' || !('$value' in tok)) gateProblems.push(`${group}.${k}: not a token (no $value)`);
  }
}
// Every geometry token is gated against the canon, a halftone color, or listed as token-only.
for (const [k, tok] of Object.entries(tokens.geometry || {})) {
  const halftoneColor = k.startsWith('halftone-') && tok.$type === 'color';
  if (!GEOM_VARS[k] && !halftoneColor && !GEOM_TOKEN_ONLY[k]) {
    gateProblems.push(`geometry.${k}: add it to GEOM_VARS (gated against the canon) or to GEOM_TOKEN_ONLY with the reason it is not emitted`);
  }
}
for (const k of Object.keys(GEOM_TOKEN_ONLY)) {
  if (!tokens.geometry?.[k]) gateProblems.push(`GEOM_TOKEN_ONLY names geometry.${k}, which tokens.json lacks`);
  if (new RegExp(`--sg-${k}\\s*:`).test(sgCanon)) gateProblems.push(`the canon declares --sg-${k}: move geometry.${k} from GEOM_TOKEN_ONLY to GEOM_VARS so it is gated`);
}

// Type levels: line height, letter spacing and fluid sizes exist only for fontSize levels, and a
// fluid size grows up to the Brand Book size and no further (the cap is the book's, the floor
// and slope are the website's). A level variant (LEVEL_VARIANTS) is a second value for one
// level, named <level>-<use>, with the reason; its Tailwind key is a type level's, so it needs no
// mfb- prefix.
const LEVELS = Object.keys(tokens.fontSize || {});
const LEVEL_VARIANTS = {
  lineHeight: { 'body-long': 'body text in long reading (articles); the Brand Book sets only short body copy' },
};
for (const group of ['lineHeight', 'letterSpacing', 'fontSizeFluid']) {
  for (const k of Object.keys(tokens[group] || {})) {
    const variant = LEVEL_VARIANTS[group]?.[k];
    if (variant && LEVELS.includes(k.split('-')[0])) continue;
    if (!LEVELS.includes(k)) gateProblems.push(`${group}.${k}: not a fontSize level (${LEVELS.join(', ')}) nor a level variant listed in LEVEL_VARIANTS`);
  }
}
for (const [group, variants] of Object.entries(LEVEL_VARIANTS)) {
  for (const k of Object.keys(variants)) {
    if (!tokens[group]?.[k]) gateProblems.push(`LEVEL_VARIANTS names ${group}.${k}, which tokens.json lacks`);
  }
}
for (const [k, tok] of Object.entries(tokens.fontSizeFluid || {})) {
  const m = String(tok.$value).match(/^clamp\(\s*([^,]+),\s*([^,]+),\s*([^,)]+)\)$/);
  const cap = tokens.fontSize?.[k]?.$value;
  if (!m) gateProblems.push(`fontSizeFluid.${k}: "${tok.$value}" is not clamp(min, preferred, max)`);
  else if (m[3].trim() !== cap) gateProblems.push(`fontSizeFluid.${k}: its maximum ${m[3].trim()} is not the Brand Book size fontSize.${k} (${cap})`);
}

// Emitted names: Tailwind 4 variables, Tailwind 3 keys and brand.css variables.
const tw4Lines = []; // [name, value]
const tw3Extend = {}; // key -> { name: value }
const cssLines = []; // [name, value]
const indexExports = {}; // group -> { key: value }
const emitGroup = (group) => {
  const map = GROUP_MAP[group];
  const skip = TW_SKIP[group] || {};
  for (const [k, tok] of Object.entries(tokens[group] || {})) {
    cssLines.push([`${map.css}${k}${map.suffix}`, valueFor(group, k, tok, 'css')]);
    (indexExports[group] ||= {})[k] = valueFor(group, k, tok, 'raw');
    if (skip[k]) continue;
    if (map.tw4) tw4Lines.push([`${map.tw4}${map.twKey}${k}${map.suffix}`, valueFor(group, k, tok, 'tw')]);
    if (map.tw3) ((tw3Extend[map.tw3] ||= {})[`${map.twKey}${k}${map.suffix}`] = valueFor(group, k, tok, 'tw'));
  }
};
// One call per group, in the order they appear in the outputs.
emitGroup('colorRole');
emitGroup('shapeTone');
emitGroup('fontSizeFluid');
emitGroup('lineHeight');
emitGroup('letterSpacing');
emitGroup('logo');
emitGroup('spaceScale');
emitGroup('space');
emitGroup('radius');
emitGroup('shadow');
emitGroup('easing');
emitGroup('duration');
emitGroup('container');
emitGroup('zIndex');
emitGroup('mediaRatio');
emitGroup('ui');
for (const group of Object.keys(GROUP_MAP)) {
  if (!indexExports[group] && Object.keys(tokens[group] || {}).length) gateProblems.push(`GROUP_MAP group "${group}" is never emitted (add an emitGroup call)`);
}

// (a), (b), (c): no Tailwind default, static keyword or numeric key; (e): no bare root, breakpoint,
// default or sub-property.
const defaultsFor = (table, prefix) => new Set(String(table[prefix] ?? '').split(' ').filter(Boolean));
for (const [name] of tw4Lines) {
  const ns = Object.keys(TW4_DEFAULTS).find((p) => name.startsWith(p));
  if (!ns) { gateProblems.push(`${name}: not in a Tailwind 4 namespace this build may emit`); continue; }
  const key = name.slice(ns.length);
  if (!key) gateProblems.push(`${name}: a bare Tailwind 4 root changes a default utility`);
  if (defaultsFor(TW4_DEFAULTS, ns).has(key)) gateProblems.push(`${name}: "${key}" is a Tailwind 4 default in ${ns}*`);
  if (STATIC_KEYWORDS.has(key) || /^\d/.test(key)) gateProblems.push(`${name}: "${key}" is a static keyword or starts with a digit`);
  if (key.includes('--')) gateProblems.push(`${name}: a sub-property (--) changes an existing utility`);
  if (/^--(breakpoint|default|animate)-/.test(name)) gateProblems.push(`${name}: breakpoints, defaults and animations are never emitted`);
  if (ns === '--color-' && (!/-on-(light|dark|orange)$/.test(key) || TW_COLOR_FAMILIES.some((f) => key.startsWith(`${f}-`)) || tokens.color[key])) {
    gateProblems.push(`${name}: a color role is named <element>-on-<light|dark|orange> and is not a palette or Tailwind color`);
  }
}
for (const [twKey, entries] of Object.entries(tw3Extend)) {
  const defaults = new Set(String(TW3_DEFAULTS[twKey] ?? '').split(' ').filter(Boolean));
  for (const key of Object.keys(entries)) {
    if (defaults.has(key)) gateProblems.push(`tailwind.js ${twKey}.${key}: a Tailwind 3 default`);
    if (STATIC_KEYWORDS.has(key) || /^\d/.test(key)) gateProblems.push(`tailwind.js ${twKey}.${key}: a static keyword or starts with a digit`);
    if (twKey === 'fontSize' && (tokens.fontSize || {})[key]) gateProblems.push(`tailwind.js fontSize.${key}: an existing key is frozen in 1.x`);
    if (twKey === 'colors' && (tokens.color[key] || TW_COLOR_FAMILIES.includes(key))) gateProblems.push(`tailwind.js colors.${key}: an existing color key is frozen in 1.x`);
  }
}
// Font weights. fontWeight is an original group, emitted outside GROUP_MAP (theme.css
// --font-weight-*, the Tailwind 3 preset's fontWeight, both extending Tailwind's scale). A key
// Tailwind already has (normal, medium, semibold...) may only restate Tailwind's own value, so no
// token edit can change what font-medium means in a project. Tailwind 3.4.19 and 4.3.3 agree.
const TW_FONT_WEIGHT = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const weightKeys = Object.entries(tokens.fontWeight || {}).map(([k, tok]) => [k, tok.$value]);
if (tokens.fontWeight?.regular && !tokens.fontWeight.normal) weightKeys.push(['normal', tokens.fontWeight.regular.$value]);
for (const [k, v] of weightKeys) {
  if (k in TW_FONT_WEIGHT && Number(v) !== TW_FONT_WEIGHT[k]) {
    gateProblems.push(`fontWeight.${k}: ${v} would change Tailwind's font-${k} (${TW_FONT_WEIGHT[k]}); a weight key Tailwind already has keeps Tailwind's value`);
  }
}
// (d) disjointness.
const keysOf = (group) => Object.keys(tokens[group] || {});
const overlap = (a, b) => a.filter((k) => b.includes(k));
const textKeys = [...LEVELS, ...keysOf('fontSizeFluid').map((k) => `${k}-fluid`)];
for (const [a, b, why] of [
  [keysOf('colorRole'), textKeys, 'color roles and text sizes'],
  [keysOf('colorRole'), keysOf('shadow'), 'color roles and shadows'],
  [keysOf('shadow'), Object.keys(tokens.color), 'shadows and palette colors'],
  [keysOf('space'), keysOf('container'), 'spacing and containers (Tailwind 4 max-w reads --spacing-* first)'],
  [keysOf('space'), keysOf('spaceScale'), 'semantic spacing and the spacing scale (both are --mfb-space-*)'],
]) {
  for (const k of overlap(a, b)) gateProblems.push(`"${k}" is a key of both ${why}`);
}
// brand.css names are unique, including against the original variables.
const originalCss = [
  ...Object.keys(tokens.color).map((k) => `--mfb-${k}`),
  ...Object.keys(tokens.fontSize || {}).map((k) => `--mfb-size-${k}`),
  ...Object.keys(tokens.fontWeight || {}).map((k) => `--mfb-weight-${k}`),
  ...Object.keys(tokens.fontFamily || {}).map((k) => `--mfb-font-${k}`),
  '--mfb-font-sans', '--mfb-gradient-brand', '--mfb-gradient',
  ...Object.keys(tokens.geometry || {}).filter((k) => k.startsWith('halftone-')).map((k) => `--mfb-${k}`),
];
const seenCss = new Set(originalCss);
for (const [name, value] of cssLines) {
  if (seenCss.has(name)) gateProblems.push(`brand.css ${name}: emitted twice`);
  seenCss.add(name);
  if (name === '--mfb-side') gateProblems.push('brand.css --mfb-side: a name projects define locally');
  if (/#[0-9a-f]{3,8}\b/i.test(value)) gateProblems.push(`brand.css ${name}: a new variable references the palette with var(), never a hex (${value})`);
}

if (gateProblems.length) {
  console.error('REFUSING TO BUILD: the new token groups break a naming or value rule.');
  for (const p of new Set(gateProblems)) console.error(`  - ${p}`);
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
// Halftone colors (geometry group, $type color): book-specified values that are deliberately
// NOT palette tokens, so they get their own --mfb-halftone-* names and stay out of the
// Tailwind color utilities. supergraphics.css reads them in .sg-halftone-cutout.
const halftone = Object.entries(tokens.geometry || {})
  .filter(([k, tok]) => k.startsWith('halftone-') && tok.$type === 'color')
  .map(([k, tok]) => [`--mfb-${k}`, tok.$value]);
const ff = (arr) => arr.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');

// The supergraphics prelude (written in section 4b) is assembled here, before any file is
// written, so a canon that reads a variable the prelude lacks stops the build with nothing written.
const SG_PRELUDE_GROUPS = ['colorRole', 'lineHeight', 'letterSpacing'];
let sgPrelude =
  '/* Generated by build-design-package.mjs - DO NOT EDIT BY HAND.\n' +
  '   Canon: src/supergraphics.canon.css + token prelude from tokens.json.\n' +
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
// The canon's text colors, line heights and letter spacing read the color roles and the type
// relationships (the Brand Book's), so the prelude carries those groups as brand.css writes them.
for (const group of SG_PRELUDE_GROUPS) {
  const map = GROUP_MAP[group];
  for (const [k, tok] of Object.entries(tokens[group] || {})) sgPrelude += `  ${map.css}${k}${map.suffix}: ${valueFor(group, k, tok, 'css')};\n`;
}
sgPrelude += '}\n\n';
// Every --mfb-* variable the canon reads must be in the prelude, so the file stays standalone.
const preludeVars = new Set([...sgPrelude.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
const unset = [...new Set([...sgCanon.matchAll(/var\((--mfb-[\w-]+)/g)].map((m) => m[1]))].filter((v) => !preludeVars.has(v));
if (unset.length) {
  console.error('REFUSING TO BUILD: the canon reads variables the supergraphics prelude does not set:');
  for (const v of unset) console.error(`  - ${v}`);
  process.exit(1);
}

// ---- 1. tailwind.js - Tailwind 3 preset (also usable in TW4 via @config) ----
// The new groups (GROUP_MAP) extend Tailwind's scales under their own keys; colors and fontSize
// keep every existing key and value, and gain only the color roles and the fluid sizes.
const preset = {
  theme: {
    extend: {
      colors: { ...mfb, mfb, ...(tw3Extend.colors || {}) }, // both conventions: bg-purple-400 and bg-mfb-purple-400; roles at the top level
      fontFamily,
      fontSize: { ...fontSize, ...(tw3Extend.fontSize || {}) },
      fontWeight: twFontWeight,
      ...(gradient ? { backgroundImage: { 'brand-gradient': gradient } } : {}),
      ...Object.fromEntries(Object.entries(tw3Extend).filter(([k]) => k !== 'colors' && k !== 'fontSize')),
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
for (const [name, v] of tw4Lines) theme += `  ${name}: ${v};\n`;
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
for (const [name, v] of cssLines) css += `  ${name}: ${v};\n`;
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
write('supergraphics.css', sgPrelude + sgCanon);

// ---- 5. index.js - programmatic access ----
// Named exports only. colors, fontFamily, fontSize and fontWeight are unchanged; colors stays the
// palette. Colors in colorRoles and shapeTones are resolved hex values; containers stay in px.
const INDEX_EXPORTS = [
  ['colorRoles', 'colorRole'],
  ['shapeTones', 'shapeTone'],
  ['fontSizeFluid', 'fontSizeFluid'],
  ['lineHeight', 'lineHeight'],
  ['letterSpacing', 'letterSpacing'],
  ['logo', 'logo'],
  ['spacing', 'spaceScale'],
  ['space', 'space'],
  ['radius', 'radius'],
  ['shadow', 'shadow'],
  ['easing', 'easing'],
  ['duration', 'duration'],
  ['container', 'container'],
  ['zIndex', 'zIndex'],
  ['mediaRatio', 'mediaRatio'],
  ['ui', 'ui'],
];
write(
  'index.js',
  `// @myfirstbitcoin/design - programmatic access to My First Bitcoin brand tokens.\n` +
    `export { default as tailwindPreset } from './tailwind.js';\n` +
    `export const colors = ${JSON.stringify(mfb, null, 2)};\n` +
    `export const fontFamily = ${JSON.stringify(fontFamily, null, 2)};\n` +
    `export const fontSize = ${JSON.stringify(fontSize, null, 2)};\n` +
    `export const fontWeight = ${JSON.stringify(fontWeight, null, 2)};\n` +
    (gradient ? `export const gradientBrand = ${JSON.stringify(gradient)};\n` : '') +
    INDEX_EXPORTS.map(([name, group]) => `export const ${name} = ${JSON.stringify(indexExports[group] || {}, null, 2)};\n`).join('')
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
  `## Upgrading from v1.3.0`,
  ``,
  `Make these changes in the same commit that raises your pin:`,
  ``,
  `- **Delete any local ${code('.highlighter')} band** (for example a ${code('linear-gradient(transparent 80%, ...)')} background on ${code('.highlighter')}), and any local rule that changes its ${code('display')} or ${code('text-align')}. ` +
    `The package now draws the Brand Book's line itself, and a local band would draw on top of it. On orange surfaces it no longer paints a white band or turns the word white: it draws a white line, and the word keeps the heading's color.`,
  `- **Remove any padding your project adds around ${code('.sg-para-pattern')} to make room for the slant.** Each row now insets itself by half its height times tan(${ANGLE}), so its first shape is no longer clipped; extra padding moves the rows further right.`,
  `- **Set ${code('--sg-aspect')} on parallelogram frames too.** The photo scale in ${code('.sg-para-frame')} was a fixed 1.12; it is now ${code('1 + tan(--sg-angle-base) / --sg-aspect')}, the smallest scale that covers the frame, so it depends on the frame's real shape.`,
  `- **${code('supergraphics.css')} sets more variables in ${code(':root')}**: the font families, sizes and weights, the halftone colors, the color roles (${code('--mfb-<element>-on-<surface>')}) and the line height and letter spacing per level (${code('--mfb-leading-<level>')}, ${code('--mfb-tracking-<level>')}), besides the palette and the geometry. If you override any of them, do it after importing ${code('supergraphics.css')}, or import the file into a cascade layer.`,
  `- ${code('.sg-cover__title')} reads ${code('--mfb-size-h2')}. The ${code('--mfb-font-h2')} variable it used to read was never defined by this package; set ${code('font-size')} on the title instead.`,
  `- **Tailwind 4 projects that restrict a theme namespace**, for example with ${code('--font-weight-*: initial')} or ${code('--radius-*: initial')}, must put that reset in its own ${code('@theme')} block before importing ${code('theme.css')}: placed after the import, it removes the package's values too, and no utility is generated for them.`,
  ``,
  `${FENCE}css\n@import "tailwindcss";\n@theme { --font-weight-*: initial; }\n@import "@myfirstbitcoin/design/theme.css";\n${FENCE}`,
  ``,
  `- **Headings and body text on light backgrounds are black.** The written spec said purple-300 headings and gray-900 text; the Brand Book draws both in black (Type Relationships, 918:2990), and the spec and the color descriptions in ${code('tokens.json')} now say so. No variable changed value: a project that colors its headings purple-300 or its text gray-900 changes it when it chooses to.`,
  `- **Text on orange is black, buttons included, and the supergraphics classes now set it.** ${code('.sg-cta')} sets ${code('var(--mfb-link-on-orange)')}, ${code('.sg-bg-orange')} ${code('var(--mfb-body-on-orange)')} and ${code('.sg-cover--orange')} (with its ${code('.sg-cover__title')}) ${code('var(--mfb-heading-on-orange)')}: black, 9.2:1 on orange-300, where they set white (2.3:1, below the 4.5:1 that body text and buttons need). Delete any local white ${code('color')} on them, which would bring the old contrast back; a local black one can go too.`,
  `- **Text on the light supergraphics surfaces is black.** ${code('.sg-bg-white')}, ${code('.sg-bg-gray')} and ${code('.sg-info-bar--on-light')} set ${code('var(--mfb-body-on-light)')} (black) instead of gray-900.`,
  `- **The light info bar's date is black, and the line under it is a solid color.** On ${code('.sg-info-bar--on-light')}, ${code('.sg-info-bar__date')} is ${code('var(--mfb-heading-on-light)')} (black) instead of orange-300 (2.3:1 on white). The date's ${code('small')} loses its 75% opacity: it is ${code('var(--mfb-muted-on-light)')} (gray-700, 5.2:1) on the light bar and ${code('var(--mfb-muted-on-dark)')} (gray-400, 8.3:1 on purple-400, where it was orange-300 at 75%, 4.2:1) on the dark bar; without either variant it keeps the date's color, fully opaque.`,
  `- **${code('.sg-headline')} and ${code('.sg-cover__title')} set line height 1 and no letter spacing** (${code('--mfb-leading-h1')} and ${code('--mfb-tracking-h1')}; ${code('h2')} for the cover title), the Brand Book's, instead of 1.05 and -0.03em. Lines of a headline sit a little closer, and each headline is a little wider (0.03em per letter): check headlines that only just fitted their box.`,
  `- **${code('.sg-label')} is Regular (400), not Medium, with line height 1.2 and no letter spacing** (${code('--mfb-leading-label')}, ${code('--mfb-tracking-label')}), instead of 1.5px. Its size stays 18px. ${code('.sg-body')} reads ${code('--mfb-leading-body')}, the same 1.2 as before.`,
  `- **A line height for long reading, ${code('--mfb-leading-body-long')} (${code('leading-body-long')}), ${tokens.lineHeight['body-long'].$value}.** It is declared from the website's article text, because the Brand Book only sets body copy next to a heading (${code('--mfb-leading-body')}, ${tokens.lineHeight.body.$value}). It is under review, and nothing uses it until a page adopts it.`,
  `- The supergraphics classes that still differ from the Brand Book are listed in ${code('brand-spec.md')} ("Supergraphics classes that differ from the Brand Book").`,
  `- **A test that snapshots the ${code('--mfb-*')} variables of ${code('brand.css')} whose value is a hex** must refresh its snapshot: this release adds ${halftoneList}. The other new variables carry no hex; they reference the palette with ${code('var()')}.`,
  `- **Everything else is added, not changed.** Every new Tailwind utility is ${code('mfb-')} prefixed, a type level (${code('leading-h1')}, ${code('tracking-h1')}, ${code('text-h1-fluid')}), a color role (${code('text-heading-on-light')}) or ${code('font-regular')}. The weights ${code('font-normal')}, ${code('font-medium')} and ${code('font-semibold')} restate Tailwind's own values (400, 500, 600), and the build refuses a weight that would change one. None of them replaces a Tailwind default or an existing key. See "Layout, motion and color roles" below.`,
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
  `The classes read the Brand Book's color roles and type relationships, so text on orange is black and headlines have no tracking. Some still carry values the Brand Book does not have, and a later release will change them: ${code('.sg-cta')}'s 1px letter spacing and 40px radius, ${code('.sg-label')}'s 18px size, the 6px corners of ${code('.sg-para-frame')} and ${code('.sg-para-accent')}, the pattern's spacing and the logo's height. ${code('brand-spec.md')} lists every such class and what to set.`,
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
    `It draws the Brand Book's highlighter (Figma node 918:2874): a thin line at the baseline, drawn beneath the glyphs (not a band), under ${tokens.geometry['highlighter-coverage'].$value} of the word, centered. ` +
    `The line is orange-300, and white inside the orange surfaces ${['sg-bg-orange', 'sg-spotlight--orange', 'sg-cover--orange', 'sg-spotlight-frame--orange', 'sg-book-frame--orange'].map(code).join(', ')} and ${code('sg-halftone-cutout--orange-bg')}. The word keeps the heading's color. ` +
    `On another orange surface, or on a mid grey such as gray-500, set ${code('--sg-highlighter-color: var(--mfb-white)')} on the section. ` +
    `On a light grey such as gray-200 (${code('sg-bg-gray')}) keep the orange line: a white one cannot be seen there. One word per heading, never more. ` +
    `The span is an ${code('inline-block')}, and the line's length and thickness are computed from the span's own width: do not override its ${code('display')} or ${code('text-align')}. ` +
    `Its measurements are the ${code('--sg-highlighter-*')} variables (coverage, aspect, offset, shape), from the geometry tokens of the same names.`,
  ``,
  `## Layout, motion and color roles`,
  ``,
  `Where the Brand Book defines a value, the token takes it. Where the book is silent (spacing, radius, shadow, motion, widths), the value is declared from the live website, myfirstbitcoin.org, which was built following the Brand Book; ` +
    `each such token's ${code('$extensions.mfb.source')} names the commit, file and line. A website value that contradicts the Brand Book is never imported. ${code('brand-spec.md')} lists every value with its source.`,
  ``,
  `| What | brand.css | Tailwind 3 and 4 |`,
  `|------|-----------|------------------|`,
  `| Color roles | ${code('--mfb-<element>-on-<surface>')}: ${keysOf('colorRole').map((k) => code(k)).join(', ')} | ${code('text-heading-on-light')}, ${code('decoration-link-underline-on-light')}, ${code('border-border-on-light')} ... |`,
  `| Line height per level | ${code('--mfb-leading-<level>')}, and ${code('--mfb-leading-body-long')} for long reading (declared from the website, under review) | ${code('leading-<level>')}, for example ${code('leading-h1')}; ${code('leading-body-long')} |`,
  `| Letter spacing per level | ${code('--mfb-tracking-<level>')} | ${code('tracking-<level>')} |`,
  `| Fluid sizes for web pages | ${code('--mfb-size-<level>-fluid')} (${keysOf('fontSizeFluid').join(', ')}) | ${code('text-<level>-fluid')} |`,
  `| Spacing scale | ${keysOf('spaceScale').map((k) => code(`--mfb-space-${k}`)).join(', ')} | Tailwind's own ${code('p-1')} to ${code('p-32')}: the same values, so the package adds none |`,
  `| Semantic spacing | ${keysOf('space').map((k) => code(`--mfb-space-${k}`)).join(', ')} | ${code('py-mfb-section')}, ${code('px-mfb-gutter')}, ${code('mt-mfb-heading-to-body')} ... |`,
  `| Radius (interface elements only, never brand shapes) | ${keysOf('radius').map((k) => code(`--mfb-radius-${k}`)).join(', ')} | ${keysOf('radius').filter((k) => !(TW_SKIP.radius || {})[k]).map((k) => code(`rounded-mfb-${k}`)).join(', ')}; ${code('rounded-full')} for the pill |`,
  `| Shadow | ${keysOf('shadow').map((k) => code(`--mfb-shadow-${k}`)).join(', ')} | ${keysOf('shadow').map((k) => code(`shadow-mfb-${k}`)).join(', ')} |`,
  `| Easing | ${keysOf('easing').map((k) => code(`--mfb-ease-${k}`)).join(', ')} | ${keysOf('easing').map((k) => code(`ease-mfb-${k}`)).join(', ')} |`,
  `| Duration | ${keysOf('duration').map((k) => code(`--mfb-duration-${k}`)).join(', ')} | ${keysOf('duration').map((k) => code(`duration-mfb-${k}`)).join(', ')} |`,
  `| Container widths | ${keysOf('container').map((k) => code(`--mfb-container-${k}`)).join(', ')} (px) | ${keysOf('container').map((k) => code(`max-w-mfb-${k}`)).join(', ')} (rem) |`,
  `| Logo size and clear space | ${keysOf('logo').map((k) => code(`--mfb-logo-${k}`)).join(', ')} | none |`,
  `| Shape tones (a shape one step lighter than its base) | ${keysOf('shapeTone').map((k) => code(`--mfb-shape-on-${k}`)).join(', ')} | none |`,
  `| Layers | ${keysOf('zIndex').map((k) => code(`--mfb-z-${k}`)).join(', ')} | none |`,
  `| Media ratios | ${keysOf('mediaRatio').map((k) => code(`--mfb-ratio-${k}`)).join(', ')} | none (Tailwind has ${code('aspect-video')} and ${code('aspect-square')}) |`,
  `| Interface | ${keysOf('ui').map((k) => code(`--mfb-ui-${k}`)).join(', ')} | none |`,
  ``,
  `- **New utilities never replace Tailwind's.** Keys are ${code('mfb-')} prefixed (${code('rounded-mfb-md')}, not ${code('rounded-md')}; ${code('ease-mfb-out')}, not ${code('ease-out')}, which is a different curve), type levels or color roles. The build refuses a key that equals a Tailwind 3 or 4 default, and a font weight that would change Tailwind's value for its name.`,
  `- **In 1.x, ${code('text-h1')} sets only the size.** Add ${code('leading-h1')} yourself (and ${code('tracking-h1')} where something else sets tracking). Folding line height into ${code('text-h1')} would change every existing page, so it waits for a major release.`,
  `- **New ${code('brand.css')} variables reference the palette with ${code('var()')}** and add no hex: roles are ${code('var(--mfb-black)')} and the like, shadows ${code('color-mix(in srgb, var(--mfb-purple-400) 25%, transparent)')}. ${code('theme.css')} and ${code('tailwind.js')} carry the same colors as hex, so Tailwind's opacity modifiers work.`,
  `- **Tailwind 4 emits a theme variable only when something uses it.** To read ${code('var(--mfb-radius-md)')} or another new variable in your own CSS, import ${code('brand.css')} as well, or use the utility.`,
  `- **Shadows in Tailwind 4: prefer the ${code('shadow-mfb-*')} utilities.** Tailwind compiles them to a hex color with alpha. A ${code('var(--mfb-shadow-*)')} from ${code('brand.css')} goes through Tailwind 4's CSS compiler, which gives it a fallback without ${code('color-mix()')} for browsers that lack it (Chrome before 111, Safari before 16.2), and that fallback draws the shadow fully opaque.`,
  `- **index.js** exports ${INDEX_EXPORTS.map(([name]) => code(name)).join(', ')} next to the existing ${code('colors')}, ${code('fontFamily')}, ${code('fontSize')} and ${code('fontWeight')}.`,
  ``,
  `## Brand check`,
  ``,
  `${code('brand-check.mjs')} ships in this package: a guard that a project runs after its build, with Node.js and nothing else. It reads every value from this package's ${code('tokens.json')}, so it follows the version you pin.`,
  ``,
  `${FENCE}sh\nnode node_modules/@myfirstbitcoin/design/brand-check.mjs [options]\n${FENCE}`,
  ``,
  `| Option | What it does |`,
  `|--------|--------------|`,
  `| ${code('--src DIR')} | Source to read, repeatable or comma-separated (default ${code('src')}). Comments are ignored. |`,
  `| ${code('--dist DIR')} | Build output whose CSS (style sheets, ${code('<style>')} blocks and the ${code('--sg-angle-*')} in style attributes of built HTML) is read, repeatable (default ${code('dist')}). |`,
  `| ${code('--source-only')} | Skip the build output. |`,
  `| ${code('--allow FILE')} | The allowlist (default ${code('brand-check.allow.json')} when it exists), below. |`,
  `| ${code('--warn RULE[,RULE]')} | Report these rules without failing. |`,
  `| ${code('--error RULE[,RULE]')} | Fail on rules that only warn by default (${code('raw-spacing')}, ${code('text-color')}, ${code('typed-caps')}). |`,
  `| ${code('--root DIR')} | The project root the paths above are relative to (default: the current directory). |`,
  `| ${code('--help')} | List the rule ids, with what each reports. |`,
  ``,
  `It exits 0 when nothing fails (warnings are printed), 1 when something fails and 2 when it cannot run (an unknown option or rule, a missing ${code('--src')}, an allowlist that is not valid). ` +
    `Run it in your build, for example ${code('"build": "astro build && node node_modules/@myfirstbitcoin/design/brand-check.mjs"')}. ` +
    `To find its path from a script, resolve ${code('@myfirstbitcoin/design/brand-check.mjs')} (it is in the package's ${code('exports')}). It fails when the source has:`,
  ``,
  `- a color literal (hex from ${code('#RGB')} to ${code('#RRGGBBAA')}, also inside an arbitrary utility such as ${code('shadow-[0_0_0_3px_#f7931a80]')}, ${code('rgb()')}, ${code('hsl()')} and the other color functions), or a named color in a color property, a custom property, a style object (${code('style={{ ... }}')}, or an object named like a style or typed ${code('CSSProperties')}), a canvas ${code('fillStyle')}, an SVG color attribute or an arbitrary utility (${code('bg-[teal]')})`,
  `- a font family other than ${code('var(--mfb-font-heading)')}, ${code('var(--mfb-font-body)')} or ${code('var(--mfb-font-sans)')} (in Tailwind 4, ${code('var(--font-sans)')} too), a family name, or the deprecated mono family. Inside ${code('@font-face')}, which describes a face rather than using one, family names and weights are allowed`,
  `- a skew, a rotation or an angle literal that is not a quarter turn (in CSS, a style object, an animation prop such as ${code('rotate: -15')}, a Tailwind class such as ${code('rotate-3')} or ${code('rotate-x-12')}, or an SVG ${code('transform')}, ${code('patternTransform')} or ${code('gradientTransform')} attribute), a transform matrix that rotates or skews, or slant geometry computed from ${code('--sg-angle-*')}: the ${ANGLE} slant comes only from the supergraphics classes`,
  `- a hand-rolled ${code('clip-path')} shape, or a hand-rolled highlighter: a ${code('linear-gradient(transparent 80%, ...)')} band, an orange pseudo-element drawn as a marker (sized in ${code('em')} or ${code('%')}, put behind the text with a negative ${code('z-index')}, or named like a highlight or a mark), an orange inset ${code('box-shadow')} under the text, or orange ${code('after:')} or ${code('before:')} utilities`,
  `- a redefinition of a variable the package defines (${code('--mfb-*')}, or the ${code('--sg-*')} geometry such as ${code('--sg-angle-base')}); pages set only ${code('--sg-aspect')} and ${code('--sg-highlighter-color')}, which must be a palette variable`,
  `- ${code('text-transform: uppercase')}, the ${code('uppercase')} class, small caps or small-cap font features`,
  `- a gradient (the deprecated brand gradient and ${code('.sg-photo-zone')} included), a smooth color filter or a blend mode (Rule 4: halftone, never duotone)`,
  `- a Tailwind color utility outside the palette, such as ${code('bg-teal-500')} or Tailwind's own ${code('text-purple-500')}`,
  `- a weight above 600, or a translucent brand shape: opacity on a supergraphics shape or the highlighter (a class, ${code('opacity-[.85]')} or an inline style), or an orange or purple fill that is not solid (${code('opacity')} or ${code('fill-opacity')} beside it, an alpha modifier such as ${code('bg-orange-200/10')}, or ${code('color-mix()')} with ${code('transparent')}). Opacity 0 (hidden) and states such as ${code('hover:opacity-90')} are left alone`,
  `- a raw value that has a token: a radius, duration, easing, container width, font size, font weight, shadow or semantic spacing literal equal to a token value (${code('border-radius: 12px')}, ${code('180ms')}, ${code('clamp(64px, 9vw, 128px)')}), with the token to use instead`,
  ``,
  `and when the built CSS lacks ${code('--sg-angle-base')} with the token value (import ${code('brand.css')} or ${code('supergraphics.css')}), or any declaration of ${code('--sg-angle-base')} or ${code('--sg-angle-alt')} has another value (a rule, a nested rule, an ${code('@property')} ${code('initial-value')}, or a style attribute in built HTML); defines a ${code('--color-*')} that is not a palette color or a color role; sets uppercase or small caps; or gives a ${code('font-family')} the mono or serif family. ` +
    `A utility class definition is not a use: Tailwind 3 emits ${code('.uppercase')} or ${code('.font-mono')} when its content scanner sees the word anywhere, a comment included, and the source check reports the class where a page uses it. ` +
    `Nor is a variable definition or the base style of ${code('code')}, ${code('kbd')}, ${code('samp')} and ${code('pre')}: Tailwind 4's base styles always set ${code('--default-mono-font-family: var(--font-mono)')}, and ${code('theme.css')} ships ${code('--font-mono')} for the deprecated mono family.`,
  ``,
  `Three rules only warn, because the right answer depends on what the check cannot see: ${code('raw-spacing')} (a px or rem spacing literal on the scale, such as ${code('padding: 24px')}: Tailwind's own steps are the same values), ${code('text-color')} (orange text, which is right only on purple-300 and purple-400, and a purple heading) and ${code('typed-caps')} (two or more words typed in capitals). ${code('--error RULE[,RULE]')} makes them fail.`,
  ``,
  `**What it does not check.** It reads how values are written, not how the page looks: it cannot measure contrast, tell which background a text sits on, or read text that a script or a content system supplies. It does not check line height, the one-word highlighter rule, which shape fits which content, or photos themselves. Status colors for forms (error, success) are not in the Brand Book or the palette, so there is no token for them yet: a project that needs them lists them in its allowlist, with the reason.`,
  ``,
  `${code('--allow FILE')} (default ${code('brand-check.allow.json')} when it exists) lists the exceptions, each with its reason, for example a third-party mark:`,
  ``,
  `${FENCE}json\n[{ "file": "src/assets/partner-logo.svg", "reason": "the partner's own logo colors" },\n { "file": "src/components/Share.astro", "rule": "color-literal", "match": "1877f2", "reason": "the network's own badge color" }]\n${FENCE}`,
  ``,
  `An entry without ${code('rule')} covers every rule in that file, and one without ${code('match')} every finding of the rule. ${code('--warn RULE[,RULE]')} reports a rule without failing, for a project that adopts the check step by step (${code('--warn raw-value')}). ${code('--help')} lists the rule ids.`,
  ``,
  `## Variables`,
  ``,
  `Plain CSS variables are namespaced ${code('--mfb-*')} (brand values) and ${code('--sg-*')} (geometry) to avoid collisions. ${code('brand.css')} has all of them; ${code('supergraphics.css')} repeats what its classes need.`,
  ``,
  `- **Colors:** ${code('--mfb-<name>')}, for example ${code('--mfb-purple-300')}, ${code('--mfb-orange-300')}, ${code('--mfb-gray-900')}`,
  `- **Font families:** ${code('--mfb-font-heading')}, ${code('--mfb-font-body')}, ${code('--mfb-font-sans')} (IBM Plex Sans, then Arial, the Brand Book's system fallback)`,
  `- **Font sizes:** ${code('--mfb-size-<level>')}, for example ${code('--mfb-size-h1')}, ${code('--mfb-size-body')}`,
  `- **Font weights:** ${weightList}. Tailwind 4 (${code('theme.css')}) and Tailwind 3 (the preset) get the same names as ${code('font-regular')}, ${code('font-medium')} and ${code('font-semibold')}, ` +
    `plus ${code('font-normal')} with the regular value; they extend Tailwind's scale rather than replace it`,
  `- **Halftone colors:** ${halftoneList} (highlight for cutout portraits, highlight for full portraits, shadow). They are book-specified values, not palette colors, so they have no Tailwind utilities`,
  `- **Geometry:** ${Object.values(GEOM_VARS).map(code).join(', ')}`,
  ``,
  `Both utility conventions are served: top-level (preferred for new pages) and mfb- prefixed (legacy). Utilities use the brand palette at the top level (e.g. ${code('bg-purple-400')}, ${code('bg-orange-300')}, ${code('text-gray-700')}, ${code('text-h1')}), overriding Tailwind's default purple/orange/gray with the brand values. Other defaults (red, blue, etc.) are untouched.`,
  ``,
  `## Deprecated (still shipped for compatibility)`,
  ``,
  `These are not in the Brand Book. They stay until a major release so that pages using them keep working; do not use them in new work.`,
  ``,
  `- **The brand gradient:** ${code('--mfb-gradient-brand')} (brand.css), ${code('--mfb-gradient')} (supergraphics.css), ${code('bg-brand-gradient')} (Tailwind 3 preset) and ${code('.sg-bg-gradient')}. ` +
    `Use a solid palette fill instead, for example purple-300 or purple-400 (${code('.sg-bg-purple')}).`,
  `- **${code('.sg-photo-zone')}:** a gradient placeholder. Put the photo itself (an ${code('img')}) in the frame, or a solid palette fill while it is missing.`,
  `- **The mono font:** ${code('--mfb-font-mono')}, ${code('--font-mono')} (Tailwind 4) and ${code('font-mono')} (Tailwind 3). IBM Plex Mono is not in the Brand Book. ` +
    `Use the brand sans (${code('--mfb-font-body')}, ${code('font-sans')}), whose system fallback is Arial (Brand Book 918:2375). ` +
    `Tailwind 4's base styles set ${code('code')}, ${code('kbd')}, ${code('samp')} and ${code('pre')} in ${code('--default-mono-font-family')}, which reads ${code('--font-mono')}; to keep them in the brand sans, add ${code('@theme { --default-mono-font-family: var(--font-sans); }')} after importing ${code('theme.css')}.`,
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
