-- ==============================================================================
-- MIGRATION: 20261118000003_mmo_infra_population_logistics_scheduler.sql
-- OBJETIVO: Motor MMO 2D por Acciones — Bases Históricas, Viviendas/Ciudadanos,
--           Producción estilo Advance Wars, Logística Dual (Tuberías/Unidades),
--           Estados RUINED/SEVERED y Programador Estratégico de Drones + Bitácora.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CORPORATIONS: POBLACIÓN DE CIUDADANOS Y TECHO POBLACIONAL
-- ------------------------------------------------------------------------------
ALTER TABLE public.corporations
  ADD COLUMN IF NOT EXISTS treasury_citizens INT NOT NULL DEFAULT 0 CHECK (treasury_citizens >= 0),
  ADD COLUMN IF NOT EXISTS population_cap INT NOT NULL DEFAULT 10 CHECK (population_cap >= 0);

-- ------------------------------------------------------------------------------
-- 2. BUILDINGS: BASES HISTÓRICAS, ALMACÉN FINITO Y ESTADOS RUINED/DAMAGED
-- ------------------------------------------------------------------------------
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS is_historical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS infra_state VARCHAR(16) NOT NULL DEFAULT 'OPERATIONAL'
    CHECK (infra_state IN ('OPERATIONAL', 'DAMAGED', 'RUINED')),
  ADD COLUMN IF NOT EXISTS max_hp NUMERIC(6,1) NOT NULL DEFAULT 20.0,
  ADD COLUMN IF NOT EXISTS base_terrain VARCHAR(24) NOT NULL DEFAULT 'plains',
  ADD COLUMN IF NOT EXISTS storage_cap BIGINT NOT NULL DEFAULT 250 CHECK (storage_cap > 0),
  ADD COLUMN IF NOT EXISTS is_production_halted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ruined_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_buildings_corp_state
  ON public.buildings(corp_id, infra_state);

-- ------------------------------------------------------------------------------
-- 3. INFRA_EDGES: TUBERÍAS, CARRETERAS Y PUENTES (NUNCA SE BORRAN AL DAÑARSE)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_edges (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id              UUID REFERENCES public.corporations(id) ON DELETE SET NULL,
  edge_type            VARCHAR(16) NOT NULL CHECK (edge_type IN ('pipeline', 'road', 'bridge')),
  from_h3              BIGINT NOT NULL,
  to_h3                BIGINT NOT NULL,
  from_building_id     UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  to_building_id       UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  hp                   NUMERIC(5,1) NOT NULL DEFAULT 20.0 CHECK (hp >= 0),
  max_hp               NUMERIC(5,1) NOT NULL DEFAULT 20.0 CHECK (max_hp > 0),
  status               VARCHAR(16) NOT NULL DEFAULT 'operational' CHECK (status IN ('operational', 'severed')),
  is_historical_anchor BOOLEAN NOT NULL DEFAULT false,
  ruined_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_infra_edge UNIQUE (edge_type, from_h3, to_h3)
);

CREATE INDEX IF NOT EXISTS idx_infra_edges_corp_type
  ON public.infra_edges(corp_id, edge_type, status);

ALTER TABLE public.infra_edges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.infra_edges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.infra_edges TO anon, authenticated;

DROP POLICY IF EXISTS "infra_edges_public_read" ON public.infra_edges;
CREATE POLICY "infra_edges_public_read"
  ON public.infra_edges FOR SELECT USING (true);

-- ------------------------------------------------------------------------------
-- 4. OPERATIONAL_UNITS: ROLES LOGÍSTICOS, CIUDADANOS Y CARGA
-- ------------------------------------------------------------------------------
ALTER TABLE public.operational_units
  ADD COLUMN IF NOT EXISTS unit_role VARCHAR(16) NOT NULL DEFAULT 'combat'
    CHECK (unit_role IN ('combat', 'citizen', 'collector')),
  ADD COLUMN IF NOT EXISTS citizens_aboard INT NOT NULL DEFAULT 0 CHECK (citizens_aboard >= 0),
  ADD COLUMN IF NOT EXISTS cargo JSONB NOT NULL DEFAULT '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS cargo_cap BIGINT NOT NULL DEFAULT 0 CHECK (cargo_cap >= 0),
  ADD COLUMN IF NOT EXISTS source_building_id UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depot_building_id UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_haul_at TIMESTAMPTZ;

