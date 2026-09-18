-- ==============================================================================
-- 002_auth_by_login.sql — Перевод аутентификации CRM строго на логины
-- В соответствии с ТЗ.md, GEMINI.md и DB.md
-- ==============================================================================

-- 1. Гарантия NOT NULL и регистронезависимой уникальности для users.login
ALTER TABLE public.users ALTER COLUMN login SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_login_lower_idx 
ON public.users (LOWER(TRIM(login)));

-- 2. Вспомогательная функция формирования синтетического адреса
CREATE OR REPLACE FUNCTION public.get_synthetic_email(p_login TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT LOWER(TRIM(p_login)) || '@internal.sotka.kg';
$$;

-- 3. Хранимая процедура создания пользователя сотрудника администратором
CREATE OR REPLACE FUNCTION public.create_crm_user(
    p_login VARCHAR(100),
    p_password TEXT,
    p_full_name VARCHAR(255),
    p_phone VARCHAR(30) DEFAULT NULL,
    p_role user_role DEFAULT 'consultant'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_auth_id UUID;
    v_user_id UUID;
    v_synthetic_email TEXT;
    v_cleaned_login TEXT;
BEGIN
    -- Валидация прав: вызывающий обязан обладать ролью admin
    IF public.get_current_user_role() != 'admin' THEN
        RAISE EXCEPTION 'Только администратор имеет право создавать учетные записи сотрудников';
    END IF;

    v_cleaned_login := TRIM(p_login);
    IF LENGTH(v_cleaned_login) < 3 THEN
        RAISE EXCEPTION 'Длина логина должна составлять не менее 3 символов';
    END IF;

    -- Проверка отсутствия дубликата логина
    IF EXISTS (SELECT 1 FROM public.users WHERE LOWER(login) = LOWER(v_cleaned_login)) THEN
        RAISE EXCEPTION 'Пользователь с логином «%» уже существует в системе', v_cleaned_login;
    END IF;

    v_synthetic_email := public.get_synthetic_email(v_cleaned_login);
    v_auth_id := gen_random_uuid();
    v_user_id := gen_random_uuid();

    -- Вставка в auth.users
    INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        is_sso_user,
        is_anonymous
    ) VALUES (
        v_auth_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        v_synthetic_email,
        crypt(p_password, gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', p_full_name, 'role', p_role::text, 'login', v_cleaned_login),
        now(),
        now(),
        false,
        false
    );

    -- Вставка в auth.identities
    INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
    ) VALUES (
        v_auth_id,
        v_auth_id,
        format('{"sub":"%s","email":"%s"}', v_auth_id, v_synthetic_email)::jsonb,
        'email',
        v_synthetic_email,
        now(),
        now(),
        now()
    );

    -- Вставка в public.users
    INSERT INTO public.users (
        user_id,
        auth_id,
        login,
        full_name,
        phone,
        role,
        is_active
    ) VALUES (
        v_user_id,
        v_auth_id,
        v_cleaned_login,
        TRIM(p_full_name),
        p_phone,
        p_role,
        true
    );

    RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_crm_user(VARCHAR, TEXT, VARCHAR, VARCHAR, user_role) TO authenticated;

-- 4. Обновление существующих учетных записей на синтетические адреса @internal.sotka.kg
UPDATE auth.users
SET email = 'admin@internal.sotka.kg',
    raw_user_meta_data = jsonb_build_object('full_name', 'Айбек Исмаилов', 'role', 'admin', 'login', 'admin'),
    updated_at = now()
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE auth.identities
SET identity_data = jsonb_build_object('sub', '11111111-1111-1111-1111-111111111111', 'email', 'admin@internal.sotka.kg'),
    provider_id = 'admin@internal.sotka.kg',
    updated_at = now()
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE auth.users
SET email = 'consultant1@internal.sotka.kg',
    raw_user_meta_data = jsonb_build_object('full_name', 'Бакыт Токтосунов', 'role', 'consultant', 'login', 'consultant1'),
    updated_at = now()
WHERE id = '22222222-2222-2222-2222-222222222222';

UPDATE auth.identities
SET identity_data = jsonb_build_object('sub', '22222222-2222-2222-2222-222222222222', 'email', 'consultant1@internal.sotka.kg'),
    provider_id = 'consultant1@internal.sotka.kg',
    updated_at = now()
WHERE id = '22222222-2222-2222-2222-222222222222';

UPDATE auth.users
SET email = 'smm_operator@internal.sotka.kg',
    raw_user_meta_data = jsonb_build_object('full_name', 'Айпери Касымова', 'role', 'smm', 'login', 'smm_operator'),
    updated_at = now()
WHERE id = '33333333-3333-3333-3333-333333333333';

UPDATE auth.identities
SET identity_data = jsonb_build_object('sub', '33333333-3333-3333-3333-333333333333', 'email', 'smm_operator@internal.sotka.kg'),
    provider_id = 'smm_operator@internal.sotka.kg',
    updated_at = now()
WHERE id = '33333333-3333-3333-3333-333333333333';
