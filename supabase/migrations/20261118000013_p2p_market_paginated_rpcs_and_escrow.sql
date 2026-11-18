-- ==============================================================================
-- MIGRACIÓN: 20261118000013_p2p_market_paginated_rpcs_and_escrow.sql
-- CONTRATO SQL/RPC v3 (10,000+ CCU) — MERCADO P2P ESCALABLE & ESCROW ATÓMICO
-- ==============================================================================
-- 1. Índices parciales (WHERE status = 'active') para libro de órdenes y keyset.
-- 2. RPC get_p2p_market_orders_page (keyset pagination O(log N) sin OFFSET).
-- 3. RPC publish_p2p_market_order (escrow atómico de inventario/hangar + idempotencia).
-- 4. RPC cancel_p2p_market_order (reembolso atómico de escrow + idempotencia).
-- 5. Refactor execute_p2p_market_transaction con Orden Canónico Global de Locks:
--    clans -> user_unit_hangar (ORDER BY id ASC) -> profiles (ORDER BY id ASC)
--    -> user_industrial_inventory (ORDER BY user_id ASC) -> p2p_market_orders (ORDER BY id ASC).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ÍNDICES PARCIALES DE ALTO RENDIMIENTO EN p2p_market_orders
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_p2p_orders_active_book
    ON public.p2p_market_orders (item_category, item_code, unit_price_ec, created_at, id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_p2p_orders_active_keyset
    ON public.p2p_market_orders (created_at DESC, id DESC)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_p2p_orders_seller_status_created
    ON public.p2p_market_orders (seller_id, status, created_at DESC, id DESC);

-- ------------------------------------------------------------------------------
-- 2. RPC: get_p2p_market_orders_page (Paginación Keyset Retrocompatible)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_p2p_market_orders_page(
    p_item_category TEXT DEFAULT NULL,
    p_item_code TEXT DEFAULT NULL,
    p_seller_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT 'active',
    p_cursor_created_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    id UUID,
    seller_id UUID,
    buyer_id UUID,
    origin_province_id VARCHAR(32),
    province_terminal_id VARCHAR(32),
    item_category VARCHAR(32),
    item_code VARCHAR(64),
    tier INTEGER,
    quantity INTEGER,
    unit_price_ec INTEGER,
    total_price_ec INTEGER,
    platform_burn_ec INTEGER,
    province_royalty_ec INTEGER,
    net_seller_revenue_ec INTEGER,
    status VARCHAR(16),
    created_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    total_active_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT := COALESCE(NULLIF(trim(p_status), ''), 'active');
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_total_count BIGINT := 0;
BEGIN
    SELECT COUNT(*)::BIGINT
    INTO v_total_count
    FROM public.p2p_market_orders o
    WHERE o.status = v_status
      AND (p_item_category IS NULL OR o.item_category = p_item_category)
      AND (p_item_code IS NULL OR o.item_code = p_item_code)
      AND (p_seller_id IS NULL OR o.seller_id = p_seller_id);

    RETURN QUERY
    SELECT
        o.id,
        o.seller_id,
        o.buyer_id,
        o.origin_province_id,
        o.province_terminal_id,
        o.item_category,
        o.item_code,
        o.tier,
        o.quantity,
        o.unit_price_ec,
        o.total_price_ec,
        o.platform_burn_ec,
        o.province_royalty_ec,
        o.net_seller_revenue_ec,
        o.status,
        o.created_at,
        o.completed_at,
        v_total_count AS total_active_count
    FROM public.p2p_market_orders o
    WHERE o.status = v_status
      AND (p_item_category IS NULL OR o.item_category = p_item_category)
      AND (p_item_code IS NULL OR o.item_code = p_item_code)
      AND (p_seller_id IS NULL OR o.seller_id = p_seller_id)
      AND (
          p_cursor_created_at IS NULL
          OR (p_cursor_id IS NOT NULL AND (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id))
          OR (p_cursor_id IS NULL AND o.created_at < p_cursor_created_at)
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_p2p_market_orders_page(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_p2p_market_orders_page(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, UUID, INT) TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 3. RPC: publish_p2p_market_order (Escrow Atómico + Idempotencia)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_p2p_market_order(
    p_item_category TEXT,
    p_item_code TEXT,
    p_tier INT,
    p_quantity INT,
    p_unit_price_ec INT,
    p_origin_province_id VARCHAR(32) DEFAULT 'ES_MADRID',
    p_province_terminal_id VARCHAR(32) DEFAULT 'ES_MADRID',
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS public.p2p_market_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_seller_id UUID := (SELECT auth.uid());
    v_cached JSONB;
    v_item_code TEXT;
    v_total_price_bigint BIGINT;
    v_total_price_ec INTEGER;
    v_tax_total INTEGER;
    v_burn_ec INTEGER;
    v_royalty_ec INTEGER;
    v_net_seller_revenue_ec INTEGER;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_hangar_row public.user_unit_hangar%ROWTYPE;
    v_inv public.user_industrial_inventory%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_current_stock INTEGER := 0;
    v_order public.p2p_market_orders%ROWTYPE;
BEGIN
    IF v_seller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Sesión militar requerida para publicar orden P2P';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT response INTO v_cached
        FROM public.economy_rpc_idempotency
        WHERE idempotency_key = p_idempotency_key
          AND user_id = v_seller_id
          AND rpc_name = 'publish_p2p_market_order';

        IF FOUND THEN
            v_order := jsonb_populate_record(NULL::public.p2p_market_orders, v_cached);
            RETURN v_order;
        END IF;
    END IF;

    IF p_item_category NOT IN (
        'raw_resource', 'refined_material', 'patent_blueprint', 'buff_consumable', 'unit_chassis', 'cosmetic'
    ) THEN
        RAISE EXCEPTION 'INVALID_ITEM_CATEGORY: Categoría P2P no válida (%)', p_item_category;
    END IF;

    IF p_item_code IS NULL OR length(trim(p_item_code)) = 0 THEN
        RAISE EXCEPTION 'INVALID_ITEM_CODE: Código de ítem requerido';
    END IF;

    IF p_tier IS NULL OR p_tier < 1 OR p_tier > 5 THEN
        RAISE EXCEPTION 'INVALID_TIER: Tier debe estar entre 1 y 5';
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'INVALID_QUANTITY: La cantidad debe ser mayor a cero';
    END IF;

    IF p_unit_price_ec IS NULL OR p_unit_price_ec <= 0 THEN
        RAISE EXCEPTION 'INVALID_PRICE: El precio unitario debe ser mayor a cero';
    END IF;

    v_total_price_bigint := p_quantity::BIGINT * p_unit_price_ec::BIGINT;
    IF v_total_price_bigint <= 0 OR v_total_price_bigint > 2147483647 THEN
        RAISE EXCEPTION 'PRICE_OVERFLOW: Precio total fuera de rango permitido';
    END IF;

    v_total_price_ec := v_total_price_bigint::INTEGER;
    v_tax_total := FLOOR(v_total_price_ec * 0.02);
    v_burn_ec := FLOOR(v_total_price_ec * 0.01);
    v_royalty_ec := v_tax_total - v_burn_ec;
    v_net_seller_revenue_ec := v_total_price_ec - v_tax_total;

    v_item_code := CASE
        WHEN p_item_category = 'unit_chassis' THEN lower(trim(p_item_code))
        ELSE trim(p_item_code)
    END;

    -- Bloqueos y débito de escrow en Orden Canónico Global:
    -- user_unit_hangar (ORDER BY id ASC) -> profiles (ORDER BY id ASC) -> user_industrial_inventory (ORDER BY user_id ASC)
    IF p_item_category = 'unit_chassis' THEN
        SELECT * INTO v_hangar_row
        FROM public.user_unit_hangar
        WHERE user_id = v_seller_id
          AND lower(unit_code) = v_item_code
          AND tier = p_tier
        ORDER BY id ASC
        FOR UPDATE;

        IF NOT FOUND OR v_hangar_row.quantity < p_quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_HANGAR_STOCK: Chasis insuficientes en hangar para escrow';
        END IF;

        IF v_hangar_row.quantity = p_quantity THEN
            DELETE FROM public.user_unit_hangar WHERE id = v_hangar_row.id;
        ELSE
            UPDATE public.user_unit_hangar
            SET quantity = quantity - p_quantity,
                updated_at = v_now
            WHERE id = v_hangar_row.id;
        END IF;

    ELSIF p_item_category IN ('raw_resource', 'refined_material') THEN
        IF v_item_code NOT IN (
            'raw_iron', 'raw_stone', 'raw_rare_earth',
            'refined_steel', 'refined_concrete', 'refined_microchip',
            'campaign_fuel', 'fuel', 'tech_scrap'
        ) THEN
            SELECT * INTO v_profile
            FROM public.profiles
            WHERE id = v_seller_id
            ORDER BY id ASC
            FOR UPDATE;

            v_current_stock := COALESCE((v_profile.metadata ->> v_item_code)::INTEGER, 0);
            IF v_current_stock < p_quantity THEN
                RAISE EXCEPTION 'INSUFFICIENT_INVENTORY: Stock insuficiente de % para escrow', v_item_code;
            END IF;

            PERFORM set_config('app.bypass_profile_guard', 'on', true);
            UPDATE public.profiles
            SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    ARRAY[v_item_code],
                    ((v_current_stock - p_quantity)::TEXT)::jsonb
                ),
                updated_at = v_now
            WHERE id = v_seller_id;
        ELSE
            SELECT * INTO v_inv
            FROM public.user_industrial_inventory
            WHERE user_id = v_seller_id
            ORDER BY user_id ASC
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'INVENTORY_NOT_FOUND: Inventario industrial no inicializado';
            END IF;

            CASE v_item_code
                WHEN 'raw_iron' THEN v_current_stock := v_inv.raw_iron;
                WHEN 'raw_stone' THEN v_current_stock := v_inv.raw_stone;
                WHEN 'raw_rare_earth' THEN v_current_stock := v_inv.raw_rare_earth;
                WHEN 'refined_steel' THEN v_current_stock := v_inv.refined_steel;
                WHEN 'refined_concrete' THEN v_current_stock := v_inv.refined_concrete;
                WHEN 'refined_microchip' THEN v_current_stock := v_inv.refined_microchip;
                WHEN 'campaign_fuel' THEN v_current_stock := v_inv.campaign_fuel;
                WHEN 'fuel' THEN v_current_stock := v_inv.campaign_fuel;
                WHEN 'tech_scrap' THEN v_current_stock := v_inv.tech_scrap;
            END CASE;

            IF v_current_stock < p_quantity THEN
                RAISE EXCEPTION 'INSUFFICIENT_INVENTORY: Stock insuficiente de % para escrow', v_item_code;
            END IF;

            CASE v_item_code
                WHEN 'raw_iron' THEN
                    UPDATE public.user_industrial_inventory SET raw_iron = raw_iron - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'raw_stone' THEN
                    UPDATE public.user_industrial_inventory SET raw_stone = raw_stone - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'raw_rare_earth' THEN
                    UPDATE public.user_industrial_inventory SET raw_rare_earth = raw_rare_earth - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'refined_steel' THEN
                    UPDATE public.user_industrial_inventory SET refined_steel = refined_steel - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'refined_concrete' THEN
                    UPDATE public.user_industrial_inventory SET refined_concrete = refined_concrete - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'refined_microchip' THEN
                    UPDATE public.user_industrial_inventory SET refined_microchip = refined_microchip - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'campaign_fuel' THEN
                    UPDATE public.user_industrial_inventory SET campaign_fuel = campaign_fuel - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'fuel' THEN
                    UPDATE public.user_industrial_inventory SET campaign_fuel = campaign_fuel - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
                WHEN 'tech_scrap' THEN
                    UPDATE public.user_industrial_inventory SET tech_scrap = tech_scrap - p_quantity, updated_at = v_now WHERE user_id = v_seller_id;
            END CASE;
        END IF;

    ELSE
        -- patent_blueprint, buff_consumable, cosmetic
        SELECT * INTO v_profile
        FROM public.profiles
        WHERE id = v_seller_id
        ORDER BY id ASC
        FOR UPDATE;

        v_current_stock := COALESCE((v_profile.metadata ->> v_item_code)::INTEGER, 0);
        IF v_current_stock < p_quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_INVENTORY: Stock insuficiente de % para escrow', v_item_code;
        END IF;

        PERFORM set_config('app.bypass_profile_guard', 'on', true);
        UPDATE public.profiles
        SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                ARRAY[v_item_code],
                ((v_current_stock - p_quantity)::TEXT)::jsonb
            ),
            updated_at = v_now
        WHERE id = v_seller_id;
    END IF;

    INSERT INTO public.p2p_market_orders (
        seller_id,
        origin_province_id,
        province_terminal_id,
        item_category,
        item_code,
        tier,
        quantity,
        unit_price_ec,
        total_price_ec,
        platform_burn_ec,
        province_royalty_ec,
        net_seller_revenue_ec,
        status,
        created_at
    ) VALUES (
        v_seller_id,
        COALESCE(p_origin_province_id, 'ES_MADRID'),
        COALESCE(p_province_terminal_id, 'ES_MADRID'),
        p_item_category,
        v_item_code,
        p_tier,
        p_quantity,
        p_unit_price_ec,
        v_total_price_ec,
        v_burn_ec,
        v_royalty_ec,
        v_net_seller_revenue_ec,
        'active',
        v_now
    )
    RETURNING * INTO v_order;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
        VALUES (p_idempotency_key, v_seller_id, 'publish_p2p_market_order', to_jsonb(v_order))
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_p2p_market_order(TEXT, TEXT, INT, INT, INT, VARCHAR, VARCHAR, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_p2p_market_order(TEXT, TEXT, INT, INT, INT, VARCHAR, VARCHAR, UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. RPC: cancel_p2p_market_order (Reembolso Atómico de Escrow + Idempotencia)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_p2p_market_order(
    p_order_id UUID,
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
    v_preview public.p2p_market_orders%ROWTYPE;
    v_order public.p2p_market_orders%ROWTYPE;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_res JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT response INTO v_cached
        FROM public.economy_rpc_idempotency
        WHERE idempotency_key = p_idempotency_key
          AND user_id = v_user_id
          AND rpc_name = 'cancel_p2p_market_order';

        IF FOUND THEN
            RETURN v_cached;
        END IF;
    END IF;

    -- Lectura sin lock para descubrir entidades y respetar el Orden Canónico Global
    SELECT * INTO v_preview
    FROM public.p2p_market_orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Orden no encontrada');
    END IF;

    IF v_preview.seller_id <> v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autorizado para cancelar esta orden');
    END IF;

    IF v_preview.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'La orden ya no está activa');
    END IF;

    -- Orden Canónico Global de Locks:
    -- user_unit_hangar (ORDER BY id ASC) -> profiles (ORDER BY id ASC) -> user_industrial_inventory (ORDER BY user_id ASC) -> p2p_market_orders (ORDER BY id ASC)
    IF v_preview.item_category = 'unit_chassis' THEN
        PERFORM 1
        FROM public.user_unit_hangar
        WHERE user_id = v_preview.seller_id
          AND lower(unit_code) = lower(v_preview.item_code)
          AND tier = v_preview.tier
        ORDER BY id ASC
        FOR UPDATE;
    ELSIF v_preview.item_category IN ('raw_resource', 'refined_material') THEN
        IF v_preview.item_code NOT IN (
            'raw_iron', 'raw_stone', 'raw_rare_earth',
            'refined_steel', 'refined_concrete', 'refined_microchip',
            'campaign_fuel', 'fuel', 'tech_scrap'
        ) THEN
            PERFORM 1
            FROM public.profiles
            WHERE id = v_preview.seller_id
            ORDER BY id ASC
            FOR UPDATE;
        ELSE
            INSERT INTO public.user_industrial_inventory (user_id)
            VALUES (v_preview.seller_id)
            ON CONFLICT (user_id) DO NOTHING;

            PERFORM 1
            FROM public.user_industrial_inventory
            WHERE user_id = v_preview.seller_id
            ORDER BY user_id ASC
            FOR UPDATE;
        END IF;
    ELSE
        PERFORM 1
        FROM public.profiles
        WHERE id = v_preview.seller_id
        ORDER BY id ASC
        FOR UPDATE;
    END IF;

    SELECT * INTO v_order
    FROM public.p2p_market_orders
    WHERE id = p_order_id
      AND status = 'active'
    ORDER BY id ASC
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Orden no disponible o ya finalizada');
    END IF;

    IF v_order.seller_id <> v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autorizado para cancelar esta orden');
    END IF;

    -- Reembolso atómico del activo en escrow al vendedor
    IF v_order.item_category = 'unit_chassis' THEN
        INSERT INTO public.user_unit_hangar (
            user_id, unit_code, tier, level, hp, quantity, location_province_id, created_at, updated_at
        ) VALUES (
            v_order.seller_id, lower(v_order.item_code), v_order.tier, 1, 100, v_order.quantity, v_order.origin_province_id, v_now, v_now
        )
        ON CONFLICT (user_id, unit_code, tier) DO UPDATE
        SET quantity = public.user_unit_hangar.quantity + EXCLUDED.quantity,
            updated_at = v_now;

    ELSIF v_order.item_category IN ('raw_resource', 'refined_material') THEN
        CASE v_order.item_code
            WHEN 'raw_iron' THEN
                UPDATE public.user_industrial_inventory SET raw_iron = raw_iron + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'raw_stone' THEN
                UPDATE public.user_industrial_inventory SET raw_stone = raw_stone + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'raw_rare_earth' THEN
                UPDATE public.user_industrial_inventory SET raw_rare_earth = raw_rare_earth + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'refined_steel' THEN
                UPDATE public.user_industrial_inventory SET refined_steel = refined_steel + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'refined_concrete' THEN
                UPDATE public.user_industrial_inventory SET refined_concrete = refined_concrete + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'refined_microchip' THEN
                UPDATE public.user_industrial_inventory SET refined_microchip = refined_microchip + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'campaign_fuel' THEN
                UPDATE public.user_industrial_inventory SET campaign_fuel = campaign_fuel + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'fuel' THEN
                UPDATE public.user_industrial_inventory SET campaign_fuel = campaign_fuel + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            WHEN 'tech_scrap' THEN
                UPDATE public.user_industrial_inventory SET tech_scrap = tech_scrap + v_order.quantity, updated_at = v_now WHERE user_id = v_order.seller_id;
            ELSE
                PERFORM set_config('app.bypass_profile_guard', 'on', true);
                UPDATE public.profiles
                SET metadata = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        ARRAY[v_order.item_code],
                        ((COALESCE((metadata ->> v_order.item_code)::INTEGER, 0) + v_order.quantity)::TEXT)::jsonb
                    ),
                    updated_at = v_now
                WHERE id = v_order.seller_id;
        END CASE;
    ELSE
        PERFORM set_config('app.bypass_profile_guard', 'on', true);
        UPDATE public.profiles
        SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                ARRAY[v_order.item_code],
                ((COALESCE((metadata ->> v_order.item_code)::INTEGER, 0) + v_order.quantity)::TEXT)::jsonb
            ),
            updated_at = v_now
        WHERE id = v_order.seller_id;
    END IF;

    UPDATE public.p2p_market_orders
    SET status = 'cancelled'
    WHERE id = p_order_id;

    v_res := jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'status', 'cancelled',
        'item_category', v_order.item_category,
        'item_code', v_order.item_code,
        'refunded_quantity', v_order.quantity
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.economy_rpc_idempotency (idempotency_key, user_id, rpc_name, response)
        VALUES (p_idempotency_key, v_user_id, 'cancel_p2p_market_order', v_res)
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_p2p_market_order(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_market_order(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. REFACTOR RPC: execute_p2p_market_transaction (Orden Canónico de Locks)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_p2p_market_transaction(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_buyer_id UUID := (SELECT auth.uid());
    v_preview public.p2p_market_orders%ROWTYPE;
    v_order public.p2p_market_orders%ROWTYPE;
    v_buyer_profile public.profiles%ROWTYPE;
    v_seller_profile public.profiles%ROWTYPE;
    v_territory public.territory_control%ROWTYPE;
    v_controlling_clan_id UUID := NULL;
    v_tax_total INTEGER;
    v_burn_ec INTEGER;
    v_royalty_ec INTEGER;
    v_net_payout INTEGER;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    IF v_buyer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
    END IF;

    -- Lectura previa sin lock para descubrir entidades y respetar Orden Canónico Global
    SELECT * INTO v_preview
    FROM public.p2p_market_orders
    WHERE id = p_order_id;

    IF NOT FOUND OR v_preview.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Orden no disponible o ya finalizada');
    END IF;

    IF v_preview.seller_id = v_buyer_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'No puedes comprar tu propia orden');
    END IF;

    IF v_preview.province_terminal_id IS NOT NULL THEN
        SELECT controlling_clan_id INTO v_controlling_clan_id
        FROM public.territory_control
        WHERE province_id = v_preview.province_terminal_id;
    END IF;

    -- Orden Canónico Global de Locks:
    -- clans -> user_unit_hangar (ORDER BY id ASC) -> profiles (ORDER BY id ASC)
    -- -> user_industrial_inventory (ORDER BY user_id ASC) -> p2p_market_orders (ORDER BY id ASC)
    IF v_controlling_clan_id IS NOT NULL THEN
        PERFORM 1
        FROM public.clans
        WHERE id = v_controlling_clan_id
        FOR UPDATE;
    END IF;

    IF v_preview.item_category = 'unit_chassis' THEN
        PERFORM 1
        FROM public.user_unit_hangar
        WHERE user_id = v_buyer_id
          AND lower(unit_code) = lower(v_preview.item_code)
          AND tier = v_preview.tier
        ORDER BY id ASC
        FOR UPDATE;
    END IF;

    IF v_buyer_id < v_preview.seller_id THEN
        SELECT * INTO v_buyer_profile FROM public.profiles WHERE id = v_buyer_id FOR UPDATE;
        SELECT * INTO v_seller_profile FROM public.profiles WHERE id = v_preview.seller_id FOR UPDATE;
    ELSE
        SELECT * INTO v_seller_profile FROM public.profiles WHERE id = v_preview.seller_id FOR UPDATE;
        SELECT * INTO v_buyer_profile FROM public.profiles WHERE id = v_buyer_id FOR UPDATE;
    END IF;

    IF v_preview.item_category IN ('raw_resource', 'refined_material') THEN
        INSERT INTO public.user_industrial_inventory (user_id)
        VALUES (v_buyer_id)
        ON CONFLICT (user_id) DO NOTHING;

        PERFORM 1
        FROM public.user_industrial_inventory
        WHERE user_id = v_buyer_id
        ORDER BY user_id ASC
        FOR UPDATE;
    END IF;

    SELECT * INTO v_order
    FROM public.p2p_market_orders
    WHERE id = p_order_id
      AND status = 'active'
    ORDER BY id ASC
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Orden no disponible o ya finalizada');
    END IF;

    IF v_order.seller_id = v_buyer_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'No puedes comprar tu propia orden');
    END IF;

    IF v_buyer_profile.battle_credits < v_order.total_price_ec THEN
        RETURN jsonb_build_object('success', false, 'error', 'Créditos de batalla insuficientes');
    END IF;

    v_tax_total := FLOOR(v_order.total_price_ec * 0.02);
    v_burn_ec := FLOOR(v_order.total_price_ec * 0.01);
    v_royalty_ec := v_tax_total - v_burn_ec;
    v_net_payout := v_order.total_price_ec - v_tax_total;

    PERFORM set_config('app.bypass_profile_guard', 'on', true);

    UPDATE public.profiles
    SET battle_credits = battle_credits - v_order.total_price_ec,
        wallet_balance = battle_credits - v_order.total_price_ec,
        updated_at = v_now
    WHERE id = v_buyer_id;

    UPDATE public.profiles
    SET battle_credits = battle_credits + v_net_payout,
        wallet_balance = battle_credits + v_net_payout,
        updated_at = v_now
    WHERE id = v_order.seller_id;

    IF v_order.province_terminal_id IS NOT NULL AND v_royalty_ec > 0 THEN
        SELECT * INTO v_territory
        FROM public.territory_control
        WHERE province_id = v_order.province_terminal_id;

        IF FOUND AND v_territory.controlling_clan_id IS NOT NULL THEN
            UPDATE public.clans
            SET treasury_gold = treasury_gold + v_royalty_ec
            WHERE id = v_territory.controlling_clan_id;
        END IF;
    END IF;

    -- Entrega del activo físico en escrow al comprador
    IF v_order.item_category = 'unit_chassis' THEN
        INSERT INTO public.user_unit_hangar (
            user_id, unit_code, tier, level, hp, quantity, location_province_id, created_at, updated_at
        ) VALUES (
            v_buyer_id, lower(v_order.item_code), v_order.tier, 1, 100, v_order.quantity, v_order.province_terminal_id, v_now, v_now
        )
        ON CONFLICT (user_id, unit_code, tier) DO UPDATE
        SET quantity = public.user_unit_hangar.quantity + EXCLUDED.quantity,
            updated_at = v_now;
    ELSIF v_order.item_category IN ('raw_resource', 'refined_material') THEN
        CASE v_order.item_code
            WHEN 'raw_iron' THEN
                UPDATE public.user_industrial_inventory SET raw_iron = raw_iron + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'raw_stone' THEN
                UPDATE public.user_industrial_inventory SET raw_stone = raw_stone + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'raw_rare_earth' THEN
                UPDATE public.user_industrial_inventory SET raw_rare_earth = raw_rare_earth + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'refined_steel' THEN
                UPDATE public.user_industrial_inventory SET refined_steel = refined_steel + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'refined_concrete' THEN
                UPDATE public.user_industrial_inventory SET refined_concrete = refined_concrete + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'refined_microchip' THEN
                UPDATE public.user_industrial_inventory SET refined_microchip = refined_microchip + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'campaign_fuel' THEN
                UPDATE public.user_industrial_inventory SET campaign_fuel = campaign_fuel + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'fuel' THEN
                UPDATE public.user_industrial_inventory SET campaign_fuel = campaign_fuel + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            WHEN 'tech_scrap' THEN
                UPDATE public.user_industrial_inventory SET tech_scrap = tech_scrap + v_order.quantity, updated_at = v_now WHERE user_id = v_buyer_id;
            ELSE
                UPDATE public.profiles
                SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb),
                    ARRAY[v_order.item_code],
                    (COALESCE((metadata->>v_order.item_code)::integer, 0) + v_order.quantity)::text::jsonb
                )
                WHERE id = v_buyer_id;
        END CASE;
    ELSE
        UPDATE public.profiles
        SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            ARRAY[v_order.item_code],
            (COALESCE((metadata->>v_order.item_code)::integer, 0) + v_order.quantity)::text::jsonb
        )
        WHERE id = v_buyer_id;
    END IF;

    UPDATE public.p2p_market_orders
    SET buyer_id = v_buyer_id,
        platform_burn_ec = v_burn_ec,
        province_royalty_ec = v_royalty_ec,
        net_seller_revenue_ec = v_net_payout,
        status = 'completed',
        completed_at = v_now
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'total_price_ec', v_order.total_price_ec,
        'platform_burn_ec', v_burn_ec,
        'province_royalty_ec', v_royalty_ec,
        'seller_received', v_net_payout
    );
END;
$$;
