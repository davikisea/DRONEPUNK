-- ==============================================================================
-- MIGRATION: 20261118000008_spatial_viewport_culling_rpcs.sql
-- OBJETIVO: Spatial Viewport Culling para 10,000+ CCU (Contrato SQL/RPC v3)
--   1. Helper IMMUTABLE `h3_res9_to_lat_lng(BIGINT)` en paridad con `src/shared/utils/h3.ts`.
--   2. Columnas `lat`, `lng` (+ `from_lat`, `from_lng`, `to_lat`, `to_lng` en `infra_edges`),
--      backfill idempotente desde `h3_index` / `from_h3` / `to_h3`, triggers de sincronización
--      automática en INSERT/UPDATE e índices B-tree compuestos para culling O(log N).
--   3. RPCs retrocompatibles `SETOF`:
--      - `get_buildings_in_viewport`
--      - `get_infra_edges_in_viewport`
--      - `get_units_in_viewport`
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FUNCIÓN INVERSA H3 RES 9 -> (LAT, LNG) EN SQL (PARIDAD CON h3Res9ToLatLng)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.h3_res9_to_lat_lng(
  p_h3_index BIGINT,
  OUT lat DOUBLE PRECISION,
  OUT lng DOUBLE PRECISION
)
RETURNS RECORD
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  v_q BIGINT;
  v_r BIGINT;
  v_xm DOUBLE PRECISION;
  v_ym DOUBLE PRECISION;
  v_mercator_r CONSTANT DOUBLE PRECISION := 6378137.0;
  v_edge_m CONSTANT DOUBLE PRECISION := 174.0;
BEGIN
  IF p_h3_index <= 0 THEN
    lat := NULL;
    lng := NULL;
    RETURN;
  END IF;

  v_q := ((p_h3_index >> 24) & 16777215::BIGINT) - 8388608::BIGINT;
  v_r := (p_h3_index & 16777215::BIGINT) - 8388608::BIGINT;

  v_xm := v_edge_m * sqrt(3.0) * (v_q::DOUBLE PRECISION + v_r::DOUBLE PRECISION / 2.0);
  v_ym := v_edge_m * 1.5 * v_r::DOUBLE PRECISION;

  lng := round(((v_xm / v_mercator_r) * (180.0 / pi()))::NUMERIC, 6)::DOUBLE PRECISION;
  lat := round(((2.0 * atan(exp(v_ym / v_mercator_r)) - pi() / 2.0) * (180.0 / pi()))::NUMERIC, 6)::DOUBLE PRECISION;
END;
$$;

