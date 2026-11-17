/**
 * ==============================================================================
 * MOTOR DE NODOS ESTRATÉGICOS, HANGAR DE FACCIÓN Y COLA DE PRODUCCIÓN
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md
 * Plan Maestro: docs/PLAN_IMPLEMENTACION_FEUDOS_CADENA_INDUSTRIAL.md
 * Migración: supabase/migrations/20261105000001_geotactics_strategic_nodes_and_queues.sql
 * ==============================================================================
 */

import {
  MASTER_METAGAME_CONSTANTS,
  type ExclusiveResourceNodeType,
  type TerritorialTaxLedger,
  type ResourceTriad,
  type DroneArchetypeId,
  type MunicipalBuildingType,
  type MunicipalBuildingSpec,
} from '@shared';

export interface StrategicNode {
  id: string;
  regionId: string;
  nodeType: 'capital_hq' | 'refinery_hub' | 'strait_canal' | 'radar_c4isr' | 'missile_silo';
  name: string;
  buffType: 'hegemonic_capital' | 'energy_extraction' | 'toll_chokepoint' | 'radar_recon' | 'area_denial';
  buffValue: number;
  controllingClanId?: string | null;
}

export interface UnitProductionItem {
  id: string;
  userId: string;
  clanId?: string | null;
  destination: 'user' | 'faction';
  unitCode: string;
  tier: 1 | 2 | 3 | 4 | 5;
  durationSeconds: number;
  startedAt: string;
  readyAt: string;
  isClaimed: boolean;
}

export interface FactionHangarStock {
  clanId: string;
  unitCode: string;
  tier: 1 | 2 | 3 | 4 | 5;
  stockQuantity: number;
}

export interface ProductionCost {
  fundsG: number;
  energyCreditEc: number;
  steelPlates: number;
  microchips: number;
}

// ============================================================================
// 1. CÁLCULO DETERMINISTA DE TIEMPOS DE FORJA FÍSICA
// ============================================================================

export const BASE_PRODUCTION_DURATIONS: Record<string, number> = {
  infantry: 0,        // T1 instantánea (kit F2P ilimitado)
  recon: 0,           // T1 instantánea (kit F2P ilimitado)
  mech: 60,           // 1 minuto
  tank: 180,          // 3 minutos
  artillery: 360,     // 6 minutos
  medium_tank: 480,   // 8 minutos
  anti_air: 300,      // 5 minutos
  b_copter: 600,      // 10 minutos
  fighter: 900,       // 15 minutos
  bomber: 1200,       // 20 minutos
  battleship: 1800,   // 30 minutos
};

/**
 * Calcula la duración exacta de ensamblaje en segundos.
 * Fórmula canónica:
 * t = (t_base * tierFactor) / ((1 + workshopBonus) * (1 + capitalBonus))
 */
export function calculateUnitProductionDuration(
  unitCode: string,
  tier: 1 | 2 | 3 | 4 | 5,
  options?: {
    hasCapitalHegemony?: boolean;
    workshopBonus?: number; // e.g. 0.15 para +15% de aceleración
  }
): number {
  // Kit F2P inagotable: T1 es 0 segundos
  if ((unitCode === 'infantry' || unitCode === 'recon') && tier === 1) {
    return 0;
  }

  const baseDuration = BASE_PRODUCTION_DURATIONS[unitCode] ?? 120;
  // Multiplicador por tier: +35% por nivel sobre Tier 1
  const tierMultiplier = 1 + (tier - 1) * 0.35;
  const rawDuration = baseDuration * tierMultiplier;

  const workshopMult = 1 + Math.max(0, options?.workshopBonus ?? 0);
  const capitalMult = options?.hasCapitalHegemony ? 1.10 : 1.00; // +10% velocidad por Capital Nacional

  const finalDuration = Math.round(rawDuration / (workshopMult * capitalMult));
  return Math.max(5, finalDuration); // Mínimo 5 segundos para cualquier unidad no F2P
}

/**
 * Calcula los costos de manufactura según la jerarquía de Tiers.
 */
