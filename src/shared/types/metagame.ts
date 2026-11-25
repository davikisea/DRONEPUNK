/**
 * ==============================================================================
 * CONTRATOS DE TIPOS Y MODELOS DEL METAJUEGO (DRONEPUNK 0.0.1)
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md + docs/02_MASTER_METAGAME_INDUSTRY_ECONOMY.md
 * Pilares: Risk.io + Albion P2P + Victoria 3 Macro-Economy + Advance Wars 1-100 HP
 * ==============================================================================
 */

import type { TerrainType, WeatherCondition } from './index';

export type ContinentCode = 'EU' | 'NA' | 'SA' | 'AS' | 'AF' | 'OC' | 'MECA';

export type BiomeType =
  | 'temperate_plains'
  | 'boreal_forest'
  | 'arid_desert'
  | 'arctic_tundra'
  | 'tropical_jungle'
  | 'mountain_highland'
  | 'coastal_archipelago';

export type BaseTerrainType =
  | 'plains'
  | 'mountain'
  | 'desert'
  | 'tundra'
  | 'forest'
  | 'archipelago';

export type WeatherType = 'clear' | 'rain' | 'snow' | 'sandstorm';

export type SecurityZone = 'high_sec' | 'low_sec' | 'null_sec';

export interface ProvinceVisualData {
  id: string;
  name: string;
  countryIso: string;
  isCapital: boolean;
  biome: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ownerTag: string;
  ownerColor: string;
  isUnderSiege?: boolean;
  currentTcp?: number;
  maxTcp?: number;
  tcpPercent?: number;
  bunkerLevel?: 1 | 2 | 3 | 4 | 5;
  activeBuffsCount?: number;
  connectedAdjacenciesCount?: number;
  isCapitalCutoff?: boolean;
  isSupplyStarved?: boolean;
  tcp?: number;
  tcpMax?: number;
  status?: TerritoryStatus;
  resourcePerMin?: string;
}

export type TerritoryStatus = 'stable' | 'under_siege' | 'disputed' | 'cooldown_priority';

export type GarrisonAIEngineTier = 'easy' | 'normal' | 'hard' | 'chess' | 'mcts_legendary';

export type MetagameItemCategory =
  | 'raw_resource'
  | 'refined_material'
  | 'patent_blueprint'
  | 'buff_consumable'
  | 'unit_chassis'
  | 'cosmetic';

export type AdjacencyConnectionType =
  | 'land_open'
  | 'land_choke'
  | 'river'
  | 'strait'
  | 'sea_lane'
  | 'air_corridor';

export type TerritoryNodeType =
  | 'capital_citadel'
  | 'city'
  | 'factory'
  | 'refinery'
  | 'warehouse'
  | 'comm_tower'
  | 'radar'
  | 'fortress';

// ------------------------------------------------------------------------------
// MODELOS GEOGRÁFICOS Y CARTOGRÁFICOS (SUPABASE SSOT)
// ------------------------------------------------------------------------------

export interface WorldCountry {
  isoCode: string; // ej: 'ES', 'US', 'JP'
  name: string;
  continent: ContinentCode;
  coordinates: { lat: number; lng: number };
  defenseDoctrine: string;
  createdAt?: string;
}

export interface WorldProvince {
  id: string; // ej: 'ES_MADRID'
  countryIso: string;
  name: string;
  isCapital: boolean;
  isCapturable: boolean; // Las capitales son capturables
  baseTerrain: BaseTerrainType;
  nativeWeather: WeatherType;
  resourceMultiplier: number; // Multiplicador de recursos (1.75x - 2.0x en capitales)
  buildingSlots: number; // 4 a 16 parcelas (12-16 en capitales)
  posX: number; // Porcentaje relativo X (0-100)
  posY: number; // Porcentaje relativo Y (0-100)
  width: number;
  height: number;
  createdAt?: string;
}

export interface TerritoryNode {
  id: string; // ej: 'NODE_ES_MAD_CITADEL'
  provinceId: string;
  name: string;
  nodeType: TerritoryNodeType;
  controllerClanId: string | null;
  defenseLevel: 1 | 2 | 3 | 4 | 5;
  energyUpkeep: number; // EC / hora
  structuralHp: number;
  maxHp: number;
  outputPerMin: number;
  isUnderAttack: boolean;
  updatedAt?: string;
}

