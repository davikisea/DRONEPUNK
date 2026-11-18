/**
 * ==============================================================================
 * RENDERIZADOR CARTOGRÁFICO WEBGL C4ISR - TACTICAL WORLD MAP (OPENPLACE BRIDGE)
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.2
 * Motor: MapLibre GL (WebGL 2.0) + Cuadrícula Vectorial GPU Continua.
 * - Semantic LOD: Macro-Globo (LOD 1) -> Operacional (LOD 2) -> Combate Táctico (LOD 3).
 * - Zero-SSR: Importación dinámica en useEffect para compatibilidad con Vite/SSR.
 * - Cuadrícula 100% Vectorial GPU: Cobertura continua del viewport sin CanvasSource.
 * - Inactividad / Blur: Congelación automática tras 5 min sin actividad.
 * ==============================================================================
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  MapMouseEvent,
} from 'maplibre-gl';
// WebGL MapLibre Styles loaded globally in main.tsx
import * as worldDomain from '@domains/world';
import {
  ZOOM_GLOBAL,
  ZOOM_OPERACIONAL,
  ZOOM_TACTICO,
  TACTICAL_SPRITE_MAX_ZOOM,
  lngLatToGridCoords,
  gridCoordsToLngLat,
  latLngToH3Res9,
  h3Res9ToLatLng,
  stateSovereigntyService,
  spatialDeploymentService,
} from '@domains/world';
import { useTerritoryMap } from '../hooks/useTerritoryMap';
import {
  useWorldRegionBroadcast,
  applyWorldDeltaToCollections,
  type WorldDeltaBatch,
} from '../hooks/useWorldRegionBroadcast';
import { useTacticalDeltaRenderer } from '../hooks/useTacticalDeltaRenderer';
import {
  C4ISR_HIDE_LAYERS_REGEX,
  ACTIVITY_TIMEOUT_MS,
  TACTICAL_GRID_DIMENSION,
  MAX_GRID_SECTORS_PER_AXIS,
  ZERO_RASTER_MILITARY_STYLE,
  resolveMunicipalityIdFromFeature,
  type TacticalGeoJSONFeature,
  type TacticalPolygonGeometry,
} from './map/tacticalMapStyle';
import {
  registerGreenUnitSprites,
  registerTerrainTileSprites,
} from './map/tacticalTerrainSprites';
import { createTacticalTerrainWebGLLayer } from './map/tacticalTerrainWebGLLayer';
import {
  buildCellPolygonFeature,
  buildViewportGridGeoJSON,
  buildViewportTerrainGeoJSON,
  computeFixedMacroBlockRange,
  computeViewportSectorRange,
} from './map/tacticalGridGeoJson';
import {
  type TacticalUnit,
  type GridPosition,
  type TerrainTile,
  type MovementType,
  supabase,
  isSupabaseConfigured,
  resolveUnitSpriteKey,
} from '@shared';
import {
  MicroTacticalDeckHUD,
  TacticalUnitDeployModal,
  TacticalRtsEngine,
  TacticalPathfindingEngine,
  calculatePathArrow,
  BaseProductionModal,
} from '@domains/tactics';
import { fetchMyCorporation, hasCorpPermission } from '../services/corporationService';
import { fetchUnitSchedules, type UnitScheduleRow } from '../services/droneScheduleService';
import { DroneSchedulerDrawer } from './DroneSchedulerDrawer';
import {
  TacticalConstructionDrawer,
  CANONICAL_UNIT_PRODUCTION_CATALOG,
  fetchWorldMapBuildings,
  fetchUnitsInViewport,
  fetchInfraEdgesInViewport,
  fetchCorpBuildings,
  claimOrCaptureBuildingDb,
  collectBuildingResourcesDb,
  calculateBuildingPendingYield,
  resolveActiveUserCorpId,
  createInfraEdge,
  executeCollectorHaul,
  syncPipelineLogistics,
  collectHousingCitizens,
  repairInfrastructure,
  triggerVulnerabilityHandshake,
  damageInfrastructure,
  type DbOperationalUnitRecord,
  type DbBuildingRecord,
  type DbInfraEdgeRecord,
  type ViewportBBox,
} from '@domains/economy';
import { audioManager } from '@domains/game-feel';

export interface TacticalWorldMapProps {
  userClanId?: string | null;
  activeProvinceId?: string | null;
  activeBattleUnits?: TacticalUnit[];
  fogOfWarBase64?: string | null;
  onSelectCountry?: (countryId: string) => void;
  onSelectProvince?: (provinceId: string) => void;
  onSelectMunicipality?: (
    municipalityId: string,
    meta?: { name?: string; cityName?: string; stateId?: string }
  ) => void;
  onSelectTacticalCell?: (
    sector: [number, number],
    cell: [number, number],
    lngLat?: [number, number]
  ) => void;
  onZoomChange?: (zoom: number) => void;
  hideLegacyMicroDeck?: boolean;
  externalDeployTrigger?: number;
  externalBuildTrigger?: number;
  className?: string;
}

type RtsUnitView = TacticalUnit & {
  owner?: string;
  isDestroyed?: boolean;
};


const DEFAULT_VIEWPORT_BBOX: ViewportBBox = {
  minLat: 9.8,
  maxLat: 11.2,
  minLng: -72.2,
  maxLng: -70.8,
};

function getMapViewportBBox(map: MapLibreMap | null): ViewportBBox {
  if (!map) return DEFAULT_VIEWPORT_BBOX;
  try {
    const bounds = map.getBounds();
    return {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast(),
    };
  } catch {
    return DEFAULT_VIEWPORT_BBOX;
  }
}

export const TacticalWorldMap: React.FC<TacticalWorldMapProps> = ({
  userClanId = 'clan-ferro',
  activeProvinceId = null,
  activeBattleUnits = [],
  fogOfWarBase64 = null,
  onSelectCountry,
  onSelectProvince,
  onSelectMunicipality,
  onSelectTacticalCell,
  onZoomChange,
  hideLegacyMicroDeck = false,
  externalDeployTrigger = 0,
  externalBuildTrigger = 0,
  className = '',
}) => {
  void fogOfWarBase64;
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const isStandbyRef = useRef<boolean>(false);
  const inactivityTimerRef = useRef<number | null>(null);
  const lastGridKeyRef = useRef<string>('empty');
  const lastTerrainKeyRef = useRef<string>('empty');
  const rtsAnchorSectorRef = useRef<[number, number] | null>(
    lngLatToGridCoords([-71.455, 10.395], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO).sector
  );

  // Stable refs para desacoplar el ciclo de vida del mapa WebGL y evitar parpadeos
  const onSelectCountryRef = useRef(onSelectCountry);
  onSelectCountryRef.current = onSelectCountry;

  const onSelectProvinceRef = useRef(onSelectProvince);
  onSelectProvinceRef.current = onSelectProvince;

  const onSelectMunicipalityRef = useRef(onSelectMunicipality);
  onSelectMunicipalityRef.current = onSelectMunicipality;

  const onSelectTacticalCellRef = useRef(onSelectTacticalCell);
  onSelectTacticalCellRef.current = onSelectTacticalCell;

  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const [currentZoom, setCurrentZoom] = useState<number>(ZOOM_GLOBAL);
  const [hoveredProvinceId] = useState<string | null>(null);
  const [hoveredCellGlobal, setHoveredCellGlobal] = useState<{
    sector: [number, number];
    cell: [number, number];
  } | null>(null);
  const [selectedMunicipalityId, setSelectedMunicipalityId] = useState<string | null>(null);
  const selectedMunicipalityIdRef = useRef<string | null>(null);
  selectedMunicipalityIdRef.current = selectedMunicipalityId;

  const [isStandbyUI, setIsStandbyUI] = useState<boolean>(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Estados de Microjuego Táctico y Asignación Espacial (Sprint 3: Zoom x15)
  const [selectedMicroCoords, setSelectedMicroCoords] = useState<{
    sector: [number, number];
    cell: [number, number];
    lngLat: [number, number];
  } | null>(null);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isBuildDrawerOpen, setIsBuildDrawerOpen] = useState(false);

  const hoveredCellGlobalRef = useRef(hoveredCellGlobal);
  hoveredCellGlobalRef.current = hoveredCellGlobal;

  const selectedMicroCoordsRef = useRef(selectedMicroCoords);
  selectedMicroCoordsRef.current = selectedMicroCoords;

  // Motor RTS Continuo de Celda (10 ticks/s) y Selección de Unidades
  const rtsEngineRef = useRef<TacticalRtsEngine>(new TacticalRtsEngine({ tickIntervalMs: 100 }));
  const [selectedTacticalUnitId, setSelectedTacticalUnitId] = useState<string | null>(null);
  const selectedTacticalUnitIdRef = useRef<string | null>(null);
  selectedTacticalUnitIdRef.current = selectedTacticalUnitId;

  // --- Movimiento Operacional Estilo Advance Wars (100% DB operational_units) ---
  interface ReachableOpTileEntry {
    sector: [number, number];
    cell: [number, number];
    lngLat: [number, number];
    h3Index: number;
    path: GridPosition[];
    originSector: [number, number];
    originCell: [number, number];
    gridOriginX: number;
    gridOriginY: number;
  }

  const [activeDbCorpId, setActiveDbCorpId] = useState<string | null>(null);
  const [isDroneSchedulerOpen, setIsDroneSchedulerOpen] = useState(false);
  const [corpProdBuildings, setCorpProdBuildings] = useState<DbBuildingRecord[]>([]);
  const [worldBuildings, setWorldBuildings] = useState<DbBuildingRecord[]>([]);
  const worldBuildingsRef = useRef<DbBuildingRecord[]>([]);
  worldBuildingsRef.current = worldBuildings;
  const [infraEdges, setInfraEdges] = useState<DbInfraEdgeRecord[]>([]);
  const infraEdgesRef = useRef<DbInfraEdgeRecord[]>([]);
  infraEdgesRef.current = infraEdges;
  const [activeSchedules, setActiveSchedules] = useState<UnitScheduleRow[]>([]);
  const [selectedMapBuilding, setSelectedMapBuilding] = useState<DbBuildingRecord | null>(null);
  const selectedMapBuildingRef = useRef<DbBuildingRecord | null>(null);
  selectedMapBuildingRef.current = selectedMapBuilding;
  const [selectedMapEdge, setSelectedMapEdge] = useState<DbInfraEdgeRecord | null>(null);
  const selectedMapEdgeRef = useRef<DbInfraEdgeRecord | null>(null);
  selectedMapEdgeRef.current = selectedMapEdge;
  const [edgeTraceMode, setEdgeTraceMode] = useState<{
    type: 'pipeline' | 'road' | 'bridge';
    fromH3: number;
    fromBuildingId?: string | null;
  } | null>(null);
  const edgeTraceModeRef = useRef(edgeTraceMode);
  edgeTraceModeRef.current = edgeTraceMode;
  const [mapInfraFeedback, setMapInfraFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isInfraActionBusy, setIsInfraActionBusy] = useState(false);

  const [activeBaseProdBuilding, setActiveBaseProdBuilding] = useState<DbBuildingRecord | null>(null);
  const [corpEconomySnap, setCorpEconomySnap] = useState({ ec: 0, citizens: 0 });
  const activeDbCorpIdRef = useRef<string | null>(null);
  const canControlDbUnitsRef = useRef(false);
  const canPurchaseUnitsRef = useRef(false);
  const canConstructDbRef = useRef(false);
  const canCollectDbRef = useRef(false);
  const [dbOperationalUnits, setDbOperationalUnits] = useState<DbOperationalUnitRecord[]>([]);
  const dbOperationalUnitsRef = useRef<DbOperationalUnitRecord[]>([]);
  dbOperationalUnitsRef.current = dbOperationalUnits;

  const [selectedDbOpUnit, setSelectedDbOpUnit] = useState<DbOperationalUnitRecord | null>(null);
  const selectedDbOpUnitRef = useRef<DbOperationalUnitRecord | null>(null);
  selectedDbOpUnitRef.current = selectedDbOpUnit;

  const reachableDbOpTilesRef = useRef<Map<string, ReachableOpTileEntry>>(new Map());
  const activeOpArrowPathRef = useRef<GridPosition[] | null>(null);
  const isMovingDbOpUnitRef = useRef<boolean>(false);

  const resolveDbUnitLngLat = useCallback((h3Index: number): [number, number] => {
    try {
      if (Number.isFinite(h3Index) && h3Index > 1000) {
        const [lat, lng] = h3Res9ToLatLng(BigInt(Math.trunc(h3Index)));
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return [lng, lat];
        }
      }
    } catch {
      // fallback seguro si h3_index no es H3 Res9 empaquetado
    }
    return [-71.455, 10.395];
  }, []);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = currentUserId;

  const activeSchedulesRef = useRef<UnitScheduleRow[]>([]);
  activeSchedulesRef.current = activeSchedules;

  const currentZoomRef = useRef<number>(currentZoom);
  currentZoomRef.current = currentZoom;

  const refreshDbOperationalUnits = useCallback(async () => {
    try {
      const bbox = getMapViewportBBox(mapInstanceRef.current);
      const [allBuildings, allEdges] = await Promise.all([
        fetchWorldMapBuildings(null, bbox).catch(() => [] as DbBuildingRecord[]),
        fetchInfraEdgesInViewport(bbox, null, 400).catch(() => [] as DbInfraEdgeRecord[]),
      ]);
      setWorldBuildings(allBuildings);
      setInfraEdges(allEdges);

      if (selectedMapBuildingRef.current) {
        const updatedB = allBuildings.find((b) => b.id === selectedMapBuildingRef.current?.id);
        if (updatedB) setSelectedMapBuilding(updatedB);
      }
      if (selectedMapEdgeRef.current) {
        const updatedE = allEdges.find((ed) => ed.id === selectedMapEdgeRef.current?.id);
        if (updatedE) setSelectedMapEdge(updatedE);
      }

      if (!isSupabaseConfigured() || !supabase) return;
      let userId = currentUserIdRef.current;
      if (!userId) {
        const { data: sessionData } = await supabase.auth.getSession();
        userId = sessionData?.session?.user?.id ?? null;
        if (userId) {
          currentUserIdRef.current = userId;
          setCurrentUserId(userId);
        }
      }
      if (!userId) {
        activeDbCorpIdRef.current = null;
        canControlDbUnitsRef.current = false;
        canPurchaseUnitsRef.current = false;
        canConstructDbRef.current = false;
        canCollectDbRef.current = false;
        setActiveDbCorpId(null);
        setDbOperationalUnits([]);
        setActiveSchedules([]);
        return;
      }

      const myCorp = await fetchMyCorporation(userId).catch(() => null);
      const corpId = myCorp?.corporation?.id ?? (await resolveActiveUserCorpId().catch(() => null));
      const effectiveCorpId = corpId ?? (userClanId && userClanId.length > 20 ? userClanId : null);

      activeDbCorpIdRef.current = effectiveCorpId;
      canControlDbUnitsRef.current = hasCorpPermission(myCorp?.membership, 'can_control_units');
      canPurchaseUnitsRef.current = hasCorpPermission(myCorp?.membership, 'can_purchase_units');
      canConstructDbRef.current = hasCorpPermission(myCorp?.membership, 'can_construct');
      canCollectDbRef.current = hasCorpPermission(myCorp?.membership, 'can_collect');
      setCorpEconomySnap({
        ec: myCorp?.corporation?.treasury_ec ?? 0,
        citizens: myCorp?.corporation?.treasury_citizens ?? 0,
      });
      setActiveDbCorpId(effectiveCorpId);

      if (!effectiveCorpId) {
        setDbOperationalUnits([]);
        setCorpProdBuildings([]);
        setActiveSchedules([]);
        return;
      }
      const [rows, buildings, schedules] = await Promise.all([
        fetchUnitsInViewport(bbox, effectiveCorpId, 'active', 400),
        fetchCorpBuildings(effectiveCorpId).catch(() => [] as DbBuildingRecord[]),
        fetchUnitSchedules(effectiveCorpId).catch(() => [] as UnitScheduleRow[]),
      ]);
      setDbOperationalUnits(rows);
      setCorpProdBuildings(
        buildings.filter((b) =>
          ['factory', 'barracks', 'port', 'airport', 'hq'].includes(b.building_type)
        )
      );

      const runningSchedules = schedules.filter((s) => s.status === 'pending' || s.status === 'active');
      setActiveSchedules(runningSchedules);

      const unitMap = new Map(rows.map((u) => [u.id, u]));
      for (const sched of runningSchedules) {
        if (!sched.unit_id) continue;
        const unitRow = unitMap.get(sched.unit_id);
        const rawWps = Array.isArray(sched.waypoints) ? (sched.waypoints as Array<{ h3?: number }>) : [];
        const wps = rawWps
          .map((wp) => {
            const h3Num = Number(wp?.h3);
            if (!Number.isFinite(h3Num) || h3Num <= 0) return null;
            const [lng, lat] = resolveDbUnitLngLat(h3Num);
            return { x: lng, y: lat, h3: h3Num };
          })
          .filter((wp): wp is { x: number; y: number; h3: number } => wp !== null);

        if (unitRow && wps.length === 1) {
          const [uLng, uLat] = resolveDbUnitLngLat(unitRow.h3_index);
          wps.unshift({ x: uLng, y: uLat, h3: unitRow.h3_index });
        }

        if (wps.length >= 2) {
          rtsEngineRef.current.syncScheduledCommand({
            scheduleId: sched.id,
            unitId: sched.unit_id,
            unitCode: unitRow?.unit_code ?? 'recon',
            ownerId: effectiveCorpId,
            commandType: sched.command_type as any,
            waypoints: wps,
            waypointCursor: sched.waypoint_cursor ?? 0,
            scheduledAtMs: Date.parse(sched.scheduled_at) || Date.now(),
            repeatIntervalSec: sched.repeat_interval_sec,
          });
        }
      }
    } catch (err) {
      console.warn('[TacticalWorldMap] Error cargando operational_units:', err);
    }
  }, [userClanId, resolveDbUnitLngLat]);

  const refreshDbOperationalUnitsRef = useRef(refreshDbOperationalUnits);
  refreshDbOperationalUnitsRef.current = refreshDbOperationalUnits;

  useEffect(() => {
    void refreshDbOperationalUnits();
    if (!isSupabaseConfigured() || !supabase) return;
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUid = session?.user?.id ?? null;
      currentUserIdRef.current = nextUid;
      setCurrentUserId(nextUid);
      void refreshDbOperationalUnits();
    });
    return () => {
      authSub?.subscription?.unsubscribe();
    };
  }, [refreshDbOperationalUnits]);

  const subscribedRegionIds = useMemo(() => {
    const ids = new Set<string>(['GLOBAL']);
    if (activeProvinceId) ids.add(activeProvinceId);
    if (selectedMunicipalityId) ids.add(selectedMunicipalityId);
    return Array.from(ids);
  }, [activeProvinceId, selectedMunicipalityId]);

  const handleWorldDeltaBatch = useCallback((batch: WorldDeltaBatch) => {
    const next = applyWorldDeltaToCollections(
      {
        buildings: worldBuildingsRef.current,
        infra_edges: infraEdgesRef.current,
        operational_units: dbOperationalUnitsRef.current,
      },
      batch
    );
    if (next.appliedCount === 0) return;

    if (next.changedTables.includes('buildings')) {
      setWorldBuildings(next.buildings);
      if (selectedMapBuildingRef.current) {
        const updatedB = next.buildings.find((b) => b.id === selectedMapBuildingRef.current?.id);
        if (updatedB) setSelectedMapBuilding(updatedB);
      }
    }
    if (next.changedTables.includes('infra_edges')) {
      setInfraEdges(next.infra_edges);
      if (selectedMapEdgeRef.current) {
        const updatedE = next.infra_edges.find((ed) => ed.id === selectedMapEdgeRef.current?.id);
        if (updatedE) setSelectedMapEdge(updatedE);
      }
    }
    if (next.changedTables.includes('operational_units')) {
      setDbOperationalUnits(next.operational_units);
    }
  }, []);

  const handleWorldResyncNeeded = useCallback(() => {
    void refreshDbOperationalUnitsRef.current();
  }, []);

  useWorldRegionBroadcast({
    regionIds: subscribedRegionIds,
    corpId: activeDbCorpId,
    userId: currentUserId,
    enabled: isSupabaseConfigured(),
    debounceMs: 150,
    onDeltaBatch: handleWorldDeltaBatch,
    onResyncNeeded: handleWorldResyncNeeded,
  });

  const {
    syncRtsUnitsNow: syncRtsUnitsToMap,
    syncOperationalLayer,
  } = useTacticalDeltaRenderer({
    mapRef: mapInstanceRef,
    rtsEngineRef,
    anchorSectorRef: rtsAnchorSectorRef,
    selectedUnitIdRef: selectedTacticalUnitIdRef,
    userClanId,
    enabled: true,
    isStandby: isStandbyUI,
    currentZoom,
    minZoom: ZOOM_TACTICO - 1.0,
    gridDimension: TACTICAL_GRID_DIMENSION,
    sourceId: 'tactical-rts-units',
    targetFps: 60,
    onTick: ({ stateChanged, isDirty }) => {
      const hasScheduledDrones = activeSchedulesRef.current.length > 0 && currentZoomRef.current >= 8.5;
      if ((stateChanged || isDirty) && hasScheduledDrones) {
        syncDbOperationalLayersRef.current();
      }
    },
  });

  const syncRtsUnitsToMapRef = useRef(syncRtsUnitsToMap);
  syncRtsUnitsToMapRef.current = syncRtsUnitsToMap;

  const syncDbOperationalLayers = useCallback(
    (
      overrideArrow?: {
        segments: ReturnType<typeof calculatePathArrow>;
        originSector: [number, number];
        originCell: [number, number];
        gridOriginX: number;
        gridOriginY: number;
      } | null
    ) => {
      const map = mapInstanceRef.current;
      if (!map || !map.isStyleLoaded()) return;

      if (map.getSource('db-mmo-infra-edges')) {
        const edgeFeatures = infraEdgesRef.current.map((ed) => {
          const fromCoord = resolveDbUnitLngLat(ed.from_h3);
          const toCoord = resolveDbUnitLngLat(ed.to_h3);
          return {
            type: 'Feature' as const,
            id: ed.id,
            geometry: { type: 'LineString' as const, coordinates: [fromCoord, toCoord] },
            properties: {
              id: ed.id,
              edge_type: ed.edge_type,
              status: ed.status,
              corp_id: ed.corp_id,
              hp: ed.hp,
              max_hp: ed.max_hp,
              isSelected: selectedMapEdgeRef.current?.id === ed.id,
              label:
                ed.status === 'severed'
                  ? `${ed.edge_type.toUpperCase()} [CORTADO]`
                  : ed.edge_type.toUpperCase(),
            },
          };
        });
        syncOperationalLayer('db-mmo-infra-edges', edgeFeatures);
      }

      if (map.getSource('db-mmo-buildings')) {
        const bldFeatures = worldBuildingsRef.current.map((b) => {
          const [lng, lat] = resolveDbUnitLngLat(b.h3_index);
          const infraState = b.infra_state ?? (b.is_disabled || b.hp <= 0 ? 'RUINED' : 'OPERATIONAL');
          const isOwn = Boolean(activeDbCorpIdRef.current && b.corp_id === activeDbCorpIdRef.current);
          const isNeutral = !b.corp_id;
          const isSelected = selectedMapBuildingRef.current?.id === b.id;
          const badge = b.is_historical ? '[HIST] ' : '';
          const stateSuffix =
            infraState === 'RUINED'
              ? ' • RUINED'
              : b.is_production_halted
              ? ' • ALMACÉN LLENO'
              : infraState === 'DAMAGED'
              ? ' • DAÑADO'
              : '';
          return {
            type: 'Feature' as const,
            id: b.id,
            geometry: { type: 'Point' as const, coordinates: [lng, lat] },
            properties: {
              id: b.id,
              building_type: b.building_type,
              corp_id: b.corp_id,
              h3_index: b.h3_index,
              infra_state: infraState,
              is_historical: Boolean(b.is_historical),
              is_production_halted: Boolean(b.is_production_halted),
              isOwn,
              isNeutral,
              isSelected,
              label: `${badge}${b.building_type.toUpperCase()}${stateSuffix}`,
            },
          };
        });
        syncOperationalLayer('db-mmo-buildings', bldFeatures);
      }

      if (map.getSource('db-operational-units')) {
        const features = dbOperationalUnitsRef.current.map((u) => {
          const interp = rtsEngineRef.current.getInterpolatedUnitCoords(u.id);
          const [lng, lat] =
            interp && Math.abs(interp.x) > 1
              ? [interp.x, interp.y]
              : resolveDbUnitLngLat(u.h3_index);
          const isSelected = selectedDbOpUnitRef.current?.id === u.id;
          return {
            type: 'Feature' as const,
            id: u.id,
            geometry: { type: 'Point' as const, coordinates: [lng, lat] },
            properties: {
              id: u.id,
              unit_code: u.unit_code,
              hp: u.hp,
              tier: u.tier,
              corp_id: u.corp_id,
              h3_index: u.h3_index,
              spriteKey: resolveUnitSpriteKey(u.unit_code),
              isSelected,
            },
          };
        });
        syncOperationalLayer('db-operational-units', features);
      }

      if (map.getSource('db-operational-reachable')) {
        const reachFeatures = Array.from(reachableDbOpTilesRef.current.values()).map((entry) => ({
          ...buildCellPolygonFeature(entry.sector, entry.cell, 'hover'),
          id: `${entry.sector[0]}_${entry.sector[1]}_${entry.cell[0]}_${entry.cell[1]}`,
        }));
        syncOperationalLayer('db-operational-reachable', reachFeatures);
      }

      if (map.getSource('db-operational-arrow')) {
        if (!overrideArrow || overrideArrow.segments.length === 0) {
          syncOperationalLayer('db-operational-arrow', []);
        } else {
          const toLngLat = (pos: GridPosition): [number, number] => {
            const rawX = overrideArrow.originCell[0] + (pos.x - overrideArrow.gridOriginX);
            const rawY = overrideArrow.originCell[1] + (pos.y - overrideArrow.gridOriginY);
            const secDx = Math.floor(rawX / TACTICAL_GRID_DIMENSION);
            const secDy = Math.floor(rawY / TACTICAL_GRID_DIMENSION);
            const cx = ((rawX % TACTICAL_GRID_DIMENSION) + TACTICAL_GRID_DIMENSION) % TACTICAL_GRID_DIMENSION;
            const cy = ((rawY % TACTICAL_GRID_DIMENSION) + TACTICAL_GRID_DIMENSION) % TACTICAL_GRID_DIMENSION;
            return gridCoordsToLngLat(
              [overrideArrow.originSector[0] + secDx, overrideArrow.originSector[1] + secDy],
              [cx, cy],
              TACTICAL_GRID_DIMENSION,
              ZOOM_TACTICO
            );
          };

          const lineCoords = overrideArrow.segments.map((seg) => toLngLat(seg.position));
          const features: Array<GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>> & { id: string }> = [];
          if (lineCoords.length >= 2) {
            features.push({
              type: 'Feature',
              id: 'arrow-body',
              geometry: { type: 'LineString', coordinates: lineCoords },
              properties: { id: 'arrow-body', kind: 'body' },
            });
          }
          const lastSeg = overrideArrow.segments[overrideArrow.segments.length - 1];
          const firstSeg = overrideArrow.segments[0];
          features.push({
            type: 'Feature',
            id: 'arrow-origin',
            geometry: { type: 'Point', coordinates: toLngLat(firstSeg.position) },
            properties: { id: 'arrow-origin', kind: 'origin', rawCode: firstSeg.rawCode },
          });
          features.push({
            type: 'Feature',
            id: 'arrow-head',
            geometry: { type: 'Point', coordinates: toLngLat(lastSeg.position) },
            properties: { id: 'arrow-head', kind: 'head', rawCode: lastSeg.rawCode, segType: lastSeg.type },
          });
          syncOperationalLayer('db-operational-arrow', features);
        }
      }
    },
    [resolveDbUnitLngLat, syncOperationalLayer]
  );

  const syncDbOperationalLayersRef = useRef(syncDbOperationalLayers);
  syncDbOperationalLayersRef.current = syncDbOperationalLayers;

  useEffect(() => {
    syncDbOperationalLayersRef.current();
  }, [dbOperationalUnits, selectedDbOpUnit, worldBuildings, infraEdges, selectedMapBuilding, selectedMapEdge]);

  const clearDbOpSelection = useCallback(() => {
    setSelectedDbOpUnit(null);
    selectedDbOpUnitRef.current = null;
    reachableDbOpTilesRef.current.clear();
    activeOpArrowPathRef.current = null;
    syncDbOperationalLayersRef.current(null);
  }, []);

  const selectDbOperationalUnit = useCallback(
    (unit: DbOperationalUnitRecord) => {
      const [lng, lat] = resolveDbUnitLngLat(unit.h3_index);
      const { sector: originSector, cell: originCell } = lngLatToGridCoords(
        [lng, lat],
        TACTICAL_GRID_DIMENSION,
        ZOOM_TACTICO
      );

      const GRID_RADIUS = 10;
      const GRID_SIZE = GRID_RADIUS * 2 + 1;
      const localTiles: TerrainTile[][] = [];

      const resolveGlobalCell = (gx: number, gy: number): { sec: [number, number]; cel: [number, number] } => {
        const rawX = originCell[0] + (gx - GRID_RADIUS);
        const rawY = originCell[1] + (gy - GRID_RADIUS);
        const secDx = Math.floor(rawX / TACTICAL_GRID_DIMENSION);
        const secDy = Math.floor(rawY / TACTICAL_GRID_DIMENSION);
        const cx = ((rawX % TACTICAL_GRID_DIMENSION) + TACTICAL_GRID_DIMENSION) % TACTICAL_GRID_DIMENSION;
        const cy = ((rawY % TACTICAL_GRID_DIMENSION) + TACTICAL_GRID_DIMENSION) % TACTICAL_GRID_DIMENSION;
        return {
          sec: [originSector[0] + secDx, originSector[1] + secDy],
          cel: [cx, cy],
        };
      };

      for (let gy = 0; gy < GRID_SIZE; gy++) {
        const row: TerrainTile[] = [];
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const { sec, cel } = resolveGlobalCell(gx, gy);
          const resolved = spatialDeploymentService.resolveSectorCellTerrain(
            sec,
            cel,
            TACTICAL_GRID_DIMENSION
          );
          row.push({
            x: gx,
            y: gy,
            type: resolved.type,
            defenseStars: 0,
            movementCost: 1,
          } as TerrainTile);
        }
        localTiles.push(row);
      }

      const unitsMap = new Map<string, TacticalUnit>();
      for (const other of dbOperationalUnitsRef.current) {
        if (other.id === unit.id) continue;
        const [oLng, oLat] = resolveDbUnitLngLat(other.h3_index);
        const oGrid = lngLatToGridCoords([oLng, oLat], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
        const dx =
          (oGrid.sector[0] - originSector[0]) * TACTICAL_GRID_DIMENSION +
          (oGrid.cell[0] - originCell[0]);
        const dy =
          (oGrid.sector[1] - originSector[1]) * TACTICAL_GRID_DIMENSION +
          (oGrid.cell[1] - originCell[1]);
        const gx = GRID_RADIUS + dx;
        const gy = GRID_RADIUS + dy;
        if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
          unitsMap.set(other.id, {
            id: other.id,
            unitCode: other.unit_code,
            displayName: other.unit_code,
            ownerId: other.corp_id === unit.corp_id ? 'p1' : 'p2',
            x: gx,
            y: gy,
            hp: other.hp,
            maxHp: 100,
            movementPoints: 5,
            movementType: 'treads',
          } as unknown as TacticalUnit);
        }
      }

      const catalogEntry = CANONICAL_UNIT_PRODUCTION_CATALOG[unit.unit_code];
      const movementPoints = catalogEntry?.movementPoints ?? 5;
      const movementType: MovementType = (catalogEntry?.movementType as MovementType) ?? 'treads';

      const syntheticUnit = {
        id: unit.id,
        unitCode: unit.unit_code,
        displayName: catalogEntry?.displayName ?? unit.unit_code,
        ownerId: 'p1',
        x: GRID_RADIUS,
        y: GRID_RADIUS,
        hp: unit.hp,
        maxHp: 100,
        ammo: 9,
        fuel: 99,
        minRange: catalogEntry?.minRange ?? 1,
        maxRange: catalogEntry?.maxRange ?? 1,
        movementPoints,
        movementType,
        visionRange: 3,
        baseAttack: catalogEntry?.baseAttack ?? 55,
        productionCost: catalogEntry?.cost ?? 1000,
        hasMoved: false,
        hasActed: false,
      } as unknown as TacticalUnit;

      const reachable = TacticalPathfindingEngine.getReachableTiles({
        unit: syntheticUnit,
        tiles: localTiles,
        unitsMap,
        gridWidth: GRID_SIZE,
        gridHeight: GRID_SIZE,
      });

      const nextMap = new Map<string, ReachableOpTileEntry>();
      for (const tileInfo of reachable) {
        const { sec, cel } = resolveGlobalCell(tileInfo.x, tileInfo.y);
        const centerLngLat = gridCoordsToLngLat(sec, cel, TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
        const key = `${sec[0]},${sec[1]}:${cel[0]},${cel[1]}`;
        nextMap.set(key, {
          sector: sec,
          cell: cel,
          lngLat: centerLngLat,
          h3Index: Number(latLngToH3Res9(centerLngLat[1], centerLngLat[0])),
          path: tileInfo.path,
          originSector,
          originCell,
          gridOriginX: GRID_RADIUS,
          gridOriginY: GRID_RADIUS,
        });
      }

      reachableDbOpTilesRef.current = nextMap;
      activeOpArrowPathRef.current = null;
      setSelectedDbOpUnit(unit);
      selectedDbOpUnitRef.current = unit;
      syncDbOperationalLayersRef.current(null);
      try { audioManager.playHoverTick(); } catch {}
    },
    [resolveDbUnitLngLat]
  );

  const executeDbOperationalMove = useCallback(
    async (targetEntry: ReachableOpTileEntry) => {
      const unit = selectedDbOpUnitRef.current;
      if (
        !unit ||
        isMovingDbOpUnitRef.current ||
        !isSupabaseConfigured() ||
        !supabase ||
        !activeDbCorpIdRef.current ||
        unit.corp_id !== activeDbCorpIdRef.current ||
        !canControlDbUnitsRef.current
      ) {
        try { audioManager.playCue('ui_cancel_rollback'); } catch {}
        return;
      }

      isMovingDbOpUnitRef.current = true;
      try {
        const { data, error } = await supabase.rpc('move_operational_unit', {
          p_unit_id: unit.id,
          p_target_h3: targetEntry.h3Index,
          p_idempotency_key: crypto.randomUUID(),
        });
        if (error) throw new Error(error.message);

        const updatedRecord = (data as { operational_unit?: DbOperationalUnitRecord } | null)
          ?.operational_unit;

        setDbOperationalUnits((prev) =>
          prev.map((u) =>
            u.id === unit.id
              ? updatedRecord
                ? updatedRecord
                : { ...u, h3_index: targetEntry.h3Index }
              : u
          )
        );
        clearDbOpSelection();
        try { audioManager.playCue('ui_tile_confirm'); } catch {}
      } catch (err) {
        console.warn('[TacticalWorldMap] Error en move_operational_unit:', err);
        try { audioManager.playCue('ui_cancel_rollback'); } catch {}
      } finally {
        isMovingDbOpUnitRef.current = false;
      }
    },
    [clearDbOpSelection]
  );

  const [baseRegionsGeoJSON, setBaseRegionsGeoJSON] = useState<any>(null);

  useEffect(() => {
    let isSubscribed = true;
    fetch('/map/theatre_regions.json')
      .then((res) => res.json())
      .then((data) => {
        if (isSubscribed) setBaseRegionsGeoJSON(data);
      })
      .catch((err) => {
        console.warn('[TacticalWorldMap] No se pudo cargar theatre_regions.json local:', err);
      });
    return () => {
      isSubscribed = false;
    };
  }, []);

  useEffect(() => {
    if (!baseRegionsGeoJSON) return;
    const registerFn =
      (worldDomain as { registerLandPolygons?: (fc: unknown) => void }).registerLandPolygons ??
      (spatialDeploymentService as unknown as { registerLandPolygons?: (fc: unknown) => void })
        .registerLandPolygons;
    if (typeof registerFn !== 'function') return;

    try {
      registerFn(baseRegionsGeoJSON);
      lastTerrainKeyRef.current = 'dirty';
      const map = mapInstanceRef.current;
      if (map && map.isStyleLoaded() && map.getSource('tactical-sector-terrain')) {
        syncViewportGridRef.current?.(map);
      }
    } catch (err) {
      console.warn('[TacticalWorldMap] Error registrando polígonos de tierra:', err);
    }
  }, [baseRegionsGeoJSON]);

  const [sovereignVersion, setSovereignVersion] = useState(0);

  useEffect(() => {
    const unsub = stateSovereigntyService.subscribe(() => {
      setSovereignVersion((v) => v + 1);
    });
    return () => unsub();
  }, []);

  const { provinces, controlMap, clansMap } = useTerritoryMap(userClanId);

  const controlMapRef = useRef(controlMap);
  controlMapRef.current = controlMap;

  // Estados de micro-física y screen shake cinético
  const [isScreenShaking, setIsScreenShaking] = useState<boolean>(false);
  const shakeTimeoutRef = useRef<number | null>(null);

  const triggerScreenShake = useCallback(() => {
    setIsScreenShaking(true);
    try {
      audioManager.playSFX('explosion');
    } catch {}
    if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
    shakeTimeoutRef.current = window.setTimeout(() => {
      setIsScreenShaking(false);
    }, 190);
  }, []);

  const triggerScreenShakeRef = useRef(triggerScreenShake);
  triggerScreenShakeRef.current = triggerScreenShake;

  // Estrato de zoom y cinemática de transición con micro-desenfoque
  const getStratumForZoom = (z: number): 1 | 2 | 3 => {
    if (z < ZOOM_OPERACIONAL) return 1;
    if (z < ZOOM_TACTICO) return 2;
    return 3;
  };

  const prevStratumRef = useRef<1 | 2 | 3>(getStratumForZoom(ZOOM_GLOBAL));
  const [isStratumTransitioning, setIsStratumTransitioning] = useState<boolean>(false);
  const stratumTimeoutRef = useRef<number | null>(null);
  const [currentStratum, setCurrentStratum] = useState<1 | 2 | 3>(getStratumForZoom(ZOOM_GLOBAL));

  const handleZoomTransition = useCallback((z: number) => {
    const rounded = Number(z.toFixed(2));
    setCurrentZoom(rounded);
    onZoomChangeRef.current?.(rounded);
    const nextStratum = getStratumForZoom(rounded);
    if (prevStratumRef.current !== nextStratum) {
      prevStratumRef.current = nextStratum;
      setCurrentStratum(nextStratum);
      setIsStratumTransitioning(true);
      if (stratumTimeoutRef.current) window.clearTimeout(stratumTimeoutRef.current);
      stratumTimeoutRef.current = window.setTimeout(() => {
        setIsStratumTransitioning(false);
      }, 260);
    }
  }, []);

  const handleZoomTransitionRef = useRef(handleZoomTransition);
  handleZoomTransitionRef.current = handleZoomTransition;

  useEffect(() => {
    const handleCustomShake = () => {
      triggerScreenShake();
    };

    window.addEventListener('tactical-screen-shake', handleCustomShake);

    if (typeof window !== 'undefined') {
      (window as any).__TRIGGER_TACTICAL_SHAKE__ = triggerScreenShake;
    }

    return () => {
      window.removeEventListener('tactical-screen-shake', handleCustomShake);
      if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
      if (stratumTimeoutRef.current) window.clearTimeout(stratumTimeoutRef.current);
    };
  }, [triggerScreenShake]);

  // Selector cromático de facción conforme a @tactical-command-intel
  const resolveFactionColor = useCallback((
    controllingClanId?: string | null,
    isBuffer?: boolean,
    isUnderSiege?: boolean,
    fallbackClanColor?: string
  ): string => {
    if (isUnderSiege) return '#EF4444'; // Alerta DEFCON 1 / Asedio balístico
    if (isBuffer) return '#2B2C24';     // --color-armor-base neutro
    if (controllingClanId === 'clan-ferro') return '#1D4ED8';   // Blue Moon: Azul Mando Asedio
    if (controllingClanId === 'clan-orinoco') return '#E65100'; // Orange Star: Naranja Petroquímico
    if (controllingClanId === 'clan-andes') return '#991B1B';   // Black Hole: Carmesí Hostil
    return fallbackClanColor || '#2B2C24';
  }, []);

  const pruneCivilianLayers = useCallback((map: MapLibreMap) => {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    for (const layer of style.layers) {
      if (C4ISR_HIDE_LAYERS_REGEX.test(layer.id)) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    }
  }, []);

  const syncViewportGrid = useCallback((map: MapLibreMap) => {
    const src = map.getSource('tactical-viewport-grid') as GeoJSONSource | undefined;
    const terrainSrc = map.getSource('tactical-sector-terrain') as GeoJSONSource | undefined;
    const z = map.getZoom();

    if (z < 10.0) {
      if (src && lastGridKeyRef.current !== 'empty') {
        src.setData({ type: 'FeatureCollection', features: [] });
        lastGridKeyRef.current = 'empty';
      }
      if (terrainSrc && lastTerrainKeyRef.current !== 'empty') {
        terrainSrc.setData({ type: 'FeatureCollection', features: [] });
        lastTerrainKeyRef.current = 'empty';
      }
      return;
    }

    const isMacroMode = z < ZOOM_TACTICO - 1.0;
    const range = isMacroMode ? computeFixedMacroBlockRange(map) : computeViewportSectorRange(map, 14);
    const gridKey = `${isMacroMode ? 'M' : 'T'}:${range.minSX}:${range.maxSX}:${range.minSY}:${range.maxSY}`;
    if (src && lastGridKeyRef.current !== gridKey) {
      lastGridKeyRef.current = gridKey;
      src.setData(buildViewportGridGeoJSON(map, range));
    }

    if (z < 14.45) {
      if (terrainSrc && lastTerrainKeyRef.current !== 'empty') {
        terrainSrc.setData({ type: 'FeatureCollection', features: [] });
        lastTerrainKeyRef.current = 'empty';
      }
      return;
    }

    const terrainKey = `${range.minSX}:${range.maxSX}:${range.minSY}:${range.maxSY}:rev${spatialDeploymentService.getTerrainRevision()}`;
    if (terrainSrc && lastTerrainKeyRef.current !== terrainKey) {
      lastTerrainKeyRef.current = terrainKey;
      terrainSrc.setData(buildViewportTerrainGeoJSON(range));
    }
  }, []);

  const syncViewportGridRef = useRef(syncViewportGrid);
  syncViewportGridRef.current = syncViewportGrid;

  const syncHoverGrid = useCallback((map: MapLibreMap) => {
    const hoverSrc = map.getSource('tactical-viewport-grid-hover') as GeoJSONSource | undefined;
    if (!hoverSrc) return;

    if (map.getZoom() < ZOOM_TACTICO - 1.0) {
      hoverSrc.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const features: TacticalGeoJSONFeature<TacticalPolygonGeometry, { kind: 'hover' | 'selected' }>[] = [];
    const sel = selectedMicroCoordsRef.current;
    const hov = hoveredCellGlobalRef.current;

    if (sel) {
      features.push(buildCellPolygonFeature(sel.sector, sel.cell, 'selected'));
    }

    if (
      hov &&
      (!sel ||
        sel.sector[0] !== hov.sector[0] ||
        sel.sector[1] !== hov.sector[1] ||
        sel.cell[0] !== hov.cell[0] ||
        sel.cell[1] !== hov.cell[1])
    ) {
      features.push(buildCellPolygonFeature(hov.sector, hov.cell, 'hover'));
    }

    hoverSrc.setData({ type: 'FeatureCollection', features });
  }, []);

  const syncHoverGridRef = useRef(syncHoverGrid);
  syncHoverGridRef.current = syncHoverGrid;

  const provincesGeoJSON = useMemo<any>(() => {
    // Si tenemos las geometrías oficiales reales (/map/theatre_regions.json), las usamos directamente
    if (baseRegionsGeoJSON && Array.isArray(baseRegionsGeoJSON.features) && baseRegionsGeoJSON.features.length > 0) {
      const features = baseRegionsGeoJSON.features.map((feat: any) => {
        const provId = feat.id || feat.properties?.id;
        const ctrl = controlMap[provId];
        const clan = ctrl?.controllingClanId ? clansMap[ctrl.controllingClanId] : null;
        const isBuffer = String(provId).startsWith('BUF_');
        const isUnderSiege = ctrl?.status === 'under_siege';
        const isSelected = provId === activeProvinceId;
        const ownerColor = resolveFactionColor(
          ctrl?.controllingClanId,
          isBuffer,
          isUnderSiege,
          clan?.color
        );
        const sov = stateSovereigntyService.getState(String(provId));

        return {
          ...feat,
          id: provId,
          properties: {
            ...feat.properties,
            id: provId,
            name: sov?.customStateName || feat.properties?.name || provId,
            countryName: sov?.customCountryName || 'República Soberana de Venezuela',
            controllingFaction: sov?.controllingFactionId || 'blue_moon',
            ownerColor,
            isBuffer,
            isCapital: provId === 'REG_VE_01',
            isUnderSiege,
            isVulnerableActive: Boolean(isUnderSiege || (ctrl as any)?.isVulnerableActive),
            isSelected,
            tcp: sov?.tcpCurrent ?? (ctrl?.currentTcp ?? 10000),
            tcpMax: sov?.tcpMax ?? (ctrl?.tcpThreshold ?? 10000),
          },
        };
      });

      return { type: 'FeatureCollection', features };
    }

    // Fallback proyectado referencial mientras descarga el GeoJSON
    const features: any[] = provinces.map((prov) => {
      const ctrl = controlMap[prov.id];
      const clan = ctrl?.controllingClanId ? clansMap[ctrl.controllingClanId] : null;
      const isBuffer = prov.id.startsWith('BUF_');
      const isUnderSiege = ctrl?.status === 'under_siege';
      const ownerColor = resolveFactionColor(
        ctrl?.controllingClanId,
        isBuffer,
        isUnderSiege,
        clan?.color
      );
      const sov = stateSovereigntyService.getState(prov.id);

      // Proyección referencial sobre el teatro venezolano y caribeño
      const lngCenter = (prov.posX - 50) * 0.28 - 66.5;
      const latCenter = (50 - prov.posY) * 0.16 + 7.8;
      const halfW = (prov.width * 0.11) / 2;
      const halfH = (prov.height * 0.09) / 2;

      return {
        type: 'Feature',
        id: prov.id,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lngCenter - halfW, latCenter + halfH],
              [lngCenter + halfW, latCenter + halfH],
              [lngCenter + halfW, latCenter - halfH],
              [lngCenter - halfW, latCenter - halfH],
              [lngCenter - halfW, latCenter + halfH],
            ],
          ],
        },
        properties: {
          id: prov.id,
          name: sov?.customStateName || prov.name,
          countryName: sov?.customCountryName || 'República Soberana de Venezuela',
          controllingFaction: sov?.controllingFactionId || 'blue_moon',
          ownerColor,
          isBuffer,
          isCapital: prov.isCapital,
          isUnderSiege,
          isVulnerableActive: Boolean(isUnderSiege || (ctrl as any)?.isVulnerableActive),
          tcp: sov?.tcpCurrent ?? (ctrl?.currentTcp ?? 10000),
          tcpMax: sov?.tcpMax ?? (ctrl?.tcpThreshold ?? 10000),
          isSelected: prov.id === activeProvinceId,
          isHovered: prov.id === hoveredProvinceId,
        },
      };
    });

    return { type: 'FeatureCollection', features };
  }, [baseRegionsGeoJSON, provinces, controlMap, clansMap, activeProvinceId, hoveredProvinceId, resolveFactionColor, sovereignVersion]);

  const provincesGeoJSONRef = useRef(provincesGeoJSON);
  provincesGeoJSONRef.current = provincesGeoJSON;

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    let isMounted = true;

    const enterStandby = () => {
      if (isStandbyRef.current) return;
      isStandbyRef.current = true;
      setIsStandbyUI(true);
    };

    const wakeFromStandby = () => {
      if (inactivityTimerRef.current !== null) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = window.setTimeout(enterStandby, ACTIVITY_TIMEOUT_MS);

      if (!isStandbyRef.current) return;
      isStandbyRef.current = false;
      setIsStandbyUI(false);
      mapInstanceRef.current?.triggerRepaint();
    };

    const initMapEngine = async () => {
      try {
        const maplibreMod = await import('maplibre-gl');
        const maplibregl = (maplibreMod as any).default || maplibreMod;
        if (!isMounted || !mapContainerRef.current) return;

        if (typeof maplibregl.supported === 'function' && !maplibregl.supported()) {
          setWebglError('El acelerador gráfico o navegador no soporta WebGL 2.0.');
          return;
        }

        const setWorker = (maplibregl as any).setWorkerUrl || (maplibreMod as any).setWorkerUrl;
        if (typeof setWorker === 'function') {
          setWorker('/maplibre-gl-worker.mjs');
        }

        // Registrar protocolo local en memoria tactical-sector:// (0 peticiones HTTP externas)
        if (typeof (maplibregl as any).addProtocol === 'function') {
          try {
            (maplibregl as any).addProtocol('tactical-sector', async (params: { url: string }) => {
              const parts = params.url.replace('tactical-sector://', '').split('?')[0].split('/');
              const sx = Number(parts[1] ?? 9880);
              const sy = Number(parts[2] ?? 15432);
              const matrix = spatialDeploymentService.getSectorTerrainMatrix([sx, sy], TACTICAL_GRID_DIMENSION);
              const encoder = new TextEncoder();
              return { data: encoder.encode(JSON.stringify({ sector: [sx, sy], matrix })).buffer };
            });
          } catch {
            // Ya registrado en sesión previa
          }
        }

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: ZERO_RASTER_MILITARY_STYLE,
          center: [-71.455, 10.395], // Epicentro Operacional Inicial: Teatro Cabimas (Zulia)
          zoom: 9.8,
          minZoom: 2.0,
          maxZoom: TACTICAL_SPRITE_MAX_ZOOM,
          doubleClickZoom: false,
          attributionControl: false,
        });

        map.on('zoom', () => {
          if (!isMounted) return;
          const z = map.getZoom();
          handleZoomTransitionRef.current?.(z);
          if (z < ZOOM_TACTICO - 1.0) {
            setHoveredCellGlobal(null);
          }
          syncViewportGridRef.current?.(map);
        });

        map.on('move', () => {
          if (!isMounted) return;
          syncViewportGridRef.current?.(map);
        });

        map.on('moveend', () => {
          if (!isMounted) return;
          syncViewportGridRef.current?.(map);
          void refreshDbOperationalUnitsRef.current();
        });

        map.on('resize', () => {
          if (!isMounted) return;
          syncViewportGridRef.current?.(map);
        });

        if (typeof window !== 'undefined') {
          (window as any).__TACTICAL_MAP_INSTANCE__ = map;
          (window as any).__SET_TACTICAL_ZOOM__ = (z: number) => {
            try { map.setZoom(z); } catch {}
            if (isMounted) {
              handleZoomTransitionRef.current?.(z);
              if (z < ZOOM_TACTICO - 1.0) {
                setHoveredCellGlobal(null);
              }
              syncViewportGridRef.current?.(map);
            }
          };
        }

        map.on('load', () => {
          if (!isMounted) return;
          pruneCivilianLayers(map);
          handleZoomTransitionRef.current?.(map.getZoom());

          // 1. Fuentes GeoJSON de Provincias, Malla de Fronteras Deduplicadas y Municipios (tolerance: 0, buffer: 64)
          map.addSource('tactical-provinces', {
            type: 'geojson',
            data: provincesGeoJSONRef.current,
            tolerance: 0,
            buffer: 64,
          });

          map.addSource('tactical-borders-mesh', {
            type: 'geojson',
            data: '/map/theatre_borders_mesh.json',
            tolerance: 0,
            buffer: 64,
          });

          map.addSource('zulia-municipalities', {
            type: 'geojson',
            data: '/map/zulia_municipalities.json',
            tolerance: 0,
            buffer: 64,
          });

          // 1A. Relleno de Provincias Soberanas (theatre_regions.json)
          map.addLayer({
            id: 'provinces-fill',
            type: 'fill',
            source: 'tactical-provinces',
            maxzoom: ZOOM_TACTICO - 0.5,
            paint: {
              'fill-color': ['get', 'ownerColor'],
              'fill-opacity': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                0.56,
                ['boolean', ['get', 'isUnderSiege'], false],
                0.48,
                0.34,
              ],
            },
          });

          // 1B. Relleno de Municipios del Zulia (Estrato 2: 8.5 <= zoom < ZOOM_TACTICO - 0.5)
          map.addLayer({
            id: 'zulia-municipalities-fill',
            type: 'fill',
            source: 'zulia-municipalities',
            minzoom: 8.5,
            maxzoom: ZOOM_TACTICO - 0.5,
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                '#F59E0B',
                '#46521F',
              ],
              'fill-opacity': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                0.34,
                0.04,
              ],
            },
          });

          // 1C. Malla de Fronteras Deduplicadas en GPU (theatre_borders_mesh.json)
          map.addLayer({
            id: 'tactical-borders-mesh',
            type: 'line',
            source: 'tactical-borders-mesh',
            maxzoom: ZOOM_TACTICO - 0.5,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#7B8A4A',
              'line-width': ['interpolate', ['linear'], ['zoom'], 3.5, 1.2, 10, 1.5],
              'line-opacity': 0.95,
            },
          });

          // 1D. Contorno de Municipios del Zulia (Estrato 2: 8.5 <= zoom < ZOOM_TACTICO - 0.5)
          map.addLayer({
            id: 'zulia-municipalities-border',
            type: 'line',
            source: 'zulia-municipalities',
            minzoom: 8.5,
            maxzoom: ZOOM_TACTICO - 0.5,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                '#FACC15',
                '#94A3B8',
              ],
              'line-width': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                3.2,
                1.2,
              ],
              'line-opacity': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                0.95,
                0.42,
              ],
            },
          });

          // 1E. Resaltado exclusivo de provincias seleccionadas o bajo asedio
          map.addLayer({
            id: 'provinces-borders',
            type: 'line',
            source: 'tactical-provinces',
            maxzoom: ZOOM_TACTICO - 0.5,
            filter: ['any', ['boolean', ['get', 'isSelected'], false], ['boolean', ['get', 'isUnderSiege'], false]],
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                '#00FF66', // Verde Fósforo CRT Radar al seleccionar
                '#EF4444', // Borde rojo DEFCON 1 en asedio
              ],
              'line-width': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                3.2,
                2.2,
              ],
              'line-opacity': 0.95,
            },
          });

          // 1F. Halo pulsante ámbar para regiones en estado de vulnerabilidad activa (Anti-Offline Raiding)
          map.addLayer({
            id: 'provinces-vulnerable-halo',
            type: 'line',
            source: 'tactical-provinces',
            maxzoom: ZOOM_TACTICO - 0.5,
            filter: ['==', ['get', 'isVulnerableActive'], true],
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#F59E0B',
              'line-width': 4.5,
              'line-opacity': 0.85,
              'line-blur': 3.0,
            },
          });

          // 2. Capa de Red Vial Troncal Real de Venezuela (theatre_roads.json)
          map.addSource('tactical-roads', {
            type: 'geojson',
            data: '/map/theatre_roads.json',
          });

          // Capa 2A: Sombra de Tinta Cómic (#0A0B08)
          map.addLayer({
            id: 'roads-ink-shadow',
            type: 'line',
            source: 'tactical-roads',
            paint: {
              'line-color': '#0A0B08',
              'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 8, 4.2, 14, 7.0],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.78, 14.5, 0.0],
            },
          });

          // Capa 2B: Resplandor Naranja/Ámbar C4ISR
          map.addLayer({
            id: 'roads-glow',
            type: 'line',
            source: 'tactical-roads',
            paint: {
              'line-color': '#D97706',
              'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 8, 3.6, 14, 6.0],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.30, 14.5, 0.0],
              'line-blur': 2.0,
            },
          });

          // Capa 2C: Núcleo de Carretera Principal (desaturado y atenuado al entrar a Zoom Táctico)
          map.addLayer({
            id: 'roads-core',
            type: 'line',
            source: 'tactical-roads',
            paint: {
              'line-color': [
                'match',
                ['get', 'highway'],
                'motorway', '#D97706',
                '#B45309',
              ],
              'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 8, 1.8, 14, 3.2],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.85, 14.5, 0.0],
            },
          });

          // (Eliminadas capas urban-roads-* de theatre_urban_roads.json que generaban líneas naranjas sueltas sobre el mapa táctico)

          // 5. Capa de Nombres de Ciudades y Cabeceras Reales (theatre_cities.json - 8.5 <= zoom < 15.0)
          map.addSource('tactical-cities', {
            type: 'geojson',
            data: '/map/theatre_cities.json',
          });

          // 5A: Marcador Radar de Ciudad
          map.addLayer({
            id: 'cities-glow',
            type: 'circle',
            source: 'tactical-cities',
            minzoom: 8.5,
            maxzoom: 15.0,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 6, 14, 12],
              'circle-color': [
                'case',
                ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                '#00FF66',
                '#F59E0B',
              ],
              'circle-opacity': 0.4,
              'circle-blur': 1.2,
            },
          });

          map.addLayer({
            id: 'cities-point',
            type: 'circle',
            source: 'tactical-cities',
            minzoom: 8.5,
            maxzoom: 15.0,
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                8.5,
                [
                  'case',
                  ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                  5.5,
                  3.5,
                ],
                14,
                [
                  'case',
                  ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                  8.5,
                  6,
                ],
              ],
              'circle-color': [
                'case',
                ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                '#00FF66',
                '#F2E8D5',
              ],
              'circle-stroke-color': '#0A0B08',
              'circle-stroke-width': 2,
            },
          });

          // 5B: Etiquetas de Texto con el Nombre de la Ciudad
          map.addLayer({
            id: 'cities-labels',
            type: 'symbol',
            source: 'tactical-cities',
            minzoom: 8.5,
            maxzoom: 15.0,
            layout: {
              'text-field': ['get', 'name'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 8.5, 10.5, 14, 15],
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
              'text-transform': 'uppercase',
              'text-letter-spacing': 0.1,
              'text-allow-overlap': false,
              'text-optional': true,
              'text-padding': 4,
            },
            paint: {
              'text-color': [
                'case',
                ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                '#00FF66',
                '#F2E8D5',
              ],
              'text-halo-color': '#0A0B08',
              'text-halo-width': 2,
            },
          });

          // 5C. Terreno Geográfico Persistente por Sector (Ruta A: CustomLayer WebGL GL_NEAREST 0-huecos)
          map.addSource('tactical-sector-terrain', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-sector-terrain-fill',
            type: 'fill',
            source: 'tactical-sector-terrain',
            minzoom: 14.5,
            filter: ['==', ['get', 'kind'], 'fill'],
            paint: {
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0.0, 14.99, 0.12, 15.0, 0.15],
            },
          });

          map.addLayer(createTacticalTerrainWebGLLayer(map));

          // 6. Cuadrícula Táctica Vectorial Continua en GPU (Macro 10.0..13.99 -> Micro 20x20 >= 14.0)
          map.addSource('tactical-viewport-grid', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-viewport-grid-lines',
            type: 'line',
            source: 'tactical-viewport-grid',
            minzoom: 10.0,
            paint: {
              'line-color': ['case', ['boolean', ['get', 'isSectorBorder'], false], '#4ADE80', '#A3E635'],
              'line-width': ['case', ['boolean', ['get', 'isSectorBorder'], false], 1.6, 0.9],
              'line-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10.0,
                0.16,
                13.99,
                0.24,
                14.0,
                ['case', ['boolean', ['get', 'isSectorBorder'], false], 0.55, 0.28],
                15.0,
                ['case', ['boolean', ['get', 'isSectorBorder'], false], 0.65, 0.32],
              ],
            },
          });

          map.addSource('tactical-viewport-grid-hover', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-viewport-grid-hover-fill',
            type: 'fill',
            source: 'tactical-viewport-grid-hover',
            minzoom: ZOOM_TACTICO - 1.0,
            paint: {
              'fill-color': '#FACC15',
              'fill-opacity': 0.16,
            },
          });

          map.addLayer({
            id: 'tactical-viewport-grid-hover-line',
            type: 'line',
            source: 'tactical-viewport-grid-hover',
            minzoom: ZOOM_TACTICO - 1.0,
            paint: {
              'line-color': '#FACC15',
              'line-width': 2.2,
            },
          });

          // 7. Precarga GPU de Sprites Verdes (greenEarth) + Capa de Unidades RTS Activas (zoom >= 15.0)
          registerGreenUnitSprites(map);

          map.addSource('tactical-rts-units', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-rts-units-halo',
            type: 'circle',
            source: 'tactical-rts-units',
            minzoom: 14.0,
            paint: {
              'circle-radius': ['case', ['boolean', ['get', 'isSelected'], false], 16, 13],
              'circle-color': ['case', ['boolean', ['get', 'isAlly'], true], '#15803D', '#C2410C'],
              'circle-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14.0,
                0.0,
                14.5,
                0.15,
                14.99,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.40, 0.24],
              ],
              'circle-stroke-color': ['case', ['boolean', ['get', 'isSelected'], false], '#EAB308', '#090D14'],
              'circle-stroke-width': ['case', ['boolean', ['get', 'isSelected'], false], 2.5, 1.5],
              'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 14.0, 0.0, 14.99, 1.0],
            },
          });

          map.addLayer({
            id: 'tactical-rts-units-sprites',
            type: 'symbol',
            source: 'tactical-rts-units',
            minzoom: 14.0,
            layout: {
              'icon-image': ['get', 'spriteKey'],
              'icon-size': ['case', ['boolean', ['get', 'isSelected'], false], 0.85, 0.7],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
            paint: {
              'icon-opacity': ['interpolate', ['linear'], ['zoom'], 14.0, 0.0, 14.5, 0.45, 14.99, 0.96, 15.0, 1.0],
            },
          });

          map.addLayer({
            id: 'tactical-rts-units-labels',
            type: 'symbol',
            source: 'tactical-rts-units',
            minzoom: 14.5,
            layout: {
              'text-field': ['concat', ['get', 'code'], ' ', ['to-string', ['get', 'hp']]],
              'text-size': 10,
              'text-offset': [0, 1.5],
              'text-anchor': 'top',
            },
            paint: {
              'text-color': '#E2E8F0',
              'text-halo-color': '#0A0B08',
              'text-halo-width': 1.5,
              'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0.0, 15.0, 1.0],
            },
          });

          // 7B. Capas DB MMO: Aristas de Infraestructura (Tuberías, Carreteras, Puentes) & Edificios / Bases Históricas
          map.addSource('db-mmo-infra-edges', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'db-mmo-infra-edges-casing',
            type: 'line',
            source: 'db-mmo-infra-edges',
            minzoom: 8.5,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#0A0B08',
              'line-width': ['case', ['boolean', ['get', 'isSelected'], false], 9, 6],
            },
          });
          map.addLayer({
            id: 'db-mmo-infra-edges-line',
            type: 'line',
            source: 'db-mmo-infra-edges',
            minzoom: 8.5,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'status'], 'severed'],
                '#EF4444',
                ['match', ['get', 'edge_type'], 'pipeline', '#06B6D4', 'bridge', '#F59E0B', '#D97706'],
              ],
              'line-width': ['case', ['boolean', ['get', 'isSelected'], false], 5, 3.2],
              'line-dasharray': ['case', ['==', ['get', 'status'], 'severed'], ['literal', [2, 2]], ['literal', [1, 0]]],
            },
          });
          map.addLayer({
            id: 'db-mmo-infra-edges-labels',
            type: 'symbol',
            source: 'db-mmo-infra-edges',
            minzoom: 10.0,
            layout: {
              'symbol-placement': 'line-center',
              'text-field': ['get', 'label'],
              'text-size': 9,
            },
            paint: {
              'text-color': '#F2E8D5',
              'text-halo-color': '#0A0B08',
              'text-halo-width': 1.5,
            },
          });

          map.addSource('db-mmo-buildings', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'db-mmo-buildings-halo',
            type: 'circle',
            source: 'db-mmo-buildings',
            minzoom: 8.5,
            paint: {
              'circle-radius': ['case', ['boolean', ['get', 'isSelected'], false], 17, 13],
              'circle-color': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                '#00FF66',
                ['boolean', ['get', 'is_production_halted'], false],
                '#EF4444',
                ['boolean', ['get', 'is_historical'], false],
                '#F59E0B',
                '#46521F',
              ],
              'circle-opacity': 0.35,
            },
          });
          map.addLayer({
            id: 'db-mmo-buildings-circle',
            type: 'circle',
            source: 'db-mmo-buildings',
            minzoom: 8.5,
            paint: {
              'circle-radius': ['case', ['boolean', ['get', 'is_historical'], false], 9.5, 7.5],
              'circle-color': [
                'case',
                ['==', ['get', 'infra_state'], 'RUINED'],
                '#7F1D1D',
                ['==', ['get', 'infra_state'], 'DAMAGED'],
                '#D97706',
                ['boolean', ['get', 'isOwn'], false],
                '#15803D',
                ['boolean', ['get', 'isNeutral'], false],
                '#E2E8F0',
                '#B91C1C',
              ],
              'circle-stroke-color': '#0A0B08',
              'circle-stroke-width': 2.5,
            },
          });
          map.addLayer({
            id: 'db-mmo-buildings-labels',
            type: 'symbol',
            source: 'db-mmo-buildings',
            minzoom: 9.5,
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 9.5,
              'text-offset': [0, 1.45],
              'text-anchor': 'top',
              'text-optional': true,
            },
            paint: {
              'text-color': '#F2E8D5',
              'text-halo-color': '#0A0B08',
              'text-halo-width': 1.8,
            },
          });

          // 7C. Capas DB Operacionales Estilo Advance Wars (Rango, Flecha Retro y Unidades)
          map.addSource('db-operational-reachable', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'db-operational-reachable-fill',
            type: 'fill',
            source: 'db-operational-reachable',
            minzoom: 8.5,
            paint: {
              'fill-color': '#3B82F6',
              'fill-opacity': 0.3,
            },
          });
          map.addLayer({
            id: 'db-operational-reachable-line',
            type: 'line',
            source: 'db-operational-reachable',
            minzoom: 8.5,
            paint: {
              'line-color': '#60A5FA',
              'line-width': 1.5,
              'line-opacity': 0.85,
            },
          });

          map.addSource('db-operational-arrow', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'db-operational-arrow-casing',
            type: 'line',
            source: 'db-operational-arrow',
            minzoom: 8.5,
            filter: ['==', ['get', 'kind'], 'body'],
            layout: { 'line-cap': 'butt', 'line-join': 'miter' },
            paint: {
              'line-color': '#0A0B08',
              'line-width': 11,
            },
          });
          map.addLayer({
            id: 'db-operational-arrow-fill',
            type: 'line',
            source: 'db-operational-arrow',
            minzoom: 8.5,
            filter: ['==', ['get', 'kind'], 'body'],
            layout: { 'line-cap': 'butt', 'line-join': 'miter' },
            paint: {
              'line-color': '#F59E0B',
              'line-width': 7,
            },
          });
          map.addLayer({
            id: 'db-operational-arrow-core',
            type: 'line',
            source: 'db-operational-arrow',
            minzoom: 8.5,
            filter: ['==', ['get', 'kind'], 'body'],
            layout: { 'line-cap': 'butt', 'line-join': 'miter' },
            paint: {
              'line-color': '#FDE047',
              'line-width': 2.5,
            },
          });
          map.addLayer({
            id: 'db-operational-arrow-nodes',
            type: 'circle',
            source: 'db-operational-arrow',
            minzoom: 8.5,
            filter: ['in', ['get', 'kind'], ['literal', ['origin', 'head']]],
            paint: {
              'circle-radius': ['case', ['==', ['get', 'kind'], 'head'], 7, 5],
              'circle-color': ['case', ['==', ['get', 'kind'], 'head'], '#FDE047', '#F59E0B'],
              'circle-stroke-color': '#0A0B08',
              'circle-stroke-width': 2.5,
            },
          });

          map.addSource('db-operational-units', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'db-operational-units-circle',
            type: 'circle',
            source: 'db-operational-units',
            minzoom: 8.5,
            paint: {
              'circle-radius': ['case', ['boolean', ['get', 'isSelected'], false], 16, 12],
              'circle-color': ['case', ['boolean', ['get', 'isSelected'], false], '#F59E0B', '#15803D'],
              'circle-opacity': 0.85,
              'circle-stroke-color': '#0A0B08',
              'circle-stroke-width': 2.5,
            },
          });
          map.addLayer({
            id: 'db-operational-units-sprites',
            type: 'symbol',
            source: 'db-operational-units',
            minzoom: 8.5,
            layout: {
              'icon-image': ['get', 'spriteKey'],
              'icon-size': ['case', ['boolean', ['get', 'isSelected'], false], 0.85, 0.7],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
          });
          map.addLayer({
            id: 'db-operational-units-labels',
            type: 'symbol',
            source: 'db-operational-units',
            minzoom: 8.5,
            layout: {
              'text-field': ['concat', ['get', 'unit_code'], ' ', ['to-string', ['get', 'hp']]],
              'text-size': 10,
              'text-offset': [0, 1.5],
              'text-anchor': 'top',
            },
            paint: {
              'text-color': '#FDE047',
              'text-halo-color': '#0A0B08',
              'text-halo-width': 1.5,
            },
          });

          syncViewportGridRef.current?.(map);
          syncHoverGridRef.current?.(map);
          syncRtsUnitsToMapRef.current?.();
          syncDbOperationalLayersRef.current();

          // Cursores tácticos e interactividad
          map.on('mouseenter', 'provinces-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'provinces-fill', () => {
            map.getCanvas().style.cursor = '';
          });

          const handleZuliaLayerClick = (e: MapMouseEvent) => {
            if (map.getZoom() >= ZOOM_TACTICO - 1.0) return;
            if ((e.originalEvent as any)?.__zuliaMunHandled) return;
            const features = (e as any).features as any[] | undefined;
            const matchedFeat = features?.find((f) => Boolean(resolveMunicipalityIdFromFeature(f)));
            const munId = matchedFeat ? resolveMunicipalityIdFromFeature(matchedFeat) : null;
            if (!munId) return;
            if (e.originalEvent) (e.originalEvent as any).__zuliaMunHandled = true;
            setSelectedMunicipalityId(munId);
            if (onSelectMunicipalityRef.current) {
              onSelectMunicipalityRef.current(munId, {
                name: matchedFeat?.properties?.name || matchedFeat?.properties?.municipalityName,
                cityName: matchedFeat?.properties?.cityName,
                stateId: matchedFeat?.properties?.stateId || 'REG_VE_02',
              });
            }
            try { audioManager.playHoverTick(); } catch {}
          };

          for (const layerId of ['cities-labels', 'cities-point', 'zulia-municipalities-fill'] as const) {
            map.on('mouseenter', layerId, () => {
              map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', layerId, () => {
              map.getCanvas().style.cursor = '';
            });
            map.on('click', layerId, handleZuliaLayerClick);
          }

          map.on('mousemove', (e: MapMouseEvent) => {
            wakeFromStandby();
            if (selectedDbOpUnitRef.current && reachableDbOpTilesRef.current.size > 0) {
              const { sector: hovSec, cell: hovCel } = lngLatToGridCoords(
                [e.lngLat.lng, e.lngLat.lat],
                TACTICAL_GRID_DIMENSION,
                ZOOM_TACTICO
              );
              const key = `${hovSec[0]},${hovSec[1]}:${hovCel[0]},${hovCel[1]}`;
              const reachEntry = reachableDbOpTilesRef.current.get(key);
              if (reachEntry && reachEntry.path.length > 0) {
                const segments = calculatePathArrow(reachEntry.path);
                syncDbOperationalLayersRef.current({
                  segments,
                  originSector: reachEntry.originSector,
                  originCell: reachEntry.originCell,
                  gridOriginX: reachEntry.gridOriginX,
                  gridOriginY: reachEntry.gridOriginY,
                });
              } else {
                syncDbOperationalLayersRef.current(null);
              }
            }
            if (map.getZoom() >= ZOOM_TACTICO - 1.0) {
              const { sector, cell } = lngLatToGridCoords(
                [e.lngLat.lng, e.lngLat.lat],
                TACTICAL_GRID_DIMENSION,
                ZOOM_TACTICO
              );
              setHoveredCellGlobal((prev) =>
                prev &&
                prev.sector[0] === sector[0] &&
                prev.sector[1] === sector[1] &&
                prev.cell[0] === cell[0] &&
                prev.cell[1] === cell[1]
                  ? prev
                  : { sector, cell }
              );
            } else {
              setHoveredCellGlobal(null);
            }
          });

          map.on('click', (e: MapMouseEvent) => {
            wakeFromStandby();

            // 1. Selección / Movimiento / Infraestructura DB MMO (Zoom >= 8.5)
            if (map.getZoom() >= 8.5) {
              if (edgeTraceModeRef.current && activeDbCorpIdRef.current) {
                const trace = edgeTraceModeRef.current;
                let targetH3 = Number(latLngToH3Res9(e.lngLat.lat, e.lngLat.lng));
                let targetBuildingId: string | null = null;
                try {
                  const bldHits = map.queryRenderedFeatures(e.point, {
                    layers: ['db-mmo-buildings-circle', 'db-mmo-buildings-labels'],
                  });
                  const hitId = bldHits[0]?.properties?.id as string | undefined;
                  const hitBld = worldBuildingsRef.current.find((b) => b.id === hitId);
                  if (hitBld) {
                    targetH3 = hitBld.h3_index;
                    targetBuildingId = hitBld.id;
                  }
                } catch {}

                if (targetH3 !== trace.fromH3) {
                  setIsInfraActionBusy(true);
                  void createInfraEdge({
                    corpId: activeDbCorpIdRef.current,
                    edgeType: trace.type,
                    fromH3: trace.fromH3,
                    toH3: targetH3,
                    fromBuildingId: trace.fromBuildingId ?? null,
                    toBuildingId: targetBuildingId,
                  })
                    .then(async () => {
                      audioManager.playCue('co_power_charge');
                      setMapInfraFeedback({ type: 'ok', text: `${trace.type.toUpperCase()} trazada entre hexágonos H3.` });
                      setEdgeTraceMode(null);
                      await refreshDbOperationalUnits();
                    })
                    .catch((err) => {
                      audioManager.playCue('ui_cancel_rollback');
                      setMapInfraFeedback({
                        type: 'err',
                        text: err instanceof Error ? err.message : 'Error trazando infraestructura.',
                      });
                      setEdgeTraceMode(null);
                    })
                    .finally(() => setIsInfraActionBusy(false));
                  return;
                }
              }

              try {
                const opFeatures = map.queryRenderedFeatures(e.point, {
                  layers: ['db-operational-units-circle', 'db-operational-units-sprites'],
                });
                if (opFeatures.length > 0) {
                  const clickedId = opFeatures[0]?.properties?.id as string | undefined;
                  const clickedDbUnit = dbOperationalUnitsRef.current.find((u) => u.id === clickedId);
                  if (clickedDbUnit) {
                    if (
                      !activeDbCorpIdRef.current ||
                      clickedDbUnit.corp_id !== activeDbCorpIdRef.current ||
                      !canControlDbUnitsRef.current
                    ) {
                      try { audioManager.playCue('ui_cancel_rollback'); } catch {}
                      return;
                    }
                    selectDbOperationalUnit(clickedDbUnit);
                    return;
                  }
                }
              } catch {
                // ignorar si las capas aún no están listas
              }

              if (selectedDbOpUnitRef.current) {
                const { sector: clickSec, cell: clickCel } = lngLatToGridCoords(
                  [e.lngLat.lng, e.lngLat.lat],
                  TACTICAL_GRID_DIMENSION,
                  ZOOM_TACTICO
                );
                const key = `${clickSec[0]},${clickSec[1]}:${clickCel[0]},${clickCel[1]}`;
                const targetEntry = reachableDbOpTilesRef.current.get(key);
                if (targetEntry) {
                  void executeDbOperationalMove(targetEntry);
                  return;
                }
                clearDbOpSelection();
              }

              try {
                const bldFeatures = map.queryRenderedFeatures(e.point, {
                  layers: ['db-mmo-buildings-circle', 'db-mmo-buildings-labels'],
                });
                if (bldFeatures.length > 0) {
                  const bldId = bldFeatures[0]?.properties?.id as string | undefined;
                  const clickedBld = worldBuildingsRef.current.find((b) => b.id === bldId);
                  if (clickedBld) {
                    setSelectedMapEdge(null);
                    setSelectedMapBuilding(clickedBld);
                    setMapInfraFeedback(null);
                    try { audioManager.playCue('ui_tile_confirm'); } catch {}
                    return;
                  }
                }

                const edgeFeatures = map.queryRenderedFeatures(e.point, {
                  layers: ['db-mmo-infra-edges-line'],
                });
                if (edgeFeatures.length > 0) {
                  const edgeId = edgeFeatures[0]?.properties?.id as string | undefined;
                  const clickedEdge = infraEdgesRef.current.find((ed) => ed.id === edgeId);
                  if (clickedEdge) {
                    setSelectedMapBuilding(null);
                    setSelectedMapEdge(clickedEdge);
                    setMapInfraFeedback(null);
                    try { audioManager.playCue('ui_tile_confirm'); } catch {}
                    return;
                  }
                }
              } catch {
                // ignorar si las capas aún no están listas
              }
            }

            if (map.getZoom() >= ZOOM_TACTICO - 1.0) {
              const { sector, cell } = lngLatToGridCoords(
                [e.lngLat.lng, e.lngLat.lat],
                TACTICAL_GRID_DIMENSION,
                ZOOM_TACTICO
              );
              setSelectedMicroCoords({
                sector,
                cell,
                lngLat: [e.lngLat.lng, e.lngLat.lat],
              });
              if (onSelectTacticalCellRef.current) {
                onSelectTacticalCellRef.current(sector, cell, [e.lngLat.lng, e.lngLat.lat]);
              }

              // Interacción RTS Continuo en Celda
              const rts = rtsEngineRef.current;
              const allUnits = rts.getAllUnits() as unknown as RtsUnitView[];
              const clickedUnit = allUnits.find((u) => u.x === cell[0] && u.y === cell[1]);
              const selectedUnit = selectedTacticalUnitIdRef.current
                ? (rts.getUnit(selectedTacticalUnitIdRef.current) as unknown as RtsUnitView | undefined)
                : undefined;

              if (clickedUnit) {
                const clickedOwner = clickedUnit.owner || clickedUnit.ownerId;
                const selectedOwner = selectedUnit ? selectedUnit.owner || selectedUnit.ownerId : null;

                if (clickedOwner === (userClanId || 'clan-ferro') || !selectedUnit) {
                  // Seleccionar unidad aliada
                  setSelectedTacticalUnitId(clickedUnit.id);
                  selectedTacticalUnitIdRef.current = clickedUnit.id;
                  syncRtsUnitsToMapRef.current?.();
                  try { audioManager.playHoverTick(); } catch {}
                } else if (selectedUnit && clickedOwner !== selectedOwner) {
                  // Disparo sobre unidad enemiga
                  const fireResult = rts.executeFire(selectedUnit.id, clickedUnit.id, Date.now());
                  if (fireResult.success) {
                    triggerScreenShakeRef.current?.();
                    syncRtsUnitsToMapRef.current?.();
                    try { audioManager.playCue('ui_tile_confirm'); } catch {}
                  } else {
                    try { audioManager.playCue('ui_cancel_rollback'); } catch {}
                  }
                }
              } else if (selectedUnit) {
                // Clic en celda vacía: orden de marcha interpolada
                const path = [
                  { x: selectedUnit.x, y: selectedUnit.y },
                  { x: cell[0], y: cell[1] },
                ];
                rts.issueMoveOrder(selectedUnit.id, path, Date.now());
                syncRtsUnitsToMapRef.current?.();
                try { audioManager.playSFX('button_click'); } catch {}
              }
            }
          });

          map.on('click', 'provinces-fill', (e: MapMouseEvent) => {
            const z = map.getZoom();
            if (z >= ZOOM_TACTICO - 1.0) return;

            if (z >= 8.5 && z < ZOOM_TACTICO - 0.5) {
              const zuliaLayers = ['cities-labels', 'cities-point', 'zulia-municipalities-fill'].filter((id) =>
                Boolean(map.getLayer(id))
              );
              if (zuliaLayers.length > 0) {
                const zuliaHits = map.queryRenderedFeatures(e.point, { layers: zuliaLayers });
                const matchedMunFeat = zuliaHits.find((f: any) => Boolean(resolveMunicipalityIdFromFeature(f)));
                const hitMunId = matchedMunFeat ? resolveMunicipalityIdFromFeature(matchedMunFeat) : null;
                if (hitMunId) {
                  if (!(e.originalEvent as any)?.__zuliaMunHandled) {
                    if (e.originalEvent) (e.originalEvent as any).__zuliaMunHandled = true;
                    setSelectedMunicipalityId(hitMunId);
                    if (onSelectMunicipalityRef.current) {
                      onSelectMunicipalityRef.current(hitMunId, {
                        name: matchedMunFeat?.properties?.name || matchedMunFeat?.properties?.municipalityName,
                        cityName: matchedMunFeat?.properties?.cityName,
                        stateId: matchedMunFeat?.properties?.stateId || 'REG_VE_02',
                      });
                    }
                    try { audioManager.playHoverTick(); } catch {}
                  }
                  return;
                }
              }
            }

            if (z < 5.0 && onSelectCountryRef.current) {
              onSelectCountryRef.current('COUNTRY_VEN');
              return;
            }

            const featureId = (e as any).features?.[0]?.properties?.id;
            if (featureId && onSelectProvinceRef.current) {
              onSelectProvinceRef.current(String(featureId));
            }
            const ctrl = controlMapRef.current?.[featureId];
            if (ctrl?.status === 'under_siege') {
              triggerScreenShakeRef.current?.();
            }
          });

          map.on('click', 'world-land-mass', (e: MapMouseEvent) => {
            if (map.getZoom() >= ZOOM_TACTICO - 1.0) return;
            const provHits = map.getLayer('provinces-fill')
              ? map.queryRenderedFeatures(e.point, { layers: ['provinces-fill'] })
              : [];
            if (provHits.length > 0) return;
            onSelectCountryRef.current?.('COUNTRY_VEN');
          });
        });

        mapInstanceRef.current = map;
        if (typeof window !== 'undefined') {
          (window as any).__TACTICAL_MAP_INSTANCE__ = map;
        }
      } catch (err: any) {
        console.error('[TacticalWorldMap] Fallo crítico al inicializar MapLibre WebGL:', err);
        setWebglError(err?.message || 'Error de contexto WebGL al inicializar mapa.');
      }
    };

    initMapEngine();

    window.addEventListener('blur', enterStandby);
    window.addEventListener('focus', wakeFromStandby);
    inactivityTimerRef.current = window.setTimeout(enterStandby, ACTIVITY_TIMEOUT_MS);

    return () => {
      isMounted = false;
      window.removeEventListener('blur', enterStandby);
      window.removeEventListener('focus', wakeFromStandby);
      if (inactivityTimerRef.current !== null) window.clearTimeout(inactivityTimerRef.current);
      if (mapInstanceRef.current) {
        if (typeof window !== 'undefined' && (window as any).__TACTICAL_MAP_INSTANCE__ === mapInstanceRef.current) {
          (window as any).__TACTICAL_MAP_INSTANCE__ = null;
        }
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [pruneCivilianLayers, userClanId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const provSource = map.getSource('tactical-provinces') as GeoJSONSource | undefined;
    if (provSource) provSource.setData(provincesGeoJSON);
  }, [provincesGeoJSON]);

  // Actualización instantánea de delimitación geográfica real de municipios del Zulia sin recargar fuentes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const activeMunId = selectedMunicipalityId || '';

    if (map.getLayer('zulia-municipalities-fill')) {
      map.setPaintProperty('zulia-municipalities-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        '#F59E0B',
        '#46521F',
      ]);
      map.setPaintProperty('zulia-municipalities-fill', 'fill-opacity', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        0.34,
        0.04,
      ]);
    }

    if (map.getLayer('zulia-municipalities-border')) {
      map.setPaintProperty('zulia-municipalities-border', 'line-color', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        '#00FF66',
        '#7B8A4A',
      ]);
      map.setPaintProperty('zulia-municipalities-border', 'line-width', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        3.2,
        1.1,
      ]);
      map.setPaintProperty('zulia-municipalities-border', 'line-opacity', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        0.98,
        0.48,
      ]);
    }

    if (map.getLayer('cities-glow')) {
      map.setPaintProperty('cities-glow', 'circle-color', [
        'case',
        ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
        '#00FF66',
        '#F59E0B',
      ]);
    }

    if (map.getLayer('cities-point')) {
      map.setPaintProperty('cities-point', 'circle-color', [
        'case',
        ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
        '#00FF66',
        '#F2E8D5',
      ]);
      map.setPaintProperty('cities-point', 'circle-radius', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8.5,
        [
          'case',
          ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
          5.5,
          3.5,
        ],
        14,
        [
          'case',
          ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
          8.5,
          6,
        ],
      ]);
    }

    if (map.getLayer('cities-labels')) {
      map.setPaintProperty('cities-labels', 'text-color', [
        'case',
        ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
        '#00FF66',
        '#F2E8D5',
      ]);
    }
  }, [selectedMunicipalityId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    syncHoverGrid(map);
  }, [hoveredCellGlobal, selectedMicroCoords, currentZoom, syncHoverGrid]);

  const syncAnchorSectorUnitsToRts = useCallback(() => {
    const anchorSector =
      rtsAnchorSectorRef.current ??
      lngLatToGridCoords([-71.455, 10.395], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO).sector;
    rtsAnchorSectorRef.current = anchorSector;

    const rts = rtsEngineRef.current;

    const matrix = spatialDeploymentService.getSectorTerrainMatrix(anchorSector, TACTICAL_GRID_DIMENSION);
    for (let y = 0; y < TACTICAL_GRID_DIMENSION; y++) {
      for (let x = 0; x < TACTICAL_GRID_DIMENSION; x++) {
        rts.setTerrain(x, y, matrix[y][x]);
      }
    }
  }, []);

  // Sincronización reactiva de terreno espacial (Estrato 3)
  useEffect(() => {
    const unsubSpatial = spatialDeploymentService.subscribe(() => {
      const map = mapInstanceRef.current;
      if (map) {
        lastTerrainKeyRef.current = 'dirty';
        syncViewportGridRef.current?.(map);
      }
      const anchor = rtsAnchorSectorRef.current;
      if (anchor) {
        const matrix = spatialDeploymentService.getSectorTerrainMatrix(anchor, TACTICAL_GRID_DIMENSION);
        for (let y = 0; y < TACTICAL_GRID_DIMENSION; y++) {
          for (let x = 0; x < TACTICAL_GRID_DIMENSION; x++) {
            rtsEngineRef.current.setTerrain(x, y, matrix[y][x]);
          }
        }
      }
    });
    return () => {
      unsubSpatial();
    };
  }, [activeBattleUnits, syncAnchorSectorUnitsToRts]);

  // Siembra inicial y sincronización de capa al cambiar zoom o unidades (el loop rAF 60 FPS corre en useTacticalDeltaRenderer)
  useEffect(() => {
    const hasScheduledDrones = activeSchedules.length > 0 && currentZoom >= 8.5;
    if (currentZoom < ZOOM_TACTICO - 1.0 && !hasScheduledDrones) {
      syncRtsUnitsToMap();
      return;
    }

    // Sembrar unidades del Polígono de Cabimas en sector ancla si el motor está vacío
    if (currentZoom >= ZOOM_TACTICO - 1.0 && rtsEngineRef.current.getAllUnits().length === 0) {
      if (activeBattleUnits && activeBattleUnits.length > 0) {
        for (const u of activeBattleUnits) {
          rtsEngineRef.current.registerUnit(u as any);
        }
      } else {
        syncAnchorSectorUnitsToRts();
      }
    }

    syncRtsUnitsToMap();
    syncDbOperationalLayersRef.current();
  }, [currentZoom, activeBattleUnits, activeSchedules.length, userClanId, syncRtsUnitsToMap, syncAnchorSectorUnitsToRts]);

  const activeMicroCoords = useMemo(() => {
    if (selectedMicroCoords) return selectedMicroCoords;
    if (currentZoom >= 15.0 && mapInstanceRef.current) {
      const center = mapInstanceRef.current.getCenter();
      const coords = lngLatToGridCoords([center.lng, center.lat], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
      return {
        sector: coords.sector,
        cell: coords.cell,
        lngLat: [center.lng, center.lat] as [number, number],
      };
    }
    return null;
  }, [selectedMicroCoords, currentZoom]);

  const microAssignment = useMemo(() => {
    if (!activeMicroCoords || currentZoom < 15.0) return null;
    return spatialDeploymentService.getSpatialAssignment(activeMicroCoords.lngLat);
  }, [activeMicroCoords, currentZoom]);

  useEffect(() => {
    if (externalDeployTrigger > 0) {
      setIsDeployModalOpen(true);
    }
  }, [externalDeployTrigger]);

  useEffect(() => {
    if (externalBuildTrigger > 0) {
      setIsBuildDrawerOpen(true);
    }
  }, [externalBuildTrigger]);

  if (webglError) {
    return (
      <div className={`relative w-full h-full flex flex-col items-center justify-center bg-[#090D14] p-6 text-center select-none ${className}`}>
        <div className="max-w-md p-6 bg-[#161712] border-2 border-amber-500 rounded-[6px_2px_6px_2px] shadow-[4px_4px_0px_#0A0B08] space-y-4">
          <div className="text-amber-400 font-mono text-xs font-black tracking-widest uppercase">
            [ALERTA C4ISR: FALLO EN MOTOR GRÁFICO WEBGL 2.0]
          </div>
          <p className="text-[#F2E8D5] text-xs font-mono leading-relaxed">
            {webglError}
          </p>
          <div className="text-[11px] font-mono text-neutral-400 bg-black/60 p-2.5 rounded border border-neutral-800">
            Verifica que la aceleración por hardware WebGL 2.0 esté habilitada en tu navegador para continuar la campaña.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-[#090D14] ${isScreenShaking ? 'tactical-screen-shake' : ''} ${className}`}
    >
      <div
        ref={mapContainerRef}
        className={`w-full h-full ${isStratumTransitioning ? 'tactical-stratum-blur' : 'tactical-stratum-clear'}`}
      />

      {/* Indicador Cinético de Cambio de Estrato (HUD C4ISR) */}
      {isStratumTransitioning && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none tactical-spring-bounce">
          <div className="bg-[#161712]/95 border-2 border-[#7B8A4A] text-[#F2E8D5] px-4 py-1.5 rounded-[12px_3px_12px_3px] shadow-[4px_4px_0px_#0A0B08] flex items-center gap-2 font-mono text-xs font-black uppercase tracking-wider backdrop-blur-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00FF66] animate-ping" />
            <span>
              {currentStratum === 1
                ? '🛰️ ESTRATO 1: VISTA MACRO-ESTRATÉGICA (Z < 10)'
                : currentStratum === 2
                ? '🗺️ ESTRATO 2: TEATRO OPERACIONAL Y RED VIAL (10 ≤ Z < 15)'
                : '⚔️ ESTRATO 3: CUADRÍCULA DE COMBATE C4ISR (Z ≥ 15)'}
            </span>
          </div>
        </div>
      )}

      {/* Capa Semántica e Interactiva Accesible (Habilita accesibilidad y orquestación E2E en Playwright) */}
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" aria-hidden="false">
        <button
          type="button"
          data-country-id="COUNTRY_VEN"
          onClick={(e) => {
            e.stopPropagation();
            onSelectCountry?.('COUNTRY_VEN');
          }}
          tabIndex={-1}
          aria-label="País República de Venezuela"
          className="absolute pointer-events-auto opacity-0 focus:opacity-100 w-6 h-6 top-16 left-1/2 -translate-x-1/2 cursor-pointer"
        />

        {[
          { id: 'MUN_ZULIA_CABIMAS', name: 'Cabimas', cityName: 'Cabimas', stateId: 'REG_VE_02', left: '22%', top: '26%' },
          { id: 'MUN_ZULIA_MARACAIBO', name: 'Maracaibo', cityName: 'Maracaibo', stateId: 'REG_VE_02', left: '19%', top: '23%' },
          { id: 'MUN_ZULIA_BARALT', name: 'Baralt', cityName: 'Mene Grande', stateId: 'REG_VE_02', left: '24%', top: '31%' },
          { id: 'MUN_ZULIA_SUCRE', name: 'Sucre', cityName: 'Bobures', stateId: 'REG_VE_02', left: '23%', top: '36%' },
        ].map((mun) => (
          <button
            key={mun.id}
            type="button"
            data-municipality-id={mun.id}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedMunicipalityId(mun.id);
              onSelectMunicipality?.(mun.id, {
                name: mun.name,
                cityName: mun.cityName,
                stateId: mun.stateId,
              });
            }}
            tabIndex={-1}
            aria-label={`Municipio ${mun.name}`}
            className="absolute pointer-events-auto opacity-0 focus:opacity-100 w-6 h-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
            style={{ left: mun.left, top: mun.top }}
          />
        ))}

        {worldBuildings
          .filter((b) => b.is_historical)
          .slice(0, 6)
          .map((hb, idx) => (
            <button
              key={hb.id}
              type="button"
              data-building-id={hb.id}
              data-building-type={hb.building_type}
              data-testid={idx === 0 ? 'map-historical-base-btn' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedMapEdge(null);
                setSelectedMapBuilding(hb);
                setMapInfraFeedback(null);
                try { audioManager.playCue('ui_tile_confirm'); } catch {}
              }}
              tabIndex={-1}
              aria-label={`Base histórica ${hb.building_type} ${hb.municipality_id ?? ''}`}
              className="absolute pointer-events-auto opacity-0 focus:opacity-100 w-5 h-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
              style={{ left: `${20 + idx * 3}%`, top: `${25 + (idx % 3) * 4}%` }}
            />
          ))}

        {provinces.map((prov) => {
          const isBuffer = prov.id.startsWith('BUF_');
          return (
            <button
              key={prov.id}
              data-region-id={prov.id}
              data-buffer-zone={isBuffer ? 'true' : 'false'}
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectProvince) onSelectProvince(prov.id);
              }}
              tabIndex={-1}
              aria-label={`Región ${prov.name}`}
              className="absolute pointer-events-auto opacity-0 focus:opacity-100 w-8 h-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
              style={{
                left: `${prov.posX}%`,
                top: `${prov.posY}%`,
              }}
            />
          );
        })}
      </div>
      <div
        className={
          hideLegacyMicroDeck
            ? 'absolute top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-[#0E100C]/88 border border-[#46521F] px-2.5 py-1 text-[9.5px] font-mono text-emerald-400 rounded shadow-[2px_2px_0px_#0A0B08] whitespace-nowrap'
            : 'absolute bottom-16 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-3 sm:bottom-16 z-20 pointer-events-none bg-[#090D14]/88 border border-[#46521F] px-2.5 py-1 text-[10px] font-mono text-emerald-400 rounded shadow-[2px_2px_0px_#0A0B08]'
        }
      >
        <div>OPENPLACE WEBGL • ZOOM: {currentZoom.toFixed(2)}x • TEATRO VENEZUELA ({provinces.filter(p => !p.id.startsWith('BUF_')).length} SOBERANAS + {provinces.filter(p => p.id.startsWith('BUF_')).length} BUFFERS)</div>
        {isStandbyUI && <div className="text-amber-500 font-bold">[MODO AHORRO C4ISR: 0% GPU STANDBY]</div>}
      </div>

      {/* Panel de Detalle del Microjuego Táctico C4ISR (Activo a Zoom >= 15.0 cuando no usa inspector unificado) */}
      {!hideLegacyMicroDeck && (
        <MicroTacticalDeckHUD
          currentZoom={currentZoom}
          selectedSector={activeMicroCoords?.sector ?? null}
          selectedCell={activeMicroCoords?.cell ?? null}
          selectedLngLat={activeMicroCoords?.lngLat ?? null}
          terrainType={microAssignment?.terrainName}
          defenseStars={microAssignment ? Math.round(microAssignment.defenseCoverPercent / 10) : 2}
          occupantName={
            microAssignment?.deployedUnit?.callsign ||
            microAssignment?.deployedBuilding?.buildingType ||
            null
          }
          onOpenDeploy={() => setIsDeployModalOpen(true)}
          onOpenBuild={() => setIsBuildDrawerOpen(true)}
        />
      )}

      {/* Modales de Despliegue, Construcción Espacial e Interacción Directa con Edificios / Infraestructura */}
      {(activeMicroCoords ||
        isDeployModalOpen ||
        isBuildDrawerOpen ||
        selectedMapBuilding ||
        selectedMapEdge ||
        activeBaseProdBuilding ||
        selectedDbOpUnit ||
        edgeTraceMode ||
        (activeDbCorpId && corpProdBuildings.length > 0)) && (() => {
        const modalCoords = activeMicroCoords || (() => {
          const fallbackLngLat: [number, number] = [-71.455, 10.395];
          const coords = lngLatToGridCoords(fallbackLngLat, TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
          return {
            sector: coords.sector,
            cell: coords.cell,
            lngLat: fallbackLngLat,
          };
        })();
        const modalH3Index = Number(latLngToH3Res9(modalCoords.lngLat[1], modalCoords.lngLat[0]));
        const bld = selectedMapBuilding;
        const bldState = bld ? bld.infra_state ?? (bld.is_disabled || bld.hp <= 0 ? 'RUINED' : 'OPERATIONAL') : 'OPERATIONAL';
        const isOwnBld = Boolean(bld && activeDbCorpId && bld.corp_id === activeDbCorpId);
        const isNeutralBld = Boolean(bld && !bld.corp_id);
        const isRivalBld = Boolean(bld && bld.corp_id && (!activeDbCorpId || bld.corp_id !== activeDbCorpId));
        const isProdFacility = Boolean(
          bld && ['factory', 'barracks', 'port', 'airport', 'hq'].includes(bld.building_type)
        );
        const isHousingBld = Boolean(bld && bld.building_type === 'housing');
        const isLogisticsBld = Boolean(bld && ['extractor', 'depot', 'hq'].includes(bld.building_type));
        const bldYield = bld ? calculateBuildingPendingYield(bld) : null;
        const activeCollectorUnit = dbOperationalUnits.find(
          (u) => u.unit_role === 'collector' && u.status === 'active'
        );

        const runInfraAction = async (fn: () => Promise<void>) => {
          setIsInfraActionBusy(true);
          setMapInfraFeedback(null);
          try {
            await fn();
          } catch (err) {
            audioManager.playCue('ui_cancel_rollback');
            setMapInfraFeedback({
              type: 'err',
              text: err instanceof Error ? err.message : 'Error ejecutando operación de infraestructura.',
            });
          } finally {
            setIsInfraActionBusy(false);
          }
        };

        const portalContent = (
          <>
            <TacticalUnitDeployModal
              isOpen={isDeployModalOpen}
              onClose={() => setIsDeployModalOpen(false)}
              sector={modalCoords.sector}
              cell={modalCoords.cell}
              lngLat={modalCoords.lngLat}
              userClanId={userClanId || 'clan-ferro'}
              userFactionId="blue_moon"
              corpId={activeDbCorpId}
              onDeploySuccess={() => {
                syncRtsUnitsToMap();
                void refreshDbOperationalUnits();
              }}
            />

            <TacticalConstructionDrawer
              isOpen={isBuildDrawerOpen}
              onClose={() => setIsBuildDrawerOpen(false)}
              sector={modalCoords.sector}
              cell={modalCoords.cell}
              lngLat={modalCoords.lngLat}
              userClanId={userClanId || 'clan-ferro'}
              corpId={activeDbCorpId ?? undefined}
              h3Index={modalH3Index}
              onConstructionSuccess={() => {
                void refreshDbOperationalUnits();
              }}
            />

            {edgeTraceMode && (
              <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 bg-[#181914] border-2 border-[#00FF66] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] font-mono text-xs text-[#F2E8D5] flex items-center gap-3">
                <span className="text-[#00FF66] font-black uppercase">
                  MODO TRAZADO ({edgeTraceMode.type.toUpperCase()}): HAZ CLIC EN EL HEXÁGONO O EDIFICIO DESTINO
                </span>
                <button
                  type="button"
                  onClick={() => setEdgeTraceMode(null)}
                  className="px-2 py-0.5 bg-rose-950 border border-rose-600 rounded-[8px_2px_8px_2px] text-[10px] cursor-pointer"
                >
                  CANCELAR
                </button>
              </div>
            )}

            {(bld || selectedMapEdge) && (
              <div
                data-testid="map-infra-action-panel"
                className="fixed bottom-24 left-4 z-[85] w-80 max-w-[92vw] bg-[#181914] border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] p-3.5 font-mono text-[#F2E8D5] space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2 border-b border-[#46521F] pb-2">
                  <div>
                    <div className="text-[10px] text-[#C46A3A] font-black uppercase">
                      {bld
                        ? `${bld.is_historical ? 'ENCLAVE HISTÓRICO' : 'INFRAESTRUCTURA'} // ${bld.municipality_id ?? 'MAPA'}`
                        : `ARISTA ${selectedMapEdge?.edge_type.toUpperCase()}`}
                    </div>
                    <h4 className="text-xs font-black uppercase">
                      {bld
                        ? `${bld.building_type.toUpperCase()} Nv.${bld.level} (${bldState})`
                        : `${selectedMapEdge?.edge_type.toUpperCase()} • ${selectedMapEdge?.status.toUpperCase()}`}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMapBuilding(null);
                      setSelectedMapEdge(null);
                      setMapInfraFeedback(null);
                    }}
                    className="px-1.5 py-0.5 bg-[#2B2C24] border border-[#7B8A4A] rounded-[8px_2px_8px_2px] text-[10px] cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                {mapInfraFeedback && (
                  <div
                    className={`p-2 text-[10px] border rounded-[8px_2px_8px_2px] ${
                      mapInfraFeedback.type === 'ok'
                        ? 'bg-emerald-950/70 border-emerald-500 text-emerald-200'
                        : 'bg-rose-950/80 border-rose-500 text-rose-200'
                    }`}
                  >
                    {mapInfraFeedback.text}
                  </div>
                )}

                {bld && (
                  <div className="space-y-2 text-[11px]">
                    <div className="flex justify-between text-[#7B8A4A]">
                      <span>Integridad: {bld.hp} / {bld.max_hp ?? 30} HP</span>
                      <span>{isOwnBld ? 'PROPIO' : isNeutralBld ? 'NEUTRAL' : 'RIVAL'}</span>
                    </div>

                    {bld.building_type === 'extractor' && bldYield && (
                      <div className="p-2 bg-[#2B2C24] border border-[#46521F] rounded-[8px_2px_8px_2px] space-y-1">
                        <div className="flex justify-between text-[10px]">
                          <span>Almacén Finito:</span>
                          <span className={bldYield.isProductionHalted ? 'text-rose-400 font-black' : 'text-emerald-400'}>
                            {bldYield.totalStored} / {bldYield.storageCap}
                          </span>
                        </div>
                        {bldYield.isProductionHalted && (
                          <div className="text-[10px] text-rose-300 font-bold">
                            ⚠ PRODUCCIÓN DETENIDA (CONECTAR TUBERÍA O RECOLECTOR)
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {!activeDbCorpId && (
                        <div className="text-[10px] text-amber-300/90">
                          Conecta una cuenta con Corporación para capturar, producir o atacar infraestructura.
                        </div>
                      )}
                      {activeDbCorpId && (isNeutralBld || (isRivalBld && bldState === 'RUINED')) && (
                        <button
                          type="button"
                          disabled={isInfraActionBusy}
                          onClick={() =>
                            void runInfraAction(async () => {
                              await claimOrCaptureBuildingDb(bld.id, activeDbCorpId);
                              audioManager.playCue('co_power_charge');
                              setMapInfraFeedback({ type: 'ok', text: 'Enclave capturado y puesto en operación.' });
                              await refreshDbOperationalUnits();
                            })
                          }
                          className="tactical-btn-heavy px-2.5 py-1 text-[10px] cursor-pointer disabled:opacity-45"
                        >
                          CAPTURAR ENCLAVE
                        </button>
                      )}

                      {isOwnBld && isProdFacility && bldState !== 'RUINED' && (
                        <button
                          type="button"
                          onClick={() => setActiveBaseProdBuilding(bld)}
                          className="tactical-btn-heavy px-2.5 py-1 text-[10px] cursor-pointer"
                        >
                          PRODUCCIÓN ADVANCE WARS
                        </button>
                      )}

                      {isOwnBld && isHousingBld && bldState !== 'RUINED' && (
                        <button
                          type="button"
                          disabled={isInfraActionBusy}
                          onClick={() =>
                            void runInfraAction(async () => {
                              await collectHousingCitizens(bld.id, activeDbCorpId!, false);
                              audioManager.playCue('ui_tile_confirm');
                              setMapInfraFeedback({ type: 'ok', text: 'Ciudadanos recolectados en Corporación.' });
                              await refreshDbOperationalUnits();
                            })
                          }
                          className="px-2.5 py-1 bg-[#46521F] border border-[#7B8A4A] rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                        >
                          RECOLECTAR CIUDADANOS
                        </button>
                      )}

                      {isOwnBld && isLogisticsBld && bldState !== 'RUINED' && (
                        <>
                          <button
                            type="button"
                            disabled={isInfraActionBusy}
                            onClick={() =>
                              void runInfraAction(async () => {
                                await syncPipelineLogistics(activeDbCorpId!);
                                if (bld.building_type !== 'depot') {
                                  await collectBuildingResourcesDb(bld.id, activeDbCorpId!).catch(() => null);
                                }
                                audioManager.playCue('ui_tile_confirm');
                                setMapInfraFeedback({ type: 'ok', text: 'Logística de tuberías y almacén sincronizada.' });
                                await refreshDbOperationalUnits();
                              })
                            }
                            className="px-2.5 py-1 bg-[#2B2C24] border border-cyan-500 text-cyan-300 rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                          >
                            SINCRONIZAR TUBERÍA
                          </button>

                          {bld.building_type === 'extractor' && activeCollectorUnit && (
                            <button
                              type="button"
                              disabled={isInfraActionBusy}
                              onClick={() =>
                                void runInfraAction(async () => {
                                  await executeCollectorHaul({
                                    unitId: activeCollectorUnit.id,
                                    extractorBuildingId: bld.id,
                                  });
                                  audioManager.playCue('ui_tile_confirm');
                                  setMapInfraFeedback({ type: 'ok', text: 'Unidad recolectora completó acarreo al depósito.' });
                                  await refreshDbOperationalUnits();
                                })
                              }
                              className="px-2.5 py-1 bg-[#2B2C24] border border-emerald-500 text-emerald-300 rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                            >
                              ACARREAR (RECOLECTOR)
                            </button>
                          )}
                        </>
                      )}

                      {activeDbCorpId && isOwnBld && (
                        <>
                          {(['pipeline', 'road', 'bridge'] as const).map((edgeT) => (
                            <button
                              key={edgeT}
                              type="button"
                              onClick={() => {
                                setEdgeTraceMode({ type: edgeT, fromH3: bld.h3_index, fromBuildingId: bld.id });
                                setMapInfraFeedback({
                                  type: 'ok',
                                  text: `Haz clic en otro hexágono/edificio para conectar ${edgeT.toUpperCase()}.`,
                                });
                              }}
                              className="px-2 py-1 bg-[#2B2C24] border border-[#46521F] rounded-[8px_2px_8px_2px] text-[10px] uppercase cursor-pointer"
                            >
                              + {edgeT}
                            </button>
                          ))}
                        </>
                      )}

                      {isOwnBld && bldState !== 'OPERATIONAL' && (
                        <button
                          type="button"
                          disabled={isInfraActionBusy}
                          onClick={() =>
                            void runInfraAction(async () => {
                              await repairInfrastructure('building', bld.id, activeDbCorpId!);
                              audioManager.playCue('co_power_charge');
                              setMapInfraFeedback({ type: 'ok', text: 'Edificio reparado (~35% costo).' });
                              await refreshDbOperationalUnits();
                            })
                          }
                          className="px-2.5 py-1 bg-amber-900/70 border border-amber-500 rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                        >
                          REPARAR (~35%)
                        </button>
                      )}

                      {activeDbCorpId && !isOwnBld && (
                        <>
                          {isRivalBld && (
                            <button
                              type="button"
                              disabled={isInfraActionBusy}
                              onClick={() =>
                                void runInfraAction(async () => {
                                  await triggerVulnerabilityHandshake({
                                    municipalityId: bld.municipality_id ?? 'MUN_ZULIA_CABIMAS',
                                    attackerCorpId: activeDbCorpId,
                                    defenderCorpId: bld.corp_id,
                                  });
                                  audioManager.playCue('trap_alert');
                                  setMapInfraFeedback({ type: 'ok', text: 'Handshake 120s iniciado para ataque.' });
                                })
                              }
                              className="px-2.5 py-1 bg-amber-950 border border-amber-500 text-amber-200 rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                            >
                              HANDSHAKE 120s
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isInfraActionBusy}
                            onClick={() =>
                              void runInfraAction(async () => {
                                await damageInfrastructure({
                                  targetKind: 'building',
                                  targetId: bld.id,
                                  attackerCorpId: activeDbCorpId,
                                  damage: 15,
                                });
                                audioManager.playCue('explosion_critical');
                                setMapInfraFeedback({ type: 'ok', text: 'Impacto balístico aplicado (35% scrap al arruinar).' });
                                await refreshDbOperationalUnits();
                              })
                            }
                            className="px-2.5 py-1 bg-rose-950 border border-rose-500 text-rose-200 rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                          >
                            ATACAR OBJETIVO
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {selectedMapEdge && (
                  <div className="space-y-2 text-[11px]">
                    <div className="flex justify-between text-[#7B8A4A]">
                      <span>HP: {selectedMapEdge.hp} / {selectedMapEdge.max_hp}</span>
                      <span>{selectedMapEdge.status.toUpperCase()}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeDbCorpId &&
                        selectedMapEdge.corp_id === activeDbCorpId &&
                        selectedMapEdge.status === 'severed' && (
                          <button
                            type="button"
                            disabled={isInfraActionBusy}
                            onClick={() =>
                              void runInfraAction(async () => {
                                await repairInfrastructure('edge', selectedMapEdge.id, activeDbCorpId);
                                audioManager.playCue('co_power_charge');
                                setMapInfraFeedback({ type: 'ok', text: 'Ruta reparada (~35% costo).' });
                                await refreshDbOperationalUnits();
                              })
                            }
                            className="px-2.5 py-1 bg-amber-900/70 border border-amber-500 rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                          >
                            REPARAR RUTA (~35%)
                          </button>
                        )}
                      {activeDbCorpId && selectedMapEdge.corp_id !== activeDbCorpId && (
                        <button
                          type="button"
                          disabled={isInfraActionBusy}
                          onClick={() =>
                            void runInfraAction(async () => {
                              await damageInfrastructure({
                                targetKind: 'edge',
                                targetId: selectedMapEdge.id,
                                attackerCorpId: activeDbCorpId,
                                damage: 15,
                              });
                              audioManager.playCue('explosion_critical');
                              setMapInfraFeedback({ type: 'ok', text: 'Sabotaje ejecutado sobre ruta.' });
                              await refreshDbOperationalUnits();
                            })
                          }
                          className="px-2.5 py-1 bg-rose-950 border border-rose-500 text-rose-200 rounded-[8px_2px_8px_2px] text-[10px] font-bold cursor-pointer"
                        >
                          SABOTEAR RUTA
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeDbCorpId && corpProdBuildings.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveBaseProdBuilding(corpProdBuildings[0])}
                className="fixed bottom-12 right-4 z-[80] tactical-btn-heavy px-3.5 py-2 text-xs font-mono cursor-pointer"
              >
                PRODUCCIÓN BASE ({corpProdBuildings[0].building_type.toUpperCase()})
              </button>
            )}

            {activeDbCorpId && activeBaseProdBuilding && (
              <BaseProductionModal
                isOpen={Boolean(activeBaseProdBuilding)}
                onClose={() => setActiveBaseProdBuilding(null)}
                corpId={activeDbCorpId}
                buildingId={activeBaseProdBuilding.id}
                buildingType={
                  (activeBaseProdBuilding.building_type as 'factory' | 'barracks' | 'port' | 'airport' | 'hq') ||
                  'factory'
                }
                h3Index={activeBaseProdBuilding.h3_index}
                corpEc={corpEconomySnap.ec}
                corpCitizens={corpEconomySnap.citizens}
                canPurchaseUnits={canPurchaseUnitsRef.current}
                canControlUnits={canControlDbUnitsRef.current}
                isRuined={activeBaseProdBuilding.is_disabled || activeBaseProdBuilding.hp <= 0}
                onDeployed={async () => {
                  await refreshDbOperationalUnits();
                }}
              />
            )}

            {selectedDbOpUnit && activeDbCorpId && (
              <>
                <button
                  type="button"
                  onClick={() => setIsDroneSchedulerOpen(true)}
                  className="fixed bottom-24 right-4 z-[80] tactical-btn-heavy px-3.5 py-2 text-xs font-mono cursor-pointer"
                >
                  PROGRAMAR DRON / BITÁCORA ({selectedDbOpUnit.unit_code.toUpperCase()})
                </button>
                <DroneSchedulerDrawer
                  isOpen={isDroneSchedulerOpen}
                  onClose={() => setIsDroneSchedulerOpen(false)}
                  corpId={activeDbCorpId}
                  unitId={selectedDbOpUnit.id}
                  unitCode={selectedDbOpUnit.unit_code}
                  currentH3={selectedDbOpUnit.h3_index}
                  canControlUnits={canControlDbUnitsRef.current}
                  availableBuildings={worldBuildings}
                  onSchedulesUpdated={refreshDbOperationalUnits}
                />
              </>
            )}
          </>
        );
        return typeof document !== 'undefined' ? createPortal(portalContent, document.body) : portalContent;
      })()}
    </div>
  );
};