export function calculateUnitProductionCost(
  unitCode: string,
  tier: 1 | 2 | 3 | 4 | 5
): ProductionCost {
  const isBasicF2p = (unitCode === 'infantry' || unitCode === 'recon') && tier === 1;

  if (isBasicF2p) {
    return {
      fundsG: unitCode === 'infantry' ? 1000 : 4000,
      energyCreditEc: 0,
      steelPlates: 0,
      microchips: 0,
    };
  }

  const tierScale = Math.pow(1.25, tier - 1);
  return {
    fundsG: Math.round(2500 * tierScale),
    energyCreditEc: Math.round(150 * tierScale),
    steelPlates: Math.round(4 * tier),
    microchips: tier >= 3 ? Math.round(2 * (tier - 2)) : 0,
  };
}

// ============================================================================
// 2. GESTIÓN DE COLA DE PRODUCCIÓN
// ============================================================================

export function createProductionQueueItem(
  userId: string,
  unitCode: string,
  tier: 1 | 2 | 3 | 4 | 5,
  destination: 'user' | 'faction',
  clanId?: string | null,
  options?: {
    hasCapitalHegemony?: boolean;
    workshopBonus?: number;
    startTimeOverride?: Date;
  }
): UnitProductionItem {
  const duration = calculateUnitProductionDuration(unitCode, tier, options);
  const start = options?.startTimeOverride ?? new Date();
  const ready = new Date(start.getTime() + duration * 1000);

  return {
    id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    userId,
    clanId: destination === 'faction' ? (clanId ?? null) : null,
    destination,
    unitCode,
    tier,
    durationSeconds: duration,
    startedAt: start.toISOString(),
    readyAt: ready.toISOString(),
    isClaimed: false,
  };
}

export function isProductionItemReady(item: UnitProductionItem, currentTime?: Date): boolean {
  if (item.isClaimed) return false;
  const now = currentTime ? currentTime.getTime() : Date.now();
  const ready = new Date(item.readyAt).getTime();
  return now >= ready;
}

// ============================================================================
// 3. NODOS ESTRATÉGICOS Y BUFFS DE ZONA
// ============================================================================

export interface RegionalStrategicState {
  hasCapitalHegemony: boolean; // Control de REG_VE_01
  energyYieldMultiplier: number;
  tollFeePercent: number;
  radarSightBonus: number;
  activeMissileSilosCount: number;
}

export function evaluateStrategicNodes(
  clanId: string,
  nodes: StrategicNode[]
): RegionalStrategicState {
  let hasCapital = false;
  let energyMultiplier = 1.0;
  let maxToll = 0.0;
  let radarBonus = 0;
  let missileSilos = 0;

  for (const node of nodes) {
    if (node.controllingClanId === clanId) {
      if (node.nodeType === 'capital_hq') {
        hasCapital = true;
      }
      if (node.nodeType === 'refinery_hub') {
        energyMultiplier += (node.buffValue - 1.0);
      }
      if (node.nodeType === 'strait_canal') {
        maxToll = Math.max(maxToll, node.buffValue);
      }
      if (node.nodeType === 'radar_c4isr') {
        radarBonus += node.buffValue;
      }
      if (node.nodeType === 'missile_silo') {
        missileSilos += 1;
      }
    }
  }

  // Capital otorga adicionalmente +15% de energía nacional
  if (hasCapital) {
    energyMultiplier += 0.15;
  }

  return {
    hasCapitalHegemony: hasCapital,
    energyYieldMultiplier: Number(energyMultiplier.toFixed(2)),
    tollFeePercent: maxToll,
    radarSightBonus: radarBonus,
    activeMissileSilosCount: missileSilos,
  };
}

// ============================================================================
// 4. HANGAR COMUNITARIO DE FACCIÓN (PRÉSTAMO Y COMANDO DE UNIDADES)
// ============================================================================

export interface FactionBorrowRequest {
  clanId: string;
  userId: string;
  userRank: 'recruit' | 'corporal' | 'sergeant' | 'veteran';
  unitCode: string;
  tier: 1 | 2 | 3 | 4 | 5;
}

export interface FactionBorrowResult {
  approved: boolean;
  reason?: string;
  unitCode?: string;
  tier?: 1 | 2 | 3 | 4 | 5;
  remainingStock?: number;
}

