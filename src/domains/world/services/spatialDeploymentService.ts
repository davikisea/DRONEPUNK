/**
 * ==============================================================================
 * SERVICIO DE ASIGNACIÓN ESPACIAL O(1), DESPLIEGUE Y CONSTRUCCIÓN C4ISR (SPRINT 3)
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.3
 * Convierte cualquier coordenada WGS84 en una celda táctica fija O(1)
 * y permite desplegar unidades y construir edificios in-situ a Zoom x15,
 * sincronizando en tiempo real con Supabase CDC y fallback seguro en memoria.
 * ==============================================================================
 */

import {
  ZOOM_TACTICO,
  lngLatToGridCoords,
  gridCoordsToLngLat,
  LngLat,
} from '../core/coordinates';
import {
  operationalUnitsService,
  DeployedOperationalUnit,
} from '@domains/tactics';
import {
  fiefBuildingService,
} from '@domains/economy';
import type { FiefBuilding, FiefBuildingType } from '@domains/economy';
import {
  supabase,
  isSupabaseConfigured,
  getTerrainDefenseStars,
  getTerrainMovementCost,
  type MunicipalMicroGrid,
  type DroneSignalProjection,
  type SparseMapHexRecord,
  type TerrainType,
  type TerrainTile,
  type SectorCellTerrainOverride,
  type SectorTerrainOverride,
  type SectorTerrainDelta,
  type WeatherCondition,
} from '@shared';
import {
  initializeMunicipalMicroGrid,
  evaluateSignalCaptureTick,
  type SignalCaptureTickResult,
} from '../core/territorialExpansionEngine';
import { clearGbaPipelineCache, generateGbaSectorBlueprint } from '../core/gbaMapPipeline';

export type MicroTerrainType =
  | 'urban_asphalt'
  | 'industrial_compound'
  | 'coastal_basin'
  | 'open_plains'
  | 'defensive_ridge';

export interface SpatialCellAssignment {
  sector: [number, number];
  cell: [number, number];
  centerLngLat: LngLat;
  formattedCoordinate: string; // ej: "SEC-10294:15424 / CELL-[5,13]"
  terrainType: MicroTerrainType;
  canonicalTerrain: TerrainType;
  defenseStars: number;
  terrainName: string;
  defenseCoverPercent: number;  // 0% - 40%
  movementCost: number;         // 1 - 3
  deployedUnit?: DeployedOperationalUnit;
  deployedBuilding?: FiefBuilding;
  isDeployable: boolean;
  isConstructible: boolean;
}

export interface DeployUnitInput {
  sector: [number, number];
  cell: [number, number];
  lngLat: LngLat;
  unitCode: string;
  unitName: string;
  clanId: string;
  clanTag: string;
  factionId: string;
  callsign: string;
  tier?: number;
}

export interface ConstructBuildingInput {
  sector: [number, number];
  cell: [number, number];
  lngLat: LngLat;
  buildingType: FiefBuildingType;
  clanId: string;
  fiefId?: string;
  treasury?: { clanId: string; energyCredits: number };
}

type SpatialChangeListener = () => void;

