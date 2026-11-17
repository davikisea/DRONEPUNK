import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Menu,
  X,
  Layers,
  ScrollText,
  Radio,
  Settings,
  Globe,
  Map as MapIcon,
  MapPin,
  Crosshair,
  Volume2,
  VolumeX,
  Monitor,
  Palette,
  Sparkles,
  Wrench,
  Activity,
} from 'lucide-react';
import { audioManager } from '@domains/game-feel';
import type { MapScaleLevel } from '../types/mapSelectionTypes';

export type LeftRailTab = 'layers' | 'feed' | 'radionet' | 'settings';

export interface LeftRailLogEntry {
  id: string;
  timestamp: string;
  headline: string;
  detail: string;
}

export interface LeftCollapsibleRailProps {
  currentScale: MapScaleLevel;
  currentZoom: number;
  onJumpToScale: (scale: MapScaleLevel) => void;
  logs: LeftRailLogEntry[];
  resolvedClanTag: string;
  isAudioMuted: boolean;
  onToggleAudio: () => void;
  isCrtActive: boolean;
  onToggleCrt: () => void;
  isReducedMotion: boolean;
  onToggleReducedMotion: () => void;
  onOpenHangar: () => void;
  onOpenWheel: () => void;
  onOpenEditor?: () => void;
  onInspectAlly: (allyName: string, sector: string) => void;
  onTransferSupplyToAlly: (allyName: string) => void;
  onCoordinateAlly: (allyName: string) => void;
  onOpenRecruitModal: () => void;
}

