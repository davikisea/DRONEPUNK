-- ==============================================================================
-- MIGRATION: 20261118000007_corporation_treasury_sharding_and_counters.sql
-- OBJETIVO: Sharding de tesorería corporativa (16 shards/corporación),
--           contadores desacoplados de miembros y refactor de las 7 RPCs
--           asignadas respetando el Orden Canónico Global de Locks (Contrato v3).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLA DE SHARDS DE TESORERÍA (16 SHARDS POR CORPORACIÓN)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corporation_treasury_shards (
  corp_id UUID NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  shard_id SMALLINT NOT NULL CHECK (shard_id >= 0 AND shard_id < 16),
  treasury_ec BIGINT NOT NULL DEFAULT 0,
  treasury_alloys BIGINT NOT NULL DEFAULT 0,
  treasury_fuel BIGINT NOT NULL DEFAULT 0,
  treasury_chips BIGINT NOT NULL DEFAULT 0,
  treasury_rare_earth BIGINT NOT NULL DEFAULT 0,
  treasury_composites BIGINT NOT NULL DEFAULT 0,
  treasury_tech_scrap BIGINT NOT NULL DEFAULT 0,
  treasury_citizens INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (corp_id, shard_id)
);

ALTER TABLE public.corporation_treasury_shards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.corporation_treasury_shards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.corporation_treasury_shards TO authenticated;

DROP POLICY IF EXISTS "corporation_treasury_shards_read" ON public.corporation_treasury_shards;
CREATE POLICY "corporation_treasury_shards_read"
  ON public.corporation_treasury_shards
  FOR SELECT
  TO authenticated
  USING (true);

-- Backfill idempotente: crea 16 shards para toda corporación existente sin shards aún
INSERT INTO public.corporation_treasury_shards (
  corp_id,
  shard_id,
  treasury_ec,
  treasury_alloys,
  treasury_fuel,
  treasury_chips,
  treasury_rare_earth,
  treasury_composites,
  treasury_tech_scrap,
  treasury_citizens
)
SELECT
  c.id,
  s.shard_id::SMALLINT,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_ec, 0) ELSE 0 END,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_alloys, 0) ELSE 0 END,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_fuel, 0) ELSE 0 END,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_chips, 0) ELSE 0 END,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_rare_earth, 0) ELSE 0 END,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_composites, 0) ELSE 0 END,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_tech_scrap, 0) ELSE 0 END,
  CASE WHEN s.shard_id = 0 THEN COALESCE(c.treasury_citizens, 0) ELSE 0 END
FROM public.corporations c
CROSS JOIN generate_series(0, 15) AS s(shard_id)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.corporation_treasury_shards existing
  WHERE existing.corp_id = c.id
)
ON CONFLICT (corp_id, shard_id) DO NOTHING;

-- Vista retrocompatible en tiempo real sobre los 16 shards (sin lockear corporations)
CREATE OR REPLACE VIEW public.corporation_treasury_totals AS
SELECT
  s.corp_id,
  COALESCE(SUM(s.treasury_ec), 0)::BIGINT AS treasury_ec,
  COALESCE(SUM(s.treasury_alloys), 0)::BIGINT AS treasury_alloys,
  COALESCE(SUM(s.treasury_fuel), 0)::BIGINT AS treasury_fuel,
  COALESCE(SUM(s.treasury_chips), 0)::BIGINT AS treasury_chips,
  COALESCE(SUM(s.treasury_rare_earth), 0)::BIGINT AS treasury_rare_earth,
  COALESCE(SUM(s.treasury_composites), 0)::BIGINT AS treasury_composites,
  COALESCE(SUM(s.treasury_tech_scrap), 0)::BIGINT AS treasury_tech_scrap,
  COALESCE(SUM(s.treasury_citizens), 0)::INT AS treasury_citizens,
  MAX(s.updated_at) AS updated_at
FROM public.corporation_treasury_shards s
GROUP BY s.corp_id;

