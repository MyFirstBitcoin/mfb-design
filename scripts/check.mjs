#!/usr/bin/env node
// The rebuild check. Run it before opening a pull request; GitHub Actions runs it on every
// pull request and every push to master (the rebuild-check job in .github/workflows/design.yml).
//
// Usage: node scripts/check.mjs
//
// It rebuilds the package and the brand spec into a temporary directory, then compares every
// file the build produced with the committed copy at the repository root. It exits 1 when:
//   - the build refuses (the geometry gate: src/supergraphics.canon.css disagrees with tokens.json);
//   - the spec generator refuses (a missing token, an unfilled placeholder, or public-file text);
//   - any committed output differs from a fresh build (someone edited tokens.json, the canon, the
//     template or a script without rebuilding, or edited a generated file by hand);
//   - package.json gains a field that runs code or installs anything in consumers' projects.
//     Consumers install this package as a git dependency, and npm runs a git dependency's
//     `prepare` script (installing its dependencies first) on every consumer install;
//   - brand-check.mjs, the guard the package ships (it is hand-written, not generated), misses a
//     planted violation or reports a clean line (scripts/brand-check.test.mjs).
// It changes nothing in the repository.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATORS = ['scripts/build-design-package.mjs', 'scripts/brand-spec.mjs'];
const FORBIDDEN_PKG_FIELDS = [
  'scripts',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies', // npm 7 and later installs peer dependencies in the consumer's project
  'peerDependenciesMeta',
  'bundleDependencies',
  'bundledDependencies',
];

const problems = [];

// ---- package.json must stay inert ----
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const field of FORBIDDEN_PKG_FIELDS) {
  if (field in pkg) problems.push(`package.json has "${field}"; it must not (see the comment in scripts/check.mjs)`);
}

// ---- rebuild into a temporary directory ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfb-design-check-'));
try {
  for (const gen of GENERATORS) {
    const r = spawnSync(process.execPath, [path.join(ROOT, gen), tmp], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      process.stderr.write(r.stdout || '');
      process.stderr.write(r.stderr || '');
      problems.push(`${gen} failed (exit ${r.status ?? r.signal}); see its message above`);
    }
  }

  // ---- the shipped brand guard still catches what it must ----
  const guard = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'brand-check.test.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (guard.status !== 0) {
    process.stderr.write(guard.stdout || '');
    process.stderr.write(guard.stderr || '');
    problems.push(`scripts/brand-check.test.mjs failed (exit ${guard.status ?? guard.signal}); see its message above`);
  }

  // ---- compare every produced file with the committed one ----
  const produced = fs.readdirSync(tmp).sort();
  if (!problems.length && produced.length === 0) problems.push('the build produced no files');
  const stale = [];
  for (const name of produced) {
    const fresh = fs.readFileSync(path.join(tmp, name));
    let committed = null;
    try { committed = fs.readFileSync(path.join(ROOT, name)); } catch { /* missing */ }
    if (committed === null) stale.push(`${name} (missing from the repository)`);
    else if (!fresh.equals(committed)) stale.push(name);
  }
  if (stale.length) {
    problems.push(
      'committed outputs differ from a fresh build: ' + stale.join(', ') +
      '. Run `node scripts/build-design-package.mjs && node scripts/brand-spec.mjs` and commit the result.'
    );
  }

  if (problems.length) {
    console.error('check: FAIL');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`check: OK (${produced.length} outputs match a fresh build: ${produced.join(', ')})`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
