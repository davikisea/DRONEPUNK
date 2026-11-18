import { supabase, isSupabaseConfigured } from '@shared';
import type { Database, Json } from '@shared';

export type UnitCommandType = 'move' | 'patrol' | 'auto_collect' | 'skirmish' | 'scheduled_deploy';
export type UnitScheduleRow = Database['public']['Tables']['unit_command_schedules']['Row'];
export type UnitActionLogRow = Database['public']['Tables']['unit_action_logs']['Row'];

function assertDb() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED: Conexión a base de datos requerida.');
  }
  return supabase;
}

export async function scheduleUnitCommand(params: {
  corpId: string;
  unitId?: string;
  hangarSlotId?: string;
  commandType: UnitCommandType;
  waypoints: Array<{ h3: number; wait_sec?: number }>;
  targetBuildingId?: string;
  scheduledAtIso?: string;
  repeatIntervalSec?: number;
  replaceActive?: boolean;
}): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('schedule_unit_command', {
    p_corp_id: params.corpId,
    p_unit_id: params.unitId ?? null,
    p_hangar_slot_id: params.hangarSlotId ?? null,
    p_command_type: params.commandType,
    p_waypoints: params.waypoints as unknown as Json,
    p_target_building_id: params.targetBuildingId ?? null,
    p_scheduled_at: params.scheduledAtIso ?? null,
    p_repeat_interval_sec: params.repeatIntervalSec ?? null,
    p_replace_active: params.replaceActive ?? true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelUnitCommand(scheduleId: string): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('cancel_unit_command', {
    p_schedule_id: scheduleId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function processDueUnitSchedules(batchLimit = 50): Promise<Json> {
  const db = assertDb();
  const { data, error } = await db.rpc('process_due_unit_schedules', {
    p_batch_limit: batchLimit,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchUnitSchedules(corpId: string, unitId?: string): Promise<UnitScheduleRow[]> {
  const db = assertDb();
  let query = db
    .from('unit_command_schedules')
    .select('*')
    .eq('corp_id', corpId)
    .order('created_at', { ascending: false })
    .limit(25);
  if (unitId) query = query.eq('unit_id', unitId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchUnitActionLogs(corpId: string, unitId?: string): Promise<UnitActionLogRow[]> {
  const db = assertDb();
  let query = db
    .from('unit_action_logs')
    .select('*')
    .eq('corp_id', corpId)
    .order('created_at', { ascending: false })
    .limit(40);
  if (unitId) query = query.eq('unit_id', unitId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
