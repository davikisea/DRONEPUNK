/**
 * ==============================================================================
 * DUAL RESOURCE HEADER (C4ISR DUAL CONTROL BAR)
 * ==============================================================================
 * Conforme a @tactical-command-intel y docs/07_MASTER_UI_UX_WAR_ROOM.md
 * - Bloque Izquierdo: Recursos Individuales ($G, EC, tech_scrap, Rango/Nivel)
 * - Bloque Derecho: Recursos de Facción (Estandarte de Clan, Bóveda, Manpower/Stock, TCP)
 * ==============================================================================
 */

import React from 'react';
import {
  Coins,
  Zap,
  Wrench,
  Globe,
  Radio,
  LogIn,
  Hammer,
  Gem,
  Clock,
  Crosshair,
} from 'lucide-react';
import { TacticalGhostBar } from './TacticalGhostBar';
import { audioManager } from '@domains/game-feel';

export interface DualResourceHeaderProps {
  // Recursos Individuales
  userGold: number;
  userEnergyEc: number;
  maxEnergyEc?: number;
  userTechScrap: number;
  userSteel?: number;
  userRareEarth?: number;
  userComposites?: number;
  userLevel: number;
  userXp: number;
  nextLevelXp: number;
  userTrophies?: number;
  activeStreak?: number;
  cycleTimerText?: string;

  // Recursos de Facción / Corporación
  clanTag?: string;
  clanName?: string;
  clanEmblem?: string;
  clanColor?: string;
  clanVaultEc?: number;
  clanSharedStockCount?: number;
  factionTcpControl?: number; // e.g. 6800 de 10000

  // Estado y Navegación
  isGuestMode?: boolean;
  onOpenAuthModal?: () => void;
  onOpenProfile?: () => void;
  onToggleDrawer?: () => void;
  isDrawerOpen?: boolean;
  onSelectCountryScale?: () => void;
}

