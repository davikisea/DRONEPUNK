-- ==============================================================================
-- MIGRATION: 20261118000002_corporation_donate_and_leave_rpcs.sql
-- OBJETIVO: RPCs atómicas para Donar recursos a la Corporación y Abandonar
--           Corporación con transferencia de liderazgo o disolución limpia.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.donate_to_corporation(
  p_corp_id UUID,
  p_ec INT DEFAULT 0,
  p_alloys INT DEFAULT 0,
  p_fuel INT DEFAULT 0,
  p_chips INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_email_confirmed TIMESTAMPTZ;
  v_profile public.profiles%ROWTYPE;
  v_inv public.user_industrial_inventory%ROWTYPE;
  v_corp public.corporations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed FROM auth.users WHERE id = v_user_id;
  IF v_email_confirmed IS NULL THEN
    RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED';
  END IF;

  IF p_ec < 0 OR p_alloys < 0 OR p_fuel < 0 OR p_chips < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Las donaciones no pueden ser negativas.';
  END IF;

  IF (p_ec + p_alloys + p_fuel + p_chips) <= 0 THEN
    RAISE EXCEPTION 'EMPTY_DONATION: Debes especificar al menos 1 recurso para donar.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.corporation_members
    WHERE corp_id = p_corp_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: No perteneces a esta Corporación.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF COALESCE(v_profile.battle_credits, 0) < p_ec THEN
    RAISE EXCEPTION 'INSUFFICIENT_EC: Créditos insuficientes.';
  END IF;

  IF p_alloys > 0 OR p_fuel > 0 OR p_chips > 0 THEN
    SELECT * INTO v_inv FROM public.user_industrial_inventory WHERE user_id = v_user_id FOR UPDATE;
    IF NOT FOUND
       OR COALESCE(v_inv.refined_steel, 0) < p_alloys
       OR COALESCE(v_inv.campaign_fuel, 0) < p_fuel
       OR COALESCE(v_inv.refined_microchip, 0) < p_chips THEN
      RAISE EXCEPTION 'INSUFFICIENT_MATERIALS: Materiales industriales insuficientes.';
    END IF;

    UPDATE public.user_industrial_inventory
    SET
      refined_steel = refined_steel - p_alloys,
      campaign_fuel = campaign_fuel - p_fuel,
      refined_microchip = refined_microchip - p_chips,
      updated_at = timezone('utc'::text, now())
    WHERE user_id = v_user_id;
  END IF;

  IF p_ec > 0 THEN
    PERFORM set_config('app.bypass_profile_guard', 'on', true);
    UPDATE public.profiles
    SET battle_credits = battle_credits - p_ec
    WHERE id = v_user_id;
  END IF;

  UPDATE public.corporations
  SET
    treasury_ec = treasury_ec + p_ec,
    treasury_alloys = treasury_alloys + p_alloys,
    treasury_fuel = treasury_fuel + p_fuel,
    treasury_chips = treasury_chips + p_chips,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_corp_id
  RETURNING * INTO v_corp;

  RETURN jsonb_build_object(
    'corp_id', v_corp.id,
    'treasury_ec', v_corp.treasury_ec,
    'treasury_alloys', v_corp.treasury_alloys,
    'treasury_fuel', v_corp.treasury_fuel,
    'treasury_chips', v_corp.treasury_chips
  );
END;
$$;

REVOKE ALL ON FUNCTION public.donate_to_corporation(UUID, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.donate_to_corporation(UUID, INT, INT, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_corporation()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_profile public.profiles%ROWTYPE;
  v_member public.corporation_members%ROWTYPE;
  v_next_leader_id UUID;
  v_dissolved BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_profile.corp_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_CORP: No perteneces a ninguna Corporación.';
  END IF;

  SELECT * INTO v_member
  FROM public.corporation_members
  WHERE corp_id = v_profile.corp_id AND user_id = v_user_id
  FOR UPDATE;

  DELETE FROM public.corporation_members
  WHERE corp_id = v_profile.corp_id AND user_id = v_user_id;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE public.profiles SET corp_id = NULL WHERE id = v_user_id;

  -- Buscar sucesor si quedan otros miembros
  SELECT user_id INTO v_next_leader_id
  FROM public.corporation_members
  WHERE corp_id = v_profile.corp_id
  ORDER BY shares DESC, joined_at ASC
  LIMIT 1;

  IF v_next_leader_id IS NULL THEN
    DELETE FROM public.corporations WHERE id = v_profile.corp_id;
    v_dissolved := true;
  ELSIF v_member.role = 'majority_shareholder' THEN
    UPDATE public.corporation_members
    SET
      role = 'majority_shareholder',
      shares = GREATEST(shares, 100),
      delegated_permissions = '{"can_use_treasury":true,"can_construct":true,"can_remodel":true,"can_collect":true,"can_purchase_units":true,"can_control_units":true}'::jsonb
    WHERE corp_id = v_profile.corp_id AND user_id = v_next_leader_id;

    UPDATE public.corporations
    SET leader_user_id = v_next_leader_id, updated_at = timezone('utc'::text, now())
    WHERE id = v_profile.corp_id;
  END IF;

  RETURN jsonb_build_object(
    'left', true,
    'corp_id', v_profile.corp_id,
    'dissolved', v_dissolved,
    'new_leader_user_id', v_next_leader_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_corporation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_corporation() TO authenticated;
