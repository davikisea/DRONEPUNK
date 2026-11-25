/**
 * ==============================================================================
 * CATÁLOGO DEMOGRÁFICO Y ESCALADO POBLACIONAL DETERMINISTA (theatre_cities.json)
 * ==============================================================================
 * Convergencia Equipo Alpha (A2) + Beta (B2, B5) + Gamma (G2):
 * - 33 ciudades reales de public/map/theatre_cities.json (21 Zulia + 12 nacionales)
 * - Función monótona tau(P) = clamp(ln(P / 15,000) / ln(2,000,000 / 15,000), 0, 1)
 * - Maracaibo (1,650,000) = Única metrópoli T5_METROPOLIS_X3 (60x60, 232 edif. grises)
 * - 100% edificios iniciales nacen GRISES NEUTRALES (ownerId: null)
 * ==============================================================================
 */

import { lngLatToGlobalTacticalCell, ZOOM_TACTICO, type LngLat } from './coordinates';
import type {
  ArterialSkeletonTopologyId,
  CityScaleSpec,
  CityScaleTierId,
  MicroGrainGrammarId,
  NeutralBuildingBudget,
  RegionalAccessPatternId,
  SatelliteFamilyId,
  SilhouetteFamilyId,
  SpriteForgePopulationScale,
  WaterfrontDirection,
} from '../types/urbanMorphologyTypes';

const POP_MIN_ANCHOR = 15_000;
const POP_MAX_ANCHOR = 2_000_000;
const LN_POP_SPAN = Math.log(POP_MAX_ANCHOR / POP_MIN_ANCHOR);

interface CityMorphologyProfileOverride {
  readonly municipalityId: string;
  readonly silhouetteFamily: SilhouetteFamilyId;
  readonly arterialSkeleton: ArterialSkeletonTopologyId;
  readonly regionalAccessPattern: RegionalAccessPatternId;
  readonly satelliteFamily: SatelliteFamilyId | null;
  readonly waterfrontDir: WaterfrontDirection;
  readonly riverPresent: boolean;
  readonly microGrains: readonly MicroGrainGrammarId[];
}

