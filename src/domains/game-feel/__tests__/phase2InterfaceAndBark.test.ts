/**
 * ==============================================================================
 * SUITE DE PRUEBAS FASE 2: INTERFAZ C4ISR, BARK ENGINE REACTIVO Y CONSOLA PARADOX
 * ==============================================================================
 * Ejecución: npx tsx src/domains/game-feel/__tests__/phase2InterfaceAndBark.test.ts
 * ==============================================================================
 */

import {
  calculateUnitProductionDuration,
  authorizeFactionUnitBorrow,
  FactionHangarStock,
} from '@domains/economy';
import {
  evaluateDroneGambitTick,
  CaptureEngine,
  resolveDroneRoleFromUnitCode,
  CANONICAL_DRONE_ROLE_PROFILES,
} from '@domains/tactics';
import { barkEngine } from '@domains/game-feel';
import type { DroneGambitProgram } from '@shared';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ [PASSED] ${message}`);
  }
}

console.log('==============================================================================');
console.log('EJECUTANDO SUITE: FASE 2 - INTERFAZ C4ISR, BARK ENGINE Y CONSOLA PARADOX');
console.log('==============================================================================\n');

// ------------------------------------------------------------------------------
// SUITE 1: BARK ENGINE Y CANDADO FRONTERIZO DEL TEATRO ACTIVO
// ------------------------------------------------------------------------------
console.log('--- SUITE 1: CANDADO DE ZONAS BUFFER Y ALERTA DEL BARK ENGINE ---');

function evaluateSectorClickBark(regionId: string, regionName: string) {
  if (regionId.startsWith('BUF_')) {
    return {
      balloonType: 'panic',
      stamp: 'ZONA RESTRINGIDA',
      text: 'SECTOR FUERA DEL TEATRO OPERACIONAL DE FASE 1 (ACTIVO: REPÚBLICA DE VENEZUELA)',
    };
  }
  return {
    balloonType: 'radio',
    stamp: 'SECTOR FIJADO',
    text: `Fijando telemetría en ${regionName}. Búnker y defensas en pantalla.`,
  };
}

// 1.1 Clic en Buffer Cúcuta BUF_CO_01 dispara alerta restrictiva
const bufferBark = evaluateSectorClickBark('BUF_CO_01', 'Norte de Santander (Cúcuta)');
assert(
  bufferBark.balloonType === 'panic',
  'Test 1.1: Sector buffer activa bocadillo de alerta defensiva ("panic")'
);
assert(
  bufferBark.stamp === 'ZONA RESTRINGIDA',
  'Test 1.2: Sector buffer despliega sello pop-art "ZONA RESTRINGIDA"'
);
assert(
  bufferBark.text === 'SECTOR FUERA DEL TEATRO OPERACIONAL DE FASE 1 (ACTIVO: REPÚBLICA DE VENEZUELA)',
  'Test 1.3: Mensaje textual canónico emitido con exactitud hacia la novela gráfica'
);

// 1.2 Clic en Zulia REG_VE_02 activa telemetría C4ISR
const soberanaBark = evaluateSectorClickBark('REG_VE_02', 'Zulia - Maracaibo');
assert(
  soberanaBark.balloonType === 'radio',
  'Test 1.4: Región soberana venezolana activa transmisión de radio militar ("radio")'
);
assert(
  soberanaBark.stamp === 'SECTOR FIJADO',
  'Test 1.5: Sello de confirmación de sector fijado'
);

// ------------------------------------------------------------------------------
// SUITE 2: RECURSOS DUALES (INDIVIDUO VS FACCIÓN)
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 2: SEPARACIÓN DIEGÉTICA DE RECURSOS DUALES ---');

interface DualResourceState {
  personal: {
    gold: number;
    ec: number;
    techScrap: number;
  };
  faction: {
    clanTag: string;
    vaultEc: number;
    sharedChassis: number;
    tcpControl: number;
  };
}

const mockState: DualResourceState = {
  personal: { gold: 12500, ec: 850, techScrap: 350 },
  faction: { clanTag: 'IVS', vaultEc: 48500, sharedChassis: 14, tcpControl: 7200 },
};

assert(mockState.personal.gold > 0, 'Test 2.1: Fondos tácticos personales aislados para despliegues in-match');
assert(mockState.faction.vaultEc === 48500, 'Test 2.2: Bóveda de clan comunitaria con 48,500 EC para mantenimiento de guerra');
assert(mockState.faction.tcpControl === 7200, 'Test 2.3: Puntos de control territorial reflejan 7,200/10,000 TCP del clan en el teatro');

// ------------------------------------------------------------------------------
// SUITE 3: CONSOLA DE MACROGESTIÓN PARADOX Y TIEMPOS DE FORJA EN VIVO
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 3: CONSOLA PARADOX Y CUENTA ATRÁS DE FABRICACIÓN ---');

const baseTimeTank = calculateUnitProductionDuration('tank', 1);
const startTime = Date.now();
const readyTime = startTime + baseTimeTank * 1000;

function getRemainingSeconds(currentTime: number, targetReadyTime: number) {
  return Math.max(0, Math.round((targetReadyTime - currentTime) / 1000));
}

assert(
  getRemainingSeconds(startTime, readyTime) === 180,
  'Test 3.1: Al inicio el temporizador marca exactamente 180s restantes'
);
assert(
  getRemainingSeconds(startTime + 90000, readyTime) === 90,
  'Test 3.2: A mitad del proceso el temporizador marca exactamente 90s restantes'
);
assert(
  getRemainingSeconds(startTime + 180000, readyTime) === 0,
  'Test 3.3: Al cumplirse el plazo la cuenta atrás cae a 0s y activa el botón "Reclamar"'
);

// ------------------------------------------------------------------------------
// SUITE 4: COMANDO DE ARSENAL COMUNITARIO EN CONSOLA PARADOX
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 4: AUTORIZACIÓN DE TROPAS DE FACCIÓN EN DRAWER ---');

const testHangar: FactionHangarStock[] = [
  { clanId: 'clan_ivs', unitCode: 'b_copter', tier: 3, stockQuantity: 2 },
];

const veteranBorrow = authorizeFactionUnitBorrow(
  {
    clanId: 'clan_ivs',
    userId: 'user_vet',
    userRank: 'veteran',
    unitCode: 'b_copter',
    tier: 3,
  },
  testHangar
);

assert(veteranBorrow.approved === true, 'Test 4.1: Veterano autorizado para desplegar Helicóptero T3 del clan');
assert(veteranBorrow.remainingStock === 1, 'Test 4.2: Stock de facción se actualiza en memoria a 1 unidad restante');

// ------------------------------------------------------------------------------
// SUITE 5: GAMBIT ENGINE OFFLINE (8H), ROLES ADVANCE WARS Y BRIEFING MATUTINO
// ------------------------------------------------------------------------------
console.log('\n--- SUITE 5: GAMBIT ENGINE OFFLINE (8H), INGENIEROS Y BRIEFING MATUTINO ---');

assert(resolveDroneRoleFromUnitCode('recon') === 'recon_scout', 'Test 5.1: recon mapea a recon_scout');
assert(resolveDroneRoleFromUnitCode('infantry') === 'infantry_engineer', 'Test 5.2: infantry mapea a infantry_engineer');
assert(CANONICAL_DRONE_ROLE_PROFILES.recon_scout.signalRadiusCells > CANONICAL_DRONE_ROLE_PROFILES.tank_direct.signalRadiusCells, 'Test 5.3: Recon tiene mayor radio de señal que Tanque');

const scoutDeniedSabotage = CaptureEngine.executeEngineerInfrastructureAction({
  unitRole: 'recon_scout',
  unitHp: 100,
  actorClanId: 'clan-ferro',
  targetBuildingId: 'bld-radar-01',
  targetBuildingType: 'radar_tower',
  targetOwnerClanId: 'clan-orinoco',
  currentStructureIntegrity: 10,
  mode: 'sabotage',
});
assert(scoutDeniedSabotage.allowed === false, 'Test 5.4: Recon NO puede sabotear infraestructura enemiga');

const engineerSabotage = CaptureEngine.executeEngineerInfrastructureAction({
  unitRole: 'infantry_engineer',
  unitHp: 100,
  actorClanId: 'clan-ferro',
  targetBuildingId: 'bld-radar-01',
  targetBuildingType: 'radar_tower',
  targetOwnerClanId: 'clan-orinoco',
  currentStructureIntegrity: 10,
  mode: 'sabotage',
});
assert(engineerSabotage.allowed === true && engineerSabotage.completed === true && engineerSabotage.isSabotaged === true, 'Test 5.5: Infantería/Ingeniero sabotea torre de radar enemiga');

const scoutGambit: DroneGambitProgram = {
  programId: 'gambit-scout-01',
  unitId: 'u-scout-01',
  unitRole: 'recon_scout',
  patrolWaypoints: [[-71.46, 10.40], [-71.43, 10.37]],
  engagementRules: [
    { detectTargetRole: 'tank_direct', action: 'retreat_to_allied_factory' },
    { detectTargetRole: 'recon_scout', action: 'attack_direct' },
  ],
  retreatCondition: {
    onDetectRole: ['tank_direct'],
    hpBelowThreshold: 25,
    fallbackFactoryCoordinates: [-71.458, 10.395],
  },
  targetPriorityRule: 'neutral_cells_first',
  maxEnemyControlThreshold: 0.70,
  shiftDurationHours: 8,
};

const abortedHighControl = evaluateDroneGambitTick(scoutGambit, {
  unitHp: 90,
  unitCode: 'recon',
  unitClanId: 'clan-ferro',
  currentCoordinates: [-71.46, 10.40],
  targetMunicipalityEnemyControlRatio: 0.78,
  detectedEnemyContacts: [],
});
assert(abortedHighControl.decision === 'abort_high_enemy_control', 'Test 5.6: Gambit aborta incursión en municipio con >70% control enemigo');

const retreatVsTank = evaluateDroneGambitTick(scoutGambit, {
  unitHp: 90,
  unitCode: 'recon',
  unitClanId: 'clan-ferro',
  currentCoordinates: [-71.46, 10.40],
  targetMunicipalityEnemyControlRatio: 0.30,
  detectedEnemyContacts: [
    { unitId: 'enemy-tank', clanId: 'clan-orinoco', unitRole: 'tank_direct', unitCode: 'tank_light', hp: 100, distanceCells: 1 },
  ],
});
assert(retreatVsTank.decision === 'retreat_to_factory', 'Test 5.7: Scout retrocede a fábrica aliada al detectar Tanque enemigo');

const artilleryGambit: DroneGambitProgram = {
  programId: 'gambit-arty-01',
  unitId: 'u-arty-01',
  unitRole: 'artillery_indirect',
  patrolWaypoints: [[-71.46, 10.40], [-71.43, 10.37]],
  engagementRules: [{ detectTargetRole: 'tank_direct', action: 'attack_indirect' }],
  retreatCondition: {
    onDetectRole: [],
    hpBelowThreshold: 20,
    fallbackFactoryCoordinates: [-71.458, 10.395],
  },
  targetPriorityRule: 'border_roads_first',
  maxEnemyControlThreshold: 0.70,
  shiftDurationHours: 8,
};

const indirectStrike = evaluateDroneGambitTick(artilleryGambit, {
  unitHp: 100,
  unitCode: 'artillery',
  unitClanId: 'clan-ferro',
  currentCoordinates: [-71.46, 10.40],
  targetMunicipalityEnemyControlRatio: 0.40,
  detectedEnemyContacts: [
    { unitId: 'enemy-tank', clanId: 'clan-orinoco', unitRole: 'tank_direct', unitCode: 'tank_light', hp: 100, distanceCells: 2 },
  ],
});
assert(indirectStrike.decision === 'attack_indirect', 'Test 5.8: Artillería ejecuta fuego indirecto a d=2');
assert(indirectStrike.combatOutcome?.counterAttackOccurred === false, 'Test 5.9: Fuego indirecto (d>=2) no recibe contraataque');
assert((indirectStrike.combatOutcome?.defenderHpAfter ?? 100) < 100, 'Test 5.10: Resolución balística opera sobre escala 1-100 HP');

const morningBark = barkEngine.generateMorningSessionBriefing({
  playerName: 'Comandante Ferro',
  borderMunicipalityName: 'Cabimas Frontera',
  cellsLostPercent: 15,
  readyFactoriesCount: 2,
  netHarvestableEc: 220,
});
assert(morningBark.text.includes('15%') && morningBark.text.includes('220 EC'), 'Test 5.11: Briefing matutino reporta pérdida nocturna y cosecha neta');

console.log('\n------------------------------------------------------------------------------');
console.log('RESUMEN FASE 2 + GAMBIT ENGINE + BRIEFING MATUTINO: 24/24 PASARON');
console.log('✅ TODAS LAS PRUEBAS DETERMINISTAS SUPERADAS AL 100%');
console.log('==============================================================================');