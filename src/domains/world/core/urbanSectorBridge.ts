/**
 * ==============================================================================
 * PUENTE DE SECTORES URBANOS Y CACHÉ DE PLANOS MAESTROS (O(1) POR SECTOR)
 * ==============================================================================
 * Convergencia Equipo Alpha (A4, A5) + Beta (B2, B4) + Gamma (G4, G5):
 * - Compila cada ciudad de public/map/theatre_cities.json (33 ciudades) UNA SOLA VEZ
 * - Memoria total para 33 ciudades: ~212 KB (Uint8Array bitflags)
 * - Rebanado O(1) por sector 20x20 (<= 0.015 ms)
 * - Provee getUrbanSectorOverlaySlice y lectura readonly de frontera sur sin
 *   eviccionar sectorLruCache <= 64
 * ==============================================================================
 */

import {
  URBAN_CELL_BIT_BRIDGE,
  URBAN_CELL_BIT_LOBE,
  URBAN_CELL_BIT_PARK,
  URBAN_CELL_BIT_PORT_WATER,
  URBAN_CELL_BIT_ROAD,
  URBAN_CELL_BIT_TREE_CROWN,
  URBAN_CELL_BIT_YELLOW_TRUNK,
  type CityScaleSpec,
  type UrbanCityBlueprint,
  type UrbanSectorOverlayCell,
  type UrbanSectorOverlaySlice,
} from '../types/urbanMorphologyTypes';
import {
  buildUrbanContainmentMasks,
  resolveInlandSafeCityAnchor,
  snapCoastalCityAnchorToShore,
} from './urbanContainmentMasks';
import { getAllCityScaleSpecs } from './urbanPopulationCatalog';
import { getProceduralSatelliteSpecs, resetProceduralSatellitesCache } from './proceduralSatelliteNetwork';
import { resetMacroBridgesCache } from './macroBridgeCorridors';
import {
  buildArterialSkeletonAndYellowSplice,
  count2x2RoadBlobs,
  synthesizeUrbanSilhouette,
} from './urbanSilhouetteAndSkeleton';
import { planFunctionalDistricts } from './urbanDistrictPlanner';
import { populateMicroGrainsInfillAndKCore } from './urbanDistrictAndGrainEngine';
import { compileOrganicSatelliteBlueprint } from './urbanSatelliteTownEngine';
import {
  computeCircleIoU,
  computeInternalMirrorIoU,
  computeTopoSignature9D,
  maxD4IoU,
  resolveCityDnaProfile,
} from './urbanVariabilityEngine';
import { findNearestYellowTrunkCell } from './yellowTrunkBackboneIndex';

const GRID_SIZE = 20;

const cityBlueprintCache = new Map<string, UrbanCityBlueprint>();
const sectorToCityIdsIndex = new Map<string, string[]>();
let sectorIndexBuilt = false;

function getCityWindowOrigin(spec: CityScaleSpec): [number, number] {
  const half = Math.floor(spec.canvasSizeTiles / 2);
  return [spec.anchorGlobalX - half, spec.anchorGlobalY - half];
}

export function getAllUrbanAndSatSpecs(
  landPredicate: (lng: number, lat: number) => boolean
): readonly CityScaleSpec[] {
  const cities = getAllCityScaleSpecs();
  const sats = getProceduralSatelliteSpecs(landPredicate);
  return [...cities, ...sats];
}

function ensureSectorCityIndexBuilt(
  landPredicate: (lng: number, lat: number) => boolean
): void {
  if (sectorIndexBuilt) return;
  const specs = getAllUrbanAndSatSpecs(landPredicate);
  if (specs.length === 0) return;

  sectorToCityIdsIndex.clear();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const [ox, oy] = getCityWindowOrigin(spec);
    const minSX = Math.floor(ox / GRID_SIZE);
    const maxSX = Math.floor((ox + spec.canvasSizeTiles - 1) / GRID_SIZE);
    const minSY = Math.floor(oy / GRID_SIZE);
    const maxSY = Math.floor((oy + spec.canvasSizeTiles - 1) / GRID_SIZE);
    for (let sy = minSY; sy <= maxSY; sy++) {
      for (let sx = minSX; sx <= maxSX; sx++) {
        const key = `${sx}_${sy}`;
        let list = sectorToCityIdsIndex.get(key);
        if (!list) {
          list = [];
          sectorToCityIdsIndex.set(key, list);
        }
        list.push(spec.cityId);
      }
    }
  }
  sectorIndexBuilt = true;
}