export interface TerritoryAdjacency {
  id: string;
  fromProvinceId: string;
  toProvinceId: string;
  connectionType: AdjacencyConnectionType;
  isBlocked: boolean;
  maxBandwidthTons: number;
  tollRatePercent: number;
}

export interface WorldRegion {
  id: string; // ej: 'ES_MAD_01'
  countryIso: string;
  provinceId: string;
  name: string;
  biomeType: BiomeType;
  securityZone: SecurityZone;
  isCapital: boolean;
  isCapturable: boolean;
  maxBuildingSlots: number;
  primaryResource: string;
  secondaryResource: string;
}

export interface TerritoryControlState {
  provinceId: string;
  controllingClanId: string | null;
  controllingAllianceId: string | null;
  currentTcp: number;
  tcpThreshold: number;
  status: TerritoryStatus;
  cooldownExpiresAt: string | null;
  lastBattleAt: string | null;
  fortressLevel: number; // 0 to 5
}

// ------------------------------------------------------------------------------
// GOBERNANZA, ALIANZAS Y SUBSIDIARIAS
// ------------------------------------------------------------------------------

export interface CorporateSubsidiary {
  id: string;
  parentCorpId: string;
  subsidiaryClanId: string;
  tributeRatePercent: number; // 5.00 to 25.00 %
  autonomousMarketAllowed: boolean;
  status: 'active' | 'grace_period' | 'seceded';
  graceExpiresAt: string | null;
}

// ------------------------------------------------------------------------------
// LOGÍSTICA, INVENTARIO Y REFUERZOS
// ------------------------------------------------------------------------------

export interface UnitHangarEntry {
  id: string;
  userId: string;
  clanId?: string | null;
  unitCode: string;
  tier: number; // 1 to 5
  level: number; // 1 to 5 (+2% eff per lvl)
  hp: number; // 1 to 100
  quantity: number;
  locationProvinceId?: string | null;
}

export interface PatentRegistryEntry {
  id: string;
  userId: string;
  patentCode: string;
  tier: number; // 1 to 5
  unlockedAt: string;
}

export interface GarrisonDeploymentState {
  id: string;
  regionId: string;
  owningClanId: string;
  garrisonLevel: 1 | 2 | 3 | 4 | 5;
  aiEngineTier: GarrisonAIEngineTier;
  hourlyUpkeepEc: number;
  isLegendary: boolean;
  serviceStartedAt: string;
  retirementDueAt: string | null; // 21 días reales para legendarios
  isUnderAttack: boolean;
  handshakeDeadline: string | null; // 120 segundos (Handshake Defensivo)
}

export interface ReinforcementQueueEntry {
  matchId: string;
  playerId: string;
  requestedAtTurn: number;
  arrivalTurn: number; // requestedAtTurn + 4
  unitsToDeploy: Array<{
    unitCode: string;
    tier: number;
    level: number;
    hp: number; // 1-100
  }>;
  isDelivered: boolean;
}

// ------------------------------------------------------------------------------
// MERCADO P2P
// ------------------------------------------------------------------------------

export interface P2PMarketOrderV2 {
  id: string;
  sellerId: string;
  buyerId?: string | null;
  provinceTerminalId?: string | null;
  itemCategory: MetagameItemCategory;
  itemCode: string;
  tier: number;
  quantity: number;
  unitPriceEc: number;
  totalPriceEc: number;
  platformBurnEc: number;
  provinceRoyaltyEc: number;
  netSellerRevenueEc: number;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
  completedAt?: string | null;
}

