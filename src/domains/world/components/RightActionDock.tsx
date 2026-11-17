import React from 'react';
import {
  ShoppingBag,
  Factory,
  Palette,
  Scale,
  Shield,
  FileText,
} from 'lucide-react';
import { audioManager } from '@domains/game-feel';
import type { LobbyBarkIntent } from '@domains/game-feel';
import type { LobbyStationView } from './TacticalDock';

export interface RightActionDockProps {
  activeStation?: LobbyStationView | null;
  onNavigate: (view: LobbyStationView) => void;
  onHoverIntent?: (intent: LobbyBarkIntent | null) => void;
}

const RIGHT_DOCK_ITEMS: {
  id: LobbyStationView;
  hotkey: string;
  label: string;
  icon: React.ReactNode;
  accentBorder: string;
  intent: LobbyBarkIntent;
}[] = [
  {
    id: 'shop',
    hotkey: '1',
    label: 'TIENDA',
    icon: <ShoppingBag className="w-3.5 h-3.5 text-purple-400" />,
    accentBorder: 'hover:border-purple-400',
    intent: 'hover_shop',
  },
  {
    id: 'industry',
    hotkey: '2',
    label: 'INDUSTRIA',
    icon: <Factory className="w-3.5 h-3.5 text-[#C46A3A]" />,
    accentBorder: 'hover:border-[#C46A3A]',
    intent: 'hover_industry',
  },
  {
    id: 'armory',
    hotkey: '3',
    label: 'ARMERÍA',
    icon: <Palette className="w-3.5 h-3.5 text-sky-400" />,
    accentBorder: 'hover:border-sky-400',
    intent: 'hover_armory',
  },
  {
    id: 'marketplace',
    hotkey: '4',
    label: 'P2P',
    icon: <Scale className="w-3.5 h-3.5 text-amber-400" />,
    accentBorder: 'hover:border-amber-400',
    intent: 'hover_marketplace',
  },
  {
    id: 'clans',
    hotkey: '5',
    label: 'ALIANZA',
    icon: <Shield className="w-3.5 h-3.5 text-emerald-400" />,
    accentBorder: 'hover:border-emerald-400',
    intent: 'hover_clans',
  },
  {
    id: 'docs',
    hotkey: '6',
    label: 'DOCTRINA',
    icon: <FileText className="w-3.5 h-3.5 text-[#F2E8D5]" />,
    accentBorder: 'hover:border-[#F2E8D5]',
    intent: 'hover_docs',
  },
];

export const RightActionDock: React.FC<RightActionDockProps> = ({
  activeStation = null,
  onNavigate,
  onHoverIntent,
}) => {
  return (
    <nav
      aria-label="Barra de Acciones Inferiores Derecha"
      data-testid="right-action-dock"
      className="fixed bottom-2.5 right-3 z-30 flex items-center gap-1 px-2 py-1.5 bg-[#0E100C]/92 backdrop-blur-md border border-[#46521F] rounded-[10px_3px_10px_3px] shadow-[4px_4px_0px_#0A0B08] select-none max-w-[calc(100vw-380px)] overflow-x-auto"
    >
      {RIGHT_DOCK_ITEMS.map((item) => {
        const isActive = activeStation === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`dock-btn-${item.id}`}
            onMouseEnter={() => {
              audioManager.playHoverTick();
              onHoverIntent?.(item.intent);
            }}
            onMouseLeave={() => onHoverIntent?.(null)}
            onClick={() => onNavigate(item.id)}
            title={`Abrir ${item.label} [Tecla ${item.hotkey}]`}
            className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px_2px_6px_2px] border text-[10px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 ${
              isActive
                ? 'bg-[#46521F] border-amber-400 text-[#F2E8D5] -translate-y-0.5 shadow-[2px_2px_0px_#0A0B08]'
                : `bg-[#1B1D17] border-[#2E3323] text-[#F2E8D5] hover:bg-[#2B2C24] ${item.accentBorder}`
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            <span className="text-[8px] text-[#7B8A4A] font-bold">[{item.hotkey}]</span>
          </button>
        );
      })}
    </nav>
  );
};
