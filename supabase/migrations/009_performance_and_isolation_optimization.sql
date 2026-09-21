-- 009_performance_and_isolation_optimization.sql
-- Комплексная оптимизация производительности СУБД/RLS:
-- 1. Мемоизация роли и идентификатора CRM-пользователя через JWT app_metadata (zero I/O) с fallback на users (STABLE)
-- 2. Оборачивание вызовов функций в (SELECT ...) в RLS-политиках
-- 3. Композитные индексы для leads, connections, employee_payouts, payments
-- 4. Агрегирующие RPC-функции (get_payouts_summary, get_analytics_summary)
-- 5. Защита от Race Condition и атомарное начисление выплат с блокировкой FOR UPDATE

-- ==============================================================================
-- 1. Оптимизированные функции извлечения контекста авторизации (STABLE SECURITY DEFINER)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS user_role AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'role', '')::user_role,
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid()) AND is_active = true LIMIT 1)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_current_crm_user_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'user_id', '')::UUID,
    (SELECT user_id FROM public.users WHERE auth_id = (SELECT auth.uid()) AND is_active = true LIMIT 1)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Синхронизация роли и CRM user_id в auth.users.raw_app_meta_data для мгновенного считывания из JWT без дискового ввода-вывода
CREATE OR REPLACE FUNCTION public.sync_user_app_metadata()
RETURNS trigger AS $$
BEGIN
  IF NEW.auth_id IS NOT NULL THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || 
      jsonb_build_object(
        'role', NEW.role,
        'user_id', NEW.user_id
      )
    WHERE id = NEW.auth_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_user_app_metadata ON public.users;
CREATE TRIGGER trg_sync_user_app_metadata
AFTER INSERT OR UPDATE OF role, is_active, auth_id ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_app_metadata();

-- Фоновый перенос метаданных для существующих активных пользователей
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT auth_id, user_id, role FROM public.users WHERE auth_id IS NOT NULL AND is_active = true LOOP
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || 
      jsonb_build_object(
        'role', r.role,
        'user_id', r.user_id
      )
    WHERE id = r.auth_id;
  END LOOP;
END;
$$;

-- ==============================================================================
-- 2. Оптимизированные RLS-политики с подзапросами (SELECT ...)
-- ==============================================================================

-- 2.1. leads
DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;
CREATE POLICY "leads_select_policy" ON public.leads
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR ((SELECT public.get_current_user_role()) = 'smm' AND created_by = (SELECT public.get_current_crm_user_id()))
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
);

DROP POLICY IF EXISTS "leads_update_policy" ON public.leads;
CREATE POLICY "leads_update_policy" ON public.leads
FOR UPDATE TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'smm' 
        AND created_by = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Открыт', 'Обработан')
    )
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
)
WITH CHECK (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'smm' 
        AND created_by = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Открыт', 'Обработан')
    )
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND assigned_to = (SELECT public.get_current_crm_user_id()) 
        AND status IN ('Назначен', 'Подписан', 'Отмена')
    )
);

-- 2.2. sellers
DROP POLICY IF EXISTS "sellers_select_policy" ON public.sellers;
CREATE POLICY "sellers_select_policy" ON public.sellers
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND (manager_id = (SELECT public.get_current_crm_user_id()) OR manager_id IS NULL)
    )
);

-- 2.3. connections
DROP POLICY IF EXISTS "connections_select_policy" ON public.connections;
CREATE POLICY "connections_select_policy" ON public.connections
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR (
        (SELECT public.get_current_user_role()) = 'consultant' 
        AND manager_id = (SELECT public.get_current_crm_user_id())
    )
);

-- 2.4. employee_payouts
DROP POLICY IF EXISTS "employee_payouts_select_policy" ON public.employee_payouts;
CREATE POLICY "employee_payouts_select_policy" ON public.employee_payouts
FOR SELECT TO authenticated
USING (
    (SELECT public.get_current_user_role()) = 'admin'
    OR user_id = (SELECT public.get_current_crm_user_id())
);