// ------------------------------------------------------------------------------
// CONSTANTES MATEMÁTICAS SSOT DE BALANCE CANÓNICO V2.0
// ------------------------------------------------------------------------------
export const MASTER_METAGAME_CONSTANTS = {
  // Geopolítica & Sobre-Expansión
  BASE_PROVINCES_CAP: 6, // N_cap: Provincias óptimas sin penalización
  OVER_EXPANSION_EXPONENT: 2.4, // gamma
  OVER_EXPANSION_COEFFICIENT: 0.35, // alpha
  PROVINCE_BASE_UPKEEP_EC: 120, // EC / h
  CAPITAL_IMMUNITY: false, // Las capitales SON capturables
  CAPITAL_RESOURCE_MULTIPLIER: 2.0, // Multiplicador masivo de producción en capitales
  COOLDOWN_PRIORITY_HOURS: 4, // Escudo post-conquista (240 min)
  TCP_MAX_STABLE: 10000,
  TCP_MAX_FORTRESS: 15000,
  TCP_PASSIVE_DECAY_PER_MIN: 50,

  // Logística y Refuerzos
  REINFORCEMENT_ARRIVAL_TURNS: 4, // 4 rondas completas
  MAX_REINFORCEMENT_CALLS_PER_MATCH: 1, // Exactamente 1 vez
  PYRRHIC_VICTORY_PENALTY: 0.15, // -15% score si se piden refuerzos

  // Balística y Escala de Integridad
  CANONICAL_MAX_HP: 100, // Escala 1-100 HP
  TIER_EFFECTIVENESS_BONUS_PER_LEVEL: 0.02, // +2% por nivel de tropa (hasta +10% en Nv. 5)
  BASE_SALVAGE_RATE: 0.35, // 35% base para lootbox de chatarra
  RECYCLE_SCRAP_RATE: 0.35, // 35% SSOT recuperación de chatarra en desguace y siniestralidad

  // Mercado P2P
  TOTAL_P2P_TAX_RATE: 0.02, // 2% total
  PLATFORM_BURN_RATE: 0.01, // 1% sink deflacionario permanente
  PROVINCE_ROYALTY_RATE: 0.01, // 1% regalía para clan dueño de la terminal
  VWAP_COLLAR_PERCENT: 0.25, // +/- 25% bandas anti-dumping / anti-RMT
  P2P_COLLAR_MAX_DEVIATION: 0.25,
  P2P_MARKET_FEE_RATE: 0.02,
  P2P_FEE_BURN_SHARE: 0.50,

  // Soberanía Dual & Asedio Geopolítico (Project Alice)
  CAPITAL_TCP_THRESHOLD: 15000,
  STANDARD_TCP_THRESHOLD: 10000,
  TCP_LOSS_ATTACKER_VICTORY: 3500,
  OCCUPIED_GRACE_HOURS_MIN: 24,

  // Guarnición IA
  HANDSHAKE_TIMEOUT_SECONDS: 120, // Ventana de 120s para drop-in humano
  LEGENDARY_SERVICE_DAYS: 21, // 21 días reales (504 horas) antes de retiro
  MAX_CLANS_PER_ALLIANCE: 10, // Máximo estricto de 10 clanes por corporación

  // Cerebro Geotáctico Persistente (Micro-Celdas 100x100m, Gambits, Impuestos Simbióticos y Política Macro)
  MUNICIPAL_GRID_TOTAL_CELLS: 500,
  MUNICIPAL_CELL_SIZE_METERS: 100,
  MUNICIPAL_MAJORITY_THRESHOLD: 0.50,
  SIGNAL_TICK_MINUTES: 10,
  ALLIED_TAX_RATE_MIN: 0.05,
  ALLIED_TAX_RATE_MAX: 0.10,
  RIVAL_RETENTION_RATE_MAX: 0.50,
  STATE_PERK_MUNICIPALITY_THRESHOLD: 0.60,
  STATE_PERK_BORDER_FUEL_DISCOUNT: 0.20,
  STATE_PERK_ADJACENT_CONQUEST_BONUS: 0.15,
  GAMBIT_DEFAULT_SHIFT_HOURS: 8,
  GAMBIT_MAX_ENEMY_CONTROL_THRESHOLD: 0.70,
} as const;

export const TOPOLOGY_FLAGS = {
  LAND_OPEN: 0x01,
  NATIONAL_BORDER: 0x02,
  COASTAL: 0x04,
  IMPASSIBLE: 0x08,
  STRAIT_CHOKE: 0x10,
  RIVER_CROSSING: 0x20,
} as const;

// ------------------------------------------------------------------------------
// MODELOS CANÓNICOS DE DRONEPUNK 0.0.1 (ALICE TOPOLOGY & SOBERANÍA DUAL)
// ------------------------------------------------------------------------------

