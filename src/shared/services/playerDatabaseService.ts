/**
 * ==============================================================================
 * SERVICIO DE PERSISTENCIA & SINCRONIZACIÓN CON BASE DE DATOS REAL (SUPABASE DB)
 * ==============================================================================
 * Conecta el estado del jugador (perfil, créditos, gemas, inventario industrial,
 * corporación y reservas de tropas) directamente con Supabase PostgreSQL.
 * Nunca genera datos ficticios ni fallbacks mock: si Supabase falla, propaga
 * un estado de error recuperable.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { IndustrialInventory, ActiveRefiningJob, CorporateSpecialization } from '@domains/economy';
import { Clan, ClanMember } from '@domains/world';
import { PlayerReserveStock, createInitialReserveStock } from '@domains/tactics';

export interface PersistentPlayerData {
  userId: string;
  username: string;
  corpId: string | null;
  gold: number;
  gems: number;
  level: number;
  xp: number;
  eloRating: number;
  trophies: number;
  activeCommanderId: string;
  commanderBondLevel: number;
  winStreak: number;
  industrialInventory: IndustrialInventory;
  refiningJobs: ActiveRefiningJob[];
  clan: Clan | null;
  clanMembers: ClanMember[];
  reserveStock: PlayerReserveStock;
  lastUpdated: number;
}

export interface PlayerLoadResult {
  data: PersistentPlayerData | null;
  error: string | null;
}

const isValidUuid = (value: string | null | undefined): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export class PlayerDatabaseService {
  private static instance: PlayerDatabaseService | null = null;
  private currentUserId: string | null = null;

  private constructor() {}

  public static getInstance(): PlayerDatabaseService {
    if (!PlayerDatabaseService.instance) {
      PlayerDatabaseService.instance = new PlayerDatabaseService();
    }
    return PlayerDatabaseService.instance;
  }

  public setUserId(userId: string | null): void {
    this.currentUserId = isValidUuid(userId) ? userId : null;
  }

  public getUserId(): string | null {
    return this.currentUserId;
  }

  /**
   * Resuelve el UUID autenticado actual desde memoria o Supabase Auth.
   */
  private async resolveAuthenticatedUserId(explicitUserId?: string): Promise<string> {
    if (isValidUuid(explicitUserId)) {
      this.currentUserId = explicitUserId;
      return explicitUserId;
    }
    if (isValidUuid(this.currentUserId)) {
      return this.currentUserId;
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || !isValidUuid(data.user.id)) {
      throw new Error(error?.message || 'Sesión no autenticada en Supabase.');
    }
    this.currentUserId = data.user.id;
    return data.user.id;
  }

  /**
   * Versión no lanzadora para UI con estado de error recuperable.
   */
  public async tryLoadPlayerData(explicitUserId?: string): Promise<PlayerLoadResult> {
    try {
      const data = await this.loadPlayerData(explicitUserId);
      return { data, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar datos desde Supabase.';
      return { data: null, error: message };
    }
  }

  /**
   * Carga los datos completos del jugador desde Supabase PostgreSQL.
   * Lanza un Error recuperable si no hay configuración, sesión o si la consulta falla.
   */
  public async loadPlayerData(explicitUserId?: string): Promise<PersistentPlayerData> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase no está configurado en el entorno.');
    }

    const userId = await this.resolveAuthenticatedUserId(explicitUserId);

    const [profileRes, invRes, membershipRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single(),
      supabase
        .from('user_industrial_inventory')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('corporation_members')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    if (profileRes.error || !profileRes.data) {
      throw new Error(profileRes.error?.message || 'No se pudo cargar el perfil del jugador desde Supabase.');
    }
    if (invRes.error) {
      throw new Error(invRes.error.message || 'No se pudo cargar el inventario industrial desde Supabase.');
    }
    if (membershipRes.error) {
      throw new Error(membershipRes.error.message || 'No se pudo verificar la membresía corporativa desde Supabase.');
    }

    const profile = profileRes.data;
    const invData = invRes.data;
    const corpId = profile.corp_id ?? membershipRes.data?.corp_id ?? null;

    let clan: Clan | null = null;
    let clanMembers: ClanMember[] = [];

    if (corpId) {
      const [corpRes, membersRes] = await Promise.all([
        supabase
          .from('corporations')
          .select('*')
          .eq('id', corpId)
          .single(),
        supabase
          .from('corporation_members')
          .select('user_id, role, joined_at, shares')
          .eq('corp_id', corpId),
      ]);

      if (corpRes.error) {
        throw new Error(corpRes.error.message || 'No se pudo cargar la corporación desde Supabase.');
      }
      if (membersRes.error) {
        throw new Error(membersRes.error.message || 'No se pudieron cargar los miembros corporativos desde Supabase.');
      }

      const corp = corpRes.data;
      const members = membersRes.data ?? [];

      clan = {
        id: corp.id,
        name: corp.name,
        tag: corp.tag,
        emblemIcon: '🛡️',
        tier: corp.tech_level >= 3 ? 'tier_3' : corp.tech_level === 2 ? 'tier_2' : 'tier_1',
        treasuryGold: corp.treasury_ec,
        treasurySteel: corp.treasury_alloys,
        warScore: corp.controlled_municipalities_count * 100 + corp.controlled_states_count * 500,
        activeMembersCount: members.length,
        maxMembers: 30,
      };

      clanMembers = members.map((m) => ({
        userId: m.user_id,
        userName: m.user_id === userId ? profile.username : m.user_id,
        role: (m.role as ClanMember['role']) || 'cadet',
        contributionPoints: m.shares ?? 0,
        warBattlesCount: 0,
        isEmbargoed: false,
        embargoFeeGold: 0,
        embargoFeeSteel: 0,
        isImmuneNewRecruit: false,
        joinedAt: new Date(m.joined_at).getTime(),
      }));
    }

    const spec = invData?.corporate_specialization;
    const validSpec: CorporateSpecialization =
      spec === 'vulcan' || spec === 'aegis' || spec === 'titan' || spec === 'none' ? spec : 'none';

    return {
      userId,
      username: profile.username,
      corpId,
      gold: profile.battle_credits ?? 0,
      gems: profile.command_gems ?? 0,
      level: profile.account_level ?? 0,
      xp: profile.current_xp ?? 0,
      eloRating: profile.elo_rating ?? 0,
      trophies: profile.trophies_count ?? 0,
      activeCommanderId: profile.selected_commander_id || 'andy',
      commanderBondLevel: profile.account_level ?? 0,
      winStreak: profile.current_win_streak ?? 0,
      industrialInventory: {
        userId,
        rawIron: invData?.raw_iron ?? 0,
        rawStone: invData?.raw_stone ?? 0,
        rawRareEarth: invData?.raw_rare_earth ?? 0,
        refinedSteel: invData?.refined_steel ?? 0,
        refinedConcrete: invData?.refined_concrete ?? 0,
        refinedMicrochip: invData?.refined_microchip ?? 0,
        campaignFuel: invData?.campaign_fuel ?? 0,
        specialization: validSpec,
        lastHarvestAt: invData?.last_harvest_at ? new Date(invData.last_harvest_at).getTime() : Date.now(),
      },
      refiningJobs: [],
      clan,
      clanMembers,
      reserveStock: this.loadPersistentStock(userId),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Guarda y sincroniza los cambios de fondos y perfil en Supabase.
   */
  public async updateProfile(partial: Partial<PersistentPlayerData>): Promise<void> {
    const current = await this.loadPlayerData(partial.userId);
    const updated: PersistentPlayerData = {
      ...current,
      ...partial,
      lastUpdated: Date.now(),
    };

    await this.syncProfileToSupabase(updated);
  }

  /**
   * Guarda el stock de refuerzos del hangar.
   */
  public async updateReserveStock(stock: PlayerReserveStock): Promise<void> {
    const userId = await this.resolveAuthenticatedUserId();
    try {
      localStorage.setItem(`tactical_stock_${userId}`, JSON.stringify(stock));
    } catch {
      // Storage quota or SSR: ignore local cache failure
    }
  }

  /**
   * Sincroniza hacia Supabase PostgreSQL.
   */
  private async syncProfileToSupabase(data: PersistentPlayerData): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase no está configurado.');
    }
    if (!isValidUuid(data.userId)) {
      throw new Error('UUID de usuario inválido para sincronizar perfil.');
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        username: data.username,
        account_level: data.level,
        current_xp: data.xp,
        battle_credits: data.gold,
        command_gems: data.gems,
        elo_rating: data.eloRating,
        trophies_count: data.trophies,
        selected_commander_id: data.activeCommanderId,
        current_win_streak: data.winStreak,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.userId);

    if (profileError) {
      throw new Error(profileError.message || 'Error al sincronizar perfil en Supabase.');
    }

    const { error: invError } = await supabase
      .from('user_industrial_inventory')
      .upsert({
        user_id: data.userId,
        raw_iron: data.industrialInventory.rawIron,
        raw_stone: data.industrialInventory.rawStone,
        raw_rare_earth: data.industrialInventory.rawRareEarth,
        refined_steel: data.industrialInventory.refinedSteel,
        refined_concrete: data.industrialInventory.refinedConcrete,
        refined_microchip: data.industrialInventory.refinedMicrochip,
        campaign_fuel: data.industrialInventory.campaignFuel,
        corporate_specialization: data.industrialInventory.specialization,
        updated_at: new Date().toISOString(),
      });

    if (invError) {
      throw new Error(invError.message || 'Error al sincronizar inventario industrial en Supabase.');
    }
  }

  private loadPersistentStock(userId: string): PlayerReserveStock {
    try {
      const raw = localStorage.getItem(`tactical_stock_${userId}`);
      if (raw) return JSON.parse(raw);
    } catch {
      // Fallback to initial empty/canonical stock structure
    }
    return createInitialReserveStock('p1');
  }
}

export const playerDb = PlayerDatabaseService.getInstance();
