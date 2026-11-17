import React from 'react';

export interface TacticalGhostBarProps {
  value: number;
  max: number;
  fillClassName?: string;
  ghostClassName?: string;
  heightClassName?: string;
  label?: string;
  showMarkerAtPercent?: number;
  fillClass?: string;
  ghostClass?: string;
  heightClass?: string;
  variant?: string;
  showNumericLabel?: boolean;
  markerTitle?: string;
}

/**
 * Barra de Progreso Táctica de Doble Capa (Ghost Drain / Surge Trail)
 * Cumple con @indie-game-ui-architect y @tactical-command-intel (DRONEPUNK 0.0.1):
 * - Capa trasera (Ghost Trail): Crema/Amarillo con retardo de 220ms y desaceleración exponencial (550ms).
 * - Capa frontal (Fill): Resorte elástico rápido (160ms).
 */
export const TacticalGhostBar: React.FC<TacticalGhostBarProps> = ({
  value,
  max,
  fillClassName = 'bg-gradient-to-r from-[#C46A3A] via-[#E65100] to-amber-400',
  ghostClassName = 'bg-[#F2E8D5]',
  heightClassName = 'h-3',
  label,
  showMarkerAtPercent,
  fillClass,
  ghostClass,
  heightClass,
  variant,
  showNumericLabel,
  markerTitle,
}) => {
  const safeMax = Math.max(1, max);
  const percent = Math.max(0, Math.min(100, Math.floor((value / safeMax) * 100)));
  const resolvedFill =
    fillClass ??
    (variant === 'xp' && fillClassName === 'bg-gradient-to-r from-[#C46A3A] via-[#E65100] to-amber-400'
      ? 'bg-[#7B8A4A]'
      : fillClassName);
  const resolvedGhost = ghostClass ?? ghostClassName;
  const resolvedHeight = heightClass ?? (variant === 'xp' && heightClassName === 'h-3' ? 'h-1.5' : heightClassName);
  const resolvedLabel = label ?? (showNumericLabel ? `${value}/${safeMax}` : undefined);

  return (
    <div
      className={`relative w-full bg-[#161712] border-2 border-[#0A0B08] outline-1 outline-[#7B8A4A]/50 rounded-[6px_2px_6px_2px] overflow-hidden select-none ${resolvedHeight}`}
    >
      {/* 1. Capa Trasera Fantasma (Ghost Trail con retardo de 220ms) */}
      <div
        className={`absolute inset-y-0 left-0 ${resolvedGhost} opacity-85 bar-ghost-trail`}
        style={{ width: `${percent}%` }}
      />

      {/* 2. Capa Frontal Activa con Resorte Elástico */}
      <div
        className={`absolute inset-y-0 left-0 ${resolvedFill} bar-fill-spring`}
        style={{ width: `${percent}%` }}
      />

      {/* 3. Marcador de Umbral Opcional (ej. COP vs SCOP) */}
      {showMarkerAtPercent !== undefined && (
        <div
          className="absolute inset-y-0 z-20 w-0.5 bg-[#F2E8D5] shadow-[0_0_4px_#0A0B08]"
          style={{ left: `${Math.max(0, Math.min(100, showMarkerAtPercent))}%` }}
          title={markerTitle}
        />
      )}

      {/* 4. Etiqueta Tabular Superpuesta */}
      {resolvedLabel && (
        <span className="absolute inset-0 z-20 flex items-center justify-center text-[9px] font-mono font-extrabold text-[#F2E8D5] tracking-wider uppercase drop-shadow-[1px_1px_0px_#0A0B08] tabular-nums">
          {resolvedLabel}
        </span>
      )}
    </div>
  );
};
