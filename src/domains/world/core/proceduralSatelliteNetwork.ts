/**
 * ==============================================================================
 * GENERADOR PROCEDURAL DE SATS INTERMEDIOS POR BIOMA REAL (@domains/world)
 * ==============================================================================
 * Replica al 100 % el rol estratégico de los SATs de SPRITE-FORGE-STUDIO:
 * - Capa separada de las ciudades reales (x1..x5): puestos intermedios de 33x33
 *   entre ciudades, en cruces carreteros, costas navegables, meandros fluviales
 *   y ambas cabeceras del Puente General Rafael Urdaneta.
 * - Clasificación automática por terreno real:
 *   1. Costa navegable (>= 2 tiles costeros tocando agua abierta) -> harbor_promenade_cove (marítimo)
 *   2. Cercanía fluvial (<= 15 tiles de isGlobalRiverAtCell) -> riverbend_mill_hamlet
 *   3. Cruce troncal / eje carretero -> highway_roundabout_hub
 *   4. Corredor petrolero / industrial -> industrial_freight_crescent
 *   5. Pie de monte / serranía -> ridge_terrace_citadel
 * ==============================================================================
 */

import {
  globalTacticalCellToLngLat,
  ZOOM_TACTICO,
} from './coordinates';
import { isGlobalRiverAtCell } from './globalHydrologyPredicate';
import { getResolvedMacroBridges } from './macroBridgeCorridors';
import { getAllCityScaleSpecs } from './urbanPopulationCatalog';
import { detHash32 } from './urbanMorphologyPrimitives';
import type {
  CityScaleSpec,
  SatelliteFamilyId,
  WaterfrontDirection,
} from '../types/urbanMorphologyTypes';

const GRID_SIZE = 20;

export interface RegionalCorridorPair {
  readonly fromId: string;
  readonly toId: string;
  readonly maxBridgeSpan: number;
  readonly preferredFamily?: SatelliteFamilyId;
}

/** Corredores estructurales del Zulia sobre los que se siembran SATs intermedios */
export const ZULIA_SAT_CORRIDORS: readonly RegionalCorridorPair[] = [
  { fromId: 'CITY_MARACAIBO', toId: 'CITY_LA_CONCEPCION', maxBridgeSpan: 8, preferredFamily: 'highway_roundabout_hub' },
  { fromId: 'CITY_MARACAIBO', toId: 'CITY_SAN_RAFAEL_DEL_MOJAN', maxBridgeSpan: 10, preferredFamily: 'harbor_promenade_cove' },
  { fromId: 'CITY_SAN_RAFAEL_DEL_MOJAN', toId: 'CITY_SINAMAICA_PARAGUAIPOA', maxBridgeSpan: 10, preferredFamily: 'riverbend_mill_hamlet' },
  { fromId: 'CITY_SAN_FRANCISCO', toId: 'CITY_CONCEPCION', maxBridgeSpan: 8, preferredFamily: 'harbor_promenade_cove' },
  { fromId: 'CITY_LA_CONCEPCION', toId: 'CITY_LA_VILLA_DEL_ROSARIO', maxBridgeSpan: 8, preferredFamily: 'highway_roundabout_hub' },
  { fromId: 'CITY_LA_VILLA_DEL_ROSARIO', toId: 'CITY_MACHIQUES', maxBridgeSpan: 10, preferredFamily: 'ridge_terrace_citadel' },
  { fromId: 'CITY_SANTA_RITA', toId: 'CITY_LOS_PUERTOS_DE_ALTAGRACIA', maxBridgeSpan: 10, preferredFamily: 'harbor_promenade_cove' },
  { fromId: 'CITY_SANTA_RITA', toId: 'CITY_CABIMAS', maxBridgeSpan: 10, preferredFamily: 'harbor_promenade_cove' },
  { fromId: 'CITY_CABIMAS', toId: 'CITY_TIA_JUANA', maxBridgeSpan: 10, preferredFamily: 'industrial_freight_crescent' },
  { fromId: 'CITY_TIA_JUANA', toId: 'CITY_CIUDAD_OJEDA', maxBridgeSpan: 10, preferredFamily: 'industrial_freight_crescent' },
  { fromId: 'CITY_CIUDAD_OJEDA', toId: 'CITY_BACHAQUERO', maxBridgeSpan: 10, preferredFamily: 'industrial_freight_crescent' },
  { fromId: 'CITY_BACHAQUERO', toId: 'CITY_MENE_GRANDE', maxBridgeSpan: 10, preferredFamily: 'ridge_terrace_citadel' },
  { fromId: 'CITY_BOBURES', toId: 'CITY_PUEBLO_NUEVO_EL_CHIVO', maxBridgeSpan: 10, preferredFamily: 'riverbend_mill_hamlet' },
  { fromId: 'CITY_PUEBLO_NUEVO_EL_CHIVO', toId: 'CITY_SAN_CARLOS_DEL_ZULIA', maxBridgeSpan: 10, preferredFamily: 'highway_roundabout_hub' },
  { fromId: 'CITY_SAN_CARLOS_DEL_ZULIA', toId: 'CITY_ENCONTRADOS', maxBridgeSpan: 10, preferredFamily: 'riverbend_mill_hamlet' },
  { fromId: 'CITY_ENCONTRADOS', toId: 'CITY_CASIGUA_EL_CUBO', maxBridgeSpan: 10, preferredFamily: 'ridge_terrace_citadel' },
];

