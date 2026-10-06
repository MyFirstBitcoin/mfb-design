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
};

// ---- sources ----
// Every value in the new sections is shown with where it comes from: a Brand Book node, the line
// of the live website it was declared from (where the book is silent), or this package's
// recommendation. tokens.json carries the full note; the spec shows the short form.
const SITE_RE = /^myfirstbitcoin\.org@([0-9a-f]{7,40}):(.+)$/;
const siteCommits = new Set();
const sourceOf = (group, name) => {
  const tok = (tokens[group] || {})[name];
  const m = tok?.$extensions?.mfb;
  if (!m?.source) {
    missing.push(`${group}.${name} ($extensions.mfb.source)`);
    return '';
  }
  if (m.source.startsWith('figma:')) return `Brand Book \`${m.source.slice(6)}\`${m.sourceKind === 'measured' ? ', measured' : ''}`;
  const site = m.source.match(SITE_RE);
  if (site) {
    siteCommits.add(site[1]);
    return `website \`${site[2]}\``;
  }
  if (m.source === 'declared') return "this package's recommendation";
  return `\`${m.source}\``;
};
const paletteName = (v) => (typeof v === 'string' ? v.match(/^\{color\.([\w-]+)\}$/)?.[1] : undefined);
const colorOf = (where, v) => {
  const name = paletteName(v);
  if (!name || !tokens.color[name]) {
    missing.push(`${where} (an alias of a palette color)`);
    return '';
  }
  return `${name} (\`${tokens.color[name].$value}\`)`;
};
const shadowText = (where, v) => {
  const color = colorOf(`${where}.color`, v?.color).replace(/ \(.*\)$/, '');
  return `\`${v?.offsetX} ${v?.offsetY} ${v?.blur} ${v?.spread}\`, ${color} at ${Math.round(Number(v?.opacity) * 100)}%`;
};
const rows = (group, required, fmt) => groupEntries(group, required).map(([name, tok]) => fmt(name, tok)).join('\n');

values.COLOR_ROWS = groupEntries('color', true)
  .map(([name, tok]) => {
    const cmyk = tok.$extensions?.mfb?.cmyk;
    return `| ${name} | ${tok.$value} | ${Array.isArray(cmyk) ? cmyk.join(' ') : ''} | ${cell(tok.$description)} |`;
  })
  .join('\n');

values.BLACK = need('color', 'black');
values.HALFTONE_SCALE = need('geometry', 'halftone-scale');
values.PATTERN_STEP = need('geometry', 'pattern-row-step');
values.PATTERN_GAP = need('geometry', 'pattern-row-gap');
values.PARA_EDGE = need('geometry', 'para-edge-ratio');
values.SPACE_HEADING_BODY = need('space', 'heading-to-body');
values.SPACE_HEADING_BODY_SRC = sourceOf('space', 'heading-to-body');
values.SPACE_QUOTE_LABEL = need('space', 'quote-to-label');
values.SPACE_QUOTE_LABEL_SRC = sourceOf('space', 'quote-to-label');
values.LOGO_MIN_W = need('logo', 'min-width');
values.LOGO_MIN_W_PRINT = need('logo', 'min-width-print');
values.LOGO_MIN_H = need('logo', 'min-height');
values.LOGO_ASPECT = need('logo', 'aspect');
values.LOGO_CLEAR = need('logo', 'clearspace');
values.LOGO_MARGIN = need('logo', 'edge-margin');
values.LOGO_ICON_H = need('geometry', 'logo-icon-h');
for (const surface of ['light', 'dark', 'orange']) {
  values[`LOGO_ON_${surface.toUpperCase()}`] = paletteName(need('colorRole', `logo-on-${surface}`)) || '';
}

values.TYPE_ROWS = groupEntries('fontSize', true)
  .map(([level, tok]) => {
    const lh = need('lineHeight', level);
    const ls = need('letterSpacing', level);
    const fluid = tokens.fontSizeFluid?.[level];
    return `| ${level} | ${tok.$value} | ${lh} | ${ls} | ${fluid ? `\`${fluid.$value}\` (${sourceOf('fontSizeFluid', level)})` : `fixed, ${tok.$value}`} |`;
  })
  .join('\n');

values.COLOR_ROLE_ROWS = rows('colorRole', true, (name, tok) =>
  `| \`${name}\` | ${colorOf(`colorRole.${name}`, tok.$value)} | ${cell(tok.$description)} | ${sourceOf('colorRole', name)} |`);
values.SHAPE_TONE_ITEMS = rows('shapeTone', true, (name, tok) =>
  `- On ${name}: ${colorOf(`shapeTone.${name}`, tok.$value).replace(/ \(.*\)$/, '')} (${sourceOf('shapeTone', name)})`);

const valueRow = (group, prefix) => (name, tok) =>
  `| \`${prefix}${name}\` | \`${tok.$value}\` | ${cell(tok.$description)} | ${sourceOf(group, name)} |`;
values.SPACE_SCALE_ITEMS = groupEntries('spaceScale', true).map(([k, tok]) => `${k}: ${tok.$value}`).join(', ');
const scaleSources = groupEntries('spaceScale', true).map(([k]) => sourceOf('spaceScale', k));
values.SPACE_SCALE_SRC = scaleSources.length ? `${scaleSources[0]} to ${scaleSources.at(-1).replace(/^website /, '')}` : '';
values.SPACE_ROWS = rows('space', true, valueRow('space', '--mfb-space-'));
values.CONTAINER_ROWS = rows('container', true, valueRow('container', '--mfb-container-'));
values.RADIUS_ROWS = rows('radius', true, valueRow('radius', '--mfb-radius-'));
values.SHADOW_ROWS = rows('shadow', true, (name, tok) =>
  `| \`--mfb-shadow-${name}\` | ${shadowText(`shadow.${name}`, tok.$value)} | ${cell(tok.$description)} | ${sourceOf('shadow', name)} |`);
values.EASING_ROWS = rows('easing', true, (name, tok) =>
  `| \`--mfb-ease-${name}\` | \`cubic-bezier(${[].concat(tok.$value).join(', ')})\` | ${cell(tok.$description)} | ${sourceOf('easing', name)} |`);
values.DURATION_ROWS = rows('duration', true, valueRow('duration', '--mfb-duration-'));
values.BREAKPOINT_ROWS = rows('breakpoint', true, valueRow('breakpoint', '--mfb-breakpoint-'));
values.Z_ROWS = rows('zIndex', true, valueRow('zIndex', '--mfb-z-'));
values.RATIO_ROWS = rows('mediaRatio', true, valueRow('mediaRatio', '--mfb-ratio-'));
values.UI_ROWS = rows('ui', true, valueRow('ui', '--mfb-ui-'));
values.SITE_COMMIT = [...siteCommits].join(', ');
if (siteCommits.size !== 1) missing.push(`website sources: expected one commit across the declared tokens, found ${siteCommits.size} (${values.SITE_COMMIT || 'none'})`);

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
