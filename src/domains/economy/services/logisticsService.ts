import { supabase, isSupabaseConfigured } from '@shared';
import type { Database, Json } from '@shared';

export type DbInfraEdgeRecord = Database['public']['Tables']['infra_edges']['Row'];
export type DbVulnerabilityWindowRecord = Database['public']['Tables']['vulnerability_windows']['Row'];

export interface ViewportBBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const DEFAULT_VIEWPORT_BBOX: ViewportBBox = {
  minLat: -90,
  maxLat: 90,
  minLng: -180,
  maxLng: 180,
};

const VIEWPORT_CACHE_MAX_ENTRIES = 24;
const VIEWPORT_CACHE_TTL_MS = 15_000;

interface ViewportCacheEntry<T> {
  expiresAt: number;
  data: T[];
}

const infraEdgesViewportCache = new Map<string, ViewportCacheEntry<DbInfraEdgeRecord>>();

function normalizeAndRoundBBox(bbox: ViewportBBox): ViewportBBox {
  const rawMinLat = Math.max(-90, Math.min(bbox.minLat, bbox.maxLat));
  const rawMaxLat = Math.min(90, Math.max(bbox.minLat, bbox.maxLat));
  const rawMinLng = Math.max(-180, Math.min(bbox.minLng, bbox.maxLng));
  const rawMaxLng = Math.min(180, Math.max(bbox.minLng, bbox.maxLng));
  return {
    minLat: Math.floor(rawMinLat * 100) / 100,
    maxLat: Math.ceil(rawMaxLat * 100) / 100,
    minLng: Math.floor(rawMinLng * 100) / 100,
    maxLng: Math.ceil(rawMaxLng * 100) / 100,
  };
}

function getCachedViewport<T>(cache: Map<string, ViewportCacheEntry<T>>, key: string): T[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function setCachedViewport<T>(cache: Map<string, ViewportCacheEntry<T>>, key: string, data: T[]): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= VIEWPORT_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + VIEWPORT_CACHE_TTL_MS, data });
}

export function clearInfraEdgesViewportCache(): void {
  infraEdgesViewportCache.clear();
}

function assertDb() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED: Conexión a base de datos requerida.');
  }
  return supabase;
}