export function resetUrbanBlueprintCache(): void {
  cityBlueprintCache.clear();
  sectorToCityIdsIndex.clear();
  sectorIndexBuilt = false;
  resetProceduralSatellitesCache();
  resetMacroBridgesCache();
}

export function getOrCompileCityBlueprint(
  spec: CityScaleSpec,
  landPredicate: (lng: number, lat: number) => boolean
): UrbanCityBlueprint {
  const cached = cityBlueprintCache.get(spec.cityId);
  if (cached) return cached;

  const width = spec.canvasSizeTiles;
  const height = spec.canvasSizeTiles;
  const [originGlobalX, originGlobalY] = getCityWindowOrigin(spec);

  const masks = buildUrbanContainmentMasks(
    originGlobalX,
    originGlobalY,
    width,
    height,
    spec.municipalityId,
    landPredicate,
    GRID_SIZE
  );

  const nominalLocalX = spec.anchorGlobalX - originGlobalX;
  const nominalLocalY = spec.anchorGlobalY - originGlobalY;

  const nearestTrunk = findNearestYellowTrunkCell(
    spec.anchorGlobalX,
    spec.anchorGlobalY,
    landPredicate
  );
  const nearestTrunkLocal: [number, number] | null = nearestTrunk
    ? [nearestTrunk.gx - originGlobalX, nearestTrunk.gy - originGlobalY]
    : null;

  const [rawSafeX, rawSafeY] = resolveInlandSafeCityAnchor(
    masks,
    nominalLocalX,
    nominalLocalY,
    10,
    nearestTrunkLocal
  );
  const [safeCenterLocalX, safeCenterLocalY] = snapCoastalCityAnchorToShore(
    masks,
    rawSafeX,
    rawSafeY,
    spec.waterfrontDir,
    spec.radiusTiles
  );

  // Despacho polimórfico: SATs procedurales usan las 5 familias orgánicas 33x33 (L4430-4530);
  // todas las ciudades reales (x1..x5) corren el pipeline completo SPRITE-FORGE-STUDIO.
  if (
    spec.isProceduralSat ||
    spec.tierId === 'T1_OUTPOST_SAT' ||
    spec.tierId === 'T2_MUNICIPAL_HUB_SAT'
  ) {
    const satBp = compileOrganicSatelliteBlueprint(
      spec,
      masks,
      originGlobalX,
      originGlobalY,
      safeCenterLocalX,
      safeCenterLocalY,
      landPredicate
    );
    cityBlueprintCache.set(spec.cityId, satBp);
    return satBp;
  }

  // Pipeline completo SPRITE-FORGE-STUDIO para ciudades Core (T3 x1, T4 x2, T5 x3)
  let dna = resolveCityDnaProfile(spec, 0);
  let cellFlags = new Uint8Array(width * height);
  let sil = synthesizeUrbanSilhouette(spec, masks, safeCenterLocalX, safeCenterLocalY, cellFlags, dna);

  // Verificación D4 IoU anti-colisión contra ciudades ya compiladas en el mismo estado
  for (let attempt = 1; attempt <= 3; attempt++) {
    let collided = false;
    for (const prev of cityBlueprintCache.values()) {
      if (prev.spec.stateId !== spec.stateId) continue;
      if (prev.spec.tierId === 'T1_OUTPOST_SAT' || prev.spec.tierId === 'T2_MUNICIPAL_HUB_SAT') continue;
      const prevLobe = new Uint8Array(prev.width * prev.height);
      for (let i = 0; i < prevLobe.length; i++) {
        if ((prev.cellFlags[i] & 1) !== 0) prevLobe[i] = 1;
      }
      if (maxD4IoU(sil.inlandMask, width, height, prevLobe, prev.width, prev.height, 32) > 0.85) {
        collided = true;
        break;
      }
    }
    if (!collided) break;
    dna = resolveCityDnaProfile(spec, attempt * 0.55);
    cellFlags = new Uint8Array(width * height);
    sil = synthesizeUrbanSilhouette(spec, masks, safeCenterLocalX, safeCenterLocalY, cellFlags, dna);
  }

  const bridgeAxis = new Uint8Array(width * height);

  const skel = buildArterialSkeletonAndYellowSplice(
    spec,
    dna,
    sil,
    masks,
    originGlobalX,
    originGlobalY,
    cellFlags,
    bridgeAxis,
    landPredicate
  );

  const plan = planFunctionalDistricts(
    spec,
    dna,
    sil,
    skel,
    masks,
    originGlobalX,
    originGlobalY,
    cellFlags
  );

  const grainRes = populateMicroGrainsInfillAndKCore(
    spec,
    sil,
    skel,
    plan,
    masks,
    originGlobalX,
    originGlobalY,
    cellFlags
  );

  const roadBlob2x2Count = count2x2RoadBlobs(cellFlags, width, height);
  const topoSig = computeTopoSignature9D(
    sil.inlandMask,
    skel.roadMask,
    plan.buildingsMask,
    skel.roundabouts.length,
    width,
    height
  );

  const circleIoU = computeCircleIoU(sil.inlandMask, width, height);
  const internalMirrorIoU = computeInternalMirrorIoU(sil.inlandMask, width, height);

  const blueprint: UrbanCityBlueprint = {
    spec,
    originGlobalX,
    originGlobalY,
    width,
    height,
    safeCenterLocalX,
    safeCenterLocalY,
    trunkInteractionMode: skel.trunkInteractionMode,
    cellFlags,
    bridgeAxis,
    buildingsByLocalIdx: plan.buildingsByLocalIdx,
    perimeterPortalsGlobal: skel.perimeterPortalsGlobal,
    roundabouts: skel.roundabouts,
    functionalDistricts: plan.districts,
    residentialDistricts: grainRes.residentialDistricts,
    expansionZoneMask: grainRes.expansionZoneMask,
    flightCorridorExclMask: plan.flightCorridorExclMask,
    districtGrid: grainRes.districtGrid,
    districtLegend: grainRes.districtLegend,
    interchangeArrows: grainRes.validatedInterchangeArrows,
    futurePortPlots: grainRes.futurePortPlots,
    metrics: {
      dryAreaTiles: sil.dryAreaTiles,
      buildingCount: plan.buildingsByLocalIdx.size,
      roadBlob2x2Count,
      tallOverhangViolations: grainRes.tallOverhangViolations,
      interiorDeadEnds: grainRes.remainingDeadEnds,
      maxEmptySquareSide: grainRes.maxEmptySquareSideValue,
      functionalDistrictsCount: plan.districts.length,
      distinctMicroGrainsCount: grainRes.distinctMicroGrainsCount,
      circleIoU,
      internalMirrorIoU,
      topoSignature9D: topoSig,
    },
  };

  cityBlueprintCache.set(spec.cityId, blueprint);
  return blueprint;
}

