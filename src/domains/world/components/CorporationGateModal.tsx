import React, { useEffect, useState } from 'react';
import { Building2, ShieldAlert, Users, PlusCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { audioManager } from '@domains/game-feel';
import {
  createCorporation,
  joinCorporation,
  listCorporations,
  type CorporationRecord,
} from '../services/corporationService';

export interface CorporationGateModalProps {
  username: string;
  onCorporationReady: () => Promise<void> | void;
}

export const CorporationGateModal: React.FC<CorporationGateModalProps> = ({
  username,
  onCorporationReady,
}) => {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [corps, setCorps] = useState<CorporationRecord[]>([]);
  const [isLoadingCorps, setIsLoadingCorps] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadCorps = async () => {
    setIsLoadingCorps(true);
    setErrorMsg(null);
    try {
      const list = await listCorporations();
      setCorps(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al consultar corporaciones.');
    } finally {
      setIsLoadingCorps(false);
    }
  };

  useEffect(() => {
    if (tab === 'join') {
      void loadCorps();
    }
  }, [tab]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await createCorporation(name, tag);
      audioManager.playSFX('co_power');
      await onCorporationReady();
    } catch (err) {
      audioManager.playSFX('combat_hit');
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo constituir la Corporación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoin = async (corpId: string) => {
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await joinCorporation(corpId);
      audioManager.playSFX('co_power');
      await onCorporationReady();
    } catch (err) {
      audioManager.playSFX('combat_hit');
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo ingresar a la Corporación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#060806]/90 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Registro Corporativo Obligatorio"
    >
      <div className="w-full max-w-xl bg-[#141712] border-2 border-[#D9822B] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] overflow-hidden text-[#ECE8DF]">
        {/* Cabecera Indie C4ISR con ícono oficial DRONEPUNK */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#1C2118] border-b-2 border-[#2B3325]">
          <div className="flex items-center gap-3">
            <img
              src="/favicon.svg"
              alt="DRONEPUNK"
              className="w-10 h-10 rounded-[8px_2px_8px_2px] border-2 border-[#D9822B] bg-[#0A0B08] p-1 shadow-[2px_2px_0px_#0A0B08]"
            />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#D9822B]">
                C4ISR PROTOCOL // ACCESO TERRITORIAL BLOQUEADO
              </div>
              <h2 className="text-lg font-black tracking-wide uppercase">
                CONSTITUCIÓN DE CORPORACIÓN
              </h2>
            </div>
          </div>
          <span className="px-2.5 py-1 text-[11px] font-mono font-bold bg-[#0A0B08] border border-[#D9822B]/60 text-[#F2B705] rounded-[6px_2px_6px_2px]">
            CMD: {username}
          </span>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-3 bg-[#1E1A12] border-l-4 border-[#F2B705] rounded-[8px_2px_8px_2px] text-xs leading-relaxed text-[#E5DFD0]">
            <ShieldAlert className="w-5 h-5 text-[#F2B705] shrink-0 mt-0.5" />
            <div>
              Toda operación sobre el mapa, edificios, tesorería y barracones requiere una{' '}
              <strong className="text-[#F2B705]">Corporación activa en Base de Datos</strong>. Si fundas
              una nueva Corporación asumirás el rango de{' '}
              <strong className="text-[#4ADE80]">Accionista Mayoritario</strong>.
            </div>
          </div>

          {/* Selector de pestañas */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                audioManager.playSFX('button_click');
                setTab('create');
              }}
              className={`tactical-btn-heavy flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-black uppercase tracking-wider rounded-[10px_3px_10px_3px] border-2 shadow-[3px_3px_0px_#0A0B08] transition-transform ${
                tab === 'create'
                  ? 'bg-[#D9822B] border-[#F2B705] text-[#0A0B08]'
                  : 'bg-[#1A1F16] border-[#2E3628] text-[#B8B2A4] hover:border-[#D9822B]'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              Fundar Corporación
            </button>
            <button
              type="button"
              onClick={() => {
                audioManager.playSFX('button_click');
                setTab('join');
              }}
              className={`tactical-btn-heavy flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-black uppercase tracking-wider rounded-[10px_3px_10px_3px] border-2 shadow-[3px_3px_0px_#0A0B08] transition-transform ${
                tab === 'join'
                  ? 'bg-[#D9822B] border-[#F2B705] text-[#0A0B08]'
                  : 'bg-[#1A1F16] border-[#2E3628] text-[#B8B2A4] hover:border-[#D9822B]'
              }`}
            >
              <Users className="w-4 h-4" />
              Unirse como Miembro
            </button>
          </div>

          {errorMsg && (
            <div className="p-2.5 bg-[#3B1212] border-2 border-[#EF4444] rounded-[8px_2px_8px_2px] text-xs font-mono text-[#FCA5A5]">
              {errorMsg}
            </div>
          )}

          {tab === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-[#B8B2A4] mb-1">
                  Nombre de Corporación (3-50 caracteres)
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={50}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Ferro Industria Zulia"
                  className="w-full px-3 py-2 bg-[#0A0B08] border-2 border-[#2E3628] focus:border-[#D9822B] rounded-[8px_2px_8px_2px] text-sm font-mono text-[#ECE8DF] outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-[#B8B2A4] mb-1">
                  Ticker / Tag (2-5 letras)
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={5}
                  value={tag}
                  onChange={(e) => setTag(e.target.value.toUpperCase())}
                  placeholder="FERRO"
                  className="w-full px-3 py-2 bg-[#0A0B08] border-2 border-[#2E3628] focus:border-[#D9822B] rounded-[8px_2px_8px_2px] text-sm font-mono uppercase text-[#F2B705] outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="tactical-btn-heavy w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#4ADE80] hover:bg-[#22C55E] disabled:opacity-50 text-[#0A0B08] font-black text-xs uppercase tracking-widest rounded-[10px_3px_10px_3px] border-2 border-[#0A0B08] shadow-[4px_4px_0px_#0A0B08]"
              >
                <Building2 className="w-4 h-4" />
                {isSubmitting ? 'Registrando en PostgreSQL...' : 'Registrar Corporación y Asumir Acciones'}
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase text-[#B8B2A4]">
                  Corporaciones Activas en DB
                </span>
                <button
                  type="button"
                  onClick={() => void loadCorps()}
                  className="flex items-center gap-1 text-[11px] font-mono text-[#D9822B] hover:text-[#F2B705]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCorps ? 'animate-spin' : ''}`} />
                  Actualizar
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {corps.length === 0 ? (
                  <div className="p-4 text-center text-xs font-mono text-[#8A8578] border-2 border-dashed border-[#2E3628] rounded-[10px_3px_10px_3px]">
                    {isLoadingCorps
                      ? 'Consultando corporaciones...'
                      : 'No hay corporaciones registradas aún. ¡Funda la primera!'}
                  </div>
                ) : (
                  corps.map((corp) => (
                    <div
                      key={corp.id}
                      className="flex items-center justify-between p-3 bg-[#0E110C] border-2 border-[#2B3325] rounded-[10px_3px_10px_3px]"
                    >
                      <div>
                        <div className="text-sm font-black text-[#ECE8DF]">
                          [{corp.tag}] {corp.name}
                        </div>
                        <div className="text-[11px] font-mono text-[#9A9486]">
                          Municipios: {corp.controlled_municipalities_count} | Tech Nv.{corp.tech_level}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => void handleJoin(corp.id)}
                        className="tactical-btn-heavy flex items-center gap-1.5 px-3 py-1.5 bg-[#D9822B] text-[#0A0B08] text-xs font-black uppercase rounded-[8px_2px_8px_2px] border-2 border-[#0A0B08] shadow-[2px_2px_0px_#0A0B08]"
                      >
                        Ingresar
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