export async function collectHousingCitizens(
  buildingId: string,
  corpId: string,
  spawnAsUnit = false
): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('collect_housing_citizens', {
    p_building_id: buildingId,
    p_corp_id: corpId,
    p_spawn_as_unit: spawnAsUnit,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function recruitAndDeployUnit(params: {
  corpId: string;
  buildingId: string;
  unitCode: string;
  tier?: number;
  targetH3Index?: number;
  personalContribution?: number;
}): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('recruit_and_deploy_unit', {
    p_corp_id: params.corpId,
    p_building_id: params.buildingId,
    p_unit_code: params.unitCode,
    p_tier: params.tier ?? 1,
    p_target_h3_index: params.targetH3Index,
    p_personal_contribution: params.personalContribution ?? 0,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function syncPipelineLogistics(corpId: string): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('sync_pipeline_logistics', {
    p_corp_id: corpId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function repairInfrastructure(
  targetKind: 'building' | 'edge',
  targetId: string,
  corpId: string
): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('repair_infrastructure', {
    p_target_kind: targetKind,
    p_target_id: targetId,
    p_corp_id: corpId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearInfraEdgesViewportCache();
  return data;
}

export async function createInfraEdge(params: {
  corpId: string;
  edgeType: 'pipeline' | 'road' | 'bridge';
  fromH3: number;
  toH3: number;
  fromBuildingId?: string | null;
  toBuildingId?: string | null;
  usePersonalTopup?: boolean;
}): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('create_infra_edge', {
    p_corp_id: params.corpId,
    p_edge_type: params.edgeType,
    p_from_h3: params.fromH3,
    p_to_h3: params.toH3,
    p_from_building_id: params.fromBuildingId ?? null,
    p_to_building_id: params.toBuildingId ?? null,
    p_use_personal_topup: Boolean(params.usePersonalTopup),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearInfraEdgesViewportCache();
  return data;
}

export async function executeCollectorHaul(params: {
  unitId: string;
  extractorBuildingId?: string | null;
  depotBuildingId?: string | null;
}): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('execute_collector_haul', {
    p_unit_id: params.unitId,
    p_extractor_building_id: params.extractorBuildingId ?? null,
    p_depot_building_id: params.depotBuildingId ?? null,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function triggerVulnerabilityHandshake(params: {
  municipalityId: string;
  attackerCorpId: string;
  defenderCorpId?: string | null;
  windowDurationSec?: number;
}): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('trigger_vulnerability_handshake', {
    p_municipality_id: params.municipalityId,
    p_attacker_corp_id: params.attackerCorpId,
    p_defender_corp_id: params.defenderCorpId ?? null,
    p_window_duration_sec: params.windowDurationSec ?? 1800,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function damageInfrastructure(params: {
  targetKind: 'building' | 'edge';
  targetId: string;
  attackerCorpId: string;
  damage?: number;
  bypassHandshakeInSimulation?: boolean;
}): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('damage_infrastructure', {
    p_target_kind: params.targetKind,
    p_target_id: params.targetId,
    p_attacker_corp_id: params.attackerCorpId,
    p_damage: params.damage ?? 10,
    p_bypass_handshake_in_simulation: Boolean(params.bypassHandshakeInSimulation),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearInfraEdgesViewportCache();
  return data;
}

function isSpatialRpcEnabled(): boolean {
  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, string | undefined>);
  return env.VITE_ENABLE_SPATIAL_RPC === 'true';
}

export async function fetchInfraEdgesInViewport(
  bbox: ViewportBBox,
  corpId?: string | null,
  limit = 400
): Promise<DbInfraEdgeRecord[]> {
  if (!isSupabaseConfigured() || !supabase || !isSpatialRpcEnabled()) return [];

  const rounded = normalizeAndRoundBBox(bbox);
  const clampedLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const normalizedCorpId = corpId && corpId.trim().length > 0 ? corpId.trim() : null;
  const cacheKey = `${rounded.minLat},${rounded.maxLat},${rounded.minLng},${rounded.maxLng}|${normalizedCorpId ?? 'ALL'}|${clampedLimit}`;

  const cached = getCachedViewport(infraEdgesViewportCache, cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase.rpc('get_infra_edges_in_viewport', {
    p_min_lat: rounded.minLat,
    p_max_lat: rounded.maxLat,
    p_min_lng: rounded.minLng,
    p_max_lng: rounded.maxLng,
    p_corp_id: normalizedCorpId,
    p_limit: clampedLimit,
  });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DbInfraEdgeRecord[];
  setCachedViewport(infraEdgesViewportCache, cacheKey, rows);
  return rows;
}

export async function fetchInfraEdges(
  corpId?: string | null,
  bbox?: ViewportBBox,
  limit = 400
): Promise<DbInfraEdgeRecord[]> {
  return fetchInfraEdgesInViewport(bbox ?? DEFAULT_VIEWPORT_BBOX, corpId, limit);
}

export async function fetchVulnerabilityWindows(
  municipalityId?: string | null
): Promise<DbVulnerabilityWindowRecord[]> {
  if (!isSupabaseConfigured() || !supabase) return [];
  let query = supabase
    .from('vulnerability_windows')
    .select('*')
    .in('status', ['handshake', 'active'])
    .order('handshake_started_at', { ascending: false })
    .limit(100);
  if (municipalityId) {
    query = query.eq('municipality_id', municipalityId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as DbVulnerabilityWindowRecord[];
}

// ==============================================================================
// MOTOR DETERMINISTA LOCAL: LOGÍSTICA DUAL & DEVASTACIÓN / REPARACIÓN
// ==============================================================================

export interface DualSimBuilding {
  id: string;
  corpId: string | null;
  buildingType: string;
  h3Index: number;
  level: number;
  hp: number;
  maxHp: number;
  infraState: 'OPERATIONAL' | 'DAMAGED' | 'RUINED';
  isHistorical: boolean;
  storageCap: number;
  stored: { alloys: number; fuel: number; chips: number };
  isProductionHalted: boolean;
}

export interface DualSimEdge {
  id: string;
  corpId: string | null;
  edgeType: 'pipeline' | 'road' | 'bridge';
  fromH3: number;
  toH3: number;
  hp: number;
  maxHp: number;
  status: 'operational' | 'severed';
}

export interface DualSimCollector {
  id: string;
  corpId: string;
  unitRole: 'collector' | 'combat' | 'citizen';
  h3Index: number;
  cargoCap: number;
  sourceBuildingId?: string | null;
  depotBuildingId?: string | null;
}

export interface DualLogisticsTickResult {
  buildings: DualSimBuilding[];
  collectors: DualSimCollector[];
  treasuryDelta: { alloys: number; fuel: number; chips: number };
  pipedExtractorIds: string[];
  haltedExtractorIds: string[];
  hauledExtractorIds: string[];
}

const SIM_BUILDING_COSTS: Record<string, { costEc: number; costAlloys: number }> = {
  factory: { costEc: 600, costAlloys: 25 },
  barracks: { costEc: 600, costAlloys: 25 },
  war_factory: { costEc: 600, costAlloys: 25 },
  extractor: { costEc: 450, costAlloys: 15 },
  foundry: { costEc: 450, costAlloys: 15 },
  refinery: { costEc: 450, costAlloys: 15 },
  mine: { costEc: 450, costAlloys: 15 },
  airport: { costEc: 800, costAlloys: 35 },
  port: { costEc: 800, costAlloys: 35 },
  radar: { costEc: 800, costAlloys: 35 },
  hq: { costEc: 800, costAlloys: 35 },
  housing: { costEc: 120, costAlloys: 15 },
  depot: { costEc: 160, costAlloys: 25 },
  fortification: { costEc: 140, costAlloys: 25 },
  road: { costEc: 30, costAlloys: 5 },
  bridge: { costEc: 90, costAlloys: 20 },
  pipeline: { costEc: 60, costAlloys: 12 },
};

export function simulateDualLogisticsTick(params: {
  corpId: string;
  buildings: DualSimBuilding[];
  edges: DualSimEdge[];
  collectors?: DualSimCollector[];
  elapsedHours?: number;
}): DualLogisticsTickResult {
  const elapsed = Math.min(16, Math.max(0, params.elapsedHours ?? 1));
  const nextBuildings = params.buildings.map((b) => ({ ...b, stored: { ...b.stored } }));
  const nextCollectors = (params.collectors ?? []).map((c) => ({ ...c }));

  const pipeReachableH3 = new Set<number>();
  const queue: number[] = [];

  for (const b of nextBuildings) {
    if (
      b.corpId === params.corpId &&
      (b.buildingType === 'depot' || b.buildingType === 'hq') &&
      b.infraState === 'OPERATIONAL'
    ) {
      pipeReachableH3.add(b.h3Index);
      queue.push(b.h3Index);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const edge of params.edges) {
      if (
        edge.corpId === params.corpId &&
        edge.edgeType === 'pipeline' &&
        edge.status === 'operational'
      ) {
        if (edge.fromH3 === curr && !pipeReachableH3.has(edge.toH3)) {
          pipeReachableH3.add(edge.toH3);
          queue.push(edge.toH3);
        } else if (edge.toH3 === curr && !pipeReachableH3.has(edge.fromH3)) {
          pipeReachableH3.add(edge.fromH3);
          queue.push(edge.fromH3);
        }
      }
    }
  }

  const treasuryDelta = { alloys: 0, fuel: 0, chips: 0 };
  const pipedExtractorIds: string[] = [];
  const haltedExtractorIds: string[] = [];
  const hauledExtractorIds: string[] = [];

  for (const b of nextBuildings) {
    if (b.corpId !== params.corpId || b.buildingType !== 'extractor' || b.infraState === 'RUINED') {
      continue;
    }
    const mult = 1 + (Math.max(1, Math.min(5, b.level)) - 1) * 0.35;
    const prodAlloys = Math.floor(18 * mult * elapsed);
    const prodFuel = Math.floor(12 * mult * elapsed);
    const prodChips = Math.floor(6 * mult * elapsed);

    if (pipeReachableH3.has(b.h3Index)) {
      treasuryDelta.alloys += b.stored.alloys + prodAlloys;
      treasuryDelta.fuel += b.stored.fuel + prodFuel;
      treasuryDelta.chips += b.stored.chips + prodChips;
      b.stored = { alloys: 0, fuel: 0, chips: 0 };
      b.isProductionHalted = false;
      pipedExtractorIds.push(b.id);
    } else {
      const cap = Math.max(1, b.storageCap || 250);
      const curSum = b.stored.alloys + b.stored.fuel + b.stored.chips;
      let room = Math.max(0, cap - curSum);
      if (!b.isProductionHalted && room > 0) {
        const addA = Math.min(room, prodAlloys);
        room -= addA;
        const addF = Math.min(room, prodFuel);
        room -= addF;
        const addC = Math.min(room, prodChips);
        b.stored.alloys += addA;
        b.stored.fuel += addF;
        b.stored.chips += addC;
      }
      const nextSum = b.stored.alloys + b.stored.fuel + b.stored.chips;
      b.isProductionHalted = nextSum >= cap;
      if (b.isProductionHalted) haltedExtractorIds.push(b.id);
    }
  }

  const operationalDepot = nextBuildings.find(
    (b) => b.corpId === params.corpId && (b.buildingType === 'depot' || b.buildingType === 'hq') && b.infraState === 'OPERATIONAL'
  );

  for (const col of nextCollectors) {
    if (col.corpId !== params.corpId || col.unitRole !== 'collector' || !operationalDepot) continue;
    const ext =
      nextBuildings.find((b) => b.id === col.sourceBuildingId) ??
      nextBuildings.find(
        (b) =>
          b.corpId === params.corpId &&
          b.buildingType === 'extractor' &&
          b.infraState !== 'RUINED' &&
          b.stored.alloys + b.stored.fuel + b.stored.chips > 0
      );
    if (!ext) continue;

    let cap = Math.max(50, col.cargoCap || 150);
    const takeA = Math.min(ext.stored.alloys, cap);
    cap -= takeA;
    const takeF = Math.min(ext.stored.fuel, cap);
    cap -= takeF;
    const takeC = Math.min(ext.stored.chips, cap);

    ext.stored.alloys -= takeA;
    ext.stored.fuel -= takeF;
    ext.stored.chips -= takeC;
    const rem = ext.stored.alloys + ext.stored.fuel + ext.stored.chips;
    ext.isProductionHalted = rem >= Math.max(1, ext.storageCap || 250);

    treasuryDelta.alloys += takeA;
    treasuryDelta.fuel += takeF;
    treasuryDelta.chips += takeC;
    col.h3Index = operationalDepot.h3Index;
    col.sourceBuildingId = ext.id;
    col.depotBuildingId = operationalDepot.id;
    hauledExtractorIds.push(ext.id);
  }

  return {
    buildings: nextBuildings,
    collectors: nextCollectors,
    treasuryDelta,
    pipedExtractorIds,
    haltedExtractorIds: nextBuildings
      .filter((b) => b.corpId === params.corpId && b.buildingType === 'extractor' && b.isProductionHalted)
      .map((b) => b.id),
    hauledExtractorIds,
  };
}

export function simulateInfrastructureDamageAndRepair(params: {
  action: 'damage' | 'repair';
  actorCorpId: string;
  building?: DualSimBuilding;
  edge?: DualSimEdge;
  damage?: number;
  nowMs?: number;
  windowActiveFromMs?: number;
  windowExpiresAtMs?: number;
  bypassHandshakeInSimulation?: boolean;
}): {
  ok: boolean;
  reason?: string;
  building?: DualSimBuilding;
  edge?: DualSimEdge;
  lootTechScrapEc: number;
  lootAlloys: number;
  repairCostEc: number;
  repairCostAlloys: number;
} {
  const nowMs = params.nowMs ?? Date.now();

  if (params.action === 'damage') {
    const ownerCorp = params.building ? params.building.corpId : params.edge?.corpId;
    if (ownerCorp === params.actorCorpId) {
      return {
        ok: false,
        reason: 'FRIENDLY_FIRE_PROHIBITED',
        lootTechScrapEc: 0,
        lootAlloys: 0,
        repairCostEc: 0,
        repairCostAlloys: 0,
      };
    }

    if (ownerCorp && !params.bypassHandshakeInSimulation) {
      const activeFrom = params.windowActiveFromMs ?? Infinity;
      const expiresAt = params.windowExpiresAtMs ?? 0;
      if (nowMs < activeFrom || nowMs >= expiresAt) {
        return {
          ok: false,
          reason: 'VULNERABILITY_HANDSHAKE_REQUIRED',
          lootTechScrapEc: 0,
          lootAlloys: 0,
          repairCostEc: 0,
          repairCostAlloys: 0,
        };
      }
    }

    const dmg = Math.max(0.1, params.damage ?? 10);

    if (params.building) {
      const b = { ...params.building, stored: { ...params.building.stored } };
      const spec = SIM_BUILDING_COSTS[b.buildingType] ?? { costEc: 100, costAlloys: 10 };
      const newHp = Math.max(0, b.hp - dmg);
      const newState: DualSimBuilding['infraState'] =
        newHp <= 0 ? 'RUINED' : newHp < b.maxHp ? 'DAMAGED' : 'OPERATIONAL';
      const becameRuined = newState === 'RUINED' && b.infraState !== 'RUINED';
      b.hp = newHp;
      b.infraState = newState;
      if (newState === 'RUINED') b.isProductionHalted = true;
      return {
        ok: true,
        building: b,
        lootTechScrapEc: becameRuined ? Math.floor(spec.costEc * b.level * 0.35) : 0,
        lootAlloys: becameRuined ? Math.floor(spec.costAlloys * b.level * 0.35) : 0,
        repairCostEc: 0,
        repairCostAlloys: 0,
      };
    }

    if (params.edge) {
      const e = { ...params.edge };
      const spec = SIM_BUILDING_COSTS[e.edgeType] ?? { costEc: 60, costAlloys: 12 };
      const newHp = Math.max(0, e.hp - dmg);
      const newStatus: DualSimEdge['status'] = newHp <= 0 ? 'severed' : 'operational';
      const becameSevered = newStatus === 'severed' && e.status !== 'severed';
      e.hp = newHp;
      e.status = newStatus;
      return {
        ok: true,
        edge: e,
        lootTechScrapEc: becameSevered ? Math.floor(spec.costEc * 0.35) : 0,
        lootAlloys: becameSevered ? Math.floor(spec.costAlloys * 0.35) : 0,
        repairCostEc: 0,
        repairCostAlloys: 0,
      };
    }
  }

  // action === 'repair'
  if (params.building) {
    const b = { ...params.building, stored: { ...params.building.stored } };
    const spec = SIM_BUILDING_COSTS[b.buildingType] ?? { costEc: 100, costAlloys: 10 };
    b.hp = b.maxHp;
    b.infraState = 'OPERATIONAL';
    b.isProductionHalted = false;
    return {
      ok: true,
      building: b,
      lootTechScrapEc: 0,
      lootAlloys: 0,
      repairCostEc: Math.max(1, Math.floor(spec.costEc * b.level * 0.35)),
      repairCostAlloys: Math.floor(spec.costAlloys * b.level * 0.35),
    };
  }

  if (params.edge) {
    const e = { ...params.edge };
    const spec = SIM_BUILDING_COSTS[e.edgeType] ?? { costEc: 60, costAlloys: 12 };
    e.hp = e.maxHp;
    e.status = 'operational';
    return {
      ok: true,
      edge: e,
      lootTechScrapEc: 0,
      lootAlloys: 0,
      repairCostEc: Math.max(1, Math.floor(spec.costEc * 0.35)),
      repairCostAlloys: Math.floor(spec.costAlloys * 0.35),
    };
  }

  return {
    ok: false,
    reason: 'TARGET_REQUIRED',
    lootTechScrapEc: 0,
    lootAlloys: 0,
    repairCostEc: 0,
    repairCostAlloys: 0,
  };
}
