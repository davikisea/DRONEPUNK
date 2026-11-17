/**
 * ==============================================================================
 * MOTOR DE UNIDADES OPERACIONALES DESPLEGADAS EN MAPA (ZOOM x10 OPERACIONAL)
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.2
 * Administra las unidades y convoyes visibles a escala operacional en el mapa.
 * Conforme a @tactical-command-intel y @indie-game-ui-architect.
 * ==============================================================================
 */

import type { FactionId } from '@domains/world';
import type {
  DroneUnitRole,
  DroneSignalProjection,
  DroneArchetypeId,
  DroneArchetypeSpec,
} from '@shared';

export const CANONICAL_H3_DRONE_CATALOG: Record<DroneArchetypeId, DroneArchetypeSpec> = {
  infantry_swarm: {
    id: 'infantry_swarm',
    tierLevel: 1,
    name: 'Dron Infantería (Swarm)',
    unlockRequirement: 'basic_factory',
    cost: { alloys: 50, fuel: 10, microchips: 0 },
    fuelPerHour: 1,
    fuelPerTick15m: 0.25,
    conquestHexesPerHour: 15,
    conquestProgressPerTick15m: 3.75,
    visionRangeHexes: 2,
    minAttackRange: 1,
    maxAttackRange: 1,
    isAirUnit: false,
    canMoveAndFireSameTick: true,
    canCaptureBuildings: true,
    canCounterAttack: true,
  },
  recon_explorer: {
    id: 'recon_explorer',
    tierLevel: 1,
    name: 'Recon (Explorador)',
    unlockRequirement: 'basic_factory',
    cost: { alloys: 120, fuel: 40, microchips: 5 },
    fuelPerHour: 4,
    fuelPerTick15m: 1.0,
    conquestHexesPerHour: 25,
    conquestProgressPerTick15m: 6.25,
    visionRangeHexes: 5,
    minAttackRange: 1,
    maxAttackRange: 1,
    isAirUnit: false,
    canMoveAndFireSameTick: true,
    canCaptureBuildings: false,
    canCounterAttack: true,
  },
  light_artillery: {
    id: 'light_artillery',
    tierLevel: 1,
    name: 'Artillería Ligera',
    unlockRequirement: 'basic_factory',
    cost: { alloys: 180, fuel: 50, microchips: 10 },
    fuelPerHour: 3,
    fuelPerTick15m: 0.75,
    conquestHexesPerHour: 2,
    conquestProgressPerTick15m: 0.5,
    visionRangeHexes: 2,
    minAttackRange: 2,
    maxAttackRange: 3,
    isAirUnit: false,
    canMoveAndFireSameTick: false,
    canCaptureBuildings: false,
    canCounterAttack: false,
  },
  medium_tank: {
    id: 'medium_tank',
    tierLevel: 2,
    name: 'Tanque Medio',
    unlockRequirement: 'corp_advanced_workshop',
    cost: { alloys: 300, fuel: 100, microchips: 25 },
    fuelPerHour: 8,
    fuelPerTick15m: 2.0,
    conquestHexesPerHour: 10,
    conquestProgressPerTick15m: 2.5,
    visionRangeHexes: 3,
    minAttackRange: 1,
    maxAttackRange: 1,
    isAirUnit: false,
    canMoveAndFireSameTick: true,
    canCaptureBuildings: false,
    canCounterAttack: true,
  },
  anti_air: {
    id: 'anti_air',
    tierLevel: 2,
    name: 'Unidad Antiaérea (AA)',
    unlockRequirement: 'corp_advanced_workshop',
    cost: { alloys: 250, fuel: 80, microchips: 30 },
    fuelPerHour: 6,
    fuelPerTick15m: 1.5,
    conquestHexesPerHour: 8,
    conquestProgressPerTick15m: 2.0,
    visionRangeHexes: 4,
    minAttackRange: 1,
    maxAttackRange: 1,
    isAirUnit: false,
    canMoveAndFireSameTick: true,
    canCaptureBuildings: false,
    canCounterAttack: true,
  },
  logistics_apc: {
    id: 'logistics_apc',
    tierLevel: 2,
    name: 'Dron Logístico (APC)',
    unlockRequirement: 'corp_advanced_workshop',
    cost: { alloys: 150, fuel: 60, microchips: 20 },
    fuelPerHour: 5,
    fuelPerTick15m: 1.25,
    conquestHexesPerHour: 0,
    conquestProgressPerTick15m: 0,
    visionRangeHexes: 2,
    minAttackRange: 0,
    maxAttackRange: 0,
    isAirUnit: false,
    canMoveAndFireSameTick: true,
    canCaptureBuildings: false,
    canCounterAttack: false,
  },
  bomber_drone: {
    id: 'bomber_drone',
    tierLevel: 3,
    name: 'Dron Bombardero',
    unlockRequirement: 'state_60_industrial_complex',
    cost: { alloys: 600, fuel: 250, microchips: 120 },
    fuelPerHour: 25,
    fuelPerTick15m: 6.25,
    conquestHexesPerHour: 0,
    conquestProgressPerTick15m: 0,
    visionRangeHexes: 4,
    minAttackRange: 1,
    maxAttackRange: 1,
    isAirUnit: true,
    canMoveAndFireSameTick: true,
    canCaptureBuildings: false,
    canCounterAttack: false,
  },
  neo_tank: {
    id: 'neo_tank',
    tierLevel: 3,
    name: 'Neo-Tanque (Coloso)',
    unlockRequirement: 'state_60_industrial_complex',
    cost: { alloys: 800, fuel: 300, microchips: 150 },
    fuelPerHour: 30,
    fuelPerTick15m: 7.5,
    conquestHexesPerHour: 12,
    conquestProgressPerTick15m: 3.0,
    visionRangeHexes: 3,
    minAttackRange: 1,
    maxAttackRange: 1,
    isAirUnit: false,
    canMoveAndFireSameTick: true,
    canCaptureBuildings: false,
    canCounterAttack: true,
  },
  tactical_missile: {
    id: 'tactical_missile',
    tierLevel: 3,
    name: 'Lanzamisiles Táctico',
    unlockRequirement: 'state_60_industrial_complex',
    cost: { alloys: 500, fuel: 150, microchips: 200 },
    fuelPerHour: 15,
    fuelPerTick15m: 3.75,
    conquestHexesPerHour: 0,
    conquestProgressPerTick15m: 0,
    visionRangeHexes: 5,
    minAttackRange: 4,
    maxAttackRange: 5,
    isAirUnit: false,
    canMoveAndFireSameTick: false,
    canCaptureBuildings: false,
    canCounterAttack: false,
  },
};