function detectLocalTerrainBiome(
  gx: number,
  gy: number,
  landPredicate: (lng: number, lat: number) => boolean
): {
  isDryCenter: boolean;
  waterfrontDir: WaterfrontDirection;
  nearRiver: boolean;
  snappedGx: number;
  snappedGy: number;
} {
  const isLand = (x: number, y: number): boolean => {
    const [lng, lat] = globalTacticalCellToLngLat(x, y, GRID_SIZE, ZOOM_TACTICO);
    return landPredicate(lng, lat);
  };

  let snappedGx = gx;
  let snappedGy = gy;
  let isDryCenter = isLand(gx, gy);

  // Si el punto medio cae en agua, buscar tierra firme más cercana en radio <= 18
  if (!isDryCenter) {
    let bestD = Infinity;
    for (let dy = -18; dy <= 18; dy += 2) {
      for (let dx = -18; dx <= 18; dx += 2) {
        if (isLand(gx + dx, gy + dy)) {
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            snappedGx = gx + dx;
            snappedGy = gy + dy;
            isDryCenter = true;
          }
        }
      }
    }
  }

  // Detectar si el SAT toca costa navegable abierta en N/E/S/W dentro de +-14 tiles
  let waterfrontDir: WaterfrontDirection = 'none';
  if (isDryCenter) {
    const dirs: Array<[WaterfrontDirection, number, number]> = [
      ['W', -1, 0],
      ['E', 1, 0],
      ['N', 0, -1],
      ['S', 0, 1],
    ];
    for (const [dName, dx, dy] of dirs) {
      let waterHits = 0;
      for (let step = 4; step <= 14; step += 2) {
        if (!isLand(snappedGx + dx * step, snappedGy + dy * step)) {
          waterHits++;
        }
      }
      if (waterHits >= 3) {
        waterfrontDir = dName;
        break;
      }
    }
  }

  // Detectar cercanía a río global
  let nearRiver = false;
  for (let dy = -14; dy <= 14 && !nearRiver; dy += 2) {
    for (let dx = -14; dx <= 14; dx += 2) {
      if (isGlobalRiverAtCell(snappedGx + dx, snappedGy + dy)) {
        nearRiver = true;
        break;
      }
    }
  }

  return { isDryCenter, waterfrontDir, nearRiver, snappedGx, snappedGy };
}

