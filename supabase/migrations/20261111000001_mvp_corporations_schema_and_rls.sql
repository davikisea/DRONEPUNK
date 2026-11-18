-- ==============================================================================
-- MIGRACIÓN MVP M1: CORPORACIONES, GOBERNANZA ACCIONARIA, EDIFICIOS Y RLS
-- ==============================================================================
-- 1. Unificación en public.corporations + public.corporation_members
--    (majority_shareholder, shareholder, member con permisos delegados).
-- 2. Bandera técnica profiles.is_admin (sin bypasses de juego) + profiles.corp_id.
-- 3. Consolidación de public.buildings con last_collected_at para cálculo horario en DB.
-- 4. Extensión de user_unit_hangar (corp_id, slot_type vanguard<=4 / reserve<=12)
--    y creación de public.operational_units (owner_user_id + corp_id).
-- 5. Tabla economy_rpc_idempotency y cierre de políticas RLS abiertas.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PROFILES: BANDERA TÉCNICA is_admin, metadata Y corp_id
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS corp_id UUID REFERENCES public.corporations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_profiles_corp_id ON public.profiles(corp_id);

-- ------------------------------------------------------------------------------
-- 2. CORPORATIONS: TESORERÍA COMPLETA Y GOBERNANZA ACCIONARIA
-- ------------------------------------------------------------------------------
ALTER TABLE public.corporations
  ADD COLUMN IF NOT EXISTS treasury_ec BIGINT NOT NULL DEFAULT 0 CHECK (treasury_ec >= 0),
  ADD COLUMN IF NOT EXISTS treasury_rare_earth BIGINT NOT NULL DEFAULT 0 CHECK (treasury_rare_earth >= 0),
  ADD COLUMN IF NOT EXISTS treasury_composites BIGINT NOT NULL DEFAULT 0 CHECK (treasury_composites >= 0),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- Cerrar política abierta heredada de 20261106_state_sovereignty_rbac.sql
DROP POLICY IF EXISTS "corporations_auth_write" ON public.corporations;
DROP POLICY IF EXISTS "corporations_public_read" ON public.corporations;
CREATE POLICY "corporations_public_read"
  ON public.corporations
  FOR SELECT
  USING (true);

CREATE TABLE IF NOT EXISTS public.corporation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id UUID NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'member'
    CHECK (role IN ('majority_shareholder', 'shareholder', 'member')),
  shares INTEGER NOT NULL DEFAULT 0 CHECK (shares >= 0),
  delegated_permissions JSONB NOT NULL DEFAULT '{
    "can_use_treasury": false,
    "can_construct": false,
    "can_remodel": false,
    "can_collect": false,
    "can_purchase_units": false,
    "can_control_units": false
  }'::jsonb,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_corporation_member UNIQUE (corp_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_corp_members_user ON public.corporation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_corp_members_corp ON public.corporation_members(corp_id, role);

ALTER TABLE public.corporation_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "corporation_members_read" ON public.corporation_members;
CREATE POLICY "corporation_members_read"
  ON public.corporation_members
  FOR SELECT
  TO authenticated
  USING (true);

-- ------------------------------------------------------------------------------
-- 3. BUILDINGS: PRODUCCIÓN HORARIA EN DB (last_collected_at) Y RLS ESTRICTO
-- ------------------------------------------------------------------------------
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS last_collected_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_buildings_corp ON public.buildings(corp_id);
CREATE INDEX IF NOT EXISTS idx_buildings_municipality ON public.buildings(municipality_id);

-- Cerrar política abierta heredada de 20261106_state_sovereignty_rbac.sql
DROP POLICY IF EXISTS "buildings_auth_write" ON public.buildings;
DROP POLICY IF EXISTS "buildings_public_read" ON public.buildings;
CREATE POLICY "buildings_public_read"
  ON public.buildings
  FOR SELECT
  USING (true);

-- ------------------------------------------------------------------------------
-- 4. CIERRE DE RLS MULTI-TENANT EN TABLAS DE TEATRO Y DESPLIEGUE
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated write tactical_fief_constructions" ON public.tactical_fief_constructions;
DROP POLICY IF EXISTS "tactical_fief_constructions_corp_write" ON public.tactical_fief_constructions;
CREATE POLICY "tactical_fief_constructions_corp_write"
  ON public.tactical_fief_constructions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.corp_id IS NOT NULL
        AND p.corp_id::text = tactical_fief_constructions.clan_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.corp_id IS NOT NULL
        AND p.corp_id::text = tactical_fief_constructions.clan_id
    )
  );