/**
 * Valida si un oficial puede tomar prestada una unidad del arsenal del clan.
 * Regla de doctrina: Rango mínimo Sargento para unidades blindadas/pesadas de facción.
 */
export function authorizeFactionUnitBorrow(
  request: FactionBorrowRequest,
  hangarStock: FactionHangarStock[]
): FactionBorrowResult {
  // Verificación de jerarquía de rango
  if (request.userRank === 'recruit') {
    return {
      approved: false,
      reason: 'Rango insuficiente. Los Reclutas no tienen acceso al Hangar Comunitario.',
    };
  }

  if (request.userRank === 'corporal' && request.tier >= 3) {
    return {
      approved: false,
      reason: 'Los Cabos solo pueden solicitar unidades de Facción hasta Tier 2.',
    };
  }

  const stockEntry = hangarStock.find(
    (item) =>
      item.clanId === request.clanId &&
      item.unitCode === request.unitCode &&
      item.tier === request.tier
  );

  if (!stockEntry || stockEntry.stockQuantity <= 0) {
    return {
      approved: false,
      reason: `No hay existencias disponibles de ${request.unitCode} (Tier ${request.tier}) en el Hangar del Clan.`,
    };
  }

  return {
    approved: true,
    unitCode: request.unitCode,
    tier: request.tier,
    remainingStock: stockEntry.stockQuantity - 1,
  };
}

// ============================================================================
// 5. ECONOMÍA SIMBIÓTICA: RETENCIÓN FISCAL TERRITORIAL (5-10% ALIADO VS 50% RIVAL)
// ============================================================================

export interface SymbioticExtractionInput {
  municipalityId: string;
  extractorOwnerClanId: string;
  municipalityControllingClanId: string | null;
  grossYieldEc: number;
  exclusiveResourceNode: ExclusiveResourceNodeType;
  ledger?: Partial<TerritorialTaxLedger>;
}

export interface SymbioticExtractionSettlement {
  municipalityId: string;
  extractorOwnerClanId: string;
  municipalityControllingClanId: string | null;
  exclusiveResourceNode: ExclusiveResourceNodeType;
  grossYieldEc: number;
  appliedTaxRate: number;
  appliedTaxRatePercent: number;
  retainedTaxEc: number;
  netExtractorYieldEc: number;
  controllingClanVaultDeltaEc: number;
  isRivalTerritory: boolean;
  receivesAlliedPatrolEscort: boolean;
  hasTreatyExemption: boolean;
}

/**
 * Liquida la extracción de fábricas y extractores privados sobre micro-celdas
 * aplicando la regla simbiótica:
 * - Municipio propio/aliado o tratado comercial: retención baja (5%-10%) + escolta aliada.
 * - Municipio de Corporación rival: retención automática de hasta 50% transferida a la bóveda gobernante.
 */
