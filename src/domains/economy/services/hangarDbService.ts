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
}

function assertDbReady() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED: Conexión a base de datos requerida.');
  }
  return supabase;
}

export async function fetchOperationalUnits(params?: {
  userId?: string;
  corpId?: string;
}): Promise<DbOperationalUnitRecord[]> {
  const db = assertDbReady();
  let query = db
    .from('operational_units')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

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
  return data;
}

export async function recallOperationalUnitDb(unitId: string): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('recall_operational_unit', {
    p_unit_id: unitId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}
