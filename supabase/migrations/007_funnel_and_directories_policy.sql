-- 007_funnel_and_directories_policy.sql
-- Разграничение прав по бизнес-логике:
-- 1. SMM: создание (Открыт), редактирование только в статусах Открыт/Обработан.
-- 2. Консультант: видит только назначенные лиды в статусах Назначен, Подписан, Отмена. Редактирует только свои лиды.
-- 3. Администратор: полное управление, привязка продавцов к лидам и удаление в справочниках.

-- 1. Обновление процедуры расчета KPI воронки лидов
CREATE OR REPLACE FUNCTION get_leads_funnel_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role user_role;
    v_user_uuid UUID;
    v_result JSON;
BEGIN
    v_role := get_current_user_role();
    v_user_uuid := get_current_crm_user_id();

    IF v_role = 'smm' THEN
        -- SMM видит только созданные им лиды
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_result
        FROM leads
        WHERE created_by = v_user_uuid;
    ELSIF v_role = 'consultant' THEN
        -- Консультант видит ТОЛЬКО назначенные на него лиды со статусами Назначен, Подписан, Отмена
        SELECT json_build_object(
            'total', count(*) FILTER (WHERE status IN ('Назначен', 'Подписан', 'Отмена')),
            'open', 0,
            'processed', 0,
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_result
        FROM leads
        WHERE assigned_to = v_user_uuid;
    ELSE
        -- Администратор видит сквозную аналитику всей компании
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_result
        FROM leads;
    END IF;

    RETURN v_result;
END;
$$;

-- 2. Обновление политик безопасности (RLS) для таблицы leads
DROP POLICY IF EXISTS "leads_select_policy" ON leads;
CREATE POLICY "leads_select_policy" ON leads
FOR SELECT TO authenticated
USING (
    (SELECT get_current_user_role()) = 'admin'
    OR ((SELECT get_current_user_role()) = 'smm' AND created_by = (SELECT get_current_crm_user_id()))
    OR (
        (SELECT get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
);

DROP POLICY IF EXISTS "leads_update_policy" ON leads;
CREATE POLICY "leads_update_policy" ON leads
FOR UPDATE TO authenticated
USING (
    (SELECT get_current_user_role()) = 'admin'
    OR (
        (SELECT get_current_user_role()) = 'smm' 
        AND created_by = (SELECT get_current_crm_user_id()) 
        AND status IN ('Открыт', 'Обработан')
    )
    OR (
        (SELECT get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
)
WITH CHECK (
    (SELECT get_current_user_role()) = 'admin'
    OR (
        (SELECT get_current_user_role()) = 'smm' 
        AND created_by = (SELECT get_current_crm_user_id()) 
        AND status IN ('Открыт', 'Обработан')
    )
    OR (
        (SELECT get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
);

-- 3. Политики безопасности RLS для справочников plans и employee_rates
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_select_policy" ON plans;
CREATE POLICY "plans_select_policy" ON plans
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "plans_admin_all_policy" ON plans;
CREATE POLICY "plans_admin_all_policy" ON plans
FOR ALL TO authenticated
USING ((SELECT get_current_user_role()) = 'admin')
WITH CHECK ((SELECT get_current_user_role()) = 'admin');

ALTER TABLE employee_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_rates_select_policy" ON employee_rates;
CREATE POLICY "employee_rates_select_policy" ON employee_rates
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "employee_rates_admin_all_policy" ON employee_rates;
CREATE POLICY "employee_rates_admin_all_policy" ON employee_rates
FOR ALL TO authenticated
USING ((SELECT get_current_user_role()) = 'admin')
WITH CHECK ((SELECT get_current_user_role()) = 'admin');

-- 4. Улучшенная процедура связывания «Лид -> Продавец -> Начисление»
CREATE OR REPLACE FUNCTION public.link_lead_to_seller(
    p_lead_id UUID,
    p_seller_phone VARCHAR(20),
    p_manager_id UUID DEFAULT NULL,
    p_assigned_by UUID DEFAULT NULL
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
    v_operator_id UUID;
BEGIN
    v_operator_id := COALESCE(p_assigned_by, get_current_crm_user_id());

    -- 1. Блокируем и проверяем лид
    SELECT * INTO v_lead FROM public.leads WHERE lead_id = p_lead_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Лид не найден в системе');
    END IF;

    IF v_lead.seller_phone IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Этот лид уже связан с продавцом +' || v_lead.seller_phone);
    END IF;

    IF v_lead.status = 'Отмена' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Нельзя привязать отмененный лид');
    END IF;

    -- 2. Блокируем и проверяем продавца
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

    -- 3. Приоритет консультанта: консультант из лида -> переданный p_manager_id -> оператор
    v_effective_manager_id := COALESCE(v_lead.assigned_to, p_manager_id, v_operator_id);

    -- 4. Получаем стоимость тарифа продавца
    IF v_seller.plan_id IS NOT NULL THEN
        SELECT price INTO v_plan_price FROM public.plans WHERE plan_id = v_seller.plan_id;
        IF v_plan_price IS NULL THEN v_plan_price := 2500.00; END IF;
    END IF;

    -- 5. Получаем персональную ставку комиссии консультанта
    IF v_effective_manager_id IS NOT NULL THEN
        SELECT connection_percent INTO v_connection_percent
        FROM public.employee_rates
        WHERE user_id = v_effective_manager_id
        ORDER BY effective_from DESC
        LIMIT 1;

        IF v_connection_percent IS NULL THEN
            v_connection_percent := 30.00;
        END IF;
    END IF;

    v_connection_fee_amount := round((v_plan_price * v_connection_percent / 100.0), 2);
    v_current_month := to_char(v_now, 'YYYY-MM');

    -- 6. Обновляем лид (статус переходит в Подписан)
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

    -- 8. Создаем или обновляем запись в connections с расчетом выплаты
    SELECT connection_id INTO v_connection_id 
    FROM public.connections 
    WHERE seller_phone = p_seller_phone 
    LIMIT 1;

    IF v_connection_id IS NOT NULL THEN
        UPDATE public.connections
        SET manager_id = v_effective_manager_id,
            plan_id = v_seller.plan_id,
            plan_price = v_plan_price,
            connection_fee_percent = v_connection_percent,
            connection_fee_amount = v_connection_fee_amount,
            status = 'подключен',
            client_status = 'новый'
        WHERE connection_id = v_connection_id;
    ELSE
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
            maintenance_months_limit
        ) VALUES (
            p_seller_phone,
            v_seller.seller_name,
            COALESCE(v_seller.store, 'Без названия'),
            v_effective_manager_id,
            v_operator_id,
            v_now,
            'подключен',
            v_seller.plan_id,
            v_plan_price,
            v_connection_percent,
            v_connection_fee_amount,
            v_current_month,
            'новый',
            3
        )
        RETURNING connection_id INTO v_connection_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'lead_id', p_lead_id,
        'seller_phone', p_seller_phone,
        'manager_id', v_effective_manager_id,
        'connection_id', v_connection_id,
        'connection_fee_amount', v_connection_fee_amount
    );
END;
$$;
