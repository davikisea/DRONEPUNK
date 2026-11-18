/**
 * MOTOR DE COMBATE TÁCTICO RTS CONTINUO (10 TICKS / SEGUNDO)
 * 
 * Basado en la especificación canónica: docs/03_TACTICAL_STRATEGY_SYSTEM_DESIGN.md
 * - Frecuencia de simulación: 10 ticks/s (delta = 100 ms).
 * - Cooldowns de recarga y movimiento continuos por tipo de chasis.
 * - Maniobra por intenciones de marcha interpoladas (UNIT_MOVE_INTENT).
 * - Balística determinista 1-100 HP reutilizando CanonicalCombatEngine.
 * - Cero spam de red: eventos de orden y resolución balística.
 */

import type { MovementType, TerrainType, WeatherCondition } from '@shared';
import { TacticalUnit, TerrainTile } from '../types';
import { CanonicalCombatEngine, CanonicalCombatOptions, CanonicalCombatResult } from './canonicalCombat';

export type ChassisType = 'foot' | 'mech' | 'wheels' | 'treads' | 'air' | 'sea';

export interface RtsUnitProfile {
  unitCode: string;
  name: string;
  chassis: ChassisType;
  baseMoveRange: number;
  minRange: number;
  maxRange: number;
  reloadCooldownMs: number;
  moveSpeedCellsPerSec: number;
  baseCost: number;
  isInfiniteStock?: boolean;
}

/**
 * Matriz canónica balanceada de los 16 Chasis Tácticos y 9 Drones Autónomos H3
 * Fuente: docs/03_TACTICAL_STRATEGY_SYSTEM_DESIGN.md - Sección 6
 */
