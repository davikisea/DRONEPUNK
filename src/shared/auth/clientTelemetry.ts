import { supabase, isSupabaseConfigured } from '../lib/supabase/client';

export type AuthTelemetryEvent =
  | 'signup_attempt'
  | 'email_verified'
  | 'login_success'
  | 'login_failed'
  | 'session_revoked'
  | 'admin_sandbox_action';

export interface ClientTelemetryDigest {
  clientFp: string;
  canvasWebgl: string | null;
  tzScreen: string;
  locale: string;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(input);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function getWebGLRendererSignature(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '');
      const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      return `${vendor}|${renderer}`;
    }
    return `${gl.getParameter(gl.VENDOR) || ''}|${gl.getParameter(gl.RENDERER) || ''}`;
  } catch {
    return null;
  }
}

let cachedDigest: ClientTelemetryDigest | null = null;

/**
 * Captura señales técnicas no invasivas y las convierte en digests SHA-256 locales
 * sin almacenar PII en claro (conforme a ISO/IEC 27701).
 */
export async function collectClientTelemetryDigest(): Promise<ClientTelemetryDigest> {
  if (cachedDigest) return cachedDigest;

  const tz =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC';
  const screenRes =
    typeof window !== 'undefined' && window.screen
      ? `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`
      : '0x0x0';
  const locale = typeof navigator !== 'undefined' ? navigator.language || 'es' : 'es';
  const platform = typeof navigator !== 'undefined' ? navigator.platform || 'unknown' : 'unknown';
  const cores = typeof navigator !== 'undefined' ? String(navigator.hardwareConcurrency || 0) : '0';

  const webglSig = getWebGLRendererSignature();
  const tzScreen = `${tz}|${screenRes}`;
  const canvasWebgl = webglSig ? await sha256Hex(webglSig) : null;
  const clientFp = await sha256Hex(`${platform}|${cores}|${tzScreen}|${canvasWebgl || 'no-gl'}`);

  cachedDigest = {
    clientFp,
    canvasWebgl,
    tzScreen,
    locale,
  };
  return cachedDigest;
}

/**
 * Envía telemetría de autenticación al RPC `log_auth_telemetry`.
 * Nunca bloquea el flujo del usuario si la red o Supabase no están disponibles.
 */
export async function emitAuthTelemetry(
  eventType: AuthTelemetryEvent,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const digest = await collectClientTelemetryDigest();
    await supabase.rpc('log_auth_telemetry', {
      p_event_type: eventType,
      p_client_fp: digest.clientFp,
      p_canvas_webgl: digest.canvasWebgl,
      p_tz_screen: digest.tzScreen,
      p_metadata: {
        ...metadata,
        locale: digest.locale,
      },
    });
  } catch {
    // Telemetría fail-safe: no interrumpir autenticación por fallo transitorio de log
  }
}
