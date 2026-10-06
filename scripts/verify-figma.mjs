#!/usr/bin/env node
// verify-figma.mjs
// Checks tokens.json against the LIVE Figma Brand Book (the canonical source of truth for the brand).
//
// Why this exists: nothing else closes the Figma -> tokens.json loop. The build only READS
// tokens.json; the Figma Variables REST endpoint is Enterprise-gated (403 on Pro); and the Figma
// MCP variable tools need a live desktop selection, which a headless job does not have. This
// script instead fetches the Brand Book page over the plain files REST API (works on Pro) and
// checks that every color token is actually present as a rendered solid fill, that every font
// size and weight token is present as a rendered text style, and that the brand typeface
// appears. It also reports heavily used non-token colors as drift suspects.
//
// It reads Figma only: no private repository, no other data. It is not run in GitHub Actions
// (there is no Figma token in this repository); a weekly job outside GitHub runs it.
//
// Usage: FIGMA_TOKEN=... node scripts/verify-figma.mjs [--json] [--summary] [--status FILE]
//   --json         print the full result as JSON instead of the text report
//   --summary      also write a short Markdown summary: appended to $GITHUB_STEP_SUMMARY when
//                  that is set (GitHub Actions), printed to stdout otherwise
//   --status FILE  also write the full result as JSON to FILE (for a scheduled job's health check)
//
// Exit codes: 0 = PASS, 1 = DRIFT (a token is absent from the Brand Book), 2 = error.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_KEY = 'mFIc75UUSyftaqnNUQgjLX'; // My First Bitcoin_Full Brand Assets
const BRAND_BOOK_PAGE = '262:2'; // 59-frame designer monograph
const NON_TOKEN_THRESHOLD = 10; // report non-token solid colors used at least this often
const FETCH_TIMEOUT_MS = 120000;

// ---- arguments ----
const args = process.argv.slice(2);
const flags = { json: false, summary: false, status: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') flags.json = true;
  else if (a === '--summary') flags.summary = true;
  else if (a === '--status') {
    flags.status = args[++i];
    if (!flags.status || flags.status.startsWith('--')) {
      console.error('ERROR: --status needs a file path.');
      process.exit(2);
    }
  } else if (a.startsWith('--status=')) flags.status = a.slice('--status='.length);
  else {
    console.error(`ERROR: unknown argument ${a}`);
    console.error('Usage: FIGMA_TOKEN=... node scripts/verify-figma.mjs [--json] [--summary] [--status FILE]');
    process.exit(2);
  }
}

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
if (!FIGMA_TOKEN) {
  console.error('ERROR: FIGMA_TOKEN is not set (a read-only Figma token that can view the Brand Book).');
  process.exit(2);
}

const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens.json'), 'utf8'));
const tokenHex = {};
for (const [name, tok] of Object.entries(tokens.color)) tokenHex[tok.$value.toUpperCase()] = name;

// ---- COVERAGE CENSUS ----
// This check used to iterate tokens.color and nothing else, so its PASS spoke for 17 of 33
// tokens while reading as though it spoke for the brand. The census derives its scope from the
// artifact: it walks EVERY token group, so adding a token adds a line to this report
// automatically, and coverage cannot drift away from what it claims to cover unnoticed.
//
// It reports rather than fails, because most tokens are honestly unverifiable: the Brand Book
// states the 13 degree angle as English prose, and no API returns that as data.
const TOKEN_GROUPS = Object.keys(tokens).filter((k) => !k.startsWith('$'));
const census = { byKind: {}, unverifiable: [], measured: [], declared: [], noProvenance: [] };
for (const group of TOKEN_GROUPS) {
  for (const [name, tok] of Object.entries(tokens[group])) {
    const mfb = (tok.$extensions || {}).mfb;
    const kind = mfb ? mfb.sourceKind : 'no-provenance';
    census.byKind[kind] = (census.byKind[kind] || 0) + 1;
    const ref = `${group}.${name}`;
    if (kind === 'prose') census.unverifiable.push(`${ref} (${mfb.source})`);
    else if (kind === 'measured') census.measured.push(`${ref} (${mfb.source})`);
    else if (kind === 'declared') census.declared.push(ref);
    else if (kind === 'unverified' || kind === 'no-provenance') census.noProvenance.push(ref);
  }
}
census.total = TOKEN_GROUPS.reduce((n, g) => n + Object.keys(tokens[g]).length, 0);
census.machineCheckable = (census.byKind['rendered-fill'] || 0) + (census.byKind['rendered-text'] || 0);

