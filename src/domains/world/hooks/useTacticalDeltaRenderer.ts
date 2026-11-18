/**
 * ==============================================================================
 * MOTOR DE RENDERIZADO DELTA WEBGL (USE TACTICAL DELTA RENDERER)
 * ==============================================================================
 * Especificación MapLibre GL v6:
 * - Reemplaza GeoJSONSource.setData() completo a 10 Hz sobre `tactical-rts-units`
 *   y capas operacionales por actualizaciones incrementales `source.updateData({ add, update, remove })`.
 * - Fallback seguro a `setData()` throttled únicamente cuando cambia el conjunto
 *   y `updateData` no está disponible.
 * - Loop `requestAnimationFrame` (hasta 60 FPS) con interpolación continua para
 *   `TacticalRtsEngine` y throttle configurable cuando la pestaña está oculta.
 * ==============================================================================
 */

import { useCallback, useEffect, useRef } from 'react';
import type {
  GeoJSONFeatureDiff,
  GeoJSONFeatureId,
  GeoJSONSourceDiff,
  Map as MapLibreMap,
} from 'maplibre-gl';
import type { TacticalRtsEngine } from '@domains/tactics';
import { resolveUnitSpriteKey } from '@shared';
import { gridCoordsToLngLat, lngLatToGridCoords, ZOOM_TACTICO } from '../core/coordinates';

export const DEFAULT_TACTICAL_GRID_DIMENSION = 20;
export const DEFAULT_RTS_SOURCE_ID = 'tactical-rts-units';
export const DEFAULT_TARGET_FPS = 60;
export const DEFAULT_HIDDEN_THROTTLE_MS = 1000;
export const DEFAULT_FALLBACK_THROTTLE_MS = 100;
const DEFAULT_COORD_EPSILON = 1e-7;

export interface GeoJSONDeltaSourceLike {
  updateData?: (diff: GeoJSONSourceDiff) => Promise<void> | void;
  setData: (data: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry | string) => unknown;
}

export interface DeltaSyncStats {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  usedNativeDelta: boolean;
  skippedByThrottle: boolean;
}

export interface GeoJSONDeltaChannelOptions {
  /** Intervalo mínimo entre llamadas de fallback `setData()` en ms (por defecto 100 ms). */
  fallbackThrottleMs?: number;
  /** Tolerancia numérica para detectar cambios de coordenadas (por defecto 1e-7 grados). */
  coordEpsilon?: number;
}

export interface TacticalRtsUnitFeatureProps {
  id: string;
  code: string;
  spriteKey: string;
  hp: number;
  isAlly: boolean;
  isSelected: boolean;
  [key: string]: unknown;
}

interface TrackedFeatureSnapshot {
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

function areCoordinatesEqual(a: unknown, b: unknown, epsilon: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= epsilon;
  }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!areCoordinatesEqual(a[i], b[i], epsilon)) {
      return false;
    }
  }
  return true;
}

function areGeometriesEqual(
  a: GeoJSON.Geometry,
  b: GeoJSON.Geometry,
  epsilon: number
): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'GeometryCollection' && b.type === 'GeometryCollection') {
    if (a.geometries.length !== b.geometries.length) return false;
    for (let i = 0; i < a.geometries.length; i++) {
      if (!areGeometriesEqual(a.geometries[i], b.geometries[i], epsilon)) {
        return false;
      }
    }
    return true;
  }
  if ('coordinates' in a && 'coordinates' in b) {
    return areCoordinatesEqual(a.coordinates, b.coordinates, epsilon);
  }
  return false;
}

function arePropertyValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!arePropertyValuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const k = aKeys[i];
      if (!Object.prototype.hasOwnProperty.call(bObj, k)) return false;
      if (!arePropertyValuesEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }
  return false;
}

function cloneGeometry(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  if (geometry.type === 'Point') {
    return {
      type: 'Point',
      coordinates: [...geometry.coordinates],
    };
  }
  return JSON.parse(JSON.stringify(geometry)) as GeoJSON.Geometry;
}