export type OperationalUnitStatus = 'entrenched' | 'patrol' | 'moving' | 'in_combat' | 'guard';

export interface DroneRoleProfile {
  role: DroneUnitRole;
  displayLabel: string;
  signalRadiusCells: number;
  captureRatePerTick: number;
  patrolSpeedKmh: number;
  canCaptureOrSabotageInfrastructure: boolean;
  engagementRangeType: 'direct' | 'indirect';
}

export const CANONICAL_DRONE_ROLE_PROFILES: Record<DroneUnitRole, DroneRoleProfile> = {
  recon_scout: {
    role: 'recon_scout',
    displayLabel: 'Recon / Scout (Señal Amplia)',
    signalRadiusCells: 3.5,
    captureRatePerTick: 45,
    patrolSpeedKmh: 72,
    canCaptureOrSabotageInfrastructure: false,
    engagementRangeType: 'direct',
  },
  infantry_engineer: {
    role: 'infantry_engineer',
    displayLabel: 'Infantería / Ingeniero (Captura & Sabotaje)',
    signalRadiusCells: 1.5,
    captureRatePerTick: 35,
    patrolSpeedKmh: 28,
    canCaptureOrSabotageInfrastructure: true,
    engagementRangeType: 'direct',
  },
  tank_direct: {
    role: 'tank_direct',
    displayLabel: 'Tanque / Blindado (Letalidad Directa)',
    signalRadiusCells: 1.2,
    captureRatePerTick: 15,
    patrolSpeedKmh: 48,
    canCaptureOrSabotageInfrastructure: false,
    engagementRangeType: 'direct',
  },
  artillery_indirect: {
    role: 'artillery_indirect',
    displayLabel: 'Artillería (Fuego Indirecto Seguro)',
    signalRadiusCells: 1.0,
    captureRatePerTick: 10,
    patrolSpeedKmh: 36,
    canCaptureOrSabotageInfrastructure: false,
    engagementRangeType: 'indirect',
  },
};

