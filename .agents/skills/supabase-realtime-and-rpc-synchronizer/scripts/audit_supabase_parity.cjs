#!/usr/bin/env node
/**
 * Supabase Migrations, Consolidated SQL, database.types.ts & Realtime Channel Auditor.
 * Non-regressive by default (exit 0 at baseline); pass --strict for 0 debt.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

const BASELINE = {
  supabaseAsAny: 12,
  missingTypesTables: 8,
  channelsWithoutRemove: 2,
};

function walk(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((ext) => e.name.endsWith(ext))) out.push(p);
  }
  return out;
}

const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
const migrationFiles = fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  : [];

const consolidatedPath = path.join(ROOT, 'supabase', 'CONSOLIDATED_FULL_DATABASE_DEPLOY.sql');
const consolidated = fs.existsSync(consolidatedPath) ? fs.readFileSync(consolidatedPath, 'utf8') : '';

const missingInConsolidated = migrationFiles.filter((f) => !consolidated.includes(f));

const dbTypesPath = path.join(ROOT, 'src', 'shared', 'types', 'database.types.ts');
const dbTypes = fs.existsSync(dbTypesPath) ? fs.readFileSync(dbTypesPath, 'utf8') : '';

const criticalTables = [
  'profiles',
  'clans',
  'clan_members',
  'user_unit_hangar',
  'faction_unit_hangar',
  'unit_production_queue',
  'user_industrial_inventory',
  'user_industrial_plots',
  'territorial_battle_sessions',
  'territorial_vulnerability_windows',
  'state_sovereignty',
  'tactical_spatial_deployments',
  'tactical_fief_constructions',
  'region_sovereignty',
  'regions',
  'system_catalog_manifest',
];
const missingTablesInTypes = criticalTables.filter((t) => !new RegExp(`\\b${t}\\s*:\\s*\\{`).test(dbTypes));

const srcFiles = walk(path.join(ROOT, 'src'), ['.ts', '.tsx']);
const asAnyHits = [];
const channelsWithoutRemove = [];

for (const file of srcFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.includes('supabase as any')) asAnyHits.push(`${rel}:${idx + 1}`);
  });
  if (text.includes('.channel(') && !text.includes('removeChannel(')) {
    channelsWithoutRemove.push(rel);
  }
}

const regressions = [];
if (missingInConsolidated.length > 0) {
  regressions.push(`migrations missing in CONSOLIDATED: ${missingInConsolidated.join(', ')}`);
}
if (asAnyHits.length > BASELINE.supabaseAsAny) {
  regressions.push(`supabase as any grew: ${asAnyHits.length} > ${BASELINE.supabaseAsAny}`);
}
if (missingTablesInTypes.length > BASELINE.missingTypesTables) {
  regressions.push(`missing tables in database.types.ts grew: ${missingTablesInTypes.length} > ${BASELINE.missingTypesTables}`);
}
if (channelsWithoutRemove.length > BASELINE.channelsWithoutRemove) {
  regressions.push(`channels without removeChannel grew: ${channelsWithoutRemove.length} > ${BASELINE.channelsWithoutRemove}`);
}

const strictFailures = [];
if (STRICT) {
  if (missingInConsolidated.length > 0) strictFailures.push(`missingInConsolidated: ${missingInConsolidated.length}`);
  if (asAnyHits.length > 0) strictFailures.push(`supabaseAsAny: ${asAnyHits.length}`);
  if (missingTablesInTypes.length > 0) strictFailures.push(`missingTablesInTypes: ${missingTablesInTypes.length}`);
  if (channelsWithoutRemove.length > 0) strictFailures.push(`channelsWithoutRemove: ${channelsWithoutRemove.length}`);
}

const ok = STRICT ? strictFailures.length === 0 : regressions.length === 0;
const report = {
  ok,
  mode: STRICT ? 'strict' : 'non-regressive',
  migrationsCount: migrationFiles.length,
  missingInConsolidated,
  missingTablesInTypes,
  supabaseAsAnyCount: asAnyHits.length,
  asAnyHits,
  channelsWithoutRemove,
  regressions,
  strictFailures,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[SupabaseParity] mode=${report.mode} ok=${ok}`);
  console.log(`  migrations:             ${migrationFiles.length} (missing in consolidated: ${missingInConsolidated.length})`);
  console.log(`  missingTablesInTypes:   ${missingTablesInTypes.length} (baseline ${BASELINE.missingTypesTables})`);
  console.log(`  supabase as any:        ${asAnyHits.length} (baseline ${BASELINE.supabaseAsAny})`);
  console.log(`  channels w/o remove:    ${channelsWithoutRemove.length} (baseline ${BASELINE.channelsWithoutRemove})`);
  if (regressions.length) console.error('  REGRESSIONS:', regressions.join('; '));
  if (strictFailures.length) console.error('  STRICT FAILURES:', strictFailures.join('; '));
}

process.exit(ok ? 0 : 1);