GRANT SELECT ON public.corporation_treasury_totals TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. TABLA DE CONTADORES DE MIEMBROS POR CORPORACIÓN
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corporation_member_counts (
  corp_id UUID PRIMARY KEY REFERENCES public.corporations(id) ON DELETE CASCADE,
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.corporation_member_counts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.corporation_member_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.corporation_member_counts TO anon, authenticated;

DROP POLICY IF EXISTS "corporation_member_counts_public_read" ON public.corporation_member_counts;
CREATE POLICY "corporation_member_counts_public_read"
  ON public.corporation_member_counts
  FOR SELECT
  USING (true);

-- Backfill idempotente de contadores de miembros
INSERT INTO public.corporation_member_counts (corp_id, member_count, updated_at)
SELECT
  c.id,
  COALESCE(COUNT(m.user_id), 0)::INTEGER,
  timezone('utc'::text, now())
FROM public.corporations c
LEFT JOIN public.corporation_members m ON m.corp_id = c.id
GROUP BY c.id
ON CONFLICT (corp_id) DO UPDATE
  SET member_count = EXCLUDED.member_count,
      updated_at = EXCLUDED.updated_at;

-- Trigger para mantener corporation_member_counts sin escanear corporation_members
CREATE OR REPLACE FUNCTION public.trg_sync_corporation_member_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.corporation_member_counts (corp_id, member_count, updated_at)
    VALUES (NEW.corp_id, 1, timezone('utc'::text, now()))
    ON CONFLICT (corp_id) DO UPDATE
      SET member_count = public.corporation_member_counts.member_count + 1,
          updated_at = timezone('utc'::text, now());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.corporation_member_counts
    SET member_count = GREATEST(0, member_count - 1),
        updated_at = timezone('utc'::text, now())
    WHERE corp_id = OLD.corp_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_corporation_members_count_sync ON public.corporation_members;
CREATE TRIGGER trg_corporation_members_count_sync
  AFTER INSERT OR DELETE ON public.corporation_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_corporation_member_counts();

-- ------------------------------------------------------------------------------
-- 3. HELPERS DE TESORERÍA SHARDED Y SINCRONIZACIÓN RETROCOMPATIBLE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.init_corp_treasury_shards(
  p_corp_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.corporation_treasury_shards (corp_id, shard_id)
  SELECT p_corp_id, s.shard_id::SMALLINT
  FROM generate_series(0, 15) AS s(shard_id)
  ON CONFLICT (corp_id, shard_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.init_corp_treasury_shards(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.init_corp_treasury_shards(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_corp_treasury_totals(
  p_corp_id UUID
)
RETURNS TABLE(
  treasury_ec BIGINT,
  treasury_alloys BIGINT,
  treasury_fuel BIGINT,
  treasury_chips BIGINT,
  treasury_rare_earth BIGINT,
  treasury_composites BIGINT,
  treasury_tech_scrap BIGINT,
  treasury_citizens INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(SUM(s.treasury_ec), 0)::BIGINT,
    COALESCE(SUM(s.treasury_alloys), 0)::BIGINT,
    COALESCE(SUM(s.treasury_fuel), 0)::BIGINT,
    COALESCE(SUM(s.treasury_chips), 0)::BIGINT,
    COALESCE(SUM(s.treasury_rare_earth), 0)::BIGINT,
    COALESCE(SUM(s.treasury_composites), 0)::BIGINT,
    COALESCE(SUM(s.treasury_tech_scrap), 0)::BIGINT,
    COALESCE(SUM(s.treasury_citizens), 0)::INT
  FROM public.corporation_treasury_shards s
  WHERE s.corp_id = p_corp_id;
$$;

REVOKE ALL ON FUNCTION public.get_corp_treasury_totals(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_corp_treasury_totals(UUID) TO authenticated, service_role;

-- Aplica deltas atómicos sobre corporation_treasury_shards sin lockear public.corporations.
-- - Créditos puros (todos los deltas >= 0): lockea únicamente 1 shard determinístico.
-- - Débitos (algún delta < 0): lockea los 16 shards en orden ascendente (shard_id ASC)
--   y valida que el total agregado >= 0 antes de descontar.
CREATE OR REPLACE FUNCTION public.apply_corp_treasury_delta(
  p_corp_id UUID,
  p_delta_ec BIGINT DEFAULT 0,
  p_delta_alloys BIGINT DEFAULT 0,
  p_delta_fuel BIGINT DEFAULT 0,
  p_delta_chips BIGINT DEFAULT 0,
  p_delta_rare_earth BIGINT DEFAULT 0,
  p_delta_composites BIGINT DEFAULT 0,
  p_delta_tech_scrap BIGINT DEFAULT 0,
  p_delta_citizens INT DEFAULT 0,
  p_shard_seed TEXT DEFAULT NULL
)
RETURNS TABLE(
  treasury_ec BIGINT,
  treasury_alloys BIGINT,
  treasury_fuel BIGINT,
  treasury_chips BIGINT,
  treasury_rare_earth BIGINT,
  treasury_composites BIGINT,
  treasury_tech_scrap BIGINT,
  treasury_citizens INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shard_id SMALLINT;
  v_has_debit BOOLEAN;
  v_tot_ec BIGINT;
  v_tot_alloys BIGINT;
  v_tot_fuel BIGINT;
  v_tot_chips BIGINT;
  v_tot_rare BIGINT;
  v_tot_comp BIGINT;
  v_tot_scrap BIGINT;
  v_tot_citizens INT;
BEGIN
  IF p_corp_id IS NULL THEN
    RAISE EXCEPTION 'CORP_REQUIRED: p_corp_id es obligatorio.';
  END IF;

  v_shard_id := (hashtext(COALESCE(p_shard_seed, (SELECT auth.uid())::text, txid_current()::text)) & 15)::SMALLINT;

  -- Asegurar existencia de shards si la corporación fue creada fuera del flujo normal
  IF NOT EXISTS (SELECT 1 FROM public.corporation_treasury_shards WHERE corp_id = p_corp_id AND shard_id = v_shard_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.corporations WHERE id = p_corp_id) THEN
      RAISE EXCEPTION 'CORP_NOT_FOUND';
    END IF;
    PERFORM public.init_corp_treasury_shards(p_corp_id);
  END IF;

  v_has_debit := (
    p_delta_ec < 0 OR p_delta_alloys < 0 OR p_delta_fuel < 0 OR p_delta_chips < 0
    OR p_delta_rare_earth < 0 OR p_delta_composites < 0 OR p_delta_tech_scrap < 0 OR p_delta_citizens < 0
  );

  IF v_has_debit THEN
    -- Orden canónico determinístico sobre los 16 shards para evitar deadlocks en débitos concurrentes
    PERFORM 1
    FROM public.corporation_treasury_shards s
    WHERE s.corp_id = p_corp_id
    ORDER BY s.shard_id ASC
    FOR UPDATE;

    SELECT
      COALESCE(SUM(s.treasury_ec), 0)::BIGINT,
      COALESCE(SUM(s.treasury_alloys), 0)::BIGINT,
      COALESCE(SUM(s.treasury_fuel), 0)::BIGINT,
      COALESCE(SUM(s.treasury_chips), 0)::BIGINT,
      COALESCE(SUM(s.treasury_rare_earth), 0)::BIGINT,
      COALESCE(SUM(s.treasury_composites), 0)::BIGINT,
      COALESCE(SUM(s.treasury_tech_scrap), 0)::BIGINT,
      COALESCE(SUM(s.treasury_citizens), 0)::INT
    INTO
      v_tot_ec, v_tot_alloys, v_tot_fuel, v_tot_chips,
      v_tot_rare, v_tot_comp, v_tot_scrap, v_tot_citizens
    FROM public.corporation_treasury_shards s
    WHERE s.corp_id = p_corp_id;

    IF (v_tot_ec + p_delta_ec) < 0
       OR (v_tot_alloys + p_delta_alloys) < 0
       OR (v_tot_fuel + p_delta_fuel) < 0
       OR (v_tot_chips + p_delta_chips) < 0
       OR (v_tot_rare + p_delta_rare_earth) < 0
       OR (v_tot_comp + p_delta_composites) < 0
       OR (v_tot_scrap + p_delta_tech_scrap) < 0
       OR (v_tot_citizens + p_delta_citizens) < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY: Tesorería corporativa insuficiente.';
    END IF;
  END IF;

  UPDATE public.corporation_treasury_shards
  SET
    treasury_ec = treasury_ec + p_delta_ec,
    treasury_alloys = treasury_alloys + p_delta_alloys,
    treasury_fuel = treasury_fuel + p_delta_fuel,
    treasury_chips = treasury_chips + p_delta_chips,
    treasury_rare_earth = treasury_rare_earth + p_delta_rare_earth,
    treasury_composites = treasury_composites + p_delta_composites,
    treasury_tech_scrap = treasury_tech_scrap + p_delta_tech_scrap,
    treasury_citizens = treasury_citizens + p_delta_citizens,
    updated_at = timezone('utc'::text, now())
  WHERE corp_id = p_corp_id AND shard_id = v_shard_id;

  RETURN QUERY
  SELECT
    COALESCE(SUM(s.treasury_ec), 0)::BIGINT,
    COALESCE(SUM(s.treasury_alloys), 0)::BIGINT,
    COALESCE(SUM(s.treasury_fuel), 0)::BIGINT,
    COALESCE(SUM(s.treasury_chips), 0)::BIGINT,
    COALESCE(SUM(s.treasury_rare_earth), 0)::BIGINT,
    COALESCE(SUM(s.treasury_composites), 0)::BIGINT,
    COALESCE(SUM(s.treasury_tech_scrap), 0)::BIGINT,
    COALESCE(SUM(s.treasury_citizens), 0)::INT
  FROM public.corporation_treasury_shards s
  WHERE s.corp_id = p_corp_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_corp_treasury_delta(UUID, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_corp_treasury_delta(UUID, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, INT, TEXT) TO service_role;

-- Sincronización batch/bajo demanda hacia public.corporations (para snapshots/lecturas legacy sin bloquear transacciones frecuentes)
CREATE OR REPLACE FUNCTION public.sync_corporation_treasury_rollups(
  p_corp_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  UPDATE public.corporations c
  SET
    treasury_ec = t.treasury_ec,
    treasury_alloys = t.treasury_alloys,
    treasury_fuel = t.treasury_fuel,
    treasury_chips = t.treasury_chips,
    treasury_rare_earth = t.treasury_rare_earth,
    treasury_composites = t.treasury_composites,
    treasury_tech_scrap = t.treasury_tech_scrap,
    treasury_citizens = t.treasury_citizens,
    updated_at = timezone('utc'::text, now())
  FROM public.corporation_treasury_totals t
  WHERE c.id = t.corp_id
    AND (p_corp_id IS NULL OR c.id = p_corp_id)
    AND (
      c.treasury_ec IS DISTINCT FROM t.treasury_ec
      OR c.treasury_alloys IS DISTINCT FROM t.treasury_alloys
      OR c.treasury_fuel IS DISTINCT FROM t.treasury_fuel
      OR c.treasury_chips IS DISTINCT FROM t.treasury_chips
      OR c.treasury_rare_earth IS DISTINCT FROM t.treasury_rare_earth
      OR c.treasury_composites IS DISTINCT FROM t.treasury_composites
      OR c.treasury_tech_scrap IS DISTINCT FROM t.treasury_tech_scrap
      OR c.treasury_citizens IS DISTINCT FROM t.treasury_citizens
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_corporation_treasury_rollups(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_corporation_treasury_rollups(UUID) TO service_role;

-- ------------------------------------------------------------------------------
-- 4. REFACTOR DE LAS 7 RPCS ASIGNADAS (CONTRATO v3 + ORDEN CANÓNICO DE LOCKS)
-- ------------------------------------------------------------------------------

-- (1/7) CREATE_CORPORATION
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

  -- Inicializar los 16 shards de tesorería (balance inicial en shard 0)
  INSERT INTO public.corporation_treasury_shards (
    corp_id, shard_id, treasury_ec, treasury_alloys, treasury_fuel, treasury_chips
  )
  SELECT
    v_corp.id,
    s.shard_id::SMALLINT,
    CASE WHEN s.shard_id = 0 THEN 500 ELSE 0 END,
    CASE WHEN s.shard_id = 0 THEN 50 ELSE 0 END,
    CASE WHEN s.shard_id = 0 THEN 25 ELSE 0 END,
    CASE WHEN s.shard_id = 0 THEN 10 ELSE 0 END
  FROM generate_series(0, 15) AS s(shard_id)
  ON CONFLICT (corp_id, shard_id) DO NOTHING;

  -- El trigger trg_corporation_members_count_sync actualiza corporation_member_counts
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

REVOKE ALL ON FUNCTION public.create_corporation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_corporation(TEXT, TEXT) TO authenticated;

-- (2/7) JOIN_CORPORATION
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

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CORP_NOT_FOUND';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_profile.corp_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_IN_CORP: Ya perteneces a una Corporación.';
  END IF;

  -- El trigger trg_corporation_members_count_sync incrementa corporation_member_counts
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

REVOKE ALL ON FUNCTION public.join_corporation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_corporation(UUID) TO authenticated;

-- (3/7) LEAVE_CORPORATION
CREATE OR REPLACE FUNCTION public.leave_corporation()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_profile public.profiles%ROWTYPE;
  v_member public.corporation_members%ROWTYPE;
  v_next_leader_id UUID;
  v_dissolved BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_profile.corp_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_CORP: No perteneces a ninguna Corporación.';
  END IF;

  SELECT * INTO v_member
  FROM public.corporation_members
  WHERE corp_id = v_profile.corp_id AND user_id = v_user_id
  FOR UPDATE;

  -- El trigger trg_corporation_members_count_sync decrementa corporation_member_counts
  DELETE FROM public.corporation_members
  WHERE corp_id = v_profile.corp_id AND user_id = v_user_id;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE public.profiles SET corp_id = NULL WHERE id = v_user_id;

  SELECT user_id INTO v_next_leader_id
  FROM public.corporation_members
  WHERE corp_id = v_profile.corp_id
  ORDER BY shares DESC, joined_at ASC
  LIMIT 1;

  IF v_next_leader_id IS NULL THEN
    DELETE FROM public.corporations WHERE id = v_profile.corp_id;
    v_dissolved := true;
  ELSIF v_member.role = 'majority_shareholder' THEN
    UPDATE public.corporation_members
    SET
      role = 'majority_shareholder',
      shares = GREATEST(shares, 100),
      delegated_permissions = '{"can_use_treasury":true,"can_construct":true,"can_remodel":true,"can_collect":true,"can_purchase_units":true,"can_control_units":true}'::jsonb
    WHERE corp_id = v_profile.corp_id AND user_id = v_next_leader_id;

    UPDATE public.corporations
    SET leader_user_id = v_next_leader_id, updated_at = timezone('utc'::text, now())
    WHERE id = v_profile.corp_id;
  END IF;

  RETURN jsonb_build_object(
    'left', true,
    'corp_id', v_profile.corp_id,
    'dissolved', v_dissolved,
    'new_leader_user_id', v_next_leader_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_corporation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_corporation() TO authenticated;

-- (4/7) DONATE_TO_CORPORATION
-- Orden canónico: corporation_treasury_shards (1 shard) -> profiles -> user_industrial_inventory
CREATE OR REPLACE FUNCTION public.donate_to_corporation(
  p_corp_id UUID,
  p_ec INT DEFAULT 0,
  p_alloys INT DEFAULT 0,
  p_fuel INT DEFAULT 0,
  p_chips INT DEFAULT 0
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
  v_inv public.user_industrial_inventory%ROWTYPE;
  v_shard_id SMALLINT;
  v_totals RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed FROM auth.users WHERE id = v_user_id;
  IF v_email_confirmed IS NULL THEN
    RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED';
  END IF;

  IF p_ec < 0 OR p_alloys < 0 OR p_fuel < 0 OR p_chips < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Las donaciones no pueden ser negativas.';
  END IF;

  IF (p_ec + p_alloys + p_fuel + p_chips) <= 0 THEN
    RAISE EXCEPTION 'EMPTY_DONATION: Debes especificar al menos 1 recurso para donar.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.corporation_members
    WHERE corp_id = p_corp_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: No perteneces a esta Corporación.';
  END IF;

  -- 1. Lock de shard único ANTES de profiles / user_industrial_inventory (sin lockear corporations)
  v_shard_id := (hashtext(v_user_id::text) & 15)::SMALLINT;
  IF NOT EXISTS (SELECT 1 FROM public.corporation_treasury_shards WHERE corp_id = p_corp_id AND shard_id = v_shard_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.corporations WHERE id = p_corp_id) THEN
      RAISE EXCEPTION 'CORP_NOT_FOUND';
    END IF;
    PERFORM public.init_corp_treasury_shards(p_corp_id);
  END IF;

  PERFORM 1
  FROM public.corporation_treasury_shards
  WHERE corp_id = p_corp_id AND shard_id = v_shard_id
  FOR UPDATE;

  -- 2. Lock de profiles
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF COALESCE(v_profile.battle_credits, 0) < p_ec THEN
    RAISE EXCEPTION 'INSUFFICIENT_EC: Créditos insuficientes.';
  END IF;

  -- 3. Lock de user_industrial_inventory
  IF p_alloys > 0 OR p_fuel > 0 OR p_chips > 0 THEN
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;
    IF NOT FOUND
       OR COALESCE(v_inv.refined_steel, 0) < p_alloys
       OR COALESCE(v_inv.campaign_fuel, 0) < p_fuel
       OR COALESCE(v_inv.refined_microchip, 0) < p_chips THEN
      RAISE EXCEPTION 'INSUFFICIENT_MATERIALS: Materiales industriales insuficientes.';
    END IF;

    UPDATE public.user_industrial_inventory
    SET
      refined_steel = refined_steel - p_alloys,
      campaign_fuel = campaign_fuel - p_fuel,
      refined_microchip = refined_microchip - p_chips,
      updated_at = timezone('utc'::text, now())
    WHERE user_id = v_user_id;
  END IF;

  IF p_ec > 0 THEN
    PERFORM set_config('app.bypass_profile_guard', 'on', true);
    UPDATE public.profiles
    SET battle_credits = battle_credits - p_ec
    WHERE id = v_user_id;
  END IF;

  SELECT * INTO v_totals
  FROM public.apply_corp_treasury_delta(
    p_corp_id,
    p_ec::BIGINT,
    p_alloys::BIGINT,
    p_fuel::BIGINT,
    p_chips::BIGINT,
    0, 0, 0, 0,
    v_user_id::text
  );

  RETURN jsonb_build_object(
    'corp_id', p_corp_id,
    'treasury_ec', v_totals.treasury_ec,
    'treasury_alloys', v_totals.treasury_alloys,
    'treasury_fuel', v_totals.treasury_fuel,
    'treasury_chips', v_totals.treasury_chips
  );
END;
$$;

REVOKE ALL ON FUNCTION public.donate_to_corporation(UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.donate_to_corporation(UUID, INT, INT, INT, INT) TO authenticated;

-- (5/7) CONSTRUCT_BUILDING
-- Orden canónico: [corporations si housing ->] corporation_treasury_shards (ORDER BY shard_id ASC) -> buildings -> profiles -> user_industrial_inventory
CREATE OR REPLACE FUNCTION public.construct_building(
  p_h3_index BIGINT,
  p_municipality_id VARCHAR,
  p_corp_id UUID,
  p_building_type VARCHAR,
  p_use_personal_topup BOOLEAN DEFAULT false,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_cached JSONB;
  v_spec RECORD;
  v_tot_ec BIGINT := 0;
  v_tot_alloys BIGINT := 0;
  v_profile public.profiles%ROWTYPE;
  v_inv public.user_industrial_inventory%ROWTYPE;
  v_corp_ec_spend BIGINT := 0;
  v_personal_ec_spend BIGINT := 0;
  v_corp_alloy_spend BIGINT := 0;
  v_personal_alloy_spend BIGINT := 0;
  v_building public.buildings%ROWTYPE;
  v_res JSONB;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_construct');

  SELECT * INTO v_spec FROM public.get_building_catalog_spec(p_building_type, 1);

  -- 1. Lock de corporations únicamente si es housing (population_cap), antes de shards/buildings/profiles
  IF p_building_type = 'housing' THEN
    UPDATE public.corporations
    SET population_cap = population_cap + 10,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_corp_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORP_NOT_FOUND'; END IF;
  END IF;

  -- 2. Lock de shards en orden ascendente (sin lockear corporations para edificios frecuentes)
  IF NOT EXISTS (SELECT 1 FROM public.corporation_treasury_shards WHERE corp_id = p_corp_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.corporations WHERE id = p_corp_id) THEN
      RAISE EXCEPTION 'CORP_NOT_FOUND';
    END IF;
    PERFORM public.init_corp_treasury_shards(p_corp_id);
  END IF;

  PERFORM 1
  FROM public.corporation_treasury_shards s
  WHERE s.corp_id = p_corp_id
  ORDER BY s.shard_id ASC
  FOR UPDATE;

  SELECT
    COALESCE(SUM(s.treasury_ec), 0)::BIGINT,
    COALESCE(SUM(s.treasury_alloys), 0)::BIGINT
  INTO v_tot_ec, v_tot_alloys
  FROM public.corporation_treasury_shards s
  WHERE s.corp_id = p_corp_id;

  IF p_use_personal_topup THEN
    v_corp_ec_spend := LEAST(v_tot_ec, v_spec.cost_ec);
    v_personal_ec_spend := v_spec.cost_ec - v_corp_ec_spend;
    v_corp_alloy_spend := LEAST(v_tot_alloys, v_spec.cost_alloys);
    v_personal_alloy_spend := v_spec.cost_alloys - v_corp_alloy_spend;
  ELSE
    IF v_tot_ec < v_spec.cost_ec OR v_tot_alloys < v_spec.cost_alloys THEN
      RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY: Tesorería corporativa insuficiente.';
    END IF;
    v_corp_ec_spend := v_spec.cost_ec;
    v_corp_alloy_spend := v_spec.cost_alloys;
  END IF;

  -- 3. Escritura en territories y buildings ANTES de lockear profiles/user_industrial_inventory
  INSERT INTO public.territories (id, name, level)
  VALUES (p_municipality_id, p_municipality_id, 'MUNICIPALITY')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.buildings (
    h3_index, municipality_id, owner_user_id, corp_id, building_type, level, hp, max_hp,
    infra_state, is_production_halted, storage_cap, last_collected_at
  ) VALUES (
    p_h3_index, p_municipality_id, v_user_id, p_corp_id, p_building_type, 1, v_spec.max_hp, v_spec.max_hp,
    'OPERATIONAL', false, 250, timezone('utc'::text, now())
  )
  RETURNING * INTO v_building;

  -- 4. Lock de profiles y user_industrial_inventory si aplica topup personal
  IF p_use_personal_topup THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
    IF COALESCE(v_profile.battle_credits, 0) < v_personal_ec_spend THEN
      RAISE EXCEPTION 'INSUFFICIENT_EC: Créditos insuficientes incluso con aporte personal.';
    END IF;

    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;
    IF COALESCE(v_inv.refined_steel, 0) < v_personal_alloy_spend THEN
      RAISE EXCEPTION 'INSUFFICIENT_ALLOYS: Aleaciones insuficientes incluso con aporte personal.';
    END IF;

    IF v_personal_ec_spend > 0 THEN
      PERFORM set_config('app.bypass_profile_guard', 'on', true);
      UPDATE public.profiles SET battle_credits = battle_credits - v_personal_ec_spend WHERE id = v_user_id;
    END IF;
    IF v_personal_alloy_spend > 0 THEN
      UPDATE public.user_industrial_inventory SET refined_steel = refined_steel - v_personal_alloy_spend WHERE user_id = v_user_id;
    END IF;
  END IF;

  -- 5. Aplicar delta en shards (ya lockeados en paso 2)
  PERFORM public.apply_corp_treasury_delta(
    p_corp_id,
    -v_corp_ec_spend,
    -v_corp_alloy_spend,
    0, 0, 0, 0, 0, 0,
    v_user_id::text
  );

  v_res := jsonb_build_object(
    'building', to_jsonb(v_building),
    'spent_corp_ec', v_corp_ec_spend,
    'spent_personal_ec', v_personal_ec_spend
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'construct_building', v_res);
  END IF;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.construct_building(BIGINT, VARCHAR, UUID, VARCHAR, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.construct_building(BIGINT, VARCHAR, UUID, VARCHAR, BOOLEAN, UUID) TO authenticated;

-- (6/7) CREATE_INFRA_EDGE
-- Orden canónico: corporation_treasury_shards (ORDER BY shard_id ASC) -> buildings -> infra_edges -> profiles -> user_industrial_inventory
CREATE OR REPLACE FUNCTION public.create_infra_edge(
  p_corp_id UUID,
  p_edge_type TEXT,
  p_from_h3 BIGINT,
  p_to_h3 BIGINT,
  p_from_building_id UUID DEFAULT NULL,
  p_to_building_id UUID DEFAULT NULL,
  p_use_personal_topup BOOLEAN DEFAULT false,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_cached JSONB;
  v_spec RECORD;
  v_tot_ec BIGINT := 0;
  v_tot_alloys BIGINT := 0;
  v_profile public.profiles%ROWTYPE;
  v_inv public.user_industrial_inventory%ROWTYPE;
  v_corp_ec_spend BIGINT := 0;
  v_personal_ec_spend BIGINT := 0;
  v_corp_alloy_spend BIGINT := 0;
  v_personal_alloy_spend BIGINT := 0;
  v_edge public.infra_edges%ROWTYPE;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_edge_type NOT IN ('pipeline', 'road', 'bridge') THEN
    RAISE EXCEPTION 'INVALID_EDGE_TYPE: Tipo de arista no válido (%).', p_edge_type;
  END IF;
  IF p_from_h3 IS NULL OR p_to_h3 IS NULL OR p_from_h3 = p_to_h3 THEN
    RAISE EXCEPTION 'INVALID_EDGE_ENDPOINTS: Debe conectar dos hexágonos H3 distintos.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_construct');

  SELECT * INTO v_spec FROM public.get_building_catalog_spec(p_edge_type, 1);

  -- 1. Lock de shards en orden ascendente (sin lockear corporations)
  IF NOT EXISTS (SELECT 1 FROM public.corporation_treasury_shards WHERE corp_id = p_corp_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.corporations WHERE id = p_corp_id) THEN
      RAISE EXCEPTION 'CORP_NOT_FOUND';
    END IF;
    PERFORM public.init_corp_treasury_shards(p_corp_id);
  END IF;

  PERFORM 1
  FROM public.corporation_treasury_shards s
  WHERE s.corp_id = p_corp_id
  ORDER BY s.shard_id ASC
  FOR UPDATE;

  SELECT
    COALESCE(SUM(s.treasury_ec), 0)::BIGINT,
    COALESCE(SUM(s.treasury_alloys), 0)::BIGINT
  INTO v_tot_ec, v_tot_alloys
  FROM public.corporation_treasury_shards s
  WHERE s.corp_id = p_corp_id;

  IF p_use_personal_topup THEN
    v_corp_ec_spend := LEAST(v_tot_ec, v_spec.cost_ec);
    v_personal_ec_spend := v_spec.cost_ec - v_corp_ec_spend;
    v_corp_alloy_spend := LEAST(v_tot_alloys, v_spec.cost_alloys);
    v_personal_alloy_spend := v_spec.cost_alloys - v_corp_alloy_spend;
  ELSE
    IF v_tot_ec < v_spec.cost_ec OR v_tot_alloys < v_spec.cost_alloys THEN
      RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY';
    END IF;
    v_corp_ec_spend := v_spec.cost_ec;
    v_corp_alloy_spend := v_spec.cost_alloys;
  END IF;

  -- 2. Escritura en infra_edges y buildings (si pipeline) ANTES de profiles/user_industrial_inventory
  INSERT INTO public.infra_edges (
    corp_id, edge_type, from_h3, to_h3, from_building_id, to_building_id, hp, max_hp, status
  ) VALUES (
    p_corp_id, p_edge_type, p_from_h3, p_to_h3, p_from_building_id, p_to_building_id, v_spec.max_hp, v_spec.max_hp, 'operational'
  )
  ON CONFLICT (edge_type, from_h3, to_h3) DO UPDATE SET
    corp_id = EXCLUDED.corp_id,
    from_building_id = COALESCE(EXCLUDED.from_building_id, public.infra_edges.from_building_id),
    to_building_id = COALESCE(EXCLUDED.to_building_id, public.infra_edges.to_building_id),
    hp = EXCLUDED.max_hp,
    max_hp = EXCLUDED.max_hp,
    status = 'operational',
    ruined_at = NULL
  RETURNING * INTO v_edge;

  IF p_edge_type = 'pipeline' THEN
    WITH RECURSIVE pipe_reach AS (
      SELECT b.h3_index
      FROM public.buildings b
      WHERE b.corp_id = p_corp_id
        AND b.building_type IN ('depot', 'hq')
        AND b.infra_state = 'OPERATIONAL'
        AND NOT b.is_disabled
      UNION
      SELECT CASE WHEN e.from_h3 = pr.h3_index THEN e.to_h3 ELSE e.from_h3 END
      FROM public.infra_edges e
      JOIN pipe_reach pr ON e.from_h3 = pr.h3_index OR e.to_h3 = pr.h3_index
      WHERE e.corp_id = p_corp_id
        AND e.edge_type = 'pipeline'
        AND e.status = 'operational'
    )
    UPDATE public.buildings b
    SET is_production_halted = false, updated_at = timezone('utc'::text, now())
    FROM pipe_reach pr
    WHERE b.corp_id = p_corp_id
      AND b.building_type = 'extractor'
      AND b.h3_index = pr.h3_index
      AND b.is_production_halted = true;
  END IF;

  -- 3. Lock de profiles y user_industrial_inventory si aplica topup personal
  IF p_use_personal_topup THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
    IF COALESCE(v_profile.battle_credits, 0) < v_personal_ec_spend THEN
      RAISE EXCEPTION 'INSUFFICIENT_EC';
    END IF;

    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;
    IF COALESCE(v_inv.refined_steel, 0) < v_personal_alloy_spend THEN
      RAISE EXCEPTION 'INSUFFICIENT_ALLOYS';
    END IF;

    IF v_personal_ec_spend > 0 THEN
      PERFORM set_config('app.bypass_profile_guard', 'on', true);
      UPDATE public.profiles SET battle_credits = battle_credits - v_personal_ec_spend WHERE id = v_user_id;
    END IF;
    IF v_personal_alloy_spend > 0 THEN
      UPDATE public.user_industrial_inventory SET refined_steel = refined_steel - v_personal_alloy_spend WHERE user_id = v_user_id;
    END IF;
  END IF;

  -- 4. Aplicar delta en shards (ya lockeados en paso 1)
  PERFORM public.apply_corp_treasury_delta(
    p_corp_id,
    -v_corp_ec_spend,
    -v_corp_alloy_spend,
    0, 0, 0, 0, 0, 0,
    v_user_id::text
  );

  v_res := jsonb_build_object('edge', to_jsonb(v_edge));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'create_infra_edge', v_res);
  END IF;
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.create_infra_edge(UUID, TEXT, BIGINT, BIGINT, UUID, UUID, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_infra_edge(UUID, TEXT, BIGINT, BIGINT, UUID, UUID, BOOLEAN, UUID) TO authenticated;

-- (7/7) COLLECT_BUILDING_RESOURCES
-- Orden canónico: corporation_treasury_shards (1 shard) -> buildings (1 fila)
CREATE OR REPLACE FUNCTION public.collect_building_resources(
  p_building_id UUID,
  p_corp_id UUID,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_cached JSONB;
  v_shard_id SMALLINT;
  v_bld public.buildings%ROWTYPE;
  v_spec RECORD;
  v_elapsed_hours NUMERIC;
  v_alloys BIGINT;
  v_fuel BIGINT;
  v_chips BIGINT;
  v_ec BIGINT;
  v_res JSONB;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_collect');

  -- 1. Lock de shard único ANTES de buildings (sin lockear corporations)
  v_shard_id := (hashtext(p_building_id::text) & 15)::SMALLINT;
  IF NOT EXISTS (SELECT 1 FROM public.corporation_treasury_shards WHERE corp_id = p_corp_id AND shard_id = v_shard_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.corporations WHERE id = p_corp_id) THEN
      RAISE EXCEPTION 'CORP_NOT_FOUND';
    END IF;
    PERFORM public.init_corp_treasury_shards(p_corp_id);
  END IF;

  PERFORM 1
  FROM public.corporation_treasury_shards
  WHERE corp_id = p_corp_id AND shard_id = v_shard_id
  FOR UPDATE;

  -- 2. Lock de buildings
  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUILDING_NOT_FOUND'; END IF;
  IF v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'NOT_BUILDING_OWNER'; END IF;
  IF v_bld.is_disabled THEN RAISE EXCEPTION 'BUILDING_DISABLED'; END IF;

  SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);

  v_elapsed_hours := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (timezone('utc'::text, now()) - v_bld.last_collected_at)) / 3600.0));

  v_alloys := COALESCE((v_bld.stored_resources->>'alloys')::bigint, 0) + FLOOR(v_spec.alloys_per_hour * v_elapsed_hours)::bigint;
  v_fuel   := COALESCE((v_bld.stored_resources->>'fuel')::bigint, 0)   + FLOOR(v_spec.fuel_per_hour * v_elapsed_hours)::bigint;
  v_chips  := COALESCE((v_bld.stored_resources->>'chips')::bigint, 0)  + FLOOR(v_spec.chips_per_hour * v_elapsed_hours)::bigint;
  v_ec     := FLOOR(v_spec.ec_per_hour * v_elapsed_hours)::bigint;

  -- 3. Aplicar crédito sobre el shard ya lockeado
  PERFORM public.apply_corp_treasury_delta(
    p_corp_id,
    v_ec,
    v_alloys,
    v_fuel,
    v_chips,
    0, 0, 0, 0,
    p_building_id::text
  );

  UPDATE public.buildings
  SET stored_resources = '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
      last_collected_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_building_id;

  v_res := jsonb_build_object(
    'elapsed_hours', ROUND(v_elapsed_hours, 4),
    'collected', jsonb_build_object('ec', v_ec, 'alloys', v_alloys, 'fuel', v_fuel, 'chips', v_chips)
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'collect_building_resources', v_res);
  END IF;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.collect_building_resources(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_building_resources(UUID, UUID, UUID) TO authenticated;
