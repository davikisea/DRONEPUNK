/**
 * ==============================================================================
 * HOOK DE SINCRONIZACIÓN REALTIME POR REGIÓN (BROADCAST v3)
 * ==============================================================================
 * Contrato SQL/RPC v3 (10,000+ CCU):
 * - Sustituye suscripciones globales `postgres_changes` por canales segmentados
 *   `world:region:{regionId}` escuchando eventos Broadcast v3:
 *   `ENTITY_UPSERT` y `ENTITY_DELETE`.
 * - Acumula y coalescea deltas en memoria con debounce (150ms por defecto) antes
 *   de entregarlos a `onDeltaBatch`, evitando waterfalls de queries.
 * - Cero llamadas a `supabase.auth.getUser()` en el hot-path: usa `userId`
 *   recibido por props o `supabase.auth.getSession()` como fallback único.
 * - Incluye helper puro `applyWorldDeltaToCollections(...)` para aplicar
 *   upserts/deletes incrementales sobre `buildings`, `infra_edges` y
 *   `operational_units`.
 * ==============================================================================
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@shared';
import type {
  DbBuildingRecord,
  DbInfraEdgeRecord,
  DbOperationalUnitRecord,
} from '@domains/economy';

export const WORLD_BROADCAST_VERSION = 3 as const;
export const DEFAULT_WORLD_DELTA_DEBOUNCE_MS = 150;

export type WorldBroadcastEvent = 'ENTITY_UPSERT' | 'ENTITY_DELETE';

export type WorldEntityTable =
  | 'buildings'
  | 'infra_edges'
  | 'operational_units'
  | 'state_sovereignty';

export type WorldBroadcastOp = 'INSERT' | 'UPDATE' | 'DELETE';

export interface WorldBroadcastPayloadV3<TRecord = Record<string, unknown>> {
  v: 3;
  event: WorldBroadcastEvent;
  table: WorldEntityTable | string;
  region_id: string;
  h3_cell: number | null;
  op: WorldBroadcastOp;
  seq: number;
  ts: string;
  record: TRecord;
}

export type WorldBroadcastDelta<TRecord = Record<string, unknown>> =
  WorldBroadcastPayloadV3<TRecord>;

export interface WorldDeltaBatch {
  deltas: WorldBroadcastDelta[];
  byTable: {
    buildings: WorldBroadcastDelta<DbBuildingRecord>[];
    infra_edges: WorldBroadcastDelta<DbInfraEdgeRecord>[];
    operational_units: WorldBroadcastDelta<DbOperationalUnitRecord>[];
    state_sovereignty: WorldBroadcastDelta<Record<string, unknown>>[];
  };
  regionIds: string[];
  flushedAt: number;
  latestSeq: number | null;
}

export type WorldResyncReason =
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'RECONNECTED';

export interface UseWorldRegionBroadcastOptions {
  regionIds: readonly string[];
  corpId?: string | null;
  userId?: string | null;
  onDeltaBatch: (batch: WorldDeltaBatch) => void;
  onResyncNeeded?: (reason: WorldResyncReason, regionId: string) => void;
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseWorldRegionBroadcastResult {
  subscribedRegions: string[];
  isConnected: boolean;
  resolvedUserId: string | null;
  lastSeq: number | null;
  flush: () => void;
}

export interface WorldCollectionsState {
  buildings: DbBuildingRecord[];
  infra_edges: DbInfraEdgeRecord[];
  operational_units: DbOperationalUnitRecord[];
}

export interface ApplyWorldDeltaResult extends WorldCollectionsState {
  appliedCount: number;
  changedTables: Array<'buildings' | 'infra_edges' | 'operational_units'>;
}

const VALID_EVENTS = new Set<string>(['ENTITY_UPSERT', 'ENTITY_DELETE']);

/**
 * Extrae y valida un payload Broadcast v3 desde el sobre entregado por
 * Supabase Realtime (`{ event, type, payload }`) o directamente.
 */
