// ==============================================================================
// PUBLIC API: DOMINIO ECONOMY
// Almacén Físico de 16 Chasis Militares, Forja de 10 Parcelas, Mercado P2P 2% y Ticker
// ==============================================================================

// Core Motors & Constants
export {
  CANONICAL_UNIT_PRODUCTION_CATALOG,
  TurnEconomyEngine,
  type ProductionCatalogEntry,
  type TurnProcessingResult,
} from './core/turnEconomy';
export {
  IndustrialEngine,
  ECONOMY_CONFIG_V2,
  REFINING_RECIPES,
  PLOT_UNLOCK_TABLE,
  CARD_UPGRADE_TABLE,
  type CorporateSpecialization,
  type IndustrialInventory,
  type RefinedResourceType,
  type RawResourceType,
  type IndustrialResourceType,
  type IndustrialPlot,
  type PlotEnterpriseType,
  type PlotStatus,
  type StrandedCargo,
  type ActiveRefiningJob,
  type P2PPriceReference,
  type P2PMarketListing,
} from './core/industrialEngine';
export {
  processPropertyMaintenance,
  isPropertyCompatibleWithUnit,
  type UnitMaintenanceReport,
  type MaintenanceProcessingResult,
} from './core/propertyMaintenance';
export {
  TerritorialUpkeepEngine,
  calculateImperialUpkeep,
  calculateRgoRegionalYield,
  evaluateOccupationFatigueAndRebellion,
  calculateAdministrativeOverloadFuelMultiplier,
  type UpkeepCalculationOutput,
  type ImperialUpkeepBreakdown,
  type OccupationFatigueEvaluation,
} from './core/upkeepEngine';
export {
  calculateUnitProductionDuration,
  calculateUnitProductionCost,
  createProductionQueueItem,
  isProductionItemReady,
  evaluateStrategicNodes,
  authorizeFactionUnitBorrow,
  calculateSymbioticExtractionSettlement,
  canUnlockDroneTier,
  settleResourceTriadExtraction,
  BASE_PRODUCTION_DURATIONS,
  MUNICIPAL_BUILDINGS_CATALOG,
  MAX_MUNICIPAL_PUBLIC_SLOTS,
  type StrategicNode,
  type UnitProductionItem,
  type FactionHangarStock,
  type SymbioticExtractionInput,
  type SymbioticExtractionSettlement,
} from './core/strategicAndProductionEngine';

// Canonical Economy & P2P Constants Re-export
export const P2P_MARKET_TAX_TOTAL = 0.02;
export const P2P_MARKET_TAX_BURN = 0.01;
export const P2P_MARKET_TAX_CLAN_ROYALTY = 0.01;
export const P2P_VWAP_COLLAR_BAND = 0.25;
export const SALVAGE_TECH_SCRAP_RATE = 0.35;
export const MAX_PHYSICAL_HANGAR_CAPACITY = 16;

// Services
export {
  fiefBuildingService,
  FiefBuildingService,
  type FiefBuilding,
  type FiefBuildingType,
  type PrivateExtractorHarvestResult,
  applyTacticalMarkEffects,
  calculateGeodesicDistanceKm,
} from './services/fiefBuildingService';

// Hooks
export {
  useUserHangar,
} from './hooks/useUserHangar';
export {
  useUserIndustry,
} from './hooks/useUserIndustry';
export {
  useTerritoryEconomyTicker,
  type TerritoryEconomyTickerState,
  type UseTerritoryEconomyTickerProps,
} from './hooks/useTerritoryEconomyTicker';

// Components
export { IndustrialComplexView } from './components/IndustrialComplexView';
export { P2PMarketplaceView } from './components/P2PMarketplaceView';
export { UnitHangarModal } from './components/UnitHangarModal';
export { LoadoutCustomizer } from './components/LoadoutCustomizer';
export { ShopCatalog } from './components/ShopCatalog';
export { TacticalConstructionDrawer } from './components/TacticalConstructionDrawer';
