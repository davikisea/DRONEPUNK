-- ==============================================================================
-- MIGRACIÓN: 20261118000006_canonical_lock_order_unification.sql
-- CONTRATO v3: Unificación estricta del Orden Canónico Global de Locks
--
-- Orden Global Obligatorio:
--   corporations
--   -> buildings (ORDER BY id ASC)
--   -> infra_edges (ORDER BY id ASC)
--   -> operational_units (ORDER BY id ASC)
--   -> user_unit_hangar (ORDER BY id ASC)
--   -> profiles (ORDER BY id ASC)
--   -> user_industrial_inventory (ORDER BY user_id ASC)
--   -> p2p_market_orders (ORDER BY id ASC)
--   -> territorial_battle_sessions / vulnerability_windows (ORDER BY id ASC)
--
-- RPCs refactorizadas (100% retrocompatibles en firma y retorno):
--   1. remodel_building
--   2. purchase_unit_from_barracks
--   3. collect_housing_citizens
--   4. recruit_and_deploy_unit
--   5. repair_infrastructure
--   6. damage_infrastructure
--   7. claim_or_capture_building
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REMODEL_BUILDING
-- Orden de locks: corporations -> buildings -> profiles -> user_industrial_inventory
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remodel_building(
  p_building_id UUID,
  p_corp_id UUID,
  p_target_type VARCHAR DEFAULT NULL,
  p_upgrade_level BOOLEAN DEFAULT true,
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
  v_bld public.buildings%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_inv public.user_industrial_inventory%ROWTYPE;
  v_new_level INT;
  v_new_type VARCHAR;
  v_old_spec RECORD;
  v_new_spec RECORD;
  v_elapsed_hours NUMERIC;
  v_stored JSONB;
  v_corp_ec_spend BIGINT := 0;
  v_personal_ec_spend BIGINT := 0;
  v_corp_alloy_spend BIGINT := 0;
  v_personal_alloy_spend BIGINT := 0;
  v_res JSONB;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_remodel');

  -- 1. Lock corporations
  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATION_NOT_FOUND'; END IF;

  -- 2. Lock buildings
  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUILDING_NOT_FOUND'; END IF;
  IF v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'NOT_BUILDING_OWNER'; END IF;
  IF v_bld.is_disabled THEN RAISE EXCEPTION 'BUILDING_DISABLED'; END IF;

  v_new_level := CASE WHEN p_upgrade_level THEN v_bld.level + 1 ELSE v_bld.level END;
  IF v_new_level > 5 THEN RAISE EXCEPTION 'MAX_BUILDING_LEVEL_REACHED'; END IF;
  v_new_type := COALESCE(p_target_type, v_bld.building_type);

  SELECT * INTO v_old_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);
  SELECT * INTO v_new_spec FROM public.get_building_catalog_spec(v_new_type, v_new_level);

  IF p_use_personal_topup THEN
    -- 3. Lock profiles
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id ORDER BY id ASC FOR UPDATE;
    -- 4. Lock user_industrial_inventory
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id ORDER BY user_id ASC FOR UPDATE;

    v_corp_ec_spend := LEAST(v_corp.treasury_ec, v_new_spec.cost_ec);
    v_personal_ec_spend := v_new_spec.cost_ec - v_corp_ec_spend;
    IF COALESCE(v_profile.battle_credits, 0) < v_personal_ec_spend THEN RAISE EXCEPTION 'INSUFFICIENT_EC'; END IF;

    v_corp_alloy_spend := LEAST(v_corp.treasury_alloys, v_new_spec.cost_alloys);
    v_personal_alloy_spend := v_new_spec.cost_alloys - v_corp_alloy_spend;
    IF COALESCE(v_inv.refined_steel, 0) < v_personal_alloy_spend THEN RAISE EXCEPTION 'INSUFFICIENT_ALLOYS'; END IF;

    IF v_personal_ec_spend > 0 THEN
      UPDATE public.profiles SET battle_credits = battle_credits - v_personal_ec_spend WHERE id = v_user_id;
    END IF;
    IF v_personal_alloy_spend > 0 THEN
      UPDATE public.user_industrial_inventory SET refined_steel = refined_steel - v_personal_alloy_spend WHERE user_id = v_user_id;
    END IF;
  ELSE
    IF v_corp.treasury_ec < v_new_spec.cost_ec OR v_corp.treasury_alloys < v_new_spec.cost_alloys THEN
      RAISE EXCEPTION 'INSUFFICIENT_CORP_TREASURY';
    END IF;
    v_corp_ec_spend := v_new_spec.cost_ec;
    v_corp_alloy_spend := v_new_spec.cost_alloys;
  END IF;

  UPDATE public.corporations
  SET treasury_ec = treasury_ec - v_corp_ec_spend,
      treasury_alloys = treasury_alloys - v_corp_alloy_spend
  WHERE id = p_corp_id;

  -- Liquidar producción pendiente antes de cambiar nivel/tipo
  v_elapsed_hours := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (timezone('utc'::text, now()) - v_bld.last_collected_at)) / 3600.0));
  v_stored := jsonb_build_object(
    'alloys', COALESCE((v_bld.stored_resources->>'alloys')::numeric, 0) + FLOOR(v_old_spec.alloys_per_hour * v_elapsed_hours),
    'fuel',   COALESCE((v_bld.stored_resources->>'fuel')::numeric, 0)   + FLOOR(v_old_spec.fuel_per_hour * v_elapsed_hours),
    'chips',  COALESCE((v_bld.stored_resources->>'chips')::numeric, 0)  + FLOOR(v_old_spec.chips_per_hour * v_elapsed_hours)
  );

  UPDATE public.buildings
  SET building_type = v_new_type,
      level = v_new_level,
      hp = v_new_spec.max_hp,
      stored_resources = v_stored,
      last_collected_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_building_id
  RETURNING * INTO v_bld;

  v_res := jsonb_build_object('building', to_jsonb(v_bld));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'remodel_building', v_res);
  END IF;

  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. PURCHASE_UNIT_FROM_BARRACKS