export function parseWorldBroadcastPayload(
  rawEnvelope: unknown
): WorldBroadcastDelta | null {
  if (!rawEnvelope || typeof rawEnvelope !== 'object') return null;

  const envelope = rawEnvelope as Record<string, unknown>;
  let candidate: unknown =
    'payload' in envelope && envelope.payload && typeof envelope.payload === 'object'
      ? envelope.payload
      : envelope;

  if (
    candidate &&
    typeof candidate === 'object' &&
    'payload' in (candidate as Record<string, unknown>) &&
    (candidate as Record<string, unknown>).v !== WORLD_BROADCAST_VERSION
  ) {
    candidate = (candidate as Record<string, unknown>).payload;
  }

  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as Record<string, unknown>;

  if (data.v !== WORLD_BROADCAST_VERSION) return null;
  if (typeof data.event !== 'string' || !VALID_EVENTS.has(data.event)) return null;
  if (typeof data.table !== 'string' || data.table.length === 0) return null;
  if (!data.record || typeof data.record !== 'object') return null;

  const op: WorldBroadcastOp =
    data.op === 'INSERT' || data.op === 'UPDATE' || data.op === 'DELETE'
      ? data.op
      : data.event === 'ENTITY_DELETE'
        ? 'DELETE'
        : 'UPDATE';

  return {
    v: 3,
    event: data.event as WorldBroadcastEvent,
    table: data.table,
    region_id: typeof data.region_id === 'string' && data.region_id ? data.region_id : 'GLOBAL',
    h3_cell: typeof data.h3_cell === 'number' ? data.h3_cell : null,
    op,
    seq: typeof data.seq === 'number' ? data.seq : Date.now(),
    ts: typeof data.ts === 'string' ? data.ts : new Date().toISOString(),
    record: data.record as Record<string, unknown>,
  };
}

