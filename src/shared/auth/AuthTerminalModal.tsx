import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield,
  Lock,
  User,
  AlertTriangle,
  ArrowRight,
  X,
  MailCheck,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import type { PkceStatus } from './useAuth';

export interface AuthSignInResult {
  success: boolean;
  needsEmailVerification?: boolean;
  error?: string;
}

export interface AuthSignUpResult {
  success: boolean;
  needsEmailVerification?: boolean;
  error?: string;
}

interface AuthTerminalModalProps {
  onSignIn: (email: string, pass: string, captchaToken?: string) => Promise<AuthSignInResult>;
  onSignUp: (
    email: string,
    pass: string,
    name: string,
    captchaToken?: string,
  ) => Promise<AuthSignUpResult>;
  onResendVerification?: (email: string) => Promise<{ success: boolean; error?: string }>;
  onCheckVerification?: () => Promise<{ verified: boolean; error?: string }>;
  onResetPending?: () => Promise<void> | void;
  error: string | null;
  pendingEmail?: string | null;
  pkceStatus?: PkceStatus;
  pkceError?: string | null;
  resendCooldownSec?: number;
  onClose?: () => void;
  customNotice?: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,24}$/;

function evaluatePasswordStrength(password: string): {
  score: number;
  label: string;
  valid: boolean;
} {
  if (!password) return { score: 0, label: 'VACÍA', valid: false };
  let score = 0;
  if (password.length >= 12) score += 2;
  else if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  const valid = password.length >= 12 && password.length <= 128 && score >= 4;
  if (score >= 6 && password.length >= 14) return { score: 4, label: 'CRIT-OK (ISO)', valid };
  if (valid) return { score: 3, label: 'SEGURA', valid };
  if (score >= 3) return { score: 2, label: 'DÉBIL (MÍN 12)', valid: false };
  return { score: 1, label: 'VULNERABLE', valid: false };
}

