-- ==============================================================================
-- seed.sql — Первичные тестовые данные для SotkaCRM
-- В соответствии с DB.md, GEMINI.md и ТЗ.md
-- ==============================================================================

-- 1. Первичные тарифные планы платформы (таблица plans)
INSERT INTO plans (plan_id, plan_name, price, billing_period, description, is_active)
VALUES 
    (
        'PLN-BASE',
        'Базовый',
        2500.00,
        'Месяц',
        'Стандартный функционал для одной торговой точки, учет до 5 сотрудников',
        true
    ),
    (
        'PLN-PREM',
        'Премиум',
        5000.00,
        'Месяц',
        'Расширенный тарифный план: до 5 филиалов, неограниченные бренды и приоритетная поддержка',
        true
    ),
    (
        'PLN-CORP',
        'Корпоративный',
        12000.00,
        'Месяц',
        'Безлимитный доступ к платформе, API-интеграции и выделенный персональный менеджер',
        true
    )
ON CONFLICT (plan_id) DO UPDATE SET
    plan_name = EXCLUDED.plan_name,
    price = EXCLUDED.price,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active;

-- 2. Пользователи системы под каждую роль (таблица users)
-- Роли: admin, consultant, smm (валидные hex-символы для UUID)
INSERT INTO users (user_id, auth_id, login, full_name, phone, role, is_active)
VALUES 
    (
        'a0000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'admin',
        'Айбек Исмаилов',
        '996700888268',
        'admin',
        true
    ),
    (
        'c0000000-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222',
        'consultant1',
        'Бакыт Токтосунов',
        '996500112233',
        'consultant',
        true
    ),
    (
        'b0000000-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333',
        'smm_operator',
        'Айпери Касымова',
        '996770445566',
        'smm',
        true
    )
ON CONFLICT (user_id) DO UPDATE SET
    auth_id = EXCLUDED.auth_id,
    login = EXCLUDED.login,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active;

-- 3. Индивидуальные мотивационные ставки сотрудников (таблица employee_rates)
INSERT INTO employee_rates (rate_id, user_id, connection_percent, maintenance_percent, effective_from, created_by)
VALUES 
    (
        'e0000000-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000001',
        30.00,
        10.00,
        '2026-01',
        'a0000000-0000-0000-0000-000000000001'
    ),
    (
        'e0000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-000000000001',
        0.00,
        0.00,
        '2026-01',
        'a0000000-0000-0000-0000-000000000001'
    )
ON CONFLICT (rate_id) DO UPDATE SET
    connection_percent = EXCLUDED.connection_percent,
    maintenance_percent = EXCLUDED.maintenance_percent,
    effective_from = EXCLUDED.effective_from;
