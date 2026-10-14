import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';
import { connectionOrderError, type ConnectionAccrualHistoryRow } from '@/lib/payroll/connection-order';
import { assignConnectionStaff, connectionOwnScopeFilter, setConnectionConfirmation } from '@/lib/services/connections';

/** Право на конкретное массовое действие (в дополнение к «connections.bulk») */
const BATCH_ACTION_PERMISSION: Record<string, string> = {
  confirm_selected: 'connections.confirm',
  assign_staff: 'connections.edit',
  update_maintenance_months: 'connections.edit',
  accrue_selected: 'connections.accrue',
};

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('connections.bulk');
    const { profile } = ctx;
    const body = await req.json();

    const { action, payload } = body;
    let connection_ids = body.connection_ids;

    if (!action) {
      return apiError('Укажите действие (action)', 'MISSING_ACTION', 400);
    }

    if (!Array.isArray(connection_ids) || connection_ids.length === 0) {
      return apiError('Список connection_ids не может быть пустым', 'EMPTY_CONNECTION_IDS', 400);
    }

    const actionPermission = BATCH_ACTION_PERMISSION[action];
    if (!actionPermission) {
      return apiError(`Неизвестное действие: ${action}`, 'INVALID_ACTION', 400);
    }
    await requirePermission(actionPermission);

    // Таблицы начислений пишутся сервисным клиентом после проверки прав (RLS разрешает запись только администратору)
    const supabase = createAdminClient();

    // Область видимости: без «connections.view_all» массовое действие затрагивает только свои подключения
    if (!ctx.canViewAll('connections')) {
      const { data: ownRows, error: ownErr } = await supabase
        .from('connections')
        .select('connection_id')
        .in('connection_id', connection_ids)
        .or(await connectionOwnScopeFilter(profile.user_id));
      if (ownErr) throw ownErr;
      connection_ids = (ownRows || []).map((r) => r.connection_id);
      if (connection_ids.length === 0) {
        return apiError('Выбранные подключения вне вашей области видимости', 'FORBIDDEN', 403);
      }
    }

    // 0. Действие: Массовое подтверждение подключений (только pending; остальные пропускаются)
    if (action === 'confirm_selected') {
      let confirmed = 0;
      const skipped: string[] = [];
      for (const connectionId of connection_ids as string[]) {
        const res = await setConnectionConfirmation({ connectionId, action: 'confirm', actor: profile });
        if (res.success) confirmed++;
        else skipped.push(`${connectionId}: ${res.error}`);
      }
      return apiSuccess({
        success: true,
        action,
        confirmed_count: confirmed,
        skipped_count: skipped.length,
        skipped: skipped.length > 0 ? skipped : undefined,
        message: `Подтверждено подключений: ${confirmed}${skipped.length > 0 ? `, пропущено: ${skipped.length}` : ''}`,
      });
    }

    // 0.1. Действие: сотрудники подключения (042/043) — участники (с подтверждением) и сопровождение по месяцам
    if (action === 'assign_staff') {
      const participants = Array.isArray(payload?.participants)
        ? (payload.participants as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
        : typeof payload?.manager_id === 'string' && payload.manager_id
        ? [payload.manager_id as string]
        : undefined;
      const maintenance = Array.isArray(payload?.maintenance)
        ? (payload.maintenance as { month_index: number; user_ids?: string[]; user_id?: string | null }[])
            .filter((m) => m && Number.isInteger(Number(m.month_index)))
            .map((m) => ({
              month_index: Number(m.month_index),
              user_ids: Array.isArray(m.user_ids) ? m.user_ids.filter((v) => typeof v === 'string') : m.user_id ? [m.user_id] : [],
            }))
        : [];
      if (!participants && maintenance.length === 0) {
        return apiError('Укажите участников подключения или сопровождение по месяцам', 'MISSING_PARAM', 400);
      }
      if (participants && !ctx.can('connections.confirm')) {
        return apiError('Назначение участников подтверждает подключение: требуется право подтверждать подключения', 'FORBIDDEN', 403);
      }
      let updated = 0;
      let confirmed = 0;
      const skipped: string[] = [];
      for (const connectionId of connection_ids as string[]) {
        const res = await assignConnectionStaff({ connectionId, participants, maintenance, actor: profile, mode: 'admin' });
        if (!res.success) {
          skipped.push(`${connectionId}: ${res.error}`);
          continue;
        }
        updated++;
        if (res.confirmed) confirmed++;
        skipped.push(...res.skipped.map((r) => `${connectionId}: ${r}`));
      }
      return apiSuccess({
        success: true,
        action,
        updated_count: updated,
        confirmed_count: confirmed,
        skipped_count: skipped.length,
        skipped: skipped.length > 0 ? skipped : undefined,
        message: `Сотрудники назначены: ${updated}${confirmed > 0 ? `, подтверждено подключений: ${confirmed}` : ''}${
          skipped.length > 0 ? `, пропущено: ${skipped.length}` : ''
        }`,
      });
    }

    // 1. Действие: Массовое изменение срока сопровождения
    if (action === 'update_maintenance_months') {
      const rawMonths = payload?.months_total ?? payload?.maintenance_months_total ?? payload?.monthsTotal ?? 2;
      const monthsTotal = Math.max(1, Math.min(24, parseInt(String(rawMonths), 10) || 2));

      const { data: updatedConns, error: updateErr } = await supabase
        .from('connections')
        .update({
          maintenance_months_total: monthsTotal,
          maintenance_months_limit: monthsTotal,
        })
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
      const mode = (payload?.mode || 'maintenance').toLowerCase();
      const settlementMonth = payload?.month || payload?.settlement_month || new Date().toISOString().slice(0, 7);

      // 2.1. Попытка вызова RPC-процедуры в СУБД
      try {
        // RPC доступна только service_role (миграция 029), права admin проверены выше
        const { data: rpcRes, error: rpcErr } = await (createAdminClient().rpc as any)('accrue_selected_connections', {
          p_connection_ids: connection_ids,
          p_mode: mode,
          p_settlement_month: settlementMonth,
        });

        if (!rpcErr && rpcRes && (rpcRes as any).success) {
          scheduleTelegramDispatch();
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
          confirmation_status,
          seller:sellers(is_active)
        `)
        .in('connection_id', connection_ids)
        .eq('confirmation_status', 'confirmed');

      if (connsErr) throw connsErr;

      let connectionBonusesCreated = 0;
      let maintenanceBonusesCreated = 0;
      let maintenanceSkipped = 0;

      // Участники (043) и сопровождающие по месяцам (042): доли поровну
      const [{ data: assignmentRows }, { data: participantRows }] = await Promise.all([
        supabase
          .from('connection_maintenance_assignments')
          .select('connection_id, month_index, user_id, assigned_at')
          .in('connection_id', connection_ids)
          .order('assigned_at', { ascending: true }),
        supabase
          .from('connection_participants')
          .select('connection_id, user_id, added_at')
          .in('connection_id', connection_ids)
          .order('added_at', { ascending: true }),
      ]);
      const participantsOf = (connectionId: string, managerId: string) => {
        const ids = [managerId];
        for (const p of participantRows || []) if (p.connection_id === connectionId && !ids.includes(p.user_id)) ids.push(p.user_id);
        return ids;
      };
      const maintenanceUsersFor = (connectionId: string, monthIndex: number, managerId: string) => {
        const assigned = (assignmentRows || []).filter((a) => a.connection_id === connectionId && a.month_index === monthIndex).map((a) => a.user_id);
        return assigned.length > 0 ? assigned : participantsOf(connectionId, managerId);
      };
      const splitAmount = (total: number, n: number, i: number) => {
        if (n <= 1) return Math.round(total * 100) / 100;
        const base = Math.round((total / n) * 100) / 100;
        return i >= n ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
      };
      const shareLabel = (n: number, i: number) => (n > 1 ? ` (доля ${i}/${n})` : '');

      // История начислений для правила «сначала подключение, сопровождение — со следующего месяца»
      const { data: historyRows } = await supabase
        .from('employee_payouts')
        .select('operation_type, settlement_month, accrual_month, seller_phone, connection_id')
        .in('operation_type', ['accrual_connection', 'accrual_maintenance']);
      const accrualHistory: ConnectionAccrualHistoryRow[] = [...((historyRows || []) as ConnectionAccrualHistoryRow[])];

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

          const accMonth = conn.accrual_month || settlementMonth;
          const connOrderError = connectionOrderError(
            'accrual_connection',
            accMonth,
            { sellerPhone: conn.seller_phone, connectionId: conn.connection_id },
            accrualHistory
          );

          if ((!existingConnAccruals || existingConnAccruals.length === 0) && feeConn > 0 && !connOrderError) {
            const users = participantsOf(conn.connection_id, conn.manager_id);
            let connInsErr: unknown = null;
            for (let i = 1; i <= users.length; i++) {
              const label = `Бонус за подключение: ${conn.seller_name || conn.store || conn.seller_phone}${shareLabel(users.length, i)}`;
              const { error } = await supabase.from('employee_payouts').insert({
                user_id: users[i - 1],
                employee_id: users[i - 1],
                connection_id: conn.connection_id,
                seller_phone: conn.seller_phone,
                operation_sign: '+',
                operation_type: 'accrual_connection',
                payout_category: 'бонус',
                amount: splitAmount(feeConn, users.length, i),
                settlement_month: accMonth,
                accrual_month: accMonth,
                actual_date: new Date().toISOString().slice(0, 10),
                payout_date: new Date().toISOString().slice(0, 10),
                status: 'completed',
                note: label,
                comment: label,
                created_by: conn.manager_id,
              } as any);
              if (error) connInsErr = error;
            }

            if (!connInsErr) {
              connectionBonusesCreated++;
              accrualHistory.push({
                operation_type: 'accrual_connection',
                settlement_month: accMonth,
                seller_phone: conn.seller_phone,
                connection_id: conn.connection_id,
              });
            }
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

          const isDue =
            (!existingMaintThisMonth || existingMaintThisMonth.length === 0) &&
            feeMaint > 0 &&
            currentMaintCount < limitMonths &&
            (!conn.maintenance_month_start || settlementMonth >= conn.maintenance_month_start) &&
            conn.client_status !== 'готов' &&
            conn.status !== 'готов';

          // Сопровождение — только со следующего месяца после начисления за подключение
          const maintOrderError = isDue
            ? connectionOrderError(
                'accrual_maintenance',
                settlementMonth,
                { sellerPhone: conn.seller_phone, connectionId: conn.connection_id },
                accrualHistory
              )
            : null;
          if (maintOrderError) maintenanceSkipped++;

          if (isDue && !maintOrderError) {
            const monthIndex = currentMaintCount + 1;
            const maintUsers = maintenanceUsersFor(conn.connection_id, monthIndex, conn.manager_id);
            let maintInsErr: unknown = null;
            for (let i = 1; i <= maintUsers.length; i++) {
              const maintUser = maintUsers[i - 1];
              const label = `Бонус за сопровождение ${monthIndex} мес. (${settlementMonth}): ${conn.seller_name || conn.store || conn.seller_phone}${shareLabel(maintUsers.length, i)}`;
              const { error } = await supabase.from('employee_payouts').insert({
                user_id: maintUser,
                employee_id: maintUser,
                connection_id: conn.connection_id,
                seller_phone: conn.seller_phone,
                operation_sign: '+',
                operation_type: 'accrual_maintenance',
                payout_category: 'бонус',
                amount: splitAmount(feeMaint, maintUsers.length, i),
                settlement_month: settlementMonth,
                accrual_month: settlementMonth,
                actual_date: new Date().toISOString().slice(0, 10),
                payout_date: new Date().toISOString().slice(0, 10),
                status: 'completed',
                note: label,
                comment: label,
                created_by: maintUser,
              } as any);
              if (error) {
                maintInsErr = error;
                break;
              }
              // Назначение месяца подтверждается начислением
              await supabase.from('connection_maintenance_assignments').upsert(
                {
                  connection_id: conn.connection_id,
                  month_index: monthIndex,
                  user_id: maintUser,
                  status: 'accrued',
                  accrued_month: settlementMonth,
                  accrued_at: new Date().toISOString(),
                },
                { onConflict: 'connection_id,month_index,user_id' }
              );
            }

            if (maintInsErr) {
              maintenanceSkipped++;
              continue;
            }
            accrualHistory.push({
              operation_type: 'accrual_maintenance',
              settlement_month: settlementMonth,
              seller_phone: conn.seller_phone,
              connection_id: conn.connection_id,
            });

            const nextCount = currentMaintCount + 1;
            const nextStatus = nextCount >= limitMonths ? 'готов' : 'сопровождение';

            await supabase
              .from('connections')
              .update({
                maintenance_months_accrued: nextCount,
                client_status: nextStatus,
                status: nextStatus,
              } as any)
              .eq('connection_id', conn.connection_id);

            maintenanceBonusesCreated++;
          }
        }
      }

      scheduleTelegramDispatch();
      return apiSuccess({
        success: true,
        action: 'accrue_selected',
        settlement_month: settlementMonth,
        mode,
        connection_bonuses_created: connectionBonusesCreated,
        maintenance_bonuses_created: maintenanceBonusesCreated,
        maintenance_skipped_same_month: maintenanceSkipped,
        total_created: connectionBonusesCreated + maintenanceBonusesCreated,
        message: `Выборочное начисление выполнено: подключений: ${connectionBonusesCreated}, сопровождений: ${maintenanceBonusesCreated}`,
      });
    }

    return apiError(`Неизвестное действие: ${action}`, 'INVALID_ACTION', 400);
  } catch (err) {
    return handleApiError(err);
  }
}
