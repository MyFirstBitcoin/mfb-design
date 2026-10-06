#!/usr/bin/env node
// brand-check.mjs: the shared brand guard of @myfirstbitcoin/design.
//
// A project runs it after its build, with Node.js 18 or later and nothing else:
//
//   node node_modules/@myfirstbitcoin/design/brand-check.mjs [options]
//
//   --src DIR        source to read (repeatable, or comma-separated; default: src)
//   --dist DIR       build output whose CSS is read (repeatable; default: dist)
//   --source-only    skip the build output
//   --allow FILE     allowlist (default: brand-check.allow.json, when it exists)
//   --warn RULES     report these rules (comma-separated ids) without failing
//   --error RULES    fail on rules that only warn by default (raw-spacing, text-color, typed-caps)
//   --root DIR       project root that the paths above are relative to (default: the current directory)
//   --help           print the rules and exit
//
// Every brand value comes from one origin, this package. The check reads every value it compares
// with (the palette, the color roles, the angle, the spacing scale and the other tokens) from the
// tokens.json next to this file, so it follows the version a project pins. It fails (exit 1) when
// the source, comments ignored, carries a brand value with another origin, or when the built CSS
// lacks the package's geometry. Exit 2 means it could not run (a bad option or allowlist).
//
// It checks how values are written, not how a page looks: it cannot measure contrast, tell which
// background a text sits on, or read text that a script or a CMS supplies. A few rules that need
// that context (orange or purple text, typed capitals, raw spacing) only warn unless --error asks.
//
// The allowlist is a JSON array of exceptions, each with its reason:
//   [{ "file": "src/assets/partner.svg", "reason": "the partner's own logo colors" },
//    { "file": "src/components/Share.astro", "rule": "color-literal", "match": "1877f2", "reason": "..." }]
// "file" is a path relative to the root (a path ending in "/" covers a directory); "rule" and
// "match" (text the finding contains) narrow the entry. Unused entries are reported, not fatal.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(HERE, 'tokens.json'), 'utf8'));

// Rules that warn without failing unless --error names them: they cannot see the background a
// text sits on, or they flag a value that is right more often than not.
const DEFAULT_WARN = new Set(['raw-spacing', 'text-color', 'typed-caps']);
const RULES = {
  'color-literal': 'a hex color or a color function (rgb, rgba, hsl, hwb, lab, lch, oklab, oklch, color)',
  'named-color': 'a named CSS color (white, teal...) in a color property, a style, an SVG color attribute or an arbitrary utility (bg-[teal])',
  'off-palette-utility': 'a Tailwind color utility outside the palette and the color roles (bg-teal-500, text-purple-500)',
  gradient: 'a gradient (the Brand Book has none; an alpha-only mask is allowed)',
  'deprecated-gradient': 'the deprecated brand gradient (--mfb-gradient-brand, --mfb-gradient, .sg-bg-gradient, bg-brand-gradient) or .sg-photo-zone',
  'color-filter': 'a smooth color filter (grayscale, sepia, hue-rotate, saturate) or a blend mode: photos are halftone, never duotone',
  'font-family': 'a font family other than var(--mfb-font-heading|body|sans) (or var(--font-sans|heading|body) from theme.css), a family name, or the mono or serif family',
  uppercase: 'text-transform: uppercase, the uppercase class, small caps or small-cap font features',
  weight: 'a font weight above 600',
  angle: 'a skew, a rotation or an angle literal that is not a quarter turn, a rotating transform matrix, or slant geometry computed from --sg-angle-*: the slant comes from the supergraphics classes',
  'clip-path': 'a hand-rolled clip-path shape (shapes come from the supergraphics classes)',
  'translucent-shape': 'opacity or a translucent fill on a brand shape (sg-* or the highlighter), or a highlighter color that is not a palette variable',
  'hand-rolled-highlighter': 'a local highlighter band or bar (a gradient band, or an orange pseudo-element sized in em): the package\'s .highlighter draws the Brand Book line',
  'token-override': 'a redefinition of a variable the package defines (--mfb-*, the --sg-* geometry); pages set only --sg-aspect and --sg-highlighter-color',
  'raw-value': 'a radius, duration, easing, container, font size, font weight, shadow or semantic spacing literal equal to a token value',
  'raw-spacing': 'a px or rem spacing literal on the spacing scale (warns by default)',
  'text-color': 'orange text, or a purple heading: the background decides (Color Contrast, 918:2588); use a color role (warns by default)',
  'typed-caps': 'two or more words typed in capitals in markup text (warns by default)',
  'built-angle': 'the built CSS lacks --sg-angle-base with the token value, or sets --sg-angle-base or --sg-angle-alt to another value',
  'built-color': 'the built CSS defines a --color-* that is not a palette color or a color role, or not its value',
  'built-uppercase': 'the built CSS sets uppercase or small caps outside a utility class definition',
  'built-font': 'the built CSS uses the mono or serif family outside a utility class definition',
  'built-missing': 'no built CSS was found (build first, or pass --source-only)',
};

// ---- options ----
const args = process.argv.slice(2);
const opt = { src: [], dist: [], allow: null, warn: new Set(), error: new Set(), root: process.cwd(), sourceOnly: false };
const usage = (msg) => {
  if (msg) console.error(`brand-check: ${msg}`);
  console.error('usage: brand-check.mjs [--src DIR] [--dist DIR] [--source-only] [--allow FILE] [--warn RULES] [--error RULES] [--root DIR] [--help]');
  process.exit(2);
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => (i + 1 < args.length ? args[++i] : usage(`${a} needs a value`));
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  if (a === '--help' || a === '-h') {
    console.log('brand-check: rules (ids for --warn and the allowlist)');
    for (const [id, why] of Object.entries(RULES)) console.log(`  ${id.padEnd(24)} ${why}${DEFAULT_WARN.has(id) ? ' [warning]' : ''}`);
    process.exit(0);
  } else if (a === '--src') opt.src.push(...list(next()));
  else if (a === '--dist') opt.dist.push(...list(next()));
  else if (a === '--allow') opt.allow = next();
  else if (a === '--warn') for (const r of list(next())) { if (!RULES[r]) usage(`--warn: unknown rule "${r}"`); opt.warn.add(r); }
  else if (a === '--error') for (const r of list(next())) { if (!RULES[r]) usage(`--error: unknown rule "${r}"`); opt.error.add(r); }
  else if (a === '--root') opt.root = resolve(next());
  else if (a === '--source-only') opt.sourceOnly = true;
  else usage(`unknown option ${a}`);
}
if (!opt.src.length) opt.src.push('src');
if (!opt.dist.length) opt.dist.push('dist');
for (const r of DEFAULT_WARN) opt.warn.add(r);
for (const r of opt.error) opt.warn.delete(r);
const ROOT = opt.root;

