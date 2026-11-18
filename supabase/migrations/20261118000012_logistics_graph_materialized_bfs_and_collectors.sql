-- ==============================================================================
-- MIGRATION: 20261118000012_logistics_graph_materialized_bfs_and_collectors.sql
-- CONTRATO SQL/RPC v3 (10,000+ CCU) - db-logistics-graph
-- 1. Índices compuestos en public.infra_edges para grafos logísticos y status.
-- 2. Materialización de alcance BFS acotado + dirty-graph recompute.
-- 3. Refactorización de sync_pipeline_logistics y execute_collector_haul con
--    orden canónico de locks:
--    corporations -> buildings (ORDER BY id ASC) -> operational_units (ORDER BY id ASC)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ÍNDICES COMPUESTOS EN INFRA_EDGES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_infra_edges_corp_from_building
  ON public.infra_edges (corp_id, from_building_id);

CREATE INDEX IF NOT EXISTS idx_infra_edges_corp_to_building
  ON public.infra_edges (corp_id, to_building_id);

CREATE INDEX IF NOT EXISTS idx_infra_edges_status
  ON public.infra_edges (status);

CREATE INDEX IF NOT EXISTS idx_infra_edges_pipeline_from_h3
  ON public.infra_edges (corp_id, edge_type, status, from_h3)
  INCLUDE (to_h3);

CREATE INDEX IF NOT EXISTS idx_infra_edges_pipeline_to_h3
  ON public.infra_edges (corp_id, edge_type, status, to_h3)
  INCLUDE (from_h3);

