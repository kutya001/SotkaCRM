'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePermission } from '@/lib/auth/check-role';
import { fetchSalaryOperationsForSummary } from '@/lib/payroll/server';
import { sumSalaryOperations } from '@/lib/payroll/classify';
import { countCancelReasons, countLeadStatuses, type CancelReasonCount, type LeadStatusCounts } from '@/lib/leads/stats';

export interface AnalyticsSummaryResult {
  leads: LeadStatusCounts;
  /** Отмены за период по причинам (051; старые отмены без кода — «Не указана») */
  cancelReasons: CancelReasonCount[];
  payouts: {
    totalAccrued: number;
    /** Выплаты, включая авансы */
    totalPaid: number;
    /** Авансы — детализация, уже входят в totalPaid */
    totalAdvances: number;
    totalDeductions: number;
    transactionsCount: number;
  };
  sellers: {
    total: number;
    active: number;
    pending: number;
    totalBalance: number;
  };
}

/**
 * Получение агрегированной сводки KPI и аналитики в одном оптимизированном вызове PostgreSQL RPC get_analytics_summary.
 * Доступ: analytics.menu; область: analytics.view_all — все сотрудники, иначе только свои показатели.
 */
export async function getAnalyticsSummaryAction(
  startDate?: string,
  endDate?: string
): Promise<{ success: boolean; data?: AnalyticsSummaryResult; error?: string }> {
  try {
    const ctx = await requirePermission('analytics.menu');
    const { profile, supabase } = ctx;

    const viewAll = ctx.canViewAll('analytics');

    // Лиды за период по всем статусам (RPC знает только прежние пять): область — как у RPC,
    // все при «analytics.view_all», иначе назначенные мне или созданные мной
    const loadLeads = async (columns: string) => {
      let q = createAdminClient().from('leads').select(columns);
      if (!viewAll) q = q.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
      if (startDate) q = q.gte('created_at', startDate);
      if (endDate) q = q.lte('created_at', endDate);
      return q;
    };
    let leadsRes = await loadLeads('status, cancel_reason_code, meeting_at, next_contact_at');
    // До миграции 051 новых колонок нет
    if (leadsRes.error) leadsRes = await loadLeads('status');
    const leadRows = (leadsRes.data || []) as unknown as { status: string; cancel_reason_code?: string | null }[];

    const [rpcRes, salaryRows] = await Promise.all([
      // RPC опирается на auth.uid() внутри БД — вызывается клиентом пользователя
      supabase.rpc('get_analytics_summary', {
        p_start_date: startDate || undefined,
        p_end_date: endDate || undefined,
      }),
      // Итоги по ЗП — по тем же правилам, что реестр операций (lib/payroll):
      // RPC считал «выплачено» как все, кроме удержаний, включая начисления.
      // Область задается явно в коде (права проверены выше), выборка — сервисным клиентом.
      fetchSalaryOperationsForSummary(createAdminClient(), viewAll ? undefined : profile.user_id, {
        from: startDate,
        to: endDate,
      }),
    ]);
    const { data, error } = rpcRes;

    if (error) {
      console.error('Error executing get_analytics_summary RPC:', error);
      return { success: false, error: error.message };
    }

    const salary = sumSalaryOperations(salaryRows);

    const raw = data as any;
    return {
      success: true,
      data: {
        leads: countLeadStatuses(leadRows),
        cancelReasons: countCancelReasons(leadRows),
        payouts: {
          totalAccrued: salary.accrued,
          totalPaid: salary.paid,
          totalAdvances: salary.advances,
          totalDeductions: salary.deducted,
          transactionsCount: salary.count,
        },
        sellers: {
          total: Number(raw?.sellers?.total) || 0,
          active: Number(raw?.sellers?.active) || 0,
          pending: Number(raw?.sellers?.pending) || 0,
          totalBalance: Number(raw?.sellers?.totalBalance) || 0,
        },
      },
    };
  } catch (err: any) {
    console.error('Unhandled error in getAnalyticsSummaryAction:', err);
    return { success: false, error: err?.message || 'Ошибка загрузки аналитики' };
  }
}
