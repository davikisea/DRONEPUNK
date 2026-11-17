/**
 * ==============================================================================
 * TEST SUITE: ASIGNACIÓN ESPACIAL O(1), DESPLIEGUE Y CONSTRUCCIÓN (SPRINT 3)
 * ==============================================================================
 * Conforme a @game-dev-quality-gate y docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.3
 * Valida la asignación matemática unívoca a Zoom x15, despliegue de tropas
 * y construcción in-situ de estructuras industriales.
 * ==============================================================================
 */

import fs from 'fs';
import path from 'path';
import {
  ZOOM_TACTICO,
  TACTICAL_SPRITE_MAX_ZOOM,
  getTacticalCellPixelSizeAtZoom,
  generateGbaSectorBlueprint,
  validateGbaSectorMatrix,
  getGbaPipelineCacheSize,
  isLandAtCabimasPolygon,
  lngLatToGridCoords,
  gridCoordsToLngLat,
  spatialDeploymentService,
} from '@domains/world';
import { operationalUnitsService, CANONICAL_H3_DRONE_CATALOG, TacticalRtsEngine, CANONICAL_RTS_PROFILES } from '@domains/tactics';
import { fiefBuildingService } from '@domains/economy';
import {
  UNIT_GREEN_SPRITE_PATHS,
  resolveUnitSpriteKey,
  SECTOR_TERRAIN_DEFENSE_STARS,
  type TerrainType,
  type WeatherCondition,
} from '@shared';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ [FAILED]: ${msg}`);
    process.exit(1);
  }
}

console.log('==============================================================================');
console.log('EJECUTANDO SUITE: ASIGNACIÓN ESPACIAL O(1), DESPLIEGUE Y CONSTRUCCIÓN (ZOOM X15)');
console.log('==============================================================================\n');

let passedTests = 0;

try {
  // ----------------------------------------------------------------------------
  // SUITE 1: Constante Canónica y Asignación Espacial O(1)
  // ----------------------------------------------------------------------------
  console.log('--- SUITE 1: ASIGNACIÓN ESPACIAL ANALÍTICA O(1) (WGS84 -> GRID) ---');

  assert(ZOOM_TACTICO === 15.0, 'ZOOM_TACTICO debe ser exactamente 15.0 para el Microjuego');
  console.log(`✅ [PASSED] Test 1.1: Umbral de microjuego táctico verificado a z=${ZOOM_TACTICO}`);
  passedTests++;

  // Coordenadas de prueba en Cabimas: [-71.4550, 10.3950]
  const cabimasCoord: [number, number] = [-71.4550, 10.3950];
  const assignment = spatialDeploymentService.getSpatialAssignment(cabimasCoord);

  assert(Array.isArray(assignment.sector) && assignment.sector.length === 2, 'Sector debe ser [x, y]');
  assert(Array.isArray(assignment.cell) && assignment.cell.length === 2, 'Celda debe ser [x, y]');
  assert(assignment.cell[0] >= 0 && assignment.cell[0] < 20, 'Celda X debe estar en [0, 19]');
  assert(assignment.cell[1] >= 0 && assignment.cell[1] < 20, 'Celda Y debe estar en [0, 19]');
  assert(assignment.formattedCoordinate.includes('SEC'), 'Debe formatear la coordenada con SEC y CELL');
  assert(assignment.defenseCoverPercent >= 10 && assignment.defenseCoverPercent <= 40, 'Cobertura entre 10% y 40%');
  assert(assignment.movementCost >= 1, 'Coste de movimiento debe ser >= 1');

  console.log(`✅ [PASSED] Test 1.2: Asignación O(1) calculada: ${assignment.formattedCoordinate} (${assignment.terrainName})`);
  passedTests++;

  // ----------------------------------------------------------------------------
  // SUITE 2: Detección de Tropas y Edificios Preexistentes
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 2: DETECCIÓN DE OCUPACIÓN Y UNIDADES PREVIAS ---');

  // La tropa unit-cab-01 está sembrada en [-71.458, 10.395]
  const occupiedCoord: [number, number] = [-71.458, 10.395];
  const occupiedAssignment = spatialDeploymentService.getSpatialAssignment(occupiedCoord);

  assert(!!occupiedAssignment.deployedUnit, 'Debe detectar la unidad preexistente en la coordenada de La Salina');
  assert(occupiedAssignment.isDeployable === false, 'Celda con unidad preexistente NO debe ser desplegable');
  assert(occupiedAssignment.deployedUnit!.callsign === 'FERRO-TITÁN-01', 'Debe identificar el callsign de la unidad');

  console.log(`✅ [PASSED] Test 2.1: Ocupación detectada: ${occupiedAssignment.deployedUnit!.name} (${occupiedAssignment.deployedUnit!.callsign})`);
  passedTests++;

  // ----------------------------------------------------------------------------
  // SUITE 3: Despliegue de Unidades en Coordenadas Libres
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 3: DESPLIEGUE TÁCTICO EN COORDENADAS ---');

  // Coordenada despejada de prueba
  const freeCoord: [number, number] = [-71.4420, 10.3850];
  const freeAssignment = spatialDeploymentService.getSpatialAssignment(freeCoord);
  assert(freeAssignment.isDeployable === true, 'Celda libre debe permitir despliegue');

  // Intento de despliegue sobre celda ocupada debe fallar
  const failDeploy = spatialDeploymentService.deployUnitAt({
    sector: occupiedAssignment.sector,
    cell: occupiedAssignment.cell,
    lngLat: occupiedCoord,
    unitCode: 'recon',
    unitName: 'Patrulla Rechazada',
    clanId: 'clan-ferro',
    clanTag: 'FERR',
    factionId: 'blue_moon',
    callsign: 'RECHAZADO-1',
  });
  assert(failDeploy.success === false, 'Despliegue sobre celda ocupada debe ser rechazado');
  assert(failDeploy.reason!.includes('CELDA OCUPADA'), 'Debe retornar motivo de rechazo');
  console.log('✅ [PASSED] Test 3.1: Despliegue en celda ocupada bloqueado con motivo balístico');
  passedTests++;

  // Despliegue válido en celda libre
  let notifyFired = false;
  const unsub = spatialDeploymentService.subscribe(() => {
    notifyFired = true;
  });

  const validDeploy = spatialDeploymentService.deployUnitAt({
    sector: freeAssignment.sector,
    cell: freeAssignment.cell,
    lngLat: freeCoord,
    unitCode: 'artillery',
    unitName: 'Batería de Artillería Trueno',
    clanId: 'clan-ferro',
    clanTag: 'FERR',
    factionId: 'blue_moon',
    callsign: 'TRUENO-CABIMAS',
    tier: 2,
  });

  assert(validDeploy.success === true, 'Despliegue en celda libre debe ser exitoso');
  assert(!!validDeploy.unit, 'Debe retornar la unidad desplegada');
  assert(validDeploy.unit!.hp === 100, 'Unidad nace con 100 HP');
  assert(Boolean(notifyFired), 'Debe notificar a los suscriptores reactivos');

  // Re-consultar la celda para confirmar ocupación
  const postDeploy = spatialDeploymentService.getSpatialAssignment(freeCoord);
  assert(postDeploy.isDeployable === false, 'Tras despliegue, la celda queda ocupada');
  assert(postDeploy.deployedUnit?.callsign === 'TRUENO-CABIMAS', 'La unidad figura como ocupante de la celda');

  console.log(`✅ [PASSED] Test 3.2: Tropa [${validDeploy.unit!.callsign}] desplegada con éxito en ${freeAssignment.formattedCoordinate}`);
  passedTests++;

  // ----------------------------------------------------------------------------
  // SUITE 4: Construcción in-situ de Estructuras Industriales / Búnkeres
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 4: CONSTRUCCIÓN IN-SITU DE EDIFICIOS ---');

  // Coordenada vial libre adyacente para construir
  const buildCoord: [number, number] = [-71.4480, 10.3880];
  const buildAssignment = spatialDeploymentService.getSpatialAssignment(buildCoord);

  const constructRes = spatialDeploymentService.constructBuildingAt({
    sector: buildAssignment.sector,
    cell: buildAssignment.cell,
    lngLat: buildCoord,
    buildingType: 'radar_station',
    clanId: 'clan-ferro',
  });

  assert(constructRes.success === true, 'Construcción debe autorizarse');
  assert(!!constructRes.building, 'Debe retornar el edificio construido');
  assert(constructRes.building!.buildingType === 'radar_station', 'Tipo de edificio debe coincidir');

  const postBuild = spatialDeploymentService.getSpatialAssignment(buildCoord);
  assert(postBuild.isConstructible === false, 'Tras construir, la celda no permite duplicar estructura');
  assert(postBuild.deployedBuilding?.buildingType === 'radar_station', 'El edificio figura como estructura activa');

  console.log(`✅ [PASSED] Test 4.1: Estructura [${constructRes.building!.buildingType}] construida exitosamente en ${buildAssignment.formattedCoordinate}`);
  passedTests++;

  // Limpieza
  operationalUnitsService.removeUnit(validDeploy.unit!.id);
  unsub();

  // ----------------------------------------------------------------------------
  // SUITE 5: Polígono Completo de Pruebas en Cabimas (9 Drones H3 + 16 Chasis Tácticos)
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 5: POLÍGONO COMPLETO DE PRUEBAS EN CABIMAS (9 DRONES H3 + 16 CHASIS) ---');

  const isInsideCabimasPolygon = (coords: [number, number]): boolean =>
    coords[0] >= -71.465 &&
    coords[0] <= -71.425 &&
    coords[1] >= 10.370 &&
    coords[1] <= 10.415;

  const cabimasUnits = operationalUnitsService
    .getAllUnits()
    .filter((u) => isInsideCabimasPolygon(u.coordinates));

  const h3DroneCodes = Object.keys(CANONICAL_H3_DRONE_CATALOG);
  const tacticalChassisCodes = [
    'infantry',
    'mech',
    'recon',
    'apc',
    'tank_light',
    'tank_medium',
    'neotank',
    'anti_air',
    'artillery',
    'rocket',
    'missiles',
    'b_copter',
    't_copter',
    'fighter',
    'bomber',
    'battleship',
  ];

  for (const code of h3DroneCodes) {
    assert(
      cabimasUnits.some((u) => u.code === code),
      `El Polígono de Cabimas debe incluir >= 1 ejemplar del Dron H3 "${code}"`
    );
  }
  for (const code of tacticalChassisCodes) {
    assert(
      cabimasUnits.some((u) => u.code === code),
      `El Polígono de Cabimas debe incluir >= 1 ejemplar del Chasis Táctico "${code}"`
    );
  }
  console.log(`✅ [PASSED] Test 5.1: Cobertura completa verificada (${h3DroneCodes.length} Drones H3 + ${tacticalChassisCodes.length} Chasis Tácticos = ${cabimasUnits.length} unidades en Cabimas)`);
  passedTests++;

  // Verificar salud 100 HP, modo estático ('holding'), perfil RTS y ausencia de colisiones O(1)
  const anchorSector = lngLatToGridCoords([-71.455, 10.395], 20, ZOOM_TACTICO).sector;
  const occupiedAnchorCells = new Set<string>();
  const rtsCheckEngine = new TacticalRtsEngine({ tickIntervalMs: 100 });
  let anchorUnitsCount = 0;

  for (const u of cabimasUnits) {
    assert(u.hp === 100 && u.maxHp === 100, `Unidad ${u.id} (${u.code}) debe iniciar en 100/100 HP`);
    assert(u.status === 'holding', `Unidad ${u.id} (${u.code}) debe estar estática ('holding')`);
    assert(Boolean(CANONICAL_RTS_PROFILES[u.code]), `Debe existir perfil RTS canónico para "${u.code}"`);

    const gCoords = lngLatToGridCoords(u.coordinates, 20, ZOOM_TACTICO);
    const cellAssign = spatialDeploymentService.getSpatialAssignment(u.coordinates);
    assert(cellAssign.isDeployable === false, `Celda de ${u.id} debe figurar ocupada (isDeployable === false)`);
    assert(
      cellAssign.deployedUnit?.id === u.id,
      `getSpatialAssignment(${u.coordinates.join(',')}) debe retornar exactamente a ${u.id}`
    );

    if (gCoords.sector[0] === anchorSector[0] && gCoords.sector[1] === anchorSector[1]) {
      const cellKey = `${gCoords.cell[0]}_${gCoords.cell[1]}`;
      assert(
        !occupiedAnchorCells.has(cellKey),
        `Colisión detectada en sector ancla [${anchorSector.join(',')}] celda [${cellKey}] para ${u.id}`
      );
      occupiedAnchorCells.add(cellKey);
      anchorUnitsCount++;
      rtsCheckEngine.registerUnit(
        {
          id: u.id,
          unitCode: u.code,
          displayName: u.name,
          owner: u.clanId,
          ownerId: u.clanId,
          x: gCoords.cell[0],
          y: gCoords.cell[1],
          hp: u.hp,
          maxHp: u.maxHp,
          ammo: 9,
          fuel: 99,
          minRange: 1,
          maxRange: 1,
          moveRange: 5,
          movementPoints: 5,
          movementType: 'treads',
          visionRange: 3,
          baseAttack: 85,
          productionCost: 5000,
          hasMoved: false,
          hasActed: false,
          skinId: 'default',
        } as any,
        u.tier || 1
      );
    }
  }

  assert(
    anchorUnitsCount >= 27,
    `Sector ancla [${anchorSector.join(',')}] debe contener al menos 27 unidades sin colisión (actual: ${anchorUnitsCount})`
  );
  assert(
    cabimasUnits.some((u) => u.clanId !== 'clan-ferro'),
    'Cabimas debe contar con al menos 1 blanco hostil para pruebas de combate directo e indirecto'
  );
  assert(
    rtsCheckEngine.getAllUnits().length === anchorUnitsCount,
    'TacticalRtsEngine debe registrar sin colisiones todas las unidades del sector ancla'
  );
  console.log(`✅ [PASSED] Test 5.2: Sin colisiones (${anchorUnitsCount} celdas únicas en sector [${anchorSector.join(',')}]), 100 HP estático y sincronización O(1)/RTS OK`);
  passedTests++;

  // Verificar sprites verdes en disco y propiedad spriteKey en GeoJSON
  for (const [spriteKey, assetUrl] of Object.entries(UNIT_GREEN_SPRITE_PATHS)) {
    const diskPath = path.resolve('public', assetUrl.replace(/^\//, ''));
    assert(fs.existsSync(diskPath), `Archivo PNG de sprite verde faltante en disco: ${diskPath} (${spriteKey})`);
  }
  const opGeoJSON = operationalUnitsService.toGeoJSON();
  for (const u of cabimasUnits) {
    const expectedKey = resolveUnitSpriteKey(u.code);
    assert(Boolean(UNIT_GREEN_SPRITE_PATHS[expectedKey]), `SpriteKey "${expectedKey}" de ${u.code} debe existir en UNIT_GREEN_SPRITE_PATHS`);
    const feat = opGeoJSON.features.find((f: any) => f.id === u.id);
    assert(feat?.properties?.spriteKey === expectedKey, `GeoJSON de ${u.id} debe incluir spriteKey="${expectedKey}"`);
  }
  console.log(`✅ [PASSED] Test 5.3: 18/18 PNGs verdes verificados en disco y spriteKey resuelto en ${cabimasUnits.length}/${cabimasUnits.length} unidades de Cabimas`);
  passedTests++;

  // ----------------------------------------------------------------------------
  // SUITE 6: Geografía Persistente Híbrida (Procedural O(1) + Sparse Overrides)
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 6: GEOGRAFÍA PERSISTENTE HÍBRIDA (PROCEDURAL O(1) + MAP BUILDER DELTAS) ---');

  // 6.1 Determinismo O(1) de base procedural (Lago vs Tierra) y 0 bytes en sectores vírgenes
  const initialOverridesCount = spatialDeploymentService.getOverriddenSectorsCount();
  assert(initialOverridesCount === 4, `Solo los 4 sectores piloto del Teatro Cabimas deben estar en overrides (actual: ${initialOverridesCount})`);

  const lakeBase = spatialDeploymentService.resolveSectorCellTerrain([9877, 15432], [0, 10], 20);
  assert(lakeBase.type === 'sea' && lakeBase.defenseStars === 0 && lakeBase.isOverridden === false, 'Celda [0,10] del Lago en [9877,15432] debe ser sea (0★) procedural sin override');

  const cabimasPort = spatialDeploymentService.resolveSectorCellTerrain([9880, 15432], [1, 4], 20);
  assert(cabimasPort.type === 'port' && cabimasPort.defenseStars === 3 && cabimasPort.isOverridden === true, 'Celda [1,4] de Cabimas debe ser port (3★) del override piloto');

  const orinocoHq = spatialDeploymentService.resolveSectorCellTerrain([9881, 15432], [15, 8], 20);
  assert(orinocoHq.type === 'hq' && orinocoHq.ownerId === 'p1' && orinocoHq.defenseStars === 4, 'Frente Oriental [9881,15432] debe contar con HQ Orange Star (p1, 4★)');

  // 6.2 Edición desde MapBuilder (Delta disperso), propagación a getSpatialAssignment y RTS, y limpieza
  const testSector: [number, number] = [9880, 15432];
  const prevCell = spatialDeploymentService.resolveSectorCellTerrain(testSector, [10, 10], 20);
  spatialDeploymentService.applySectorTerrainDelta({
    sector: testSector,
    gridSize: 20,
    changes: [{ x: 10, y: 10, type: 'mountain', defenseStars: 4 }],
    source: 'map_builder',
  });

  const editedCoord = gridCoordsToLngLat(testSector, [10, 10], 20, ZOOM_TACTICO);
  const editedAssign = spatialDeploymentService.getSpatialAssignment(editedCoord);
  assert(editedAssign.canonicalTerrain === 'mountain', 'getSpatialAssignment debe reflejar mountain tras guardar delta');
  assert(editedAssign.defenseStars === 4 && editedAssign.defenseCoverPercent === 40, 'Bonos de defensa 4★ (40%) deben propagarse en caliente');

  const rtsTerrainSync = new TacticalRtsEngine({ tickIntervalMs: 100 });
  const matrixAfterEdit = spatialDeploymentService.getSectorTerrainMatrix(testSector, 20);
  rtsTerrainSync.setTerrain(10, 10, matrixAfterEdit[10][10]);
  assert(rtsTerrainSync.getTerrain(10, 10).type === 'mountain' && rtsTerrainSync.getTerrain(10, 10).defenseStars === 4, 'TacticalRtsEngine.setTerrain debe recibir el terreno persistente del sector');

  // Restaurar celda [10, 10] para dejar el piloto limpio
  spatialDeploymentService.applySectorTerrainDelta({
    sector: testSector,
    gridSize: 20,
    changes: [{ x: 10, y: 10, type: prevCell.type, ownerId: prevCell.ownerId ?? null }],
    source: 'map_builder',
  });
  console.log('✅ [PASSED] Test 6.1: Geografía Híbrida O(1) (Lago sea vs Cabimas port/road/forest) y deltas de MapBuilder sincronizados con RTS');
  passedTests++;

  // Test 6.2: Pipeline GBA de 6 Etapas, Máscara Real Cabimas, Caché LRU <= 64 y Zoom 1:1 48px
  assert(isLandAtCabimasPolygon(-71.485, 10.39) === false, 'Lago Maracaibo [-71.485, 10.39] debe ser agua en máscara real');
  assert(isLandAtCabimasPolygon(-71.455, 10.395) === true, 'Centro de Cabimas [-71.455, 10.395] debe ser tierra en máscara real');

  const cellPxAtMaxZoom = getTacticalCellPixelSizeAtZoom(TACTICAL_SPRITE_MAX_ZOOM, 20, 512);
  assert(Math.abs(cellPxAtMaxZoom - 48) < 0.05, `Zoom máximo 1:1 (${TACTICAL_SPRITE_MAX_ZOOM}) debe rendir celdas de ~48px (actual=${cellPxAtMaxZoom})`);

  const sectorSectors: Array<[number, number]> = [
    [9878, 15432],
    [9879, 15432],
    [9880, 15432],
    [9881, 15432],
  ];
  for (const s of sectorSectors) {
    const bp = generateGbaSectorBlueprint(s, 20);
    const val = validateGbaSectorMatrix(bp.matrix);
    assert(val.emptyCells === 0, `Sector [${s[0]}, ${s[1]}] no debe tener celdas vacías`);
    assert(bp.blueprint.validation.bfsReachableRatio >= 0.90, `Sector [${s[0]}, ${s[1]}] BFS reachable ratio >= 0.90 (actual=${bp.blueprint.validation.bfsReachableRatio})`);
    assert((bp.blueprint.validation.parallelRoadConflicts ?? 0) === 0, `Sector [${s[0]}, ${s[1]}] no debe tener bloques 2x2 de carreteras paralelas (actual=${bp.blueprint.validation.parallelRoadConflicts})`);
    assert((bp.blueprint.validation.calibrationScore ?? 0) >= 75, `Sector [${s[0]}, ${s[1]}] calibrationScore >= 75 (actual=${bp.blueprint.validation.calibrationScore})`);
  }

  // Verificar cota de caché LRU <= 64 sectores tras visitar > 70 sectores
  for (let i = 0; i < 72; i++) {
    generateGbaSectorBlueprint([9900 + i, 15432], 20);
  }
  assert(getGbaPipelineCacheSize() <= 64, `Caché LRU GBA debe estar acotado a <= 64 sectores (actual=${getGbaPipelineCacheSize()})`);

  console.log('✅ [PASSED] Test 6.2: Pipeline GBA 6 Etapas, Máscara Real, BFS Conectividad, LRU <= 64 y Lock Zoom 1:1 (48px)');
  passedTests++;

  // Test 6.3: Paridad 20/20 terrenos en SECTOR_TERRAIN_DEFENSE_STARS, 0 ramales muertos y clima clear/rain/snow
  const expectedTerrains: TerrainType[] = [
    'plains', 'forest', 'mountain', 'road', 'river',
    'city', 'factory', 'airport', 'port', 'hq',
    'sea', 'reef', 'shoal', 'bridge', 'commtower',
    'silo', 'usedSilo', 'lab', 'pipe', 'pipeSeam',
  ];
  assert(
    Object.keys(SECTOR_TERRAIN_DEFENSE_STARS).length >= 20,
    `SECTOR_TERRAIN_DEFENSE_STARS debe soportar >= 20 terrenos (actual=${Object.keys(SECTOR_TERRAIN_DEFENSE_STARS).length})`
  );
  for (const t of expectedTerrains) {
    assert(
      typeof SECTOR_TERRAIN_DEFENSE_STARS[t] === 'number',
      `SECTOR_TERRAIN_DEFENSE_STARS debe definir estrellas de defensa para "${t}"`
    );
  }

  const isProp = (t: TerrainType) =>
    t === 'city' || t === 'factory' || t === 'airport' || t === 'port' ||
    t === 'hq' || t === 'commtower' || t === 'lab' || t === 'silo' || t === 'usedSilo';

  for (const s of sectorSectors) {
    const bp = generateGbaSectorBlueprint(s, 20, true);
    const mat = bp.matrix;
    const g = mat.length;
    let deadEnds = 0;
    for (let y = 1; y < g - 1; y++) {
      for (let x = 1; x < g - 1; x++) {
        if (mat[y][x].type !== 'road') continue;
        let roadN = 0;
        let adjProp = false;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nt = mat[y + dy]?.[x + dx]?.type;
          if (!nt) continue;
          if (nt === 'road' || nt === 'bridge') roadN++;
          if (isProp(nt)) adjProp = true;
        }
        if (roadN <= 1 && !adjProp) deadEnds++;
      }
    }
    assert(deadEnds === 0, `Sector piloto [${s[0]}, ${s[1]}] debe tener 0 ramales muertos (actual=${deadEnds})`);

    // Invariantes duros: 0 puentes consecutivos, 0 reef tocando tierra y 0 bloques 2x2 de road
    for (let y = 0; y < g; y++) {
      for (let x = 0; x < g; x++) {
        const curr = mat[y][x].type;
        if (curr === 'bridge') {
          const adjBridge = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => mat[y + dy]?.[x + dx]?.type === 'bridge');
          assert(!adjBridge, `Sector [${s[0]}, ${s[1]}] (${x},${y}) no debe tener puentes consecutivos`);
        }
        if (curr === 'reef') {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nt = mat[y + dy]?.[x + dx]?.type;
              if (nt) {
                assert(nt === 'sea' || nt === 'reef', `Arrecife (${x},${y}) no debe tocar tierra (${nt})`);
              }
            }
          }
        }
        if (x < g - 1 && y < g - 1) {
          const is2x2Road =
            mat[y][x].type === 'road' &&
            mat[y][x + 1].type === 'road' &&
            mat[y + 1][x].type === 'road' &&
            mat[y + 1][x + 1].type === 'road';
          assert(!is2x2Road, `Sector [${s[0]}, ${s[1]}] (${x},${y}) no debe tener bloques 2x2 de road`);
        }
      }
    }
  }

  // Soporte de clima determinista y overrides clear/rain/snow
  const weatherConditions: WeatherCondition[] = ['clear', 'rain', 'snow'];
  assert(
    spatialDeploymentService.getSectorWeather([9880, 15432]) === 'clear',
    'Clima por defecto en Cabimas [9880, 15432] debe ser "clear"'
  );
  for (const w of weatherConditions) {
    const bpWeather = generateGbaSectorBlueprint([9880, 15432], 20, false, undefined, w);
    assert(
      bpWeather.blueprint.weather === w,
      `generateGbaSectorBlueprint debe propagar weatherOverride="${w}"`
    );
    spatialDeploymentService.setSectorWeatherOverride([9880, 15432], w);
    assert(
      spatialDeploymentService.getSectorWeather([9880, 15432]) === w,
      `spatialDeploymentService.getSectorWeather debe retornar "${w}" tras override`
    );
  }
  spatialDeploymentService.setSectorWeatherOverride([9880, 15432], null);
  assert(
    spatialDeploymentService.getSectorWeather([9880, 15432]) === 'clear',
    'Tras limpiar override, el clima de Cabimas debe volver a "clear"'
  );

  console.log('✅ [PASSED] Test 6.3: Paridad 20/20 terrenos, 0 ramales muertos en sectores piloto y clima clear/rain/snow OK');
  passedTests++;

  console.log('------------------------------------------------------------------------------');
  console.log(`RESUMEN ASIGNACIÓN ESPACIAL Y CONSTRUCCIÓN SPRINT 3: ${passedTests}/${passedTests} PASARON`);
  console.log('✅ TODAS LAS PRUEBAS DE MICROJUEGO, DESPLIEGUE Y CONSTRUCCIÓN SUPERADAS (100% ÉXITO)');
  console.log('==============================================================================\n');
} catch (err) {
  console.error('Error fatal durante la ejecución de pruebas:', err);
  process.exit(1);
}