export const DualResourceHeader: React.FC<DualResourceHeaderProps> = ({
  userGold,
  userEnergyEc,
  maxEnergyEc = 1000,
  userTechScrap,
  userSteel = 420,
  userRareEarth = 140,
  userLevel,
  userXp,
  nextLevelXp,
  cycleTimerText = '04:59',
  clanTag = 'IVS',
  clanName = 'Iron Vanguard Syndicate',
  clanEmblem = '🛡️',
  clanColor = '#3B82F6',
  clanVaultEc = 45000,
  clanSharedStockCount = 14,
  factionTcpControl = 7200,
  isGuestMode = false,
  onOpenAuthModal,
  onOpenProfile,
  onToggleDrawer,
  isDrawerOpen = false,
  onSelectCountryScale,
}) => {
  return (
    <header
      data-testid="persistent-top-header"
      className="fixed top-0 left-0 right-0 h-12 z-30 px-3 flex items-center justify-between gap-2 max-w-full bg-[#0E100C]/90 backdrop-blur-md border-b border-[#46521F] shadow-[0_3px_0px_rgba(10,11,8,0.85)] shrink-0 select-none"
    >
      {/* -------------------------------------------------------------------- */}
      {/* BLOQUE IZQUIERDO: IDENTIDAD DE MANDO + RECURSOS TABULARES            */}
      {/* -------------------------------------------------------------------- */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Insignia Oficial de Marca DRONEPUNK */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-[#181914] border border-[#C46A3A]/60 rounded-[6px_2px_6px_2px] shrink-0">
          <img src="/icon.svg" alt="DRONEPUNK" className="w-6 h-6 object-contain" />
          <span className="hidden sm:inline font-display font-black text-[11px] tracking-wider uppercase text-[#F2E8D5]">
            DRONEPUNK
          </span>
        </div>

        {/* Insignia de Nivel y Rango */}
        <button
          type="button"
          onClick={() => {
            audioManager.play('menu_select');
            onOpenProfile?.();
          }}
          className="flex items-center gap-1.5 px-2 py-1 bg-[#1B1D17] hover:bg-[#2B2C24] border border-[#7B8A4A] rounded-[6px_2px_6px_2px] transition-transform active:scale-95 text-left cursor-pointer shrink-0"
          title="Ver Expediente de Mando [P]"
        >
          <div className="w-6 h-6 rounded-[4px_1px_4px_1px] bg-[#46521F] border border-[#7B8A4A] flex items-center justify-center font-black text-[11px] text-[#F2E8D5]">
            N{userLevel}
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-wider text-[#F2E8D5] leading-none">
              {userLevel >= 8 ? 'VETERANO' : userLevel >= 4 ? 'SARGENTO' : userLevel >= 2 ? 'CABO' : 'RECLUTA'}
            </span>
            <div className="w-14 mt-1">
              <TacticalGhostBar
                value={userXp}
                max={nextLevelXp}
                variant="xp"
                showNumericLabel={false}
              />
            </div>
          </div>
        </button>

        {/* Acceso Directo Escala País */}
        {onSelectCountryScale && (
          <button
            type="button"
            data-testid="header-country-btn"
            onClick={() => {
              audioManager.play('menu_select');
              onSelectCountryScale();
            }}
            className="hidden md:flex items-center gap-1 px-2 py-1 bg-[#181914] hover:bg-[#25271F] border border-[#46521F] hover:border-amber-400 rounded text-[10px] font-mono font-bold text-amber-300 cursor-pointer shrink-0"
            title="Inspeccionar País (Escala Nacional)"
          >
            <Globe className="w-3 h-3" />
            <span>VENEZUELA</span>
          </button>
        )}

        {/* Contadores de Recursos Individuales (EC, Acero, Tierras Raras, Chatarra, $G) */}
        <div className="flex items-center gap-1.5 overflow-x-auto tabular-nums">
          <div
            className="flex items-center gap-1 px-2 py-1 bg-[#181914] border border-[#2E3323] rounded text-[11px] font-mono"
            title={`Créditos Energéticos (EC): ${userEnergyEc}/${maxEnergyEc}`}
          >
            <Zap className="w-3 h-3 text-[#00FF66] shrink-0" />
            <span className="font-black text-[#00FF66]">{userEnergyEc.toLocaleString()}</span>
            <span className="text-[9px] text-[#7B8A4A] font-bold">EC</span>
          </div>

          <div
            className="flex items-center gap-1 px-2 py-1 bg-[#181914] border border-[#2E3323] rounded text-[11px] font-mono"
            title="Acero Refinado"
          >
            <Hammer className="w-3 h-3 text-sky-300 shrink-0" />
            <span className="font-black text-[#F2E8D5]">{userSteel.toLocaleString()}t</span>
          </div>

          <div
            className="hidden sm:flex items-center gap-1 px-2 py-1 bg-[#181914] border border-[#2E3323] rounded text-[11px] font-mono"
            title="Tierras Raras"
          >
            <Gem className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="font-black text-cyan-200">{userRareEarth.toLocaleString()}</span>
          </div>

          <div
            className="hidden lg:flex items-center gap-1 px-2 py-1 bg-[#181914] border border-[#2E3323] rounded text-[11px] font-mono"
            title="Chatarra Tecnológica (tech_scrap)"
          >
            <Wrench className="w-3 h-3 text-[#C46A3A] shrink-0" />
            <span className="font-black text-[#F2E8D5]">{userTechScrap.toLocaleString()}</span>
            <span className="text-[8px] text-[#C46A3A] font-bold">SCRAP</span>
          </div>

          <div
            className="flex items-center gap-1 px-2 py-1 bg-[#181914] border border-[#2E3323] rounded text-[11px] font-mono"
            title="Fondos Tácticos ($G)"
          >
            <Coins className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="font-black text-amber-300">${userGold.toLocaleString()}</span>
          </div>

          <div
            className="hidden md:flex items-center gap-1 px-2 py-1 bg-[#181914] border border-[#2E3323] rounded text-[10px] font-mono text-[#A9B87A]"
            title="Temporizador de Ciclo Macroeconómico"
          >
            <Clock className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="font-bold text-[#F2E8D5]">{cycleTimerText}</span>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* BLOQUE DERECHO: CORPORACIÓN / FACCIÓN + TOGGLE INSPECTOR             */}
      {/* -------------------------------------------------------------------- */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isGuestMode ? (
          <button
            type="button"
            onClick={() => {
              audioManager.play('menu_confirm');
              onOpenAuthModal?.();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#C46A3A] hover:bg-[#d67845] text-[#F2E8D5] font-black text-[11px] uppercase tracking-wider border border-[#F2E8D5] rounded cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Ingresar</span>
          </button>
        ) : (
          <>
            {/* Estandarte y Bóveda del Clan */}
            <div
              className="hidden xl:flex items-center gap-2 px-2 py-0.5 bg-[#181914] border border-[#46521F] rounded"
              style={{ borderLeftColor: clanColor, borderLeftWidth: '3px' }}
              title={`Corporación Militar: ${clanTag} ${clanName} • Bóveda: ${clanVaultEc.toLocaleString()} EC • ${clanSharedStockCount} Chasis`}
            >
              <span className="text-xs">{clanEmblem}</span>
              <span className="font-black text-[11px] text-[#F2E8D5]">{clanTag}</span>
              <span className="text-[10px] text-[#00FF66] font-mono font-bold tabular-nums">
                {clanVaultEc.toLocaleString()} EC
              </span>
            </div>

            {/* Puntos de Control Territorial (TCP) */}
            <div
              className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-[#181914] border border-[#2E3323] rounded text-[10px] font-mono"
              title={`Control Territorial de Facción: ${factionTcpControl}/10000 TCP`}
            >
              <Radio className="w-3 h-3 text-[#00FF66]" />
              <span className="font-black text-[#00FF66] tabular-nums">{factionTcpControl} TCP</span>
            </div>

            {/* Toggle Inspector Derecho */}
            <button
              type="button"
              data-testid="toggle-inspector-header-btn"
              onClick={() => {
                audioManager.play('menu_select');
                onToggleDrawer?.();
              }}
              className={`flex items-center gap-1 px-2.5 py-1 font-mono font-black text-[10px] uppercase tracking-wider border rounded cursor-pointer transition-colors ${
                isDrawerOpen
                  ? 'bg-[#46521F] border-amber-400 text-amber-300'
                  : 'bg-[#1B1D17] hover:bg-[#2B2C24] border-[#7B8A4A] text-[#F2E8D5]'
              }`}
              title="Mostrar/Ocultar Inspector Derecho"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">INSPECTOR</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
