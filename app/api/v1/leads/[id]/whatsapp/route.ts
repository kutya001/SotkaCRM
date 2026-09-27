import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase } = await requireAuth();

    const { data: lead } = await supabase
      .from('leads')
      .select('lead_id, phone, country_code, client_name')
      .eq('lead_id', id)
      .single();

    if (!lead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    const cleanPhone = (lead.phone || '').replace(/\D/g, '');
    const code = (lead.country_code || '996').replace(/\D/g, '');
    const fullPhone = cleanPhone.startsWith(code) ? cleanPhone : `${code}${cleanPhone}`;

    const text = encodeURIComponent(`Здравствуйте, ${lead.client_name}! Обращаюсь по поводу подключения сервиса Sotka.`);
    const directUrl = `https://wa.me/${fullPhone}?text=${text}`;

    return apiSuccess({
      phone: fullPhone,
      client_name: lead.client_name,
      direct_url: directUrl,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
