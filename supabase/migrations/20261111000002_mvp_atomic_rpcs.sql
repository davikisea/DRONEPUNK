-- ==============================================================================
-- MIGRACIÓN MVP M2: RPCs ATÓMICOS 100% BASE DE DATOS (ZERO-RAM / ZERO-BYPASS)
-- ==============================================================================
-- Todos los RPCs son SECURITY DEFINER con SET search_path = public, pg_temp.
-- CERO ramas privilegiadas para is_admin: ADMIN juega con las mismas reglas.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- HELPER 1: VERIFICAR MEMBRESÍA Y PERMISOS ACCIONARIOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_corp_permission(
  p_user_id UUID,
  p_corp_id UUID,
  p_perm_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member public.corporation_members%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Sesión autenticada obligatoria.';
  END IF;

  IF p_corp_id IS NULL THEN
    RAISE EXCEPTION 'CORP_REQUIRED: Debes pertenecer a una Corporación para operar.';
  END IF;

  SELECT * INTO v_member
  FROM public.corporation_members
  WHERE corp_id = p_corp_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CORP_FORBIDDEN: No eres miembro de esta Corporación.';
  END IF;

  IF v_member.role IN ('majority_shareholder', 'shareholder') THEN
    RETURN;
  END IF;

  IF COALESCE((v_member.delegated_permissions ->> p_perm_key)::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Tu rango de Miembro no tiene permiso (%) autorizado por los Accionistas.', p_perm_key;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- HELPER 2: CATÁLOGO AUTORITATIVO DE EDIFICIOS (COSTOS Y RENDIMIENTO POR HORA)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_building_catalog_spec(
  p_building_type TEXT,
  p_level INT
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
  ELSE
    RAISE EXCEPTION 'INVALID_BUILDING_TYPE: Tipo de edificio no reconocido (%).', p_building_type;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- HELPER 3: CATÁLOGO AUTORITATIVO DE UNIDADES (T1-T5)
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
    WHEN 'md_tank'    THEN v_base_ec := 1100; v_base_alloys := 60; v_base_rare := 15; v_base_comp := 10;
    WHEN 'neotank'    THEN v_base_ec := 1600; v_base_alloys := 85; v_base_rare := 30; v_base_comp := 25;
    WHEN 'artillery'  THEN v_base_ec := 550; v_base_alloys := 30;  v_base_rare := 5;
    WHEN 'rockets'    THEN v_base_ec := 1050; v_base_alloys := 55; v_base_rare := 20; v_base_comp := 10;
    WHEN 'anti_air'   THEN v_base_ec := 600; v_base_alloys := 30;  v_base_rare := 8;
    WHEN 'b_copter'   THEN v_base_ec := 800; v_base_alloys := 45;  v_base_rare := 15; v_base_comp := 10;
    WHEN 'fighter'    THEN v_base_ec := 1500; v_base_alloys := 75; v_base_rare := 30; v_base_comp := 25;
    WHEN 'bomber'     THEN v_base_ec := 1800; v_base_alloys := 90; v_base_rare := 35; v_base_comp := 30;
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
-- RPC 1: CREATE_CORPORATION (FUNDADOR = ACCIONISTA MAYORITARIO)
-- ------------------------------------------------------------------------------
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
  v_profile public.profiles%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
  v_clean_name TEXT := trim(p_name);
  v_clean_tag TEXT := upper(trim(p_tag));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Debes iniciar sesión.';
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

-- ------------------------------------------------------------------------------
-- RPC 2: JOIN_CORPORATION (INGRESA COMO MIEMBRO SIN PERMISOS HASTA DELEGACIÓN)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_corporation(p_corp_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_profile public.profiles%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
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

  UPDATE public.profiles SET corp_id = p_corp_id WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'corp_id', v_corp.id,
    'name', v_corp.name,
    'tag', v_corp.tag,
    'role', 'member'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 3: UPDATE_MEMBER_PERMISSIONS (SOLO ACCIONISTAS)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_member_permissions(
  p_corp_id UUID,
  p_target_user_id UUID,
  p_role TEXT,
  p_permissions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_actor public.corporation_members%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_actor FROM public.corporation_members
  WHERE corp_id = p_corp_id AND user_id = v_user_id;

  IF NOT FOUND OR v_actor.role NOT IN ('majority_shareholder', 'shareholder') THEN
    RAISE EXCEPTION 'SHAREHOLDER_REQUIRED: Solo los Accionistas pueden gestionar rangos y permisos.';
  END IF;

  IF p_role NOT IN ('majority_shareholder', 'shareholder', 'member') THEN
    RAISE EXCEPTION 'INVALID_ROLE';
  END IF;

  IF p_role = 'majority_shareholder' AND v_actor.role <> 'majority_shareholder' THEN
    RAISE EXCEPTION 'MAJORITY_REQUIRED: Solo el Accionista Mayoritario puede asignar ese rango.';
  END IF;

  UPDATE public.corporation_members
  SET role = p_role,
      delegated_permissions = COALESCE(p_permissions, delegated_permissions)
  WHERE corp_id = p_corp_id AND user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TARGET_MEMBER_NOT_FOUND';
  END IF;

  RETURN jsonb_build_object('ok', true, 'target_user_id', p_target_user_id, 'role', p_role);
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 4: CONSTRUCT_BUILDING (TESORERÍA CORP + OPCIONAL APORTE PERSONAL)
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

  UPDATE public.corporations
  SET treasury_ec = treasury_ec - v_corp_ec_spend,
      treasury_alloys = treasury_alloys - v_corp_alloy_spend
  WHERE id = p_corp_id;

  INSERT INTO public.buildings (
    h3_index, municipality_id, owner_user_id, corp_id, building_type, level, hp, last_collected_at
  ) VALUES (
    p_h3_index, p_municipality_id, v_user_id, p_corp_id, p_building_type, 1, v_spec.max_hp, timezone('utc'::text, now())
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

-- ------------------------------------------------------------------------------
-- RPC 5: CLAIM_OR_CAPTURE_BUILDING
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

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUILDING_NOT_FOUND'; END IF;

  IF v_bld.corp_id = p_corp_id THEN
    RAISE EXCEPTION 'ALREADY_OWNED_BY_CORP';
  END IF;

  IF v_bld.corp_id IS NOT NULL AND v_bld.hp > 0 THEN
    RAISE EXCEPTION 'BUILDING_STILL_DEFENDED: El edificio rival aún tiene HP > 0.';
  END IF;

  SELECT * INTO v_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);

  UPDATE public.buildings
  SET corp_id = p_corp_id,
      owner_user_id = v_user_id,
      hp = GREATEST(10.0, v_spec.max_hp * 0.5),
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
-- RPC 6: REMODEL_BUILDING (LIQUIDA HORAS PENDIENTES Y MEJORA NIVEL/TIPO)
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

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUILDING_NOT_FOUND'; END IF;
  IF v_bld.corp_id <> p_corp_id THEN RAISE EXCEPTION 'NOT_BUILDING_OWNER'; END IF;
  IF v_bld.is_disabled THEN RAISE EXCEPTION 'BUILDING_DISABLED'; END IF;

  v_new_level := CASE WHEN p_upgrade_level THEN v_bld.level + 1 ELSE v_bld.level END;
  IF v_new_level > 5 THEN RAISE EXCEPTION 'MAX_BUILDING_LEVEL_REACHED'; END IF;
  v_new_type := COALESCE(p_target_type, v_bld.building_type);

  SELECT * INTO v_old_spec FROM public.get_building_catalog_spec(v_bld.building_type, v_bld.level);
  SELECT * INTO v_new_spec FROM public.get_building_catalog_spec(v_new_type, v_new_level);

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id FOR UPDATE;

  IF p_use_personal_topup THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;

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
-- RPC 7: COLLECT_BUILDING_RESOURCES (CÁLCULO POR HORA EXCLUSIVO EN DB)
-- ------------------------------------------------------------------------------
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

  UPDATE public.corporations
  SET treasury_ec = treasury_ec + v_ec,
      treasury_alloys = treasury_alloys + v_alloys,
      treasury_fuel = treasury_fuel + v_fuel,
      treasury_chips = treasury_chips + v_chips
  WHERE id = p_corp_id;

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

-- ------------------------------------------------------------------------------
-- RPC 8: PURCHASE_UNIT_FROM_BARRACKS (CANJE ATÓMICO CORP + APORTE PERSONAL)
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

  SELECT * INTO v_bld FROM public.buildings WHERE id = p_building_id FOR UPDATE;
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

  -- Bloquear Hangar físico (máximo 16 chasis: 4 vanguardia + 12 reserva)
  SELECT
    COALESCE(SUM(quantity), 0),
    COALESCE(SUM(CASE WHEN slot_type = 'vanguard' THEN quantity ELSE 0 END), 0)
  INTO v_total_qty, v_vanguard_qty
  FROM public.user_unit_hangar
  WHERE user_id = v_user_id
  FOR UPDATE;

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

  SELECT * INTO v_corp FROM public.corporations WHERE id = p_corp_id FOR UPDATE;
  IF v_corp.treasury_ec < v_c_ec
     OR v_corp.treasury_alloys < v_c_alloys
     OR v_corp.treasury_rare_earth < v_c_rare
     OR v_corp.treasury_composites < v_c_comp THEN
    RAISE EXCEPTION 'INSUFFICIENT_CORP_RESOURCES: La Tesorería corporativa no cubre el resto del costo.';
  END IF;

  IF v_p_ec > 0 THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
    IF COALESCE(v_profile.battle_credits, 0) < v_p_ec THEN
      RAISE EXCEPTION 'INSUFFICIENT_PERSONAL_EC';
    END IF;
    UPDATE public.profiles SET battle_credits = battle_credits - v_p_ec WHERE id = v_user_id;
  END IF;

  IF (v_p_alloys + v_p_rare + v_p_comp) > 0 THEN
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;
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
-- RPC 9: SCRAP_UNIT_FROM_HANGAR (35% TECH_SCRAP)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scrap_unit_from_hangar(
  p_hangar_slot_id UUID,
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
  v_row public.user_unit_hangar%ROWTYPE;
  v_spec RECORD;
  v_scrap_ec BIGINT;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  SELECT * INTO v_row FROM public.user_unit_hangar WHERE id = p_hangar_slot_id FOR UPDATE;
  IF NOT FOUND OR v_row.user_id <> v_user_id OR v_row.quantity < 1 THEN
    RAISE EXCEPTION 'HANGAR_UNIT_NOT_FOUND';
  END IF;

  SELECT * INTO v_spec FROM public.get_unit_catalog_spec(v_row.unit_code, v_row.tier);
  v_scrap_ec := FLOOR(v_spec.cost_ec * 0.35)::bigint;

  IF v_row.quantity = 1 THEN
    DELETE FROM public.user_unit_hangar WHERE id = p_hangar_slot_id;
  ELSE
    UPDATE public.user_unit_hangar SET quantity = quantity - 1, updated_at = timezone('utc'::text, now())
    WHERE id = p_hangar_slot_id;
  END IF;

  UPDATE public.profiles SET battle_credits = battle_credits + v_scrap_ec WHERE id = v_user_id;

  v_res := jsonb_build_object('scrapped_unit', v_row.unit_code, 'tech_scrap_ec', v_scrap_ec);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'scrap_unit_from_hangar', v_res);
  END IF;

  RETURN v_res;
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 10: DEPLOY & RECALL OPERATIONAL UNIT (REGISTRA owner_user_id + corp_id)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deploy_operational_unit(
  p_hangar_slot_id UUID,
  p_corp_id UUID,
  p_h3_index BIGINT,
  p_municipality_id VARCHAR DEFAULT NULL,
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
  v_slot public.user_unit_hangar%ROWTYPE;
  v_op public.operational_units%ROWTYPE;
  v_res JSONB;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_control_units');

  SELECT * INTO v_slot FROM public.user_unit_hangar WHERE id = p_hangar_slot_id FOR UPDATE;
  IF NOT FOUND OR v_slot.user_id <> v_user_id OR v_slot.quantity < 1 THEN
    RAISE EXCEPTION 'HANGAR_SLOT_EMPTY';
  END IF;

  IF v_slot.quantity = 1 THEN
    DELETE FROM public.user_unit_hangar WHERE id = p_hangar_slot_id;
  ELSE
    UPDATE public.user_unit_hangar SET quantity = quantity - 1 WHERE id = p_hangar_slot_id;
  END IF;

  INSERT INTO public.operational_units (
    owner_user_id, corp_id, hangar_slot_id, unit_code, tier, hp, h3_index, municipality_id, status
  ) VALUES (
    v_user_id, p_corp_id, NULL, v_slot.unit_code, v_slot.tier, v_slot.hp, p_h3_index, p_municipality_id, 'active'
  )
  RETURNING * INTO v_op;

  v_res := jsonb_build_object('operational_unit', to_jsonb(v_op));

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'deploy_operational_unit', v_res);
  END IF;

  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.recall_operational_unit(
  p_unit_id UUID,
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
  v_op public.operational_units%ROWTYPE;
  v_res JSONB;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached FROM public.economy_rpc_idempotency WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  SELECT * INTO v_op FROM public.operational_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERATIONAL_UNIT_NOT_FOUND'; END IF;
  IF v_op.owner_user_id <> v_user_id THEN
    PERFORM public.assert_corp_permission(v_user_id, v_op.corp_id, 'can_control_units');
  END IF;

  INSERT INTO public.user_unit_hangar (
    user_id, corp_id, unit_code, tier, level, hp, quantity, slot_type
  ) VALUES (
    v_op.owner_user_id, v_op.corp_id, v_op.unit_code, v_op.tier, 1, v_op.hp, 1, 'reserve'
  )
  ON CONFLICT (user_id, unit_code, tier)
  DO UPDATE SET
    quantity = public.user_unit_hangar.quantity + 1,
    hp = LEAST(100, GREATEST(1, v_op.hp)),
    updated_at = timezone('utc'::text, now());

  DELETE FROM public.operational_units WHERE id = p_unit_id;

  v_res := jsonb_build_object('recalled_unit_id', p_unit_id, 'unit_code', v_op.unit_code);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'recall_operational_unit', v_res);
  END IF;

  RETURN v_res;
END;
$$;
