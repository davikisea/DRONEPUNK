import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Users,
  PlusCircle,
  ArrowRight,
  RefreshCw,
  Coins,
  LogOut,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { audioManager } from '@domains/game-feel';
import {
  fetchCorpBuildings,
  collectHousingCitizens,
  syncPipelineLogistics,
  repairInfrastructure,
  type DbBuildingRecord,
} from '@domains/economy';
import {
  createCorporation,
  joinCorporation,
  listCorporations,
  fetchCorporationMembers,
  updateMemberPermissions,
  donateToCorporation,
  leaveCorporation,
  type MyCorporationContext,
  type CorporationRecord,
  type CorporationMemberRecord,
  type DelegatedPermissions,
} from '../services/corporationService';

export interface CorporationHubModuleProps {
  isVerifiedCommander: boolean;
  currentUserId: string | null;
  corpContext: MyCorporationContext | null;
  userBalances: {
    ec: number;
    alloys: number;
    fuel: number;
    chips: number;
  };
  onOpenAuthModal: (notice?: string) => void;
  onCorporationChanged: () => Promise<void> | void;
  extraHeadquartersContent?: React.ReactNode;
}

const PERMISSION_LABELS: Array<{ key: keyof DelegatedPermissions; label: string }> = [
  { key: 'can_use_treasury', label: 'Usar Tesorería' },
  { key: 'can_construct', label: 'Construir' },
  { key: 'can_remodel', label: 'Remodelar' },
  { key: 'can_collect', label: 'Recolectar' },
  { key: 'can_purchase_units', label: 'Comprar Chasis' },
  { key: 'can_control_units', label: 'Comandar Tropas' },
];

