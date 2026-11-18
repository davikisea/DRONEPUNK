-- ==============================================================================
-- MIGRATION: 20261118000004_mmo_dual_logistics_devastation_and_city_bases_seed.sql
-- OBJETIVO: Logística Dual (Tuberías + Recolectores + Almacén Finito),
--           Handshake 120s + Devastación RUINED/SEVERED con 35% tech_scrap,
--           Viviendas + Población, Programador de Drones Completo y
--           Semilla Idempotente de Bases Históricas de Ciudad.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONES DE ESQUEMA & REALTIME CDC
-- ------------------------------------------------------------------------------
ALTER TABLE public.corporations
  ADD COLUMN IF NOT EXISTS treasury_tech_scrap BIGINT NOT NULL DEFAULT 0 CHECK (treasury_tech_scrap >= 0),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'buildings') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.buildings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'infra_edges') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.infra_edges;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operational_units') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.operational_units;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vulnerability_windows') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.vulnerability_windows;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'unit_command_schedules') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.unit_command_schedules;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'unit_action_logs') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.unit_action_logs;
    END IF;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. PROYECCIÓN ANALÍTICA H3 RES 9 SAFE-INTEGER EN SQL (PARIDAD CON coordinates.ts)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lat_lng_to_h3_res9(
  p_lat NUMERIC,
  p_lng NUMERIC
)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clamped_lat DOUBLE PRECISION := GREATEST(-85.05112878::DOUBLE PRECISION, LEAST(85.05112878::DOUBLE PRECISION, p_lat::DOUBLE PRECISION));
  v_r DOUBLE PRECISION := 6378137.0;
  v_edge DOUBLE PRECISION := 174.0;
  v_xm DOUBLE PRECISION;
  v_ym DOUBLE PRECISION;
  v_qf DOUBLE PRECISION;
  v_rf DOUBLE PRECISION;
  v_sf DOUBLE PRECISION;
  v_q BIGINT;
  v_r_ax BIGINT;
  v_s BIGINT;
  v_q_diff DOUBLE PRECISION;
  v_r_diff DOUBLE PRECISION;
  v_s_diff DOUBLE PRECISION;
  v_pq BIGINT;
  v_pr BIGINT;