export const CANONICAL_RTS_PROFILES: Record<string, RtsUnitProfile> = {
  infantry: {
    unitCode: 'infantry',
    name: 'Infantería Ligera',
    chassis: 'foot',
    baseMoveRange: 3,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 1000, // 1.0s
    moveSpeedCellsPerSec: 1.5,
    baseCost: 1000,
    isInfiniteStock: true,
  },
  mech: {
    unitCode: 'mech',
    name: 'Mecanizado (Bazooka)',
    chassis: 'mech',
    baseMoveRange: 2,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 2000, // 2.0s
    moveSpeedCellsPerSec: 1.2,
    baseCost: 3000,
  },
  recon: {
    unitCode: 'recon',
    name: 'Jeep Reconocimiento',
    chassis: 'wheels',
    baseMoveRange: 8,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 1200, // 1.2s
    moveSpeedCellsPerSec: 4.0,
    baseCost: 4000,
    isInfiniteStock: true,
  },
  apc: {
    unitCode: 'apc',
    name: 'Transporte Blindado (APC)',
    chassis: 'treads',
    baseMoveRange: 6,
    minRange: 0,
    maxRange: 0,
    reloadCooldownMs: 1000,
    moveSpeedCellsPerSec: 2.8,
    baseCost: 5000,
  },
  tank_light: {
    unitCode: 'tank_light',
    name: 'Tanque Ligero',
    chassis: 'treads',
    baseMoveRange: 6,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 2500, // 2.5s
    moveSpeedCellsPerSec: 2.8,
    baseCost: 7000,
  },
  tank_medium: {
    unitCode: 'tank_medium',
    name: 'Tanque Medio',
    chassis: 'treads',
    baseMoveRange: 5,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 3500, // 3.5s
    moveSpeedCellsPerSec: 2.2,
    baseCost: 12000,
  },
  md_tank: {
    unitCode: 'md_tank',
    name: 'Tanque Medio',
    chassis: 'treads',
    baseMoveRange: 5,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 3500,
    moveSpeedCellsPerSec: 2.2,
    baseCost: 12000,
  },
  neotank: {
    unitCode: 'neotank',
    name: 'Neotanque Pesado',
    chassis: 'treads',
    baseMoveRange: 6,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 4000,
    moveSpeedCellsPerSec: 2.5,
    baseCost: 22000,
  },
  artillery: {
    unitCode: 'artillery',
    name: 'Artillería Autopropulsada',
    chassis: 'treads',
    baseMoveRange: 5,
    minRange: 2,
    maxRange: 3,
    reloadCooldownMs: 5500, // 5.5s
    moveSpeedCellsPerSec: 1.8,
    baseCost: 6000,
  },
  rocket: {
    unitCode: 'rocket',
    name: 'Lanzacohetes Pesado',
    chassis: 'wheels',
    baseMoveRange: 5,
    minRange: 3,
    maxRange: 5,
    reloadCooldownMs: 7500, // 7.5s
    moveSpeedCellsPerSec: 2.0,
    baseCost: 15000,
  },
  anti_air: {
    unitCode: 'anti_air',
    name: 'Blindado Antiaéreo',
    chassis: 'treads',
    baseMoveRange: 6,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 1000, // 1.0s
    moveSpeedCellsPerSec: 3.0,
    baseCost: 8000,
  },
  missiles: {
    unitCode: 'missiles',
    name: 'Batería SAM Móvil',
    chassis: 'wheels',
    baseMoveRange: 4,
    minRange: 3,
    maxRange: 5,
    reloadCooldownMs: 6000, // 6.0s
    moveSpeedCellsPerSec: 1.6,
    baseCost: 12000,
  },
  missile: {
    unitCode: 'missile',
    name: 'Batería SAM Móvil',
    chassis: 'wheels',
    baseMoveRange: 4,
    minRange: 3,
    maxRange: 5,
    reloadCooldownMs: 6000, // 6.0s
    moveSpeedCellsPerSec: 1.6,
    baseCost: 12000,
  },
  b_copter: {
    unitCode: 'b_copter',
    name: 'Helicóptero Asalto',
    chassis: 'air',
    baseMoveRange: 6,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 1800, // 1.8s
    moveSpeedCellsPerSec: 3.5,
    baseCost: 9000,
  },
  chopper_battle: {
    unitCode: 'chopper_battle',
    name: 'Helicóptero Asalto',
    chassis: 'air',
    baseMoveRange: 6,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 1800, // 1.8s
    moveSpeedCellsPerSec: 3.5,
    baseCost: 9000,
  },
  t_copter: {
    unitCode: 't_copter',
    name: 'Helicóptero de Transporte',
    chassis: 'air',
    baseMoveRange: 6,
    minRange: 0,
    maxRange: 0,
    reloadCooldownMs: 1000,
    moveSpeedCellsPerSec: 3.5,
    baseCost: 5000,
  },
  fighter: {
    unitCode: 'fighter',
    name: 'Caza Interceptor',
    chassis: 'air',
    baseMoveRange: 9,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 2200,
    moveSpeedCellsPerSec: 4.5,
    baseCost: 20000,
  },
  bomber: {
    unitCode: 'bomber',
    name: 'Bombardero Pesado',
    chassis: 'air',
    baseMoveRange: 7,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 4500,
    moveSpeedCellsPerSec: 3.2,
    baseCost: 22000,
  },
  battleship: {
    unitCode: 'battleship',
    name: 'Acorazado Naval',
    chassis: 'sea',
    baseMoveRange: 5,
    minRange: 2,
    maxRange: 6,
    reloadCooldownMs: 7000,
    moveSpeedCellsPerSec: 1.5,
    baseCost: 28000,
  },
  infantry_swarm: {
    unitCode: 'infantry_swarm',
    name: 'Dron Infantería (Swarm)',
    chassis: 'foot',
    baseMoveRange: 3,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 1000,
    moveSpeedCellsPerSec: 1.5,
    baseCost: 1000,
    isInfiniteStock: true,
  },
  recon_explorer: {
    unitCode: 'recon_explorer',
    name: 'Recon (Explorador H3)',
    chassis: 'wheels',
    baseMoveRange: 8,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 1200,
    moveSpeedCellsPerSec: 4.0,
    baseCost: 4000,
    isInfiniteStock: true,
  },
  light_artillery: {
    unitCode: 'light_artillery',
    name: 'Artillería Ligera H3',
    chassis: 'treads',
    baseMoveRange: 5,
    minRange: 2,
    maxRange: 3,
    reloadCooldownMs: 5000,
    moveSpeedCellsPerSec: 1.8,
    baseCost: 6000,
  },
  medium_tank: {
    unitCode: 'medium_tank',
    name: 'Tanque Medio H3',
    chassis: 'treads',
    baseMoveRange: 5,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 3500,
    moveSpeedCellsPerSec: 2.2,
    baseCost: 12000,
  },
  logistics_apc: {
    unitCode: 'logistics_apc',
    name: 'Dron Logístico (APC H3)',
    chassis: 'treads',
    baseMoveRange: 6,
    minRange: 0,
    maxRange: 0,
    reloadCooldownMs: 1000,
    moveSpeedCellsPerSec: 2.8,
    baseCost: 5000,
  },
  bomber_drone: {
    unitCode: 'bomber_drone',
    name: 'Dron Bombardero H3',
    chassis: 'air',
    baseMoveRange: 7,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 4500,
    moveSpeedCellsPerSec: 3.2,
    baseCost: 22000,
  },
  neo_tank: {
    unitCode: 'neo_tank',
    name: 'Neo-Tanque (Coloso H3)',
    chassis: 'treads',
    baseMoveRange: 6,
    minRange: 1,
    maxRange: 1,
    reloadCooldownMs: 4000,
    moveSpeedCellsPerSec: 2.5,
    baseCost: 22000,
  },
  tactical_missile: {
    unitCode: 'tactical_missile',
    name: 'Lanzamisiles Táctico H3',
    chassis: 'wheels',
    baseMoveRange: 5,
    minRange: 4,
    maxRange: 5,
    reloadCooldownMs: 7500,
    moveSpeedCellsPerSec: 2.0,
    baseCost: 15000,
  },
};

