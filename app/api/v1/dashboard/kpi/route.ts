import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function GET(req: NextRequest) {
  try {
    const { supabase, profile } = await requireAuth();

    // Запрашиваем ключевые счетчики параллельно
    const currentMonth = new Date().toISOString().substring(0, 7);

    let leadsQuery = supabase.from('leads').select('status, assigned_to');
    if (profile.role === 'consultant') {
      leadsQuery = leadsQuery.eq('assigned_to', profile.user_id);
    } else if (profile.role === 'smm') {
      leadsQuery = leadsQuery.eq('created_by', profile.user_id);
    }

    const [leadsRes, sellersRes, connectionsRes, payoutsRes] = await Promise.all([
      leadsQuery,
      supabase.from('sellers').select('is_active, balance', { count: 'exact' }),
      supabase.from('connections').select('connection_id', { count: 'exact', head: true }),
      supabase.from('employee_payouts').select('amount').eq('accrual_month', currentMonth),
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
