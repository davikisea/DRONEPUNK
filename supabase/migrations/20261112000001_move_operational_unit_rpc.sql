-- ==============================================================================
-- MIGRACIÓN INCREMENTAL: RPC ATÓMICO DE MOVIMIENTO OPERACIONAL (ZERO-RAM)
-- ==============================================================================
-- Persiste el movimiento de unidades desplegadas en public.operational_units
-- validando membresía/permiso can_control_units, bloqueo FOR UPDATE e idempotencia.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.move_operational_unit(
  p_unit_id UUID,
  p_target_h3 BIGINT,
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
  v_updated public.operational_units%ROWTYPE;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Sesión autenticada obligatoria.';
  END IF;

  IF p_target_h3 IS NULL THEN
    RAISE EXCEPTION 'INVALID_TARGET_H3: Coordenada H3 destino requerida.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_cached
    FROM public.economy_rpc_idempotency
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_cached;
    END IF;
  END IF;

  SELECT * INTO v_op
  FROM public.operational_units
  WHERE id = p_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPERATIONAL_UNIT_NOT_FOUND: Unidad operacional no encontrada.';
  END IF;

  IF v_op.status <> 'active' THEN
    RAISE EXCEPTION 'UNIT_NOT_ACTIVE: La unidad no está disponible para maniobrar (%).', v_op.status;
  END IF;

  PERFORM public.assert_corp_permission(v_user_id, v_op.corp_id, 'can_control_units');

  UPDATE public.operational_units
  SET h3_index = p_target_h3,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_unit_id
  RETURNING * INTO v_updated;

  v_res := jsonb_build_object(
    'operational_unit', to_jsonb(v_updated),
    'previous_h3_index', v_op.h3_index,
    'new_h3_index', v_updated.h3_index
  );

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
    VALUES (p_idempotency_key, v_user_id, 'move_operational_unit', v_res);
  END IF;

  RETURN v_res;
END;
$$;
