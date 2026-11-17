/**
 * ==============================================================================
 * MOTOR DE GUARNICIONES IA ESCALABLES (GARRISON AI ENGINE)
 * ==============================================================================
 * Especificación Canónica: docs/05_MASTER_GAME_ENGINE_AND_NETWORKING.md & docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §5
 * Mapeo de inversión a niveles cognitivos del orquestador autónomo y balanceo.
 * ==============================================================================
 */

import {
  GarrisonAIEngineTier,
  OSM_HEX_TERRAIN_CATALOG,
  type DroneGambitProgram,
  type DroneUnitRole,
  type DroneArchetypeId,
  type GambitConditionCode,
  type GambitActionCode,
  type GambitSlotRule,
  type DoctrinePresetId,
  type DoctrineCodePayload,
  type OsmHexTerrainType,
} from '@shared';
import { CanonicalCombatEngine } from './canonicalCombat';
import { CANONICAL_H3_DRONE_CATALOG } from './operationalUnitsEngine';
import type { TacticalUnit, TerrainTile } from '../types';

export interface GarrisonLevelSpec {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  aiEngineTier: GarrisonAIEngineTier;
  searchEngine: string;
  maxSearchPlies: number;
  maxStateBudget: number;
  maxOperableTier: number;
  activationCostEc: number;
  baseHourlyUpkeepEc: number;
  baseSupplyPoolChassis: number;
  difficultyMultiplier: number;
  allowsHiredGeneral: boolean;
  canTriggerSCOP: boolean;
}

export interface GarrisonInvestmentRebalance {
  currentLevel: 1 | 2 | 3 | 4 | 5;
  targetLevel: 1 | 2 | 3 | 4 | 5;
  upgradeCostEc: number;
  hourlyUpkeepEcDelta: number;
  supplyPoolCapacityDelta: number;
  isValid: boolean;
  error?: string;
}

export class GarrisonAIEngine {
  /**
   * Catálogo canónico de especificaciones técnicas por nivel de guarnición (1 a 5).
   */
  public static readonly GARRISON_TIER_SPECS: Record<1 | 2 | 3 | 4 | 5, GarrisonLevelSpec> = {
    1: {
      level: 1,
      name: 'Milicia Local',
      aiEngineTier: 'easy',
      searchEngine: '1-ply Greedy Heuristic',
      maxSearchPlies: 1,
      maxStateBudget: 250,
      maxOperableTier: 2,
      activationCostEc: 0,
      baseHourlyUpkeepEc: 0,
      baseSupplyPoolChassis: 12,
      difficultyMultiplier: 1.0,
      allowsHiredGeneral: false,
      canTriggerSCOP: false,
    },
    2: {
      level: 2,
      name: 'División Regular',
      aiEngineTier: 'normal',
      searchEngine: '2-ply Positional Minimax',
      maxSearchPlies: 2,
      maxStateBudget: 2500,
      maxOperableTier: 3,
      activationCostEc: 4500,
      baseHourlyUpkeepEc: 180,
      baseSupplyPoolChassis: 24,
      difficultyMultiplier: 1.25,
      allowsHiredGeneral: true,
      canTriggerSCOP: false,
    },
    3: {
      level: 3,
      name: 'Guardia Acorazada Veterana',
      aiEngineTier: 'hard',
      searchEngine: '3-ply Task-Force Tree',
      maxSearchPlies: 3,
      maxStateBudget: 18000,
      maxOperableTier: 4,
      activationCostEc: 18000,
      baseHourlyUpkeepEc: 750,
      baseSupplyPoolChassis: 40,
      difficultyMultiplier: 1.6,
      allowsHiredGeneral: true,
      canTriggerSCOP: true, // Habilita COP
    },
    4: {
      level: 4,
      name: 'Cuerpo de Estado Mayor',
      aiEngineTier: 'chess',
      searchEngine: 'Alpha-Beta (4-5 ply) + Killer Heuristic',
      maxSearchPlies: 5,
      maxStateBudget: 120000,
      maxOperableTier: 4,
      activationCostEc: 65000,
      baseHourlyUpkeepEc: 2800,
      baseSupplyPoolChassis: 60,
      difficultyMultiplier: 2.1,
      allowsHiredGeneral: true,
      canTriggerSCOP: true, // Sincroniza COP y SCOP
    },
    5: {
      level: 5,
      name: 'Gran Mariscal ("Búnker Implacable")',
      aiEngineTier: 'mcts_legendary',
      searchEngine: 'Híbrido Alpha-Beta + MCTS-UCT + Heatmaps',
      maxSearchPlies: 6,
      maxStateBudget: 450000,
      maxOperableTier: 5,
      activationCostEc: 220000,
      baseHourlyUpkeepEc: 9500,
      baseSupplyPoolChassis: 85,
      difficultyMultiplier: 3.0,
      allowsHiredGeneral: true,
      canTriggerSCOP: true, // Sinergia letal con CO Zone
    },
  };