DROP POLICY IF EXISTS "Allow authenticated write tactical_spatial_deployments" ON public.tactical_spatial_deployments;
DROP POLICY IF EXISTS "tactical_spatial_deployments_corp_write" ON public.tactical_spatial_deployments;
CREATE POLICY "tactical_spatial_deployments_corp_write"
  ON public.tactical_spatial_deployments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.corp_id IS NOT NULL
        AND p.corp_id::text = tactical_spatial_deployments.clan_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.corp_id IS NOT NULL
        AND p.corp_id::text = tactical_spatial_deployments.clan_id
    )
  );

DROP POLICY IF EXISTS "Allow authenticated write region_operational_state" ON public.region_operational_state;
DROP POLICY IF EXISTS "region_operational_state_corp_write" ON public.region_operational_state;
CREATE POLICY "region_operational_state_corp_write"
  ON public.region_operational_state
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.corp_id IS NOT NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.corp_id IS NOT NULL
    )
  );

-- ------------------------------------------------------------------------------
-- 5. HANGAR FÍSICO (4 VANGUARDIA + 12 RESERVA = 16 CHASIS) Y OPERATIONAL_UNITS
-- ------------------------------------------------------------------------------
ALTER TABLE public.user_unit_hangar
  ADD COLUMN IF NOT EXISTS corp_id UUID REFERENCES public.corporations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS building_id UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slot_type VARCHAR(16) NOT NULL DEFAULT 'reserve'
    CHECK (slot_type IN ('vanguard', 'reserve'));

CREATE INDEX IF NOT EXISTS idx_user_unit_hangar_corp ON public.user_unit_hangar(corp_id);

CREATE OR REPLACE FUNCTION public.check_user_hangar_slot_distribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vanguard INTEGER := 0;
  v_reserve INTEGER := 0;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN slot_type = 'vanguard' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN slot_type = 'reserve' THEN quantity ELSE 0 END), 0)
  INTO v_vanguard, v_reserve
  FROM public.user_unit_hangar
  WHERE user_id = NEW.user_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF NEW.slot_type = 'vanguard' THEN
    v_vanguard := v_vanguard + NEW.quantity;
  ELSE
    v_reserve := v_reserve + NEW.quantity;
  END IF;

  IF v_vanguard > 4 THEN
    RAISE EXCEPTION 'Límite de Vanguardia excedido: Máximo 4 chasis en Vanguardia (Actual proyectado: %)', v_vanguard;
  END IF;

  IF v_reserve > 12 THEN
    RAISE EXCEPTION 'Límite de Reserva excedido: Máximo 12 chasis en Reserva (Actual proyectado: %)', v_reserve;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_hangar_slots ON public.user_unit_hangar;
CREATE TRIGGER trg_enforce_user_hangar_slots
  BEFORE INSERT OR UPDATE OF quantity, slot_type ON public.user_unit_hangar
  FOR EACH ROW
  EXECUTE FUNCTION public.check_user_hangar_slot_distribution();

-- Solo lectura directa para el usuario y su corporación; mutaciones vía RPCs atómicos
DROP POLICY IF EXISTS "user_unit_hangar_own" ON public.user_unit_hangar;
DROP POLICY IF EXISTS "user_unit_hangar_select" ON public.user_unit_hangar;
CREATE POLICY "user_unit_hangar_select"
  ON public.user_unit_hangar
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (
      corp_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.corporation_members cm
        WHERE cm.corp_id = user_unit_hangar.corp_id
          AND cm.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE TABLE IF NOT EXISTS public.operational_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  corp_id UUID NOT NULL REFERENCES public.corporations(id) ON DELETE CASCADE,
  hangar_slot_id UUID REFERENCES public.user_unit_hangar(id) ON DELETE SET NULL,
  unit_code VARCHAR(32) NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 5),
  hp INTEGER NOT NULL DEFAULT 100 CHECK (hp BETWEEN 1 AND 100),
  h3_index BIGINT NOT NULL,
  municipality_id VARCHAR(32) REFERENCES public.territories(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'engaged', 'recalled', 'destroyed')),
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_operational_units_owner ON public.operational_units(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_operational_units_corp ON public.operational_units(corp_id, status);
CREATE INDEX IF NOT EXISTS idx_operational_units_h3 ON public.operational_units(h3_index);

ALTER TABLE public.operational_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operational_units_read" ON public.operational_units;
CREATE POLICY "operational_units_read"
  ON public.operational_units
  FOR SELECT
  TO authenticated
  USING (true);

-- ------------------------------------------------------------------------------
-- 6. IDEMPOTENCIA DE RPCs ECONÓMICOS Y REALTIME CDC
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.economy_rpc_idempotency (
  idempotency_key UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rpc_name VARCHAR(64) NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.economy_rpc_idempotency ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'buildings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.buildings;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'operational_units'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.operational_units;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'corporations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.corporations;
    END IF;
  END IF;
END;
$$;
