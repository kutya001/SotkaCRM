-- ==============================================================================
-- 031_payroll_operation_sign_from_type.sql
-- Знак операции по ЗП определяется ее видом (operation_type):
--   начисления (+): salary_base, bonus_other, accrual_connection, accrual_maintenance
--   удержания (−):  deduction, fine
--   выплаты (−):    payout, advance (аванс — это выплата)
-- Раньше у operation_sign был DEFAULT '+', и операции, созданные без явного знака
-- (например, выплата через старую 11-параметровую RPC), получали неверный знак.
-- Миграция идемпотентна.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.employee_payouts_sign_from_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.operation_sign := CASE
    WHEN NEW.operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance') THEN '+'
    WHEN NEW.operation_type IN ('deduction', 'fine', 'payout', 'advance') THEN '-'
    ELSE COALESCE(NEW.operation_sign, '-')
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_payouts_sign_from_type ON public.employee_payouts;
CREATE TRIGGER trg_employee_payouts_sign_from_type
BEFORE INSERT OR UPDATE OF operation_type, operation_sign ON public.employee_payouts
FOR EACH ROW
EXECUTE FUNCTION public.employee_payouts_sign_from_type();

-- Исправление уже сохраненных операций с неверным знаком
UPDATE public.employee_payouts
SET operation_sign = CASE
  WHEN operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance') THEN '+'
  ELSE '-'
END
WHERE operation_type IN (
    'salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance',
    'deduction', 'fine', 'payout', 'advance'
  )
  AND operation_sign IS DISTINCT FROM CASE
    WHEN operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance') THEN '+'
    ELSE '-'
  END;
