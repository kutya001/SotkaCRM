-- ==============================================================================
-- 001_initial_schema.sql
-- Физическая спецификация схемы PostgreSQL / Supabase для SotkaCRM
-- В соответствии с DB.md, GEMINI.md и ТЗ.md
-- ==============================================================================

-- 1. Пользовательские типы и перечисления (ENUM)
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'consultant', 'smm');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE lead_status AS ENUM ('Открыт', 'Обработан', 'Назначен', 'Подписан', 'Отмена');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE client_lifecycle_status AS ENUM ('новый', 'подключен', 'сопровождение', 'готов', 'отменен');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE maintenance_status AS ENUM ('начислено', 'выплачено', 'отменено');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE payout_category_type AS ENUM ('аванс', 'выплата зп', 'бонус', 'прочие начисления', 'удержание');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE seller_moderation_status AS ENUM ('approved', 'pending', 'rejected', 'blocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Таблицы базы данных

-- 2.1. Таблица plans (Справочник тарифов платформы)
CREATE TABLE IF NOT EXISTS plans (
    plan_id VARCHAR(50) PRIMARY KEY,
    plan_name VARCHAR(100) NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    billing_period VARCHAR(20) NOT NULL DEFAULT 'Месяц',
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2. Таблица plans_history (Аудит изменения тарифов)
CREATE TABLE IF NOT EXISTS plans_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    plan_name VARCHAR(100) NOT NULL,
    old_price NUMERIC(12,2) NOT NULL,
    new_price NUMERIC(12,2) NOT NULL,
    changed_by UUID NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.3. Таблица users (Учетные записи и доступы)
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    login VARCHAR(100) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NULL,
    role user_role NOT NULL DEFAULT 'consultant',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4. Таблица sellers (Реестр продавцов платформы)
CREATE TABLE IF NOT EXISTS sellers (
    seller_phone VARCHAR(20) PRIMARY KEY,
    seller_name VARCHAR(255) NOT NULL,
    store VARCHAR(255) NOT NULL DEFAULT 'Без названия',
    plan_id VARCHAR(50) NULL REFERENCES plans(plan_id),
    plan_name VARCHAR(100) NOT NULL DEFAULT 'Без тарифа',
    balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    moderation seller_moderation_status NOT NULL DEFAULT 'pending',
    is_active BOOLEAN NOT NULL DEFAULT true,
    registered_at TIMESTAMPTZ NULL,
    last_activity TIMESTAMPTZ NULL,
    employees_count INTEGER NOT NULL DEFAULT 0,
    outlets_count INTEGER NOT NULL DEFAULT 0,
    brands TEXT NULL,
    organization_id VARCHAR(100) NULL,
    manager_id UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.5. Таблица leads (Модуль входящих заявок)
CREATE TABLE IF NOT EXISTS leads (
    lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    country_code VARCHAR(10) NOT NULL DEFAULT '996',
    status lead_status NOT NULL DEFAULT 'Открыт',
    instagram VARCHAR(255) NULL,
    comment TEXT NULL,
    created_by UUID NOT NULL REFERENCES users(user_id),
    assigned_to UUID NULL REFERENCES users(user_id),
    seller_phone VARCHAR(20) NULL UNIQUE REFERENCES sellers(seller_phone) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.6. Таблица payments (Журнал платежей и транзакций платформы)
CREATE TABLE IF NOT EXISTS payments (
    payment_id VARCHAR(100) PRIMARY KEY,
    user_phone VARCHAR(20) NOT NULL,
    user_id VARCHAR(100) NULL,
    user_name VARCHAR(255) NULL,
    amount NUMERIC(12,2) NOT NULL,
    date_time TIMESTAMPTZ NOT NULL,
    tran_type VARCHAR(50) NOT NULL,
    description TEXT NULL,
    status VARCHAR(50) NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.7. Таблица connections (Закрепления клиентов за сотрудниками)
CREATE TABLE IF NOT EXISTS connections (
    connection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_phone VARCHAR(20) NOT NULL REFERENCES sellers(seller_phone) ON DELETE CASCADE,
    seller_name VARCHAR(255) NOT NULL,
    store VARCHAR(255) NOT NULL,
    manager_id UUID NOT NULL REFERENCES users(user_id),
    assigned_by UUID NOT NULL REFERENCES users(user_id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(50) NOT NULL DEFAULT 'подключен',
    plan_id VARCHAR(50) NULL REFERENCES plans(plan_id),
    plan_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    connection_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 30.00,
    connection_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    accrual_month VARCHAR(7) NOT NULL,
    maintenance_months_limit INTEGER NOT NULL DEFAULT 3,
    maintenance_months_accrued INTEGER NOT NULL DEFAULT 0,
    client_status client_lifecycle_status NOT NULL DEFAULT 'новый'
);

-- 2.8. Таблица employee_rates (Персональные ставки сотрудников)
CREATE TABLE IF NOT EXISTS employee_rates (
    rate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    connection_percent NUMERIC(5,2) NOT NULL DEFAULT 30.00,
    maintenance_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    effective_from VARCHAR(7) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL REFERENCES users(user_id)
);

-- 2.9. Таблица client_maintenance (Начисления за сопровождение)
CREATE TABLE IF NOT EXISTS client_maintenance (
    maintenance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
    accrual_month VARCHAR(7) NOT NULL,
    seller_phone VARCHAR(20) NOT NULL REFERENCES sellers(seller_phone),
    manager_id UUID NOT NULL REFERENCES users(user_id),
    plan_id VARCHAR(50) NULL REFERENCES plans(plan_id),
    plan_price NUMERIC(12,2) NOT NULL,
    maintenance_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    maintenance_amount NUMERIC(12,2) NOT NULL,
    status maintenance_status NOT NULL DEFAULT 'начислено',
    accrued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accrued_by UUID NULL REFERENCES users(user_id)
);

-- 2.10. Таблица employee_payouts (Журнал выплат персоналу)
CREATE TABLE IF NOT EXISTS employee_payouts (
    payout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    accrual_month VARCHAR(7) NOT NULL,
    payout_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC(12,2) NOT NULL,
    payout_category payout_category_type NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    comment TEXT NULL,
    created_by UUID NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.11. Таблица outlets (Торговые точки на карте)
CREATE TABLE IF NOT EXISTS outlets (
    outlet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_phone VARCHAR(20) NOT NULL REFERENCES sellers(seller_phone) ON DELETE CASCADE,
    store_name VARCHAR(255) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    manager_id UUID NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Индексы базы данных
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

CREATE INDEX IF NOT EXISTS idx_payments_user_phone ON payments(user_phone);
CREATE INDEX IF NOT EXISTS idx_payments_status_type ON payments(status, tran_type);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date_time DESC);

CREATE INDEX IF NOT EXISTS idx_sellers_plan_id ON sellers(plan_id);
CREATE INDEX IF NOT EXISTS idx_sellers_manager_id ON sellers(manager_id);
CREATE INDEX IF NOT EXISTS idx_sellers_registered ON sellers(registered_at DESC);

CREATE INDEX IF NOT EXISTS idx_conn_manager_month ON connections(manager_id, accrual_month);
CREATE INDEX IF NOT EXISTS idx_maint_manager_month ON client_maintenance(manager_id, accrual_month);
CREATE INDEX IF NOT EXISTS idx_payouts_user_month ON employee_payouts(user_id, accrual_month);

-- 4. Бизнес-логика, хранимые процедуры и триггеры

-- 4.1. Защита от физического удаления лидов
CREATE OR REPLACE FUNCTION trg_lock_lead_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Физическое удаление лида запрещено бизнес-правилами. Установите статус "Отмена".';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_lead_delete ON leads;
CREATE TRIGGER prevent_lead_delete
BEFORE DELETE ON leads
FOR EACH ROW
EXECUTE FUNCTION trg_lock_lead_delete();

-- 4.2. Автоматическое версионирование стоимости тарифов
CREATE OR REPLACE FUNCTION trg_audit_plan_price()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.price <> NEW.price THEN
        INSERT INTO plans_history (
            plan_id,
            plan_name,
            old_price,
            new_price,
            changed_at
        ) VALUES (
            OLD.plan_id,
            NEW.plan_name,
            OLD.price,
            NEW.price,
            now()
        );
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_plan_price_trigger ON plans;
CREATE TRIGGER audit_plan_price_trigger
BEFORE UPDATE ON plans
FOR EACH ROW
EXECUTE FUNCTION trg_audit_plan_price();

-- 4.3. Валидация и автостатус привязки продавца к лиду
CREATE OR REPLACE FUNCTION trg_validate_lead_seller_link()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.seller_phone IS NOT NULL THEN
        NEW.status := 'Подписан';
        NEW.linked_at := coalesce(NEW.linked_at, now());
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_lead_seller_link_trigger ON leads;
CREATE TRIGGER validate_lead_seller_link_trigger
BEFORE INSERT OR UPDATE OF seller_phone ON leads
FOR EACH ROW
EXECUTE FUNCTION trg_validate_lead_seller_link();

-- 5. Функции контекста авторизации Supabase
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
    SELECT role FROM users WHERE auth_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_current_crm_user_id()
RETURNS UUID AS $$
    SELECT user_id FROM users WHERE auth_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 6. Политики безопасности (Row Level Security - RLS)

-- 6.1. users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_policy" ON users;
CREATE POLICY "users_select_policy" ON users
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "users_admin_write_policy" ON users;
CREATE POLICY "users_admin_write_policy" ON users
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

-- 6.2. leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select_policy" ON leads;
CREATE POLICY "leads_select_policy" ON leads
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR (get_current_user_role() = 'smm' AND created_by = get_current_crm_user_id())
    OR (get_current_user_role() = 'consultant' AND (assigned_to = get_current_crm_user_id() OR assigned_to IS NULL))
);

DROP POLICY IF EXISTS "leads_insert_policy" ON leads;
CREATE POLICY "leads_insert_policy" ON leads
FOR INSERT TO authenticated
WITH CHECK (
    get_current_user_role() IN ('admin', 'smm', 'consultant')
    AND created_by = get_current_crm_user_id()
);

DROP POLICY IF EXISTS "leads_update_policy" ON leads;
CREATE POLICY "leads_update_policy" ON leads
FOR UPDATE TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR (get_current_user_role() = 'consultant' AND (assigned_to = get_current_crm_user_id() OR assigned_to IS NULL))
)
WITH CHECK (
    get_current_user_role() = 'admin'
    OR (get_current_user_role() = 'consultant')
);

-- 6.3. sellers
ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sellers_select_policy" ON sellers;
CREATE POLICY "sellers_select_policy" ON sellers
FOR SELECT TO authenticated
USING (
    get_current_user_role() IN ('admin', 'consultant')
);

DROP POLICY IF EXISTS "sellers_admin_write_policy" ON sellers;
CREATE POLICY "sellers_admin_write_policy" ON sellers
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

-- 6.4. payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select_policy" ON payments;
CREATE POLICY "payments_select_policy" ON payments
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR (
        get_current_user_role() = 'consultant'
        AND user_phone IN (SELECT seller_phone FROM sellers WHERE manager_id = get_current_crm_user_id())
    )
);

DROP POLICY IF EXISTS "payments_admin_write_policy" ON payments;
CREATE POLICY "payments_admin_write_policy" ON payments
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

-- 6.5. connections
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connections_select_policy" ON connections;
CREATE POLICY "connections_select_policy" ON connections
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR manager_id = get_current_crm_user_id()
);

DROP POLICY IF EXISTS "connections_admin_write_policy" ON connections;
CREATE POLICY "connections_admin_write_policy" ON connections
FOR ALL TO authenticated
USING (get_current_user_role() IN ('admin', 'consultant'))
WITH CHECK (get_current_user_role() IN ('admin', 'consultant'));

-- 6.6. employee_rates
ALTER TABLE employee_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_rates_select_policy" ON employee_rates;
CREATE POLICY "employee_rates_select_policy" ON employee_rates
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR user_id = get_current_crm_user_id()
);

DROP POLICY IF EXISTS "employee_rates_admin_write_policy" ON employee_rates;
CREATE POLICY "employee_rates_admin_write_policy" ON employee_rates
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

-- 6.7. client_maintenance
ALTER TABLE client_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_maintenance_select_policy" ON client_maintenance;
CREATE POLICY "client_maintenance_select_policy" ON client_maintenance
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR manager_id = get_current_crm_user_id()
);

DROP POLICY IF EXISTS "client_maintenance_admin_write_policy" ON client_maintenance;
CREATE POLICY "client_maintenance_admin_write_policy" ON client_maintenance
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

-- 6.8. employee_payouts
ALTER TABLE employee_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payouts_select_policy" ON employee_payouts;
CREATE POLICY "payouts_select_policy" ON employee_payouts
FOR SELECT TO authenticated
USING (
    get_current_user_role() = 'admin'
    OR user_id = get_current_crm_user_id()
);

DROP POLICY IF EXISTS "payouts_admin_modify_policy" ON employee_payouts;
CREATE POLICY "payouts_admin_modify_policy" ON employee_payouts
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

-- 6.9. outlets
ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outlets_select_policy" ON outlets;
CREATE POLICY "outlets_select_policy" ON outlets
FOR SELECT TO authenticated
USING (get_current_user_role() IN ('admin', 'consultant'));

DROP POLICY IF EXISTS "outlets_write_policy" ON outlets;
CREATE POLICY "outlets_write_policy" ON outlets
FOR ALL TO authenticated
USING (get_current_user_role() IN ('admin', 'consultant'))
WITH CHECK (get_current_user_role() IN ('admin', 'consultant'));

-- 6.10. plans & plans_history
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_select_policy" ON plans;
CREATE POLICY "plans_select_policy" ON plans
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "plans_admin_write_policy" ON plans;
CREATE POLICY "plans_admin_write_policy" ON plans
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');

DROP POLICY IF EXISTS "plans_history_select_policy" ON plans_history;
CREATE POLICY "plans_history_select_policy" ON plans_history
FOR SELECT TO authenticated
USING (get_current_user_role() = 'admin');

DROP POLICY IF EXISTS "plans_history_admin_write_policy" ON plans_history;
CREATE POLICY "plans_history_admin_write_policy" ON plans_history
FOR ALL TO authenticated
USING (get_current_user_role() = 'admin')
WITH CHECK (get_current_user_role() = 'admin');