BEGIN
  v_xm := ((p_lng::DOUBLE PRECISION * pi()) / 180.0) * v_r;
  v_ym := ln(tan(pi() / 4.0 + (v_clamped_lat * pi()) / 360.0)) * v_r;
  v_qf := ((sqrt(3.0) / 3.0) * v_xm - (1.0 / 3.0) * v_ym) / v_edge;
  v_rf := ((2.0 / 3.0) * v_ym) / v_edge;
  v_sf := -v_qf - v_rf;

  v_q := round(v_qf)::BIGINT;
  v_r_ax := round(v_rf)::BIGINT;
  v_s := round(v_sf)::BIGINT;

  v_q_diff := abs(v_q::DOUBLE PRECISION - v_qf);
  v_r_diff := abs(v_r_ax::DOUBLE PRECISION - v_rf);
  v_s_diff := abs(v_s::DOUBLE PRECISION - v_sf);

  IF v_q_diff > v_r_diff AND v_q_diff > v_s_diff THEN
    v_q := -v_r_ax - v_s;
  ELSIF v_r_diff > v_s_diff THEN
    v_r_ax := -v_q - v_s;
  END IF;

  v_pq := (v_q + 8388608::BIGINT) & 16777215::BIGINT;
  v_pr := (v_r_ax + 8388608::BIGINT) & 16777215::BIGINT;

  -- Prefijo seguro IEEE-754: 0x0009000000000000 = (9 << 48)
  RETURN (9::BIGINT << 48) | (v_pq << 24) | v_pr;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. CATÁLOGO EXTENDIDO DE UNIDADES (COMPATIBLE CON BASEPRODUCTIONMODAL)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unit_catalog_spec(
  p_unit_code TEXT,
  p_tier INT
)
RETURNS TABLE(
  cost_ec BIGINT,
  cost_alloys BIGINT,
  cost_rare_earth BIGINT,
  cost_composites BIGINT
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tier INT := COALESCE(p_tier, 1);
  v_tier_mult NUMERIC;
  v_base_ec BIGINT;
  v_base_alloys BIGINT;
  v_base_rare BIGINT := 0;
  v_base_comp BIGINT := 0;
BEGIN
  IF v_tier < 1 OR v_tier > 5 THEN
    RAISE EXCEPTION 'INVALID_TIER: El Tier debe estar entre 1 y 5.';
  END IF;

  v_tier_mult := 1.0 + ((v_tier - 1) * 0.45);

  CASE lower(p_unit_code)
    WHEN 'infantry'   THEN v_base_ec := 100; v_base_alloys := 5;
    WHEN 'mech'       THEN v_base_ec := 250; v_base_alloys := 12;
    WHEN 'recon'      THEN v_base_ec := 300; v_base_alloys := 15;
    WHEN 'apc'        THEN v_base_ec := 400; v_base_alloys := 20;
    WHEN 'tank'       THEN v_base_ec := 650; v_base_alloys := 35;  v_base_rare := 5;
    WHEN 'tank_light' THEN v_base_ec := 650; v_base_alloys := 35;  v_base_rare := 5;
    WHEN 'md_tank'    THEN v_base_ec := 1100; v_base_alloys := 60; v_base_rare := 15; v_base_comp := 10;
    WHEN 'neotank'    THEN v_base_ec := 1600; v_base_alloys := 85; v_base_rare := 30; v_base_comp := 25;
    WHEN 'artillery'  THEN v_base_ec := 550; v_base_alloys := 30;  v_base_rare := 5;
    WHEN 'rockets'    THEN v_base_ec := 1050; v_base_alloys := 55; v_base_rare := 20; v_base_comp := 10;
    WHEN 'rocket'     THEN v_base_ec := 1050; v_base_alloys := 55; v_base_rare := 20; v_base_comp := 10;
    WHEN 'anti_air'   THEN v_base_ec := 600; v_base_alloys := 30;  v_base_rare := 8;
    WHEN 'antiair'    THEN v_base_ec := 600; v_base_alloys := 30;  v_base_rare := 8;
    WHEN 'missiles'   THEN v_base_ec := 950; v_base_alloys := 50;  v_base_rare := 15; v_base_comp := 8;
    WHEN 't_copter'   THEN v_base_ec := 500; v_base_alloys := 25;  v_base_rare := 5;
    WHEN 'b_copter'   THEN v_base_ec := 800; v_base_alloys := 45;  v_base_rare := 15; v_base_comp := 10;
    WHEN 'fighter'    THEN v_base_ec := 1500; v_base_alloys := 75; v_base_rare := 30; v_base_comp := 25;
    WHEN 'bomber'     THEN v_base_ec := 1800; v_base_alloys := 90; v_base_rare := 35; v_base_comp := 30;
    WHEN 'lander'     THEN v_base_ec := 700; v_base_alloys := 35;  v_base_rare := 8;
    WHEN 'cruiser'    THEN v_base_ec := 1100; v_base_alloys := 60; v_base_rare := 18; v_base_comp := 12;
    WHEN 'sub'        THEN v_base_ec := 1200; v_base_alloys := 65; v_base_rare := 20; v_base_comp := 14;
    WHEN 'battleship' THEN v_base_ec := 2000; v_base_alloys := 100; v_base_rare := 40; v_base_comp := 35;
    ELSE
      RAISE EXCEPTION 'INVALID_UNIT_CODE: Chasis no reconocido (%).', p_unit_code;
  END CASE;

  RETURN QUERY SELECT
    ROUND(v_base_ec * v_tier_mult)::BIGINT,
    ROUND(v_base_alloys * v_tier_mult)::BIGINT,
    ROUND((v_base_rare + CASE WHEN v_tier >= 3 THEN (v_tier - 2) * 8 ELSE 0 END) * v_tier_mult)::BIGINT,
    ROUND((v_base_comp + CASE WHEN v_tier >= 4 THEN (v_tier - 3) * 10 ELSE 0 END) * v_tier_mult)::BIGINT;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. CONSTRUCT_BUILDING & CLAIM_OR_CAPTURE_BUILDING (POBLACIÓN + RUINED + BASES HISTÓRICAS)
-- ------------------------------------------------------------------------------
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
  v_corp public.corporations%ROWTYPE;
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

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORP_NOT_FOUND'; END IF;

  IF p_use_personal_topup THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;

    v_corp_ec_spend := LEAST(v_corp.treasury_ec, v_spec.cost_ec);
    v_personal_ec_spend := v_spec.cost_ec - v_corp_ec_spend;
    IF COALESCE(v_profile.battle_credits, 0) < v_personal_ec_spend THEN
      RAISE EXCEPTION 'INSUFFICIENT_EC: Créditos insuficientes incluso con aporte personal.';
    END IF;

    v_corp_alloy_spend := LEAST(v_corp.treasury_alloys, v_spec.cost_alloys);
    v_personal_alloy_spend := v_spec.cost_alloys - v_corp_alloy_spend;
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
  ELSE
    IF v_corp.treasury_ec < v_spec.cost_ec OR v_corp.treasury_alloys < v_spec.cost_alloys THEN
      RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY: Tesorería corporativa insuficiente.';
    END IF;
    v_corp_ec_spend := v_spec.cost_ec;
    v_corp_alloy_spend := v_spec.cost_alloys;
  END IF;

  INSERT INTO public.territories (id, name, level)
  VALUES (p_municipality_id, p_municipality_id, 'MUNICIPALITY')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.corporations
  SET treasury_ec = treasury_ec - v_corp_ec_spend,
      treasury_alloys = treasury_alloys - v_corp_alloy_spend,
      population_cap = population_cap + CASE WHEN p_building_type = 'housing' THEN 10 ELSE 0 END,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_corp_id;

  INSERT INTO public.buildings (
    h3_index, municipality_id, owner_user_id, corp_id, building_type, level, hp, max_hp,
    infra_state, is_production_halted, storage_cap, last_collected_at
  ) VALUES (
    p_h3_index, p_municipality_id, v_user_id, p_corp_id, p_building_type, 1, v_spec.max_hp, v_spec.max_hp,
    'OPERATIONAL', false, 250, timezone('utc'::text, now())
  )
  RETURNING * INTO v_building;

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

CREATE OR REPLACE FUNCTION public.claim_or_capture_building(
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
  v_bld public.buildings%ROWTYPE;
  v_spec RECORD;
  v_res JSONB;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_construct');

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUILDING_NOT_FOUND'; END IF;

  IF v_bld.corp_id = p_corp_id THEN
    RAISE EXCEPTION 'ALREADY_OWNED_BY_CORP';
  END IF;

  IF v_bld.corp_id IS NOT NULL AND v_bld.hp > 0 AND v_bld.infra_state <> 'RUINED' THEN
    RAISE EXCEPTION 'BUILDING_STILL_DEFENDED: El edificio rival aún tiene HP > 0.';
  END IF;

  SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);

  UPDATE public.buildings
  SET corp_id = p_corp_id,
      owner_user_id = v_user_id,
      hp = GREATEST(10.0, v_spec.max_hp * 0.5),
      max_hp = v_spec.max_hp,
      infra_state = 'OPERATIONAL',
      is_disabled = false,
      is_production_halted = false,
      ruined_at = NULL,
      stored_resources = '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
      last_collected_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_building_id
  RETURNING * INTO v_bld;

  v_res := jsonb_build_object('building', to_jsonb(v_bld));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'claim_or_capture_building', v_res);
  END IF;

  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. INFRA_EDGES: TRAZADO DE TUBERÍAS, CARRETERAS Y PUENTES ENTRE HEXÁGONOS