export interface UnitMoveIntent {
  unitId: string;
  path: Array<{ x: number; y: number }>;
  currentWaypointIndex: number;
  stepProgressMs: number;
  msPerStep: number;
}

export type ScheduledDroneCommandType =
  | 'move'
  | 'patrol'
  | 'auto_collect'
  | 'skirmish'
  | 'scheduled_deploy';

export interface ScheduledDroneOrderState {
  scheduleId: string;
  unitId: string;
  unitCode: string;
  ownerId: string;
  commandType: ScheduledDroneCommandType;
  waypoints: Array<{ x: number; y: number; h3?: number }>;
  waypointCursor: number;
  scheduledAtMs: number;
  repeatIntervalSec: number | null;
  isActivated: boolean;
}

export interface TacticalRtsUnitState extends TacticalUnit {
  reloadRemainingMs: number;
  lastFiredTimestamp: number;
  currentMoveIntent: UnitMoveIntent | null;
  tier: 1 | 2 | 3 | 4 | 5; // 1-5
  owner?: string;
  moveRange?: number;
  isDestroyed?: boolean;
}

export interface BallisticTracer {
  id: string;
  attackerId: string;
  targetId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  startedAt: number;
  durationMs: number; // Típicamente 200 ms
  damageDealt: number;
  isCritical: boolean;
}

export interface RtsFireResult {
  success: boolean;
  reason?: string;
  combatResult?: CanonicalCombatResult;
  tracer?: BallisticTracer;
  defenderDestroyed?: boolean;
  attackerDestroyed?: boolean;
}

export interface TacticalRtsEngineOptions {
  tickIntervalMs?: number; // 100 ms por defecto (10 ticks/s)
  isCompetitiveMirror?: boolean; // Tier 1 espejo (+0%)
  initialWeather?: WeatherCondition;
}

