import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Shield,
  Zap,
  Hammer,
  Layers,
  Award,
  ChevronRight,
  Flame,
  Cpu,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { audioManager } from '@domains/game-feel';
import {
  UnitHangarEntry,
  PatentRegistryEntry,
  MASTER_METAGAME_CONSTANTS,
  type DroneGambitProgram,
  type DoctrinePresetId,
  type DoctrineCodePayload,
  type GambitSlotRule,
} from '@shared';
import { useUserHangar } from '../hooks/useUserHangar';
import { calculateAdministrativeOverloadFuelMultiplier } from '../core/upkeepEngine';

export interface UnitHangarModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEc: number;
  userSteel: number;
  userRareEarth?: number;
  userComposites?: number;
  onUpdateResources?: (delta: { ec?: number; steel?: number; rareEarth?: number; composites?: number }) => void;
  onDeployToReinforcements?: (units: UnitHangarEntry[]) => void;
}

const HANGAR_GAMBIT_PRESETS: Record<DoctrinePresetId, DoctrineCodePayload> = {
  NIGHT_PAINTER: {
    name: 'Pintor Nocturno',
    version: 1,
    recommendedUnit: 'recon_explorer',
    maxSlots: 4,
    rules: [
      { slot: 1, condition: 'SUPERIOR_ENEMY_IN_RANGE', action: 'FLEE_OPPOSITE_TO_FOREST_OR_MOUNTAIN' },
      { slot: 2, condition: 'FUEL_LT_20', action: 'RETREAT_TO_NEAREST_APC_OR_REPAIR' },
      { slot: 3, condition: 'HEX_NEUTRAL', action: 'CAPTURE_HEX_UNTIL_DONE' },
      { slot: 4, condition: 'ALWAYS', action: 'FOLLOW_WAYPOINTS_LOOP' },
    ],
  },
  WATCHDOG: {
    name: 'Perro Guardián',
    version: 1,
    recommendedUnit: 'medium_tank',
    maxSlots: 4,
    rules: [
      { slot: 1, condition: 'HP_LT_30', action: 'RETREAT_TO_NEAREST_APC_OR_REPAIR' },
      { slot: 2, condition: 'ENEMY_NEAR_ALLY_FACTORY_2', action: 'INTERCEPT_AND_ATTACK' },
      { slot: 3, condition: 'WEAK_ENEMY_IN_RANGE', action: 'ATTACK_WEAKEST' },
      { slot: 4, condition: 'ALWAYS', action: 'PATROL_PING_PONG' },
    ],
  },
  SABOTEUR: {
    name: 'Saboteador',
    version: 1,
    recommendedUnit: 'infantry_swarm',
    maxSlots: 4,
    rules: [
      { slot: 1, condition: 'ENEMY_IN_RANGE', action: 'IGNORE_COMBAT_STEALTH' },
      { slot: 2, condition: 'HEX_HAS_ENEMY_FACTORY', action: 'SABOTAGE_OR_CAPTURE_BUILDING' },
      { slot: 3, condition: 'MUNICIPALITY_ENEMY_OVER_70', action: 'RETURN_TO_ALLY_FACTORY' },
      { slot: 4, condition: 'ALWAYS', action: 'FOLLOW_WAYPOINTS_LOOP' },
    ],
  },
};

function encodeDoctrineLocal(payload: DoctrineCodePayload): string {
  const json = JSON.stringify(payload);
  return `DP-DOC-${globalThis.btoa(unescape(encodeURIComponent(json)))}`;
}

function decodeDoctrineLocal(code: string): DoctrineCodePayload {
  const trimmed = code.trim();
  if (!trimmed.startsWith('DP-DOC-')) throw new Error('Formato inválido');
  const json = decodeURIComponent(escape(globalThis.atob(trimmed.slice(7))));
  return JSON.parse(json) as DoctrineCodePayload;
}

interface UnitBlueprint {
  code: string;
  name: string;
  category: 'infantry' | 'armor' | 'artillery' | 'aviation';
  baseSteelCost: number;
  baseRareEarthCost: number;
  baseCompositesCost: number;
  baseEcCost: number;
  baseAtk: number;
  baseDef: number;
  rangeMin: number;
  rangeMax: number;
  description: string;
}

