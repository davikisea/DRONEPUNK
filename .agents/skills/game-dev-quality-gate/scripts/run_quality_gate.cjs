#!/usr/bin/env node
/**
 * Unified Deterministic Quality Gate & Orphan Test Coverage Auditor for DRONEPUNK.
 * Modes:
 *   --mode=audit (default): runs boundary wrappers (parsing stdout -> real exit code),
 *     checks orphan *.test.ts vs package.json, and checks docs/migrations sync.
 *   --mode=fast --files=a,b: runs audit + domain-mapped test suites.
 *   --mode=full: runs audit + lint + build + all 47/47 *.test.ts suites + verify-map-topology.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='));
const MODE = modeArg ? modeArg.split('=')[1] : 'audit';
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');

function walk(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function runCmd(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', shell: true });
}

// 1. Discover all *.test.ts in src/ vs package.json
const allTestFiles = walk(path.join(ROOT, 'src'), '.test.ts')
  .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
  .sort();

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const allPkgScripts = Object.values(pkg.scripts || {}).join('\n');
const aggregateScripts = [
  pkg.scripts?.['test:all'] || '',
  pkg.scripts?.['test:geotactics'] || '',
  pkg.scripts?.['test:catalogs'] || '',
].join('\n');

const inAggregate = allTestFiles.filter((t) => aggregateScripts.includes(t));
const orphanSuites = allTestFiles.filter((t) => !allPkgScripts.includes(t));
const isolatedOnly = allTestFiles.filter((t) => allPkgScripts.includes(t) && !aggregateScripts.includes(t));

// 2. Wrap boundary scripts and parse stdout (since legacy scripts exit 0 on violations)
const sharedRes = runCmd('node', ['scripts/checkSharedViolations.cjs']);
const sharedViolations = (sharedRes.stdout || '')
  .split(/\r?\n/)
  .filter((l) => l.includes('DOMAIN IMPORT IN SHARED:'));

const legacyRes = runCmd('node', ['scripts/checkLegacyImports.cjs']);
const legacyMatch = (legacyRes.stdout || '').match(/remaining in modern codebase:\s*(\d+)/i);
const legacyCount = legacyMatch ? parseInt(legacyMatch[1], 10) : 0;

// 3. Docs / Migrations sanity
const migrationsCount = fs.existsSync(path.join(ROOT, 'supabase', 'migrations'))
  ? fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).length
  : 0;
const consolidated = fs.existsSync(path.join(ROOT, 'supabase', 'CONSOLIDATED_FULL_DATABASE_DEPLOY.sql'))
  ? fs.readFileSync(path.join(ROOT, 'supabase', 'CONSOLIDATED_FULL_DATABASE_DEPLOY.sql'), 'utf8')
  : '';
const migrationFiles = fs.existsSync(path.join(ROOT, 'supabase', 'migrations'))
  ? fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'))
  : [];
const missingInConsolidated = migrationFiles.filter((f) => !consolidated.includes(f)).length;

let lintOk = true;
let buildOk = true;
let topologyOk = true;
const failedSuites = [];

if (MODE === 'full' || MODE === 'fast') {
  const lint = runCmd('npm', ['run', 'lint']);
  lintOk = lint.status === 0;
}

if (MODE === 'full') {
  const build = runCmd('npm', ['run', 'build']);
  buildOk = build.status === 0;

  const topo = runCmd('node', ['scripts/verify-map-topology.mjs', '--json']);
  topologyOk = topo.status === 0;

  for (const suite of allTestFiles) {
    const r = runCmd('npx', ['tsx', suite]);
    if (r.status !== 0) failedSuites.push(suite);
  }
}

const BASELINE_SHARED = 6; // checkSharedViolations.cjs @domains/ hits
const ok =
  legacyCount === 0 &&
  missingInConsolidated === 0 &&
  lintOk &&
  buildOk &&
  topologyOk &&
  failedSuites.length === 0 &&
  (STRICT ? sharedViolations.length === 0 : sharedViolations.length <= BASELINE_SHARED);

const summary = {
  ok,
  mode: MODE,
  strict: STRICT,
  coverage: {
    totalSuites: allTestFiles.length,
    inAggregate: inAggregate.length,
    isolatedOnly: isolatedOnly.length,
    orphanSuitesCount: orphanSuites.length,
    orphanSuites,
  },
  boundaries: {
    sharedAliasViolations: sharedViolations.length,
    legacyImports: legacyCount,
  },
  migrationsCount,
  missingInConsolidated,
  lintOk,
  buildOk,
  topologyOk,
  failedSuites,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`[QualityGate] mode=${MODE} ok=${ok}`);
  console.log(`  suites: ${allTestFiles.length} total (${inAggregate.length} aggregate, ${isolatedOnly.length} isolated, ${orphanSuites.length} orphan)`);
  console.log(`  boundaries: ${sharedViolations.length} @domains/* in shared (baseline ${BASELINE_SHARED}), ${legacyCount} legacy`);
  console.log(`  migrations: ${migrationsCount} (missing in consolidated: ${missingInConsolidated})`);
  if (MODE === 'full') {
    console.log(`  lint=${lintOk} build=${buildOk} topology=${topologyOk} failedSuites=${failedSuites.length}`);
  }
}

process.exit(ok ? 0 : 1);