export type CanonicalBiome =
  | 'BIO-PLA'
  | 'BIO-HGH'
  | 'BIO-URB'
  | 'BIO-ARC-ISL'
  | 'BIO-JGL';

export interface GeotacticsRegion {
  id: string; // ej: 'REG_VE_01'
  countryIso: string;
  name: string;
  biome: CanonicalBiome;
  isPlayable: boolean;
  isNationalCapital: boolean;
  isCapturable: boolean;
  centerX: number;
  centerY: number;
  primaryCommodity: string;
  resourceTier: 1 | 2 | 3 | 4 | 5;
  baseHourlyYield: number;
  baseEnergyUpkeepEc: number;
  maxBuildingSlots: number;
  createdAt?: string;
}

export interface GeotacticsRegionAdjacency {
  id: string;
  fromRegionId: string;
  toRegionId: string;
  topologyFlags: number; // 0x01 land_open, 0x02 national_border, 0x04 coastal, 0x08 impassible, 0x10 strait_choke, 0x20 river_crossing
  chokeControllingRegionId?: string | null;
  distanceKm: number;
  transitRounds: number;
  tollFeePercent: number;
  createdAt?: string;
}

export interface GeotacticsRegionSovereignty {
  regionId: string;
  ownerClanId: string | null;      // De Jure Owner
  controllerClanId: string | null; // De Facto Controller
  controlPoints: number;           // 0..15000 TCP
  maxControlPoints: number;        // 10000 o 15000
  bunkerLevel: 1 | 2 | 3 | 4 | 5;
  status: 'stable' | 'under_siege' | 'occupied_grace';
  customsEscrowLocked: boolean;
  isEnergyStarved: boolean;
  activeBattleId?: string | null;
  cooldownExpiresAt?: string | null;
  graceExpiresAt?: string | null;
  lastTickAt: string;
  updatedAt: string;
}

export interface TerritorialBattleSession {
  id: string;
  regionId: string;
  attackerClanId: string;
  defenderClanId?: string | null;
  attackerCommanderId: string;
  defenderCommanderId?: string | null;
  mode: 'pve_garrison' | 'pvp_realtime';
  handshakeExpiresAt: string;
  status: 'handshake_pending' | 'in_combat' | 'concluded' | 'aborted';
  createdAt: string;
  concludedAt?: string | null;
}

/**
 * Calcula la recuperación de chatarra tecnológica (35% SSOT) por pérdida de un chasis destruido.
 */
export function calculateLossScrapRecovery(tier: number, quantity: number = 1): number {
  const baseValue = tier * 50 * Math.max(0, quantity);
  return Math.floor(baseValue * MASTER_METAGAME_CONSTANTS.RECYCLE_SCRAP_RATE);
}

/**
 * Calcula el factor multiplicador de sobre-expansión imperial (Victoria 3 Macro-Economy).
 */
export function calculateOverExpansionFactor(provincesCount: number): number {
  const cap = MASTER_METAGAME_CONSTANTS.BASE_PROVINCES_CAP;
  if (provincesCount <= cap) return 0.0;
  const ratio = (provincesCount - cap) / cap;
  return (
    MASTER_METAGAME_CONSTANTS.OVER_EXPANSION_COEFFICIENT *
    Math.pow(ratio, MASTER_METAGAME_CONSTANTS.OVER_EXPANSION_EXPONENT)
  );
}

/**
 * Calcula la liquidación exacta del split del 2% en una transacción P2P.
 */
export function calculateP2PTransactionSplit(totalPriceEc: number): {
  taxTotal: number;
  platformBurn: number;
  provinceRoyalty: number;
  netSellerPayout: number;
} {
  const taxTotal = Math.floor(totalPriceEc * MASTER_METAGAME_CONSTANTS.TOTAL_P2P_TAX_RATE);
  const platformBurn = Math.floor(totalPriceEc * MASTER_METAGAME_CONSTANTS.PLATFORM_BURN_RATE);
  const provinceRoyalty = taxTotal - platformBurn;
  const netSellerPayout = totalPriceEc - taxTotal;

  return {
    taxTotal,
    platformBurn,
    provinceRoyalty,
    netSellerPayout,
  };
}