-- ------------------------------------------------------------------------------
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
  v_corp public.corporations%ROWTYPE;
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
  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORP_NOT_FOUND'; END IF;

  IF p_use_personal_topup THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;

    v_corp_ec_spend := LEAST(v_corp.treasury_ec, v_spec.cost_ec);
    v_personal_ec_spend := v_spec.cost_ec - v_corp_ec_spend;
    IF COALESCE(v_profile.battle_credits, 0) < v_personal_ec_spend THEN
      RAISE EXCEPTION 'INSUFFICIENT_EC';
    END IF;

    v_corp_alloy_spend := LEAST(v_corp.treasury_alloys, v_spec.cost_alloys);
    v_personal_alloy_spend := v_spec.cost_alloys - v_corp_alloy_spend;
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
  ELSE
    IF v_corp.treasury_ec < v_spec.cost_ec OR v_corp.treasury_alloys < v_spec.cost_alloys THEN
      RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY';
    END IF;
    v_corp_ec_spend := v_spec.cost_ec;
    v_corp_alloy_spend := v_spec.cost_alloys;
  END IF;

  UPDATE public.corporations
  SET treasury_ec = treasury_ec - v_corp_ec_spend,
      treasury_alloys = treasury_alloys - v_corp_alloy_spend,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_corp_id;

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

  v_res := jsonb_build_object('edge', to_jsonb(v_edge));
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'create_infra_edge', v_res);
  END IF;
  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. LOGÍSTICA DUAL: TUBERÍAS CONTINUAS VS ALMACÉN FINITO + UNIDADES RECOLECTORAS