// ---- allowlist ----
let allowlist = [];
const allowPath = opt.allow ? resolve(ROOT, opt.allow) : join(ROOT, 'brand-check.allow.json');
if (opt.allow && !existsSync(allowPath)) usage(`--allow ${opt.allow}: not found`);
if (existsSync(allowPath)) {
  try {
    allowlist = JSON.parse(readFileSync(allowPath, 'utf8'));
  } catch (e) {
    usage(`${relative(ROOT, allowPath)}: not valid JSON (${e.message})`);
  }
  if (!Array.isArray(allowlist)) usage(`${relative(ROOT, allowPath)}: must be a JSON array`);
  allowlist.forEach((e, n) => {
    if (!e || typeof e.file !== 'string' || !e.file) usage(`${relative(ROOT, allowPath)} entry ${n + 1}: needs "file"`);
    if (typeof e.reason !== 'string' || !e.reason.trim()) usage(`${relative(ROOT, allowPath)} entry ${n + 1}: needs a "reason"`);
    if (e.rule !== undefined && !RULES[e.rule]) usage(`${relative(ROOT, allowPath)} entry ${n + 1}: unknown rule "${e.rule}"`);
  });
}
const used = new Set();
const allowed = (f) =>
  allowlist.some((e, n) => {
    const fileOk = e.file === f.file || (e.file.endsWith('/') && f.file.startsWith(e.file));
    const ruleOk = e.rule === undefined || e.rule === f.rule;
    const matchOk = e.match === undefined || String(f.match).toLowerCase().includes(String(e.match).toLowerCase());
    if (fileOk && ruleOk && matchOk) used.add(n);
    return fileOk && ruleOk && matchOk;
  });

// ---- values from tokens.json ----
const palette = tokens.color;
const roles = tokens.colorRole || {};
const resolveAlias = (v) => palette[String(v).match(/^\{color\.([\w-]+)\}$/)?.[1]]?.$value;
const familySteps = new Map(); // purple -> {200, 300, 400}; black -> {''}
for (const key of Object.keys(palette)) {
  const m = key.match(/^([a-z]+)(?:-(\d+))?$/);
  if (!m) continue;
  if (!familySteps.has(m[1])) familySteps.set(m[1], new Set());
  familySteps.get(m[1]).add(m[2] ?? '');
}
const ANGLE = tokens.geometry['angle-base'].$value;
const ANGLE_ALT = tokens.geometry['angle-alt'].$value;
// Words that name a palette family. In script code they are often data (a CMS surface name such
// as backgroundColor: 'purple'), so there they count as named colors only inside a style.
const PALETTE_WORDS = new Set([...familySteps.keys(), 'grey']);
// The variables the package defines (every :root declaration of brand.css and supergraphics.css,
// next to this file). A page that redefines one gives a brand value a second origin. Pages set
// --sg-aspect on each frame, and --sg-highlighter-color, which no :root block declares.
const PKG_VARS = new Set();
for (const f of ['brand.css', 'supergraphics.css']) {
  const p = join(HERE, f);
  if (!existsSync(p)) continue;
  for (const block of readFileSync(p, 'utf8').matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/(--(?:mfb|sg)-[\w-]+)\s*:/g)) PKG_VARS.add(m[1]);
  }
}
PKG_VARS.delete('--sg-aspect');

const px = (v) => {
  const m = String(v).trim().match(/^(-?\d*\.?\d+)(px|rem)?$/);
  if (!m) return null;
  return Math.abs(Number(m[1]) * (m[2] === 'rem' ? 16 : 1));
};
const ms = (v) => {
  const m = String(v).trim().match(/^(\d*\.?\d+)(ms|s)$/);
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
};
const norm = (v) => String(v).toLowerCase().replace(/\s+/g, ' ').replace(/\s*([(),/])\s*/g, '$1').trim();
const entries = (group) => Object.entries(tokens[group] || {});
const byPx = (group, hint) => {
  const m = new Map();
  for (const [k, t] of entries(group)) {
    const n = px(t.$value);
    if (n !== null && !m.has(n)) m.set(n, hint(k));
  }
  return m;
};
const byText = (group, hint, map = new Map()) => {
  for (const [k, t] of entries(group)) if (!/^-?\d*\.?\d+(px|rem)?$/.test(String(t.$value))) map.set(norm(t.$value), hint(k));
  return map;
};
// A px literal is compared with the spacing scale only: a semantic spacing token in px (such as
// the 40px between a heading and its text) names a role, and any other 40px is not that role.
const SPACE_PX = byPx('spaceScale', (k) => `var(--mfb-space-${k}) or Tailwind's p-${k}, m-${k}, gap-${k}`);
const SPACE_TEXT = byText('space', (k) => `var(--mfb-space-${k}) or *-mfb-${k}`);
const RADIUS_PX = byPx('radius', (k) => `var(--mfb-radius-${k})${k === 'pill' ? ' or rounded-full' : ` or rounded-mfb-${k}`}`);
const CONTAINER_PX = byPx('container', (k) => `var(--mfb-container-${k}) or max-w-mfb-${k}`);
const SIZE_PX = byPx('fontSize', (k) => `var(--mfb-size-${k}) or text-${k}`);
const SIZE_TEXT = byText('fontSizeFluid', (k) => `var(--mfb-size-${k}-fluid) or text-${k}-fluid`);
const DURATION_MS = new Map(entries('duration').map(([k, t]) => [ms(t.$value), `var(--mfb-duration-${k}) or duration-mfb-${k}`]));
const EASING = new Map(entries('easing').map(([k, t]) => [norm(`cubic-bezier(${[].concat(t.$value).join(',')})`), `var(--mfb-ease-${k}) or ease-mfb-${k}`]));
const WEIGHT = new Map(entries('fontWeight').map(([k, t]) => [String(t.$value), `var(--mfb-weight-${k}) or font-${k}`]));
const SHADOW = new Map();
for (const [k, t] of entries('shadow')) {
  const v = t.$value;
  const name = String(v.color).match(/^\{color\.([\w-]+)\}$/)?.[1];
  const pct = `${Math.round(Number(v.opacity) * 100)}%`;
  const z = (s) => (String(s) === '0px' ? '0' : String(s));
  for (const color of [`var(--mfb-${name})`, palette[name]?.$value]) {
    SHADOW.set(norm(`${z(v.offsetX)} ${z(v.offsetY)} ${z(v.blur)} ${z(v.spread)} color-mix(in srgb, ${color} ${pct}, transparent)`), `var(--mfb-shadow-${k}) or shadow-mfb-${k}`);
  }
}

