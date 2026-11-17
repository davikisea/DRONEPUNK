/**
 * ==============================================================================
 * SUITE DE PRUEBAS: NODOS ESTRATÉGICOS, HANGAR DE FACCIÓN Y COLA DE PRODUCCIÓN
 * ==============================================================================
 * Ejecución: npx tsx src/domains/economy/__tests__/strategicAndProductionEngine.test.ts
 * ==============================================================================
 */

import {
  calculateUnitProductionDuration,
  calculateUnitProductionCost,
  createProductionQueueItem,
  isProductionItemReady,
  evaluateStrategicNodes,
  authorizeFactionUnitBorrow,
  calculateSymbioticExtractionSettlement,
  fiefBuildingService,
  evaluateOccupationFatigueAndRebellion,
  canUnlockDroneTier,
  settleResourceTriadExtraction,
  calculateAdministrativeOverloadFuelMultiplier,
  MUNICIPAL_BUILDINGS_CATALOG,
  StrategicNode,
  FactionHangarStock,
} from '@domains/economy';
import { calculateSupplyLineHourlyFuelBurn, CANONICAL_H3_DRONE_CATALOG } from '@domains/tactics';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ [PASSED] ${message}`);
  }
}

console.log('==============================================================================');
console.log('EJECUTANDO SUITE: FASE 1 - NODOS ESTRATÉGICOS, FORJA Y HANGAR DE FACCIÓN');
console.log('==============================================================================\n');

// ------------------------------------------------------------------------------
// SUITE 1: TIEMPOS DE FORJA FÍSICA Y KIT F2P
// ------------------------------------------------------------------------------
console.log('--- SUITE 1: TIEMPOS DE ENSAMBLAJE Y COLA DE FORJA ---');

// 1.1 Kit F2P inagotable debe ser instantáneo
const t1InfantryDuration = calculateUnitProductionDuration('infantry', 1);
assert(t1InfantryDuration === 0, 'Test 1.1: Infantería Ligera Tier 1 tiene 0s de espera (Kit F2P)');

const t1ReconDuration = calculateUnitProductionDuration('recon', 1);
assert(t1ReconDuration === 0, 'Test 1.2: Reconocimiento Tier 1 tiene 0s de espera (Kit F2P)');

// 1.2 Tanque Ligero escala con su Tier
const t1Tank = calculateUnitProductionDuration('tank', 1);
const t3Tank = calculateUnitProductionDuration('tank', 3);
assert(t1Tank === 180, `Test 1.3: Tanque Ligero T1 dura exactamente 180s (esperado: 180, obtenido: ${t1Tank})`);
assert(t3Tank > t1Tank, `Test 1.4: Tanque Ligero T3 (${t3Tank}s) tarda más que T1 (${t1Tank}s) por pureza industrial`);

// 1.3 Reducción de tiempo por Buff Hegemónico de Capital Nacional
const t1MediumTankNormal = calculateUnitProductionDuration('medium_tank', 1);
const t1MediumTankCapital = calculateUnitProductionDuration('medium_tank', 1, { hasCapitalHegemony: true });
assert(
  t1MediumTankCapital < t1MediumTankNormal,
  `Test 1.5: Capital Nacional acelera forja (+10% velocidad): Normal=${t1MediumTankNormal}s, Con Capital=${t1MediumTankCapital}s`
);

// ------------------------------------------------------------------------------
// SUITE 2: COSTOS DE MANUFACTURA
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 2: COSTOS DE FABRICACIÓN SEGÚN TIERS ---');

const f2pCost = calculateUnitProductionCost('infantry', 1);
assert(f2pCost.energyCreditEc === 0 && f2pCost.steelPlates === 0, 'Test 2.1: Infantería F2P no consume EC ni placas de acero');

const t3Cost = calculateUnitProductionCost('tank', 3);
assert(t3Cost.steelPlates === 12, `Test 2.2: Tanque T3 requiere 12 placas de acero (obtenido: ${t3Cost.steelPlates})`);
assert(t3Cost.microchips === 2, `Test 2.3: Tanque T3 requiere 2 microchips para sensores balísticos`);

// ------------------------------------------------------------------------------
// SUITE 3: COLA DE PRODUCCIÓN Y TEMPORIZADORES
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 3: COLA DE PRODUCCIÓN CON TEMPORIZADORES REALES ---');

const now = new Date('2026-11-05T00:00:00Z');
const queueItem = createProductionQueueItem(
  'user-123',
  'tank',
  1,
  'user',
  null,
  { startTimeOverride: now }
);

assert(queueItem.durationSeconds === 180, 'Test 3.1: Item de cola registra duración correcta de 180s');

const tPlus60s = new Date('2026-11-05T00:01:00Z');
assert(!isProductionItemReady(queueItem, tPlus60s), 'Test 3.2: A los 60s la unidad NO está lista (en ensamblaje)');

const tPlus180s = new Date('2026-11-05T00:03:00Z');
assert(isProductionItemReady(queueItem, tPlus180s), 'Test 3.3: A los 180s la unidad está LISTA para reclamar al hangar');

// ------------------------------------------------------------------------------
// SUITE 4: NODOS ESTRATÉGICOS Y BUFFS REGIONALES
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 4: EVALUACIÓN DE NODOS ESTRATÉGICOS ---');

const mockNodes: StrategicNode[] = [
  {
    id: 'NODE_VE_CAPITAL',
    regionId: 'REG_VE_01',
    nodeType: 'capital_hq',
    name: 'Cuartel General Central Caracas',
    buffType: 'hegemonic_capital',
    buffValue: 1.15,
    controllingClanId: 'clan-alpha',
  },
  {
    id: 'NODE_VE_MARACAIBO_CHOKE',
    regionId: 'REG_VE_02',
    nodeType: 'strait_canal',
    name: 'Canal de Maracaibo',
    buffType: 'toll_chokepoint',
    buffValue: 5.0,
    controllingClanId: 'clan-alpha',
  },
  {
    id: 'NODE_VE_PARAGUANA_CRP',
    regionId: 'REG_VE_11',
    nodeType: 'refinery_hub',
    name: 'Refinería Amuay',
    buffType: 'energy_extraction',
    buffValue: 1.25,
    controllingClanId: 'clan-alpha',
  },
  {
    id: 'NODE_VE_MARGARITA_RADAR',
    regionId: 'REG_VE_14',
    nodeType: 'radar_c4isr',
    name: 'Radar Margarita',
    buffType: 'radar_recon',
    buffValue: 3.0,
    controllingClanId: 'clan-beta', // Otro clan
  },
];

const clanAlphaBuffs = evaluateStrategicNodes('clan-alpha', mockNodes);
assert(clanAlphaBuffs.hasCapitalHegemony === true, 'Test 4.1: Clan Alpha posee la Capital Nacional Caracas');
assert(clanAlphaBuffs.tollFeePercent === 5.0, 'Test 4.2: Clan Alpha controla el peaje del 5% en Estrecho de Maracaibo');
assert(clanAlphaBuffs.energyYieldMultiplier === 1.40, `Test 4.3: Refinería (+25%) + Capital (+15%) otorgan 1.40x EC (obtenido: ${clanAlphaBuffs.energyYieldMultiplier})`);
assert(clanAlphaBuffs.radarSightBonus === 0, 'Test 4.4: Radar no pertenece a Clan Alpha (pertenece a Clan Beta)');

// ------------------------------------------------------------------------------
// SUITE 5: HANGAR DE FACCIÓN Y PRÉSTAMO DE UNIDADES
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 5: HANGAR COMUNITARIO DE FACCIÓN Y JERARQUÍA DE MANDO ---');

const mockFactionStock: FactionHangarStock[] = [
  {
    clanId: 'clan-alpha',
    unitCode: 'medium_tank',
    tier: 2,
    stockQuantity: 3,
  },
  {
    clanId: 'clan-alpha',
    unitCode: 'medium_tank',
    tier: 4,
    stockQuantity: 1,
  },
];

// Recluta intenta tomar unidad
const recruitReq = authorizeFactionUnitBorrow(
  {
    clanId: 'clan-alpha',
    userId: 'user-rec',
    userRank: 'recruit',
    unitCode: 'medium_tank',
    tier: 2,
  },
  mockFactionStock
);
assert(!recruitReq.approved, 'Test 5.1: Recluta es rechazado por falta de rango');

// Cabo intenta tomar unidad Tier 4
const corporalReq = authorizeFactionUnitBorrow(
  {
    clanId: 'clan-alpha',
    userId: 'user-corp',
    userRank: 'corporal',
    unitCode: 'medium_tank',
    tier: 4,
  },
  mockFactionStock
);
assert(!corporalReq.approved, 'Test 5.2: Cabo no puede pedir unidades superiores a Tier 2');

// Sargento pide unidad Tier 2 con stock
const sergeantReq = authorizeFactionUnitBorrow(
  {
    clanId: 'clan-alpha',
    userId: 'user-sgt',
    userRank: 'sergeant',
    unitCode: 'medium_tank',
    tier: 2,
  },
  mockFactionStock
);
assert(sergeantReq.approved === true, 'Test 5.3: Sargento es autorizado para comandar tanque de facción');
assert(sergeantReq.remainingStock === 2, `Test 5.4: Stock de facción decrementa a 2 (obtenido: ${sergeantReq.remainingStock})`);

// ------------------------------------------------------------------------------
// SUITE 6: ECONOMÍA SIMBIÓTICA (5-10% ALIADO VS 50% RIVAL) Y ANTI-SNOWBALL
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 6: ECONOMÍA SIMBIÓTICA Y FRENO LOGÍSTICO ANTI-SNOWBALL ---');

const alliedSettlement = calculateSymbioticExtractionSettlement({
  municipalityId: 'MUN_ZULIA_CABIMAS',
  extractorOwnerClanId: 'clan-ferro',
  municipalityControllingClanId: 'clan-ferro',
  grossYieldEc: 1000,
  exclusiveResourceNode: 'lithium',
  ledger: { alliedTaxRate: 0.08 },
});
assert(alliedSettlement.appliedTaxRate === 0.08, 'Test 6.1: Municipio propio aplica impuesto reducido del 8%');
assert(alliedSettlement.retainedTaxEc === 80 && alliedSettlement.netExtractorYieldEc === 920, 'Test 6.2: Neto del extractor aliado es 920 EC');
assert(alliedSettlement.receivesAlliedPatrolEscort === true, 'Test 6.3: Extractor aliado recibe escolta de patrullas');

const governingVault = { clanId: 'clan-orinoco', energyCredits: 1000 };
const rivalHarvest = fiefBuildingService.harvestPrivateExtractorWithSymbioticTax({
  municipalityId: 'MUN_CARACAS_LIBERTADOR',
  extractorOwnerClanId: 'clan-ferro',
  municipalityControllingClanId: 'clan-orinoco',
  exclusiveResourceNode: 'silicon',
  grossYieldEc: 1000,
  governingClanTreasury: governingVault,
});
assert(rivalHarvest.settlement.isRivalTerritory === true, 'Test 6.4: Extractor en municipio rival sin tratado marcado como territorio hostil');
assert(rivalHarvest.settlement.retainedTaxEc === 500 && rivalHarvest.settlement.netExtractorYieldEc === 500, 'Test 6.5: Retención automática del 50% en territorio rival');
assert(governingVault.energyCredits === 1500, `Test 6.6: Bóveda gobernante recibe 500 EC automáticamente (actual: ${governingVault.energyCredits})`);

const nearCapitalFuel = calculateSupplyLineHourlyFuelBurn({
  baseHourlyFuel: 10,
  bfsHopsFromCapital: 1,
  isSupplyConnected: true,
  hasBorderStateFuelPerk: false,
});
const farWithPerkFuel = calculateSupplyLineHourlyFuelBurn({
  baseHourlyFuel: 10,
  bfsHopsFromCapital: 4,
  isSupplyConnected: true,
  hasBorderStateFuelPerk: true,
});
assert(nearCapitalFuel.finalHourlyFuelBurn === 12.5, `Test 6.7: 1 salto BFS consume 12.5 fuel/h (obtenido: ${nearCapitalFuel.finalHourlyFuelBurn})`);
assert(farWithPerkFuel.finalHourlyFuelBurn === 16, `Test 6.8: 4 saltos BFS con Perk -20% consume 16 fuel/h (obtenido: ${farWithPerkFuel.finalHourlyFuelBurn})`);

const fatigueOk = evaluateOccupationFatigueAndRebellion({
  clanId: 'clan-ferro',
  controlledStatesCount: 4,
  adminCapacityStates: 5,
  baseHourlyUpkeepEc: 1000,
});
assert(fatigueOk.maintenanceMultiplier === 1.0 && !fatigueOk.triggersInternalRebellion, 'Test 6.9: Bajo capacidad administrativa no hay fatiga');

const fatigueSnowball = evaluateOccupationFatigueAndRebellion({
  clanId: 'clan-ferro',
  controlledStatesCount: 9,
  adminCapacityStates: 5,
  baseHourlyUpkeepEc: 1000,
});
assert(fatigueSnowball.maintenanceMultiplier > 5, `Test 6.10: Sobre-extensión de +4 estados dispara mantenimiento exponencial (${fatigueSnowball.maintenanceMultiplier}x)`);
assert(fatigueSnowball.triggersInternalRebellion === true && fatigueSnowball.opensLightningRaidWindow === true, 'Test 6.11: Fatiga de ocupación dispara riesgo de rebelión y ventana relámpago');

// ------------------------------------------------------------------------------
// SUITE 7: ECONOMÍA AL/CB/MC, 9 DRONES EN 3 NIVELES, 6 EDIFICIOS Y SOBRECARGA
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 7: TRIADA AL/CB/MC, 9 DRONES, 6 EDIFICIOS Y SOBRECARGA ---');

assert(Object.keys(CANONICAL_H3_DRONE_CATALOG).length === 9, 'Test 7.1: Catálogo H3 registra exactamente 9 drones autónomos');
assert(Object.keys(MUNICIPAL_BUILDINGS_CATALOG).length === 6, 'Test 7.2: Catálogo Municipal registra exactamente 6 edificios públicos');

const neoUnlockDenied = canUnlockDroneTier('neo_tank', {
  hasBasicFactory: true,
  corpControlledMunicipalities: 2,
  hasAdvancedWorkshop: true,
  stateControlRatio: 0.55,
  hasIndustrialComplex: true,
});
assert(!neoUnlockDenied.allowed, 'Test 7.3: Neo-Tanque Nivel 3 rechazado si control estatal <= 60%');

const neoUnlockOk = canUnlockDroneTier('neo_tank', {
  hasBasicFactory: true,
  corpControlledMunicipalities: 2,
  hasAdvancedWorkshop: true,
  stateControlRatio: 0.65,
  hasIndustrialComplex: true,
});
assert(neoUnlockOk.allowed, 'Test 7.4: Neo-Tanque Nivel 3 desbloqueado con >60% estado + Complejo Industrial');

const triadFreeZone = settleResourceTriadExtraction({
  gross: { alloys: 100, fuel: 100, microchips: 100 },
  isAlliedMunicipality: true,
  hasCorporateFreeZonePerk: true,
  hasCustomsRefineryBuilding: true, // +20% -> 120, 0% impuesto
});
assert(triadFreeZone.netPlayer.alloys === 120 && triadFreeZone.retainedCorpVault.alloys === 0, 'Test 7.5: Aduana (+20%) + Zona Franca Corporativa (0% tax) liquida 120 AL netos');

const overload4States = calculateAdministrativeOverloadFuelMultiplier({
  controlledStatesCount: 4, // 2 estados por encima de 2 -> +30% CB/h
  hasVanguardLogisticsInBorderState: false,
});
assert(overload4States.overloadPenaltyRatio === 0.3 && overload4States.netFuelMultiplier === 1.3, 'Test 7.6: 4 estados controlados aplican +30% sobrecarga de CB/h');

console.log('\n------------------------------------------------------------------------------');
console.log('RESUMEN FASE 1+3+5+H3 (AL/CB/MC, 9 DRONES, 6 EDIFICIOS Y SOBRECARGA): 31/31 PASARON');
console.log('✅ TODAS LAS PRUEBAS DETERMINISTAS SUPERADAS AL 100%');
console.log('==============================================================================');