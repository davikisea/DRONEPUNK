-- ==============================================================================
-- MIGRACIÓN 20261118000005: ENDURECIMIENTO RLS, RBAC ESTRICTO Y REVOKE DE WRITES
-- ==============================================================================
-- Contrato SQL/RPC v3 (10,000+ CCU):
-- 1. Cierra políticas PERMISSIVE huérfanas de:
--    - 20261107_theatre_cabimas_realtime.sql:
--      spatial_dep_auth_insert_update, fief_const_auth_insert_update, region_op_auth_update
--    - 20261106_state_sovereignty_rbac.sql:
--      municipal_micro_grids_auth_write, territorial_tax_ledgers_auth_write,
--      territories_auth_write, map_hexes_auth_write
-- 2. Implementa RBAC estricto usando (SELECT auth.uid()) y membresía en
--    public.corporation_members / public.profiles.
-- 3. Revoca writes directos de cliente (INSERT, UPDATE, DELETE) en:
--    p2p_market_orders, territorial_battle_sessions, state_sovereignty,
--    tactical_spatial_deployments, tactical_fief_constructions, region_operational_state
--    preservando lecturas públicas autorizadas (GRANT SELECT + política FOR SELECT).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FUNCIÓN HELPER RBAC: public.is_sovereignty_authorized
-- ------------------------------------------------------------------------------
-- Reemplaza la implementación previa que usaba auth.uid() sin initplan y
-- permitía cross-clan por OR cm.role IN ('leader', 'officer') sobre clan_members.
-- Ahora valida membresía estricta en corporation_members o rol admin/gestor en profiles.
CREATE OR REPLACE FUNCTION public.is_sovereignty_authorized(target_clan_id VARCHAR(64))
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    (
      target_clan_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.corporation_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND cm.corp_id::text = target_clan_id
          AND cm.role IN ('majority_shareholder', 'shareholder')
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles pp
      WHERE pp.id = (SELECT auth.uid())
        AND (
          pp.is_admin = true
          OR pp.metadata->>'is_faction_manager' = 'true'
        )
    );
$$;

-- Actualizar municipal_managers_auth_write para usar (SELECT auth.uid())
DROP POLICY IF EXISTS "municipal_managers_auth_write" ON public.municipal_managers;
CREATE POLICY "municipal_managers_auth_write"
  ON public.municipal_managers
  FOR ALL
  TO authenticated
  USING (
    public.is_sovereignty_authorized(appointed_by_clan_id)
    OR manager_user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_sovereignty_authorized(appointed_by_clan_id)
    OR manager_user_id = (SELECT auth.uid())
  );

-- ------------------------------------------------------------------------------
-- 2. CIERRE DE POLÍTICAS PERMISSIVE HUÉRFANAS EN TABLAS DE 20261106 (RBAC ESTRICTO)
-- ------------------------------------------------------------------------------

-- 2a. public.municipal_micro_grids
ALTER TABLE public.municipal_micro_grids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "municipal_micro_grids_public_read" ON public.municipal_micro_grids;
CREATE POLICY "municipal_micro_grids_public_read"
  ON public.municipal_micro_grids
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "municipal_micro_grids_auth_write" ON public.municipal_micro_grids;
DROP POLICY IF EXISTS "municipal_micro_grids_rbac_write" ON public.municipal_micro_grids;
CREATE POLICY "municipal_micro_grids_rbac_write"
  ON public.municipal_micro_grids
  FOR ALL
  TO authenticated
  USING (
    public.is_sovereignty_authorized(controlling_clan_id)
  )
  WITH CHECK (
    public.is_sovereignty_authorized(controlling_clan_id)
  );

-- 2b. public.territorial_tax_ledgers
ALTER TABLE public.territorial_tax_ledgers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "territorial_tax_ledgers_public_read" ON public.territorial_tax_ledgers;
CREATE POLICY "territorial_tax_ledgers_public_read"
  ON public.territorial_tax_ledgers
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "territorial_tax_ledgers_auth_write" ON public.territorial_tax_ledgers;
DROP POLICY IF EXISTS "territorial_tax_ledgers_rbac_write" ON public.territorial_tax_ledgers;
CREATE POLICY "territorial_tax_ledgers_rbac_write"
  ON public.territorial_tax_ledgers
  FOR ALL
  TO authenticated
  USING (
    public.is_sovereignty_authorized(controlling_clan_id)
  )
  WITH CHECK (
    public.is_sovereignty_authorized(controlling_clan_id)
  );

-- 2c. public.territories
ALTER TABLE public.territories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "territories_public_read" ON public.territories;
CREATE POLICY "territories_public_read"
  ON public.territories
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "territories_auth_write" ON public.territories;
DROP POLICY IF EXISTS "territories_rbac_write" ON public.territories;
CREATE POLICY "territories_rbac_write"
  ON public.territories
  FOR ALL
  TO authenticated
  USING (
    manager_user_id = (SELECT auth.uid())
    OR (
      owner_corp_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.corporation_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND cm.corp_id = territories.owner_corp_id
          AND cm.role IN ('majority_shareholder', 'shareholder')
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles pp
      WHERE pp.id = (SELECT auth.uid())
        AND (
          pp.is_admin = true
          OR pp.metadata->>'is_faction_manager' = 'true'
        )
    )
  )
  WITH CHECK (
    manager_user_id = (SELECT auth.uid())
    OR (
      owner_corp_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.corporation_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND cm.corp_id = territories.owner_corp_id
          AND cm.role IN ('majority_shareholder', 'shareholder')
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles pp
      WHERE pp.id = (SELECT auth.uid())
        AND (
          pp.is_admin = true
          OR pp.metadata->>'is_faction_manager' = 'true'
        )
    )
  );

