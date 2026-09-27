import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase } = await requireAdmin();
    const body = await req.json();

    const assignedTo = body.assigned_to || null;

    const { data: currentLead } = await supabase
      .from('leads')
      .select('status')
      .eq('lead_id', id)
      .single();

    if (!currentLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    const updates: Record<string, any> = {
      assigned_to: assignedTo,
      updated_at: new Date().toISOString(),
    };

    if (assignedTo && (currentLead.status === 'Открыт' || currentLead.status === 'Обработан')) {
      updates.status = 'Назначен';
    }

    if (!assignedTo && currentLead.status === 'Назначен') {
      updates.status = 'Обработан';
    }

    const { data: updated, error } = await supabase
      .from('leads')
      .update(updates as any)
      .eq('lead_id', id)
      .select(
        `
          lead_id,
          assigned_to,
          status,
          assigned_user:users!leads_assigned_to_fkey(user_id, full_name, role, color)
        `
      )
      .single();

    if (error) throw error;

    return apiSuccess(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