// ------------------------------------------------------------------------------
// CEREBRO GEOTÁCTICO PERSISTENTE: MICRO-CELDAS, GAMBITS E IMPUESTOS SIMBIÓTICOS
// ------------------------------------------------------------------------------

export type DroneUnitRole =
  | 'recon_scout'
  | 'infantry_engineer'
  | 'tank_direct'
  | 'artillery_indirect';

export type ExclusiveResourceNodeType =
  | 'lithium'
  | 'oil_energy'
  | 'silicon'
  | 'alloys'
  | 'fuel';

export type MunicipalPublicInfrastructureType =
  | 'early_warning_radar'
  | 'rapid_repair_workshop'
  | 'sam_battery';

export interface MunicipalMicroCell {
  cellIndex: number;
  x: number;
  y: number;
  sector: [number, number];
  lngLat: [number, number];
  controllingClanId: string | null;
  signalInfluenceByClan: Record<string, number>;
  exclusiveResourceNode?: ExclusiveResourceNodeType | null;
  privateBuildingId?: string | null;
  publicInfrastructureType?: MunicipalPublicInfrastructureType | null;
  isSabotaged?: boolean;
}

export interface MunicipalMicroGrid {
  municipalityId: string;
  stateId: string;
  totalCells: number;
  gridColumns: number;
  gridRows: number;
  cellSizeMeters: number;
  cells: MunicipalMicroCell[];
  controllingClanId: string | null;
  majorityThreshold: number;
  sovereigntyRatioByClan: Record<string, number>;
  publicSlotsUnlocked: boolean;
  updatedAt: string;
}

export interface DroneSignalProjection {
  unitId: string;
  clanId: string;
  unitRole: DroneUnitRole;
  centerCellIndex?: number;
  coordinates: [number, number];
  hp: number;
  signalRadiusCells: number;
  captureRatePerTick: number;
}

export interface GambitEngagementRule {
  detectTargetRole: DroneUnitRole | 'any_hostile' | 'enemy_infrastructure';
  action:
    | 'attack_direct'
    | 'attack_indirect'
    | 'sabotage_capture'
    | 'retreat_to_allied_factory'
    | 'ignore';
}

export interface DroneGambitProgram {
  programId: string;
  unitId: string;
  unitRole: DroneUnitRole;
  patrolWaypoints: [[number, number], [number, number]];
  engagementRules: GambitEngagementRule[];
  retreatCondition: {
    onDetectRole: DroneUnitRole[];
    hpBelowThreshold: number;
    fallbackFactoryCoordinates: [number, number];
  };
  targetPriorityRule:
    | 'neutral_cells_first'
    | 'enemy_extractors_first'
    | 'border_roads_first';
  maxEnemyControlThreshold: number;
  shiftDurationHours: number;
}

export interface TerritorialTaxLedger {
  municipalityId: string;
  controllingClanId: string | null;
  alliedTaxRate: number;
  rivalRetentionRate: number;
  treatyOverrideRate?: Record<string, number>;
  exclusiveResourceNode: ExclusiveResourceNodeType;
  accumulatedVaultTaxEc: number;
}

// ------------------------------------------------------------------------------
// CEREBRO GEOTÁCTICO PERSISTENTE H3 (RES 9, AL/CB/MC, 9 DRONES Y CARTUCHOS GAMBITS)
// ------------------------------------------------------------------------------

export interface ResourceTriad {
  alloys: number;     // AL: Aleaciones estructurales
  fuel: number;       // CB: Combustible operativo
  microchips: number; // MC: Microchips tácticos
}

export type DroneArchetypeId =
  | 'infantry_swarm'
  | 'recon_explorer'
  | 'light_artillery'
  | 'medium_tank'
  | 'anti_air'
  | 'logistics_apc'
  | 'bomber_drone'
  | 'neo_tank'
  | 'tactical_missile';

export interface DroneArchetypeSpec {
  id: DroneArchetypeId;
  tierLevel: 1 | 2 | 3;
  name: string;
  unlockRequirement:
    | 'basic_factory'
    | 'corp_advanced_workshop'
    | 'state_60_industrial_complex';
  cost: ResourceTriad;
  fuelPerHour: number;
  fuelPerTick15m: number;
  conquestHexesPerHour: number;
  conquestProgressPerTick15m: number;
  visionRangeHexes: number;
  minAttackRange: number;
  maxAttackRange: number;
  isAirUnit: boolean;
  canMoveAndFireSameTick: boolean;
  canCaptureBuildings: boolean;
  canCounterAttack: boolean;
}