const TW_COLOR_FAMILIES = new Set(('red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink ' +
  'rose slate gray zinc neutral stone mauve olive mist taupe black white').split(' '));
const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
  'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
  'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
  'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite ' +
  'forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory ' +
  'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen ' +
  'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
  'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
  'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
  'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
  'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
  'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
  'yellowgreen').split(' '));
const COLOR_PROP =
  '(?:color|background(?:-?color)?|border(?:-?(?:top|right|bottom|left|block|inline)(?:-?(?:start|end))?)?(?:-?color)?|' +
  'outline(?:-?color)?|fill|stroke|stop-?color|flood-?color|lighting-?color|text-?decoration(?:-?color)?|caret-?color|' +
  'accent-?color|column-?rule(?:-?color)?|box-?shadow|text-?shadow|scrollbar-?color)';

// ---- files ----
const SOURCE_EXT = new Set(['.astro', '.css', '.scss', '.sass', '.less', '.pcss', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.svg', '.vue', '.svelte']);
const CSS_EXT = new Set(['.css', '.scss', '.sass', '.less', '.pcss']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.astro', '.svelte-kit', '.next']);
const distAbs = opt.dist.map((d) => resolve(ROOT, d));
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');
function walk(abs, out, exts) {
  if (!existsSync(abs)) return out;
  const st = statSync(abs);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(abs.split(sep).pop())) return out;
    for (const n of readdirSync(abs).sort()) walk(join(abs, n), out, exts);
  } else if (exts.has(extname(abs)) && !/(^|[\\/])brand-check\.m?js$/.test(abs)) out.push(abs);
  return out;
}

// ---- findings ----
const findings = [];
let lineStarts = [];
const lineOf = (i) => {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= i) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
};
const report = (file, index, rule, why, match) =>
  findings.push({ file, line: index === null ? null : lineOf(index), rule, why, match: String(match).replace(/\s+/g, ' ').trim().slice(0, 100) });
