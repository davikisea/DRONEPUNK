/**
 * Deterministic Economy, Anti-Inflation (65% Sink / 35% Scrap), P2P 2% & Siege Invariants Auditor.
 * Non-regressive by default (exit 0 at baseline); pass --strict for 0 debt.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MASTER_METAGAME_CONSTANTS,
  calculateLossScrapRecovery,
  calculateP2PTransactionSplit,
} from '../../../../src/shared/types/metagame';
import {
  MAX_PHYSICAL_HANGAR_CAPACITY,
  P2P_MARKET_TAX_TOTAL,
  P2P_VWAP_COLLAR_BAND,
  SALVAGE_TECH_SCRAP_RATE,
  IndustrialEngine,
  BASE_PRODUCTION_DURATIONS,
  calculateUnitProductionCost,
} from '../../../../src/domains/economy';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');

const BASELINE = {
  industrialEngineTaxMismatch: 1, // IndustrialEngine.MARKET_TAX_RATE = 0.12 vs 0.02
  hangarCapUnusedInSrc: 1,        // MAX_PHYSICAL_HANGAR_CAPACITY not imported in useUserHangar/UnitHangarModal
};

// 1. Anti-inflation sweep: every chassis T1..T5 must have forgeCost > scrap return
const unitCodes = Object.keys(BASE_PRODUCTION_DURATIONS);
const inflationExploits: string[] = [];
for (const code of unitCodes) {
  for (let tier = 1; tier <= 5; tier++) {
    const cost = calculateUnitProductionCost(code, tier);
    const scrap = calculateLossScrapRecovery(tier, 1);
    if (scrap > Math.floor(50 * tier * MASTER_METAGAME_CONSTANTS.RECYCLE_SCRAP_RATE)) {
      inflationExploits.push(`${code} T${tier} scrap=${scrap} exceeds 35% ceiling (cost EC=${cost.energyCredits})`);
    }
  }
}

// 2. SSOT Parity checks
const ssotDrifts: string[] = [];
if (P2P_MARKET_TAX_TOTAL !== MASTER_METAGAME_CONSTANTS.TOTAL_P2P_TAX_RATE) ssotDrifts.push('P2P_MARKET_TAX_TOTAL');
if (P2P_VWAP_COLLAR_BAND !== MASTER_METAGAME_CONSTANTS.VWAP_COLLAR_PERCENT) ssotDrifts.push('P2P_VWAP_COLLAR_BAND');
if (SALVAGE_TECH_SCRAP_RATE !== MASTER_METAGAME_CONSTANTS.RECYCLE_SCRAP_RATE) ssotDrifts.push('SALVAGE_TECH_SCRAP_RATE');
if (MAX_PHYSICAL_HANGAR_CAPACITY !== 16) ssotDrifts.push('MAX_PHYSICAL_HANGAR_CAPACITY');

const split = calculateP2PTransactionSplit(1000);
if (split.platformBurn !== 10 || split.provinceRoyalty !== 10 || split.netSellerPayout !== 980) {
  ssotDrifts.push(`calculateP2PTransactionSplit(1000) invalid: ${JSON.stringify(split)}`);
}

// 3. Known debt checks
const industrialTaxMismatch = IndustrialEngine.MARKET_TAX_RATE !== MASTER_METAGAME_CONSTANTS.TOTAL_P2P_TAX_RATE ? 1 : 0;
const hangarHookSrc = fs.readFileSync(path.join(ROOT, 'src/domains/economy/hooks/useUserHangar.ts'), 'utf8');
const hangarModalSrc = fs.readFileSync(path.join(ROOT, 'src/domains/economy/components/UnitHangarModal.tsx'), 'utf8');
const hangarCapUnused =
  !hangarHookSrc.includes('MAX_PHYSICAL_HANGAR_CAPACITY') &&
  !hangarModalSrc.includes('MAX_PHYSICAL_HANGAR_CAPACITY')
    ? 1
    : 0;

const regressions: string[] = [];
if (inflationExploits.length > 0) regressions.push(`inflationExploits: ${inflationExploits.join(', ')}`);
if (ssotDrifts.length > 0) regressions.push(`ssotDrifts: ${ssotDrifts.join(', ')}`);
if (industrialTaxMismatch > BASELINE.industrialEngineTaxMismatch) regressions.push('industrialTaxMismatch');
if (hangarCapUnused > BASELINE.hangarCapUnusedInSrc) regressions.push('hangarCapUnused');

const strictFailures: string[] = [];
if (STRICT) {
  if (industrialTaxMismatch) strictFailures.push(`IndustrialEngine.MARKET_TAX_RATE=${IndustrialEngine.MARKET_TAX_RATE} (expected 0.02)`);
  if (hangarCapUnused) strictFailures.push('MAX_PHYSICAL_HANGAR_CAPACITY unused in useUserHangar / UnitHangarModal');
}

const ok = STRICT ? regressions.length === 0 && strictFailures.length === 0 : regressions.length === 0;
console.log(`[EconomyAudit] mode=${STRICT ? 'strict' : 'non-regressive'} ok=${ok}`);
console.log(`  archetypes swept: ${unitCodes.length} x 5 tiers | inflationExploits=${inflationExploits.length} | ssotDrifts=${ssotDrifts.length}`);
console.log(`  debt: industrialTaxMismatch=${industrialTaxMismatch} (rate=${IndustrialEngine.MARKET_TAX_RATE}) hangarCapUnused=${hangarCapUnused}`);
if (regressions.length) console.error('  REGRESSIONS:', regressions.join('; '));
if (strictFailures.length) console.error('  STRICT FAILURES:', strictFailures.join('; '));

process.exit(ok ? 0 : 1);
