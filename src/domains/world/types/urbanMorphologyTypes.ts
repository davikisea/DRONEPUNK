/**
 * ==============================================================================
 * CONTRATOS PUROS DEL MOTOR URBANO POLIMÓRFICO Y LÍNEA AMARILLA BASE (@domains/world)
 * ==============================================================================
 * Convergencia de Equipos Alpha, Beta y Gamma:
 * - Bitflags contiguos Uint8Array por celda (3.6 KB para Maracaibo 60x60)
 * - 100% de edificios iniciales nacen GRISES NEUTRALES (ownerId: null)
 * - Cero dependencias de @domains/tactics o @domains/economy
 * - Cero contaminación de TerrainTile en @shared
 * ==============================================================================
 */

import type { TerrainType } from '@shared';
import type { LngLat } from '../core/coordinates';

export type CityScaleTierId =
  | 'T5_MEGAPOLIS_X5'
  | 'T4_METROPOLIS_X4'
  | 'T3_CONURBATION_X3'
  | 'T2_INTERMEDIATE_X2'
  | 'T1_MUNICIPAL_X1'
  | 'T5_METROPOLIS_X3'
  | 'T4_CONURBATION_X2'
  | 'T3_REGIONAL_HUB_X1'
  | 'T2_MUNICIPAL_HUB_SAT'
  | 'T1_OUTPOST_SAT';

export type SpriteForgePopulationScale =
  | 'x5'
  | 'x4'
  | 'x3'
  | 'x2'
  | 'x1'
  | 'sat_hub'
  | 'sat_outpost';

export type YellowTrunkCityInteractionMode =
  | 'pass_through_absorb'    // dist <= R_tiles (ej. Sinamaica: 0.90 tiles)
  | 'tangential_bypass'      // R_tiles < dist <= R_tiles + 4 (ej. La Villa: 12.68 tiles)
  | 'trunk_spur_precompiled' // Ciudades continentales > R+4 (pre-compilado O(1))
  | 'maritime_port_only';    // Islas reales sin puente (ej. El Toro / Isla de Toas)

export type SilhouetteFamilyId =
  | 'coastal_arc_crescent'
  | 'harmonic_fourier_polygon'
  | 'multi_ellipse_metaball'
  | 'river_corridor_split'
  | 'alpine_wedge_terrace';

export type ArterialSkeletonTopologyId =
  | 'coastal_promenade'
  | 'radial_annular'
  | 'tangential_beltway'
  | 'eccentric_roundabout'
  | 'twin_plaza_dumbbell'
  | 's_spine_collector'
  | 'y_trident_fork'
  | 'bi_bank_bridges';

export type RegionalAccessPatternId =
  | 'tangential_bypass'
  | 'monumental_bridge'
  | 'divided_stem'
  | 'y_fork_approach'
  | 'opposite_dual_entry'
  | 'perimeter_loop';

export type SatelliteFamilyId =
  | 'highway_roundabout_hub'
  | 'harbor_promenade_cove'
  | 'ridge_terrace_citadel'
  | 'riverbend_mill_hamlet'
  | 'industrial_freight_crescent';

export type MicroGrainGrammarId =
  | 'curved_arc'
  | 'diagonal_terrace'
  | 'ns_bars'
  | 'ew_bars'
  | 'superblock_central_park'
  | 'courtyard_cloisters'
  | 'comb_piers'
  | 'organic_loops'
  | 'divided_borough';

export type PartitionGeometryMethodId =
  | 'voronoi_geodesic'
  | 'non_orthogonal_angular'
  | 'coast_parallel_bands'
  | 'elevation_terraces';

export type DistrictOrientationId =
  | 'NS'
  | 'EW'
  | 'L_SHAPED'
  | 'COASTAL_ARC'
  | 'BLOCK_INTEGRATED';

export type FunctionalDistrictArchetypeId =
  | 'waterfront_port'
  | 'air_hub'
  | 'civic_core'
  | 'industrial_logistics_park'
  | 'science_campus';

export interface CityDnaProfile {
  silhouetteFamily: SilhouetteFamilyId;
  scaleFactor: number;
  angleRad: number;
  harmonics: number[];
  lobeCount: number;
  concavity: number;
  arterialSkeleton: ArterialSkeletonTopologyId;
  regionalAccessPattern: RegionalAccessPatternId;
  terminalMode?: 't_plaza' | 'roundabout';
  partitionMethod: PartitionGeometryMethodId;
  sectorCount: number;
  angularJitterRad: number;
  defaultOrientation: DistrictOrientationId;
  perDistrictOrientation: Partial<Record<FunctionalDistrictArchetypeId, DistrictOrientationId>>;
  microGrains: MicroGrainGrammarId[];
}

