-- ==============================================================================
-- MIGRACIÓN CANÓNICA: SOBERANÍA TERRITORIAL DE ESTADOS Y CONTROL RBAC C4ISR
-- ==============================================================================
-- Especificación: docs/PROPUESTA_INGENIERIA_MAPA_METAPOLITICA_ALICE_CABIMAS.md
-- Tabla: public.state_sovereignty
-- RLS: Lectura pública; Escritura restringida a Líderes de Clan y Gestores de Facción
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.state_sovereignty (
  state_id VARCHAR(64) PRIMARY KEY,
  country_id VARCHAR(64) NOT NULL DEFAULT 'COUNTRY_VEN',
  canonical_country_name TEXT NOT NULL DEFAULT 'República de Venezuela',
  custom_country_name TEXT NOT NULL DEFAULT 'República Soberana de Venezuela',
  canonical_state_name TEXT NOT NULL,
  custom_state_name TEXT NOT NULL,
  controlling_faction_id VARCHAR(32) NOT NULL DEFAULT 'blue_moon',
  controlling_clan_id VARCHAR(64) NOT NULL DEFAULT 'clan-ferro',
  tcp_current INTEGER NOT NULL DEFAULT 10000 CHECK (tcp_current >= 0 AND tcp_current <= 10000),
  tcp_max INTEGER NOT NULL DEFAULT 10000,
  gdp_war_credits_per_hour INTEGER NOT NULL DEFAULT 5000,
  defense_level INTEGER NOT NULL DEFAULT 3 CHECK (defense_level >= 1 AND defense_level <= 5),
  custom_motto TEXT,
  sovereign_proclamation TEXT,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.state_sovereignty ENABLE ROW LEVEL SECURITY;

-- Índice para consultas rápidas por facción y país
CREATE INDEX IF NOT EXISTS idx_state_sovereignty_faction ON public.state_sovereignty(controlling_faction_id);
CREATE INDEX IF NOT EXISTS idx_state_sovereignty_country ON public.state_sovereignty(country_id);

-- Política 1: Lectura libre para todos los comandantes y observadores en el mapa
CREATE POLICY "state_sovereignty_public_read"
  ON public.state_sovereignty
  FOR SELECT
  USING (true);

-- Función de ayuda de seguridad para comprobar rol de líder de clan o gestor de facción
CREATE OR REPLACE FUNCTION public.is_sovereignty_authorized(target_clan_id VARCHAR(64))
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clan_members cm
    WHERE cm.user_id = auth.uid()
      AND (cm.clan_id = target_clan_id OR cm.role IN ('leader', 'officer'))
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles pp
    WHERE pp.id = auth.uid()
      AND (pp.is_admin = true OR pp.metadata->>'is_faction_manager' = 'true')
  );
$$;

-- Política 2: Inserción y Actualización exclusiva para comandantes autorizados
CREATE POLICY "state_sovereignty_leader_update"
  ON public.state_sovereignty
  FOR ALL
  TO authenticated
  USING (
    public.is_sovereignty_authorized(controlling_clan_id)
  )
  WITH CHECK (
    public.is_sovereignty_authorized(controlling_clan_id)
  );

-- Comentarios explicativos canónicos
COMMENT ON TABLE public.state_sovereignty IS 'SSOT de soberanía estatal, nombres proclamados de países/estados y control territorial en GEOTACTICS.';