function makeProceduralSatSpec(params: {
  satId: string;
  name: string;
  stateId: string;
  municipalityId: string | null;
  family: SatelliteFamilyId;
  waterfrontDir: WaterfrontDirection;
  nearRiver: boolean;
  gx: number;
  gy: number;
}): CityScaleSpec {
  const anchorLngLat = globalTacticalCellToLngLat(params.gx, params.gy, GRID_SIZE, ZOOM_TACTICO);
  const isCoastal = params.family === 'harbor_promenade_cove' || params.waterfrontDir !== 'none';
  return {
    cityId: params.satId,
    name: params.name,
    stateId: params.stateId,
    municipalityId: params.municipalityId,
    cityType: isCoastal ? 'maritime_sat_outpost' : 'procedural_sat_outpost',
    importance: 'municipal',
    population: 22_000,
    normalizedLogIndex: 0.08,
    tierId: 'T2_MUNICIPAL_HUB_SAT',
    engineScale: 'sat_hub',
    canvasSizeTiles: 33,
    radiusTiles: 10,
    targetDryAreaTiles: 165,
    targetExitsCount: 3,
    isProceduralSat: true,
    neutralBuildings: {
      initialOwner: null,
      hq: 0,
      commtower: 1,
      factory: params.family === 'industrial_freight_crescent' ? 2 : 1,
      airport: 0,
      port: isCoastal ? 2 : 0,
      lab: 0,
      silo: 1,
      city: 14,
      total: 18,
    },
    silhouetteFamily: isCoastal ? 'coastal_arc_crescent' : 'harmonic_fourier_polygon',
    arterialSkeleton: 'eccentric_roundabout',
    regionalAccessPattern: 'y_fork_approach',
    satelliteFamily: params.family,
    waterfrontDir: params.waterfrontDir,
    riverPresent: params.nearRiver,
    microGrains: ['organic_loops', 'ns_bars'],
    anchorLngLat,
    anchorGlobalX: params.gx,
    anchorGlobalY: params.gy,
  };
}

let cachedProceduralSats: CityScaleSpec[] | null = null;

export function resetProceduralSatellitesCache(): void {
  cachedProceduralSats = null;
}

/**
 * Genera determinísticamente todos los SATs intermedios procedurales:
 * 1. Los 2 SATs marítimos en ambas cabeceras del Puente General Rafael Urdaneta.
 * 2. SATs intermedios a lo largo de corredores entre ciudades según bioma real.
 */
