-- ==============================================================================
-- МИГРАЦИЯ 028: Исправление классификации начислений в расчетном листке,
-- сальдо и связей со сделками (get_employee_payroll_sheet)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_employee_payroll_sheet(
  p_employee_id UUID,
  p_month VARCHAR(7) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_target_month VARCHAR(7);
    v_opening_balance NUMERIC(12,2) := 0;
    v_current_accrued NUMERIC(12,2) := 0;
    v_current_deductions NUMERIC(12,2) := 0;
    v_current_paid NUMERIC(12,2) := 0;
    v_closing_balance NUMERIC(12,2) := 0;

    v_emp RECORD;
    v_accruals JSONB := '[]'::jsonb;
    v_deductions JSONB := '[]'::jsonb;
    v_payouts JSONB := '[]'::jsonb;
    v_all_operations JSONB := '[]'::jsonb;
BEGIN
    v_target_month := COALESCE(p_month, to_char(CURRENT_DATE, 'YYYY-MM'));
    IF v_target_month !~ '^\d{4}-\d{2}$' THEN
        v_target_month := to_char(CURRENT_DATE, 'YYYY-MM');
    END IF;

    -- Получение данных сотрудника
    SELECT 
      user_id,
      full_name,
      role::text AS role,
      login,
      color
    INTO v_emp
    FROM public.users
    WHERE user_id = p_employee_id
    LIMIT 1;

    -- 1. Сальдо на начало месяца (все предыдущие периоды)
    SELECT 
      COALESCE(SUM(
        CASE 
          WHEN ep.operation_sign = '+' OR ep.operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance') 
            THEN ep.amount 
          ELSE -ep.amount 
        END
      ), 0)
    INTO v_opening_balance
    FROM public.employee_payouts ep
    WHERE (ep.user_id = p_employee_id OR ep.employee_id = p_employee_id)
      AND (COALESCE(ep.settlement_month, ep.accrual_month) < v_target_month);

    -- 2. Начисления за выбранный месяц (+)
    SELECT 
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', COALESCE(ep.id, ep.payout_id),
          'payout_id', ep.payout_id,
          'actual_date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'settlement_month', COALESCE(ep.settlement_month, ep.accrual_month, v_target_month),
          'amount', ep.amount,
          'operation_sign', '+',
          'operation_type', ep.operation_type,
          'payout_category', ep.payout_category,
          'note', COALESCE(ep.note, ep.comment, ep.description),
          'comment', COALESCE(ep.comment, ep.note, ep.description),
          'description', COALESCE(ep.description, ep.note, ep.comment),
          'connection_id', ep.connection_id,
          'seller_phone', ep.seller_phone,
          'source_name', COALESCE(s.store, s.seller_name, c.store, c.seller_name, ep.note, 'Клиент'),
          'store', COALESCE(s.store, c.store),
          'seller_name', COALESCE(s.seller_name, c.seller_name)
        ) ORDER BY COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date) ASC, ep.created_at ASC
      ), '[]'::jsonb),
      COALESCE(SUM(ep.amount), 0)
    INTO v_accruals, v_current_accrued
    FROM public.employee_payouts ep
    LEFT JOIN public.sellers s ON (s.seller_phone = ep.seller_phone OR s.id = ep.seller_id)
    LEFT JOIN public.connections c ON c.connection_id = ep.connection_id
    WHERE (ep.user_id = p_employee_id OR ep.employee_id = p_employee_id)
      AND COALESCE(ep.settlement_month, ep.accrual_month) = v_target_month
      AND (ep.operation_sign = '+' OR ep.operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'));

    -- 3. Удержания и авансы за выбранный месяц (-)
    SELECT 
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', COALESCE(ep.id, ep.payout_id),
          'payout_id', ep.payout_id,
          'actual_date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'settlement_month', COALESCE(ep.settlement_month, ep.accrual_month, v_target_month),
          'amount', ep.amount,
          'operation_sign', '-',
          'operation_type', ep.operation_type,
          'payout_category', ep.payout_category,
          'payment_method', ep.payment_method,
          'note', COALESCE(ep.note, ep.comment, ep.description),
          'comment', COALESCE(ep.comment, ep.note, ep.description),
          'description', COALESCE(ep.description, ep.note, ep.comment)
        ) ORDER BY COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date) ASC, ep.created_at ASC
      ), '[]'::jsonb),
      COALESCE(SUM(ep.amount), 0)
    INTO v_deductions, v_current_deductions
    FROM public.employee_payouts ep
    WHERE (ep.user_id = p_employee_id OR ep.employee_id = p_employee_id)
      AND COALESCE(ep.settlement_month, ep.accrual_month) = v_target_month
      AND (
        ep.operation_type IN ('advance', 'deduction', 'fine')
        OR ep.payout_category::text IN ('удержание', 'штраф', 'аванс')
      );

    -- 4. Выплаты зарплаты за выбранный месяц (-)
    SELECT 
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', COALESCE(ep.id, ep.payout_id),
          'payout_id', ep.payout_id,
          'actual_date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'settlement_month', COALESCE(ep.settlement_month, ep.accrual_month, v_target_month),
          'amount', ep.amount,
          'operation_sign', '-',
          'operation_type', 'payout',
          'payout_category', ep.payout_category,
          'payment_method', ep.payment_method,
          'note', COALESCE(ep.note, ep.comment, ep.description),
          'comment', COALESCE(ep.comment, ep.note, ep.description),
          'description', COALESCE(ep.description, ep.note, ep.comment)
        ) ORDER BY COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date) ASC, ep.created_at ASC
      ), '[]'::jsonb),
      COALESCE(SUM(ep.amount), 0)
    INTO v_payouts, v_current_paid
    FROM public.employee_payouts ep
    WHERE (ep.user_id = p_employee_id OR ep.employee_id = p_employee_id)
      AND COALESCE(ep.settlement_month, ep.accrual_month) = v_target_month
      AND NOT (ep.operation_sign = '+' OR ep.operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance'))
      AND NOT (ep.operation_type IN ('advance', 'deduction', 'fine') OR ep.payout_category::text IN ('удержание', 'штраф', 'аванс'));

    -- 5. Полный список всех операций за месяц (от новых к старым)
    SELECT 
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', COALESCE(ep.id, ep.payout_id),
          'payout_id', ep.payout_id,
          'actual_date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'date', COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date),
          'settlement_month', COALESCE(ep.settlement_month, ep.accrual_month, v_target_month),
          'amount', ep.amount,
          'operation_sign', CASE 
            WHEN ep.operation_sign = '+' OR ep.operation_type IN ('salary_base', 'bonus_other', 'accrual_connection', 'accrual_maintenance') THEN '+' 
            ELSE '-' 
          END,
          'operation_type', COALESCE(ep.operation_type, 'payout'),
          'payout_category', ep.payout_category,
          'payment_method', ep.payment_method,
          'note', COALESCE(ep.note, ep.comment, ep.description),
          'comment', COALESCE(ep.comment, ep.note, ep.description),
          'description', COALESCE(ep.description, ep.note, ep.comment),
          'connection_id', ep.connection_id,
          'seller_phone', ep.seller_phone,
          'source_name', COALESCE(s.store, s.seller_name, c.store, c.seller_name, ep.note, 'Клиент'),
          'store', COALESCE(s.store, c.store),
          'seller_name', COALESCE(s.seller_name, c.seller_name)
        ) ORDER BY COALESCE(ep.actual_date, ep.payout_date, ep.created_at::date) DESC, ep.created_at DESC
      ), '[]'::jsonb)
    INTO v_all_operations
    FROM public.employee_payouts ep
    LEFT JOIN public.sellers s ON (s.seller_phone = ep.seller_phone OR s.id = ep.seller_id)
    LEFT JOIN public.connections c ON c.connection_id = ep.connection_id
    WHERE (ep.user_id = p_employee_id OR ep.employee_id = p_employee_id)
      AND COALESCE(ep.settlement_month, ep.accrual_month) = v_target_month;

    -- 6. Итоговое сальдо на конец месяца
    v_closing_balance := v_opening_balance + v_current_accrued - v_current_deductions - v_current_paid;

    RETURN jsonb_build_object(
      'employee', jsonb_build_object(
        'id', COALESCE(v_emp.user_id, p_employee_id),
        'full_name', COALESCE(v_emp.full_name, 'Сотрудник'),
        'role', COALESCE(v_emp.role, 'consultant'),
        'login', COALESCE(v_emp.login, 'user'),
        'color', v_emp.color
      ),
      'employee_id', p_employee_id,
      'month', v_target_month,
      'settlement_month', v_target_month,
      'period', v_target_month,
      'opening_balance', v_opening_balance,
      'total_accrued', v_current_accrued,
      'total_deductions', v_current_deductions,
      'total_paid', v_current_paid,
      'closing_balance', v_closing_balance,
      'accruals', v_accruals,
      'deductions', v_deductions,
      'deductions_and_advances', v_deductions,
      'payouts', v_payouts,
      'operations', v_all_operations
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_payroll_sheet(UUID, VARCHAR) TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';
