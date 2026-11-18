/**
 * ==============================================================================
 * SUITE DETERMINISTA: LOGÍSTICA DUAL, POBLACIÓN, BASES HISTÓRICAS, DEVASTACIÓN
 *                     Y PROGRAMACIÓN DE DRONES (MMO 2D EN TIEMPO REAL)
 * ==============================================================================
 */

import {
  HISTORICAL_CITY_BASES_SEED,
  calculateBuildingPendingYield,
  simulateDualLogisticsTick,
  simulateInfrastructureDamageAndRepair,
  type DualSimBuilding,
  type DualSimEdge,
  type DualSimCollector,
} from '@domains/economy';
import { latLngToH3Res9, h3Res9ToLatLng } from '@domains/world';
import { TacticalRtsEngine } from '@domains/tactics';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`❌ [FAILED]: ${msg}`);
  }
}

console.log('==============================================================================');
console.log('SUITE: LOGÍSTICA DUAL, BASES HISTÓRICAS, DEVASTACIÓN & DRONES PROGRAMADOS');
console.log('==============================================================================\n');

let passed = 0;

// 1. Semilla de Bases Históricas + SafeInteger H3 Res 9 Round-Trip
{
  assert(
    HISTORICAL_CITY_BASES_SEED.length >= 24,
    `Deben existir al menos 24 bases históricas sembradas (actual: ${HISTORICAL_CITY_BASES_SEED.length})`
  );
  const hasHq = HISTORICAL_CITY_BASES_SEED.some((b) => b.building_type === 'hq' && b.is_historical);
  const hasFactory = HISTORICAL_CITY_BASES_SEED.some((b) => b.building_type === 'factory' && b.is_historical);
  const hasPort = HISTORICAL_CITY_BASES_SEED.some((b) => b.building_type === 'port' && b.is_historical);
  const hasAirport = HISTORICAL_CITY_BASES_SEED.some((b) => b.building_type === 'airport' && b.is_historical);
  assert(hasHq && hasFactory && hasPort && hasAirport, 'Debe haber bases históricas HQ, Factory, Port y Airport');

  for (const base of HISTORICAL_CITY_BASES_SEED) {
    assert(Number.isSafeInteger(base.h3_index), `h3_index de ${base.id} debe ser SafeInteger IEEE-754`);
    const [lat, lng] = h3Res9ToLatLng(BigInt(base.h3_index));
    const roundTrip = Number(latLngToH3Res9(lat, lng));
    assert(roundTrip === base.h3_index, `Round-trip H3 falló en ${base.id}`);
  }
  console.log(`✅ [PASSED] Test 1: ${HISTORICAL_CITY_BASES_SEED.length} Bases Históricas de Ciudad + H3 SafeInteger`);
  passed++;
}