/**
 * Rebanado O(1) de todos los planos urbanos que intersectan el sector (sectorX, sectorY).
 * Retorna null en sectores rurales (0 edificios aleatorios).
 */
export function getUrbanSectorOverlaySlice(
  sectorX: number,
  sectorY: number,
  landPredicate: (lng: number, lat: number) => boolean
): UrbanSectorOverlaySlice | null {
  ensureSectorCityIndexBuilt(landPredicate);
  const cityIds = sectorToCityIdsIndex.get(`${sectorX}_${sectorY}`);
  if (!cityIds || cityIds.length === 0) return null;

  const allSpecs = getAllUrbanAndSatSpecs(landPredicate);
  const cells: UrbanSectorOverlayCell[] = [];
  const treeCrownLocalIndices: number[] = [];
  const clearedPlainLocalIndices: number[] = [];
  const occupied = new Uint8Array(GRID_SIZE * GRID_SIZE);

  const sectorMinGx = sectorX * GRID_SIZE;
  const sectorMinGy = sectorY * GRID_SIZE;

  for (let c = 0; c < cityIds.length; c++) {
    const spec = allSpecs.find((s) => s.cityId === cityIds[c]);
    if (!spec) continue;
    const bp = getOrCompileCityBlueprint(spec, landPredicate);

    const startGx = Math.max(sectorMinGx, bp.originGlobalX);
    const endGx = Math.min(sectorMinGx + GRID_SIZE - 1, bp.originGlobalX + bp.width - 1);
    const startGy = Math.max(sectorMinGy, bp.originGlobalY);
    const endGy = Math.min(sectorMinGy + GRID_SIZE - 1, bp.originGlobalY + bp.height - 1);

    for (let gy = startGy; gy <= endGy; gy++) {
      for (let gx = startGx; gx <= endGx; gx++) {
        const slx = gx - sectorMinGx;
        const sly = gy - sectorMinGy;
        const sIdx = sly * GRID_SIZE + slx;
        if (occupied[sIdx] === 1) continue;

        const blx = gx - bp.originGlobalX;
        const bly = gy - bp.originGlobalY;
        const bIdx = bly * bp.width + blx;
        const flags = bp.cellFlags[bIdx];

        const bldg = bp.buildingsByLocalIdx.get(bIdx);
        if (bldg) {
          occupied[sIdx] = 1;
          cells.push({
            localX: slx,
            localY: sly,
            type: bldg.type,
            ownerId: null,
            neutralSkinVariant: bldg.neutralSkinVariant,
            portUnderlayWater: (flags & URBAN_CELL_BIT_PORT_WATER) !== 0,
          });
          continue;
        }

        if ((flags & URBAN_CELL_BIT_BRIDGE) !== 0) {
          occupied[sIdx] = 1;
          cells.push({
            localX: slx,
            localY: sly,
            type: 'bridge',
            ownerId: null,
            isYellowTrunk: (flags & URBAN_CELL_BIT_YELLOW_TRUNK) !== 0,
            bridgeAxis: (bp.bridgeAxis[bIdx] === 2 ? 2 : 1) as 1 | 2,
          });
          continue;
        }

        if ((flags & URBAN_CELL_BIT_ROAD) !== 0) {
          occupied[sIdx] = 1;
          cells.push({
            localX: slx,
            localY: sly,
            type: 'road',
            ownerId: null,
            isYellowTrunk: (flags & URBAN_CELL_BIT_YELLOW_TRUNK) !== 0,
          });
          continue;
        }

        if ((flags & URBAN_CELL_BIT_PARK) !== 0) {
          occupied[sIdx] = 1;
          cells.push({
            localX: slx,
            localY: sly,
            type: 'forest',
            ownerId: null,
          });
          continue;
        }

        const inExpansion = Boolean(bp.expansionZoneMask && bp.expansionZoneMask[bIdx]);
        const inFlightCorridor = Boolean(bp.flightCorridorExclMask && bp.flightCorridorExclMask[bIdx]);
        const inUrbanLobe = (flags & URBAN_CELL_BIT_LOBE) !== 0;

        if ((flags & URBAN_CELL_BIT_TREE_CROWN) !== 0 && !inExpansion && !inFlightCorridor) {
          treeCrownLocalIndices.push(sIdx);
        }

        if (inUrbanLobe || inExpansion || inFlightCorridor) {
          clearedPlainLocalIndices.push(sIdx);
        }
      }
    }
  }

  return {
    sectorX,
    sectorY,
    cityIds,
    cells,
    treeCrownLocalIndices,
    clearedPlainLocalIndices,
  };
}

export function getCompiledCityBlueprintCount(): number {
  return cityBlueprintCache.size;
}