-- ------------------------------------------------------------------------------
-- 5. VULNERABILITY_WINDOWS: HANDSHAKE DE 120s PARA ATAQUE A INFRAESTRUCTURA
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vulnerability_windows (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id      VARCHAR(32) NOT NULL REFERENCES public.territories(id) ON DELETE CASCADE,
  attacker_corp_id     UUID NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  defender_corp_id     UUID REFERENCES public.corporations(id) ON DELETE SET NULL,
  handshake_started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  active_from          TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + interval '120 seconds'),
  expires_at           TIMESTAMPTZ NOT NULL,
  status               VARCHAR(16) NOT NULL DEFAULT 'handshake' CHECK (status IN ('handshake', 'active', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_vuln_windows_muni
  ON public.vulnerability_windows(municipality_id, status, active_from, expires_at);

ALTER TABLE public.vulnerability_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vulnerability_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vulnerability_windows TO authenticated;

DROP POLICY IF EXISTS "vuln_windows_auth_read" ON public.vulnerability_windows;
CREATE POLICY "vuln_windows_auth_read"
  ON public.vulnerability_windows FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------------------------
-- 6. UNIT_COMMAND_SCHEDULES & UNIT_ACTION_LOGS (PROGRAMADOR DE DRONES + BITÁCORA)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unit_command_schedules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id             UUID REFERENCES public.operational_units(id) ON DELETE CASCADE,
  hangar_slot_id      UUID REFERENCES public.user_unit_hangar(id) ON DELETE SET NULL,
  corp_id             UUID NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  created_by          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  command_type        TEXT NOT NULL CHECK (command_type IN ('move', 'patrol', 'auto_collect', 'skirmish', 'scheduled_deploy')),
  waypoints           JSONB NOT NULL DEFAULT '[]'::jsonb,
  waypoint_cursor     INT NOT NULL DEFAULT 0,
  target_building_id  UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  scheduled_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  next_tick_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  repeat_interval_sec INT CHECK (repeat_interval_sec IS NULL OR repeat_interval_sec >= 10),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'failed')),
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chk_schedule_target CHECK (
    (command_type = 'scheduled_deploy' AND hangar_slot_id IS NOT NULL)
    OR (command_type <> 'scheduled_deploy' AND unit_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ucs_due
  ON public.unit_command_schedules(next_tick_at, status)
  WHERE status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_ucs_unit ON public.unit_command_schedules(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_ucs_corp ON public.unit_command_schedules(corp_id, created_at DESC);

ALTER TABLE public.unit_command_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_command_schedules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.unit_command_schedules TO authenticated;

DROP POLICY IF EXISTS "ucs_select_corp" ON public.unit_command_schedules;
CREATE POLICY "ucs_select_corp"
  ON public.unit_command_schedules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.corporation_members cm
      WHERE cm.corp_id = unit_command_schedules.corp_id
        AND cm.user_id = (SELECT auth.uid())
    )
  );

CREATE TABLE IF NOT EXISTS public.unit_action_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID REFERENCES public.operational_units(id) ON DELETE SET NULL,
  schedule_id UUID REFERENCES public.unit_command_schedules(id) ON DELETE SET NULL,
  corp_id     UUID NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'order_scheduled', 'order_cancelled', 'order_started', 'waypoint_step',
    'deployed', 'collected', 'interception', 'skirmish', 'order_completed', 'order_failed'
  )),
  summary     TEXT NOT NULL,
  h3_index    BIGINT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ual_corp_time ON public.unit_action_logs(corp_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ual_unit_time ON public.unit_action_logs(unit_id, created_at DESC);

ALTER TABLE public.unit_action_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_action_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.unit_action_logs TO authenticated;

DROP POLICY IF EXISTS "ual_select_corp" ON public.unit_action_logs;
CREATE POLICY "ual_select_corp"
  ON public.unit_action_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.corporation_members cm
      WHERE cm.corp_id = unit_action_logs.corp_id
        AND cm.user_id = (SELECT auth.uid())
    )
  );