  /**
   * Obtiene la especificación completa para un nivel dado.
   */
  public static getSpec(level: 1 | 2 | 3 | 4 | 5): GarrisonLevelSpec {
    return this.GARRISON_TIER_SPECS[level];
  }

  /**
   * Calcula el coste y delta de balance al reajustar/mejorar una guarnición ("Modo Balanceador").
   */
  public static calculateRebalance(
    currentLevel: 1 | 2 | 3 | 4 | 5,
    targetLevel: 1 | 2 | 3 | 4 | 5,
    availableCreditsEc: number
  ): GarrisonInvestmentRebalance {
    if (targetLevel === currentLevel) {
      return {
        currentLevel,
        targetLevel,
        upgradeCostEc: 0,
        hourlyUpkeepEcDelta: 0,
        supplyPoolCapacityDelta: 0,
        isValid: true,
      };
    }

    if (targetLevel < currentLevel) {
      // Reclasificación a la baja (degradación)
      const currentSpec = this.GARRISON_TIER_SPECS[currentLevel];
      const targetSpec = this.GARRISON_TIER_SPECS[targetLevel];
      return {
        currentLevel,
        targetLevel,
        upgradeCostEc: 0,
        hourlyUpkeepEcDelta: targetSpec.baseHourlyUpkeepEc - currentSpec.baseHourlyUpkeepEc,
        supplyPoolCapacityDelta: targetSpec.baseSupplyPoolChassis - currentSpec.baseSupplyPoolChassis,
        isValid: true,
      };
    }

    // Mejora a un nivel superior
    const currentSpec = this.GARRISON_TIER_SPECS[currentLevel];
    const targetSpec = this.GARRISON_TIER_SPECS[targetLevel];
    const cost = targetSpec.activationCostEc - currentSpec.activationCostEc;

    if (availableCreditsEc < cost) {
      return {
        currentLevel,
        targetLevel,
        upgradeCostEc: cost,
        hourlyUpkeepEcDelta: targetSpec.baseHourlyUpkeepEc - currentSpec.baseHourlyUpkeepEc,
        supplyPoolCapacityDelta: targetSpec.baseSupplyPoolChassis - currentSpec.baseSupplyPoolChassis,
        isValid: false,
        error: `Créditos insuficientes: Se requieren ${cost.toLocaleString()} EC (Disponibles: ${availableCreditsEc.toLocaleString()} EC).`,
      };
    }

    return {
      currentLevel,
      targetLevel,
      upgradeCostEc: cost,
      hourlyUpkeepEcDelta: targetSpec.baseHourlyUpkeepEc - currentSpec.baseHourlyUpkeepEc,
      supplyPoolCapacityDelta: targetSpec.baseSupplyPoolChassis - currentSpec.baseSupplyPoolChassis,
      isValid: true,
    };
  }