-- Orden de locks: corporations -> buildings -> user_unit_hangar -> profiles -> user_industrial_inventory
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_unit_from_barracks(
  p_corp_id UUID,
  p_building_id UUID,
  p_unit_code TEXT,
  p_tier INT DEFAULT 1,
  p_personal_contribution JSONB DEFAULT '{}'::jsonb,
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
  v_profile public.profiles%ROWTYPE;
  v_inv public.user_industrial_inventory%ROWTYPE;
  v_spec RECORD;
  v_total_qty INT := 0;
  v_vanguard_qty INT := 0;
  v_slot_type VARCHAR(16);
  v_p_ec BIGINT := GREATEST(0, COALESCE((p_personal_contribution->>'ec')::bigint, 0));
  v_p_alloys BIGINT := GREATEST(0, COALESCE((p_personal_contribution->>'alloys')::bigint, 0));
  v_p_rare BIGINT := GREATEST(0, COALESCE((p_personal_contribution->>'rare_earth')::bigint, 0));
  v_p_comp BIGINT := GREATEST(0, COALESCE((p_personal_contribution->>'composites')::bigint, 0));
  v_c_ec BIGINT;
  v_c_alloys BIGINT;
  v_c_rare BIGINT;
  v_c_comp BIGINT;
  v_unit_row public.user_unit_hangar%ROWTYPE;
  v_res JSONB;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_purchase_units');

  -- 1. Lock corporations
  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATION_NOT_FOUND'; END IF;

  -- 2. Lock buildings
  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BARRACKS_NOT_FOUND'; END IF;
  IF v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'BARRACKS_NOT_OWNED_BY_CORP'; END IF;
  IF v_bld.is_disabled THEN RAISE EXCEPTION 'BARRACKS_DISABLED'; END IF;
  IF v_bld.building_type NOT IN ('barracks', 'factory', 'war_factory', 'airport', 'port', 'hq') THEN
    RAISE EXCEPTION 'INVALID_PRODUCTION_BUILDING';
  END IF;

  IF p_tier > 1 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_patents
      WHERE user_id = v_user_id AND lower(patent_code) = lower(p_unit_code) AND tier >= p_tier
    ) THEN
      RAISE EXCEPTION 'PATENT_REQUIRED: Patente Tier % requerida para %.', p_tier, p_unit_code;
    END IF;
  END IF;

  SELECT * INTO v_spec FROM public.get_unit_catalog_spec(p_unit_code, p_tier);

  -- 3. Lock user_unit_hangar en orden determinista antes de agregar (evita FOR UPDATE con SUM)
  PERFORM 1
  FROM public.user_unit_hangar
  WHERE user_id = v_user_id
  ORDER BY id ASC
  FOR UPDATE;

  SELECT
    COALESCE(SUM(quantity), 0),
    COALESCE(SUM(CASE WHEN slot_type = 'vanguard' THEN quantity ELSE 0 END), 0)
  INTO v_total_qty, v_vanguard_qty
  FROM public.user_unit_hangar
  WHERE user_id = v_user_id;

  IF v_total_qty >= 16 THEN
    RAISE EXCEPTION 'HANGAR_CAPACITY_EXCEEDED: Límite físico de 16 chasis alcanzado.';
  END IF;

  v_slot_type := CASE WHEN v_vanguard_qty < 4 THEN 'vanguard' ELSE 'reserve' END;

  -- Combinar Tesorería de Corporación + Aporte Personal
  v_p_ec     := LEAST(v_p_ec, v_spec.cost_ec);
  v_p_alloys := LEAST(v_p_alloys, v_spec.cost_alloys);
  v_p_rare   := LEAST(v_p_rare, v_spec.cost_rare_earth);
  v_p_comp   := LEAST(v_p_comp, v_spec.cost_composites);

  v_c_ec     := v_spec.cost_ec - v_p_ec;
  v_c_alloys := v_spec.cost_alloys - v_p_alloys;
  v_c_rare   := v_spec.cost_rare_earth - v_p_rare;
  v_c_comp   := v_spec.cost_composites - v_p_comp;

  IF v_corp.treasury_ec < v_c_ec
     OR v_corp.treasury_alloys < v_c_alloys
     OR v_corp.treasury_rare_earth < v_c_rare
     OR v_corp.treasury_composites < v_c_comp THEN
    RAISE EXCEPTION 'INSUFFICIENT_CORP_RESOURCES: La Tesorería corporativa no cubre el resto del costo.';
  END IF;

  -- 4. Lock profiles
  IF v_p_ec > 0 THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id ORDER BY id ASC FOR UPDATE;
    IF COALESCE(v_profile.battle_credits, 0) < v_p_ec THEN
      RAISE EXCEPTION 'INSUFFICIENT_PERSONAL_EC';
    END IF;
    UPDATE public.profiles SET battle_credits = battle_credits - v_p_ec WHERE id = v_user_id;
  END IF;

  -- 5. Lock user_industrial_inventory
  IF (v_p_alloys + v_p_rare + v_p_comp) > 0 THEN
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id ORDER BY user_id ASC FOR UPDATE;
    IF COALESCE(v_inv.refined_steel, 0) < v_p_alloys
       OR COALESCE(v_inv.rare_earth, 0) < v_p_rare
       OR COALESCE(v_inv.carbon_composites, 0) < v_p_comp THEN
      RAISE EXCEPTION 'INSUFFICIENT_PERSONAL_MATERIALS';
    END IF;
    UPDATE public.user_industrial_inventory
    SET refined_steel = refined_steel - v_p_alloys,
        rare_earth = rare_earth - v_p_rare,
        carbon_composites = carbon_composites - v_p_comp
    WHERE user_id = v_user_id;
  END IF;

  UPDATE public.corporations
  SET treasury_ec = treasury_ec - v_c_ec,
      treasury_alloys = treasury_alloys - v_c_alloys,
      treasury_rare_earth = treasury_rare_earth - v_c_rare,
      treasury_composites = treasury_composites - v_c_comp
  WHERE id = p_corp_id;

  -- Upsert en user_unit_hangar registrando user_id (owner) + corp_id + building_id
  INSERT INTO public.user_unit_hangar (
    user_id, corp_id, building_id, unit_code, tier, level, hp, quantity, slot_type
  ) VALUES (
    v_user_id, p_corp_id, p_building_id, lower(p_unit_code), p_tier, 1, 100, 1, v_slot_type
  )
  ON CONFLICT (user_id, unit_code, tier)
  DO UPDATE SET
    quantity = public.user_unit_hangar.quantity + 1,
    corp_id = EXCLUDED.corp_id,
    building_id = EXCLUDED.building_id,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_unit_row;

  v_res := jsonb_build_object(
    'unit', to_jsonb(v_unit_row),
    'slot_type', v_slot_type,
    'total_hangar_units', v_total_qty + 1
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'purchase_unit_from_barracks', v_res);
  END IF;

  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. COLLECT_HOUSING_CITIZENS