REVOKE ALL ON FUNCTION public.h3_res9_to_lat_lng(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.h3_res9_to_lat_lng(BIGINT) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. COLUMNAS ESPACIALES Y BACKFILL IDEMPOTENTE
-- ------------------------------------------------------------------------------

-- 2a. public.buildings
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

UPDATE public.buildings b
SET
  lat = COALESCE(b.lat, coords.lat),
  lng = COALESCE(b.lng, coords.lng)
FROM LATERAL public.h3_res9_to_lat_lng(b.h3_index) AS coords
WHERE b.h3_index IS NOT NULL
  AND (b.lat IS NULL OR b.lng IS NULL);

-- 2b. public.infra_edges
ALTER TABLE public.infra_edges
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS from_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS from_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS to_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS to_lng DOUBLE PRECISION;

UPDATE public.infra_edges e
SET
  from_lat = COALESCE(e.from_lat, fc.lat),
  from_lng = COALESCE(e.from_lng, fc.lng),
  to_lat   = COALESCE(e.to_lat, tc.lat),
  to_lng   = COALESCE(e.to_lng, tc.lng),
  lat      = COALESCE(e.lat, round(((fc.lat + tc.lat) / 2.0)::NUMERIC, 6)::DOUBLE PRECISION),
  lng      = COALESCE(e.lng, round(((fc.lng + tc.lng) / 2.0)::NUMERIC, 6)::DOUBLE PRECISION)
FROM LATERAL public.h3_res9_to_lat_lng(e.from_h3) AS fc,
     LATERAL public.h3_res9_to_lat_lng(e.to_h3) AS tc
WHERE (
  e.lat IS NULL OR e.lng IS NULL
  OR e.from_lat IS NULL OR e.from_lng IS NULL
  OR e.to_lat IS NULL OR e.to_lng IS NULL
);

-- 2c. public.operational_units
ALTER TABLE public.operational_units
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

UPDATE public.operational_units u
SET
  lat = COALESCE(u.lat, coords.lat),
  lng = COALESCE(u.lng, coords.lng)
FROM LATERAL public.h3_res9_to_lat_lng(u.h3_index) AS coords
WHERE u.h3_index IS NOT NULL
  AND (u.lat IS NULL OR u.lng IS NULL);

-- ------------------------------------------------------------------------------
-- 3. TRIGGERS DE SINCRONIZACIÓN AUTOMÁTICA H3 -> (LAT, LNG) EN INSERT/UPDATE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_h3_lat_lng_from_index()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_coords RECORD;
BEGIN
  IF NEW.h3_index IS NOT NULL AND (
    TG_OP = 'INSERT'
    OR NEW.h3_index IS DISTINCT FROM OLD.h3_index
    OR NEW.lat IS NULL
    OR NEW.lng IS NULL
  ) THEN
    IF TG_OP = 'INSERT' AND NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
      RETURN NEW;
    END IF;
    SELECT c.lat, c.lng INTO v_coords FROM public.h3_res9_to_lat_lng(NEW.h3_index) AS c;
    NEW.lat := v_coords.lat;
    NEW.lng := v_coords.lng;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_buildings_sync_lat_lng ON public.buildings;
CREATE TRIGGER trg_buildings_sync_lat_lng
  BEFORE INSERT OR UPDATE OF h3_index, lat, lng ON public.buildings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_h3_lat_lng_from_index();

DROP TRIGGER IF EXISTS trg_operational_units_sync_lat_lng ON public.operational_units;
CREATE TRIGGER trg_operational_units_sync_lat_lng
  BEFORE INSERT OR UPDATE OF h3_index, lat, lng ON public.operational_units
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_h3_lat_lng_from_index();

CREATE OR REPLACE FUNCTION public.sync_infra_edge_lat_lng()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from RECORD;
  v_to RECORD;
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.from_h3 IS DISTINCT FROM OLD.from_h3
     OR NEW.to_h3 IS DISTINCT FROM OLD.to_h3
     OR NEW.lat IS NULL OR NEW.lng IS NULL
     OR NEW.from_lat IS NULL OR NEW.from_lng IS NULL
     OR NEW.to_lat IS NULL OR NEW.to_lng IS NULL
  THEN
    IF NEW.from_h3 IS NOT NULL AND (
      TG_OP = 'INSERT' OR NEW.from_h3 IS DISTINCT FROM OLD.from_h3
      OR NEW.from_lat IS NULL OR NEW.from_lng IS NULL
    ) THEN
      SELECT c.lat, c.lng INTO v_from FROM public.h3_res9_to_lat_lng(NEW.from_h3) AS c;
      NEW.from_lat := COALESCE(NEW.from_lat, v_from.lat);
      NEW.from_lng := COALESCE(NEW.from_lng, v_from.lng);
      IF TG_OP = 'UPDATE' AND NEW.from_h3 IS DISTINCT FROM OLD.from_h3 THEN
        NEW.from_lat := v_from.lat;
        NEW.from_lng := v_from.lng;
      END IF;
    END IF;

    IF NEW.to_h3 IS NOT NULL AND (
      TG_OP = 'INSERT' OR NEW.to_h3 IS DISTINCT FROM OLD.to_h3
      OR NEW.to_lat IS NULL OR NEW.to_lng IS NULL
    ) THEN
      SELECT c.lat, c.lng INTO v_to FROM public.h3_res9_to_lat_lng(NEW.to_h3) AS c;
      NEW.to_lat := COALESCE(NEW.to_lat, v_to.lat);
      NEW.to_lng := COALESCE(NEW.to_lng, v_to.lng);
      IF TG_OP = 'UPDATE' AND NEW.to_h3 IS DISTINCT FROM OLD.to_h3 THEN
        NEW.to_lat := v_to.lat;
        NEW.to_lng := v_to.lng;
      END IF;
    END IF;

    IF NEW.from_lat IS NOT NULL AND NEW.to_lat IS NOT NULL
       AND NEW.from_lng IS NOT NULL AND NEW.to_lng IS NOT NULL THEN
      NEW.lat := round(((NEW.from_lat + NEW.to_lat) / 2.0)::NUMERIC, 6)::DOUBLE PRECISION;
      NEW.lng := round(((NEW.from_lng + NEW.to_lng) / 2.0)::NUMERIC, 6)::DOUBLE PRECISION;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_infra_edges_sync_lat_lng ON public.infra_edges;
CREATE TRIGGER trg_infra_edges_sync_lat_lng
  BEFORE INSERT OR UPDATE OF from_h3, to_h3, lat, lng, from_lat, from_lng, to_lat, to_lng ON public.infra_edges
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_infra_edge_lat_lng();

-- ------------------------------------------------------------------------------
-- 4. ÍNDICES B-TREE COMPUESTOS PARA VIEWPORT CULLING
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_buildings_lat_lng
  ON public.buildings (lat, lng);

CREATE INDEX IF NOT EXISTS idx_buildings_corp_lat_lng
  ON public.buildings (corp_id, lat, lng)
  WHERE corp_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_infra_edges_lat_lng
  ON public.infra_edges (lat, lng);

CREATE INDEX IF NOT EXISTS idx_infra_edges_from_lat_lng
  ON public.infra_edges (from_lat, from_lng);

CREATE INDEX IF NOT EXISTS idx_infra_edges_to_lat_lng
  ON public.infra_edges (to_lat, to_lng);

CREATE INDEX IF NOT EXISTS idx_infra_edges_corp_lat_lng
  ON public.infra_edges (corp_id, lat, lng)
  WHERE corp_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_operational_units_status_lat_lng
  ON public.operational_units (status, lat, lng);

CREATE INDEX IF NOT EXISTS idx_operational_units_corp_status_lat_lng
  ON public.operational_units (corp_id, status, lat, lng);

-- ------------------------------------------------------------------------------
-- 5. RPCs DE VIEWPORT CULLING (CONTRATO v3, SETOF 100% RETROCOMPATIBLE)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_buildings_in_viewport(
  p_min_lat DOUBLE PRECISION,
  p_max_lat DOUBLE PRECISION,
  p_min_lng DOUBLE PRECISION,
  p_max_lng DOUBLE PRECISION,
  p_corp_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 400
)
RETURNS SETOF public.buildings
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT b.*
  FROM public.buildings b
  WHERE b.lat BETWEEN LEAST(p_min_lat, p_max_lat) AND GREATEST(p_min_lat, p_max_lat)
    AND b.lng BETWEEN LEAST(p_min_lng, p_max_lng) AND GREATEST(p_min_lng, p_max_lng)
    AND (p_corp_id IS NULL OR b.corp_id = p_corp_id)
  ORDER BY b.is_historical DESC, b.level DESC, b.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 400), 1), 1000);