const DEFAULT_TERRAIN_DEFENSE_STARS: Record<TerrainType, number> = {
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

const BASE_TERRAIN_MOVEMENT_COSTS: Record<TerrainType, Record<MovementType, number>> = {
  plains: { foot: 1, mech: 1, wheels: 2, treads: 1, air: 1, sea: Infinity },
  rubble: { foot: 1, mech: 1, wheels: 2, treads: 1, air: 1, sea: Infinity },
  forest: { foot: 1, mech: 1, wheels: 3, treads: 2, air: 1, sea: Infinity },
  mountain: { foot: 2, mech: 1, wheels: Infinity, treads: Infinity, air: 1, sea: Infinity },
  road: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  river: { foot: 2, mech: 1, wheels: Infinity, treads: Infinity, air: 1, sea: Infinity },
  city: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  factory: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  airport: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  port: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: 1 },
  hq: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  sea: { foot: Infinity, mech: Infinity, wheels: Infinity, treads: Infinity, air: 1, sea: 1 },
  reef: { foot: Infinity, mech: Infinity, wheels: Infinity, treads: Infinity, air: 1, sea: 2 },
  shoal: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: 1 },
  bridge: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: 1 },
  commtower: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  silo: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  usedSilo: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  lab: { foot: 1, mech: 1, wheels: 1, treads: 1, air: 1, sea: Infinity },
  pipe: { foot: Infinity, mech: Infinity, wheels: Infinity, treads: Infinity, air: Infinity, sea: Infinity },
  pipeSeam: { foot: Infinity, mech: Infinity, wheels: Infinity, treads: Infinity, air: Infinity, sea: Infinity },
};

export class TacticalRtsEngine {
  private units: Map<string, TacticalRtsUnitState> = new Map();
  private scheduledOrders: Map<string, ScheduledDroneOrderState> = new Map();
  private terrainMap: Map<string, TerrainTile> = new Map();
  private activeTracers: BallisticTracer[] = [];
  private tickIntervalMs: number;
  private isCompetitiveMirror: boolean;
  private weather: WeatherCondition = 'clear';
  private isDirty: boolean = true;
  private lastTickTimestamp: number = 0;

  constructor(options: TacticalRtsEngineOptions = {}) {
    this.tickIntervalMs = options.tickIntervalMs ?? 100;
    this.isCompetitiveMirror = options.isCompetitiveMirror ?? false;
    this.weather = options.initialWeather ?? 'clear';
  }

  public registerUnit(unit: TacticalUnit, tier: number = 1): TacticalRtsUnitState {
    const existing = this.units.get(unit.id);
    if (existing) return existing;

    const profile = CANONICAL_RTS_PROFILES[unit.unitCode] || CANONICAL_RTS_PROFILES.infantry;
    const clampedTier = Math.max(1, Math.min(5, tier)) as 1 | 2 | 3 | 4 | 5;
    const rtsUnit: TacticalRtsUnitState = {
      ...unit,
      ownerId: unit.ownerId || (unit as { owner?: string }).owner || 'neutral',
      hp: unit.hp ?? 100,
      tier: clampedTier,
      reloadRemainingMs: 0,
      lastFiredTimestamp: 0,
      currentMoveIntent: null,
      minRange: profile.minRange,
      maxRange: profile.maxRange,
      moveRange: profile.baseMoveRange,
      isDestroyed: false,
    };

    this.units.set(unit.id, rtsUnit);
    this.isDirty = true;
    return rtsUnit;
  }

  public setWeather(w: WeatherCondition): void {
    if (this.weather !== w) {
      this.weather = w;
      this.isDirty = true;
    }
  }

  public getWeather(): WeatherCondition {
    return this.weather;
  }

  public setTerrain(x: number, y: number, tile: TerrainTile): void {
    const normalizedTile: TerrainTile = {
      ...tile,
      x,
      y,
      defenseStars: tile.defenseStars ?? DEFAULT_TERRAIN_DEFENSE_STARS[tile.type] ?? 1,
    };
    this.terrainMap.set(`${x},${y}`, normalizedTile);
  }

  public getTerrain(x: number, y: number): TerrainTile {
    return this.terrainMap.get(`${x},${y}`) ?? {
      x,
      y,
      type: 'plains',
      defenseStars: DEFAULT_TERRAIN_DEFENSE_STARS.plains,
    };
  }

  /**
   * Destruye un punto de costura de tubería ('pipeSeam') convirtiéndolo en escombros transitables ('rubble').
   */
  public destroyPipeSeam(x: number, y: number): boolean {
    const tile = this.getTerrain(x, y);
    if (tile.type !== 'pipeSeam') return false;

    this.terrainMap.set(`${x},${y}`, {
      ...tile,
      x,
      y,
      type: 'rubble',
      defenseStars: DEFAULT_TERRAIN_DEFENSE_STARS.rubble,
    });
    this.isDirty = true;
    return true;
  }