-- ------------------------------------------------------------------------------
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
  v_halted_count INT := 0;
  v_cur_alloys INT;
  v_cur_fuel INT;
  v_cur_chips INT;
  v_add_alloys INT;
  v_add_fuel INT;
  v_add_chips INT;
  v_cur_sum INT;
  v_cap INT;
  v_room INT;
  v_new_halted BOOLEAN;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_collect');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  -- Flujo 1: Extractores conectados vía grafo de tuberías operacionales a algún Depot/HQ operacional
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
    SET stored_resources = '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
        is_production_halted = false,
        last_collected_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = v_rec.id;
  END LOOP;

  -- Flujo 2: Extractores SIN salida por tubería -> acumulan hasta storage_cap y se detienen
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
    WHERE b.corp_id = p_corp_id
      AND b.building_type = 'extractor'
      AND b.infra_state = 'OPERATIONAL'
      AND NOT b.is_disabled
      AND NOT EXISTS (SELECT 1 FROM pipe_reach pr WHERE pr.h3_index = b.h3_index)
    FOR UPDATE OF b
  LOOP
    v_cur_alloys := COALESCE((v_rec.stored_resources->>'alloys')::INT, 0);
    v_cur_fuel := COALESCE((v_rec.stored_resources->>'fuel')::INT, 0);
    v_cur_chips := COALESCE((v_rec.stored_resources->>'chips')::INT, 0);
    v_cur_sum := v_cur_alloys + v_cur_fuel + v_cur_chips;
    v_cap := GREATEST(1, COALESCE(v_rec.storage_cap, 250)::INT);
    v_room := GREATEST(0, v_cap - v_cur_sum);

    IF NOT v_rec.is_production_halted AND v_room > 0 THEN
      SELECT * INTO v_spec FROM public.get_building_catalog_spec('extractor', v_rec.level);
      v_elapsed := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (timezone('utc'::text, now()) - v_rec.last_collected_at)) / 3600.0));
      v_add_alloys := LEAST(v_room, FLOOR(COALESCE(v_spec.alloys_per_hour, 0) * v_elapsed)::INT);
      v_room := GREATEST(0, v_room - v_add_alloys);
      v_add_fuel := LEAST(v_room, FLOOR(COALESCE(v_spec.fuel_per_hour, 0) * v_elapsed)::INT);
      v_room := GREATEST(0, v_room - v_add_fuel);
      v_add_chips := LEAST(v_room, FLOOR(COALESCE(v_spec.chips_per_hour, 0) * v_elapsed)::INT);

      v_cur_alloys := v_cur_alloys + v_add_alloys;
      v_cur_fuel := v_cur_fuel + v_add_fuel;
      v_cur_chips := v_cur_chips + v_add_chips;
    END IF;

    v_new_halted := (v_cur_alloys + v_cur_fuel + v_cur_chips) >= v_cap;
    IF v_new_halted THEN
      v_halted_count := v_halted_count + 1;
    END IF;

    UPDATE public.buildings
    SET stored_resources = jsonb_build_object('alloys', v_cur_alloys, 'fuel', v_cur_fuel, 'chips', v_cur_chips),
        is_production_halted = v_new_halted,
        last_collected_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = v_rec.id;
  END LOOP;

  IF (v_total_alloys + v_total_fuel + v_total_chips) > 0 THEN
    UPDATE public.corporations
    SET treasury_alloys = treasury_alloys + v_total_alloys,
        treasury_fuel = treasury_fuel + v_total_fuel,
        treasury_chips = treasury_chips + v_total_chips,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_corp_id;
  END IF;

  v_res := jsonb_build_object(
    'alloys', v_total_alloys,
    'fuel', v_total_fuel,
    'chips', v_total_chips,
    'halted_extractors', v_halted_count
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'sync_pipeline_logistics', v_res);
  END IF;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_collector_haul(
  p_unit_id UUID,
  p_extractor_building_id UUID DEFAULT NULL,
  p_depot_building_id UUID DEFAULT NULL,
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
  v_ext public.buildings%ROWTYPE;
  v_depot public.buildings%ROWTYPE;
  v_spec RECORD;
  v_elapsed NUMERIC;
  v_cur_alloys INT;
  v_cur_fuel INT;
  v_cur_chips INT;
  v_cap INT;
  v_room INT;
  v_add_alloys INT;
  v_add_fuel INT;
  v_add_chips INT;
  v_haul_cap INT;
  v_take_alloys INT;
  v_take_fuel INT;
  v_take_chips INT;
  v_rem_alloys INT;
  v_rem_fuel INT;
  v_rem_chips INT;
  v_halted_after BOOLEAN;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  SELECT * INTO v_unit FROM public.operational_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR v_unit.status <> 'active' THEN
    RAISE EXCEPTION 'OPERATIONAL_UNIT_NOT_FOUND';
  END IF;
  IF v_unit.unit_role <> 'collector' THEN
    RAISE EXCEPTION 'INVALID_UNIT_ROLE: Solo unidades con rol collector pueden acarrear logística.';
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, v_unit.corp_id, 'can_collect');

  IF COALESCE(p_extractor_building_id, v_unit.source_building_id) IS NOT NULL THEN
    SELECT * INTO v_ext FROM public.buildings
    WHERE id = COALESCE(p_extractor_building_id, v_unit.source_building_id)
    FOR UPDATE;
  ELSE
    SELECT * INTO v_ext FROM public.buildings
    WHERE corp_id = v_unit.corp_id
      AND building_type = 'extractor'
      AND infra_state <> 'RUINED'
      AND NOT is_disabled
    ORDER BY is_production_halted DESC, last_collected_at ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND OR v_ext.corp_id <> v_unit.corp_id OR v_ext.building_type <> 'extractor' THEN
    RAISE EXCEPTION 'INVALID_EXTRACTOR_BUILDING';
  END IF;
  IF v_ext.infra_state = 'RUINED' OR v_ext.is_disabled THEN
    RAISE EXCEPTION 'EXTRACTOR_RUINED';
  END IF;

  IF COALESCE(p_depot_building_id, v_unit.depot_building_id) IS NOT NULL THEN
    SELECT * INTO v_depot FROM public.buildings
    WHERE id = COALESCE(p_depot_building_id, v_unit.depot_building_id)
    FOR UPDATE;
  ELSE
    SELECT * INTO v_depot FROM public.buildings
    WHERE corp_id = v_unit.corp_id
      AND building_type IN ('depot', 'hq')
      AND infra_state = 'OPERATIONAL'
      AND NOT is_disabled
    ORDER BY CASE WHEN building_type = 'depot' THEN 0 ELSE 1 END, created_at ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND OR v_depot.corp_id <> v_unit.corp_id OR v_depot.building_type NOT IN ('depot', 'hq') THEN
    RAISE EXCEPTION 'INVALID_DEPOT_BUILDING';
  END IF;
  IF v_depot.infra_state = 'RUINED' OR v_depot.is_disabled THEN
    RAISE EXCEPTION 'DEPOT_RUINED';
  END IF;

  v_cur_alloys := COALESCE((v_ext.stored_resources->>'alloys')::INT, 0);
  v_cur_fuel := COALESCE((v_ext.stored_resources->>'fuel')::INT, 0);
  v_cur_chips := COALESCE((v_ext.stored_resources->>'chips')::INT, 0);
  v_cap := GREATEST(1, COALESCE(v_ext.storage_cap, 250)::INT);
  v_room := GREATEST(0, v_cap - (v_cur_alloys + v_cur_fuel + v_cur_chips));

  IF NOT v_ext.is_production_halted AND v_room > 0 THEN
    SELECT * INTO v_spec FROM public.get_building_catalog_spec('extractor', v_ext.level);
    v_elapsed := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (timezone('utc'::text, now()) - v_ext.last_collected_at)) / 3600.0));
    v_add_alloys := LEAST(v_room, FLOOR(COALESCE(v_spec.alloys_per_hour, 0) * v_elapsed)::INT);
    v_room := GREATEST(0, v_room - v_add_alloys);
    v_add_fuel := LEAST(v_room, FLOOR(COALESCE(v_spec.fuel_per_hour, 0) * v_elapsed)::INT);
    v_room := GREATEST(0, v_room - v_add_fuel);
    v_add_chips := LEAST(v_room, FLOOR(COALESCE(v_spec.chips_per_hour, 0) * v_elapsed)::INT);

    v_cur_alloys := v_cur_alloys + v_add_alloys;
    v_cur_fuel := v_cur_fuel + v_add_fuel;
    v_cur_chips := v_cur_chips + v_add_chips;
  END IF;

  v_haul_cap := GREATEST(50, COALESCE(NULLIF(v_unit.cargo_cap, 0), 150)::INT);
  v_take_alloys := LEAST(v_cur_alloys, v_haul_cap);
  v_haul_cap := GREATEST(0, v_haul_cap - v_take_alloys);
  v_take_fuel := LEAST(v_cur_fuel, v_haul_cap);
  v_haul_cap := GREATEST(0, v_haul_cap - v_take_fuel);
  v_take_chips := LEAST(v_cur_chips, v_haul_cap);

  v_rem_alloys := GREATEST(0, v_cur_alloys - v_take_alloys);
  v_rem_fuel := GREATEST(0, v_cur_fuel - v_take_fuel);
  v_rem_chips := GREATEST(0, v_cur_chips - v_take_chips);
  v_halted_after := (v_rem_alloys + v_rem_fuel + v_rem_chips) >= v_cap;

  UPDATE public.buildings
  SET stored_resources = jsonb_build_object('alloys', v_rem_alloys, 'fuel', v_rem_fuel, 'chips', v_rem_chips),
      is_production_halted = v_halted_after,
      last_collected_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = v_ext.id;

  IF (v_take_alloys + v_take_fuel + v_take_chips) > 0 THEN
    UPDATE public.corporations
    SET treasury_alloys = treasury_alloys + v_take_alloys,
        treasury_fuel = treasury_fuel + v_take_fuel,
        treasury_chips = treasury_chips + v_take_chips,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_unit.corp_id;
  END IF;

  UPDATE public.operational_units
  SET h3_index = v_depot.h3_index,
      source_building_id = v_ext.id,
      depot_building_id = v_depot.id,
      cargo = '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
      next_haul_at = timezone('utc'::text, now()) + interval '15 seconds',
      updated_at = timezone('utc'::text, now())
  WHERE id = v_unit.id;

  INSERT INTO public.unit_action_logs (unit_id, corp_id, action_type, summary, h3_index, metadata)
  VALUES (
    v_unit.id,
    v_unit.corp_id,
    'collected',
    'Acarreo logístico completado: +' || v_take_alloys || ' Alloys, +' || v_take_fuel || ' Fuel, +' || v_take_chips || ' Chips',
    v_depot.h3_index,
    jsonb_build_object(
      'extractor_id', v_ext.id,
      'depot_id', v_depot.id,
      'hauled', jsonb_build_object('alloys', v_take_alloys, 'fuel', v_take_fuel, 'chips', v_take_chips),
      'extractor_halted_after', v_halted_after
    )
  );

  v_res := jsonb_build_object(
    'unit_id', v_unit.id,
    'extractor_id', v_ext.id,
    'depot_id', v_depot.id,
    'hauled', jsonb_build_object('alloys', v_take_alloys, 'fuel', v_take_fuel, 'chips', v_take_chips),
    'extractor_halted_after', v_halted_after
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'execute_collector_haul', v_res);
  END IF;
  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. HANDSHAKE 120s & DEVASTACIÓN DE INFRAESTRUCTURA (35% TECH_SCRAP, 0 BORRADOS)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_vulnerability_handshake(
  p_municipality_id VARCHAR,
  p_attacker_corp_id UUID,
  p_defender_corp_id UUID DEFAULT NULL,
  p_window_duration_sec INT DEFAULT 1800,
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
  v_win public.vulnerability_windows%ROWTYPE;
  v_duration INT := GREATEST(300, LEAST(14400, COALESCE(p_window_duration_sec, 1800)));
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_attacker_corp_id, 'can_control_units');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  INSERT INTO public.territories (id, name, level)
  VALUES (p_municipality_id, p_municipality_id, 'MUNICIPALITY')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.vulnerability_windows (
    municipality_id, attacker_corp_id, defender_corp_id,
    handshake_started_at, active_from, expires_at, status
  ) VALUES (
    p_municipality_id, p_attacker_corp_id, p_defender_corp_id,
    v_now, v_now + interval '120 seconds', v_now + interval '120 seconds' + make_interval(secs => v_duration), 'handshake'
  )
  RETURNING * INTO v_win;

  v_res := jsonb_build_object(
    'window', to_jsonb(v_win),
    'handshake_seconds', 120
  );
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'trigger_vulnerability_handshake', v_res);
  END IF;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.damage_infrastructure(
  p_target_kind TEXT,
  p_target_id UUID,
  p_attacker_corp_id UUID,
  p_damage NUMERIC DEFAULT 10.0,
  p_bypass_handshake_in_simulation BOOLEAN DEFAULT false,
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
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_bld public.buildings%ROWTYPE;
  v_edge public.infra_edges%ROWTYPE;
  v_spec RECORD;
  v_new_hp NUMERIC;
  v_new_state TEXT;
  v_scrap_ec BIGINT := 0;
  v_scrap_alloys BIGINT := 0;
  v_has_window BOOLEAN := false;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF COALESCE(p_damage, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_DAMAGE'; END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_attacker_corp_id, 'can_control_units');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  -- Activar ventanas cuyo Handshake de 120s ya venció
  UPDATE public.vulnerability_windows
  SET status = 'active'
  WHERE status = 'handshake'
    AND active_from <= v_now
    AND expires_at > v_now;

  IF p_target_kind = 'building' THEN
    SELECT * INTO v_bld FROM public.buildings WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BUILDING_NOT_FOUND'; END IF;
    IF v_bld.corp_id = p_attacker_corp_id THEN
      RAISE EXCEPTION 'FRIENDLY_FIRE_PROHIBITED';
    END IF;

    IF v_bld.corp_id IS NOT NULL AND NOT p_bypass_handshake_in_simulation THEN
      SELECT EXISTS (
        SELECT 1 FROM public.vulnerability_windows vw
        WHERE vw.municipality_id = v_bld.municipality_id
          AND vw.attacker_corp_id = p_attacker_corp_id
          AND vw.status = 'active'
          AND vw.active_from <= v_now
          AND vw.expires_at > v_now
      ) INTO v_has_window;

      IF NOT v_has_window THEN
        RAISE EXCEPTION 'VULNERABILITY_HANDSHAKE_REQUIRED: Inicia el Handshake de 120s antes de devastar infraestructura enemiga.';
      END IF;
    END IF;

    SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);
    v_new_hp := GREATEST(0, v_bld.hp - p_damage);
    v_new_state := CASE
      WHEN v_new_hp <= 0 THEN 'RUINED'
      WHEN v_new_hp < COALESCE(v_bld.max_hp, v_spec.max_hp) THEN 'DAMAGED'
      ELSE 'OPERATIONAL'
    END;

    IF v_new_state = 'RUINED' AND v_bld.infra_state <> 'RUINED' THEN
      v_scrap_ec := FLOOR(COALESCE(v_spec.cost_ec, 100)::NUMERIC * 0.35)::BIGINT;
      v_scrap_alloys := FLOOR(COALESCE(v_spec.cost_alloys, 0)::NUMERIC * 0.35)::BIGINT;
      UPDATE public.corporations
      SET treasury_tech_scrap = treasury_tech_scrap + v_scrap_ec,
          treasury_alloys = treasury_alloys + v_scrap_alloys,
          updated_at = v_now
      WHERE id = p_attacker_corp_id;
    END IF;

    UPDATE public.buildings
    SET hp = v_new_hp,
        infra_state = v_new_state,
        is_disabled = (v_new_state = 'RUINED'),
        is_production_halted = CASE WHEN v_new_state = 'RUINED' THEN true ELSE is_production_halted END,
        ruined_at = CASE WHEN v_new_state = 'RUINED' THEN COALESCE(ruined_at, v_now) ELSE ruined_at END,
        updated_at = v_now
    WHERE id = p_target_id
    RETURNING * INTO v_bld;

    INSERT INTO public.unit_action_logs (corp_id, action_type, summary, h3_index, metadata)
    VALUES (
      p_attacker_corp_id,
      'skirmish',
      'Ataque a infraestructura (' || v_bld.building_type || ') -> ' || v_new_state,
      v_bld.h3_index,
      jsonb_build_object('building_id', v_bld.id, 'hp_after', v_new_hp, 'loot_tech_scrap', v_scrap_ec, 'loot_alloys', v_scrap_alloys)
    );

    v_res := jsonb_build_object(
      'target_kind', 'building',
      'target', to_jsonb(v_bld),
      'infra_state', v_new_state,
      'loot_tech_scrap', v_scrap_ec,
      'loot_alloys', v_scrap_alloys
    );

  ELSIF p_target_kind = 'edge' THEN
    SELECT * INTO v_edge FROM public.infra_edges WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EDGE_NOT_FOUND'; END IF;
    IF v_edge.corp_id = p_attacker_corp_id THEN
      RAISE EXCEPTION 'FRIENDLY_FIRE_PROHIBITED';
    END IF;

    IF v_edge.corp_id IS NOT NULL AND NOT p_bypass_handshake_in_simulation THEN
      SELECT EXISTS (
        SELECT 1 FROM public.vulnerability_windows vw
        WHERE vw.attacker_corp_id = p_attacker_corp_id
          AND vw.status = 'active'
          AND vw.active_from <= v_now
          AND vw.expires_at > v_now
      ) INTO v_has_window;

      IF NOT v_has_window THEN
        RAISE EXCEPTION 'VULNERABILITY_HANDSHAKE_REQUIRED: Inicia el Handshake de 120s antes de sabotear rutas.';
      END IF;
    END IF;

    SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_edge.edge_type, 1);
    v_new_hp := GREATEST(0, v_edge.hp - p_damage);
    v_new_state := CASE WHEN v_new_hp <= 0 THEN 'severed' ELSE 'operational' END;

    IF v_new_state = 'severed' AND v_edge.status <> 'severed' THEN
      v_scrap_ec := FLOOR(COALESCE(v_spec.cost_ec, 60)::NUMERIC * 0.35)::BIGINT;
      v_scrap_alloys := FLOOR(COALESCE(v_spec.cost_alloys, 0)::NUMERIC * 0.35)::BIGINT;
      UPDATE public.corporations
      SET treasury_tech_scrap = treasury_tech_scrap + v_scrap_ec,
          treasury_alloys = treasury_alloys + v_scrap_alloys,
          updated_at = v_now
      WHERE id = p_attacker_corp_id;
    END IF;

    UPDATE public.infra_edges
    SET hp = v_new_hp,
        status = v_new_state,
        ruined_at = CASE WHEN v_new_state = 'severed' THEN COALESCE(ruined_at, v_now) ELSE ruined_at END
    WHERE id = p_target_id
    RETURNING * INTO v_edge;

    INSERT INTO public.unit_action_logs (corp_id, action_type, summary, h3_index, metadata)
    VALUES (
      p_attacker_corp_id,
      'skirmish',
      'Sabotaje a ' || v_edge.edge_type || ' -> ' || upper(v_new_state),
      v_edge.to_h3,
      jsonb_build_object('edge_id', v_edge.id, 'hp_after', v_new_hp, 'loot_tech_scrap', v_scrap_ec, 'loot_alloys', v_scrap_alloys)
    );

    v_res := jsonb_build_object(
      'target_kind', 'edge',
      'target', to_jsonb(v_edge),
      'status', v_new_state,
      'loot_tech_scrap', v_scrap_ec,
      'loot_alloys', v_scrap_alloys
    );
  ELSE
    RAISE EXCEPTION 'INVALID_TARGET_KIND';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'damage_infrastructure', v_res);
  END IF;
  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. PROCESS_DUE_UNIT_SCHEDULES (PATRULLA, AUTO_COLLECT, SKIRMISH, SCHEDULED_DEPLOY)
