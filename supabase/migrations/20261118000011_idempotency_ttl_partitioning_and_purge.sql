-- ==============================================================================
-- MIGRACIÓN: 20261118000011_idempotency_ttl_partitioning_and_purge.sql
-- OBJETIVO:
--   1. Añadir columna TTL `expires_at` e índices eficientes (B-tree / BRIN) en:
--      - public.economy_rpc_idempotency
--      - public.unit_action_logs
--      - public.auth_audit_logs
--   2. Crear RPC de purga por lotes `public.purge_expired_idempotency_and_logs`
--      con soporte para el trigger de inmutabilidad en `auth_audit_logs`.
--   3. Programar la purga periódica en `pg_cron` (protegida con `IF EXISTS`).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. COLUMNAS TTL `expires_at` E ÍNDICES EFICIENTES
-- ------------------------------------------------------------------------------

-- 1a. economy_rpc_idempotency: tabla de alto churn (TTL 24h).
--     B-tree sobre expires_at permite borrado por lotes ordenado sin full-scan.
ALTER TABLE public.economy_rpc_idempotency
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours');

CREATE INDEX IF NOT EXISTS idx_economy_rpc_idempotency_expires_at
  ON public.economy_rpc_idempotency (expires_at);

-- 1b. unit_action_logs: tabla append-only de telemetría de unidades.
--     BRIN sobre expires_at mantiene overhead mínimo de escritura y almacenamiento.
ALTER TABLE public.unit_action_logs
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours');

CREATE INDEX IF NOT EXISTS idx_unit_action_logs_expires_at_brin
  ON public.unit_action_logs USING brin (expires_at)
  WITH (pages_per_range = 32);

-- 1c. auth_audit_logs: tabla append-only de auditoría de autenticación.
--     BRIN sobre expires_at para poda eficiente por rangos de páginas.
ALTER TABLE public.auth_audit_logs
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours');

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_expires_at_brin
  ON public.auth_audit_logs USING brin (expires_at)
  WITH (pages_per_range = 32);

-- ------------------------------------------------------------------------------
-- 2. FUNCIÓN DE PURGA POR LOTES CON RESPETO A INMUTABILIDAD ISO 27001
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_idempotency_and_logs(
  p_batch_size INT DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_size          INT := GREATEST(1, LEAST(COALESCE(p_batch_size, 5000), 50000));
  v_now                 TIMESTAMPTZ := timezone('utc'::text, now());
  v_deleted_idempotency INT := 0;
  v_deleted_unit_logs   INT := 0;
  v_deleted_auth_logs   INT := 0;
BEGIN
  -- 2a. Purga por lotes en economy_rpc_idempotency (usa B-tree ordenado)
  WITH expired_idem AS (
    SELECT idempotency_key
    FROM public.economy_rpc_idempotency
    WHERE expires_at < v_now
    ORDER BY expires_at ASC
    LIMIT v_batch_size
  )
  DELETE FROM public.economy_rpc_idempotency t
  USING expired_idem e
  WHERE t.idempotency_key = e.idempotency_key;
  GET DIAGNOSTICS v_deleted_idempotency = ROW_COUNT;

  -- 2b. Purga por lotes en unit_action_logs (usa BRIN sin sort)
  WITH expired_ual AS (
    SELECT id
    FROM public.unit_action_logs
    WHERE expires_at < v_now
    LIMIT v_batch_size
  )
  DELETE FROM public.unit_action_logs t
  USING expired_ual e
  WHERE t.id = e.id;
  GET DIAGNOSTICS v_deleted_unit_logs = ROW_COUNT;

  -- 2c. Purga por lotes en auth_audit_logs (habilita guarda transaccional del trigger)
  PERFORM set_config('app.allow_telemetry_purge', 'on', true);

  WITH expired_audit AS (
    SELECT id
    FROM public.auth_audit_logs
    WHERE expires_at < v_now
    LIMIT v_batch_size
  )
  DELETE FROM public.auth_audit_logs t
  USING expired_audit e
  WHERE t.id = e.id;
  GET DIAGNOSTICS v_deleted_auth_logs = ROW_COUNT;

  PERFORM set_config('app.allow_telemetry_purge', 'off', true);

  RETURN jsonb_build_object(
    'batch_size', v_batch_size,
    'purged_idempotency', v_deleted_idempotency,
    'purged_unit_action_logs', v_deleted_unit_logs,
    'purged_auth_audit_logs', v_deleted_auth_logs,
    'executed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_idempotency_and_logs(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_idempotency_and_logs(INT) TO service_role;

-- ------------------------------------------------------------------------------
-- 3. PROGRAMACIÓN IDEMPOTENTE EN pg_cron (PROTEGIDA CON IF EXISTS)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_existing_job_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'cron' AND p.proname = 'schedule'
     )
  THEN
    SELECT jobid INTO v_existing_job_id
    FROM cron.job
    WHERE jobname = 'purge_expired_idempotency_and_logs_job'
    LIMIT 1;

    IF v_existing_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_existing_job_id);
    END IF;

    PERFORM cron.schedule(
      'purge_expired_idempotency_and_logs_job',
      '*/15 * * * *',
      $cron$SELECT public.purge_expired_idempotency_and_logs(5000);$cron$
    );
  END IF;
END;
$$;
