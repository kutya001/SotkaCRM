import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { updatePlan, deletePlan } from '@/app/plans/actions';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireAdmin();
    const body = await req.json();

    const res = await updatePlan(id, body);
    if (!res.success) {
      return apiError(res.error || 'Ошибка обновления тарифа', 'UPDATE_PLAN_ERROR', 400);
    }

    return apiSuccess({ success: true, plan_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireAdmin();

    const res = await deletePlan(id);
    if (!res.success) {
      return apiError(res.error || 'Ошибка удаления тарифа', 'DELETE_PLAN_ERROR', 400);
    }

    return apiSuccess({ success: true, deleted_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