export function getProceduralSatelliteSpecs(
  landPredicate: (lng: number, lat: number) => boolean
): readonly CityScaleSpec[] {
  if (cachedProceduralSats) return cachedProceduralSats;

  const cities = getAllCityScaleSpecs();
  const cityById = new Map(cities.map((c) => [c.cityId, c]));
  const sats: CityScaleSpec[] = [];

  const isTooClose = (gx: number, gy: number, minCityDist: number, minSatDist: number): boolean => {
    for (const c of cities) {
      const minD = Math.max(minCityDist, c.radiusTiles + 18);
      if (Math.hypot(c.anchorGlobalX - gx, c.anchorGlobalY - gy) < minD) return true;
    }
    for (const s of sats) {
      if (Math.hypot(s.anchorGlobalX - gx, s.anchorGlobalY - gy) < minSatDist) return true;
    }
    return false;
  };

  // 1. SATs marítimos obligatorios en ambas cabeceras del Puente General Rafael Urdaneta
  const bridges = getResolvedMacroBridges(landPredicate);
  for (const br of bridges) {
    const [wx, wy] = br.westSatAnchor;
    const [ex, ey] = br.eastSatAnchor;
    sats.push(
      makeProceduralSatSpec({
        satId: br.def.westSatId,
        name: br.def.westSatName,
        stateId: br.def.stateId,
        municipalityId: br.def.westMunicipalityId,
        family: 'harbor_promenade_cove',
        waterfrontDir: 'E',
        nearRiver: false,
        gx: wx,
        gy: wy,
      })
    );
    sats.push(
      makeProceduralSatSpec({
        satId: br.def.eastSatId,
        name: br.def.eastSatName,
        stateId: br.def.stateId,
        municipalityId: br.def.eastMunicipalityId,
        family: 'harbor_promenade_cove',
        waterfrontDir: 'W',
        nearRiver: false,
        gx: ex,
        gy: ey,
      })
    );
  }

  // 2. SATs intermedios en corredores entre ciudades del Zulia
  for (let i = 0; i < ZULIA_SAT_CORRIDORS.length; i++) {
    const pair = ZULIA_SAT_CORRIDORS[i];
    const fromC = cityById.get(pair.fromId);
    const toC = cityById.get(pair.toId);
    if (!fromC || !toC) continue;

    const dist = Math.hypot(
      toC.anchorGlobalX - fromC.anchorGlobalX,
      toC.anchorGlobalY - fromC.anchorGlobalY
    );
    if (dist < 62) continue;

    const fracs = dist >= 160 ? [0.35, 0.65] : [0.5];
    for (let fIdx = 0; fIdx < fracs.length; fIdx++) {
      const t = fracs[fIdx];
      const rawGx = Math.round(fromC.anchorGlobalX + (toC.anchorGlobalX - fromC.anchorGlobalX) * t);
      const rawGy = Math.round(fromC.anchorGlobalY + (toC.anchorGlobalY - fromC.anchorGlobalY) * t);
      const biome = detectLocalTerrainBiome(rawGx, rawGy, landPredicate);
      if (!biome.isDryCenter) continue;
      if (isTooClose(biome.snappedGx, biome.snappedGy, 34, 30)) continue;

      // Selección automática de familia por terreno real (costa -> marítimo, río -> fluvial, etc.)
      let family: SatelliteFamilyId;
      if (biome.waterfrontDir !== 'none') {
        family = 'harbor_promenade_cove';
      } else if (biome.nearRiver) {
        family = 'riverbend_mill_hamlet';
      } else if (pair.preferredFamily && pair.preferredFamily !== 'harbor_promenade_cove') {
        family = pair.preferredFamily;
      } else {
        const inlandFams: SatelliteFamilyId[] = [
          'highway_roundabout_hub',
          'industrial_freight_crescent',
          'ridge_terrace_citadel',
        ];
        family = inlandFams[detHash32(`${pair.fromId}_${pair.toId}_${fIdx}`) % inlandFams.length];
      }

      const satId = `SAT_ZULIA_${i}_${fIdx}`;
      sats.push(
        makeProceduralSatSpec({
          satId,
          name: `SAT: ${fromC.name}-${toC.name} [${family}]`,
          stateId: fromC.stateId,
          municipalityId: null,
          family,
          waterfrontDir: biome.waterfrontDir,
          nearRiver: biome.nearRiver,
          gx: biome.snappedGx,
          gy: biome.snappedGy,
        })
      );
    }
  }

  // 3. Garantizar 1 SAT marítimo (harbor_promenade_cove) por CADA municipio costero del Zulia
  const coastalCities = cities.filter(
    (c) =>
      c.stateId === 'REG_VE_02' &&
      c.municipalityId !== null &&
      c.waterfrontDir !== 'none' &&
      c.cityId !== 'CITY_EL_TORO'
  );
  const coveredCoastalMuns = new Set<string>(
    sats
      .filter((s) => s.satelliteFamily === 'harbor_promenade_cove' && s.municipalityId)
      .map((s) => s.municipalityId!)
  );

  for (const city of coastalCities) {
    const munId = city.municipalityId!;
    if (coveredCoastalMuns.has(munId)) continue;

    // Buscar un punto costero seco a 28..52 tiles a lo largo del litoral del municipio
    const tangentDirs: ReadonlyArray<readonly [number, number]> =
      city.waterfrontDir === 'E' || city.waterfrontDir === 'W'
        ? [[0, 1], [0, -1]]
        : [[1, 0], [-1, 0]];
    const towardWater: readonly [number, number] =
      city.waterfrontDir === 'E'
        ? [1, 0]
        : city.waterfrontDir === 'W'
        ? [-1, 0]
        : city.waterfrontDir === 'N'
        ? [0, -1]
        : [0, 1];

    let placed = false;
    for (const [tdx, tdy] of tangentDirs) {
      if (placed) break;
      for (const distAlong of [34, 42, 28, 50]) {
        if (placed) break;
        const candX = city.anchorGlobalX + tdx * distAlong + towardWater[0] * 4;
        const candY = city.anchorGlobalY + tdy * distAlong + towardWater[1] * 4;
        const biome = detectLocalTerrainBiome(candX, candY, landPredicate);
        if (!biome.isDryCenter || biome.waterfrontDir === 'none') continue;
        if (isTooClose(biome.snappedGx, biome.snappedGy, 24, 24)) continue;

        sats.push(
          makeProceduralSatSpec({
            satId: `SAT_MARITIME_${munId}`,
            name: `SAT: Puerto ${city.name} [harbor_promenade_cove]`,
            stateId: city.stateId,
            municipalityId: munId,
            family: 'harbor_promenade_cove',
            waterfrontDir: biome.waterfrontDir,
            nearRiver: biome.nearRiver,
            gx: biome.snappedGx,
            gy: biome.snappedGy,
          })
        );
        coveredCoastalMuns.add(munId);
        placed = true;
      }
    }
  }

  cachedProceduralSats = sats;
  return sats;
}