export interface RoundaboutRecord {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: 1 | 2 | 3;
  readonly role: 'primary' | 'secondary';
}

export interface FunctionalDistrictRecord {
  readonly id: string;
  readonly archetype: FunctionalDistrictArchetypeId;
  readonly orientation: DistrictOrientationId;
  readonly bbox: readonly [number, number, number, number];
  readonly buildingCount: number;
  readonly parkCount: number;
}

export interface ResidentialSectorRecord {
  readonly id: string;
  readonly grain: MicroGrainGrammarId;
  readonly bbox: readonly [number, number, number, number];
  readonly buildingCount: number;
}

export interface InterchangeArrowRecord {
  readonly globalX: number;
  readonly globalY: number;
  readonly dx: number;
  readonly dy: number;
}

export interface FuturePortPlotRecord {
  readonly coastGlobalX: number;
  readonly coastGlobalY: number;
  readonly waterFacing: WaterfrontDirection;
  readonly dockBboxGlobal: readonly [number, number, number, number];
}

export interface DistrictLegendEntry {
  readonly dIdx: number;
  readonly tag: string;
  readonly kind: 'functional' | 'residential';
  readonly archetype: string;
}

export type WaterfrontDirection = 'N' | 'E' | 'S' | 'W' | 'none';

export type InitialNeutralBuildingType = Extract<
  TerrainType,
  'hq' | 'city' | 'factory' | 'airport' | 'port' | 'commtower' | 'lab' | 'silo' | 'usedSilo'
>;

/** Bitflags por celda en UrbanCityBlueprint.cellFlags (Uint8Array) */
export const URBAN_CELL_BIT_LOBE = 1 << 0;
export const URBAN_CELL_BIT_BELTWAY = 1 << 1;
export const URBAN_CELL_BIT_ROAD = 1 << 2;
export const URBAN_CELL_BIT_BRIDGE = 1 << 3;
export const URBAN_CELL_BIT_PARK = 1 << 4;
export const URBAN_CELL_BIT_YELLOW_TRUNK = 1 << 5;
export const URBAN_CELL_BIT_PORT_WATER = 1 << 6;
export const URBAN_CELL_BIT_TREE_CROWN = 1 << 7;

export const AWBW_BUILDING_OVERHANG_PX: Readonly<Record<InitialNeutralBuildingType, number>> = {
  hq: 15,
  factory: 9,
  commtower: 9,
  lab: 8,
  silo: 8,
  city: 6,
  port: 6,
  airport: 2,
  usedSilo: 0,
};

export interface NeutralBuildingBudget {
  readonly initialOwner: null;
  readonly hq: number;
  readonly commtower: number;
  readonly factory: number;
  readonly airport: number;
  readonly port: number;
  readonly lab: number;
  readonly silo: number;
  readonly city: number;
  readonly total: number;
}

export interface CityScaleSpec {
  readonly cityId: string;
  readonly name: string;
  readonly stateId: string;
  readonly municipalityId: string | null;
  readonly cityType: string;
  readonly importance: 'capital' | 'major' | 'secondary' | 'municipal';
  readonly population: number;
  readonly normalizedLogIndex: number;
  readonly tierId: CityScaleTierId;
  readonly engineScale: SpriteForgePopulationScale;
  readonly canvasSizeTiles: 20 | 33 | 36 | 40 | 44 | 48 | 56 | 60 | 64 | 68 | 80;
  readonly radiusTiles: number;
  readonly targetDryAreaTiles: number;
  readonly targetExitsCount?: number;
  readonly isProceduralSat?: boolean;
  readonly neutralBuildings: NeutralBuildingBudget;
  readonly silhouetteFamily: SilhouetteFamilyId;
  readonly arterialSkeleton: ArterialSkeletonTopologyId;
  readonly regionalAccessPattern: RegionalAccessPatternId;
  readonly satelliteFamily: SatelliteFamilyId | null;
  readonly waterfrontDir: WaterfrontDirection;
  readonly riverPresent: boolean;
  readonly microGrains: readonly MicroGrainGrammarId[];
  readonly anchorLngLat: LngLat;
  readonly anchorGlobalX: number;
  readonly anchorGlobalY: number;
}

