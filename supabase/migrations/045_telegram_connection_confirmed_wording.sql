-- ==============================================================================
-- 045_telegram_connection_confirmed_wording.sql
-- Уточнение сообщения «Подключение подтверждено» (044): если проводка начисления участнику
-- еще не создана (ставка нулевая, начисление отложено из-за порядка месяцев), сумма
-- показывается как «К начислению», а не «Начислено». Триггер trg_telegram_on_maintenance_assigned
-- оставлен пустой функцией намеренно: назначение сопровождения не уведомляет, сводка приходит
-- при начислении от сервера. Миграция идемпотентна.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.trg_telegram_on_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_fee NUMERIC(12, 2);
  v_confirmer_name TEXT;
  v_body TEXT;
  v_users UUID[];
  v_n INT;
  v_i INT;
  v_share NUMERIC(12, 2);
  v_accrued BOOLEAN;
  v_confirmation_changed BOOLEAN := FALSE;
  v_manager_changed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_confirmation_changed := NEW.confirmation_status IS DISTINCT FROM OLD.confirmation_status;
    v_manager_changed := NEW.manager_id IS DISTINCT FROM OLD.manager_id;
    IF NOT v_confirmation_changed AND NOT v_manager_changed THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Ожидает подтверждения: участников не беспокоим, администраторам запрос формирует сервер
  IF NEW.confirmation_status = 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT plan_name INTO v_plan FROM public.plans WHERE plan_id = NEW.plan_id;
  v_fee := COALESCE(
    NULLIF(NEW.connection_fee, 0),
    NULLIF(NEW.connection_fee_amount, 0),
    ROUND(COALESCE(NEW.plan_price, 0) * COALESCE(NEW.connection_fee_percent, 30) / 100)
  );

  v_body := 'Продавец: ' || COALESCE(NULLIF(NEW.seller_name, ''), '—')
    || E'\nТелефон: +' || NEW.seller_phone
    || E'\nМагазин: ' || COALESCE(NULLIF(NEW.store, ''), '—')
    || CASE WHEN v_plan IS NOT NULL THEN E'\nТариф: ' || v_plan ELSE '' END;

  v_users := public.connection_participants_of(NEW.connection_id);
  v_n := COALESCE(cardinality(v_users), 0);
  IF v_n = 0 THEN
    v_users := ARRAY[NEW.manager_id];
    v_n := 1;
  END IF;

  -- Отклонение: всем участникам с причиной
  IF TG_OP = 'UPDATE' AND v_confirmation_changed AND NEW.confirmation_status = 'rejected' THEN
    FOR v_i IN 1..v_n LOOP
      PERFORM public.telegram_enqueue(
        v_users[v_i], 'connections', 'Подключение отклонено',
        v_body || CASE WHEN COALESCE(NEW.rejection_reason, '') <> '' THEN E'\nПричина: ' || left(NEW.rejection_reason, 300) ELSE '' END
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.confirmation_status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Смена основного по уже подтвержденному подключению: уведомляется только новый основной
  IF TG_OP = 'UPDATE' AND NOT v_confirmation_changed AND v_manager_changed THEN
    v_users := ARRAY[NEW.manager_id];
    v_n := 1;
  END IF;

  IF NEW.confirmed_by IS NOT NULL THEN
    SELECT full_name INTO v_confirmer_name FROM public.users WHERE user_id = NEW.confirmed_by;
  END IF;

  -- Подтверждено: каждому участнику его доля — начисленная (проводка создана триггером начисления)
  -- или расчетная, если проводки еще нет
  FOR v_i IN 1..v_n LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_share
    FROM public.employee_payouts
    WHERE connection_id = NEW.connection_id
      AND operation_type = 'accrual_connection'
      AND operation_sign = '+'
      AND COALESCE(employee_id, user_id) = v_users[v_i];
    v_accrued := COALESCE(v_share, 0) > 0;
    IF NOT v_accrued THEN
      v_share := public.connection_split_amount(v_fee, v_n, v_i);
    END IF;

    PERFORM public.telegram_enqueue(
      v_users[v_i],
      'connections',
      'Подключение подтверждено',
      v_body
        || CASE WHEN v_accrued THEN E'\nНачислено: +' ELSE E'\nК начислению: +' END
        || public.telegram_format_amount(v_share) || ' сом'
        || CASE WHEN v_n > 1 THEN ' (ваша доля 1/' || v_n || ' от ' || public.telegram_format_amount(v_fee) || ' сом)' ELSE '' END
        || E'\nМесяц начисления: ' || COALESCE(NEW.accrual_month, '—')
        || CASE WHEN v_confirmer_name IS NOT NULL AND NEW.confirmed_by <> v_users[v_i] THEN E'\nПодтвердил: ' || v_confirmer_name ELSE '' END
    );
  END LOOP;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
