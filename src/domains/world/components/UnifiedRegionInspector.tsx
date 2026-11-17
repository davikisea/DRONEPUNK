import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ChevronRight,
  Globe,
  Shield,
  MapPin,
  Crosshair,
  Crown,
  Flag,
  Coins,
  Zap,
  Fuel,
  Hammer,
  Gem,
  Cpu,
  Swords,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  Anchor,
  Scale,
  TrendingUp,
  Activity,
  Building2,
  Layers,
  Users,
  SlidersHorizontal,
} from 'lucide-react';
import { audioManager, barkEngine, BarkSelfOptimizationMetrics } from '@domains/game-feel';
import { GarrisonAIEngine, buildDroneSignalProjection } from '@domains/tactics';
import {
  fiefBuildingService,
  MUNICIPAL_BUILDINGS_CATALOG,
  calculateAdministrativeOverloadFuelMultiplier,
} from '@domains/economy';
import { stateSovereigntyService, STATE_PERKS_CATALOG } from '../services/stateSovereigntyService';
import {
  politicalAliceEngine,
  POLITICAL_EDICTS_CATALOG,
  VENEZUELA_FACTION_REGISTRY,
  THREE_LAYER_ARCHITECTURE,
  PoliticalEdictId,
  CANONICAL_VENEZUELA_REGIONS,
} from '../core/politicalAliceEngine';
import { spatialDeploymentService } from '../services/spatialDeploymentService';
import { StateSovereignDeckModal } from './StateSovereignDeckModal';
import type {
  StateSovereigntyRecord,
  UserRoleContext,
} from '../types/stateSovereigntyTypes';
import type {
  MapSelectionTarget,
  MapScaleLevel,
  InspectorTabId,
} from '../types/mapSelectionTypes';
import {
  ZULIA_MUNICIPALITIES_CATALOG,
  getZuliaMunicipalityMeta,
} from '../types/mapSelectionTypes';
import type {
  WorldProvince,
  TerritoryNode,
  TerritoryControlState,
} from '@shared';

export interface UnifiedRegionInspectorProps {
  selection: MapSelectionTarget | null;
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  onSelectTarget: (target: MapSelectionTarget) => void;
  userContext: UserRoleContext;
  provinces: WorldProvince[];
  nodes: TerritoryNode[];
  controlMap: Record<string, TerritoryControlState>;
  userClanId?: string | null;
  userClanTag?: string;
  userEc: number;
  userSteel: number;
  currentZoom: number;
  onDeclareAttack?: (targetProvinceId: string) => Promise<{ success: boolean; message?: string; error?: string } | void> | void;
  onOpenDeployModal?: () => void;
  onOpenBuildDrawer?: () => void;
  onOpenFullHangar?: () => void;
  onRebalanceGarrison?: (targetLevel: 1 | 2 | 3 | 4 | 5) => void;
  onJumpToScaleZoom?: (scale: MapScaleLevel, center?: [number, number], zoom?: number) => void;
}

const FACTION_META: Record<string, { bg: string; border: string; name: string }> = {
  orange_star: { bg: '#E65100', border: '#F59E0B', name: 'Orange Star (Vanguardia)' },
  blue_moon: { bg: '#1D4ED8', border: '#3B82F6', name: 'Blue Moon (Legión Ártica)' },
  green_earth: { bg: '#15803D', border: '#22C55E', name: 'Green Earth (Superioridad)' },
  yellow_comet: { bg: '#D97706', border: '#FBBF24', name: 'Yellow Comet (Élite Marcial)' },
  black_hole: { bg: '#4C1D95', border: '#991B1B', name: 'Black Hole (Dominio Táctico)' },
};

const SCALE_LABELS: Record<MapScaleLevel, string> = {
  country: 'ESCALA 1 • PAÍS',
  state: 'ESCALA 2 • ESTADO',
  municipality: 'ESCALA 3 • MUNICIPIO',
  cell: 'ESCALA 4 • CELDA 20×20',
};

