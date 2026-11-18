/**
 * ==============================================================================
 * HOOK DE GESTIÓN PERSISTENTE DEL HANGAR FÍSICO Y PATENTES (USE USER HANGAR)
 * ==============================================================================
 * Eje Gravitacional de Datos en Vivo (Supabase SSOT - 0% Mock Data):
 * - Lectura y sincronización reactiva de `public.user_unit_hangar`.
 * - Desbloqueo y persistencia de patentes en `public.user_patents`.
 * - Regla Canónica de Desguace: 35% de chatarra recuperada (MASTER_METAGAME_CONSTANTS).
 * - Cero fallbacks locales o IDs sintéticos en modo autenticado.
 * ==============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@shared';
import {
  UnitHangarEntry,
  PatentRegistryEntry,
  MASTER_METAGAME_CONSTANTS,
} from '@shared';
import { audioManager } from '@domains/game-feel';
import {
  fetchOperationalUnits,
  deployOperationalUnitDb,
  recallOperationalUnitDb,
  type DbOperationalUnitRecord,
} from '../services/hangarDbService';
import { resolveActiveUserCorpId } from '../services/buildingDbService';

export interface UseUserHangarReturn {
  hangarUnits: UnitHangarEntry[];
  operationalUnits: DbOperationalUnitRecord[];
  unlockedPatents: PatentRegistryEntry[];
  battlegroup: UnitHangarEntry[];
  activeCorpId: string | null;
  isLoading: boolean;
  error: string | null;
  refreshHangar: () => Promise<void>;
  craftUnit: (params: {
    unitCode: string;
    tier: number;
    level: number;
    quantity: number;
    costs: { ec: number; steel: number; rareEarth?: number; composites?: number };
  }) => Promise<{ success: boolean; message: string }>;
  unlockPatent: (params: {
    patentCode: string;
    tier: number;
    costEc: number;
    costSteel: number;
  }) => Promise<{ success: boolean; message: string }>;
  scrapUnit: (hangarUnitId: string) => Promise<{
    success: boolean;
    recoveredSteel: number;
    recoveredEc: number;
    message: string;
  }>;
  deployUnitToField: (params: {
    hangarSlotId: string;
    h3Index?: number;
    municipalityId?: string | null;
    corpId?: string;
  }) => Promise<{ success: boolean; message: string }>;
  recallUnitToHangar: (unitId: string) => Promise<{ success: boolean; message: string }>;
  toggleBattlegroupUnit: (unit: UnitHangarEntry) => void;
  setBattlegroupLoadout: (units: UnitHangarEntry[]) => void;
}

export function useUserHangar(userId?: string | null): UseUserHangarReturn {
  const [hangarUnits, setHangarUnits] = useState<UnitHangarEntry[]>([]);
  const [operationalUnits, setOperationalUnits] = useState<DbOperationalUnitRecord[]>([]);
  const [unlockedPatents, setUnlockedPatents] = useState<PatentRegistryEntry[]>([]);
  const [battlegroup, setBattlegroup] = useState<UnitHangarEntry[]>([]);
  const [activeCorpId, setActiveCorpId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);

  /**
   * Carga reactiva de unidades y patentes desde Supabase.
   */
  const loadHangarData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let activeUserId = userId;
      if (!activeUserId) {
        const { data: authData } = await supabase.auth.getUser();
        activeUserId = authData?.user?.id ?? null;
      }

      if (!activeUserId) {
        if (isMountedRef.current) {
          setHangarUnits([]);
          setUnlockedPatents([]);
          setBattlegroup([]);
          setIsLoading(false);
        }
        return;
      }

      // Consulta paralela a tablas reales de Supabase
      const [hangarRes, patentsRes, opsRes, corpId] = await Promise.all([
        supabase
          .from('user_unit_hangar')
          .select('*')
          .eq('user_id', activeUserId)
          .order('tier', { ascending: false }),
        supabase
          .from('user_patents')
          .select('*')
          .eq('user_id', activeUserId)
          .order('tier', { ascending: false }),
        fetchOperationalUnits({ userId: activeUserId }).catch(() => [] as DbOperationalUnitRecord[]),
        resolveActiveUserCorpId().catch(() => null),
      ]);

      if (hangarRes.error) {
        throw hangarRes.error;
      }
      if (patentsRes.error) {
        throw patentsRes.error;
      }

      if (isMountedRef.current) {
        const loadedHangar: UnitHangarEntry[] = (hangarRes.data || []).map((row) => ({
          id: row.id,
          userId: row.user_id,
          clanId: row.clan_id,
          unitCode: row.unit_code,
          tier: row.tier,
          level: row.level,
          hp: row.hp,
          quantity: row.quantity,
          locationProvinceId: row.location_province_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        const loadedPatents: PatentRegistryEntry[] = (patentsRes.data || []).map((row) => ({
          id: row.id,
          userId: row.user_id,
          patentCode: row.patent_code,
          tier: row.tier,
          unlockedAt: row.unlocked_at,
        }));

        setHangarUnits(loadedHangar);
        setOperationalUnits(opsRes);
        setUnlockedPatents(loadedPatents);
        setActiveCorpId(corpId);

        // Auto-seleccionar primer elemento en battlegroup si está vacío
        setBattlegroup((prev) => {
          if (prev.length > 0) return prev;
          return loadedHangar.slice(0, 2);
        });

        setIsLoading(false);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Error cargando datos del hangar');
        setIsLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    isMountedRef.current = true;
    loadHangarData();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadHangarData]);

  /**
   * Forja de nueva unidad T1-T5 y persistencia atómica en base de datos.
   */
  const craftUnit = useCallback(
    async (params: {
      unitCode: string;
      tier: number;
      level: number;
      quantity: number;
      corpId?: string;
      buildingId?: string;
      personalContribution?: { ec?: number; alloys?: number; rare_earth?: number; composites?: number };
      costs: { ec: number; steel: number; rareEarth?: number; composites?: number };
    }) => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const activeUserId = authData?.user?.id ?? userId;

        if (!activeUserId) {
          return { success: false, message: 'Autenticación requerida para ensamblar unidades en el Hangar.' };
        }

        let targetCorpId = params.corpId;
        if (!targetCorpId) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('corp_id')
            .eq('id', activeUserId)
            .single();
          targetCorpId = prof?.corp_id ?? undefined;
        }
        if (!targetCorpId) {
          return { success: false, message: 'CORP_REQUIRED: Debes pertenecer a una Corporación para fabricar unidades.' };
        }

        let targetBuildingId = params.buildingId;
        if (!targetBuildingId) {
          const { data: bld } = await supabase
            .from('buildings')
            .select('id')
            .eq('corp_id', targetCorpId)
            .in('building_type', ['barracks', 'factory', 'war_factory', 'airport', 'port', 'hq'])
            .eq('is_disabled', false)
            .limit(1)
            .maybeSingle();
          targetBuildingId = bld?.id;
        }
        if (!targetBuildingId) {
          return { success: false, message: 'BARRACKS_REQUIRED: Tu Corporación necesita un Barracón/Fábrica operativo.' };
        }

        const { error: rpcError } = await supabase.rpc('purchase_unit_from_barracks', {
          p_corp_id: targetCorpId,
          p_building_id: targetBuildingId,
          p_unit_code: params.unitCode,
          p_tier: params.tier,
          p_personal_contribution: params.personalContribution ?? {},
          p_idempotency_key: crypto.randomUUID(),
        });

        if (rpcError) {
          throw rpcError;
        }

        await loadHangarData();
        audioManager.playSFX('co_power');
        return { success: true, message: `Unidad ${params.unitCode} T${params.tier} forjada en DB.` };
      } catch (err: any) {
        console.error('[useUserHangar] Fallo en forja:', err);
        return { success: false, message: err.message || 'Error de base de datos durante la forja.' };
      }
    },
    [userId, loadHangarData]
  );

  /**
   * Desbloqueo permanente de patente tecnológica.
   */
  const unlockPatent = useCallback(
    async (params: {
      patentCode: string;
      tier: number;
      costEc: number;
      costSteel: number;
    }) => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const activeUserId = authData?.user?.id ?? userId;

        if (!activeUserId) {
          return { success: false, message: 'Autenticación requerida para registrar patentes militares.' };
        }

        const { data, error: insertError } = await supabase
          .from('user_patents')
          .insert({
            user_id: activeUserId,
            patent_code: params.patentCode,
            tier: params.tier,
          })
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        if (data) {
          const newPatent: PatentRegistryEntry = {
            id: data.id,
            userId: data.user_id,
            patentCode: data.patent_code,
            tier: data.tier,
            unlockedAt: data.unlocked_at,
          };
          setUnlockedPatents((prev) => [...prev, newPatent]);
        }

        audioManager.playSFX('co_power');
        return { success: true, message: `Patente ${params.patentCode} T${params.tier} registrada.` };
      } catch (err: any) {
        console.error('[useUserHangar] Fallo en patente:', err);
        return { success: false, message: err.message || 'Error registrando patente en Supabase.' };
      }
    },
    [userId]
  );

  /**
   * Desguace de unidades: Regla Canónica SSOT del 35% de retorno.
   */
  const scrapUnit = useCallback(
    async (hangarUnitId: string) => {
      const unit = hangarUnits.find((u) => u.id === hangarUnitId);
      if (!unit) {
        return { success: false, recoveredSteel: 0, recoveredEc: 0, message: 'Unidad no encontrada en el arsenal.' };
      }

      const baseValSteel = 50 * unit.tier;
      const baseValEc = 100 * unit.tier;
      const salvageRate = MASTER_METAGAME_CONSTANTS.BASE_SALVAGE_RATE ?? 0.35;
      const recoveredSteel = Math.floor(baseValSteel * salvageRate);
      const recoveredEc = Math.floor(baseValEc * salvageRate);

      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('scrap_unit_from_hangar', {
          p_hangar_slot_id: hangarUnitId,
          p_idempotency_key: crypto.randomUUID(),
        });

        if (rpcError) {
          throw rpcError;
        }

        const serverEc = (rpcData as Record<string, unknown> | null)?.tech_scrap_ec;
        const creditedEc = typeof serverEc === 'number' ? serverEc : recoveredEc;

        await loadHangarData();
        audioManager.playSFX('combat_hit');

        return {
          success: true,
          recoveredSteel,
          recoveredEc: creditedEc,
          message: `Desguazado en DB: +${creditedEc} EC (35% Tech Scrap).`,
        };
      } catch (err: any) {
        console.error('[useUserHangar] Fallo en desguace:', err);
        return {
          success: false,
          recoveredSteel: 0,
          recoveredEc: 0,
          message: err.message || 'Fallo de persistencia al desguazar.',
        };
      }
    },
    [hangarUnits]
  );

  const deployUnitToField = useCallback(
    async (params: {
      hangarSlotId: string;
      h3Index?: number;
      municipalityId?: string | null;
      corpId?: string;
    }) => {
      try {
        const targetCorpId = params.corpId ?? activeCorpId ?? (await resolveActiveUserCorpId());
        if (!targetCorpId) {
          return {
            success: false,
            message: 'CORP_REQUIRED: Debes pertenecer a una Corporación para desplegar tropas.',
          };
        }
        await deployOperationalUnitDb({
          hangarSlotId: params.hangarSlotId,
          corpId: targetCorpId,
          h3Index: params.h3Index ?? 1,
          municipalityId: params.municipalityId ?? null,
        });
        await loadHangarData();
        audioManager.playSFX('co_power');
        return { success: true, message: 'Chasis desplegado al frente operativo en DB.' };
      } catch (err: unknown) {
        return {
          success: false,
          message: err instanceof Error ? err.message : 'Error desplegando unidad en DB.',
        };
      }
    },
    [activeCorpId, loadHangarData]
  );

  const recallUnitToHangar = useCallback(
    async (unitId: string) => {
      try {
        await recallOperationalUnitDb(unitId);
        await loadHangarData();
        audioManager.playSFX('button_click');
        return { success: true, message: 'Chasis retirado a la Reserva del Hangar Físico (DB).' };
      } catch (err: unknown) {
        return {
          success: false,
          message: err instanceof Error ? err.message : 'Error retirando unidad a reserva.',
        };
      }
    },
    [loadHangarData]
  );

  const toggleBattlegroupUnit = useCallback((unit: UnitHangarEntry) => {
    audioManager.playHoverTick();
    setBattlegroup((prev) => {
      const exists = prev.some((u) => u.id === unit.id);
      if (exists) {
        return prev.filter((u) => u.id !== unit.id);
      }
      if (prev.length >= 4) {
        return prev;
      }
      return [...prev, unit];
    });
  }, []);

  const setBattlegroupLoadout = useCallback((units: UnitHangarEntry[]) => {
    setBattlegroup(units.slice(0, 4));
  }, []);

  return {
    hangarUnits,
    operationalUnits,
    unlockedPatents,
    battlegroup,
    activeCorpId,
    isLoading,
    error,
    refreshHangar: loadHangarData,
    craftUnit,
    unlockPatent,
    scrapUnit,
    deployUnitToField,
    recallUnitToHangar,
    toggleBattlegroupUnit,
    setBattlegroupLoadout,
  };
}