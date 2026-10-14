import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { updatePlan, deletePlan } from '@/app/plans/actions';

/** Обновление тарифа: plans.manage */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePermission('plans.manage');
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

/** Удаление тарифа: plans.manage */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePermission('plans.manage');

    const res = await deletePlan(id);
    if (!res.success) {
      return apiError(res.error || 'Ошибка удаления тарифа', 'DELETE_PLAN_ERROR', 400);
    }

    return apiSuccess({ success: true, deleted_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