$$;

CREATE OR REPLACE FUNCTION public.get_infra_edges_in_viewport(
  p_min_lat DOUBLE PRECISION,
  p_max_lat DOUBLE PRECISION,
  p_min_lng DOUBLE PRECISION,
  p_max_lng DOUBLE PRECISION,
  p_corp_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 400
)
RETURNS SETOF public.infra_edges
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT e.*
  FROM public.infra_edges e
  WHERE (
      (
        e.from_lat BETWEEN LEAST(p_min_lat, p_max_lat) AND GREATEST(p_min_lat, p_max_lat)
        AND e.from_lng BETWEEN LEAST(p_min_lng, p_max_lng) AND GREATEST(p_min_lng, p_max_lng)
      )
      OR (
        e.to_lat BETWEEN LEAST(p_min_lat, p_max_lat) AND GREATEST(p_min_lat, p_max_lat)
        AND e.to_lng BETWEEN LEAST(p_min_lng, p_max_lng) AND GREATEST(p_min_lng, p_max_lng)
      )
      OR (
        e.lat BETWEEN LEAST(p_min_lat, p_max_lat) AND GREATEST(p_min_lat, p_max_lat)
        AND e.lng BETWEEN LEAST(p_min_lng, p_max_lng) AND GREATEST(p_min_lng, p_max_lng)
      )
    )
    AND (p_corp_id IS NULL OR e.corp_id = p_corp_id)
  ORDER BY e.is_historical_anchor DESC, e.created_at DESC, e.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 400), 1), 1000);
$$;

CREATE OR REPLACE FUNCTION public.get_units_in_viewport(
  p_min_lat DOUBLE PRECISION,
  p_max_lat DOUBLE PRECISION,
  p_min_lng DOUBLE PRECISION,
  p_max_lng DOUBLE PRECISION,
  p_corp_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'active',
  p_limit INT DEFAULT 400
)
RETURNS SETOF public.operational_units
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT u.*
  FROM public.operational_units u
  WHERE u.lat BETWEEN LEAST(p_min_lat, p_max_lat) AND GREATEST(p_min_lat, p_max_lat)
    AND u.lng BETWEEN LEAST(p_min_lng, p_max_lng) AND GREATEST(p_min_lng, p_max_lng)
    AND (p_corp_id IS NULL OR u.corp_id = p_corp_id)
    AND (p_status IS NULL OR u.status = p_status)
  ORDER BY u.tier DESC, u.updated_at DESC, u.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 400), 1), 1000);
$$;

-- ------------------------------------------------------------------------------
-- 6. PERMISOS EXPLÍCITOS (MENOR PRIVILEGIO)
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_buildings_in_viewport(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_buildings_in_viewport(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, INT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_infra_edges_in_viewport(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_infra_edges_in_viewport(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, INT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_units_in_viewport(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_units_in_viewport(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, TEXT, INT) TO authenticated;
