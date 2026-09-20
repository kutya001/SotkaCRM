-- ==============================================================================
-- 004_add_biz_plan.sql
-- Добавление тарифа «Бизнес» (PLN-BIZ) и синхронизация справочника plans
-- В соответствии с DB.md, GEMINI.md и ТЗ.md
-- ==============================================================================

INSERT INTO public.plans (plan_id, plan_name, price, billing_period, description, is_active)
VALUES (
    'PLN-BIZ',
    'Бизнес',
    7000.00,
    'Месяц',
    'Тарифный план для развивающегося бизнеса: расширенное количество торговых точек и сотрудников',
    true
)
ON CONFLICT (plan_id) DO UPDATE SET
    plan_name = EXCLUDED.plan_name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active;
