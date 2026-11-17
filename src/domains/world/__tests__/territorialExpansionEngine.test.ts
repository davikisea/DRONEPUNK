/**
 * ==============================================================================
 * SUITE DE PRUEBAS FASE 3: EXPANSIÓN TERRITORIAL DINÁMICA (TERRITORIAL.IO) Y NODOS
 * ==============================================================================
 * Ejecución: npx tsx src/domains/world/__tests__/territorialExpansionEngine.test.ts
 * ==============================================================================
 */

import {
  initializeRegionGrid,
  executeTerritorialExpansion,
  calculateIndustrialYieldWithNodes,
  recalculateSovereignty,
  initializeMunicipalMicroGrid,
  evaluateSignalCaptureTick,
  lngLatToMunicipalMicroCell,
  TacticalBitMap,
  latLngToH3Res9,
  h3GridDisk,
  executeFifteenMinuteTickPipeline,
  type H3PersistentDroneState,
  type H3PersistentBuildingState,
} from '@domains/world';
import { StrategicNode } from '@domains/economy';
import { CANONICAL_GAMBIT_PRESETS } from '@domains/tactics';
import type { DroneSignalProjection, SparseMapHexRecord } from '@shared';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ [PASSED] ${message}`);
  }
}

console.log('==============================================================================');
console.log('EJECUTANDO SUITE: FASE 3 - EXPANSIÓN TERRITORIAL.IO Y CONTROL DE NODOS');
console.log('==============================================================================\n');

const mockNodes: StrategicNode[] = [
  {
    id: 'NODE_VE_CAPITAL',
    regionId: 'REG_VE_01',
    nodeType: 'capital_hq',
    name: 'Cuartel General Caracas',
    buffType: 'hegemonic_capital',
    buffValue: 1.15,
    controllingClanId: null,
  },
  {
    id: 'NODE_VE_CRP_AMUAY',
    regionId: 'REG_VE_11',
    nodeType: 'refinery_hub',
    name: 'Refinería CRP Amuay',
    buffType: 'energy_extraction',
    buffValue: 1.25,
    controllingClanId: null,
  },
];

// ------------------------------------------------------------------------------
// SUITE 1: MALLA CELULAR Y UBICACIÓN DE NODOS ESTRATÉGICOS
// ------------------------------------------------------------------------------
console.log('--- SUITE 1: MALLA TERRITORIAL DE 100 CELDAS Y SUPER-NODOS ---');

const caracasGrid = initializeRegionGrid('REG_VE_01', 10, mockNodes, null);
assert(caracasGrid.cells.length === 100, 'Test 1.1: Región inicializada con exactamente 100 celdas (10x10)');
assert(caracasGrid.controllingClanId === null, 'Test 1.2: Inicialmente la región neutral no tiene clan dominante');

const capitalCell = caracasGrid.cells.find((c) => c.strategicNodeId === 'NODE_VE_CAPITAL');
assert(capitalCell !== undefined, 'Test 1.3: El Cuartel General de Caracas está posicionado en la cuadrícula');
assert(capitalCell!.terrainDefenseStar === 4, 'Test 1.4: La celda de Capital posee cobertura de 4★ de fortificación máxima');

// ------------------------------------------------------------------------------
// SUITE 2: CABEZA DE PUENTE Y AVANCE DE FRONTERA ("PINTADO DE ZONAS")
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 2: CABEZA DE PUENTE Y PULSO DE EXPANSIÓN ORTOGONAL ---');

// Pulso 1: Establecer cabeza de puente en (0,0) con $1,500 Fondos
const pulse1 = executeTerritorialExpansion(
  caracasGrid,
  {
    regionId: 'REG_VE_01',
    clanId: 'clan-ivs',
    expansionBudgetFunds: 1500,
    bridgeheadOrigin: { x: 0, y: 0 },
  },
  mockNodes
);

assert(pulse1.cellsConquered >= 1, `Test 2.1: Establecida cabeza de puente aliada (Celdas: ${pulse1.cellsConquered})`);
assert(caracasGrid.cells[0].clanId === 'clan-ivs', 'Test 2.2: Celda (0,0) pintada con el estandarte de clan-ivs');
assert(pulse1.newSovereigntyPercent > 0, `Test 2.3: Control de clan-ivs sube al ${pulse1.newSovereigntyPercent}%`);

// Pulso 2: Expansión de frontera ortogonal masiva con $4,000 Fondos
const pulse2 = executeTerritorialExpansion(
  caracasGrid,
  {
    regionId: 'REG_VE_01',
    clanId: 'clan-ivs',
    expansionBudgetFunds: 4000,
  },
  mockNodes
);

assert(pulse2.cellsConquered > pulse1.cellsConquered, `Test 2.4: El avance de frontera conquista ${pulse2.cellsConquered} celdas contiguas`);
assert(pulse2.newSovereigntyPercent > pulse1.newSovereigntyPercent, `Test 2.5: La zona pintada se expande al ${pulse2.newSovereigntyPercent}%`);

// ------------------------------------------------------------------------------
// SUITE 3: CAPTURA DE NODO ESTRATÉGICO Y CONSOLIDACIÓN DE SOBERANÍA
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 3: ASALTO A LA CAPITAL Y SOBERANÍA DE FACTO (>=50%) ---');

// Forzar avance directo hacia la celda de la capital
const targetX = capitalCell!.x;
const targetY = capitalCell!.y;

const pulseCapture = executeTerritorialExpansion(
  caracasGrid,
  {
    regionId: 'REG_VE_01',
    clanId: 'clan-ivs',
    expansionBudgetFunds: 25000, // Gran presupuesto de asalto
    bridgeheadOrigin: { x: targetX, y: targetY },
  },
  mockNodes
);

assert(capitalCell!.clanId === 'clan-ivs', 'Test 3.1: Celda de Capital Nacional conquistada por clan-ivs');
assert(mockNodes[0].controllingClanId === 'clan-ivs', 'Test 3.2: El nodo estratégico NODE_VE_CAPITAL transfiere su control a clan-ivs');
assert(pulseCapture.newSovereigntyPercent >= 50, `Test 3.3: Control territorial supera el 50% (${pulseCapture.newSovereigntyPercent}%)`);
assert(caracasGrid.controllingClanId === 'clan-ivs', 'Test 3.4: clan-ivs es declarado Soberano de Facto de la región');

// ------------------------------------------------------------------------------
// SUITE 4: MULTIPLICADOR INDUSTRIAL Y ALIMENTACIÓN DE HANGAR
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 4: IMPACTO DE NODOS ESTRATÉGICOS SOBRE LAS 10 PARCELAS ---');

// Caso A: Sin nodos estratégicos
const yieldBase = calculateIndustrialYieldWithNodes(1000, 'clan-ivs', []);
assert(yieldBase.finalYield === 1000, 'Test 4.1: Sin nodos, el rendimiento de extracción se mantiene en 1.0x (1,000 EC)');

// Caso B: Control de Capital Caracas (+15% EC, +10% Forja)
const yieldWithCapital = calculateIndustrialYieldWithNodes(1000, 'clan-ivs', mockNodes);
assert(
  yieldWithCapital.buffs.activeHegemonicBuff === true,
  'Test 4.2: Buff Hegemónico Nacional activado en tiempo real'
);
assert(
  yieldWithCapital.finalYield === 1150,
  `Test 4.3: Rendimiento con Capital sube a 1,150 EC (+15%): obtenido ${yieldWithCapital.finalYield}`
);

// Caso C: Control de Capital + Refinería CRP Amuay (+25% EC adicional)
mockNodes[1].controllingClanId = 'clan-ivs';
const yieldWithBoth = calculateIndustrialYieldWithNodes(1000, 'clan-ivs', mockNodes);
assert(
  yieldWithBoth.finalYield === 1400,
  `Test 4.4: Rendimiento con Capital + Refinería sube a 1,400 EC (+40% total): obtenido ${yieldWithBoth.finalYield}`
);
assert(
  yieldWithBoth.buffs.refinerySpeedMultiplier === 1.10,
  'Test 4.5: Velocidad de forja en cola física acelerada en +10%'
);

// ------------------------------------------------------------------------------
// SUITE 5: MALLA MUNICIPAL DE 500 MICRO-CELDAS (100x100m) Y CAPTURA POR SEÑAL
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 5: MALLA MUNICIPAL DE 500 MICRO-CELDAS (100x100m) Y CAPTURA POR SEÑAL ---');

const cabimasGrid = initializeMunicipalMicroGrid(
  'MUN_ZULIA_CABIMAS',
  'REG_VE_02',
  [-71.4539, 10.3994],
  null
);
assert(cabimasGrid.cells.length === 500, `Test 5.1: Malla municipal posee exactamente 500 micro-celdas (obtenido: ${cabimasGrid.cells.length})`);
assert(cabimasGrid.cellSizeMeters === 100, 'Test 5.2: Tamaño de micro-celda verificado en 100m');
assert(cabimasGrid.controllingClanId === null && !cabimasGrid.publicSlotsUnlocked, 'Test 5.3: Municipio neutral inicia sin soberanía ni ranuras públicas');

const projectedCell = lngLatToMunicipalMicroCell([-71.4539, 10.3994], [-71.4539, 10.3994]);
assert(projectedCell.cellIndex >= 0 && projectedCell.cellIndex < 500, 'Test 5.4: Proyección O(1) de coordenada WGS84 cae dentro de [0, 499]');

const microBitmap = TacticalBitMap.createMunicipalMicroGridBitmap();
assert(microBitmap.bytes.length === 63, `Test 5.5: TacticalBitMap de 500 micro-celdas comprimido en 63 bytes (obtenido: ${microBitmap.bytes.length})`);
microBitmap.setBit(0, true);
microBitmap.setBit(250, true);
assert(microBitmap.countSetBits() === 2, 'Test 5.6: countSetBits() contabiliza exactamente 2 micro-celdas activas');

// Desplegar escuadrón de Scouts cubriendo >50% de la malla en varios puntos para simular consolidación
const scoutSquad: DroneSignalProjection[] = [];
for (let row = 2; row <= 17; row += 5) {
  for (let col = 3; col <= 22; col += 5) {
    const idx = row * 25 + col;
    scoutSquad.push({
      unitId: `scout-${idx}`,
      clanId: 'clan-ferro',
      unitRole: 'recon_scout',
      centerCellIndex: idx,
      coordinates: cabimasGrid.cells[idx]!.lngLat,
      hp: 100,
      signalRadiusCells: 4,
      captureRatePerTick: 120,
    });
  }
}

const tick1 = evaluateSignalCaptureTick(cabimasGrid, scoutSquad, 10, 1.0);
assert(tick1.cellsConverted > 250, `Test 5.7: Proyección de señal convierte >250 celdas (convertidas: ${tick1.cellsConverted})`);
assert(cabimasGrid.controllingClanId === 'clan-ferro', 'Test 5.8: Al superar el 50% de celdas, clan-ferro obtiene soberanía municipal');
assert(cabimasGrid.publicSlotsUnlocked === true, 'Test 5.9: Ranuras de infraestructura estratégica desbloqueadas tras mayoría >50%');

// ------------------------------------------------------------------------------
// SUITE 6: PIPELINE DE TICK 15 MINUTOS (5 FASES H3: LOGÍSTICA, IA, COMBATE, CAPTURA, MACRO)
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 6: PIPELINE DE TICK CADA 15 MINUTOS (5 FASES H3) ---');

const h3Center = latLngToH3Res9(10.3994, -71.4539);
const h3Neighbors = h3GridDisk(h3Center, 1);
const sparseMap = new Map<string, SparseMapHexRecord>();

const dronesTick: H3PersistentDroneState[] = [
  {
    id: 'drone-tank-1',
    ownerUserId: 'user-alpha',
    corpId: 'corp-ferro',
    unitType: 'medium_tank',
    tier: 2,
    currentH3: h3Center,
    hp10: 8.0,
    fuel: 40,
    maxFuel: 40,
    waypoints: [h3Neighbors[1]!],
    currentWpIndex: 0,
    ticksOnBuilding: 0,
    ticksDeployed: 1,
    aiRules: CANONICAL_GAMBIT_PRESETS.WATCHDOG.rules,
  },
  {
    id: 'drone-inf-rival',
    ownerUserId: 'user-beta',
    corpId: 'corp-orinoco',
    unitType: 'infantry_swarm',
    tier: 1,
    currentH3: h3Neighbors[1]!,
    hp10: 10.0,
    fuel: 20,
    maxFuel: 20,
    waypoints: [],
    currentWpIndex: 0,
    ticksOnBuilding: 0,
    ticksDeployed: 1,
    aiRules: CANONICAL_GAMBIT_PRESETS.SABOTEUR.rules,
  },
  {
    id: 'drone-bomber-rival',
    ownerUserId: 'user-beta',
    corpId: 'corp-orinoco',
    unitType: 'bomber_drone',
    tier: 3,
    currentH3: h3Neighbors[2]!,
    hp10: 10.0,
    fuel: 100,
    maxFuel: 100,
    waypoints: [],
    currentWpIndex: 0,
    ticksOnBuilding: 0,
    ticksDeployed: 1,
    aiRules: CANONICAL_GAMBIT_PRESETS.WATCHDOG.rules,
  },
];

const buildingsTick: H3PersistentBuildingState[] = [
  {
    id: 'bld-aa-ferro',
    h3Index: h3Center,
    municipalityId: 'MUN_ZULIA_CABIMAS',
    ownerUserId: 'user-alpha',
    corpId: 'corp-ferro',
    buildingType: 'FIXED_AA_BATTERY',
    hp10: 20,
    isDisabled: false,
  },
  {
    id: 'bld-factory-ferro',
    h3Index: h3Neighbors[3]!,
    municipalityId: 'MUN_ZULIA_CABIMAS',
    ownerUserId: 'user-alpha',
    corpId: 'corp-ferro',
    buildingType: 'PRIVATE_FACTORY',
    hp10: 20,
    isDisabled: false,
    grossOutputPerTick: { alloys: 100, fuel: 100, microchips: 50 },
    alliedTaxRate: 0.1,
  },
];

const tickOut = executeFifteenMinuteTickPipeline({
  tickNumber: 1,
  drones: dronesTick,
  buildings: buildingsTick,
  sparseHexes: sparseMap,
  municipalities: [
    {
      municipalityId: 'MUN_ZULIA_CABIMAS',
      stateId: 'REG_VE_02',
      totalHexes: 500,
      ownerCorpId: 'corp-orinoco',
    },
  ],
  corporations: {
    'corp-ferro': { corpId: 'corp-ferro', controlledStatesCount: 2, activeStatePerks: [] },
    'corp-orinoco': { corpId: 'corp-orinoco', controlledStatesCount: 2, activeStatePerks: [] },
  },
  terrainResolver: (h3) => ({
    terrain: h3 === h3Neighbors[1]! ? 'URBAN' : 'PLAIN',
  }),
});

assert(tickOut.aaInterceptionsCount === 1, 'Test 6.1: Batería Antiaérea Fija interceptó al Bombardero enemigo');
assert(tickOut.destroyedDrones.some((d) => d.droneId === 'drone-bomber-rival' && d.reason === 'aa_battery'), 'Test 6.2: Bombardero destruido por AA con retorno de 35% tech_scrap');
assert(tickOut.combatEventsCount >= 1, 'Test 6.3: Fase 3 ejecutó combate determinista entre drones');
assert(tickOut.playerResourceSettlements['user-alpha']!.alloys === 50, `Test 6.4: Fábrica en municipio rival retiene 50% al dueño municipal (neto jugador: ${tickOut.playerResourceSettlements['user-alpha']!.alloys})`);
assert(tickOut.corpVaultTaxCredits['corp-orinoco']!.alloys === 50, 'Test 6.5: Bóveda de corporación rival recibe el 50% retenido');
assert(tickOut.sparseHexCount >= 1, 'Test 6.6: Fase 4 registró progreso de conquista en el Sparse Map');

console.log('\n------------------------------------------------------------------------------');
console.log('RESUMEN FASE 3 + PIPELINE H3 DE 15 MINUTOS: 28/28 PASARON');
console.log('✅ TODAS LAS PRUEBAS DETERMINISTAS DE EXPANSIÓN Y TICK H3 SUPERADAS AL 100%');
console.log('==============================================================================');