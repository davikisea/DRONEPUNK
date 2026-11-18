import { supabase, isSupabaseConfigured, latLngToH3Res9 } from '@shared';
import type { Json } from '@shared';

export interface DbBuildingRecord {
  id: string;
  h3_index: number;
  municipality_id: string | null;
  owner_user_id: string | null;
  corp_id: string | null;
  building_type: string;
  level: number;
  hp: number;
  stored_resources: Json;
  tax_rate: number;
  is_disabled: boolean;
  last_collected_at: string;
  created_at: string;
  updated_at: string;
  is_historical?: boolean;
  infra_state?: 'OPERATIONAL' | 'DAMAGED' | 'RUINED' | string;
  max_hp?: number;
  base_terrain?: string;
  storage_cap?: number;
  is_production_halted?: boolean;
  ruined_at?: string | null;
  lat?: number | null;
  lng?: number | null;
}

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

const buildingsViewportCache = new Map<string, ViewportCacheEntry<DbBuildingRecord>>();

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

export function clearBuildingsViewportCache(): void {
  buildingsViewportCache.clear();
}

interface HistoricalCityBaseSpec {
  id: string;
  municipality_id: string;
  city_name: string;
  building_type: 'hq' | 'factory' | 'port' | 'airport';
  lat: number;
  lng: number;
  base_terrain: string;
}

