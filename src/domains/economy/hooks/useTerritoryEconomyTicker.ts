/**
 * ==============================================================================
 * HOOK DE GENERACIÓN ECONÓMICA CONTINUA Y TICKER DB-SSOT (USE TERRITORY ECONOMY TICKER)
 * ==============================================================================
 * Arquitectura: Wplace × Victoria 3 Continuous Production Pipeline (100% DB-SSOT)
 * - Cero `setInterval` que mute saldos en RAM.
 * - Cálculo en vivo del rendimiento horario acumulado exclusivamente a partir de
 *   `last_collected_at` vs `NOW()` (`Date.now()`) de los edificios en Supabase.
 * - Cosecha atómica vía `collectBuildingResourcesDb` (`collect_building_resources`).
 * ==============================================================================
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  WorldProvince,
  TerritoryNode,
  TerritoryControlState,
  type ExclusiveResourceNodeType,
} from '@shared';
import { audioManager } from '@domains/game-feel';
import { TerritorialUpkeepEngine, type UpkeepCalculationOutput } from '../core/upkeepEngine';
import {
  calculateSymbioticExtractionSettlement,
  type SymbioticExtractionSettlement,
} from '../core/strategicAndProductionEngine';
import {
  fetchCorpBuildings,
  collectBuildingResourcesDb,
  calculateBuildingPendingYield,
  resolveActiveUserCorpId,
  type DbBuildingRecord,
} from '../services/buildingDbService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UseTerritoryEconomyTickerProps {
  clanId?: string | null;
  corpId?: string | null;
  provinces: WorldProvince[];
  nodes: TerritoryNode[];
  controlMap: Record<string, TerritoryControlState>;
  onHarvestResources?: (delta: { ec: number; steel: number }) => void;
  onDeductUpkeep?: (upkeepEc: number) => void;
}

export interface TerritoryEconomyTickerState {
  ecPerMinute: number;
  steelPerMinute: number;
  accumulatedEc: number;
  accumulatedSteel: number;
  secondsUntilNextMinuteTick: number;
  controlledProvincesCount: number;
  controlledNodesCount: number;
  hasCapitalControl: boolean;
  upkeepMetrics: UpkeepCalculationOutput;
  symbioticTaxBreakdown: SymbioticExtractionSettlement;
  dbBuildings: DbBuildingRecord[];
  isLoadingBuildings: boolean;
  refreshBuildings: () => Promise<void>;
  harvestResources: () => { ec: number; steel: number };
}

export function useTerritoryEconomyTicker({
  clanId = 'clan-ferro',
  corpId = null,
  provinces,
  nodes,
  controlMap,
  onHarvestResources,
}: UseTerritoryEconomyTickerProps): TerritoryEconomyTickerState {
  const [dbBuildings, setDbBuildings] = useState<DbBuildingRecord[]>([]);
  const [resolvedCorpId, setResolvedCorpId] = useState<string | null>(() =>
    corpId && UUID_REGEX.test(corpId) ? corpId : clanId && UUID_REGEX.test(clanId) ? clanId : null
  );
  const [isLoadingBuildings, setIsLoadingBuildings] = useState<boolean>(false);
  // Referencia de reloj de solo lectura para calcular NOW() - last_collected_at sin mutar saldos en RAM
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (corpId && UUID_REGEX.test(corpId)) {
      setResolvedCorpId(corpId);
      return;
    }
    if (clanId && UUID_REGEX.test(clanId)) {
      setResolvedCorpId(clanId);
      return;
    }
    resolveActiveUserCorpId()
      .then((cid) => {
        if (isMountedRef.current && cid) setResolvedCorpId(cid);
      })
      .catch(() => {});
  }, [corpId, clanId]);

  const refreshBuildings = useCallback(async () => {
    if (!resolvedCorpId) {
      if (isMountedRef.current) setDbBuildings([]);
      return;
    }
    setIsLoadingBuildings(true);
    try {
      const list = await fetchCorpBuildings(resolvedCorpId);
      if (isMountedRef.current) {
        setDbBuildings(list);
        setNowMs(Date.now());
      }
    } catch {
      if (isMountedRef.current) setDbBuildings([]);
    } finally {
      if (isMountedRef.current) setIsLoadingBuildings(false);
    }
  }, [resolvedCorpId]);

  useEffect(() => {
    void refreshBuildings();
  }, [refreshBuildings]);

  // Reloj de solo lectura para refrescar la proyección temporal NOW() - last_collected_at (no muta saldos)
  useEffect(() => {
    const clockTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 10000);
    return () => window.clearInterval(clockTimer);
  }, []);

  // 1. Provincias y nodos soberanos controlados por el clan
  const controlledProvinces = useMemo(() => {
    if (!clanId) return [];
    return provinces.filter((p) => {
      const ctrl = controlMap[p.id];
      return ctrl ? ctrl.controllingClanId === clanId : false;
    });
  }, [provinces, controlMap, clanId]);

  const controlledNodes = useMemo(() => {
    if (!clanId) return [];
    return nodes.filter((n) => n.controllerClanId === clanId);
  }, [nodes, clanId]);

  const hasCapitalControl = useMemo(() => {
    return controlledProvinces.some((p) => p.isCapital);
  }, [controlledProvinces]);

  // 2. Cálculo integral de Upkeep y Sobre-expansión Psi_Over
  const upkeepMetrics = useMemo(() => {
    const nodeUpkeepData = controlledNodes.map((n) => ({
      id: n.id,
      nodeType: n.nodeType,
      defenseLevel: n.defenseLevel,
      energyUpkeep: n.energyUpkeep,
      outputPerMin: n.outputPerMin,
    }));

    return TerritorialUpkeepEngine.calculateClanTerritorialUpkeep({
      clanId: resolvedCorpId ?? clanId ?? 'clan-ferro',
      adminCapacity: 8,
      controlledProvincesCount: Math.max(1, controlledProvinces.length),
      nodes: nodeUpkeepData,
      isCapitalProvince: hasCapitalControl,
    });
  }, [resolvedCorpId, clanId, controlledProvinces.length, controlledNodes, hasCapitalControl]);

  // 3. Rendimiento horario acumulado en vivo desde DB (`last_collected_at` vs `nowMs`)
  const { ecPerMinute, steelPerMinute, accumulatedEc, accumulatedSteel } = useMemo(() => {
    let totalEcPerHour = 0;
    let totalAlloysPerHour = 0;
    let totalPendingEc = 0;
    let totalPendingAlloys = 0;

    for (const b of dbBuildings) {
      const y = calculateBuildingPendingYield(b, nowMs);
      totalEcPerHour += y.ecPerHour;
      totalAlloysPerHour += y.alloysPerHour;
      totalPendingEc += y.pendingEc;
      totalPendingAlloys += y.pendingAlloys;
    }

    return {
      ecPerMinute: Math.round((totalEcPerHour / 60) * 100) / 100,
      steelPerMinute: Math.round((totalAlloysPerHour / 60) * 100) / 100,
      accumulatedEc: totalPendingEc,
      accumulatedSteel: totalPendingAlloys,
    };
  }, [dbBuildings, nowMs]);

  const secondsUntilNextMinuteTick = useMemo(() => {
    const sec = 60 - (Math.floor(nowMs / 1000) % 60);
    return sec === 0 ? 60 : sec;
  }, [nowMs]);

  // 4. Desglose fiscal simbiótico de la cosecha acumulada
  const symbioticTaxBreakdown = useMemo(() => {
    const activeMunicipalityOwner = controlledProvinces[0]
      ? controlMap[controlledProvinces[0].id]?.controllingClanId ?? clanId ?? 'clan-ferro'
      : clanId ?? 'clan-ferro';
    const exclusiveNode: ExclusiveResourceNodeType = hasCapitalControl ? 'silicon' : 'oil_energy';
    return calculateSymbioticExtractionSettlement({
      municipalityId: controlledProvinces[0]?.id ?? 'MUN_ZULIA_CABIMAS',
      extractorOwnerClanId: clanId ?? 'clan-ferro',
      municipalityControllingClanId: activeMunicipalityOwner,
      grossYieldEc: accumulatedEc,
      exclusiveResourceNode: exclusiveNode,
    });
  }, [accumulatedEc, clanId, controlMap, controlledProvinces, hasCapitalControl]);

  // 5. Cosecha activa contra DB (`collect_building_resources`)
  const harvestResources = useCallback(() => {
    const ec = symbioticTaxBreakdown.netExtractorYieldEc;
    const steel = accumulatedSteel;

    if (!resolvedCorpId || dbBuildings.length === 0 || (ec <= 0 && steel <= 0)) {
      audioManager.playHoverTick();
      return { ec: 0, steel: 0 };
    }

    const activeBuildings = dbBuildings.filter((b) => !b.is_disabled);
    void (async () => {
      try {
        let collectedEc = 0;
        let collectedAlloys = 0;
        for (const b of activeBuildings) {
          const res = (await collectBuildingResourcesDb(b.id, resolvedCorpId)) as {
            collected?: { ec?: number; alloys?: number };
          } | null;
          collectedEc += Number(res?.collected?.ec ?? 0);
          collectedAlloys += Number(res?.collected?.alloys ?? 0);
        }
        audioManager.playComboAction(6);
        onHarvestResources?.({ ec: collectedEc, steel: collectedAlloys });
        await refreshBuildings();
      } catch {
        audioManager.playHoverTick();
      }
    })();

    return { ec, steel };
  }, [
    symbioticTaxBreakdown.netExtractorYieldEc,
    accumulatedSteel,
    resolvedCorpId,
    dbBuildings,
    onHarvestResources,
    refreshBuildings,
  ]);

  return {
    ecPerMinute,
    steelPerMinute,
    accumulatedEc,
    accumulatedSteel,
    secondsUntilNextMinuteTick,
    controlledProvincesCount: controlledProvinces.length,
    controlledNodesCount: controlledNodes.length,
    hasCapitalControl,
    upkeepMetrics,
    symbioticTaxBreakdown,
    dbBuildings,
    isLoadingBuildings,
    refreshBuildings,
    harvestResources,
  };
}