/** Perfiles morfológicos canónicos de las 21 ciudades del Estado Zulia */
const ZULIA_MORPHOLOGY_OVERRIDES: Readonly<Record<string, CityMorphologyProfileOverride>> = {
  CITY_MARACAIBO: {
    municipalityId: 'MUN_ZULIA_MARACAIBO',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    regionalAccessPattern: 'tangential_bypass',
    satelliteFamily: null,
    waterfrontDir: 'E',
    riverPresent: false,
    microGrains: ['comb_piers', 'curved_arc', 'superblock_central_park', 'ns_bars', 'courtyard_cloisters'],
  },
  CITY_SAN_FRANCISCO: {
    municipalityId: 'MUN_ZULIA_SAN_FRANCISCO',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'tangential_beltway',
    regionalAccessPattern: 'monumental_bridge',
    satelliteFamily: null,
    waterfrontDir: 'E',
    riverPresent: false,
    microGrains: ['ns_bars', 'ew_bars', 'divided_borough', 'curved_arc'],
  },
  CITY_CABIMAS: {
    municipalityId: 'MUN_ZULIA_CABIMAS',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'radial_annular',
    regionalAccessPattern: 'divided_stem',
    satelliteFamily: null,
    waterfrontDir: 'W',
    riverPresent: false,
    microGrains: ['comb_piers', 'ew_bars', 'organic_loops', 'superblock_central_park'],
  },
  CITY_CIUDAD_OJEDA: {
    municipalityId: 'MUN_ZULIA_LAGUNILLAS',
    silhouetteFamily: 'harmonic_fourier_polygon',
    arterialSkeleton: 'eccentric_roundabout',
    regionalAccessPattern: 'y_fork_approach',
    satelliteFamily: null,
    waterfrontDir: 'W',
    riverPresent: false,
    microGrains: ['curved_arc', 'ew_bars', 'courtyard_cloisters'],
  },
  CITY_SAN_CARLOS_DEL_ZULIA: {
    municipalityId: 'MUN_ZULIA_COLON',
    silhouetteFamily: 'river_corridor_split',
    arterialSkeleton: 'twin_plaza_dumbbell',
    regionalAccessPattern: 'monumental_bridge',
    satelliteFamily: null,
    waterfrontDir: 'none',
    riverPresent: true,
    microGrains: ['divided_borough', 'courtyard_cloisters', 'ns_bars'],
  },
  CITY_MACHIQUES: {
    municipalityId: 'MUN_ZULIA_MACHIQUES_DE_PERIJA',
    silhouetteFamily: 'alpine_wedge_terrace',
    arterialSkeleton: 's_spine_collector',
    regionalAccessPattern: 'opposite_dual_entry',
    satelliteFamily: null,
    waterfrontDir: 'none',
    riverPresent: false,
    microGrains: ['diagonal_terrace', 'ns_bars', 'organic_loops'],
  },
  CITY_LA_CONCEPCION: {
    municipalityId: 'MUN_ZULIA_JESUS_ENRIQUE_LOSSADA',
    silhouetteFamily: 'multi_ellipse_metaball',
    arterialSkeleton: 'y_trident_fork',
    regionalAccessPattern: 'divided_stem',
    satelliteFamily: null,
    waterfrontDir: 'none',
    riverPresent: false,
    microGrains: ['organic_loops', 'ew_bars', 'divided_borough'],
  },
  CITY_LOS_PUERTOS_DE_ALTAGRACIA: {
    municipalityId: 'MUN_ZULIA_MIRANDA',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    regionalAccessPattern: 'y_fork_approach',
    satelliteFamily: null,
    waterfrontDir: 'W',
    riverPresent: false,
    microGrains: ['comb_piers', 'curved_arc', 'ns_bars'],
  },
  CITY_LA_VILLA_DEL_ROSARIO: {
    municipalityId: 'MUN_ZULIA_ROSARIO_DE_PERIJA',
    silhouetteFamily: 'harmonic_fourier_polygon',
    arterialSkeleton: 'eccentric_roundabout',
    regionalAccessPattern: 'tangential_bypass',
    satelliteFamily: 'highway_roundabout_hub',
    waterfrontDir: 'none',
    riverPresent: false,
    microGrains: ['curved_arc', 'ns_bars', 'courtyard_cloisters'],
  },
  CITY_BACHAQUERO: {
    municipalityId: 'MUN_ZULIA_VALMORE_RODRIGUEZ',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'y_trident_fork',
    regionalAccessPattern: 'y_fork_approach',
    satelliteFamily: 'industrial_freight_crescent',
    waterfrontDir: 'W',
    riverPresent: false,
    microGrains: ['ew_bars', 'comb_piers'],
  },
  CITY_CONCEPCION: {
    municipalityId: 'MUN_ZULIA_LA_CANADA_DE_URDANETA',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    regionalAccessPattern: 'perimeter_loop',
    satelliteFamily: 'harbor_promenade_cove',
    waterfrontDir: 'E',
    riverPresent: false,
    microGrains: ['comb_piers', 'ns_bars'],
  },
  CITY_SAN_RAFAEL_DEL_MOJAN: {
    municipalityId: 'MUN_ZULIA_MARA',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    regionalAccessPattern: 'y_fork_approach',
    satelliteFamily: 'riverbend_mill_hamlet',
    waterfrontDir: 'E',
    riverPresent: true,
    microGrains: ['curved_arc', 'comb_piers'],
  },
  CITY_MENE_GRANDE: {
    municipalityId: 'MUN_ZULIA_BARALT',
    silhouetteFamily: 'alpine_wedge_terrace',
    arterialSkeleton: 's_spine_collector',
    regionalAccessPattern: 'tangential_bypass',
    satelliteFamily: 'ridge_terrace_citadel',
    waterfrontDir: 'none',
    riverPresent: false,
    microGrains: ['diagonal_terrace', 'ew_bars'],
  },
  CITY_SANTA_RITA: {
    municipalityId: 'MUN_ZULIA_SANTA_RITA',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    regionalAccessPattern: 'monumental_bridge',
    satelliteFamily: 'harbor_promenade_cove',
    waterfrontDir: 'W',
    riverPresent: false,
    microGrains: ['comb_piers', 'ns_bars'],
  },
  CITY_TIA_JUANA: {
    municipalityId: 'MUN_ZULIA_SIMON_BOLIVAR',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'y_trident_fork',
    regionalAccessPattern: 'y_fork_approach',
    satelliteFamily: 'industrial_freight_crescent',
    waterfrontDir: 'W',
    riverPresent: false,
    microGrains: ['ns_bars', 'ew_bars'],
  },
  CITY_SINAMAICA_PARAGUAIPOA: {
    municipalityId: 'MUN_ZULIA_GUAJIRA',
    silhouetteFamily: 'harmonic_fourier_polygon',
    arterialSkeleton: 's_spine_collector',
    regionalAccessPattern: 'opposite_dual_entry',
    satelliteFamily: 'riverbend_mill_hamlet',
    waterfrontDir: 'E',
    riverPresent: true,
    microGrains: ['curved_arc', 'divided_borough'],
  },
  CITY_PUEBLO_NUEVO_EL_CHIVO: {
    municipalityId: 'MUN_ZULIA_FRANCISCO_JAVIER_PULGAR',
    silhouetteFamily: 'harmonic_fourier_polygon',
    arterialSkeleton: 'eccentric_roundabout',
    regionalAccessPattern: 'y_fork_approach',
    satelliteFamily: 'highway_roundabout_hub',
    waterfrontDir: 'none',
    riverPresent: true,
    microGrains: ['divided_borough', 'ns_bars'],
  },
  CITY_ENCONTRADOS: {
    municipalityId: 'MUN_ZULIA_CATATUMBO',
    silhouetteFamily: 'river_corridor_split',
    arterialSkeleton: 'bi_bank_bridges',
    regionalAccessPattern: 'perimeter_loop',
    satelliteFamily: 'riverbend_mill_hamlet',
    waterfrontDir: 'none',
    riverPresent: true,
    microGrains: ['courtyard_cloisters', 'ew_bars'],
  },
  CITY_BOBURES: {
    municipalityId: 'MUN_ZULIA_SUCRE',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    regionalAccessPattern: 'perimeter_loop',
    satelliteFamily: 'harbor_promenade_cove',
    waterfrontDir: 'N',
    riverPresent: false,
    microGrains: ['comb_piers', 'ew_bars'],
  },
  CITY_CASIGUA_EL_CUBO: {
    municipalityId: 'MUN_ZULIA_JESUS_MARIA_SEMPRUM',
    silhouetteFamily: 'alpine_wedge_terrace',
    arterialSkeleton: 's_spine_collector',
    regionalAccessPattern: 'tangential_bypass',
    satelliteFamily: 'ridge_terrace_citadel',
    waterfrontDir: 'none',
    riverPresent: false,
    microGrains: ['diagonal_terrace', 'ns_bars'],
  },
  CITY_EL_TORO: {
    municipalityId: 'MUN_ZULIA_ALMIRANTE_PADILLA',
    silhouetteFamily: 'coastal_arc_crescent',
    arterialSkeleton: 'coastal_promenade',
    regionalAccessPattern: 'perimeter_loop',
    satelliteFamily: 'harbor_promenade_cove',
    waterfrontDir: 'S',
    riverPresent: false,
    microGrains: ['ns_bars', 'comb_piers'],
  },
};