  /**
   * Evalúa si una guarnición sufre degradación por agotamiento de chasis.
   */
  public static checkAttritionDowngrade(
    currentLevel: 1 | 2 | 3 | 4 | 5,
    remainingChassisCount: number
  ): {
    needsDowngrade: boolean;
    effectiveLevel: 1 | 2 | 3 | 4 | 5;
    reason?: string;
  } {
    if (remainingChassisCount <= 0 && currentLevel > 1) {
      return {
        needsDowngrade: true,
        effectiveLevel: 1,
        reason: 'Agotamiento total de la reserva de chasis (Supply Pool = 0). Degrada a Milicia Nivel 1.',
      };
    }

    const minChassisThreshold = Math.floor(this.GARRISON_TIER_SPECS[currentLevel].baseSupplyPoolChassis * 0.25);
    if (remainingChassisCount < minChassisThreshold && currentLevel > 2) {
      const downgraded = (currentLevel - 1) as 1 | 2 | 3 | 4 | 5;
      return {
        needsDowngrade: true,
        effectiveLevel: downgraded,
        reason: `Reserva crítica de chasis (<25%). Capacidad reducida a Nivel ${downgraded}.`,
      };
    }

    return {
      needsDowngrade: false,
      effectiveLevel: currentLevel,
    };
  }
}

// ==============================================================================
// MOTOR DE ÓRDENES AUTÓNOMAS (GAMBIT ENGINE OFFLINE 8H) PARA DRONES PERSISTENTES
// ==============================================================================

export interface GambitDetectedContact {
  unitId: string;
  clanId: string;
  unitRole: DroneUnitRole;
  unitCode: string;
  hp: number;
  distanceCells: number;
  defenseStars?: number;
}

export interface GambitEvaluationContext {
  unitHp: number;
  unitCode: string;
  unitClanId: string;
  currentCoordinates: [number, number];
  targetMunicipalityEnemyControlRatio: number;
  detectedEnemyContacts: GambitDetectedContact[];
  detectedEnemyInfrastructure?: {
    buildingId: string;
    buildingType: 'factory' | 'extractor' | 'radar_tower' | 'sam_battery';
    distanceCells: number;
  } | null;
}

export interface GambitTickDecision {
  decision:
    | 'patrol_waypoint_a'
    | 'patrol_waypoint_b'
    | 'attack_direct'
    | 'attack_indirect'
    | 'sabotage_infrastructure'
    | 'retreat_to_factory'
    | 'abort_high_enemy_control';
  targetCoordinates: [number, number];
  targetUnitId?: string;
  combatOutcome?: {
    attackerHpAfter: number;
    defenderHpAfter: number;
    counterAttackOccurred: boolean;
  };
  reason: string;
}

function buildSyntheticTacticalUnit(params: {
  id: string;
  code: string;
  ownerId: string;
  x: number;
  y: number;
  hp: number;
  isIndirect: boolean;
}): TacticalUnit {
  return {
    id: params.id,
    unitCode: params.code,
    displayName: params.code.toUpperCase(),
    ownerId: params.ownerId,
    x: params.x,
    y: params.y,
    hp: Math.max(1, Math.min(100, Math.round(params.hp))),
    maxHp: 100,
    ammo: 9,
    fuel: 99,
    movementPoints: 6,
    movementType: params.isIndirect ? 'treads' : 'wheels',
    minRange: params.isIndirect ? 2 : 1,
    maxRange: params.isIndirect ? 3 : 1,
    visionRange: 3,
    baseAttack: 65,
    productionCost: 4000,
    hasMoved: false,
    hasActed: false,
    skinId: 'default',
    tier: 1,
  };
}

/**
 * Evalúa un tick determinista del Árbol de Órdenes (Gambits tipo FFXII / Screeps)
 * para drones autónomos que operan 24/7 en la malla municipal y red vial.
 */
