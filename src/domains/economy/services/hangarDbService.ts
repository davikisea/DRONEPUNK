import { supabase, isSupabaseConfigured } from '@shared';
import type { Json } from '@shared';

export interface DbOperationalUnitRecord {
  id: string;
  owner_user_id: string;
  corp_id: string;
  hangar_slot_id: string | null;
  unit_code: string;
  tier: number;
  hp: number;
  h3_index: number;
  municipality_id: string | null;
  status: string;
  unit_role?: 'combat' | 'citizen' | 'collector' | string;
  citizens_aboard?: number;
  cargo?: Json;
  cargo_cap?: number;
  source_building_id?: string | null;
  depot_building_id?: string | null;
  next_haul_at?: string | null;
  deployed_at?: string;
  created_at?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface ViewportBBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const VIEWPORT_CACHE_MAX_ENTRIES = 24;
const VIEWPORT_CACHE_TTL_MS = 15_000;

interface ViewportCacheEntry<T> {
  expiresAt: number;
  data: T[];
}

const unitsViewportCache = new Map<string, ViewportCacheEntry<DbOperationalUnitRecord>>();

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

export function clearUnitsViewportCache(): void {
  unitsViewportCache.clear();
}

function assertDbReady() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED: Conexión a base de datos requerida.');
  }
  return supabase;
}

function isSpatialRpcEnabled(): boolean {
  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, string | undefined>);
  return env.VITE_ENABLE_SPATIAL_RPC === 'true';
}

export async function fetchUnitsInViewport(
  bbox: ViewportBBox,
  corpId?: string | null,
  status: string | null = 'active',
  limit = 400
): Promise<DbOperationalUnitRecord[]> {
  if (!isSupabaseConfigured() || !supabase || !isSpatialRpcEnabled()) return [];

  const rounded = normalizeAndRoundBBox(bbox);
  const clampedLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
  const normalizedCorpId = corpId && corpId.trim().length > 0 ? corpId.trim() : null;
  const normalizedStatus = status === undefined ? 'active' : status;
  const cacheKey = `${rounded.minLat},${rounded.maxLat},${rounded.minLng},${rounded.maxLng}|${normalizedCorpId ?? 'ALL'}|${normalizedStatus ?? 'ALL'}|${clampedLimit}`;

  const cached = getCachedViewport(unitsViewportCache, cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase.rpc('get_units_in_viewport', {
    p_min_lat: rounded.minLat,
    p_max_lat: rounded.maxLat,
    p_min_lng: rounded.minLng,
    p_max_lng: rounded.maxLng,
    p_corp_id: normalizedCorpId,
    p_status: normalizedStatus,
    p_limit: clampedLimit,
  });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DbOperationalUnitRecord[];
  setCachedViewport(unitsViewportCache, cacheKey, rows);
  return rows;
}

export async function fetchOperationalUnits(params?: {
  userId?: string;
  corpId?: string;
  bbox?: ViewportBBox;
  status?: string;
  limit?: number;
}): Promise<DbOperationalUnitRecord[]> {
  if (params?.bbox) {
    const rows = await fetchUnitsInViewport(
      params.bbox,
      params.corpId ?? null,
      params.status ?? 'active',
      params.limit ?? 400
    );
    return params.userId ? rows.filter((u) => u.owner_user_id === params.userId) : rows;
  }

  const db = assertDbReady();
  const clampedLimit = Math.min(Math.max(1, Math.floor(params?.limit ?? 400)), 1000);
  let query = db
    .from('operational_units')
    .select('*')
    .eq('status', params?.status ?? 'active')
    .order('created_at', { ascending: false })
    .limit(clampedLimit);

  if (params?.corpId) {
    query = query.eq('corp_id', params.corpId);
  } else if (params?.userId) {
    query = query.eq('owner_user_id', params.userId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as DbOperationalUnitRecord[];
}

export async function deployOperationalUnitDb(params: {
  hangarSlotId: string;
  corpId: string;
  h3Index: number;
  municipalityId?: string | null;
}): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('deploy_operational_unit', {
    p_hangar_slot_id: params.hangarSlotId,
    p_corp_id: params.corpId,
    p_h3_index: params.h3Index,
    p_municipality_id: params.municipalityId ?? undefined,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearUnitsViewportCache();
  return data;
}

export async function recallOperationalUnitDb(unitId: string): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('recall_operational_unit', {
    p_unit_id: unitId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  clearUnitsViewportCache();
  return data;
}