-- ------------------------------------------------------------------------------
-- 2. TABLAS MATERIALIZADAS PARA DIRTY-GRAPH RECOMPUTE Y BFS ACOTADO
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corp_logistics_dirty (
  corp_id    UUID PRIMARY KEY REFERENCES public.corporations(id) ON DELETE CASCADE,
  is_dirty   BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.corp_logistics_dirty ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corp_logistics_dirty FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.corp_pipeline_reachability (
  corp_id   UUID NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  h3_index  BIGINT NOT NULL,
  hop_depth INT NOT NULL DEFAULT 0,
  PRIMARY KEY (corp_id, h3_index)
);

CREATE INDEX IF NOT EXISTS idx_corp_pipeline_reachability_corp_depth
  ON public.corp_pipeline_reachability (corp_id, hop_depth, h3_index);

ALTER TABLE public.corp_pipeline_reachability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corp_pipeline_reachability FROM PUBLIC, anon, authenticated;

-- Triggers para marcar el grafo logístico como dirty cuando mutan tuberías o nodos HQ/Depot
CREATE OR REPLACE FUNCTION public.mark_corp_logistics_dirty_from_edge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.corp_id IS NOT NULL AND OLD.edge_type = 'pipeline' THEN
    INSERT INTO public.corp_logistics_dirty (corp_id, is_dirty, updated_at)
    VALUES (OLD.corp_id, true, timezone('utc'::text, now()))
    ON CONFLICT (corp_id) DO UPDATE
      SET is_dirty = true,
          updated_at = timezone('utc'::text, now());
  END IF;

  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.corp_id IS NOT NULL AND NEW.edge_type = 'pipeline' THEN
    INSERT INTO public.corp_logistics_dirty (corp_id, is_dirty, updated_at)
    VALUES (NEW.corp_id, true, timezone('utc'::text, now()))
    ON CONFLICT (corp_id) DO UPDATE
      SET is_dirty = true,
          updated_at = timezone('utc'::text, now());
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_infra_edges_mark_logistics_dirty ON public.infra_edges;
CREATE TRIGGER trg_infra_edges_mark_logistics_dirty
  AFTER INSERT OR UPDATE OF corp_id, edge_type, status, from_h3, to_h3 OR DELETE
  ON public.infra_edges
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_corp_logistics_dirty_from_edge();

CREATE OR REPLACE FUNCTION public.mark_corp_logistics_dirty_from_building()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE')
     AND OLD.corp_id IS NOT NULL
     AND OLD.building_type IN ('depot', 'hq') THEN
    INSERT INTO public.corp_logistics_dirty (corp_id, is_dirty, updated_at)
    VALUES (OLD.corp_id, true, timezone('utc'::text, now()))
    ON CONFLICT (corp_id) DO UPDATE
      SET is_dirty = true,
          updated_at = timezone('utc'::text, now());
  END IF;

  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND NEW.corp_id IS NOT NULL
     AND NEW.building_type IN ('depot', 'hq') THEN
    INSERT INTO public.corp_logistics_dirty (corp_id, is_dirty, updated_at)
    VALUES (NEW.corp_id, true, timezone('utc'::text, now()))
    ON CONFLICT (corp_id) DO UPDATE
      SET is_dirty = true,
          updated_at = timezone('utc'::text, now());
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_buildings_mark_logistics_dirty ON public.buildings;
CREATE TRIGGER trg_buildings_mark_logistics_dirty
  AFTER INSERT OR UPDATE OF corp_id, building_type, h3_index, infra_state, is_disabled OR DELETE
  ON public.buildings
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_corp_logistics_dirty_from_building();

-- ------------------------------------------------------------------------------
-- 3. REFACTOR: sync_pipeline_logistics
--    - Elimina dobles WITH RECURSIVE ... FOR UPDATE OF b
--    - Usa dirty-graph recompute + BFS acotado (máx 64 saltos)
--    - Orden canónico de locks: corporations -> buildings (ORDER BY id ASC)
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
  v_is_dirty BOOLEAN;
  v_depth INT := 0;
  v_added INT := 0;
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
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM public.assert_corp_permission(v_user_id, p_corp_id, 'can_collect');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached
    FROM public.economy_rpc_idempotency
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  -- Orden canónico de locks #1: corporations primero
  PERFORM 1 FROM public.corporations WHERE id = p_corp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORP_NOT_FOUND'; END IF;

  -- Recomputar alcance de tuberías solo si el grafo está dirty (BFS acotado <= 64 saltos)
  SELECT is_dirty INTO v_is_dirty
  FROM public.corp_logistics_dirty
  WHERE corp_id = p_corp_id;

  IF NOT FOUND OR v_is_dirty THEN
    DELETE FROM public.corp_pipeline_reachability WHERE corp_id = p_corp_id;

    INSERT INTO public.corp_pipeline_reachability (corp_id, h3_index, hop_depth)
    SELECT DISTINCT p_corp_id, b.h3_index, 0
    FROM public.buildings b
    WHERE b.corp_id = p_corp_id
      AND b.building_type IN ('depot', 'hq')
      AND b.infra_state = 'OPERATIONAL'
      AND NOT b.is_disabled
    ON CONFLICT (corp_id, h3_index) DO NOTHING;

    GET DIAGNOSTICS v_added = ROW_COUNT;
    v_depth := 0;

    WHILE v_added > 0 AND v_depth < 64 LOOP
      INSERT INTO public.corp_pipeline_reachability (corp_id, h3_index, hop_depth)
      SELECT p_corp_id, next_h3, v_depth + 1
      FROM (
        SELECT e.to_h3 AS next_h3
        FROM public.corp_pipeline_reachability r
        JOIN public.infra_edges e
          ON e.corp_id = p_corp_id
         AND e.edge_type = 'pipeline'
         AND e.status = 'operational'
         AND e.from_h3 = r.h3_index
        WHERE r.corp_id = p_corp_id
          AND r.hop_depth = v_depth
        UNION
        SELECT e.from_h3 AS next_h3
        FROM public.corp_pipeline_reachability r
        JOIN public.infra_edges e
          ON e.corp_id = p_corp_id
         AND e.edge_type = 'pipeline'
         AND e.status = 'operational'
         AND e.to_h3 = r.h3_index
        WHERE r.corp_id = p_corp_id
          AND r.hop_depth = v_depth
      ) frontier
      ON CONFLICT (corp_id, h3_index) DO NOTHING;

      GET DIAGNOSTICS v_added = ROW_COUNT;
      v_depth := v_depth + 1;
    END LOOP;

    INSERT INTO public.corp_logistics_dirty (corp_id, is_dirty, updated_at)
    VALUES (p_corp_id, false, v_now)
    ON CONFLICT (corp_id) DO UPDATE
      SET is_dirty = false,
          updated_at = v_now;
  END IF;

  -- Orden canónico de locks #2: buildings en una sola pasada ORDER BY id ASC
  FOR v_rec IN
    SELECT b.*,
           (r.h3_index IS NOT NULL) AS is_pipe_connected
    FROM public.buildings b
    LEFT JOIN public.corp_pipeline_reachability r
      ON r.corp_id = p_corp_id
     AND r.h3_index = b.h3_index
    WHERE b.corp_id = p_corp_id
      AND b.building_type = 'extractor'
      AND b.infra_state = 'OPERATIONAL'
      AND NOT b.is_disabled
    ORDER BY b.id ASC
    FOR UPDATE OF b
  LOOP
    IF v_rec.is_pipe_connected THEN
      -- Flujo 1: Extractor conectado vía tubería operacional a algún Depot/HQ operacional
      SELECT * INTO v_spec FROM public.get_building_catalog_spec('extractor', v_rec.level);
      v_elapsed := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (v_now - v_rec.last_collected_at)) / 3600.0));
      v_total_alloys := v_total_alloys + FLOOR(COALESCE(v_spec.alloys_per_hour, 0) * v_elapsed)::INT + COALESCE((v_rec.stored_resources->>'alloys')::INT, 0);
      v_total_fuel := v_total_fuel + FLOOR(COALESCE(v_spec.fuel_per_hour, 0) * v_elapsed)::INT + COALESCE((v_rec.stored_resources->>'fuel')::INT, 0);
      v_total_chips := v_total_chips + FLOOR(COALESCE(v_spec.chips_per_hour, 0) * v_elapsed)::INT + COALESCE((v_rec.stored_resources->>'chips')::INT, 0);

      UPDATE public.buildings
      SET stored_resources = '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
          is_production_halted = false,
          last_collected_at = v_now,
          updated_at = v_now
      WHERE id = v_rec.id;
    ELSE
      -- Flujo 2: Extractor SIN salida por tubería -> acumula hasta storage_cap y se detiene
      v_cur_alloys := COALESCE((v_rec.stored_resources->>'alloys')::INT, 0);
      v_cur_fuel := COALESCE((v_rec.stored_resources->>'fuel')::INT, 0);
      v_cur_chips := COALESCE((v_rec.stored_resources->>'chips')::INT, 0);
      v_cur_sum := v_cur_alloys + v_cur_fuel + v_cur_chips;
      v_cap := GREATEST(1, COALESCE(v_rec.storage_cap, 250)::INT);
      v_room := GREATEST(0, v_cap - v_cur_sum);

      IF NOT v_rec.is_production_halted AND v_room > 0 THEN
        SELECT * INTO v_spec FROM public.get_building_catalog_spec('extractor', v_rec.level);
        v_elapsed := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (v_now - v_rec.last_collected_at)) / 3600.0));
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
          last_collected_at = v_now,
          updated_at = v_now
      WHERE id = v_rec.id;
    END IF;
  END LOOP;

  IF (v_total_alloys + v_total_fuel + v_total_chips) > 0 THEN
    UPDATE public.corporations
    SET treasury_alloys = treasury_alloys + v_total_alloys,
        treasury_fuel = treasury_fuel + v_total_fuel,
        treasury_chips = treasury_chips + v_total_chips,
        updated_at = v_now
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