const UNIT_CATALOG: UnitBlueprint[] = [
  {
    code: 'INF_MECH',
    name: 'Infantería Mecanizada',
    category: 'infantry',
    baseSteelCost: 20,
    baseRareEarthCost: 5,
    baseCompositesCost: 10,
    baseEcCost: 50,
    baseAtk: 65,
    baseDef: 50,
    rangeMin: 1,
    rangeMax: 1,
    description: 'Fuerzas de despliegue rápido con lanzacohetes portátiles. Eficaces en captura de nodos.',
  },
  {
    code: 'TANK_T80',
    name: 'Blindado Medio Vanguard',
    category: 'armor',
    baseSteelCost: 80,
    baseRareEarthCost: 25,
    baseCompositesCost: 40,
    baseEcCost: 180,
    baseAtk: 85,
    baseDef: 75,
    rangeMin: 1,
    rangeMax: 1,
    description: 'Columna vertebral acorazada. Balística de alto calibre con blindaje compuesto reactivo.',
  },
  {
    code: 'ARTY_M109',
    name: 'Artillería Autopropulsada',
    category: 'artillery',
    baseSteelCost: 65,
    baseRareEarthCost: 35,
    baseCompositesCost: 30,
    baseEcCost: 160,
    baseAtk: 95,
    baseDef: 40,
    rangeMin: 2,
    rangeMax: 4,
    description: 'Soporte de fuego indirecto a larga distancia. Devastador contra concentraciones acorazadas.',
  },
  {
    code: 'MLRS_M270',
    name: 'Lanzacohetes Múltiple MLRS',
    category: 'artillery',
    baseSteelCost: 95,
    baseRareEarthCost: 50,
    baseCompositesCost: 60,
    baseEcCost: 260,
    baseAtk: 110,
    baseDef: 30,
    rangeMin: 3,
    rangeMax: 5,
    description: 'Bombardeo de saturación en racimo. Implacable contra guarniciones y fortines.',
  },
  {
    code: 'HELI_APACHE',
    name: 'Helicóptero de Ataque Cóndor',
    category: 'aviation',
    baseSteelCost: 75,
    baseRareEarthCost: 60,
    baseCompositesCost: 80,
    baseEcCost: 280,
    baseAtk: 100,
    baseDef: 45,
    rangeMin: 1,
    rangeMax: 1,
    description: 'Aeronave de ala rotatoria antitanque. Ignora restricciones de terreno terrestre.',
  },
  {
    code: 'NEOTANK',
    name: 'Neotanque Pesado (Árbol Corporativo)',
    category: 'armor',
    baseSteelCost: 130,
    baseRareEarthCost: 65,
    baseCompositesCost: 90,
    baseEcCost: 420,
    baseAtk: 118,
    baseDef: 95,
    rangeMin: 1,
    rangeMax: 1,
    description: 'Desbloqueado al controlar >= 1 municipio. Blindaje pesado dentro del Hangar Físico de 16 Chasis.',
  },
  {
    code: 'BOMBER',
    name: 'Bombardero Estratégico (Árbol Corporativo)',
    category: 'aviation',
    baseSteelCost: 145,
    baseRareEarthCost: 85,
    baseCompositesCost: 110,
    baseEcCost: 480,
    baseAtk: 125,
    baseDef: 65,
    rangeMin: 1,
    rangeMax: 1,
    description: 'Desbloqueado al controlar >= 1 municipio. Supresión masiva contra tanques y fábricas.',
  },
];