// 2. Logística Dual: Tubería Continua vs Almacén Finito (storage_cap=250) + Unidad Recolectora
{
  const corpId = 'corp-ferro';
  const depotH3 = Number(latLngToH3Res9(10.3994, -71.4539));
  const pipedExtH3 = Number(latLngToH3Res9(10.405, -71.4539));
  const isolatedExtH3 = Number(latLngToH3Res9(10.42, -71.4539));

  const buildings: DualSimBuilding[] = [
    {
      id: 'b-depot',
      corpId,
      buildingType: 'depot',
      h3Index: depotH3,
      level: 1,
      hp: 30,
      maxHp: 30,
      infraState: 'OPERATIONAL',
      isHistorical: false,
      storageCap: 500,
      stored: { alloys: 0, fuel: 0, chips: 0 },
      isProductionHalted: false,
    },
    {
      id: 'b-ext-piped',
      corpId,
      buildingType: 'extractor',
      h3Index: pipedExtH3,
      level: 1,
      hp: 20,
      maxHp: 20,
      infraState: 'OPERATIONAL',
      isHistorical: false,
      storageCap: 250,
      stored: { alloys: 10, fuel: 5, chips: 2 },
      isProductionHalted: false,
    },
    {
      id: 'b-ext-isolated',
      corpId,
      buildingType: 'extractor',
      h3Index: isolatedExtH3,
      level: 2,
      hp: 20,
      maxHp: 20,
      infraState: 'OPERATIONAL',
      isHistorical: false,
      storageCap: 250,
      stored: { alloys: 180, fuel: 40, chips: 20 }, // 240/250
      isProductionHalted: false,
    },
  ];

  const edges: DualSimEdge[] = [
    {
      id: 'e-pipe-1',
      corpId,
      edgeType: 'pipeline',
      fromH3: depotH3,
      toH3: pipedExtH3,
      hp: 15,
      maxHp: 15,
      status: 'operational',
    },
  ];

  // Tick 1 sin recolector: el conectado vacía directo a tesorería; el aislado llena 250/250 y se detiene
  const tick1 = simulateDualLogisticsTick({ corpId, buildings, edges, elapsedHours: 1 });
  assert(tick1.pipedExtractorIds.includes('b-ext-piped'), 'Extractor con tubería debe fluir continuamente');
  assert(tick1.treasuryDelta.alloys === 28, `Alloys por tubería esperado 28, obtenido ${tick1.treasuryDelta.alloys}`);
  assert(tick1.haltedExtractorIds.includes('b-ext-isolated'), 'Extractor sin tubería debe detenerse al llegar a 250');

  const isolatedAfterTick1 = tick1.buildings.find((b) => b.id === 'b-ext-isolated')!;
  const pendingCheck = calculateBuildingPendingYield({
    building_type: 'extractor',
    level: 2,
    is_disabled: false,
    last_collected_at: new Date(Date.now() - 3600_000).toISOString(),
    stored_resources: isolatedAfterTick1.stored,
    storage_cap: 250,
    is_production_halted: isolatedAfterTick1.isProductionHalted,
  });
  assert(pendingCheck.isStorageFull && pendingCheck.isProductionHalted, 'calculateBuildingPendingYield debe reportar almacén lleno y producción detenida');

  // Tick 2 con unidad recolectora: vacía parte del extractor detenido y reactiva su producción
  const collector: DualSimCollector = {
    id: 'u-col-1',
    corpId,
    unitRole: 'collector',
    h3Index: isolatedExtH3,
    cargoCap: 150,
    sourceBuildingId: 'b-ext-isolated',
    depotBuildingId: 'b-depot',
  };
  const tick2 = simulateDualLogisticsTick({
    corpId,
    buildings: tick1.buildings,
    edges,
    collectors: [collector],
    elapsedHours: 0,
  });
  const isolatedAfterHaul = tick2.buildings.find((b) => b.id === 'b-ext-isolated')!;
  assert(tick2.hauledExtractorIds.includes('b-ext-isolated'), 'Unidad collector debe acarrear del extractor');
  assert(!isolatedAfterHaul.isProductionHalted, 'Extractor debe reactivarse tras liberar espacio en almacén');
  assert(
    tick2.treasuryDelta.alloys + tick2.treasuryDelta.fuel + tick2.treasuryDelta.chips === 150,
    'Recolector debe transportar exactamente su capacidad (150)'
  );
  console.log('✅ [PASSED] Test 2: Logística Dual (Tuberías continuas, Almacén Finito y Recolector)');
  passed++;
}

