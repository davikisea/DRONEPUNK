/**
 * ==============================================================================
 * SUITE DE PRUEBAS DETERMINISTAS: AUDITORÍA TOPOLÓGICA DE CARTOGRAFÍA VECTORIAL
 * ==============================================================================
 * Valida la integridad matemática (desfase 0.000 m) de la cartografía WebGL
 * generada por el pipeline TopoJSON Bottom-Up:
 *   1. IDs canónicos (25 regiones + 21 municipios Zulia) y validez geométrica.
 *   2. Coherencia Estado-Estado bit-a-bit (devanado opuesto) e igualdad con mesh_state_internal.
 *   3. Coherencia Municipio-a-Estado (perímetro exterior de 21 municipios de Zulia vs REG_VE_02).
 *   4. Unicidad de aristas sin duplicados ni segmentos cero en theatre_borders_mesh.json.
 *   5. Coherencia exacta entre world_land.json (VEN) y el exterior de theatre_regions.json.
 *   6. Invariantes Zero-Raster, maxzoom y tolerance: 0 en TacticalWorldMap.tsx.
 * ==============================================================================
 */

import path from 'node:path';
import process from 'node:process';
import {
  CANONICAL_VENEZUELA_REGIONS,
  ZOOM_GLOBAL,
  ZOOM_OPERACIONAL,
  ZOOM_TACTICO,
} from '@domains/world';
import {
  CANONICAL_REGION_IDS,
  CANONICAL_ZULIA_MUNICIPALITY_IDS,
  auditCanonicalIdsAndGeometry,
  auditStateToStateBoundaries,
  auditZuliaMunicipalitiesCoherence,
  auditBordersMeshUniqueness,
  auditWorldLandVenezuelaCoherence,
  auditTacticalWorldMapInvariants,
  pointToSegmentDistKm,
  signedShoelaceArea,
} from '../../../../scripts/verify-map-topology.mjs';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`❌ [ASSERTION FAILED]: ${message}`);
  }
}

console.log('==============================================================================');
console.log('EJECUTANDO SUITE: AUDITORÍA TOPOLÓGICA DETERMINISTA DE CARTOGRAFÍA (0.000 m)');
console.log('==============================================================================\n');

const rootDir = path.resolve(process.cwd());
let passedTests = 0;