const each = (re, text, fn) => { for (const m of text.matchAll(re)) fn(m); };
const quarterTurn = (value, unit) => Math.abs(({ deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[unit] * Number(value)) % 90) < 1e-9;

/** Blank out comments, keeping every newline so line numbers stay true. */
function stripComments(text, ext) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank);
  if (!CSS_EXT.has(ext) && ext !== '.html' && ext !== '.svg') {
    out = out.replace(/(^|[^:"'`\\])(\/\/[^\n]*)/g, (m, pre, c) => pre + blank(c));
  }
  if (!CSS_EXT.has(ext)) {
    // Editor metadata in SVG files (Inkscape's page color, guides, zoom) is not drawn.
    out = out.replace(/<\/?(?:sodipodi|inkscape):[^>]*>/g, blank).replace(/\s(?:sodipodi|inkscape):[\w-]+\s*=\s*(?:"[^"]*"|'[^']*')/g, blank);
  }
  return out;
}

/**
 * The value after a "prop:" at index i: a quoted string, or the text up to ; } or the end of the
 * line (in script code also up to a comma, which ends an object property). An expression such
 * as a variable or a ternary reads as words that match no token, so it is never reported.
 */
function readValue(t, i, script) {
  while (t[i] === ' ' || t[i] === '\t') i++;
  const q = t[i];
  if (q === '"' || q === "'" || q === '`') {
    const end = t.indexOf(q, i + 1);
    if (end === -1) return null;
    const v = t.slice(i + 1, end);
    return v.includes('${') ? null : v;
  }
  let depth = 0;
  let j = i;
  for (; j < t.length; j++) {
    const c = t[j];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth <= 0 && (';}\n"\'`{'.includes(c) || (script && c === ','))) break;
  }
  return t.slice(i, j).trim().replace(/\s*!important$/, '');
}
/** Split a value into its top-level parts (spaces outside parentheses). */
function parts(v) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of v) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (/\s/.test(c) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

const rangesOf = (re, t) => [...t.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
const inRanges = (i, ranges) => ranges.some(([a, b]) => i >= a && i < b);
/** Ranges of <style> blocks in markup files, where the text is CSS. */
const styleBlocks = (t) => rangesOf(/<style\b[^>]*>([\s\S]*?)<\/style>/g, t);
/** @font-face blocks: their font-family and font-weight describe a face, they do not use one. */
const fontFaces = (t) => rangesOf(/@font-face\s*\{[^}]*\}/g, t);
/** Inline styles in markup and style objects in script code. */
const inlineStyles = (t) => rangesOf(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*'|\{\{[\s\S]*?\}\}|\{`[^`]*`\})|\bstyle\s*:\s*\{[^{}]*\}/g, t);
/** A quoted family name counts only where a font family is being set. */
const FAMILY_CONTEXT = /(?:font-?family|fontFamily|\bfont|--[\w-]*font[\w-]*|\b(?:sans|serif|mono|display|heading|body|family))["']?\s*[:=]\s*[[{(]?\s*(?:(?:["'][^"'\n]*["']|[\w-]+)\s*,\s*)*$/i;

function rawValues(file, t, ctx) {
  const check = (re, fn) => each(re, t, (m) => {
    if (inRanges(m.index, ctx.faces)) return;
    const v = readValue(t, m.index + m[0].length, ctx.script(m.index));
    if (v === null || v === '') return;
    fn(m, v);
  });
  const hint = (m, v, h, rule = 'raw-value') => report(file, m.index, rule, `"${v}" has a token: use ${h}`, `${m[1]}: ${v}`);

  check(/(?<![\w-])((?:padding|margin)(?:-?(?:top|right|bottom|left|inline|block)(?:-?(?:start|end))?)?|gap|row-?gap|column-?gap)\s*:\s*/gi, (m, v) => {
    const nt = norm(v);
    if (SPACE_TEXT.has(nt)) return hint(m, v, SPACE_TEXT.get(nt));
    for (const p of parts(v)) {
      if (SPACE_TEXT.has(norm(p))) return hint(m, p, SPACE_TEXT.get(norm(p)));
      const n = px(p);
      if (n && SPACE_PX.has(n) && /px|rem|^-?\d+$/.test(p)) return hint(m, p, SPACE_PX.get(n), 'raw-spacing');
    }
  });
  check(/(?<![\w-])(border(?:-?(?:top|bottom|start|end)-?(?:left|right|start|end))?-?radius)\s*:\s*/gi, (m, v) => {
    for (const p of parts(v)) {
      const n = px(p);
      if (n && RADIUS_PX.has(n)) return hint(m, p, RADIUS_PX.get(n));
    }
  });
  check(/(?<![\w-])(max-?width)\s*:\s*/gi, (m, v) => {
    const n = px(v);
    if (n && CONTAINER_PX.has(n)) hint(m, v, CONTAINER_PX.get(n));
  });
  check(/(?<![\w-])(font-?size)\s*:\s*/gi, (m, v) => {
    if (SIZE_TEXT.has(norm(v))) return hint(m, v, SIZE_TEXT.get(norm(v)));
    const n = px(v);
    if (n && SIZE_PX.has(n) && /px|rem|^\d+$/.test(v)) hint(m, v, SIZE_PX.get(n));
  });
  check(/(?<![\w-])(font-?weight)\s*:\s*/gi, (m, v) => {
    if (WEIGHT.has(v.trim())) hint(m, v, WEIGHT.get(v.trim()));
  });
  check(/(?<![\w-])(transition(?:-?duration)?|animation(?:-?duration)?)\s*:\s*/gi, (m, v) => {
    for (const p of v.split(/[\s,]+/)) {
      const n = ms(p);
      if (n !== null && DURATION_MS.has(n)) return hint(m, p, DURATION_MS.get(n));
    }
  });
  check(/(?<![\w-])(box-?shadow)\s*:\s*/gi, (m, v) => {
    const k = norm(v.replace(/(^|\s)0px(?=\s)/g, '$10'));
    if (SHADOW.has(k)) hint(m, v, SHADOW.get(k));
  });
  each(/cubic-bezier\(([^)]*)\)/g, t, (m) => {
    const k = norm(`cubic-bezier(${m[1].split(',').map((n) => String(Number(n))).join(',')})`);
    if (EASING.has(k)) report(file, m.index, 'raw-value', `this easing has a token: use ${EASING.get(k)}`, m[0]);
  });
}

/** Class lists: class attributes, @apply, and string literals that read as utility classes. */
function classLists(t, ext) {
  const out = [];
  each(/@apply\s+([^;}\n]+)/g, t, (m) => out.push([m.index, m[1]]));
  if (CSS_EXT.has(ext)) return out;
  // Every string literal: a class attribute's value, or a string that reads as a list of utilities.
  each(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g, t, (m) => {
    const s = m[2].replace(/\$\{[^}]*\}/g, ' ');
    const toks = s.split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    const attr = /(?<![\w-])(?:class|className|class:list)\s*=\s*\{?\s*$/.test(t.slice(Math.max(0, m.index - 20), m.index));
    const classy = toks.every((x) => /^!?(?:[\w-]+:)*-?[a-z][\w-]*(?:\[[^\]\s]*\])?(?:\/[\w.]+)?$/.test(x));
    if (attr || (classy && toks.some((x) => x.includes('-') || x.includes('[')))) out.push([m.index, s]);
  });
  return out;
}

const COLOR_UTIL = '(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|decoration|fill|stroke|shadow|inset-shadow|drop-shadow|from|via|to|placeholder|accent|caret|divide)';
function checkClasses(file, t, ext) {
  for (const [index, list] of classLists(t, ext)) {
    const toks = list.split(/\s+/).filter(Boolean).map((x) => x.replace(/^!/, '').replace(/^(?:[\w-]+:)+/, ''));
    const tagStart = t.lastIndexOf('<', index);
    const onHeading = tagStart !== -1 && /^<h[1-6]\b[^<>]*$/.test(t.slice(tagStart, index));
    for (const c of toks) {
      const color = c.match(new RegExp(`^-?${COLOR_UTIL}-([a-z]+)(?:-(\\d{2,3}))?(?:\\/[\\w.]+)?$`));
      if (color && TW_COLOR_FAMILIES.has(color[1]) && !(familySteps.has(color[1]) && familySteps.get(color[1]).has(color[2] ?? ''))) {
        report(file, index, 'off-palette-utility', 'color outside the palette (tokens.json): use the nearest palette color or a color role', c);
      }
      const arbColor = c.match(new RegExp(`^-?${COLOR_UTIL}-\\[(?:color:)?([a-z]+)\\]$`));
      if (arbColor && NAMED_COLORS.has(arbColor[1])) report(file, index, 'named-color', 'named color in an arbitrary value (use a palette utility or a color role)', c);
      if (/^text-(?:mfb-)?orange-\d+(?:\/[\w.]+)?$/.test(c)) report(file, index, 'text-color', 'orange text: only on purple-300 and purple-400 (text-link-on-dark), never on a light background; on orange, text is black (918:2588)', c);
      if (onHeading && /^text-(?:mfb-)?purple-\d+(?:\/[\w.]+)?$/.test(c)) report(file, index, 'text-color', 'purple heading: headings on light backgrounds are black (text-heading-on-light, 918:2990), on dark ones white', c);
      if (c === 'uppercase' || c === 'small-caps') report(file, index, 'uppercase', 'uppercase (Brand Book: Title Case, never all caps)', c);
      if (/^font-(?:mono|serif|\[(?!\d).+\])$/.test(c)) report(file, index, 'font-family', 'font family that is not the brand sans', c);
      const arbWeight = c.match(/^font-\[(\d+)\]$/);
      if (/^font-(?:bold|extrabold|black)$/.test(c) || (arbWeight && Number(arbWeight[1]) > 600)) report(file, index, 'weight', 'weight above 600 (the brand uses 400, 500 and 600)', c);
      if (/^-?skew-[xy]?-?/.test(c) && !/^-?skew-[xy]?-?0$/.test(c)) report(file, index, 'angle', 'skew utility (the slant comes from the supergraphics classes)', c);
      const rot = c.match(/^-?rotate-(\d+)$/);
      if (rot && Number(rot[1]) % 90) report(file, index, 'angle', 'rotation that is not a quarter turn', c);
      if (/^(?:bg-gradient-|bg-linear-|bg-radial-|bg-conic-)/.test(c) || c === 'bg-brand-gradient') report(file, index, c === 'bg-brand-gradient' ? 'deprecated-gradient' : 'gradient', 'gradient utility (solid palette fills only)', c);
      if (/^(?:grayscale|sepia|hue-rotate-\d+|saturate-\d+)$/.test(c)) report(file, index, 'color-filter', 'smooth color filter (photos are halftone, never duotone)', c);
      if (/^(?:mix-blend|bg-blend)-(?!normal$)[\w-]+$/.test(c)) report(file, index, 'color-filter', 'blend mode (a photo blended into a color is duotone; photos are halftone)', c);
      if (/^\[clip-path:/.test(c)) report(file, index, 'clip-path', 'hand-rolled clip-path (use the supergraphics shape classes)', c);
      const arb = c.match(/^-?(p[trblxyse]?|m[trblxyse]?|gap(?:-[xy])?|space-[xy]|rounded(?:-[trblse]{1,2})?|duration|ease|max-w|text|font|shadow)-\[([^\]]+)\]$/);
      if (arb) {
        const [, util, rawv] = arb;
        const v = rawv.replace(/_/g, ' ');
        let h = null;
        let rule = 'raw-value';
        if (/^(p|m|gap|space)/.test(util)) {
          h = SPACE_TEXT.get(norm(v));
          if (!h && px(v)) { h = SPACE_PX.get(px(v)); rule = 'raw-spacing'; }
        } else if (util.startsWith('rounded')) h = px(v) ? RADIUS_PX.get(px(v)) : null;
        else if (util === 'duration') h = DURATION_MS.get(ms(v));
        else if (util === 'ease') h = EASING.get(norm(v.replace(/\s/g, '')));
        else if (util === 'max-w') h = px(v) ? CONTAINER_PX.get(px(v)) : null;
        else if (util === 'text') h = SIZE_TEXT.get(norm(v)) || (px(v) ? SIZE_PX.get(px(v)) : null);
        else if (util === 'font') h = WEIGHT.get(v);
        if (h) report(file, index, rule, `"${v}" has a token: use ${h}`, c);
      }
    }
    const shape = toks.some((c) => /^(?:sg-(?:para|spotlight|book|halftone|cover|bg)[\w-]*|highlighter)$/.test(c));
    const see = toks.find((c) => /^opacity-(?:\d+|\[[^\]]+\])$/.test(c) || /^(?:bg|fill)-[\w-]+\/(?:\d+|\[[^\]]+\])$/.test(c));
    if (shape && see) report(file, index, 'translucent-shape', 'translucent brand shape (solid palette fills only)', see);
  }
}

