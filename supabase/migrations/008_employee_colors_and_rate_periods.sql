-- ==============================================================================
-- Миграция 008: Цветовая индикация сотрудников, версионирование цен тарифов по датам,
-- периодические процентные ставки сотрудников и доработка RPC-связывания
-- ==============================================================================

-- 1. ЦВЕТОВАЯ ИНДИКАЦИЯ СОТРУДНИКОВ
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS color VARCHAR(30) NOT NULL DEFAULT '#3B82F6';

-- 2. ВЕРСИОНИРОВАНИЕ ЦЕН ТАРИФОВ ПО ДАТАМ (plan_prices)
CREATE TABLE IF NOT EXISTS public.plan_prices (
    price_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id VARCHAR(50) NOT NULL REFERENCES public.plans(plan_id) ON DELETE CASCADE,
    price NUMERIC(12,2) NOT NULL,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NULL REFERENCES public.users(user_id),
    CONSTRAINT uq_plan_price_plan_date UNIQUE(plan_id, effective_from)
);

-- Первичное наполнение базовыми ценами из plans, если еще не заполнены
INSERT INTO public.plan_prices (plan_id, price, effective_from, created_at)
SELECT plan_id, price, '2020-01-01'::date, now()
FROM public.plans
ON CONFLICT (plan_id, effective_from) DO NOTHING;

-- RLS для plan_prices
ALTER TABLE public.plan_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_prices_select_policy" ON public.plan_prices;
CREATE POLICY "plan_prices_select_policy" ON public.plan_prices
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "plan_prices_admin_all_policy" ON public.plan_prices;
CREATE POLICY "plan_prices_admin_all_policy" ON public.plan_prices
    FOR ALL TO authenticated
    USING ((SELECT public.get_current_user_role()) = 'admin')
    WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');

-- Функция получения цены тарифа на заданную дату
CREATE OR REPLACE FUNCTION public.get_plan_price_on_date(
    p_plan_id VARCHAR,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC(12,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_price NUMERIC(12,2);
BEGIN
    SELECT price INTO v_price
    FROM public.plan_prices
    WHERE plan_id = p_plan_id
      AND effective_from <= COALESCE(p_date, CURRENT_DATE)
    ORDER BY effective_from DESC, created_at DESC
    LIMIT 1;

    IF v_price IS NULL THEN
        SELECT price INTO v_price FROM public.plans WHERE plan_id = p_plan_id;
    END IF;

    RETURN COALESCE(v_price, 2500.00);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_plan_price_on_date(VARCHAR, DATE) TO authenticated;

-- 3. ПЕРИОДИЧЕСКИЕ ПРОЦЕНТНЫЕ СТАВКИ СОТРУДНИКОВ (employee_rates)
-- Удаляем возможные дубликаты перед добавлением уникального индекса
DELETE FROM public.employee_rates a
USING public.employee_rates b
WHERE a.rate_id < b.rate_id
  AND a.user_id = b.user_id
  AND a.effective_from = b.effective_from;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_employee_rates_user_month'
    ) THEN
        ALTER TABLE public.employee_rates 
        ADD CONSTRAINT uq_employee_rates_user_month UNIQUE (user_id, effective_from);
    END IF;
END $$;

-- Функция получения персональной ставки сотрудника на расчетный месяц (YYYY-MM)
CREATE OR REPLACE FUNCTION public.get_employee_rate_on_month(
    p_user_id UUID,
    p_month VARCHAR(7) DEFAULT to_char(now(), 'YYYY-MM')
)
RETURNS TABLE (
    connection_percent NUMERIC(5,2),
    maintenance_percent NUMERIC(5,2)
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT er.connection_percent, er.maintenance_percent
    FROM public.employee_rates er
    WHERE er.user_id = p_user_id
      AND er.effective_from <= COALESCE(p_month, to_char(now(), 'YYYY-MM'))
    ORDER BY er.effective_from DESC, er.created_at DESC
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_rate_on_month(UUID, VARCHAR) TO authenticated;

-- 4. ОБНОВЛЕНИЕ RPC-ФУНКЦИИ link_lead_to_seller
-- Учитывает историческую цену тарифа на дату подключения и ставку сотрудника по периоду
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
    v_current_month := to_char(v_now, 'YYYY-MM');

    -- 4. Получаем стоимость тарифа продавца на дату привязки
    IF v_seller.plan_id IS NOT NULL THEN
        v_plan_price := public.get_plan_price_on_date(v_seller.plan_id, (v_now::DATE));
    END IF;

    -- 5. Получаем персональную ставку комиссии консультанта на расчетный период
    IF v_effective_manager_id IS NOT NULL THEN
        SELECT r.connection_percent INTO v_connection_percent
        FROM public.get_employee_rate_on_month(v_effective_manager_id, v_current_month) r;

        IF v_connection_percent IS NULL THEN
            v_connection_percent := 30.00;
        END IF;
    END IF;

    v_connection_fee_amount := round((v_plan_price * v_connection_percent / 100.0), 2);

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
            v_seller.store,
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
        ) RETURNING connection_id INTO v_connection_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'connection_id', v_connection_id,
        'connection_fee_amount', v_connection_fee_amount,
        'assigned_to', v_effective_manager_id,
        'plan_price', v_plan_price,
        'connection_fee_percent', v_connection_percent
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_lead_to_seller(UUID, VARCHAR, UUID, UUID) TO authenticated;