export function computeNormalizedPopulationIndex(population: number): number {
  const clamped = Math.max(POP_MIN_ANCHOR, Math.min(POP_MAX_ANCHOR, Math.floor(population)));
  const tau = Math.log(clamped / POP_MIN_ANCHOR) / LN_POP_SPAN;
  return Number(Math.max(0, Math.min(1, tau)).toFixed(4));
}

export function resolveCityScaleTier(population: number): {
  tierId: CityScaleTierId;
  engineScale: SpriteForgePopulationScale;
  canvasSizeTiles: 36 | 44 | 56 | 68 | 80;
  compactnessKappa: number;
  minBldgs: number;
  maxBldgs: number;
  targetExitsCount: number;
} {
  if (population >= 2_000_000) {
    return {
      tierId: 'T5_MEGAPOLIS_X5',
      engineScale: 'x5',
      canvasSizeTiles: 80,
      compactnessKappa: 0.62,
      minBldgs: 320,
      maxBldgs: 440,
      targetExitsCount: 7,
    };
  }
  if (population >= 1_000_000) {
    return {
      tierId: 'T4_METROPOLIS_X4',
      engineScale: 'x4',
      canvasSizeTiles: 68,
      compactnessKappa: 0.635,
      minBldgs: 220,
      maxBldgs: 320,
      targetExitsCount: 6,
    };
  }
  if (population >= 350_000) {
    return {
      tierId: 'T3_CONURBATION_X3',
      engineScale: 'x3',
      canvasSizeTiles: 56,
      compactnessKappa: 0.655,
      minBldgs: 140,
      maxBldgs: 210,
      targetExitsCount: 5,
    };
  }
  if (population >= 150_000) {
    return {
      tierId: 'T2_INTERMEDIATE_X2',
      engineScale: 'x2',
      canvasSizeTiles: 44,
      compactnessKappa: 0.675,
      minBldgs: 95,
      maxBldgs: 145,
      targetExitsCount: 4,
    };
  }
  return {
    tierId: 'T1_MUNICIPAL_X1',
    engineScale: 'x1',
    canvasSizeTiles: 36,
    compactnessKappa: 0.69,
    minBldgs: 50,
    maxBldgs: 90,
    targetExitsCount: 3,
  };
}