export type OsmHexTerrainType =
  | 'ROAD'
  | 'PLAIN'
  | 'FOREST'
  | 'URBAN'
  | 'MOUNTAIN'
  | 'WATER';

export interface OsmTerrainModifierSpec {
  terrainType: OsmHexTerrainType;
  stars: 0 | 1 | 2 | 3 | 4;
  defenseBonus: number;
  movementCostMultiplier: number;
  concealsGroundUnits: boolean;
  impassableForWheeledTracked: boolean;
  requiresBridgeForGround: boolean;
  infantryVisionBonus: number;
}

export const OSM_HEX_TERRAIN_CATALOG: Record<OsmHexTerrainType, OsmTerrainModifierSpec> = {
  ROAD: {
    terrainType: 'ROAD',
    stars: 0,
    defenseBonus: 0.0,
    movementCostMultiplier: 0.5,
    concealsGroundUnits: false,
    impassableForWheeledTracked: false,
    requiresBridgeForGround: false,
    infantryVisionBonus: 0,
  },
  PLAIN: {
    terrainType: 'PLAIN',
    stars: 1,
    defenseBonus: 0.1,
    movementCostMultiplier: 1.0,
    concealsGroundUnits: false,
    impassableForWheeledTracked: false,
    requiresBridgeForGround: false,
    infantryVisionBonus: 0,
  },
  FOREST: {
    terrainType: 'FOREST',
    stars: 2,
    defenseBonus: 0.2,
    movementCostMultiplier: 1.5,
    concealsGroundUnits: true,
    impassableForWheeledTracked: false,
    requiresBridgeForGround: false,
    infantryVisionBonus: 0,
  },
  URBAN: {
    terrainType: 'URBAN',
    stars: 3,
    defenseBonus: 0.3,
    movementCostMultiplier: 1.0,
    concealsGroundUnits: false,
    impassableForWheeledTracked: false,
    requiresBridgeForGround: false,
    infantryVisionBonus: 0,
  },
  MOUNTAIN: {
    terrainType: 'MOUNTAIN',
    stars: 4,
    defenseBonus: 0.4,
    movementCostMultiplier: 2.0,
    concealsGroundUnits: true,
    impassableForWheeledTracked: true,
    requiresBridgeForGround: false,
    infantryVisionBonus: 1,
  },
  WATER: {
    terrainType: 'WATER',
    stars: 0,
    defenseBonus: -0.1,
    movementCostMultiplier: 1.0,
    concealsGroundUnits: false,
    impassableForWheeledTracked: false,
    requiresBridgeForGround: true,
    infantryVisionBonus: 0,
  },
};

export type GambitConditionCode =
  | 'HP_LT_40'
  | 'HP_LT_30'
  | 'FUEL_LT_20'
  | 'ENEMY_IN_RANGE'
  | 'WEAK_ENEMY_IN_RANGE'
  | 'SUPERIOR_ENEMY_IN_RANGE'
  | 'ENEMY_NEAR_ALLY_FACTORY_2'
  | 'HEX_NEUTRAL'
  | 'HEX_ENEMY'
  | 'HEX_HAS_ENEMY_FACTORY'
  | 'MUNICIPALITY_ENEMY_OVER_50'
  | 'MUNICIPALITY_ENEMY_OVER_70'
  | 'ALWAYS';

export type GambitActionCode =
  | 'ATTACK_WEAKEST'
  | 'KEEP_DISTANCE_AND_FIRE'
  | 'IGNORE_COMBAT_STEALTH'
  | 'INTERCEPT_AND_ATTACK'
  | 'FOLLOW_WAYPOINTS_LOOP'
  | 'PATROL_PING_PONG'
  | 'HOLD_POSITION_ANCHOR'
  | 'CAPTURE_HEX_UNTIL_DONE'
  | 'SABOTAGE_OR_CAPTURE_BUILDING'
  | 'RETREAT_TO_NEAREST_APC_OR_REPAIR'
  | 'RETURN_TO_ALLY_FACTORY'
  | 'FLEE_OPPOSITE_TO_FOREST_OR_MOUNTAIN';

