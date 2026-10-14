import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/v1/dashboard/kpi — показатели главной страницы.
 * Каждый блок считается в области данных сотрудника: без права «<модуль>.view_all» —
 * только свои лиды, продавцы, подключения и начисления. В ответе есть scope по модулям,
 * чтобы страница подписывала карточки («Мои продавцы» и т. п.).
 */
export async function GET(_req: NextRequest) {
  try {
    const { profile, canViewAll } = await requirePermission('dashboard.menu');
    const admin = createAdminClient();
    const me = profile.user_id;
    const currentMonth = new Date().toISOString().substring(0, 7);

    const scope = {
      leads: canViewAll('leads') ? 'all' : 'own',
      sellers: canViewAll('sellers') ? 'all' : 'own',
      connections: canViewAll('connections') ? 'all' : 'own',
      payouts: canViewAll('payouts') ? 'all' : 'own',
    } as const;

    let leadsQuery = admin.from('leads').select('status');
    if (scope.leads === 'own') leadsQuery = leadsQuery.or(`assigned_to.eq.${me},created_by.eq.${me}`);

    let sellersQuery = admin.from('sellers').select('is_active, balance').eq('is_deleted_from_source', false);
    if (scope.sellers === 'own') sellersQuery = sellersQuery.eq('manager_id', me);

    let connectionsQuery = admin
      .from('connections')
      .select('connection_id', { count: 'exact', head: true })
      .eq('confirmation_status', 'confirmed');
    if (scope.connections === 'own') connectionsQuery = connectionsQuery.eq('manager_id', me);

    let payoutsQuery = admin
      .from('employee_payouts')
      .select('amount, operation_type')
      .eq('accrual_month', currentMonth);
    if (scope.payouts === 'own') payoutsQuery = payoutsQuery.or(`user_id.eq.${me},employee_id.eq.${me}`);

    const [leadsRes, sellersRes, connectionsRes, payoutsRes] = await Promise.all([
      leadsQuery,
      sellersQuery,
      connectionsQuery,
      payoutsQuery,
    ]);
    if (leadsRes.error) throw leadsRes.error;
    if (sellersRes.error) throw sellersRes.error;
    if (connectionsRes.error) throw connectionsRes.error;
    if (payoutsRes.error) throw payoutsRes.error;

    const leads = leadsRes.data || [];
    const totalLeads = leads.length;
    const openLeads = leads.filter((l) => l.status === 'Открыт').length;
    const signedLeads = leads.filter((l) => l.status === 'Подписан').length;
    const cancelledLeads = leads.filter((l) => l.status === 'Отмена').length;
    const conversionRate = totalLeads > 0 ? Math.round((signedLeads / totalLeads) * 1000) / 10 : 0;

    let activeSellers = 0;
    let totalBalance = 0;
    for (const s of sellersRes.data || []) {
      if (s.is_active) activeSellers++;
      if (s.balance) totalBalance += Number(s.balance);
    }

    // Фонд выплат: начисления (положительные операции) за текущий месяц
    const monthPayouts = (payoutsRes.data || []).reduce((acc, p) => {
      const amount = Number(p.amount) || 0;
      return amount > 0 ? acc + amount : acc;
    }, 0);

    return apiSuccess({
      total_leads: totalLeads,
      open_leads: openLeads,
      signed_leads: signedLeads,
      cancelled_leads: cancelledLeads,
      conversion_rate: conversionRate,
      active_sellers: activeSellers,
      total_sellers: (sellersRes.data || []).length,
      total_sellers_balance: Math.round(totalBalance * 100) / 100,
      total_connections: connectionsRes.count || 0,
      month_payouts: Math.round(monthPayouts * 100) / 100,
      scope,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