const SHAPE_CLASS = /(?:^|[\s"'`{])(?:sg-(?:para|spotlight|book|halftone|cover|bg)[\w-]*|highlighter)(?=[\s"'`}$]|$)/;
const TYPED_CAPS = /\b[A-Z][A-Z'’]{3,}\b[^a-z<>{}\n]*?\b[A-Z][A-Z'’]{3,}\b/;

function checkSource(abs) {
  const file = rel(abs);
  const ext = extname(abs);
  const t = stripComments(readFileSync(abs, 'utf8'), ext);
  lineStarts = [0];
  for (let i = 0; i < t.length; i++) if (t[i] === '\n') lineStarts.push(i + 1);
  // Script code: a .js/.ts file, or a markup file outside its <style> blocks.
  const blocks = CSS_EXT.has(ext) ? [] : styleBlocks(t);
  const ctx = {
    faces: fontFaces(t),
    styles: inlineStyles(t),
    script: (i) => !CSS_EXT.has(ext) && !(ext === '.html' || ext === '.svg') && !inRanges(i, blocks),
  };

  // Colors
  each(/(?<![\w&#/.-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g, t, (m) => {
    const before = t.slice(t.lastIndexOf('\n', m.index) + 1, m.index);
    if (/(?:\b(?:href|to|id|for|xlink:href)=\{?["'`]?[^"'`\s]*|\b(?:href|url|link|anchor|hash|[a-z]+Url|[a-z]+Href)\s*[:=]\s*["'`][^"'`\s]*|url\(\s*["']?|querySelector(?:All)?\(\s*["'`][^"'`]*|getElementById\(\s*["'`])$/i.test(before)) return;
    if (/^\s*[{,.:[>+~]/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 3)) && !/:\s*[^;{}]*$/.test(before)) return; // an id selector
    report(file, m.index, 'color-literal', 'hex color (use var(--mfb-*) or a palette utility)', m[0]);
  });
  each(/(?<![\w.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi, t, (m) =>
    report(file, m.index, 'color-literal', 'color function (use var(--mfb-*); a translucent shadow mixes a palette color with color-mix())', t.slice(m.index, m.index + 40)));
  each(new RegExp(`(?<![\\w-])(${COLOR_PROP})\\s*:\\s*([^;}\\n]*)`, 'gi'), t, (m) => {
    const value = m[2].replace(/[!=]==?\s*(["'`])[^"'`]*\1|(["'`])[^"'`]*\2\s*[!=]==?/g, ' ').toLowerCase().replace(/var\(--[\w-]+/g, ' ');
    const word = (value.match(/[a-z]+/g) ?? []).find((w) => NAMED_COLORS.has(w));
    if (!word) return;
    // In script code a palette word outside a style is usually data, such as a CMS surface name.
    if (ctx.script(m.index) && PALETTE_WORDS.has(word) && !inRanges(m.index, ctx.styles)) return;
    report(file, m.index, 'named-color', `named color "${word}" (use var(--mfb-${word === 'white' || word === 'black' ? word : '<palette>'}))`, m[0]);
  });
  each(/(?<![\w-])(fill|stroke|stop-color|flood-color|lighting-color|color|bgcolor)=(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/gi, t, (m) => {
    const v = (m[2] ?? m[3] ?? m[4]).trim();
    if (NAMED_COLORS.has(v.toLowerCase())) report(file, m.index, 'named-color', 'SVG color attribute with a named color (use currentColor or var(--mfb-*))', m[0]);
  });
  each(/(?<![\w-])color["']?\s*:\s*["'`]?var\(--mfb-orange-\d+\)/g, t, (m) =>
    report(file, m.index, 'text-color', 'orange text: only on purple-300 and purple-400 (var(--mfb-link-on-dark)), never on a light background; on orange, text is black (918:2588)', m[0]));
  each(/([^{}]*)\{([^{}]*)\}/g, t, (m) => {
    if (!CSS_EXT.has(ext) && !inRanges(m.index + m[1].length, blocks)) return;
    const c = m[2].match(/(?<![\w-])color\s*:\s*var\(--mfb-purple-\d+\)/);
    if (c && /(?:^|[\s,>+~(])h[1-6](?![\w-])/.test(m[1].trim())) report(file, m.index + m[0].indexOf(c[0]), 'text-color', 'purple heading: headings on light backgrounds are black (var(--mfb-heading-on-light), 918:2990), on dark ones white', c[0]);
  });

  // Gradients, highlighter bands and filters
  each(/(?:repeating-)?(?:linear|radial|conic)-gradient\(/g, t, (m) => {
    const text = t.slice(m.index, m.index + 400);
    const before = t.slice(Math.max(0, m.index - 160), m.index);
    const isMask = /(?:(?:-webkit-)?mask(?:-image)?|(?:Webkit)?[mM]ask(?:Image)?)\s*:\s*(?:[\w.!]+\s*\?\s*)?["'`]?\s*$|\bconst\s+[A-Z_]*MASK\s*=\s*["'`]?\s*$/.test(before);
    const body = text.match(/^[\w-]+\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/)?.[1] ?? '';
    const onlyAlpha = body.replace(/to (?:right|left|bottom|top)/g, '').replace(/var\(--mfb-black\)|black|transparent|calc\([^)]*\)|-?[\d.]+(?:px|%|deg)?|,/g, '').trim() === '';
    if (isMask && onlyAlpha) return;
    const band = body.match(/transparent\s+(\d+(?:\.\d+)?)%\s*,\s*.+?\s(\d+(?:\.\d+)?)%/);
    if (band && band[1] === band[2]) {
      return report(file, m.index, 'hand-rolled-highlighter', 'local highlighter band: delete it, the package\'s .highlighter draws the Brand Book\'s thin line (since v1.4.0)', text.split('\n')[0]);
    }
    report(file, m.index, 'gradient', 'gradient (the Brand Book uses solid palette fills only)', text.split('\n')[0]);
  });
  each(/([^{}]*::?(?:after|before)[^{}]*)\{([^{}]*)\}/g, t, (m) => {
    if (/(?<![\w-])height\s*:\s*[\d.]+em\b/.test(m[2]) && /background(?:-color)?\s*:\s*[^;]*(?:--(?:mfb-)?orange|--(?:mfb-)?accent|highlighter)/.test(m[2])) {
      report(file, m.index + m[0].indexOf('{'), 'hand-rolled-highlighter', 'local highlighter bar (an orange pseudo-element sized in em): use the package\'s .highlighter', m[1].trim());
    }
  });
  each(/--mfb-gradient(?:-brand)?(?![\w-])|(?<![\w-])sg-bg-gradient(?![\w-])|(?<![\w-])sg-photo-zone(?![\w-])/g, t, (m) =>
    report(file, m.index, 'deprecated-gradient', 'deprecated brand gradient or smooth gradient class (use a solid palette fill)', m[0]));
  each(/(?<![\w-])(?:grayscale|sepia|hue-rotate|saturate)\s*\(/g, t, (m) =>
    report(file, m.index, 'color-filter', 'smooth color filter (photos are halftone, never duotone)', m[0]));
  each(/(?<![\w-])(?:mix-blend-mode|mixBlendMode|background-blend-mode|backgroundBlendMode)\s*:\s*["'`]?\s*([\w-]+)/g, t, (m) => {
    if (!/^(?:normal|initial|inherit|unset|revert)$/.test(m[1])) report(file, m.index, 'color-filter', 'blend mode (a photo blended into a color is duotone; photos are halftone, Rule 4)', m[0]);
  });

  // Geometry
  each(/(?<![\w-])skew(?:[XY])?\s*\(/g, t, (m) => {
    if (/^\s*-?0(?:\.0+)?(?:deg|rad|grad|turn)?\s*(?:,\s*-?0(?:\.0+)?(?:deg|rad|grad|turn)?\s*)?\)/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 40))) return; // no skew at all
    report(file, m.index, 'angle', 'skew (the slant comes from the supergraphics classes, e.g. sg-para)', t.slice(m.index, m.index + 50));
  });
  each(/(?<![\w.-])(-?\d*\.?\d+)(deg|grad|rad|turn)(?![\w-])/g, t, (m) => {
    if (!quarterTurn(m[1], m[2])) report(file, m.index, 'angle', `angle literal (the brand angle, ${ANGLE}, comes from --sg-angle-base)`, m[0]);
  });
  each(/rotate[XYZ3d]*\s*[:(][^;\n)]*--sg-angle|(?<![\w-])rotate\s*:\s*[^;\n]*--sg-angle/g, t, (m) =>
    report(file, m.index, 'angle', 'rotation by the brand angle (use a supergraphics shape)', m[0]));
  each(/(?<![\w-])(?:tan|sin|cos|atan2?)\(\s*(?:calc\(\s*)?(?:-1\s*\*\s*)?var\(--sg-angle-[\w-]+\)/g, t, (m) =>
    report(file, m.index, 'angle', 'slant geometry computed in the page from --sg-angle-* (the supergraphics classes compute it; a local inset doubles theirs)', m[0]));
  each(/(?<![\w-])transform\s*=\s*\{?\s*["'`]([^"'`]*)["'`]/g, t, (m) => {
    for (const r of m[1].matchAll(/rotate\(\s*(-?\d*\.?\d+)/g)) {
      if (Math.abs(Number(r[1]) % 90) > 1e-9) report(file, m.index, 'angle', 'rotation in an SVG transform that is not a quarter turn (the logo and the shapes are never tilted by hand)', r[0]);
    }
  });
  each(/(?<![\w-])(matrix(?:3d)?)\s*\(([^)]*)\)/g, t, (m) => {
    const n = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    const [len, turn] = m[1] === 'matrix' ? [6, [1, 2]] : [16, [1, 2, 4, 6, 8, 9]];
    if (n.length === len && n.every(Number.isFinite) && turn.every((i) => n[i] === 0)) return; // scale and translate only
    report(file, m.index, 'angle', 'transform matrix that rotates or skews', m[0].slice(0, 60));
  });
  each(/(?<![\w-])(?:-webkit-clip-path|clip-path|WebkitClipPath|clipPath)\s*:\s*/g, t, (m) => {
    const v = readValue(t, m.index + m[0].length, false) ?? '';
    if (/^(?:none|inset\(\s*50%\s*\)|var\(--sg-[\w-]+\))$/.test(v.trim())) return;
    report(file, m.index, 'clip-path', 'hand-rolled clip-path (use the supergraphics shape classes: sg-para-frame, sg-spotlight-frame, sg-book-frame)', `clip-path: ${v}`);
  });

  // Package variables are defined by the package only.
  each(/(?<![\w-])(--(?:mfb|sg)-[\w-]+)["']?\s*:/g, t, (m) => {
    if (PKG_VARS.has(m[1])) report(file, m.index, 'token-override', `redefines ${m[1]}, which the package defines: take the value from the package (an exception goes in the allowlist, with its reason)`, m[0]);
  });

  // Type
  each(/(?<![\w-])(?:font-family|fontFamily)\s*(?::\s*([^;}\n]+)|=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\}))/g, t, (m) => {
    if (inRanges(m.index, ctx.faces)) return;
    const v = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim().replace(/\s*!important$/, '').replace(/^["'`]|["'`],?$/g, '').trim();
    if (!/^(?:var\(--(?:mfb-)?font-(?:heading|body|sans)\)|inherit|initial|unset)$/.test(v))
      report(file, m.index, 'font-family', 'font family that is not exactly var(--mfb-font-heading|body|sans)', m[0]);
  });
  each(/--mfb-font-mono|var\(--font-(?:mono|serif)\)/g, t, (m) => report(file, m.index, 'font-family', 'the deprecated mono family, or the serif family', m[0]));
  each(/(["'])(?:IBM Plex[^"']*|Arial|Helvetica[^"']*|Inter|Roboto|Georgia|Times New Roman|Courier[^"']*|monospace|sans-serif|serif|system-ui)\1/g, t, (m) => {
    if (inRanges(m.index, ctx.faces)) return;
    if (!FAMILY_CONTEXT.test(t.slice(t.lastIndexOf('\n', m.index - 1) + 1, m.index))) return; // a word in data, not a family
    report(file, m.index, 'font-family', 'font family literal', m[0]);
  });
  each(/(?:text-transform|textTransform)\s*:\s*["'`]?uppercase|small-caps|smallCaps|font-variant-caps\s*:\s*all|(?:font-feature-settings|fontFeatureSettings)\s*:[^;}\n]*["'](?:smcp|c2sc)["']/g, t, (m) =>
    report(file, m.index, 'uppercase', 'uppercase or small caps (Brand Book: Title Case, never all caps)', m[0]));
  each(/(?:font-weight|fontWeight)\s*:\s*["'`]?\s*(?:[7-9]00|1000|bold|bolder)\b/g, t, (m) => {
    if (!inRanges(m.index, ctx.faces)) report(file, m.index, 'weight', 'weight above 600 (the brand uses 400, 500 and 600)', m[0]);
  });
  if (!CSS_EXT.has(ext) && !['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
    each(/(?<![=\-])>([^<>{}]+)</g, t, (m) => {
      const caps = m[1].match(TYPED_CAPS);
      if (caps) report(file, m.index + 1 + caps.index, 'typed-caps', 'words typed in capitals: type them in Title Case or sentence case (Rule 1); all caps is never a style', caps[0]);
    });
  }

  // Translucent brand shapes
  each(/([^{}\n;>]*(?:\.sg-|\.highlighter)[^{}\n;]*)\{([^{}]*)\}/g, t, (m) => {
    if (/opacity\s*:|color-mix\(/.test(m[2])) report(file, m.index, 'translucent-shape', 'translucent brand shape (solid palette fills only)', m[1]);
  });
  each(/<[a-zA-Z][\w.:-]*\s[^<>]*>/g, t, (m) => {
    const cls = m[0].match(/\bclass(?:Name)?\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/);
    if (!cls || !SHAPE_CLASS.test(cls[1])) return;
    const op = m[0].match(/\bstyle\s*=[^>]*?\bopacity["']?\s*:\s*["'`]?\s*(\d*\.?\d+)/);
    if (op && Number(op[1]) < 1) report(file, m.index, 'translucent-shape', 'translucent brand shape (solid palette fills only)', `opacity: ${op[1]}`);
  });
  each(/--sg-highlighter-color["']?\s*:\s*/g, t, (m) => {
    const v = (readValue(t, m.index + m[0].length, ctx.script(m.index)) ?? '').trim();
    const name = v.match(/^var\(--mfb-([\w-]+)\)$/)?.[1];
    if (!name || !(palette[name] || roles[name])) report(file, m.index, 'translucent-shape', 'the highlighter color is a solid palette variable, for example var(--mfb-white)', `--sg-highlighter-color: ${v}`);
  });

  checkClasses(file, t, ext);
  rawValues(file, t, ctx);
}

// A utility class definition that Tailwind emits because its content scanner saw the word (in a
// comment, say). The source check already reports the class where it is used.
const BUILT_UTILITY = /^(?:uppercase|small-caps|font-mono|font-serif)$/;
const isUtilityRule = (sel) => sel.trim() !== '' && sel.split(',').every((part) => {
  const last = part.trim().split(/[\s>+~]+/).pop() || '';
  const m = last.match(/^\.((?:[\w-]+\\:)*)([\w-]+)((?::{1,2}[\w-]+(?:\([^)]*\))?)*)$/);
  return !!m && BUILT_UTILITY.test(m[2]);
});
/** The selector of the rule that index i is in (its selector, or its declaration block). */
const selectorAt = (css, i) => {
  const nextOpen = css.indexOf('{', i);
  const nextClose = css.indexOf('}', i);
  const end = nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose) ? nextOpen : css.lastIndexOf('{', i);
  if (end < 0) return '';
  const start = Math.max(css.lastIndexOf('}', end - 1), css.lastIndexOf('{', end - 1), css.lastIndexOf(';', end - 1)) + 1;
  return css.slice(start, end);
};

function checkBuilt() {
  const files = distAbs.flatMap((d) => walk(d, [], new Set(['.css', '.html'])));
  const chunks = [];
  for (const abs of files) {
    const text = readFileSync(abs, 'utf8');
    if (abs.endsWith('.css')) chunks.push([rel(abs), text]);
    else for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) chunks.push([rel(abs), m[1]]);
  }
  if (!chunks.length) {
    findings.push({ file: opt.dist.join(', '), line: null, rule: 'built-missing', why: 'no built CSS found (build first, or pass --source-only)', match: opt.dist.join(', ') });
    return;
  }
  // Geometry: the base angle is there, and nothing sets either angle to another value.
  let angleFound = false;
  for (const [file, css] of chunks) {
    for (const m of css.matchAll(/--sg-angle-(base|alt)\s*:\s*([^;}]+)/g)) {
      const want = m[1] === 'base' ? ANGLE : ANGLE_ALT;
      if (m[2].trim().toLowerCase() === String(want).toLowerCase()) { if (m[1] === 'base') angleFound = true; continue; }
      findings.push({ file, line: null, rule: 'built-angle', why: `--sg-angle-${m[1]} is set to ${m[2].trim()}, the token is ${want}`, match: `--sg-angle-${m[1]}: ${m[2].trim()}` });
    }
  }
  if (!angleFound) {
    findings.push({ file: opt.dist.join(', '), line: null, rule: 'built-angle', why: `--sg-angle-base is missing or is not ${ANGLE} (import @myfirstbitcoin/design/brand.css or supergraphics.css)`, match: '--sg-angle-base' });
  }
  const hex = (v) => {
    let h = v.trim().toLowerCase().replace(/^#/, '');
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    return h.length === 8 && h.endsWith('ff') ? h.slice(0, 6) : h;
  };
  const expected = (name) => {
    const bare = name.replace(/^mfb-/, '');
    if (palette[bare]) return [palette[bare].$value, `var(--mfb-${bare})`];
    if (roles[name]) return [resolveAlias(roles[name].$value), `var(--mfb-${name})`];
    return null;
  };
  for (const [file, css] of chunks) {
    const snip = (i, len) => css.slice(Math.max(0, i - 30), i + len + 20);
    for (const m of css.matchAll(/--color-([\w-]+)\s*:\s*([^;}]+)/g)) {
      const want = expected(m[1]);
      const v = m[2].trim();
      if (!want) findings.push({ file, line: null, rule: 'built-color', why: `--color-${m[1]} is not a palette color or a color role`, match: `--color-${m[1]}: ${v}` });
      else if (v !== want[1] && !(/^#[0-9a-f]{3,8}$/i.test(v) && hex(v) === hex(want[0])))
        findings.push({ file, line: null, rule: 'built-color', why: `--color-${m[1]} is ${v}, the token is ${want[0]}`, match: `--color-${m[1]}: ${v}` });
    }
    for (const [re, rule, why] of [
      [/text-transform\s*:\s*uppercase/gi, 'built-uppercase', 'text-transform: uppercase'],
      [/font-variant(?:-caps)?\s*:[^;}]*small-caps/gi, 'built-uppercase', 'small caps'],
      [/font-feature-settings\s*:[^;}]*["'](?:smcp|c2sc)["']/gi, 'built-uppercase', 'small-cap font features'],
      [/\.uppercase(?![\w-])/g, 'built-uppercase', 'the uppercase class'],
      [/\.font-(?:mono|serif)(?![\w-])/g, 'built-font', 'a font-mono or font-serif class'],
      [/var\(\s*--(?:mfb-)?font-(?:mono|serif)\s*[,)]/g, 'built-font', 'a use of the mono or serif family'],
    ]) {
      for (const m of css.matchAll(re)) {
        if (isUtilityRule(selectorAt(css, m.index))) continue;
        // Tailwind 4's base styles set code, kbd, samp and pre in this variable; it is not a use.
        if (/--default-mono-font-family\s*:\s*$/.test(css.slice(Math.max(0, m.index - 40), m.index))) continue;
        findings.push({ file, line: null, rule, why, match: snip(m.index, m[0].length) });
      }
    }
  }
}

// ---- run ----
const srcAbs = opt.src.map((d) => resolve(ROOT, d));
for (const [i, d] of srcAbs.entries()) if (!existsSync(d)) usage(`--src ${opt.src[i]}: not found under ${ROOT}`);
const sources = srcAbs.flatMap((d) => walk(d, [], SOURCE_EXT)).filter((f) => !distAbs.some((d) => f.startsWith(d + sep)));
sources.forEach(checkSource);
if (!opt.sourceOnly) checkBuilt();

const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.file}|${f.line}|${f.rule}|${f.match}`;
  return !seen.has(k) && seen.add(k);
});
const kept = unique.filter((f) => !allowed(f));
const errors = kept.filter((f) => !opt.warn.has(f.rule));
const warnings = kept.filter((f) => opt.warn.has(f.rule));
const line = (f) => `${f.file}${f.line ? `:${f.line}` : ''}: [${f.rule}] ${f.why}: ${f.match}`;
for (const f of warnings) console.warn(`brand-check: warning: ${line(f)}`);
for (const f of errors) console.error(`brand-check: ${line(f)}`);
allowlist.forEach((e, n) => {
  if (!used.has(n)) console.warn(`brand-check: warning: allowlist entry ${n + 1} (${e.file}${e.rule ? `, ${e.rule}` : ''}) matched nothing; remove it`);
});
const what = `${sources.length} source files${opt.sourceOnly ? '' : ' and the built CSS'}`;
if (errors.length) {
  const counts = {};
  for (const f of errors) counts[f.rule] = (counts[f.rule] || 0) + 1;
  console.error(`brand-check: ${errors.length} problem(s) in ${what} (${Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(', ')}). ` +
    'Every brand value comes from @myfirstbitcoin/design: see its README, "Brand check".');
  process.exit(1);
}
console.log(`brand-check: ${what} checked against @myfirstbitcoin/design tokens; no problem${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
