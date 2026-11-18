// ==============================================================================
// PUBLIC API: DOMINIO WORLD
// Cartografía MapLibre, Carreteras, Logística, Asedios Territoriales y Clanes
// ==============================================================================

// Core Motors & Algorithms
export {
  WorldMapEngine,
  validateSupplyLineConnectivity,
  type AdjacencyEdge,
} from './core/worldMapEngine';
export {
  ZOOM_GLOBAL,
  ZOOM_OPERACIONAL,
  ZOOM_TACTICO,
  TACTICAL_SPRITE_MAX_ZOOM,
  getTacticalCellPixelSizeAtZoom,
  TILE_SIZE,
  EARTH_RADIUS_M,
  MUNICIPAL_GRID_COLS,
  MUNICIPAL_GRID_ROWS,
  MUNICIPAL_TOTAL_MICRO_CELLS,
  MICRO_CELL_SIZE_METERS,
  H3_RES9_EDGE_METERS,
  lngLatToGridCoords,
  tileFractionToLngLat,
  gridCoordsToLngLat,
  getTileBounds,
  traceSupplyLine,
  lngLatToMunicipalMicroCell,
  latLngToH3Res9,
  h3Res9ToLatLng,
  h3Res9ToParentRes4,
  h3GridDistance,
  h3GridDisk,
  h3GridPathCells,
  type LngLat,
  type QuadLngLatBounds,
  type TacticalGridCoords,
} from './core/coordinates';
export {
  SpatialRoadIndex,
  getCellKey,
  calculateAnalyticalDistanceKm,
  type NearestNodeResult,
  type RoadAdjacencyResult,
  type SpatialBoundingBox,
} from './core/spatialRoadIndex';
export {
  roadNetworkEngine,
  RoadNetworkEngine,
  OSM_HEX_TERRAIN_CATALOG,
  canUnitTraverseOsmHex,
} from './core/roadNetworkEngine';
export {
  roadGarrisonEngine,
  RoadGarrisonEngine,
  type ClanTreasury,
  type DronePatrolShiftSimulationResult,
} from './core/roadGarrisonEngine';
export {
  TerritorialSiegeOrchestrator,
  type VulnerabilityWindowConfig,
  type InitiateSiegeParams,
  type SiegeResolutionResult,
} from './core/territorialSiegeOrchestrator';
export const HUMAN_HANDSHAKE_WINDOW_MS = 120_000;
export {
  initializeRegionGrid,
  recalculateSovereignty,
  executeTerritorialExpansion,
  calculateIndustrialYieldWithNodes,
  initializeMunicipalMicroGrid,
  recalculateMunicipalGridSovereignty,
  evaluateSignalCaptureTick,
  executeFifteenMinuteTickPipeline,
  type ExpansionOrder,
  type ExpansionResult,
  type RegionGridMap,
  type SignalCaptureTickResult,
  type H3PersistentDroneState,
  type H3PersistentBuildingState,
  type H3MunicipalityContext,
  type H3TickCorporationContext,
  type FifteenMinuteTickInput,
  type FifteenMinuteTickOutput,
} from './core/territorialExpansionEngine';
export {
  politicalAliceEngine,
  PoliticalAliceEngine,
  THREE_LAYER_ARCHITECTURE,
  VENEZUELA_FACTION_REGISTRY,
  POLITICAL_EDICTS_CATALOG,
  CANONICAL_VENEZUELA_REGIONS,
  CANONICAL_VENEZUELA_ADJACENCIES,
  type PoliticalEdictId,
} from './core/politicalAliceEngine';
export {
  TacticalBitMap,
} from './core/tacticalBitmap';
export {
  ClanEngine,
  CLAN_VAULT_TIERS,
  CANONICAL_TERRITORY_SECTORS,
  CLAN_PROJECTS,
  type Clan,
  type ClanMember,
  type ClanRole,
  type VaultTier,
  type CardRarity,
  type ClanCardRequest,
  type UserProfileIdentity,
  type SafeguardInventory,
  type TerritorySector,
} from './core/clanSystem';

