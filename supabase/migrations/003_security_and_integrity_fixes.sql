-- ==============================================================================
-- 003_security_and_integrity_fixes.sql
-- Устранение уязвимостей безопасности, атомарное связывание лидов и SQL-агрегаты
-- В соответствии с DB.md, GEMINI.md и ТЗ.md
-- ==============================================================================

-- 1. БЕЗОПАСНОСТЬ: Отзыв публичного анонимного доступа к таблице users
DROP POLICY IF EXISTS "users_anon_select_policy" ON public.users;

-- 2. ЦЕЛОСТНОСТЬ ДАННЫХ: Атомарная процедура связывания «Лид -> Продавец -> Начисление»
-- Выполняется в единой транзакции с блокировкой строк FOR UPDATE для защиты от race conditions
CREATE OR REPLACE FUNCTION public.link_lead_to_seller(
    p_lead_id UUID,
    p_seller_phone VARCHAR(20),
    p_manager_id UUID,
    p_assigned_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_lead RECORD;
    v_seller RECORD;
    v_collision_lead RECORD;
    v_plan_price NUMERIC(12,2) := 2500.00;
    v_connection_percent NUMERIC(5,2) := 30.00;
    v_connection_fee_amount NUMERIC(12,2);
    v_connection_id UUID;
    v_current_month VARCHAR(7);
    v_now TIMESTAMPTZ := now();
    v_effective_manager_id UUID;
BEGIN
    -- 1. Блокируем и проверяем лид
    SELECT * INTO v_lead FROM public.leads WHERE lead_id = p_lead_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лид не найден в системе');
    END IF;

    IF v_lead.seller_phone IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Этот лид уже связан с продавцом +' || v_lead.seller_phone);
    END IF;

    IF v_lead.status = 'Подписан' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лид уже имеет статус «Подписан»');
    END IF;

    IF v_lead.status = 'Отмена' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Нельзя привязать отмененный лид');
    END IF;

    -- 2. Блокируем и проверяем продавца на коллизию
    SELECT * INTO v_seller FROM public.sellers WHERE seller_phone = p_seller_phone FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец не найден в базе данных Sotka');
    END IF;

    SELECT lead_id, client_name INTO v_collision_lead 
    FROM public.leads 
    WHERE seller_phone = p_seller_phone 
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Продавец +' || p_seller_phone || ' уже привязан к другому лиду («' || v_collision_lead.client_name || '»)');
    END IF;

    -- 3. Определяем менеджера / консультанта
    v_effective_manager_id := COALESCE(v_lead.assigned_to, p_manager_id, p_assigned_by);

    -- 4. Получаем стоимость тарифа продавца
    IF v_seller.plan_id IS NOT NULL THEN
        SELECT price INTO v_plan_price FROM public.plans WHERE plan_id = v_seller.plan_id;
        IF v_plan_price IS NULL THEN v_plan_price := 2500.00; END IF;
    END IF;

    -- 5. Получаем персональную ставку комиссии консультанта
    SELECT connection_percent INTO v_connection_percent
    FROM public.employee_rates
    WHERE user_id = v_effective_manager_id
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_connection_percent IS NULL THEN
        v_connection_percent := 30.00;
    END IF;

    v_connection_fee_amount := round((v_plan_price * v_connection_percent / 100.0), 2);
    v_current_month := to_char(v_now, 'YYYY-MM');

    -- 6. Обновляем лид
    UPDATE public.leads
    SET seller_phone = p_seller_phone,
        status = 'Подписан',
        linked_at = v_now,
        assigned_to = v_effective_manager_id,
        updated_at = v_now
    WHERE lead_id = p_lead_id;

    -- 7. Обновляем продавца: привязываем куратора
    UPDATE public.sellers
    SET manager_id = v_effective_manager_id
    WHERE seller_phone = p_seller_phone;

    -- 8. Создаем запись в connections
    INSERT INTO public.connections (
        seller_phone,
        seller_name,
        store,
        manager_id,
        assigned_by,
        assigned_at,
        status,
        plan_id,
        plan_price,
        connection_fee_percent,
        connection_fee_amount,
        accrual_month,
        client_status,
        maintenance_months_limit,
        maintenance_months_accrued
    ) VALUES (
        p_seller_phone,
        COALESCE(v_seller.seller_name, v_lead.client_name),
        COALESCE(v_seller.store, 'Без названия'),
        v_effective_manager_id,
        p_assigned_by,
        v_now,
        'подключен',
        v_seller.plan_id,
        v_plan_price,
        v_connection_percent,
        v_connection_fee_amount,
        v_current_month,
        'новый',
        3,
        0
    ) RETURNING connection_id INTO v_connection_id;

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID) TO authenticated;

-- 3. ПРОИЗВОДИТЕЛЬНОСТЬ: SQL-агрегат для воронки лидов
CREATE OR REPLACE FUNCTION public.get_leads_funnel_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'total', count(*)::int,
        'open', count(*) FILTER (WHERE status = 'Открыт')::int,
        'processed', count(*) FILTER (WHERE status = 'Обработан')::int,
        'assigned', count(*) FILTER (WHERE status = 'Назначен')::int,
        'signed', count(*) FILTER (WHERE status = 'Подписан')::int,
        'cancelled', count(*) FILTER (WHERE status = 'Отмена')::int
    )
    FROM public.leads;
$$;

GRANT EXECUTE ON FUNCTION public.get_leads_funnel_stats() TO authenticated;

-- 4. ПРОИЗВОДИТЕЛЬНОСТЬ: SQL-агрегат для метрик продавцов
CREATE OR REPLACE FUNCTION public.get_sellers_kpi_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'total', count(*)::int,
        'active', count(*) FILTER (WHERE is_active = true)::int,
        'pendingModeration', count(*) FILTER (WHERE moderation = 'pending')::int,
        'totalBalance', COALESCE(sum(balance), 0)::numeric(12,2),
        'assigned', count(*) FILTER (WHERE manager_id IS NOT NULL)::int
    )
    FROM public.sellers;
$$;

GRANT EXECUTE ON FUNCTION public.get_sellers_kpi_stats() TO authenticated;
