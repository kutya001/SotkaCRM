-- ==============================================================================
-- 030_employee_profile_fields.sql
-- Анкета сотрудника: адрес и координаты проживания (карта), ИНН, дата рождения, пол, биография
-- Миграция идемпотентна; существующие данные не меняются.
-- ==============================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS inn VARCHAR(14);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS gender VARCHAR(6);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_latitude_range;
ALTER TABLE public.users ADD CONSTRAINT users_latitude_range
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_longitude_range;
ALTER TABLE public.users ADD CONSTRAINT users_longitude_range
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

-- Координаты задаются парой
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_coordinates_pair;
ALTER TABLE public.users ADD CONSTRAINT users_coordinates_pair
  CHECK ((latitude IS NULL) = (longitude IS NULL));

-- ИНН (ПИН) Кыргызской Республики: 14 цифр
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_inn_format;
ALTER TABLE public.users ADD CONSTRAINT users_inn_format
  CHECK (inn IS NULL OR inn ~ '^[0-9]{14}$');

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_gender_values;
ALTER TABLE public.users ADD CONSTRAINT users_gender_values
  CHECK (gender IS NULL OR gender IN ('male', 'female'));

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_birth_date_range;
ALTER TABLE public.users ADD CONSTRAINT users_birth_date_range
  CHECK (birth_date IS NULL OR birth_date >= DATE '1900-01-01');

-- ИНН уникален среди заполненных
CREATE UNIQUE INDEX IF NOT EXISTS users_inn_unique ON public.users (inn) WHERE inn IS NOT NULL;
