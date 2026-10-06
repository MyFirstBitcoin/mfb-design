#!/usr/bin/env node
// Tests brand-check.mjs (the guard this package ships) against a project tree with planted
// violations, clean controls, an allowlist, --warn and --error. scripts/check.mjs runs it.
//
// Usage: node scripts/brand-check.test.mjs
//
// Every planted line carries one violation and names the rule it must trigger, in the source and
// in the built CSS alike; every line of a clean file must trigger nothing. The clean files include
// what a correct Tailwind 3 and Tailwind 4 build emits on its own (utility definitions for words
// the content scanner saw in a comment, the base styles of code elements, theme.css's --font-mono),
// which must not be reported. A rule that warns by default (raw-spacing, text-color, typed-caps,
// translucent-text, letter-spacing) is reported as a warning on its line. The tree is written to a
// temporary directory and removed afterwards.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(ROOT, 'brand-check.mjs');

// [file, content]. A line ending in "@rule" must be reported with that rule on that line.
const PLANTED = {
  'src/styles/site.css': `
:root { --mfb-local: 1; }
.a { color: #422C70; }                                      @color-literal
.b { background: rgba(0, 0, 0, 0.5); }                      @color-literal
.c { color: teal; }                                         @named-color
.d { background: linear-gradient(90deg, var(--mfb-purple-300), var(--mfb-purple-200)); } @gradient
.e { background: var(--mfb-gradient-brand); }               @deprecated-gradient
.f { filter: grayscale(1); }                                @color-filter
.g { font-family: 'IBM Plex Mono', monospace; }             @font-family
.h { text-transform: uppercase; }                           @uppercase
.i { font-weight: 700; }                                    @weight
.j { transform: skewX(-10deg); }                            @angle
.k { clip-path: polygon(8% 0, 100% 0, 92% 100%, 0 100%); }  @clip-path
.sg-para.faded { opacity: 0.5; }                            @translucent-shape
.l { padding: 24px; }                                       @raw-spacing
.m { border-radius: 12px; }                                 @raw-value
.n { transition: opacity 180ms ease; }                      @raw-value
.o { transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); } @raw-value
.p { max-width: 1280px; }                                   @raw-value
.q { font-size: 18px; }                                     @raw-value
.r { font-weight: 500; }                                    @raw-value
.s { padding: clamp(64px, 9vw, 128px) 0; }                  @raw-value
.t { box-shadow: 0 20px 60px -20px color-mix(in srgb, var(--mfb-purple-400) 25%, transparent); } @raw-value
.u { transform: rotate(13deg); }                            @angle
:root { --sg-angle-base: calc(var(--sg-angle-alt) / 2.4); }  @token-override
:root { --mfb-font-body: Inter, Arial, sans-serif; }        @token-override
.hl::after { height: .34em; background: var(--mfb-orange-300); } @hand-rolled-highlighter
.highlighter { background: linear-gradient(transparent 80%, var(--mfb-orange-300) 80%); } @hand-rolled-highlighter
.photo { mix-blend-mode: multiply; }                        @color-filter
.sc { font-feature-settings: "c2sc", "smcp"; }              @uppercase
.v { --sg-highlighter-color: color-mix(in srgb, var(--mfb-orange-300) 40%, transparent); } @translucent-shape
.room { padding-left: calc(tan(var(--sg-angle-base)) * var(--sg-base-h) / 2); } @angle
.link { color: var(--mfb-orange-300); }                     @text-color
h2 { color: var(--mfb-purple-300); }                        @text-color
.ring { box-shadow:
  0 0 0 3px #F7931A80,                                      @color-literal
  0 1px 2px var(--mfb-black); }
:root { --surface: white; }                                 @named-color
.hl2::after { content: ""; position: absolute; bottom: 0; height: 40%; z-index: -1; background: var(--mfb-orange-300); } @hand-rolled-highlighter
.under { box-shadow: inset 0 -0.35em 0 var(--mfb-orange-300); } @hand-rolled-highlighter
.tag { background: var(--mfb-purple-300); opacity: .8; }    @translucent-shape
.chip { background: color-mix(in srgb, var(--mfb-orange-300) 40%, transparent); } @translucent-shape
.tilt { transform: skewY(-3deg); }                          @angle
.up2 { text-transform: UPPERCASE; }                         @uppercase
.fs { font: 500 18px/1.22 "IBM Plex Serif", serif; }        @font-family
.fs2 { font: italic 20px Georgia, serif; }                  @font-family
@theme { --font-display: Georgia, serif; }                  @font-family
.under2 { box-shadow: inset 0 -10px var(--mfb-orange-300); } @hand-rolled-highlighter
.thick { text-decoration: underline var(--mfb-orange-300); text-decoration-thickness: 0.4em; } @hand-rolled-highlighter
mark { background: var(--mfb-orange-300); }                 @hand-rolled-highlighter
.dim { background: var(--mfb-purple-300); filter: opacity(80%); } @translucent-shape
.edge { border-color: color-mix(in srgb, var(--mfb-orange-300) 50%, transparent); } @translucent-shape
.body { color: var(--mfb-gray-900); }                       @text-color
.eyebrow { letter-spacing: 0.12em; }                        @letter-spacing
.faint { color: color-mix(in srgb, var(--mfb-white) 85%, transparent); } @translucent-text
`,
  'src/ui/Card.tsx': `
const panel: React.CSSProperties = { background: 'orange', padding: 0 }; @named-color
const tile = { backgroundColor: 'purple', color: 'rebeccapurple' }; @named-color
const tone = { textColor: open ? 'var(--mfb-white)' : 'var(--mfb-gray-900)' }; @text-color
export const Card = ({ open }) => (
  <div className="bg-teal-500 p-6">x</div>                  @off-palette-utility
  <div className="text-purple-500">x</div>                  @off-palette-utility
  <h2 className="uppercase text-h2">x</h2>                  @uppercase
  <p className="font-mono">x</p>                            @font-family
  <b className="font-bold">x</b>                            @weight
  <div className="-skew-x-12">x</div>                       @angle
  <div className="rounded-[12px]">x</div>                   @raw-value
  <div className="p-[24px]">x</div>                         @raw-spacing
  <div className="sg-para opacity-50">x</div>               @translucent-shape
  <div className="bg-gradient-to-r">x</div>                 @gradient
  <div style={{ padding: 24, color: 'var(--mfb-black)' }}>x</div> @raw-spacing
  <div style={{ borderRadius: '8px' }}>x</div>              @raw-value
  <div style={{ textTransform: 'uppercase' }}>x</div>       @uppercase
  <div style={{ backgroundColor: 'white' }}>x</div>         @named-color
  <svg><path fill="red" /></svg>                            @named-color
  <div className="bg-[teal]">x</div>                        @named-color
  <div className="sg-para opacity-[.85]">x</div>            @translucent-shape
  <div className="sg-para" style={{ opacity: 0.6 }}>x</div> @translucent-shape
  <h2 className="text-purple-300">x</h2>                    @text-color
  <p className="text-orange-300">x</p>                      @text-color
  <b className="font-[700]">x</b>                           @weight
  <div className="mix-blend-multiply">x</div>               @color-filter
  <svg><g transform="rotate(-15.5 60 32)" /></svg>          @angle
  <h3>UPCOMING EVENTS</h3>                                  @typed-caps
  <svg><pattern patternTransform="rotate(30)" /></svg>      @angle
  <svg><g transform="skewX(-10)" /></svg>                   @angle
  <div style={{ fontFamily: "Georgia" }}>x</div>            @font-family
  <div style={{ background: "linear-gradient(var(--mfb-orange-300), var(--mfb-purple-300))" }}>x</div> @gradient
  <div style={{ background: 'var(--mfb-orange-300)', opacity: 0.6 }}>x</div> @translucent-shape
  <div className="bg-orange-300 opacity-60">x</div>         @translucent-shape
  <div className="bg-purple-300/80">x</div>                 @translucent-shape
  <svg><rect fill="var(--mfb-purple-300)" fillOpacity={0.5} /></svg> @translucent-shape
  <div style={{ transform: 'rotate(-4.5deg)' }}>x</div>     @angle
  <div style={{ transform: open ? 'skewY(-3deg)' : 'none' }}>x</div> @angle
  <motion.div animate={{ rotate: -15 }}>x</motion.div>      @angle
  <div className="rotate-x-12">x</div>                      @angle
  <div className="shadow-[0_0_0_3px_#F7931A80]">x</div>     @color-literal
  <div style={{ color: '#F7931ACC' }}>x</div>               @color-literal
  <span className="after:absolute after:h-[0.3em] after:bg-orange-300">x</span> @hand-rolled-highlighter
  <div style={{ "textTransform": "uppercase" }}>x</div>    @uppercase
  <div className={clsx('uppercase', open && 'ring')}>x</div> @uppercase
  <div className={open ? 'uppercase' : ''}>x</div>          @uppercase
  <svg><text x="0" y="10" rotate="13">A</text></svg>        @angle
  <svg><defs><linearGradient id="lg" /></defs></svg>        @gradient
  <svg><clipPath id="c"><polygon points="0,0 10,0 8,10 0,10" /></clipPath></svg> @clip-path
  <p className="text-gray-900">x</p>                        @text-color
  <p className="text-white/85">x</p>                        @translucent-text
  <p className="tracking-wide">x</p>                        @letter-spacing
  <div style={{ letterSpacing: '0.12em' }}>x</div>          @letter-spacing
);
`,
  'src/assets/tilted.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 64">
  <g transform="rotate(-15.5 60 32)"><path d="M0 0h10v10z" /></g> @angle
  <g transform="skewX(-10)"><path d="M0 0h10v10z" /></g>   @angle
  <linearGradient id="g" gradientTransform="rotate(15)" />  @angle
  <rect fill="orange" width="10" height="10" />             @named-color
  <rect fill="#F7931ACC" width="10" height="10" />          @color-literal
  <rect fill="var(--mfb-orange-300)" opacity="0.5" width="10" height="10" /> @translucent-shape
</svg>
`,
  'src/ui/Caps.astro': `---
const on = true;
---
<p class:list={['uppercase', { on }]}>x</p>                  @uppercase
`,
  'src/ui/Clean.astro': `---
const href = '#feed';
const EDGE_MASK =
  'linear-gradient(to right, transparent 0, var(--mfb-black) 56px, var(--mfb-black) calc(100% - 56px), transparent 100%)';
const block = { backgroundColor: 'purple', surface: 'white', country: 'Georgia' };
const spin = { rotate: 180, skewX: 0 };
const id = '#feed';
function color(name) { return name; }
---
<button class="bg-orange-300 text-black hover:opacity-90 disabled:opacity-50">Join</button>
<svg><rect fill="var(--mfb-orange-300)" opacity="1" /></svg>
<a href="#feed" class="text-heading-on-light decoration-link-underline-on-light underline">Read</a>
<h2 class="text-h2-fluid leading-h2 font-medium text-black">Open Source Education</h2>
<div class="bg-purple-300 text-white p-6 gap-4 rounded-mfb-lg shadow-mfb-media max-w-mfb-page"></div>
<div class="sg-para-frame" style="--sg-aspect: 0.75"></div>
<p class="text-link-on-dark">Bitcoin FAQ and API</p>
<p>Block #840000 was mined during Cohort #100; pick a color (any one) at the lab (in Prague).</p>
<p class="tracking-normal tracking-h1 text-white/100 text-body-on-light">x</p>
<svg><sodipodi:namedview pagecolor="#ffffff" bordercolor="#666666" /><g transform="matrix(2.6916761,0,0,1.4510755,-10,20)"><path fill="currentColor" /></g></svg>
<style>
  .card { padding: var(--mfb-space-6); border-radius: var(--mfb-radius-lg); color: var(--mfb-body-on-light); }
  .card { transition: transform var(--mfb-duration-fast) var(--mfb-ease-out); font-family: var(--mfb-font-body); }
  .card { box-shadow: var(--mfb-shadow-media); max-width: var(--mfb-container-measure); font-weight: var(--mfb-weight-medium); }
  .fade { mask-image: linear-gradient(to right, transparent, var(--mfb-black) 10%); }
  .sr-only { clip-path: inset(50%); }
  .spin { transform: rotate(90deg); }
  .open { transform: skewX(0deg); font-family: var(--font-sans); }
  .on-orange { --sg-highlighter-color: var(--mfb-white); }
  @font-face { font-family: 'IBM Plex Sans'; font-weight: 500; src: url(/fonts/plex.woff2); }
  /* a comment may say #ff0000, uppercase and 10deg */
  #feed { margin: 0 auto; padding: 0; }
  a:hover,
  #top { color: var(--mfb-black); }
  .nav a.active::after { content: ""; height: 3px; background: var(--mfb-orange-300); }
  .menu { background: var(--mfb-purple-400); opacity: 0; }
  .btn:disabled { background: var(--mfb-purple-300); opacity: .5; }
  .split { background: linear-gradient(to bottom, var(--mfb-purple-300) 50%, var(--mfb-white) 50%); }
  .dash { background: repeating-linear-gradient(90deg, var(--mfb-gray-400) 0 12px, transparent 12px 20px); }
  .short { font: 500 var(--mfb-size-body)/1.2 var(--mfb-font-body); letter-spacing: 0; }
  .link { text-decoration-color: var(--mfb-orange-300); text-decoration-thickness: 2px; }
  .fade-btn { background: var(--mfb-orange-300); transition: opacity var(--mfb-duration-fast); }
  .track { letter-spacing: var(--mfb-tracking-h1); }
  :root { --font-sans: var(--mfb-font-sans); --font-weight-medium: 500; }
</style>
`,
  'src/styles/legacy.scss': `.x {
  // legacy value was #fff
  color: var(--mfb-black);
}
`,
  // Built CSS that drifts: every declaration of either angle is checked, wherever it sits.
  'dist/_astro/drift.css': `
.page { --sg-angle-base: 10deg; }                          @built-angle
@property --sg-angle-alt { syntax: "<angle>"; inherits: true; initial-value: 20deg; } @built-angle
.extra{--sg-angle-base:calc(var(--sg-angle-alt) / 2.4)}    @built-angle
:root { --color-purple-300: #422c70; --color-teal-500: oklch(70% .1 180); } @built-color
.y { text-transform: uppercase; }                          @built-uppercase
.btn { @media (width >= 48rem) { font-variant-caps: all-small-caps; } } @built-uppercase
.code { font-family: var(--font-mono); }                   @built-font
.quote { font: italic 1rem/1.2 Georgia, serif; }           @built-font
.eyebrow.uppercase { text-transform: uppercase; }          @built-uppercase
`,
  'dist/index.html': `<!doctype html>
<html><head><style>.z{--sg-angle-alt:30deg}</style></head> @built-angle
<body><div class="sg-para" style="--sg-angle-base: 10deg"></div></body></html> @built-angle
`,
  // Clean controls: what a correct Tailwind 4 build emits (theme.css's --font-mono, the base
  // styles' --default-mono-font-family, utility definitions, nested variants) ...
  'dist/_astro/tw4.css': `@layer theme {
  :root, :host {
    --font-sans: "IBM Plex Sans", Arial, sans-serif;
    --font-mono: "IBM Plex Mono", monospace;
    --color-purple-300: #422C70;
    --color-heading-on-light: #000;
    --default-font-family: var(--font-sans);
    --default-mono-font-family: var(--font-mono);
  }
}
@layer base {
  html, :host { font-family: var(--default-font-family, ui-sans-serif, system-ui, sans-serif); }
  code, kbd, samp, pre {
    font-family: var(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
    font-feature-settings: var(--default-mono-font-feature-settings, normal);
  }
}
@layer utilities {
  .font-mono { font-family: var(--font-mono); }
  .uppercase { text-transform: uppercase; }
  .uppercase\\! { text-transform: uppercase !important; }
  .md\\:uppercase { @media (width >= 48rem) { text-transform: uppercase; } }
  .group-hover\\:uppercase { &:is(:where(.group):hover *) { @media (hover: hover) { text-transform: uppercase; } } }
}
:root { --mfb-font-mono: "IBM Plex Mono", monospace; --sg-angle-base: 13deg; --sg-angle-alt: 24deg; }
@property --sg-angle-base { syntax: "<angle>"; inherits: true; initial-value: 13deg; }
@property --sg-angle-alt { syntax: "<angle>"; inherits: true; initial-value: 24.0deg; }
`,
  // ... and a minified Tailwind 3 build, where the word "uppercase" in a comment is enough for
  // the scanner to emit .uppercase and its variants, and the preset's mono reaches code elements.
  'dist/_astro/tw3.css': '@font-face{font-family:"IBM Plex Mono";font-weight:400;src:url(data:font/woff2;base64,d09GMgAB) format("woff2")}' +
    'code,kbd,samp,pre{font-family:"IBM Plex Mono",monospace;font-feature-settings:normal;font-size:1em}' +
    '.\\!uppercase{text-transform:uppercase!important}.uppercase{text-transform:uppercase}.font-mono{font-family:"IBM Plex Mono",monospace}' +
    '@media (min-width:768px){.md\\:uppercase{text-transform:uppercase}}.\\[\\&\\>\\*\\]\\:uppercase>*{text-transform:uppercase}' +
    '.group:hover .group-hover\\:uppercase{text-transform:uppercase}\n',
};

// Files that must not be reported at all.
const CLEAN = new Set(['src/ui/Clean.astro', 'src/styles/legacy.scss', 'dist/_astro/tw4.css', 'dist/_astro/tw3.css']);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-check-test-'));
const failures = [];
const run = (args, cwd = tmp) => spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: 'utf8' });
const parse = (out) =>
  out.split('\n').map((l) => l.match(/^brand-check: (?:warning: )?([^:\s][^:]*?)(?::(\d+))?: \[([\w-]+)\]/)).filter(Boolean)
    .map((m) => ({ file: m[1], line: m[2] ? Number(m[2]) : null, rule: m[3] }));

try {
  const expected = [];
  for (const [file, text] of Object.entries(PLANTED)) {
    const lines = text.split('\n');
    const clean = lines.map((l, i) => {
      const m = l.match(/\s+@([\w-]+)$/);
      if (m) expected.push({ file, line: i + 1, rule: m[1] });
      return m ? l.slice(0, m.index) : l;
    });
    fs.mkdirSync(path.join(tmp, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(tmp, file), clean.join('\n'));
  }

  // 1. Every planted violation is reported on its line, and nothing in a clean file is.
  const r = run([]);
  const got = parse(r.stderr + r.stdout);
  if (r.status !== 1) failures.push(`planted tree: exit ${r.status}, expected 1`);
  for (const e of expected) {
    if (!got.some((g) => g.file === e.file && g.line === e.line && g.rule === e.rule)) failures.push(`missed: ${e.file}:${e.line} [${e.rule}]`);
  }
  for (const g of got) {
    if (CLEAN.has(g.file)) failures.push(`false positive: ${g.file}:${g.line} [${g.rule}]`);
    else if (g.line === null || !expected.some((e) => e.file === g.file && e.line === g.line)) failures.push(`unexpected: ${g.file}:${g.line} [${g.rule}]`);
  }

  // 2. The clean files alone pass: the clean source, and the Tailwind 3 and 4 builds.
  fs.rmSync(path.join(tmp, 'dist/_astro/drift.css'));
  fs.rmSync(path.join(tmp, 'dist/index.html'));
  const clean = run(['--src', 'src/ui/Clean.astro']);
  if (clean.status !== 0) failures.push(`clean files: exit ${clean.status}, expected 0: ${clean.stderr.trim()}`);

  // 3. A build without the angle is reported.
  const tw4 = path.join(tmp, 'dist/_astro/tw4.css');
  const tw4Text = fs.readFileSync(tw4, 'utf8');
  fs.writeFileSync(tw4, tw4Text.replace(/--sg-angle-base: 13deg;|@property --sg-angle-base[^}]*\}/g, ''));
  if (!parse(run(['--src', 'src/ui/Clean.astro']).stderr).some((g) => g.rule === 'built-angle' && g.line === null)) failures.push('missed: built CSS without --sg-angle-base [built-angle]');
  fs.writeFileSync(tw4, tw4Text);

  // 4. An allowlist entry silences its findings; an unused entry is reported; a reason is required.
  fs.writeFileSync(path.join(tmp, 'brand-check.allow.json'), JSON.stringify([
    { file: 'src/ui/Card.tsx', reason: 'test: a third-party component' },
    { file: 'src/styles/site.css', rule: 'color-literal', match: '422C70', reason: 'test' },
    { file: 'src/none.css', reason: 'test: unused' },
  ]));
  const a = run([]);
  const ga = parse(a.stderr);
  if (ga.some((g) => g.file === 'src/ui/Card.tsx')) failures.push('allowlist: a whole-file entry did not silence the file');
  if (ga.some((g) => g.file === 'src/styles/site.css' && g.line === 3)) failures.push('allowlist: a rule and match entry did not silence its finding');
  if (!ga.some((g) => g.file === 'src/styles/site.css' && g.line === 4)) failures.push('allowlist: a rule and match entry silenced another finding');
  if (!/allowlist entry 3 .*matched nothing/.test(a.stderr)) failures.push('allowlist: an unused entry was not reported');
  fs.writeFileSync(path.join(tmp, 'brand-check.allow.json'), JSON.stringify([{ file: 'src/x.css' }]));
  if (run([]).status !== 2) failures.push('allowlist: an entry without a reason was accepted');
  fs.rmSync(path.join(tmp, 'brand-check.allow.json'));

  // 5. --warn reports a rule without failing; the default warnings fail only under --error.
  const w = run(['--src', 'src/ui', '--warn', 'off-palette-utility,uppercase,font-family,weight,angle,raw-value,translucent-shape,gradient,named-color,color-filter,color-literal,hand-rolled-highlighter,clip-path']);
  if (w.status !== 0) failures.push(`--warn: exit ${w.status}, expected 0: ${w.stderr.split('\n').filter((l) => !l.includes('warning')).join(' ')}`);
  fs.mkdirSync(path.join(tmp, 'src2'));
  fs.writeFileSync(path.join(tmp, 'src2/a.css'), '.x { padding: 24px; }\n.y { letter-spacing: 0.1em; }\n');
  const dw = run(['--src', 'src2', '--source-only']);
  if (dw.status !== 0 || !/warning: src2\/a\.css:1: \[raw-spacing\]/.test(dw.stderr) || !/warning: src2\/a\.css:2: \[letter-spacing\]/.test(dw.stderr))
    failures.push(`default warning: exit ${dw.status}, expected 0 with a raw-spacing and a letter-spacing warning`);
  if (run(['--src', 'src2', '--source-only', '--error', 'raw-spacing']).status !== 1) failures.push('--error raw-spacing did not fail');
  if (run(['--src', 'src2', '--source-only', '--error', 'letter-spacing']).status !== 1) failures.push('--error letter-spacing did not fail');

  // 6. No built CSS, and --source-only.
  fs.rmSync(path.join(tmp, 'dist'), { recursive: true });
  if (!parse(run(['--src', 'src/ui/Clean.astro']).stderr).some((g) => g.rule === 'built-missing')) failures.push('missed: no built CSS [built-missing]');
  if (run(['--src', 'src/ui/Clean.astro', '--source-only']).status !== 0) failures.push('--source-only still read the build');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error('brand-check test: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`brand-check test: OK (${Object.keys(PLANTED).length} files, ${CLEAN.size} of them clean controls, every rule, the allowlist, --warn, --error, --source-only)`);