// ---- fetch the Brand Book page ----
let doc;
try {
  const res = await fetch(`https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${BRAND_BOOK_PAGE}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`ERROR: Figma API ${res.status} (token expired or file moved?)`);
    process.exit(2);
  }
  doc = await res.json();
} catch (e) {
  console.error(`ERROR: could not read the Figma file (${e.message})`);
  process.exit(2);
}
const root = doc.nodes?.[BRAND_BOOK_PAGE]?.document;
if (!root) {
  console.error(`ERROR: Brand Book page ${BRAND_BOOK_PAGE} not found in file ${FILE_KEY}.`);
  process.exit(2);
}

const toHex = (c) =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()).join('');

const solid = new Map();
const fonts = new Map();
const sizes = new Map();
const weights = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

(function walk(n) {
  for (const f of [...(n.fills || []), ...(n.strokes || [])]) {
    if (f.visible === false) continue;
    if (f.type === 'SOLID' && f.color) bump(solid, toHex(f.color));
  }
  const st = n.style || {};
  if (st.fontFamily) bump(fonts, st.fontFamily);
  // Sizes and weights ride the same walk. When this loop read fontFamily and nothing else,
  // 12 tokens were reported as having no established provenance although every one of them
  // is in the Brand Book as a rendered text style.
  if (st.fontSize) bump(sizes, Math.round(st.fontSize));
  if (st.fontWeight) bump(weights, st.fontWeight);
  for (const ov of Object.values(n.styleOverrideTable || {})) {
    if (ov.fontFamily) bump(fonts, ov.fontFamily);
    if (ov.fontSize) bump(sizes, Math.round(ov.fontSize));
    if (ov.fontWeight) bump(weights, ov.fontWeight);
  }
  for (const c of n.children || []) walk(c);
})(root);

// ---- checks ----
const missing = [];
const present = {};
for (const [hex, name] of Object.entries(tokenHex)) {
  const n = solid.get(hex) || 0;
  present[name] = n;
  if (n === 0) missing.push(`${name} (${hex})`);
}

const suspects = [...solid.entries()]
  .filter(([hex, n]) => !(hex in tokenHex) && n >= NON_TOKEN_THRESHOLD)
  .sort((a, b) => b[1] - a[1])
  .map(([hex, n]) => `${hex} x${n}`);

// Read the family from the token being verified rather than hard-coding it, so a change of
// typeface in tokens.json is checked as the new typeface.
const bodyFamily = tokens.fontFamily?.body?.$value?.[0] || 'IBM Plex Sans';
const sansOk = (fonts.get(bodyFamily) || 0) > 0;

const missingType = [];
const typeUsage = {};
for (const [name, tok] of Object.entries(tokens.fontSize || {})) {
  const px = parseInt(String(tok.$value), 10);
  const n = sizes.get(px) || 0;
  typeUsage[`fontSize.${name}`] = n;
  if (n === 0) missingType.push(`fontSize.${name} (${tok.$value})`);
}
for (const [name, tok] of Object.entries(tokens.fontWeight || {})) {
  const w = parseInt(String(tok.$value), 10);
  const n = weights.get(w) || 0;
  typeUsage[`fontWeight.${name}`] = n;
  if (n === 0) missingType.push(`fontWeight.${name} (${tok.$value})`);
}

const colorTotal = Object.keys(tokenHex).length;
const typeTotal = Object.keys(typeUsage).length;
const result = {
  checkedAt: new Date().toISOString(),
  fileKey: FILE_KEY,
  page: BRAND_BOOK_PAGE,
  pass: missing.length === 0 && missingType.length === 0 && sansOk,
  missingTokenColors: missing,
  missingTypeTokens: missingType,
  typeTokenUsage: typeUsage,
  tokenColorUsage: present,
  nonTokenColorSuspects: suspects,
  fonts: Object.fromEntries([...fonts.entries()].sort((a, b) => b[1] - a[1])),
  bodyFamilyChecked: bodyFamily,
  coverage: census,
  knownOpenQuestions: [
    `coverage: ${census.machineCheckable}/${census.total} tokens are machine-checkable against Figma; ` +
      `${census.unverifiable.length} are prose in the brand book, ${census.measured.length} are measured from its vectors, ${census.declared.length} are declared ` +
      `downstream (what Figma owes), ${census.noProvenance.length} have no established provenance`,
    'IBM Plex Mono (fontFamily.mono) is deprecated in tokens.json: absent from the Brand Book, kept for compatibility, phase out',
    'Brand gradient (gradient.brand) is deprecated in tokens.json: absent from the Brand Book, kept for compatibility, phase out',
  ],
};

if (flags.status) {
  const dir = path.dirname(path.resolve(flags.status));
  fs.mkdirSync(dir, { recursive: true });
  // Write then rename, so a reader never sees a half-written status file.
  const tmp = `${flags.status}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(result, null, 2) + '\n');
  fs.renameSync(tmp, flags.status);
}

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Brand token verification vs Figma (${result.checkedAt.slice(0, 10)})`);
  // Print the census FIRST. A reader who sees only "PASS" reasonably concludes the brand is
  // verified; this line says how much of it actually was.
  console.log(`  Coverage: ${census.machineCheckable}/${census.total} tokens machine-checkable against Figma`);
  console.log(`    ${census.unverifiable.length} prose (stated in the brand book as English; no API returns these)`);
  console.log(`    ${census.measured.length} measured from the brand book's vector geometry, by hand or by an AI session through the Figma MCP, node ids in each note; no machine re-checks them (re-measure if those slides change)`);
  console.log(`    ${census.declared.length} declared downstream, which is what Figma owes: ${census.declared.join(', ') || 'none'}`);
  if (census.noProvenance.length)
    console.log(`    ${census.noProvenance.length} with NO established provenance: ${census.noProvenance.slice(0, 6).join(', ')}${census.noProvenance.length > 6 ? ' ...' : ''}`);
  console.log(`  Token colors: ${colorTotal - missing.length}/${colorTotal} present in brand book`);
  if (missing.length) console.log(`  MISSING (DRIFT!): ${missing.join(', ')}`);
  console.log(`  Type tokens: ${typeTotal - missingType.length}/${typeTotal} present in brand book`);
  if (missingType.length) console.log(`  MISSING TYPE (DRIFT!): ${missingType.join(', ')}`);
  console.log(`  ${bodyFamily} present: ${sansOk ? 'yes' : 'NO (DRIFT!)'}`);
  if (suspects.length) console.log(`  Non-token colors >= ${NON_TOKEN_THRESHOLD}x (mockup noise, review if new): ${suspects.slice(0, 8).join(', ')}`);
  if (flags.status) console.log(`  Status written: ${flags.status}`);
  console.log(result.pass ? 'PASS' : 'FAIL');
}

if (flags.summary) {
  const lines = [
    `### Figma check: ${result.pass ? 'PASS' : 'FAIL'}`,
    '',
    `Brand Book \`${FILE_KEY}\`, page \`${BRAND_BOOK_PAGE}\`, read ${result.checkedAt}.`,
    '',
    '| Check | Result |',
    '|-------|--------|',
    `| Token colors present | ${colorTotal - missing.length}/${colorTotal} |`,
    `| Type tokens present | ${typeTotal - missingType.length}/${typeTotal} |`,
    `| ${bodyFamily} present | ${sansOk ? 'yes' : 'no'} |`,
    `| Machine-checkable coverage | ${census.machineCheckable}/${census.total} tokens |`,
  ];
  if (missing.length) lines.push('', `Missing colors: ${missing.join(', ')}`);
  if (missingType.length) lines.push('', `Missing type tokens: ${missingType.join(', ')}`);
  if (suspects.length) lines.push('', `Non-token colors used ${NON_TOKEN_THRESHOLD} times or more (review if new): ${suspects.slice(0, 8).join(', ')}`);
  const md = lines.join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  else process.stdout.write('\n' + md);
}

process.exit(result.pass ? 0 : 1);
