-- ==============================================================================
-- MIGRATION: 20261118000009_wal_replica_identity_and_broadcast_triggers.sql
-- OBJETIVO (Contrato SQL/RPC v3 - 10,000+ CCU):
--   1. Cambiar REPLICA IDENTITY FULL a DEFAULT en territorial_battle_sessions,
--      tactical_spatial_deployments, tactical_fief_constructions y tablas de
--      alto churn para eliminar el WAL bloat en UPDATE/DELETE.
--   2. Remover tablas de alto churn (buildings, infra_edges, operational_units,
--      unit_command_schedules, unit_action_logs, p2p_market_orders,
--      state_sovereignty, territorial_battle_sessions) de supabase_realtime.
--   3. Crear función de trigger unificada y triggers AFTER INSERT OR UPDATE OR
--      DELETE que emitan el payload Broadcast v3 por canal segmentado usando
--      realtime.send (con guarda en pg_proc) y pg_notify como fallback.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REPLICA IDENTITY DEFAULT EN TABLAS DE ALTO CHURN
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'territorial_battle_sessions',
    'tactical_spatial_deployments',
    'tactical_fief_constructions',
    'region_operational_state',
    'state_sovereignty',
    'buildings',
    'infra_edges',
    'operational_units',
    'unit_command_schedules',
    'unit_action_logs',
    'p2p_market_orders',
    'match_action_deltas',
    'matchmaking_queue',
    'active_matches',
    'match_participants',
    'chat_messages'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', v_table);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 2. REMOVER TABLAS DE ALTO CHURN DE LA PUBLICACIÓN supabase_realtime
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'buildings',
    'infra_edges',
    'operational_units',
    'unit_command_schedules',
    'unit_action_logs',
    'p2p_market_orders',
    'state_sovereignty',
    'territorial_battle_sessions'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY v_tables LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. FUNCIÓN DE TRIGGER UNIFICADA: BROADCAST v3 (realtime.send + pg_notify)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_wal_change_v3()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row_json  JSONB;
  v_topic     TEXT;
  v_event     TEXT;
  v_region_id TEXT := 'GLOBAL';
  v_h3_cell   BIGINT := NULL;
  v_payload   JSONB;
  v_has_send  BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row_json := to_jsonb(OLD);
  ELSE
    v_row_json := to_jsonb(NEW);
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'buildings' THEN
      v_region_id := COALESCE(NULLIF(v_row_json ->> 'municipality_id', ''), 'GLOBAL');
      v_h3_cell   := NULLIF(v_row_json ->> 'h3_index', '')::BIGINT;
      v_topic     := 'world:region:' || v_region_id;
      v_event     := CASE WHEN TG_OP = 'DELETE' THEN 'ENTITY_DELETE' ELSE 'ENTITY_UPSERT' END;

    WHEN 'operational_units' THEN
      v_region_id := COALESCE(NULLIF(v_row_json ->> 'municipality_id', ''), 'GLOBAL');
      v_h3_cell   := NULLIF(v_row_json ->> 'h3_index', '')::BIGINT;
      v_topic     := 'world:region:' || v_region_id;
      v_event     := CASE WHEN TG_OP = 'DELETE' THEN 'ENTITY_DELETE' ELSE 'ENTITY_UPSERT' END;

    WHEN 'infra_edges' THEN
      v_region_id := COALESCE(
        NULLIF(v_row_json ->> 'municipality_id', ''),
        (
          SELECT b.municipality_id
          FROM public.buildings b
          WHERE b.id = NULLIF(v_row_json ->> 'from_building_id', '')::UUID
          LIMIT 1
        ),
        'GLOBAL'
      );
      v_h3_cell := COALESCE(
        NULLIF(v_row_json ->> 'h3_index', '')::BIGINT,
        NULLIF(v_row_json ->> 'from_h3', '')::BIGINT
      );
      v_topic := 'world:region:' || v_region_id;
      v_event := CASE WHEN TG_OP = 'DELETE' THEN 'ENTITY_DELETE' ELSE 'ENTITY_UPSERT' END;

    WHEN 'state_sovereignty' THEN
      v_region_id := COALESCE(NULLIF(v_row_json ->> 'state_id', ''), 'GLOBAL');
      v_topic     := 'world:region:' || v_region_id;
      v_event     := CASE WHEN TG_OP = 'DELETE' THEN 'ENTITY_DELETE' ELSE 'ENTITY_UPSERT' END;

    WHEN 'territorial_battle_sessions' THEN
      v_region_id := COALESCE(NULLIF(v_row_json ->> 'region_id', ''), 'GLOBAL');
      v_topic     := 'siege:region:' || v_region_id;
      v_event     := 'SIEGE_STATE';

    WHEN 'p2p_market_orders' THEN
      v_region_id := COALESCE(
        NULLIF(v_row_json ->> 'province_terminal_id', ''),
        NULLIF(v_row_json ->> 'origin_province_id', ''),
        'GLOBAL'
      );
      v_topic := 'market:p2p:' || COALESCE(NULLIF(v_row_json ->> 'item_category', ''), 'all');
      v_event := 'MARKET_ORDER';

    WHEN 'match_action_deltas' THEN
      v_region_id := COALESCE(NULLIF(v_row_json ->> 'match_id', ''), 'GLOBAL');
      v_topic     := 'match:' || v_region_id;
      v_event     := 'MATCH_ACTION';

    ELSE
      v_topic := 'world:region:GLOBAL';
      v_event := CASE WHEN TG_OP = 'DELETE' THEN 'ENTITY_DELETE' ELSE 'ENTITY_UPSERT' END;
  END CASE;

  v_payload := jsonb_build_object(
    'v',         3,
    'event',     v_event,
    'table',     TG_TABLE_NAME,
    'region_id', v_region_id,
    'h3_cell',   v_h3_cell,
    'op',        TG_OP,
    'seq',       (floor(extract(epoch FROM clock_timestamp()) * 1000))::BIGINT,
    'ts',        to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'record',    v_row_json
  );

  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'realtime'
        AND p.proname = 'send'
    ) INTO v_has_send;

    IF v_has_send THEN
      PERFORM realtime.send(v_payload, v_event, v_topic, false);
    ELSE
      PERFORM pg_notify(left(v_topic, 63), left(v_payload::TEXT, 7900));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'broadcast_wal_change_v3 emit failed for % on %: %', TG_TABLE_NAME, v_topic, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. ADJUNTAR TRIGGERS AFTER INSERT OR UPDATE OR DELETE
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'buildings',
    'infra_edges',
    'operational_units',
    'state_sovereignty',
    'territorial_battle_sessions',
    'p2p_market_orders',
    'match_action_deltas'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_broadcast_wal_v3 ON public.%I', v_table);
      EXECUTE format(
        'CREATE TRIGGER trg_broadcast_wal_v3 AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.broadcast_wal_change_v3()',
        v_table
      );
    END IF;
  END LOOP;
END $$;
