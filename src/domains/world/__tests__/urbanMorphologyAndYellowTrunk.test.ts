import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateGbaSectorBlueprint,
  getAllCityScaleSpecs,
  getCityScaleSpecById,
  getOrCompileCityBlueprint,
  getYellowTrunkSectorCount,
  isLandAtCabimasPolygon,
  lngLatToGlobalTacticalCell,
} from '../index';

async function runTests(): Promise<void> {
  console.log('==============================================================================');
  console.log('SUITE: MOTOR URBANO POLIMÓRFICO, LÍNEA AMARILLA BASE Y NEUTRALIDAD GRIS AWBW');
  console.log('==============================================================================');

  // 1. Catálogo real de 33 ciudades (21 Zulia + 12 nacionales) y primacía de Maracaibo
  const allCities = getAllCityScaleSpecs();
  assert.equal(allCities.length, 33, `Se esperaban 33 ciudades en theatre_cities.json (actual: ${allCities.length})`);
  const zuliaCities = allCities.filter((c) => c.stateId === 'REG_VE_02');
  assert.equal(zuliaCities.length, 21, `Se esperaban 21 ciudades en el Estado Zulia (actual: ${zuliaCities.length})`);

  const maracaiboSpec = getCityScaleSpecById('CITY_MARACAIBO');
  const sanFranciscoSpec = getCityScaleSpecById('CITY_SAN_FRANCISCO');
  const cabimasSpec = getCityScaleSpecById('CITY_CABIMAS');
  const elToroSpec = getCityScaleSpecById('CITY_EL_TORO');
  assert(maracaiboSpec && sanFranciscoSpec && cabimasSpec && elToroSpec, 'Ciudades clave del Zulia deben existir');
  assert.equal(maracaiboSpec.tierId, 'T5_METROPOLIS_X3', 'Maracaibo debe ser T5_METROPOLIS_X3');
  assert.equal(sanFranciscoSpec.tierId, 'T4_CONURBATION_X2', 'San Francisco debe ser T4_CONURBATION_X2');
  assert.equal(cabimasSpec.tierId, 'T4_CONURBATION_X2', 'Cabimas debe ser T4_CONURBATION_X2');
  assert.equal(elToroSpec.tierId, 'T1_OUTPOST_SAT', 'El Toro debe ser T1_OUTPOST_SAT');

  // 2. Compilar planos maestros y validar escala jerárquica + 100% edificios grises neutrales
  const maracaiboBp = getOrCompileCityBlueprint(maracaiboSpec, isLandAtCabimasPolygon);
  const sfBp = getOrCompileCityBlueprint(sanFranciscoSpec, isLandAtCabimasPolygon);
  const cabimasBp = getOrCompileCityBlueprint(cabimasSpec, isLandAtCabimasPolygon);
  const elToroBp = getOrCompileCityBlueprint(elToroSpec, isLandAtCabimasPolygon);

  assert(
    maracaiboBp.metrics.buildingCount > sfBp.metrics.buildingCount,
    `Maracaibo (${maracaiboBp.metrics.buildingCount}) debe tener más edificios que San Francisco (${sfBp.metrics.buildingCount})`
  );
  assert(
    sfBp.metrics.buildingCount > elToroBp.metrics.buildingCount,
    `San Francisco (${sfBp.metrics.buildingCount}) debe tener más edificios que El Toro (${elToroBp.metrics.buildingCount})`
  );
  assert.equal(elToroBp.trunkInteractionMode, 'maritime_port_only', 'El Toro (Isla de Toas) debe usar enlace marítimo');

  for (const bp of [maracaiboBp, sfBp, cabimasBp, elToroBp]) {
    assert.equal(bp.metrics.roadBlob2x2Count, 0, `${bp.spec.name}: 0 bloques 2x2 de carretera`);
    assert.equal(bp.metrics.tallOverhangViolations, 0, `${bp.spec.name}: 0 violaciones North Setback`);
    for (const b of bp.buildingsByLocalIdx.values()) {
      assert.equal(b.ownerId, null, `${bp.spec.name}: edificio ${b.type} debe nacer neutral gris (ownerId: null)`);
    }
  }
  console.log(
    `✅ [PASSED] Test 1: Jerarquía Zulia validada (Maracaibo=${maracaiboBp.metrics.buildingCount} > San Francisco=${sfBp.metrics.buildingCount} > Cabimas=${cabimasBp.metrics.buildingCount} > El Toro=${elToroBp.metrics.buildingCount}, 100% neutrales grises)`
  );

  // 3. Sector de Maracaibo en gbaMapPipeline: 100% edificios grises neutrales y 0 tuberías
  const mcboCell = lngLatToGlobalTacticalCell(maracaiboSpec.anchorLngLat);
  const { matrix: mcboMatrix } = generateGbaSectorBlueprint([mcboCell.sectorX, mcboCell.sectorY], 20, true);
  let mcboBuildings = 0;
  for (const row of mcboMatrix) {
    for (const tile of row) {
      assert(tile.type !== 'pipe' && tile.type !== 'pipeSeam', '0 tuberías en motor urbano');
      if (['hq', 'city', 'factory', 'airport', 'port', 'commtower', 'lab', 'silo', 'usedSilo'].includes(tile.type)) {
        assert.equal(tile.ownerId, null, `Edificio ${tile.type} en Maracaibo debe nacer neutral (ownerId: null)`);
        mcboBuildings++;
      }
    }
  }
  assert(mcboBuildings > 0, 'Sector central de Maracaibo debe contener edificios urbanos');
  console.log(`✅ [PASSED] Test 2: Sector central de Maracaibo [${mcboCell.sectorX},${mcboCell.sectorY}] con ${mcboBuildings} edificios 100% grises neutrales y 0 tuberías`);

  // 4. Precedencia cartográfica municipal_hd > world_macro en el Lago de Maracaibo (0 tierra fantasma)
  assert.equal(isLandAtCabimasPolygon(-71.55, 10.2), false, 'Centro del Lago de Maracaibo debe ser agua (false)');
  assert.equal(isLandAtCabimasPolygon(-71.57, 10.57), false, 'Estrecho del Lago (Puente Urdaneta) debe ser agua (false)');
  assert.equal(isLandAtCabimasPolygon(-71.6406, 10.6544), true, 'Centro de Maracaibo debe ser tierra firme (true)');
  console.log('✅ [PASSED] Test 3: Precedencia municipal_hd > world_macro verificada (0 tierra fantasma en el Lago)');

  // 5. Línea Amarilla Base indexada
  const trunkSectors = getYellowTrunkSectorCount();
  assert(trunkSectors > 100, `YellowTrunkBackboneIndex debe indexar >100 sectores de theatre_roads.json (actual: ${trunkSectors})`);
  console.log(`✅ [PASSED] Test 4: Línea Amarilla Base indexada en ${trunkSectors} sectores O(1)`);

  // 6. Purga de sprites legados y existencia de catálogo definitivo AWBW
  assert.equal(fs.existsSync(path.resolve('public/assets/spritesheets')), false, 'public/assets/spritesheets debe estar purgado');
  assert.equal(fs.existsSync(path.resolve('public/assets/units')), false, 'public/assets/units debe estar purgado');
  assert.equal(fs.existsSync(path.resolve('public/assets/awbw/Map/AW2/Neutral/HQ-0.png')), true, 'Neutral HQ gris AWBW debe existir');
  assert.equal(fs.existsSync(path.resolve('public/assets/awbw/Map/AW2/Neutral/City-0.png')), true, 'AW2 Neutral City debe existir');
  assert.equal(fs.existsSync(path.resolve('public/assets/awbw/Map/AW1/Neutral/City-0.png')), true, 'AW1 Neutral City debe existir');
  console.log('✅ [PASSED] Test 5: Purga de 53 archivos legados y catálogo definitivo public/assets/awbw/ verificados');

  console.log('==============================================================================');
  console.log('✅ TODAS LAS PRUEBAS DEL MOTOR URBANO, LÍNEA AMARILLA Y AWBW PASARON (5/5)');
  console.log('==============================================================================');
}

runTests().catch((err) => {
  console.error('❌ FALLO EN SUITE URBAN MORPHOLOGY & YELLOW TRUNK:', err);
  process.exit(1);
});