export interface GambitSlotRule {
  slot: number;
  condition: GambitConditionCode;
  action: GambitActionCode;
}

export type DoctrinePresetId = 'NIGHT_PAINTER' | 'WATCHDOG' | 'SABOTEUR';

export interface DoctrineCodePayload {
  name: string;
  version: number;
  recommendedUnit: DroneArchetypeId;
  maxSlots: 4 | 6;
  rules: GambitSlotRule[];
}

export interface SparseMapHexRecord {
  h3Index: string;
  municipalityId: string;
  terrainType: OsmHexTerrainType;
  hasBridge?: boolean;
  ownerCorpId: string | null;
  captureProgress: number; // 0..100
  contestingCorpId: string | null;
  lastUpdatedTick: number;
  lastActiveTimestampMs: number;
}

/**
 * Contratos de Geografía Persistente Híbrida por Sector (20x20 celdas) y Pipeline GBA
 */
export const TACTICAL_SPRITE_NATIVE_SIZE = 16;
export const TACTICAL_SPRITE_GPU_SCALE = 3;
export const TACTICAL_SPRITE_GPU_SIZE = TACTICAL_SPRITE_NATIVE_SIZE * TACTICAL_SPRITE_GPU_SCALE; // 48px
// A z=15 (tileSize 512px) cada celda 20x20 mide 25.6px; a z=15.90689 mide exactamente 48.0px (1:1 con sprite GPU)
export const TACTICAL_SPRITE_MAX_ZOOM = Number(
  (15 + Math.log2(TACTICAL_SPRITE_GPU_SIZE / (512 / 20))).toFixed(4)
);

export type GbaFactionOwner = 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | null;

export type GbaDistrictArchetype =
  | 'coastal_port'
  | 'urban_core'
  | 'industrial_hub'
  | 'forest_frontier'
  | 'mountain_pass';

export interface GbaCalibrationProfile {
  profileId: string;
  label: string;
  // Costero
  coastEdgeStrictness: number; // 0..1 (1 = estricto contra polígono real)
  shoalRatio: number; // 0..1 (proporción de costa con playa shoal vs acantilado)
  reefDensity: number; // 0..1
  portCoastalMinSpacing: number; // distancia mínima entre puertos
  estuaryMouthWidth: number; // 1..2
  // Hidrología
  riverMeanderAmplitude: number;
  riverMeanderFreq: number;
  lake2x2Probability: number; // 0..1
  bridgeMaxSpacing: number;
  waterfallMouthEnabled: boolean;
  // Red Vial A*
  roadWidth: 1;
  roadCurvePenalty: number;
  roadParallelMinGap: number; // >= 3 celdas entre vías paralelas
  roadEdgeAttachMode: 'explicit_ports_only';
  // Biomas y Orografía
  forestClusterTargetDensity: number; // 0..1
  forestSmoothPasses: number; // >= 2
  mountainRidgeLength: number;
  mountainPassFrequency: number;
  plainOpenBufferRatio: number;
  // Gramática Estratégica
  hqFactoryClusterSize: number; // 2..4
  cityClusterSize: number; // 2..3
  siloChokepointBias: number; // 0..1
  minStrategicPropsPerLandSector: number;
  maxDeadEndRoads: number; // 0
  minBfsPassableRatio: number; // 0.90
}

export const DEFAULT_GBA_CALIBRATION_PROFILE: GbaCalibrationProfile = {
  profileId: 'aw_gba_aaa_v1',
  label: 'Advance Wars GBA Calibrated AAA',
  coastEdgeStrictness: 1.0,
  shoalRatio: 0.48,
  reefDensity: 0.055,
  portCoastalMinSpacing: 8,
  estuaryMouthWidth: 1,
  riverMeanderAmplitude: 1.6,
  riverMeanderFreq: 0.19,
  lake2x2Probability: 0.22,
  bridgeMaxSpacing: 9,
  waterfallMouthEnabled: true,
  roadWidth: 1,
  roadCurvePenalty: 1.45,
  roadParallelMinGap: 3,
  roadEdgeAttachMode: 'explicit_ports_only',
  forestClusterTargetDensity: 0.28,
  forestSmoothPasses: 2,
  mountainRidgeLength: 5,
  mountainPassFrequency: 0.35,
  plainOpenBufferRatio: 0.24,
  hqFactoryClusterSize: 3,
  cityClusterSize: 2,
  siloChokepointBias: 0.7,
  minStrategicPropsPerLandSector: 4,
  maxDeadEndRoads: 0,
  minBfsPassableRatio: 0.90,
};