const HISTORICAL_CITY_BASE_SPECS: HistoricalCityBaseSpec[] = [
  { id: 'hist-caracas-hq', municipality_id: 'MUN_DC_CARACAS', city_name: 'Caracas', building_type: 'hq', lat: 10.4806, lng: -66.9036, base_terrain: 'city' },
  { id: 'hist-caracas-fac', municipality_id: 'MUN_DC_CARACAS', city_name: 'Caracas', building_type: 'factory', lat: 10.4806, lng: -66.8996, base_terrain: 'plains' },
  { id: 'hist-maracaibo-hq', municipality_id: 'MUN_ZULIA_MARACAIBO', city_name: 'Maracaibo', building_type: 'hq', lat: 10.6544, lng: -71.6406, base_terrain: 'city' },
  { id: 'hist-maracaibo-port', municipality_id: 'MUN_ZULIA_MARACAIBO', city_name: 'Maracaibo', building_type: 'port', lat: 10.6544, lng: -71.6366, base_terrain: 'shoal' },
  { id: 'hist-sanfrancisco-fac', municipality_id: 'MUN_ZULIA_SAN_FRANCISCO', city_name: 'San Francisco', building_type: 'factory', lat: 10.5517, lng: -71.6344, base_terrain: 'city' },
  { id: 'hist-cabimas-hq', municipality_id: 'MUN_ZULIA_CABIMAS', city_name: 'Cabimas', building_type: 'hq', lat: 10.3994, lng: -71.4539, base_terrain: 'city' },
  { id: 'hist-cabimas-fac', municipality_id: 'MUN_ZULIA_CABIMAS', city_name: 'Cabimas', building_type: 'factory', lat: 10.3994, lng: -71.4499, base_terrain: 'plains' },
  { id: 'hist-cabimas-port', municipality_id: 'MUN_ZULIA_CABIMAS', city_name: 'Cabimas', building_type: 'port', lat: 10.395, lng: -71.458, base_terrain: 'shoal' },
  { id: 'hist-santarita-port', municipality_id: 'MUN_ZULIA_SANTA_RITA', city_name: 'Santa Rita', building_type: 'port', lat: 10.5364, lng: -71.5117, base_terrain: 'shoal' },
  { id: 'hist-altagracia-port', municipality_id: 'MUN_ZULIA_MIRANDA', city_name: 'Los Puertos de Altagracia', building_type: 'port', lat: 10.6744, lng: -71.5228, base_terrain: 'shoal' },
  { id: 'hist-ojeda-fac', municipality_id: 'MUN_ZULIA_LAGUNILLAS', city_name: 'Ciudad Ojeda', building_type: 'factory', lat: 10.2078, lng: -71.3087, base_terrain: 'city' },
  { id: 'hist-bachaquero-fac', municipality_id: 'MUN_ZULIA_VALMORE_RODRIGUEZ', city_name: 'Bachaquero', building_type: 'factory', lat: 9.9694, lng: -71.1494, base_terrain: 'plains' },
  { id: 'hist-menegrande-fac', municipality_id: 'MUN_ZULIA_BARALT', city_name: 'Mene Grande', building_type: 'factory', lat: 9.8167, lng: -70.9253, base_terrain: 'plains' },
  { id: 'hist-tiajuana-fac', municipality_id: 'MUN_ZULIA_SIMON_BOLIVAR', city_name: 'Tía Juana', building_type: 'factory', lat: 10.2583, lng: -71.3667, base_terrain: 'plains' },
  { id: 'hist-machiques-hq', municipality_id: 'MUN_ZULIA_MACHIQUES_DE_PERIJA', city_name: 'Machiques', building_type: 'hq', lat: 10.0644, lng: -72.545, base_terrain: 'city' },
  { id: 'hist-sancarlos-fac', municipality_id: 'MUN_ZULIA_COLON', city_name: 'San Carlos del Zulia', building_type: 'factory', lat: 9.0, lng: -71.9136, base_terrain: 'city' },
  { id: 'hist-valencia-hq', municipality_id: 'MUN_CARABOBO_VALENCIA', city_name: 'Valencia', building_type: 'hq', lat: 10.162, lng: -68.0077, base_terrain: 'city' },
  { id: 'hist-valencia-fac', municipality_id: 'MUN_CARABOBO_VALENCIA', city_name: 'Valencia', building_type: 'factory', lat: 10.162, lng: -68.0037, base_terrain: 'plains' },
  { id: 'hist-barquisimeto-fac', municipality_id: 'MUN_LARA_IRIBARREN', city_name: 'Barquisimeto', building_type: 'factory', lat: 10.0647, lng: -69.3228, base_terrain: 'city' },
  { id: 'hist-maracay-air', municipality_id: 'MUN_ARAGUA_GIRARDOT', city_name: 'Maracay', building_type: 'airport', lat: 10.2469, lng: -67.5958, base_terrain: 'plains' },
  { id: 'hist-plc-port', municipality_id: 'MUN_ANZOATEGUI_SOTILLO', city_name: 'Puerto La Cruz', building_type: 'port', lat: 10.2189, lng: -64.6344, base_terrain: 'shoal' },
  { id: 'hist-guayana-fac', municipality_id: 'MUN_BOLIVAR_CARONI', city_name: 'Ciudad Guayana', building_type: 'factory', lat: 8.3077, lng: -62.7118, base_terrain: 'city' },
  { id: 'hist-sancristobal-hq', municipality_id: 'MUN_TACHIRA_SAN_CRISTOBAL', city_name: 'San Cristóbal', building_type: 'hq', lat: 7.7669, lng: -72.225, base_terrain: 'city' },
  { id: 'hist-merida-air', municipality_id: 'MUN_MERIDA_LIBERTADOR', city_name: 'Mérida', building_type: 'airport', lat: 8.5983, lng: -71.145, base_terrain: 'plains' },
  { id: 'hist-coro-port', municipality_id: 'MUN_FALCON_MIRANDA', city_name: 'Coro', building_type: 'port', lat: 11.4045, lng: -69.6734, base_terrain: 'shoal' },
  { id: 'hist-maturin-fac', municipality_id: 'MUN_MONAGAS_MATURIN', city_name: 'Maturín', building_type: 'factory', lat: 9.7456, lng: -63.1767, base_terrain: 'plains' },
  { id: 'hist-barinas-fac', municipality_id: 'MUN_BARINAS_BARINAS', city_name: 'Barinas', building_type: 'factory', lat: 8.6226, lng: -70.2075, base_terrain: 'plains' },
  { id: 'hist-laguaira-port', municipality_id: 'MUN_LA_GUAIRA_VARGAS', city_name: 'La Guaira', building_type: 'port', lat: 10.6017, lng: -66.9322, base_terrain: 'shoal' },
];

export const HISTORICAL_CITY_BASES_SEED: DbBuildingRecord[] = HISTORICAL_CITY_BASE_SPECS.map((spec) => {
  const epochIso = '2026-11-18T00:00:00.000Z';
  return {
    id: spec.id,
    h3_index: Number(latLngToH3Res9(spec.lat, spec.lng)),
    municipality_id: spec.municipality_id,
    owner_user_id: null,
    corp_id: null,
    building_type: spec.building_type,
    level: 2,
    hp: 30,
    max_hp: 30,
    stored_resources: { alloys: 0, fuel: 0, chips: 0 },
    tax_rate: 0.1,
    is_disabled: false,
    is_historical: true,
    infra_state: 'OPERATIONAL',
    base_terrain: spec.base_terrain,
    storage_cap: 500,
    is_production_halted: false,
    ruined_at: null,
    last_collected_at: epochIso,
    created_at: epochIso,
    updated_at: epochIso,
  };
});

function assertDbReady() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED: Conexión a base de datos requerida.');
  }
  return supabase;
}