function resolveFeatureId(
  feature: GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>
): GeoJSONFeatureId | null {
  if (typeof feature.id === 'string' || typeof feature.id === 'number') {
    return feature.id;
  }
  const propId = feature.properties?.id;
  if (typeof propId === 'string' || typeof propId === 'number') {
    return propId;
  }
  return null;
}

/**
 * Canal de sincronización incremental para cualquier `GeoJSONSource` de MapLibre GL v6.
 * Mantiene el último snapshot confirmado por ID para emitir únicamente `{ add, update, remove }`
 * mediante `source.updateData()`, evitando reconstruir `FeatureCollection` completos.
 */
export class GeoJSONDeltaChannel<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  private snapshot = new Map<GeoJSONFeatureId, TrackedFeatureSnapshot>();
  private lastFallbackSetDataAt = 0;
  private readonly fallbackThrottleMs: number;
  private readonly coordEpsilon: number;

  constructor(options: GeoJSONDeltaChannelOptions = {}) {
    this.fallbackThrottleMs = Math.max(0, options.fallbackThrottleMs ?? DEFAULT_FALLBACK_THROTTLE_MS);
    this.coordEpsilon = options.coordEpsilon ?? DEFAULT_COORD_EPSILON;
  }

  public getTrackedCount(): number {
    return this.snapshot.size;
  }

  public reset(): void {
    this.snapshot.clear();
    this.lastFallbackSetDataAt = 0;
  }

  public clear(source?: GeoJSONDeltaSourceLike | null): void {
    const hadFeatures = this.snapshot.size > 0;
    this.snapshot.clear();
    if (!source || !hadFeatures) return;

    if (typeof source.updateData === 'function') {
      try {
        const res = source.updateData({ removeAll: true });
        if (res && typeof (res as Promise<void>).catch === 'function') {
          (res as Promise<void>).catch(() => {
            source.setData({ type: 'FeatureCollection', features: [] });
          });
        }
      } catch {
        source.setData({ type: 'FeatureCollection', features: [] });
      }
    } else {
      source.setData({ type: 'FeatureCollection', features: [] });
    }
  }

  public apply(
    source: GeoJSONDeltaSourceLike | null | undefined,
    nextFeatures: ReadonlyArray<GeoJSON.Feature<GeoJSON.Geometry, P> & { id?: GeoJSONFeatureId }>,
    nowMs: number = Date.now()
  ): DeltaSyncStats {
    if (!source) {
      return {
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: this.snapshot.size,
        usedNativeDelta: false,
        skippedByThrottle: false,
      };
    }

    const add: GeoJSON.Feature[] = [];
    const update: GeoJSONFeatureDiff[] = [];
    const seenIds = new Set<GeoJSONFeatureId>();
    const nextSnapshot = new Map<GeoJSONFeatureId, TrackedFeatureSnapshot>();
    const normalizedFeatures: Array<GeoJSON.Feature<GeoJSON.Geometry, P>> = [];
    let unchanged = 0;

    for (let i = 0; i < nextFeatures.length; i++) {
      const raw = nextFeatures[i];
      const id = resolveFeatureId(raw);
      if (id === null) continue;

      seenIds.add(id);
      const props = (raw.properties ?? {}) as Record<string, unknown>;
      const normalizedFeature: GeoJSON.Feature<GeoJSON.Geometry, P> = {
        ...raw,
        id,
      };
      normalizedFeatures.push(normalizedFeature);

      const prev = this.snapshot.get(id);
      if (!prev) {
        add.push(normalizedFeature);
        nextSnapshot.set(id, {
          geometry: cloneGeometry(raw.geometry),
          properties: { ...props },
        });
        continue;
      }

      const geomChanged = !areGeometriesEqual(prev.geometry, raw.geometry, this.coordEpsilon);
      const addOrUpdateProperties: Array<{ key: string; value: unknown }> = [];
      const removeProperties: string[] = [];

      const nextKeys = Object.keys(props);
      for (let k = 0; k < nextKeys.length; k++) {
        const key = nextKeys[k];
        if (
          !Object.prototype.hasOwnProperty.call(prev.properties, key) ||
          !arePropertyValuesEqual(prev.properties[key], props[key])
        ) {
          addOrUpdateProperties.push({ key, value: props[key] });
        }
      }

      const prevKeys = Object.keys(prev.properties);
      for (let k = 0; k < prevKeys.length; k++) {
        const key = prevKeys[k];
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          removeProperties.push(key);
        }
      }

      if (geomChanged || addOrUpdateProperties.length > 0 || removeProperties.length > 0) {
        const featureDiff: GeoJSONFeatureDiff = { id };
        if (geomChanged) {
          featureDiff.newGeometry = raw.geometry;
        }
        if (removeProperties.length > 0) {
          featureDiff.removeProperties = removeProperties;
        }
        if (addOrUpdateProperties.length > 0) {
          featureDiff.addOrUpdateProperties = addOrUpdateProperties;
        }
        update.push(featureDiff);
        nextSnapshot.set(id, {
          geometry: geomChanged ? cloneGeometry(raw.geometry) : prev.geometry,
          properties: { ...props },
        });
      } else {
        unchanged++;
        nextSnapshot.set(id, prev);
      }
    }

    const remove: GeoJSONFeatureId[] = [];
    for (const prevId of this.snapshot.keys()) {
      if (!seenIds.has(prevId)) {
        remove.push(prevId);
      }
    }

    const hasChanges = add.length > 0 || update.length > 0 || remove.length > 0;
    if (!hasChanges) {
      return {
        added: 0,
        updated: 0,
        removed: 0,
        unchanged,
        usedNativeDelta: typeof source.updateData === 'function',
        skippedByThrottle: false,
      };
    }

    const hasNativeUpdateData = typeof source.updateData === 'function';

    if (hasNativeUpdateData) {
      const diff: GeoJSONSourceDiff = {};
      if (nextFeatures.length === 0 && this.snapshot.size > 0) {
        diff.removeAll = true;
      } else {
        if (remove.length > 0) diff.remove = remove;
        if (add.length > 0) diff.add = add;
        if (update.length > 0) diff.update = update;
      }

      this.snapshot = nextSnapshot;
      try {
        const result = source.updateData!(diff);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {
            source.setData({ type: 'FeatureCollection', features: normalizedFeatures });
          });
        }
      } catch {
        source.setData({ type: 'FeatureCollection', features: normalizedFeatures });
      }

      return {
        added: add.length,
        updated: update.length,
        removed: remove.length,
        unchanged,
        usedNativeDelta: true,
        skippedByThrottle: false,
      };
    }

    // Fallback seguro a setData() throttled solo si el conjunto cambió realmente.
    const isTransitionToOrFromEmpty =
      (this.snapshot.size === 0 && normalizedFeatures.length > 0) ||
      (this.snapshot.size > 0 && normalizedFeatures.length === 0);

    if (
      !isTransitionToOrFromEmpty &&
      this.fallbackThrottleMs > 0 &&
      nowMs - this.lastFallbackSetDataAt < this.fallbackThrottleMs
    ) {
      // No actualizamos `this.snapshot` para conservar los cambios pendientes hasta el próximo flush.
      return {
        added: 0,
        updated: 0,
        removed: 0,
        unchanged,
        usedNativeDelta: false,
        skippedByThrottle: true,
      };
    }

    this.lastFallbackSetDataAt = nowMs;
    this.snapshot = nextSnapshot;
    source.setData({
      type: 'FeatureCollection',
      features: normalizedFeatures,
    });

    return {
      added: add.length,
      updated: update.length,
      removed: remove.length,
      unchanged,
      usedNativeDelta: false,
      skippedByThrottle: false,
    };
  }
}