export interface UrbanBuildingPlacement {
  readonly localX: number;
  readonly localY: number;
  readonly globalX: number;
  readonly globalY: number;
  readonly type: InitialNeutralBuildingType;
  /** Invariante: todo edificio urbano nace 100% GRIS NEUTRAL (ownerId: null) */
  readonly ownerId: null;
  readonly overhangPx: number;
  /** Variante neutral gris oficial (0 = AW2/Neutral, 1 = AW1/Neutral) para romper monotonía en T5/T4 */
  readonly neutralSkinVariant: 0 | 1;
  readonly districtId: string;
}

export interface UrbanCityBlueprint {
  readonly spec: CityScaleSpec;
  /** Esquina superior izquierda global [originGlobalX, originGlobalY] */
  readonly originGlobalX: number;
  readonly originGlobalY: number;
  readonly width: number;
  readonly height: number;
  /** Centro efectivo tras Inland Safe Centroid Shift (coordenadas locales) */
  readonly safeCenterLocalX: number;
  readonly safeCenterLocalY: number;
  readonly trunkInteractionMode: YellowTrunkCityInteractionMode;
  /** Bitflags contiguos Uint8Array(width * height) */
  readonly cellFlags: Uint8Array;
  /** Orientación de puente (0 = ninguno, 1 = HBridge, 2 = VBridge) */
  readonly bridgeAxis: Uint8Array;
  /** Edificios neutrales grises indexados por localIdx = localY * width + localX */
  readonly buildingsByLocalIdx: ReadonlyMap<number, UrbanBuildingPlacement>;
  /** Portales globales [gx, gy] sobre beltway_real conectados a la línea amarilla */
  readonly perimeterPortalsGlobal: ReadonlyArray<readonly [number, number]>;
  /** Rotondas generadas en el casco urbano (primaria + secundaria en x3) */
  readonly roundabouts?: readonly RoundaboutRecord[];
  /** Distritos funcionales no-cuadrados colocados antes del relleno residencial */
  readonly functionalDistricts?: readonly FunctionalDistrictRecord[];
  /** Sectores residenciales polimórficos con su micro-grain y bbox */
  readonly residentialDistricts?: readonly ResidentialSectorRecord[];
  /** Máscara de zonas verdes contiguas de expansión periurbana (Uint8Array, parcelas discretas <=64) */
  readonly expansionZoneMask?: Uint8Array;
  /** Máscara de exclusión de corredor aéreo (6 tiles delante/detrás de pista AIR_HUB) */
  readonly flightCorridorExclMask?: Uint8Array;
  /** Matriz exclusiva de distritos (0 = ninguno, 1..N = dIdx, first-writer-wins -> 0 solapes) */
  readonly districtGrid?: Int32Array;
  /** Leyenda ordenada de los distritos presentes en districtGrid */
  readonly districtLegend?: readonly DistrictLegendEntry[];
  /** Flechas amarillas de intercambio vial multi-direccional validadas */
  readonly interchangeArrows?: readonly InterchangeArrowRecord[];
  /** Lotes costeros reservados para futuros puertos marítimos */
  readonly futurePortPlots?: readonly FuturePortPlotRecord[];
  readonly metrics: {
    readonly dryAreaTiles: number;
    readonly buildingCount: number;
    readonly roadBlob2x2Count: number;
    readonly tallOverhangViolations: number;
    readonly interiorDeadEnds: number;
    readonly maxEmptySquareSide?: number;
    readonly functionalDistrictsCount?: number;
    readonly distinctMicroGrainsCount?: number;
    readonly circleIoU?: number;
    readonly internalMirrorIoU?: number;
    readonly topoSignature9D?: readonly number[];
  };
}

export interface UrbanSectorOverlayCell {
  readonly localX: number;
  readonly localY: number;
  readonly type: TerrainType;
  readonly ownerId: null;
  readonly neutralSkinVariant?: 0 | 1;
  readonly isYellowTrunk?: boolean;
  readonly bridgeAxis?: 1 | 2;
  readonly portUnderlayWater?: boolean;
}

export interface UrbanSectorOverlaySlice {
  readonly sectorX: number;
  readonly sectorY: number;
  readonly cityIds: readonly string[];
  readonly cells: readonly UrbanSectorOverlayCell[];
  readonly treeCrownLocalIndices: readonly number[];
  /** Celdas locales (y*20+x) que deben permanecer estrictamente 'plains' (0 montañas/bosques aleatorios) */
  readonly clearedPlainLocalIndices?: readonly number[];
}