-- Orden de locks: corporations -> buildings
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

  -- 1. Lock corporations
  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATION_NOT_FOUND'; END IF;

  -- 2. Lock buildings
  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND OR v_bld.corp_id <> p_corp_id OR v_bld.building_type <> 'housing' THEN
    RAISE EXCEPTION 'INVALID_HOUSING_BUILDING';
  END IF;
  IF v_bld.infra_state = 'RUINED' OR v_bld.is_disabled THEN
    RAISE EXCEPTION 'BUILDING_RUINED';
  END IF;

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

-- ------------------------------------------------------------------------------
-- 4. RECRUIT_AND_DEPLOY_UNIT
-- Orden de locks: corporations -> buildings -> operational_units (INSERT)
-- ------------------------------------------------------------------------------
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

  -- 1. Lock corporations
  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATION_NOT_FOUND'; END IF;

  -- 2. Lock buildings
  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND OR v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'BUILDING_NOT_OWNED'; END IF;
  IF v_bld.infra_state = 'RUINED' OR v_bld.is_disabled THEN RAISE EXCEPTION 'BUILDING_RUINED'; END IF;
  IF v_bld.building_type NOT IN ('factory', 'barracks', 'port', 'airport', 'hq') THEN
    RAISE EXCEPTION 'INVALID_PRODUCTION_FACILITY';
  END IF;

  SELECT * INTO v_spec FROM public.get_unit_catalog_spec(p_unit_code, p_tier);
  v_cost_ec := GREATEST(0, COALESCE(v_spec.cost_ec, 0)::INT - COALESCE(p_personal_contribution, 0)::INT);
  v_cost_alloys := COALESCE(v_spec.cost_alloys, 0)::INT;

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

