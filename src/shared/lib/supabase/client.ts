import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../types/database.types';

let browserClient: SupabaseClient<Database> | null = null;

/**
 * Retorna true si Supabase está configurado con credenciales de entorno válidas (no placeholders)
 */
export function isSupabaseConfigured(): boolean {
  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, string | undefined>);
  const url = env.VITE_SUPABASE_URL || '';
  return !!url && !url.includes('placeholder') && !url.includes('your-project-id');
}

/**
 * Crea o retorna una instancia singleton del cliente Supabase para el navegador
 */
export function createBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as Record<string, string | undefined>);
  const isProd = env.PROD === true || env.MODE === 'production';
  const rawUrl = env.VITE_SUPABASE_URL || '';
  const rawAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

  if (isProd && (!rawUrl || !rawAnonKey || rawUrl.includes('placeholder') || rawAnonKey.includes('placeholder'))) {
    throw new Error('[Supabase] VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY son obligatorias en producción.');
  }

  const supabaseUrl = rawUrl || 'https://placeholder.supabase.co';
  const supabaseAnonKey = rawAnonKey || 'placeholder-anon-key';

  browserClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });

  return browserClient;
}

export const supabase = createBrowserClient();
