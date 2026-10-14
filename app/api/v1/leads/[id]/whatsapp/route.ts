import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { isLeadInScope, leadActorFrom } from '@/lib/leads/status-rules';
import { DEFAULT_COUNTRY_CODE, fullDigitsFrom } from '@/lib/utils/phone';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.menu');

    const { data: lead } = await createAdminClient()
      .from('leads')
      .select('lead_id, phone, country_code, client_name, created_by, assigned_to')
      .eq('lead_id', id)
      .single();

    if (!lead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!isLeadInScope(leadActorFrom(ctx), lead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    // Полный номер с кодом страны СНГ из национального номера лида
    const fullPhone = fullDigitsFrom(lead.phone, lead.country_code || DEFAULT_COUNTRY_CODE);

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