export function resolveDroneRoleFromUnitCode(unitCode: string): DroneUnitRole {
  const norm = unitCode.toLowerCase();
  if (norm === 'recon' || norm === 'scout' || norm === 'b_copter') {
    return 'recon_scout';
  }
  if (norm === 'infantry' || norm === 'mech' || norm === 'inf_mech' || norm === 'engineer') {
    return 'infantry_engineer';
  }
  if (norm === 'artillery' || norm === 'rocket' || norm === 'missiles' || norm === 'arty_m109' || norm === 'mlrs_m270') {
    return 'artillery_indirect';
  }
  return 'tank_direct';
}

export function buildDroneSignalProjection(unit: {
  id: string;
  code: string;
  clanId: string;
  coordinates: [number, number];
  hp: number;
  centerCellIndex?: number;
}): DroneSignalProjection {
  const unitRole = resolveDroneRoleFromUnitCode(unit.code);
  const profile = CANONICAL_DRONE_ROLE_PROFILES[unitRole];
  return {
    unitId: unit.id,
    clanId: unit.clanId,
    unitRole,
    centerCellIndex: unit.centerCellIndex,
    coordinates: unit.coordinates,
    hp: unit.hp,
    signalRadiusCells: profile.signalRadiusCells,
    captureRatePerTick: profile.captureRatePerTick,
  };
}

export interface OperationalDeployedUnit {
  id: string;
  name: string;
  code: string;
  unitType: string;
  clanId: string;
  clanTag: string;
  clanName: string;
  factionId: FactionId;
  location: [number, number]; // [lng, lat]
  hp: number; // 1-100
  maxHp: number; // 100
  status: OperationalUnitStatus;
  cityName?: string;
  facingAngle?: number; // Grados 0-360 para orientación
  lastActionAt: string;
}