-- ------------------------------------------------------------------------------
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
  v_slot public.user_unit_hangar%ROWTYPE;
  v_deployed public.operational_units%ROWTYPE;
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
      UPDATE public.unit_command_schedules
      SET status = 'active', updated_at = timezone('utc'::text, now())
      WHERE id = v_sched.id;

      INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary)
      VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_started', 'Ejecución iniciada: ' || v_sched.command_type);
    END IF;

    IF v_sched.command_type = 'scheduled_deploy' AND v_sched.hangar_slot_id IS NOT NULL THEN
      SELECT * INTO v_slot FROM public.user_unit_hangar WHERE id = v_sched.hangar_slot_id FOR UPDATE;
      IF FOUND AND v_slot.quantity >= 1 THEN
        v_next_h3 := COALESCE((v_sched.waypoints -> 0 ->> 'h3')::BIGINT, public.lat_lng_to_h3_res9(10.3994, -71.4539));
        IF v_slot.quantity = 1 THEN
          DELETE FROM public.user_unit_hangar WHERE id = v_slot.id;
        ELSE
          UPDATE public.user_unit_hangar SET quantity = quantity - 1 WHERE id = v_slot.id;
        END IF;

        INSERT INTO public.operational_units (
          owner_user_id, corp_id, unit_code, tier, hp, h3_index, status, unit_role
        ) VALUES (
          v_sched.created_by, v_sched.corp_id, v_slot.unit_code, v_slot.tier, v_slot.hp, v_next_h3, 'active',
          CASE WHEN v_slot.unit_code IN ('apc', 't_copter', 'lander') THEN 'collector' ELSE 'combat' END
        ) RETURNING * INTO v_deployed;

        UPDATE public.unit_command_schedules
        SET unit_id = v_deployed.id, status = 'completed', updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;

        INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index)
        VALUES (v_deployed.id, v_sched.id, v_sched.corp_id, 'deployed', 'Despliegue programado ejecutado: ' || v_deployed.unit_code, v_next_h3);
      ELSE
        UPDATE public.unit_command_schedules
        SET status = 'failed', failure_reason = 'HANGAR_SLOT_EMPTY', updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
      END IF;
      CONTINUE;
    END IF;

    IF jsonb_array_length(v_sched.waypoints) > 0 AND v_sched.unit_id IS NOT NULL THEN
      v_wp := v_sched.waypoints -> v_sched.waypoint_cursor;
      v_next_h3 := (v_wp->>'h3')::BIGINT;

      IF v_next_h3 IS NOT NULL THEN
        UPDATE public.operational_units
        SET h3_index = v_next_h3, updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.unit_id;

        INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index)
        VALUES (
          v_sched.unit_id,
          v_sched.id,
          v_sched.corp_id,
          CASE
            WHEN v_sched.command_type = 'auto_collect' THEN 'collected'
            WHEN v_sched.command_type = 'skirmish' THEN 'skirmish'
            ELSE 'waypoint_step'
          END,
          CASE
            WHEN v_sched.command_type = 'auto_collect' THEN 'Ciclo auto_collect ejecutado en ruta'
            WHEN v_sched.command_type = 'skirmish' THEN 'Escaramuza táctica ejecutada en objetivo'
            ELSE 'Paso ejecutado en ruta'
          END,
          v_next_h3
        );
      END IF;

      IF v_sched.waypoint_cursor + 1 < jsonb_array_length(v_sched.waypoints) THEN
        UPDATE public.unit_command_schedules
        SET waypoint_cursor = waypoint_cursor + 1,
            next_tick_at = timezone('utc'::text, now()) + interval '5 seconds',
            updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
      ELSIF v_sched.command_type IN ('patrol', 'auto_collect') THEN
        UPDATE public.unit_command_schedules
        SET waypoint_cursor = 0,
            next_tick_at = timezone('utc'::text, now()) + make_interval(secs => COALESCE(v_sched.repeat_interval_sec, 10)),
            updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
      ELSIF v_sched.repeat_interval_sec IS NOT NULL THEN
        UPDATE public.unit_command_schedules
        SET waypoint_cursor = 0,
            status = 'pending',
            next_tick_at = timezone('utc'::text, now()) + make_interval(secs => v_sched.repeat_interval_sec),
            updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
      ELSE
        UPDATE public.unit_command_schedules
        SET status = 'completed', updated_at = timezone('utc'::text, now())
        WHERE id = v_sched.id;
        INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index)
        VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_completed', 'Orden completada', v_next_h3);
      END IF;
    ELSE
      UPDATE public.unit_command_schedules
      SET status = 'completed', updated_at = timezone('utc'::text, now())
      WHERE id = v_sched.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed);
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. SEMILLA IDEMPOTENTE DE BASES HISTÓRICAS DE CIUDAD (theatre_cities.json)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_historical_city_bases()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INT := 0;
  v_row RECORD;
  v_h3 BIGINT;
