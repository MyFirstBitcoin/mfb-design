#!/usr/bin/env node
// Generates brand-spec.md, the written brand specification, from tokens.json and the prose in
// src/brand-spec.template.md.
//
// Usage: node scripts/brand-spec.mjs [OUT_DIR]
//   OUT_DIR defaults to the repository root. scripts/check.mjs passes a temporary directory.
//
// Values are READ from tokens.json; only the prose around them is written by hand, in the
// template. Rules cannot be generated and should not be; values must be, so the spec can never
// disagree with the tokens it says it comes from.
//
// brand-spec.md is committed and public, and it is in package.json's `files` (and exports, as
// ./brand-spec.md), so consumers install it with the package and read the rules at the version
// they pin.
//
// It refuses to write when:
//   - a token the prose depends on is absent (a blank where a brand value belongs);
//   - the template names a placeholder this script does not fill, or leaves one unfilled;
//   - the result contains an em-dash, a machine path or a date stamp (the public file carries none).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(process.argv[2] || ROOT);
const TEMPLATE = path.join(ROOT, 'src', 'brand-spec.template.md');
const FIGMA_FILE = 'mFIc75UUSyftaqnNUQgjLX'; // My First Bitcoin_Full Brand Assets (the Brand Book)

const EM_DASH = String.fromCharCode(0x2014);
const DEGREE = String.fromCharCode(0xb0);

const fail = (msg, details = []) => {
  console.error(`REFUSING TO WRITE brand-spec.md: ${msg}`);
  for (const d of details) console.error(`  - ${d}`);
  process.exit(1);
};

const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens.json'), 'utf8'));
const template = fs.readFileSync(TEMPLATE, 'utf8');

// ---- text helpers ----
// Token descriptions in tokens.json use an em-dash as a separator (for example between
// "Primary purple" and "brand hero color"). tokens.json is published as it is, so the spec
// rewrites each one as a colon.
const clean = (s) => String(s ?? '').replace(new RegExp(`\\s*${EM_DASH}\\s*`, 'g'), ': ').trim();
const cell = (s) => clean(s).replace(/\|/g, '\\|');
// "$status": "DEPRECATED 2026-07-14: text" is rendered as "**Deprecated:** text". The date is
// history (it stays in tokens.json); the public spec carries no date stamps.
const status = (tok) => {
  if (!tok.$status) return '';
  const m = String(tok.$status).match(/^([A-Za-z]+)(?:\s+\d{4}-\d{2}-\d{2})?\s*:\s*(.*)$/s);
  const label = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Status';
  return `**${label}:** ${clean(m ? m[2] : tok.$status)}`;
};

// ---- required values ----
const missing = [];
const need = (group, name) => {
  const tok = (tokens[group] || {})[name];
  const v = tok ? tok.$value : undefined;
  if (v === undefined || v === null || String(v).trim() === '') {
    missing.push(`${group}.${name}`);
    return '';
  }
  return String(v);
};
const groupEntries = (group, required) => {
  const entries = Object.entries(tokens[group] || {});
  if (required && entries.length === 0) missing.push(`${group} (the whole group)`);
  return entries;
};

const values = {
  FIGMA_FILE,
  ANGLE: need('geometry', 'angle-base').replace('deg', DEGREE),
  BASE_RATIO: need('geometry', 'base-h-ratio'),
  HALFTONE_HI: need('geometry', 'halftone-highlight'),
  HALFTONE_HI_FULL: need('geometry', 'halftone-highlight-full'),
  HALFTONE_LO: need('geometry', 'halftone-shadow'),
  HL_COVERAGE: need('geometry', 'highlighter-coverage'),
  HL_ASPECT: need('geometry', 'highlighter-aspect'),
  HL_OFFSET: need('geometry', 'highlighter-offset'),
  HL_SHAPE: need('geometry', 'highlighter-shape'),
  ORANGE: need('color', 'orange-300'),
  GRAY900: need('color', 'gray-900'),
};

values.COLOR_ROWS = groupEntries('color', true)
  .map(([name, tok]) => `| ${name} | ${tok.$value} | ${cell(tok.$description)} |`)
  .join('\n');

const gradients = groupEntries('gradient', false);
values.GRADIENT_ITEMS = gradients.length
  ? gradients
      .map(([name, tok]) => {
        const st = status(tok);
        return `- **${name}** (\`${tok.$value}\`): ${clean(tok.$description)}${st ? `. ${st}` : ''}`;
      })
      .join('\n')
  : 'No gradient tokens.';

values.FONT_FAMILY_ROWS = groupEntries('fontFamily', true)
  .map(([name, tok]) => {
    const family = Array.isArray(tok.$value) ? tok.$value.join(', ') : tok.$value;
    const st = status(tok);
    return `| ${name} | ${family} | ${cell(tok.$description)}${st ? `. ${st.replace(/\|/g, '\\|')}` : ''} |`;
  })
  .join('\n');

values.FONT_WEIGHT_ITEMS = groupEntries('fontWeight', true)
  .map(([name, tok]) => `- **${name}**: ${tok.$value} (${clean(tok.$description)})`)
  .join('\n');

values.FONT_SIZE_ROWS = groupEntries('fontSize', true)
  .map(([name, tok]) => `| ${name} | ${tok.$value} | ${cell(tok.$description)} |`)
  .join('\n');

if (missing.length) {
  fail('tokens.json lacks values the spec depends on; refusing to emit a blank where a brand value belongs.', missing);
}

// ---- fill the template ----
const unknown = new Set();
const md = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key) => {
  if (!(key in values)) { unknown.add(key); return whole; }
  return values[key];
});
if (unknown.size) fail('the template names placeholders this script does not fill.', [...unknown]);
if (/\{\{|\}\}/.test(md)) fail('the output still contains "{{" or "}}" (a malformed placeholder in the template).');

// ---- public-file guards ----
const problems = [];
md.split('\n').forEach((line, i) => {
  if (line.includes(EM_DASH)) problems.push(`line ${i + 1}: em-dash`);
  if (/\/home\/|\/Users\/|~\//.test(line)) problems.push(`line ${i + 1}: machine path`);
  if (/\b(19|20)\d\d-\d\d-\d\d\b/.test(line)) problems.push(`line ${i + 1}: date stamp`);
});
if (problems.length) fail('the result would carry text a public file must not.', problems);

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, 'brand-spec.md');
fs.writeFileSync(out, md);
console.log(`Wrote ${out}`);