export interface BuildRtsUnitFeaturesParams {
  rtsEngine: TacticalRtsEngine;
  anchorSector: [number, number];
  userClanId?: string | null;
  selectedUnitId?: string | null;
  gridDimension?: number;
}

/**
 * Construye las features GeoJSON con ID top-level y coordenadas interpoladas
 * continuamente desde `TacticalRtsEngine.getInterpolatedUnitCoords`.
 */
export function buildTacticalRtsUnitFeatures({
  rtsEngine,
  anchorSector,
  userClanId,
  selectedUnitId,
  gridDimension = DEFAULT_TACTICAL_GRID_DIMENSION,
}: BuildRtsUnitFeaturesParams): Array<
  GeoJSON.Feature<GeoJSON.Point, TacticalRtsUnitFeatureProps> & { id: string }
> {
  const units = rtsEngine.getAllUnits();
  const allyClan = userClanId || 'clan-ferro';
  const features: Array<
    GeoJSON.Feature<GeoJSON.Point, TacticalRtsUnitFeatureProps> & { id: string }
  > = [];

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.isDestroyed) continue;

    const interp = rtsEngine.getInterpolatedUnitCoords(u.id);
    const ux = interp ? interp.x : u.x;
    const uy = interp ? interp.y : u.y;

    if (ux < 0 || ux >= gridDimension || uy < 0 || uy >= gridDimension) {
      continue;
    }

    const unitOwner = (u as { ownerId?: string }).ownerId || u.owner;
    const isAlly = unitOwner === allyClan;

    features.push({
      type: 'Feature',
      id: u.id,
      geometry: {
        type: 'Point',
        coordinates: gridCoordsToLngLat(anchorSector, [ux, uy], gridDimension, ZOOM_TACTICO),
      },
      properties: {
        id: u.id,
        code: String(u.unitCode || 'UNT').slice(0, 8).toUpperCase(),
        spriteKey: resolveUnitSpriteKey(u.unitCode || 'tank_light'),
        hp: u.hp ?? 100,
        isAlly,
        isSelected: u.id === (selectedUnitId ?? null),
      },
    });
  }

  return features;
}