// 3. Handshake 120s, Devastación RUINED/SEVERED, 35% tech_scrap y Reparación ~35%
{
  const attackerCorp = 'corp-attacker';
  const defenderCorp = 'corp-defender';
  const baseStartMs = 1_700_000_000_000;
  const activeFromMs = baseStartMs + 120_000;
  const expiresAtMs = activeFromMs + 1_800_000;

  const historicalHq: DualSimBuilding = {
    id: 'b-hist-hq',
    corpId: defenderCorp,
    buildingType: 'hq',
    h3Index: Number(latLngToH3Res9(10.3994, -71.4539)),
    level: 1,
    hp: 30,
    maxHp: 30,
    infraState: 'OPERATIONAL',
    isHistorical: true,
    storageCap: 500,
    stored: { alloys: 0, fuel: 0, chips: 0 },
    isProductionHalted: false,
  };

  // Antes de los 120s debe rechazarse
  const tooEarly = simulateInfrastructureDamageAndRepair({
    action: 'damage',
    actorCorpId: attackerCorp,
    building: historicalHq,
    damage: 30,
    nowMs: baseStartMs + 60_000,
    windowActiveFromMs: activeFromMs,
    windowExpiresAtMs: expiresAtMs,
  });
  assert(!tooEarly.ok && tooEarly.reason === 'VULNERABILITY_HANDSHAKE_REQUIRED', 'No debe permitir ataque antes de 120s');

  // Dentro de ventana: daño parcial -> DAMAGED
  const partialHit = simulateInfrastructureDamageAndRepair({
    action: 'damage',
    actorCorpId: attackerCorp,
    building: historicalHq,
    damage: 10,
    nowMs: activeFromMs + 5_000,
    windowActiveFromMs: activeFromMs,
    windowExpiresAtMs: expiresAtMs,
  });
  assert(partialHit.ok && partialHit.building?.infraState === 'DAMAGED', 'Daño parcial debe pasar a DAMAGED');

  // Golpe final -> RUINED sin eliminarse, con 35% tech_scrap (800 * 0.35 = 280)
  const ruinHit = simulateInfrastructureDamageAndRepair({
    action: 'damage',
    actorCorpId: attackerCorp,
    building: partialHit.building!,
    damage: 25,
    nowMs: activeFromMs + 10_000,
    windowActiveFromMs: activeFromMs,
    windowExpiresAtMs: expiresAtMs,
  });
  assert(ruinHit.ok && ruinHit.building?.infraState === 'RUINED', 'Debe pasar a RUINED a 0 HP');
  assert(ruinHit.building?.isHistorical === true, 'Base histórica nunca se elimina al quedar RUINED');
  assert(ruinHit.lootTechScrapEc === 280, `Saqueo 35% tech_scrap esperado 280, obtenido ${ruinHit.lootTechScrapEc}`);

  // Reparación por el dueño al 35% del costo
  const repaired = simulateInfrastructureDamageAndRepair({
    action: 'repair',
    actorCorpId: defenderCorp,
    building: ruinHit.building!,
  });
  assert(
    repaired.ok &&
      repaired.building?.infraState === 'OPERATIONAL' &&
      repaired.building?.hp === 30 &&
      repaired.repairCostEc === 280,
    'Reparación debe restaurar OPERATIONAL al 35% del costo'
  );
  console.log('✅ [PASSED] Test 3: Handshake 120s, Devastación RUINED (35% scrap) y Reparación (35% costo)');
  passed++;
}

// 4. Interpolación Continua de Órdenes Programadas de Drones (unit_command_schedules)
{
  const rts = new TacticalRtsEngine({ tickIntervalMs: 100 });
  const t0 = 1_700_000_000_000;
  const scheduledAtMs = t0 + 1000;

  rts.syncScheduledCommand(
    {
      scheduleId: 'sched-patrol-1',
      unitId: 'drone-patrol-1',
      unitCode: 'recon',
      ownerId: 'corp-ferro',
      commandType: 'patrol',
      waypoints: [
        { x: -71.45, y: 10.39 },
        { x: -71.44, y: 10.40 },
      ],
      waypointCursor: 0,
      scheduledAtMs,
      repeatIntervalSec: 15,
    },
    t0
  );

  // Antes de scheduledAtMs no debe moverse
  rts.tick(t0 + 200);
  const beforeDue = rts.getInterpolatedUnitCoords('drone-patrol-1');
  assert(beforeDue !== null && Math.abs(beforeDue.x - -71.45) < 1e-6, 'Dron no debe moverse antes de scheduledAtMs');

  // Después de scheduledAtMs debe activarse e interpolar entre waypoints
  rts.tick(scheduledAtMs);
  rts.tick(scheduledAtMs + 100);
  const mid = rts.getInterpolatedUnitCoords('drone-patrol-1');
  assert(
    mid !== null && mid.x > -71.45 && mid.x < -71.44 && mid.y > 10.39 && mid.y < 10.40,
    `Dron debe interpolar suavemente entre waypoints (obtenido: ${JSON.stringify(mid)})`
  );
  console.log('✅ [PASSED] Test 4: Interpolación en tiempo real de órdenes programadas de drones');
  passed++;
}

console.log(`\n✅ SUITE COMPLETADA: ${passed}/4 PRUEBAS DETERMINISTAS SUPERADAS`);
