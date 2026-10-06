#!/usr/bin/env node
// Tests brand-check.mjs (the guard this package ships) against a project tree with planted
// violations, a clean tree, an allowlist, --warn and --error. scripts/check.mjs runs it.
//
// Usage: node scripts/brand-check.test.mjs
//
// Every planted line carries one violation and names the rule it must trigger; every clean line
// must trigger nothing. A rule that warns by default (raw-spacing, text-color, typed-caps) is
// reported as a warning on its line. The tree is written to a temporary directory and removed
// afterwards.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(ROOT, 'brand-check.mjs');

// [file, content]. A line ending in "@rule" must be reported with that rule on that line.
const PLANTED = {
  'src/styles/global.css': `
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
`,
  'src/components/Card.tsx': `
export const Card = () => (
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
);
`,
  'src/components/Clean.astro': `---
const href = '#feed';
const EDGE_MASK =
  'linear-gradient(to right, transparent 0, var(--mfb-black) 56px, var(--mfb-black) calc(100% - 56px), transparent 100%)';
const block = { backgroundColor: 'purple', surface: 'white', country: 'Georgia' };
---
<a href="#feed" class="text-heading-on-light decoration-link-underline-on-light underline">Read</a>
<h2 class="text-h2-fluid leading-h2 font-medium text-black">Open Source Education</h2>
<div class="bg-purple-300 text-white p-6 gap-4 rounded-mfb-lg shadow-mfb-media max-w-mfb-page"></div>
<div class="sg-para-frame" style="--sg-aspect: 0.75"></div>
<p class="text-link-on-dark">Bitcoin FAQ and API</p>
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
</style>
`,
  // Built CSS: one off-palette color, one uppercase rule, one mono use and one angle override,
  // next to what a Tailwind build emits on its own (utility definitions its content scanner saw in
  // a comment, and Tailwind 4's --default-mono-font-family), which is not reported.
  'dist/_astro/index.css': ':root{--mfb-purple-400:#2B1C58;--sg-angle-base:13deg;--default-mono-font-family:var(--font-mono)}.x{color:var(--color-purple-300)}' +
    ':root{--color-purple-300:#422c70;--color-heading-on-light:#000;--color-teal-500:oklch(70% .1 180)}.y{text-transform:uppercase}.code{font-family:var(--font-mono)}' +
    '.uppercase{text-transform:uppercase}.font-mono{font-family:var(--font-mono)}@media (min-width:48rem){.md\\:uppercase{text-transform:uppercase}}.extra{--sg-angle-base:calc(var(--sg-angle-alt) / 2.4)}',
};

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

  // 1. Every planted violation is reported on its line, and nothing in the clean file is.
  const r = run([]);
  const got = parse(r.stderr + r.stdout);
  if (r.status !== 1) failures.push(`planted tree: exit ${r.status}, expected 1`);
  for (const e of expected) {
    if (!got.some((g) => g.file === e.file && g.line === e.line && g.rule === e.rule)) failures.push(`missed: ${e.file}:${e.line} [${e.rule}]`);
  }
  for (const g of got.filter((g) => g.file === 'src/components/Clean.astro')) failures.push(`false positive: ${g.file}:${g.line} [${g.rule}]`);
  for (const g of got.filter((g) => g.line !== null && g.file !== 'src/components/Clean.astro')) {
    if (!expected.some((e) => e.file === g.file && e.line === g.line)) failures.push(`unexpected: ${g.file}:${g.line} [${g.rule}]`);
  }
  // Built CSS: exactly one finding per planted rule; utility definitions and Tailwind's own
  // --default-mono-font-family are not reported.
  for (const rule of ['built-color', 'built-uppercase', 'built-font', 'built-angle']) {
    const n = got.filter((g) => g.rule === rule).length;
    if (n !== 1) failures.push(`built CSS: [${rule}] reported ${n} times, expected once`);
  }

  // 2. A missing angle is reported.
  fs.writeFileSync(path.join(tmp, 'dist/_astro/index.css'), ':root{--sg-angle-base:10deg}');
  if (!parse(run(['--src', 'src/components/Clean.astro']).stderr).some((g) => g.rule === 'built-angle')) failures.push('missed: built CSS with a 10deg angle [built-angle]');
  fs.writeFileSync(path.join(tmp, 'dist/_astro/index.css'), ':root{--sg-angle-base:13deg}');

  // 3. The clean file alone passes.
  const clean = run(['--src', 'src/components/Clean.astro']);
  if (clean.status !== 0) failures.push(`clean file: exit ${clean.status}, expected 0: ${clean.stderr.trim()}`);

  // 4. An allowlist entry silences its findings; an unused entry is reported; a reason is required.
  fs.writeFileSync(path.join(tmp, 'brand-check.allow.json'), JSON.stringify([
    { file: 'src/components/Card.tsx', reason: 'test: a third-party component' },
    { file: 'src/styles/global.css', rule: 'color-literal', match: '422C70', reason: 'test' },
    { file: 'src/none.css', reason: 'test: unused' },
  ]));
  const a = run([]);
  const ga = parse(a.stderr);
  if (ga.some((g) => g.file === 'src/components/Card.tsx')) failures.push('allowlist: a whole-file entry did not silence the file');
  if (ga.some((g) => g.file === 'src/styles/global.css' && g.line === 3)) failures.push('allowlist: a rule and match entry did not silence its finding');
  if (!ga.some((g) => g.file === 'src/styles/global.css' && g.line === 4)) failures.push('allowlist: a rule and match entry silenced another finding');
  if (!/allowlist entry 3 .*matched nothing/.test(a.stderr)) failures.push('allowlist: an unused entry was not reported');
  fs.writeFileSync(path.join(tmp, 'brand-check.allow.json'), JSON.stringify([{ file: 'src/x.css' }]));
  if (run([]).status !== 2) failures.push('allowlist: an entry without a reason was accepted');
  fs.rmSync(path.join(tmp, 'brand-check.allow.json'));

  // 5. --warn reports a rule without failing; the default warnings fail only under --error.
  const w = run(['--src', 'src/components', '--warn', 'off-palette-utility,uppercase,font-family,weight,angle,raw-value,translucent-shape,gradient,named-color,color-filter']);
  if (w.status !== 0) failures.push(`--warn: exit ${w.status}, expected 0: ${w.stderr.split('\n').filter((l) => !l.includes('warning')).join(' ')}`);
  fs.mkdirSync(path.join(tmp, 'src2'));
  fs.writeFileSync(path.join(tmp, 'src2/a.css'), '.x { padding: 24px; }\n');
  const dw = run(['--src', 'src2', '--source-only']);
  if (dw.status !== 0 || !/warning: src2\/a\.css:1: \[raw-spacing\]/.test(dw.stderr)) failures.push(`default warning: exit ${dw.status}, expected 0 with a raw-spacing warning`);
  if (run(['--src', 'src2', '--source-only', '--error', 'raw-spacing']).status !== 1) failures.push('--error raw-spacing did not fail');

  // 6. No built CSS, and --source-only.
  fs.rmSync(path.join(tmp, 'dist'), { recursive: true });
  if (!parse(run(['--src', 'src/components/Clean.astro']).stderr).some((g) => g.rule === 'built-missing')) failures.push('missed: no built CSS [built-missing]');
  if (run(['--src', 'src/components/Clean.astro', '--source-only']).status !== 0) failures.push('--source-only still read the build');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error('brand-check test: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`brand-check test: OK (${Object.keys(PLANTED).length} planted files, every rule, the allowlist, --warn, --error, --source-only)`);
