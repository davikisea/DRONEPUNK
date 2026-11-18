-- ==============================================================================
-- MIGRATION: 20261118000001_iso_auth_antifraud_telemetry.sql
-- OBJETIVO: Identidades ISO/IEC 27001, 27002, 27701 (Privacy by Design),
--           Telemetría Anti-Multicuentas Determinista y Hardening de Profiles/Corps.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA PRIVADO & LLAVES HMAC ROTATIVAS (INACCESIBLE VÍA POSTGREST)
-- ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.telemetry_hmac_keys (
  key_version SMALLINT PRIMARY KEY,
  secret_key  TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at  TIMESTAMPTZ NOT NULL
);

REVOKE ALL ON TABLE private.telemetry_hmac_keys FROM PUBLIC, anon, authenticated;

-- Seed inicial criptográfico por despliegue (sin secretos en el repositorio)
INSERT INTO private.telemetry_hmac_keys (key_version, secret_key, is_active, expires_at)
VALUES (
  1,
  encode(extensions.gen_random_bytes(32), 'hex'),
  true,
  timezone('utc'::text, now()) + interval '90 days'
)
ON CONFLICT (key_version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. TABLA INMUTABLE DE AUDITORÍA DE AUTENTICACIÓN (ISO 27001 / 27701)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type        VARCHAR(32) NOT NULL CHECK (event_type IN (
    'signup_attempt', 'email_verified', 'login_success',
    'login_failed', 'session_revoked', 'admin_sandbox_action'
  )),
  ip_hash           BYTEA NOT NULL,
  ip_subnet_hash    BYTEA NOT NULL,
  key_version       SMALLINT NOT NULL,
  fingerprint_hash  BYTEA,
  canvas_webgl_hash BYTEA,
  country_code      CHAR(2),
  asn               INTEGER,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user_time
  ON public.auth_audit_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_audit_ip_time
  ON public.auth_audit_logs(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event_time
  ON public.auth_audit_logs(event_type, created_at DESC);

ALTER TABLE public.auth_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.auth_audit_logs TO authenticated;

DROP POLICY IF EXISTS "auth_audit_select_own" ON public.auth_audit_logs;
CREATE POLICY "auth_audit_select_own"
  ON public.auth_audit_logs
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.trg_reject_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('app.allow_telemetry_purge', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_AUDIT_LOG: UPDATE/DELETE prohibido en public.auth_audit_logs (ISO 27001).';
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_audit_immutable ON public.auth_audit_logs;
CREATE TRIGGER trg_auth_audit_immutable
  BEFORE UPDATE OR DELETE ON public.auth_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reject_audit_mutation();

-- ------------------------------------------------------------------------------
-- 3. HUELLAS DE DISPOSITIVO HASHED (ANTI-MULTICUENTAS SIN PII EN CLARO)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_device_fingerprints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fingerprint_hash  BYTEA NOT NULL,
  canvas_webgl_hash BYTEA,
  tz_screen_hash    BYTEA,
  key_version       SMALLINT NOT NULL,
  trust_level       VARCHAR(16) NOT NULL DEFAULT 'unverified'
    CHECK (trust_level IN ('unverified', 'trusted', 'suspect', 'blocked')),
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_user_device_fp UNIQUE (user_id, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS idx_device_fp_user_distinct
  ON public.user_device_fingerprints(fingerprint_hash, user_id);
CREATE INDEX IF NOT EXISTS idx_device_canvas_user
  ON public.user_device_fingerprints(canvas_webgl_hash, user_id)
  WHERE canvas_webgl_hash IS NOT NULL;

ALTER TABLE public.user_device_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_device_fingerprints FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. SEÑALES DE RIESGO AGREGADAS & REPUTACIÓN DE DOMINIOS DE CORREO
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_risk_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signal_type     VARCHAR(32) NOT NULL CHECK (signal_type IN (
    'shared_device_cluster', 'disposable_email', 'rapid_corp_transfer', 'sybil_suspect'
  )),
  risk_score      SMALLINT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  review_status   VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'cleared', 'flagged', 'restricted')),
  evidence_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  cooldown_until  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_risk_signal_user_type UNIQUE (user_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_risk_signals_user_status
  ON public.account_risk_signals(user_id, review_status);
CREATE INDEX IF NOT EXISTS idx_risk_signals_pending
  ON public.account_risk_signals(review_status, risk_score DESC)
  WHERE review_status IN ('pending', 'flagged');

ALTER TABLE public.account_risk_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_risk_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_risk_signals TO authenticated;

DROP POLICY IF EXISTS "risk_signals_select_own" ON public.account_risk_signals;
CREATE POLICY "risk_signals_select_own"
  ON public.account_risk_signals
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE TABLE IF NOT EXISTS public.email_domain_reputation (
  domain      VARCHAR(253) PRIMARY KEY,
  list_type   VARCHAR(16) NOT NULL CHECK (list_type IN ('disposable', 'allow', 'block')),
  source      VARCHAR(64) NOT NULL DEFAULT 'manual',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.email_domain_reputation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_domain_reputation FROM PUBLIC, anon, authenticated;

INSERT INTO public.email_domain_reputation (domain, list_type, source) VALUES
  ('mailinator.com', 'disposable', 'iso_baseline'),
  ('guerrillamail.com', 'disposable', 'iso_baseline'),
  ('10minutemail.com', 'disposable', 'iso_baseline'),
  ('tempmail.com', 'disposable', 'iso_baseline'),
  ('yopmail.com', 'disposable', 'iso_baseline'),
  ('throwawaymail.com', 'disposable', 'iso_baseline'),
  ('trashmail.com', 'disposable', 'iso_baseline')
ON CONFLICT (domain) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. MOTOR DE EVALUACIÓN DE RIESGO ANTI-MULTICUENTAS (DETERMINISTA)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_multiaccount_risk(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions, pg_temp
AS $$
DECLARE
  v_device_cluster_count INT := 0;
  v_device_score SMALLINT := 0;
  v_email_domain TEXT;
  v_domain_type TEXT;
  v_disposable_score SMALLINT := 0;
  v_total_score INT := 0;
  v_status VARCHAR(16) := 'cleared';
  v_cooldown TIMESTAMPTZ := NULL;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('total_score', 0, 'status', 'cleared', 'cooldown_until', NULL);
  END IF;

  -- Regla 1: Cluster de dispositivo compartido (requiere fingerprint + canvas/tz_screen para evitar falsos positivos CGNAT)
  SELECT COALESCE(MAX(cluster_cnt), 0)
  INTO v_device_cluster_count
  FROM (
    SELECT COUNT(DISTINCT udf2.user_id) AS cluster_cnt
    FROM public.user_device_fingerprints udf1
    JOIN public.user_device_fingerprints udf2
      ON udf1.fingerprint_hash = udf2.fingerprint_hash
     AND (
       (udf1.canvas_webgl_hash IS NOT NULL AND udf1.canvas_webgl_hash = udf2.canvas_webgl_hash)
       OR (udf1.tz_screen_hash IS NOT NULL AND udf1.tz_screen_hash = udf2.tz_screen_hash)
     )
    WHERE udf1.user_id = p_user_id
      AND udf2.last_seen_at >= timezone('utc'::text, now()) - interval '30 days'
    GROUP BY udf1.fingerprint_hash
  ) sub;

  IF v_device_cluster_count >= 5 THEN
    v_device_score := 75;
  ELSIF v_device_cluster_count >= 3 THEN
    v_device_score := 45;
  ELSIF v_device_cluster_count = 2 THEN
    v_device_score := 20;
  END IF;

  IF v_device_score > 0 THEN
    INSERT INTO public.account_risk_signals (
      user_id, signal_type, risk_score, review_status, evidence_json, updated_at
    ) VALUES (
      p_user_id,
      'shared_device_cluster',
      v_device_score,
      CASE
        WHEN v_device_score >= 70 THEN 'restricted'
        WHEN v_device_score >= 30 THEN 'flagged'
        ELSE 'pending'
      END,
      jsonb_build_object('distinct_accounts_30d', v_device_cluster_count),
      timezone('utc'::text, now())
    )
    ON CONFLICT (user_id, signal_type) DO UPDATE
      SET risk_score = EXCLUDED.risk_score,
          review_status = CASE
            WHEN public.account_risk_signals.review_status = 'cleared' AND EXCLUDED.risk_score < 70 THEN 'cleared'
            ELSE EXCLUDED.review_status
          END,
          evidence_json = EXCLUDED.evidence_json,
          updated_at = timezone('utc'::text, now());
  END IF;

  -- Regla 2: Reputación de dominio de correo
  SELECT lower(split_part(email, '@', 2))
  INTO v_email_domain
  FROM auth.users
  WHERE id = p_user_id;

  IF v_email_domain IS NOT NULL AND v_email_domain <> '' THEN
    SELECT list_type INTO v_domain_type
    FROM public.email_domain_reputation
    WHERE domain = v_email_domain;

    IF v_domain_type IN ('disposable', 'block') THEN
      v_disposable_score := 80;
      INSERT INTO public.account_risk_signals (
        user_id, signal_type, risk_score, review_status, evidence_json, updated_at
      ) VALUES (
        p_user_id,
        'disposable_email',
        80,
        'restricted',
        jsonb_build_object('list_type', v_domain_type),
        timezone('utc'::text, now())
      )
      ON CONFLICT (user_id, signal_type) DO UPDATE
        SET risk_score = 80,
            review_status = 'restricted',
            updated_at = timezone('utc'::text, now());
    END IF;
  END IF;

  -- Score compuesto activo (excluye señales marcadas como cleared)
  SELECT COALESCE(SUM(risk_score), 0), MAX(cooldown_until)
  INTO v_total_score, v_cooldown
  FROM public.account_risk_signals
  WHERE user_id = p_user_id
    AND review_status <> 'cleared';

  v_total_score := LEAST(v_total_score, 100);

  IF v_total_score >= 70 THEN
    v_status := 'restricted';
    INSERT INTO public.account_risk_signals (
      user_id, signal_type, risk_score, review_status, evidence_json, updated_at
    ) VALUES (
      p_user_id,
      'sybil_suspect',
      v_total_score,
      'restricted',
      jsonb_build_object('composite_score', v_total_score),
      timezone('utc'::text, now())
    )
    ON CONFLICT (user_id, signal_type) DO UPDATE
      SET risk_score = EXCLUDED.risk_score,
          review_status = 'restricted',
          evidence_json = EXCLUDED.evidence_json,
          updated_at = timezone('utc'::text, now());
  ELSIF v_total_score >= 30 THEN
    v_status := 'flagged';
  END IF;

  RETURN jsonb_build_object(
    'total_score', v_total_score,
    'status', v_status,
    'cooldown_until', v_cooldown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_multiaccount_risk(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_multiaccount_risk(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.check_email_domain_allowed(p_email_domain TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_domain TEXT := lower(trim(COALESCE(p_email_domain, '')));
  v_list_type VARCHAR(16);
BEGIN
  IF v_domain = '' OR position('.' IN v_domain) = 0 THEN
    RETURN jsonb_build_object('allowed', false, 'list_type', 'invalid');
  END IF;

  SELECT list_type INTO v_list_type
  FROM public.email_domain_reputation
  WHERE domain = v_domain;

  IF v_list_type IN ('disposable', 'block') THEN
    RETURN jsonb_build_object('allowed', false, 'list_type', v_list_type);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'list_type', COALESCE(v_list_type, 'neutral'));
END;
$$;

REVOKE ALL ON FUNCTION public.check_email_domain_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_domain_allowed(TEXT) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. RPC INGESTA DE TELEMETRÍA AUTH (HMAC-SHA256 EN SERVIDOR)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_auth_telemetry(
  p_event_type   VARCHAR(32),
  p_raw_ip       TEXT DEFAULT '0.0.0.0',
  p_client_fp    TEXT DEFAULT NULL,
  p_canvas_webgl TEXT DEFAULT NULL,
  p_tz_screen    TEXT DEFAULT NULL,
  p_country_code CHAR(2) DEFAULT NULL,
  p_asn          INTEGER DEFAULT NULL,
  p_metadata     JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions, pg_temp
AS $$
DECLARE
  v_caller_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), 'service_role');
  v_user_id UUID := (SELECT auth.uid());
  v_key_version SMALLINT;
  v_secret TEXT;
  v_safe_ip TEXT := COALESCE(NULLIF(trim(p_raw_ip), ''), '0.0.0.0');
  v_subnet TEXT;
  v_ip_hash BYTEA;
  v_subnet_hash BYTEA;
  v_fp_hash BYTEA;
  v_canvas_hash BYTEA;
  v_tz_hash BYTEA;
  v_risk JSONB := jsonb_build_object('total_score', 0, 'status', 'cleared', 'cooldown_until', NULL);
BEGIN
  IF p_event_type NOT IN (
    'signup_attempt', 'email_verified', 'login_success',
    'login_failed', 'session_revoked', 'admin_sandbox_action'
  ) THEN
    RAISE EXCEPTION 'INVALID_EVENT_TYPE';
  END IF;

  IF v_user_id IS NULL AND v_caller_role IN ('service_role', 'postgres') AND (p_metadata ? 'target_user_id') THEN
    v_user_id := (p_metadata->>'target_user_id')::UUID;
  END IF;

  -- Solo service_role puede registrar admin_sandbox_action sin sesión o para otro usuario
  IF p_event_type = 'admin_sandbox_action' AND v_caller_role NOT IN ('service_role', 'postgres') THEN
    IF v_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = v_user_id AND is_admin = true
    ) THEN
      RAISE EXCEPTION 'ADMIN_REQUIRED';
    END IF;
  END IF;

  SELECT key_version, secret_key
  INTO v_key_version, v_secret
  FROM private.telemetry_hmac_keys
  WHERE is_active = true
  ORDER BY key_version DESC
  LIMIT 1;

  IF v_key_version IS NULL THEN
    RAISE EXCEPTION 'HMAC_KEY_NOT_CONFIGURED';
  END IF;

  -- Subred gruesa (/24 para IPv4, prefijo para IPv6)
  IF position(':' IN v_safe_ip) > 0 THEN
    v_subnet := split_part(v_safe_ip, ':', 1) || ':' || split_part(v_safe_ip, ':', 2) || ':' || split_part(v_safe_ip, ':', 3) || '::/48';
  ELSE
    v_subnet := regexp_replace(v_safe_ip, '\.\d+$', '.0/24');
  END IF;

  v_ip_hash := extensions.hmac(convert_to(v_safe_ip, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256');
  v_subnet_hash := extensions.hmac(convert_to(v_subnet, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256');

  IF p_client_fp IS NOT NULL AND length(trim(p_client_fp)) > 0 THEN
    v_fp_hash := extensions.hmac(convert_to(trim(p_client_fp), 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256');
  END IF;

  IF p_canvas_webgl IS NOT NULL AND length(trim(p_canvas_webgl)) > 0 THEN
    v_canvas_hash := extensions.hmac(convert_to(trim(p_canvas_webgl), 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256');
  END IF;

  IF p_tz_screen IS NOT NULL AND length(trim(p_tz_screen)) > 0 THEN
    v_tz_hash := extensions.hmac(convert_to(trim(p_tz_screen), 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256');
  END IF;

  INSERT INTO public.auth_audit_logs (
    user_id, event_type, ip_hash, ip_subnet_hash, key_version,
    fingerprint_hash, canvas_webgl_hash, country_code, asn, metadata
  ) VALUES (
    v_user_id,
    p_event_type,
    v_ip_hash,
    v_subnet_hash,
    v_key_version,
    v_fp_hash,
    v_canvas_hash,
    p_country_code,
    p_asn,
    COALESCE(p_metadata, '{}'::jsonb) - 'raw_ip' - 'email'
  );

  IF v_user_id IS NOT NULL AND v_fp_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_user_id
  ) THEN
    INSERT INTO public.user_device_fingerprints (
      user_id, fingerprint_hash, canvas_webgl_hash, tz_screen_hash, key_version
    ) VALUES (
      v_user_id, v_fp_hash, v_canvas_hash, v_tz_hash, v_key_version
    )
    ON CONFLICT (user_id, fingerprint_hash) DO UPDATE
      SET last_seen_at = timezone('utc'::text, now()),
          canvas_webgl_hash = COALESCE(EXCLUDED.canvas_webgl_hash, public.user_device_fingerprints.canvas_webgl_hash),
          tz_screen_hash = COALESCE(EXCLUDED.tz_screen_hash, public.user_device_fingerprints.tz_screen_hash),
          key_version = EXCLUDED.key_version;

    v_risk := public.evaluate_multiaccount_risk(v_user_id);
  END IF;

  RETURN jsonb_build_object(
    'logged', true,
    'event_type', p_event_type,
    'key_version', v_key_version,
    'risk', v_risk
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_auth_telemetry(VARCHAR, TEXT, TEXT, TEXT, TEXT, CHAR, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_auth_telemetry(VARCHAR, TEXT, TEXT, TEXT, TEXT, CHAR, INTEGER, JSONB) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. PURGA Y RETENCIÓN GDPR / ISO 27701
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_auth_telemetry()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_logs INT := 0;
  v_deleted_fps INT := 0;
BEGIN
  PERFORM set_config('app.allow_telemetry_purge', 'on', true);

  DELETE FROM public.auth_audit_logs
  WHERE (event_type <> 'admin_sandbox_action' AND created_at < timezone('utc'::text, now()) - interval '90 days')
     OR (event_type = 'admin_sandbox_action' AND created_at < timezone('utc'::text, now()) - interval '365 days');
  GET DIAGNOSTICS v_deleted_logs = ROW_COUNT;

  DELETE FROM public.user_device_fingerprints
  WHERE last_seen_at < timezone('utc'::text, now()) - interval '180 days';
  GET DIAGNOSTICS v_deleted_fps = ROW_COUNT;

  RETURN jsonb_build_object(
    'purged_audit_logs', v_deleted_logs,
    'purged_device_fingerprints', v_deleted_fps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_auth_telemetry() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_auth_telemetry() TO service_role;

-- ------------------------------------------------------------------------------
-- 8. HARDENING DE PROFILES, HANDLE_NEW_USER Y RPCS DE CORPORACIÓN
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    username,
    avatar_url,
    account_level,
    current_xp,
    battle_credits,
    command_gems,
    elo_rating
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'Commander_' || SUBSTRING(NEW.id::text FROM 1 FOR 6)),
    'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=150',
    1,
    0,
    500,
    50,
    1200
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_guard_profile_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IN ('authenticated', 'anon')
     AND current_setting('app.bypass_profile_guard', true) IS DISTINCT FROM 'on' THEN
    IF NEW.account_level IS DISTINCT FROM OLD.account_level
       OR NEW.current_xp IS DISTINCT FROM OLD.current_xp
       OR NEW.battle_credits IS DISTINCT FROM OLD.battle_credits
       OR NEW.command_gems IS DISTINCT FROM OLD.command_gems
       OR NEW.elo_rating IS DISTINCT FROM OLD.elo_rating
       OR NEW.trophies_count IS DISTINCT FROM OLD.trophies_count
       OR NEW.total_matches_played IS DISTINCT FROM OLD.total_matches_played
       OR NEW.total_victories IS DISTINCT FROM OLD.total_victories
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.corp_id IS DISTINCT FROM OLD.corp_id
       OR NEW.clan_id IS DISTINCT FROM OLD.clan_id
       OR NEW.is_chat_banned IS DISTINCT FROM OLD.is_chat_banned
       OR NEW.muted_until IS DISTINCT FROM OLD.muted_until
       OR NEW.wallet_balance IS DISTINCT FROM OLD.wallet_balance THEN
      RAISE EXCEPTION 'Operación denegada: Los balances, privilegios administrativos y membresías corporativas solo pueden modificarse mediante transacciones autorizadas del servidor.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_corporation(
  p_name TEXT,
  p_tag TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_email_confirmed TIMESTAMPTZ;
  v_profile public.profiles%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
  v_clean_name TEXT := trim(p_name);
  v_clean_tag TEXT := upper(trim(p_tag));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Debes iniciar sesión.';
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed
  FROM auth.users WHERE id = v_user_id;

  IF v_email_confirmed IS NULL THEN
    RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED: Debes verificar tu correo electrónico antes de fundar una Corporación.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_risk_signals
    WHERE user_id = v_user_id AND review_status = 'restricted'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_RESTRICTED_RISK: Cuenta restringida por señales de seguridad.';
  END IF;

  IF length(v_clean_name) < 3 OR length(v_clean_name) > 50 THEN
    RAISE EXCEPTION 'INVALID_NAME: El nombre debe tener entre 3 y 50 caracteres.';
  END IF;

  IF length(v_clean_tag) < 2 OR length(v_clean_tag) > 5 THEN
    RAISE EXCEPTION 'INVALID_TAG: El tag debe tener entre 2 y 5 caracteres.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: Perfil de usuario inexistente.';
  END IF;

  IF v_profile.corp_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_IN_CORP: Ya perteneces a una Corporación.';
  END IF;

  INSERT INTO public.corporations (name, tag, leader_user_id, treasury_ec, treasury_alloys, treasury_fuel, treasury_chips)
  VALUES (v_clean_name, v_clean_tag, v_user_id, 500, 50, 25, 10)
  RETURNING * INTO v_corp;

  INSERT INTO public.corporation_members (corp_id, user_id, role, shares, delegated_permissions)
  VALUES (
    v_corp.id,
    v_user_id,
    'majority_shareholder',
    100,
    '{"can_use_treasury":true,"can_construct":true,"can_remodel":true,"can_collect":true,"can_purchase_units":true,"can_control_units":true}'::jsonb
  );

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE public.profiles SET corp_id = v_corp.id WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'corp_id', v_corp.id,
    'name', v_corp.name,
    'tag', v_corp.tag,
    'role', 'majority_shareholder',
    'shares', 100
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.join_corporation(p_corp_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_email_confirmed TIMESTAMPTZ;
  v_profile public.profiles%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed
  FROM auth.users WHERE id = v_user_id;

  IF v_email_confirmed IS NULL THEN
    RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED: Debes verificar tu correo electrónico antes de unirte a una Corporación.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_risk_signals
    WHERE user_id = v_user_id AND review_status = 'restricted'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_RESTRICTED_RISK: Cuenta restringida por señales de seguridad.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_profile.corp_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_IN_CORP: Ya perteneces a una Corporación.';
  END IF;

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CORP_NOT_FOUND';
  END IF;

  INSERT INTO public.corporation_members (corp_id, user_id, role, shares)
  VALUES (p_corp_id, v_user_id, 'member', 0);

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE public.profiles SET corp_id = p_corp_id WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'corp_id', v_corp.id,
    'name', v_corp.name,
    'tag', v_corp.tag,
    'role', 'member'
  );
END;
$$;