function buildNeutralBuildingBudget(
  population: number,
  engineScale: SpriteForgePopulationScale,
  totalBuildings: number,
  isCoastalOrRiverPort: boolean,
  isIndustrial: boolean
): NeutralBuildingBudget {
  const hq = 1;
  const commtower =
    engineScale === 'x5'
      ? 4
      : engineScale === 'x4'
      ? 3
      : engineScale === 'x3' || engineScale === 'x2'
      ? 2
      : 1;
  const factory = Math.max(2, Math.round(totalBuildings * (0.062 + (isIndustrial ? 0.018 : 0))));
  const airport =
    engineScale === 'x5' || engineScale === 'x4' || engineScale === 'x3'
      ? 2
      : engineScale === 'x2' || population >= 90_000
      ? 1
      : 0;
  const port = !isCoastalOrRiverPort
    ? 0
    : engineScale === 'x5'
    ? 6
    : engineScale === 'x4'
    ? 5
    : engineScale === 'x3'
    ? 4
    : engineScale === 'x2'
    ? 3
    : 2;
  const lab =
    engineScale === 'x5' || engineScale === 'x4'
      ? 3
      : engineScale === 'x3' || engineScale === 'x2'
      ? 2
      : 1;
  const silo =
    engineScale === 'x5'
      ? 5
      : engineScale === 'x4'
      ? 4
      : engineScale === 'x3'
      ? 3
      : engineScale === 'x2'
      ? 2
      : 1;

  const specialSum = hq + commtower + factory + airport + port + lab + silo;
  const city = Math.max(8, totalBuildings - specialSum);

  return {
    initialOwner: null,
    hq,
    commtower,
    factory,
    airport,
    port,
    lab,
    silo,
    city,
    total: specialSum + city,
  };
}

export function buildDeterministicCityScaleSpec(input: {
  cityId: string;
  name: string;
  stateId: string;
  cityType: string;
  importance: 'capital' | 'major' | 'secondary' | 'municipal';
  population: number;
  coordinates: LngLat;
}): CityScaleSpec {
  const tau = computeNormalizedPopulationIndex(input.population);
  const tier = resolveCityScaleTier(input.population);
  const radiusByScale: Record<'x5' | 'x4' | 'x3' | 'x2' | 'x1', [number, number]> = {
    x5: [28, 33],
    x4: [24, 28],
    x3: [19, 23],
    x2: [14, 18],
    x1: [10, 14],
  };
  const [rMin, rMax] = radiusByScale[tier.engineScale as 'x5' | 'x4' | 'x3' | 'x2' | 'x1'];
  const radiusTiles = Math.round(rMin + (rMax - rMin) * tau);
  const targetDryAreaTiles = Math.round(tier.compactnessKappa * Math.PI * radiusTiles * radiusTiles);
  const urbanFillRatio = 0.21 + 0.05 * tau;
  const totalBuildings = Math.max(
    tier.minBldgs,
    Math.min(tier.maxBldgs, Math.round(targetDryAreaTiles * urbanFillRatio))
  );

  const override = ZULIA_MORPHOLOGY_OVERRIDES[input.cityId];
  const isCoastal =
    override !== undefined
      ? override.waterfrontDir !== 'none' || override.riverPresent
      : input.cityType.includes('port') || input.cityType.includes('coastal');
  const isIndustrial =
    input.cityType.includes('petroleum') ||
    input.cityType.includes('industrial') ||
    input.cityType.includes('refinery') ||
    input.cityType.includes('agro');

  const neutralBuildings = buildNeutralBuildingBudget(
    input.population,
    tier.engineScale,
    totalBuildings,
    isCoastal,
    isIndustrial
  );

  const anchorCell = lngLatToGlobalTacticalCell(input.coordinates, 20, ZOOM_TACTICO);

  return {
    cityId: input.cityId,
    name: input.name,
    stateId: input.stateId,
    municipalityId: override?.municipalityId ?? null,
    cityType: input.cityType,
    importance: input.importance,
    population: input.population,
    normalizedLogIndex: tau,
    tierId: tier.tierId,
    engineScale: tier.engineScale,
    canvasSizeTiles: tier.canvasSizeTiles,
    radiusTiles,
    targetDryAreaTiles,
    targetExitsCount: tier.targetExitsCount,
    isProceduralSat: false,
    neutralBuildings,
    silhouetteFamily: override?.silhouetteFamily ?? (isCoastal ? 'coastal_arc_crescent' : 'harmonic_fourier_polygon'),
    arterialSkeleton: override?.arterialSkeleton ?? (isCoastal ? 'coastal_promenade' : 'eccentric_roundabout'),
    regionalAccessPattern: override?.regionalAccessPattern ?? 'tangential_bypass',
    satelliteFamily: null,
    waterfrontDir: override?.waterfrontDir ?? 'none',
    riverPresent: override?.riverPresent ?? false,
    microGrains: override?.microGrains ?? ['curved_arc', 'ns_bars', 'ew_bars'],
    anchorLngLat: input.coordinates,
    anchorGlobalX: anchorCell.globalX,
    anchorGlobalY: anchorCell.globalY,
  };
}

