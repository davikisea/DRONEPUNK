import React, { useEffect, useState, useCallback } from 'react';
import { X, Clock, Navigation, RefreshCw, AlertTriangle, CheckCircle2, ScrollText } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@shared';
import { audioManager } from '@domains/game-feel';
import type { DbBuildingRecord } from '@domains/economy';
import {
  scheduleUnitCommand,
  cancelUnitCommand,
  processDueUnitSchedules,
  fetchUnitSchedules,
  fetchUnitActionLogs,
  type UnitCommandType,
  type UnitScheduleRow,
  type UnitActionLogRow,
} from '../services/droneScheduleService';

export interface DroneSchedulerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  corpId: string;
  unitId: string;
  unitCode: string;
  currentH3: number;
  canControlUnits: boolean;
  availableBuildings?: DbBuildingRecord[];
  onSchedulesUpdated?: () => Promise<void> | void;
}

export const DroneSchedulerDrawer: React.FC<DroneSchedulerDrawerProps> = ({
  isOpen,
  onClose,
  corpId,
  unitId,
  unitCode,
  currentH3,
  canControlUnits,
  availableBuildings = [],
  onSchedulesUpdated,
}) => {
  const [commandType, setCommandType] = useState<UnitCommandType>('patrol');
  const [targetH3, setTargetH3] = useState(String(currentH3));
  const [targetBuildingId, setTargetBuildingId] = useState<string>('');
  const [repeatIntervalSec, setRepeatIntervalSec] = useState<string>('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [schedules, setSchedules] = useState<UnitScheduleRow[]>([]);
  const [logs, setLogs] = useState<UnitActionLogRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        fetchUnitSchedules(corpId, unitId),
        fetchUnitActionLogs(corpId, unitId),
      ]);
      setSchedules(s);
      setLogs(l);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error cargando programación de dron.');
    }
  }, [corpId, unitId]);

  useEffect(() => {
    if (!isOpen) return;
    setTargetH3(String(currentH3));
    void loadData();

    if (!isSupabaseConfigured() || !supabase || !corpId) return;
    const channel = supabase
      .channel(`drone-sched:${corpId}:${unitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'unit_command_schedules', filter: `corp_id=eq.${corpId}` },
        () => {
          void loadData();
          void onSchedulesUpdated?.();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'unit_action_logs', filter: `corp_id=eq.${corpId}` },
        () => {
          void loadData();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isOpen, currentH3, corpId, unitId, loadData, onSchedulesUpdated]);

  if (!isOpen) return null;

  const handleSelectTargetBuilding = (buildingId: string) => {
    setTargetBuildingId(buildingId);
    const b = availableBuildings.find((item) => item.id === buildingId);
    if (b) {
      setTargetH3(String(b.h3_index));
    }
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canControlUnits) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setIsSubmitting(true);
    try {
      const h3Num = Number(targetH3) || currentH3;
      const scheduledAtIso = scheduledLocal ? new Date(scheduledLocal).toISOString() : undefined;
      const repeatSec = repeatIntervalSec ? Math.max(10, Number(repeatIntervalSec)) : undefined;
      const waypoints =
        (commandType === 'patrol' || commandType === 'auto_collect') && h3Num !== currentH3
          ? [
              { h3: currentH3, wait_sec: 0 },
              { h3: h3Num, wait_sec: 0 },
            ]
          : [{ h3: h3Num, wait_sec: 0 }];

      await scheduleUnitCommand({
        corpId,
        unitId,
        commandType,
        waypoints,
        targetBuildingId: targetBuildingId || undefined,
        scheduledAtIso,
        repeatIntervalSec: repeatSec,
        replaceActive: true,
      });
      audioManager.playCue('ui_tile_confirm');
      setStatusMsg('Orden programada y registrada en bitácora.');
      await loadData();
      await onSchedulesUpdated?.();
    } catch (err) {
      audioManager.playCue('ui_cancel_rollback');
      setErrorMsg(err instanceof Error ? err.message : 'Error al programar orden.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunTickNow = async () => {
    setIsSubmitting(true);
    try {
      await processDueUnitSchedules(25);
      await loadData();
      await onSchedulesUpdated?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-[85] w-full max-w-md bg-[#2B2C24] border-l-2 border-[#0A0B08] shadow-[4px_4px_0px_#0A0B08] flex flex-col font-mono text-[#F2E8D5]">
      <div className="flex items-center justify-between px-4 py-3 bg-[#181914] border-b-2 border-[#46521F]">
        <div className="flex items-center gap-2">
          <Navigation className="w-4 h-4 text-[#C46A3A]" />
          <div>
            <div className="text-[10px] text-[#C46A3A] font-bold uppercase">
              PROGRAMACIÓN ESTRATÉGICA // {unitCode.toUpperCase()}
            </div>
            <h3 className="text-xs font-black uppercase">COLA DE ÓRDENES & BITÁCORA</h3>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            audioManager.playCue('ui_cancel_rollback');
            onClose();
          }}
          className="p-1 bg-[#3B3C34] hover:bg-[#C46A3A] border border-[#7B8A4A] rounded-[14px_4px_14px_4px] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {errorMsg && (
          <div className="flex items-start gap-2 p-2.5 bg-rose-950/80 border border-[#0A0B08] rounded-[14px_4px_14px_4px] text-xs text-rose-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}
        {statusMsg && (
          <div className="flex items-start gap-2 p-2.5 bg-emerald-950/70 border border-[#7B8A4A] rounded-[14px_4px_14px_4px] text-xs text-emerald-200">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{statusMsg}</span>
          </div>
        )}

        <form
          onSubmit={handleSchedule}
          className="p-3.5 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] space-y-3"
        >
          <div className="grid grid-cols-2 gap-1.5">
            {(['move', 'patrol', 'auto_collect', 'skirmish'] as UnitCommandType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCommandType(t)}
                className={`py-1.5 px-2 text-[11px] font-bold uppercase rounded-[14px_4px_14px_4px] border cursor-pointer ${
                  commandType === t
                    ? 'bg-[#C46A3A] text-[#0A0B08] border-[#0A0B08]'
                    : 'bg-[#2B2C24] text-[#F2E8D5] border-[#46521F]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {availableBuildings.length > 0 && (
            <div className="space-y-1 text-xs">
              <label className="text-[10px] text-[#7B8A4A] font-bold uppercase">
                Enclave / Edificio Destino (opcional)
              </label>
              <select
                value={targetBuildingId}
                onChange={(e) => handleSelectTargetBuilding(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#2B2C24] border border-[#46521F] rounded-[14px_4px_14px_4px]"
              >
                <option value="">-- Coordenada H3 manual --</option>
                {availableBuildings.slice(0, 40).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.building_type.toUpperCase()} ({b.municipality_id ?? 'MAP'}) • {b.infra_state ?? 'OPERATIONAL'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1 text-xs">
            <label className="text-[10px] text-[#7B8A4A] font-bold uppercase">H3 Destino</label>
            <input
              type="text"
              value={targetH3}
              onChange={(e) => setTargetH3(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#2B2C24] border border-[#46521F] rounded-[14px_4px_14px_4px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="space-y-1">
              <label className="text-[10px] text-[#7B8A4A] font-bold uppercase flex items-center gap-1">
                <Clock className="w-3 h-3" /> Hora Programada UTC
              </label>
              <input
                type="datetime-local"
                value={scheduledLocal}
                onChange={(e) => setScheduledLocal(e.target.value)}
                className="w-full px-2 py-1.5 bg-[#2B2C24] border border-[#46521F] rounded-[14px_4px_14px_4px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#7B8A4A] font-bold uppercase">
                Repetir cada (seg ≥10)
              </label>
              <input
                type="number"
                min={10}
                placeholder="Ej. 30"
                value={repeatIntervalSec}
                onChange={(e) => setRepeatIntervalSec(e.target.value)}
                className="w-full px-2 py-1.5 bg-[#2B2C24] border border-[#46521F] rounded-[14px_4px_14px_4px]"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canControlUnits || isSubmitting}
              className="tactical-btn-heavy flex-1 py-2 text-xs cursor-pointer disabled:opacity-45"
            >
              PROGRAMAR ORDEN
            </button>
            <button
              type="button"
              onClick={() => void handleRunTickNow()}
              disabled={isSubmitting}
              className="px-2.5 py-2 bg-[#2B2C24] border border-[#7B8A4A] rounded-[14px_4px_14px_4px] text-[10px] font-bold cursor-pointer"
              title="Procesar cola pendiente"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </form>

        {/* Órdenes Activas/Pendientes */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-[#7B8A4A] uppercase">
            Cola de Órdenes ({schedules.length})
          </div>
          {schedules.slice(0, 5).map((s) => (
            <div
              key={s.id}
              className="p-2.5 bg-[#181914] border border-[#46521F] rounded-[14px_4px_14px_4px] flex items-center justify-between text-[11px]"
            >
              <div>
                <span className="font-bold text-amber-300 uppercase">{s.command_type}</span> •{' '}
                <span>{s.status}</span>
                <div className="text-[10px] text-[#7B8A4A]">
                  {new Date(s.scheduled_at).toISOString().slice(0, 19)}Z
                </div>
              </div>
              {(s.status === 'pending' || s.status === 'active') && canControlUnits && (
                <button
                  type="button"
                  onClick={() =>
                    void cancelUnitCommand(s.id).then(async () => {
                      await loadData();
                      await onSchedulesUpdated?.();
                    })
                  }
                  className="px-2 py-1 bg-rose-950 border border-rose-700 rounded-[14px_4px_14px_4px] text-[10px] cursor-pointer"
                >
                  Cancelar
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Bitácora Auditable */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-[#7B8A4A] uppercase flex items-center gap-1.5">
            <ScrollText className="w-3.5 h-3.5 text-[#C46A3A]" />
            Bitácora de Acciones (`unit_action_logs`)
          </div>
          {logs.slice(0, 10).map((l) => (
            <div
              key={l.id}
              className="p-2 bg-[#181914] border border-[#46521F] rounded-[14px_4px_14px_4px] text-[11px]"
            >
              <div className="flex justify-between">
                <span className="font-bold text-[#C46A3A] uppercase">{l.action_type}</span>
                <span className="text-[10px] text-[#7B8A4A]">
                  {new Date(l.created_at).toISOString().slice(11, 19)}Z
                </span>
              </div>
              <div className="text-[#F2E8D5] mt-0.5">{l.summary}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