-- Publicación Realtime CDC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'infra_edges') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.infra_edges;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'unit_command_schedules') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.unit_command_schedules;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'unit_action_logs') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.unit_action_logs;
    END IF;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 7. CATÁLOGO EXTENDIDO DE EDIFICIOS & POBLACIÓN (MANTIENE FIRMA RETURNS TABLE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_building_catalog_spec(
  p_building_type TEXT,
  p_level INT DEFAULT 1
)
RETURNS TABLE(
  cost_ec BIGINT,
  cost_alloys BIGINT,
  alloys_per_hour NUMERIC,
  fuel_per_hour NUMERIC,
  chips_per_hour NUMERIC,
  ec_per_hour NUMERIC,
  max_hp NUMERIC
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_lvl INT := GREATEST(1, LEAST(5, COALESCE(p_level, 1)));
  v_mult NUMERIC := 1.0 + ((v_lvl - 1) * 0.35);
BEGIN
  IF p_building_type IN ('barracks', 'factory', 'war_factory') THEN
    RETURN QUERY SELECT
      (600 * v_lvl)::BIGINT, (25 * v_lvl)::BIGINT,
      0::NUMERIC, 0::NUMERIC, 0::NUMERIC, ROUND(20 * v_mult, 2), ROUND(25 * v_mult, 1);
  ELSIF p_building_type IN ('extractor', 'foundry', 'refinery', 'mine') THEN
    RETURN QUERY SELECT
      (450 * v_lvl)::BIGINT, (15 * v_lvl)::BIGINT,
      ROUND(18 * v_mult, 2), ROUND(12 * v_mult, 2), ROUND(6 * v_mult, 2), ROUND(45 * v_mult, 2), ROUND(20 * v_mult, 1);
  ELSIF p_building_type IN ('airport', 'port', 'radar', 'hq') THEN
    RETURN QUERY SELECT
      (800 * v_lvl)::BIGINT, (35 * v_lvl)::BIGINT,
      ROUND(6 * v_mult, 2), ROUND(10 * v_mult, 2), ROUND(12 * v_mult, 2), ROUND(30 * v_mult, 2), ROUND(30 * v_mult, 1);
  ELSIF p_building_type = 'housing' THEN
    RETURN QUERY SELECT
      (120 * v_lvl)::BIGINT, (15 * v_lvl)::BIGINT,
      0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, ROUND(20 * v_mult, 1);
  ELSIF p_building_type = 'depot' THEN
    RETURN QUERY SELECT
      (160 * v_lvl)::BIGINT, (25 * v_lvl)::BIGINT,
      0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, ROUND(30 * v_mult, 1);
  ELSIF p_building_type = 'fortification' THEN
    RETURN QUERY SELECT
      (140 * v_lvl)::BIGINT, (25 * v_lvl)::BIGINT,
      0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, ROUND(40 * v_mult, 1);
  ELSIF p_building_type = 'road' THEN
    RETURN QUERY SELECT
      30::BIGINT, 5::BIGINT,
      0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 15::NUMERIC;
  ELSIF p_building_type = 'bridge' THEN
    RETURN QUERY SELECT
      90::BIGINT, 20::BIGINT,
      0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 25::NUMERIC;
  ELSIF p_building_type = 'pipeline' THEN
    RETURN QUERY SELECT
      60::BIGINT, 12::BIGINT,
      0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 15::NUMERIC;
  ELSE
    RAISE EXCEPTION 'INVALID_BUILDING_TYPE: Tipo de edificio no reconocido (%).', p_building_type;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. RPCS DE POBLACIÓN, PRODUCCIÓN ADVANCE WARS Y LOGÍSTICA DUAL
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collect_housing_citizens(
  p_building_id UUID,
  p_corp_id UUID,
  p_spawn_as_unit BOOLEAN DEFAULT false,
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
  v_bld public.buildings%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
  v_citizens_per_hour NUMERIC;
  v_elapsed_hours NUMERIC;
  v_generated INT;
  v_room INT;
  v_added INT;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_collect');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id FOR UPDATE;
  IF NOT FOUND OR v_bld.corp_id <> p_corp_id OR v_bld.building_type <> 'housing' THEN
    RAISE EXCEPTION 'INVALID_HOUSING_BUILDING';
  END IF;
  IF v_bld.infra_state = 'RUINED' OR v_bld.is_disabled THEN
    RAISE EXCEPTION 'BUILDING_RUINED';
  END IF;

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id FOR UPDATE;
  v_citizens_per_hour := 2.0 * power(1.5, GREATEST(0, v_bld.level - 1));
  v_elapsed_hours := LEAST(24.0, GREATEST(0.0, EXTRACT(EPOCH FROM (timezone('utc'::text, now()) - v_bld.last_collected_at)) / 3600.0));
  v_generated := FLOOR(v_citizens_per_hour * v_elapsed_hours);
  v_room := GREATEST(0, v_corp.population_cap - v_corp.treasury_citizens);
  v_added := LEAST(v_generated, v_room);

  IF v_added > 0 THEN
    IF p_spawn_as_unit THEN
      INSERT INTO public.operational_units (
        owner_user_id, corp_id, unit_code, tier, hp, h3_index, municipality_id, status, unit_role, citizens_aboard
      ) VALUES (
        v_user_id, p_corp_id, 'infantry', 1, 100, v_bld.h3_index, v_bld.municipality_id, 'active', 'citizen', v_added
      );
    ELSE
      UPDATE public.corporations
      SET treasury_citizens = treasury_citizens + v_added, updated_at = timezone('utc'::text, now())
      WHERE id = p_corp_id;
    END IF;
  END IF;

  UPDATE public.buildings
  SET last_collected_at = timezone('utc'::text, now()), updated_at = timezone('utc'::text, now())
  WHERE id = p_building_id;

  v_res := jsonb_build_object('added_citizens', v_added, 'spawned_unit', p_spawn_as_unit);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'collect_housing_citizens', v_res);
  END IF;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.recruit_and_deploy_unit(
  p_corp_id UUID,
  p_building_id UUID,
  p_unit_code TEXT,
  p_tier INT DEFAULT 1,
  p_target_h3_index BIGINT DEFAULT NULL,
  p_personal_contribution NUMERIC DEFAULT 0,
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
  v_bld public.buildings%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
  v_spec RECORD;
  v_citizen_cost INT := 1;
  v_cost_ec INT;
  v_cost_alloys INT;
  v_spawn_h3 BIGINT;
  v_unit public.operational_units%ROWTYPE;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_purchase_units');
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_control_units');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id FOR UPDATE;
  IF NOT FOUND OR v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'BUILDING_NOT_OWNED'; END IF;
  IF v_bld.infra_state = 'RUINED' OR v_bld.is_disabled THEN RAISE EXCEPTION 'BUILDING_RUINED'; END IF;
  IF v_bld.building_type NOT IN ('factory', 'barracks', 'port', 'airport', 'hq') THEN
    RAISE EXCEPTION 'INVALID_PRODUCTION_FACILITY';
  END IF;

  SELECT * INTO v_spec FROM public.get_unit_catalog_spec(p_unit_code, p_tier);
  v_cost_ec := GREATEST(0, COALESCE(v_spec.cost_ec, 0)::INT - COALESCE(p_personal_contribution, 0)::INT);
  v_cost_alloys := COALESCE(v_spec.cost_alloys, 0)::INT;

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id FOR UPDATE;
  IF v_corp.treasury_citizens < v_citizen_cost THEN
    RAISE EXCEPTION 'INSUFFICIENT_CITIZENS: Requiere % ciudadano(s).', v_citizen_cost;
  END IF;
  IF v_corp.treasury_ec < v_cost_ec OR v_corp.treasury_alloys < v_cost_alloys THEN
    RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY';
  END IF;

  UPDATE public.corporations
  SET
    treasury_citizens = treasury_citizens - v_citizen_cost,
    treasury_ec = treasury_ec - v_cost_ec,
    treasury_alloys = treasury_alloys - v_cost_alloys,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_corp_id;

  v_spawn_h3 := COALESCE(p_target_h3_index, v_bld.h3_index);

  INSERT INTO public.operational_units (
    owner_user_id, corp_id, unit_code, tier, hp, h3_index, municipality_id, status, unit_role
  ) VALUES (
    v_user_id, p_corp_id, p_unit_code, GREATEST(1, LEAST(5, p_tier)), 100, v_spawn_h3, v_bld.municipality_id, 'active', 'combat'
  )
  RETURNING * INTO v_unit;

  INSERT INTO public.unit_action_logs (unit_id, corp_id, action_type, summary, h3_index, metadata)
  VALUES (v_unit.id, p_corp_id, 'deployed', 'Reclutamiento directo estilo Advance Wars: ' || p_unit_code, v_spawn_h3, jsonb_build_object('building_id', p_building_id, 'citizen_cost', v_citizen_cost));

  v_res := jsonb_build_object('operational_unit', to_jsonb(v_unit), 'citizens_spent', v_citizen_cost);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'recruit_and_deploy_unit', v_res);
  END IF;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pipeline_logistics(
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
  v_rec RECORD;
  v_spec RECORD;
  v_elapsed NUMERIC;
  v_total_alloys INT := 0;
  v_total_fuel INT := 0;
  v_total_chips INT := 0;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_collect');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  -- Extractores conectados vía grafo de tuberías operacionales hacia algún Depot/HQ operacional
  FOR v_rec IN
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
    SELECT b.*
    FROM public.buildings b
    JOIN pipe_reach pr ON pr.h3_index = b.h3_index
    WHERE b.corp_id = p_corp_id
      AND b.building_type = 'extractor'
      AND b.infra_state = 'OPERATIONAL'
      AND NOT b.is_disabled
    FOR UPDATE OF b
  LOOP
    SELECT * INTO v_spec FROM public.get_building_catalog_spec('extractor', v_rec.level);
    v_elapsed := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (timezone('utc'::text, now()) - v_rec.last_collected_at)) / 3600.0));
    v_total_alloys := v_total_alloys + FLOOR(COALESCE(v_spec.alloys_per_hour, 0) * v_elapsed)::INT + COALESCE((v_rec.stored_resources->>'alloys')::INT, 0);
    v_total_fuel := v_total_fuel + FLOOR(COALESCE(v_spec.fuel_per_hour, 0) * v_elapsed)::INT + COALESCE((v_rec.stored_resources->>'fuel')::INT, 0);
    v_total_chips := v_total_chips + FLOOR(COALESCE(v_spec.chips_per_hour, 0) * v_elapsed)::INT + COALESCE((v_rec.stored_resources->>'chips')::INT, 0);

    UPDATE public.buildings
    SET
      stored_resources = '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
      is_production_halted = false,
      last_collected_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_rec.id;
  END LOOP;

  IF (v_total_alloys + v_total_fuel + v_total_chips) > 0 THEN
    UPDATE public.corporations
    SET
      treasury_alloys = treasury_alloys + v_total_alloys,
      treasury_fuel = treasury_fuel + v_total_fuel,
      treasury_chips = treasury_chips + v_total_chips,
      updated_at = timezone('utc'::text, now())
    WHERE id = p_corp_id;
  END IF;

  v_res := jsonb_build_object('alloys', v_total_alloys, 'fuel', v_total_fuel, 'chips', v_total_chips);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'sync_pipeline_logistics', v_res);
  END IF;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.repair_infrastructure(
  p_target_kind TEXT,
  p_target_id UUID,
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
  v_bld public.buildings%ROWTYPE;
  v_edge public.infra_edges%ROWTYPE;
  v_spec RECORD;
  v_cost_ec INT;
  v_cost_alloys INT;
  v_corp public.corporations%ROWTYPE;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_construct');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  IF p_target_kind = 'building' THEN
    SELECT * INTO v_bld FROM public.buildings WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND OR v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'BUILDING_NOT_OWNED'; END IF;
    SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);
  ELSIF p_target_kind = 'edge' THEN
    SELECT * INTO v_edge FROM public.infra_edges WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND OR v_edge.corp_id <> p_corp_id THEN RAISE EXCEPTION 'EDGE_NOT_OWNED'; END IF;
    SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_edge.edge_type, 1);
  ELSE
    RAISE EXCEPTION 'INVALID_TARGET_KIND';
  END IF;

  v_cost_ec := GREATEST(1, FLOOR(COALESCE(v_spec.cost_ec, 100)::NUMERIC * 0.35)::INT);
  v_cost_alloys := FLOOR(COALESCE(v_spec.cost_alloys, 0)::NUMERIC * 0.35)::INT;

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id FOR UPDATE;
  IF v_corp.treasury_ec < v_cost_ec OR v_corp.treasury_alloys < v_cost_alloys THEN
    RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY';
  END IF;

  UPDATE public.corporations
  SET treasury_ec = treasury_ec - v_cost_ec, treasury_alloys = treasury_alloys - v_cost_alloys, updated_at = timezone('utc'::text, now())
  WHERE id = p_corp_id;

  IF p_target_kind = 'building' THEN
    UPDATE public.buildings
    SET hp = max_hp, infra_state = 'OPERATIONAL', is_disabled = false, is_production_halted = false, ruined_at = NULL, updated_at = timezone('utc'::text, now())
    WHERE id = p_target_id;
  ELSE
    UPDATE public.infra_edges
    SET hp = max_hp, status = 'operational', ruined_at = NULL
    WHERE id = p_target_id;
  END IF;

  v_res := jsonb_build_object('repaired', true, 'cost_ec', v_cost_ec, 'cost_alloys', v_cost_alloys);
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'repair_infrastructure', v_res);
  END IF;
  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. RPCS DE PROGRAMACIÓN ESTRATÉGICA DE DRONES & BITÁCORA
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_unit_command(
  p_corp_id UUID,
  p_unit_id UUID DEFAULT NULL,
  p_hangar_slot_id UUID DEFAULT NULL,
  p_command_type TEXT DEFAULT 'move',
  p_waypoints JSONB DEFAULT '[]'::jsonb,
  p_target_building_id UUID DEFAULT NULL,
  p_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_repeat_interval_sec INT DEFAULT NULL,
  p_replace_active BOOLEAN DEFAULT true,
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
  v_unit public.operational_units%ROWTYPE;
  v_sched public.unit_command_schedules%ROWTYPE;
  v_when TIMESTAMPTZ := COALESCE(p_scheduled_at, timezone('utc'::text, now()));
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_control_units');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  IF p_command_type <> 'scheduled_deploy' THEN
    SELECT * INTO v_unit FROM public.operational_units WHERE id = p_unit_id FOR UPDATE;
    IF NOT FOUND OR v_unit.corp_id <> p_corp_id OR v_unit.status <> 'active' THEN
      RAISE EXCEPTION 'UNIT_NOT_CONTROLLABLE';
    END IF;
    IF p_replace_active THEN
      UPDATE public.unit_command_schedules
      SET status = 'cancelled', updated_at = timezone('utc'::text, now())
      WHERE unit_id = p_unit_id AND status IN ('pending', 'active');
    END IF;
  END IF;

  INSERT INTO public.unit_command_schedules (
    unit_id, hangar_slot_id, corp_id, created_by, command_type, waypoints, target_building_id, scheduled_at, next_tick_at, repeat_interval_sec
  ) VALUES (
    p_unit_id, p_hangar_slot_id, p_corp_id, v_user_id, p_command_type, COALESCE(p_waypoints, '[]'::jsonb), p_target_building_id, v_when, v_when, p_repeat_interval_sec
  )
  RETURNING * INTO v_sched;

  INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index, metadata)
  VALUES (
    p_unit_id,
    v_sched.id,
    p_corp_id,
    'order_scheduled',
    'Orden programada: ' || p_command_type,
    v_unit.h3_index,
    jsonb_build_object('scheduled_at', v_when, 'waypoints_count', jsonb_array_length(COALESCE(p_waypoints, '[]'::jsonb)))
  );

  v_res := jsonb_build_object('schedule', to_jsonb(v_sched));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'schedule_unit_command', v_res);
  END IF;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_unit_command(
  p_schedule_id UUID,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_sched public.unit_command_schedules%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO v_sched FROM public.unit_command_schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_NOT_FOUND'; END IF;

  PERFORM public.assert_corp_permission(v_user_id, v_sched.corp_id, 'can_control_units');

  UPDATE public.unit_command_schedules
  SET status = 'cancelled', updated_at = timezone('utc'::text, now())
  WHERE id = p_schedule_id;

  INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary)
  VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_cancelled', 'Orden cancelada por comandante.');

  RETURN jsonb_build_object('cancelled', true, 'schedule_id', p_schedule_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_due_unit_schedules(p_batch_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sched RECORD;
  v_wp JSONB;
  v_next_h3 BIGINT;
  v_processed INT := 0;
BEGIN
  FOR v_sched IN
    SELECT *
    FROM public.unit_command_schedules
    WHERE status IN ('pending', 'active')
      AND next_tick_at <= timezone('utc'::text, now())
    ORDER BY next_tick_at ASC
    LIMIT GREATEST(1, LEAST(100, COALESCE(p_batch_limit, 50)))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;

    IF v_sched.status = 'pending' THEN
      UPDATE public.unit_command_schedules SET status = 'active', updated_at = timezone('utc'::text, now()) WHERE id = v_sched.id;
      INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary)
      VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_started', 'Ejecución iniciada: ' || v_sched.command_type);
    END IF;

    IF jsonb_array_length(v_sched.waypoints) > 0 AND v_sched.unit_id IS NOT NULL THEN
      v_wp := v_sched.waypoints -> v_sched.waypoint_cursor;
      v_next_h3 := (v_wp->>'h3')::BIGINT;

      IF v_next_h3 IS NOT NULL THEN
        UPDATE public.operational_units SET h3_index = v_next_h3, updated_at = timezone('utc'::text, now()) WHERE id = v_sched.unit_id;
        INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index)
        VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'waypoint_step', 'Paso ejecutado en ruta', v_next_h3);
      END IF;

      IF v_sched.waypoint_cursor + 1 < jsonb_array_length(v_sched.waypoints) THEN
        UPDATE public.unit_command_schedules
        SET waypoint_cursor = waypoint_cursor + 1, next_tick_at = timezone('utc'::text, now()) + interval '5 seconds', updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
      ELSIF v_sched.command_type = 'patrol' THEN
        UPDATE public.unit_command_schedules
        SET waypoint_cursor = 0, next_tick_at = timezone('utc'::text, now()) + interval '10 seconds', updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
      ELSIF v_sched.repeat_interval_sec IS NOT NULL THEN
        UPDATE public.unit_command_schedules
        SET waypoint_cursor = 0, status = 'pending', next_tick_at = timezone('utc'::text, now()) + make_interval(secs => v_sched.repeat_interval_sec), updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
      ELSE
        UPDATE public.unit_command_schedules
        SET status = 'completed', updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
        INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index)
        VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_completed', 'Orden completada', v_next_h3);
      END IF;
    ELSE
      UPDATE public.unit_command_schedules SET status = 'completed', updated_at = timezone('utc'::text, now()) WHERE id = v_sched.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed);
END;
$$;

REVOKE ALL ON FUNCTION public.collect_housing_citizens(UUID, UUID, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_housing_citizens(UUID, UUID, BOOLEAN, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.recruit_and_deploy_unit(UUID, UUID, TEXT, INT, BIGINT, NUMERIC, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recruit_and_deploy_unit(UUID, UUID, TEXT, INT, BIGINT, NUMERIC, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_pipeline_logistics(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_pipeline_logistics(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.repair_infrastructure(TEXT, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_infrastructure(TEXT, UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.schedule_unit_command(UUID, UUID, UUID, TEXT, JSONB, UUID, TIMESTAMPTZ, INT, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.schedule_unit_command(UUID, UUID, UUID, TEXT, JSONB, UUID, TIMESTAMPTZ, INT, BOOLEAN, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_unit_command(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_unit_command(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.process_due_unit_schedules(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_due_unit_schedules(INT) TO authenticated, service_role;