export function evaluateDroneGambitTick(
  gambit: DroneGambitProgram,
  ctx: GambitEvaluationContext
): GambitTickDecision {
  // 1. Regla de filtrado territorial: abortar incursión en municipios con >70% de control enemigo
  if (ctx.targetMunicipalityEnemyControlRatio > gambit.maxEnemyControlThreshold) {
    return {
      decision: 'abort_high_enemy_control',
      targetCoordinates: gambit.retreatCondition.fallbackFactoryCoordinates,
      reason: `Control enemigo (${Math.round(ctx.targetMunicipalityEnemyControlRatio * 100)}%) excede el umbral seguro (${Math.round(gambit.maxEnemyControlThreshold * 100)}%). Replegando.`,
    };
  }

  // 2. Evaluación de retirada prioritaria por detección de amenaza superior o HP bajo
  const threatContact = ctx.detectedEnemyContacts.find((c) =>
    gambit.retreatCondition.onDetectRole.includes(c.unitRole)
  );
  if (threatContact || ctx.unitHp <= gambit.retreatCondition.hpBelowThreshold) {
    return {
      decision: 'retreat_to_factory',
      targetCoordinates: gambit.retreatCondition.fallbackFactoryCoordinates,
      targetUnitId: threatContact?.unitId,
      reason: threatContact
        ? `Amenaza detectada (${threatContact.unitRole}): retrocediendo a fábrica aliada más cercana.`
        : `Integridad crítica (${ctx.unitHp} HP): retrocediendo a fábrica aliada para reparación.`,
    };
  }

  // 3. Evaluación de reglas de enfrentamiento (1-100 HP)
  for (const rule of gambit.engagementRules) {
    if (rule.action === 'retreat_to_allied_factory') {
      const dangerous = ctx.detectedEnemyContacts.find(
        (c) => rule.detectTargetRole === 'any_hostile' || c.unitRole === rule.detectTargetRole
      );
      if (dangerous) {
        return {
          decision: 'retreat_to_factory',
          targetCoordinates: gambit.retreatCondition.fallbackFactoryCoordinates,
          targetUnitId: dangerous.unitId,
          reason: `Regla de Gambit: contacto ${dangerous.unitRole} activa retirada a fábrica aliada.`,
        };
      }
    }

    if (
      rule.action === 'sabotage_capture' &&
      rule.detectTargetRole === 'enemy_infrastructure' &&
      gambit.unitRole === 'infantry_engineer' &&
      ctx.detectedEnemyInfrastructure
    ) {
      return {
        decision: 'sabotage_infrastructure',
        targetCoordinates: ctx.currentCoordinates,
        reason: `Ingeniero ejecuta sabotaje/captura sobre ${ctx.detectedEnemyInfrastructure.buildingType} (${ctx.detectedEnemyInfrastructure.buildingId}).`,
      };
    }

    if (rule.action === 'attack_direct' || rule.action === 'attack_indirect') {
      const target = ctx.detectedEnemyContacts.find(
        (c) => rule.detectTargetRole === 'any_hostile' || c.unitRole === rule.detectTargetRole
      );
      if (target) {
        const isIndirect = rule.action === 'attack_indirect' || gambit.unitRole === 'artillery_indirect';
        const dist = isIndirect ? Math.max(2, target.distanceCells) : 1;
        const attackerUnit = buildSyntheticTacticalUnit({
          id: gambit.unitId,
          code: ctx.unitCode,
          ownerId: ctx.unitClanId,
          x: 0,
          y: 0,
          hp: ctx.unitHp,
          isIndirect,
        });
        const defenderUnit = buildSyntheticTacticalUnit({
          id: target.unitId,
          code: target.unitCode,
          ownerId: target.clanId,
          x: dist,
          y: 0,
          hp: target.hp,
          isIndirect: target.unitRole === 'artillery_indirect',
        });
        const tileA: TerrainTile = { x: 0, y: 0, type: 'plains', defenseStars: 1 };
        const tileB: TerrainTile = { x: dist, y: 0, type: 'plains', defenseStars: target.defenseStars ?? 1 };

        const combat = CanonicalCombatEngine.calculateEngagement(attackerUnit, defenderUnit, tileA, tileB, {
          deterministic: true,
          scale100Hp: true,
        });
        // Fuego indirecto a d >= 2 no recibe contraataque
        const counterOccurred = dist === 1 ? combat.canCounterAttack : false;
        const attackerHpAfter = dist === 1 ? combat.attackerHpAfter : ctx.unitHp;

        return {
          decision: isIndirect ? 'attack_indirect' : 'attack_direct',
          targetCoordinates: ctx.currentCoordinates,
          targetUnitId: target.unitId,
          combatOutcome: {
            attackerHpAfter,
            defenderHpAfter: combat.defenderHpAfter,
            counterAttackOccurred: counterOccurred,
          },
          reason: isIndirect
            ? `Fuego indirecto (d=${dist}, sin contraataque) contra ${target.unitRole}: ${combat.defenderHpBefore} -> ${combat.defenderHpAfter} HP.`
            : `Intercepción directa (d=1) contra ${target.unitRole}: objetivo ${combat.defenderHpBefore} -> ${combat.defenderHpAfter} HP.`,
        };
      }
    }
  }

  // 4. Patrulla A <-> B
  const [wpA, wpB] = gambit.patrolWaypoints;
  const distToA = Math.hypot(ctx.currentCoordinates[0] - wpA[0], ctx.currentCoordinates[1] - wpA[1]);
  const distToB = Math.hypot(ctx.currentCoordinates[0] - wpB[0], ctx.currentCoordinates[1] - wpB[1]);
  const nextIsB = distToA <= distToB;

  return {
    decision: nextIsB ? 'patrol_waypoint_b' : 'patrol_waypoint_a',
    targetCoordinates: nextIsB ? wpB : wpA,
    reason: `Patrulla autónoma (${gambit.targetPriorityRule}) hacia Waypoint ${nextIsB ? 'B' : 'A'}.`,
  };
}

