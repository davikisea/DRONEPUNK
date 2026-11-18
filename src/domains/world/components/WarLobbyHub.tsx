/**
 * ==============================================================================
 * CENTRAL DE INTELIGENCIA MILITAR & CUARTEL GENERAL (WAR LOBBY HUB — DRONEPUNK 0.0.1)
 * ==============================================================================
 * Rediseño Competitivo "The Living Comic Canvas" conforme a @tactical-command-intel
 * e @indie-game-ui-architect:
 * - Cuadrante Izquierdo/Central (~58%): CommanderLivingVignette con el Comandante
 *   Táctico activo a cuerpo completo (smoothFull), respiración procedural, parallax
 *   y bocadillo persistente del Bark Engine (hora del día, último resultado, clic
 *   y hover sobre terminales).
 * - Cuadrante Derecho (~42%): Matriz de Navegación Diegética conectada al 100%
 *   con las tablas y estaciones reales (Despliegue, Hangar, Cuartel de Oficiales,
 *   Industria & Silos, Intendencia, Corporación/Clanes, Expediente Militar).
 * - Shell Persistente (Zero-Unmount HQ): Renderiza las sub-vistas superpuestas sin
 *   desmontar el estado del lobby ni reiniciar temporizadores.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Sword,
} from 'lucide-react';
import { MatchFormat, CANONICAL_CO_REGISTRY, COId } from '@domains/tactics';
import { LobbyBarkIntent, audioManager, CommanderBarkWidget, BarkMessage } from '@domains/game-feel';
import { supabase } from '@shared';
import { IndustrialInventory, UnitHangarModal, useTerritoryEconomyTicker } from '@domains/economy';
import type { Clan, SafeguardInventory, UserRoleContext } from '@domains/world';
import { politicalAliceEngine } from '../core/politicalAliceEngine';
import { spatialDeploymentService } from '../services/spatialDeploymentService';
import {
  fetchMyCorporation,
  hasCorpPermission,
  type MyCorporationContext,
} from '../services/corporationService';
import { useTerritoryMap } from '../hooks/useTerritoryMap';
import { DualResourceHeader } from './DualResourceHeader';
import { LobbyStationView } from './TacticalDock';
import { RightActionDock } from './RightActionDock';
import { LeftCollapsibleRail } from './LeftCollapsibleRail';
import { UnifiedRegionInspector } from './UnifiedRegionInspector';
import { WarRoomModal, PrizeItem } from './WarRoomModal';
import { TacticalWorldMap } from './TacticalWorldMap';
import { GarrisonManagementDrawer } from './GarrisonManagementDrawer';
import type { MapSelectionTarget, MapScaleLevel } from '../types/mapSelectionTypes';
import { getZuliaMunicipalityMeta } from '../types/mapSelectionTypes';

export interface WarLobbyHubProps {
  userId?: string;
  onDeployCombat?: (format: MatchFormat, context?: any) => void;
  onStartMatch?: (format: MatchFormat, context?: any) => void;
  onNavigateToView?: (view: LobbyStationView) => void;
  onOpenShop?: () => void;
  onOpenArmory?: () => void;
  onOpenIndustry?: () => void;
  onOpenMarketplace?: () => void;
  onOpenClans?: () => void;
  onOpenDocs?: () => void;
  onOpenEditor?: () => void;
  onOpenProfile?: () => void;
  onOpenLoadingScreen?: () => void;
  userGold: number;
  userGems: number;
  userSteel?: number;
  userLevel?: number;
  userXp?: number;
  nextLevelXp?: number;
  clanName?: string;
  clanTag?: string;
  clanEmblem?: string;
  clan?: Clan;
  industrialInventory?: IndustrialInventory;
  safeguardInventory?: SafeguardInventory;
  isTournamentMode: boolean;
  onToggleTournament?: () => void;
  onToggleTournamentMode?: () => void;
  activeStreakMultiplier?: number;
  winStreak?: number;
  simLevel?: number;
  userTrophies?: number;
  shieldCharges?: number;
  // Sincronización con el Comandante Táctico Activo (28 COs smoothFull)
  activeCommanderId?: COId | string;
  onSelectCommander?: (coId: COId) => void;
  commanderBondLevel?: number;
  lastMatchResult?: 'victory' | 'defeat' | null;
  // Extensiones para el Shell Diegético Persistente (Zero-Unmount)
  activeStation?: LobbyStationView | null;
  onCloseStation?: () => void;
  onGainGold?: (deltaGold: number) => void;
  onGainSteel?: (deltaSteel: number) => void;
  isGuestMode?: boolean;
  onOpenAuthModal?: (customNotice?: string) => void;
  children?: React.ReactNode;
}

const STATION_TITLES: Record<LobbyStationView, { badge: string; title: string }> = {
  shop: { badge: 'ESTACIÓN 01 // INTENDENCIA', title: 'Intendencia Militar • Suministros & Skins' },
  industry: { badge: 'ESTACIÓN 02 // FUNDICIÓN', title: 'Complejo Industrial • Refinería & Silos' },
  armory: { badge: 'ESTACIÓN 03 // HANGAR', title: 'Hangar de Tropas • Almacén Físico de 16 Chasis' },
  marketplace: { badge: 'ESTACIÓN 04 // COMERCIO', title: 'Bolsa Negra P2P • Mercado de Recursos' },
  clans: { badge: 'ESTACIÓN 05 // CORPORACIÓN', title: 'Cuartel General de Alianza & Salvaguarda' },
  docs: { badge: 'ESTACIÓN 06 // INTELIGENCIA', title: 'Archivos de Doctrina Militar & Especificaciones' },
  qa: { badge: 'ESTACIÓN 07 // TELEMETRÍA', title: 'Centro de Telemetría Táctica & QA' },
};

const WHEEL_PRIZES: PrizeItem[] = [
  { text: '1,500 FONDOS ($G)', color: '#2B2C24', type: 'gold', amount: 1500, rarity: 'COMMON' },
  { text: '45t ACERO REFINADO', color: '#46521F', type: 'steel', amount: 45, rarity: 'RARE' },
  { text: '+20 CÉLULAS ENERGÍA', color: '#C46A3A', type: 'energy', amount: 20, rarity: 'COMMON' },
  { text: '5,000 FONDOS ($G)', color: '#161712', type: 'gold', amount: 5000, rarity: 'LEGENDARY' },
  { text: '100 GEMAS TÁCTICAS', color: '#4C1D95', type: 'gems', amount: 100, rarity: 'EPIC' },
  { text: '120t ACERO PESADO', color: '#1D4ED8', type: 'steel', amount: 120, rarity: 'EPIC' },
];

export const WarLobbyHub: React.FC<WarLobbyHubProps> = ({
  userId,
  onDeployCombat,
  onStartMatch,
  onNavigateToView,
  onOpenShop,
  onOpenArmory,
  onOpenIndustry,
  onOpenMarketplace,
  onOpenClans,
  onOpenDocs,
  onOpenEditor,
  onOpenProfile,
  onOpenLoadingScreen,
  userGold,
  userGems,
  userSteel = 25,
  userLevel,
  userXp = 720,
  nextLevelXp = 1000,
  clanName,
  clanTag,
  clan,
  industrialInventory,
  safeguardInventory,
  isTournamentMode,
  onToggleTournament,
  onToggleTournamentMode,
  activeStreakMultiplier,
  winStreak = 3,
  simLevel,
  userTrophies = 2450,
  shieldCharges = 3,
  activeCommanderId = 'andy',
  onSelectCommander,
  commanderBondLevel = 8,
  lastMatchResult = null,
  activeStation = null,
  onCloseStation,
  onGainGold,
  onGainSteel,
  isGuestMode = false,
  onOpenAuthModal,
  children,
}) => {
  // Estados Locales de Recursos Dinámicos & Cosecha
  const [localGold, setLocalGold] = useState(userGold);
  const [localSteel, setLocalSteel] = useState(userSteel);
  const [localEnergy, setLocalEnergy] = useState(75);
  const maxEnergy = 80;
  const [energyTimerSeconds, setEnergyTimerSeconds] = useState(312);
  const [offerTimerSeconds, setOfferTimerSeconds] = useState(899);

  // Estado sincronizado del Comandante Activo y Hover Contextual del Bark Engine (CAPA 3 MVP: Sujeto único 'stella')
  const [selectedCOId, setSelectedCOId] = useState<COId>('stella');
  const [hoverIntent, setHoverIntent] = useState<LobbyBarkIntent | null>(null);

  // Estados de Interfaz, Accesibilidad & Modales
  const [isAudioMuted, setIsAudioMuted] = useState(() => audioManager.getSettings().muted);
  const [isCrtActive, setIsCrtActive] = useState(true);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [genericModalData, setGenericModalData] = useState<{
    title: string;
    content: React.ReactNode;
  } | null>(null);

  // Ruleta de Reabastecimiento (Ceremonia de 3 Tiempos)
  const wheelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isWheelSpinning, setIsWheelSpinning] = useState(false);
  const [wheelAngle, setWheelAngle] = useState(0);
  const [wheelResultText, setWheelResultText] = useState<string | null>(null);
  const [wonPrize, setWonPrize] = useState<PrizeItem | null>(null);

  // Estados del Metajuego V2 Map-First (4 Escalas Geográficas + Hangar + Guarniciones)
  const [selectionTarget, setSelectionTarget] = useState<MapSelectionTarget>({
    scale: 'state',
    countryId: 'COUNTRY_VEN',
    stateId: 'REG_VE_01',
  });
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [currentMapZoom, setCurrentMapZoom] = useState(9.8);
  const [deployTrigger, setDeployTrigger] = useState(0);
  const [buildTrigger, setBuildTrigger] = useState(0);
  const [isHangarModalOpen, setIsHangarModalOpen] = useState(false);
  const [isGarrisonDrawerOpen, setIsGarrisonDrawerOpen] = useState(false);
  const [aliceLogs, setAliceLogs] = useState(() => politicalAliceEngine.getState().operationLogs);
  const [corpContext, setCorpContext] = useState<MyCorporationContext | null>(null);
  const [userEc, setUserEc] = useState(0);
  const [userRareEarth, setUserRareEarth] = useState(0);
  const [userComposites, setUserComposites] = useState(0);

  useEffect(() => {
    if (!userId || isGuestMode) {
      setCorpContext(null);
      return;
    }
    let cancelled = false;
    fetchMyCorporation(userId)
      .then((ctx) => {
        if (cancelled) return;
        setCorpContext(ctx);
        if (ctx) {
          setUserEc(ctx.corporation.treasury_ec ?? 0);
          setLocalSteel(ctx.corporation.treasury_alloys ?? userSteel ?? 0);
          setUserRareEarth(ctx.corporation.treasury_rare_earth ?? 0);
          setUserComposites(ctx.corporation.treasury_composites ?? 0);
        }
      })
      .catch((err) => {
        console.warn('[WarLobbyHub] No se pudo cargar contexto corporativo:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isGuestMode, userSteel]);

  const selectedProvinceId =
    selectionTarget && 'stateId' in selectionTarget
      ? selectionTarget.stateId
      : 'REG_VE_01';

  useEffect(() => {
    const unsub = politicalAliceEngine.subscribe((next) => {
      setAliceLogs([...next.operationLogs]);
    });
    return () => unsub();
  }, []);

  const resolvedClanId = corpContext?.corporation.id ?? clan?.id ?? '';
  const resolvedClanName = corpContext?.corporation.name ?? clan?.name ?? clanName ?? 'Sin Corporación';
  const resolvedClanTag = corpContext?.corporation.tag
    ? `[${corpContext.corporation.tag}]`
    : clan?.tag ?? clanTag ?? '[---]';

  const userRoleContext: UserRoleContext = useMemo(() => {
    const corpRole = corpContext?.membership.role;
    const mappedRole: UserRoleContext['clanRole'] =
      corpRole === 'majority_shareholder'
        ? 'leader'
        : corpRole === 'shareholder'
        ? 'officer'
        : ((clan as any)?.userRole || 'recruit');
    return {
      userId: userId || '',
      userName: corpContext?.corporation.name || clan?.name || 'Comandante',
      clanId: resolvedClanId,
      clanTag: corpContext?.corporation.tag || clan?.tag || '',
      clanRole: mappedRole,
      factionId: 'blue_moon',
      isFactionManager: corpRole === 'majority_shareholder' || corpRole === 'shareholder',
    };
  }, [userId, clan, corpContext, resolvedClanId]);

  // Bark Widget Interactivo en esquina inferior izquierda
  const [barkWidgetMessage, setBarkWidgetMessage] = useState<BarkMessage | null>(null);

  // Datos Soberanos del Metajuego Territorial en Vivo (Supabase SSOT)
  const {
    provinces,
    nodes,
    controlMap,
    declareAttack,
    syncTerritoryData,
  } = useTerritoryMap(resolvedClanId);

  const selectedProvince =
    (selectedProvinceId ? provinces.find((p) => p.id === selectedProvinceId) : null) ||
    provinces[0] ||
    null;

  const addGoldReward = useCallback(
    (amount: number) => {
      setLocalGold((g) => g + amount);
      onGainGold?.(amount);
    },
    [onGainGold]
  );

  const addSteelReward = useCallback(
    (amount: number) => {
      setLocalSteel((s) => s + amount);
      onGainSteel?.(amount);
    },
    [onGainSteel]
  );

  // Ticker de Generación Continua Wplace & Upkeep Territorial (Victoria 3 Pipeline)
  const territoryTicker = useTerritoryEconomyTicker({
    clanId: resolvedClanId,
    provinces,
    nodes,
    controlMap,
    onHarvestResources: ({ ec, steel }) => {
      setUserEc((prev) => prev + ec);
      addSteelReward(steel);
    },
    onDeductUpkeep: (upkeep) => {
      setUserEc((prev) => Math.max(0, prev - upkeep));
    },
  });

  const controlledProvinces = useMemo(() => {
    if (!resolvedClanId) return [];
    return provinces
      .filter((p) => controlMap[p.id]?.controllingClanId === resolvedClanId)
      .map((p) => ({ id: p.id, name: p.name }));
  }, [provinces, controlMap, resolvedClanId]);

  const canUseTreasury = !corpContext || hasCorpPermission(corpContext.membership, 'can_use_treasury');
  const canControlUnits = !corpContext || hasCorpPermission(corpContext.membership, 'can_control_units');
  const canPurchaseUnits = !corpContext || hasCorpPermission(corpContext.membership, 'can_purchase_units');

  const streak = safeguardInventory?.currentStreak ?? winStreak;
  const resolvedLevel = corpContext?.corporation.tech_level ?? userLevel ?? 1;

  useEffect(() => {
    setSelectedCOId('stella');
  }, [activeCommanderId]);

  useEffect(() => {
    setLocalGold(userGold);
  }, [userGold]);

  useEffect(() => {
    setLocalSteel(userSteel);
  }, [userSteel]);

  const handleCommanderChange = useCallback(
    (_nextCoId: COId) => {
      // CAPA 3 MVP: Sujeto de prueba único bloqueado en Mayor Stella ('stella')
      setSelectedCOId('stella');
      onSelectCommander?.('stella');
    },
    [onSelectCommander]
  );

  // Temporizadores militares de energía y oferta
  useEffect(() => {
    const timer = setInterval(() => {
      setEnergyTimerSeconds((prev) => {
        if (prev <= 1) {
          setLocalEnergy((e) => Math.min(maxEnergy, e + 1));
          return 300;
        }
        return prev - 1;
      });
      setOfferTimerSeconds((prev) => (prev > 0 ? prev - 1 : 900));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleDeploy = useCallback(
    (_format: MatchFormat, targetProvId?: string) => {
      // CAPA 2 (Combate Táctico Advance Wars) deshabilitada en este MVP:
      // Redirige cualquier intento de batalla hacia la Operación Geopolítica en el Mapa de Venezuela (Capa 1).
      audioManager.playDeployHorn();
      setActiveModal(null);

      const targetId = targetProvId || selectedProvince?.id || 'REG_VE_20';
      setSelectionTarget({
        scale: 'state',
        countryId: 'COUNTRY_VEN',
        stateId: targetId,
      });
      if (!canControlUnits) {
        return;
      }
      setIsInspectorOpen(true);
      declareAttack(selectedProvince?.id || 'REG_VE_01', targetId, resolvedClanId);
    },
    [resolvedClanId, canControlUnits, declareAttack, selectedProvince]
  );

  const handleNavigate = useCallback(
    (view: LobbyStationView) => {
      audioManager.playSFX('button_click');
      if (isGuestMode && view !== 'docs') {
        onOpenAuthModal?.('Esta terminal militar está reservada a personal en activo. Identifícate para ingresar.');
        return;
      }
      if (onNavigateToView) {
        onNavigateToView(view);
        return;
      }
      switch (view) {
        case 'shop':
          onOpenShop?.();
          break;
        case 'armory':
          onOpenArmory?.();
          break;
        case 'industry':
          onOpenIndustry?.();
          break;
        case 'marketplace':
          onOpenMarketplace?.();
          break;
        case 'clans':
          onOpenClans?.();
          break;
        case 'docs':
          onOpenDocs?.();
          break;
        case 'qa':
          break;
      }
    },
    [
      isGuestMode,
      onOpenAuthModal,
      onNavigateToView,
      onOpenShop,
      onOpenArmory,
      onOpenIndustry,
      onOpenMarketplace,
      onOpenClans,
      onOpenDocs,
    ]
  );

  const handleSelectCountryFromMap = useCallback((countryId: string) => {
    setSelectionTarget({
      scale: 'country',
      countryId,
      countryName: 'República Soberana de Venezuela',
    });
    setIsInspectorOpen(true);
    setBarkWidgetMessage({
      id: `cnt_${Date.now()}`,
      text: 'Telemetría macro-nacional fijada. Edictos y balance imperial disponibles en el inspector derecho.',
      balloonType: 'radio',
      stamp: 'ESCALA PAÍS',
      durationMs: 4500,
    });
  }, []);

  const handleSelectProvinceFromMap = useCallback((provId: string) => {
    setSelectionTarget({
      scale: 'state',
      countryId: 'COUNTRY_VEN',
      stateId: provId,
    });
    setIsInspectorOpen(true);
    if (provId.startsWith('BUF_')) {
      setBarkWidgetMessage({
        id: `buf_${Date.now()}`,
        text: 'SECTOR FUERA DEL TEATRO OPERACIONAL DE FASE 1 (ACTIVO: REPÚBLICA DE VENEZUELA)',
        balloonType: 'panic',
        stamp: 'ZONA RESTRINGIDA',
        durationMs: 5000,
      });
    } else {
      const prov = provinces.find((p) => p.id === provId);
      setBarkWidgetMessage({
        id: `sel_${Date.now()}`,
        text: `Fijando telemetría en ${prov?.name || provId}. Búnker y defensas en pantalla.`,
        balloonType: 'radio',
        stamp: 'SECTOR FIJADO',
        durationMs: 4500,
      });
    }
  }, [provinces]);

  const handleSelectMunicipalityFromMap = useCallback(
    (munId: string, meta?: { name?: string; cityName?: string; stateId?: string }) => {
      const catalogMeta = getZuliaMunicipalityMeta(munId);
      const munName = meta?.name || catalogMeta?.name || munId;
      const cityName = meta?.cityName || catalogMeta?.cityName || munName;
      const stateId = meta?.stateId || catalogMeta?.stateId || 'REG_VE_02';
      setSelectionTarget({
        scale: 'municipality',
        countryId: 'COUNTRY_VEN',
        stateId,
        municipalityId: munId,
        municipalityName: munName,
        cityName,
      });
      setIsInspectorOpen(true);
      setBarkWidgetMessage({
        id: `mun_${Date.now()}`,
        text: `Municipio ${munName} (${cityName}) fijado en radar operacional.`,
        balloonType: 'radio',
        stamp: 'MUNICIPIO FIJADO',
        durationMs: 4500,
      });
    },
    []
  );

  const handleSelectCellFromMap = useCallback(
    (sector: [number, number], cell: [number, number], lngLat?: [number, number]) => {
      const resolvedLngLat: [number, number] = lngLat ?? [-71.455, 10.395];
      setSelectionTarget({
        scale: 'cell',
        countryId: 'COUNTRY_VEN',
        stateId: 'REG_VE_02',
        municipalityId: 'MUN_ZULIA_CABIMAS',
        sector,
        cell,
        lngLat: resolvedLngLat,
      });
      setIsInspectorOpen(true);
      setBarkWidgetMessage({
        id: `cell_${Date.now()}`,
        text: `Celda táctica SEC [${sector.join(',')}] • CELL [${cell.join(',')}] seleccionada para despliegue o construcción.`,
        balloonType: 'radio',
        stamp: 'CUADRÍCULA 20×20',
        durationMs: 4500,
      });
    },
    []
  );

  const handleJumpToScaleZoom = useCallback(
    (scale: MapScaleLevel, center?: [number, number], zoom?: number) => {
      const targetZoom =
        zoom ??
        (scale === 'country'
          ? 5.5
          : scale === 'state'
          ? 6.2
          : scale === 'municipality'
          ? 10.5
          : 15.2);
      const targetCenter =
        center ??
        (scale === 'country' || scale === 'state'
          ? ([-66.5, 8.2] as [number, number])
          : ([-71.455, 10.395] as [number, number]));

      const map = (window as any).__TACTICAL_MAP_INSTANCE__;
      if (map && typeof map.jumpTo === 'function') {
        try {
          map.jumpTo({ center: targetCenter, zoom: targetZoom });
        } catch {}
      }
      if (typeof (window as any).__SET_TACTICAL_ZOOM__ === 'function') {
        (window as any).__SET_TACTICAL_ZOOM__(targetZoom);
      }
      setCurrentMapZoom(targetZoom);

      if (scale === 'country') {
        setSelectionTarget({
          scale: 'country',
          countryId: 'COUNTRY_VEN',
          countryName: 'República Soberana de Venezuela',
        });
      } else if (scale === 'state') {
        setSelectionTarget((prev) => ({
          scale: 'state',
          countryId: 'COUNTRY_VEN',
          stateId: prev && 'stateId' in prev ? prev.stateId : 'REG_VE_01',
        }));
      } else if (scale === 'municipality') {
        setSelectionTarget((prev) => ({
          scale: 'municipality',
          countryId: 'COUNTRY_VEN',
          stateId: 'REG_VE_02',
          municipalityId:
            prev && 'municipalityId' in prev && prev.municipalityId
              ? prev.municipalityId
              : 'MUN_ZULIA_CABIMAS',
          municipalityName: 'Cabimas',
          cityName: 'Cabimas',
        }));
      } else if (scale === 'cell') {
        const assignment = spatialDeploymentService.getSpatialAssignment(targetCenter);
        setSelectionTarget({
          scale: 'cell',
          countryId: 'COUNTRY_VEN',
          stateId: 'REG_VE_02',
          municipalityId: 'MUN_ZULIA_CABIMAS',
          sector: assignment.sector,
          cell: assignment.cell,
          lngLat: targetCenter,
        });
      }
      setIsInspectorOpen(true);
    },
    []
  );

  const toggleAudio = () => {
    const muted = audioManager.toggleMute();
    setIsAudioMuted(muted);
  };

  const openGenericModal = (title: string, content: React.ReactNode) => {
    audioManager.playSFX('button_click');
    setGenericModalData({ title, content });
    setActiveModal('modal-generic');
  };

  // =========================================================================
  // HOTKEYS GLOBALES DEL CUARTEL GENERAL ([1]-[6], [SPACE], [F], [R], [P], [C], [ESC])
  // =========================================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key === 'Escape') {
        if (activeModal) {
          audioManager.playCue('ui_cancel_rollback');
          setActiveModal(null);
          return;
        }
        if (activeStation && onCloseStation) {
          audioManager.playCue('ui_cancel_rollback');
          onCloseStation();
          return;
        }
        if (isInspectorOpen) {
          audioManager.playCue('ui_cancel_rollback');
          setIsInspectorOpen(false);
          return;
        }
      }

      if (activeModal) return;

      switch (e.key) {
        case '1':
          handleNavigate('shop');
          break;
        case '2':
          handleNavigate('industry');
          break;
        case '3':
          handleNavigate('armory');
          break;
        case '4':
          handleNavigate('marketplace');
          break;
        case '5':
          handleNavigate('clans');
          break;
        case '6':
          handleNavigate('docs');
          break;
        case 'm':
        case 'M':
          if (!e.ctrlKey && !e.metaKey && !activeStation) {
            e.preventDefault();
            audioManager.playSFX('button_click');
            setIsInspectorOpen(prev => !prev);
          }
          break;
        case ' ':
          if (!activeStation) {
            e.preventDefault();
            audioManager.playSFX('button_click');
            setActiveModal('modal-battle-hq');
          }
          break;
        case 'f':
        case 'F':
          if (!e.ctrlKey && !e.metaKey && !activeStation) {
            e.preventDefault();
            handleDeploy('blitz_skirmish');
          }
          break;
        case 'r':
        case 'R':
          if (!e.ctrlKey && !e.metaKey && !activeStation) {
            e.preventDefault();
            audioManager.playSFX('button_click');
            setActiveModal('modal-ruleta');
          }
          break;
        case 'c':
        case 'C':
          if (!e.ctrlKey && !e.metaKey && !activeStation) {
            e.preventDefault();
            audioManager.playSFX('button_click');
            setActiveModal('modal-commander-dossier');
          }
          break;
        case 'p':
        case 'P':
          if (!e.ctrlKey && !e.metaKey && !activeStation) {
            e.preventDefault();
            audioManager.playSFX('button_click');
            onOpenProfile?.();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, activeStation, onCloseStation, handleNavigate, handleDeploy, onOpenProfile]);

  // =========================================================================
  // RULETA DE REABASTECIMIENTO MECÁNICO (CEREMONIA DE 3 TIEMPOS)
  // =========================================================================
  const drawWheel = useCallback(() => {
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const numSegments = WHEEL_PRIZES.length;
    const arcSize = (2 * Math.PI) / numSegments;
    const radius = canvas.width / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < numSegments; i++) {
      const angle = i * arcSize;
      ctx.beginPath();
      ctx.fillStyle = WHEEL_PRIZES[i].color;
      ctx.moveTo(radius, radius);
      ctx.arc(radius, radius, radius, angle, angle + arcSize);
      ctx.lineTo(radius, radius);
      ctx.fill();
      ctx.strokeStyle = '#0A0B08';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.save();
      ctx.translate(radius, radius);
      ctx.rotate(angle + arcSize / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#F2E8D5';
      ctx.font = "800 11px 'JetBrains Mono', monospace";
      ctx.fillText(WHEEL_PRIZES[i].text, radius - 14, 4);
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    if (activeModal === 'modal-ruleta') {
      const id = setTimeout(drawWheel, 40);
      return () => clearTimeout(id);
    }
  }, [activeModal, drawWheel]);

  const spinWheel = async () => {
    if (isWheelSpinning) return;
    setIsWheelSpinning(true);
    setWonPrize(null);
    audioManager.playSFX('button_click');
    setWheelResultText('TIEMPO 1 // SOLICITANDO SUMINISTRO AL SERVIDOR C4ISR...');

    if (!userId || isGuestMode) {
      setIsWheelSpinning(false);
      onOpenAuthModal?.('Debes iniciar sesión para girar la ruleta y recibir suministros del Alto Mando.');
      setWheelResultText('FALLO // AUTORIZACIÓN MILITAR REQUERIDA');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('rpc_spin_daily_wheel', {
        p_user_id: userId,
      });

      if (error || !data || !(data as any).success) {
        setIsWheelSpinning(false);
        const errMsg = error?.message || (data as any)?.error || 'NO AUTORIZADO';
        setWheelResultText(`RECHAZO // ${errMsg.toUpperCase()}`);
        return;
      }

      const res = data as {
        success: boolean;
        reward_type: string;
        reward_amount: number;
        reward_label: string;
        wallet_balance?: number;
      };

      // Mapear segmento del rotor según el tipo de recompensa del servidor
      let targetIndex = 0;
      if (res.reward_type === 'credits') {
        targetIndex = res.reward_amount >= 1200 ? 3 : 0;
      } else if (res.reward_type === 'gems') {
        targetIndex = res.reward_amount >= 100 ? 4 : 4;
      } else if (res.reward_type === 'steel') {
        targetIndex = res.reward_amount >= 100 ? 5 : 1;
      }

      const extraRounds = 5;
      const segmentAngle = 360 / WHEEL_PRIZES.length;
      const targetDeg =
        extraRounds * 360 + (360 - (targetIndex * segmentAngle + segmentAngle / 2) - 90);

      const nextAngle = wheelAngle + targetDeg;
      setWheelAngle(nextAngle);

      const tickDelays = [180, 380, 620, 900, 1250, 1650, 2150, 2750, 3450];
      tickDelays.forEach((delay, idx) => {
        setTimeout(() => {
          audioManager.playGoldTick(idx);
        }, delay);
      });

      setTimeout(() => {
        setIsWheelSpinning(false);
        const won = WHEEL_PRIZES[targetIndex];
        setWonPrize(won);
        audioManager.playComboAction(8);
        setWheelResultText(`¡SUMINISTRO ASEGURADO: ${res.reward_label.toUpperCase()}!`);

        if (res.reward_type === 'credits') {
          addGoldReward(res.reward_amount);
        } else if (res.reward_type === 'steel') {
          addSteelReward(res.reward_amount);
        }
      }, 4050);
    } catch (err: any) {
      setIsWheelSpinning(false);
      setWheelResultText(`FALLO DE ENLACE // ${err?.message?.toUpperCase() || 'ERROR DESCONOCIDO'}`);
    }
  };

  return (
    <div
      data-testid="map-first-shell"
      className="h-screen max-h-screen w-screen overflow-hidden bg-[#0E100C] text-[#F2E8D5] font-sans select-none relative"
    >
      {/* 1. HEADER SUPERIOR PERSISTENTE (DARK-GLASS MINIMALISTA) */}
      <DualResourceHeader
        userGold={localGold}
        userEnergyEc={userEc}
        maxEnergyEc={8000}
        userTechScrap={industrialInventory?.techScrap ?? 350}
        userSteel={localSteel}
        userRareEarth={userRareEarth}
        userComposites={userComposites}
        userLevel={resolvedLevel}
        userXp={userXp}
        nextLevelXp={nextLevelXp}
        userTrophies={userTrophies}
        activeStreak={streak}
        cycleTimerText={formatTime(energyTimerSeconds)}
        clanTag={resolvedClanTag}
        clanName={resolvedClanName}
        clanColor={clan?.color ?? '#3B82F6'}
        clanVaultEc={corpContext?.corporation.treasury_ec ?? 0}
        clanSharedStockCount={14}
        factionTcpControl={7200}
        isGuestMode={isGuestMode}
        onOpenAuthModal={onOpenAuthModal}
        onOpenProfile={onOpenProfile}
        onToggleDrawer={() => setIsInspectorOpen((prev) => !prev)}
        isDrawerOpen={isInspectorOpen}
        onSelectCountryScale={() => handleSelectCountryFromMap('COUNTRY_VEN')}
      />

      {/* 2. LIENZO ÚNICO 100% MAPA-PRIMERO (100vw x 100vh) */}
      <main className="relative w-full h-full overflow-hidden bg-[#0E100C]">
        <div className="absolute inset-0 w-full h-full overflow-hidden">
          <TacticalWorldMap
            className="w-full h-full"
            activeProvinceId={selectedProvince?.id}
            userClanId={resolvedClanId}
            onSelectCountry={handleSelectCountryFromMap}
            onSelectProvince={handleSelectProvinceFromMap}
            onSelectMunicipality={handleSelectMunicipalityFromMap}
            onSelectTacticalCell={handleSelectCellFromMap}
            onZoomChange={(z) => {
              setCurrentMapZoom(z);
              if (z >= 15.0) {
                setSelectionTarget((prev) => {
                  if (prev.scale === 'cell') return prev;
                  const coord: [number, number] = [-71.455, 10.395];
                  const assignment = spatialDeploymentService.getSpatialAssignment(coord);
                  return {
                    scale: 'cell',
                    countryId: 'COUNTRY_VEN',
                    stateId: 'REG_VE_02',
                    municipalityId: 'MUN_ZULIA_CABIMAS',
                    sector: assignment.sector,
                    cell: assignment.cell,
                    lngLat: coord,
                  };
                });
              }
            }}
            hideLegacyMicroDeck={true}
            externalDeployTrigger={deployTrigger}
            externalBuildTrigger={buildTrigger}
          />
        </div>

        {/* C4ISR THEATER STRIP */}
        <div
          data-testid="c4isr-theater-strip"
          className="fixed top-[80px] left-1/2 -translate-x-1/2 z-20 pointer-events-none flex items-center gap-2 px-3 py-1 bg-[#0E100C]/90 border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] text-[10px] font-mono font-bold text-[#F2E8D5] tracking-wider uppercase whitespace-nowrap"
        >
          <img src="/icon.svg" alt="DRONEPUNK" className="w-4 h-4 object-contain" />
          <span>DRONEPUNK • MAPA TERRITORIAL GLOBAL</span>
        </div>

        {/* 3. RAIL IZQUIERDO DESPLEGABLE (TOP-LEFT, LIBRE DE BARK) */}
        <LeftCollapsibleRail
          currentScale={selectionTarget.scale}
          currentZoom={currentMapZoom}
          onJumpToScale={(scale) => handleJumpToScaleZoom(scale)}
          logs={aliceLogs}
          resolvedClanTag={resolvedClanTag}
          isAudioMuted={isAudioMuted}
          onToggleAudio={toggleAudio}
          isCrtActive={isCrtActive}
          onToggleCrt={() => setIsCrtActive((p) => !p)}
          isReducedMotion={isReducedMotion}
          onToggleReducedMotion={() => setIsReducedMotion((p) => !p)}
          onOpenHangar={() => setIsHangarModalOpen(true)}
          onOpenWheel={() => setActiveModal('modal-ruleta')}
          onOpenEditor={onOpenEditor}
          onInspectAlly={(allyName, sector) =>
            openGenericModal(
              `INSPECCIÓN DE GUARNICIÓN ALIADA // ${allyName.toUpperCase()}`,
              <p className="text-xs text-[#F2E8D5] leading-relaxed">
                Inspeccionando perímetro defensivo de <strong>{allyName}</strong> ({sector}). Baterías
                antiaéreas y silos operando al 100% de eficiencia.
              </p>
            )
          }
          onTransferSupplyToAlly={(allyName) => {
            audioManager.playComboAction(3);
            addSteelReward(25);
            openGenericModal(
              'TRANSFERENCIA LOGÍSTICA COMPLETADA',
              <p className="text-xs text-[#F2E8D5] leading-relaxed">
                Transferiste combustible táctico a <strong>{allyName}</strong>. ¡Recibiste{' '}
                <strong className="text-amber-400">+25t de Acero Refinado</strong> en reciprocidad!
              </p>
            );
          }}
          onCoordinateAlly={(allyName) =>
            openGenericModal(
              'TRANSMISIÓN DE COORDINACIÓN ALIADA',
              <p className="text-xs text-[#F2E8D5] leading-relaxed">
                Enviada solicitud de maniobra conjunta a <strong>{allyName}</strong> para el próximo
                Torneo de Alianzas ({resolvedClanTag}).
              </p>
            )
          }
          onOpenRecruitModal={() =>
            openGenericModal(
              'FRECUENCIA DE RECLUTAMIENTO DE ALIANZA',
              <div className="p-3 rounded-[8px_2px_8px_2px] bg-[#161712] border-2 border-[#0A0B08] space-y-2">
                <p className="text-xs text-[#F2E8D5]">
                  Código táctico de invitación directa para <strong>{resolvedClanName}</strong>:
                </p>
                <code className="block p-2 bg-[#2B2C24] text-amber-300 font-mono font-extrabold text-xs border border-[#7B8A4A] rounded">
                  TACTICAL-HQ-{resolvedClanTag}-9942
                </code>
              </div>
            )
          }
        />

        {/* 4. INSPECTOR DERECHO UNIFICADO DE 4 ESCALAS (PAÍS / ESTADO / MUNICIPIO / CELDA) */}
        <UnifiedRegionInspector
          selection={selectionTarget}
          isOpen={isInspectorOpen}
          onClose={() => setIsInspectorOpen(false)}
          onOpen={() => setIsInspectorOpen(true)}
          onSelectTarget={(nextTarget) => {
            setSelectionTarget(nextTarget);
            setIsInspectorOpen(true);
          }}
          userContext={userRoleContext}
          provinces={provinces}
          nodes={nodes}
          controlMap={controlMap}
          userClanId={resolvedClanId}
          userClanTag={resolvedClanTag}
          userEc={userEc}
          userSteel={localSteel}
          corpContext={corpContext}
          currentZoom={currentMapZoom}
          onDeclareAttack={async (targetProvinceId) => {
            if (!canControlUnits) {
              return { success: false, error: 'Permiso can_control_units requerido para declarar ofensivas.' };
            }
            const originId = selectedProvince?.id || 'REG_VE_01';
            const res = await declareAttack(
              originId,
              targetProvinceId,
              resolvedClanId
            );
            if (res.success) {
              audioManager.playComboAction(8);
              syncTerritoryData();
            } else {
              audioManager.playSFX('button_click');
            }
            return res;
          }}
          onOpenDeployModal={() => setDeployTrigger((n) => n + 1)}
          onOpenBuildDrawer={() => setBuildTrigger((n) => n + 1)}
          onOpenFullHangar={() => {
            if (canPurchaseUnits) {
              setIsHangarModalOpen(true);
            }
          }}
          onRebalanceGarrison={(targetLevel) => {
            if (!canUseTreasury) return;
            const upkeep = targetLevel * 150;
            setUserEc((prev) => Math.max(0, prev - upkeep));
          }}
          onJumpToScaleZoom={handleJumpToScaleZoom}
        />

        {/* 5. BARRA INFERIOR DERECHA (TIENDA, INDUSTRIA, ARMERÍA, P2P, ALIANZA, DOCTRINA) */}
        <RightActionDock
          activeStation={activeStation}
          onHoverIntent={setHoverIntent}
          onNavigate={(view) => {
            if (activeStation === view && onCloseStation) {
              onCloseStation();
              return;
            }
            handleNavigate(view);
          }}
        />

        {/* ====================================================================
            SHELL DIEGÉTICO SUPERPUESTO PARA SUB-VISTAS (ZERO-UNMOUNT HQ)
            Se abre sobre el mapa WebGL sin desmontarlo
           ==================================================================== */}
        <AnimatePresence>
          {activeStation && children && (
            <motion.section
              key={activeStation}
              initial={{ opacity: 0, scale: 0.96, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className="fixed top-14 left-3 right-3 bottom-16 z-40 flex flex-col tactical-comic-card bg-[#161712]/96 backdrop-blur-md border-3 border-[#0A0B08] shadow-[10px_10px_0px_#0A0B08] overflow-hidden"
            >
              {/* Barra de Cabecera de la Terminal de Estación */}
              <div className="px-4 py-2 bg-[#2B2C24] border-b-2 border-[#0A0B08] flex flex-wrap items-center justify-between gap-2 ben-day-dark shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onMouseEnter={() => audioManager.playHoverTick()}
                    onClick={() => {
                      audioManager.playCue('ui_cancel_rollback');
                      onCloseStation?.();
                    }}
                    className="tactical-juice-btn flex items-center gap-1.5 px-3 py-1 bg-[#46521F] hover:bg-[#586827] text-[#F2E8D5] font-display font-extrabold text-xs uppercase tracking-wider border-2 border-[#0A0B08]"
                    title="Cerrar estación y volver al Mapa Táctico [ESC]"
                  >
                    <ArrowLeft className="w-4 h-4 text-amber-300" />
                    <span>Volver al Mapa [ESC]</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <img src="/favicon.svg" alt="DRONEPUNK" className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline-block px-2 py-0.5 rounded-[4px_1px_4px_1px] bg-[#E65100] text-[#F2E8D5] font-mono font-extrabold text-[10px] uppercase border border-[#0A0B08]">
                      {STATION_TITLES[activeStation]?.badge}
                    </span>
                    <h2 className="font-display font-extrabold text-sm sm:text-base text-[#F2E8D5] uppercase tracking-wider">
                      {STATION_TITLES[activeStation]?.title}
                    </h2>
                  </div>
                </div>

                <button
                  type="button"
                  onMouseEnter={() => audioManager.playHoverTick()}
                  onClick={() => handleDeploy('blitz_skirmish')}
                  className="tactical-btn-heavy px-3.5 py-1 text-xs flex items-center gap-1.5"
                  title="Ejecutar presión de asedio en el teatro"
                >
                  <Sword className="w-3.5 h-3.5 text-amber-300" />
                  <span>Asedio Táctico</span>
                </button>
              </div>

              {/* Contenido de la Estación (Shop, Armory, Industry, Market, Clans, Docs, QA) */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
                {children}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* 6. MODALES INTERNOS ANIMADOS CON MOTION (SALA DE OPERACIONES, DOSSIER CO, ROTOR, RADAR) */}
      <WarRoomModal
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        onDeploy={handleDeploy}
        onOpenBattleHQ={() => {
          if (isGuestMode) {
            onOpenAuthModal?.('Debes iniciar sesión para acceder al Estado Mayor de Batalla.');
            return;
          }
          setActiveModal('modal-battle-hq');
        }}
        wheelCanvasRef={wheelCanvasRef}
        isWheelSpinning={isWheelSpinning}
        wheelAngle={wheelAngle}
        wheelResultText={wheelResultText}
        wonPrize={wonPrize}
        onSpinWheel={spinWheel}
        genericModalData={genericModalData}
        activeCommanderId={selectedCOId}
        onSelectCommander={handleCommanderChange}
        commanderBondLevel={commanderBondLevel}
      />

      <UnitHangarModal
        isOpen={isHangarModalOpen}
        onClose={() => setIsHangarModalOpen(false)}
        userEc={userEc}
        userSteel={localSteel}
        userRareEarth={userRareEarth}
        userComposites={userComposites}
        onUpdateResources={(delta) => {
          if (delta.ec) setUserEc((e) => Math.max(0, e + delta.ec!));
          if (delta.steel) addSteelReward(delta.steel);
          if (delta.rareEarth) setUserRareEarth((r) => Math.max(0, r + delta.rareEarth!));
          if (delta.composites) setUserComposites((c) => Math.max(0, c + delta.composites!));
        }}
      />

      <GarrisonManagementDrawer
        isOpen={isGarrisonDrawerOpen}
        onClose={() => setIsGarrisonDrawerOpen(false)}
        userEc={userEc}
        clanTag={resolvedClanTag}
        controlledProvinces={controlledProvinces}
        onSpendEc={(amount) => {
          if (!canUseTreasury) return;
          setUserEc((e) => Math.max(0, e - amount));
        }}
      />

      {/* 7. COMANDANTE REACTIVO PRESERVADO (BARK ENGINE - ESQUINA INFERIOR IZQUIERDA) */}
      <CommanderBarkWidget
        commanderId={selectedCOId}
        externalMessage={barkWidgetMessage}
        onClearExternalMessage={() => setBarkWidgetMessage(null)}
        selectedSectorName={selectedProvince?.name}
        onOpenDossier={() => setActiveModal('modal-commander-dossier')}
      />
    </div>
  );
};