function getRecordId(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const id = (record as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function applyDeltaListToCollection<T extends { id: string }>(
  current: readonly T[],
  deltas: readonly WorldBroadcastDelta[]
): { next: T[]; changed: boolean } {
  if (deltas.length === 0) {
    return { next: current as T[], changed: false };
  }

  const next = current.slice();
  const indexById = new Map<string, number>();
  for (let i = 0; i < next.length; i++) {
    indexById.set(next[i].id, i);
  }

  let changed = false;

  for (const delta of deltas) {
    const id = getRecordId(delta.record);
    if (!id) continue;

    const existingIdx = indexById.get(id);
    const isDelete = delta.event === 'ENTITY_DELETE' || delta.op === 'DELETE';

    if (isDelete) {
      if (existingIdx !== undefined) {
        next.splice(existingIdx, 1);
        indexById.clear();
        for (let i = 0; i < next.length; i++) {
          indexById.set(next[i].id, i);
        }
        changed = true;
      }
      continue;
    }

    const incoming = delta.record as unknown as T;
    if (existingIdx !== undefined) {
      next[existingIdx] = { ...next[existingIdx], ...incoming };
      changed = true;
    } else {
      indexById.set(id, next.length);
      next.push(incoming);
      changed = true;
    }
  }

  return { next: changed ? next : (current as T[]), changed };
}

/**
 * Helper puro e inmutable para aplicar uno o varios deltas Broadcast v3
 * (o un `WorldDeltaBatch`) sobre las colecciones locales del mapa mundial.
 */
export function applyWorldDeltaToCollections(
  collections: WorldCollectionsState,
  deltaOrBatch: WorldBroadcastDelta | readonly WorldBroadcastDelta[] | WorldDeltaBatch
): ApplyWorldDeltaResult {
  const deltas: readonly WorldBroadcastDelta[] = Array.isArray(deltaOrBatch)
    ? deltaOrBatch
    : 'deltas' in deltaOrBatch
      ? deltaOrBatch.deltas
      : [deltaOrBatch];

  if (deltas.length === 0) {
    return {
      ...collections,
      appliedCount: 0,
      changedTables: [],
    };
  }

  const buildingDeltas: WorldBroadcastDelta[] = [];
  const edgeDeltas: WorldBroadcastDelta[] = [];
  const unitDeltas: WorldBroadcastDelta[] = [];

  for (const d of deltas) {
    if (d.table === 'buildings') buildingDeltas.push(d);
    else if (d.table === 'infra_edges') edgeDeltas.push(d);
    else if (d.table === 'operational_units') unitDeltas.push(d);
  }

  const bRes = applyDeltaListToCollection(collections.buildings, buildingDeltas);
  const eRes = applyDeltaListToCollection(collections.infra_edges, edgeDeltas);
  const uRes = applyDeltaListToCollection(collections.operational_units, unitDeltas);

  const changedTables: Array<'buildings' | 'infra_edges' | 'operational_units'> = [];
  if (bRes.changed) changedTables.push('buildings');
  if (eRes.changed) changedTables.push('infra_edges');
  if (uRes.changed) changedTables.push('operational_units');

  return {
    buildings: bRes.next,
    infra_edges: eRes.next,
    operational_units: uRes.next,
    appliedCount: buildingDeltas.length + edgeDeltas.length + unitDeltas.length,
    changedTables,
  };
}

function buildWorldDeltaBatch(deltas: WorldBroadcastDelta[]): WorldDeltaBatch {
  const byTable: WorldDeltaBatch['byTable'] = {
    buildings: [],
    infra_edges: [],
    operational_units: [],
    state_sovereignty: [],
  };
  const regionSet = new Set<string>();
  let latestSeq: number | null = null;

  for (const delta of deltas) {
    regionSet.add(delta.region_id);
    if (latestSeq === null || delta.seq > latestSeq) {
      latestSeq = delta.seq;
    }
    switch (delta.table) {
      case 'buildings':
        byTable.buildings.push(delta as unknown as WorldBroadcastDelta<DbBuildingRecord>);
        break;
      case 'infra_edges':
        byTable.infra_edges.push(delta as unknown as WorldBroadcastDelta<DbInfraEdgeRecord>);
        break;
      case 'operational_units':
        byTable.operational_units.push(delta as unknown as WorldBroadcastDelta<DbOperationalUnitRecord>);
        break;
      case 'state_sovereignty':
        byTable.state_sovereignty.push(delta);
        break;
      default:
        break;
    }
  }

  return {
    deltas,
    byTable,
    regionIds: Array.from(regionSet),
    flushedAt: Date.now(),
    latestSeq,
  };
}

/**
 * Suscribe a canales segmentados `world:region:{regionId}` con Broadcast v3,
 * coalesciendo y debouncing los deltas en memoria antes de invocar `onDeltaBatch`.
 */
export function useWorldRegionBroadcast({
  regionIds,
  corpId: _corpId,
  userId,
  onDeltaBatch,
  onResyncNeeded,
  debounceMs = DEFAULT_WORLD_DELTA_DEBOUNCE_MS,
  enabled = true,
}: UseWorldRegionBroadcastOptions): UseWorldRegionBroadcastResult {
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(userId ?? null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastSeq, setLastSeq] = useState<number | null>(null);

  const onDeltaBatchRef = useRef(onDeltaBatch);
  onDeltaBatchRef.current = onDeltaBatch;

  const onResyncNeededRef = useRef(onResyncNeeded);
  onResyncNeededRef.current = onResyncNeeded;

  const pendingMapRef = useRef<Map<string, WorldBroadcastDelta>>(new Map());
  const unkeyedQueueRef = useRef<WorldBroadcastDelta[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadErrorByRegionRef = useRef<Set<string>>(new Set());

  const normalizedRegions = useMemo(() => {
    const unique = new Set<string>();
    for (const raw of regionIds) {
      const trimmed = raw?.trim();
      if (trimmed) unique.add(trimmed);
    }
    return Array.from(unique).sort();
  }, [regionIds]);

  const regionsKey = normalizedRegions.join('|');

  // Evita `supabase.auth.getUser()` en el hot-path: usa `userId` o `getSession()`.
  useEffect(() => {
    if (userId) {
      setResolvedUserId(userId);
      return;
    }
    if (!enabled || !isSupabaseConfigured() || !supabase) {
      setResolvedUserId(null);
      return;
    }

    let cancelled = false;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) {
          setResolvedUserId(data.session?.user?.id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedUserId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, enabled]);

  const flush = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (pendingMapRef.current.size === 0 && unkeyedQueueRef.current.length === 0) {
      return;
    }

    const combined = [
      ...Array.from(pendingMapRef.current.values()),
      ...unkeyedQueueRef.current,
    ];
    pendingMapRef.current.clear();
    unkeyedQueueRef.current = [];

    const batch = buildWorldDeltaBatch(combined);
    if (batch.latestSeq !== null) {
      setLastSeq((prev) => (prev === null || batch.latestSeq! > prev ? batch.latestSeq! : prev));
    }
    onDeltaBatchRef.current(batch);
  }, []);

  const enqueueDelta = useCallback(
    (delta: WorldBroadcastDelta) => {
      const id = getRecordId(delta.record);
      if (id) {
        const key = `${delta.table}:${id}`;
        const existing = pendingMapRef.current.get(key);
        if (!existing || delta.seq >= existing.seq) {
          pendingMapRef.current.set(key, delta);
        }
      } else {
        unkeyedQueueRef.current.push(delta);
      }

      if (debounceMs <= 0) {
        flush();
        return;
      }

      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        flush();
      }, debounceMs);
    },
    [debounceMs, flush]
  );

  useEffect(() => {
    if (!enabled || normalizedRegions.length === 0 || !isSupabaseConfigured() || !supabase) {
      setIsConnected(false);
      return;
    }

    const client = supabase;
    const channels: RealtimeChannel[] = [];
    const connectedRegions = new Set<string>();
    let disposed = false;

    const handleEnvelope = (raw: unknown) => {
      if (disposed) return;
      const parsed = parseWorldBroadcastPayload(raw);
      if (parsed) {
        enqueueDelta(parsed);
      }
    };

    for (const regionId of normalizedRegions) {
      const topic = `world:region:${regionId}`;
      const channel = client
        .channel(topic)
        .on('broadcast', { event: 'ENTITY_UPSERT' }, handleEnvelope)
        .on('broadcast', { event: 'ENTITY_DELETE' }, handleEnvelope)
        .subscribe((status) => {
          if (disposed) return;

          if (status === 'SUBSCRIBED') {
            connectedRegions.add(regionId);
            setIsConnected(true);
            if (hadErrorByRegionRef.current.has(regionId)) {
              hadErrorByRegionRef.current.delete(regionId);
              onResyncNeededRef.current?.('RECONNECTED', regionId);
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            connectedRegions.delete(regionId);
            setIsConnected(connectedRegions.size > 0);
            hadErrorByRegionRef.current.add(regionId);
            onResyncNeededRef.current?.(status, regionId);
          } else if (status === 'CLOSED') {
            connectedRegions.delete(regionId);
            setIsConnected(connectedRegions.size > 0);
          }
        });

      channels.push(channel);
    }

    return () => {
      disposed = true;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingMapRef.current.clear();
      unkeyedQueueRef.current = [];
      setIsConnected(false);
      for (const ch of channels) {
        void client.removeChannel(ch);
      }
    };
  }, [enabled, regionsKey, enqueueDelta]);

  return {
    subscribedRegions: normalizedRegions,
    isConnected,
    resolvedUserId,
    lastSeq,
    flush,
  };
}