export interface BiomeCoastalMask {
  isCoastalSector: boolean;
  waterCells: number;
  shoalCells: number;
  landCells: number;
}

export interface GbaAutotileMask {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
  bitmask: number; // 0..15 (N=1, E=2, S=4, W=8)
}

export interface SectorGenerationValidation {
  emptyCells: number;
  connectedRoads: boolean;
  bfsReachableRatio: number; // 0..1
  riverBridgeCount: number;
  strategicPropertiesCount: number;
  parallelRoadConflicts?: number;
  disconnectedProperties?: number;
  calibrationScore?: number; // 0..100
  districtArchetype?: GbaDistrictArchetype;
}

export interface SectorGenerationBlueprint {
  sector: [number, number];
  gridSize: number;
  seed: number;
  coastalMask: BiomeCoastalMask;
  validation: SectorGenerationValidation;
  generatedAt: string;
  profileId?: string;
  weather?: WeatherCondition;
}

export interface SectorCellTerrainOverride {
  x: number; // 0..19
  y: number; // 0..19
  type: TerrainType;
  ownerId?: GbaFactionOwner;
  defenseStars?: number;
}

export interface SectorTerrainOverride {
  sectorKey: string; // `${sx}_${sy}`
  sector: [number, number];
  gridSize: number; // 20
  cells: Record<string, SectorCellTerrainOverride>; // key `${x}_${y}`
  updatedAt: string;
  source: 'map_builder' | 'pilot_seed' | 'supabase';
}

export interface SectorTerrainDelta {
  sector: [number, number];
  gridSize?: number;
  changes: SectorCellTerrainOverride[];
  source?: 'map_builder' | 'pilot_seed' | 'supabase';
}

export type PropertyOwnershipOrigin =
  | 'neutral_procedural'
  | 'pilot_seed'
  | 'map_builder'
  | 'conquest_rpc'
  | 'supabase_realtime';

export interface SectorPropertyOwnershipRecord {
  sectorKey: string;
  cellKey: string;
  terrainType: TerrainType;
  ownerId: GbaFactionOwner;
  ownerClanId: string | null;
  buildingId: string | null;
  captureProgress: number;
  origin: PropertyOwnershipOrigin;
  updatedAt: string;
}

export type PropertyOwnershipResolver = (
  sector: [number, number],
  cell: [number, number],
  terrainType: TerrainType
) => GbaFactionOwner;

export const SECTOR_TERRAIN_DEFENSE_STARS: Record<TerrainType, number> = {
  plains: 1,
  forest: 2,
  mountain: 4,
  road: 0,
  river: 0,
  city: 3,
  factory: 3,
  airport: 3,
  port: 3,
  hq: 4,
  sea: 0,
  reef: 1,
  shoal: 0,
  bridge: 0,
  commtower: 3,
  silo: 3,
  usedSilo: 3,
  lab: 3,
  pipe: 0,
  pipeSeam: 0,
  rubble: 1,
};

export const SECTOR_TERRAIN_MOVEMENT_COST: Record<TerrainType, number> = {
  plains: 1,
  forest: 2,
  mountain: 3,
  road: 1,
  river: 2,
  city: 1,
  factory: 1,
  airport: 1,
  port: 1,
  hq: 1,
  sea: 1,
  reef: 2,
  shoal: 1,
  bridge: 1,
  commtower: 1,
  silo: 1,
  usedSilo: 1,
  lab: 1,
  pipe: 99,
  pipeSeam: 99,
  rubble: 1,
};

export function getTerrainDefenseStars(type: TerrainType): number {
  return SECTOR_TERRAIN_DEFENSE_STARS[type] ?? 1;
}

export function getTerrainMovementCost(type: TerrainType): number {
  return SECTOR_TERRAIN_MOVEMENT_COST[type] ?? 1;
}
