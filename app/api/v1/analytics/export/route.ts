import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/check-role';
import { handleApiError } from '@/lib/api/handler';

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireRoles(['admin', 'supervisor']);

    const { data: leads } = await supabase
      .from('leads')
      .select('lead_id, client_name, phone, status, created_at, seller_phone')
      .order('created_at', { ascending: false });

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
    const bom = '\uFEFF';
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