  public isTerrainPassable(terrainType: TerrainType, movementType: MovementType = 'foot'): boolean {
    const baseCost = BASE_TERRAIN_MOVEMENT_COSTS[terrainType]?.[movementType] ?? Infinity;
    return Number.isFinite(baseCost);
  }

  public isTilePassable(x: number, y: number, movementType: MovementType = 'foot'): boolean {
    return this.isTerrainPassable(this.getTerrain(x, y).type, movementType);
  }

  /**
   * Coste de movimiento determinista por terreno y chasis aplicando modificadores climáticos.
   */
  public getTerrainMovementCost(terrainType: TerrainType, movementType: MovementType = 'foot'): number {
    const baseCost = BASE_TERRAIN_MOVEMENT_COSTS[terrainType]?.[movementType] ?? Infinity;
    if (!Number.isFinite(baseCost)) {
      return Infinity;
    }

    if (this.weather === 'rain' && movementType === 'wheels') {
      return baseCost + 1;
    }

    if (this.weather === 'snow' && movementType !== 'air' && movementType !== 'sea') {
      return baseCost + 1;
    }

    return baseCost;
  }

  public getMovementCost(x: number, y: number, movementType: MovementType = 'foot'): number {
    return this.getTerrainMovementCost(this.getTerrain(x, y).type, movementType);
  }

  /**
   * Alcance de visión determinista en celdas; en 'rain' penaliza -1 en niebla (mínimo 1).
   */
  public getUnitVisionRange(unitOrId: string | TacticalUnit, inFog: boolean = true): number {
    const unit = typeof unitOrId === 'string' ? this.units.get(unitOrId) : unitOrId;
    if (!unit) return 0;

    const baseVision = unit.visionRange ?? 2;
    const rainPenalty = this.weather === 'rain' && inFog ? 1 : 0;
    return Math.max(1, baseVision - rainPenalty);
  }

  public getUnit(id: string): TacticalRtsUnitState | undefined {
    return this.units.get(id);
  }

  public getAllUnits(): TacticalRtsUnitState[] {
    return Array.from(this.units.values()).filter((u) => !u.isDestroyed);
  }

  public getActiveTracers(): BallisticTracer[] {
    return this.activeTracers;
  }

  public consumeDirtyFlag(): boolean {
    const dirty = this.isDirty;
    this.isDirty = false;
    return dirty;
  }

