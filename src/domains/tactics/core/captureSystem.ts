/**
 * SISTEMA CANÓNICO DE CAPTURA DE SEDES Y PROPIEDADES
 * Especificación Advance Wars / WarsWorld / AWBW
 * 
 * Reglas:
 * 1. Toda propiedad neutral o enemiga posee 20 puntos de resistencia de captura.
 * 2. Solo las unidades a pie (Infantería y Mecanizados) pueden capturar sedes.
 * 3. En cada turno de captura, la resistencia se reduce en una cantidad equivalente a la salud (HP) actual de la unidad.
 * 4. Al llegar a 0 puntos, la sede se transfiere al comandante captor y los puntos se restablecen a 20.
 * 5. La captura del Cuartel General (HQ) enemigo otorga la victoria inmediata de la partida.
 */

import { TacticalUnit, TerrainTile, TerrainType } from '../types';
import type { DroneUnitRole } from '@shared';

export const CAPTURABLE_PROPERTY_TYPES: TerrainType[] = [
  'city',
  'factory',
  'airport',
  'port',
  'hq',
  'commtower',
  'lab',
];

export interface CaptureExecutionResult {
  success: boolean;
  captured: boolean;
  isHqCaptured: boolean;
  damageInflictedToProperty: number;
  remainingCapturePoints: number;
  newOwnerId: string | null;
  message: string;
}

export class CaptureEngine {
  /**
   * Verifica si una unidad está capacitada para iniciar o continuar la captura de una loseta.
   */
  public static canCapture(unit: TacticalUnit, tile: TerrainTile): boolean {
    if (unit.hp <= 0) return false;

    // Solo tropas a pie
    const isFootSoldier = unit.unitCode === 'infantry' || unit.unitCode === 'mech';
    if (!isFootSoldier) return false;

    // Solo propiedades capturables
    if (!CAPTURABLE_PROPERTY_TYPES.includes(tile.type)) return false;

    // No se puede capturar una propiedad que ya es aliada
    if (tile.ownerId === unit.ownerId) return false;

    return true;
  }

  /**
   * Ejecuta un paso de captura de la propiedad por parte de la unidad.
   */
  public static executeCaptureStep(
    unit: TacticalUnit,
    tile: TerrainTile
  ): CaptureExecutionResult {
    if (!this.canCapture(unit, tile)) {
      return {
        success: false,
        captured: false,
        isHqCaptured: false,
        damageInflictedToProperty: 0,
        remainingCapturePoints: tile.captureHp ?? 20,
        newOwnerId: tile.ownerId || null,
        message: 'La unidad no puede capturar esta loseta.',
      };
    }

    const currentPoints = tile.captureHp ?? 20;
    // Escala continua 1-100 HP normalizada a 20 Puntos de Captura (100 HP -> 10 pts/turno, requiere 2 turnos completos)
    const capturePower = unit.hp > 10 ? Math.ceil(unit.hp / 10) : unit.hp;
    const damage = Math.min(currentPoints, capturePower);
    const remaining = currentPoints - damage;

    if (remaining <= 0) {
      // Captura completada con éxito
      const isHq = tile.type === 'hq';
      return {
        success: true,
        captured: true,
        isHqCaptured: isHq,
        damageInflictedToProperty: damage,
        remainingCapturePoints: 20, // Se resetea para futuras capturas
        newOwnerId: unit.ownerId,
        message: isHq
          ? `¡CUARTEL GENERAL CAPTURADO! El ejército ${unit.ownerId.toUpperCase()} se alza con la victoria.`
          : `¡${tile.type.toUpperCase()} capturada con éxito por ${unit.displayName}!`,
      };
    }

    // Captura en progreso
    return {
      success: true,
      captured: false,
      isHqCaptured: false,
      damageInflictedToProperty: damage,
      remainingCapturePoints: remaining,
      newOwnerId: tile.ownerId || null,
      message: `Captura en progreso: ${remaining}/20 puntos restantes.`,
    };
  }

  /**
   * Habilita exclusivamente al chasis de Infantería / Ingeniero ('infantry_engineer')
   * para capturar o sabotear infraestructura enemiga (fábricas, extractores, torres de radar).
   */
  public static executeEngineerInfrastructureAction(params: {
    unitRole: DroneUnitRole;
    unitHp: number;
    actorClanId: string;
    targetBuildingId: string;
    targetBuildingType: 'factory' | 'extractor' | 'radar_tower' | 'sam_battery';
    targetOwnerClanId: string | null;
    currentStructureIntegrity: number;
    mode: 'capture' | 'sabotage';
  }): {
    allowed: boolean;
    completed: boolean;
    newOwnerClanId: string | null;
    remainingIntegrity: number;
    isSabotaged: boolean;
    reason: string;
  } {
    if (params.unitHp <= 0) {
      return {
        allowed: false,
        completed: false,
        newOwnerClanId: params.targetOwnerClanId,
        remainingIntegrity: params.currentStructureIntegrity,
        isSabotaged: false,
        reason: 'El dron ingeniero está destruido (0 HP).',
      };
    }

    if (params.unitRole !== 'infantry_engineer') {
      return {
        allowed: false,
        completed: false,
        newOwnerClanId: params.targetOwnerClanId,
        remainingIntegrity: params.currentStructureIntegrity,
        isSabotaged: false,
        reason: `Solo el chasis Infantería/Ingeniero puede capturar o sabotear infraestructura (${params.unitRole} rechazado).`,
      };
    }

    if (params.targetOwnerClanId === params.actorClanId) {
      return {
        allowed: false,
        completed: false,
        newOwnerClanId: params.targetOwnerClanId,
        remainingIntegrity: params.currentStructureIntegrity,
        isSabotaged: false,
        reason: 'La infraestructura ya pertenece a tu Corporación.',
      };
    }

    const power = Math.max(1, Math.ceil(params.unitHp / 10));
    const nextIntegrity = Math.max(0, params.currentStructureIntegrity - power);
    const completed = nextIntegrity === 0;

    if (params.mode === 'sabotage') {
      return {
        allowed: true,
        completed,
        newOwnerClanId: completed ? null : params.targetOwnerClanId,
        remainingIntegrity: completed ? 20 : nextIntegrity,
        isSabotaged: completed,
        reason: completed
          ? `Infraestructura ${params.targetBuildingType} (${params.targetBuildingId}) saboteada y neutralizada.`
          : `Sabotaje en progreso: ${nextIntegrity}/20 integridad restante.`,
      };
    }

    return {
      allowed: true,
      completed,
      newOwnerClanId: completed ? params.actorClanId : params.targetOwnerClanId,
      remainingIntegrity: completed ? 20 : nextIntegrity,
      isSabotaged: false,
      reason: completed
        ? `Infraestructura ${params.targetBuildingType} (${params.targetBuildingId}) capturada para ${params.actorClanId}.`
        : `Captura en progreso: ${nextIntegrity}/20 puntos restantes.`,
    };
  }
}
