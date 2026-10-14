import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { updateEmployee } from '@/app/employees/actions';

/** Смена цвета сотрудника: employees.edit */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePermission('employees.edit');
    const body = await req.json();

    const color = body.color;
    if (!color) {
      return apiError('HEX-код цвета обязателен', 'MISSING_COLOR', 400);
    }

    const res = await updateEmployee(id, { color });
    if (!res.success) {
      return apiError(res.error || 'Ошибка обновления цвета сотрудника', 'COLOR_UPDATE_FAILED', 400);
    }

    return apiSuccess({ success: true, id, color });
  } catch (err) {
    return handleApiError(err);
  }
}
