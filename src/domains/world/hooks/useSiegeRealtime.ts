/**
 * ==============================================================================
 * HOOK DE SINCRONIZACIÓN REALTIME DE ASEDIO TERRITORIAL Y HANDSHAKE (120s)
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §5.4
 * - Suscripción a alertas de asedio en tiempo real por provincia.
 * - Cuenta atrás síncrona en vivo de 120 segundos para el Human Handshake.
 * - Relevo a Guarnición IA al expirar el tiempo.
 * - Soporte offline / fallback para tests deterministas y modo de desarrollo.
 * ==============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@shared';
import {
  TerritorialBattleSession,
  GeotacticsRegionSovereignty,
  MASTER_METAGAME_CONSTANTS,
} from '@shared';
import {
  TerritorialSiegeOrchestrator,
  SiegeResolutionResult,
} from '@domains/world';
import { audioManager } from '@domains/game-feel';

function mapDbSessionToDomain(raw: Record<string, any>): TerritorialBattleSession {
  return {
    id: raw.id,
    regionId: raw.regionId ?? raw.region_id,
    attackerClanId: raw.attackerClanId ?? raw.attacker_clan_id,
    defenderClanId: raw.defenderClanId ?? raw.defender_clan_id ?? null,
    attackerCommanderId: raw.attackerCommanderId ?? raw.attacker_commander_id,
    defenderCommanderId: raw.defenderCommanderId ?? raw.defender_commander_id ?? null,
    mode: (raw.mode as 'pve_garrison' | 'pvp_realtime') ?? 'pve_garrison',
    handshakeExpiresAt: raw.handshakeExpiresAt ?? raw.handshake_expires_at,
    status: (raw.status as TerritorialBattleSession['status']) ?? 'handshake_pending',
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    concludedAt: raw.concludedAt ?? raw.concluded_at ?? null,
  };
}

export interface UseSiegeRealtimeReturn {
  activeSession: TerritorialBattleSession | null;
  sovereignty: GeotacticsRegionSovereignty | null;
  handshakeSecondsRemaining: number;
  isHandshakeActive: boolean;
  isHandshakeExpired: boolean;
  isDefendingClan: boolean;
  isLoading: boolean;
  error: string | null;
  startSiege: (
    attackerClanId: string,
    attackerCommanderId: string,
    currentSovereignty: GeotacticsRegionSovereignty
  ) => Promise<TerritorialBattleSession>;
  claimHandshake: (defenderCommanderId: string) => Promise<{ success: boolean; message?: string }>;
  resolveExpiredHandshake: (bunkerLevel: 1 | 2 | 3 | 4 | 5) => void;
  resolveBattleConcluded: (
    winner: 'attacker' | 'defender',
    isCapital?: boolean
  ) => SiegeResolutionResult | null;
}

export function useSiegeRealtime(
  regionId?: string | null,
  userClanId?: string | null,
  currentUserId?: string | null
): UseSiegeRealtimeReturn {
  const [activeSession, setActiveSession] = useState<TerritorialBattleSession | null>(null);
  const [sovereignty, setSovereignty] = useState<GeotacticsRegionSovereignty | null>(null);
  const [handshakeSecondsRemaining, setHandshakeSecondsRemaining] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Calcula si el clan del usuario actual es el defensor en esta sesión
  const isDefendingClan = Boolean(
    userClanId && activeSession?.defenderClanId && userClanId === activeSession.defenderClanId
  );

  const isHandshakeActive = Boolean(
    activeSession && activeSession.status === 'handshake_pending' && handshakeSecondsRemaining > 0
  );

  const isHandshakeExpired = Boolean(
    activeSession && activeSession.status === 'handshake_pending' && handshakeSecondsRemaining <= 0
  );

  // Actualizador del reloj Fischer de Handshake (120s -> 0s)
  useEffect(() => {
    if (!activeSession || activeSession.status !== 'handshake_pending') {
      if (timerRef.current) clearInterval(timerRef.current);
      setHandshakeSecondsRemaining(0);
      return;
    }

    const updateRemaining = () => {
      const expiresAt = new Date(activeSession.handshakeExpiresAt).getTime();
      const now = Date.now();
      const diffSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
      setHandshakeSecondsRemaining(diffSec);

      if (diffSec <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    };

    updateRemaining();
    timerRef.current = setInterval(updateRemaining, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeSession]);

  // Suscripción Realtime al canal Broadcast de batalla territorial (siege:region:{regionId})
  useEffect(() => {
    if (!regionId || !supabase) return;

    const channelName = `siege:region:${regionId}`;
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'SIEGE_STATE' }, ({ payload }) => {
        const rawRecord = payload?.record ?? payload?.new ?? payload;
        if (rawRecord && typeof rawRecord === 'object' && 'id' in rawRecord) {
          setActiveSession(mapDbSessionToDomain(rawRecord as Record<string, any>));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [regionId]);

  /**
   * Inicia formalmente el asedio sobre una provincia limítrofe.
   */
  const startSiege = useCallback(
    async (
      attackerClanId: string,
      attackerCommanderId: string,
      currentSovereignty: GeotacticsRegionSovereignty
    ): Promise<TerritorialBattleSession> => {
      setIsLoading(true);
      setError(null);

      const { session, updatedSovereignty } = TerritorialSiegeOrchestrator.createSiegeSession({
        regionId: currentSovereignty.regionId,
        attackerClanId,
        attackerCommanderId,
        defenderClanId: currentSovereignty.controllerClanId,
        sovereignty: currentSovereignty,
      });

      setActiveSession(session);
      setSovereignty(updatedSovereignty);
      audioManager.playSFX('co_power');

      try {
        if (!supabase) throw new Error('Supabase no configurado');
        const { data, error: rpcError } = await supabase.rpc('start_territorial_siege', {
          p_region_id: currentSovereignty.regionId,
          p_attacker_clan_id: attackerClanId,
          p_attacker_commander_id: attackerCommanderId,
          p_defender_clan_id: currentSovereignty.controllerClanId ?? null,
        });

        if (rpcError) throw rpcError;
        if (data) {
          const authoritativeSession = mapDbSessionToDomain(data as Record<string, any>);
          setActiveSession(authoritativeSession);
          return authoritativeSession;
        }
      } catch (err: any) {
        console.warn('[SiegeRealtime] Persistencia remota en fallback local:', err.message);
      } finally {
        setIsLoading(false);
      }

      return session;
    },
    []
  );

  /**
   * Un oficial humano del clan defensor pulsa "Tomar el Mando" antes de los 120s.
   */
  const claimHandshake = useCallback(
    async (defenderCommanderId: string): Promise<{ success: boolean; message?: string }> => {
      if (!activeSession) {
        return { success: false, message: 'No hay ninguna sesión de asedio activa para reclamar.' };
      }

      const res = TerritorialSiegeOrchestrator.claimDefensiveHandshake(
        activeSession,
        defenderCommanderId,
        new Date()
      );

      if (!res.success) {
        setError(res.reason || 'Handshake fallido');
        return { success: false, message: res.reason };
      }

      setActiveSession(res.session);
      audioManager.playSFX('unit_order');

      try {
        if (supabase) {
          const { data, error: rpcError } = await supabase.rpc('claim_territorial_handshake', {
            p_session_id: activeSession.id,
            p_defender_commander_id: defenderCommanderId,
          });
          if (rpcError) throw rpcError;
          if (data) {
            setActiveSession(mapDbSessionToDomain(data as Record<string, any>));
          }
        }
      } catch (err: any) {
        console.warn('[SiegeRealtime] Error al persistir claim:', err.message);
      }

      return { success: true };
    },
    [activeSession]
  );

  /**
   * Resuelve la expiración de los 120 segundos asignando la Guarnición IA correspondiente al nivel del búnker.
   */
  const resolveExpiredHandshake = useCallback(
    (bunkerLevel: 1 | 2 | 3 | 4 | 5) => {
      if (!activeSession || activeSession.status !== 'handshake_pending') return;

      const res = TerritorialSiegeOrchestrator.resolveHandshakeTimeout(
        activeSession,
        bunkerLevel,
        new Date()
      );

      setActiveSession(res.session);

      if (supabase) {
        Promise.resolve(
          supabase.rpc('resolve_territorial_handshake_timeout', {
            p_session_id: activeSession.id,
            p_bunker_level: bunkerLevel,
          })
        )
          .then(({ data, error: rpcError }) => {
            if (rpcError) {
              console.warn('[SiegeRealtime] Fallback timeout local:', rpcError.message);
              return;
            }
            if (data) {
              setActiveSession(mapDbSessionToDomain(data as Record<string, any>));
            }
          })
          .catch((err: unknown) => console.warn('[SiegeRealtime] Fallback timeout local:', err));
      }
    },
    [activeSession]
  );

  /**
   * Resuelve el cierre de la batalla y ajusta los puntos de control TCP.
   */
  const resolveBattleConcluded = useCallback(
    (winner: 'attacker' | 'defender', isCapital: boolean = false): SiegeResolutionResult | null => {
      if (!activeSession || !sovereignty) return null;

      const result = TerritorialSiegeOrchestrator.resolveTerritorialSiege(
        sovereignty,
        activeSession,
        winner,
        isCapital,
        new Date()
      );

      const updatedSov: GeotacticsRegionSovereignty = {
        ...sovereignty,
        controlPoints: result.newControlPoints,
        status: result.newStatus,
        ownerClanId: result.newOwnerClanId,
        controllerClanId: result.newControllerClanId,
        cooldownExpiresAt: result.cooldownExpiresAt,
        graceExpiresAt: result.graceExpiresAt,
        updatedAt: new Date().toISOString(),
      };

      setSovereignty(updatedSov);
      setActiveSession(prev => (prev ? { ...prev, status: 'concluded', concludedAt: new Date().toISOString() } : null));

      if (supabase) {
        Promise.resolve(
          supabase.rpc('resolve_territorial_battle', {
            p_session_id: activeSession.id,
            p_winner: winner,
            p_is_capital: isCapital,
          })
        )
          .then(({ error: rpcError }) => {
            if (rpcError) {
              console.warn('[SiegeRealtime] Fallback resolución batalla local:', rpcError.message);
            }
          })
          .catch((err: unknown) => console.warn('[SiegeRealtime] Fallback resolución batalla local:', err));
      }

      return result;
    },
    [activeSession, sovereignty]
  );

  return {
    activeSession,
    sovereignty,
    handshakeSecondsRemaining,
    isHandshakeActive,
    isHandshakeExpired,
    isDefendingClan,
    isLoading,
    error,
    startSiege,
    claimHandshake,
    resolveExpiredHandshake,
    resolveBattleConcluded,
  };
}