  /**
   * Ciclo de simulación continua a 10 ticks/s (deltaMs = 100 ms)
   */
  public tick(now: number = Date.now()): { stateChanged: boolean; expiredTracers: string[] } {
    const deltaMs = this.lastTickTimestamp > 0 ? Math.min(now - this.lastTickTimestamp, 500) : this.tickIntervalMs;
    this.lastTickTimestamp = now;

    let stateChanged = false;

    // 1. Limpiar trazadoras balísticas expiradas (> 200 ms)
    const activeTracersCountBefore = this.activeTracers.length;
    this.activeTracers = this.activeTracers.filter((t) => now - t.startedAt < t.durationMs);
    if (this.activeTracers.length !== activeTracersCountBefore) {
      stateChanged = true;
    }

    // 1.5 Activar órdenes programadas por hora (unit_command_schedules) cuya hora UTC ya venció
    for (const order of this.scheduledOrders.values()) {
      if (!order.isActivated && now >= order.scheduledAtMs) {
        const unit = this.units.get(order.unitId);
        if (unit && !unit.isDestroyed && order.waypoints.length >= 2) {
          const profile = CANONICAL_RTS_PROFILES[unit.unitCode] || CANONICAL_RTS_PROFILES.infantry;
          const msPerStep = Math.round(1000 / Math.max(0.5, profile.moveSpeedCellsPerSec));
          const loopPath =
            order.commandType === 'patrol' || order.commandType === 'auto_collect'
              ? [...order.waypoints, order.waypoints[0]]
              : order.waypoints;
          unit.currentMoveIntent = {
            unitId: order.unitId,
            path: loopPath.map((wp) => ({ x: wp.x, y: wp.y })),
            currentWaypointIndex: Math.min(order.waypointCursor, Math.max(0, loopPath.length - 2)),
            stepProgressMs: 0,
            msPerStep,
          };
          order.isActivated = true;
          stateChanged = true;
        }
      }
    }

    // 2. Decrementar cooldowns de recarga y avanzar movimiento
    for (const unit of this.units.values()) {
      if (unit.isDestroyed) continue;

      // Decrementar recarga
      if (unit.reloadRemainingMs > 0) {
        unit.reloadRemainingMs = Math.max(0, unit.reloadRemainingMs - deltaMs);
        if (unit.reloadRemainingMs === 0) {
          stateChanged = true;
        }
      }

      // Procesar intención de marcha
      if (unit.currentMoveIntent) {
        stateChanged = true;
        const intent = unit.currentMoveIntent;
        intent.stepProgressMs += deltaMs;

        if (intent.stepProgressMs >= intent.msPerStep) {
          intent.stepProgressMs = 0;
          intent.currentWaypointIndex++;

          if (intent.currentWaypointIndex < intent.path.length) {
            const nextCoord = intent.path[intent.currentWaypointIndex];
            unit.x = nextCoord.x;
            unit.y = nextCoord.y;
            if (intent.currentWaypointIndex >= intent.path.length - 1) {
              const sched = this.scheduledOrders.get(unit.id);
              if (
                sched &&
                (sched.commandType === 'patrol' || sched.commandType === 'auto_collect') &&
                intent.path.length >= 2
              ) {
                intent.currentWaypointIndex = 0;
              } else {
                unit.currentMoveIntent = null;
              }
            }
          } else {
            // Llegada al destino final
            unit.currentMoveIntent = null;
          }
        }
      }
    }

    if (stateChanged) {
      this.isDirty = true;
    }

    return { stateChanged, expiredTracers: [] };
  }

  /**
   * Sincroniza una orden programada de unit_command_schedules para interpolación visual continua.
   */
  public syncScheduledCommand(
    order: {
      scheduleId: string;
      unitId: string;
      unitCode: string;
      ownerId: string;
      commandType: ScheduledDroneCommandType;
      waypoints: Array<{ x: number; y: number; h3?: number }>;
      waypointCursor: number;
      scheduledAtMs: number;
      repeatIntervalSec?: number | null;
    },
    nowMs: number = Date.now()
  ): boolean {
    if (!order.unitId || order.waypoints.length === 0) return false;

    let unit = this.units.get(order.unitId);
    if (!unit) {
      const start = order.waypoints[0];
      unit = this.registerUnit(
        {
          id: order.unitId,
          unitCode: order.unitCode,
          displayName: order.unitCode,
          ownerId: order.ownerId,
          x: start.x,
          y: start.y,
          hp: 100,
          maxHp: 100,
          movementPoints: 6,
          movementType: 'treads',
          visionRange: 3,
          minRange: 1,
          maxRange: 1,
          ammo: 9,
          fuel: 99,
          baseAttack: 50,
          productionCost: 1000,
          hasMoved: false,
          hasActed: false,
        } as unknown as TacticalUnit,
        1
      );
    }

    const existing = this.scheduledOrders.get(order.unitId);
    if (
      existing &&
      existing.scheduleId === order.scheduleId &&
      existing.waypoints.length === order.waypoints.length &&
      existing.isActivated
    ) {
      return true;
    }

    const isDue = nowMs >= order.scheduledAtMs;
    const orderState: ScheduledDroneOrderState = {
      scheduleId: order.scheduleId,
      unitId: order.unitId,
      unitCode: order.unitCode,
      ownerId: order.ownerId,
      commandType: order.commandType,
      waypoints: order.waypoints,
      waypointCursor: order.waypointCursor,
      scheduledAtMs: order.scheduledAtMs,
      repeatIntervalSec: order.repeatIntervalSec ?? null,
      isActivated: isDue && order.waypoints.length >= 2,
    };

    this.scheduledOrders.set(order.unitId, orderState);

    if (orderState.isActivated) {
      const profile = CANONICAL_RTS_PROFILES[unit.unitCode] || CANONICAL_RTS_PROFILES.infantry;
      const msPerStep = Math.round(1000 / Math.max(0.5, profile.moveSpeedCellsPerSec));
      const loopPath =
        order.commandType === 'patrol' || order.commandType === 'auto_collect'
          ? [...order.waypoints, order.waypoints[0]]
          : order.waypoints;
      unit.currentMoveIntent = {
        unitId: order.unitId,
        path: loopPath.map((wp) => ({ x: wp.x, y: wp.y })),
        currentWaypointIndex: Math.min(order.waypointCursor, Math.max(0, loopPath.length - 2)),
        stepProgressMs: 0,
        msPerStep,
      };
      this.isDirty = true;
    }

    return true;
  }

