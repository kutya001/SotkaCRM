'use server';

import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/check-role';

export interface AnalyticsSummaryResult {
  leads: {
    total: number;
    open: number;
    processed: number;
    assigned: number;
    signed: number;
    cancelled: number;
  };
  payouts: {
    totalPaid: number;
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
 * Получение агрегированной сводки KPI и аналитики в одном оптимизированном вызове PostgreSQL RPC get_analytics_summary
 */
export async function getAnalyticsSummaryAction(
  startDate?: string,
  endDate?: string
): Promise<{ success: boolean; data?: AnalyticsSummaryResult; error?: string }> {
  try {
    await requireAuth();
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('get_analytics_summary', {
      p_start_date: startDate || undefined,
      p_end_date: endDate || undefined,
    });

    if (error) {
      console.error('Error executing get_analytics_summary RPC:', error);
      return { success: false, error: error.message };
    }

    const raw = data as any;
    return {
      success: true,
      data: {
        leads: {
          total: Number(raw?.leads?.total) || 0,
          open: Number(raw?.leads?.open) || 0,
          processed: Number(raw?.leads?.processed) || 0,
          assigned: Number(raw?.leads?.assigned) || 0,
          signed: Number(raw?.leads?.signed) || 0,
          cancelled: Number(raw?.leads?.cancelled) || 0,
        },
        payouts: {
          totalPaid: Number(raw?.payouts?.totalPaid) || 0,
          totalAdvances: Number(raw?.payouts?.totalAdvances) || 0,
          totalDeductions: Number(raw?.payouts?.totalDeductions) || 0,
          transactionsCount: Number(raw?.payouts?.transactionsCount) || 0,
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