export function calculateSymbioticExtractionSettlement(
  input: SymbioticExtractionInput
): SymbioticExtractionSettlement {
  const gross = Math.max(0, Math.floor(input.grossYieldEc));
  const alliedRateRaw = input.ledger?.alliedTaxRate ?? 0.08;
  const alliedRate = Math.max(
    MASTER_METAGAME_CONSTANTS.ALLIED_TAX_RATE_MIN,
    Math.min(MASTER_METAGAME_CONSTANTS.ALLIED_TAX_RATE_MAX, alliedRateRaw)
  );
  const rivalRateRaw =
    input.ledger?.rivalRetentionRate ?? MASTER_METAGAME_CONSTANTS.RIVAL_RETENTION_RATE_MAX;
  const rivalRate = Math.max(
    0.10,
    Math.min(MASTER_METAGAME_CONSTANTS.RIVAL_RETENTION_RATE_MAX, rivalRateRaw)
  );

  const treatyRate = input.ledger?.treatyOverrideRate?.[input.extractorOwnerClanId];

  let appliedTaxRate = 0;
  let isRivalTerritory = false;
  let receivesAlliedPatrolEscort = false;
  let hasTreatyExemption = false;

  if (!input.municipalityControllingClanId) {
    appliedTaxRate = 0;
    isRivalTerritory = false;
    receivesAlliedPatrolEscort = false;
  } else if (input.extractorOwnerClanId === input.municipalityControllingClanId) {
    appliedTaxRate = alliedRate;
    isRivalTerritory = false;
    receivesAlliedPatrolEscort = true;
  } else if (treatyRate !== undefined) {
    appliedTaxRate = Math.max(
      0,
      Math.min(MASTER_METAGAME_CONSTANTS.RIVAL_RETENTION_RATE_MAX, treatyRate)
    );
    isRivalTerritory = false;
    receivesAlliedPatrolEscort = true;
    hasTreatyExemption = true;
  } else {
    appliedTaxRate = rivalRate;
    isRivalTerritory = true;
    receivesAlliedPatrolEscort = false;
  }

  const retainedTaxEc = Math.floor(gross * appliedTaxRate);
  const netExtractorYieldEc = Math.max(0, gross - retainedTaxEc);

  return {
    municipalityId: input.municipalityId,
    extractorOwnerClanId: input.extractorOwnerClanId,
    municipalityControllingClanId: input.municipalityControllingClanId,
    exclusiveResourceNode: input.exclusiveResourceNode,
    grossYieldEc: gross,
    appliedTaxRate,
    appliedTaxRatePercent: Number((appliedTaxRate * 100).toFixed(1)),
    retainedTaxEc,
    netExtractorYieldEc,
    controllingClanVaultDeltaEc: input.municipalityControllingClanId ? retainedTaxEc : 0,
    isRivalTerritory,
    receivesAlliedPatrolEscort,
    hasTreatyExemption,
  };
}

// ============================================================================
// 6. CATÁLOGO DE 6 EDIFICIOS MUNICIPALES, DESBLOQUEO DE TIERS Y TRIADA AL/CB/MC
// ============================================================================

export const MAX_MUNICIPAL_PUBLIC_SLOTS = 5;

export const MUNICIPAL_BUILDINGS_CATALOG: Record<
  MunicipalBuildingType,
  MunicipalBuildingSpec
> = {
  EARLY_WARNING_RADAR: {
    type: 'EARLY_WARNING_RADAR',
    name: 'Torre de Radar de Alerta',
    cost: { alloys: 400, fuel: 100, microchips: 80 },
    radiusHexes: 15,
    description:
      'Elimina niebla de guerra, revela unidades en FOREST/MOUNTAIN y emite alerta push cuando un enemigo cruza la frontera.',
  },
  RAPID_REPAIR_WORKSHOP: {
    type: 'RAPID_REPAIR_WORKSHOP',
    name: 'Taller de Reparación Rápida',
    cost: { alloys: 600, fuel: 200, microchips: 50 },
    radiusHexes: 3,
    description:
      'Recarga 100% CB y repara +3 HP/h (+30 HP/h base 100) a drones aliados en rango.',
  },
  FIXED_AA_BATTERY: {
    type: 'FIXED_AA_BATTERY',
    name: 'Batería Antiaérea Fija',
    cost: { alloys: 500, fuel: 150, microchips: 100 },
    radiusHexes: 4,
    description:
      'Ataca automáticamente en cada tick a cualquier Dron Bombardero enemigo en su radio sin consumir CB de jugadores.',
  },
  JAMMER_CENTER: {
    type: 'JAMMER_CENTER',
    name: 'Centro de Interferencia (Jammer)',
    cost: { alloys: 450, fuel: 100, microchips: 150 },
    radiusHexes: 6,
    description:
      'Guerra electrónica: reduce -50% la velocidad de conquista enemiga en su radio y oculta fábricas privadas aliadas.',
  },
  CUSTOMS_REFINERY: {
    type: 'CUSTOMS_REFINERY',
    name: 'Aduana / Refinería Fiscal',
    cost: { alloys: 700, fuel: 250, microchips: 60 },
    radiusHexes: 'MUNICIPALITY',
    description:
      'Aumenta +20% la extracción de recursos de todas las fábricas privadas del municipio.',
  },
  COMMAND_BUNKER: {
    type: 'COMMAND_BUNKER',
    name: 'Búnker de Mando (Sede)',
    cost: { alloys: 1000, fuel: 400, microchips: 200 },
    radiusHexes: 'MUNICIPALITY',
    description:
      'Otorga +25% resistencia a la captura en todo el municipio. Si es destruido o capturado, el municipio cae al instante.',
  },
};

