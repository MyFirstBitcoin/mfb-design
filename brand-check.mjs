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
//   --error RULES    fail on rules that only warn by default (raw-spacing, text-color, typed-caps,
//                    translucent-text, letter-spacing)
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
// that context (orange, purple or gray-900 text, translucent text, letter spacing, typed capitals,
// raw spacing) only warn unless --error asks.
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
const DEFAULT_WARN = new Set(['raw-spacing', 'text-color', 'typed-caps', 'translucent-text', 'letter-spacing']);
const RULES = {
  'color-literal': 'a hex color (#RGB to #RRGGBBAA, also inside an arbitrary utility) or a color function (rgb, rgba, hsl, hwb, lab, lch, oklab, oklch, color)',
  'named-color': 'a named CSS color (white, teal...) in a color property, a custom property, a style object, a canvas fillStyle, an SVG color attribute or an arbitrary utility (bg-[teal])',
  'off-palette-utility': 'a Tailwind color utility outside the palette and the color roles (bg-teal-500, text-purple-500)',
  gradient: 'a gradient, in CSS or as an SVG linearGradient or radialGradient element (the Brand Book has none; an alpha-only mask and a hard-stop split that blends nothing are allowed)',
  'deprecated-gradient': 'the deprecated brand gradient (--mfb-gradient-brand, --mfb-gradient, .sg-bg-gradient, bg-brand-gradient) or .sg-photo-zone',
  'color-filter': 'a smooth color filter (grayscale, sepia, hue-rotate, saturate) or a blend mode: photos are halftone, never duotone',
  'font-family': 'a font family other than var(--mfb-font-heading|body|sans) (or var(--font-sans|heading|body) from theme.css), in font-family, the font shorthand or a --font-* theme variable, a family name, or the mono or serif family',
  uppercase: 'text-transform: uppercase (textTransform in a style object, quoted or not, in any case), the uppercase class (in a class attribute or a string such as clsx(\'uppercase\')), small caps or small-cap font features',
  weight: 'a font weight above 600',
  angle: 'a skew, a rotation or an angle literal that is not a quarter turn (in CSS, a style object, an animation prop such as rotate: -15, a Tailwind class, an SVG transform, patternTransform or gradientTransform attribute, or the rotate attribute of SVG text), a rotating transform matrix, or slant geometry computed from --sg-angle-*: the slant comes from the supergraphics classes',
  'clip-path': 'a hand-rolled clip-path shape, or an SVG clipPath drawn with a polygon (shapes come from the supergraphics classes)',
  'translucent-shape': 'opacity or a translucent fill on a brand shape (sg-* or the highlighter) or on an orange or purple fill (opacity, fill-opacity or filter: opacity() beside it outside a disabled state, an alpha modifier such as bg-orange-300/50, or a fill or border that mixes orange or purple with transparent), or a highlighter color that is not a palette variable',
  'hand-rolled-highlighter': 'a local highlighter: a gradient band, an orange pseudo-element drawn as a marker (sized in em or %, behind the text, or named like a highlight), an orange mark element, an inset orange box-shadow, a thick orange underline (0.2em or 4px and more), or after:/before: orange utilities. The package\'s .highlighter draws the Brand Book line',
  'token-override': 'a redefinition of a variable the package defines (--mfb-*, the --sg-* geometry); pages set only --sg-aspect and --sg-highlighter-color',
  'raw-value': 'a radius, duration, easing, container, font size, font weight, shadow or semantic spacing literal equal to a token value',
  'raw-spacing': 'a px or rem spacing literal on the spacing scale (warns by default)',
  'text-color': 'orange text, a purple heading, or gray-900 text: the background decides (Color Contrast, 918:2588), and text on light backgrounds is black (918:2990); use a color role (warns by default)',
  'translucent-text': 'translucent text: a text color mixed with transparent, or an alpha modifier such as text-white/85; text takes a solid palette color (warns by default)',
  'letter-spacing': 'letter spacing other than none: a non-zero letter-spacing or letterSpacing, or a tracking-* utility other than tracking-normal and the type levels; no brand text style has tracking (918:2323) (warns by default)',
  'typed-caps': 'two or more words typed in capitals in markup text (warns by default)',
  'built-angle': 'the built CSS has no --sg-angle-base with the token value, or any declaration of --sg-angle-base or --sg-angle-alt (a rule, an @property initial-value, or a style attribute in built HTML) has another value',
  'built-color': 'the built CSS defines a --color-* that is not a palette color or a color role, or not its value',
  'built-uppercase': 'the built CSS sets uppercase or small caps outside a utility class definition (a utility such as .uppercase, alone in its compound selector, is reported where the source uses it)',
  'built-font': 'a font-family declaration in the built CSS uses the mono or serif family, outside a utility class definition and the base styles of code, kbd, samp and pre',
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

// Orange and purple are the brand's fills, and a fill in either is solid. A palette variable or
// utility of either family, or its hex value, names such a fill.
const familyHex = (fams) => Object.entries(palette).filter(([k]) => fams.includes(k.replace(/-\d+$/, ''))).map(([, t]) => String(t.$value).replace(/^#/, '').toLowerCase());
const BRAND_FILL = new RegExp(`var\\(\\s*--(?:mfb-|color-(?:mfb-)?)?(?:orange|purple)-\\d+\\s*\\)|#(?:${familyHex(['orange', 'purple']).join('|')})(?:ff)?(?![0-9a-f])`, 'i');
/** Whether a value draws in orange: a palette orange, an accent or highlighter variable, the word, or an orange hex. */
const isOrange = (v) => {
  if (/--(?:mfb-|color-(?:mfb-)?)?(?:orange-\d+|accent[\w-]*|highlighter[\w-]*)|(?<![\w-])(?:dark)?orange(?![\w-])/i.test(v)) return true;
  return [...v.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?:[0-9a-f]{2}|[0-9a-f])?(?![0-9a-f])/gi)].some((m) => {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 0.35 || max !== r) return false;
    const hue = (60 * (g - b)) / (max - min);
    return hue >= 15 && hue <= 45;
  });
};

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
const LINE_COMMENT_CSS = new Set(['.scss', '.sass', '.less']);
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
  // Line comments: script code, and SCSS, Sass and Less (plain CSS has none; a "//" there is a URL).
  if ((!CSS_EXT.has(ext) || LINE_COMMENT_CSS.has(ext)) && ext !== '.html' && ext !== '.svg') {
    out = out.replace(/(^|[^:"'`\\(])(\/\/[^\n]*)/g, (m, pre, c) => pre + blank(c));
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

/**
 * Whether a gradient blends nowhere: each color starts where the one before it ends, as in a
 * two-color split (purple 50%, white 50%) or a dashed line (line 0 12px, transparent 12px 20px).
 * Such a gradient draws solid areas side by side. A stop placed before the previous one starts
 * where that one ends (CSS moves it there).
 */
function hardStops(body) {
  let stops = splitTop(body);
  if (stops.length && /^(?:to\s|from\s|at\s|in\s|circle|ellipse|closest-|farthest-|-?[\d.]+(?:deg|grad|rad|turn)$)/.test(stops[0])) stops = stops.slice(1);
  if (stops.length < 2) return false;
  const len = (x) => {
    const n = String(x).match(/^(-?\d*\.?\d+)(px|%|em|rem)?$/);
    if (!n || (!n[2] && Number(n[1]) !== 0)) return null;
    return [Number(n[1]), n[2] ?? '0'];
  };
  const parsed = stops.map((s) => { const [color, ...pos] = parts(s); return { color, pos: pos.map(len) }; });
  if (parsed.some((p) => !p.pos.length || p.pos.length > 2 || p.pos.some((x) => !x))) return false;
  for (let i = 0; i + 1 < parsed.length; i++) {
    const a = parsed[i], b = parsed[i + 1];
    if (a.color === b.color) continue;
    const [end, endUnit] = a.pos.at(-1);
    const [start, startUnit] = b.pos[0];
    if (startUnit === '0') continue; // at 0: before or at the previous stop
    if (endUnit !== startUnit && endUnit !== '0') return false;
    if (start > end) return false;
  }
  return true;
}
const rangesOf = (re, t) => [...t.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
const inRanges = (i, ranges) => ranges.some(([a, b]) => i >= a && i < b);
/** Files that hold script code only: no markup text, no typed capitals. */
const SCRIPT_ONLY_EXT = new Set(['.js', '.mjs', '.cjs', '.ts']);
/**
 * Ranges of the text that follows a markup tag, up to the next tag or {expression}: prose. A "<"
 * after a name (Array<string>, a<b) does not open a tag, and neither do <script> and <style>.
 */
const textNodes = (t) => [...t.matchAll(/(?<![\w$.)\]])<\/?(?!script\b|style\b)[A-Za-z][\w.:-]*(?:\s(?:=>|[^<>])*?)?\/?>([^<>{}]*)/g)]
  .map((m) => [m.index + m[0].length - m[1].length, m.index + m[0].length]);
/** Ranges of <style> blocks in markup files, where the text is CSS. */
const styleBlocks = (t) => rangesOf(/<style\b[^>]*>([\s\S]*?)<\/style>/g, t);
/** @font-face blocks: their font-family and font-weight describe a face, they do not use one. */
const fontFaces = (t) => rangesOf(/@font-face\s*\{[^}]*\}/g, t);
/** The index just past the brace that closes the one at t[open], skipping strings; -1 if none. */
function closeBrace(t, open) {
  let depth = 0;
  for (let i = open; i < t.length; i++) {
    const c = t[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < t.length && t[j] !== c && t[j] !== '\n') j += t[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}
/**
 * Inline styles in markup, and style objects in script code: a style={...} or style: {...}
 * value, and an object assigned to a name containing "style" or typed CSSProperties.
 */
function inlineStyles(t) {
  const out = rangesOf(/\bstyle\s*=\s*(?:"[^"]*"|'[^']*')/g, t);
  for (const m of t.matchAll(/\bstyle\s*[=:]\s*\{|\b(?:const|let|var)\s+([\w$]+)\s*(?::\s*([^=\n]+?))?\s*=\s*\{/g)) {
    if (m[1] !== undefined && !/style/i.test(m[1]) && !/CSSProperties/.test(m[2] ?? '')) continue;
    const end = closeBrace(t, m.index + m[0].length - 1);
    if (end !== -1) out.push([m.index, end]);
  }
  return out;
}
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
const ONE_WORD_UTILITY = /^(?:uppercase|grayscale|sepia)$/;
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
    // A one-word utility on its own, as in clsx('uppercase') or class:list={['uppercase', ...]}.
    const oneWord = toks.length === 1 && ONE_WORD_UTILITY.test(toks[0].replace(/^!|!$/g, '').replace(/^(?:[\w-]+:)+/, '')) &&
      !/(?:text-?transform|textTransform)["']?\s*:\s*$/i.test(t.slice(Math.max(0, m.index - 20), m.index));
    if (attr || oneWord || (classy && toks.some((x) => x.includes('-') || x.includes('[')))) out.push([m.index, s]);
  });
  return out;
}

const COLOR_UTIL = '(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|decoration|fill|stroke|shadow|inset-shadow|drop-shadow|from|via|to|placeholder|accent|caret|divide)';
function checkClasses(file, t, ext) {
  for (const [index, list] of classLists(t, ext)) {
    const raw = list.split(/\s+/).filter(Boolean).map((x) => x.replace(/^!|!$/g, ''));
    const toks = raw.map((x) => x.replace(/^(?:[\w-]+:)+/, ''));
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
      if (/^text-(?:mfb-)?gray-900(?:\/[\w.]+)?$/.test(c)) report(file, index, 'text-color', GRAY_900_TEXT, c);
      if (/^text-(?:mfb-)?(?:white|black|(?:gray|purple|orange)-\d+|[a-z]+-on-(?:light|dark|orange))\/(?:\d+|\[[^\]]+\])$/.test(c) && !/\/(?:100|\[(?:1|100%)\])$/.test(c))
        report(file, index, 'translucent-text', 'translucent text (an alpha modifier): text takes a solid palette color, for example text-muted-on-dark instead of text-white/70', c);
      const track = c.match(/^-?tracking-(.+)$/);
      if (track && !/^(?:normal|\[0(?:\.0+)?(?:em|px|rem)?\])$/.test(track[1]) && !(c[0] !== '-' && tokens.letterSpacing?.[track[1]]))
        report(file, index, 'letter-spacing', 'letter spacing: no brand text style has tracking (918:2323); use tracking-normal or a type level such as tracking-h1', c);
      if (c === 'uppercase' || c === 'small-caps') report(file, index, 'uppercase', 'uppercase (Brand Book: Title Case, never all caps)', c);
      if (/^font-(?:mono|serif|\[(?!\d).+\])$/.test(c)) report(file, index, 'font-family', 'font family that is not the brand sans', c);
      const arbWeight = c.match(/^font-\[(\d+)\]$/);
      if (/^font-(?:bold|extrabold|black)$/.test(c) || (arbWeight && Number(arbWeight[1]) > 600)) report(file, index, 'weight', 'weight above 600 (the brand uses 400, 500 and 600)', c);
      if (/^-?skew-[xy]?-?/.test(c) && !/^-?skew-[xy]?-?0$/.test(c)) report(file, index, 'angle', 'skew utility (the slant comes from the supergraphics classes)', c);
      const rot = c.match(/^-?rotate(?:-[xyz])?-(\d+)$/);
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
    // An orange or purple fill is solid: no alpha modifier, and no opacity on the same element
    // (a state such as hover:opacity-90 or disabled:opacity-50 is left alone).
    const brandFill = /^(?:bg|fill)-(?:mfb-)?(?:orange|purple)-\d+/;
    const alpha = raw.find((c) => !c.includes(':') && brandFill.test(c) && /\/(?:\d+|\[[^\]]+\])$/.test(c) && !/\/100$/.test(c));
    const dim = raw.find((c) => /^opacity-(?:\d+|\[[^\]]+\])$/.test(c) && !/^opacity-(?:0|100|\[(?:0|1|100%)\])$/.test(c));
    if (!shape && (alpha || (dim && raw.some((c) => !c.includes(':') && brandFill.test(c)))))
      report(file, index, 'translucent-shape', 'translucent orange or purple fill (the brand fills are solid)', alpha || dim);
    // A highlighter drawn with pseudo-element utilities: an orange after: or before: fill.
    const pseudoFill = raw.find((c) => /^(?:[\w-]+:)*(?:after|before):(?:[\w-]+:)*(?:bg|border-b)-(?:mfb-)?(?:orange-\d+|\[[^\]]*\])/.test(c) && isOrange(c.replace(/^.*:(?=(?:bg|border-b)-)/, '').replace(/^(?:bg|border-b)-(?:mfb-)?/, '--')));
    if (pseudoFill) report(file, index, 'hand-rolled-highlighter', 'local highlighter drawn with after: or before: utilities: use the package\'s .highlighter', pseudoFill);
  }
}

const GRAY_900_TEXT = 'gray-900 text: text on light backgrounds is black (var(--mfb-body-on-light) or text-body-on-light, 918:2990), headings too (heading-on-light)';
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
    // Text between markup tags is prose ("block #840000", "a color (any one)"), not a value.
    text: CSS_EXT.has(ext) || SCRIPT_ONLY_EXT.has(ext) ? [] : textNodes(t).filter(([a]) => !inRanges(a, blocks)),
  };

  // Colors
  // A hex may follow an underscore, as inside an arbitrary utility (shadow-[0_0_0_3px_#f7931a80]).
  each(/(?<![A-Za-z0-9&#/.-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![A-Za-z0-9-])/g, t, (m) => {
    const before = t.slice(t.lastIndexOf('\n', m.index) + 1, m.index);
    if (inRanges(m.index, ctx.text)) return;
    if (/(?:\b(?:href|to|id|for|xlink:href)=\{?["'`]?[^"'`\s]*|\b(?:href|url|link|anchor|hash|id|selector|target|[a-z]+Url|[a-z]+Href|[a-z]+Id|[a-z]+Selector)\s*[:=]\s*["'`][^"'`\s]*|url\(\s*["']?|querySelector(?:All)?\(\s*["'`][^"'`]*|getElementById\(\s*["'`])$/i.test(before)) return;
    // An id selector is followed by more selector and then "{"; a value, even one continued on
    // the next line (box-shadow: ...\n  0 0 0 3px #f7931a80,), ends at ";" or "}".
    const after = t.slice(m.index + m[0].length);
    const stop = after.search(/[{;}]/);
    if (/^\s*[{,.:[>+~]/.test(after.slice(0, 3)) && stop !== -1 && after[stop] === '{') return;
    report(file, m.index, 'color-literal', 'hex color (use var(--mfb-*) or a palette utility)', m[0]);
  });
  // A CSS color function takes no space before its parenthesis, and color() names a color space.
  // A function a script declares (function color(name)) or calls with other arguments is code.
  each(/(?<![\w.-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi, t, (m) => {
    if (inRanges(m.index, ctx.text)) return;
    if (/\bfunction\s+$/.test(t.slice(Math.max(0, m.index - 12), m.index))) return;
    if (/^color\($/i.test(m[0]) && !/^\s*(?:from\b|srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|--)/i.test(t.slice(m.index + m[0].length, m.index + m[0].length + 20))) return;
    report(file, m.index, 'color-literal', 'color function (use var(--mfb-*); a translucent shadow mixes a palette color with color-mix())', t.slice(m.index, m.index + 40));
  });
  // The value is read ahead without consuming it, so a second property on the same line (in a
  // style object, { background: 'orange', color: 'rebeccapurple' }) is read on its own.
  each(new RegExp(`(?<![\\w-])(${COLOR_PROP})["']?\\s*:\\s*(?=([^;}\\n]*))`, 'gi'), t, (m) => {
    const raw = ctx.script(m.index) ? m[2].split(/,\s*["']?[\w$-]+["']?\s*:/)[0] : m[2];
    const value = raw.replace(/[!=]==?\s*(["'`])[^"'`]*\1|(["'`])[^"'`]*\2\s*[!=]==?/g, ' ').toLowerCase().replace(/var\(--[\w-]+/g, ' ');
    const word = (value.match(/[a-z]+/g) ?? []).find((w) => NAMED_COLORS.has(w));
    if (!word) return;
    // In script code a palette word outside a style is usually data, such as a CMS surface name.
    if (ctx.script(m.index) && PALETTE_WORDS.has(word) && !inRanges(m.index, ctx.styles)) return;
    report(file, m.index, 'named-color', `named color "${word}" (use var(--mfb-${word === 'white' || word === 'black' ? word : '<palette>'}))`, m[0] + raw);
  });
  // A custom property, or a canvas fill or stroke, set to a named color.
  each(/(?<![\w-])(--[\w-]+)["']?\s*:\s*["'`]?\s*([a-zA-Z]+)\s*["'`]?\s*(?=[;},\n]|!important)|\b(?:fill|stroke)Style\s*=\s*["'`]([a-zA-Z]+)["'`]/g, t, (m) => {
    const word = (m[2] ?? m[3]).toLowerCase();
    if (NAMED_COLORS.has(word)) report(file, m.index, 'named-color', `named color "${word}" (use var(--mfb-${word === 'white' || word === 'black' ? word : '<palette>'}))`, m[0]);
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
  // A text color (color, or a value assigned to a name such as textColor) that is gray-900, or a
  // color mixed with transparent. Ternaries count: isDark ? 'var(--mfb-white)' : 'var(--mfb-gray-900)'.
  each(/(?<![\w-])(color|[\w$]*[tT]extColor|--[\w-]*text-color)["']?\s*[:=]\s*(?=([^;}\n]*))/g, t, (m) => {
    const raw = ctx.script(m.index) ? m[2].split(/,\s*["']?[\w$-]+["']?\s*:/)[0] : m[2];
    if (/var\(\s*--(?:mfb-|color-(?:mfb-)?)?gray-900\s*\)/.test(raw)) report(file, m.index, 'text-color', GRAY_900_TEXT, m[0] + raw);
    if (/color-mix\([^;]*\btransparent\b/.test(raw)) report(file, m.index, 'translucent-text', 'translucent text (a color mixed with transparent): text takes a solid palette color, for example var(--mfb-muted-on-dark) on dark backgrounds', m[0] + raw);
  });
  // Letter spacing: no brand text style has any. A var() is not read; a non-zero length is.
  each(/(?<![\w-])(letter-spacing|letterSpacing)["']?\s*:\s*(?=([^;}\n]*))/g, t, (m) => {
    if (inRanges(m.index, ctx.faces)) return;
    const script = ctx.script(m.index);
    const raw = script ? m[2].split(/,\s*["']?[\w$-]+["']?\s*:/)[0] : m[2];
    const lengths = [...raw.matchAll(/(?<![\w.-])(-?\d*\.?\d+)(em|px|rem|ch|%)?(?![\w.%-])/g)].filter((x) => x[2] || script);
    if (lengths.some((x) => Number(x[1]) !== 0)) report(file, m.index, 'letter-spacing', 'letter spacing: no brand text style has tracking (918:2323); use var(--mfb-tracking-<level>) or none', m[0] + raw);
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
    // Solid areas side by side (a two-color split, a dashed line) blend nothing. An orange band
    // drawn that way is still reported: it is how a highlighter gets drawn by hand.
    if (hardStops(body) && !isOrange(body)) return;
    report(file, m.index, 'gradient', 'gradient (the Brand Book uses solid palette fills only)', text.split('\n')[0]);
  });
  each(/<(linearGradient|radialGradient)\b/g, t, (m) => {
    const open = t.lastIndexOf('<mask', m.index);
    if (open !== -1 && t.indexOf('</mask>', open) > m.index) return; // an alpha mask
    report(file, m.index, 'gradient', `an SVG ${m[1]} (the Brand Book uses solid palette fills only; a third-party mark goes in the allowlist)`, m[0]);
  });
  // An orange pseudo-element drawn as a marker: sized in em or %, put behind the text, or named
  // like a highlight. An orange bar of a few px (an active tab, say) is not one.
  each(/([^{}]*::?(?:after|before)[^{}]*)\{([^{}]*)\}/g, t, (m) => {
    const fill = m[2].match(/(?<![\w-])(?:background(?:-color)?|border-bottom(?:-color)?)\s*:\s*([^;]*)/);
    if (!fill || !isOrange(fill[1])) return;
    const sel = m[1].split('\n').slice(-3).join(' ');
    if (/(?<![\w-])height\s*:\s*(?:[\d.]+(?:em|%)|calc\([^;]*em\b)/.test(m[2]) || /z-index\s*:\s*-\d/.test(m[2]) || /highlight|marker|(?<![\w-])(?:hl|mark)(?![\w-])/i.test(sel)) {
      report(file, m.index + m[0].indexOf('{'), 'hand-rolled-highlighter', 'local highlighter (an orange pseudo-element drawn as a marker): use the package\'s .highlighter', sel.trim());
    }
  });
  each(/(?<![\w-])(?:box-shadow|boxShadow)["']?\s*:\s*["'`]?\s*inset\s+0\s+(-?[\d.]+)(em|px|rem)(?:\s+-?[\d.]+(?:em|px|rem)?){0,2}\s+([^;\n"'`]*)/g, t, (m) => {
    if ((m[2] === 'em' || px(m[1] + m[2]) >= 6) && isOrange(m[3]))
      report(file, m.index, 'hand-rolled-highlighter', 'local highlighter (an orange inset shadow under the text): use the package\'s .highlighter', m[0]);
  });
  // A thick orange underline, or an orange mark element: a highlighter drawn another way. A thin
  // orange underline (a link's) is not one.
  const thickOrangeUnderline = (text) => {
    const decl = [...text.matchAll(/(?<![\w-])(?:text-decoration(?:-(?:color|thickness))?|textDecoration(?:Color|Thickness)?)["']?\s*:\s*([^;\n]*)/g)].map((d) => d[1]);
    return decl.some((v) => isOrange(v)) &&
      decl.some((v) => [...v.matchAll(/(?<![\w.-])(\d*\.?\d+)(em|px|rem)(?![\w-])/g)].some((x) => (x[2] === 'em' ? Number(x[1]) >= 0.2 : px(x[1] + x[2]) >= 4)));
  };
  each(/([^{}]*)\{([^{}]*)\}/g, t, (m) => {
    if (!CSS_EXT.has(ext) && !inRanges(m.index + m[1].length, blocks)) return;
    const at = m.index + m[1].length;
    const sel = m[1].split('\n').pop().trim();
    if (thickOrangeUnderline(m[2])) report(file, at, 'hand-rolled-highlighter', 'local highlighter (a thick orange underline): use the package\'s .highlighter', sel);
    const fill = m[2].match(/(?<![\w-])background(?:-color)?\s*:\s*([^;]*)/);
    if (fill && isOrange(fill[1]) && /(?:^|[\s,>+~(])mark(?![\w-])/.test(sel)) report(file, at, 'hand-rolled-highlighter', 'local highlighter (an orange mark element): use the package\'s .highlighter', sel);
  });
  for (const [a, b] of ctx.styles) {
    if (thickOrangeUnderline(t.slice(a, b))) report(file, a, 'hand-rolled-highlighter', 'local highlighter (a thick orange underline): use the package\'s .highlighter', t.slice(a, b));
  }
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
  each(/(?<![\w-])(?:transform|patternTransform|gradientTransform)\s*=\s*\{?\s*["'`]([^"'`]*)["'`]/g, t, (m) => {
    for (const r of m[1].matchAll(/rotate\(\s*(-?\d*\.?\d+)/g)) {
      if (Math.abs(Number(r[1]) % 90) > 1e-9) report(file, m.index, 'angle', 'rotation in an SVG transform that is not a quarter turn (the logo and the shapes are never tilted by hand)', r[0]);
    }
  });
  each(/<(?:text|tspan)\b[^>]*?\srotate\s*=\s*\{?\s*["'`]?\s*(-?[\d.]+(?:[\s,]+-?[\d.]+)*)/g, t, (m) => {
    if (m[1].split(/[\s,]+/).map(Number).some((n) => Number.isFinite(n) && Math.abs(n % 90) > 1e-9))
      report(file, m.index, 'angle', 'SVG text with rotated glyphs (a rotate attribute that is not a quarter turn)', m[0].slice(0, 60));
  });
  each(/<clipPath\b[^>]*>([\s\S]*?)<\/clipPath>/g, t, (m) => {
    if (/<poly(?:gon|line)\b/.test(m[1])) report(file, m.index, 'clip-path', 'an SVG clipPath drawn with a polygon (use the supergraphics shape classes; a logo goes in the allowlist)', m[0].split('\n')[0].slice(0, 60));
  });
  // A unitless rotation or skew in script code: an animation or style prop (rotate: -15).
  each(/(?<![\w-])(rotate[XYZ]?|skew[XY]?)["']?\s*:\s*(-?\d*\.?\d+|\[[^\]\n]*\])(?=\s*[,}\n])/g, t, (m) => {
    if (!ctx.script(m.index)) return;
    const turns = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (turns.some((n) => (m[1].startsWith('skew') ? n !== 0 : Math.abs(n % 90) > 1e-9)))
      report(file, m.index, 'angle', 'rotation or skew in a script prop that is not a quarter turn (the slant comes from the supergraphics classes)', m[0]);
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
  // The font shorthand and Tailwind 4's --font-* theme variables set a family too. Each is reported
  // once, so the family names inside it are not reported again below.
  const BRAND_FAMILY = /^(?:var\(--(?:mfb-)?font-(?:heading|body|sans)\)|inherit|initial|unset|revert)$/;
  const familyDecls = [];
  const declEnd = (i) => { const e = t.slice(i).search(/[;}\n]/); return e === -1 ? t.length : i + e; };
  // A family list holds quotes, so in CSS the value runs to the end of the declaration; in script
  // code it is the quoted string.
  const familyValue = (i, script) => (script && /^["'`]/.test(t[i]) ? readValue(t, i, true) : t.slice(i, declEnd(i)).replace(/\s*!important\s*$/, '').trim());
  each(/(?<![\w-])font["']?\s*:\s*/g, t, (m) => {
    if (inRanges(m.index, ctx.faces)) return;
    const v = familyValue(m.index + m[0].length, ctx.script(m.index));
    if (!v) return;
    // The family follows the size and its line height: 500 18px/1.22 "IBM Plex Serif", serif.
    const size = [...v.matchAll(/(?<=^|\s)(?:-?\d*\.?\d+(?:px|rem|em|%|pt|vw|vh|vmin|vmax|ch|ex|lh)|(?:xx?-)?(?:small|large)|medium|smaller|larger|(?:var|calc|clamp|min|max)\((?:[^()]|\([^()]*\))*\))(?:\s*\/\s*[^\s,]+)?(?=\s+\S)/g)].at(-1);
    if (!size) return;
    familyDecls.push([m.index, declEnd(m.index)]);
    const family = v.slice(size.index + size[0].length).trim();
    if (!BRAND_FAMILY.test(family)) report(file, m.index, 'font-family', 'font shorthand whose family is not exactly var(--mfb-font-heading|body|sans)', `font: ${v}`);
  });
  each(/(?<![\w-])(--font-[\w-]+)["']?\s*:\s*/g, t, (m) => {
    if (/^--font-(?:weight|size|feature|variation|stretch|style|optical|smoothing)(?![\w])/.test(m[1]) || m[1].slice(2).includes('--')) return;
    const v = (familyValue(m.index + m[0].length, ctx.script(m.index)) ?? '').trim();
    if (!v) return;
    familyDecls.push([m.index, declEnd(m.index)]);
    if (!BRAND_FAMILY.test(v)) report(file, m.index, 'font-family', `${m[1]} sets a family other than var(--mfb-font-heading|body|sans)`, `${m[1]}: ${v}`);
  });
  each(/(["'])(?:IBM Plex[^"']*|Arial|Helvetica[^"']*|Inter|Roboto|Georgia|Times New Roman|Courier[^"']*|monospace|sans-serif|serif|system-ui)\1/g, t, (m) => {
    if (inRanges(m.index, ctx.faces) || inRanges(m.index, familyDecls)) return;
    if (!FAMILY_CONTEXT.test(t.slice(t.lastIndexOf('\n', m.index - 1) + 1, m.index))) return; // a word in data, not a family
    report(file, m.index, 'font-family', 'font family literal', m[0]);
  });
  each(/(?:text-transform|textTransform)["']?\s*:\s*["'`]?uppercase|small-caps|smallCaps|(?:font-variant-caps|fontVariantCaps)["']?\s*:\s*["'`]?all|(?:font-feature-settings|fontFeatureSettings)["']?\s*:[^;}\n]*["'](?:smcp|c2sc)["']/gi, t, (m) =>
    report(file, m.index, 'uppercase', 'uppercase or small caps (Brand Book: Title Case, never all caps)', m[0]));
  each(/(?:font-weight|fontWeight)\s*:\s*["'`]?\s*(?:[7-9]00|1000|bold|bolder)\b/g, t, (m) => {
    if (!inRanges(m.index, ctx.faces)) report(file, m.index, 'weight', 'weight above 600 (the brand uses 400, 500 and 600)', m[0]);
  });
  if (!CSS_EXT.has(ext) && !SCRIPT_ONLY_EXT.has(ext)) {
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
  // An orange or purple fill is solid: no opacity, fill-opacity or filter: opacity() beside it (0
  // hides, it does not tint; a disabled state may dim it), and no color-mix with transparent in a
  // fill or a border.
  const OPACITY = /(?<![\w-])(?:(opacity|fill-?opacity|fillOpacity)["']?\s*[:=]\s*\{?\s*["'`]?\s*|(filter)["']?\s*:\s*["'`]?[^;\n]*?opacity\(\s*)(\d*\.?\d+)(%?)/gi;
  const FILLS_BRAND = new RegExp(`(?<![\\w-])(?:background(?:-?color)?|fill)["']?\\s*[:=]\\s*\\{?\\s*["'\`]?(?:(?!,\\s*["']?[\\w-]+["']?\\s*:)[^;\\n])*?(?:${BRAND_FILL.source})`, 'i');
  const translucentFill = (text, offset) => {
    if (!FILLS_BRAND.test(text)) return;
    for (const o of text.matchAll(OPACITY)) {
      const v = Number(o[3]) / (o[4] ? 100 : 1);
      if (v > 0 && v < 1) report(file, offset + o.index, 'translucent-shape', 'translucent orange or purple fill (the brand fills are solid)', o[2] ? `filter: opacity(${o[3]}${o[4]})` : `${o[1]}: ${o[3]}${o[4]}`);
    }
  };
  each(/([^{}]*)\{([^{}]*)\}/g, t, (m) => {
    if (/:disabled|\[disabled\]|\[aria-disabled/.test(m[1].split('\n').pop())) return;
    if (CSS_EXT.has(ext) || inRanges(m.index + m[1].length, blocks)) translucentFill(m[2], m.index + m[1].length + 1);
  });
  for (const [a, b] of ctx.styles) translucentFill(t.slice(a, b), a);
  each(/<[a-zA-Z][\w.:-]*\s[^<>]*>/g, t, (m) => translucentFill(m[0], m.index));
  each(new RegExp(`(?<![\\w-])(?:background(?:-?color)?|fill|border(?:-?(?:top|right|bottom|left|block|inline)(?:-?(?:start|end))?)?(?:-?color)?|outline(?:-?color)?)["']?\\s*:\\s*["'\`]?(?:(?!gradient\\()[^;\\n"'\`])*?color-mix\\([^;\\n]*?(?:${BRAND_FILL.source})[^;\\n]*?transparent`, 'gi'), t, (m) =>
    report(file, m.index, 'translucent-shape', 'translucent orange or purple fill or border (the brand colors are solid)', m[0]));
  each(/--sg-highlighter-color["']?\s*:\s*/g, t, (m) => {
    const v = (readValue(t, m.index + m[0].length, ctx.script(m.index)) ?? '').trim();
    const name = v.match(/^var\(--mfb-([\w-]+)\)$/)?.[1];
    if (!name || !(palette[name] || roles[name])) report(file, m.index, 'translucent-shape', 'the highlighter color is a solid palette variable, for example var(--mfb-white)', `--sg-highlighter-color: ${v}`);
  });

  checkClasses(file, t, ext);
  rawValues(file, t, ctx);
}

// ---- built CSS ----
/** Split a selector list at its top-level commas. */
const splitTop = (sel) => {
  const out = [];
  let depth = 0, cur = '';
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
};
/**
 * Every declaration of a style sheet, with the selectors and at-rules it sits in (CSS nesting
 * included), its property, its value and its index. Comments and strings are skipped, and a ";"
 * inside parentheses (a data: URL) does not end a declaration.
 */
function declarations(css) {
  const out = [];
  const stack = [];
  const clean = (x) => x.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  let start = 0, depth = 0;
  const flush = (end) => {
    const text = css.slice(start, end);
    const m = clean(text).match(/^(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:([\s\S]*)$/);
    if (m) out.push({ prop: m[1], value: m[2].trim(), index: start + Math.max(0, text.search(/\S/)), rules: stack.slice() });
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e === -1 ? css.length : e + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === '{') { stack.push(clean(css.slice(start, i))); start = i + 1; }
    else if (depth === 0 && c === ';') { flush(i); start = i + 1; }
    else if (depth === 0 && c === '}') { flush(i); stack.pop(); start = i + 1; }
  }
  flush(css.length); // a style attribute's last declaration has no ";"
  return out;
}
/** The utility a class names, without its variants: md\:hover\:uppercase -> uppercase. */
const utilityOf = (cls) => {
  const name = cls.replace(/\\(.)/g, '$1');
  let depth = 0, cut = 0;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === '[' || name[i] === '(') depth++;
    else if (name[i] === ']' || name[i] === ')') depth--;
    else if (name[i] === ':' && depth === 0) cut = i + 1;
  }
  return name.slice(cut).replace(/^!|!$/g, '');
};
// A utility class definition is not a use: Tailwind 3 emits .uppercase or .font-mono when its
// content scanner sees the word anywhere (a comment, a string), and Tailwind 4 when theme.css
// gives it the font. Whether a page uses the class is checked in the source, where it is written.
const BUILT_UTILITY = /^(?:uppercase|font-mono|font-serif)$/;
// The utility class must stand alone in its compound selector: .group:hover .group-hover\:uppercase
// is a definition, .eyebrow.uppercase is a page's own rule.
const inUtility = (rules) => rules.some((r) => !r.startsWith('@') && splitTop(r).every((part) =>
  [...part.matchAll(/\.((?:\\.|[\w-])+)/g)].some((m) => BUILT_UTILITY.test(utilityOf(m[1])) &&
    !/[\w\\)\]-]/.test(part[m.index - 1] ?? '') && part[m.index + m[0].length] !== '.')));
// Tailwind's base styles set code, kbd, samp and pre in the mono family (Tailwind 4 through
// --default-mono-font-family, which theme.css's --font-mono feeds); that is code, not text.
const inCodeBase = (rules) => rules.some((r) => !r.startsWith('@') && splitTop(r).every((part) => {
  const last = part.replace(/:(?:where|is)\(/g, '').split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
  return /^(?:code|kbd|samp|pre|tt)(?![\w-])/.test(last);
}));
const MONO_SERIF = /var\(\s*--(?:mfb-|tw-|default-)?(?:font-)?(?:mono|serif)|(?<![\w-])(?:ui-)?(?:monospace|serif)(?![\w-])|IBM Plex Mono|Courier|Georgia|Times New Roman/i;

function checkBuilt() {
  const files = distAbs.flatMap((d) => walk(d, [], new Set(['.css', '.html'])));
  const chunks = []; // [file, css, offset in the file, the file's text]
  const inline = []; // style attributes of built HTML
  for (const abs of files) {
    const text = readFileSync(abs, 'utf8');
    if (abs.endsWith('.css')) chunks.push([rel(abs), text, 0, text]);
    else {
      for (const m of text.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/g)) chunks.push([rel(abs), m[2], m.index + m[1].length, text]);
      for (const m of text.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) if (/--sg-angle/.test(m[0])) inline.push([rel(abs), m[1] ?? m[2], m.index, text]);
    }
  }
  if (!chunks.length) {
    findings.push({ file: opt.dist.join(', '), line: null, rule: 'built-missing', why: 'no built CSS found (build first, or pass --source-only)', match: opt.dist.join(', ') });
    return;
  }
  const lineIn = (text, i) => text.slice(0, i).split('\n').length;
  const add = (file, text, i, rule, why, match) => findings.push({ file, line: lineIn(text, i), rule, why, match: String(match).replace(/\s+/g, ' ').trim().slice(0, 100) });

  // Geometry: the base angle is there, and every declaration of either angle has the token value
  // (a rule, a nested rule, an @property initial-value, or a style attribute in built HTML).
  let angleFound = false;
  const angle = (file, text, offset, d) => {
    const prop = d.prop.startsWith('--sg-angle-') ? d.prop : d.prop === 'initial-value' && d.rules.at(-1)?.match(/^@property\s+(--sg-angle-[\w-]+)/)?.[1];
    const which = prop && prop.match(/^--sg-angle-(base|alt)$/)?.[1];
    if (!which) return;
    const want = which === 'base' ? ANGLE : ANGLE_ALT;
    const v = d.value.replace(/\s*!important$/i, '').trim();
    const deg = (x) => {
      const n = String(x).trim().match(/^(-?\d*\.?\d+)(deg|grad|rad|turn)$/i);
      return n ? Number(n[1]) * { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[n[2].toLowerCase()] : null;
    };
    if (v.toLowerCase() === String(want).toLowerCase() || (deg(v) !== null && Math.abs(deg(v) - deg(want)) < 1e-9)) { if (which === 'base') angleFound = true; return; }
    add(file, text, offset + d.index, 'built-angle', `${prop} is set to ${d.value}, the token is ${want}`, `${d.prop}: ${d.value}`);
  };
  for (const [file, value, at, text] of inline) {
    for (const d of declarations(value)) angle(file, text, at, { ...d, index: 0 });
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
  for (const [file, css, offset, text] of chunks) {
    for (const d of declarations(css)) {
      const at = offset + d.index;
      angle(file, text, offset, d);
      const color = d.prop.match(/^--color-([\w-]+)$/);
      if (color) {
        const want = expected(color[1]);
        if (!want) add(file, text, at, 'built-color', `--color-${color[1]} is not a palette color or a color role`, `${d.prop}: ${d.value}`);
        else if (d.value !== want[1] && !(/^#[0-9a-f]{3,8}$/i.test(d.value) && hex(d.value) === hex(want[0])))
          add(file, text, at, 'built-color', `--color-${color[1]} is ${d.value}, the token is ${want[0]}`, `${d.prop}: ${d.value}`);
        continue;
      }
      if (d.rules.some((r) => /^@font-face\b/.test(r))) continue;
      const p = d.prop.toLowerCase();
      const caps = (p === 'text-transform' && /(?<![\w-])uppercase(?![\w-])/i.test(d.value) && 'text-transform: uppercase') ||
        ((p === 'font-variant' || p === 'font-variant-caps' || p === 'font') && /small-caps|petite-caps|unicase|titling-caps/i.test(d.value) && 'small caps') ||
        (p === 'font-feature-settings' && /["'](?:smcp|c2sc|pcap|c2pc)["']/i.test(d.value) && 'small-cap font features');
      if (caps && !inUtility(d.rules)) add(file, text, at, 'built-uppercase', caps, `${d.rules.at(-1) ?? ''}{${d.prop}:${d.value}}`);
      if ((p === 'font-family' || p === 'font') && MONO_SERIF.test(d.value) && !inUtility(d.rules) && !inCodeBase(d.rules))
        add(file, text, at, 'built-font', 'a font-family in the mono or serif family', `${d.rules.at(-1) ?? ''}{${d.prop}:${d.value}}`);
    }
  }
  if (!angleFound) {
    findings.push({ file: opt.dist.join(', '), line: null, rule: 'built-angle', why: `--sg-angle-base is missing or is not ${ANGLE} (import @myfirstbitcoin/design/brand.css or supergraphics.css)`, match: '--sg-angle-base' });
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