  public clearScheduledCommand(unitId: string): void {
    this.scheduledOrders.delete(unitId);
    const unit = this.units.get(unitId);
    if (unit) {
      unit.currentMoveIntent = null;
    }
  }

  public getScheduledCommand(unitId: string): ScheduledDroneOrderState | undefined {
    return this.scheduledOrders.get(unitId);
  }

  /**
   * Retorna la coordenada continua interpolada de una unidad en tránsito o su posición actual.
   */
  public getInterpolatedUnitCoords(unitId: string): { x: number; y: number; progress: number } | null {
    const unit = this.units.get(unitId);
    if (!unit || unit.isDestroyed) return null;

    const intent = unit.currentMoveIntent;
    if (intent && intent.path.length >= 2) {
      const p0 = intent.path[intent.currentWaypointIndex];
      const p1 = intent.path[intent.currentWaypointIndex + 1];
      if (p0 && p1) {
        const progress = Math.min(1, Math.max(0, intent.stepProgressMs / Math.max(1, intent.msPerStep)));
        return {
          x: p0.x + (p1.x - p0.x) * progress,
          y: p0.y + (p1.y - p0.y) * progress,
          progress,
        };
      }
    }

    return { x: unit.x, y: unit.y, progress: 0 };
  }

  /**
   * Ordena a una unidad marchar por un camino planificado
   */
  public issueMoveOrder(unitId: string, path: Array<{ x: number; y: number }>, now: number = Date.now()): boolean {
    const unit = this.units.get(unitId);
    if (!unit || unit.isDestroyed || path.length < 2) return false;

    const profile = CANONICAL_RTS_PROFILES[unit.unitCode] || CANONICAL_RTS_PROFILES.infantry;
    const movementType = unit.movementType ?? profile.chassis;

    for (let i = 1; i < path.length; i++) {
      if (!this.isTilePassable(path[i].x, path[i].y, movementType)) {
        return false;
      }
    }

    const msPerStep = Math.round(1000 / profile.moveSpeedCellsPerSec);

    unit.currentMoveIntent = {
      unitId,
      path,
      currentWaypointIndex: 0,
      stepProgressMs: 0,
      msPerStep,
    };

    this.isDirty = true;
    return true;
  }

  /**
   * Detiene el movimiento de una unidad inmediatamente
   */
  public haltUnit(unitId: string): void {
    const unit = this.units.get(unitId);
    if (unit && unit.currentMoveIntent) {
      unit.currentMoveIntent = null;
      this.isDirty = true;
    }
  }