// ==============================================================================
// CARTUCHOS GAMBITS (4-6 RANURAS), 3 PRESETS, CÓDIGO DE DOCTRINA Y DRY-RUN
// ==============================================================================

export const CANONICAL_GAMBIT_PRESETS: Record<DoctrinePresetId, DoctrineCodePayload> = {
  NIGHT_PAINTER: {
    name: 'Pintor Nocturno',
    version: 1,
    recommendedUnit: 'recon_explorer',
    maxSlots: 4,
    rules: [
      { slot: 1, condition: 'SUPERIOR_ENEMY_IN_RANGE', action: 'FLEE_OPPOSITE_TO_FOREST_OR_MOUNTAIN' },
      { slot: 2, condition: 'FUEL_LT_20', action: 'RETREAT_TO_NEAREST_APC_OR_REPAIR' },
      { slot: 3, condition: 'HEX_NEUTRAL', action: 'CAPTURE_HEX_UNTIL_DONE' },
      { slot: 4, condition: 'ALWAYS', action: 'FOLLOW_WAYPOINTS_LOOP' },
    ],
  },
  WATCHDOG: {
    name: 'Perro Guardián',
    version: 1,
    recommendedUnit: 'medium_tank',
    maxSlots: 4,
    rules: [
      { slot: 1, condition: 'HP_LT_30', action: 'RETREAT_TO_NEAREST_APC_OR_REPAIR' },
      { slot: 2, condition: 'ENEMY_NEAR_ALLY_FACTORY_2', action: 'INTERCEPT_AND_ATTACK' },
      { slot: 3, condition: 'WEAK_ENEMY_IN_RANGE', action: 'ATTACK_WEAKEST' },
      { slot: 4, condition: 'ALWAYS', action: 'PATROL_PING_PONG' },
    ],
  },
  SABOTEUR: {
    name: 'Saboteador',
    version: 1,
    recommendedUnit: 'infantry_swarm',
    maxSlots: 4,
    rules: [
      { slot: 1, condition: 'ENEMY_IN_RANGE', action: 'IGNORE_COMBAT_STEALTH' },
      { slot: 2, condition: 'HEX_HAS_ENEMY_FACTORY', action: 'SABOTAGE_OR_CAPTURE_BUILDING' },
      { slot: 3, condition: 'MUNICIPALITY_ENEMY_OVER_70', action: 'RETURN_TO_ALLY_FACTORY' },
      { slot: 4, condition: 'ALWAYS', action: 'FOLLOW_WAYPOINTS_LOOP' },
    ],
  },
};

export function serializeDoctrineCode(payload: DoctrineCodePayload): string {
  const json = JSON.stringify(payload);
  const encoded = globalThis.btoa(unescape(encodeURIComponent(json)));
  return `DP-DOC-${encoded}`;
}

export function deserializeDoctrineCode(codeString: string): DoctrineCodePayload {
  const trimmed = codeString.trim();
  if (!trimmed.startsWith('DP-DOC-')) {
    throw new Error('Código de Doctrina inválido: debe iniciar con prefijo DP-DOC-.');
  }
  const b64 = trimmed.slice('DP-DOC-'.length);
  const json = decodeURIComponent(escape(globalThis.atob(b64)));
  const parsed = JSON.parse(json) as DoctrineCodePayload;
  if (!parsed || !Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    throw new Error('Código de Doctrina inválido: pila de reglas vacía.');
  }
  const maxSlots = parsed.maxSlots === 6 ? 6 : 4;
  return {
    ...parsed,
    maxSlots,
    rules: parsed.rules.slice(0, maxSlots),
  };
}