-- ------------------------------------------------------------------------------
-- 4. REFACTOR: execute_collector_haul
--    - Orden canónico estricto de locks:
--      corporations -> buildings (ORDER BY id ASC) -> operational_units (ORDER BY id ASC)
-- ------------------------------------------------------------------------------
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
  v_unit_meta RECORD;
  v_ext_id UUID;
  v_depot_id UUID;
  v_b public.buildings%ROWTYPE;
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
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached
    FROM public.economy_rpc_idempotency
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_cached; END IF;
  END IF;

  -- Lectura sin lock para resolver corp_id y edificios candidatos antes de adquirir locks
  SELECT corp_id, status, unit_role, source_building_id, depot_building_id
  INTO v_unit_meta
  FROM public.operational_units
  WHERE id = p_unit_id;

  IF NOT FOUND OR v_unit_meta.status <> 'active' THEN
    RAISE EXCEPTION 'OPERATIONAL_UNIT_NOT_FOUND';
  END IF;
  IF v_unit_meta.unit_role <> 'collector' THEN
    RAISE EXCEPTION 'INVALID_UNIT_ROLE: Solo unidades con rol collector pueden acarrear logística.';
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, v_unit_meta.corp_id, 'can_collect');

  v_ext_id := COALESCE(p_extractor_building_id, v_unit_meta.source_building_id);
  IF v_ext_id IS NULL THEN
    SELECT id INTO v_ext_id
    FROM public.buildings
    WHERE corp_id = v_unit_meta.corp_id
      AND building_type = 'extractor'
      AND infra_state <> 'RUINED'
      AND NOT is_disabled
    ORDER BY is_production_halted DESC, last_collected_at ASC, id ASC
    LIMIT 1;
  END IF;
  IF v_ext_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_EXTRACTOR_BUILDING';
  END IF;

  v_depot_id := COALESCE(p_depot_building_id, v_unit_meta.depot_building_id);
  IF v_depot_id IS NULL THEN
    SELECT id INTO v_depot_id
    FROM public.buildings
    WHERE corp_id = v_unit_meta.corp_id
      AND building_type IN ('depot', 'hq')
      AND infra_state = 'OPERATIONAL'
      AND NOT is_disabled
    ORDER BY CASE WHEN building_type = 'depot' THEN 0 ELSE 1 END, created_at ASC, id ASC
    LIMIT 1;
  END IF;
  IF v_depot_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_DEPOT_BUILDING';
  END IF;

  -- Orden canónico de locks #1: corporations
  PERFORM 1 FROM public.corporations WHERE id = v_unit_meta.corp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CORP_NOT_FOUND'; END IF;

  -- Orden canónico de locks #2: buildings ORDER BY id ASC
  FOR v_b IN
    SELECT *
    FROM public.buildings
    WHERE id IN (v_ext_id, v_depot_id)
    ORDER BY id ASC
    FOR UPDATE
  LOOP
    IF v_b.id = v_ext_id THEN v_ext := v_b; END IF;
    IF v_b.id = v_depot_id THEN v_depot := v_b; END IF;
  END LOOP;

  IF v_ext.id IS NULL OR v_ext.corp_id <> v_unit_meta.corp_id OR v_ext.building_type <> 'extractor' THEN
    RAISE EXCEPTION 'INVALID_EXTRACTOR_BUILDING';
  END IF;
  IF v_ext.infra_state = 'RUINED' OR v_ext.is_disabled THEN
    RAISE EXCEPTION 'EXTRACTOR_RUINED';
  END IF;

  IF v_depot.id IS NULL OR v_depot.corp_id <> v_unit_meta.corp_id OR v_depot.building_type NOT IN ('depot', 'hq') THEN
    RAISE EXCEPTION 'INVALID_DEPOT_BUILDING';
  END IF;
  IF v_depot.infra_state = 'RUINED' OR v_depot.is_disabled THEN
    RAISE EXCEPTION 'DEPOT_RUINED';
  END IF;

  -- Orden canónico de locks #3: operational_units ORDER BY id ASC
  SELECT * INTO v_unit
  FROM public.operational_units
  WHERE id = p_unit_id
  ORDER BY id ASC
  FOR UPDATE;

  IF NOT FOUND OR v_unit.status <> 'active' OR v_unit.corp_id <> v_unit_meta.corp_id THEN
    RAISE EXCEPTION 'OPERATIONAL_UNIT_NOT_FOUND';
  END IF;
  IF v_unit.unit_role <> 'collector' THEN
    RAISE EXCEPTION 'INVALID_UNIT_ROLE: Solo unidades con rol collector pueden acarrear logística.';
  END IF;

  v_cur_alloys := COALESCE((v_ext.stored_resources->>'alloys')::INT, 0);
  v_cur_fuel := COALESCE((v_ext.stored_resources->>'fuel')::INT, 0);
  v_cur_chips := COALESCE((v_ext.stored_resources->>'chips')::INT, 0);
  v_cap := GREATEST(1, COALESCE(v_ext.storage_cap, 250)::INT);
  v_room := GREATEST(0, v_cap - (v_cur_alloys + v_cur_fuel + v_cur_chips));

  IF NOT v_ext.is_production_halted AND v_room > 0 THEN
    SELECT * INTO v_spec FROM public.get_building_catalog_spec('extractor', v_ext.level);
    v_elapsed := LEAST(16.0, GREATEST(0.0, EXTRACT(EPOCH FROM (v_now - v_ext.last_collected_at)) / 3600.0));
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
      last_collected_at = v_now,
      updated_at = v_now
  WHERE id = v_ext.id;

  IF (v_take_alloys + v_take_fuel + v_take_chips) > 0 THEN
    UPDATE public.corporations
    SET treasury_alloys = treasury_alloys + v_take_alloys,
        treasury_fuel = treasury_fuel + v_take_fuel,
        treasury_chips = treasury_chips + v_take_chips,
        updated_at = v_now
    WHERE id = v_unit.corp_id;
  END IF;

  UPDATE public.operational_units
  SET h3_index = v_depot.h3_index,
      source_building_id = v_ext.id,
      depot_building_id = v_depot.id,
      cargo = '{"alloys":0,"fuel":0,"chips":0}'::jsonb,
      next_haul_at = v_now + interval '15 seconds',
      updated_at = v_now
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
-- 5. PERMISOS SEGUROS
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sync_pipeline_logistics(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_pipeline_logistics(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.execute_collector_haul(UUID, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_collector_haul(UUID, UUID, UUID, UUID) TO authenticated;
