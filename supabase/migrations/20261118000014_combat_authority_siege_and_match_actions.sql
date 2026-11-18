-- ==============================================================================
-- MIGRATION 20261118000014: COMBAT AUTHORITY, SIEGE & MATCH ACTIONS (CONTRACT v3)
-- ==============================================================================
-- Scope (db-combat-authority):
-- 1. Ensure `public.match_action_deltas` exists with idempotency, uniqueness,
--    and strict participant-only RLS (SELECT only; writes via RPC).
-- 2. Implement the 5 authoritative RPCs defined in Contract v3:
--    - start_territorial_siege
--    - claim_territorial_handshake
--    - resolve_territorial_handshake_timeout
--    - resolve_territorial_battle
--    - submit_match_action
-- 3. Emit v3 Broadcast payloads on `siege:region:{region_id}` and
--    `match:{match_id}` via `realtime.send` (with safe `pg_notify` fallback).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLE: public.match_action_deltas & STRICT RLS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_action_deltas (
  id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES public.active_matches(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL CHECK (turn_number >= 1),
  action_index INTEGER NOT NULL CHECK (action_index >= 0),
  action_payload JSONB NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.match_action_deltas
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE INDEX IF NOT EXISTS idx_match_action_deltas_match_turn
  ON public.match_action_deltas(match_id, turn_number, action_index ASC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_action_deltas_turn_action
  ON public.match_action_deltas(match_id, turn_number, action_index);

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_action_deltas_idempotency
  ON public.match_action_deltas(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.match_action_deltas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.match_action_deltas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.match_action_deltas TO authenticated, service_role;

DROP POLICY IF EXISTS "match_action_deltas_select" ON public.match_action_deltas;
CREATE POLICY "match_action_deltas_select"
  ON public.match_action_deltas
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.active_matches m
      WHERE m.id = match_action_deltas.match_id
        AND (
          (SELECT auth.uid()) = m.player1_id
          OR (SELECT auth.uid()) = m.player2_id
        )
    )
  );

-- ------------------------------------------------------------------------------
-- 2. HELPER: Canonical v3 Broadcast Emitter (`realtime.send` + `pg_notify`)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._emit_combat_broadcast_v3(
  p_topic TEXT,
  p_event TEXT,
  p_table TEXT,
  p_op TEXT,
  p_region_id TEXT,
  p_record JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_payload JSONB;
  v_has_realtime_send BOOLEAN := false;
BEGIN
  v_payload := jsonb_build_object(
    'v', 3,
    'event', p_event,
    'table', p_table,
    'region_id', p_region_id,
    'h3_cell', NULL,
    'op', p_op,
    'seq', (EXTRACT(EPOCH FROM v_now) * 1000)::BIGINT,
    'ts', to_char(timezone('utc', v_now), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'record', COALESCE(p_record, '{}'::jsonb)
  );

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime'
      AND p.proname = 'send'
  ) INTO v_has_realtime_send;

  IF v_has_realtime_send THEN
    EXECUTE 'SELECT realtime.send($1, $2, $3, $4)'
      USING v_payload, p_event, p_topic, false;
  ELSE
    PERFORM pg_notify(left(p_topic, 63), v_payload::TEXT);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._emit_combat_broadcast_v3(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. RPC 1: start_territorial_siege
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_territorial_siege(
  p_region_id TEXT,
  p_attacker_clan_id UUID,
  p_attacker_commander_id UUID,
  p_defender_clan_id UUID DEFAULT NULL
)
RETURNS public.territorial_battle_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_sov public.region_sovereignty%ROWTYPE;
  v_defender_clan_id UUID;
  v_session public.territorial_battle_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_attacker_commander_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED_COMMANDER: auth.uid() must match p_attacker_commander_id';
  END IF;

  IF p_region_id IS NULL OR btrim(p_region_id) = '' THEN
    RAISE EXCEPTION 'INVALID_REGION_ID';
  END IF;

  IF p_attacker_clan_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ATTACKER_CLAN_ID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clan_members cm
    WHERE cm.clan_id = p_attacker_clan_id
      AND cm.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_CLAN_MEMBER: User % is not a member of clan %', v_user_id, p_attacker_clan_id;
  END IF;

  -- Canonical lock order: region_sovereignty -> territorial_battle_sessions
  SELECT *
  INTO v_sov
  FROM public.region_sovereignty
  WHERE region_id = p_region_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGION_SOVEREIGNTY_NOT_FOUND: %', p_region_id;
  END IF;

  IF v_sov.cooldown_expires_at IS NOT NULL AND v_sov.cooldown_expires_at > v_now THEN
    RAISE EXCEPTION 'SIEGE_COOLDOWN_ACTIVE: Region % shielded until %', p_region_id, v_sov.cooldown_expires_at;
  END IF;

  IF v_sov.status = 'under_siege' OR EXISTS (
    SELECT 1
    FROM public.territorial_battle_sessions s
    WHERE s.region_id = p_region_id
      AND s.status IN ('handshake_pending', 'in_combat')
  ) THEN
    RAISE EXCEPTION 'SIEGE_ALREADY_ACTIVE: Region % already has an active battle session', p_region_id;
  END IF;

  v_defender_clan_id := COALESCE(p_defender_clan_id, v_sov.controller_clan_id);

  IF v_defender_clan_id IS NOT NULL AND v_defender_clan_id = p_attacker_clan_id THEN
    RAISE EXCEPTION 'SELF_SIEGE_FORBIDDEN: Cannot siege own clan region';
  END IF;

  INSERT INTO public.territorial_battle_sessions (
    region_id,
    attacker_clan_id,
    defender_clan_id,
    attacker_commander_id,
    defender_commander_id,
    mode,
    handshake_expires_at,
    status
  ) VALUES (
    p_region_id,
    p_attacker_clan_id,
    v_defender_clan_id,
    p_attacker_commander_id,
    NULL,
    'pve_garrison',
    v_now + INTERVAL '120 seconds',
    'handshake_pending'
  )
  RETURNING * INTO v_session;

  UPDATE public.region_sovereignty
  SET
    status = 'under_siege',
    active_battle_id = v_session.id,
    updated_at = v_now
  WHERE region_id = p_region_id;

  PERFORM public._emit_combat_broadcast_v3(
    'siege:region:' || p_region_id,
    'SIEGE_STATE',
    'territorial_battle_sessions',
    'INSERT',
    p_region_id,
    to_jsonb(v_session)
  );

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.start_territorial_siege(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_territorial_siege(TEXT, UUID, UUID, UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. RPC 2: claim_territorial_handshake
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_territorial_handshake(
  p_session_id UUID,
  p_defender_commander_id UUID
)
RETURNS public.territorial_battle_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_session public.territorial_battle_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_defender_commander_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED_COMMANDER: auth.uid() must match p_defender_commander_id';
  END IF;

  SELECT *
  INTO v_session
  FROM public.territorial_battle_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SIEGE_SESSION_NOT_FOUND: %', p_session_id;
  END IF;

  IF v_session.defender_clan_id IS NULL THEN
    RAISE EXCEPTION 'NO_DEFENDER_CLAN: Neutral region cannot claim PvP handshake';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clan_members cm
    WHERE cm.clan_id = v_session.defender_clan_id
      AND cm.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_DEFENDER_CLAN: User % is not a member of defender clan %', v_user_id, v_session.defender_clan_id;
  END IF;

  IF v_session.status <> 'handshake_pending' THEN
    RAISE EXCEPTION 'HANDSHAKE_NOT_PENDING: Session status is %', v_session.status;
  END IF;

  IF v_now > v_session.handshake_expires_at THEN
    RAISE EXCEPTION 'HANDSHAKE_EXPIRED: 120s window expired at %', v_session.handshake_expires_at;
  END IF;

  UPDATE public.territorial_battle_sessions
  SET
    defender_commander_id = p_defender_commander_id,
    mode = 'pvp_realtime',
    status = 'in_combat'
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  PERFORM public._emit_combat_broadcast_v3(
    'siege:region:' || v_session.region_id,
    'SIEGE_STATE',
    'territorial_battle_sessions',
    'UPDATE',
    v_session.region_id,
    to_jsonb(v_session)
  );

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_territorial_handshake(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_territorial_handshake(UUID, UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. RPC 3: resolve_territorial_handshake_timeout
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_territorial_handshake_timeout(
  p_session_id UUID,
  p_bunker_level INT DEFAULT 1
)
RETURNS public.territorial_battle_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_session public.territorial_battle_sessions%ROWTYPE;
  v_bunker_level INT := GREATEST(1, LEAST(5, COALESCE(p_bunker_level, 1)));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT *
  INTO v_session
  FROM public.territorial_battle_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SIEGE_SESSION_NOT_FOUND: %', p_session_id;
  END IF;

  IF NOT (
    v_session.attacker_commander_id = v_user_id
    OR EXISTS (
      SELECT 1
      FROM public.clan_members cm
      WHERE cm.user_id = v_user_id
        AND cm.clan_id IN (v_session.attacker_clan_id, v_session.defender_clan_id)
    )
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SIEGE_PARTICIPANT';
  END IF;

  IF v_session.status = 'in_combat' AND v_session.mode = 'pve_garrison' THEN
    RETURN v_session;
  END IF;

  IF v_session.status <> 'handshake_pending' THEN
    RAISE EXCEPTION 'HANDSHAKE_NOT_PENDING: Session status is %', v_session.status;
  END IF;

  IF v_now < v_session.handshake_expires_at THEN
    RAISE EXCEPTION 'HANDSHAKE_NOT_EXPIRED_YET: Expires at %', v_session.handshake_expires_at;
  END IF;

  UPDATE public.territorial_battle_sessions
  SET
    mode = 'pve_garrison',
    status = 'in_combat'
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  PERFORM public._emit_combat_broadcast_v3(
    'siege:region:' || v_session.region_id,
    'SIEGE_STATE',
    'territorial_battle_sessions',
    'UPDATE',
    v_session.region_id,
    to_jsonb(v_session) || jsonb_build_object('garrison_ai_level', v_bunker_level)
  );

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_territorial_handshake_timeout(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_territorial_handshake_timeout(UUID, INT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. RPC 4: resolve_territorial_battle
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_territorial_battle(
  p_session_id UUID,
  p_winner TEXT,
  p_is_capital BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_region_id TEXT;
  v_sov public.region_sovereignty%ROWTYPE;
  v_session public.territorial_battle_sessions%ROWTYPE;
  v_win RECORD;
  v_utc_time TIME := (v_now AT TIME ZONE 'UTC')::TIME;
  v_is_vulnerable BOOLEAN := true;
  v_is_immune BOOLEAN := false;
  v_base_drain INT;
  v_mitigation NUMERIC;
  v_tcp_delta INT := 0;
  v_max_tcp INT;
  v_new_tcp INT;
  v_prev_status TEXT;
  v_new_status TEXT;
  v_is_flipped BOOLEAN := false;
  v_new_owner UUID;
  v_new_controller UUID;
  v_cooldown_expires TIMESTAMPTZ;
  v_grace_expires TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_winner IS NULL OR p_winner NOT IN ('attacker', 'defender') THEN
    RAISE EXCEPTION 'INVALID_WINNER: Expected attacker or defender, got %', p_winner;
  END IF;

  SELECT region_id
  INTO v_region_id
  FROM public.territorial_battle_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SIEGE_SESSION_NOT_FOUND: %', p_session_id;
  END IF;

  -- Canonical lock order: region_sovereignty -> territorial_battle_sessions
  SELECT *
  INTO v_sov
  FROM public.region_sovereignty
  WHERE region_id = v_region_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGION_SOVEREIGNTY_NOT_FOUND: %', v_region_id;
  END IF;

  SELECT *
  INTO v_session
  FROM public.territorial_battle_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT (
    v_session.attacker_commander_id = v_user_id
    OR v_session.defender_commander_id = v_user_id
    OR EXISTS (
      SELECT 1
      FROM public.clan_members cm
      WHERE cm.user_id = v_user_id
        AND cm.clan_id IN (v_session.attacker_clan_id, v_session.defender_clan_id)
    )
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_SIEGE_PARTICIPANT';
  END IF;

  IF v_session.status IN ('concluded', 'aborted') THEN
    RAISE EXCEPTION 'BATTLE_ALREADY_CONCLUDED: Session status is %', v_session.status;
  END IF;

  -- Evaluate offline raiding protection window if configured
  SELECT *
  INTO v_win
  FROM public.territorial_vulnerability_windows
  WHERE region_id = v_region_id
    AND is_active = true;

  IF FOUND THEN
    IF v_win.window_end_utc > v_win.window_start_utc THEN
      v_is_vulnerable := (v_utc_time >= v_win.window_start_utc AND v_utc_time < v_win.window_end_utc);
    ELSE
      v_is_vulnerable := (v_utc_time >= v_win.window_start_utc OR v_utc_time < v_win.window_end_utc);
    END IF;
  END IF;

  IF p_winner = 'attacker' AND NOT v_is_vulnerable THEN
    v_tcp_delta := 0;
    v_is_immune := true;
  ELSIF p_winner = 'defender' THEN
    v_tcp_delta := 500;
  ELSE
    v_base_drain := CASE WHEN COALESCE(p_is_capital, false) THEN 1200 ELSE 1800 END;
    v_mitigation := GREATEST(0.60, 1.0 - (COALESCE(v_sov.bunker_level, 1) - 1) * 0.10);
    v_tcp_delta := -LEAST(2500, GREATEST(800, FLOOR(v_base_drain * v_mitigation)::INT));
  END IF;

  v_max_tcp := COALESCE(
    v_sov.max_control_points,
    CASE WHEN COALESCE(p_is_capital, false) THEN 15000 ELSE 10000 END
  );
  v_new_tcp := GREATEST(0, LEAST(v_max_tcp, v_sov.control_points + v_tcp_delta));

  v_prev_status := v_sov.status;
  v_new_status := v_sov.status;
  v_new_owner := v_sov.owner_clan_id;
  v_new_controller := v_sov.controller_clan_id;
  v_cooldown_expires := v_sov.cooldown_expires_at;
  v_grace_expires := v_sov.grace_expires_at;

  IF p_winner = 'attacker' THEN
    IF v_new_tcp <= 0 THEN
      v_is_flipped := true;
      v_new_status := 'occupied_grace';
      v_new_controller := v_session.attacker_clan_id;
      v_new_owner := COALESCE(v_sov.owner_clan_id, v_sov.controller_clan_id);
      v_cooldown_expires := v_now + INTERVAL '4 hours';
      v_grace_expires := v_now + INTERVAL '24 hours';
    ELSE
      v_new_status := 'under_siege';
    END IF;
  ELSE
    IF v_new_tcp >= v_max_tcp THEN
      v_new_status := 'stable';
    ELSE
      v_new_status := 'under_siege';
    END IF;
  END IF;

  UPDATE public.territorial_battle_sessions
  SET
    status = 'concluded',
    concluded_at = v_now
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  UPDATE public.region_sovereignty
  SET
    control_points = v_new_tcp,
    status = v_new_status,
    owner_clan_id = v_new_owner,
    controller_clan_id = v_new_controller,
    active_battle_id = NULL,
    cooldown_expires_at = v_cooldown_expires,
    grace_expires_at = v_grace_expires,
    updated_at = v_now
  WHERE region_id = v_region_id;

  PERFORM public._emit_combat_broadcast_v3(
    'siege:region:' || v_region_id,
    'SIEGE_STATE',
    'territorial_battle_sessions',
    'UPDATE',
    v_region_id,
    to_jsonb(v_session)
  );

  RETURN jsonb_build_object(
    'winner', p_winner,
    'region_id', v_region_id,
    'session_id', v_session.id,
    'tcp_delta', v_tcp_delta,
    'new_control_points', v_new_tcp,
    'previous_status', v_prev_status,
    'new_status', v_new_status,
    'is_sovereignty_flipped', v_is_flipped,
    'is_immune_offline_protection', v_is_immune,
    'cooldown_expires_at', v_cooldown_expires,
    'grace_expires_at', v_grace_expires,
    'new_owner_clan_id', v_new_owner,
    'new_controller_clan_id', v_new_controller
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_territorial_battle(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_territorial_battle(UUID, TEXT, BOOLEAN) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. RPC 5: submit_match_action (Turn Authority, 1-100 HP, Idempotency, Broadcast)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_match_action(
  p_match_id UUID,
  p_turn_number INT,
  p_action_index INT,
  p_action_payload JSONB,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_cached JSONB;
  v_match public.active_matches%ROWTYPE;
  v_existing public.match_action_deltas%ROWTYPE;
  v_delta public.match_action_deltas%ROWTYPE;
  v_action_type TEXT;
  v_hp_val NUMERIC;
  v_next_player UUID;
  v_next_turn INT;
  v_res JSONB;
  v_key TEXT;
  v_hp_keys TEXT[] := ARRAY['hp', 'unitHp', 'unit_hp'];
  v_combat_hp_keys TEXT[] := ARRAY['newHp', 'new_hp', 'attackerHp', 'attacker_hp', 'defenderHp', 'defender_hp', 'targetHp', 'target_hp', 'damage'];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response
    INTO v_cached
    FROM public.economy_rpc_idempotency
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN v_cached;
    END IF;
  END IF;

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_MATCH_ID';
  END IF;

  IF p_action_index IS NULL OR p_action_index < 0 THEN
    RAISE EXCEPTION 'INVALID_ACTION_INDEX';
  END IF;

  IF p_action_payload IS NULL OR jsonb_typeof(p_action_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_ACTION_PAYLOAD';
  END IF;

  v_action_type := UPPER(COALESCE(p_action_payload->>'type', ''));
  IF v_action_type NOT IN (
    'MOVE', 'ATTACK', 'CAPTURE', 'JOIN', 'LOAD', 'UNLOAD',
    'SILO', 'SUPPLY', 'PRODUCE', 'CO_POWER', 'END_TURN'
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTION_TYPE: %', v_action_type;
  END IF;

  -- Validate 1-100 HP canonical invariants on action payload & nested payload
  FOREACH v_key IN ARRAY v_hp_keys LOOP
    IF p_action_payload ? v_key AND jsonb_typeof(p_action_payload->v_key) = 'number' THEN
      v_hp_val := (p_action_payload->>v_key)::NUMERIC;
      IF v_hp_val < 1 OR v_hp_val > 100 THEN
        RAISE EXCEPTION 'INVALID_HP_RANGE: % must be between 1 and 100 (got %)', v_key, v_hp_val;
      END IF;
    END IF;
    IF jsonb_typeof(p_action_payload->'payload') = 'object'
       AND (p_action_payload->'payload') ? v_key
       AND jsonb_typeof((p_action_payload->'payload')->v_key) = 'number' THEN
      v_hp_val := ((p_action_payload->'payload')->>v_key)::NUMERIC;
      IF v_hp_val < 1 OR v_hp_val > 100 THEN
        RAISE EXCEPTION 'INVALID_HP_RANGE: payload.% must be between 1 and 100 (got %)', v_key, v_hp_val;
      END IF;
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY v_combat_hp_keys LOOP
    IF p_action_payload ? v_key AND jsonb_typeof(p_action_payload->v_key) = 'number' THEN
      v_hp_val := (p_action_payload->>v_key)::NUMERIC;
      IF v_hp_val < 0 OR v_hp_val > 100 THEN
        RAISE EXCEPTION 'INVALID_HP_RANGE: % must be between 0 and 100 (got %)', v_key, v_hp_val;
      END IF;
    END IF;
    IF jsonb_typeof(p_action_payload->'payload') = 'object'
       AND (p_action_payload->'payload') ? v_key
       AND jsonb_typeof((p_action_payload->'payload')->v_key) = 'number' THEN
      v_hp_val := ((p_action_payload->'payload')->>v_key)::NUMERIC;
      IF v_hp_val < 0 OR v_hp_val > 100 THEN
        RAISE EXCEPTION 'INVALID_HP_RANGE: payload.% must be between 0 and 100 (got %)', v_key, v_hp_val;
      END IF;
    END IF;
  END LOOP;

  -- Lock active match row
  SELECT *
  INTO v_match
  FROM public.active_matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND: %', p_match_id;
  END IF;

  IF v_match.status <> 'in_progress' THEN
    RAISE EXCEPTION 'MATCH_NOT_IN_PROGRESS: Status is %', v_match.status;
  END IF;

  IF v_user_id <> v_match.player1_id AND (v_match.player2_id IS NULL OR v_user_id <> v_match.player2_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_MATCH_PARTICIPANT';
  END IF;

  -- Idempotency check by (match_id, turn_number, action_index)
  SELECT *
  INTO v_existing
  FROM public.match_action_deltas
  WHERE match_id = p_match_id
    AND turn_number = p_turn_number
    AND action_index = p_action_index;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'delta_id', v_existing.id,
      'match_id', v_existing.match_id,
      'turn_number', v_existing.turn_number,
      'action_index', v_existing.action_index,
      'action_type', UPPER(COALESCE(v_existing.action_payload->>'type', '')),
      'actor_id', v_existing.actor_id,
      'created_at', v_existing.created_at
    );
  END IF;

  -- Turn authority validation
  IF v_match.current_turn_player_id IS NOT NULL AND v_match.current_turn_player_id <> v_user_id THEN
    RAISE EXCEPTION 'NOT_YOUR_TURN: Current turn belongs to %', v_match.current_turn_player_id;
  END IF;

  IF p_turn_number IS NULL OR p_turn_number <> v_match.turn_number THEN
    RAISE EXCEPTION 'INVALID_TURN_NUMBER: Expected %, got %', v_match.turn_number, p_turn_number;
  END IF;

  INSERT INTO public.match_action_deltas (
    match_id,
    turn_number,
    action_index,
    action_payload,
    actor_id,
    idempotency_key
  ) VALUES (
    p_match_id,
    p_turn_number,
    p_action_index,
    p_action_payload,
    v_user_id,
    p_idempotency_key
  )
  RETURNING * INTO v_delta;

  -- Advance turn atomically on END_TURN
  IF v_action_type = 'END_TURN' THEN
    IF v_match.player2_id IS NOT NULL THEN
      v_next_player := CASE
        WHEN v_match.current_turn_player_id = v_match.player1_id THEN v_match.player2_id
        ELSE v_match.player1_id
      END;
      v_next_turn := CASE
        WHEN v_match.current_turn_player_id = v_match.player2_id THEN v_match.turn_number + 1
        ELSE v_match.turn_number
      END;
    ELSE
      v_next_player := v_match.player1_id;
      v_next_turn := v_match.turn_number + 1;
    END IF;

    UPDATE public.active_matches
    SET
      current_turn_player_id = v_next_player,
      turn_number = v_next_turn,
      updated_at = v_now
    WHERE id = p_match_id;
  END IF;

  v_res := jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'delta_id', v_delta.id,
    'match_id', p_match_id,
    'turn_number', p_turn_number,
    'action_index', p_action_index,
    'action_type', v_action_type,
    'actor_id', v_user_id,
    'created_at', v_delta.created_at
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'submit_match_action', v_res)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  PERFORM public._emit_combat_broadcast_v3(
    'match:' || p_match_id::TEXT,
    'MATCH_ACTION',
    'match_action_deltas',
    'INSERT',
    NULL,
    jsonb_build_object(
      'id', v_delta.id,
      'match_id', p_match_id,
      'turn_number', p_turn_number,
      'action_index', p_action_index,
      'actor_id', v_user_id,
      'action_payload', p_action_payload,
      'created_at', v_delta.created_at
    )
  );

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_match_action(UUID, INT, INT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_match_action(UUID, INT, INT, JSONB, UUID) TO authenticated, service_role;
