import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { updateEmployee, toggleEmployeeActive } from '@/app/employees/actions';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireAdmin();
    const body = await req.json();

    const res = await updateEmployee(id, body);
    if (!res.success) {
      return apiError(res.error || 'Ошибка обновления сотрудника', 'UPDATE_FAILED', 400);
    }

    return apiSuccess({ success: true, id });
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

    const res = await toggleEmployeeActive(id, false);
    if (!res.success) {
      return apiError(res.error || 'Ошибка деактивации сотрудника', 'DEACTIVATE_FAILED', 400);
    }

    return apiSuccess({ success: true, deactivated_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
