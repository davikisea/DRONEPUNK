-- ==============================================================================
-- DRONEPUNK: MIGRACIÓN 20261118000010 — SCHEDULER BATCH WORKER & PG_CRON
-- Contrato SQL/RPC v3 (10,000+ CCU) — db-scheduler-worker
-- 1. Columnas de backoff/reintento en unit_command_schedules (idempotente)
-- 2. Refactor de public.process_due_unit_schedules(p_batch_limit INT DEFAULT 25)
--    con FOR UPDATE SKIP LOCKED, batching acotado, backoff exponencial en fallos
--    y emisión de deltas agrupados por región (en lugar de N eventos WAL).
-- 3. Registro idempotente del job pg_cron protegido con IF EXISTS.
-- ==============================================================================

-- 1. Columnas de observabilidad y backoff en unit_command_schedules
ALTER TABLE public.unit_command_schedules
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ucs_due
  ON public.unit_command_schedules(next_tick_at, status)
  WHERE status IN ('pending', 'active');

-- 2. Refactor de process_due_unit_schedules con SKIP LOCKED, backoff y deltas por región
CREATE OR REPLACE FUNCTION public.process_due_unit_schedules(p_batch_limit INT DEFAULT 25)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now              TIMESTAMPTZ := timezone('utc'::text, now());
  v_limit            INT := GREATEST(1, LEAST(100, COALESCE(p_batch_limit, 25)));
  v_sched            public.unit_command_schedules%ROWTYPE;
  v_wp               JSONB;
  v_next_h3          BIGINT;
  v_processed        INT := 0;
  v_succeeded        INT := 0;
  v_failed           INT := 0;
  v_regions_notified INT := 0;
  v_slot             public.user_unit_hangar%ROWTYPE;
  v_unit             public.operational_units%ROWTYPE;
  v_region_id        TEXT;
  v_unit_delta       JSONB;
  v_region_deltas    JSONB := '{}'::jsonb;
  v_region_key       TEXT;
  v_region_units     JSONB;
  v_last_h3          BIGINT;
  v_seq              BIGINT;
  v_payload          JSONB;
  v_has_realtime     BOOLEAN := false;
  v_backoff_sec      INT;
  v_err_msg          TEXT;
