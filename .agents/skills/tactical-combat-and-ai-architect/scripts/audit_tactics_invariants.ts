/**
 * Deterministic Tactics Domain Invariants & Full-Suite Auditor.
 * Non-regressive by default (exit 0 at baseline); pass --strict for 0 debt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CANONICAL_DAMAGE_CHART, isIndirectFireUnit } from '../../../../src/domains/tactics/core/canonicalDamageChart';
import { CANONICAL_CO_REGISTRY, COEngine } from '../../../../src/domains/tactics/core/coSystem';
import { CANONICAL_UNIT_PRODUCTION_CATALOG } from '../../../../src/domains/economy/core/turnEconomy';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const RUN_TESTS = process.argv.includes('--run-tests');

const BASELINE = {
  missingChartArchetypes: 1,      // 'missile' in turnEconomy vs 'missiles' in canonicalDamageChart
  missingIndirectMissiles: 1,     // isIndirectFireUnit('missiles') currently false
  missingVisionArchetypes: 5,     // neotank, apc, t_copter, missiles/missile missing in CANONICAL_UNIT_BASE_VISION
  coScaleBugs: 2,                 // kindle -3 & getCapturePoints not /10
  reserveMaxHp10: 7,              // CANONICAL_RESERVE_CATALOG entries with maxHp: 10
  kanbeiDefenderBroken: 1,        // defender Day-to-Day ignored in getCombatModifiers
};

const archetypes = Object.keys(CANONICAL_UNIT_PRODUCTION_CATALOG);
const chartMissing = archetypes.filter((a) => !(a in CANONICAL_DAMAGE_CHART));
const indirectMissilesOk = isIndirectFireUnit('missiles');

const fogSrc = fs.readFileSync(path.join(ROOT, 'src/domains/tactics/core/fogOfWar.ts'), 'utf8');
const missingVision = archetypes.filter((a) => !new RegExp(`\\b${a}\\s*:`).test(fogSrc));

const coSrc = fs.readFileSync(path.join(ROOT, 'src/domains/tactics/core/coSystem.ts'), 'utf8');
let coScaleIssues = 0;
if (coSrc.includes('u.hp - 3')) coScaleIssues++;
const andyState = { coId: 'andy', activePower: null, charge: 0, maxCharge: 30000, starValue: 10000, powerCount: 0 } as any;
if (COEngine.getCapturePoints(andyState, 100) !== 10) coScaleIssues++;

const reinfSrc = fs.readFileSync(path.join(ROOT, 'src/domains/tactics/core/reinforcementsEngine.ts'), 'utf8');
const maxHp10Count = (reinfSrc.match(/maxHp:\s*10\b/g) || []).length;

const dummyUnit = { unitCode: 'infantry', minRange: 1, maxRange: 1, movementType: 'foot' } as any;
const kanbeiState = { coId: 'kanbei', activePower: null, charge: 0, maxCharge: 40000, starValue: 10000, powerCount: 0 } as any;
const mods = COEngine.getCombatModifiers(dummyUnit, dummyUnit, andyState, kanbeiState);
const kanbeiDefOk = mods.defenderModifier >= 120;

const testDir = path.join(ROOT, 'src/domains/tactics/__tests__');
const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts')).sort();
const failedTests: string[] = [];

if (RUN_TESTS) {
  for (const tf of testFiles) {
    const r = spawnSync('npx', ['tsx', path.join('src/domains/tactics/__tests__', tf)], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: true,
    });
    if (r.status !== 0) failedTests.push(tf);
  }
}

const regressions: string[] = [];
if (chartMissing.length > BASELINE.missingChartArchetypes) regressions.push(`CANONICAL_DAMAGE_CHART missing grew: ${chartMissing.join(',')}`);
if (!indirectMissilesOk && BASELINE.missingIndirectMissiles === 0) regressions.push('isIndirectFireUnit(missiles) false');
if (missingVision.length > BASELINE.missingVisionArchetypes) regressions.push(`missingVision grew: ${missingVision.length}`);
if (coScaleIssues > BASELINE.coScaleBugs) regressions.push(`coScaleIssues grew: ${coScaleIssues}`);
if (maxHp10Count > BASELINE.reserveMaxHp10) regressions.push(`reserve maxHp:10 grew: ${maxHp10Count}`);
if (failedTests.length > 0) regressions.push(`failedTests: ${failedTests.join(',')}`);

const strictFailures: string[] = [];
if (STRICT) {
  if (chartMissing.length > 0) strictFailures.push(`chartMissing: ${chartMissing.join(',')}`);
  if (!indirectMissilesOk) strictFailures.push('isIndirectFireUnit(missiles) is false');
  if (missingVision.length > 0) strictFailures.push(`missingVision: ${missingVision.join(',')}`);
  if (coScaleIssues > 0) strictFailures.push(`coScaleIssues: ${coScaleIssues}`);
  if (maxHp10Count > 0) strictFailures.push(`reserveMaxHp10: ${maxHp10Count}`);
  if (!kanbeiDefOk) strictFailures.push(`kanbei defenderModifier=${mods.defenderModifier} (<120)`);
}

const ok = STRICT ? strictFailures.length === 0 && failedTests.length === 0 : regressions.length === 0;
console.log(`[TacticsAudit] mode=${STRICT ? 'strict' : 'non-regressive'} ok=${ok}`);
console.log(`  COs registered: ${Object.keys(CANONICAL_CO_REGISTRY).length} | archetypes: ${archetypes.length} (chart missing: ${chartMissing.length})`);
console.log(`  indirect(missiles)=${indirectMissilesOk} | missingVision=${missingVision.length} | coScaleIssues=${coScaleIssues} | reserveMaxHp10=${maxHp10Count} | kanbeiDefOk=${kanbeiDefOk}`);
console.log(`  tactics test suites: ${testFiles.length}${RUN_TESTS ? ` (failed: ${failedTests.length})` : ' (pass --run-tests to execute all)'}`);
if (regressions.length) console.error('  REGRESSIONS:', regressions.join('; '));
if (strictFailures.length) console.error('  STRICT FAILURES:', strictFailures.join('; '));

process.exit(ok ? 0 : 1);
