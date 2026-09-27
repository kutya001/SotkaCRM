import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { upsertEmployeeRate, deleteEmployeeRate } from '@/app/rates/actions';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireAdmin();
    const body = await req.json();

    const res = await upsertEmployeeRate({
      user_id: body.user_id || id,
      connection_percent: body.connection_percent,
      maintenance_percent: body.maintenance_percent,
      effective_from: body.effective_from || new Date().toISOString().substring(0, 10),
    });

    if (!res.success) {
      return apiError(res.error || 'Ошибка обновления ставки', 'UPDATE_RATE_ERROR', 400);
    }

    return apiSuccess({ success: true, user_id: id });
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

    const res = await deleteEmployeeRate(id);
    if (!res.success) {
      return apiError(res.error || 'Ошибка удаления ставки', 'DELETE_RATE_ERROR', 400);
    }

    return apiSuccess({ success: true, deleted_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
