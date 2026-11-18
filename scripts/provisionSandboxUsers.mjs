/**
 * ==============================================================================
 * DRONEPUNK — PROVISIONAMIENTO SANDBOX ADMIN + 5 USUARIOS QA + VERIFICACIÓN EN VIVO
 * ==============================================================================
 * Uso (en terminal efímera, NUNCA guardar SUPABASE_SERVICE_ROLE_KEY en .env.local ni git):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<TU_SERVICE_ROLE_KEY>"
 *   node scripts/provisionSandboxUsers.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

function generateStrongPassword() {
  return `Dp!${crypto.randomBytes(12).toString('base64url')}9#`;
}

async function ensureUser(adminClient, spec) {
  const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);

  const existing = listData.users.find(
    (u) => (u.email || '').toLowerCase() === spec.email.toLowerCase(),
  );

  if (existing) {
    const { data: updated, error: updErr } = await adminClient.auth.admin.updateUserById(
      existing.id,
      {
        email_confirm: spec.emailConfirm,
        user_metadata: { username: spec.username },
        app_metadata: spec.appMetadata,
      },
    );
    if (updErr) throw new Error(`updateUserById(${spec.email}) failed: ${updErr.message}`);
    return { user: updated.user, created: false, password: null };
  }

  const password = spec.password || generateStrongPassword();
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: spec.email,
    password,
    email_confirm: spec.emailConfirm,
    user_metadata: { username: spec.username },
    app_metadata: spec.appMetadata,
  });
  if (createErr) throw new Error(`createUser(${spec.email}) failed: ${createErr.message}`);
  return { user: created.user, created: true, password };
}

async function run() {
  const localEnv = loadDotEnvLocal();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error('[ERROR] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.');
    process.exit(1);
  }
  if (!serviceRoleKey) {
    console.error('[BLOCKED] Falta $env:SUPABASE_SERVICE_ROLE_KEY en la sesión actual.');
    console.error('Ejecuta: $env:SUPABASE_SERVICE_ROLE_KEY = "<TU_KEY>" ; node scripts/provisionSandboxUsers.mjs');
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('=== 1. VERIFICANDO ESQUEMA ISO AUTH & TELEMETRÍA EN SUPABASE ===');
  const requiredTables = [
    'profiles',
    'corporations',
    'corporation_members',
    'auth_audit_logs',
    'user_device_fingerprints',
    'account_risk_signals',
    'email_domain_reputation',
  ];
  for (const tbl of requiredTables) {
    const { error } = await admin.from(tbl).select('*', { head: true, count: 'exact' });
    if (error) {
      console.error(`[FAIL] Tabla '${tbl}' no disponible: ${error.message}`);
      console.error('Aplica primero supabase/CONSOLIDATED_FULL_DATABASE_DEPLOY.sql en el SQL Editor.');
      process.exit(1);
    }
  }
  console.log('[PASS] Las 7 tablas críticas existen y responden.');

  console.log('\n=== 2. PROVISIONANDO ADMIN PRINCIPAL (iseadavidfreelance@gmail.com) ===');
  const adminSpec = {
    email: 'iseadavidfreelance@gmail.com',
    username: 'Cmdr_IseaAdmin',
    emailConfirm: true,
    password: process.env.ADMIN_SANDBOX_PASSWORD || undefined,
    appMetadata: { sandbox_role: 'technical_admin' },
  };
  const adminRes = await ensureUser(admin, adminSpec);
  const adminId = adminRes.user.id;

  const { error: adminProfErr } = await admin
    .from('profiles')
    .update({
      is_admin: true,
      metadata: { sandbox_provisioned: true, role_scope: 'technical_admin_full_permissions' },
    })
    .eq('id', adminId);
  if (adminProfErr) {
    throw new Error(`No se pudo asignar is_admin=true: ${adminProfErr.message}`);
  }

  await admin.rpc('log_auth_telemetry', {
    p_event_type: 'admin_sandbox_action',
    p_raw_ip: '127.0.0.1',
    p_client_fp: 'provision-sandbox-script',
    p_metadata: { target_user_id: adminId, action: 'grant_is_admin_and_verify', gameplay_bypasses: false },
  });
  console.log(`[PASS] Admin listo: ${adminSpec.email} (id=${adminId}, created=${adminRes.created}, is_admin=true)`);
  if (adminRes.password) {
    console.log(`       Contraseña temporal generada (cámbiala/rota al entrar): ${adminRes.password}`);
  }

  console.log('\n=== 3. PROVISIONANDO 5 USUARIOS QA MULTI-ROL / MULTI-ESTADO ===');
  const qaSpecs = [
    { email: 'iseadavidfreelance+qa1@gmail.com', username: 'QA_Shareholder', emailConfirm: true, appMetadata: { qa_role: 'rival_shareholder' } },
    { email: 'iseadavidfreelance+qa2@gmail.com', username: 'QA_Officer', emailConfirm: true, appMetadata: { qa_role: 'delegated_officer' } },
    { email: 'iseadavidfreelance+qa3@gmail.com', username: 'QA_Logistics', emailConfirm: true, appMetadata: { qa_role: 'restricted_member' } },
    { email: 'iseadavidfreelance+qa4@gmail.com', username: 'QA_NoCorp', emailConfirm: true, appMetadata: { qa_role: 'verified_no_corp' } },
    { email: 'iseadavidfreelance+qa5@gmail.com', username: 'QA_Unverified', emailConfirm: false, appMetadata: { qa_role: 'unverified_blocked' } },
  ];

  for (const spec of qaSpecs) {
    const res = await ensureUser(admin, spec);
    console.log(
      `[PASS] ${spec.email} -> id=${res.user.id} | emailConfirm=${spec.emailConfirm} | role=${spec.appMetadata.qa_role}${res.password ? ` | pass=${res.password}` : ''}`,
    );
  }

  console.log('\n=== 4. PRUEBAS DE SEGURIDAD & TELEMETRÍA EN VIVO ===');
  const { data: mailinatorCheck, error: domErr } = await anon.rpc('check_email_domain_allowed', {
    p_email_domain: 'mailinator.com',
  });
  if (domErr || mailinatorCheck?.allowed !== false) {
    throw new Error(`check_email_domain_allowed('mailinator.com') falló: ${JSON.stringify(mailinatorCheck || domErr)}`);
  }
  console.log('[PASS] check_email_domain_allowed("mailinator.com") => allowed=false');

  const { error: riskAnonErr } = await anon.rpc('evaluate_multiaccount_risk', {
    p_user_id: adminId,
  });
  if (!riskAnonErr) {
    throw new Error('BRECHA: evaluate_multiaccount_risk debería estar bloqueado para anon');
  }
  console.log(`[PASS] evaluate_multiaccount_risk bloqueado para anon (${riskAnonErr.code || riskAnonErr.message})`);

  const { data: auditRows, error: auditErr } = await admin
    .from('auth_audit_logs')
    .select('id, event_type, key_version, created_at')
    .order('created_at', { ascending: false })
    .limit(3);
  if (auditErr || !auditRows?.length) {
    throw new Error(`auth_audit_logs sin registros o error: ${auditErr?.message}`);
  }
  console.log(`[PASS] auth_audit_logs activo (${auditRows.length} registros recientes, último=${auditRows[0].event_type})`);

  console.log('\n✅ PROVISIONAMIENTO Y VERIFICACIÓN EN VIVO COMPLETADOS (100% PASS).');
}

run().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