export const AuthTerminalModal: React.FC<AuthTerminalModalProps> = ({
  onSignIn,
  onSignUp,
  onResendVerification,
  onCheckVerification,
  onResetPending,
  error: authError,
  pendingEmail,
  pkceStatus = 'idle',
  pkceError,
  resendCooldownSec = 0,
  onClose,
  customNotice,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'pending_verification'>(
    pendingEmail ? 'pending_verification' : 'signin',
  );
  const [email, setEmail] = useState(pendingEmail || '');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (pendingEmail) {
      setEmail(pendingEmail);
      setMode('pending_verification');
    }
  }, [pendingEmail]);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const showDevQuickConnect =
    import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_QUICK_CONNECT === 'true';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setStatusMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setLocalError('Formato de frecuencia militar (correo electrónico) inválido.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signin') {
        const res = await onSignIn(cleanEmail, password);
        if (res.needsEmailVerification) {
          setMode('pending_verification');
          setStatusMessage('Verifica tu bandeja de entrada para activar el acceso.');
        } else if (!res.success) {
          setLocalError(res.error || 'Fallo de autenticación táctica');
        }
      } else if (mode === 'signup') {
        const cleanUser = username.trim();
        if (!USERNAME_REGEX.test(cleanUser)) {
          setLocalError('El indicativo debe tener 3–24 caracteres (letras, números, _ o -).');
          return;
        }
        if (!strength.valid) {
          setLocalError('La clave debe tener mínimo 12 caracteres y combinar mayúsculas, minúsculas y dígitos/símbolos.');
          return;
        }
        const lowerPass = password.toLowerCase();
        if (lowerPass.includes(cleanUser.toLowerCase()) || lowerPass.includes(cleanEmail.split('@')[0])) {
          setLocalError('La clave no puede contener tu indicativo ni tu correo electrónico.');
          return;
        }
        const res = await onSignUp(cleanEmail, password, cleanUser);
        if (!res.success) {
          setLocalError(res.error || 'Fallo en registro de nuevo oficial');
        } else if (res.needsEmailVerification) {
          setMode('pending_verification');
          setStatusMessage('Enlace PKCE enviado. Confirma tu correo para desbloquear el mapa táctico.');
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!onResendVerification || resendCooldownSec > 0) return;
    setLocalError(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    try {
      const target = (pendingEmail || email).trim().toLowerCase();
      const res = await onResendVerification(target);
      if (res.success) {
        setStatusMessage('Nuevo enlace de verificación transmitido a tu correo.');
      } else {
        setLocalError(res.error || 'No se pudo reenviar el enlace.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckVerification = async () => {
    if (!onCheckVerification) return;
    setLocalError(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    try {
      const res = await onCheckVerification();
      if (!res.verified) {
        setLocalError(res.error || 'Verificación aún no confirmada. Revisa tu bandeja o spam.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDevQuickConnect = async () => {
    if (!showDevQuickConnect) return;
    const devEmail = import.meta.env.VITE_DEV_QUICK_EMAIL || '';
    const devPass = import.meta.env.VITE_DEV_QUICK_PASSWORD || '';
    if (!devEmail || !devPass) {
      setLocalError('Configura VITE_DEV_QUICK_EMAIL y VITE_DEV_QUICK_PASSWORD en .env.local.');
      return;
    }
    setEmail(devEmail);
    setPassword(devPass);
    setIsSubmitting(true);
    setLocalError(null);
    try {
      const res = await onSignIn(devEmail, devPass);
      if (!res.success) {
        setLocalError(res.error || 'Error al conectar con credencial de prueba');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeError = localError || pkceError || authError;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="relative w-full max-w-md bg-[#2B2C24] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] overflow-hidden font-mono text-[#F2E8D5]">
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#181914] border-b-2 border-[#46521F]">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="DRONEPUNK" className="w-5 h-5 object-contain" />
            <span className="text-xs uppercase tracking-wider text-[#C46A3A] font-bold">
              DRONEPUNK // C4ISR — ENLACE DE SEGURIDAD SOBERANA
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-[#46521F] text-[#F2E8D5] border border-[#7B8A4A] px-2 py-0.5 rounded-[14px_4px_14px_4px] font-bold">
              ISO-27001
            </span>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-[#F2E8D5] bg-[#3B3C34] hover:bg-[#C46A3A] border border-[#7B8A4A] p-1 rounded-[14px_4px_14px_4px] transition-colors cursor-pointer"
                title="Cerrar y volver al Mapa Mundial [ESC]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          {customNotice && (
            <div className="flex items-start gap-2 p-3 bg-[#181914] border-2 border-[#7B8A4A] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] text-amber-300 text-xs font-sans">
              <Shield className="w-4 h-4 shrink-0 text-[#C46A3A] mt-0.5" />
              <span>{customNotice}</span>
            </div>
          )}

          {pkceStatus === 'verifying' && (
            <div className="flex items-center gap-2 p-3 bg-[#181914] border-2 border-[#7B8A4A] rounded-[14px_4px_14px_4px] text-xs text-emerald-300">
              <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              <span>Validando token criptográfico PKCE...</span>
            </div>
          )}

          <div className="space-y-1.5 text-center">
            <img src="/favicon.svg" alt="DRONEPUNK" className="w-9 h-9 mx-auto object-contain" />
            <div className="text-[11px] font-bold text-[#C46A3A] tracking-widest uppercase">
              DRONEPUNK // C4ISR
            </div>
            <h2 className="text-lg font-bold text-[#F2E8D5] tracking-widest uppercase">
              {mode === 'signin'
                ? 'IDENTIFICACIÓN DE COMANDANTE'
                : mode === 'signup'
                  ? 'REGISTRO DE NUEVA MATRÍCULA'
                  : 'VERIFICACIÓN DE CORREO OBLIGATORIA'}
            </h2>
            <p className="text-xs text-[#7B8A4A]">
              {mode === 'pending_verification'
                ? 'El teatro táctico permanece sellado hasta confirmar tu identidad.'
                : 'Acceso restringido a personal militar autorizado por el Alto Mando.'}
            </p>
          </div>

          {activeError && (
            <div className="flex items-start gap-2 p-3 bg-rose-950/80 border-2 border-[#0A0B08] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] text-rose-200 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{activeError}</span>
            </div>
          )}

          {statusMessage && (
            <div className="flex items-start gap-2 p-3 bg-emerald-950/70 border-2 border-[#7B8A4A] rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] text-emerald-200 text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{statusMessage}</span>
            </div>
          )}

          {mode === 'pending_verification' ? (
            <div className="space-y-4">
              <div className="p-4 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] space-y-2 text-xs">
                <div className="flex items-center gap-2 text-[#C46A3A] font-bold uppercase">
                  <MailCheck className="w-4 h-4" />
                  <span>Enlace PKCE transmitido</span>
                </div>
                <p className="text-[#F2E8D5]">
                  Correo destino: <span className="font-bold text-amber-300">{pendingEmail || email}</span>
                </p>
                <p className="text-[#7B8A4A]">
                  Abre el enlace enviado a tu bandeja de entrada (o carpeta Spam) para activar tu matrícula operativa.
                </p>
              </div>

              <button
                type="button"
                onClick={handleCheckVerification}
                disabled={isSubmitting}
                className="tactical-btn-heavy w-full py-2.5 px-4 text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSubmitting ? 'animate-spin' : ''}`} />
                <span>YA VERIFIQUÉ MI CORREO</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isSubmitting || resendCooldownSec > 0}
                  className="py-2 px-3 bg-[#181914] hover:bg-[#46521F] border-2 border-[#7B8A4A] text-[#F2E8D5] text-[11px] font-bold rounded-[14px_4px_14px_4px] uppercase cursor-pointer disabled:opacity-50"
                >
                  {resendCooldownSec > 0 ? `Reenviar (${resendCooldownSec}s)` : 'Reenviar Enlace'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (onResetPending) await onResetPending();
                    setMode('signin');
                    setLocalError(null);
                    setStatusMessage(null);
                  }}
                  className="py-2 px-3 bg-[#181914] hover:bg-[#3B3C34] border-2 border-[#46521F] text-[#7B8A4A] hover:text-[#F2E8D5] text-[11px] font-bold rounded-[14px_4px_14px_4px] uppercase cursor-pointer"
                >
                  Cambiar Correo
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div className="space-y-1">
                  <label className="text-[11px] text-[#7B8A4A] font-bold flex items-center gap-1.5 uppercase">
                    <User className="w-3.5 h-3.5 text-[#C46A3A]" />
                    Indicativo de Llamada
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ej. Commander_Viper"
                    className="w-full px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] text-sm text-[#F2E8D5] focus:outline-none focus:border-[#7B8A4A] transition-colors"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] text-[#7B8A4A] font-bold flex items-center gap-1.5 uppercase">
                  <Shield className="w-3.5 h-3.5 text-[#C46A3A]" />
                  Frecuencia Militar (Email Real)
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="comandante@dominio.com"
                  className="w-full px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] text-sm text-[#F2E8D5] focus:outline-none focus:border-[#7B8A4A] transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-[#7B8A4A] font-bold flex items-center gap-1.5 uppercase">
                  <Lock className="w-3.5 h-3.5 text-[#C46A3A]" />
                  Clave Criptográfica {mode === 'signup' ? '(Mín. 12 caracteres)' : ''}
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 bg-[#181914] border-2 border-[#46521F] rounded-[14px_4px_14px_4px] text-sm text-[#F2E8D5] focus:outline-none focus:border-[#7B8A4A] transition-colors"
                />
                {mode === 'signup' && password.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <div className="flex gap-1 h-1.5">
                      {[1, 2, 3, 4].map((lvl) => (
                        <div
                          key={lvl}
                          className={`flex-1 transition-colors ${
                            strength.score >= lvl
                              ? strength.valid
                                ? 'bg-emerald-500'
                                : 'bg-amber-500'
                              : 'bg-[#181914]'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="text-[10px] text-right text-[#7B8A4A] font-bold">
                      FORTALEZA: {strength.label}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="tactical-btn-heavy w-full py-2.5 px-4 text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span>DESCRIPTANDO ENLACE...</span>
                ) : (
                  <>
                    <span>{mode === 'signin' ? 'CONECTAR TERMINAL' : 'CREAR MATRÍCULA'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Quick Dev Connect (solo si DEV y flag explícito activo) */}
          {showDevQuickConnect && mode !== 'pending_verification' && (
            <div className="pt-2 border-t-2 border-[#46521F]">
              <button
                type="button"
                onClick={handleDevQuickConnect}
                disabled={isSubmitting}
                className="w-full py-2 px-3 bg-[#181914] hover:bg-[#46521F] border-2 border-[#7B8A4A] text-amber-400 text-xs font-bold rounded-[14px_4px_14px_4px] shadow-[4px_4px_0px_#0A0B08] uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Conexión Rápida Sandbox (DEV)</span>
              </button>
            </div>
          )}

          {/* Toggle Mode */}
          {mode !== 'pending_verification' && (
            <div className="text-center text-xs text-[#7B8A4A]">
              {mode === 'signin' ? (
                <span>
                  ¿No posees matrícula operativa?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signup');
                      setLocalError(null);
                      setStatusMessage(null);
                    }}
                    className="text-[#C46A3A] hover:underline cursor-pointer font-bold"
                  >
                    Solicitar Alta
                  </button>
                </span>
              ) : (
                <span>
                  ¿Ya cuentas con expediente activo?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setLocalError(null);
                      setStatusMessage(null);
                    }}
                    className="text-[#C46A3A] hover:underline cursor-pointer font-bold"
                  >
                    Iniciar Sesión
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