export interface CartridgeSensorContext {
  hpPercent: number;
  fuelPercent: number;
  enemyInRange: boolean;
  weakEnemyInRange: boolean;
  superiorEnemyInRange: boolean;
  enemyNearAllyFactory2: boolean;
  hexState: 'NEUTRAL' | 'ENEMY' | 'ALLIED';
  hexHasEnemyFactory: boolean;
  municipalityEnemyControlPercent: number;
  maxAllowedSlots?: 4 | 6;
}

export function evaluateCartridgeGambitRules(
  rules: GambitSlotRule[],
  ctx: CartridgeSensorContext
): {
  matchedSlot: number;
  condition: GambitConditionCode;
  action: GambitActionCode;
} {
  const maxSlots = ctx.maxAllowedSlots ?? 6;
  const activeRules = [...rules]
    .sort((a, b) => a.slot - b.slot)
    .slice(0, maxSlots);

  for (const rule of activeRules) {
    let matches = false;
    switch (rule.condition) {
      case 'HP_LT_40':
        matches = ctx.hpPercent < 40;
        break;
      case 'HP_LT_30':
        matches = ctx.hpPercent < 30;
        break;
      case 'FUEL_LT_20':
        matches = ctx.fuelPercent < 20;
        break;
      case 'ENEMY_IN_RANGE':
        matches = ctx.enemyInRange;
        break;
      case 'WEAK_ENEMY_IN_RANGE':
        matches = ctx.weakEnemyInRange;
        break;
      case 'SUPERIOR_ENEMY_IN_RANGE':
        matches = ctx.superiorEnemyInRange;
        break;
      case 'ENEMY_NEAR_ALLY_FACTORY_2':
        matches = ctx.enemyNearAllyFactory2;
        break;
      case 'HEX_NEUTRAL':
        matches = ctx.hexState === 'NEUTRAL';
        break;
      case 'HEX_ENEMY':
        matches = ctx.hexState === 'ENEMY';
        break;
      case 'HEX_HAS_ENEMY_FACTORY':
        matches = ctx.hexHasEnemyFactory;
        break;
      case 'MUNICIPALITY_ENEMY_OVER_50':
        matches = ctx.municipalityEnemyControlPercent > 50;
        break;
      case 'MUNICIPALITY_ENEMY_OVER_70':
        matches = ctx.municipalityEnemyControlPercent > 70;
        break;
      case 'ALWAYS':
        matches = true;
        break;
    }

    if (matches) {
      return {
        matchedSlot: rule.slot,
        condition: rule.condition,
        action: rule.action,
      };
    }
  }

  return {
    matchedSlot: 0,
    condition: 'ALWAYS',
    action: 'FOLLOW_WAYPOINTS_LOOP',
  };
}

export interface DryRunCheckpoint {
  hours: 4 | 8 | 12;
  tick: number;
  h3Index: string;
  remainingFuel: number;
  remainingHp10: number;
  capturedHexesCount: number;
  alertReason: string | null;
}

export interface DryRunSimulationResult {
  unitType: DroneArchetypeId;
  checkpoints: DryRunCheckpoint[];
  blockedAlert: string | null;
  exhaustedFuelAtTick: number | null;
}

const LOCAL_H3_BIAS = 8_388_608n;
const LOCAL_H3_MASK = 0xFFFFFFn;
const LOCAL_H3_RES9_PREFIX = 0x0890000000000000n;

function localStepH3Toward(currentH3: bigint, targetH3: bigint): bigint {
  if (currentH3 === targetH3) return currentH3;
  const cq = Number(((currentH3 >> 24n) & LOCAL_H3_MASK) - LOCAL_H3_BIAS);
  const cr = Number((currentH3 & LOCAL_H3_MASK) - LOCAL_H3_BIAS);
  const tq = Number(((targetH3 >> 24n) & LOCAL_H3_MASK) - LOCAL_H3_BIAS);
  const tr = Number((targetH3 & LOCAL_H3_MASK) - LOCAL_H3_BIAS);
  const stepQ = cq + Math.sign(tq - cq);
  const stepR = cr + Math.sign(tr - cr);
  return (
    LOCAL_H3_RES9_PREFIX |
    (((BigInt(stepQ) + LOCAL_H3_BIAS) & LOCAL_H3_MASK) << 24n) |
    ((BigInt(stepR) + LOCAL_H3_BIAS) & LOCAL_H3_MASK)
  );
}