let catalogSpecs: CityScaleSpec[] = [];
let catalogLoaded = false;
let catalogNodeAttempted = false;

export function registerTheatreCitiesGeoJson(geojson: unknown): number {
  const features =
    geojson && typeof geojson === 'object' && Array.isArray((geojson as { features?: unknown[] }).features)
      ? (geojson as {
          features: Array<{
            properties?: Record<string, unknown>;
            geometry?: { type?: string; coordinates?: unknown };
          }>;
        }).features
      : [];

  if (features.length === 0) return catalogSpecs.length;

  const built: CityScaleSpec[] = [];
  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    const props = feat?.properties;
    const geom = feat?.geometry;
    if (!props || !geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) continue;
    const coords = geom.coordinates as number[];
    if (coords.length < 2) continue;

    const cityId = typeof props.id === 'string' ? props.id : `CITY_${i}`;
    const name = typeof props.name === 'string' ? props.name : cityId;
    const stateId = typeof props.stateId === 'string' ? props.stateId : 'REG_VE_00';
    const cityType = typeof props.type === 'string' ? props.type : 'urban_hub';
    const importanceRaw = typeof props.importance === 'string' ? props.importance : 'municipal';
    const importance =
      importanceRaw === 'capital' || importanceRaw === 'major' || importanceRaw === 'secondary'
        ? importanceRaw
        : 'municipal';
    const population = typeof props.population === 'number' && Number.isFinite(props.population)
      ? props.population
      : 50_000;

    built.push(
      buildDeterministicCityScaleSpec({
        cityId,
        name,
        stateId,
        cityType,
        importance,
        population,
        coordinates: [coords[0], coords[1]] as LngLat,
      })
    );
  }

  // Ordenar descendentemente por población (Maracaibo líder del Zulia)
  built.sort((a, b) => b.population - a.population);
  catalogSpecs = built;
  catalogLoaded = true;
  return catalogSpecs.length;
}

export function ensureTheatreCitiesLoadedInNode(): void {
  if (catalogLoaded || catalogNodeAttempted) return;
  catalogNodeAttempted = true;
  try {
    if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.versions?.node) {
      return;
    }
    const getBuiltin = (process as unknown as { getBuiltinModule?: (m: string) => Record<string, unknown> }).getBuiltinModule;
    const loadMod = (m: string) =>
      getBuiltin ? getBuiltin(m) : (Function('mod', 'return require(mod)') as (mod: string) => Record<string, unknown>)(m);
    const fsMod = loadMod('fs') as { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string };
    const pathMod = loadMod('path') as { resolve: (...p: string[]) => string };
    const filePath = pathMod.resolve(process.cwd(), 'public', 'map', 'theatre_cities.json');
    if (fsMod.existsSync(filePath)) {
      const parsed = JSON.parse(fsMod.readFileSync(filePath, 'utf-8'));
      registerTheatreCitiesGeoJson(parsed);
    }
  } catch {
    // Fallback silencioso
  }
}

export function getAllCityScaleSpecs(): readonly CityScaleSpec[] {
  ensureTheatreCitiesLoadedInNode();
  return catalogSpecs;
}

export function getCityScaleSpecById(cityId: string): CityScaleSpec | undefined {
  ensureTheatreCitiesLoadedInNode();
  return catalogSpecs.find((c) => c.cityId === cityId);
}