-- ==============================================================================
-- 3. Композитные индексы для устранения Seq Scan и ресурсоемких Bitmap Heap Scan
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_leads_assigned_status_created 
ON public.leads (assigned_to, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_created_by_status_created 
ON public.leads (created_by, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connections_seller_phone_assigned 
ON public.connections (seller_phone, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_connections_manager_assigned 
ON public.connections (manager_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_payouts_user_month 
ON public.employee_payouts (user_id, accrual_month, payout_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_user_phone_date 
ON public.payments (user_phone, date_time DESC);

-- ==============================================================================
-- 4. Серверные агрегаты и RPC-функции на стороне СУБД
-- ==============================================================================

-- 4.1. Расчет сводки фонда выплат на стороне PostgreSQL
CREATE OR REPLACE FUNCTION public.get_payouts_summary(
    p_accrual_month text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'totalPaid', coalesce(sum(amount) FILTER (WHERE payout_category != 'удержание'), 0),
    'totalAdvances', coalesce(sum(amount) FILTER (WHERE payout_category = 'аванс'), 0),
    'totalDeductions', coalesce(sum(amount) FILTER (WHERE payout_category = 'удержание'), 0),
    'transactionsCount', count(*)
  )
  FROM public.employee_payouts
  WHERE (p_accrual_month IS NULL OR p_accrual_month = 'all' OR accrual_month = p_accrual_month)
    AND (p_user_id IS NULL OR user_id = p_user_id);
$$;

-- 4.2. Сводная аналитика платформы в одном запросе
CREATE OR REPLACE FUNCTION public.get_analytics_summary(
    p_start_date timestamptz DEFAULT NULL,
    p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role user_role;
    v_user_uuid UUID;
    v_leads_stats JSON;
    v_payouts_stats JSON;
    v_sellers_stats JSON;
BEGIN
    v_role := public.get_current_user_role();
    v_user_uuid := public.get_current_crm_user_id();

    -- Статистика воронки лидов с учетом ролевой изоляции
    IF v_role = 'smm' THEN
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_leads_stats
        FROM public.leads
        WHERE created_by = v_user_uuid
          AND (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    ELSIF v_role = 'consultant' THEN
        SELECT json_build_object(
            'total', count(*) FILTER (WHERE status IN ('Назначен', 'Подписан', 'Отмена')),
            'open', 0,
            'processed', 0,
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_leads_stats
        FROM public.leads
        WHERE assigned_to = v_user_uuid
          AND (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    ELSE
        SELECT json_build_object(
            'total', count(*),
            'open', count(*) FILTER (WHERE status = 'Открыт'),
            'processed', count(*) FILTER (WHERE status = 'Обработан'),
            'assigned', count(*) FILTER (WHERE status = 'Назначен'),
            'signed', count(*) FILTER (WHERE status = 'Подписан'),
            'cancelled', count(*) FILTER (WHERE status = 'Отмена')
        ) INTO v_leads_stats
        FROM public.leads
        WHERE (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    END IF;

    -- Статистика фонда выплат
    IF v_role = 'admin' THEN
        SELECT json_build_object(
            'totalPaid', coalesce(sum(amount) FILTER (WHERE payout_category != 'удержание'), 0),
            'totalAdvances', coalesce(sum(amount) FILTER (WHERE payout_category = 'аванс'), 0),
            'totalDeductions', coalesce(sum(amount) FILTER (WHERE payout_category = 'удержание'), 0),
            'transactionsCount', count(*)
        ) INTO v_payouts_stats
        FROM public.employee_payouts
        WHERE (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    ELSE
        SELECT json_build_object(
            'totalPaid', coalesce(sum(amount) FILTER (WHERE payout_category != 'удержание'), 0),
            'totalAdvances', coalesce(sum(amount) FILTER (WHERE payout_category = 'аванс'), 0),
            'totalDeductions', coalesce(sum(amount) FILTER (WHERE payout_category = 'удержание'), 0),
            'transactionsCount', count(*)
        ) INTO v_payouts_stats
        FROM public.employee_payouts
        WHERE user_id = v_user_uuid
          AND (p_start_date IS NULL OR created_at >= p_start_date)
          AND (p_end_date IS NULL OR created_at <= p_end_date);
    END IF;

    -- Статистика базы продавцов
    IF v_role = 'smm' THEN
        v_sellers_stats := json_build_object('total', 0, 'active', 0, 'pending', 0, 'totalBalance', 0);
    ELSIF v_role = 'consultant' THEN
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pending', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', coalesce(sum(balance), 0)
        ) INTO v_sellers_stats
        FROM public.sellers
        WHERE manager_id = v_user_uuid;
    ELSE
        SELECT json_build_object(
            'total', count(*),
            'active', count(*) FILTER (WHERE is_active = true),
            'pending', count(*) FILTER (WHERE moderation = 'pending'),
            'totalBalance', coalesce(sum(balance), 0)
        ) INTO v_sellers_stats
        FROM public.sellers;
    END IF;

    RETURN json_build_object(
        'leads', v_leads_stats,
        'payouts', v_payouts_stats,
        'sellers', v_sellers_stats
    );
END;
$$;

-- ==============================================================================
-- 5. Исключение Race Conditions и атомарная фиксация выплат с FOR UPDATE
-- ==============================================================================

-- Уникальный индекс: предотвращение повторного начисления выплаты заработной платы сотруднику за один и тот же расчетный месяц
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_unique_salary_period 
ON public.employee_payouts (user_id, accrual_month) 
WHERE payout_category = 'выплата зп';

-- Атомарная транзакционная процедура фиксации выплаты
CREATE OR REPLACE FUNCTION public.process_employee_payout_atomic(
    p_user_id uuid,
    p_accrual_month varchar(7),
    p_payout_date date,
    p_amount numeric(12,2),
    p_payout_category payout_category_type,
    p_payment_method varchar(50),
    p_comment text,
    p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_locked_user RECORD;
    v_new_payout_id UUID;
BEGIN
    -- Блокируем строку сотрудника в users во избежание параллельных двойных начислений (Race Condition)
    SELECT user_id, full_name, is_active 
    INTO v_locked_user
    FROM public.users
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Сотрудник не найден';
    END IF;

    IF NOT v_locked_user.is_active THEN
        RAISE EXCEPTION 'Невозможно оформить выплату заблокированному сотруднику';
    END IF;

    -- Фиксируем запись выплаты
    INSERT INTO public.employee_payouts (
        user_id,
        accrual_month,
        payout_date,
        amount,
        payout_category,
        payment_method,
        comment,
        created_by,
        created_at
    ) VALUES (
        p_user_id,
        p_accrual_month,
        p_payout_date,
        p_amount,
        p_payout_category,
        p_payment_method,
        p_comment,
        p_created_by,
        now()
    ) RETURNING payout_id INTO v_new_payout_id;

    RETURN json_build_object(
        'success', true,
        'payout_id', v_new_payout_id
    );
END;
$$;