-- ==============================================================================
-- EXTENSIÓN: CEREBRO GEOTÁCTICO PERSISTENTE (MICRO-CELDAS, GESTORES Y FISCALIDAD)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.municipal_micro_grids (
  municipality_id VARCHAR(64) PRIMARY KEY,
  state_id VARCHAR(64) NOT NULL,
  total_cells INTEGER NOT NULL DEFAULT 500 CHECK (total_cells = 500),
  grid_columns INTEGER NOT NULL DEFAULT 25,
  grid_rows INTEGER NOT NULL DEFAULT 20,
  cell_size_meters INTEGER NOT NULL DEFAULT 100,
  controlling_clan_id VARCHAR(64),
  majority_threshold NUMERIC(4,2) NOT NULL DEFAULT 0.50,
  sovereignty_ratio_by_clan JSONB NOT NULL DEFAULT '{}'::jsonb,
  cells_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_slots_unlocked BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.municipal_micro_grids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "municipal_micro_grids_public_read" ON public.municipal_micro_grids;
CREATE POLICY "municipal_micro_grids_public_read"
  ON public.municipal_micro_grids
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "municipal_micro_grids_auth_write" ON public.municipal_micro_grids;
CREATE POLICY "municipal_micro_grids_auth_write"
  ON public.municipal_micro_grids
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.municipal_managers (
  municipality_id VARCHAR(64) PRIMARY KEY,
  state_id VARCHAR(64) NOT NULL,
  manager_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  manager_user_name TEXT NOT NULL DEFAULT 'Sin Asignar',
  appointed_by_clan_id VARCHAR(64) NOT NULL,
  early_warning_radar_active BOOLEAN NOT NULL DEFAULT true,
  rapid_repair_workshop_active BOOLEAN NOT NULL DEFAULT true,
  sam_battery_active BOOLEAN NOT NULL DEFAULT true,
  local_tax_rate NUMERIC(4,2) NOT NULL DEFAULT 0.08 CHECK (local_tax_rate >= 0.05 AND local_tax_rate <= 0.50),
  corruption_risk_score INTEGER NOT NULL DEFAULT 0 CHECK (corruption_risk_score >= 0 AND corruption_risk_score <= 100),
  audit_trail_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.municipal_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "municipal_managers_public_read" ON public.municipal_managers;
CREATE POLICY "municipal_managers_public_read"
  ON public.municipal_managers
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "municipal_managers_auth_write" ON public.municipal_managers;
CREATE POLICY "municipal_managers_auth_write"
  ON public.municipal_managers
  FOR ALL
  TO authenticated
  USING (
    public.is_sovereignty_authorized(appointed_by_clan_id)
    OR manager_user_id = auth.uid()
  )
  WITH CHECK (
    public.is_sovereignty_authorized(appointed_by_clan_id)
    OR manager_user_id = auth.uid()
  );

CREATE TABLE IF NOT EXISTS public.territorial_tax_ledgers (
  municipality_id VARCHAR(64) PRIMARY KEY,
  controlling_clan_id VARCHAR(64),
  allied_tax_rate NUMERIC(4,2) NOT NULL DEFAULT 0.08 CHECK (allied_tax_rate >= 0.05 AND allied_tax_rate <= 0.10),
  rival_retention_rate NUMERIC(4,2) NOT NULL DEFAULT 0.50 CHECK (rival_retention_rate >= 0.10 AND rival_retention_rate <= 0.50),
  treaty_override_rate JSONB NOT NULL DEFAULT '{}'::jsonb,
  exclusive_resource_node VARCHAR(32) NOT NULL DEFAULT 'oil_energy',
  accumulated_vault_tax_ec INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.territorial_tax_ledgers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "territorial_tax_ledgers_public_read" ON public.territorial_tax_ledgers;
CREATE POLICY "territorial_tax_ledgers_public_read"
  ON public.territorial_tax_ledgers
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "territorial_tax_ledgers_auth_write" ON public.territorial_tax_ledgers;
CREATE POLICY "territorial_tax_ledgers_auth_write"
  ON public.territorial_tax_ledgers
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.rpc_evaluate_signal_capture_tick(
  p_municipality_id VARCHAR(64),
  p_drones_payload JSONB DEFAULT '[]'::jsonb,
  p_tick_minutes INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_grid RECORD;
BEGIN
  SELECT * INTO v_grid
  FROM public.municipal_micro_grids
  WHERE municipality_id = p_municipality_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'municipality_id', p_municipality_id,
      'reason', 'Malla municipal no inicializada'
    );
  END IF;

  UPDATE public.municipal_micro_grids
  SET updated_at = timezone('utc'::text, now())
  WHERE municipality_id = p_municipality_id;

  RETURN jsonb_build_object(
    'success', true,
    'municipality_id', p_municipality_id,
    'tick_minutes', GREATEST(1, p_tick_minutes),
    'controlling_clan_id', v_grid.controlling_clan_id,
    'public_slots_unlocked', v_grid.public_slots_unlocked
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_settle_symbiotic_extraction_tax(
  p_municipality_id VARCHAR(64),
  p_extractor_clan_id VARCHAR(64),
  p_gross_yield_ec INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ledger RECORD;
  v_tax_rate NUMERIC := 0.08;
  v_retained_ec INTEGER := 0;
  v_net_ec INTEGER := 0;
  v_is_allied BOOLEAN := false;
BEGIN
  SELECT * INTO v_ledger
  FROM public.territorial_tax_ledgers
  WHERE municipality_id = p_municipality_id;

  IF NOT FOUND THEN
    v_is_allied := true;
    v_tax_rate := 0.08;
    v_retained_ec := FLOOR(GREATEST(0, p_gross_yield_ec) * v_tax_rate);
    v_net_ec := GREATEST(0, p_gross_yield_ec) - v_retained_ec;
    RETURN jsonb_build_object(
      'municipality_id', p_municipality_id,
      'gross_ec', p_gross_yield_ec,
      'retained_tax_ec', v_retained_ec,
      'net_ec', v_net_ec,
      'applied_rate', v_tax_rate,
      'is_allied', v_is_allied
    );
  END IF;

  IF v_ledger.controlling_clan_id = p_extractor_clan_id THEN
    v_is_allied := true;
    v_tax_rate := v_ledger.allied_tax_rate;
  ELSIF (v_ledger.treaty_override_rate ? p_extractor_clan_id) THEN
    v_is_allied := true;
    v_tax_rate := (v_ledger.treaty_override_rate->>p_extractor_clan_id)::NUMERIC;
  ELSE
    v_is_allied := false;
    v_tax_rate := v_ledger.rival_retention_rate;
  END IF;

  v_retained_ec := FLOOR(GREATEST(0, p_gross_yield_ec) * v_tax_rate);
  v_net_ec := GREATEST(0, p_gross_yield_ec) - v_retained_ec;

  UPDATE public.territorial_tax_ledgers
  SET accumulated_vault_tax_ec = accumulated_vault_tax_ec + v_retained_ec,
      updated_at = timezone('utc'::text, now())
  WHERE municipality_id = p_municipality_id;

  RETURN jsonb_build_object(
    'municipality_id', p_municipality_id,
    'controlling_clan_id', v_ledger.controlling_clan_id,
    'gross_ec', p_gross_yield_ec,
    'retained_tax_ec', v_retained_ec,
    'net_ec', v_net_ec,
    'applied_rate', v_tax_rate,
    'is_allied', v_is_allied
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_execute_municipal_manager_action(
  p_municipality_id VARCHAR(64),
  p_action_type VARCHAR(64),
  p_new_value TEXT,
  p_is_suspicious BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mgr RECORD;
  v_audit_entry JSONB;
BEGIN
  SELECT * INTO v_mgr
  FROM public.municipal_managers
  WHERE municipality_id = p_municipality_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Gestor Municipal no encontrado');
  END IF;

  v_audit_entry := jsonb_build_object(
    'id', uuid_generate_v4(),
    'municipality_id', p_municipality_id,
    'actor_user_id', auth.uid(),
    'action_type', p_action_type,
    'new_value', p_new_value,
    'is_suspicious_corruption', p_is_suspicious,
    'timestamp', timezone('utc'::text, now())
  );

  UPDATE public.municipal_managers
  SET corruption_risk_score = LEAST(100, corruption_risk_score + CASE WHEN p_is_suspicious THEN 25 ELSE 0 END),
      audit_trail_logs = COALESCE(audit_trail_logs, '[]'::jsonb) || jsonb_build_array(v_audit_entry),
      updated_at = timezone('utc'::text, now())
  WHERE municipality_id = p_municipality_id;

  RETURN jsonb_build_object(
    'success', true,
    'municipality_id', p_municipality_id,
    'audit_entry', v_audit_entry
  );
END;
$$;

-- ==============================================================================
-- EXTENSIÓN H3 SPARSE MAP: TERRITORIES, MAP_HEXES, CORPORATIONS, BUILDINGS, DRONES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.territories (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  level VARCHAR(20) NOT NULL CHECK (level IN ('COUNTRY', 'STATE', 'MUNICIPALITY')),
  parent_id VARCHAR(32),
  owner_corp_id UUID,
  manager_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  control_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  total_hexes INT NOT NULL DEFAULT 500,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.territories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "territories_public_read" ON public.territories;
CREATE POLICY "territories_public_read"
  ON public.territories
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "territories_auth_write" ON public.territories;
CREATE POLICY "territories_auth_write"
  ON public.territories
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.map_hexes (
  h3_index BIGINT PRIMARY KEY,
  municipality_id VARCHAR(32) REFERENCES public.territories(id) ON DELETE CASCADE,
  terrain_type VARCHAR(20) NOT NULL DEFAULT 'PLAIN',
  owner_corp_id UUID,
  capture_progress NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  contesting_corp_id UUID,
  last_updated_tick BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_map_hexes_municipality ON public.map_hexes(municipality_id);
ALTER TABLE public.map_hexes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_hexes_public_read" ON public.map_hexes;
CREATE POLICY "map_hexes_public_read"
  ON public.map_hexes
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "map_hexes_auth_write" ON public.map_hexes;
CREATE POLICY "map_hexes_auth_write"
  ON public.map_hexes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.corporations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  tag VARCHAR(5) UNIQUE NOT NULL,
  leader_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  treasury_alloys BIGINT NOT NULL DEFAULT 0,
  treasury_fuel BIGINT NOT NULL DEFAULT 0,
  treasury_chips BIGINT NOT NULL DEFAULT 0,
  controlled_municipalities_count INT NOT NULL DEFAULT 0,
  controlled_states_count INT NOT NULL DEFAULT 0,
  tech_level INT NOT NULL DEFAULT 1,
  active_state_perks JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT max_3_global_perks CHECK (jsonb_array_length(active_state_perks) <= 3)
);

ALTER TABLE public.corporations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "corporations_public_read" ON public.corporations;
CREATE POLICY "corporations_public_read"
  ON public.corporations
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "corporations_auth_write" ON public.corporations;
CREATE POLICY "corporations_auth_write"
  ON public.corporations
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.buildings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  h3_index BIGINT NOT NULL UNIQUE,
  municipality_id VARCHAR(32) REFERENCES public.territories(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  corp_id UUID REFERENCES public.corporations(id) ON DELETE SET NULL,
  building_type VARCHAR(30) NOT NULL,
  level INT NOT NULL DEFAULT 1,
  hp NUMERIC(4,1) NOT NULL DEFAULT 20.0,
  stored_resources JSONB NOT NULL DEFAULT '{"alloys": 0, "fuel": 0, "chips": 0}'::jsonb,
  tax_rate NUMERIC(4,2) NOT NULL DEFAULT 0.10,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buildings_public_read" ON public.buildings;
CREATE POLICY "buildings_public_read"
  ON public.buildings
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "buildings_auth_write" ON public.buildings;
CREATE POLICY "buildings_auth_write"
  ON public.buildings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.drones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  corp_id UUID REFERENCES public.corporations(id) ON DELETE SET NULL,
  unit_type VARCHAR(30) NOT NULL,
  current_h3 BIGINT NOT NULL,
  hp NUMERIC(4,1) NOT NULL DEFAULT 10.0,
  fuel NUMERIC(5,1) NOT NULL,
  max_fuel NUMERIC(5,1) NOT NULL,
  waypoints BIGINT[] NOT NULL DEFAULT '{}',
  current_wp_index INT NOT NULL DEFAULT 0,
  patrol_direction INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'IDLE',
  ticks_on_building INT NOT NULL DEFAULT 0,
  ticks_deployed INT NOT NULL DEFAULT 0,
  ai_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_tick_processed BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_drones_current_h3 ON public.drones(current_h3);
ALTER TABLE public.drones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drones_public_read" ON public.drones;
CREATE POLICY "drones_public_read"
  ON public.drones
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "drones_auth_write" ON public.drones;
CREATE POLICY "drones_auth_write"
  ON public.drones
  FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.rpc_recalculate_geopolitical_control(
  p_current_tick BIGINT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_count INT := 0;
BEGIN
  UPDATE public.territories t
  SET owner_corp_id = sub.dominant_corp,
      control_percentage = sub.pct,
      updated_at = timezone('utc'::text, now())
  FROM (
    SELECT
      mh.municipality_id,
      mh.owner_corp_id AS dominant_corp,
      ROUND((COUNT(*)::NUMERIC / GREATEST(1, MAX(ter.total_hexes))) * 100.0, 2) AS pct
    FROM public.map_hexes mh
    JOIN public.territories ter ON ter.id = mh.municipality_id
    WHERE mh.owner_corp_id IS NOT NULL
    GROUP BY mh.municipality_id, mh.owner_corp_id
    HAVING (COUNT(*)::NUMERIC / GREATEST(1, MAX(ter.total_hexes))) > 0.50
  ) sub
  WHERE t.id = sub.municipality_id
    AND t.level = 'MUNICIPALITY';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'tick', p_current_tick,
    'municipalities_updated', v_updated_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_cleanup_stale_sparse_hexes(
  p_current_tick BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INT := 0;
BEGIN
  DELETE FROM public.map_hexes
  WHERE owner_corp_id IS NULL
    AND capture_progress = 0
    AND last_updated_tick < (p_current_tick - 672); -- 7 días * 96 ticks/día = 672 ticks

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'purged_hexes', v_deleted_count
  );
END;
$$;