// Services
export {
  generateGbaSectorBlueprint,
  validateGbaSectorMatrix,
  getGbaPipelineCacheSize,
  isLandAtCabimasPolygon,
  registerLandPolygons,
  GBA_CALIBRATION_PRESETS,
} from './core/gbaMapPipeline';
export {
  stateSovereigntyService,
  STATE_PERKS_CATALOG,
} from './services/stateSovereigntyService';
export { spatialDeploymentService } from './services/spatialDeploymentService';

// Hooks
export { useTerritoryMap } from './hooks/useTerritoryMap';
export { useSiegeRealtime } from './hooks/useSiegeRealtime';

// Types
export type {
  FactionId,
  StateSovereigntyRecord,
  UserRoleContext,
  SovereignStateUpdateInput,
  ProvincialStrataState,
  SecessionEvaluationResult,
  MunicipalAuditActionType,
  MunicipalAuditLogEntry,
  MunicipalPublicBuildingsState,
  MunicipalManagerRole,
  StateLevelPerkState,
  CorporateMacroPrivilegeState,
  MunicipalBuildingType,
  MunicipalBuildingSpec,
  StatePerkBranch,
  StatePerkId,
  StatePerkSpec,
} from './types/stateSovereigntyTypes';
export * from './types/tacticalRoadTypes';
export {
  ZULIA_MUNICIPALITIES_CATALOG,
  getZuliaMunicipalityMeta,
  type MapScaleLevel,
  type InspectorTabId,
  type CountrySelectionTarget,
  type StateSelectionTarget,
  type MunicipalitySelectionTarget,
  type CellSelectionTarget,
  type MapSelectionTarget,
  type ZuliaMunicipalityMeta,
} from './types/mapSelectionTypes';

// Components
export {
  TacticalWorldMap,
  TacticalWorldMap as WorldMapCanvas,
  type TacticalWorldMapProps,
} from './components/TacticalWorldMap';
export { MapLoadingScreen } from './components/MapLoadingScreen';
export { WarLobbyHub } from './components/WarLobbyHub';
export { WarRoomModal } from './components/WarRoomModal';
export { ClanHeadquartersView } from './components/ClanHeadquartersView';
export { MetaCommandConsole } from './components/MetaCommandConsole';
export { UnifiedRegionInspector } from './components/UnifiedRegionInspector';
export { RightActionDock } from './components/RightActionDock';
export { LeftCollapsibleRail } from './components/LeftCollapsibleRail';
export { GarrisonManagementDrawer } from './components/GarrisonManagementDrawer';
export { TerritorySiegeModal } from './components/TerritorySiegeModal';
export { TerritoryInspectorModal } from './components/TerritoryInspectorModal';
export { StateInspectorDrawer } from './components/StateInspectorDrawer';
export { StateSovereignDeckModal } from './components/StateSovereignDeckModal';
export { DualResourceHeader } from './components/DualResourceHeader';
export { CommandHUD } from './components/CommandHUD';
export { FactionBanner } from './components/FactionBanner';
export { ParadoxCommandDrawer } from './components/ParadoxCommandDrawer';
export { TacticalC4ISRBaseDiorama } from './components/TacticalC4ISRBaseDiorama';
export { TacticalDock, type LobbyStationView } from './components/TacticalDock';
export { TacticalMapControls } from './components/TacticalMapControls';
export { CorporationGateModal } from './components/CorporationGateModal';
export { CorporationHubModule } from './components/CorporationHubModule';
export { DroneSchedulerDrawer, type DroneSchedulerDrawerProps } from './components/DroneSchedulerDrawer';
export {
  scheduleUnitCommand,
  cancelUnitCommand,
  processDueUnitSchedules,
  fetchUnitSchedules,
  fetchUnitActionLogs,
  type UnitCommandType,
  type UnitScheduleRow,
  type UnitActionLogRow,
} from './services/droneScheduleService';
export {
  fetchMyCorporation,
  fetchCorporationMembers,
  listCorporations,
  createCorporation,
  joinCorporation,
  updateMemberPermissions,
  donateToCorporation,
  leaveCorporation,
  hasCorpPermission,
  type CorporationRole,
  type DelegatedPermissions,
  type CorporationRecord,
  type CorporationMemberRecord,
  type MyCorporationContext,
} from './services/corporationService';
