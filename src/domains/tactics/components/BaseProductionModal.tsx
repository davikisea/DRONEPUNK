import React, { useState } from 'react';
import { X, Factory, Anchor, Plane, Users, Coins, AlertTriangle, ShieldCheck } from 'lucide-react';
import { UNIT_GREEN_SPRITE_PATHS, resolveUnitSpriteKey } from '@shared';
import { recruitAndDeployUnit } from '@domains/economy';
import { audioManager } from '@domains/game-feel';

export interface BaseProductionModalProps {
  isOpen: boolean;
  onClose: () => void;
  corpId: string;
  buildingId: string;
  buildingType: 'factory' | 'barracks' | 'port' | 'airport' | 'hq';
  h3Index: number;
  corpEc: number;
  corpCitizens: number;
  canPurchaseUnits: boolean;
  canControlUnits: boolean;
  isRuined?: boolean;
  onDeployed?: () => Promise<void> | void;
}

const FACILITY_UNITS: Record<string, Array<{ code: string; name: string; ec: number; citizens: number }>> = {
  factory: [
    { code: 'infantry', name: 'Infantería Ligera', ec: 100, citizens: 1 },
    { code: 'mech', name: 'Infantería Mecanizada', ec: 200, citizens: 1 },
    { code: 'recon', name: 'Reconocimiento', ec: 250, citizens: 1 },
    { code: 'apc', name: 'APC Logístico', ec: 400, citizens: 1 },
    { code: 'tank', name: 'Tanque Ligero', ec: 500, citizens: 1 },
    { code: 'md_tank', name: 'Tanque Medio', ec: 850, citizens: 1 },
    { code: 'artillery', name: 'Artillería Táctica', ec: 600, citizens: 1 },
    { code: 'antiair', name: 'Defensa Antiaérea', ec: 650, citizens: 1 },
  ],
  barracks: [
    { code: 'infantry', name: 'Infantería Ligera', ec: 100, citizens: 1 },
    { code: 'mech', name: 'Infantería Mecanizada', ec: 200, citizens: 1 },
  ],
  hq: [
    { code: 'infantry', name: 'Infantería Ligera', ec: 100, citizens: 1 },
    { code: 'recon', name: 'Reconocimiento', ec: 250, citizens: 1 },
  ],
  port: [
    { code: 'lander', name: 'Lancha de Desembarco', ec: 700, citizens: 1 },
    { code: 'cruiser', name: 'Crucero Escolta', ec: 1100, citizens: 1 },
    { code: 'sub', name: 'Submarino Táctico', ec: 1200, citizens: 1 },
  ],
  airport: [
    { code: 't_copter', name: 'Helicóptero Transporte', ec: 500, citizens: 1 },
    { code: 'b_copter', name: 'Helicóptero Combate', ec: 750, citizens: 1 },
    { code: 'fighter', name: 'Caza Interceptor', ec: 1250, citizens: 1 },
    { code: 'bomber', name: 'Bombardero Pesado', ec: 1450, citizens: 1 },
  ],
};

export const BaseProductionModal: React.FC<BaseProductionModalProps> = ({
  isOpen,
  onClose,
  corpId,
  buildingId,
  buildingType,
  h3Index,
  corpEc,
  corpCitizens,
  canPurchaseUnits,
  canControlUnits,
  isRuined = false,
  onDeployed,
}) => {
  const [submittingCode, setSubmittingCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const units = FACILITY_UNITS[buildingType] || FACILITY_UNITS.factory;
  const hasPerms = canPurchaseUnits && canControlUnits;

  const handleRecruit = async (unitCode: string) => {
    if (!hasPerms || isRuined) return;
    setErrorMsg(null);
    setSubmittingCode(unitCode);
    try {
      await recruitAndDeployUnit({
        corpId,
        buildingId,
        unitCode,
        tier: 1,
        targetH3Index: h3Index,
      });
      audioManager.playCue('co_power_charge');
      await onDeployed?.();
      onClose();
    } catch (err) {
      audioManager.playCue('ui_cancel_rollback');
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo reclutar y desplegar la unidad.');
    } finally {
      setSubmittingCode(null);
    }
  };

  const Icon = buildingType === 'port' ? Anchor : buildingType === 'airport' ? Plane : Factory;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-[#2B2C24] border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] overflow-hidden font-mono text-[#F2E8D5]">
        <div className="flex items-center justify-between px-5 py-3 bg-[#181914] border-b-2 border-[#46521F]">
          <div className="flex items-center gap-2.5">
            <Icon className="w-5 h-5 text-[#C46A3A]" />
            <div>
              <div className="text-[10px] text-[#C46A3A] font-bold uppercase tracking-widest">
                PRODUCCIÓN DIRECTA ADVANCE WARS // {buildingType.toUpperCase()}
              </div>
              <h2 className="text-sm font-black uppercase">DESPLIEGUE DE FUERZAS DE BASE</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              audioManager.playCue('ui_cancel_rollback');
              onClose();
            }}
            className="p-1.5 bg-[#3B3C34] hover:bg-[#C46A3A] border border-[#7B8A4A] rounded-[14px_4px_14px_4px] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#181914] border border-[#46521F] rounded-[14px_4px_14px_4px] text-xs">
            <span className="flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-amber-300" />
              Tesorería EC: <strong className="text-amber-300">{corpEc.toLocaleString()}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-emerald-400" />
              Ciudadanos: <strong className="text-emerald-400">{corpCitizens}</strong>
            </span>
            <span className="flex items-center gap-1 text-[10px] text-[#7B8A4A]">
              <ShieldCheck className="w-3.5 h-3.5" />
              {hasPerms ? 'Permisos OK' : 'Requiere can_purchase_units + can_control_units'}
            </span>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-rose-950/80 border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] text-rose-200 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {units.map((u) => {
              const sprite = UNIT_GREEN_SPRITE_PATHS[resolveUnitSpriteKey(u.code)];
              const canAfford = corpEc >= u.ec && corpCitizens >= u.citizens;
              const disabled = !hasPerms || isRuined || !canAfford || submittingCode !== null;
              return (
                <div
                  key={u.code}
                  className="flex items-center justify-between gap-3 p-3 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px]"
                >
                  <div className="flex items-center gap-3">
                    {sprite && <img src={sprite} alt={u.name} className="w-8 h-8 object-contain" />}
                    <div>
                      <div className="text-xs font-black uppercase">{u.name}</div>
                      <div className="text-[11px] text-[#7B8A4A]">
                        {u.ec} EC • {u.citizens} Ciudadano • 100 HP (T1)
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void handleRecruit(u.code)}
                    className="tactical-btn-heavy px-3 py-1.5 text-[11px] cursor-pointer disabled:opacity-45"
                  >
                    {submittingCode === u.code ? 'DESPLEGANDO...' : 'CREAR Y DESPLEGAR'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