export interface UseTacticalDeltaRendererOptions {
  mapRef: React.RefObject<MapLibreMap | null>;
  rtsEngineRef: React.RefObject<TacticalRtsEngine | null>;
  anchorSectorRef?: React.RefObject<[number, number] | null>;
  selectedUnitIdRef?: React.RefObject<string | null>;
  userClanId?: string | null;
  enabled?: boolean;
  isStandby?: boolean;
  currentZoom?: number;
  minZoom?: number;
  gridDimension?: number;
  sourceId?: string;
  /** FPS objetivo en pestaña visible (máximo 60). */
  targetFps?: number;
  /** Throttle en ms cuando la pestaña está oculta (<= 0 pausa el loop en segundo plano). */
  hiddenThrottleMs?: number;
  /** Throttle en ms para el fallback `setData()` si `updateData()` no existe. */
  fallbackThrottleMs?: number;
  /** Callback ejecutado en cada paso del loop para sincronizar capas operacionales adicionales. */
  onTick?: (info: {
    now: number;
    stateChanged: boolean;
    isDirty: boolean;
    isHidden: boolean;
  }) => void;
}

export interface UseTacticalDeltaRendererResult {
  syncRtsUnitsNow: () => DeltaSyncStats | null;
  syncOperationalLayer: <P extends Record<string, unknown>>(
    sourceId: string,
    features: ReadonlyArray<GeoJSON.Feature<GeoJSON.Geometry, P> & { id?: GeoJSONFeatureId }>
  ) => DeltaSyncStats | null;
  resetChannel: (sourceId?: string) => void;
  getStats: () => {
    fps: number;
    lastDelta: DeltaSyncStats | null;
    isTabHidden: boolean;
  };
}