export class OperationalUnitsEngine {
  private units: Map<string, OperationalDeployedUnit> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.seedDefaultOperationalUnits();
  }

  /**
   * Genera unidades desplegadas semilleras en las arterias y nodos urbanos reales
   */
  public seedDefaultOperationalUnits(): void {
    const nowIso = new Date().toISOString();
    const makeCabimasUnit = (
      id: string,
      name: string,
      code: string,
      unitType: string,
      location: [number, number],
      facingAngle: number = 90,
      hostile: boolean = false
    ): OperationalDeployedUnit => ({
      id,
      name,
      code,
      unitType,
      clanId: hostile ? 'clan-orinoco' : 'clan-ferro',
      clanTag: hostile ? 'ORNC' : 'FERR',
      clanName: hostile ? 'División Petroquímica Orinoco' : 'Legión Blindada Ferro',
      factionId: hostile ? 'orange_star' : 'blue_moon',
      location,
      hp: 100,
      maxHp: 100,
      status: 'guard',
      cityName: 'Cabimas',
      facingAngle,
      lastActionAt: nowIso,
    });

    const seedList: OperationalDeployedUnit[] = [
      // ======================================================================
      // TEATRO CABIMAS — POLÍGONO COMPLETO (SECTOR ANCLA [9880, 15432] + SALINA)
      // ======================================================================
      makeCabimasUnit('unit-op-cab-01', 'Vanguardia Acorazada T-72B', 'MD_TANK', 'md_tank', [-71.460, 10.405], 180),
      makeCabimasUnit('unit-op-cab-h3-infantry_swarm', 'Dron Infantería (Swarm)', 'INFANTRY_SWARM', 'infantry_swarm', [-71.453705, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-recon_explorer', 'Recon (Explorador H3)', 'RECON_EXPLORER', 'recon_explorer', [-71.453156, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-light_artillery', 'Artillería Ligera H3', 'LIGHT_ARTILLERY', 'light_artillery', [-71.452606, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-medium_tank', 'Tanque Medio H3', 'MEDIUM_TANK', 'medium_tank', [-71.452057, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-anti_air', 'Unidad Antiaérea (AA H3)', 'ANTI_AIR', 'anti_air', [-71.451508, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-logistics_apc', 'Dron Logístico (APC H3)', 'LOGISTICS_APC', 'logistics_apc', [-71.450958, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-bomber_drone', 'Dron Bombardero H3', 'BOMBER_DRONE', 'bomber_drone', [-71.450409, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-neo_tank', 'Neo-Tanque (Coloso H3)', 'NEO_TANK', 'neo_tank', [-71.44986, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-h3-tactical_missile', 'Lanzamisiles Táctico H3', 'TACTICAL_MISSILE', 'tactical_missile', [-71.44931, 10.400027], 90),
      makeCabimasUnit('unit-op-cab-ch-battleship', 'Acorazado Naval La Salina', 'BATTLESHIP', 'battleship', [-71.454254, 10.398946], 90),
      makeCabimasUnit('unit-op-cab-ch-infantry', 'Infantería de Línea Cabimas', 'INFANTRY', 'infantry', [-71.453705, 10.398946], 90),
      makeCabimasUnit('unit-op-cab-ch-mech', 'Mecanizado Bazooka El Barroso', 'MECH', 'mech', [-71.453156, 10.398946], 90),
      makeCabimasUnit('unit-op-cab-ch-tank_medium', 'Tanque Mediano Vanguardia', 'TANK_MEDIUM', 'tank_medium', [-71.452606, 10.398946], 90),
      makeCabimasUnit('unit-op-cab-enemy-01', 'Blanco Hostil Blindado Orinoco', 'TANK_MEDIUM', 'tank_medium', [-71.452057, 10.398946], 270, true),
      makeCabimasUnit('unit-op-cab-ch-recon', 'Vehículo Reconocimiento Intercomunal', 'RECON', 'recon', [-71.451508, 10.398946], 270),
      makeCabimasUnit('unit-op-cab-ch-apc', 'Transporte Blindado APC Logístico', 'APC', 'apc', [-71.450958, 10.398946], 270),
      makeCabimasUnit('unit-op-cab-ch-tank_light', 'Tanque Ligero Costa Oriental', 'TANK_LIGHT', 'tank_light', [-71.450409, 10.398946], 270),
      makeCabimasUnit('unit-op-cab-ch-neotank', 'Neotanque Pesado Ferro', 'NEOTANK', 'neotank', [-71.44986, 10.398946], 270),
      makeCabimasUnit('unit-op-cab-enemy-02', 'Blanco Hostil Aéreo Orinoco', 'B_COPTER', 'b_copter', [-71.452057, 10.398406], 270, true),
      makeCabimasUnit('unit-op-cab-ch-anti_air', 'Blindado Antiaéreo Vulcan', 'ANTI_AIR', 'anti_air', [-71.451508, 10.398406], 270),
      makeCabimasUnit('unit-op-cab-ch-b_copter', 'Helicóptero de Batalla Costa', 'B_COPTER', 'b_copter', [-71.453705, 10.397866], 90),
      makeCabimasUnit('unit-op-cab-ch-t_copter', 'Helicóptero de Transporte Lago', 'T_COPTER', 't_copter', [-71.453156, 10.397866], 90),
      makeCabimasUnit('unit-op-cab-ch-artillery', 'Artillería de Asedio Carretera H', 'ARTILLERY', 'artillery', [-71.452057, 10.397866], 0),
      makeCabimasUnit('unit-op-cab-ch-fighter', 'Caza Interceptor Aeroespacial', 'FIGHTER', 'fighter', [-71.450958, 10.397866], 0),
      makeCabimasUnit('unit-op-cab-ch-bomber', 'Bombardero Pesado Estratégico', 'BOMBER', 'bomber', [-71.450409, 10.397866], 0),
      makeCabimasUnit('unit-op-cab-ch-rocket', 'Lanzacohetes Múltiple Carretera K', 'ROCKET', 'rocket', [-71.452057, 10.397325], 0),
      makeCabimasUnit('unit-op-cab-ch-missiles', 'Batería de Misiles AA Tierra-Aire', 'MISSILES', 'missiles', [-71.452057, 10.396785], 0),

      // ======================================================================
      // PUENTE GENERAL RAFAEL URDANETA (Estrecho de Maracaibo)
      // ======================================================================
      {
        id: 'unit-op-bridge-01',
        name: 'Convoy de Suministro Blindado',
        code: 'RECON',
        unitType: 'recon',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        clanName: 'Legión Blindada Ferro',
        factionId: 'blue_moon',
        location: [-71.550, 10.585],
        hp: 100,
        maxHp: 100,
        status: 'guard',
        cityName: 'Maracaibo / Cabimas',
        facingAngle: 105,
        lastActionAt: nowIso,
      },

      // ======================================================================
      // CARACAS (Distrito Capital - División Petroquímica Orinoco / Orange Star)
      // ======================================================================
      {
        id: 'unit-op-ccs-01',
        name: 'Guardia Pretoriana de Miraflores',
        code: 'HEAVY_TANK',
        unitType: 'heavy_tank',
        clanId: 'clan-orinoco',
        clanTag: 'ORNC',
        clanName: 'División Petroquímica Orinoco',
        factionId: 'orange_star',
        location: [-66.918, 10.505],
        hp: 100,
        maxHp: 100,
        status: 'guard',
        cityName: 'Caracas',
        facingAngle: 0,
        lastActionAt: nowIso,
      },
      {
        id: 'unit-op-ccs-02',
        name: 'Patrulla Autopista Gran Cacique Guaicaipuro',
        code: 'RECON',
        unitType: 'recon',
        clanId: 'clan-orinoco',
        clanTag: 'ORNC',
        clanName: 'División Petroquímica Orinoco',
        factionId: 'orange_star',
        location: [-66.865, 10.490],
        hp: 100,
        maxHp: 100,
        status: 'guard',
        cityName: 'Caracas',
        facingAngle: 260,
        lastActionAt: nowIso,
      },

      // ======================================================================
      // VALENCIA (Complejo Industrial Carabobo - Guardia Imperial Sol / Yellow Comet)
      // ======================================================================
      {
        id: 'unit-op-val-01',
        name: 'División Mecanizada Distribuidor San Blas',
        code: 'TANK',
        unitType: 'tank',
        clanId: 'clan-sol',
        clanTag: 'SOL',
        clanName: 'Guardia Imperial Sol',
        factionId: 'yellow_comet',
        location: [-67.995, 10.185],
        hp: 100,
        maxHp: 100,
        status: 'guard',
        cityName: 'Valencia',
        facingAngle: 45,
        lastActionAt: nowIso,
      },

      // ======================================================================
      // BARQUISIMETO (Nudo Logístico Lara - Vanguardia Selva Verde / Green Earth)
      // ======================================================================
      {
        id: 'unit-op-barq-01',
        name: 'Destacamento Antiaéreo Las Trinitarias',
        code: 'ANTI_AIR',
        unitType: 'anti_air',
        clanId: 'clan-selva',
        clanTag: 'SLVA',
        clanName: 'Vanguardia Selva Verde',
        factionId: 'green_earth',
        location: [-69.295, 10.075],
        hp: 100,
        maxHp: 100,
        status: 'guard',
        cityName: 'Barquisimeto',
        facingAngle: 315,
        lastActionAt: nowIso,
      },
    ];

    seedList.forEach((u) => this.units.set(u.id, u));
  }

  public getAllUnits(): OperationalDeployedUnit[] {
    return Array.from(this.units.values());
  }

  public getUnit(id: string): OperationalDeployedUnit | undefined {
    return this.units.get(id);
  }

  public deployUnit(unit: OperationalDeployedUnit): void {
    this.units.set(unit.id, unit);
    this.notify();
  }

  public removeUnit(id: string): boolean {
    const res = this.units.delete(id);
    if (res) this.notify();
    return res;
  }

  public updateUnitLocation(id: string, newLocation: [number, number]): boolean {
    const u = this.units.get(id);
    if (!u) return false;
    u.location = newLocation;
    u.lastActionAt = new Date().toISOString();
    this.notify();
    return true;
  }

  /**
   * Serializa las unidades a GeoJSON para MapLibre GL
   */
  public toGeoJSON(): GeoJSON.FeatureCollection<GeoJSON.Point> {
    return {
      type: 'FeatureCollection',
      features: Array.from(this.units.values()).map((u) => ({
        type: 'Feature',
        id: u.id,
        geometry: {
          type: 'Point',
          coordinates: u.location,
        },
        properties: {
          id: u.id,
          name: u.name,
          code: u.code,
          unitType: u.unitType,
          clanId: u.clanId,
          clanTag: u.clanTag,
          clanName: u.clanName,
          factionId: u.factionId,
          hp: u.hp,
          maxHp: u.maxHp,
          status: u.status,
          cityName: u.cityName || '',
          facingAngle: u.facingAngle || 0,
        },
      })),
    };
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

export const operationalUnitsEngine = new OperationalUnitsEngine();