  /**
   * Comprueba si la unidad atacante puede disparar sobre el objetivo
   */
  public canFire(attackerId: string, targetId: string, now: number = Date.now()): { canFire: boolean; reason?: string } {
    const attacker = this.units.get(attackerId);
    const target = this.units.get(targetId);

    if (!attacker || attacker.isDestroyed) return { canFire: false, reason: 'ATTACKER_UNAVAILABLE' };
    if (!target || target.isDestroyed) return { canFire: false, reason: 'TARGET_UNAVAILABLE' };
    if ((attacker.ownerId || attacker.owner) === (target.ownerId || target.owner)) return { canFire: false, reason: 'FRIENDLY_FIRE_PROHIBITED' };

    // Validación de Cooldown de Recarga
    if (attacker.reloadRemainingMs > 0) {
      return { canFire: false, reason: `WEAPON_RELOADING_${attacker.reloadRemainingMs}MS` };
    }

    // Unidades desarmadas (ej. APC, Helicóptero de Transporte) no pueden disparar
    const profile = CANONICAL_RTS_PROFILES[attacker.unitCode];
    if (profile && profile.maxRange === 0) {
      return { canFire: false, reason: 'UNARMED_UNIT' };
    }

    // Artillería o armas de fuego indirecto no disparan en movimiento
    if (
      profile &&
      (profile.minRange > 1 || profile.unitCode === 'artillery' || profile.unitCode === 'rocket') &&
      attacker.currentMoveIntent
    ) {
      return { canFire: false, reason: 'INDIRECT_FIRE_REQUIRES_STATIONARY' };
    }

    // Validación de Rango de Distancia Manhattan
    const distance = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
    if (distance < attacker.minRange || distance > attacker.maxRange) {
      return { canFire: false, reason: `OUT_OF_RANGE_DIST_${distance}` };
    }

    return { canFire: true };
  }

  /**
   * Ejecuta el disparo en tiempo real gobernado por cooldowns y balística canónica
   */
  public executeFire(attackerId: string, targetId: string, now: number = Date.now()): RtsFireResult {
    const validation = this.canFire(attackerId, targetId, now);
    if (!validation.canFire) {
      return { success: false, reason: validation.reason };
    }

    const attacker = this.units.get(attackerId)!;
    const target = this.units.get(targetId)!;
    const profile = CANONICAL_RTS_PROFILES[attacker.unitCode] || CANONICAL_RTS_PROFILES.infantry;

    const attackerTile = this.getTerrain(attacker.x, attacker.y);
    const defenderTile = this.getTerrain(target.x, target.y);

    // Configuración canónica anti-P2W (+0% en esports, +2% territorial tier)
    const options: CanonicalCombatOptions = {
      scale100Hp: true,
      deterministic: true,
      attackerTierLevel: this.isCompetitiveMirror ? 1 : attacker.tier,
      defenderTierLevel: this.isCompetitiveMirror ? 1 : target.tier,
    };

    const combatResult = CanonicalCombatEngine.calculateEngagement(attacker, target, attackerTile, defenderTile, options);

    if (!combatResult.canAttack) {
      return { success: false, reason: 'COMBAT_REJECTED_BY_ENGINE' };
    }

    // 1. Aplicar daño balístico al defensor (1-100 HP)
    target.hp = Math.max(0, combatResult.defenderHpAfter);
    if (target.hp === 0) {
      target.isDestroyed = true;
      target.currentMoveIntent = null;
    }

    // 2. Si el defensor sobrevive y puede contraatacar (solo ataque directo adyacente a rango 1)
    if (combatResult.canCounterAttack && !target.isDestroyed) {
      attacker.hp = Math.max(0, combatResult.attackerHpAfter);
      if (attacker.hp === 0) {
        attacker.isDestroyed = true;
        attacker.currentMoveIntent = null;
      }
    }

    // 3. Aplicar Cooldown de Recarga al Atacante
    attacker.reloadRemainingMs = profile.reloadCooldownMs;
    attacker.lastFiredTimestamp = now;

    // 4. Crear Trazadora Balística Visual para WebGL TileCanvas (200 ms de vida)
    const isCritical = combatResult.attackerDamageDealt >= 40;
    const tracer: BallisticTracer = {
      id: `tracer-${now}-${Math.random().toString(36).substring(2, 7)}`,
      attackerId,
      targetId,
      from: { x: attacker.x, y: attacker.y },
      to: { x: target.x, y: target.y },
      startedAt: now,
      durationMs: 200,
      damageDealt: combatResult.attackerDamageDealt,
      isCritical,
    };
    this.activeTracers.push(tracer);

    this.isDirty = true;

    return {
      success: true,
      combatResult,
      tracer,
      defenderDestroyed: target.isDestroyed,
      attackerDestroyed: attacker.isDestroyed,
    };
  }
}