BEGIN
  FOR v_row IN
    SELECT * FROM (VALUES
      ('MUN_DC_CARACAS', 'Caracas', 'hq', 10.4806::NUMERIC, -66.9036::NUMERIC, 'city'),
      ('MUN_DC_CARACAS', 'Caracas', 'factory', 10.4806::NUMERIC, -66.8996::NUMERIC, 'plains'),
      ('MUN_ZULIA_MARACAIBO', 'Maracaibo', 'hq', 10.6544::NUMERIC, -71.6406::NUMERIC, 'city'),
      ('MUN_ZULIA_MARACAIBO', 'Maracaibo', 'port', 10.6544::NUMERIC, -71.6366::NUMERIC, 'shoal'),
      ('MUN_ZULIA_SAN_FRANCISCO', 'San Francisco', 'factory', 10.5517::NUMERIC, -71.6344::NUMERIC, 'city'),
      ('MUN_ZULIA_CABIMAS', 'Cabimas', 'hq', 10.3994::NUMERIC, -71.4539::NUMERIC, 'city'),
      ('MUN_ZULIA_CABIMAS', 'Cabimas', 'factory', 10.3994::NUMERIC, -71.4499::NUMERIC, 'plains'),
      ('MUN_ZULIA_CABIMAS', 'Cabimas', 'port', 10.3950::NUMERIC, -71.4580::NUMERIC, 'shoal'),
      ('MUN_ZULIA_SANTA_RITA', 'Santa Rita', 'port', 10.5364::NUMERIC, -71.5117::NUMERIC, 'shoal'),
      ('MUN_ZULIA_MIRANDA', 'Los Puertos de Altagracia', 'port', 10.6744::NUMERIC, -71.5228::NUMERIC, 'shoal'),
      ('MUN_ZULIA_LAGUNILLAS', 'Ciudad Ojeda', 'factory', 10.2078::NUMERIC, -71.3087::NUMERIC, 'city'),
      ('MUN_ZULIA_VALMORE_RODRIGUEZ', 'Bachaquero', 'factory', 9.9694::NUMERIC, -71.1494::NUMERIC, 'plains'),
      ('MUN_ZULIA_BARALT', 'Mene Grande', 'factory', 9.8167::NUMERIC, -70.9253::NUMERIC, 'plains'),
      ('MUN_ZULIA_SIMON_BOLIVAR', 'Tía Juana', 'factory', 10.2583::NUMERIC, -71.3667::NUMERIC, 'plains'),
      ('MUN_ZULIA_MACHIQUES_DE_PERIJA', 'Machiques', 'hq', 10.0644::NUMERIC, -72.5450::NUMERIC, 'city'),
      ('MUN_ZULIA_COLON', 'San Carlos del Zulia', 'factory', 9.0000::NUMERIC, -71.9136::NUMERIC, 'city'),
      ('MUN_CARABOBO_VALENCIA', 'Valencia', 'hq', 10.1620::NUMERIC, -68.0077::NUMERIC, 'city'),
      ('MUN_CARABOBO_VALENCIA', 'Valencia', 'factory', 10.1620::NUMERIC, -68.0037::NUMERIC, 'plains'),
      ('MUN_LARA_IRIBARREN', 'Barquisimeto', 'factory', 10.0647::NUMERIC, -69.3228::NUMERIC, 'city'),
      ('MUN_ARAGUA_GIRARDOT', 'Maracay', 'airport', 10.2469::NUMERIC, -67.5958::NUMERIC, 'plains'),
      ('MUN_ANZOATEGUI_SOTILLO', 'Puerto La Cruz', 'port', 10.2189::NUMERIC, -64.6344::NUMERIC, 'shoal'),
      ('MUN_BOLIVAR_CARONI', 'Ciudad Guayana', 'factory', 8.3077::NUMERIC, -62.7118::NUMERIC, 'city'),
      ('MUN_TACHIRA_SAN_CRISTOBAL', 'San Cristóbal', 'hq', 7.7669::NUMERIC, -72.2250::NUMERIC, 'city'),
      ('MUN_MERIDA_LIBERTADOR', 'Mérida', 'airport', 8.5983::NUMERIC, -71.1450::NUMERIC, 'plains'),
      ('MUN_FALCON_MIRANDA', 'Coro', 'port', 11.4045::NUMERIC, -69.6734::NUMERIC, 'shoal'),
      ('MUN_MONAGAS_MATURIN', 'Maturín', 'factory', 9.7456::NUMERIC, -63.1767::NUMERIC, 'plains'),
      ('MUN_BARINAS_BARINAS', 'Barinas', 'factory', 8.6226::NUMERIC, -70.2075::NUMERIC, 'plains'),
      ('MUN_LA_GUAIRA_VARGAS', 'La Guaira', 'port', 10.6017::NUMERIC, -66.9322::NUMERIC, 'shoal')
    ) AS t(muni_id, city_name, b_type, lat, lng, terrain)
  LOOP
    INSERT INTO public.territories (id, name, level)
    VALUES (v_row.muni_id, v_row.city_name, 'MUNICIPALITY')
    ON CONFLICT (id) DO NOTHING;

    v_h3 := public.lat_lng_to_h3_res9(v_row.lat, v_row.lng);

    INSERT INTO public.buildings (
      h3_index, municipality_id, corp_id, building_type, level, hp, max_hp,
      is_historical, infra_state, base_terrain, storage_cap, is_production_halted
    ) VALUES (
      v_h3, v_row.muni_id, NULL, v_row.b_type, 2, 30.0, 30.0,
      true, 'OPERATIONAL', v_row.terrain, 500, false
    )
    ON CONFLICT (h3_index) DO UPDATE SET
      is_historical = true,
      municipality_id = COALESCE(public.buildings.municipality_id, EXCLUDED.municipality_id),
      base_terrain = COALESCE(public.buildings.base_terrain, EXCLUDED.base_terrain);

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('seeded_historical_bases', v_inserted);
END;
$$;

SELECT public.seed_historical_city_bases();

-- ------------------------------------------------------------------------------
-- 10. PERMISOS SEGUROS
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_infra_edge(UUID, TEXT, BIGINT, BIGINT, UUID, UUID, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_infra_edge(UUID, TEXT, BIGINT, BIGINT, UUID, UUID, BOOLEAN, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_collector_haul(UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_collector_haul(UUID, UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.trigger_vulnerability_handshake(VARCHAR, UUID, UUID, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_vulnerability_handshake(VARCHAR, UUID, UUID, INT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.damage_infrastructure(TEXT, UUID, UUID, NUMERIC, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.damage_infrastructure(TEXT, UUID, UUID, NUMERIC, BOOLEAN, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.seed_historical_city_bases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_historical_city_bases() TO service_role;