export interface BuildingPendingYield {
  elapsedHours: number;
  ecPerHour: number;
  alloysPerHour: number;
  fuelPerHour: number;
  chipsPerHour: number;
  pendingEc: number;
  pendingAlloys: number;
  pendingFuel: number;
  pendingChips: number;
  storageCap: number;
  totalStored: number;
  isStorageFull: boolean;
  isProductionHalted: boolean;
}

/**
 * Calcula el rendimiento horario acumulado en vivo de un edificio a partir de
 * `last_collected_at` vs `nowMs` (tope de 16h y tope finito `storage_cap`).
 */
export function calculateBuildingPendingYield(
  building: Pick<
    DbBuildingRecord,
    'building_type' | 'level' | 'is_disabled' | 'last_collected_at' | 'stored_resources'
  > &
    Partial<Pick<DbBuildingRecord, 'storage_cap' | 'is_production_halted' | 'infra_state'>>,
  nowMs: number = Date.now()
): BuildingPendingYield {
  const lvl = Math.max(1, Math.min(5, building.level || 1));
  const mult = 1.0 + (lvl - 1) * 0.35;
  const type = building.building_type;
  const storageCap = Math.max(1, Number(building.storage_cap ?? 250) || 250);

  let ecPerHour = 0;
  let alloysPerHour = 0;
  let fuelPerHour = 0;
  let chipsPerHour = 0;

  if (type === 'barracks' || type === 'factory' || type === 'war_factory') {
    ecPerHour = Math.round(20 * mult * 100) / 100;
  } else if (type === 'extractor' || type === 'foundry' || type === 'refinery' || type === 'mine') {
    alloysPerHour = Math.round(18 * mult * 100) / 100;
    fuelPerHour = Math.round(12 * mult * 100) / 100;
    chipsPerHour = Math.round(6 * mult * 100) / 100;
    ecPerHour = Math.round(45 * mult * 100) / 100;
  } else if (type === 'airport' || type === 'port' || type === 'radar' || type === 'hq') {
    alloysPerHour = Math.round(6 * mult * 100) / 100;
    fuelPerHour = Math.round(10 * mult * 100) / 100;
    chipsPerHour = Math.round(12 * mult * 100) / 100;
    ecPerHour = Math.round(30 * mult * 100) / 100;
  }

  const stored = (building.stored_resources ?? {}) as Record<string, unknown>;
  const storedAlloys = Number(stored.alloys ?? 0) || 0;
  const storedFuel = Number(stored.fuel ?? 0) || 0;
  const storedChips = Number(stored.chips ?? 0) || 0;
  const baseStoredSum = storedAlloys + storedFuel + storedChips;
  const isRuined = building.is_disabled || building.infra_state === 'RUINED';
  const isHalted = Boolean(building.is_production_halted) || baseStoredSum >= storageCap;

  if (isRuined || isHalted) {
    return {
      elapsedHours: 0,
      ecPerHour: 0,
      alloysPerHour: 0,
      fuelPerHour: 0,
      chipsPerHour: 0,
      pendingEc: 0,
      pendingAlloys: storedAlloys,
      pendingFuel: storedFuel,
      pendingChips: storedChips,
      storageCap,
      totalStored: baseStoredSum,
      isStorageFull: baseStoredSum >= storageCap,
      isProductionHalted: Boolean(building.is_production_halted) || (baseStoredSum >= storageCap && !isRuined),
    };
  }

  const lastCollectedMs = Date.parse(building.last_collected_at);
  const elapsedHours = Number.isFinite(lastCollectedMs)
    ? Math.min(16.0, Math.max(0.0, (nowMs - lastCollectedMs) / 3600000))
    : 0;

  let room = Math.max(0, storageCap - baseStoredSum);
  const addAlloys = Math.min(room, Math.floor(alloysPerHour * elapsedHours));
  room = Math.max(0, room - addAlloys);
  const addFuel = Math.min(room, Math.floor(fuelPerHour * elapsedHours));
  room = Math.max(0, room - addFuel);
  const addChips = Math.min(room, Math.floor(chipsPerHour * elapsedHours));

  const pendingAlloys = storedAlloys + addAlloys;
  const pendingFuel = storedFuel + addFuel;
  const pendingChips = storedChips + addChips;
  const totalStored = pendingAlloys + pendingFuel + pendingChips;

  return {
    elapsedHours,
    ecPerHour,
    alloysPerHour,
    fuelPerHour,
    chipsPerHour,
    pendingEc: Math.floor(ecPerHour * elapsedHours),
    pendingAlloys,
    pendingFuel,
    pendingChips,
    storageCap,
    totalStored,
    isStorageFull: totalStored >= storageCap,
    isProductionHalted: totalStored >= storageCap,
  };
}