export const UnifiedRegionInspector: React.FC<UnifiedRegionInspectorProps> = ({
  selection,
  isOpen,
  onClose,
  onOpen,
  onSelectTarget,
  userContext,
  provinces,
  controlMap,
  userClanId = 'clan-ferro',
  userClanTag = '[IVS]',
  currentZoom,
  onDeclareAttack,
  onOpenDeployModal,
  onOpenBuildDrawer,
  onOpenFullHangar,
  onRebalanceGarrison,
  onJumpToScaleZoom,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTabId>('summary');
  const [selectedGarrisonLevel, setSelectedGarrisonLevel] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [aliceState, setAliceState] = useState(() => politicalAliceEngine.getState());
  const [barkMetrics, setBarkMetrics] = useState<BarkSelfOptimizationMetrics>(() =>
    barkEngine.getSelfOptimizationMetrics()
  );
  const [stateRecord, setStateRecord] = useState<StateSovereigntyRecord | null>(null);
  const [isSovereignDeckOpen, setIsSovereignDeckOpen] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [spatialVersion, setSpatialVersion] = useState(0);
  const [harvestReport, setHarvestReport] = useState<{
    grossEc: number;
    retainedEc: number;
    netEc: number;
    ratePercent: number;
    nodeLabel: string;
  } | null>(null);
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [workshopEnabled, setWorkshopEnabled] = useState(true);
  const [samEnabled, setSamEnabled] = useState(true);
  const [jammerEnabled, setJammerEnabled] = useState(true);
  const [customsEnabled, setCustomsEnabled] = useState(true);
  const [selectedStatePerks, setSelectedStatePerks] = useState<string[]>(['VANGUARD_LOGISTICS']);

  useEffect(() => {
    const unsubAlice = politicalAliceEngine.subscribe((next) => {
      setAliceState({ ...next });
      setBarkMetrics(barkEngine.getSelfOptimizationMetrics());
    });
    const unsubBark = barkEngine.subscribe(() => {
      setBarkMetrics(barkEngine.getSelfOptimizationMetrics());
    });
    const unsubSpatial = spatialDeploymentService.subscribe(() => {
      setSpatialVersion((v) => v + 1);
    });
    return () => {
      unsubAlice();
      unsubBark();
      unsubSpatial();
    };
  }, []);

  const activeStateId =
    selection && 'stateId' in selection && selection.stateId
      ? selection.stateId
      : 'REG_VE_01';

  useEffect(() => {
    const rec = stateSovereigntyService.getState(activeStateId);
    setStateRecord(rec || null);

    const unsubSov = stateSovereigntyService.subscribe((updated) => {
      if (updated.stateId === activeStateId) {
        setStateRecord(updated);
      }
    });
    return () => unsubSov();
  }, [activeStateId]);

  const effectiveClanId =
    userClanId && VENEZUELA_FACTION_REGISTRY[userClanId]
      ? userClanId
      : aliceState.playerClanId;

  const empireMetrics = politicalAliceEngine.getEmpireMetrics(effectiveClanId);

  const selectedProvince = useMemo(() => {
    return provinces.find((p) => p.id === activeStateId) || provinces[0] || null;
  }, [provinces, activeStateId]);

  const selectedRegionSpec = politicalAliceEngine.getRegionById(activeStateId);
  const selectedRegionSov = aliceState.sovereigntyMap[activeStateId];
  const controlState = controlMap[activeStateId];
  const isBufferZone = Boolean(selectedRegionSpec && !selectedRegionSpec.isPlayable);

  const tcp = selectedRegionSov?.controlPoints ?? stateRecord?.tcpCurrent ?? controlState?.currentTcp ?? 10000;
  const tcpMax = selectedRegionSov?.maxControlPoints ?? stateRecord?.tcpMax ?? controlState?.tcpThreshold ?? 10000;
  const tcpPercent = Math.min(100, Math.round((tcp / Math.max(1, tcpMax)) * 100));

  const deJureClan = selectedRegionSov?.ownerClanId
    ? VENEZUELA_FACTION_REGISTRY[selectedRegionSov.ownerClanId]
    : null;
  const deFactoClan = selectedRegionSov?.controllerClanId
    ? VENEZUELA_FACTION_REGISTRY[selectedRegionSov.controllerClanId]
    : null;
  const isController = selectedRegionSov?.controllerClanId === effectiveClanId;
  const isDeFactoOccupation =
    selectedRegionSov?.controllerClanId !== selectedRegionSov?.ownerClanId;

  const adjacencyCheck = politicalAliceEngine.findOriginAdjacentRegion(activeStateId, effectiveClanId);
  const provincialStrata = politicalAliceEngine.getProvincialStrata(activeStateId);

  const activeMunicipalityId =
    selection && 'municipalityId' in selection && selection.municipalityId
      ? selection.municipalityId
      : activeStateId === 'REG_VE_02'
      ? 'MUN_ZULIA_CABIMAS'
      : null;

  const municipalityMeta = activeMunicipalityId
    ? getZuliaMunicipalityMeta(activeMunicipalityId)
    : undefined;

  const municipalMicroGrid = useMemo(() => {
    void spatialVersion;
    const targetMunId = activeMunicipalityId || 'MUN_ZULIA_CABIMAS';
    return spatialDeploymentService.getOrCreateMunicipalGrid(
      targetMunId,
      activeStateId,
      municipalityMeta?.centerLngLat || [-71.4539, 10.3994],
      selectedRegionSov?.controllerClanId ?? effectiveClanId
    );
  }, [
    spatialVersion,
    activeMunicipalityId,
    activeStateId,
    municipalityMeta?.centerLngLat,
    selectedRegionSov?.controllerClanId,
    effectiveClanId,
  ]);

  const municipalControlPercent = useMemo(() => {
    const ratio = municipalMicroGrid.sovereigntyRatioByClan[effectiveClanId] ?? 0;
    return Math.round(ratio * 100);
  }, [municipalMicroGrid.sovereigntyRatioByClan, effectiveClanId]);

  const cellAssignment = useMemo(() => {
    void spatialVersion;
    if (selection?.scale === 'cell') {
      return spatialDeploymentService.getSpatialAssignment(selection.lngLat);
    }
    return null;
  }, [selection, spatialVersion]);

  // Cálculos nacionales agregados (Escala País)
  const nationalGdpPerHour = useMemo(() => {
    return CANONICAL_VENEZUELA_REGIONS.filter((r) => r.isPlayable).reduce((sum, r) => {
      const rec = stateSovereigntyService.getState(r.id);
      return sum + (rec?.gdpWarCreditsPerHour ?? r.baseHourlyYield * 10);
    }, 0);
  }, [aliceState.cycleCount]);

  // Handlers de Operaciones
  const handleExecutePoliticalSiege = async () => {
    audioManager.playDeployHorn();
    if (onDeclareAttack) {
      const attackRes = await onDeclareAttack(activeStateId);
      if (attackRes && typeof attackRes === 'object') {
        setStatusFeedback({
          text: attackRes.message || attackRes.error || 'Operación ejecutada.',
          isError: !attackRes.success,
        });
      }
      return;
    }
    const res = politicalAliceEngine.executePoliticalSiegeOperation(activeStateId);
    setStatusFeedback({ text: res.message, isError: !res.success });
  };

  const handleReinforceRegion = () => {
    audioManager.playComboAction(5);
    const res = politicalAliceEngine.reinforceAndConsolidateRegion(activeStateId);
    setStatusFeedback({ text: res.message, isError: !res.success });
    if (res.success) {
      barkEngine.triggerBark({
        commanderId: 'stella',
        triggerContext: 'region_claimed',
        unitName: selectedProvince?.name || activeStateId,
        bondingLevel: 5,
      });
    }
  };

  const handleToggleEdict = (edictId: PoliticalEdictId, edictName: string) => {
    audioManager.playSFX('button_click');
    const res = politicalAliceEngine.togglePoliticalEdict(edictId);
    setStatusFeedback({ text: res.message, isError: !res.success });
    if (res.success && res.enacted) {
      barkEngine.triggerBark({
        commanderId: 'stella',
        triggerContext: 'edict_enacted',
        unitName: edictName,
        bondingLevel: 5,
      });
    }
  };

  const handleAdjustToll = (chokeId: 'CHK-MARACAIBO' | 'CHK-PARIA', nextVal: number) => {
    audioManager.playHoverTick();
    const res = politicalAliceEngine.setChokepointToll(chokeId, nextVal);
    setStatusFeedback({ text: res.message, isError: false });
    barkEngine.triggerBark({
      commanderId: 'stella',
      triggerContext: 'chokepoint_toll',
      unitName: chokeId,
      bondingLevel: 5,
    });
  };

  const handleAdvanceEconomyCycle = () => {
    audioManager.playComboAction(7);
    const res = politicalAliceEngine.advancePoliticalEconomyCycle();
    setStatusFeedback({ text: res.summary, isError: res.isEnergyStarved });
    if (res.isEnergyStarved || empireMetrics.upkeepBreakdown.excessRegions > 0) {
      barkEngine.triggerBark({
        commanderId: 'stella',
        triggerContext: 'overexpansion_warning',
        bondingLevel: 5,
      });
    } else if (empireMetrics.controlsNationalCapital) {
      barkEngine.triggerBark({
        commanderId: 'stella',
        triggerContext: 'capital_hegemony',
        bondingLevel: 5,
      });
    }
  };

  const factionMeta = FACTION_META[stateRecord?.controllingFactionId || 'blue_moon'] || {
    bg: '#1D4ED8',
    border: '#3B82F6',
    name: 'Blue Moon',
  };

  // Título contextual según escala
  const scaleTitle = useMemo(() => {
    if (!selection) return 'Teatro Venezuela';
    if (selection.scale === 'country') {
      return stateRecord?.customCountryName || selection.countryName || 'República de Venezuela';
    }
    if (selection.scale === 'state') {
      return selectedProvince?.name || stateRecord?.customStateName || selection.stateId;
    }
    if (selection.scale === 'municipality') {
      return municipalityMeta?.name || selection.municipalityName || selection.municipalityId;
    }
    return `SECTOR [${selection.sector.join(',')}] • CELDA [${selection.cell.join(',')}]`;
  }, [selection, stateRecord, selectedProvince, municipalityMeta]);

  const scaleSubtitle = useMemo(() => {
    if (!selection) return 'C4ISR';
    if (selection.scale === 'country') return 'METAMANDO POLÍTICO • PROJECT ALICE • TEATRO VENEZUELA (24 ESTADOS + 7 BUFFERS)';
    if (selection.scale === 'state') return `${activeStateId} • ${stateRecord?.customCountryName || 'Venezuela'}`;
    if (selection.scale === 'municipality') return `${selection.municipalityId} • Cabecera: ${municipalityMeta?.cityName || selection.cityName || 'N/A'}`;
    return `LOD 3 • MICROJUEGO TÁCTICO • ZOOM ${currentZoom.toFixed(1)}x`;
  }, [selection, activeStateId, stateRecord, municipalityMeta, currentZoom]);

  // Cuando está cerrado, mostrar píldora compacta para reabrir sin estorbar
  if (!isOpen || !selection) {
    return (
      <button
        type="button"
        data-testid="reopen-inspector-btn"
        onMouseEnter={() => audioManager.playHoverTick()}
        onClick={() => {
          audioManager.playSFX('button_click');
          onOpen();
        }}
        className="fixed top-14 right-3 z-30 px-3 py-1.5 bg-[#0E100C]/92 hover:bg-[#1E2019] text-[#F2E8D5] border border-[#7B8A4A] rounded-[8px_2px_8px_2px] shadow-[3px_3px_0px_#0A0B08] font-mono font-black text-[11px] uppercase flex items-center gap-1.5 cursor-pointer backdrop-blur-md"
      >
        <Crosshair className="w-3.5 h-3.5 text-amber-400" />
        <span>INSPECTOR: {scaleTitle}</span>
      </button>
    );
  }

  const authCheck = stateSovereigntyService.canUnlockStateControl(userContext, activeStateId);

  return (
    <>
      <AnimatePresence>
        <motion.aside
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 18 }}
          transition={{ duration: 0.2 }}
          aria-label="Inspector Derecho Unificado de 4 Escalas"
          data-testid="unified-region-inspector"
          data-scale={selection.scale}
          className="fixed top-14 right-3 bottom-16 z-30 w-[356px] sm:w-[376px] bg-[#0E100C]/94 backdrop-blur-md border border-[#46521F] rounded-[12px_4px_12px_4px] shadow-[6px_6px_0px_#0A0B08] flex flex-col overflow-hidden text-[#F2E8D5] select-none"
        >
          {/* 1. CABECERA CONTEXTUAL + HERÁLDICA */}
          <div
            className="px-3 py-2 border-b border-[#0A0B08] flex items-start justify-between gap-2 shrink-0"
            style={{
              background: `linear-gradient(135deg, ${factionMeta.bg}CC 0%, #161712 85%)`,
            }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="px-1.5 py-0.5 rounded bg-[#0A0B08]/80 border border-amber-400/50 text-[9px] font-mono font-black text-amber-300 uppercase">
                  {SCALE_LABELS[selection.scale]}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono font-bold text-[#00FF66]">
                  {userClanTag}
                </span>
              </div>
              <h2 className="font-display font-black text-sm uppercase tracking-wide text-white truncate">
                {scaleTitle}
              </h2>
              <p className="text-[9px] font-mono text-[#F2E8D5]/80 truncate">
                {scaleSubtitle}
              </p>
            </div>

            <button
              type="button"
              data-testid="close-inspector-btn"
              onClick={() => {
                audioManager.playCue('ui_cancel_rollback');
                onClose();
              }}
              className="p-1 bg-[#161712]/90 hover:bg-[#873612] text-[#F2E8D5] border border-[#0A0B08] rounded cursor-pointer shrink-0"
              title="Colapsar Inspector"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 2. BREADCRUMB NAVEGABLE DE 4 ESCALAS (PAÍS > ESTADO > MUNICIPIO > CELDA) */}
          <nav
            aria-label="Navegación de Escalas Geográficas"
            className="px-2.5 py-1.5 bg-[#161712] border-b border-[#2E3323] flex items-center gap-1 overflow-x-auto text-[10px] font-mono shrink-0"
          >
            <button
              type="button"
              data-testid="breadcrumb-country"
              onClick={() => {
                audioManager.playHoverTick();
                onSelectTarget({
                  scale: 'country',
                  countryId: 'COUNTRY_VEN',
                  countryName: stateRecord?.customCountryName || 'República de Venezuela',
                });
                onJumpToScaleZoom?.('country', [-66.5, 8.2], 5.5);
              }}
              className={`px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer shrink-0 ${
                selection.scale === 'country'
                  ? 'bg-[#46521F] text-amber-300 font-black'
                  : 'text-[#A9B87A] hover:text-white'
              }`}
            >
              <Globe className="w-3 h-3" />
              <span>País</span>
            </button>

            <ChevronRight className="w-3 h-3 text-[#7B8A4A] shrink-0" />

            <button
              type="button"
              data-testid="breadcrumb-state"
              onClick={() => {
                audioManager.playHoverTick();
                onSelectTarget({
                  scale: 'state',
                  countryId: 'COUNTRY_VEN',
                  stateId: activeStateId,
                });
                onJumpToScaleZoom?.('state');
              }}
              className={`px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer shrink-0 ${
                selection.scale === 'state'
                  ? 'bg-[#46521F] text-amber-300 font-black'
                  : 'text-[#A9B87A] hover:text-white'
              }`}
            >
              <Shield className="w-3 h-3" />
              <span>{selectedProvince?.name?.split(' - ')[0] || 'Estado'}</span>
            </button>

            <ChevronRight className="w-3 h-3 text-[#7B8A4A] shrink-0" />

            <button
              type="button"
              data-testid="breadcrumb-municipality"
              onClick={() => {
                audioManager.playHoverTick();
                const fallbackMun = municipalityMeta || ZULIA_MUNICIPALITIES_CATALOG[2]; // Cabimas
                onSelectTarget({
                  scale: 'municipality',
                  countryId: 'COUNTRY_VEN',
                  stateId: fallbackMun.stateId,
                  municipalityId: fallbackMun.id,
                  municipalityName: fallbackMun.name,
                  cityName: fallbackMun.cityName,
                });
                onJumpToScaleZoom?.('municipality', fallbackMun.centerLngLat, 10.5);
              }}
              className={`px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer shrink-0 ${
                selection.scale === 'municipality'
                  ? 'bg-[#46521F] text-amber-300 font-black'
                  : 'text-[#A9B87A] hover:text-white'
              }`}
            >
              <MapPin className="w-3 h-3" />
              <span>{municipalityMeta?.name || 'Cabimas'}</span>
            </button>

            <ChevronRight className="w-3 h-3 text-[#7B8A4A] shrink-0" />

            <button
              type="button"
              data-testid="breadcrumb-cell"
              onClick={() => {
                audioManager.playHoverTick();
                const coord = selection.scale === 'cell' ? selection.lngLat : ([-71.455, 10.395] as [number, number]);
                const assignment = spatialDeploymentService.getSpatialAssignment(coord);
                onSelectTarget({
                  scale: 'cell',
                  countryId: 'COUNTRY_VEN',
                  stateId: 'REG_VE_02',
                  municipalityId: municipalityMeta?.id || 'MUN_ZULIA_CABIMAS',
                  sector: assignment.sector,
                  cell: assignment.cell,
                  lngLat: coord,
                });
                onJumpToScaleZoom?.('cell', coord, 15.2);
              }}
              className={`px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer shrink-0 ${
                selection.scale === 'cell'
                  ? 'bg-[#E65100] text-black font-black'
                  : 'text-[#A9B87A] hover:text-white'
              }`}
            >
              <Crosshair className="w-3 h-3" />
              <span>
                {selection.scale === 'cell' ? `[${selection.cell.join(',')}]` : 'Celda'}
              </span>
            </button>
          </nav>

          {/* 3. BARRA DE 4 PESTAÑAS MINIMALISTAS */}
          <div className="grid grid-cols-4 bg-[#181914] border-b border-[#2E3323] p-1 gap-1 text-[9px] font-mono font-black uppercase shrink-0">
            <button
              type="button"
              data-testid="inspector-tab-summary"
              onClick={() => {
                audioManager.playHoverTick();
                setActiveTab('summary');
              }}
              className={`py-1.5 rounded transition-colors cursor-pointer ${
                activeTab === 'summary'
                  ? 'bg-[#E65100] text-black'
                  : 'text-[#A9B87A] hover:text-white hover:bg-[#22231C]'
              }`}
            >
              RESUMEN
            </button>
            <button
              type="button"
              data-testid="inspector-tab-government"
              onClick={() => {
                audioManager.playHoverTick();
                setActiveTab('government');
              }}
              className={`py-1.5 rounded transition-colors cursor-pointer ${
                activeTab === 'government'
                  ? 'bg-[#E65100] text-black'
                  : 'text-[#A9B87A] hover:text-white hover:bg-[#22231C]'
              }`}
            >
              GOBIERNO
            </button>
            <button
              type="button"
              data-testid="inspector-tab-economy"
              onClick={() => {
                audioManager.playHoverTick();
                setActiveTab('economy');
              }}
              className={`py-1.5 rounded transition-colors cursor-pointer ${
                activeTab === 'economy'
                  ? 'bg-[#E65100] text-black'
                  : 'text-[#A9B87A] hover:text-white hover:bg-[#22231C]'
              }`}
            >
              ECONOMÍA
            </button>
            <button
              type="button"
              data-testid="inspector-tab-operations"
              onClick={() => {
                audioManager.playHoverTick();
                setActiveTab('operations');
              }}
              className={`py-1.5 rounded transition-colors cursor-pointer ${
                activeTab === 'operations'
                  ? 'bg-[#E65100] text-black'
                  : 'text-[#A9B87A] hover:text-white hover:bg-[#22231C]'
              }`}
            >
              OPERACIONES
            </button>
          </div>

          {/* Feedback operativo */}
          {statusFeedback && (
            <div
              className={`mx-2.5 mt-2 p-2 rounded border text-[10px] font-mono flex items-center justify-between gap-2 shrink-0 ${
                statusFeedback.isError
                  ? 'bg-red-950/85 border-red-500/60 text-red-200'
                  : 'bg-emerald-950/85 border-emerald-500/60 text-emerald-200'
              }`}
            >
              <span className="leading-tight">{statusFeedback.text}</span>
              <button
                type="button"
                onClick={() => setStatusFeedback(null)}
                className="font-black text-xs cursor-pointer"
              >
                ×
              </button>
            </div>
          )}

          {/* 4. CONTENIDO DINÁMICO POR ESCALA Y PESTAÑA */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 font-mono text-[11px] custom-scrollbar">
            {/* =============================================================== */}
            {/* ESCALA 1: PAÍS (COUNTRY)                                        */}
            {/* =============================================================== */}
            {selection.scale === 'country' && (
              <>
                {activeTab === 'summary' && (
                  <div className="space-y-2.5">
                    <div className="p-2.5 bg-[#1B1D17] border border-[#46521F] rounded-[8px_2px_8px_2px] space-y-2">
                      <div className="flex items-center justify-between text-[10px] text-[#A9B87A]">
                        <span>ESTADO DE SOBERANÍA NACIONAL</span>
                        <span className="text-[#00FF66] font-bold">FASE 1 ACTIVA</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-[#141510] rounded border border-[#2E3323]">
                          <span className="text-[9px] text-[#A9B87A] block">PIB DE GUERRA TOTAL</span>
                          <span className="text-xs font-black text-amber-400 tabular-nums">
                            +{nationalGdpPerHour.toLocaleString()} $G/hr
                          </span>
                        </div>
                        <div className="p-2 bg-[#141510] rounded border border-[#2E3323]">
                          <span className="text-[9px] text-[#A9B87A] block">ESTADOS CONTROLADOS</span>
                          <span className="text-xs font-black text-emerald-400 tabular-nums">
                            {empireMetrics.controlledRegions.length} / 24
                          </span>
                        </div>
                      </div>
                      <div className="p-2 bg-yellow-950/30 border border-yellow-500/40 rounded text-[10px] text-amber-200 flex items-center gap-1.5">
                        <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                        <span>
                          Capital (REG_VE_01 Caracas): <strong>+5%</strong> buff regional, +15% EC, +10% forja.
                        </span>
                      </div>
                    </div>

                    <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-1.5">
                      <div className="text-[10px] font-bold text-amber-300 uppercase">
                        Píldoras de Arquitectura (3 Capas)
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[8px] font-bold">
                        <div className="px-1.5 py-1 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-center">
                          L1: POLÍTICA ON
                        </div>
                        <div className="px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-400 text-center">
                          L2: BATALLA OFF
                        </div>
                        <div className="px-1.5 py-1 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300 text-center">
                          L3: STELLA ({barkMetrics.adaptiveScorePercent}%)
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'government' && (
                  <div className="space-y-2.5">
                    {/* Aduanas de Estrechos */}
                    <div className="p-2.5 bg-[#1B1D17] border border-[#46521F] rounded space-y-2">
                      <div className="text-[10px] font-black text-cyan-300 uppercase flex items-center gap-1.5">
                        <Anchor className="w-3.5 h-3.5" />
                        <span>Aduanas de Estrechos Estratégicos (0% - 10%)</span>
                      </div>

                      <div className="p-2 bg-[#141510] rounded border border-[#2E3323] space-y-1 text-[10px]">
                        <div className="flex justify-between">
                          <span>CHK-MARACAIBO (Zulia REG_VE_02)</span>
                          <span className="text-amber-300 font-black">
                            {aliceState.chokepointTolls['CHK-MARACAIBO'].toFixed(1)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={aliceState.chokepointTolls['CHK-MARACAIBO']}
                          onChange={(e) => handleAdjustToll('CHK-MARACAIBO', parseFloat(e.target.value))}
                          className="w-full accent-amber-400 cursor-pointer"
                        />
                      </div>

                      <div className="p-2 bg-[#141510] rounded border border-[#2E3323] space-y-1 text-[10px]">
                        <div className="flex justify-between">
                          <span>CHK-PARIA (Sucre REG_VE_13)</span>
                          <span className="text-amber-300 font-black">
                            {aliceState.chokepointTolls['CHK-PARIA'].toFixed(1)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={aliceState.chokepointTolls['CHK-PARIA']}
                          onChange={(e) => handleAdjustToll('CHK-PARIA', parseFloat(e.target.value))}
                          className="w-full accent-amber-400 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Edictos Nacionales */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold text-amber-300 uppercase flex items-center gap-1">
                        <Scale className="w-3.5 h-3.5" />
                        <span>Edictos Nacionales</span>
                      </div>
                      {POLITICAL_EDICTS_CATALOG.map((edict) => {
                        const isActive = aliceState.activeEdictIds.includes(edict.id);
                        return (
                          <div
                            key={edict.id}
                            className={`p-2 rounded border space-y-1 text-[10px] ${
                              isActive
                                ? 'bg-[#25271F] border-amber-400'
                                : 'bg-[#181914] border-[#2E3323]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-[#F2E8D5]">{edict.name}</span>
                              <span className="text-[9px] text-amber-300">
                                {isActive ? 'ACTIVO' : `${edict.costEc} EC`}
                              </span>
                            </div>
                            <p className="text-[9px] text-[#A9B87A] font-sans leading-snug">
                              {edict.description}
                            </p>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => handleToggleEdict(edict.id, edict.name)}
                                className={`px-2 py-0.5 rounded text-[9px] font-black uppercase cursor-pointer ${
                                  isActive
                                    ? 'bg-red-900/80 text-white'
                                    : 'bg-[#E65100] hover:bg-amber-400 text-black'
                                }`}
                              >
                                {isActive ? 'Derogar' : 'Promulgar'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="p-2 rounded bg-[#181914] border border-amber-500/40 text-[9px]">
                      Sujeto Bark Activo: <strong className="text-amber-300">Mayor Stella (stella)</strong> • {barkMetrics.adaptiveScorePercent}% eficacia
                    </div>
                  </div>
                )}

                {activeTab === 'economy' && (
                  <div className="space-y-2.5">
                    <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-black text-emerald-400 uppercase">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>Balance Imperial (Cap {empireMetrics.upkeepBreakdown.imperialCap} Regiones)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">Extracción RGO Bruta:</span>
                        <span className="text-emerald-400 font-bold">+{empireMetrics.hourlyEcGrossYield} EC/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">Peajes Estrechos:</span>
                        <span className="text-cyan-300 font-bold">+{empireMetrics.hourlyTollRevenueEc} EC/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">Upkeep + Edictos:</span>
                        <span className="text-red-400 font-bold">
                          -{Math.round(empireMetrics.upkeepBreakdown.totalUpkeepEc + empireMetrics.edictUpkeepEc)} EC/h
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-[#2E3323] pt-1 font-black">
                        <span>Balance Neto:</span>
                        <span className={empireMetrics.netEcPerCycle >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {empireMetrics.netEcPerCycle >= 0 ? '+' : ''}{empireMetrics.netEcPerCycle} EC
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleAdvanceEconomyCycle}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-display font-black text-xs uppercase rounded border border-[#0A0B08] cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>EJECUTAR CICLO (#{aliceState.cycleCount + 1})</span>
                    </button>
                  </div>
                )}

                {activeTab === 'operations' && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-amber-300 font-bold uppercase">
                      Estados Soberanos y Buffers Fronterizos (31)
                    </div>
                    <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                      {CANONICAL_VENEZUELA_REGIONS.map((reg) => (
                        <button
                          key={reg.id}
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            onSelectTarget({
                              scale: 'state',
                              countryId: 'COUNTRY_VEN',
                              stateId: reg.id,
                            });
                          }}
                          className="w-full p-2 rounded bg-[#181914] hover:bg-[#25271F] border border-[#2E3323] flex items-center justify-between text-left cursor-pointer"
                        >
                          <span className="truncate font-bold">{reg.name}</span>
                          <span className="text-[9px] text-amber-300 shrink-0">{reg.id}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* =============================================================== */}
            {/* ESCALA 2: ESTADO (STATE)                                        */}
            {/* =============================================================== */}
            {selection.scale === 'state' && (
              <>
                {activeTab === 'summary' && (
                  <div className="space-y-2.5">
                    {isBufferZone && (
                      <div className="p-2 bg-red-950/70 border border-red-500/60 rounded text-[10px] text-red-200 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                        <span>
                          <strong>ZONA BUFFER INTERNACIONAL:</strong> SECTOR FUERA DEL TEATRO OPERACIONAL DE FASE 1 (ACTIVO: REPÚBLICA DE VENEZUELA).
                        </span>
                      </div>
                    )}

                    {/* Soberanía Dual De Jure / De Facto */}
                    <div className="grid grid-cols-2 gap-2 p-2 bg-[#181914] rounded border border-[#2E3323] text-[10px]">
                      <div>
                        <span className="text-[#A9B87A] block text-[8px]">PROPIETARIO DE JURE</span>
                        <span className="font-bold text-amber-300">
                          {deJureClan ? `${deJureClan.emblem} ${deJureClan.name}` : isBufferZone ? 'Frontera Exterior' : 'Neutral'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#A9B87A] block text-[8px]">CONTROLADOR DE FACTO</span>
                        <span className="font-bold text-emerald-400">
                          {deFactoClan ? `${deFactoClan.emblem} ${deFactoClan.name}` : isBufferZone ? 'Bloqueado (Fase 1)' : 'Neutral'}
                        </span>
                      </div>
                    </div>

                    {isDeFactoOccupation && !isBufferZone && (
                      <div className="p-2 bg-amber-950/50 border border-amber-500/50 rounded text-[10px] text-amber-200">
                        ⏳ Ocupación Militar De Facto activa (ventana 24h).
                      </div>
                    )}

                    {/* Métricas TCP y PIB DE GUERRA */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-[#1B1D17] border border-[#2E3323] rounded">
                        <span className="text-[9px] text-[#A9B87A] flex items-center gap-1">
                          <Shield className="w-3 h-3 text-sky-400" /> CONTROL (TCP)
                        </span>
                        <span className="text-xs font-black text-sky-300 tabular-nums">
                          {tcp.toLocaleString()} / {tcpMax.toLocaleString()}
                        </span>
                        <div className="w-full bg-[#0A0B08] h-1.5 mt-1 rounded overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              tcpPercent < 50 ? 'bg-red-500' : tcpPercent < 80 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${tcpPercent}%` }}
                          />
                        </div>
                      </div>

                      <div className="p-2 bg-[#1B1D17] border border-[#2E3323] rounded">
                        <span className="text-[9px] text-[#A9B87A] flex items-center gap-1">
                          <Coins className="w-3 h-3 text-amber-400" /> PIB DE GUERRA
                        </span>
                        <span className="text-xs font-black text-amber-400 tabular-nums">
                          +{(stateRecord?.gdpWarCreditsPerHour ?? 6400).toLocaleString()} $G/hr
                        </span>
                        <span className="text-[9px] text-[#A9B87A] block">
                          Búnker Nv.{selectedRegionSov?.bunkerLevel ?? stateRecord?.defenseLevel ?? 1}/5
                        </span>
                      </div>
                    </div>

                    {/* RENDIMIENTO DE RECURSOS */}
                    <div className="p-2 bg-[#181914] border border-[#46521F]/70 rounded space-y-1.5">
                      <span className="text-[9px] text-[#A9B87A] uppercase font-bold flex items-center gap-1">
                        <Zap className="w-3 h-3 text-emerald-400" /> RENDIMIENTO DE RECURSOS / CICLO
                      </span>
                      <div className="grid grid-cols-4 gap-1 text-[10px] text-center">
                        <div className="p-1 bg-[#22231C] rounded">
                          <Fuel className="w-3 h-3 text-amber-400 mx-auto" />
                          <span className="font-bold block mt-0.5">+{stateRecord?.resources.oil ?? 120}</span>
                          <span className="text-[8px] text-[#A9B87A]">Crudo</span>
                        </div>
                        <div className="p-1 bg-[#22231C] rounded">
                          <Hammer className="w-3 h-3 text-stone-300 mx-auto" />
                          <span className="font-bold block mt-0.5">+{stateRecord?.resources.steel ?? 250}</span>
                          <span className="text-[8px] text-[#A9B87A]">Acero</span>
                        </div>
                        <div className="p-1 bg-[#22231C] rounded">
                          <Gem className="w-3 h-3 text-cyan-400 mx-auto" />
                          <span className="font-bold block mt-0.5">+{stateRecord?.resources.rareEarth ?? 30}</span>
                          <span className="text-[8px] text-[#A9B87A]">Raros</span>
                        </div>
                        <div className="p-1 bg-[#22231C] rounded">
                          <Cpu className="w-3 h-3 text-purple-400 mx-auto" />
                          <span className="font-bold block mt-0.5">+{stateRecord?.resources.composites ?? 55}</span>
                          <span className="text-[8px] text-[#A9B87A]">Blindaje</span>
                        </div>
                      </div>
                    </div>

                    {/* Botón Operativo Principal */}
                    {!isController ? (
                      <button
                        type="button"
                        onClick={handleExecutePoliticalSiege}
                        className={`w-full py-2 px-3 font-display font-black text-xs uppercase rounded border border-[#0A0B08] shadow-[3px_3px_0px_#0A0B08] cursor-pointer flex items-center justify-center gap-2 ${
                          isBufferZone
                            ? 'bg-slate-800 text-red-300 border-red-500/50'
                            : adjacencyCheck.valid
                            ? 'bg-[#E65100] hover:bg-amber-400 text-black'
                            : 'bg-[#2B2C24] text-amber-300'
                        }`}
                      >
                        <Swords className="w-4 h-4" />
                        <span>
                          {isBufferZone
                            ? 'ZONA BUFFER BLOQUEADA (FASE 1)'
                            : 'EJECUTAR PRESIÓN DE ASEDIO (-TCP)'}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleReinforceRegion}
                        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-black font-display font-black text-xs uppercase rounded border border-[#0A0B08] cursor-pointer flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {isDeFactoOccupation
                            ? 'CONSOLIDAR SOBERANÍA DE JURE (+2,500 TCP)'
                            : 'REFORZAR SECTOR & BÚNKER (+2,500 TCP)'}
                        </span>
                      </button>
                    )}

                    {/* Desbloquear Panel de Control del Estado */}
                    <button
                      type="button"
                      onClick={() => {
                        audioManager.playCue(authCheck.allowed ? 'tactical_confirm_click' : 'defeat_sting');
                        setIsSovereignDeckOpen(true);
                      }}
                      className={`w-full py-2 px-3 rounded border border-[#0A0B08] flex items-center justify-center gap-2 font-display font-black text-[11px] uppercase cursor-pointer ${
                        authCheck.allowed
                          ? 'bg-[#46521F] hover:bg-[#586827] text-amber-300'
                          : 'bg-[#1C1E17] hover:bg-[#2B2C24] text-amber-300/80'
                      }`}
                    >
                      {authCheck.allowed ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-red-400" />}
                      <span>DESBLOQUEAR PANEL DE CONTROL</span>
                    </button>
                  </div>
                )}

                {activeTab === 'government' && (
                  <div className="space-y-2.5">
                    <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-2">
                      <div className="flex items-center justify-between text-[10px] font-bold text-amber-300">
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" /> ESTRATOS POPs PROVINCIALES
                        </span>
                        <span className={provincialStrata.secessionRiskPercent > 60 ? 'text-red-400' : 'text-emerald-400'}>
                          Secesión: {provincialStrata.secessionRiskPercent}%
                        </span>
                      </div>
                      <div className="space-y-1 text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-[#A9B87A]">Lealtad Militarista:</span>
                          <span className="font-bold">{provincialStrata.militaristsLoyalty}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#A9B87A]">Satisfacción Burocrática:</span>
                          <span className="font-bold">{provincialStrata.bureaucratsSatisfaction}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#A9B87A]">Malestar Obrero Petro:</span>
                          <span className="font-bold">{provincialStrata.petroLaborUnrest}%</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsSovereignDeckOpen(true)}
                      className="w-full py-2 px-3 bg-[#E65100] hover:bg-amber-400 text-black font-display font-black text-xs uppercase rounded border border-[#0A0B08] cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>DESBLOQUEAR PANEL DE CONTROL</span>
                    </button>

                    {/* 3 Ramas de Perks Estatales (>60% = 1, >85% = 2, máx. 3 globales) y Sobrecarga */}
                    <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-2 text-[10px]">
                      <div className="flex items-center justify-between font-bold text-[#00FF66]">
                        <span>PERKS ESTATALES (MÁX. 3 GLOBALES)</span>
                        <span className="text-amber-300">{selectedStatePerks.length}/3</span>
                      </div>
                      <div className="text-[9px] font-mono text-[#A9B87A]">
                        Sobrecarga Administrativa:{' '}
                        <strong className="text-sky-300">
                          {calculateAdministrativeOverloadFuelMultiplier({
                            controlledStatesCount: empireMetrics.controlledRegions.length,
                            hasVanguardLogisticsInBorderState: selectedStatePerks.includes('VANGUARD_LOGISTICS'),
                          }).netFuelMultiplier}x CB/h
                        </strong>{' '}
                        (+15% por estado &gt; 2)
                      </div>
                      <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto pr-1">
                        {Object.values(STATE_PERKS_CATALOG).map((perk) => {
                          const active = selectedStatePerks.includes(perk.id);
                          return (
                            <button
                              key={perk.id}
                              type="button"
                              onClick={() => {
                                audioManager.playHoverTick();
                                setSelectedStatePerks((prev) =>
                                  prev.includes(perk.id)
                                    ? prev.filter((id) => id !== perk.id)
                                    : prev.length < 3
                                    ? [...prev, perk.id]
                                    : prev
                                );
                              }}
                              className={`p-1.5 rounded border text-left cursor-pointer ${
                                active
                                  ? 'bg-[#22331E] border-[#00FF66] text-[#F2E8D5]'
                                  : 'bg-[#141510] border-[#2E3323] text-[#A9B87A]'
                              }`}
                            >
                              <div className="flex justify-between font-bold text-[9px]">
                                <span>[{perk.branch}] {perk.name}</span>
                                <span>{active ? 'ACTIVO' : 'ACTIVAR'}</span>
                              </div>
                              <div className="text-[8px] opacity-80 truncate">{perk.description}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'economy' && (
                  <div className="space-y-2.5">
                    <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-1.5 text-[10px]">
                      <div className="font-bold text-amber-300 uppercase">
                        Cadena RGO & Suministros
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">RGO Primario:</span>
                        <span className="font-bold uppercase text-amber-300">
                          {selectedRegionSpec?.primaryCommodity.replace(/_/g, ' ') || 'Industrial'} (T{selectedRegionSpec?.resourceTier || 3})
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">Rendimiento Base:</span>
                        <span className="text-emerald-400 font-bold">+{selectedRegionSpec?.baseHourlyYield || 400} EC/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">Upkeep Regional:</span>
                        <span className="text-red-400 font-bold">-{selectedRegionSpec?.baseEnergyUpkeepEc || 150} EC/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">RENDIMIENTO DE RECURSOS:</span>
                        <span className="text-sky-300 font-bold">
                          +{stateRecord?.resources.oil ?? 100} Crudo / +{stateRecord?.resources.steel ?? 150} Acero
                        </span>
                      </div>
                    </div>

                    {activeStateId === 'REG_VE_02' && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-amber-300 font-bold uppercase">
                          Municipios de Zulia ({ZULIA_MUNICIPALITIES_CATALOG.length})
                        </div>
                        <div className="grid grid-cols-2 gap-1 max-h-44 overflow-y-auto pr-1">
                          {ZULIA_MUNICIPALITIES_CATALOG.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                onSelectTarget({
                                  scale: 'municipality',
                                  countryId: 'COUNTRY_VEN',
                                  stateId: 'REG_VE_02',
                                  municipalityId: m.id,
                                  municipalityName: m.name,
                                  cityName: m.cityName,
                                });
                                onJumpToScaleZoom?.('municipality', m.centerLngLat, 10.5);
                              }}
                              className="p-1.5 rounded bg-[#181914] hover:bg-[#25271F] border border-[#2E3323] text-left text-[9px] truncate cursor-pointer"
                            >
                              {m.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'operations' && (
                  <div className="space-y-2.5">
                    {!isController ? (
                      <button
                        type="button"
                        onClick={handleExecutePoliticalSiege}
                        className="w-full py-2.5 px-3 bg-[#E65100] hover:bg-amber-400 text-black font-display font-black text-xs uppercase rounded border border-[#0A0B08] cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Swords className="w-4 h-4" />
                        <span>
                          {isBufferZone
                            ? 'ZONA BUFFER BLOQUEADA (FASE 1)'
                            : 'EJECUTAR PRESIÓN DE ASEDIO (-TCP)'}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleReinforceRegion}
                        className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-black font-display font-black text-xs uppercase rounded border border-[#0A0B08] cursor-pointer flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>REFORZAR SECTOR & BÚNKER (+2,500 TCP)</span>
                      </button>
                    )}

                    {/* Selector de Nivel de Búnker 1-5 */}
                    <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-2">
                      <span className="text-[10px] font-bold text-[#A9B87A] uppercase">
                        Fortificación IA de Guarnición (Nv.1 - Nv.5)
                      </span>
                      <div className="grid grid-cols-5 gap-1">
                        {([1, 2, 3, 4, 5] as const).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setSelectedGarrisonLevel(lvl)}
                            className={`py-1.5 rounded border font-black text-[10px] cursor-pointer ${
                              selectedGarrisonLevel === lvl
                                ? 'bg-amber-400 text-black border-[#0A0B08]'
                                : 'bg-[#141510] text-[#F2E8D5] border-[#2E3323]'
                            }`}
                          >
                            Nv.{lvl}
                          </button>
                        ))}
                      </div>
                      {(() => {
                        const spec = GarrisonAIEngine.getSpec(selectedGarrisonLevel);
                        return (
                          <div className="text-[10px] space-y-1 pt-1">
                            <div className="flex justify-between">
                              <span className="text-[#A9B87A]">Motor:</span>
                              <span className="text-amber-300 font-bold">{spec.name}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#A9B87A]">Upkeep:</span>
                              <span>{spec.baseHourlyUpkeepEc} EC/h</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                audioManager.playAirdropImpact();
                                onRebalanceGarrison?.(selectedGarrisonLevel);
                                handleReinforceRegion();
                              }}
                              className="w-full py-1.5 bg-[#46521F] hover:bg-[#586827] text-amber-300 font-bold uppercase rounded cursor-pointer"
                            >
                              FORTIFICAR GUARNICIÓN
                            </button>
                          </div>
                        );
                      })()}
                    </div>

                    {onOpenFullHangar && (
                      <button
                        type="button"
                        onClick={onOpenFullHangar}
                        className="w-full py-2 bg-[#181914] hover:bg-[#25271F] border border-[#46521F] text-[#F2E8D5] font-bold text-[10px] uppercase rounded flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Layers className="w-3.5 h-3.5 text-sky-400" />
                        <span>ABRIR HANGAR INDUSTRIAL T1-T5</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* =============================================================== */}
            {/* ESCALA 3: MUNICIPIO (MUNICIPALITY)                              */}
            {/* =============================================================== */}
            {selection.scale === 'municipality' && (
              <>
                {activeTab === 'summary' && (
                  <div className="space-y-2.5">
                    <div className="p-2.5 bg-[#1B1D17] border border-[#46521F] rounded space-y-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#A9B87A]">CABECERA MUNICIPAL</span>
                        <span className="text-[#00FF66] font-bold">{municipalityMeta?.cityName || selection.cityName || 'N/A'}</span>
                      </div>
                      <p className="text-[10px] text-[#F2E8D5] font-sans leading-snug">
                        {municipalityMeta?.strategicRole || 'Corredor operacional urbano y red logística del Zulia.'}
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="p-1.5 bg-[#141510] rounded border border-[#2E3323]">
                          <span className="text-[8px] text-[#A9B87A] block">FEUDO ACTIVO</span>
                          <span className="text-[10px] font-bold text-amber-300 truncate block">
                            {municipalityMeta?.activeFiefName || 'Terminal Local'}
                          </span>
                        </div>
                        <div className="p-1.5 bg-[#141510] rounded border border-[#2E3323]">
                          <span className="text-[8px] text-[#A9B87A] block">INGRESO LOCAL</span>
                          <span className="text-[10px] font-bold text-emerald-400 tabular-nums">
                            +{municipalityMeta?.hourlyLocalYieldEc ?? 210} EC/h
                          </span>
                        </div>
                      </div>

                      {/* Malla Municipal 500 Micro-Celdas (100x100m) y Mayoría (>50%) */}
                      <div className="p-2 bg-[#141510] border border-[#2E3323] rounded space-y-1.5">
                        <div className="flex items-center justify-between text-[9px] font-mono">
                          <span className="text-[#A9B87A] uppercase">
                            Malla Micro-Celdas (500 × 100m²)
                          </span>
                          <span
                            className={`font-black ${
                              municipalControlPercent > 50 ? 'text-[#00FF66]' : 'text-amber-300'
                            }`}
                          >
                            {municipalControlPercent}% ({municipalMicroGrid.controllingClanId ? 'SOBERANO >50%' : 'EN DISPUTA'})
                          </span>
                        </div>
                        <div className="w-full h-2 bg-[#0A0B08] rounded overflow-hidden border border-[#2E3323]">
                          <div
                            className="h-full bg-[#00FF66] transition-all duration-300"
                            style={{ width: `${Math.min(100, municipalControlPercent)}%` }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            const center = municipalityMeta?.centerLngLat || ([-71.4539, 10.3994] as [number, number]);
                            const scoutProjection = buildDroneSignalProjection({
                              id: `drone-scout-${Date.now()}`,
                              code: 'recon',
                              clanId: effectiveClanId,
                              coordinates: center,
                              hp: 100,
                            });
                            const res = spatialDeploymentService.evaluateMunicipalSignalTick(
                              municipalMicroGrid.municipalityId,
                              [scoutProjection],
                              10,
                              1.0
                            );
                            setStatusFeedback({
                              text: `Tick 10m ejecutado: +${res.cellsConverted} micro-celdas capturadas por proyección de señal.`,
                              isError: false,
                            });
                          }}
                          className="w-full py-1 bg-[#22251B] hover:bg-[#2E3323] border border-[#46521F] text-[#A9B87A] text-[9px] font-bold uppercase rounded cursor-pointer"
                        >
                          EJECUTAR TICK DE SEÑAL (10 MIN)
                        </button>
                      </div>

                      {/* Cosecha Rápida 1-Clic de Fábricas Privadas (Impuesto Simbiótico) */}
                      <div className="p-2 bg-[#141510] border border-[#46521F] rounded space-y-1.5">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-amber-300 font-black uppercase">
                            Cosecha Rápida Matutina (1 Clic)
                          </span>
                          <span className="text-emerald-400 font-mono">
                            {selectedRegionSov?.controllerClanId === effectiveClanId ? '5-10% ALIADO' : 'HASTA 50% RIVAL'}
                          </span>
                        </div>
                        {harvestReport && (
                          <div className="text-[9px] font-mono text-[#F2E8D5] bg-[#1B1D17] p-1.5 rounded border border-[#2E3323]">
                            Bruto: {harvestReport.grossEc} EC • Impuesto ({harvestReport.ratePercent}%): -{harvestReport.retainedEc} EC •{' '}
                            <strong className="text-[#00FF66]">Neto: +{harvestReport.netEc} EC</strong>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            audioManager.playComboAction(5);
                            const res = fiefBuildingService.harvestPrivateExtractorWithSymbioticTax({
                              municipalityId: municipalMicroGrid.municipalityId,
                              extractorOwnerClanId: effectiveClanId,
                              municipalityControllingClanId: selectedRegionSov?.controllerClanId ?? effectiveClanId,
                              exclusiveResourceNode: 'oil_energy',
                              grossYieldEc: municipalityMeta?.hourlyLocalYieldEc ?? 240,
                            });
                            setHarvestReport({
                              grossEc: res.settlement.grossYieldEc,
                              retainedEc: res.settlement.retainedTaxEc,
                              netEc: res.settlement.netExtractorYieldEc,
                              ratePercent: res.settlement.appliedTaxRatePercent,
                              nodeLabel: res.exclusiveResourceNode,
                            });
                            setStatusFeedback({
                              text: `Cosecha completada: +${res.settlement.netExtractorYieldEc} EC netos (retención fiscal ${res.settlement.appliedTaxRatePercent}%).`,
                              isError: false,
                            });
                          }}
                          className="w-full py-1.5 bg-[#00FF66]/20 hover:bg-[#00FF66]/30 border border-[#00FF66] text-[#00FF66] font-black text-[10px] uppercase rounded cursor-pointer"
                        >
                          COSECHAR FÁBRICAS PRIVADAS (NETO POST-IMPUESTO)
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      data-testid="enter-cell-scale-btn"
                      onClick={() => {
                        const center = municipalityMeta?.centerLngLat || ([-71.455, 10.395] as [number, number]);
                        const assignment = spatialDeploymentService.getSpatialAssignment(center);
                        onSelectTarget({
                          scale: 'cell',
                          countryId: 'COUNTRY_VEN',
                          stateId: selection.stateId,
                          municipalityId: selection.municipalityId,
                          sector: assignment.sector,
                          cell: assignment.cell,
                          lngLat: center,
                        });
                        onJumpToScaleZoom?.('cell', center, 15.2);
                      }}
                      className="w-full py-2 px-3 bg-[#E65100] hover:bg-amber-400 text-black font-display font-black text-xs uppercase rounded border border-[#0A0B08] cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Crosshair className="w-4 h-4" />
                      <span>DESPLEGAR CUADRÍCULA 20×20 (Z=15.2)</span>
                    </button>
                  </div>
                )}

                {activeTab === 'government' && (
                  <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-2 text-[10px]">
                    <div className="font-bold text-amber-300 uppercase">Control Jurisdiccional Local</div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Estado Padre:</span>
                      <span className="font-bold">{selection.stateId} (Zulia)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Peaje / Chokepoint:</span>
                      <span className="text-cyan-300 font-bold">
                        {municipalityMeta?.chokepointId || 'Corredor Libre'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Facción Controladora:</span>
                      <span className="text-sky-300 font-bold">{factionMeta.name}</span>
                    </div>

                    {/* Panel del Gestor Municipal e Infraestructura Pública */}
                    <div className="pt-2 border-t border-[#2E3323] space-y-1.5">
                      <div className="text-[9px] font-black text-[#00FF66] uppercase">
                        Panel del Gestor Municipal (RBAC & Infraestructura)
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            const next = !radarEnabled;
                            setRadarEnabled(next);
                            stateSovereigntyService.executeMunicipalManagerAction({
                              municipalityId: municipalMicroGrid.municipalityId,
                              actorUserId: userContext.userId,
                              actorUserName: userContext.userName,
                              actionType: 'toggle_radar',
                              buildingEnabled: next,
                            });
                          }}
                          className={`py-1 px-1 rounded border text-[9px] font-bold cursor-pointer ${
                            radarEnabled
                              ? 'bg-[#22331E] border-[#00FF66] text-[#00FF66]'
                              : 'bg-[#2E1616] border-red-500 text-red-300'
                          }`}
                        >
                          RADAR {radarEnabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            const next = !workshopEnabled;
                            setWorkshopEnabled(next);
                            stateSovereigntyService.executeMunicipalManagerAction({
                              municipalityId: municipalMicroGrid.municipalityId,
                              actorUserId: userContext.userId,
                              actorUserName: userContext.userName,
                              actionType: 'toggle_workshop',
                              buildingEnabled: next,
                            });
                          }}
                          className={`py-1 px-1 rounded border text-[9px] font-bold cursor-pointer ${
                            workshopEnabled
                              ? 'bg-[#22331E] border-[#00FF66] text-[#00FF66]'
                              : 'bg-[#2E1616] border-red-500 text-red-300'
                          }`}
                        >
                          TALLER {workshopEnabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            const next = !samEnabled;
                            setSamEnabled(next);
                            stateSovereigntyService.executeMunicipalManagerAction({
                              municipalityId: municipalMicroGrid.municipalityId,
                              actorUserId: userContext.userId,
                              actorUserName: userContext.userName,
                              actionType: 'toggle_sam_battery',
                              buildingEnabled: next,
                            });
                          }}
                          className={`py-1 px-1 rounded border text-[9px] font-bold cursor-pointer ${
                            samEnabled
                              ? 'bg-[#22331E] border-[#00FF66] text-[#00FF66]'
                              : 'bg-[#2E1616] border-red-500 text-red-300'
                          }`}
                        >
                          AA {samEnabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            setJammerEnabled((v) => !v);
                          }}
                          className={`py-1 px-1 rounded border text-[9px] font-bold cursor-pointer ${
                            jammerEnabled
                              ? 'bg-[#22331E] border-[#00FF66] text-[#00FF66]'
                              : 'bg-[#2E1616] border-red-500 text-red-300'
                          }`}
                        >
                          JAMMER {jammerEnabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            setCustomsEnabled((v) => !v);
                          }}
                          className={`py-1 px-1 rounded border text-[9px] font-bold cursor-pointer col-span-2 ${
                            customsEnabled
                              ? 'bg-[#22331E] border-[#00FF66] text-[#00FF66]'
                              : 'bg-[#2E1616] border-red-500 text-red-300'
                          }`}
                        >
                          ADUANA (+20%) {customsEnabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                      <div className="text-[8px] font-mono text-[#A9B87A]">
                        Ranuras públicas (Máx. 5): {Object.values(MUNICIPAL_BUILDINGS_CATALOG).length} arquetipos disponibles • Búnker +25% res.
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          audioManager.playCue('ui_tile_confirm');
                          barkEngine.generateMorningSessionBriefing({
                            playerName: userContext.userName,
                            borderMunicipalityName: municipalityMeta?.name || 'Cabimas',
                            cellsLostPercent: 15,
                            readyFactoriesCount: 2,
                            netHarvestableEc: 220,
                          });
                          setStatusFeedback({
                            text: `Canal Radio-Net enviado al Gestor Municipal de ${municipalityMeta?.name || 'Cabimas'}: solicitada Torre de Radar en carretera fronteriza.`,
                            isError: false,
                          });
                        }}
                        className="w-full py-1.5 bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400 text-amber-300 font-black text-[9px] uppercase rounded cursor-pointer"
                      >
                        ALERTA AL GESTOR: EXIGIR TORRE DE RADAR EN FRONTERA
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'economy' && (
                  <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-2 text-[10px]">
                    <div className="font-bold text-emerald-400 uppercase flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" /> Complejo & Red Vial Urbana
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Instalación Principal:</span>
                      <span className="text-amber-300 font-bold">{municipalityMeta?.activeFiefName || 'Sector Logístico'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Red Vial OSM Conectada:</span>
                      <span className="text-emerald-400 font-bold">ACTIVA (A* O(1))</span>
                    </div>
                  </div>
                )}

                {activeTab === 'operations' && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        const center = municipalityMeta?.centerLngLat || ([-71.455, 10.395] as [number, number]);
                        const assignment = spatialDeploymentService.getSpatialAssignment(center);
                        onSelectTarget({
                          scale: 'cell',
                          countryId: 'COUNTRY_VEN',
                          stateId: selection.stateId,
                          municipalityId: selection.municipalityId,
                          sector: assignment.sector,
                          cell: assignment.cell,
                          lngLat: center,
                        });
                        onJumpToScaleZoom?.('cell', center, 15.2);
                      }}
                      className="w-full py-2 bg-[#E65100] hover:bg-amber-400 text-black font-display font-black text-xs uppercase rounded cursor-pointer"
                    >
                      INSPECCIONAR CELDAS 20×20
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onSelectTarget({
                          scale: 'state',
                          countryId: 'COUNTRY_VEN',
                          stateId: selection.stateId,
                        })
                      }
                      className="w-full py-2 bg-[#181914] hover:bg-[#25271F] border border-[#46521F] text-[#F2E8D5] font-bold text-[10px] uppercase rounded cursor-pointer"
                    >
                      SUBIR A ESTADO ({selection.stateId})
                    </button>
                  </div>
                )}
              </>
            )}

            {/* =============================================================== */}
            {/* ESCALA 4: CELDA DE CUADRÍCULA 20x20 (CELL)                      */}
            {/* =============================================================== */}
            {selection.scale === 'cell' && cellAssignment && (
              <>
                {activeTab === 'summary' && (
                  <div className="space-y-2.5">
                    <div className="p-2.5 bg-[#1B1D17] border border-[#E65100]/70 rounded space-y-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="px-1.5 py-0.5 bg-[#46521F] text-amber-300 font-black rounded">
                          LOD 3 • MICROJUEGO TÁCTICO
                        </span>
                        <span className="text-[#00FF66] font-bold">ZOOM {currentZoom.toFixed(1)}x</span>
                      </div>
                      <div className="font-display font-black text-xs uppercase text-[#F2E8D5]">
                        ASIGNACIÓN ESPACIAL O(1)
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
                        <div className="p-1.5 bg-[#141510] rounded border border-[#2E3323]">
                          <span className="text-[8px] text-[#A9B87A] block">SECTOR / CELDA</span>
                          <span className="font-bold text-amber-300">
                            [{selection.sector.join(', ')}] • [{selection.cell.join(', ')}]
                          </span>
                        </div>
                        <div className="p-1.5 bg-[#141510] rounded border border-[#2E3323]">
                          <span className="text-[8px] text-[#A9B87A] block">COBERTURA</span>
                          <span className="font-bold text-sky-300">
                            {'★'.repeat(Math.max(1, Math.round(cellAssignment.defenseCoverPercent / 10)))} ({cellAssignment.defenseCoverPercent}%)
                          </span>
                        </div>
                      </div>
                      <div className="text-[9px] text-[#A9B87A]">
                        Terreno: <strong className="text-[#F2E8D5]">{cellAssignment.terrainName}</strong> • WGS84: {selection.lngLat[0].toFixed(5)}°, {selection.lngLat[1].toFixed(5)}°
                      </div>
                    </div>

                    {/* Ocupante RTS o Estructura */}
                    <div className="p-2 bg-[#181914] border border-[#2E3323] rounded space-y-1 text-[10px]">
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">Unidad RTS in-situ:</span>
                        <span className="font-bold text-amber-300">
                          {cellAssignment.deployedUnit
                            ? `${cellAssignment.deployedUnit.callsign} (${cellAssignment.deployedUnit.hp}/100 HP)`
                            : 'Despejada'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#A9B87A]">Edificio / Estructura:</span>
                        <span className="font-bold text-emerald-400">
                          {cellAssignment.deployedBuilding
                            ? `${cellAssignment.deployedBuilding.buildingType} (Nv.${cellAssignment.deployedBuilding.level})`
                            : 'Sin estructura'}
                        </span>
                      </div>
                    </div>

                    {/* Acciones Directas In-Situ: DESPLEGAR y CONSTRUIR */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          audioManager.playCue('tactical_confirm_click');
                          onOpenDeployModal?.();
                        }}
                        className="tactical-btn-heavy py-2 px-3 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Swords className="w-3.5 h-3.5" />
                        <span>DESPLEGAR</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          audioManager.playCue('tactical_confirm_click');
                          onOpenBuildDrawer?.();
                        }}
                        className="py-2 px-3 bg-[#46521F] hover:bg-[#586827] text-amber-200 border border-[#0A0B08] font-display font-black text-xs uppercase rounded cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Hammer className="w-3.5 h-3.5" />
                        <span>CONSTRUIR</span>
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'government' && (
                  <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-1.5 text-[10px]">
                    <div className="font-bold text-amber-300 uppercase">Jurisdicción de Celda 20×20</div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Coordenada:</span>
                      <span>{cellAssignment.formattedCoordinate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Desplegable:</span>
                      <span className={cellAssignment.isDeployable ? 'text-emerald-400' : 'text-red-400'}>
                        {cellAssignment.isDeployable ? 'SÍ (LIBRE)' : 'OCUPADA'}
                      </span>
                    </div>
                  </div>
                )}

                {activeTab === 'economy' && (
                  <div className="p-2.5 bg-[#1B1D17] border border-[#2E3323] rounded space-y-1.5 text-[10px]">
                    <div className="font-bold text-emerald-400 uppercase">Infraestructura de Celda</div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Coste de Movimiento:</span>
                      <span>{cellAssignment.movementCost} PM</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A9B87A]">Construible:</span>
                      <span className={cellAssignment.isConstructible ? 'text-emerald-400' : 'text-red-400'}>
                        {cellAssignment.isConstructible ? 'DISPONIBLE' : 'BLOQUEADO'}
                      </span>
                    </div>
                  </div>
                )}

                {activeTab === 'operations' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenDeployModal?.()}
                      className="tactical-btn-heavy py-2 px-3 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Swords className="w-3.5 h-3.5" />
                      <span>DESPLEGAR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenBuildDrawer?.()}
                      className="py-2 px-3 bg-[#46521F] hover:bg-[#586827] text-amber-200 border border-[#0A0B08] font-display font-black text-xs uppercase rounded cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Hammer className="w-3.5 h-3.5" />
                      <span>CONSTRUIR</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.aside>
      </AnimatePresence>

      {/* Modal RBAC de Soberanía Estatal */}
      {stateRecord && (
        <StateSovereignDeckModal
          key={stateRecord.stateId}
          isOpen={isSovereignDeckOpen}
          onClose={() => setIsSovereignDeckOpen(false)}
          state={stateRecord}
          userContext={userContext}
          onSuccess={(updated) => setStateRecord(updated)}
        />
      )}
    </>
  );
};