const DRONE_UNLOCK_TIER_MAP: Record<DroneArchetypeId, 1 | 2 | 3> = {
  infantry_swarm: 1,
  recon_explorer: 1,
  light_artillery: 1,
  medium_tank: 2,
  anti_air: 2,
  logistics_apc: 2,
  bomber_drone: 3,
  neo_tank: 3,
  tactical_missile: 3,
};

export function canUnlockDroneTier(
  unitType: DroneArchetypeId,
  state: {
    hasBasicFactory: boolean;
    corpControlledMunicipalities: number;
    hasAdvancedWorkshop: boolean;
    stateControlRatio: number;
    hasIndustrialComplex: boolean;
  }
): { allowed: boolean; tierLevel: 1 | 2 | 3; reason?: string } {
  const tierLevel = DRONE_UNLOCK_TIER_MAP[unitType];
  if (tierLevel === 1) {
    return state.hasBasicFactory
      ? { allowed: true, tierLevel }
      : { allowed: false, tierLevel, reason: 'Requiere Fábrica Básica individual.' };
  }
  if (tierLevel === 2) {
    if (state.corpControlledMunicipalities < 1 || !state.hasAdvancedWorkshop) {
      return {
        allowed: false,
        tierLevel,
        reason: 'Nivel 2 requiere Corporación con >= 1 municipio y Taller Avanzado.',
      };
    }
    return { allowed: true, tierLevel };
  }
  if (state.stateControlRatio <= 0.60 || !state.hasIndustrialComplex) {
    return {
      allowed: false,
      tierLevel,
      reason: 'Nivel 3 requiere Control Estatal >60% y Complejo Industrial.',
    };
  }
  return { allowed: true, tierLevel };
}

export function settleResourceTriadExtraction(params: {
  gross: ResourceTriad;
  isAlliedMunicipality: boolean;
  alliedTaxRate?: number;
  hasCorporateFreeZonePerk?: boolean;
  hasCustomsRefineryBuilding?: boolean;
}): {
  adjustedGross: ResourceTriad;
  netPlayer: ResourceTriad;
  retainedCorpVault: ResourceTriad;
  appliedTaxRate: number;
} {
  const refineryMult = params.hasCustomsRefineryBuilding ? 1.2 : 1.0;
  const adjustedGross: ResourceTriad = {
    alloys: Math.floor(Math.max(0, params.gross.alloys) * refineryMult),
    fuel: Math.floor(Math.max(0, params.gross.fuel) * refineryMult),
    microchips: Math.floor(Math.max(0, params.gross.microchips) * refineryMult),
  };

  let appliedTaxRate: number;
  if (!params.isAlliedMunicipality) {
    appliedTaxRate = MASTER_METAGAME_CONSTANTS.RIVAL_RETENTION_RATE_MAX; // 50%
  } else if (params.hasCorporateFreeZonePerk) {
    appliedTaxRate = 0.0; // Perk Zona Franca Corporativa: 0%
  } else {
    const raw = params.alliedTaxRate ?? 0.1;
    appliedTaxRate = Math.max(
      MASTER_METAGAME_CONSTANTS.ALLIED_TAX_RATE_MIN,
      Math.min(MASTER_METAGAME_CONSTANTS.ALLIED_TAX_RATE_MAX, raw)
    );
  }

  const retainedCorpVault: ResourceTriad = {
    alloys: Math.floor(adjustedGross.alloys * appliedTaxRate),
    fuel: Math.floor(adjustedGross.fuel * appliedTaxRate),
    microchips: Math.floor(adjustedGross.microchips * appliedTaxRate),
  };
  const netPlayer: ResourceTriad = {
    alloys: Math.max(0, adjustedGross.alloys - retainedCorpVault.alloys),
    fuel: Math.max(0, adjustedGross.fuel - retainedCorpVault.fuel),
    microchips: Math.max(0, adjustedGross.microchips - retainedCorpVault.microchips),
  };

  return {
    adjustedGross,
    netPlayer,
    retainedCorpVault,
    appliedTaxRate,
  };
}
