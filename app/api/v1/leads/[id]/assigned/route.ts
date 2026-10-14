import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { normalizeNullableUuid } from '@/lib/validations';
import { implicitStatusForAssignment, isLeadInScope, leadActorFrom } from '@/lib/leads/status-rules';
import { scheduleTelegramDispatch } from '@/lib/telegram/outbox';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requirePermission('leads.assign');
    const body = await req.json();
    const admin = createAdminClient();

    const assignedTo = normalizeNullableUuid(body.assigned_to);

    const { data: currentLead } = await admin
      .from('leads')
      .select('status, created_by, assigned_to')
      .eq('lead_id', id)
      .single();

    if (!currentLead) {
      return apiError('Лид не найден', 'NOT_FOUND', 404);
    }

    if (!isLeadInScope(leadActorFrom(ctx), currentLead)) {
      return apiError('Лид вне вашей области видимости', 'FORBIDDEN', 403);
    }

    const updates: Record<string, unknown> = {
      assigned_to: assignedTo,
      updated_at: new Date().toISOString(),
    };

    // Назначение из «Открыт»/«Обработан» → «Назначен»; снятие из «Назначен» → «Обработан»
    const implicitStatus = implicitStatusForAssignment(currentLead.status, assignedTo);
    if (implicitStatus) {
      updates.status = implicitStatus;
    }

    const { data: updated, error } = await admin
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

    scheduleTelegramDispatch();
    return apiSuccess(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
