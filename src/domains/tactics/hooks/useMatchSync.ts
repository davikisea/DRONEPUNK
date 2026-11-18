import { useEffect, useRef, useState, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@shared';
import { DeltaAction, TurnSnapshot, MatchSyncEvent } from '@shared';

export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export interface UseMatchSyncOptions {
  matchId: string | null;
  userId: string | null;
  turnNumber: number;
  onRemoteAction?: (action: DeltaAction) => void;
  onStateSync?: (snapshot: TurnSnapshot) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
}

export interface UseMatchSyncReturn {
  connectionStatus: ConnectionStatus;
  latencyMs: number;
  broadcastAction: (action: Omit<DeltaAction, 'actionId' | 'timestamp'>) => Promise<boolean>;
  requestStateResync: () => Promise<void>;
  disconnect: () => void;
}

export function useMatchSync({
  matchId,
  userId,
  turnNumber,
  onRemoteAction,
  onStateSync,
  onConnectionChange,
}: UseMatchSyncOptions): UseMatchSyncReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [latencyMs, setLatencyMs] = useState<number>(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const actionCounterRef = useRef<number>(0);
  const pingTimestampRef = useRef<number>(0);

  const updateStatus = useCallback(
    (status: ConnectionStatus) => {
      setConnectionStatus(status);
      onConnectionChange?.(status);
    },
    [onConnectionChange]
  );

  // Desconectar canal activo
  const disconnect = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    updateStatus('DISCONNECTED');
  }, [updateStatus]);

  // Transmitir acción táctica al rival mediante Broadcast de baja latencia (<50ms)
  const broadcastAction = useCallback(
    async (actionPayload: Omit<DeltaAction, 'actionId' | 'timestamp'>): Promise<boolean> => {
      const channel = channelRef.current;
      if (!channel || connectionStatus !== 'CONNECTED') {
        return false;
      }

      actionCounterRef.current += 1;
      const fullAction: DeltaAction = {
        ...actionPayload,
        actionId: actionCounterRef.current,
        timestamp: Date.now(),
      };

      // Validación autoritativa server-side (1-100 HP, turno e idempotencia)
      if (matchId && supabase?.rpc) {
        const idempotencyKey =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : undefined;

        const { error: rpcError } = await supabase.rpc('submit_match_action', {
          p_match_id: matchId,
          p_turn_number: turnNumber,
          p_action_index: fullAction.actionId,
          p_action_payload: fullAction as unknown as Record<string, never>,
          p_idempotency_key: idempotencyKey ?? null,
        });

        if (rpcError) {
          console.warn('[useMatchSync] submit_match_action rechazó la acción:', rpcError.message);
          return false;
        }
      }

      const syncMessage: MatchSyncEvent = {
        type: 'MATCH_ACTION',
        matchId: matchId || '',
        senderId: userId || '',
        turnNumber,
        action: fullAction,
        timestamp: Date.now(),
      };

      const resp = await channel.send({
        type: 'broadcast',
        event: 'MATCH_ACTION',
        payload: syncMessage,
      });

      return resp === 'ok';
    },
    [connectionStatus, matchId, userId, turnNumber]
  );

  // Solicitar recuperación de estado ante reconexión
  const requestStateResync = useCallback(async () => {
    if (!matchId) return;

    try {
      updateStatus('RECONNECTING');
      const { data, error } = await supabase.rpc('rpc_reconnect_match_state', {
        p_match_id: matchId,
        p_user_id: userId || '00000000-0000-0000-0000-000000000000',
      });

      if (!error && data && typeof data === 'object' && !Array.isArray(data) && 'snapshot' in data && data.snapshot) {
        onStateSync?.(data.snapshot as unknown as TurnSnapshot);
        updateStatus('CONNECTED');
      }
    } catch {
      // Si la RPC no está disponible (modo offline o fallback), mantener estado actual
    }
  }, [matchId, userId, onStateSync, updateStatus]);

  // Suscripción al Canal WebSocket Realtime
  useEffect(() => {
    if (!matchId || !userId) {
      disconnect();
      return;
    }

    updateStatus('CONNECTING');

    const channel = supabase.channel(`match:${matchId}`, {
      config: {
        broadcast: { ack: true, self: false },
        presence: { key: userId },
      },
    });

    // 1. Escuchar acciones tácticas del rival (formato v3 Broadcast y MatchSyncEvent)
    channel.on('broadcast', { event: 'MATCH_ACTION' }, ({ payload }) => {
      if (!payload) return;
      if (payload.v === 3 && payload.record) {
        const rec = payload.record as { actor_id?: string; action_payload?: DeltaAction };
        if (rec.actor_id !== userId && rec.action_payload) {
          onRemoteAction?.(rec.action_payload);
        }
        return;
      }
      const event = payload as MatchSyncEvent;
      if (event && event.senderId !== userId && event.action) {
        onRemoteAction?.(event.action);
      }
    });

    // 2. Ping de latencia para el reloj Fischer
    channel.on('broadcast', { event: 'TACTICAL_PING' }, () => {
      channel.send({
        type: 'broadcast',
        event: 'TACTICAL_PONG',
        payload: { t: Date.now() },
      });
    });

    channel.on('broadcast', { event: 'TACTICAL_PONG' }, () => {
      if (pingTimestampRef.current > 0) {
        const roundtrip = Date.now() - pingTimestampRef.current;
        setLatencyMs(Math.round(roundtrip / 2));
      }
    });

    // 3. Suscripción y manejo de ciclo de vida
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        updateStatus('CONNECTED');

        // Medir latencia inicial
        pingTimestampRef.current = Date.now();
        channel.send({
          type: 'broadcast',
          event: 'TACTICAL_PING',
          payload: { t: pingTimestampRef.current },
        });
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        updateStatus('DISCONNECTED');
      } else if (status === 'TIMED_OUT') {
        updateStatus('RECONNECTING');
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId, userId, onRemoteAction, disconnect, updateStatus]);

  return {
    connectionStatus,
    latencyMs,
    broadcastAction,
    requestStateResync,
    disconnect,
  };
}