-- ------------------------------------------------------------------------------
-- 5. REPAIR_INFRASTRUCTURE
-- Orden de locks: corporations -> buildings / infra_edges
-- ------------------------------------------------------------------------------
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
  IF p_target_kind NOT IN ('building', 'edge') THEN RAISE EXCEPTION 'INVALID_TARGET_KIND'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_construct');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  -- 1. Lock corporations
  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATION_NOT_FOUND'; END IF;

  -- 2. Lock buildings o infra_edges
  IF p_target_kind = 'building' THEN
    SELECT * INTO v_bld FROM public.buildings WHERE id = p_target_id ORDER BY id ASC FOR UPDATE;
    IF NOT FOUND OR v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'BUILDING_NOT_OWNED'; END IF;
    SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);
  ELSE
    SELECT * INTO v_edge FROM public.infra_edges WHERE id = p_target_id ORDER BY id ASC FOR UPDATE;
    IF NOT FOUND OR v_edge.corp_id <> p_corp_id THEN RAISE EXCEPTION 'EDGE_NOT_OWNED'; END IF;
    SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_edge.edge_type, 1);
  END IF;

  v_cost_ec := GREATEST(1, FLOOR(COALESCE(v_spec.cost_ec, 100)::NUMERIC * 0.35)::INT);
  v_cost_alloys := FLOOR(COALESCE(v_spec.cost_alloys, 0)::NUMERIC * 0.35)::INT;

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
-- 6. DAMAGE_INFRASTRUCTURE
-- Orden de locks: corporations -> buildings / infra_edges -> vulnerability_windows
-- ------------------------------------------------------------------------------
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
  v_corp public.corporations%ROWTYPE;
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
  IF p_target_kind NOT IN ('building', 'edge') THEN RAISE EXCEPTION 'INVALID_TARGET_KIND'; END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_attacker_corp_id, 'can_control_units');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  -- 1. Lock corporations (atacante para posible loot)
  SELECT * INTO v_corp FROM public.corporations WHERE id = p_attacker_corp_id ORDER BY id ASC FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORPORATION_NOT_FOUND'; END IF;

  -- 2. Lock target (buildings o infra_edges)
  IF p_target_kind = 'building' THEN
    SELECT * INTO v_bld FROM public.buildings WHERE id = p_target_id ORDER BY id ASC FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BUILDING_NOT_FOUND'; END IF;
    IF v_bld.corp_id = p_attacker_corp_id THEN
      RAISE EXCEPTION 'FRIENDLY_FIRE_PROHIBITED';
    END IF;
  ELSE
    SELECT * INTO v_edge FROM public.infra_edges WHERE id = p_target_id ORDER BY id ASC FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EDGE_NOT_FOUND'; END IF;
    IF v_edge.corp_id = p_attacker_corp_id THEN
      RAISE EXCEPTION 'FRIENDLY_FIRE_PROHIBITED';
    END IF;
  END IF;

  -- 3. Lock y activar vulnerability_windows cuyo Handshake de 120s ya venció
  PERFORM 1
  FROM public.vulnerability_windows
  WHERE status = 'handshake'
    AND active_from <= v_now
    AND expires_at > v_now
  ORDER BY id ASC
  FOR UPDATE;

  UPDATE public.vulnerability_windows
  SET status = 'active'
  WHERE status = 'handshake'
    AND active_from <= v_now
    AND expires_at > v_now;

  IF p_target_kind = 'building' THEN
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

  ELSE
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
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'damage_infrastructure', v_res);
  END IF;
  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. CLAIM_OR_CAPTURE_BUILDING
-- Orden de locks: buildings (ORDER BY id ASC)
-- ------------------------------------------------------------------------------
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

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id ORDER BY id ASC FOR UPDATE;
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

REVOKE ALL ON FUNCTION public.remodel_building(UUID, UUID, VARCHAR, BOOLEAN, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remodel_building(UUID, UUID, VARCHAR, BOOLEAN, BOOLEAN, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.purchase_unit_from_barracks(UUID, UUID, TEXT, INT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_unit_from_barracks(UUID, UUID, TEXT, INT, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.collect_housing_citizens(UUID, UUID, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_housing_citizens(UUID, UUID, BOOLEAN, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.recruit_and_deploy_unit(UUID, UUID, TEXT, INT, BIGINT, NUMERIC, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recruit_and_deploy_unit(UUID, UUID, TEXT, INT, BIGINT, NUMERIC, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.repair_infrastructure(TEXT, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_infrastructure(TEXT, UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.damage_infrastructure(TEXT, UUID, UUID, NUMERIC, BOOLEAN, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.damage_infrastructure(TEXT, UUID, UUID, NUMERIC, BOOLEAN, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_or_capture_building(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_or_capture_building(UUID, UUID, UUID) TO authenticated;
