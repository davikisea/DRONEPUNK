/**
 * ==============================================================================
 * PREDICADO PURO DE HIDROLOGÍA GLOBAL 4-CONECTADA (@domains/world)
 * ==============================================================================
 * Fuente única de verdad para canales fluviales compartida entre:
 * - gbaMapPipeline.ts (Etapa 2: Hidrología)
 * - urbanContainmentMasks.ts (Exclusión de water_grid antes de compilar ciudades)
 *
 * Garantiza 0 ríos cortados por cascos urbanos y puentes limpios en cruces viales.
 * ==============================================================================
 */

import { DEFAULT_GBA_CALIBRATION_PROFILE, type GbaCalibrationProfile } from '@shared';

export const GLOBAL_RIVER_ANCHOR_WX = 9880 * 20 + 13;
export const GLOBAL_RIVER_ANCHOR_WY = 15432 * 20 + 15;

function nsChannelTargetX(wy: number, freq: number, amp: number): number {
  return Math.round(GLOBAL_RIVER_ANCHOR_WX + Math.sin(wy * freq) * amp);
}

function ewTributaryTargetY(wx: number, freq: number, amp: number): number {
  return Math.round(GLOBAL_RIVER_ANCHOR_WY + Math.sin(wx * (freq * 0.85)) * (amp * 0.9));
}

/**
 * Determina en O(1) si la celda táctica global (gx, gy) pertenece al cauce
 * fluvial 4-conectado (incluyendo codos ortogonales sin saltos diagonales).
 */
export function isGlobalRiverAtCell(
  gx: number,
  gy: number,
  profile: GbaCalibrationProfile = DEFAULT_GBA_CALIBRATION_PROFILE
): boolean {
  const freq = profile.riverMeanderFreq;
  const amp = profile.riverMeanderAmplitude;

  // 1. Canal principal N-S (con codo ortogonal entre gy-1 y gy)
  const txCurr = nsChannelTargetX(gy, freq, amp);
  if (gx === txCurr) return true;
  const txPrev = nsChannelTargetX(gy - 1, freq, amp);
  if (txPrev !== txCurr) {
    const minX = Math.min(txPrev, txCurr);
    const maxX = Math.max(txPrev, txCurr);
    if (gx >= minX && gx <= maxX) return true;
  }

  // 2. Tributario E-O (para gx <= anchorWX + 26, con codo ortogonal entre gx-1 y gx)
  if (gx <= GLOBAL_RIVER_ANCHOR_WX + 26) {
    const tyCurr = ewTributaryTargetY(gx, freq, amp);
    if (gy === tyCurr) return true;
    const tyPrev = ewTributaryTargetY(gx - 1, freq, amp);
    if (tyPrev !== tyCurr) {
      const minY = Math.min(tyPrev, tyCurr);
      const maxY = Math.max(tyPrev, tyCurr);
      if (gy >= minY && gy <= maxY) return true;
    }
  }

  return false;
}
