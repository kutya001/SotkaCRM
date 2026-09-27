import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();
    const body = await req.json();

    const { action, connection_ids, payload } = body;

    if (!action) {
      return apiError('Укажите действие (action)', 'MISSING_ACTION', 400);
    }

    if (!Array.isArray(connection_ids) || connection_ids.length === 0) {
      return apiError('Список connection_ids не может быть пустым', 'EMPTY_CONNECTION_IDS', 400);
    }

    // 1. Действие: Массовое изменение срока сопровождения
    if (action === 'update_maintenance_months') {
      const monthsTotal = Math.max(1, Math.min(24, parseInt(payload?.months_total || payload?.monthsTotal || '2', 10)));

      const { data: updatedConns, error: updateErr } = await supabase
        .from('connections')
        .update({
          maintenance_months_total: monthsTotal,
          maintenance_months_limit: monthsTotal,
          updated_at: new Date().toISOString(),
        } as any)
        .in('connection_id', connection_ids)
        .select('connection_id');

      if (updateErr) {
        throw updateErr;
      }

      return apiSuccess({
        success: true,
        action: 'update_maintenance_months',
        updated_count: updatedConns?.length || connection_ids.length,
        months_total: monthsTotal,
        message: `Срок сопровождения (${monthsTotal} мес.) успешно установлен для ${updatedConns?.length || connection_ids.length} подключений`,
      });
    }

    // 2. Действие: Выборочное начисление бонусов по списку подключений
    if (action === 'accrue_selected') {
      const mode = (payload?.mode || 'all').toLowerCase();
      const settlementMonth = payload?.month || payload?.settlement_month || new Date().toISOString().slice(0, 7);

      // 2.1. Попытка вызова RPC-процедуры в СУБД
      try {
        const { data: rpcRes, error: rpcErr } = await (supabase.rpc as any)('accrue_selected_connections', {
          p_connection_ids: connection_ids,
          p_mode: mode,
          p_settlement_month: settlementMonth,
        });

        if (!rpcErr && rpcRes && (rpcRes as any).success) {
          return apiSuccess({
            success: true,
            action: 'accrue_selected',
            settlement_month: settlementMonth,
            mode,
            ...(rpcRes as any),
            message: `Начисления успешно проведены для выбранных подключений (${settlementMonth})`,
          });
        }
      } catch (rpcCatch) {
        console.warn('[Connections Batch] RPC accrue_selected_connections unavailable, using native engine:', rpcCatch);
      }

      // 2.2. Нативный TypeScript-движок выборочного начисления
      const { data: conns, error: connsErr } = await supabase
        .from('connections')
        .select(`
          connection_id,
          seller_phone,
          seller_name,
          store,
          manager_id,
          plan_price,
          connection_fee_amount,
          connection_fee,
          maintenance_fee_monthly,
          maintenance_months_total,
          maintenance_months_limit,
          maintenance_months_accrued,
          maintenance_month_start,
          accrual_month,
          status,
          client_status,
          seller:sellers(is_active)
        `)
        .in('connection_id', connection_ids);

      if (connsErr) throw connsErr;

      let connectionBonusesCreated = 0;
      let maintenanceBonusesCreated = 0;

      for (const conn of (conns || [])) {
        if (!conn.manager_id) continue;
        if (conn.seller && (conn.seller as any).is_active === false) continue;

        const planPrice = Number(conn.plan_price) || 0;
        const feeConn = Number(conn.connection_fee_amount || conn.connection_fee || Math.round(planPrice * 0.5));
        const feeMaint = Number(conn.maintenance_fee_monthly || Math.round(planPrice * 0.1));
        const limitMonths = Number(conn.maintenance_months_total || conn.maintenance_months_limit || 2);

        // Начисление за подключение
        if (mode === 'all' || mode === 'connection' || mode === 'connection_only') {
          const { data: existingConnAccruals } = await supabase
            .from('employee_payouts')
            .select('payout_id')
            .eq('connection_id', conn.connection_id)
            .eq('operation_type', 'accrual_connection')
            .limit(1);

          if ((!existingConnAccruals || existingConnAccruals.length === 0) && feeConn > 0) {
            const accMonth = conn.accrual_month || settlementMonth;
            await supabase.from('employee_payouts').insert({
              user_id: conn.manager_id,
              employee_id: conn.manager_id,
              connection_id: conn.connection_id,
              seller_phone: conn.seller_phone,
              operation_sign: '+',
              operation_type: 'accrual_connection',
              payout_category: 'бонус',
              amount: feeConn,
              settlement_month: accMonth,
              accrual_month: accMonth,
              actual_date: new Date().toISOString().slice(0, 10),
              payout_date: new Date().toISOString().slice(0, 10),
              status: 'completed',
              note: `Бонус за подключение: ${conn.seller_name || conn.store || conn.seller_phone}`,
              comment: `Бонус за подключение: ${conn.seller_name || conn.store || conn.seller_phone}`,
              created_by: conn.manager_id,
            } as any);

            connectionBonusesCreated++;
          }
        }

        // Начисление за сопровождение
        if (mode === 'all' || mode === 'maintenance' || mode === 'maintenance_only') {
          const { data: existingMaintThisMonth } = await supabase
            .from('employee_payouts')
            .select('payout_id')
            .eq('connection_id', conn.connection_id)
            .eq('operation_type', 'accrual_maintenance')
            .or(`settlement_month.eq.${settlementMonth},accrual_month.eq.${settlementMonth}`)
            .limit(1);

          const { data: allMaintForConn } = await supabase
            .from('employee_payouts')
            .select('payout_id')
            .eq('connection_id', conn.connection_id)
            .eq('operation_type', 'accrual_maintenance');

          const currentMaintCount = allMaintForConn?.length || conn.maintenance_months_accrued || 0;

          if (
            (!existingMaintThisMonth || existingMaintThisMonth.length === 0) &&
            feeMaint > 0 &&
            currentMaintCount < limitMonths &&
            (!conn.maintenance_month_start || settlementMonth >= conn.maintenance_month_start) &&
            conn.client_status !== 'готов' &&
            conn.status !== 'готов'
          ) {
            await supabase.from('employee_payouts').insert({
              user_id: conn.manager_id,
              employee_id: conn.manager_id,
              connection_id: conn.connection_id,
              seller_phone: conn.seller_phone,
              operation_sign: '+',
              operation_type: 'accrual_maintenance',
              payout_category: 'бонус',
              amount: feeMaint,
              settlement_month: settlementMonth,
              accrual_month: settlementMonth,
              actual_date: new Date().toISOString().slice(0, 10),
              payout_date: new Date().toISOString().slice(0, 10),
              status: 'completed',
              note: `Бонус за сопровождение (${settlementMonth}): ${conn.seller_name || conn.store || conn.seller_phone}`,
              comment: `Бонус за сопровождение (${settlementMonth}): ${conn.seller_name || conn.store || conn.seller_phone}`,
              created_by: conn.manager_id,
            } as any);

            const nextCount = currentMaintCount + 1;
            const nextStatus = nextCount >= limitMonths ? 'готов' : 'сопровождение';

            await supabase
              .from('connections')
              .update({
                maintenance_months_accrued: nextCount,
                client_status: nextStatus,
                status: nextStatus,
                updated_at: new Date().toISOString(),
              } as any)
              .eq('connection_id', conn.connection_id);

            maintenanceBonusesCreated++;
          }
        }
      }

      return apiSuccess({
        success: true,
        action: 'accrue_selected',
        settlement_month: settlementMonth,
        mode,
        connection_bonuses_created: connectionBonusesCreated,
        maintenance_bonuses_created: maintenanceBonusesCreated,
        total_created: connectionBonusesCreated + maintenanceBonusesCreated,
        message: `Выборочное начисление выполнено: подключений: ${connectionBonusesCreated}, сопровождений: ${maintenanceBonusesCreated}`,
      });
    }

    return apiError(`Неизвестное действие: ${action}`, 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