-- 2d. public.map_hexes
ALTER TABLE public.map_hexes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_hexes_public_read" ON public.map_hexes;
CREATE POLICY "map_hexes_public_read"
  ON public.map_hexes
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "map_hexes_auth_write" ON public.map_hexes;
DROP POLICY IF EXISTS "map_hexes_rbac_write" ON public.map_hexes;
CREATE POLICY "map_hexes_rbac_write"
  ON public.map_hexes
  FOR ALL
  TO authenticated
  USING (
    (
      owner_corp_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.corporation_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND cm.corp_id = map_hexes.owner_corp_id
          AND cm.role IN ('majority_shareholder', 'shareholder')
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles pp
      WHERE pp.id = (SELECT auth.uid())
        AND (
          pp.is_admin = true
          OR pp.metadata->>'is_faction_manager' = 'true'
        )
    )
  )
  WITH CHECK (
    (
      owner_corp_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.corporation_members cm
        WHERE cm.user_id = (SELECT auth.uid())
          AND cm.corp_id = map_hexes.owner_corp_id
          AND cm.role IN ('majority_shareholder', 'shareholder')
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles pp
      WHERE pp.id = (SELECT auth.uid())
        AND (
          pp.is_admin = true
          OR pp.metadata->>'is_faction_manager' = 'true'
        )
    )
  );

-- ------------------------------------------------------------------------------
-- 3. CIERRE DE HUÉRFANAS EN 20261107 + REVOCACIÓN DE WRITES DIRECTOS DE CLIENTE
-- ------------------------------------------------------------------------------
-- Todas las escrituras en estas 6 tablas deben pasar exclusivamente por RPCs
-- SECURITY DEFINER autoritativas o service_role. Se preservan las lecturas públicas.

-- 3a. public.tactical_spatial_deployments
ALTER TABLE public.tactical_spatial_deployments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "spatial_dep_auth_insert_update" ON public.tactical_spatial_deployments;
DROP POLICY IF EXISTS "Allow authenticated write tactical_spatial_deployments" ON public.tactical_spatial_deployments;
DROP POLICY IF EXISTS "tactical_spatial_deployments_corp_write" ON public.tactical_spatial_deployments;
DROP POLICY IF EXISTS "spatial_dep_public_read" ON public.tactical_spatial_deployments;
CREATE POLICY "spatial_dep_public_read"
  ON public.tactical_spatial_deployments
  FOR SELECT
  USING (true);

REVOKE ALL ON public.tactical_spatial_deployments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tactical_spatial_deployments TO anon, authenticated;

-- 3b. public.tactical_fief_constructions
ALTER TABLE public.tactical_fief_constructions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fief_const_auth_insert_update" ON public.tactical_fief_constructions;
DROP POLICY IF EXISTS "Allow authenticated write tactical_fief_constructions" ON public.tactical_fief_constructions;
DROP POLICY IF EXISTS "tactical_fief_constructions_corp_write" ON public.tactical_fief_constructions;
DROP POLICY IF EXISTS "fief_const_public_read" ON public.tactical_fief_constructions;
CREATE POLICY "fief_const_public_read"
  ON public.tactical_fief_constructions
  FOR SELECT
  USING (true);

REVOKE ALL ON public.tactical_fief_constructions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tactical_fief_constructions TO anon, authenticated;

-- 3c. public.region_operational_state
ALTER TABLE public.region_operational_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "region_op_auth_update" ON public.region_operational_state;
DROP POLICY IF EXISTS "Allow authenticated write region_operational_state" ON public.region_operational_state;
DROP POLICY IF EXISTS "region_operational_state_corp_write" ON public.region_operational_state;
DROP POLICY IF EXISTS "region_op_public_read" ON public.region_operational_state;
CREATE POLICY "region_op_public_read"
  ON public.region_operational_state
  FOR SELECT
  USING (true);

REVOKE ALL ON public.region_operational_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.region_operational_state TO anon, authenticated;

-- 3d. public.state_sovereignty
ALTER TABLE public.state_sovereignty ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "state_sovereignty_leader_update" ON public.state_sovereignty;
DROP POLICY IF EXISTS "state_sovereignty_public_read" ON public.state_sovereignty;
CREATE POLICY "state_sovereignty_public_read"
  ON public.state_sovereignty
  FOR SELECT
  USING (true);

REVOKE ALL ON public.state_sovereignty FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.state_sovereignty TO anon, authenticated;

-- 3e. public.p2p_market_orders
ALTER TABLE public.p2p_market_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "p2p_market_orders_manage_own" ON public.p2p_market_orders;
DROP POLICY IF EXISTS "p2p_market_orders_view" ON public.p2p_market_orders;
CREATE POLICY "p2p_market_orders_view"
  ON public.p2p_market_orders
  FOR SELECT
  USING (true);

REVOKE ALL ON public.p2p_market_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.p2p_market_orders TO anon, authenticated;

-- 3f. public.territorial_battle_sessions
ALTER TABLE public.territorial_battle_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "battle_sessions_read_all" ON public.territorial_battle_sessions;
CREATE POLICY "battle_sessions_read_all"
  ON public.territorial_battle_sessions
  FOR SELECT
  USING (true);

REVOKE ALL ON public.territorial_battle_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.territorial_battle_sessions TO anon, authenticated;