export const UnitHangarModal: React.FC<UnitHangarModalProps> = ({
  isOpen,
  onClose,
  userEc,
  userSteel,
  userRareEarth = 120,
  userComposites = 90,
  onUpdateResources,
  onDeployToReinforcements,
}) => {
  const [activeTab, setActiveTab] = useState<'inventory' | 'forge' | 'patents' | 'battlegroup'>('inventory');

  // Hangar y Patentes conectadas al 100% con Supabase (useUserHangar)
  const {
    hangarUnits,
    operationalUnits,
    unlockedPatents,
    battlegroup,
    isLoading: isHangarLoading,
    craftUnit,
    unlockPatent,
    scrapUnit,
    deployUnitToField,
    recallUnitToHangar,
    toggleBattlegroupUnit,
  } = useUserHangar();

  const totalChassisCount = hangarUnits.reduce((sum, u) => sum + Math.max(1, u.quantity), 0);
  const vanguardCount = Math.min(4, battlegroup.length);
  const reserveCount = Math.max(0, Math.min(12, totalChassisCount - vanguardCount));
  const [hangarFeedback, setHangarFeedback] = useState<{ text: string; isError?: boolean } | null>(null);

  // Crafting state
  const [selectedBlueprintCode, setSelectedBlueprintCode] = useState<string>('TANK_T80');
  const [selectedCraftTier, setSelectedCraftTier] = useState<number>(2);
  const [selectedCraftLevel, setSelectedCraftLevel] = useState<number>(1);
  const [craftQuantity, setCraftQuantity] = useState<number>(1);
  const [craftSuccessMessage, setCraftSuccessMessage] = useState<string | null>(null);
  const [gambitTargetPriority, setGambitTargetPriority] = useState<DroneGambitProgram['targetPriorityRule']>('neutral_cells_first');
  const [gambitRetreatVsTank, setGambitRetreatVsTank] = useState<boolean>(true);
  const [gambitMaxEnemyControl, setGambitMaxEnemyControl] = useState<number>(70);
  const [gambitSavedMsg, setGambitSavedMsg] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<DoctrinePresetId>('NIGHT_PAINTER');
  const [activeDoctrineRules, setActiveDoctrineRules] = useState<GambitSlotRule[]>(
    HANGAR_GAMBIT_PRESETS.NIGHT_PAINTER.rules
  );
  const [doctrineCodeInput, setDoctrineCodeInput] = useState<string>(() =>
    encodeDoctrineLocal(HANGAR_GAMBIT_PRESETS.NIGHT_PAINTER)
  );
  const [dryRunResult, setDryRunResult] = useState<
    Array<{ hours: 4 | 8 | 12; remainingFuel: number; remainingHp10: number; capturedHexes: number }> | null
  >(null);

  if (!isOpen) return null;

  const selectedBp = UNIT_CATALOG.find((b) => b.code === selectedBlueprintCode) ?? UNIT_CATALOG[0];

  // Cost calculations with level scaling
  const tierCostMultiplier = 1 + (selectedCraftTier - 1) * 0.45;
  const levelCostMultiplier = 1 + (selectedCraftLevel - 1) * 0.25;
  const totalSteelCost = Math.round(selectedBp.baseSteelCost * tierCostMultiplier * levelCostMultiplier * craftQuantity);
  const totalRareEarthCost = Math.round(selectedBp.baseRareEarthCost * tierCostMultiplier * levelCostMultiplier * craftQuantity);
  const totalCompositesCost = Math.round(selectedBp.baseCompositesCost * tierCostMultiplier * levelCostMultiplier * craftQuantity);
  const totalEcCost = Math.round(selectedBp.baseEcCost * tierCostMultiplier * levelCostMultiplier * craftQuantity);

  const canAfford =
    userSteel >= totalSteelCost &&
    userRareEarth >= totalRareEarthCost &&
    userComposites >= totalCompositesCost &&
    userEc >= totalEcCost;

  const currentMaxPatentTier =
    unlockedPatents.find((p) => p.patentCode === selectedBlueprintCode)?.tier ?? 0;

  const isPatentUnlocked = currentMaxPatentTier >= selectedCraftTier;

  const handleCraft = async () => {
    if (!canAfford || !isPatentUnlocked) {
      audioManager.playCancelRollback();
      return;
    }

    onUpdateResources?.({
      steel: -totalSteelCost,
      rareEarth: -totalRareEarthCost,
      composites: -totalCompositesCost,
      ec: -totalEcCost,
    });

    audioManager.playAirdropImpact();

    const res = await craftUnit({
      unitCode: selectedBlueprintCode,
      tier: selectedCraftTier,
      level: selectedCraftLevel,
      quantity: craftQuantity,
      costs: {
        ec: totalEcCost,
        steel: totalSteelCost,
        rareEarth: totalRareEarthCost,
        composites: totalCompositesCost,
      },
    });

    if (res.success) {
      setCraftSuccessMessage(res.message);
      setTimeout(() => setCraftSuccessMessage(null), 3500);
    }
  };

  const handleSalvageScrap = async (unitId: string) => {
    const res = await scrapUnit(unitId);
    if (res.success) {
      onUpdateResources?.({
        steel: res.recoveredSteel,
        ec: res.recoveredEc,
      });
      audioManager.playComboAction(3);
    }
  };

  const handleAddToBattlegroup = (unit: UnitHangarEntry) => {
    toggleBattlegroupUnit(unit);
    onDeployToReinforcements?.([...battlegroup, unit]);
  };

  const handleDeployToFieldDb = async (unit: UnitHangarEntry) => {
    setHangarFeedback(null);
    const res = await deployUnitToField({ hangarSlotId: unit.id });
    setHangarFeedback({ text: res.message, isError: !res.success });
    if (res.success) {
      onDeployToReinforcements?.([unit]);
    }
  };

  const handleRecallToHangarDb = async (operationalUnitId: string) => {
    setHangarFeedback(null);
    const res = await recallUnitToHangar(operationalUnitId);
    setHangarFeedback({ text: res.message, isError: !res.success });
  };

  const handleRemoveFromBattlegroup = (id: string) => {
    const unit = battlegroup.find((u) => u.id === id);
    if (unit) {
      toggleBattlegroupUnit(unit);
    }
  };

  const handleUnlockPatent = async (blueprintCode: string, nextTier: number, ecCost: number) => {
    if (userEc < ecCost) {
      audioManager.playCancelRollback();
      return;
    }
    onUpdateResources?.({ ec: -ecCost });
    await unlockPatent({
      patentCode: blueprintCode,
      tier: nextTier,
      costEc: ecCost,
      costSteel: 0,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 animate-fade-in">
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-[14px_4px_14px_4px] bg-[#161712] border-3 border-[#0A0B08] shadow-[4px_4px_0px_#0A0B08] text-[#F2E8D5] overflow-hidden"
      >
        {/* ENCABEZADO C4ISR */}
        <header className="px-5 py-3.5 bg-[#2B2C24] border-b-2 border-[#0A0B08] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="DRONEPUNK" className="w-5 h-5 object-contain shrink-0" />
            <div className="w-10 h-10 rounded-[8px_2px_8px_2px] bg-[#161712] border-2 border-[#E65100] flex items-center justify-center text-[#E65100]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-[4px_1px_4px_1px] bg-[#E65100] text-black font-mono font-black text-[10px] uppercase">
                  C4ISR // HANGAR V2.0
                </span>
                <span className="text-xs font-mono text-amber-300 font-bold">
                  SISTEMA DE TROPAS FÍSICAS Y DESCARTABLES
                </span>
              </div>
              <h2 className="text-lg font-display font-black uppercase text-[#F2E8D5] tracking-wide">
                Hangar de Producción Militar & Grupo de Tareas
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* TICKER DE RECURSOS */}
            <div className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-[6px_2px_6px_2px] bg-[#161712] border border-[#7B8A4A]/50 font-mono text-xs">
              <span className="text-amber-400 font-extrabold flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                {userEc.toLocaleString()} EC
              </span>
              <span className="text-sky-300 font-extrabold flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-sky-400" />
                {userSteel}t Acero
              </span>
              <span className="text-emerald-400 font-extrabold flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                {userRareEarth}t Tierras Raras
              </span>
            </div>

            <button
              onClick={() => {
                audioManager.playSFX('button_click');
                onClose();
              }}
              className="p-1.5 rounded-[6px_2px_6px_2px] bg-[#161712] hover:bg-[#E65100] border-2 border-[#0A0B08] text-[#F2E8D5] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* NAVEGACIÓN DE PESTAÑAS */}
        <nav className="px-5 py-2 bg-[#1C1D17] border-b-2 border-[#0A0B08] flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              audioManager.playCursorMove();
              setActiveTab('inventory');
            }}
            className={`px-4 py-2 rounded-[6px_2px_6px_2px] text-xs font-display font-extrabold uppercase tracking-wider transition-all border-2 ${
              activeTab === 'inventory'
                ? 'bg-[#E65100] text-black border-[#0A0B08]'
                : 'bg-[#2B2C24] text-[#F2E8D5]/80 border-[#0A0B08] hover:text-[#F2E8D5]'
            }`}
          >
            📦 Inventario de Tropas ({hangarUnits.length})
          </button>
          <button
            onClick={() => {
              audioManager.playCursorMove();
              setActiveTab('forge');
            }}
            className={`px-4 py-2 rounded-[6px_2px_6px_2px] text-xs font-display font-extrabold uppercase tracking-wider transition-all border-2 ${
              activeTab === 'forge'
                ? 'bg-[#E65100] text-black border-[#0A0B08]'
                : 'bg-[#2B2C24] text-[#F2E8D5]/80 border-[#0A0B08] hover:text-[#F2E8D5]'
            }`}
          >
            ⚒️ Fundición & Ensamblaje
          </button>
          <button
            onClick={() => {
              audioManager.playCursorMove();
              setActiveTab('battlegroup');
            }}
            className={`px-4 py-2 rounded-[6px_2px_6px_2px] text-xs font-display font-extrabold uppercase tracking-wider transition-all border-2 ${
              activeTab === 'battlegroup'
                ? 'bg-[#E65100] text-black border-[#0A0B08]'
                : 'bg-[#2B2C24] text-[#F2E8D5]/80 border-[#0A0B08] hover:text-[#F2E8D5]'
            }`}
          >
            🎖️ Vanguardia ({vanguardCount}/4) • En Campo ({operationalUnits.length})
          </button>
          <button
            onClick={() => {
              audioManager.playCursorMove();
              setActiveTab('patents');
            }}
            className={`px-4 py-2 rounded-[6px_2px_6px_2px] text-xs font-display font-extrabold uppercase tracking-wider transition-all border-2 ${
              activeTab === 'patents'
                ? 'bg-[#E65100] text-black border-[#0A0B08]'
                : 'bg-[#2B2C24] text-[#F2E8D5]/80 border-[#0A0B08] hover:text-[#F2E8D5]'
            }`}
          >
            📜 Bóveda de Patentes
          </button>
        </nav>

        {/* CONTENIDO PRINCIPAL */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {craftSuccessMessage && (
            <div className="p-3 bg-emerald-950/80 border-2 border-emerald-500 rounded text-emerald-200 text-xs font-mono font-bold flex items-center gap-2 animate-bounce">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              {craftSuccessMessage}
            </div>
          )}

          {hangarFeedback && (
            <div
              className={`p-3 border-2 rounded text-xs font-mono font-bold flex items-center gap-2 ${
                hangarFeedback.isError
                  ? 'bg-rose-950/80 border-rose-500 text-rose-200'
                  : 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
              }`}
            >
              {hangarFeedback.isError ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span>{hangarFeedback.text}</span>
            </div>
          )}

          {/* Barra Canónica del Hangar Físico: 16 Chasis (4 Vanguardia + 12 Reserva, CERO cartas) */}
          <div className="p-2.5 bg-[#1C1D17] border border-[#2E3323] rounded flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-amber-300 font-bold uppercase">
              HANGAR FÍSICO CANÓNICO: {totalChassisCount}/16 CHASIS (CERO CARTAS)
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[#00FF66]">Vanguardia: {vanguardCount}/4</span>
              <span className="text-sky-300">Reserva: {reserveCount}/12</span>
              <span className="text-amber-400">Desplegados (DB): {operationalUnits.length}</span>
            </div>
          </div>

          {/* TAB 1: INVENTARIO DE TROPAS EN HANGAR */}
          {activeTab === 'inventory' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#F2E8D5]/80 font-mono">
                  Unidades físicas actualmente almacenadas en el complejo. Al destruirse en combate, se consumen
                  permanentemente conforme a la economía 100% impulsada por jugadores.
                </p>
                <span className="text-[11px] font-mono text-amber-400">
                  Desguace recupera el 35% del valor base en chatarra.
                </span>
              </div>

              {hangarUnits.length === 0 ? (
                <div className="p-8 text-center bg-[#2B2C24] border-2 border-[#0A0B08] rounded">
                  <p className="text-sm font-mono text-[#F2E8D5]/60 uppercase">
                    Hangar vacío. Ensambla nuevas unidades en la pestaña "Fundición".
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {hangarUnits.map((unit) => {
                    const bp = UNIT_CATALOG.find((b) => b.code === unit.unitCode) ?? UNIT_CATALOG[0];
                    const effBonus = (unit.level - 1) * 2; // +2% per level

                    return (
                      <div
                        key={unit.id}
                        className="p-3.5 bg-[#2B2C24] border-2 border-[#0A0B08] rounded-[8px_2px_8px_2px] flex flex-col justify-between gap-3 shadow-[4px_4px_0px_#0A0B08]"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 rounded bg-[#161712] text-amber-400 font-mono font-black text-[10px] border border-[#0A0B08]">
                              NIVEL {unit.level} • TIER {unit.tier}
                            </span>
                            <span className="text-xs font-mono font-extrabold text-[#00FF66]">
                              +{effBonus}% EFICIENCIA
                            </span>
                          </div>
                          <h3 className="text-base font-display font-black uppercase text-[#F2E8D5] mt-1">
                            {bp.name}
                          </h3>
                          <p className="text-[11px] text-[#F2E8D5]/70 line-clamp-2 mt-0.5">
                            {bp.description}
                          </p>

                          <div className="grid grid-cols-3 gap-2 mt-3 p-2 bg-[#161712] rounded font-mono text-[11px]">
                            <div>
                              <span className="text-[#F2E8D5]/60 block text-[9px]">INTEGRIDAD</span>
                              <span className="font-extrabold text-amber-300">
                                {unit.hp} / {MASTER_METAGAME_CONSTANTS.CANONICAL_MAX_HP} HP
                              </span>
                            </div>
                            <div>
                              <span className="text-[#F2E8D5]/60 block text-[9px]">CANTIDAD</span>
                              <span className="font-extrabold text-sky-400">{unit.quantity}x</span>
                            </div>
                            <div>
                              <span className="text-[#F2E8D5]/60 block text-[9px]">RANGO</span>
                              <span className="font-extrabold text-emerald-400">
                                {bp.rangeMin}-{bp.rangeMax}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-[#161712]">
                          <button
                            onClick={() => handleAddToBattlegroup(unit)}
                            className="flex-1 py-1.5 px-2 bg-[#46521F] hover:bg-[#586827] text-[#F2E8D5] text-[10px] font-display font-extrabold uppercase rounded border border-[#0A0B08] flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            Vanguardia
                          </button>
                          <button
                            onClick={() => handleDeployToFieldDb(unit)}
                            className="py-1.5 px-2 bg-[#E65100] hover:bg-amber-400 text-black text-[10px] font-display font-extrabold uppercase rounded border border-[#0A0B08] cursor-pointer"
                            title="Desplegar unidad operativa en DB (deploy_operational_unit)"
                          >
                            Desplegar (DB)
                          </button>
                          <button
                            onClick={() => handleSalvageScrap(unit.id)}
                            className="py-1.5 px-2 bg-[#161712] hover:bg-rose-950 text-rose-400 hover:text-rose-200 text-[10px] font-mono font-bold rounded border border-[#0A0B08] flex items-center gap-1 cursor-pointer"
                            title="Desguazar por chatarra (+35% recursos)"
                          >
                            <Trash2 className="w-3 h-3" />
                            Desguazar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FUNDICIÓN & ENSAMBLAJE DE NUEVAS UNIDADES */}
          {activeTab === 'forge' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Selector de Planos de Chasis */}
              <div className="lg:col-span-5 space-y-2">
                <h4 className="text-xs font-mono font-extrabold text-amber-400 uppercase tracking-widest">
                  SELECCIONA TIPO DE CHASIS MILITAR
                </h4>
                <div className="space-y-2">
                  {UNIT_CATALOG.map((bp) => {
                    const isSelected = bp.code === selectedBlueprintCode;
                    const patentTier = unlockedPatents.find((p) => p.patentCode === bp.code)?.tier ?? 0;

                    return (
                      <button
                        key={bp.code}
                        onClick={() => {
                          audioManager.playCursorMove();
                          setSelectedBlueprintCode(bp.code);
                        }}
                        className={`w-full text-left p-3 rounded-[6px_2px_6px_2px] border-2 transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-[#46521F] border-[#E65100] shadow-[3px_3px_0px_#0A0B08]'
                            : 'bg-[#2B2C24] border-[#0A0B08] hover:border-[#7B8A4A]'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-display font-extrabold text-sm text-[#F2E8D5] uppercase">
                              {bp.name}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#161712] text-amber-300">
                              PATENTE TIER {patentTier}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-[#F2E8D5]/70 mt-0.5">
                            ATK: {bp.baseAtk} • DEF: {bp.baseDef} • RANGO: {bp.rangeMin}-{bp.rangeMax}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-amber-300 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Parámetros de Fabricación y Costes */}
              <div className="lg:col-span-7 bg-[#2B2C24] border-2 border-[#0A0B08] p-4 rounded-[8px_2px_8px_2px] flex flex-col justify-between gap-4">
                <div className="space-y-4">
                  <div className="border-b border-[#161712] pb-3">
                    <span className="text-[10px] font-mono uppercase text-amber-400">CONFIGURACIÓN DE LÍNEA</span>
                    <h3 className="text-xl font-display font-black text-[#F2E8D5] uppercase">{selectedBp.name}</h3>
                    <p className="text-xs text-[#F2E8D5]/80 mt-1">{selectedBp.description}</p>
                  </div>

                  {/* Selector de Nivel de Tropa (1 a 5) */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-mono">
                      <span>NIVEL DE CALIBRACIÓN BALÍSTICA (1 - 5)</span>
                      <span className="text-[#00FF66] font-bold">
                        +{((selectedCraftLevel - 1) * 2)}% EFICIENCIA DE COMBATE
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {[1, 2, 3, 4, 5].map((lvl) => (
                        <button
                          key={lvl}
                          onClick={() => {
                            audioManager.playCursorMove();
                            setSelectedCraftLevel(lvl);
                          }}
                          className={`py-2 rounded font-display font-black text-xs border-2 uppercase ${
                            selectedCraftLevel === lvl
                              ? 'bg-[#E65100] text-black border-[#0A0B08]'
                              : 'bg-[#161712] text-[#F2E8D5] border-[#0A0B08] hover:bg-[#1F201A]'
                          }`}
                        >
                          Nv. {lvl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Selector de Tier Tecnológico */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-mono">
                      <span>TIER DE BLINDAJE Y PATENTE (1 - 5)</span>
                      <span className={isPatentUnlocked ? 'text-emerald-400' : 'text-rose-400'}>
                        {isPatentUnlocked
                          ? '✓ PATENTE HOMOLOGADA'
                          : `⚠ REQUIERE PATENTE TIER ${selectedCraftTier}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {[1, 2, 3, 4, 5].map((tier) => (
                        <button
                          key={tier}
                          onClick={() => {
                            audioManager.playCursorMove();
                            setSelectedCraftTier(tier);
                          }}
                          className={`py-2 rounded font-display font-black text-xs border-2 uppercase ${
                            selectedCraftTier === tier
                              ? 'bg-amber-400 text-black border-[#0A0B08]'
                              : 'bg-[#161712] text-[#F2E8D5] border-[#0A0B08] hover:bg-[#1F201A]'
                          }`}
                        >
                          T-{tier}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Selector de Cantidad */}
                  <div className="flex items-center justify-between p-2.5 bg-[#161712] rounded border border-[#0A0B08]">
                    <span className="text-xs font-mono font-bold">VOLUMEN DE PRODUCCIÓN EN SERIE:</span>
                    <div className="flex items-center gap-2">
                      {[1, 3, 5, 10].map((qty) => (
                        <button
                          key={qty}
                          onClick={() => {
                            audioManager.playCursorMove();
                            setCraftQuantity(qty);
                          }}
                          className={`px-3 py-1 rounded font-mono font-extrabold text-xs border ${
                            craftQuantity === qty
                              ? 'bg-[#46521F] text-amber-300 border-amber-300'
                              : 'bg-[#2B2C24] text-[#F2E8D5] border-[#0A0B08]'
                          }`}
                        >
                          {qty}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Hoja de Costes Requeridos */}
                  <div className="p-3 bg-[#161712] rounded border border-[#0A0B08] space-y-2">
                    <span className="text-[10px] font-mono text-[#F2E8D5]/60 uppercase">
                      RECURSOS INDUSTRIALES REQUERIDOS
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                      <div className={userSteel >= totalSteelCost ? 'text-sky-300' : 'text-rose-400 font-bold'}>
                        Acero: {totalSteelCost}t ({userSteel}t)
                      </div>
                      <div className={userRareEarth >= totalRareEarthCost ? 'text-emerald-300' : 'text-rose-400 font-bold'}>
                        T. Raras: {totalRareEarthCost}t ({userRareEarth}t)
                      </div>
                      <div className={userComposites >= totalCompositesCost ? 'text-purple-300' : 'text-rose-400 font-bold'}>
                        Compuestos: {totalCompositesCost}t ({userComposites}t)
                      </div>
                      <div className={userEc >= totalEcCost ? 'text-amber-300' : 'text-rose-400 font-bold'}>
                        Energía: {totalEcCost} EC ({userEc})
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  disabled={!canAfford || !isPatentUnlocked}
                  onClick={handleCraft}
                  className={`w-full py-3 font-display font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 ${
                    canAfford && isPatentUnlocked
                      ? 'tactical-btn-heavy cursor-pointer'
                      : 'rounded-[6px_2px_6px_2px] border-2 border-[#0A0B08] bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60'
                  }`}
                >
                  <Hammer className="w-4 h-4" />
                  ENSAMBLAR {craftQuantity}X EN LÍNEA DE FUNDICIÓN
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: GRUPO DE COMBATE (BATTLEGROUP & REFUERZOS) */}
          {activeTab === 'battlegroup' && (
            <div className="space-y-4">
              <div className="p-3 bg-[#2B2C24] border-2 border-[#0A0B08] rounded flex items-center justify-between">
                <div>
                  <h4 className="font-display font-extrabold text-sm uppercase text-[#F2E8D5]">
                    GRUPO TÁCTICO ACTIVO PARA DESPLIEGUE & REFUERZOS (T+4)
                  </h4>
                  <p className="text-xs font-mono text-[#F2E8D5]/70">
                    Estas unidades son transportadas al teatro de operaciones. Si solicitas el refuerzo único
                    en combate, llegarán en la ronda 4 desde hangares de retaguardia.
                  </p>
                </div>
                <span className="text-xs font-mono px-3 py-1 bg-[#161712] border border-[#00FF66] text-[#00FF66] rounded font-bold">
                  {battlegroup.length} / 6 SLOTS ASIGNADOS
                </span>
              </div>

              {/* Programador Visual de Gambits de Patrulla (8 Horas) */}
              <div className="p-3 bg-[#1E2219] border-2 border-[#00FF66]/60 rounded-[8px_2px_8px_2px] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-display font-black text-xs uppercase text-[#00FF66]">
                      PROGRAMADOR DE GAMBITS OFFLINE (TURNO DE 8 HORAS)
                    </h4>
                    <p className="text-[10px] font-mono text-[#A9B87A]">
                      Asigna reglas de patrulla A ↔ B, retirada ante Tanques y filtrado territorial antes de desconectarte.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-[#161712] border border-[#00FF66] text-[#00FF66] rounded font-bold">
                    SHIFT: 8H
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] font-mono">
                  <div className="p-2 bg-[#161712] border border-[#2E3323] rounded">
                    <span className="text-[#A9B87A] block mb-1">PRIORIDAD DE OBJETIVO</span>
                    <select
                      value={gambitTargetPriority}
                      onChange={(e) =>
                        setGambitTargetPriority(
                          e.target.value as DroneGambitProgram['targetPriorityRule']
                        )
                      }
                      className="w-full bg-[#2B2C24] border border-[#46521F] text-[#F2E8D5] p-1 rounded text-[10px]"
                    >
                      <option value="neutral_cells_first">Priorizar celdas neutrales</option>
                      <option value="enemy_extractors_first">Sabotear extractores rivales</option>
                      <option value="border_roads_first">Patrullar carreteras fronterizas</option>
                    </select>
                  </div>

                  <div className="p-2 bg-[#161712] border border-[#2E3323] rounded flex flex-col justify-between">
                    <span className="text-[#A9B87A] block">REGLA DE AMENAZA (FFXII)</span>
                    <label className="flex items-center gap-1.5 text-[#F2E8D5] cursor-pointer mt-1">
                      <input
                        type="checkbox"
                        checked={gambitRetreatVsTank}
                        onChange={(e) => setGambitRetreatVsTank(e.target.checked)}
                      />
                      <span>Atacar Scout / Retirarse ante Tanque</span>
                    </label>
                  </div>

                  <div className="p-2 bg-[#161712] border border-[#2E3323] rounded">
                    <span className="text-[#A9B87A] block mb-1">
                      ABORTAR SI CONTROL ENEMIGO &gt; {gambitMaxEnemyControl}%
                    </span>
                    <input
                      type="range"
                      min={50}
                      max={90}
                      step={5}
                      value={gambitMaxEnemyControl}
                      onChange={(e) => setGambitMaxEnemyControl(Number(e.target.value))}
                      className="w-full accent-[#00FF66]"
                    />
                  </div>
                </div>

                  <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      audioManager.playCue('ui_tile_confirm');
                      setGambitSavedMsg(
                        `Gambit 8h guardado: ${gambitTargetPriority} | Retirada ante Tanque=${gambitRetreatVsTank ? 'ON' : 'OFF'} | Límite enemigo=${gambitMaxEnemyControl}%`
                      );
                    }}
                    className="px-3 py-1.5 bg-[#00FF66] hover:bg-[#33ff85] text-black font-display font-black text-[10px] uppercase rounded border border-[#0A0B08] cursor-pointer"
                  >
                    GUARDAR RUTINA DE PATRULLA (8H)
                  </button>
                  {gambitSavedMsg && (
                    <span className="text-[10px] font-mono text-[#00FF66] truncate">
                      {gambitSavedMsg}
                    </span>
                  )}
                </div>

                {/* Zonas A, B y C: Presets H3, Cartuchos Gambits, Código de Doctrina y Simulador Dry-Run */}
                <div className="pt-2.5 border-t border-[#2E3323] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-mono font-bold text-amber-300 uppercase">
                      ZONA A/B/C • CARTUCHOS H3 (4-6 RANURAS) + CÓDIGO DE DOCTRINA + DRY-RUN
                    </span>
                    <div className="flex items-center gap-1">
                      {(['NIGHT_PAINTER', 'WATCHDOG', 'SABOTEUR'] as const).map((presetKey) => (
                        <button
                          key={presetKey}
                          type="button"
                          onClick={() => {
                            audioManager.playHoverTick();
                            const preset = HANGAR_GAMBIT_PRESETS[presetKey];
                            setSelectedPresetId(presetKey);
                            setActiveDoctrineRules(preset.rules);
                            setDoctrineCodeInput(encodeDoctrineLocal(preset));
                          }}
                          className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border cursor-pointer ${
                            selectedPresetId === presetKey
                              ? 'bg-amber-400 text-black border-[#0A0B08]'
                              : 'bg-[#161712] text-[#F2E8D5] border-[#2E3323]'
                          }`}
                        >
                          {HANGAR_GAMBIT_PRESETS[presetKey].name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pila de Prioridades (Zona B) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {activeDoctrineRules.map((rule) => (
                      <div
                        key={rule.slot}
                        className="p-1.5 bg-[#161712] border border-[#2E3323] rounded text-[10px] font-mono flex items-center justify-between gap-2"
                      >
                        <span className="text-amber-300 font-bold">SLOT {rule.slot}:</span>
                        <span className="text-[#F2E8D5] truncate">
                          SI [{rule.condition}] → {rule.action}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Exportador / Importador de Código de Doctrina + Botón Dry-Run (Zona C) */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={doctrineCodeInput}
                      onChange={(e) => setDoctrineCodeInput(e.target.value)}
                      className="flex-1 px-2 py-1 bg-[#161712] border border-[#46521F] text-[#00FF66] font-mono text-[10px] rounded"
                      aria-label="Código de Doctrina"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const decoded = decodeDoctrineLocal(doctrineCodeInput);
                          setActiveDoctrineRules(decoded.rules);
                          setGambitSavedMsg(`Doctrina "${decoded.name}" importada (${decoded.rules.length} slots).`);
                          audioManager.playCue('ui_tile_confirm');
                        } catch {
                          setGambitSavedMsg('Código de Doctrina inválido.');
                          audioManager.playCue('ui_cancel_rollback');
                        }
                      }}
                      className="px-2.5 py-1 bg-[#2B2C24] hover:bg-[#383A2E] border border-[#7B8A4A] text-amber-300 font-mono font-bold text-[10px] uppercase rounded cursor-pointer"
                    >
                      IMPORTAR DOCTRINA
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        audioManager.playHoverTick();
                        const overload = calculateAdministrativeOverloadFuelMultiplier({
                          controlledStatesCount: 2,
                        });
                        const burnPerHour =
                          (selectedPresetId === 'NIGHT_PAINTER' ? 4 : selectedPresetId === 'WATCHDOG' ? 8 : 1) *
                          overload.netFuelMultiplier;
                        const conquestPerHour =
                          selectedPresetId === 'NIGHT_PAINTER' ? 25 : selectedPresetId === 'WATCHDOG' ? 10 : 15;
                        const maxFuel = 40;
                        setDryRunResult(
                          ([4, 8, 12] as const).map((h) => {
                            const remFuel = Math.max(0, Number((maxFuel - burnPerHour * h).toFixed(1)));
                            const hpLoss = remFuel <= 0 ? (h - maxFuel / Math.max(1, burnPerHour)) * 2 : 0;
                            return {
                              hours: h,
                              remainingFuel: remFuel,
                              remainingHp10: Math.max(0, Number((10 - hpLoss).toFixed(1))),
                              capturedHexes: Math.round(conquestPerHour * Math.min(h, maxFuel / Math.max(1, burnPerHour))),
                            };
                          })
                        );
                      }}
                      className="px-2.5 py-1 bg-[#E65100] hover:bg-amber-400 text-black font-display font-black text-[10px] uppercase rounded border border-[#0A0B08] cursor-pointer"
                    >
                      SIMULAR DRY-RUN (4H / 8H / 12H)
                    </button>
                  </div>

                  {dryRunResult && (
                    <div className="grid grid-cols-3 gap-2">
                      {dryRunResult.map((cp) => (
                        <div
                          key={cp.hours}
                          className="p-2 bg-[#161712] border border-[#2E3323] rounded text-[10px] font-mono"
                        >
                          <div className="text-amber-300 font-bold">PROYECCIÓN {cp.hours}H</div>
                          <div className="text-[#00FF66]">+{cp.capturedHexes} hex H3</div>
                          <div className={cp.remainingFuel <= 0 ? 'text-red-400' : 'text-sky-300'}>
                            CB: {cp.remainingFuel} • {cp.remainingHp10}/10 HP
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Unidades Operativas Desplegadas en DB (recall_operational_unit) */}
              <div className="p-3 bg-[#1C1D17] border border-[#2E3323] rounded space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-amber-300 uppercase">
                    CHASIS DESPLEGADOS EN CAMPO (DB: {operationalUnits.length})
                  </span>
                  <span className="text-[10px] font-mono text-[#F2E8D5]/60">
                    Retirar devuelve el chasis a la Reserva (12 slots)
                  </span>
                </div>
                {operationalUnits.length === 0 ? (
                  <p className="text-[11px] font-mono text-[#F2E8D5]/60">
                    No hay chasis desplegados actualmente en operational_units.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {operationalUnits.map((op) => (
                      <div
                        key={op.id}
                        className="p-2.5 bg-[#2B2C24] border border-[#0A0B08] rounded flex items-center justify-between gap-2 text-xs font-mono"
                      >
                        <div>
                          <div className="font-bold text-white uppercase">
                            {op.unit_code} • T{op.tier}
                          </div>
                          <div className="text-[10px] text-emerald-400">
                            HP {op.hp}/100 • H3 #{op.h3_index}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRecallToHangarDb(op.id)}
                          className="px-2.5 py-1 bg-[#161712] hover:bg-[#46521F] text-amber-300 border border-[#0A0B08] rounded text-[10px] font-bold uppercase cursor-pointer"
                        >
                          Retirar a Reserva (DB)
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {battlegroup.length === 0 ? (
                <div className="p-8 text-center bg-[#2B2C24] border-2 border-[#0A0B08] rounded">
                  <p className="text-sm font-mono text-[#F2E8D5]/60 uppercase">
                    Sin unidades asignadas al grupo de combate. Ve al "Inventario de Tropas" y asigna blindados.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {battlegroup.map((unit) => {
                    const bp = UNIT_CATALOG.find((b) => b.code === unit.unitCode) ?? UNIT_CATALOG[0];
                    return (
                      <div
                        key={unit.id}
                        className="p-3 bg-[#2B2C24] border-2 border-[#0A0B08] rounded flex items-center justify-between gap-3 shadow-[3px_3px_0px_#0A0B08]"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono px-1.5 bg-[#161712] text-amber-400 font-bold rounded">
                              Nv. {unit.level}
                            </span>
                            <span className="text-xs font-display font-bold uppercase text-[#F2E8D5]">
                              {bp.name}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-emerald-400 block mt-1">
                            {unit.hp}/100 HP • Tier {unit.tier}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveFromBattlegroup(unit.id)}
                          className="p-1.5 bg-[#161712] hover:bg-rose-900 border border-[#0A0B08] text-rose-300 rounded"
                          title="Retirar del grupo activo"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: BÓVEDA DE PATENTES */}
          {activeTab === 'patents' && (
            <div className="space-y-4">
              <p className="text-xs font-mono text-[#F2E8D5]/80">
                Las patentes permiten homologar chasis de mayores Tiers tecnológicos. Las patentes pueden ser
                intercambiadas en el Mercado P2P entre corporaciones aliadas.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {UNIT_CATALOG.map((bp) => {
                  const currentTier = unlockedPatents.find((p) => p.patentCode === bp.code)?.tier ?? 0;
                  const nextTier = currentTier + 1;
                  const upgradeCost = nextTier * 250;

                  return (
                    <div
                      key={bp.code}
                      className="p-4 bg-[#2B2C24] border-2 border-[#0A0B08] rounded-[8px_2px_8px_2px] flex items-center justify-between shadow-[4px_4px_0px_#0A0B08]"
                    >
                      <div>
                        <span className="text-[10px] font-mono px-2 py-0.5 bg-[#161712] text-amber-300 rounded border border-[#0A0B08]">
                          CATEGORÍA {bp.category.toUpperCase()}
                        </span>
                        <h4 className="text-base font-display font-black text-[#F2E8D5] uppercase mt-1">
                          {bp.name}
                        </h4>
                        <span className="text-xs font-mono text-[#00FF66] block mt-0.5">
                          Nivel de Patente Actual: Tier {currentTier} / 5
                        </span>
                      </div>

                      {nextTier <= 5 ? (
                        <button
                          disabled={userEc < upgradeCost}
                          onClick={() => handleUnlockPatent(bp.code, nextTier, upgradeCost)}
                          className={`px-3 py-2 rounded text-xs font-display font-extrabold uppercase border-2 border-[#0A0B08] ${
                            userEc >= upgradeCost
                              ? 'bg-amber-400 hover:bg-amber-300 text-black shadow-[2px_2px_0px_#0A0B08]'
                              : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                          }`}
                        >
                          Desbloquear T-{nextTier} ({upgradeCost} EC)
                        </button>
                      ) : (
                        <span className="text-xs font-mono text-emerald-400 font-bold px-2 py-1 bg-[#161712] rounded border border-emerald-500">
                          MAX TIER 5
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