export const CorporationHubModule: React.FC<CorporationHubModuleProps> = ({
  isVerifiedCommander,
  currentUserId,
  corpContext,
  userBalances,
  onOpenAuthModal,
  onCorporationChanged,
  extraHeadquartersContent,
}) => {
  const [noCorpTab, setNoCorpTab] = useState<'create' | 'join'>('create');
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'donate' | 'hq'>('overview');

  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [corps, setCorps] = useState<CorporationRecord[]>([]);
  const [members, setMembers] = useState<CorporationMemberRecord[]>([]);
  const [corpBuildings, setCorpBuildings] = useState<DbBuildingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [donateEc, setDonateEc] = useState('0');
  const [donateAlloys, setDonateAlloys] = useState('0');
  const [donateFuel, setDonateFuel] = useState('0');
  const [donateChips, setDonateChips] = useState('0');

  const loadDirectory = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const list = await listCorporations();
      setCorps(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al consultar corporaciones.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (corpId: string) => {
    setIsLoading(true);
    try {
      const list = await fetchCorporationMembers(corpId);
      setMembers(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al consultar miembros.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!corpContext) {
      void loadDirectory();
    } else {
      void loadMembers(corpContext.corporation.id);
      void fetchCorpBuildings(corpContext.corporation.id)
        .then(setCorpBuildings)
        .catch(() => setCorpBuildings([]));
    }
  }, [corpContext, loadDirectory, loadMembers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isVerifiedCommander) {
      onOpenAuthModal('Inicia sesión con una cuenta verificada para fundar una Corporación.');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      await createCorporation(name, tag);
      audioManager.playSFX('co_power');
      setName('');
      setTag('');
      setSuccessMsg('Corporación constituida y registrada en base de datos.');
      await onCorporationChanged();
    } catch (err) {
      audioManager.playSFX('combat_hit');
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo constituir la Corporación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoin = async (corpId: string) => {
    if (!isVerifiedCommander) {
      onOpenAuthModal('Inicia sesión con una cuenta verificada para unirte a una Corporación.');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      await joinCorporation(corpId);
      audioManager.playSFX('co_power');
      setSuccessMsg('Ingreso corporativo confirmado.');
      await onCorporationChanged();
    } catch (err) {
      audioManager.playSFX('combat_hit');
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo ingresar a la Corporación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corpContext) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      await donateToCorporation(corpContext.corporation.id, {
        ec: Number(donateEc) || 0,
        alloys: Number(donateAlloys) || 0,
        fuel: Number(donateFuel) || 0,
        chips: Number(donateChips) || 0,
      });
      audioManager.playSFX('co_power');
      setDonateEc('0');
      setDonateAlloys('0');
      setDonateFuel('0');
      setDonateChips('0');
      setSuccessMsg('Donación acreditada en la tesorería corporativa.');
      await onCorporationChanged();
    } catch (err) {
      audioManager.playSFX('combat_hit');
      setErrorMsg(err instanceof Error ? err.message : 'Error al procesar donación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLeave = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      await leaveCorporation();
      audioManager.playCue('ui_cancel_rollback');
      setConfirmLeave(false);
      setSuccessMsg('Has abandonado la Corporación.');
      await onCorporationChanged();
    } catch (err) {
      audioManager.playSFX('combat_hit');
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo abandonar la Corporación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTogglePermission = async (
    member: CorporationMemberRecord,
    key: keyof DelegatedPermissions
  ) => {
    if (!corpContext) return;
    setErrorMsg(null);
    const updated: DelegatedPermissions = {
      ...member.delegated_permissions,
      [key]: !member.delegated_permissions[key],
    };
    try {
      await updateMemberPermissions(corpContext.corporation.id, member.user_id, member.role, updated);
      audioManager.play('menu_select');
      await loadMembers(corpContext.corporation.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo actualizar el permiso.');
    }
  };

  const isShareholder =
    corpContext?.membership.role === 'majority_shareholder' ||
    corpContext?.membership.role === 'shareholder';

  return (
    <div className="w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-5 font-mono text-[#F2E8D5]">
      {!isVerifiedCommander && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#181914] border-2 border-[#D9822B] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08]">
          <div className="flex items-start gap-2.5 text-xs">
            <Lock className="w-4 h-4 text-[#D9822B] shrink-0 mt-0.5" />
            <span>
              Estás explorando en <strong>Modo Visitante</strong>. Puedes consultar el directorio de
              Corporaciones; inicia sesión con cuenta verificada para fundar, unirte, donar o gestionar.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenAuthModal()}
            className="tactical-btn-heavy px-4 py-2 text-xs shrink-0 cursor-pointer"
          >
            Conectar Terminal
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2 p-3 bg-rose-950/80 border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] text-rose-200 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-2 p-3 bg-emerald-950/70 border-2 border-[#7B8A4A] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] text-emerald-200 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* CASO A: SIN CORPORACIÓN ACTIVA -> CREAR O UNIRSE EN EL MÓDULO */}
      {!corpContext ? (
        <div className="bg-[#2B2C24] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-[#181914] border-b-2 border-[#46521F]">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#C46A3A]" />
              <h2 className="text-sm font-black uppercase tracking-wider">
                REGISTRO CORPORATIVO (MODULO EN JUEGO)
              </h2>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNoCorpTab('create')}
                className={`px-3 py-1.5 text-xs font-bold uppercase rounded-[14px_4px_14px_4px] border cursor-pointer ${
                  noCorpTab === 'create'
                    ? 'bg-[#C46A3A] text-[#0A0B08] border-[#0A0B08]'
                    : 'bg-[#2B2C24] text-[#F2E8D5] border-[#46521F]'
                }`}
              >
                <PlusCircle className="w-3.5 h-3.5 inline mr-1" />
                Fundar Corporación
              </button>
              <button
                type="button"
                onClick={() => {
                  setNoCorpTab('join');
                  void loadDirectory();
                }}
                className={`px-3 py-1.5 text-xs font-bold uppercase rounded-[14px_4px_14px_4px] border cursor-pointer ${
                  noCorpTab === 'join'
                    ? 'bg-[#C46A3A] text-[#0A0B08] border-[#0A0B08]'
                    : 'bg-[#2B2C24] text-[#F2E8D5] border-[#46521F]'
                }`}
              >
                <Users className="w-3.5 h-3.5 inline mr-1" />
                Directorio ({corps.length})
              </button>
            </div>
          </div>

          <div className="p-5">
            {noCorpTab === 'create' ? (
              <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#7B8A4A] uppercase">
                    Nombre de Corporación (3–50 caracteres)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={50}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ej. Vanguardia Isea"
                    className="w-full px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] text-sm text-[#F2E8D5]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#7B8A4A] uppercase">
                    Ticker / Tag (2–5 letras)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={5}
                    value={tag}
                    onChange={(e) => setTag(e.target.value.toUpperCase())}
                    placeholder="ISEA"
                    className="w-full px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] text-sm uppercase text-[#F2E8D5]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="tactical-btn-heavy px-5 py-2.5 text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <span>FUNDAR CORPORACIÓN Y ASUMIR 100 ACCIONES</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[#7B8A4A]">
                    Corporaciones activas en Supabase (`public.corporations`)
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadDirectory()}
                    className="px-2.5 py-1 bg-[#181914] border border-[#7B8A4A] rounded-[14px_4px_14px_4px] text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    Actualizar
                  </button>
                </div>
                {corps.length === 0 ? (
                  <p className="text-xs text-[#7B8A4A] py-6 text-center">
                    No hay corporaciones fundadas aún. ¡Sé el primero en fundar una!
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {corps.map((c) => (
                      <div
                        key={c.id}
                        className="p-4 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] flex flex-col justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-black text-sm text-[#F2E8D5]">
                              [{c.tag}] {c.name}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 bg-[#46521F] rounded-[14px_4px_14px_4px]">
                              TECH Nv.{c.tech_level}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#7B8A4A] mt-1">
                            EC: {c.treasury_ec} • Alloys: {c.treasury_alloys} • Fuel: {c.treasury_fuel} • Chips:{' '}
                            {c.treasury_chips}
                          </div>
                          <div className="text-[11px] text-amber-300/90 mt-0.5">
                            Municipios: {c.controlled_municipalities_count} • Estados: {c.controlled_states_count}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleJoin(c.id)}
                          disabled={isSubmitting}
                          className="tactical-btn-heavy py-1.5 px-3 text-xs cursor-pointer disabled:opacity-50"
                        >
                          Unirse como Miembro
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* CASO B: CORPORACIÓN ACTIVA -> RESUMEN DB, MIEMBROS/PERMISOS, DONAR Y ABANDONAR */
        <div className="space-y-4">
          <div className="bg-[#2B2C24] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-[11px] text-[#C46A3A] font-bold uppercase tracking-widest">
                CORPORACIÓN ACTIVA • TECH NIVEL {corpContext.corporation.tech_level}
              </div>
              <h2 className="text-xl font-black uppercase">
                [{corpContext.corporation.tag}] {corpContext.corporation.name}
              </h2>
              <div className="text-xs text-[#7B8A4A] mt-0.5">
                Tu Rango: <span className="text-amber-300 font-bold">{corpContext.membership.role}</span> •{' '}
                Acciones: <span className="text-[#F2E8D5] font-bold">{corpContext.membership.shares}</span> •{' '}
                Municipios: {corpContext.corporation.controlled_municipalities_count} • Estados:{' '}
                {corpContext.corporation.controlled_states_count}
              </div>
            </div>

            <div>
              {!confirmLeave ? (
                <button
                  type="button"
                  onClick={() => setConfirmLeave(true)}
                  className="px-3 py-2 bg-red-950/80 hover:bg-red-800 border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] text-xs font-bold text-red-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Abandonar Corporación
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLeave()}
                    disabled={isSubmitting}
                    className="px-3 py-2 bg-red-700 hover:bg-red-600 border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] text-xs font-black text-white cursor-pointer"
                  >
                    Confirmar Salida
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(false)}
                    className="px-3 py-2 bg-[#181914] border border-[#7B8A4A] rounded-[14px_4px_14px_4px] text-xs cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Navegación interna del módulo */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'overview' as const, label: 'Tesorería & Estado DB' },
              { id: 'members' as const, label: `Miembros & Permisos (${members.length})` },
              { id: 'donate' as const, label: 'Donar Recursos' },
              ...(extraHeadquartersContent ? [{ id: 'hq' as const, label: 'Cuartel Táctico & Alianza' }] : []),
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3.5 py-2 text-xs font-bold uppercase rounded-[14px_4px_14px_4px] border-2 cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-[#C46A3A] text-[#0A0B08] border-[#0A0B08] shadow-[4px_4px_0px_#0A0B08]'
                    : 'bg-[#181914] text-[#F2E8D5] border-[#46521F]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] text-[#7B8A4A] uppercase font-bold">
                    Población de Ciudadanos (Viviendas) & Logística Tuberías
                  </div>
                  <div className="text-lg font-black text-emerald-400">
                    {corpContext.corporation.treasury_citizens ?? 0} /{' '}
                    {corpContext.corporation.population_cap ?? 10} Ciudadanos
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={async () => {
                      setErrorMsg(null);
                      setSuccessMsg(null);
                      setIsSubmitting(true);
                      try {
                        const res = (await syncPipelineLogistics(corpContext.corporation.id)) as {
                          alloys?: number;
                          fuel?: number;
                          chips?: number;
                        } | null;
                        audioManager.playCue('ui_tile_confirm');
                        setSuccessMsg(
                          `Tuberías sincronizadas (+${res?.alloys ?? 0} Alloys, +${res?.fuel ?? 0} Fuel, +${res?.chips ?? 0} Chips).`,
                        );
                        await onCorporationChanged();
                      } catch (err) {
                        setErrorMsg(err instanceof Error ? err.message : 'Error sincronizando tuberías.');
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    className="tactical-btn-heavy px-3 py-1.5 text-[11px] cursor-pointer disabled:opacity-50"
                  >
                    Sincronizar Tuberías
                  </button>
                </div>
              </div>

              {corpBuildings.length > 0 && (
                <div className="p-4 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] space-y-2">
                  <div className="text-[11px] font-bold text-[#C46A3A] uppercase">
                    Infraestructura Corporativa ({corpBuildings.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {corpBuildings.map((b) => {
                      const isHousing = b.building_type === 'housing';
                      const isRuined = b.is_disabled || b.hp <= 0;
                      return (
                        <div
                          key={b.id}
                          className="flex items-center justify-between gap-2 p-2 bg-[#2B2C24] border border-[#46521F] rounded-[14px_4px_14px_4px] text-xs"
                        >
                          <div>
                            <span className="font-bold uppercase">{b.building_type}</span> • Nv.{b.level} •{' '}
                            <span className={isRuined ? 'text-rose-400' : 'text-emerald-400'}>
                              {isRuined ? 'RUINED' : `${b.hp} HP`}
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            {isHousing && !isRuined && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={async () => {
                                  setErrorMsg(null);
                                  setIsSubmitting(true);
                                  try {
                                    await collectHousingCitizens(b.id, corpContext.corporation.id, false);
                                    audioManager.playCue('ui_tile_confirm');
                                    setSuccessMsg('Ciudadanos recolectados en la Corporación.');
                                    await onCorporationChanged();
                                  } catch (err) {
                                    setErrorMsg(err instanceof Error ? err.message : 'Error recolectando ciudadanos.');
                                  } finally {
                                    setIsSubmitting(false);
                                  }
                                }}
                                className="px-2 py-1 bg-[#46521F] border border-[#7B8A4A] rounded-[14px_4px_14px_4px] text-[10px] font-bold cursor-pointer"
                              >
                                Recolectar Ciudadanos
                              </button>
                            )}
                            {isRuined && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={async () => {
                                  setErrorMsg(null);
                                  setIsSubmitting(true);
                                  try {
                                    await repairInfrastructure('building', b.id, corpContext.corporation.id);
                                    audioManager.playCue('co_power_charge');
                                    setSuccessMsg('Infraestructura reparada (~35% costo).');
                                    const updated = await fetchCorpBuildings(corpContext.corporation.id);
                                    setCorpBuildings(updated);
                                    await onCorporationChanged();
                                  } catch (err) {
                                    setErrorMsg(err instanceof Error ? err.message : 'Error reparando edificio.');
                                  } finally {
                                    setIsSubmitting(false);
                                  }
                                }}
                                className="px-2 py-1 bg-amber-900/70 border border-amber-500 rounded-[14px_4px_14px_4px] text-[10px] font-bold cursor-pointer"
                              >
                                Reparar (~35%)
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Tesorería EC', val: corpContext.corporation.treasury_ec },
                  { label: 'Aleaciones (Alloys)', val: corpContext.corporation.treasury_alloys },
                  { label: 'Combustible (Fuel)', val: corpContext.corporation.treasury_fuel },
                  { label: 'Microchips (Chips)', val: corpContext.corporation.treasury_chips },
                  { label: 'Tierras Raras', val: corpContext.corporation.treasury_rare_earth },
                  { label: 'Compuestos', val: corpContext.corporation.treasury_composites },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="p-4 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08]"
                  >
                    <div className="text-[10px] text-[#7B8A4A] uppercase font-bold">{item.label}</div>
                    <div className="text-xl font-black text-amber-300 mt-1">{item.val.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'members' && (
            <div className="space-y-3">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="p-4 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#C46A3A]" />
                      <span className="text-xs font-bold">
                        {m.user_id === currentUserId ? 'TÚ (' + m.user_id.slice(0, 8) + ')' : m.user_id.slice(0, 8)}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 bg-[#46521F] rounded-[14px_4px_14px_4px] uppercase">
                        {m.role}
                      </span>
                    </div>
                    <span className="text-xs text-amber-300 font-bold">{m.shares} Acciones</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {PERMISSION_LABELS.map((p) => {
                      const active = m.delegated_permissions[p.key];
                      const canEdit = isShareholder && m.role !== 'majority_shareholder';
                      return (
                        <button
                          key={p.key}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => void handleTogglePermission(m, p.key)}
                          className={`px-2.5 py-1.5 text-[11px] font-bold rounded-[14px_4px_14px_4px] border text-left ${
                            active
                              ? 'bg-emerald-950/70 border-emerald-500/70 text-emerald-300'
                              : 'bg-[#2B2C24] border-[#46521F] text-[#7B8A4A]'
                          } ${canEdit ? 'cursor-pointer hover:border-[#C46A3A]' : 'opacity-80 cursor-default'}`}
                        >
                          {active ? '✓ ' : '✕ '}
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'donate' && (
            <form
              onSubmit={handleDonate}
              className="p-5 bg-[#2B2C24] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] space-y-4 max-w-xl"
            >
              <div className="flex items-center gap-2 text-sm font-black uppercase">
                <Coins className="w-5 h-5 text-[#C46A3A]" />
                <span>Transferir Recursos Personales a Tesorería</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[#7B8A4A] font-bold">EC (Disp: {userBalances.ec})</label>
                  <input
                    type="number"
                    min={0}
                    max={userBalances.ec}
                    value={donateEc}
                    onChange={(e) => setDonateEc(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px]"
                  />
                </div>
                <div>
                  <label className="text-[#7B8A4A] font-bold">Alloys / Acero (Disp: {userBalances.alloys})</label>
                  <input
                    type="number"
                    min={0}
                    max={userBalances.alloys}
                    value={donateAlloys}
                    onChange={(e) => setDonateAlloys(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px]"
                  />
                </div>
                <div>
                  <label className="text-[#7B8A4A] font-bold">Fuel (Disp: {userBalances.fuel})</label>
                  <input
                    type="number"
                    min={0}
                    max={userBalances.fuel}
                    value={donateFuel}
                    onChange={(e) => setDonateFuel(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px]"
                  />
                </div>
                <div>
                  <label className="text-[#7B8A4A] font-bold">Chips (Disp: {userBalances.chips})</label>
                  <input
                    type="number"
                    min={0}
                    max={userBalances.chips}
                    value={donateChips}
                    onChange={(e) => setDonateChips(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px]"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="tactical-btn-heavy px-5 py-2.5 text-xs cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'TRANSFIRIENDO...' : 'CONFIRMAR DONACIÓN'}
              </button>
            </form>
          )}

          {activeTab === 'hq' && extraHeadquartersContent}
        </div>
      )}
    </div>
  );
};
