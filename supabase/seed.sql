-- ==============================================================================
-- seed.sql — Первичные тестовые данные для SotkaCRM
-- В соответствии с DB.md, GEMINI.md и ТЗ.md
-- Пароль по умолчанию для всех учетных записей: admin123456
-- ==============================================================================

-- 1. Учетные записи аутентификации Supabase Auth (auth.users)
-- Примечание: GoTrue требует строковых токенов (не NULL), иначе возникает ошибка сканирования схемы
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    phone_change,
    phone_change_token,
    reauthentication_token,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at
) VALUES 
    (
        '00000000-0000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111',
        'authenticated',
        'authenticated',
        'admin@internal.sotka.kg',
        '$2a$06$y4vcdP6qT4k6NOd/RNQj7e6npksDaKFZQtsymVc4Gm1R9fR3VksLW',
        NOW(),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"role":"admin","login":"admin","full_name":"Айбек Исмаилов"}'::jsonb,
        false,
        NOW(),
        NOW()
    ),
    (
        '00000000-0000-0000-0000-000000000000',
        '22222222-2222-2222-2222-222222222222',
        'authenticated',
        'authenticated',
        'consultant1@internal.sotka.kg',
        '$2a$06$XSedRKZLj6HXJyJcUAh./OnnJskz4TaKeSzDBB/GBQE7GZrdW387q',
        NOW(),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"role":"consultant","login":"consultant1","full_name":"Бакыт Токтосунов"}'::jsonb,
        false,
        NOW(),
        NOW()
    ),
    (
        '00000000-0000-0000-0000-000000000000',
        '33333333-3333-3333-3333-333333333333',
        'authenticated',
        'authenticated',
        'smm_operator@internal.sotka.kg',
        '$2a$06$tBofuDCN7wI5Q5lCthGAc.R80CCYpRheTLV2oJwfWtYwI00O/PYlu',
        NOW(),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"role":"smm","login":"smm_operator","full_name":"Айпери Касымова"}'::jsonb,
        false,
        NOW(),
        NOW()
    )
ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    email_change_token_current = '',
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    updated_at = NOW();

-- 2. Идентичности пользователей (auth.identities)
INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
) VALUES
    (
        '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
        '{"sub":"11111111-1111-1111-1111-111111111111","email":"admin@internal.sotka.kg"}'::jsonb,
        'email',
        'admin@internal.sotka.kg',
        NOW(),
        NOW(),
        NOW()
    ),
    (
        '22222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222',
        '{"sub":"22222222-2222-2222-2222-222222222222","email":"consultant1@internal.sotka.kg"}'::jsonb,
        'email',
        'consultant1@internal.sotka.kg',
        NOW(),
        NOW(),
        NOW()
    ),
    (
        '33333333-3333-3333-3333-333333333333',
        '33333333-3333-3333-3333-333333333333',
        '{"sub":"33333333-3333-3333-3333-333333333333","email":"smm_operator@internal.sotka.kg"}'::jsonb,
        'email',
        'smm_operator@internal.sotka.kg',
        NOW(),
        NOW(),
        NOW()
    )
ON CONFLICT (provider, provider_id) DO NOTHING;

-- 3. Первичные тарифные планы платформы (таблица plans)
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

-- 4. Пользователи системы под каждую роль (таблица users)
-- Роли: admin, consultant, smm
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

-- 5. Индивидуальные мотивационные ставки сотрудников (таблица employee_rates)
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
