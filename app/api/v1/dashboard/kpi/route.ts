import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const { profile, canViewAll } = await requirePermission('dashboard.menu');
    const admin = createAdminClient();
    const leadsViewAll = canViewAll('leads');

    // Запрашиваем ключевые счетчики параллельно
    const currentMonth = new Date().toISOString().substring(0, 7);

    // 1. Попытка вызова высокопроизводительного SQL-агрегата в СУБД (1 раундтрип)
    // RPC доверяет p_user_id/p_role, поэтому доступна только service_role (миграция 029);
    // параметры берутся из серверного профиля, а не из запроса. p_role — только для области
    // воронки: при праве «leads.view_all» передаем 'admin' (все лиды), иначе базовую роль
    const { data: rpcData, error: rpcError } = await admin.rpc('get_dashboard_kpi', {
      p_user_id: profile.user_id,
      p_role: leadsViewAll ? 'admin' : profile.role,
      p_month: currentMonth,
    });

    if (!rpcError && rpcData) {
      const res = rpcData as Record<string, any>;
      return apiSuccess({
        total_leads: Number(res.total_leads) || 0,
        open_leads: Number(res.open_leads) || 0,
        signed_leads: Number(res.signed_leads) || 0,
        cancelled_leads: Number(res.cancelled_leads) || 0,
        conversion_rate: Number(res.conversion_rate) || 0,
        active_sellers: Number(res.active_sellers) || 0,
        total_sellers_balance: Number(res.total_sellers_balance) || 0,
        total_connections: Number(res.total_connections) || 0,
        month_payouts: Number(res.month_payouts) || 0,
      });
    }

    // Fallback: быстрые параллельные агрегатные запросы (те же глобальные метрики, что считает RPC;
    // воронка лидов — в области видимости сотрудника)
    let leadsQuery = admin.from('leads').select('status, assigned_to');
    if (!leadsViewAll) {
      leadsQuery = leadsQuery.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
    }

    const [leadsRes, sellersRes, connectionsRes, payoutsRes] = await Promise.all([
      leadsQuery,
      admin.from('sellers').select('is_active, balance', { count: 'exact' }),
      admin.from('connections').select('connection_id', { count: 'exact', head: true }),
      admin.from('employee_payouts').select('amount').eq('accrual_month', currentMonth),
    ]);

    const leads = leadsRes.data || [];
    const totalLeads = leads.length;
    const openLeads = leads.filter((l) => l.status === 'Открыт').length;
    const signedLeads = leads.filter((l) => l.status === 'Подписан').length;
    const cancelledLeads = leads.filter((l) => l.status === 'Отмена').length;

    const conversionRate = totalLeads > 0 ? Math.round((signedLeads / totalLeads) * 1000) / 10 : 0;

    let activeSellers = 0;
    let totalBalance = 0;
    if (sellersRes.data) {
      for (const s of sellersRes.data) {
        if (s.is_active) activeSellers++;
        if (s.balance) totalBalance += Number(s.balance);
      }
    }

    const totalConnections = connectionsRes.count || 0;
    const monthPayouts = (payoutsRes.data || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

    return apiSuccess({
      total_leads: totalLeads,
      open_leads: openLeads,
      signed_leads: signedLeads,
      cancelled_leads: cancelledLeads,
      conversion_rate: conversionRate,
      active_sellers: activeSellers,
      total_sellers_balance: totalBalance,
      total_connections: totalConnections,
      month_payouts: monthPayouts,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
