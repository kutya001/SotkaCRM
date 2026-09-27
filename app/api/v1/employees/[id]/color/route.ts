import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { updateEmployee } from '@/app/employees/actions';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireAdmin();
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