function hashGridInt(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothValueNoise2D(wx: number, wy: number, scale: number, seed: number): number {
  const gx = Math.floor(wx / scale);
  const gy = Math.floor(wy / scale);
  const fx = (wx / scale) - gx;
  const fy = (wy / scale) - gy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  const n00 = hashGridInt(gx, gy, seed);
  const n10 = hashGridInt(gx + 1, gy, seed);
  const n01 = hashGridInt(gx, gy + 1, seed);
  const n11 = hashGridInt(gx + 1, gy + 1, seed);

  const nx0 = n00 * (1 - u) + n10 * u;
  const nx1 = n01 * (1 - u) + n11 * u;
  return nx0 * (1 - v) + nx1 * v;
}

function mapCanonicalToMicroTerrain(type: TerrainType): {
  micro: MicroTerrainType;
  label: string;
} {
  switch (type) {
    case 'sea':
    case 'reef':
    case 'shoal':
    case 'river':
      return { micro: 'coastal_basin', label: type === 'sea' ? 'Lago / Agua Profunda' : type === 'shoal' ? 'Costa / Vado Lacustre' : 'Cuenca Fluvial / Arrecife' };
    case 'road':
    case 'bridge':
    case 'city':
      return { micro: 'urban_asphalt', label: type === 'city' ? 'Núcleo Urbano' : 'Corredor de Asfalto Urbano' };
    case 'factory':
    case 'airport':
    case 'port':
    case 'hq':
    case 'commtower':
    case 'silo':
    case 'usedSilo':
    case 'lab':
    case 'pipe':
    case 'pipeSeam':
      return { micro: 'industrial_compound', label: `Instalación Estratégica (${type.toUpperCase()})` };
    case 'mountain':
    case 'forest':
      return { micro: 'defensive_ridge', label: type === 'mountain' ? 'Elevación Montañosa (4★)' : 'Bosque Táctico (2★)' };
    case 'rubble':
      return { micro: 'open_plains', label: 'Escombros Tácticos (1★)' };
    case 'plains':
    default:
      return { micro: 'open_plains', label: 'Llanura Abierta / Terreno Firme' };
  }
}

class SpatialDeploymentService {
  private listeners: Set<SpatialChangeListener> = new Set();
  private occupiedCells: Map<string, { unitId?: string; buildingId?: string }> = new Map();
  private municipalGrids: Map<string, MunicipalMicroGrid> = new Map();
  private sparseH3Hexes: Map<string, SparseMapHexRecord> = new Map();
  private sectorTerrainOverrides: Map<string, SectorTerrainOverride> = new Map();
  private sectorWeatherOverrides: Map<string, WeatherCondition> = new Map();
  private terrainRevision: number = 1;
  private activeRegionId: string = 'REG_VE_02';
  private realtimeChannel: any = null;
  private isHydrated: boolean = false;
  private seedOccupiedSynced: boolean = false;
  private terrainInitialized: boolean = false;

  constructor() {
    // Diferir la indexación inicial al microtask posterior al grafo ESM para evitar ciclos @domains/world <-> @domains/tactics <-> @shared
    queueMicrotask(() => {
      try {
        this.ensureTerrainInitialized();
        this.ensureSeedOccupiedSynced();
      } catch {
        // Fallback: se sincroniza lazy en la primera llamada
      }
    });

    // Inicialización no bloqueante de canal Realtime
    this.initRealtimeSubscription(this.activeRegionId).catch((err) => {
      console.warn('[SpatialDeploymentService] Fallo inicializando Realtime (degradado a memoria):', err);
    });
  }

  private ensureSeedOccupiedSynced(
    gridSize: number = 20,
    zoom: number = ZOOM_TACTICO
  ): void {
    if (this.seedOccupiedSynced) return;
    this.syncOccupiedCellsFromSeed(gridSize, zoom);
  }

  /**
   * Indexa en occupiedCells todas las unidades operacionales actualmente sembradas.
   */
  public syncOccupiedCellsFromSeed(
    gridSize: number = 20,
    zoom: number = ZOOM_TACTICO
  ): void {
    const seededUnits = operationalUnitsService.getAllUnits();
    for (const unit of seededUnits) {
      const { sector, cell } = lngLatToGridCoords(unit.coordinates, gridSize, zoom);
      const cellKey = this.calculateSpatialCellId(sector, cell);
      this.occupiedCells.set(cellKey, {
        ...this.occupiedCells.get(cellKey),
        unitId: unit.id,
      });
    }
    this.seedOccupiedSynced = true;
  }

  /**
   * Genera la clave espacial canónica O(1) de una celda.
   */
  public calculateSpatialCellId(sector: [number, number], cell: [number, number]): string {
    return `${sector[0]}_${sector[1]}_${cell[0]}_${cell[1]}`;
  }

  /**
   * Inicializa la suscripción a canales de Postgres Changes para la región operacional.
   */
  public async initRealtimeSubscription(regionId: string = 'REG_VE_02'): Promise<void> {
    this.activeRegionId = regionId;

    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      // 1. Carga inicial selectiva por región (Hidratación delta O(1))
      await this.hydrateFromDatabase(regionId);

      // 2. Desuscribir canal previo si existía
      this.unsubscribeRealtime();

      // 3. Suscribir canal específico del teatro de operaciones
      const channelName = `theatre:${regionId}`;
      this.realtimeChannel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tactical_spatial_deployments',
            filter: `region_id=eq.${regionId}`,
          },
          (payload: any) => this.handleDeploymentRealtimeChange(payload)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tactical_fief_constructions',
            filter: `region_id=eq.${regionId}`,
          },
          (payload: any) => this.handleConstructionRealtimeChange(payload)
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.info(`[SpatialDeploymentService] Canal Realtime conectado: ${channelName}`);
          }
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`SPATIAL_REALTIME_INIT_ERROR: ${msg}`);
    }
  }

  /**
   * Cierra el canal Realtime activo.
   */
  public unsubscribeRealtime(): void {
    if (this.realtimeChannel && supabase) {
      try {
        supabase.removeChannel(this.realtimeChannel);
      } catch (err) {
        console.warn('[SpatialDeploymentService] Error al desuscribir canal:', err);
      }
      this.realtimeChannel = null;
    }
  }

  /**
   * Hidrata las unidades y edificios desplegados desde la base de datos Supabase.
   */
  private async hydrateFromDatabase(regionId: string): Promise<void> {
    if (!supabase) return;

    try {
      // Despliegues militares
      const { data: deployments, error: depError } = await supabase
        .from('tactical_spatial_deployments')
        .select('*')
        .eq('region_id', regionId);

      if (depError) {
        throw new Error(`SPATIAL_DEPLOYMENTS_FETCH_ERROR: ${depError.message}`);
      }

      if (Array.isArray(deployments)) {
        deployments.forEach((row: any) => {
          const unit: DeployedOperationalUnit = {
            id: row.id,
            name: row.unit_name,
            code: row.unit_code,
            clanId: row.clan_id,
            clanTag: row.clan_tag,
            factionId: row.faction_id,
            coordinates: [Number(row.lng), Number(row.lat)],
            hp: row.hp,
            maxHp: row.max_hp,
            tier: row.tier,
            status: row.status,
            callsign: row.callsign,
            colorHex: row.color_hex,
          };
          operationalUnitsService.deployUnit(unit);
          this.occupiedCells.set(row.cell_key, {
            ...this.occupiedCells.get(row.cell_key),
            unitId: row.id,
          });
        });
      }

      // Estructuras de feudos
      const { data: constructions, error: constError } = await supabase
        .from('tactical_fief_constructions')
        .select('*')
        .eq('region_id', regionId);

      if (constError) {
        throw new Error(`SPATIAL_CONSTRUCTIONS_FETCH_ERROR: ${constError.message}`);
      }

      if (Array.isArray(constructions)) {
        constructions.forEach((row: any) => {
          const building: FiefBuilding = {
            id: row.id,
            fiefId: row.fief_id,
            clanId: row.clan_id,
            buildingType: row.building_type,
            location: [Number(row.lng), Number(row.lat)],
            adjacentRoadSegmentId: row.adjacent_road_segment_id || 'seg-salina-main',
            level: row.level,
            currentHp: row.current_hp,
            maxHp: row.max_hp,
            hourlyUpkeepEc: row.hourly_upkeep_ec,
            efficiencyModifier: 1.0,
            isOperating: true,
            isIsolatedFromSupply: false,
            lastHarvestAt: row.last_harvest_at || row.created_at || new Date().toISOString(),
            createdAt: row.created_at,
          };
          fiefBuildingService.registerBuilding(building);
          this.occupiedCells.set(row.cell_key, {
            ...this.occupiedCells.get(row.cell_key),
            buildingId: row.id,
          });
        });
      }

      this.isHydrated = true;
      this.notifyListeners();
    } catch (hydrateErr) {
      const msg = hydrateErr instanceof Error ? hydrateErr.message : String(hydrateErr);
      throw new Error(`SPATIAL_HYDRATION_ERROR: ${msg}`);
    }
  }

  /**
   * Manejador CDC Realtime para cambios en unidades tácticas.
   */
  private handleDeploymentRealtimeChange(payload: any) {
    const { eventType, new: newRec, old: oldRec } = payload;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (!newRec) return;
      const unit: DeployedOperationalUnit = {
        id: newRec.id,
        name: newRec.unit_name,
        code: newRec.unit_code,
        clanId: newRec.clan_id,
        clanTag: newRec.clan_tag,
        factionId: newRec.faction_id,
        coordinates: [Number(newRec.lng), Number(newRec.lat)],
        hp: newRec.hp,
        maxHp: newRec.max_hp,
        tier: newRec.tier,
        status: newRec.status,
        callsign: newRec.callsign,
        colorHex: newRec.color_hex,
      };
      operationalUnitsService.deployUnit(unit);
      if (newRec.cell_key) {
        this.occupiedCells.set(newRec.cell_key, {
          ...this.occupiedCells.get(newRec.cell_key),
          unitId: unit.id,
        });
      }
      this.notifyListeners();
    } else if (eventType === 'DELETE') {
      if (!oldRec) return;
      if (oldRec.id) operationalUnitsService.removeUnit(oldRec.id);
      if (oldRec.cell_key) {
        const cellData = this.occupiedCells.get(oldRec.cell_key);
        if (cellData) {
          delete cellData.unitId;
          if (!cellData.buildingId) this.occupiedCells.delete(oldRec.cell_key);
        }
      }
      this.notifyListeners();
    }
  }

  /**
   * Manejador CDC Realtime para cambios en construcciones in-situ.
   */
  private handleConstructionRealtimeChange(payload: any) {
    const { eventType, new: newRec, old: oldRec } = payload;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (!newRec) return;
      const building: FiefBuilding = {
        id: newRec.id,
        fiefId: newRec.fief_id,
        clanId: newRec.clan_id,
        buildingType: newRec.building_type,
        location: [Number(newRec.lng), Number(newRec.lat)],
        adjacentRoadSegmentId: newRec.adjacent_road_segment_id || 'seg-salina-main',
        level: newRec.level,
        currentHp: newRec.current_hp,
        maxHp: newRec.max_hp,
        hourlyUpkeepEc: newRec.hourly_upkeep_ec,
        efficiencyModifier: 1.0,
        isOperating: true,
        isIsolatedFromSupply: false,
        lastHarvestAt: newRec.last_harvest_at || new Date().toISOString(),
        createdAt: newRec.created_at,
      };
      fiefBuildingService.registerBuilding(building);
      if (newRec.cell_key) {
        this.occupiedCells.set(newRec.cell_key, {
          ...this.occupiedCells.get(newRec.cell_key),
          buildingId: building.id,
        });
      }
      this.notifyListeners();
    } else if (eventType === 'DELETE') {
      if (!oldRec) return;
      if (oldRec.id) fiefBuildingService.removeBuilding(oldRec.id);
      if (oldRec.cell_key) {
        const cellData = this.occupiedCells.get(oldRec.cell_key);
        if (cellData) {
          delete cellData.buildingId;
          if (!cellData.unitId) this.occupiedCells.delete(oldRec.cell_key);
        }
      }
      this.notifyListeners();
    }
  }

  /**
   * Obtiene la asignación espacial analítica O(1) de cualquier punto en el mapa.
   */
  public getSpatialAssignment(
    lngLat: LngLat,
    gridSize: number = 20,
    zoom: number = ZOOM_TACTICO
  ): SpatialCellAssignment {
    this.ensureSeedOccupiedSynced(gridSize, zoom);
    const { sector, cell } = lngLatToGridCoords(lngLat, gridSize, zoom);
    const centerLngLat = gridCoordsToLngLat(sector, cell, gridSize, zoom);
    const cellKey = this.calculateSpatialCellId(sector, cell);

    // Buscar si hay unidad desplegada en las proximidades de esta coordenada
    const allUnits = operationalUnitsService.getAllUnits();
    const deployedUnit = allUnits.find((u) => {
      const uCoords = lngLatToGridCoords(u.coordinates, gridSize, zoom);
      return (
        uCoords.sector[0] === sector[0] &&
        uCoords.sector[1] === sector[1] &&
        uCoords.cell[0] === cell[0] &&
        uCoords.cell[1] === cell[1]
      );
    });

    // Buscar si hay edificio desplegado en esta coordenada
    const allBuildings = fiefBuildingService.getAllBuildings();
    const deployedBuilding = allBuildings.find((b) => {
      const bCoords = lngLatToGridCoords(b.location, gridSize, zoom);
      return (
        bCoords.sector[0] === sector[0] &&
        bCoords.sector[1] === sector[1] &&
        bCoords.cell[0] === cell[0] &&
        bCoords.cell[1] === cell[1]
      );
    });

    const resolved = this.resolveSectorCellTerrain(sector, cell, gridSize);
    const mapped = mapCanonicalToMicroTerrain(resolved.type);

    let terrainType: MicroTerrainType = mapped.micro;
    let terrainName = mapped.label;
    let defenseCoverPercent = resolved.defenseStars * 10;
    let movementCost = resolved.movementCost;

    if (deployedBuilding) {
      terrainType = 'industrial_compound';
      terrainName = `Zona de Estructura: ${deployedBuilding.buildingType}`;
      defenseCoverPercent = 35;
      movementCost = 1;
    }

    const isDeployable = !deployedUnit;
    const isNaturalImmutable =
      resolved.type === 'mountain' ||
      resolved.type === 'forest' ||
      resolved.type === 'sea' ||
      resolved.type === 'reef' ||
      resolved.type === 'river' ||
      resolved.type === 'shoal';
    const isConstructible = !deployedBuilding && !deployedUnit && !isNaturalImmutable;

    return {
      sector,
      cell,
      centerLngLat,
      formattedCoordinate: `SEC [${sector.join(',')}] • CELL [${cell.join(',')}]`,
      terrainType,
      canonicalTerrain: resolved.type,
      defenseStars: resolved.defenseStars,
      terrainName,
      defenseCoverPercent,
      movementCost,
      deployedUnit,
      deployedBuilding,
      isDeployable,
      isConstructible,
    };
  }

  /**
   * Valida estrictamente qué tipo de infraestructura puede construirse según el terreno
   * (prohíbe aplanar montañas/bosques o rellenar agua; permite puentes sobre río/vado).
   */
  public canConstructBuilding(
    lngLat: [number, number],
    buildingType: string,
    gridSize = 20,
    zoom = 15
  ): { allowed: boolean; reason?: string; resolvedTerrain: string } {
    const info = this.getSpatialAssignment(lngLat, gridSize, zoom);
    const t = info.canonicalTerrain;
    const b = buildingType.trim().toLowerCase();

    if (info.deployedBuilding && b !== 'pipeline') {
      return { allowed: false, reason: 'Celda ocupada por otra estructura.', resolvedTerrain: t };
    }
    if (t === 'sea' || t === 'reef') {
      return { allowed: false, reason: 'PROHIBIDO RELLENAR MAR O ARRECIFES.', resolvedTerrain: t };
    }
    if (t === 'mountain') {
      return { allowed: false, reason: 'PROHIBIDO APLANAR MONTAÑAS.', resolvedTerrain: t };
    }

    if (b === 'bridge') {
      if (t !== 'river' && t !== 'shoal') {
        return { allowed: false, reason: 'PUENTE SOLO SOBRE RÍO O VADO.', resolvedTerrain: t };
      }
      return { allowed: true, resolvedTerrain: t };
    }

    if (b === 'pipeline') {
      if (t !== 'plains' && t !== 'road' && t !== 'river' && t !== 'shoal') {
        return { allowed: false, reason: 'TUBERÍA NO PERMITIDA EN ESTE TERRENO.', resolvedTerrain: t };
      }
      return { allowed: true, resolvedTerrain: t };
    }

    if (b === 'fortification') {
      if (t !== 'plains' && t !== 'forest') {
        return { allowed: false, reason: 'FORTIFICACIÓN SOLO EN LLANURA O BOSQUE.', resolvedTerrain: t };
      }
      return { allowed: true, resolvedTerrain: t };
    }

    if (b === 'port' && t === 'shoal') {
      return { allowed: true, resolvedTerrain: t };
    }

    if (t === 'forest') {
      return { allowed: false, reason: 'PROHIBIDO TALAR/APLANAR BOSQUES.', resolvedTerrain: t };
    }
    if (t !== 'plains') {
      return { allowed: false, reason: `TERRENO NO APTO (${t.toUpperCase()}).`, resolvedTerrain: t };
    }
    return { allowed: true, resolvedTerrain: t };
  }

  /**
   * Despliega una unidad militar en una coordenada espacial concreta.
   */
  public deployUnitAt(input: DeployUnitInput): {
    success: boolean;
    unit?: DeployedOperationalUnit;
    reason?: string;
  } {
    const assignment = this.getSpatialAssignment(input.lngLat);
    if (!assignment.isDeployable) {
      return {
        success: false,
        reason: 'CELDA OCUPADA: Ya existe una unidad militar posicionada en estas coordenadas.',
      };
    }

    const newUnit: DeployedOperationalUnit = {
      id: `unit-dep-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: input.unitName,
      code: input.unitCode,
      clanId: input.clanId,
      clanTag: input.clanTag,
      factionId: input.factionId,
      coordinates: input.lngLat,
      hp: 100,
      maxHp: 100,
      tier: input.tier || 1,
      status: 'holding',
      callsign: input.callsign,
      colorHex:
        input.factionId === 'orange_star'
          ? '#E65100'
          : input.factionId === 'blue_moon'
          ? '#1D4ED8'
          : input.factionId === 'green_earth'
          ? '#15803D'
          : input.factionId === 'yellow_comet'
          ? '#D97706'
          : '#991B1B',
    };

    operationalUnitsService.deployUnit(newUnit);

    const cellKey = this.calculateSpatialCellId(input.sector, input.cell);
    this.occupiedCells.set(cellKey, {
      ...this.occupiedCells.get(cellKey),
      unitId: newUnit.id,
    });

    // Persistencia asíncrona no bloqueante en Supabase
    if (isSupabaseConfigured() && supabase) {
      Promise.resolve(
        supabase
          .from('tactical_spatial_deployments')
          .upsert({
            id: newUnit.id,
            region_id: this.activeRegionId,
            cell_key: cellKey,
            sector_x: input.sector[0],
            sector_y: input.sector[1],
            cell_x: input.cell[0],
            cell_y: input.cell[1],
            lat: input.lngLat[1],
            lng: input.lngLat[0],
            unit_code: input.unitCode,
            unit_name: input.unitName,
            clan_id: input.clanId,
            clan_tag: input.clanTag,
            faction_id: input.factionId,
            callsign: input.callsign,
            tier: input.tier || 1,
            hp: newUnit.hp,
            max_hp: newUnit.maxHp,
            status: newUnit.status,
            color_hex: newUnit.colorHex,
            updated_at: new Date().toISOString(),
          })
      ).then(({ error }: any) => {
        if (error) console.warn('[SpatialDeploymentService] Error persistiendo unidad en Supabase:', error.message);
      }).catch((err: any) => console.warn('[SpatialDeploymentService] Error de red Supabase:', err));
    }

    this.notifyListeners();
    return { success: true, unit: newUnit };
  }

  /**
   * Alias de compatibilidad para contratos del HUD y Playwright.
   */
  public deployTacticalUnit(input: DeployUnitInput) {
    return this.deployUnitAt(input);
  }

  /**
   * Construye una estructura industrial / búnker in-situ en las coordenadas indicadas.
   */
  public constructBuildingAt(input: ConstructBuildingInput): {
    success: boolean;
    building?: FiefBuilding;
    reason?: string;
  } {
    const assignment = this.getSpatialAssignment(input.lngLat);
    if (!assignment.isConstructible) {
      return {
        success: false,
        reason: 'ESPACIO NO DISPONIBLE: No se puede construir sobre una estructura o unidad preexistente.',
      };
    }

    const defaultTreasury = input.treasury || {
      clanId: input.clanId,
      energyCredits: 50000,
    };

    const orderRes = fiefBuildingService.placeBuilding(
      {
        fiefId: input.fiefId || 'fief-cabimas-centro',
        clanId: input.clanId,
        buildingType: input.buildingType,
        location: input.lngLat,
      },
      defaultTreasury
    );

    if (!orderRes.success || !orderRes.building) {
      return {
        success: false,
        reason: orderRes.reason || 'Fallo al autorizar la orden de construcción.',
      };
    }

    const cellKey = this.calculateSpatialCellId(input.sector, input.cell);
    this.occupiedCells.set(cellKey, {
      ...this.occupiedCells.get(cellKey),
      buildingId: orderRes.building.id,
    });

    // Persistencia asíncrona no bloqueante en Supabase
    if (isSupabaseConfigured() && supabase) {
      Promise.resolve(
        supabase
          .from('tactical_fief_constructions')
          .upsert({
            id: orderRes.building.id,
            fief_id: orderRes.building.fiefId,
            region_id: this.activeRegionId,
            cell_key: cellKey,
            sector_x: input.sector[0],
            sector_y: input.sector[1],
            cell_x: input.cell[0],
            cell_y: input.cell[1],
            lat: input.lngLat[1],
            lng: input.lngLat[0],
            building_type: orderRes.building.buildingType,
            clan_id: orderRes.building.clanId,
            adjacent_road_segment_id: orderRes.building.adjacentRoadSegmentId,
            level: orderRes.building.level,
            current_hp: orderRes.building.currentHp,
            max_hp: orderRes.building.maxHp,
            hourly_upkeep_ec: orderRes.building.hourlyUpkeepEc,
            updated_at: new Date().toISOString(),
          })
      ).then(({ error }: any) => {
        if (error) console.warn('[SpatialDeploymentService] Error persistiendo edificio en Supabase:', error.message);
      }).catch((err: any) => console.warn('[SpatialDeploymentService] Error de red Supabase:', err));
    }

    this.notifyListeners();
    return { success: true, building: orderRes.building };
  }

  /**
   * Alias de compatibilidad para contratos del HUD y Playwright.
   */
  public constructTacticalBuilding(input: ConstructBuildingInput) {
    return this.constructBuildingAt(input);
  }

  /**
   * Obtiene o inicializa la malla de 500 micro-celdas (100x100m) de un municipio.
   */
  public getOrCreateMunicipalGrid(
    municipalityId: string,
    stateId: string = this.activeRegionId,
    centerLngLat: [number, number] = [-71.4539, 10.3994],
    initialControllingClanId: string | null = null
  ): MunicipalMicroGrid {
    const existing = this.municipalGrids.get(municipalityId);
    if (existing) return existing;

    const created = initializeMunicipalMicroGrid(
      municipalityId,
      stateId,
      centerLngLat,
      initialControllingClanId
    );
    this.municipalGrids.set(municipalityId, created);
    return created;
  }

  /**
   * Ejecuta un tick de captura por proyección de señal sobre la malla municipal
   * y notifica a los suscriptores del HUD C4ISR.
   */
  public evaluateMunicipalSignalTick(
    municipalityId: string,
    deployedDrones: DroneSignalProjection[],
    tickMinutes: number = 10,
    stateConquestSpeedMultiplier: number = 1.0
  ): SignalCaptureTickResult {
    const grid = this.getOrCreateMunicipalGrid(municipalityId);
    const result = evaluateSignalCaptureTick(
      grid,
      deployedDrones,
      tickMinutes,
      stateConquestSpeedMultiplier
    );
    this.notifyListeners();
    return result;
  }

  /**
   * Inserción o actualización bajo demanda en el Mapa Disperso H3 (Sparse Map).
   */
  public touchSparseHex(
    h3Index: bigint | string,
    patch: Partial<SparseMapHexRecord>
  ): SparseMapHexRecord {
    const key = typeof h3Index === 'bigint' ? h3Index.toString() : h3Index;
    const existing = this.sparseH3Hexes.get(key);
    const next: SparseMapHexRecord = {
      h3Index: key,
      municipalityId: patch.municipalityId ?? existing?.municipalityId ?? 'MUN_ZULIA_CABIMAS',
      terrainType: patch.terrainType ?? existing?.terrainType ?? 'PLAIN',
      hasBridge: patch.hasBridge ?? existing?.hasBridge ?? false,
      ownerCorpId: patch.ownerCorpId !== undefined ? patch.ownerCorpId : (existing?.ownerCorpId ?? null),
      captureProgress: patch.captureProgress ?? existing?.captureProgress ?? 0,
      contestingCorpId:
        patch.contestingCorpId !== undefined
          ? patch.contestingCorpId
          : (existing?.contestingCorpId ?? null),
      lastUpdatedTick: patch.lastUpdatedTick ?? existing?.lastUpdatedTick ?? 0,
      lastActiveTimestampMs: patch.lastActiveTimestampMs ?? Date.now(),
    };
    this.sparseH3Hexes.set(key, next);
    return next;
  }

  public getSparseHex(h3Index: bigint | string): SparseMapHexRecord | undefined {
    const key = typeof h3Index === 'bigint' ? h3Index.toString() : h3Index;
    return this.sparseH3Hexes.get(key);
  }

  public getActiveSparseHexCount(): number {
    return this.sparseH3Hexes.size;
  }

  /**
   * Recolector de basura del Sparse Map: elimina hexágonos neutrales sin progreso
   * que permanecen inactivos por más de 7 días (por defecto).
   */
  public purgeStaleNeutralSparseHexes(
    nowMs: number = Date.now(),
    maxInactiveDays: number = 7
  ): number {
    const cutoffMs = nowMs - maxInactiveDays * 24 * 3600 * 1000;
    let purged = 0;
    for (const [key, hex] of this.sparseH3Hexes.entries()) {
      if (
        hex.ownerCorpId === null &&
        hex.captureProgress === 0 &&
        hex.lastActiveTimestampMs < cutoffMs
      ) {
        this.sparseH3Hexes.delete(key);
        purged++;
      }
    }
    return purged;
  }

  // ============================================================================
  // GEOGRAFÍA PERSISTENTE HÍBRIDA (PROCEDURAL O(1) + SPARSE OVERRIDES)
  // ============================================================================

  private ensureTerrainInitialized(): void {
    if (this.terrainInitialized) return;
    this.terrainInitialized = true;
    this.seedPilotCabimasTerrainOverrides();
  }

  public getSectorKey(sector: [number, number]): string {
    return `${sector[0]}_${sector[1]}`;
  }

  public getTerrainRevision(): number {
    this.ensureTerrainInitialized();
    return this.terrainRevision;
  }

  /**
   * Incrementa atómicamente terrainRevision tras hidratación cartográfica asíncrona
   * (polígonos, ciudades, carreteras) para purgar sectorLruCache, cityBlueprintCache,
   * sectorGeoJsonCache y sectorTextureCache (WebGL GPU).
   */
  public bumpTerrainRevision(options?: {
    clearProceduralCaches?: boolean;
    notify?: boolean;
  }): number {
    this.ensureTerrainInitialized();
    if (options?.clearProceduralCaches !== false) {
      clearGbaPipelineCache();
    }
    this.terrainRevision += 1;
    if (options?.notify !== false) {
      this.notifyListeners();
    }
    return this.terrainRevision;
  }

  /**
   * Hook desacoplado para la futura Fase de Conquista (Supabase RPC claim_or_capture_building):
   * actualiza el ownerId de una propiedad neutral gris -> facción conquistadora e invalida GPU.
   */
  public applyPropertyCaptureOverride(
    sector: [number, number],
    cell: [number, number],
    ownerId: 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | null,
    source: 'map_builder' | 'supabase' = 'supabase'
  ): void {
    const current = this.resolveSectorCellTerrain(sector, cell, 20);
    this.applySectorTerrainDelta({
      sector,
      gridSize: 20,
      source,
      changes: [{ x: cell[0], y: cell[1], type: current.type, ownerId }],
    });
  }

  public getOverriddenSectorsCount(): number {
    this.ensureTerrainInitialized();
    return this.sectorTerrainOverrides.size;
  }

  /**
   * Calcula el terreno base procedural O(1) (0 bytes almacenados) delegando al
   * Pipeline GBA de 6 Etapas con caché LRU acotada.
   */
  public computeProceduralBaseCell(
    sector: [number, number],
    cell: [number, number],
    gridSize: number = 20
  ): TerrainType {
    const { matrix } = generateGbaSectorBlueprint(sector, gridSize);
    return matrix[cell[1]]?.[cell[0]]?.type ?? 'plains';
  }

  /**
   * Resuelve el terreno efectivo (Override disperso ?? Pipeline GBA 6 Etapas O(1)).
   */
  public resolveSectorCellTerrain(
    sector: [number, number],
    cell: [number, number],
    gridSize: number = 20
  ): {
    type: TerrainType;
    defenseStars: number;
    movementCost: number;
    ownerId?: 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | null;
    isOverridden: boolean;
  } {
    this.ensureTerrainInitialized();
    const sectorKey = this.getSectorKey(sector);
    const cellKey = `${cell[0]}_${cell[1]}`;
    const override = this.sectorTerrainOverrides.get(sectorKey)?.cells[cellKey];
    const { matrix } = generateGbaSectorBlueprint(sector, gridSize);
    const baseTile = matrix[cell[1]]?.[cell[0]];
    const type = override?.type ?? baseTile?.type ?? 'plains';
    const defenseStars = override?.defenseStars ?? baseTile?.defenseStars ?? getTerrainDefenseStars(type);
    return {
      type,
      defenseStars,
      movementCost: getTerrainMovementCost(type),
      ownerId: (override?.ownerId ?? baseTile?.ownerId ?? null) as 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | null,
      isOverridden: Boolean(override),
    };
  }

  /**
   * Genera la matriz 20x20 completa para MapBuilder o el renderizador WebGL del viewport.
   */
  public getSectorTerrainMatrix(
    sector: [number, number],
    gridSize: number = 20
  ): TerrainTile[][] {
    this.ensureTerrainInitialized();
    const { matrix } = generateGbaSectorBlueprint(sector, gridSize);
    const overrides = this.sectorTerrainOverrides.get(this.getSectorKey(sector))?.cells;
    if (!overrides) return matrix;

    for (const ov of Object.values(overrides)) {
      if (ov.y >= 0 && ov.y < gridSize && ov.x >= 0 && ov.x < gridSize) {
        matrix[ov.y][ov.x] = {
          x: ov.x,
          y: ov.y,
          type: ov.type,
          defenseStars: ov.defenseStars ?? getTerrainDefenseStars(ov.type),
          ownerId: ov.ownerId ?? null,
        };
      }
    }
    return matrix;
  }

  /**
   * Aplica un delta disperso desde el Editor de Mapas. Solo persiste celdas distintas
   * de la base procedural; si todas coinciden, libera el sector (0 bytes).
   */
  public applySectorTerrainDelta(delta: SectorTerrainDelta): SectorTerrainOverride | null {
    this.ensureTerrainInitialized();
    const gridSize = delta.gridSize ?? 20;
    const sectorKey = this.getSectorKey(delta.sector);
    const existing = this.sectorTerrainOverrides.get(sectorKey);
    const nextCells: Record<string, SectorCellTerrainOverride> = {
      ...(existing?.cells ?? {}),
    };

    for (const change of delta.changes) {
      if (change.x < 0 || change.x >= gridSize || change.y < 0 || change.y >= gridSize) continue;
      const cellKey = `${change.x}_${change.y}`;
      const baseType = this.computeProceduralBaseCell(delta.sector, [change.x, change.y], gridSize);
      if (change.type === baseType && !change.ownerId) {
        delete nextCells[cellKey];
      } else {
        nextCells[cellKey] = {
          x: change.x,
          y: change.y,
          type: change.type,
          ownerId: change.ownerId ?? null,
          defenseStars: change.defenseStars ?? getTerrainDefenseStars(change.type),
        };
      }
    }

    if (Object.keys(nextCells).length === 0) {
      this.sectorTerrainOverrides.delete(sectorKey);
      this.terrainRevision += 1;
      this.notifyListeners();
      return null;
    }

    const record: SectorTerrainOverride = {
      sectorKey,
      sector: delta.sector,
      gridSize,
      cells: nextCells,
      updatedAt: new Date().toISOString(),
      source: delta.source ?? 'map_builder',
    };
    this.sectorTerrainOverrides.set(sectorKey, record);
    this.terrainRevision += 1;
    this.notifyListeners();
    return record;
  }

  public resetSectorOverrides(sector: [number, number]): void {
    this.ensureTerrainInitialized();
    const sectorKey = this.getSectorKey(sector);
    if (this.sectorTerrainOverrides.delete(sectorKey)) {
      this.terrainRevision += 1;
      this.notifyListeners();
    }
  }

  /**
   * Retorna el clima efectivo del sector (override manual o clima determinista del pipeline GBA).
   */
  public getSectorWeather(
    sector: [number, number],
    gridSize: number = 20
  ): WeatherCondition {
    const sectorKey = this.getSectorKey(sector);
    const override = this.sectorWeatherOverrides.get(sectorKey);
    if (override) return override;
    const { blueprint } = generateGbaSectorBlueprint(sector, gridSize);
    return blueprint.weather ?? 'clear';
  }

  /**
   * Establece o limpia un override de clima para un sector y notifica a los suscriptores.
   */
  public setSectorWeatherOverride(
    sector: [number, number],
    weather: WeatherCondition | null
  ): void {
    const sectorKey = this.getSectorKey(sector);
    if (weather === null) {
      this.sectorWeatherOverrides.delete(sectorKey);
    } else {
      this.sectorWeatherOverrides.set(sectorKey, weather);
    }
    this.terrainRevision += 1;
    this.notifyListeners();
  }

  private seedPilotCabimasTerrainOverrides(): void {
    // Overrides dispersos mínimos compatibles con el Motor Paramétrico GBA:
    // INVARIANTE DE NEUTRALIDAD GRIS: toda propiedad sembrada inicialmente nace con ownerId: null (gris neutral).

    // 1. Sector [9878, 15432]: Costa Occidental Real de Cabimas / Punta Icotea
    this.applySectorTerrainDeltaRaw(
      [9878, 15432],
      [
        { x: 16, y: 10, type: 'port', ownerId: null },
      ],
      'pilot_seed'
    );

    // 2. Sector [9879, 15432]: Corredor La Salina (Tierra Firme)
    this.applySectorTerrainDeltaRaw(
      [9879, 15432],
      [
        { x: 13, y: 11, type: 'city', ownerId: null },
        { x: 16, y: 8, type: 'commtower', ownerId: null },
      ],
      'pilot_seed'
    );

    // 3. Sector [9880, 15432]: Polígono Principal de Cabimas
    this.applySectorTerrainDeltaRaw(
      [9880, 15432],
      [
        { x: 0, y: 11, type: 'forest' }, // Garantiza cobertura 20% en centro ancla Test 1.2
        { x: 1, y: 4, type: 'port', ownerId: null }, // Puerto táctico neutral gris Test 6.1
        { x: 18, y: 2, type: 'hq', ownerId: null }, // HQ neutral gris esperando conquista
      ],
      'pilot_seed'
    );

    // 4. Sector [9881, 15432]: Flanco Oriental — Puesto Avanzado Orinoco (Neutral Gris)
    this.applySectorTerrainDeltaRaw(
      [9881, 15432],
      [
        { x: 15, y: 8, type: 'hq', ownerId: null }, // HQ neutral gris (4★) Test 6.1
        { x: 13, y: 8, type: 'factory', ownerId: null },
        { x: 15, y: 4, type: 'airport', ownerId: null },
      ],
      'pilot_seed'
    );
  }

  private applySectorTerrainDeltaRaw(
    sector: [number, number],
    changes: SectorCellTerrainOverride[],
    source: 'map_builder' | 'pilot_seed' | 'supabase'
  ): void {
    const sectorKey = this.getSectorKey(sector);
    const cells: Record<string, SectorCellTerrainOverride> = {};
    for (const c of changes) {
      cells[`${c.x}_${c.y}`] = {
        ...c,
        ownerId: c.ownerId ?? null,
        defenseStars: c.defenseStars ?? getTerrainDefenseStars(c.type),
      };
    }
    this.sectorTerrainOverrides.set(sectorKey, {
      sectorKey,
      sector,
      gridSize: 20,
      cells,
      updatedAt: new Date().toISOString(),
      source,
    });
  }

  public subscribe(listener: SpatialChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('[SpatialDeploymentService] Error en suscriptor:', e);
      }
    });
  }
}

export const spatialDeploymentService = new SpatialDeploymentService();
