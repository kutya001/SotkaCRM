import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';

/** Экспорт лидов в CSV (analytics.export); без leads.view_all выгружаются только свои лиды */
export async function POST(_req: NextRequest) {
  try {
    const ctx = await requirePermission('analytics.export');
    const { profile } = ctx;

    let query = createAdminClient()
      .from('leads')
      .select('lead_id, client_name, phone, status, created_at, seller_phone')
      .order('created_at', { ascending: false });
    if (!ctx.canViewAll('leads')) {
      query = query.or(`assigned_to.eq.${profile.user_id},created_by.eq.${profile.user_id}`);
    }

    const { data: leads } = await query;

    // Формируем CSV строку
    const headers = ['ID Лида', 'Клиент', 'Телефон', 'Статус', 'Дата создания', 'Связанный продавец'];
    const rows = (leads || []).map((l) => [
      `"${l.lead_id}"`,
      `"${(l.client_name || '').replace(/"/g, '""')}"`,
      `"${l.phone}"`,
      `"${l.status}"`,
      `"${l.created_at}"`,
      `"${l.seller_phone || ''}"`,
    ]);

    const csvContent = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');

    // Возвращаем CSV с BOM для корректного отображения кириллицы в Excel
    const bom = '﻿';
    return new NextResponse(bom + csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sotkacrm_export.csv"',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