try {
  // ----------------------------------------------------------------------------
  // TEST 0: Alineación SSOT con @domains/world
  // ----------------------------------------------------------------------------
  console.log('--- PRE-CHECK: ALINEACIÓN SSOT CON @domains/world ---');
  assert(ZOOM_GLOBAL === 3.5, 'ZOOM_GLOBAL debe ser 3.5');
  assert(ZOOM_OPERACIONAL === 10.0, 'ZOOM_OPERACIONAL debe ser 10.0');
  assert(ZOOM_TACTICO === 15.0, 'ZOOM_TACTICO debe ser 15.0');

  const canonicalEngineIds = new Set(CANONICAL_VENEZUELA_REGIONS.map((r) => r.id));
  for (let i = 1; i <= 24; i++) {
    const regId = `REG_VE_${String(i).padStart(2, '0')}`;
    assert(canonicalEngineIds.has(regId), `CANONICAL_VENEZUELA_REGIONS debe incluir ${regId}`);
    assert(CANONICAL_REGION_IDS.includes(regId), `CANONICAL_REGION_IDS debe incluir ${regId}`);
  }
  assert(CANONICAL_REGION_IDS.length === 25, 'Deben auditarse exactamente 25 IDs de región');
  assert(
    CANONICAL_ZULIA_MUNICIPALITY_IDS.length === 21,
    'Deben auditarse exactamente 21 IDs municipales de Zulia'
  );
  assert(
    Math.abs(signedShoelaceArea([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]) - 4) < 1e-12,
    'signedShoelaceArea debe calcular exactamente el área de un polígono cerrado'
  );
  assert(
    pointToSegmentDistKm([0, 0], [0, 0], [1, 0]) === 0,
    'pointToSegmentDistKm sobre extremo debe ser 0'
  );
  console.log('✅ [PASSED] Pre-check SSOT: 24 entidades REG_VE_* + BUF_MARITIME_CARIBE + 21 MUN_ZULIA_*');
  passedTests++;

  // ----------------------------------------------------------------------------
  // TEST 1: IDs Canónicos y Validez de Anillos
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST 1: IDS CANÓNICOS Y VALIDEZ DE GEOMETRÍAS ---');
  const t1 = auditCanonicalIdsAndGeometry({ rootDir });
  assert(t1.passed, `Test 1 falló:\n${t1.errors.join('\n')}`);
  assert(t1.metrics.regionsCount === 25, 'theatre_regions.json debe tener exactamente 25 features');
  assert(
    t1.metrics.zuliaMunicipalitiesCount === 21,
    'zulia_municipalities.json debe tener exactamente 21 features'
  );
  assert(t1.metrics.ringViolations === 0, 'Debe haber 0 violaciones de anillos');
  console.log(
    `✅ [PASSED] Test 1: 25 regiones (${t1.metrics.regionRings} anillos, ${t1.metrics.regionVertices} vértices), 21 municipios Zulia (${t1.metrics.zuliaRings} anillos, ${t1.metrics.zuliaVertices} vértices), 0 anillos degenerados`
  );
  passedTests++;

  // ----------------------------------------------------------------------------
  // TEST 2: Coherencia Estado-Estado (0.000 m) e igualdad con mesh_state_internal
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST 2: COHERENCIA ESTADO-ESTADO Y MALLA INTERNA ---');
  const t2 = auditStateToStateBoundaries({ rootDir });
  assert(t2.passed, `Test 2 falló:\n${t2.errors.join('\n')}`);
  assert(t2.metrics.sameDirCollisions === 0, 'Debe haber 0 colisiones en el mismo sentido');
  assert(t2.metrics.multiOwnerViolations === 0, 'Debe haber 0 aristas con más de 2 estados dueños');
  assert(t2.metrics.oppositeWindingViolations === 0, 'Todas las aristas compartidas deben tener devanado opuesto');
  assert(t2.metrics.nonSharingNearMisses === 0, 'Debe haber 0 near-misses entre estados sin arista compartida');
  assert(t2.metrics.internalNearMisses === 0, 'Debe haber 0 near-misses internos en fronteras adyacentes');
  assert(t2.metrics.sliverHoles === 0, 'Debe haber 0 huecos/slivers internos entre estados');
  console.log(
    `✅ [PASSED] Test 2: ${t2.metrics.adjacentStatePairs} pares adyacentes, ${t2.metrics.sharedInternalSegments} aristas internas en devanado opuesto exacto (0.000 m), 100% idénticas a mesh_state_internal`
  );
  passedTests++;

  // ----------------------------------------------------------------------------
  // TEST 3: Coherencia Municipio-a-Estado (Zulia vs REG_VE_02, 0.000 m)
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST 3: COHERENCIA PERÍMETRO EXTERIOR ZULIA VS REG_VE_02 ---');
  const t3 = auditZuliaMunicipalitiesCoherence({ rootDir });
  assert(t3.passed, `Test 3 falló:\n${t3.errors.join('\n')}`);
  assert(t3.metrics.edgeMismatches === 0, 'Debe haber 0 aristas distintas entre Zulia exterior y REG_VE_02');
  assert(t3.metrics.vertexMismatches === 0, 'Debe haber 0 vértices distintos entre Zulia exterior y REG_VE_02');
  console.log(
    `✅ [PASSED] Test 3: ${t3.metrics.zuliaExteriorEdges} aristas y ${t3.metrics.zuliaExteriorVertices} vértices exteriores de Zulia coinciden 100% (0.000 m) con REG_VE_02`
  );
  passedTests++;

  // ----------------------------------------------------------------------------
  // TEST 4: Cero Bordes Duplicados en theatre_borders_mesh.json
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST 4: UNICIDAD EN theatre_borders_mesh.json ---');
  const t4 = auditBordersMeshUniqueness({ rootDir });
  assert(t4.passed, `Test 4 falló:\n${t4.errors.join('\n')}`);
  assert(t4.metrics.duplicateSegments === 0, 'Debe haber 0 segmentos duplicados en theatre_borders_mesh.json');
  assert(t4.metrics.zeroLengthSegments === 0, 'Debe haber 0 segmentos de longitud cero en theatre_borders_mesh.json');
  console.log(
    `✅ [PASSED] Test 4: ${t4.metrics.uniqueSegments} segmentos no dirigidos únicos en ${t4.metrics.meshFeatures} features (0 duplicados, 0 longitud cero)`
  );
  passedTests++;

  // ----------------------------------------------------------------------------
  // TEST 5: Coherencia de Masa Terrestre Venezuela en world_land.json
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST 5: COHERENCIA VENEZUELA EN world_land.json ---');
  const t5 = auditWorldLandVenezuelaCoherence({ rootDir });
  assert(t5.passed, `Test 5 falló:\n${t5.errors.join('\n')}`);
  assert(t5.metrics.venFeatureCount === 1, 'world_land.json debe contener exactamente 1 feature de Venezuela');
  assert(t5.metrics.mismatchesVsRegions === 0, 'world_land[VEN] debe coincidir 100% con el exterior de theatre_regions.json');
  assert(t5.metrics.mismatchesVsMesh === 0, 'world_land[VEN] debe coincidir 100% con mesh_theatre_exterior + mesh_federal_dependencies');
  console.log(
    `✅ [PASSED] Test 5: world_land.json [VEN] coincide 100% (${t5.metrics.venExteriorSegments} aristas exteriores, desfase 0.000 m)`
  );
  passedTests++;

  // ----------------------------------------------------------------------------
  // TEST 6: Auditoría Read-Only de TacticalWorldMap.tsx (Zero-Raster y LOD)
  // ----------------------------------------------------------------------------
  console.log('\n--- TEST 6: AUDITORÍA ZERO-RASTER Y LOD EN TacticalWorldMap.tsx ---');
  const t6 = auditTacticalWorldMapInvariants({ rootDir });
  assert(t6.passed, `Test 6 falló:\n${t6.errors.join('\n')}`);
  assert(t6.metrics.externalHttpUrls === 0, 'TacticalWorldMap.tsx debe tener 0 URLs externas http(s)');
  assert(t6.metrics.rasterLayerDeclarations === 0, 'TacticalWorldMap.tsx debe tener 0 capas raster');
  assert(t6.metrics.maxzoomVerifiedLayers === 4, 'Las 4 capas de contorno deben declarar maxzoom');
  assert(t6.metrics.zeroToleranceVerifiedSources === 3, 'Las 3 fuentes GeoJSON tácticas deben declarar tolerance: 0');
  assert(t6.metrics.zOrderValid === true, 'El orden Z de las capas en TacticalWorldMap.tsx debe ser estricto');
  console.log(
    `✅ [PASSED] Test 6: 0 URLs raster externas, maxzoom verificado en 4/4 capas, tolerance: 0 verificado en 3/3 fuentes GeoJSON, Z-order estricto válido`
  );
  passedTests++;

  console.log('\n------------------------------------------------------------------------------');
  console.log(`RESUMEN AUDITORÍA CARTOGRÁFICA TOPOJSON: ${passedTests}/${passedTests} SUITES PASARON`);
  console.log('✅ INTEGRIDAD TOPOLÓGICA VERIFICADA AL 100% (0.000 m)');
  console.log('==============================================================================\n');
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('\n❌ ERROR EN AUDITORÍA TOPOLÓGICA CARTOGRÁFICA:', message);
  process.exit(1);
}
