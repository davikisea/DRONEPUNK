import { useState, useEffect, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase/client';
import { Database } from '../types/database.types';
import { emitAuthTelemetry } from './clientTelemetry';

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'yopmail.com',
  'throwawaymail.com',
  'trashmail.com',
]);

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type IndustrialInventoryRow = Database['public']['Tables']['user_industrial_inventory']['Row'];
export type CorporationMemberRow = Database['public']['Tables']['corporation_members']['Row'];

export type PkceStatus = 'idle' | 'verifying' | 'verified' | 'error';

export interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  industrialInventory: IndustrialInventoryRow | null;
  corpMembership: CorporationMemberRow | null;
  isLoading: boolean;
  error: string | null;
  isEmailVerified: boolean;
  pendingEmail: string | null;
  pkceStatus: PkceStatus;
  pkceError: string | null;
  resendCooldownSec: number;
}

interface HydratedAccountData {
  profile: Profile | null;
  industrialInventory: IndustrialInventoryRow | null;
  corpMembership: CorporationMemberRow | null;
  error: string | null;
}

function checkUserEmailConfirmed(user: User | null): boolean {
  if (!user) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    industrialInventory: null,
    corpMembership: null,
    isLoading: true,
    error: null,
    isEmailVerified: false,
    pendingEmail: null,
    pkceStatus: 'idle',
    pkceError: null,
    resendCooldownSec: 0,
  });

  // Countdown para cooldown de reenvío de verificación
  useEffect(() => {
    if (state.resendCooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setState((prev) => ({
        ...prev,
        resendCooldownSec: Math.max(0, prev.resendCooldownSec - 1),
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.resendCooldownSec]);

  const fetchAccountHydration = useCallback(async (userId: string): Promise<HydratedAccountData> => {
    try {
      const [profileRes, inventoryRes, membershipRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('user_industrial_inventory')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('corporation_members')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);

      const firstError = profileRes.error || inventoryRes.error || membershipRes.error;
      if (firstError) {
        console.error('[useAuth] Error hydrating account from Supabase:', firstError);
        return {
          profile: profileRes.data ?? null,
          industrialInventory: inventoryRes.data ?? null,
          corpMembership: membershipRes.data ?? null,
          error: firstError.message || 'Error al sincronizar el perfil con Supabase.',
        };
      }

      return {
        profile: profileRes.data ?? null,
        industrialInventory: inventoryRes.data ?? null,
        corpMembership: membershipRes.data ?? null,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error inesperado de conexión con Supabase.';
      console.error('[useAuth] Unexpected error hydrating account:', err);
      return {
        profile: null,
        industrialInventory: null,
        corpMembership: null,
        error: message,
      };
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!state.user) return;
    const hydrated = await fetchAccountHydration(state.user.id);
    setState((prev) => ({
      ...prev,
      profile: hydrated.error ? prev.profile : hydrated.profile,
      industrialInventory: hydrated.error ? prev.industrialInventory : hydrated.industrialInventory,
      corpMembership: hydrated.error ? prev.corpMembership : hydrated.corpMembership,
      error: hydrated.error,
    }));
  }, [state.user, fetchAccountHydration]);

  useEffect(() => {
    let mounted = true;

    const bootstrapSession = async () => {
      let pkceStatus: PkceStatus = 'idle';
      let pkceError: string | null = null;

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const urlError = params.get('error_description') || params.get('error');

        if (urlError) {
          pkceStatus = 'error';
          pkceError = decodeURIComponent(urlError.replace(/\+/g, ' '));
          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (code) {
          setState((prev) => ({ ...prev, pkceStatus: 'verifying' }));
          const { data: exchangeData, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
          window.history.replaceState({}, document.title, window.location.pathname);
          if (exchangeErr) {
            pkceStatus = 'error';
            pkceError = exchangeErr.message || 'El enlace de verificación expiró o ya fue utilizado.';
          } else if (exchangeData.session?.user) {
            pkceStatus = 'verified';
            void emitAuthTelemetry('email_verified', { method: 'pkce_callback' });
          }
        }
      }

      const { data: { session }, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        setState((prev) => ({
          ...prev,
          user: null,
          session: null,
          profile: null,
          industrialInventory: null,
          corpMembership: null,
          isLoading: false,
          error: error.message,
          isEmailVerified: false,
          pkceStatus,
          pkceError,
        }));
        return;
      }

      if (session?.user) {
        const verified = checkUserEmailConfirmed(session.user);
        const hydrated = verified
          ? await fetchAccountHydration(session.user.id)
          : { profile: null, industrialInventory: null, corpMembership: null, error: null };
        if (mounted) {
          setState((prev) => ({
            ...prev,
            user: session.user,
            session,
            profile: hydrated.profile,
            industrialInventory: hydrated.industrialInventory,
            corpMembership: hydrated.corpMembership,
            isLoading: false,
            error: hydrated.error,
            isEmailVerified: verified,
            pendingEmail: verified ? null : (session.user.email ?? prev.pendingEmail),
            pkceStatus,
            pkceError,
          }));
        }
      } else if (mounted) {
        setState((prev) => ({
          ...prev,
          user: null,
          session: null,
          profile: null,
          industrialInventory: null,
          corpMembership: null,
          isLoading: false,
          error: null,
          isEmailVerified: false,
          pkceStatus,
          pkceError,
        }));
      }
    };

    void bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (session?.user) {
        const verified = checkUserEmailConfirmed(session.user);
        const hydrated = verified
          ? await fetchAccountHydration(session.user.id)
          : { profile: null, industrialInventory: null, corpMembership: null, error: null };

        if (event === 'SIGNED_IN' && verified) {
          void emitAuthTelemetry('login_success', { auth_event: event });
        } else if (event === 'USER_UPDATED' && verified) {
          void emitAuthTelemetry('email_verified', { auth_event: event });
        }

        if (mounted) {
          setState((prev) => ({
            ...prev,
            user: session.user,
            session,
            profile: hydrated.profile,
            industrialInventory: hydrated.industrialInventory,
            corpMembership: hydrated.corpMembership,
            isLoading: false,
            error: hydrated.error,
            isEmailVerified: verified,
            pendingEmail: verified ? null : (session.user.email ?? prev.pendingEmail),
          }));
        }
      } else if (mounted) {
        setState((prev) => ({
          ...prev,
          user: null,
          session: null,
          profile: null,
          industrialInventory: null,
          corpMembership: null,
          isLoading: false,
          error: null,
          isEmailVerified: false,
        }));
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchAccountHydration]);

  const signInWithEmail = async (email: string, password: string, captchaToken?: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null, pkceError: null }));
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) {
      void emitAuthTelemetry('login_failed', { reason: error.message });
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Credenciales inválidas o verificación de correo pendiente.',
      }));
      return { success: false, error: 'Credenciales inválidas o verificación de correo pendiente.' };
    }

    const verified = checkUserEmailConfirmed(data.user);
    if (!verified) {
      setState((prev) => ({
        ...prev,
        user: data.user,
        session: null,
        isLoading: false,
        isEmailVerified: false,
        pendingEmail: data.user?.email ?? email.trim().toLowerCase(),
        error: null,
      }));
      return {
        success: false,
        needsEmailVerification: true,
        error: 'Debes confirmar tu correo electrónico antes de acceder al teatro táctico.',
      };
    }

    const hydrated = data.user
      ? await fetchAccountHydration(data.user.id)
      : { profile: null, industrialInventory: null, corpMembership: null, error: null };

    setState((prev) => ({
      ...prev,
      user: data.user,
      session: data.session,
      profile: hydrated.profile,
      industrialInventory: hydrated.industrialInventory,
      corpMembership: hydrated.corpMembership,
      isLoading: false,
      error: hydrated.error,
      isEmailVerified: true,
      pendingEmail: null,
    }));
    if (hydrated.error) {
      return { success: false, error: hydrated.error };
    }
    return { success: true, user: data.user };
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    username: string,
    captchaToken?: string,
  ) => {
    const cleanEmail = email.trim().toLowerCase();
    const emailDomain = cleanEmail.split('@')[1] || '';

    if (password.length < 12 || password.length > 128) {
      const msg = 'La clave criptográfica debe tener entre 12 y 128 caracteres (ISO 27002).';
      setState((prev) => ({ ...prev, isLoading: false, error: msg }));
      return { success: false, error: msg };
    }

    if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
      const msg = 'Los dominios de correo desechable no están permitidos.';
      void emitAuthTelemetry('signup_attempt', { blocked_reason: 'disposable_email_client' });
      setState((prev) => ({ ...prev, isLoading: false, error: msg }));
      return { success: false, error: msg };
    }

    if (isSupabaseConfigured() && emailDomain) {
      const { data: domainCheck } = await supabase.rpc('check_email_domain_allowed', {
        p_email_domain: emailDomain,
      });
      const checkObj = domainCheck as { allowed?: boolean } | null;
      if (checkObj && checkObj.allowed === false) {
        const msg = 'Este dominio de correo está restringido por políticas de seguridad.';
        void emitAuthTelemetry('signup_attempt', { blocked_reason: 'disposable_email_server' });
        setState((prev) => ({ ...prev, isLoading: false, error: msg }));
        return { success: false, error: msg };
      }
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null, pkceError: null }));
    void emitAuthTelemetry('signup_attempt', { has_captcha: Boolean(captchaToken) });

    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: redirectTo,
        captchaToken,
        data: { username: username.trim() },
      },
    });
    if (error) {
      setState((prev) => ({ ...prev, isLoading: false, error: error.message }));
      return { success: false, error: error.message };
    }

    const needsVerification = !data.session || !checkUserEmailConfirmed(data.user);
    setState((prev) => ({
      ...prev,
      user: data.user,
      session: data.session,
      isLoading: false,
      isEmailVerified: !needsVerification,
      pendingEmail: needsVerification ? cleanEmail : null,
      resendCooldownSec: needsVerification ? 60 : 0,
      error: null,
    }));

    return {
      success: true,
      user: data.user,
      needsEmailVerification: needsVerification,
    };
  };

  const resendVerificationEmail = async (email: string) => {
    if (state.resendCooldownSec > 0) {
      return {
        success: false,
        error: `Espera ${state.resendCooldownSec}s antes de reenviar el enlace.`,
      };
    }
    const cleanEmail = email.trim().toLowerCase();
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    setState((prev) => ({ ...prev, resendCooldownSec: 60 }));
    return { success: true };
  };

  const checkVerificationStatus = async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.user) {
      return { verified: false, error: error?.message || 'Aún no se detecta confirmación de correo.' };
    }
    const verified = checkUserEmailConfirmed(data.session.user);
    if (verified) {
      const hydrated = await fetchAccountHydration(data.session.user.id);
      void emitAuthTelemetry('email_verified', { method: 'manual_refresh' });
      setState((prev) => ({
        ...prev,
        user: data.session!.user,
        session: data.session,
        profile: hydrated.profile,
        industrialInventory: hydrated.industrialInventory,
        corpMembership: hydrated.corpMembership,
        isEmailVerified: true,
        pendingEmail: null,
        error: hydrated.error,
      }));
    }
    return { verified };
  };

  const signOut = async (scope: 'local' | 'global' = 'local') => {
    setState((prev) => ({ ...prev, isLoading: true }));
    void emitAuthTelemetry('session_revoked', { scope });
    await supabase.auth.signOut({ scope });
    setState({
      user: null,
      session: null,
      profile: null,
      industrialInventory: null,
      corpMembership: null,
      isLoading: false,
      error: null,
      isEmailVerified: false,
      pendingEmail: null,
      pkceStatus: 'idle',
      pkceError: null,
      resendCooldownSec: 0,
    });
  };

  return {
    ...state,
    signInWithEmail,
    signUpWithEmail,
    resendVerificationEmail,
    checkVerificationStatus,
    signOut,
    refreshProfile,
  };
}