export const LeftCollapsibleRail: React.FC<LeftCollapsibleRailProps> = ({
  currentScale,
  currentZoom,
  onJumpToScale,
  logs,
  resolvedClanTag,
  isAudioMuted,
  onToggleAudio,
  isCrtActive,
  onToggleCrt,
  isReducedMotion,
  onToggleReducedMotion,
  onOpenHangar,
  onOpenWheel,
  onOpenEditor,
  onInspectAlly,
  onTransferSupplyToAlly,
  onCoordinateAlly,
  onOpenRecruitModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<LeftRailTab>('layers');

  return (
    <aside
      aria-label="Rail de Mando Izquierdo"
      data-testid="left-collapsible-rail"
      className="fixed top-14 left-3 z-30 flex flex-col items-start gap-1.5 select-none max-h-[calc(100vh-335px)] pointer-events-none"
    >
      {/* Botón Toggle Compacto */}
      <div className="pointer-events-auto flex items-center gap-1.5">
        <button
          type="button"
          data-testid="left-rail-toggle"
          onMouseEnter={() => audioManager.playHoverTick()}
          onClick={() => {
            audioManager.playSFX('button_click');
            setIsOpen((prev) => !prev);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px_2px_8px_2px] border text-[11px] font-mono font-black uppercase tracking-wider shadow-[3px_3px_0px_#0A0B08] backdrop-blur-md cursor-pointer transition-colors ${
            isOpen
              ? 'bg-[#46521F] border-amber-400 text-[#F2E8D5]'
              : 'bg-[#0E100C]/92 border-[#46521F] hover:border-[#7B8A4A] text-[#F2E8D5]'
          }`}
          title="Desplegar/Colapsar Menú Táctico Izquierdo"
        >
          {isOpen ? <X className="w-3.5 h-3.5 text-amber-300" /> : <Menu className="w-3.5 h-3.5 text-[#00FF66]" />}
          <span>C4ISR</span>
          <span className="text-[9px] text-[#A9B87A] font-bold">
            • Z{currentZoom.toFixed(1)}
          </span>
        </button>

        {/* Píldora Compacta de Zoom / Escala Activa */}
        <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-[6px_2px_6px_2px] bg-[#0E100C]/85 border border-[#46521F]/70 text-[10px] font-mono text-[#A9B87A] backdrop-blur-sm">
          <Activity className="w-3 h-3 text-[#00FF66]" />
          <span className="uppercase font-bold text-[#F2E8D5]">
            {currentScale === 'country'
              ? 'ESCALA: PAÍS'
              : currentScale === 'state'
              ? 'ESCALA: ESTADO'
              : currentScale === 'municipality'
              ? 'ESCALA: MUNICIPIO'
              : 'ESCALA: CELDA 20×20'}
          </span>
        </div>
      </div>

      {/* Panel Desplegable Izquierdo (Altura restringida para nunca tapar Mayor Stella en bottom-left) */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: -14, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -14, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            data-testid="left-rail-drawer"
            className="pointer-events-auto w-[300px] sm:w-[320px] max-h-[calc(100vh-390px)] bg-[#0E100C]/95 backdrop-blur-md border-2 border-[#46521F] rounded-[12px_4px_12px_4px] shadow-[6px_6px_0px_#0A0B08] flex flex-col overflow-hidden text-[#F2E8D5]"
          >
            {/* Pestañas del Rail Izquierdo */}
            <div className="grid grid-cols-4 bg-[#161712] border-b border-[#46521F]/60 p-1 gap-1 text-[9px] font-mono font-black uppercase shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('layers')}
                className={`py-1.5 rounded flex flex-col items-center gap-0.5 cursor-pointer ${
                  activeTab === 'layers'
                    ? 'bg-[#46521F] text-amber-300'
                    : 'text-[#A9B87A] hover:bg-[#1E2019]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>CAPAS</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('feed')}
                className={`py-1.5 rounded flex flex-col items-center gap-0.5 cursor-pointer ${
                  activeTab === 'feed'
                    ? 'bg-[#46521F] text-amber-300'
                    : 'text-[#A9B87A] hover:bg-[#1E2019]'
                }`}
              >
                <ScrollText className="w-3.5 h-3.5" />
                <span>FEED</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('radionet')}
                className={`py-1.5 rounded flex flex-col items-center gap-0.5 cursor-pointer ${
                  activeTab === 'radionet'
                    ? 'bg-[#46521F] text-amber-300'
                    : 'text-[#A9B87A] hover:bg-[#1E2019]'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>RADIO</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`py-1.5 rounded flex flex-col items-center gap-0.5 cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-[#46521F] text-amber-300'
                    : 'text-[#A9B87A] hover:bg-[#1E2019]'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>AJUSTES</span>
              </button>
            </div>

            {/* Contenido Scrollable */}
            <div className="p-2.5 overflow-y-auto space-y-2.5 text-[11px] font-mono">
              {activeTab === 'layers' && (
                <div className="space-y-2">
                  <div className="text-[10px] text-[#A9B87A] uppercase font-bold">
                    Conmutador Rápido de Escala (4 Niveles)
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onJumpToScale('country')}
                      className={`p-2 rounded border text-left cursor-pointer flex items-center gap-1.5 ${
                        currentScale === 'country'
                          ? 'bg-[#46521F] border-amber-400 text-amber-300'
                          : 'bg-[#181914] border-[#2E3323] hover:border-[#7B8A4A]'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <div>
                        <div className="font-black text-[10px]">PAÍS</div>
                        <div className="text-[8px] text-[#A9B87A]">Macro z=4.5</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onJumpToScale('state')}
                      className={`p-2 rounded border text-left cursor-pointer flex items-center gap-1.5 ${
                        currentScale === 'state'
                          ? 'bg-[#46521F] border-amber-400 text-amber-300'
                          : 'bg-[#181914] border-[#2E3323] hover:border-[#7B8A4A]'
                      }`}
                    >
                      <MapIcon className="w-3.5 h-3.5 shrink-0" />
                      <div>
                        <div className="font-black text-[10px]">ESTADO</div>
                        <div className="text-[8px] text-[#A9B87A]">Teatro z=6.2</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onJumpToScale('municipality')}
                      className={`p-2 rounded border text-left cursor-pointer flex items-center gap-1.5 ${
                        currentScale === 'municipality'
                          ? 'bg-[#46521F] border-amber-400 text-amber-300'
                          : 'bg-[#181914] border-[#2E3323] hover:border-[#7B8A4A]'
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <div>
                        <div className="font-black text-[10px]">MUNICIPIO</div>
                        <div className="text-[8px] text-[#A9B87A]">Zulia z=10.5</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onJumpToScale('cell')}
                      className={`p-2 rounded border text-left cursor-pointer flex items-center gap-1.5 ${
                        currentScale === 'cell'
                          ? 'bg-[#46521F] border-amber-400 text-amber-300'
                          : 'bg-[#181914] border-[#2E3323] hover:border-[#7B8A4A]'
                      }`}
                    >
                      <Crosshair className="w-3.5 h-3.5 shrink-0" />
                      <div>
                        <div className="font-black text-[10px]">CELDA 20×20</div>
                        <div className="text-[8px] text-[#A9B87A]">Táctico z=15.2</div>
                      </div>
                    </button>
                  </div>

                  {/* Estado de Capas Canónicas */}
                  <div className="grid grid-cols-3 gap-1 text-[8px] font-bold pt-1">
                    <div className="px-1.5 py-1 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-center truncate">
                      L1: POLÍTICA ON
                    </div>
                    <div className="px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-400 text-center truncate">
                      L2: BATALLA OFF
                    </div>
                    <div className="px-1.5 py-1 rounded bg-amber-950/70 border border-amber-500/40 text-amber-300 text-center truncate">
                      L3: STELLA
                    </div>
                  </div>

                  {/* Utilidades Rápidas */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={onOpenHangar}
                      className="px-2 py-1.5 rounded bg-[#181914] hover:bg-[#2B2C24] border border-[#46521F] text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Palette className="w-3.5 h-3.5 text-sky-400" />
                      <span>Hangar 16</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenWheel}
                      className="px-2 py-1.5 rounded bg-[#181914] hover:bg-[#2B2C24] border border-[#46521F] text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Rotor [R]</span>
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'feed' && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-amber-300 uppercase font-bold">
                    Bitácora Geopolítica del Teatro
                  </div>
                  {logs.slice(0, 6).map((log) => (
                    <div
                      key={log.id}
                      className="p-2 rounded bg-[#181914] border border-[#2E3323] space-y-0.5"
                    >
                      <div className="flex items-center justify-between text-[9px] text-amber-300 font-bold">
                        <span className="truncate">{log.headline}</span>
                        <span className="text-[#7B8A4A] shrink-0 ml-1">{log.timestamp}</span>
                      </div>
                      <p className="text-[9px] text-[#D8D1C5] leading-snug">{log.detail}</p>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'radionet' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-[#00FF66] font-bold">
                    <span>RADIO-NET // ONLINE</span>
                    <span className="text-amber-300">{resolvedClanTag}</span>
                  </div>

                  <div className="p-2 rounded bg-[#181914] border border-[#2E3323] flex items-center justify-between">
                    <div>
                      <div className="font-bold text-[#F2E8D5]">Carlos • NVL.18</div>
                      <div className="text-[9px] text-[#A9B87A]">Sector Bravo</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onInspectAlly('Carlos', 'Sector Bravo')}
                      className="px-2 py-1 rounded bg-[#2B2C24] hover:border-amber-400 border border-[#7B8A4A] text-[9px] font-bold cursor-pointer"
                    >
                      Inspeccionar
                    </button>
                  </div>

                  <div className="p-2 rounded bg-[#181914] border border-[#2E3323] flex items-center justify-between">
                    <div>
                      <div className="font-bold text-[#F2E8D5]">Ana • NVL.50</div>
                      <div className="text-[9px] text-[#A9B87A]">Logística Costa Oriental</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTransferSupplyToAlly('Ana')}
                      className="px-2 py-1 rounded bg-[#C46A3A] hover:bg-[#d87744] text-[#F2E8D5] text-[9px] font-bold cursor-pointer"
                    >
                      +25t Acero
                    </button>
                  </div>

                  <div className="p-2 rounded bg-[#181914] border border-[#2E3323] flex items-center justify-between">
                    <div>
                      <div className="font-bold text-[#F2E8D5]">Luis • NVL.53</div>
                      <div className="text-[9px] text-[#A9B87A]">Escuadrón Vanguardia</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onCoordinateAlly('Luis')}
                      className="px-2 py-1 rounded bg-[#2B2C24] hover:border-amber-400 border border-[#7B8A4A] text-[9px] font-bold cursor-pointer"
                    >
                      Coordinar
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={onOpenRecruitModal}
                    className="w-full py-1.5 rounded border border-dashed border-[#C46A3A] text-amber-300 text-[10px] font-bold cursor-pointer hover:bg-[#181914]"
                  >
                    + Código de Reclutamiento {resolvedClanTag}
                  </button>
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={onToggleAudio}
                    className="w-full p-2 rounded bg-[#181914] hover:bg-[#2B2C24] border border-[#2E3323] flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      {isAudioMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-[#00FF66]" />}
                      <span>Audio WebAudio</span>
                    </span>
                    <span className="text-[9px] font-bold text-amber-300">
                      {isAudioMuted ? 'SILENCIADO' : 'ACTIVO'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleCrt}
                    className="w-full p-2 rounded bg-[#181914] hover:bg-[#2B2C24] border border-[#2E3323] flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5 text-sky-400" />
                      <span>Filtro Scanlines CRT</span>
                    </span>
                    <span className="text-[9px] font-bold text-amber-300">
                      {isCrtActive ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleReducedMotion}
                    className="w-full p-2 rounded bg-[#181914] hover:bg-[#2B2C24] border border-[#2E3323] flex items-center justify-between cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Movimiento Reducido</span>
                    </span>
                    <span className="text-[9px] font-bold text-amber-300">
                      {isReducedMotion ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  {onOpenEditor && (
                    <button
                      type="button"
                      onClick={onOpenEditor}
                      className="w-full p-2 rounded bg-[#181914] hover:bg-[#2B2C24] border border-[#46521F] flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5 text-[#C46A3A]" />
                        <span>Estudio Táctico [E]</span>
                      </span>
                      <span className="text-[9px] text-amber-300">ABRIR</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
};
