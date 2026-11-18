/**
 * ==============================================================================
 * SERVICIO DE SOBERANÍA TERRITORIAL Y CONTROL DE ESTADOS C4ISR
 * ==============================================================================
 * Especificación: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.1 & §3.2
 * Aplica control RBAC para Líderes de Clan y Gestores de Facción.
 * Permite cambiar el concepto soberano y nombre de Países y Estados en vivo,
 * sincronizando en tiempo real vía Supabase CDC con fallback local.
 * ==============================================================================
 */

import {
  supabase,
  isSupabaseConfigured,
  MASTER_METAGAME_CONSTANTS,
  type MunicipalManagerRole,
  type MunicipalAuditActionType,
  type MunicipalAuditLogEntry,
  type StateLevelPerkState,
  type CorporateMacroPrivilegeState,
  type StatePerkId,
  type StatePerkSpec,
} from '@shared';

export const STATE_PERKS_CATALOG: Record<StatePerkId, StatePerkSpec> = {
  VANGUARD_LOGISTICS: {
    id: 'VANGUARD_LOGISTICS',
    branch: 'EXPANSION',
    name: 'Logística de Vanguardia',
    description: '-30% consumo de CB/h para drones en estados fronterizos al estado controlado.',
  },
  BLITZKRIEG_DOCTRINE: {
    id: 'BLITZKRIEG_DOCTRINE',
    branch: 'EXPANSION',
    name: 'Doctrina Relámpago',
    description: 'Recons y Tanques Medios ganan +1 hex de movimiento por tick durante sus primeras 6h (24 ticks).',
  },
  ASYMMETRIC_WARFARE: {
    id: 'ASYMMETRIC_WARFARE',
    branch: 'EXPANSION',
    name: 'Guerra Asimétrica',
    description: 'Drones Infantería tardan 1h (4 ticks) en vez de 2h en capturar/sabotear fábricas adyacentes.',
  },
  MICROCHIP_SUBSIDY: {
    id: 'MICROCHIP_SUBSIDY',
    branch: 'INDUSTRIAL',
    name: 'Subsidio de Microchips',
    description: '+25% producción de Microchips (MC) en fábricas de la corporación dentro del estado.',
  },
  CORPORATE_FREE_ZONE: {
    id: 'CORPORATE_FREE_ZONE',
    branch: 'INDUSTRIAL',
    name: 'Zona Franca Corporativa',
    description: 'Reduce impuesto de extracción del 10% al 0% para miembros (mantiene hasta 50% para rivales).',
  },
  CENTRALIZED_SUPPLY: {
    id: 'CENTRALIZED_SUPPLY',
    branch: 'INDUSTRIAL',
    name: 'Suministro Centralizado',
    description: 'Los APC fabricados duplican max_fuel y reparan +25% HP/h en lugar de 15%.',
  },
  CIVIL_MOBILIZATION: {
    id: 'CIVIL_MOBILIZATION',
    branch: 'FORTRESS',
    name: 'Movilización Civil',
    description: 'Hexágonos del estado regeneran +5% de control/h hacia la corporación si no hay enemigos presentes.',
  },
  INTEGRATED_DEFENSE_NET: {
    id: 'INTEGRATED_DEFENSE_NET',
    branch: 'FORTRESS',
    name: 'Red de Defensa Integrada',
    description: '+1 hex de alcance de disparo a Artillerías, Lanzamisiles y Baterías AA dentro del estado.',
  },
};
import type {
  StateSovereigntyRecord,
  UserRoleContext,
  SovereignStateUpdateInput,
  FactionId,
} from '../types/stateSovereigntyTypes';

type StateChangeListener = (updatedState: StateSovereigntyRecord) => void;

class StateSovereigntyService {
  private statesMap: Map<string, StateSovereigntyRecord> = new Map();
  private municipalManagers: Map<string, MunicipalManagerRole> = new Map();
  private corporateDiplomacy: Map<
    string,
    { nonAggressionPacts: string[]; customTariffTreaties: Record<string, number> }
  > = new Map();
  private listeners: Set<StateChangeListener> = new Set();
  private isInitialized = false;
  private realtimeChannel: any = null;
  private activeRegionId = 'GLOBAL';
  private lastSeqByState: Map<string, number> = new Map();
  private cachedSessionUserId: string | null = null;
  private sessionCacheExpiresAt = 0;
  private authListenerUnsubscribe: (() => void) | null = null;

