// ==============================================================================
// ATOMIC STORE: TACTICAL MATCH HIGH-FREQUENCY STATE
// Store sin dependencias externas basado en React 19 `useSyncExternalStore`.
// Aísla el estado táctico de alta frecuencia (`turnTimeRemaining`, `units`,
// `matchTiles`, `playerFunds`, `selectedUnitId`) para evitar re-renders globales
// de `App.tsx` cada segundo.
// ==============================================================================

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SetStateAction } from 'react';
import type { MovementType, TerrainTile } from '@shared';
import { getPredefinedMap } from '../core/predefinedMaps';
import { MATCH_FORMAT_CONFIGS } from '../core/autonomousOrchestrator';

export interface SimUnit {
  id: string;
  name: string;
  code: string;
  owner: 'p1' | 'p2';
  x: number;
  y: number;
  hp: number;
  movePoints: number;
  moveType: MovementType;
  minRange: number;
  maxRange: number;
  baseAtk: number;
  hasMoved?: boolean;
  hasActed?: boolean;
}

export interface TacticalMatchState {
  units: SimUnit[];
  selectedUnitId: string;
  matchTiles: TerrainTile[][];
  playerFunds: Record<'p1' | 'p2', number>;
  turnTimeRemaining: number;
}

function createInitialState(): TacticalMatchState {
  const initialMap = getPredefinedMap('caustic_finale');
  const initialUnits: SimUnit[] = initialMap.startingUnits.map(u => ({
    id: u.id,
    name: u.displayName,
    code: u.unitCode,
    owner: u.ownerId as 'p1' | 'p2',
    x: u.x,
    y: u.y,
    hp: u.hp,
    movePoints: u.movementPoints,
    moveType: u.movementType as MovementType,
    minRange: u.minRange,
    maxRange: u.maxRange,
    baseAtk: u.baseAttack,
    hasMoved: false,
    hasActed: false,
  }));

  return {
    units: initialUnits,
    selectedUnitId: 'p1_inf_hq',
    matchTiles: initialMap.tiles.map(row => row.map(t => ({ ...t }))),
    playerFunds: { p1: 6000, p2: 6000 },
    turnTimeRemaining: MATCH_FORMAT_CONFIGS.blitz_skirmish.turnTimeLimitSec,
  };
}

let state: TacticalMatchState = createInitialState();
const serverSnapshot: TacticalMatchState = state;
const listeners = new Set<() => void>();

function emitChange(): void {
  listeners.forEach(listener => listener());
}

function resolveUpdater<T>(updater: SetStateAction<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (prevState: T) => T)(prev) : updater;
}

function updateSlice<K extends keyof TacticalMatchState>(
  key: K,
  updater: SetStateAction<TacticalMatchState[K]>,
): void {
  const prevValue = state[key];
  const nextValue = resolveUpdater(updater, prevValue);
  if (Object.is(nextValue, prevValue)) {
    return;
  }
  state = { ...state, [key]: nextValue };
  emitChange();
}

export const tacticalMatchStore = {
  getState: (): TacticalMatchState => state,
  getServerState: (): TacticalMatchState => serverSnapshot,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setUnits: (updater: SetStateAction<SimUnit[]>): void => {
    updateSlice('units', updater);
  },
  setSelectedUnitId: (updater: SetStateAction<string>): void => {
    updateSlice('selectedUnitId', updater);
  },
  setMatchTiles: (updater: SetStateAction<TerrainTile[][]>): void => {
    updateSlice('matchTiles', updater);
  },
  setPlayerFunds: (updater: SetStateAction<Record<'p1' | 'p2', number>>): void => {
    updateSlice('playerFunds', updater);
  },
  setTurnTimeRemaining: (updater: SetStateAction<number>): void => {
    updateSlice('turnTimeRemaining', updater);
  },
  reset: (): void => {
    state = createInitialState();
    emitChange();
  },
};

/**
 * Selector granular sobre `tacticalMatchStore` usando `useSyncExternalStore`.
 * Solo re-renderiza el componente cuando el valor retornado por `selector` cambia (`Object.is`).
 */
export function useTacticalMatchSelector<T>(selector: (matchState: TacticalMatchState) => T): T {
  return useSyncExternalStore(
    tacticalMatchStore.subscribe,
    () => selector(tacticalMatchStore.getState()),
    () => selector(tacticalMatchStore.getServerState()),
  );
}

const selectTurnTimeRemaining = (s: TacticalMatchState): number => s.turnTimeRemaining;
const selectUnits = (s: TacticalMatchState): SimUnit[] => s.units;
const selectMatchTiles = (s: TacticalMatchState): TerrainTile[][] => s.matchTiles;
const selectPlayerFunds = (s: TacticalMatchState): Record<'p1' | 'p2', number> => s.playerFunds;
const selectSelectedUnitId = (s: TacticalMatchState): string => s.selectedUnitId;

export function useTurnTimeRemaining(): number {
  return useTacticalMatchSelector(selectTurnTimeRemaining);
}

export function useMatchUnits(): SimUnit[] {
  return useTacticalMatchSelector(selectUnits);
}

export function useMatchTiles(): TerrainTile[][] {
  return useTacticalMatchSelector(selectMatchTiles);
}

export function usePlayerFunds(): Record<'p1' | 'p2', number> {
  return useTacticalMatchSelector(selectPlayerFunds);
}

export function useSelectedUnitId(): string {
  return useTacticalMatchSelector(selectSelectedUnitId);
}

export interface UseTacticalTurnTimerOptions {
  enabled: boolean;
  turnTimeLimitSec: number;
  resetKey: string;
  onTimeExpired: () => void;
  onUrgencyTick?: () => void;
  onExpiredTick?: () => void;
}

/**
 * Orquestador del temporizador de turno (`setInterval(1000)`).
 * Actualiza `turnTimeRemaining` directamente en `tacticalMatchStore` sin
 * suscribir al componente anfitrión (`App.tsx`) al tick de 1 segundo.
 */
export function useTacticalTurnTimer({
  enabled,
  turnTimeLimitSec,
  resetKey,
  onTimeExpired,
  onUrgencyTick,
  onExpiredTick,
}: UseTacticalTurnTimerOptions): void {
  const onTimeExpiredRef = useRef(onTimeExpired);
  const onUrgencyTickRef = useRef(onUrgencyTick);
  const onExpiredTickRef = useRef(onExpiredTick);

  onTimeExpiredRef.current = onTimeExpired;
  onUrgencyTickRef.current = onUrgencyTick;
  onExpiredTickRef.current = onExpiredTick;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const interval = setInterval(() => {
      tacticalMatchStore.setTurnTimeRemaining(prev => {
        if (prev <= 1) {
          onExpiredTickRef.current?.();
          setTimeout(() => onTimeExpiredRef.current(), 0);
          return turnTimeLimitSec;
        }

        if (prev <= 6) {
          onUrgencyTickRef.current?.();
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [enabled, turnTimeLimitSec, resetKey]);
}