export function useTacticalDeltaRenderer({
  mapRef,
  rtsEngineRef,
  anchorSectorRef,
  selectedUnitIdRef,
  userClanId,
  enabled = true,
  isStandby = false,
  currentZoom,
  minZoom = ZOOM_TACTICO - 1.0,
  gridDimension = DEFAULT_TACTICAL_GRID_DIMENSION,
  sourceId = DEFAULT_RTS_SOURCE_ID,
  targetFps = DEFAULT_TARGET_FPS,
  hiddenThrottleMs = DEFAULT_HIDDEN_THROTTLE_MS,
  fallbackThrottleMs = DEFAULT_FALLBACK_THROTTLE_MS,
  onTick,
}: UseTacticalDeltaRendererOptions): UseTacticalDeltaRendererResult {
  const channelsRef = useRef<Map<string, GeoJSONDeltaChannel<Record<string, unknown>>>>(new Map());
  const lastDeltaRef = useRef<DeltaSyncStats | null>(null);
  const fpsRef = useRef<number>(0);
  const isTabHiddenRef = useRef<boolean>(
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false
  );

  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const userClanIdRef = useRef(userClanId);
  userClanIdRef.current = userClanId;

  const currentZoomRef = useRef(currentZoom);
  currentZoomRef.current = currentZoom;

  const getOrCreateChannel = useCallback(
    (targetSourceId: string): GeoJSONDeltaChannel<Record<string, unknown>> => {
      let channel = channelsRef.current.get(targetSourceId);
      if (!channel) {
        channel = new GeoJSONDeltaChannel({ fallbackThrottleMs });
        channelsRef.current.set(targetSourceId, channel);
      }
      return channel;
    },
    [fallbackThrottleMs]
  );

  const syncOperationalLayer = useCallback(
    <P extends Record<string, unknown>>(
      targetSourceId: string,
      features: ReadonlyArray<GeoJSON.Feature<GeoJSON.Geometry, P> & { id?: GeoJSONFeatureId }>
    ): DeltaSyncStats | null => {
      const map = mapRef.current;
      if (!map) return null;
      const src = map.getSource(targetSourceId) as unknown as GeoJSONDeltaSourceLike | undefined;
      if (!src) return null;

      const channel = getOrCreateChannel(targetSourceId);
      return channel.apply(
        src,
        features as ReadonlyArray<GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>> & { id?: GeoJSONFeatureId }>,
        Date.now()
      );
    },
    [getOrCreateChannel, mapRef]
  );

  const syncRtsUnitsNow = useCallback((): DeltaSyncStats | null => {
    const map = mapRef.current;
    const rtsEngine = rtsEngineRef.current;
    if (!map || !rtsEngine) return null;

    const src = map.getSource(sourceId) as unknown as GeoJSONDeltaSourceLike | undefined;
    if (!src) return null;

    const channel = getOrCreateChannel(sourceId);
    const zoom = typeof currentZoomRef.current === 'number' ? currentZoomRef.current : map.getZoom();

    if (zoom < minZoom) {
      const stats = channel.apply(src, [], Date.now());
      lastDeltaRef.current = stats;
      return stats;
    }

    let anchorSector = anchorSectorRef?.current ?? null;
    if (!anchorSector) {
      const center = map.getCenter();
      anchorSector = lngLatToGridCoords([center.lng, center.lat], gridDimension, ZOOM_TACTICO).sector;
      if (anchorSectorRef) {
        anchorSectorRef.current = anchorSector;
      }
    }

    const features = buildTacticalRtsUnitFeatures({
      rtsEngine,
      anchorSector,
      userClanId: userClanIdRef.current,
      selectedUnitId: selectedUnitIdRef?.current ?? null,
      gridDimension,
    });

    const stats = channel.apply(src, features, Date.now());
    lastDeltaRef.current = stats;
    return stats;
  }, [
    anchorSectorRef,
    getOrCreateChannel,
    gridDimension,
    mapRef,
    minZoom,
    rtsEngineRef,
    selectedUnitIdRef,
    sourceId,
  ]);

  const resetChannel = useCallback(
    (targetSourceId?: string) => {
      if (targetSourceId) {
        channelsRef.current.get(targetSourceId)?.reset();
        return;
      }
      for (const ch of channelsRef.current.values()) {
        ch.reset();
      }
    },
    []
  );

  const getStats = useCallback(
    () => ({
      fps: fpsRef.current,
      lastDelta: lastDeltaRef.current,
      isTabHidden: isTabHiddenRef.current,
    }),
    []
  );

  useEffect(() => {
    if (!enabled || isStandby) {
      fpsRef.current = 0;
      return;
    }

    let rafId: number | null = null;
    let hiddenTimerId: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    const clampedFps = Math.min(60, Math.max(1, targetFps));
    const minFrameIntervalMs = 1000 / clampedFps;
    let lastRenderPerfMs = 0;
    let fpsWindowStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let frameCount = 0;

    const stepSimulationAndRender = (isHidden: boolean) => {
      const rtsEngine = rtsEngineRef.current;
      if (!rtsEngine) return;

      const now = Date.now();
      const { stateChanged } = rtsEngine.tick(now);
      const isDirty = rtsEngine.consumeDirtyFlag();

      const hasMovingUnits = rtsEngine.getAllUnits().some((u) => !u.isDestroyed && u.currentMoveIntent !== null);
      if (stateChanged || isDirty || hasMovingUnits) {
        syncRtsUnitsNow();
      }

      onTickRef.current?.({
        now,
        stateChanged,
        isDirty,
        isHidden,
      });
    };

    const scheduleHiddenTick = () => {
      if (isDisposed || hiddenThrottleMs <= 0) return;
      hiddenTimerId = setTimeout(() => {
        if (isDisposed || !isTabHiddenRef.current) return;
        stepSimulationAndRender(true);
        scheduleHiddenTick();
      }, hiddenThrottleMs);
    };

    const runVisibleFrame = (perfNow: number) => {
      if (isDisposed || isTabHiddenRef.current) return;

      if (lastRenderPerfMs === 0 || perfNow - lastRenderPerfMs >= minFrameIntervalMs - 0.5) {
        lastRenderPerfMs = perfNow;
        frameCount++;
        if (perfNow - fpsWindowStartMs >= 1000) {
          fpsRef.current = Math.round((frameCount * 1000) / Math.max(1, perfNow - fpsWindowStartMs));
          frameCount = 0;
          fpsWindowStartMs = perfNow;
        }
        stepSimulationAndRender(false);
      }

      rafId = window.requestAnimationFrame(runVisibleFrame);
    };

    const startActiveLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (hiddenTimerId !== null) {
        clearTimeout(hiddenTimerId);
        hiddenTimerId = null;
      }

      if (isTabHiddenRef.current) {
        fpsRef.current = 0;
        scheduleHiddenTick();
      } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        lastRenderPerfMs = 0;
        rafId = window.requestAnimationFrame(runVisibleFrame);
      }
    };

    const handleVisibilityChange = () => {
      isTabHiddenRef.current = document.visibilityState === 'hidden';
      startActiveLoop();
    };

    if (typeof document !== 'undefined') {
      isTabHiddenRef.current = document.visibilityState === 'hidden';
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Sincronización inicial inmediata al montar o reactivar.
    syncRtsUnitsNow();
    startActiveLoop();

    return () => {
      isDisposed = true;
      if (rafId !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId);
      }
      if (hiddenTimerId !== null) {
        clearTimeout(hiddenTimerId);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, hiddenThrottleMs, isStandby, rtsEngineRef, syncRtsUnitsNow, targetFps]);

  return {
    syncRtsUnitsNow,
    syncOperationalLayer,
    resetChannel,
    getStats,
  };
}