  constructor() {
    this.initializeDefaultStates();
    this.initSessionCache();
    this.initRealtimeSubscription('GLOBAL').catch((err) => {
      console.warn('[StateSovereigntyService] Fallo inicializando Realtime (degradado a memoria):', err);
    });
  }

  /**
   * Inicializa caché de sesión reactiva mediante getSession() y onAuthStateChange
   * (evita round-trips auth.getUser() bajo alta concurrencia).
   */
  private initSessionCache(): void {
    if (!isSupabaseConfigured() || !supabase?.auth) return;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
        this.cachedSessionUserId = session?.user?.id ?? null;
        this.sessionCacheExpiresAt = Date.now() + 60_000;
      });
      this.authListenerUnsubscribe = () => data?.subscription?.unsubscribe?.();
    } catch {
      // Entorno sin auth listener (p.ej. tests unitarios)
    }
  }

  /**
   * Obtiene el userId desde caché en memoria o supabase.auth.getSession().
   */
  public async getCachedSessionUserId(): Promise<string | null> {
    if (this.cachedSessionUserId && Date.now() < this.sessionCacheExpiresAt) {
      return this.cachedSessionUserId;
    }
    if (!isSupabaseConfigured() || !supabase?.auth?.getSession) {
      return this.cachedSessionUserId;
    }
    try {
      const { data } = await supabase.auth.getSession();
      this.cachedSessionUserId = data?.session?.user?.id ?? null;
      this.sessionCacheExpiresAt = Date.now() + 60_000;
      return this.cachedSessionUserId;
    } catch {
      return this.cachedSessionUserId;
    }
  }

  /**
   * Carga el estado inicial de soberanía geopolítica (Venezuela y sus 24 entidades).
   */
  private initializeDefaultStates() {
    const defaultData: StateSovereigntyRecord[] = [
      {
        stateId: 'REG_VE_01',
        countryId: 'COUNTRY_VEN',
        canonicalCountryName: 'República de Venezuela',
        customCountryName: 'República Soberana de Venezuela',
        canonicalStateName: 'Distrito Capital',
        customStateName: 'Caracas Metrópolis Central',
        controllingFactionId: 'orange_star',
        controllingClanId: 'clan-orinoco',
        controllingClanTag: 'ORNC',
        controllingClanName: 'División Petroquímica Orinoco',
        status: 'stable',
        tcpCurrent: 10000,
        tcpMax: 10000,
        gdpWarCreditsPerHour: 8500,
        resources: { oil: 120, steel: 350, rareEarth: 45, composites: 90 },
        defenseLevel: 5,
        customMotto: 'Orden, Petróleo y Vanguardia Continental',
        sovereignProclamation: 'Sede del Comando Nacional. El control de Caracas garantiza la supremacía logística.',
      },
      {
        stateId: 'REG_VE_02',
        countryId: 'COUNTRY_VEN',
        canonicalCountryName: 'República de Venezuela',
        customCountryName: 'Hegemonía Petrolera de Maracaibo',
        canonicalStateName: 'Zulia',
        customStateName: 'Estado Zulia (Teatro Cabimas)',
        controllingFactionId: 'blue_moon',
        controllingClanId: 'clan-ferro',
        controllingClanTag: 'FERR',
        controllingClanName: 'Legión Blindada Ferro',
        status: 'stable',
        tcpCurrent: 10000,
        tcpMax: 10000,
        gdpWarCreditsPerHour: 12400,
        resources: { oil: 850, steel: 500, rareEarth: 20, composites: 130 },
        defenseLevel: 4,
        customMotto: 'Acero Frío y Petróleo Pesado',
        sovereignProclamation: 'El Lago de Maracaibo y la Costa Oriental operan bajo jurisdicción militar del Clan Ferro.',
      },
      {
        stateId: 'REG_VE_03',
        countryId: 'COUNTRY_VEN',
        canonicalCountryName: 'República de Venezuela',
        customCountryName: 'República Soberana de Venezuela',
        canonicalStateName: 'Bolívar',
        customStateName: 'Macizo Metalúrgico de Bolívar',
        controllingFactionId: 'black_hole',
        controllingClanId: 'clan-andes',
        controllingClanTag: 'ANDS',
        controllingClanName: 'Comando Siderúrgico Andes',
        status: 'contested',
        tcpCurrent: 6800,
        tcpMax: 10000,
        gdpWarCreditsPerHour: 9800,
        resources: { oil: 40, steel: 1200, rareEarth: 310, composites: 80 },
        defenseLevel: 3,
        customMotto: 'La Fuerza del Macizo no se Doblega',
      },
      {
        stateId: 'REG_VE_04',
        countryId: 'COUNTRY_VEN',
        canonicalCountryName: 'República de Venezuela',
        customCountryName: 'República Soberana de Venezuela',
        canonicalStateName: 'Anzoátegui',
        customStateName: 'Faja Petrolífera de Anzoátegui',
        controllingFactionId: 'orange_star',
        controllingClanId: 'clan-orinoco',
        controllingClanTag: 'ORNC',
        controllingClanName: 'División Petroquímica Orinoco',
        status: 'stable',
        tcpCurrent: 9200,
        tcpMax: 10000,
        gdpWarCreditsPerHour: 7600,
        resources: { oil: 620, steel: 180, rareEarth: 15, composites: 45 },
        defenseLevel: 3,
      },
      {
        stateId: 'REG_VE_05',
        countryId: 'COUNTRY_VEN',
        canonicalCountryName: 'República de Venezuela',
        customCountryName: 'República Soberana de Venezuela',
        canonicalStateName: 'Carabobo',
        customStateName: 'Complejo Industrial Carabobo',
        controllingFactionId: 'yellow_comet',
        controllingClanId: 'clan-sol',
        controllingClanTag: 'SOL',
        controllingClanName: 'Guardia Imperial Sol',
        status: 'stable',
        tcpCurrent: 9500,
        tcpMax: 10000,
        gdpWarCreditsPerHour: 8100,
        resources: { oil: 110, steel: 410, rareEarth: 60, composites: 115 },
        defenseLevel: 4,
      },
      {
        stateId: 'REG_VE_07',
        countryId: 'COUNTRY_VEN',
        canonicalCountryName: 'República de Venezuela',
        customCountryName: 'República Soberana de Venezuela',
        canonicalStateName: 'Lara',
        customStateName: 'Nudo Logístico Barquisimeto-Lara',
        controllingFactionId: 'green_earth',
        controllingClanId: 'clan-selva',
        controllingClanTag: 'SLVA',
        controllingClanName: 'Vanguardia Selva Verde',
        status: 'stable',
        tcpCurrent: 8900,
        tcpMax: 10000,
        gdpWarCreditsPerHour: 6400,
        resources: { oil: 50, steel: 220, rareEarth: 85, composites: 65 },
        defenseLevel: 3,
      },
    ];

    defaultData.forEach((st) => this.statesMap.set(st.stateId, st));
    this.isInitialized = true;
  }

  /**
   * Conecta y sincroniza con Supabase Broadcast acotado por región: `world:region:{regionId}`
   * (por defecto `world:region:GLOBAL` para cambios de soberanía v3).
   */
  public async initRealtimeSubscription(regionId: string = 'GLOBAL'): Promise<void> {
    if (!isSupabaseConfigured() || !supabase) return;

    const targetRegion = regionId || 'GLOBAL';
    this.activeRegionId = targetRegion;

    try {
      // 1. Hidratación inicial desde la base de datos
      const query = supabase.from('state_sovereignty').select('*');
      const { data: dbStates, error } =
        targetRegion !== 'GLOBAL'
          ? await query.eq('state_id', targetRegion)
          : await query;

      if (error) {
        throw new Error(`SOVEREIGNTY_FETCH_ERROR: ${error.message}`);
      }

      if (Array.isArray(dbStates)) {
        dbStates.forEach((row: any) => {
          this.applyStateDeltaToMemory(row, false);
        });
      }

      // 2. Desuscribir canal anterior si existe
      this.unsubscribeRealtime();

      // 3. Suscribirse a canal Broadcast v3 acotado por región
      const topic = `world:region:${targetRegion}`;
      this.realtimeChannel = supabase
        .channel(topic, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'ENTITY_UPSERT' }, ({ payload }: { payload: any }) =>
          this.handleBroadcastDelta(payload)
        )
        .on('broadcast', { event: 'ENTITY_DELETE' }, ({ payload }: { payload: any }) =>
          this.handleBroadcastDelta(payload)
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.info(`[StateSovereigntyService] Canal Broadcast conectado: ${topic}`);
          }
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`SOVEREIGNTY_REALTIME_INIT_ERROR: ${msg}`);
    }
  }

  /**
   * Desconecta el canal Realtime activo.
   */
  public unsubscribeRealtime(): void {
    if (this.realtimeChannel && supabase) {
      try {
        supabase.removeChannel(this.realtimeChannel);
      } catch (err) {
        console.warn('[StateSovereigntyService] Error al desuscribir canal:', err);
      }
      this.realtimeChannel = null;
    }
  }

  /**
   * Aplica un delta de registro `state_sovereignty` en memoria.
   */
  private applyStateDeltaToMemory(row: any, notify: boolean): void {
    if (!row?.state_id) return;
    const existing = this.getState(row.state_id);
    if (!existing) return;

    const merged: StateSovereigntyRecord = {
      ...existing,
      customCountryName: row.custom_country_name || existing.customCountryName,
      customStateName: row.custom_state_name || existing.customStateName,
      customMotto: row.custom_motto || existing.customMotto,
      sovereignProclamation: row.sovereign_proclamation || existing.sovereignProclamation,
      controllingFactionId: (row.controlling_faction_id as FactionId) || existing.controllingFactionId,
      controllingClanId: row.controlling_clan_id || existing.controllingClanId,
      tcpCurrent: row.tcp_current ?? existing.tcpCurrent,
      tcpMax: row.tcp_max ?? existing.tcpMax,
      defenseLevel: row.defense_level ?? existing.defenseLevel,
    };
    this.statesMap.set(row.state_id, merged);
    if (notify) {
      this.notifyListeners(merged);
    }
  }

  /**
   * Maneja eventos Broadcast v3 (`ENTITY_UPSERT` / `ENTITY_DELETE`) para `state_sovereignty`.
   */
  private handleBroadcastDelta(payload: any) {
    if (!payload || (payload.table && payload.table !== 'state_sovereignty')) return;
    const op = payload.op;
    const newRec = payload.record;
    if (!newRec?.state_id) return;

    const stateId = String(newRec.state_id);
    const seq = Number(payload.seq ?? 0);
    const prevSeq = this.lastSeqByState.get(stateId) ?? 0;
    if (seq > 0 && seq < prevSeq) return;
    if (seq > 0) this.lastSeqByState.set(stateId, seq);

    if (op === 'DELETE') {
      this.statesMap.delete(stateId);
      return;
    }

    if (op === 'INSERT' || op === 'UPDATE' || !op) {
      this.applyStateDeltaToMemory(newRec, true);
    }
  }

  /**
   * Verifica los permisos RBAC de un usuario para desbloquear el panel de control del estado.
   * Regla Inviolable: Sólo líderes de clanes y gestores de la facción pueden desbloquear estas interfaces.
   */
  public canUnlockStateControl(
    userContext: UserRoleContext,
    stateId: string
  ): { allowed: boolean; reason?: string } {
    if (!userContext || !userContext.userId) {
      return {
        allowed: false,
        reason: 'ACCESO DENEGADO (DEFCON 1): Usuario no autenticado. Se requiere credencial militar válida.',
      };
    }

    const state = this.getState(stateId);
    if (!state) {
      return {
        allowed: false,
        reason: 'SECTOR NO LOCALIZADO: El estado solicitado no figura en el teatro cartográfico activo.',
      };
    }

    // Comprobar si el clan del usuario pertenece a la facción que controla el estado
    const isControllingFaction = userContext.factionId === state.controllingFactionId;
    const isControllingClan = userContext.clanId === state.controllingClanId;

    if (!isControllingFaction && !isControllingClan) {
      return {
        allowed: false,
        reason: `ACCESO DENEGADO: El sector está bajo control de la facción [${state.controllingFactionId.toUpperCase()}]. Tu facción [${userContext.factionId.toUpperCase()}] debe conquistarlo antes de tomar la gobernanza.`,
      };
    }

    // Comprobar jerarquía de mando: Líder de Clan o Gestor de Facción u Oficial autorizado
    const isLeader = userContext.clanRole === 'leader';
    const isOfficer = userContext.clanRole === 'officer';
    const isFactionManager = userContext.isFactionManager === true;

    if (!isLeader && !isOfficer && !isFactionManager) {
      return {
        allowed: false,
        reason: `AUTORIZACIÓN INSUFICIENTE: Tu rango [${userContext.clanRole.toUpperCase()}] es de tropa de campo. Solo los LÍDERES DE CLAN o GESTORES DE FACCIÓN pueden modificar la soberanía del Estado.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Obtiene la telemetría de un estado por su identificador.
   */
  public getState(stateId: string): StateSovereigntyRecord | undefined {
    return this.statesMap.get(stateId);
  }

  /**
   * Retorna la totalidad de estados registrados.
   */
  public getAllStates(): StateSovereigntyRecord[] {
    return Array.from(this.statesMap.values());
  }

  /**
   * Sincroniza directamente un registro de soberanía territorial desde el motor geopolítico
   * (actualizando TCP, status, fortificación, recursos, etc.).
   */
  public updateStateRecord(stateId: string, patch: Partial<StateSovereigntyRecord>): StateSovereigntyRecord {
    const existing = this.getState(stateId) || {
      stateId,
      countryId: 'COUNTRY_VEN',
      canonicalCountryName: 'República de Venezuela',
      customCountryName: 'República Soberana de Venezuela',
      canonicalStateName: stateId,
      customStateName: stateId,
      controllingFactionId: 'blue_moon' as FactionId,
      controllingClanId: '',
      controllingClanTag: 'N/A',
      controllingClanName: 'Sin Corporación',
      status: 'stable',
      tcpCurrent: 10000,
      tcpMax: 10000,
      gdpWarCreditsPerHour: 5000,
      resources: { oil: 100, steel: 150, rareEarth: 10, composites: 25 },
      defenseLevel: 2,
    };

    const updated: StateSovereigntyRecord = {
      ...existing,
      ...patch,
      stateId,
      resources: patch.resources ? { ...existing.resources, ...patch.resources } : existing.resources,
    };

    this.statesMap.set(stateId, updated);
    this.notifyListeners(updated);
    return updated;
  }

  /**
   * Actualiza el concepto del País y del Estado soberano tras validación de permisos RBAC.
   */
  public async updateStateSovereignty(
    userContext: UserRoleContext,
    input: SovereignStateUpdateInput
  ): Promise<{ success: boolean; state?: StateSovereigntyRecord; error?: string }> {
    const authCheck = this.canUnlockStateControl(userContext, input.stateId);
    if (!authCheck.allowed) {
      return { success: false, error: authCheck.reason };
    }

    const state = this.getState(input.stateId);
    if (!state) {
      return { success: false, error: 'Estado no encontrado en el mapa.' };
    }

    // Aplicar transformaciones soberanas
    const updated: StateSovereigntyRecord = {
      ...state,
      customCountryName: input.newCountryName?.trim() || state.customCountryName,
      customStateName: input.newStateName?.trim() || state.customStateName,
      customMotto: input.customMotto?.trim() || state.customMotto,
      sovereignProclamation: input.sovereignProclamation?.trim() || state.sovereignProclamation,
      unlockedAt: new Date().toISOString(),
      unlockedByUserId: userContext.userId,
      unlockedByUserName: userContext.userName,
    };

    // Sincronizar con Supabase si está configurado; retornar error recuperable si falla
    if (isSupabaseConfigured() && supabase) {
      try {
        const { error } = await supabase
          .from('state_sovereignty')
          .upsert({
            state_id: updated.stateId,
            custom_country_name: updated.customCountryName,
            custom_state_name: updated.customStateName,
            custom_motto: updated.customMotto,
            sovereign_proclamation: updated.sovereignProclamation,
            controlling_faction_id: updated.controllingFactionId,
            controlling_clan_id: updated.controllingClanId,
            updated_by_user_id: userContext.userId,
            updated_at: new Date().toISOString(),
          });
        if (error) {
          return {
            success: false,
            error: `Error sincronizando soberanía con Supabase: ${error.message}`,
          };
        }
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        return {
          success: false,
          error: `Error de red al sincronizar soberanía con Supabase: ${msg}`,
        };
      }
    }

    // Si se cambió el nombre del país, propagarlo a los estados controlados por la misma facción
    if (input.newCountryName && input.newCountryName !== state.customCountryName) {
      for (const [sId, st] of this.statesMap.entries()) {
        if (st.controllingFactionId === state.controllingFactionId) {
          this.statesMap.set(sId, { ...st, customCountryName: input.newCountryName });
        }
      }
    }

    this.statesMap.set(input.stateId, updated);

    // Notificar suscriptores reactivos
    this.notifyListeners(updated);

    return { success: true, state: updated };
  }

  // ============================================================================
  // POLÍTICA MACRO ESCALADA: GESTOR MUNICIPAL, PERKS ESTATALES (>60%) Y DIPLOMACIA
  // ============================================================================

  /**
   * Nombra un Gestor Municipal exclusivo para un municipio donde la Corporación
   * ya haya consolidado mayoría simple (>50% de las micro-celdas).
   */
  public appointMunicipalManager(params: {
    municipalityId: string;
    stateId: string;
    municipalityControllingClanId: string | null;
    majorityRatio: number;
    managerUserId: string;
    managerUserName: string;
    actorContext: UserRoleContext;
    initialTaxRate?: number;
  }): { success: boolean; manager?: MunicipalManagerRole; error?: string } {
    if (params.majorityRatio <= MASTER_METAGAME_CONSTANTS.MUNICIPAL_MAJORITY_THRESHOLD) {
      return {
        success: false,
        error: `Mayoría insuficiente: se requiere >50% de las micro-celdas del municipio (actual: ${(params.majorityRatio * 100).toFixed(1)}%).`,
      };
    }

    if (
      !params.municipalityControllingClanId ||
      params.municipalityControllingClanId !== params.actorContext.clanId
    ) {
      return {
        success: false,
        error: 'Solo la Corporación que ostenta la soberanía municipal puede nombrar al Gestor Municipal.',
      };
    }

    const canAppoint =
      params.actorContext.clanRole === 'leader' ||
      params.actorContext.clanRole === 'officer' ||
      params.actorContext.isFactionManager;
    if (!canAppoint) {
      return {
        success: false,
        error: 'Permisos RBAC insuficientes: solo Líderes, Oficiales o Gestores de Facción nombran Gestores Municipales.',
      };
    }

    const localTaxRate = Math.max(
      MASTER_METAGAME_CONSTANTS.ALLIED_TAX_RATE_MIN,
      Math.min(
        MASTER_METAGAME_CONSTANTS.RIVAL_RETENTION_RATE_MAX,
        params.initialTaxRate ?? 0.08
      )
    );

    const manager: MunicipalManagerRole = {
      managerUserId: params.managerUserId,
      managerUserName: params.managerUserName,
      municipalityId: params.municipalityId,
      stateId: params.stateId,
      appointedByClanId: params.municipalityControllingClanId,
      publicBuildingsState: {
        earlyWarningRadarActive: true,
        rapidRepairWorkshopActive: true,
        samBatteryActive: true,
      },
      localTaxRate,
      corruptionRiskScore: 0,
      auditTrailLogs: [],
      updatedAt: new Date().toISOString(),
    };

    this.municipalManagers.set(params.municipalityId, manager);
    return { success: true, manager };
  }

  public getMunicipalManager(municipalityId: string): MunicipalManagerRole | undefined {
    return this.municipalManagers.get(municipalityId);
  }

  /**
   * Ejecuta una orden exclusiva del Gestor Municipal (Radares, Talleres, Baterías SAM o Impuesto)
   * registrando trazabilidad completa en bitácora C4ISR contra corrupción/sabotaje interno.
   */
  public executeMunicipalManagerAction(params: {
    municipalityId: string;
    actorUserId: string;
    actorUserName: string;
    actionType: MunicipalAuditActionType;
    buildingEnabled?: boolean;
    newLocalTaxRate?: number;
    isPreIncursionWindow?: boolean;
  }): {
    success: boolean;
    manager?: MunicipalManagerRole;
    auditEntry?: MunicipalAuditLogEntry;
    error?: string;
  } {
    const manager = this.municipalManagers.get(params.municipalityId);
    if (!manager) {
      return { success: false, error: 'El municipio no tiene un Gestor Municipal asignado.' };
    }

    if (manager.managerUserId !== params.actorUserId) {
      return {
        success: false,
        error: `RBAC DENEGADO: Solo el Gestor asignado (${manager.managerUserName}) puede operar la infraestructura municipal.`,
      };
    }

    let previousValue = '';
    let newValue = '';
    let isSuspiciousCorruption = false;

    if (params.actionType === 'toggle_radar' || params.actionType === 'sabotage_radar_pre_incursion') {
      previousValue = String(manager.publicBuildingsState.earlyWarningRadarActive);
      const nextActive =
        params.actionType === 'sabotage_radar_pre_incursion'
          ? false
          : (params.buildingEnabled ?? !manager.publicBuildingsState.earlyWarningRadarActive);
      manager.publicBuildingsState.earlyWarningRadarActive = nextActive;
      newValue = String(nextActive);
      if (!nextActive && (params.isPreIncursionWindow || params.actionType === 'sabotage_radar_pre_incursion')) {
        isSuspiciousCorruption = true;
      }
    } else if (params.actionType === 'toggle_workshop') {
      previousValue = String(manager.publicBuildingsState.rapidRepairWorkshopActive);
      const nextActive = params.buildingEnabled ?? !manager.publicBuildingsState.rapidRepairWorkshopActive;
      manager.publicBuildingsState.rapidRepairWorkshopActive = nextActive;
      newValue = String(nextActive);
    } else if (params.actionType === 'toggle_sam_battery') {
      previousValue = String(manager.publicBuildingsState.samBatteryActive);
      const nextActive = params.buildingEnabled ?? !manager.publicBuildingsState.samBatteryActive;
      manager.publicBuildingsState.samBatteryActive = nextActive;
      newValue = String(nextActive);
    } else if (params.actionType === 'adjust_local_tax' || params.actionType === 'fiscal_diversion_detected') {
      previousValue = manager.localTaxRate.toFixed(2);
      const nextRate = Math.max(
        MASTER_METAGAME_CONSTANTS.ALLIED_TAX_RATE_MIN,
        Math.min(
          MASTER_METAGAME_CONSTANTS.RIVAL_RETENTION_RATE_MAX,
          params.newLocalTaxRate ?? manager.localTaxRate
        )
      );
      manager.localTaxRate = nextRate;
      newValue = nextRate.toFixed(2);
      if (params.actionType === 'fiscal_diversion_detected') {
        isSuspiciousCorruption = true;
      }
    }

    if (isSuspiciousCorruption) {
      manager.corruptionRiskScore = Math.min(100, manager.corruptionRiskScore + 35);
    }

    const auditEntry: MunicipalAuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      municipalityId: params.municipalityId,
      actorUserId: params.actorUserId,
      actorUserName: params.actorUserName,
      actionType: params.actionType,
      previousValue,
      newValue,
      isSuspiciousCorruption,
      timestamp: new Date().toISOString(),
    };

    manager.auditTrailLogs.unshift(auditEntry);
    manager.updatedAt = auditEntry.timestamp;
    this.municipalManagers.set(params.municipalityId, { ...manager });

    return { success: true, manager, auditEntry };
  }

  /**
   * Nivel Estado (>60% de los municipios del estado): activa Perks Estatales automáticos
   * (-20% consumo de combustible fronterizo y +15% velocidad de conquista en municipios adyacentes).
   */
  public evaluateStateLevelPerks(params: {
    stateId: string;
    clanId: string | null;
    controlledMunicipalitiesCount: number;
    totalMunicipalitiesCount: number;
  }): StateLevelPerkState {
    const total = Math.max(1, params.totalMunicipalitiesCount);
    const ratio = Number((params.controlledMunicipalitiesCount / total).toFixed(4));
    const isPerkUnlocked =
      Boolean(params.clanId) && ratio > MASTER_METAGAME_CONSTANTS.STATE_PERK_MUNICIPALITY_THRESHOLD;

    return {
      stateId: params.stateId,
      controllingClanId: isPerkUnlocked ? params.clanId : null,
      controlledMunicipalitiesCount: params.controlledMunicipalitiesCount,
      totalMunicipalitiesCount: total,
      controlRatio: ratio,
      isPerkUnlocked,
      borderFuelDiscountMultiplier: isPerkUnlocked
        ? Number((1 - MASTER_METAGAME_CONSTANTS.STATE_PERK_BORDER_FUEL_DISCOUNT).toFixed(2))
        : 1.0,
      adjacentConquestSpeedMultiplier: isPerkUnlocked
        ? Number((1 + MASTER_METAGAME_CONSTANTS.STATE_PERK_ADJACENT_CONQUEST_BONUS).toFixed(2))
        : 1.0,
    };
  }

  /**
   * Nivel Corporación (>= 1 municipio controlado): desbloquea Árbol Tecnológico Avanzado
   * (Neotanque y Bombardero dentro del Hangar Físico de 16 Chasis) y Diplomacia Oficial.
   */
  public evaluateCorporateMacroPrivileges(params: {
    clanId: string;
    controlledMunicipalitiesCount: number;
    addNonAggressionPactWithClanId?: string;
    setCustomTariffForClan?: { targetClanId: string; rate: number };
  }): CorporateMacroPrivilegeState {
    const unlocked = params.controlledMunicipalitiesCount >= 1;
    const dip = this.corporateDiplomacy.get(params.clanId) ?? {
      nonAggressionPacts: [],
      customTariffTreaties: {},
    };

    if (unlocked && params.addNonAggressionPactWithClanId) {
      if (!dip.nonAggressionPacts.includes(params.addNonAggressionPactWithClanId)) {
        dip.nonAggressionPacts.push(params.addNonAggressionPactWithClanId);
      }
    }

    if (unlocked && params.setCustomTariffForClan) {
      const clampedRate = Math.max(
        0,
        Math.min(
          MASTER_METAGAME_CONSTANTS.RIVAL_RETENTION_RATE_MAX,
          params.setCustomTariffForClan.rate
        )
      );
      dip.customTariffTreaties[params.setCustomTariffForClan.targetClanId] = clampedRate;
    }

    this.corporateDiplomacy.set(params.clanId, dip);

    return {
      clanId: params.clanId,
      controlledMunicipalitiesCount: params.controlledMunicipalitiesCount,
      advancedTechTreeUnlocked: unlocked,
      unlockedHeavyChassis: unlocked ? ['neotank', 'bomber'] : [],
      officialDiplomacyEnabled: unlocked,
      nonAggressionPacts: [...dip.nonAggressionPacts],
      customTariffTreaties: { ...dip.customTariffTreaties },
    };
  }

  /**
   * Configura los Perks Estatales por ramas (>60% = 1 perk, >85% = 2 perks, máx. 3 globales).
   */
  public configureCorporationStatePerks(params: {
    clanId: string;
    statesControlRatios: Record<string, number>;
    requestedPerksByState: Record<string, StatePerkId[]>;
  }): {
    success: boolean;
    activeGlobalPerks: StatePerkId[];
    maxAllowedInState: Record<string, number>;
    reason?: string;
  } {
    const maxAllowedInState: Record<string, number> = {};
    const activeGlobalPerks: StatePerkId[] = [];

    for (const [stateId, ratio] of Object.entries(params.statesControlRatios)) {
      const stateCap = ratio > 0.85 ? 2 : ratio > 0.60 ? 1 : 0;
      maxAllowedInState[stateId] = stateCap;
      const req = params.requestedPerksByState[stateId] ?? [];
      if (req.length > stateCap) {
        return {
          success: false,
          activeGlobalPerks: [],
          maxAllowedInState,
          reason: `El estado ${stateId} (${Math.round(ratio * 100)}%) solo autoriza ${stateCap} Perks.`,
        };
      }
      for (const perk of req) {
        if (!activeGlobalPerks.includes(perk)) {
          activeGlobalPerks.push(perk);
        }
      }
    }

    if (activeGlobalPerks.length > 3) {
      return {
        success: false,
        activeGlobalPerks: activeGlobalPerks.slice(0, 3),
        maxAllowedInState,
        reason: `Tope global excedido: máximo 3 Perks Estatales activos simultáneamente (solicitados: ${activeGlobalPerks.length}).`,
      };
    }

    return {
      success: true,
      activeGlobalPerks,
      maxAllowedInState,
    };
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(updated: StateSovereigntyRecord) {
    this.listeners.forEach((listener) => {
      try {
        listener(updated);
      } catch (err) {
        console.error('[StateSovereigntyService] Error en suscriptor:', err);
      }
    });
  }
}

export const stateSovereigntyService = new StateSovereigntyService();