export async function resolveActiveUserCorpId(): Promise<string | null> {
  if (!isSupabaseConfigured() || !supabase) return null;
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('corp_id')
    .eq('id', userId)
    .maybeSingle();
  return profile?.corp_id ?? null;
}

function isSpatialRpcEnabled(): boolean {
  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, string | undefined>);
  return env.VITE_ENABLE_SPATIAL_RPC === 'true';
}

export async function fetchBuildingsInViewport(
  bbox: ViewportBBox,
  corpId?: string | null,
  limit = 400
): Promise<DbBuildingRecord[]> {
  if (!isSupabaseConfigured() || !supabase || !isSpatialRpcEnabled()) return [];

  const rounded = normalizeAndRoundBBox(bbox);
  const clampedLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const normalizedCorpId = corpId && corpId.trim().length > 0 ? corpId.trim() : null;
  const cacheKey = `${rounded.minLat},${rounded.maxLat},${rounded.minLng},${rounded.maxLng}|${normalizedCorpId ?? 'ALL'}|${clampedLimit}`;

  const cached = getCachedViewport(buildingsViewportCache, cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase.rpc('get_buildings_in_viewport', {
    p_min_lat: rounded.minLat,
    p_max_lat: rounded.maxLat,
    p_min_lng: rounded.minLng,
    p_max_lng: rounded.maxLng,
    p_corp_id: normalizedCorpId,
    p_limit: clampedLimit,
  });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DbBuildingRecord[];
  setCachedViewport(buildingsViewportCache, cacheKey, rows);
  return rows;
}

export async function fetchCorpBuildings(
  corpId: string,
  bbox?: ViewportBBox,
  limit = 400
): Promise<DbBuildingRecord[]> {
  if (bbox) {
    return fetchBuildingsInViewport(bbox, corpId, limit);
  }
  const db = assertDbReady();
  const clampedLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const { data, error } = await db
    .from('buildings')
    .select('*')
    .eq('corp_id', corpId)
    .order('created_at', { ascending: false })
    .limit(clampedLimit);

  if (error) throw new Error(error.message);
  return (data ?? []) as DbBuildingRecord[];
}

export async function fetchWorldMapBuildings(
  corpId?: string | null,
  bbox?: ViewportBBox
): Promise<DbBuildingRecord[]> {
  let dbRows: DbBuildingRecord[] = [];
  if (isSupabaseConfigured() && supabase) {
    try {
      dbRows = await fetchBuildingsInViewport(bbox ?? DEFAULT_VIEWPORT_BBOX, corpId, 400);
    } catch {
      dbRows = [];
    }
  }

  const mergedByH3 = new Map<number, DbBuildingRecord>();
  for (const seed of HISTORICAL_CITY_BASES_SEED) {
    mergedByH3.set(seed.h3_index, seed);
  }
  for (const row of dbRows) {
    mergedByH3.set(Number(row.h3_index), row);
  }
  return Array.from(mergedByH3.values());
}

export async function constructBuildingDb(params: {
  h3Index: number;
  municipalityId: string;
  corpId: string;
  buildingType: string;
  usePersonalTopup?: boolean;
}): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('construct_building', {
    p_h3_index: params.h3Index,
    p_municipality_id: params.municipalityId,
    p_corp_id: params.corpId,
    p_building_type: params.buildingType,
    p_use_personal_topup: Boolean(params.usePersonalTopup),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearBuildingsViewportCache();
  return data;
}

export async function claimOrCaptureBuildingDb(buildingId: string, corpId: string): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('claim_or_capture_building', {
    p_building_id: buildingId,
    p_corp_id: corpId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearBuildingsViewportCache();
  return data;
}

export async function remodelBuildingDb(params: {
  buildingId: string;
  corpId: string;
  targetType?: string;
  upgradeLevel?: boolean;
  usePersonalTopup?: boolean;
}): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('remodel_building', {
    p_building_id: params.buildingId,
    p_corp_id: params.corpId,
    p_target_type: params.targetType,
    p_upgrade_level: params.upgradeLevel ?? true,
    p_use_personal_topup: Boolean(params.usePersonalTopup),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearBuildingsViewportCache();
  return data;
}

export async function collectBuildingResourcesDb(buildingId: string, corpId: string): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('collect_building_resources', {
    p_building_id: buildingId,
    p_corp_id: corpId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearBuildingsViewportCache();
  return data;
}
