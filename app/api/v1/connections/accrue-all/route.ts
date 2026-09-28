import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireAdmin();

    let targetMonth = new Date().toISOString().slice(0, 7);
    let accrualType: 'all' | 'connection' | 'maintenance' = 'all';

    try {
      const text = await req.text();
      if (text && text.trim().length > 0) {
        const body = JSON.parse(text);
        if (body?.settlement_month && typeof body.settlement_month === 'string') {
          targetMonth = body.settlement_month.trim();
        } else if (body?.month && typeof body.month === 'string') {
          targetMonth = body.month.trim();
        } else if (body?.settlementMonth && typeof body.settlementMonth === 'string') {
          targetMonth = body.settlementMonth.trim();
        }

        if (body?.accrual_type && ['all', 'connection', 'maintenance'].includes(body.accrual_type)) {
          accrualType = body.accrual_type;
        } else if (body?.type && ['all', 'connection', 'maintenance'].includes(body.type)) {
          accrualType = body.type;
        }
      }
    } catch {
      // Игнорируем ошибку JSON-парсинга, используются значения по умолчанию
    }

    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      return apiError('Неверный формат месяца. Ожидается YYYY-MM', 'VALIDATION_ERROR', 400);
    }

    let resultData: any = null;

    // 1. Попытка вызвать хранимую процедуру accrue_connection_bonuses_v2
    try {
      const rpcRes = await (supabase.rpc as any)('accrue_connection_bonuses_v2', {
        p_mode: accrualType,
        p_settlement_month: targetMonth,
      });
      if (!rpcRes.error && rpcRes.data && (rpcRes.data as any).success) {
        resultData = rpcRes.data;
      }
    } catch {
      // Игнорируем ошибку RPC и пробуем process_unified_connection_accruals
    }

    if (!resultData) {
      try {
        const rpcRes2 = await supabase.rpc('process_unified_connection_accruals', {
          p_settlement_month: targetMonth,
          p_accrual_type: accrualType,
        });
        if (!rpcRes2.error && rpcRes2.data) {
          resultData = rpcRes2.data;
        }
      } catch {
        // Игнорируем ошибку RPC и переходим к нативному выполнению
      }
    }

    // 2. Если RPC недоступна или вернула ошибку, выполняем надежную нативную обработку в TypeScript
    if (!resultData) {
      // Получаем список активных подключений с назначенным куратором
      const { data: conns, error: connErr } = await supabase
        .from('connections')
        .select(`
          connection_id,
          seller_phone,
          seller_name,
          store,
          manager_id,
          status,
          assigned_at,
          accrual_month,
          plan_price,
          connection_fee_percent,
          connection_fee_amount,
          connection_fee,
          maintenance_fee_monthly,
          maintenance_month_start,
          maintenance_months_total,
          maintenance_months_accrued
        `)
        .not('manager_id', 'is', null);

      if (connErr) throw connErr;

      // Получаем статус активности продавцов
      const { data: sellers } = await supabase
        .from('sellers')
        .select('seller_phone, is_active')
        .eq('is_active', true);

      const activeSellersSet = new Set((sellers || []).map((s) => s.seller_phone));

      // Получаем существующие начисления из connection_accruals для дедупликации
      const { data: existingAccruals, error: accErr } = await supabase
        .from('connection_accruals')
        .select('connection_id, accrual_type, settlement_month');

      if (accErr) throw accErr;

      const existingMap = new Set(
        (existingAccruals || []).map(
          (a) => `${a.connection_id}_${a.accrual_type}_${a.settlement_month || ''}`
        )
      );
      const existingConnBonusSet = new Set(
        (existingAccruals || [])
          .filter((a) => a.accrual_type === 'connection')
          .map((a) => a.connection_id)
      );

      // Дополнительная дедупликация по employee_payouts
      const { data: existingPayouts } = await supabase
        .from('employee_payouts')
        .select('connection_id, operation_type, settlement_month')
        .in('operation_type', ['accrual_connection', 'accrual_maintenance']);

      const existingPayoutsMap = new Set(
        (existingPayouts || []).map(
          (p: any) => `${p.connection_id}_${p.operation_type}_${p.settlement_month || ''}`
        )
      );

      const todayStr = new Date().toISOString().slice(0, 10);

      let connectionBonusesCreated = 0;
      let maintenanceBonusesCreated = 0;

      for (const conn of conns || []) {
        if (!activeSellersSet.has(conn.seller_phone)) continue;

        const sellerLabel = conn.seller_name || (conn as any).store || conn.seller_phone;

        // А. Бонус за подключение
        if (accrualType === 'all' || accrualType === 'connection') {
          const alreadyHasConnBonus = existingConnBonusSet.has(conn.connection_id);
          const fee =
            Number(conn.connection_fee) ||
            Number(conn.connection_fee_amount) ||
            Math.round(
              ((Number(conn.plan_price) || 0) * (Number(conn.connection_fee_percent) || 30)) / 100
            );

          const payoutKey = `${conn.connection_id}_accrual_connection_`;
          const alreadyInPayouts = existingPayoutsMap.has(payoutKey) ||
            Array.from(existingPayoutsMap).some((k) => k.startsWith(`${conn.connection_id}_accrual_connection`));

          if (!alreadyHasConnBonus && !alreadyInPayouts && fee > 0) {
            const monthForConn = conn.accrual_month || targetMonth;

            // Запись в connection_accruals (реестр подключений)
            const { error: insErr } = await supabase.from('connection_accruals').insert({
              connection_id: conn.connection_id,
              seller_phone: conn.seller_phone,
              employee_id: conn.manager_id,
              accrual_type: 'connection',
              settlement_month: monthForConn,
              amount: fee,
              is_paid: false,
              notes: `Бонус за подключение кон.: ${sellerLabel}`,
            });

            if (!insErr) {
              // Синхронная запись в employee_payouts (журнал ЗП)
              await supabase.from('employee_payouts').insert({
                user_id: conn.manager_id,
                employee_id: conn.manager_id,
                connection_id: conn.connection_id,
                seller_phone: conn.seller_phone,
                operation_sign: '+',
                operation_type: 'accrual_connection',
                payout_category: 'бонус',
                amount: fee,
                settlement_month: monthForConn,
                accrual_month: monthForConn,
                actual_date: todayStr,
                payout_date: todayStr,
                status: 'completed',
                note: `Бонус за подключение кон.: ${sellerLabel}`,
                comment: `Бонус за подключение кон.: ${sellerLabel}`,
                created_by: conn.manager_id,
              } as any);

              connectionBonusesCreated++;
              existingConnBonusSet.add(conn.connection_id);
            }
          }
        }

        // Б. Бонус за сопровождение
        if (accrualType === 'all' || accrualType === 'maintenance') {
          const maintKey = `${conn.connection_id}_maintenance_${targetMonth}`;
          const alreadyHasMaintThisMonth = existingMap.has(maintKey);

          const payoutMaintKey = `${conn.connection_id}_accrual_maintenance_${targetMonth}`;
          const alreadyMaintInPayouts = existingPayoutsMap.has(payoutMaintKey);

          const totalMonths = Number(conn.maintenance_months_total) || 2;
          const accruedMonths = Number(conn.maintenance_months_accrued) || 0;

          const maintFee =
            Number(conn.maintenance_fee_monthly) ||
            Math.round((Number(conn.plan_price) || 0) * 0.1);

          const startMonth = conn.maintenance_month_start || null;
          const canStartMaint = !startMonth || targetMonth >= startMonth;

          if (
            !alreadyHasMaintThisMonth &&
            !alreadyMaintInPayouts &&
            maintFee > 0 &&
            conn.status !== 'готов' &&
            accruedMonths < totalMonths &&
            canStartMaint
          ) {
            // Запись в connection_accruals (реестр подключений)
            const { error: insMaintErr } = await supabase.from('connection_accruals').insert({
              connection_id: conn.connection_id,
              seller_phone: conn.seller_phone,
              employee_id: conn.manager_id,
              accrual_type: 'maintenance',
              settlement_month: targetMonth,
              amount: maintFee,
              is_paid: false,
              notes: `Бонус за сопровождение (${targetMonth}): ${sellerLabel}`,
            });

            if (!insMaintErr) {
              // Синхронная запись в employee_payouts (журнал ЗП)
              await supabase.from('employee_payouts').insert({
                user_id: conn.manager_id,
                employee_id: conn.manager_id,
                connection_id: conn.connection_id,
                seller_phone: conn.seller_phone,
                operation_sign: '+',
                operation_type: 'accrual_maintenance',
                payout_category: 'бонус',
                amount: maintFee,
                settlement_month: targetMonth,
                accrual_month: targetMonth,
                actual_date: todayStr,
                payout_date: todayStr,
                status: 'completed',
                note: `Бонус за сопровождение (${targetMonth}): ${sellerLabel}`,
                comment: `Бонус за сопровождение (${targetMonth}): ${sellerLabel}`,
                created_by: conn.manager_id,
              } as any);

              maintenanceBonusesCreated++;
              existingMap.add(maintKey);

              const newAccrued = accruedMonths + 1;
              const newStatus = newAccrued >= totalMonths ? 'готов' : 'сопровождение';
              await supabase
                .from('connections')
                .update({
                  maintenance_months_accrued: newAccrued,
                  status: newStatus,
                })
                .eq('connection_id', conn.connection_id);
            }
          }
        }
      }

      resultData = {
        connection_bonuses_created: connectionBonusesCreated,
        maintenance_bonuses_created: maintenanceBonusesCreated,
        total_created: connectionBonusesCreated + maintenanceBonusesCreated,
        settlement_month: targetMonth,
        accrual_type: accrualType,
        message:
          accrualType === 'connection'
            ? `Начислено бонусов за подключение: +${connectionBonusesCreated}`
            : accrualType === 'maintenance'
            ? `Начислено бонусов за сопровождение: +${maintenanceBonusesCreated}`
            : `Начисление выполнено: подключений +${connectionBonusesCreated}, сопровождений +${maintenanceBonusesCreated}`,
      };
    }

    revalidatePath('/connections');
    revalidatePath('/payouts');
    revalidatePath('/profile');

    return apiSuccess(resultData);
  } catch (err) {
    return handleApiError(err);
  }
}
