/**
 * ==============================================================================
 * MODAL DE DESPLIEGUE ESPACIAL DE TROPAS EN COORDENADAS C4ISR (100% DB)
 * ==============================================================================
 * - Lee stock real de `user_unit_hangar` vía `useUserHangar` (@domains/economy).
 * - Valida corporación activa (`corp_id`) y permisos `can_control_units` / `can_purchase_units`.
 * - Permite comprar chasis en barracones/fábricas vía `purchase_unit_from_barracks`.
 * - Despliega al mapa operacional vía `deployOperationalUnitDb` (`deploy_operational_unit`).
 * ==============================================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Crosshair,
  Radio,
  Swords,
  X,
  AlertTriangle,
  Sparkles,
  Box,
  Factory,
  Lock,
  ShoppingCart,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@shared';
import {
  CANONICAL_UNIT_PRODUCTION_CATALOG,
  deployOperationalUnitDb,
  useUserHangar,
} from '@domains/economy';
import { latLngToH3Res9 } from '@domains/world';
import { audioManager } from '@domains/game-feel';

export interface TacticalUnitDeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  sector: [number, number];
  cell: [number, number];
  lngLat: [number, number];
  userClanId?: string;
  userClanTag?: string;
  userFactionId?: string;
  corpId?: string | null;
  h3Index?: number;
  onDeploySuccess?: (unitCode: string) => void;
}

interface CorpPermissions {
  canControlUnits: boolean;
  canPurchaseUnits: boolean;
}

interface ProductionBuildingRow {
  id: string;
  building_type: string;
  h3_index: number;
  hp: number;
}

export const TacticalUnitDeployModal: React.FC<TacticalUnitDeployModalProps> = ({
  isOpen,
  onClose,
  sector,
  cell,
  lngLat,
  corpId: propCorpId,
  h3Index: propH3Index,
  onDeploySuccess,
}) => {
  const {
    hangarUnits,
    activeCorpId,
    isLoading: isHangarLoading,
    refreshHangar,
  } = useUserHangar();

  const resolvedCorpId = propCorpId ?? activeCorpId ?? null;

  const [activeTab, setActiveTab] = useState<'deploy' | 'barracks'>('deploy');
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const [purchaseCode, setPurchaseCode] = useState<string>('infantry');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [personalEcContribution, setPersonalEcContribution] = useState<number>(0);
  const [callsign, setCallsign] = useState<string>('VANGUARDIA-ALFA');

  const [permissions, setPermissions] = useState<CorpPermissions>({
    canControlUnits: false,
    canPurchaseUnits: false,
  });
  const [buildings, setBuildings] = useState<ProductionBuildingRow[]>([]);
  const [isCheckingAccess, setIsCheckingAccess] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resolvedH3Index = useMemo(() => {
    if (typeof propH3Index === 'number' && Number.isFinite(propH3Index) && propH3Index > 0) {
      return Math.trunc(propH3Index);
    }
    const [lng, lat] = lngLat;
    return Number(latLngToH3Res9(lat, lng));
  }, [propH3Index, lngLat]);

  const availableCatalogUnits = useMemo(
    () =>
      Object.entries(CANONICAL_UNIT_PRODUCTION_CATALOG).filter(
        ([code]) => code !== 'missile'
      ),
    []
  );

  // Sincronizar selección inicial de slot del hangar real
  useEffect(() => {
    if (hangarUnits.length > 0 && !hangarUnits.some((u) => u.id === selectedSlotId)) {
      setSelectedSlotId(hangarUnits[0].id);
    } else if (hangarUnits.length === 0) {
      setSelectedSlotId('');
    }
  }, [hangarUnits, selectedSlotId]);

  // Cargar permisos corporativos y barracones/fábricas de la corporación desde Supabase
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!resolvedCorpId || !isSupabaseConfigured() || !supabase) {
      setPermissions({ canControlUnits: false, canPurchaseUnits: false });
      setBuildings([]);
      return;
    }

    let cancelled = false;
    const loadCorpContext = async () => {
      setIsCheckingAccess(true);
      try {
        const { data: authData } = await supabase!.auth.getUser();
        const userId = authData?.user?.id;
        if (!userId || cancelled) return;

        const [memberRes, bldRes] = await Promise.all([
          supabase!
            .from('corporation_members')
            .select('role, delegated_permissions')
            .eq('corp_id', resolvedCorpId)
            .eq('user_id', userId)
            .maybeSingle(),
          supabase!
            .from('buildings')
            .select('id, building_type, h3_index, hp')
            .eq('corp_id', resolvedCorpId)
            .eq('is_disabled', false)
            .in('building_type', ['barracks', 'factory', 'war_factory', 'airport', 'port', 'hq'])
            .order('created_at', { ascending: false }),
        ]);

        if (cancelled) return;

        const role = (memberRes.data?.role ?? '').toLowerCase();
        const isLeadership = role === 'founder' || role === 'ceo' || role === 'leader' || role === 'commander';
        const permsObj =
          memberRes.data?.delegated_permissions &&
          typeof memberRes.data.delegated_permissions === 'object' &&
          !Array.isArray(memberRes.data.delegated_permissions)
            ? (memberRes.data.delegated_permissions as Record<string, unknown>)
            : {};

        setPermissions({
          canControlUnits: Boolean(memberRes.data) && (isLeadership || Boolean(permsObj.can_control_units)),
          canPurchaseUnits: Boolean(memberRes.data) && (isLeadership || Boolean(permsObj.can_purchase_units)),
        });

        const rows = (bldRes.data ?? []) as ProductionBuildingRow[];
        setBuildings(rows);
        if (rows.length > 0) {
          setSelectedBuildingId((prev) => (rows.some((b) => b.id === prev) ? prev : rows[0].id));
        } else {
          setSelectedBuildingId('');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Error verificando permisos corporativos.');
        }
      } finally {
        if (!cancelled) setIsCheckingAccess(false);
      }
    };

    void loadCorpContext();
    return () => {
      cancelled = true;
    };
  }, [isOpen, resolvedCorpId]);

  if (!isOpen) return null;

  const selectedSlot = hangarUnits.find((u) => u.id === selectedSlotId) ?? null;
  const selectedCatalogInfo = selectedSlot
    ? CANONICAL_UNIT_PRODUCTION_CATALOG[selectedSlot.unitCode]
    : null;

  const handleExecuteDeploy = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!resolvedCorpId) {
      setErrorMsg('BLOQUEO: No tienes una corporación activa asignada.');
      return;
    }
    if (!permissions.canControlUnits) {
      setErrorMsg('BLOQUEO DE PERMISOS: Tu rango corporativo no tiene permiso can_control_units.');
      return;
    }
    if (!selectedSlot) {
      setErrorMsg('No hay chasis seleccionado en el Hangar Físico. Compra o produce uno primero.');
      return;
    }

    setIsSubmitting(true);
    try {
      await deployOperationalUnitDb({
        hangarSlotId: selectedSlot.id,
        corpId: resolvedCorpId,
        h3Index: resolvedH3Index,
      });

      await refreshHangar();
      audioManager.playCue('co_power_charge');
      const label = callsign.trim().toUpperCase() || selectedCatalogInfo?.displayName || selectedSlot.unitCode;
      setSuccessMsg(`¡${label} DESPLEGADO EN H3 #${resolvedH3Index} CON ÉXITO!`);
      onDeploySuccess?.(selectedSlot.unitCode);
      window.setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      audioManager.playCue('ui_cancel_rollback');
      setErrorMsg(err instanceof Error ? err.message : 'Error al desplegar unidad operacional en DB.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePurchaseFromBarracks = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!isSupabaseConfigured() || !supabase) {
      setErrorMsg('Conexión a Supabase no configurada.');
      return;
    }
    if (!resolvedCorpId) {
      setErrorMsg('BLOQUEO: Requiere corporación activa para adquirir chasis.');
      return;
    }
    if (!permissions.canPurchaseUnits) {
      setErrorMsg('BLOQUEO DE PERMISOS: Tu rango corporativo no tiene permiso can_purchase_units.');
      return;
    }
    if (!selectedBuildingId) {
      setErrorMsg('No hay barracones, fábricas ni HQ operativos en tu corporación.');
      return;
    }

    setIsSubmitting(true);
    try {
      const contribution =
        personalEcContribution > 0 ? { ec: Math.floor(personalEcContribution) } : {};

      const { error } = await supabase.rpc('purchase_unit_from_barracks', {
        p_corp_id: resolvedCorpId,
        p_building_id: selectedBuildingId,
        p_unit_code: purchaseCode,
        p_tier: 1,
        p_personal_contribution: contribution,
        p_idempotency_key: crypto.randomUUID(),
      });

      if (error) throw new Error(error.message);

      await refreshHangar();
      audioManager.playCue('co_power_charge');
      const unitName = CANONICAL_UNIT_PRODUCTION_CATALOG[purchaseCode]?.displayName ?? purchaseCode;
      setSuccessMsg(`¡Chasis ${unitName} adquirido en Hangar Físico! Ya puedes desplegarlo.`);
      setActiveTab('deploy');
    } catch (err: unknown) {
      audioManager.playCue('ui_cancel_rollback');
      setErrorMsg(err instanceof Error ? err.message : 'Error al comprar unidad en barracones.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-[#161712] border-3 border-[#0A0B08] shadow-[10px_10px_0px_#0A0B08] rounded-[14px_4px_14px_4px] flex flex-col overflow-hidden text-[#F2E8D5]"
        style={{
          backgroundImage: 'radial-gradient(#46521F 14%, transparent 15%)',
          backgroundSize: '10px 10px',
        }}
      >
        {/* Cabecera C4ISR */}
        <div className="px-4 py-3 bg-[#2B2C24] border-b-3 border-[#0A0B08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#1D4ED8] text-white rounded-[4px_1px_4px_1px] border border-[#0A0B08] shadow-[2px_2px_0px_#0A0B08]">
              <Crosshair className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-mono font-black uppercase text-amber-400 tracking-widest block leading-tight">
                ORDEN OPERACIONAL • HANGAR DB
              </span>
              <h3 className="text-sm font-display font-black text-[#F2E8D5] uppercase tracking-wide">
                DESPLIEGUE Y BARRACONES
              </h3>
            </div>
          </div>

          <button
            type="button"
            title="Cerrar Despliegue"
            onClick={() => {
              audioManager.playCue('ui_cancel_rollback');
              onClose();
            }}
            className="p-1 bg-[#161712] hover:bg-[#873612] text-[#F2E8D5] border border-[#0A0B08] rounded cursor-pointer transition-transform active:translate-y-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Coordenadas Espaciales */}
        <div className="px-4 py-2 bg-[#1C1E17] border-b-2 border-[#0A0B08] flex items-center justify-between text-xs font-mono">
          <div>
            <span className="text-[10px] text-amber-300 font-bold block">ASIGNACIÓN ESPACIAL:</span>
            <span className="text-[#F2E8D5]">
              SEC [{sector.join(',')}] • CELDA [{cell.join(',')}] • H3 #{resolvedH3Index}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-amber-300 font-bold block">GPS RADAR:</span>
            <span className="text-emerald-400">
              [{lngLat[0].toFixed(4)}, {lngLat[1].toFixed(4)}]
            </span>
          </div>
        </div>

        {/* Pestañas: Hangar Físico vs Compra en Barracones */}
        <div className="px-4 pt-3 flex gap-2 border-b border-[#0A0B08] bg-[#1C1E17]">
          <button
            type="button"
            onClick={() => setActiveTab('deploy')}
            className={`px-3 py-1.5 text-[11px] font-mono font-black uppercase rounded-t border-t-2 border-x-2 border-[#0A0B08] cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'deploy'
                ? 'bg-[#2B2C24] text-amber-300'
                : 'bg-[#161712] text-[#F2E8D5]/60 hover:text-[#F2E8D5]'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>Hangar ({hangarUnits.reduce((acc, u) => acc + u.quantity, 0)})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('barracks')}
            className={`px-3 py-1.5 text-[11px] font-mono font-black uppercase rounded-t border-t-2 border-x-2 border-[#0A0B08] cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'barracks'
                ? 'bg-[#2B2C24] text-emerald-300'
                : 'bg-[#161712] text-[#F2E8D5]/60 hover:text-[#F2E8D5]'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>Barracones</span>
          </button>
        </div>

        {/* Contenido */}
        <div className="p-4 space-y-3.5 overflow-y-auto max-h-[58vh]">
          {!resolvedCorpId && !isCheckingAccess && (
            <div className="p-3 bg-amber-950/80 border-2 border-amber-500 rounded text-amber-200 text-xs font-mono flex items-center gap-2">
              <Lock className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                BLOQUEO: No perteneces a ninguna corporación activa (`corp_id` requerido). Únete o funda una corporación para comprar o desplegar tropas.
              </span>
            </div>
          )}

          {resolvedCorpId && !isCheckingAccess && activeTab === 'deploy' && !permissions.canControlUnits && (
            <div className="p-2.5 bg-red-950/80 border-2 border-red-500 rounded text-red-200 text-xs font-mono flex items-center gap-2">
              <Lock className="w-4 h-4 shrink-0 text-red-400" />
              <span>Permiso requerido: `can_control_units` para desplegar tropas al mapa operacional.</span>
            </div>
          )}

          {resolvedCorpId && !isCheckingAccess && activeTab === 'barracks' && !permissions.canPurchaseUnits && (
            <div className="p-2.5 bg-red-950/80 border-2 border-red-500 rounded text-red-200 text-xs font-mono flex items-center gap-2">
              <Lock className="w-4 h-4 shrink-0 text-red-400" />
              <span>Permiso requerido: `can_purchase_units` para adquirir chasis en barracones.</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 bg-red-950/80 border-2 border-red-500 rounded text-red-200 text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-2.5 bg-emerald-950/80 border-2 border-emerald-500 rounded text-emerald-200 text-xs font-mono flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {activeTab === 'deploy' ? (
            <>
              <div className="space-y-1">
                <label className="text-[11px] font-mono font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  <span>Indicativo de Radio (Callsign)</span>
                </label>
                <input
                  type="text"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value)}
                  maxLength={24}
                  className="w-full px-3 py-2 bg-[#161712] border-2 border-[#0A0B08] text-xs font-mono text-[#F2E8D5] uppercase rounded-[6px_2px_6px_2px] focus:outline-none focus:border-amber-400 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.6)]"
                  placeholder="Ej. VANGUARDIA-ALFA"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-mono font-bold text-amber-300 uppercase tracking-wider block">
                  Stock Real en Hangar Físico (`user_unit_hangar`)
                </span>

                {isHangarLoading ? (
                  <div className="p-4 text-center text-xs font-mono text-[#F2E8D5]/70 bg-[#1C1E17] border border-[#0A0B08] rounded">
                    Sincronizando inventario del Hangar Físico...
                  </div>
                ) : hangarUnits.length === 0 ? (
                  <div className="p-4 text-center space-y-2 bg-[#1C1E17] border-2 border-[#0A0B08] rounded">
                    <p className="text-xs font-mono text-red-300 font-bold">
                      0 chasis disponibles en tu Hangar Físico.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('barracks')}
                      className="px-3 py-1.5 bg-[#46521F] hover:bg-[#5A6929] text-amber-300 border border-[#0A0B08] rounded text-[11px] font-mono font-bold uppercase cursor-pointer"
                    >
                      Ir a Barracones para Comprar Chasis
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {hangarUnits.map((slot) => {
                      const isSelected = selectedSlotId === slot.id;
                      const info = CANONICAL_UNIT_PRODUCTION_CATALOG[slot.unitCode];
                      return (
                        <div
                          key={slot.id}
                          onClick={() => {
                            audioManager.playHoverTick();
                            setSelectedSlotId(slot.id);
                          }}
                          className={`p-2.5 rounded-[6px_2px_6px_2px] border-2 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[#2B2C24] border-amber-400 shadow-[3px_3px_0px_#0A0B08] scale-[1.01]'
                              : 'bg-[#1C1E17] border-[#0A0B08] hover:border-[#46521F]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-display font-black text-[#F2E8D5] uppercase">
                              {info?.displayName ?? slot.unitCode}
                            </span>
                            <span className="px-1.5 py-0.5 bg-[#161712] border border-[#0A0B08] text-amber-400 font-mono font-bold text-[10px] rounded">
                              T{slot.tier} • x{slot.quantity}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-[#F2E8D5]/70 mb-1">
                            HP {slot.hp}/100 • Nv.{slot.level}
                            {info ? ` • Mov ${info.movementPoints}` : ''}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Factory className="w-3.5 h-3.5" />
                  <span>Instalación de Producción Corporativa</span>
                </label>
                {buildings.length === 0 ? (
                  <div className="p-2.5 bg-[#1C1E17] border border-[#0A0B08] rounded text-[11px] font-mono text-amber-300">
                    No se detectaron barracones, fábricas ni HQ operativos para esta corporación.
                  </div>
                ) : (
                  <select
                    value={selectedBuildingId}
                    onChange={(e) => setSelectedBuildingId(e.target.value)}
                    className="w-full px-3 py-2 bg-[#161712] border-2 border-[#0A0B08] text-xs font-mono text-[#F2E8D5] rounded"
                  >
                    {buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.building_type.toUpperCase()} • H3 #{b.h3_index} (HP {b.hp})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-mono font-bold text-amber-300 uppercase tracking-wider block">
                  Aporte Personal de EC (Opcional, combinado con Tesorería)
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={personalEcContribution}
                  onChange={(e) => setPersonalEcContribution(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-3 py-1.5 bg-[#161712] border-2 border-[#0A0B08] text-xs font-mono text-[#F2E8D5] rounded"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableCatalogUnits.map(([code, unit]) => {
                  const isSelected = purchaseCode === code;
                  return (
                    <div
                      key={code}
                      onClick={() => {
                        audioManager.playHoverTick();
                        setPurchaseCode(code);
                      }}
                      className={`p-2 rounded-[6px_2px_6px_2px] border-2 cursor-pointer ${
                        isSelected
                          ? 'bg-[#2B2C24] border-emerald-400 shadow-[3px_3px_0px_#0A0B08]'
                          : 'bg-[#1C1E17] border-[#0A0B08] hover:border-[#46521F]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-display font-black uppercase text-[#F2E8D5]">
                          {unit.displayName}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-amber-400">
                          {unit.cost.toLocaleString()}G
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-[#F2E8D5]/60 mt-0.5">
                        Mov {unit.movementPoints} • {unit.facility.toUpperCase()}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Pie de Acción */}
        <div className="p-3.5 bg-[#2B2C24] border-t-3 border-[#0A0B08] flex items-center justify-between gap-3">
          {activeTab === 'deploy' ? (
            <>
              <div className="text-xs font-mono">
                <span className="text-[10px] text-[#F2E8D5]/60 block">CHASIS SELECCIONADO:</span>
                <span className="text-sm font-black text-amber-400">
                  {selectedSlot
                    ? `${selectedCatalogInfo?.displayName ?? selectedSlot.unitCode} (x${selectedSlot.quantity})`
                    : 'Ninguno'}
                </span>
              </div>

              <button
                type="button"
                disabled={
                  isSubmitting ||
                  !resolvedCorpId ||
                  !permissions.canControlUnits ||
                  !selectedSlot
                }
                onClick={handleExecuteDeploy}
                className="tactical-btn-heavy px-5 py-2.5 text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Swords className="w-4 h-4" />
                <span>{isSubmitting ? 'DESPLEGANDO...' : '¡DESPLEGAR EN COORDENADAS!'}</span>
              </button>
            </>
          ) : (
            <>
              <div className="text-xs font-mono">
                <span className="text-[10px] text-[#F2E8D5]/60 block">ORDEN DE COMPRA:</span>
                <span className="text-sm font-black text-emerald-400">
                  {CANONICAL_UNIT_PRODUCTION_CATALOG[purchaseCode]?.displayName ?? purchaseCode}
                </span>
              </div>

              <button
                type="button"
                disabled={
                  isSubmitting ||
                  !resolvedCorpId ||
                  !permissions.canPurchaseUnits ||
                  !selectedBuildingId
                }
                onClick={handlePurchaseFromBarracks}
                className="tactical-btn-heavy px-5 py-2.5 text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>{isSubmitting ? 'COMPRANDO...' : 'COMPRAR EN BARRACONES'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
