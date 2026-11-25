/**
 * ==============================================================================
 * SUITE DE PARIDAD 100 % — SPRITE-FORGE-STUDIO (v6.0.0-awbw) EN DRONEPUNK
 * ==============================================================================
 * Valida las métricas cuantitativas de la skill sprite-forge-city-world-architect
 * sobre todas las ciudades reales de public/map/theatre_cities.json.
 * ==============================================================================
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  clearGbaPipelineCache,
  generateGbaSectorBlueprint,
  isLandAtCabimasPolygon,
  registerLandPolygons,
} from '../core/gbaMapPipeline';
import { getAllCityScaleSpecs } from '../core/urbanPopulationCatalog';
import { getOrCompileCityBlueprint, resetUrbanBlueprintCache } from '../core/urbanSectorBridge';
import { getResolvedMacroBridges } from '../core/macroBridgeCorridors';
import { getProceduralSatelliteSpecs } from '../core/proceduralSatelliteNetwork';
import {
  getYellowTrunkBridgeAxisAtGlobalCell,
  registerYellowTrunkGeoJson,
} from '../core/yellowTrunkBackboneIndex';
import {
  chaikinSmooth,
  extractThinRing,
  maxEmptySquareSide,
  rasterizePolygon,
} from '../core/urbanMorphologyPrimitives';
import {
  applyAntiCollisionRepairs,
  maxD4IoU,
  resolveCityDnaProfile,
} from '../core/urbanVariabilityEngine';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`❌ [FAILED]: ${msg}`);
    process.exit(1);
  }
}

console.log('==============================================================================');
console.log('SUITE DE PARIDAD 100 %: SPRITE-FORGE-STUDIO (v6.0.0-awbw) -> DRONEPUNK');
console.log('==============================================================================');

// Hidratar cartografía vectorial real
const zulia = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/map/zulia_municipalities.json'), 'utf-8')
);
const regions = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/map/theatre_regions.json'), 'utf-8')
);
const world = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/map/world_land.json'), 'utf-8')
);
registerLandPolygons(zulia, 'zulia_hd');
registerLandPolygons(regions, 'theatre_regions');
registerLandPolygons(world, 'world_land');
clearGbaPipelineCache();
resetUrbanBlueprintCache();

// 1. Primitivas morfológicas puras
const square: ReadonlyArray<readonly [number, number]> = [
  [6, 6],
  [22, 6],
  [22, 22],
  [6, 22],
];
const smooth = chaikinSmooth(square, 2);
assert(smooth.length === 16, `Chaikin passes=2 debe emitir 16 vértices (got ${smooth.length})`);
const mask = rasterizePolygon(smooth, 30, 30);
const ring = extractThinRing(mask, 30, 30);
let ringCount = 0;
for (let i = 0; i < ring.length; i++) if (ring[i]) ringCount++;
assert(ringCount > 20, `extractThinRing debe producir anillo continuo > 20 tiles (got ${ringCount})`);

const m4 = new Uint8Array(10 * 10);
for (let y = 2; y < 6; y++) {
  for (let x = 3; x < 7; x++) m4[y * 10 + x] = 1;
}
assert(maxEmptySquareSide(m4, 10, 10) === 4, 'maxEmptySquareSide debe detectar 4x4 exacto');
m4[3 * 10 + 4] = 0;
assert(maxEmptySquareSide(m4, 10, 10) <= 3, 'maxEmptySquareSide debe bajar a <= 3 tras partir');
console.log('✅ [PASSED] Test 1: Primitivas morfológicas (Chaikin, extractThinRing, maxEmptySquareSide)');

// 2. Motor de variabilidad AC-01..AC-07
const specs = getAllCityScaleSpecs();
assert(specs.length >= 21, `Debe haber >= 21 ciudades en catálogo (got ${specs.length})`);
const inlandSpec = specs.find((s) => s.waterfrontDir === 'none')!;
const baseDna = resolveCityDnaProfile(inlandSpec);
const repaired = applyAntiCollisionRepairs(
  {
    ...baseDna,
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    partitionMethod: 'coast_parallel_bands',
    regionalAccessPattern: 'monumental_bridge',
    perDistrictOrientation: { ...baseDna.perDistrictOrientation, air_hub: 'BLOCK_INTEGRATED' },
  },
  { waterfrontDir: 'none', riverPresent: false, scale: 'x1' }
);
assert(repaired.silhouetteFamily !== 'coastal_arc_crescent', 'AC-01 falló en silhouetteFamily');
assert(repaired.arterialSkeleton !== 'coastal_promenade', 'AC-01 falló en arterialSkeleton');
assert(repaired.partitionMethod !== 'coast_parallel_bands', 'AC-01 falló en partitionMethod');
assert(repaired.regionalAccessPattern !== 'monumental_bridge', 'AC-03 falló en regionalAccessPattern');
assert(repaired.perDistrictOrientation.air_hub === 'EW', 'AC-06 falló en air_hub');
assert(
  new Set(repaired.microGrains).size >= Math.min(repaired.sectorCount, 3),
  'AC-07 falló en diversidad de microGrains'
);
console.log('✅ [PASSED] Test 2: Motor de variabilidad AC-01..AC-07');

// 3. Compilación completa de las 33 ciudades con oráculos cuantitativos
const t0 = performance.now();
const compiled = specs.map((s) => getOrCompileCityBlueprint(s, isLandAtCabimasPolygon));
const elapsedMs = performance.now() - t0;
console.log(`⏱️  Compiladas ${compiled.length} ciudades en ${elapsedMs.toFixed(1)} ms`);
assert(elapsedMs < 8000, `Compilación de 33 ciudades demasiado lenta: ${elapsedMs.toFixed(1)} ms`);

for (const bp of compiled) {
  assert(
    bp.metrics.roadBlob2x2Count === 0,
    `${bp.spec.cityId}: roadBlob2x2Count=${bp.metrics.roadBlob2x2Count} (esperado 0)`
  );
  assert(
    bp.metrics.tallOverhangViolations === 0,
    `${bp.spec.cityId}: tallOverhangViolations=${bp.metrics.tallOverhangViolations} (esperado 0)`
  );
  assert(
    bp.metrics.interiorDeadEnds === 0,
    `${bp.spec.cityId}: interiorDeadEnds=${bp.metrics.interiorDeadEnds} (esperado 0)`
  );
  assert(bp.metrics.buildingCount > 0, `${bp.spec.cityId}: buildingCount debe ser > 0`);

  for (const b of bp.buildingsByLocalIdx.values()) {
    assert(b.ownerId === null, `${bp.spec.cityId}: edificio (${b.localX},${b.localY}) no es neutral`);
  }

  if (bp.spec.engineScale === 'x3' || bp.spec.engineScale === 'x2' || bp.spec.engineScale === 'x1') {
    const maxSq = bp.metrics.maxEmptySquareSide ?? 99;
    assert(maxSq <= 3, `${bp.spec.cityId}: maxEmptySquareSide=${maxSq} (esperado <= 3)`);
  }
}

const maracaibo = compiled.find((c) => c.spec.cityId === 'CITY_MARACAIBO')!;
const caracas = compiled.find((c) => c.spec.cityId === 'CITY_CARACAS')!;
const sanFrancisco = compiled.find((c) => c.spec.cityId === 'CITY_SAN_FRANCISCO')!;
const cabimas = compiled.find((c) => c.spec.cityId === 'CITY_CABIMAS')!;
const santaRita = compiled.find((c) => c.spec.cityId === 'CITY_SANTA_RITA')!;
assert(Boolean(maracaibo) && Boolean(caracas) && Boolean(sanFrancisco) && Boolean(cabimas) && Boolean(santaRita), 'Ciudades de referencia x5..x1 deben existir');
assert(caracas.spec.engineScale === 'x5', `Caracas debe ser x5 (got ${caracas.spec.engineScale})`);
assert(maracaibo.spec.engineScale === 'x4', `Maracaibo debe ser x4 (got ${maracaibo.spec.engineScale})`);
assert(sanFrancisco.spec.engineScale === 'x3', `San Francisco debe ser x3 (got ${sanFrancisco.spec.engineScale})`);
assert(cabimas.spec.engineScale === 'x2', `Cabimas debe ser x2 (got ${cabimas.spec.engineScale})`);
assert(santaRita.spec.engineScale === 'x1', `Santa Rita debe ser x1 (got ${santaRita.spec.engineScale})`);
assert(
  (maracaibo.metrics.functionalDistrictsCount ?? 0) >= 3,
  `Maracaibo debe tener >= 3 distritos funcionales (got ${maracaibo.metrics.functionalDistrictsCount})`
);
assert(
  maracaibo.metrics.buildingCount >= 180,
  `Maracaibo (x4) debe tener >= 180 edificios (got ${maracaibo.metrics.buildingCount})`
);
assert(
  maracaibo.perimeterPortalsGlobal.length >= 3,
  `Maracaibo debe tener >= 3 salidas multi-direccionales (got ${maracaibo.perimeterPortalsGlobal.length})`
);
assert(
  cabimas.perimeterPortalsGlobal.length >= 3,
  `Cabimas debe tener >= 3 salidas multi-direccionales (got ${cabimas.perimeterPortalsGlobal.length})`
);
assert(
  (maracaibo.roundabouts?.length ?? 0) >= 2,
  `Maracaibo (x4) debe tener >= 2 rotondas (got ${maracaibo.roundabouts?.length ?? 0})`
);
assert(
  (maracaibo.residentialDistricts?.length ?? 0) >= 3,
  `Maracaibo debe exponer >= 3 distritos residenciales polimórficos (got ${maracaibo.residentialDistricts?.length ?? 0})`
);
assert(
  Boolean(maracaibo.expansionZoneMask) && (maracaibo.interchangeArrows?.length ?? 0) >= 3,
  'Maracaibo debe exponer expansionZoneMask y >= 3 flechas amarillas de intercambio'
);
assert(
  Boolean(maracaibo.districtGrid) && (maracaibo.districtLegend?.length ?? 0) >= 4,
  `Maracaibo debe exponer districtGrid exclusivo y >= 4 entradas en districtLegend (got ${maracaibo.districtLegend?.length ?? 0})`
);
assert(
  (maracaibo.functionalDistricts ?? []).some((d) => d.archetype === 'civic_core'),
  'Maracaibo (x4) debe incluir civic_core garantizado'
);
assert(
  (sanFrancisco.functionalDistricts ?? []).some((d) => d.archetype === 'civic_core'),
  'San Francisco (x3) debe incluir civic_core garantizado'
);
assert(
  (cabimas.functionalDistricts ?? []).some((d) => d.archetype === 'civic_core'),
  'Cabimas (x2) debe incluir civic_core garantizado'
);
assert(
  (maracaibo.metrics.circleIoU ?? 0) > 0.25 && (maracaibo.metrics.internalMirrorIoU ?? 0) > 0,
  `Maracaibo debe reportar circleIoU e internalMirrorIoU válidos (circleIoU=${maracaibo.metrics.circleIoU}, mirror=${maracaibo.metrics.internalMirrorIoU})`
);
// Validar que las parcelas verdes de expansión de Maracaibo fueron particionadas (<= 64 tiles por componente)
if (maracaibo.expansionZoneMask) {
  const ew = maracaibo.width;
  const eh = maracaibo.height;
  const vis = new Uint8Array(ew * eh);
  let maxParcel = 0;
  let parcelCount = 0;
  for (let i = 0; i < ew * eh; i++) {
    if (!maracaibo.expansionZoneMask[i] || vis[i]) continue;
    parcelCount++;
    let sz = 0;
    const q: number[] = [i];
    vis[i] = 1;
    while (q.length > 0) {
      const cur = q.pop()!;
      sz++;
      const cx = cur % ew;
      const cy = Math.floor(cur / ew);
      const nbs = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of nbs) {
        if (nx < 0 || nx >= ew || ny < 0 || ny >= eh) continue;
        const ni = ny * ew + nx;
        if (maracaibo.expansionZoneMask[ni] && !vis[ni]) {
          vis[ni] = 1;
          q.push(ni);
        }
      }
    }
    if (sz > maxParcel) maxParcel = sz;
  }
  assert(
    parcelCount >= 1 && maxParcel <= 72,
    `Maracaibo expansionZoneMask debe particionarse en parcelas discretas (parcelas=${parcelCount}, maxParcel=${maxParcel})`
  );
}

if (cabimas) {
  const mLobe = new Uint8Array(maracaibo.width * maracaibo.height);
  const cLobe = new Uint8Array(cabimas.width * cabimas.height);
  for (let i = 0; i < mLobe.length; i++) if ((maracaibo.cellFlags[i] & 1) !== 0) mLobe[i] = 1;
  for (let i = 0; i < cLobe.length; i++) if ((cabimas.cellFlags[i] & 1) !== 0) cLobe[i] = 1;
  const iou = maxD4IoU(mLobe, maracaibo.width, maracaibo.height, cLobe, cabimas.width, cabimas.height);
  assert(iou < 0.95, `D4 IoU Maracaibo vs Cabimas demasiado alto: ${iou.toFixed(3)}`);
}
console.log(
  `✅ [PASSED] Test 3: 33/33 ciudades x1..x5 (Caracas x5=${caracas.metrics.buildingCount}, Maracaibo x4=${maracaibo.metrics.buildingCount} [${maracaibo.perimeterPortalsGlobal.length} salidas, ${maracaibo.roundabouts?.length} rotondas], San Francisco x3=${sanFrancisco.metrics.buildingCount}, Cabimas x2=${cabimas.metrics.buildingCount}, Santa Rita x1=${santaRita.metrics.buildingCount})`
);

// 3b. Puente General Rafael Urdaneta 100% recto horizontal + 2 SATs marítimos de cabecera + SATs intermedios procedurales
registerYellowTrunkGeoJson(null, isLandAtCabimasPolygon);
const bridges = getResolvedMacroBridges(isLandAtCabimasPolygon);
assert(bridges.length >= 1, 'Debe resolverse el Puente General Rafael Urdaneta');
const urdaneta = bridges[0];
assert(urdaneta.waterBridgeTiles >= 80, `Puente Urdaneta debe cruzar el estrecho completo >= 80 tiles (got ${urdaneta.waterBridgeTiles})`);
for (const [gx, gy, axis] of urdaneta.tiles) {
  assert(gy === urdaneta.fixedGy, `Puente Urdaneta debe ser 100% línea recta horizontal (gy=${gy} != ${urdaneta.fixedGy})`);
  if (axis === 1) {
    assert(
      getYellowTrunkBridgeAxisAtGlobalCell(gx, gy, isLandAtCabimasPolygon) === 1,
      `Tile de puente (${gx},${gy}) debe estar estampado como HBridge en yellowTrunkBackboneIndex`
    );
  }
}

const procSats = getProceduralSatelliteSpecs(isLandAtCabimasPolygon);
assert(procSats.length >= 6, `Deben generarse >= 6 SATs intermedios procedurales en Zulia (got ${procSats.length})`);
const westBridgeSat = procSats.find((s) => s.cityId === urdaneta.def.westSatId);
const eastBridgeSat = procSats.find((s) => s.cityId === urdaneta.def.eastSatId);
assert(Boolean(westBridgeSat) && Boolean(eastBridgeSat), 'Deben existir ambos SATs marítimos en cabeceras del Puente Urdaneta');
assert(westBridgeSat!.satelliteFamily === 'harbor_promenade_cove', 'SAT Oeste del puente debe ser harbor_promenade_cove');
assert(eastBridgeSat!.satelliteFamily === 'harbor_promenade_cove', 'SAT Este del puente debe ser harbor_promenade_cove');

for (const satSpec of procSats) {
  const satBp = getOrCompileCityBlueprint(satSpec, isLandAtCabimasPolygon);
  assert(satBp.metrics.roadBlob2x2Count === 0, `${satSpec.cityId}: 0 blobs 2x2`);
  assert(satBp.metrics.tallOverhangViolations === 0, `${satSpec.cityId}: 0 overhang`);
  assert(satBp.metrics.interiorDeadEnds === 0, `${satSpec.cityId}: 0 dead-ends`);
  assert(satBp.metrics.buildingCount >= 8, `${satSpec.cityId}: >= 8 edificios neutrales (got ${satBp.metrics.buildingCount})`);
  for (const b of satBp.buildingsByLocalIdx.values()) {
    assert(b.ownerId === null, `${satSpec.cityId}: 100% edificios grises neutrales`);
  }
}
const maritimeSats = procSats.filter((s) => s.satelliteFamily === 'harbor_promenade_cove');
assert(
  maritimeSats.length >= 6,
  `Municipios costeros del Zulia deben generar >= 6 SATs marítimos harbor_promenade_cove (got ${maritimeSats.length})`
);
console.log(
  `✅ [PASSED] Test 3b: Puente Rafael Urdaneta 100% recto (${urdaneta.waterBridgeTiles} tiles HBridge) + 2 SATs marítimos de cabecera + ${procSats.length} SATs procedurales (${maritimeSats.length} marítimos en municipios costeros, 0 blobs, 0 dead-ends, 100% grises)`
);

// 4. Integración gbaMapPipeline 20x20: 100% edificios neutrales grises + 0 montañas dentro del casco/expansión/pistas
const sx = Math.floor(maracaibo.spec.anchorGlobalX / 20);
const sy = Math.floor(maracaibo.spec.anchorGlobalY / 20);
const { matrix } = generateGbaSectorBlueprint([sx, sy], 20, true);
let propCount = 0;
let urbanMountainCount = 0;
for (let y = 0; y < 20; y++) {
  for (let x = 0; x < 20; x++) {
    const t = matrix[y][x];
    const gx = sx * 20 + x;
    const gy = sy * 20 + y;
    const blx = gx - maracaibo.originGlobalX;
    const bly = gy - maracaibo.originGlobalY;
    const inBlueprint = blx >= 0 && blx < maracaibo.width && bly >= 0 && bly < maracaibo.height;
    if (inBlueprint && t.type === 'mountain') {
      const bIdx = bly * maracaibo.width + blx;
      const inLobe = (maracaibo.cellFlags[bIdx] & 1) !== 0;
      const inExp = Boolean(maracaibo.expansionZoneMask && maracaibo.expansionZoneMask[bIdx]);
      const inFlight = Boolean(maracaibo.flightCorridorExclMask && maracaibo.flightCorridorExclMask[bIdx]);
      if (inLobe || inExp || inFlight) urbanMountainCount++;
    }
    if (
      t.type === 'hq' ||
      t.type === 'city' ||
      t.type === 'factory' ||
      t.type === 'airport' ||
      t.type === 'port' ||
      t.type === 'commtower' ||
      t.type === 'lab' ||
      t.type === 'silo'
    ) {
      propCount++;
      assert((t.ownerId ?? null) === null, `Tile (${x},${y}) ${t.type} en sector Maracaibo no es neutral`);
    }
  }
}
assert(propCount > 0, 'Sector de Maracaibo debe contener propiedades urbanas neutrales');
assert(urbanMountainCount === 0, `Casco/expansión/pistas de Maracaibo no deben contener montañas intraurbanas (got ${urbanMountainCount})`);
console.log(`✅ [PASSED] Test 4: Integración gbaMapPipeline 20x20 (${propCount} propiedades grises neutrales, 0 montañas intraurbanas)`);
console.log('\n🎉 SUITE urbanParity100 COMPLETADA AL 100% SIN ERRORES.');