BEGIN
  -- Reclamo acotado de schedules vencidos sin contención entre workers
  FOR v_sched IN
    SELECT ucs.*
    FROM public.unit_command_schedules ucs
    WHERE ucs.status IN ('pending', 'active')
      AND ucs.next_tick_at <= v_now
    ORDER BY ucs.next_tick_at ASC, ucs.id ASC
    LIMIT v_limit
    FOR UPDATE OF ucs SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;

    BEGIN
      IF v_sched.status = 'pending' THEN
        UPDATE public.unit_command_schedules
        SET status = 'active',
            updated_at = v_now
        WHERE id = v_sched.id;

        INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary)
        VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_started', 'Ejecución iniciada: ' || v_sched.command_type);
      END IF;

      -- Caso A: Despliegue programado desde hangar (orden de locks: operational_units -> user_unit_hangar)
      IF v_sched.command_type = 'scheduled_deploy' AND v_sched.hangar_slot_id IS NOT NULL THEN
        SELECT * INTO v_slot
        FROM public.user_unit_hangar
        WHERE id = v_sched.hangar_slot_id
        FOR UPDATE;

        IF FOUND AND v_slot.quantity >= 1 THEN
          v_next_h3 := COALESCE((v_sched.waypoints -> 0 ->> 'h3')::BIGINT, public.lat_lng_to_h3_res9(10.3994, -71.4539));
          v_region_id := NULLIF(v_sched.waypoints -> 0 ->> 'municipality_id', '');

          IF v_region_id IS NULL AND v_sched.target_building_id IS NOT NULL THEN
            SELECT b.municipality_id INTO v_region_id
            FROM public.buildings b
            WHERE b.id = v_sched.target_building_id;
          END IF;

          IF v_slot.quantity = 1 THEN
            DELETE FROM public.user_unit_hangar WHERE id = v_slot.id;
          ELSE
            UPDATE public.user_unit_hangar
            SET quantity = quantity - 1
            WHERE id = v_slot.id;
          END IF;

          INSERT INTO public.operational_units (
            owner_user_id, corp_id, unit_code, tier, hp, h3_index, municipality_id, status, unit_role
          ) VALUES (
            v_sched.created_by,
            v_sched.corp_id,
            v_slot.unit_code,
            v_slot.tier,
            v_slot.hp,
            v_next_h3,
            v_region_id,
            'active',
            CASE WHEN v_slot.unit_code IN ('apc', 't_copter', 'lander') THEN 'collector' ELSE 'combat' END
          )
          RETURNING * INTO v_unit;

          UPDATE public.unit_command_schedules
          SET unit_id = v_unit.id,
              status = 'completed',
              retry_count = 0,
              failure_reason = NULL,
              updated_at = v_now
          WHERE id = v_sched.id;

          INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index)
          VALUES (v_unit.id, v_sched.id, v_sched.corp_id, 'deployed', 'Despliegue programado ejecutado: ' || v_unit.unit_code, v_next_h3);

          v_region_key := COALESCE(v_unit.municipality_id, 'GLOBAL');
          v_unit_delta := jsonb_build_object(
            'id', v_unit.id,
            'corp_id', v_unit.corp_id,
            'unit_code', v_unit.unit_code,
            'tier', v_unit.tier,
            'hp', v_unit.hp,
            'h3_index', v_unit.h3_index,
            'municipality_id', v_unit.municipality_id,
            'status', v_unit.status,
            'op', 'INSERT'
          );
          v_region_deltas := jsonb_set(
            v_region_deltas,
            ARRAY[v_region_key],
            COALESCE(v_region_deltas -> v_region_key, '[]'::jsonb) || jsonb_build_array(v_unit_delta),
            true
          );

          v_succeeded := v_succeeded + 1;
        ELSE
          UPDATE public.unit_command_schedules
          SET status = 'failed',
              failure_reason = 'HANGAR_SLOT_EMPTY',
              last_error_at = v_now,
              updated_at = v_now
          WHERE id = v_sched.id;

          INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary)
          VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_failed', 'Despliegue fallido: hangar vacío');

          v_failed := v_failed + 1;
        END IF;

      -- Caso B: Movimiento por waypoints / patrulla / recolección / escaramuza
      ELSIF jsonb_array_length(v_sched.waypoints) > 0 AND v_sched.unit_id IS NOT NULL THEN
        v_wp := v_sched.waypoints -> v_sched.waypoint_cursor;
        v_next_h3 := (v_wp ->> 'h3')::BIGINT;

        IF v_next_h3 IS NOT NULL THEN
          UPDATE public.operational_units
          SET h3_index = v_next_h3,
              updated_at = v_now
          WHERE id = v_sched.unit_id
            AND status IN ('active', 'engaged')
          RETURNING * INTO v_unit;

          IF NOT FOUND THEN
            UPDATE public.unit_command_schedules
            SET status = 'failed',
                failure_reason = 'UNIT_NOT_ACTIVE',
                last_error_at = v_now,
                updated_at = v_now
            WHERE id = v_sched.id;

            v_failed := v_failed + 1;
            CONTINUE;
          END IF;

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

          v_region_key := COALESCE(v_unit.municipality_id, 'GLOBAL');
          v_unit_delta := jsonb_build_object(
            'id', v_unit.id,
            'corp_id', v_unit.corp_id,
            'unit_code', v_unit.unit_code,
            'tier', v_unit.tier,
            'hp', v_unit.hp,
            'h3_index', v_unit.h3_index,
            'municipality_id', v_unit.municipality_id,
            'status', v_unit.status,
            'op', 'UPDATE'
          );
          v_region_deltas := jsonb_set(
            v_region_deltas,
            ARRAY[v_region_key],
            COALESCE(v_region_deltas -> v_region_key, '[]'::jsonb) || jsonb_build_array(v_unit_delta),
            true
          );
        END IF;

        IF v_sched.waypoint_cursor + 1 < jsonb_array_length(v_sched.waypoints) THEN
          UPDATE public.unit_command_schedules
          SET waypoint_cursor = waypoint_cursor + 1,
              next_tick_at = v_now + interval '5 seconds',
              retry_count = 0,
              failure_reason = NULL,
              updated_at = v_now
          WHERE id = v_sched.id;
        ELSIF v_sched.command_type IN ('patrol', 'auto_collect') THEN
          UPDATE public.unit_command_schedules
          SET waypoint_cursor = 0,
              next_tick_at = v_now + make_interval(secs => COALESCE(v_sched.repeat_interval_sec, 10)),
              retry_count = 0,
              failure_reason = NULL,
              updated_at = v_now
          WHERE id = v_sched.id;
        ELSIF v_sched.repeat_interval_sec IS NOT NULL THEN
          UPDATE public.unit_command_schedules
          SET waypoint_cursor = 0,
              status = 'pending',
              next_tick_at = v_now + make_interval(secs => v_sched.repeat_interval_sec),
              retry_count = 0,
              failure_reason = NULL,
              updated_at = v_now
          WHERE id = v_sched.id;
        ELSE
          UPDATE public.unit_command_schedules
          SET status = 'completed',
              retry_count = 0,
              failure_reason = NULL,
              updated_at = v_now
          WHERE id = v_sched.id;

          INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary, h3_index)
          VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_completed', 'Orden completada', v_next_h3);
        END IF;

        v_succeeded := v_succeeded + 1;
      ELSE
        UPDATE public.unit_command_schedules
        SET status = 'completed',
            retry_count = 0,
            failure_reason = NULL,
            updated_at = v_now
        WHERE id = v_sched.id;

        v_succeeded := v_succeeded + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Backoff exponencial por schedule ante fallos transitorios sin abortar el lote
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
      v_failed := v_failed + 1;

      IF v_sched.retry_count + 1 >= 5 THEN
        UPDATE public.unit_command_schedules
        SET status = 'failed',
            retry_count = v_sched.retry_count + 1,
            failure_reason = LEFT(v_err_msg, 240),
            last_error_at = v_now,
            updated_at = v_now
        WHERE id = v_sched.id;

        INSERT INTO public.unit_action_logs (unit_id, schedule_id, corp_id, action_type, summary)
        VALUES (v_sched.unit_id, v_sched.id, v_sched.corp_id, 'order_failed', 'Orden fallida tras reintentos: ' || LEFT(v_err_msg, 180));
      ELSE
        v_backoff_sec := LEAST(3600, (POWER(2, LEAST(10, v_sched.retry_count + 1)) * 5)::INT);
        UPDATE public.unit_command_schedules
        SET retry_count = v_sched.retry_count + 1,
            next_tick_at = v_now + make_interval(secs => v_backoff_sec),
            failure_reason = LEFT(v_err_msg, 240),
            last_error_at = v_now,
            updated_at = v_now
        WHERE id = v_sched.id;
      END IF;
    END;
  END LOOP;

  -- Emisión de deltas agrupados por región (1 Broadcast v3 por región en lugar de N eventos WAL)
  IF v_region_deltas <> '{}'::jsonb THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'realtime'
        AND p.proname = 'send'
    ) INTO v_has_realtime;

    v_seq := (EXTRACT(EPOCH FROM v_now) * 1000)::BIGINT;

    FOR v_region_key, v_region_units IN
      SELECT key, value
      FROM jsonb_each(v_region_deltas)
    LOOP
      v_last_h3 := (v_region_units -> (jsonb_array_length(v_region_units) - 1) ->> 'h3_index')::BIGINT;
      v_payload := jsonb_build_object(
        'v', 3,
        'event', 'ENTITY_UPSERT',
        'table', 'operational_units',
        'region_id', v_region_key,
        'h3_cell', v_last_h3,
        'op', 'UPDATE',
        'seq', v_seq,
        'ts', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'record', jsonb_build_object(
          'batch', true,
          'units', v_region_units
        )
      );

      IF v_has_realtime THEN
        BEGIN
          PERFORM realtime.send(
            v_payload,
            'ENTITY_UPSERT',
            'world:region:' || v_region_key,
            false
          );
        EXCEPTION WHEN OTHERS THEN
          PERFORM pg_notify('world:region:' || v_region_key, v_payload::text);
        END;
      ELSE
        PERFORM pg_notify('world:region:' || v_region_key, v_payload::text);
      END IF;

      v_regions_notified := v_regions_notified + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'succeeded', v_succeeded,
    'failed', v_failed,
    'regions_notified', v_regions_notified
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_due_unit_schedules(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_due_unit_schedules(INT) TO authenticated, service_role;

-- 3. Registro idempotente del job pg_cron (protegido para entornos sin pg_cron)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process_due_unit_schedules_worker') THEN
      PERFORM cron.unschedule('process_due_unit_schedules_worker');
    END IF;

    BEGIN
      PERFORM cron.schedule(
        'process_due_unit_schedules_worker',
        '15 seconds',
        $cron$SELECT public.process_due_unit_schedules(25);$cron$
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM cron.schedule(
        'process_due_unit_schedules_worker',
        '* * * * *',
        $cron$SELECT public.process_due_unit_schedules(25);$cron$
      );
    END;
  END IF;
END;
$$;
