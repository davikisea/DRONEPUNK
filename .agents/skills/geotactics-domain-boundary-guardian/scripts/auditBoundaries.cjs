#!/usr/bin/env node
/**
 * Deterministic Boundary & Modularity Auditor for DRONEPUNK.
 * Non-regressive by default (exit 0 at verified baseline, exit 1 on any new regression).
 * Pass --strict to require 0 total violations.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

const BASELINE = {
  sharedDomainViolations: 17, // 6 @domains/* + 11 relative in QADevOpsRunner.tsx
  deepImports: 0,
  missingBarrelExports: 0,
  duplicateBasenames: 7,
  appLines: 3150,
  appUseStates: 75,
};

function walk(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

const srcFiles = walk(path.join(ROOT, 'src'), ['.ts', '.tsx']);
const sharedFiles = srcFiles.filter((f) => rel(f).startsWith('src/shared/'));

// 1. @shared -> @domains/* (alias or relative)
const sharedViolations = [];
const sharedRe = /from\s+['"](@domains\/[^'"]+|(?:\.\.\/)+domains\/[^'"]+)['"]/g;
for (const file of sharedFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    let m;
    sharedRe.lastIndex = 0;
    while ((m = sharedRe.exec(line)) !== null) {
      sharedViolations.push(`${rel(file)}:${idx + 1} -> ${m[1]}`);
    }
  });
}

// 2. Deep imports (@domains/<x>/subpath)
const deepImports = [];
const deepRe = /from\s+['"]@domains\/[^/'"]+\/[^'"]+['"]/g;
for (const file of srcFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (deepRe.test(line)) deepImports.push(`${rel(file)}:${idx + 1}`);
    deepRe.lastIndex = 0;
  });
}

// 3. Duplicate basenames across domains/shared (excluding index.ts, types.ts, *.test.ts)
const byName = new Map();
for (const file of srcFiles) {
  const r = rel(file);
  if (r.includes('/__tests__/') || r.endsWith('.test.ts') || r.endsWith('.test.tsx')) continue;
  const base = path.basename(file);
  if (base === 'index.ts' || base === 'types.ts') continue;
  if (!byName.has(base)) byName.set(base, []);
  byName.get(base).push(r);
}
const duplicates = [...byName.entries()]
  .filter(([, paths]) => paths.length > 1)
  .map(([name, paths]) => ({ name, paths }));

// 4. App.tsx metrics
const appPath = path.join(ROOT, 'src', 'App.tsx');
const appContent = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';
const appLines = appContent ? appContent.split(/\r?\n/).length : 0;
const appUseStates = (appContent.match(/\buseState\s*(?:<[^>]*>)?\s*\(/g) || []).length;

// 5. Regression checks
const regressions = [];
if (sharedViolations.length > BASELINE.sharedDomainViolations) {
  regressions.push(`shared->domains increased: ${sharedViolations.length} > ${BASELINE.sharedDomainViolations}`);
}
if (deepImports.length > BASELINE.deepImports) {
  regressions.push(`deep-imports detected: ${deepImports.length}`);
}
if (duplicates.length > BASELINE.duplicateBasenames) {
  regressions.push(`duplicate basenames increased: ${duplicates.length} > ${BASELINE.duplicateBasenames}`);
}
if (appLines > BASELINE.appLines) {
  regressions.push(`App.tsx grew: ${appLines} > ${BASELINE.appLines} lines`);
}
if (appUseStates > BASELINE.appUseStates) {
  regressions.push(`App.tsx useState grew: ${appUseStates} > ${BASELINE.appUseStates}`);
}

const strictFailures = [];
if (STRICT) {
  if (sharedViolations.length > 0) strictFailures.push(`shared->domains: ${sharedViolations.length}`);
  if (deepImports.length > 0) strictFailures.push(`deep-imports: ${deepImports.length}`);
  if (duplicates.length > 0) strictFailures.push(`duplicates: ${duplicates.length}`);
}

const ok = STRICT ? strictFailures.length === 0 : regressions.length === 0;
const report = {
  ok,
  mode: STRICT ? 'strict' : 'non-regressive',
  counts: {
    sharedViolations: sharedViolations.length,
    deepImports: deepImports.length,
    duplicates: duplicates.length,
    appLines,
    appUseStates,
  },
  regressions,
  strictFailures,
  sharedViolations,
  deepImports,
  duplicates,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[BoundaryAudit] mode=${report.mode} ok=${ok}`);
  console.log(`  shared->domains: ${sharedViolations.length} (baseline ${BASELINE.sharedDomainViolations})`);
  console.log(`  deep-imports:    ${deepImports.length}`);
  console.log(`  duplicates:      ${duplicates.length} (baseline ${BASELINE.duplicateBasenames})`);
  console.log(`  App.tsx:         ${appLines} lines, ${appUseStates} useState`);
  if (regressions.length) console.error('  REGRESSIONS:', regressions.join('; '));
  if (strictFailures.length) console.error('  STRICT FAILURES:', strictFailures.join('; '));
}

process.exit(ok ? 0 : 1);