/**
 * Simulador Dry-Run ("Qué pasaría si...") a 4h (16 ticks), 8h (32 ticks) y 12h (48 ticks)
 * sin resistencia enemiga, detectando ríos sin puente y agotamiento de combustible.
 */
export function simulateDroneDryRun(params: {
  unitType: DroneArchetypeId;
  startH3: bigint;
  waypoints: bigint[];
  initialFuel: number;
  rules: GambitSlotRule[];
  terrainByH3?: Map<string, { terrain: OsmHexTerrainType; hasBridge?: boolean }>;
  fuelMultiplier?: number;
}): DryRunSimulationResult {
  const spec = CANONICAL_H3_DRONE_CATALOG[params.unitType];
  const fuelMult = Math.max(0.1, params.fuelMultiplier ?? 1.0);
  const wpList = params.waypoints.length > 0 ? params.waypoints : [params.startH3];

  let currentH3 = params.startH3;
  let wpIdx = 0;
  let fuel = Math.max(0, params.initialFuel);
  let hp10 = 10.0;
  let capturedHexesCount = 0;
  let blockedAlert: string | null = null;
  let exhaustedFuelAtTick: number | null = null;
  const visitedSet = new Set<string>();
  const checkpoints: DryRunCheckpoint[] = [];

  for (let tick = 1; tick <= 48; tick++) {
    const fuelBurn = spec.fuelPerTick15m * fuelMult;
    fuel = Math.max(0, Number((fuel - fuelBurn).toFixed(2)));
    if (fuel <= 0) {
      if (exhaustedFuelAtTick === null) exhaustedFuelAtTick = tick;
      hp10 = Math.max(0, Number((hp10 - 0.5).toFixed(2))); // -2 HP/h = -0.5 HP/tick
      blockedAlert = blockedAlert ?? `Combustible agotado en tick ${tick} (${(tick / 4).toFixed(2)}h): colapso mecánico activo.`;
    } else if (hp10 > 0 && !blockedAlert) {
      const targetWp = wpList[wpIdx]!;
      const nextH3 = localStepH3Toward(currentH3, targetWp);
      const terrainInfo = params.terrainByH3?.get(nextH3.toString());
      if (terrainInfo) {
        const mod = OSM_HEX_TERRAIN_CATALOG[terrainInfo.terrain];
        if (!spec.isAirUnit && mod.requiresBridgeForGround && !terrainInfo.hasBridge) {
          blockedAlert = `Ruta bloqueada en tick ${tick}: río sin puente (WATER) en H3 ${nextH3.toString()}.`;
        } else if (
          !spec.isAirUnit &&
          mod.impassableForWheeledTracked &&
          params.unitType !== 'infantry_swarm'
        ) {
          blockedAlert = `Terreno montaña impasable para ${spec.name} en H3 ${nextH3.toString()}.`;
        } else {
          currentH3 = nextH3;
        }
      } else {
        currentH3 = nextH3;
      }

      if (currentH3 === targetWp && wpList.length > 1) {
        wpIdx = (wpIdx + 1) % wpList.length;
      }

      if (spec.conquestHexesPerHour > 0) {
        const key = currentH3.toString();
        if (!visitedSet.has(key)) {
          visitedSet.add(key);
          capturedHexesCount += 1;
        }
      }
    }

    if (tick === 16 || tick === 32 || tick === 48) {
      checkpoints.push({
        hours: (tick / 4) as 4 | 8 | 12,
        tick,
        h3Index: currentH3.toString(),
        remainingFuel: fuel,
        remainingHp10: hp10,
        capturedHexesCount,
        alertReason: blockedAlert,
      });
    }
  }

  return {
    unitType: params.unitType,
    checkpoints,
    blockedAlert,
    exhaustedFuelAtTick,
  };
}