import { supabase, isSupabaseConfigured } from '@shared';
import type { Json } from '@shared';

export type CorporationRole = 'majority_shareholder' | 'shareholder' | 'member';

export interface DelegatedPermissions {
  can_use_treasury: boolean;
  can_construct: boolean;
  can_remodel: boolean;
  can_collect: boolean;
  can_purchase_units: boolean;
  can_control_units: boolean;
}

export interface CorporationRecord {
  id: string;
  name: string;
  tag: string;
  leader_user_id: string | null;
  treasury_ec: number;
  treasury_alloys: number;
  treasury_fuel: number;
  treasury_chips: number;
  treasury_rare_earth: number;
  treasury_composites: number;
  tech_level: number;
  controlled_municipalities_count: number;
  controlled_states_count: number;
  treasury_citizens?: number;
  population_cap?: number;
}

export interface CorporationMemberRecord {
  id: string;
  corp_id: string;
  user_id: string;
  role: CorporationRole;
  shares: number;
  delegated_permissions: DelegatedPermissions;
  joined_at: string;
}

export interface MyCorporationContext {
  corporation: CorporationRecord;
  membership: CorporationMemberRecord;
}

const DEFAULT_PERMISSIONS: DelegatedPermissions = {
  can_use_treasury: false,
  can_construct: false,
  can_remodel: false,
  can_collect: false,
  can_purchase_units: false,
  can_control_units: false,
};

function parsePermissions(raw: Json | null | undefined): DelegatedPermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PERMISSIONS };
  }
  const rec = raw as Record<string, unknown>;
  return {
    can_use_treasury: Boolean(rec.can_use_treasury),
    can_construct: Boolean(rec.can_construct),
    can_remodel: Boolean(rec.can_remodel),
    can_collect: Boolean(rec.can_collect),
    can_purchase_units: Boolean(rec.can_purchase_units),
    can_control_units: Boolean(rec.can_control_units),
  };
}

export function hasCorpPermission(
  membership: CorporationMemberRecord | null | undefined,
  perm: keyof DelegatedPermissions
): boolean {
  if (!membership) return false;
  if (membership.role === 'majority_shareholder' || membership.role === 'shareholder') {
    return true;
  }
  return Boolean(membership.delegated_permissions?.[perm]);
}

function assertDbReady() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('SUPABASE_NOT_CONFIGURED: Conexión a base de datos requerida.');
  }
  return supabase;
}

export async function fetchMyCorporation(userId: string): Promise<MyCorporationContext | null> {
  const db = assertDbReady();
  const { data: profile, error: profErr } = await db
    .from('profiles')
    .select('corp_id')
    .eq('id', userId)
    .single();

  if (profErr) throw new Error(profErr.message);
  if (!profile?.corp_id) return null;

  const [corpRes, memberRes] = await Promise.all([
    db.from('corporations').select('*').eq('id', profile.corp_id).single(),
    db
      .from('corporation_members')
      .select('*')
      .eq('corp_id', profile.corp_id)
      .eq('user_id', userId)
      .single(),
  ]);

  if (corpRes.error) throw new Error(corpRes.error.message);
  if (memberRes.error) throw new Error(memberRes.error.message);

  return {
    corporation: corpRes.data as CorporationRecord,
    membership: {
      ...memberRes.data,
      role: memberRes.data.role as CorporationRole,
      delegated_permissions: parsePermissions(memberRes.data.delegated_permissions),
    },
  };
}

export async function listCorporations(): Promise<CorporationRecord[]> {
  const db = assertDbReady();
  const { data, error } = await db
    .from('corporations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as CorporationRecord[];
}

export async function createCorporation(name: string, tag: string): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('create_corporation', {
    p_name: name.trim(),
    p_tag: tag.trim().toUpperCase(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function joinCorporation(corpId: string): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('join_corporation', {
    p_corp_id: corpId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchCorporationMembers(corpId: string): Promise<CorporationMemberRecord[]> {
  const db = assertDbReady();
  const { data, error } = await db
    .from('corporation_members')
    .select('*')
    .eq('corp_id', corpId)
    .order('shares', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    role: row.role as CorporationRole,
    delegated_permissions: parsePermissions(row.delegated_permissions),
  }));
}

export async function updateMemberPermissions(
  corpId: string,
  targetUserId: string,
  role: CorporationRole,
  permissions: DelegatedPermissions
): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('update_member_permissions', {
    p_corp_id: corpId,
    p_target_user_id: targetUserId,
    p_role: role,
    p_permissions: permissions as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function donateToCorporation(
  corpId: string,
  amounts: { ec?: number; alloys?: number; fuel?: number; chips?: number }
): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('donate_to_corporation', {
    p_corp_id: corpId,
    p_ec: Math.max(0, Math.floor(amounts.ec ?? 0)),
    p_alloys: Math.max(0, Math.floor(amounts.alloys ?? 0)),
    p_fuel: Math.max(0, Math.floor(amounts.fuel ?? 0)),
    p_chips: Math.max(0, Math.floor(amounts.chips ?? 0)),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function leaveCorporation(): Promise<Json> {
  const db = assertDbReady();
  const { data, error } = await db.rpc('leave_corporation');
  if (error) throw new Error(error.message);
  return data;
}
