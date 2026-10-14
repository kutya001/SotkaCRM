import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { updateEmployee, toggleEmployeeActive } from '@/app/employees/actions';

/** Редактирование сотрудника: employees.edit (смена активности — дополнительно employees.deactivate) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePermission('employees.edit');
    const body = await req.json();

    const res = await updateEmployee(id, body);
    if (!res.success) {
      if (res.error?.startsWith('Недостаточно прав')) {
        return apiError(res.error, 'FORBIDDEN', 403);
      }
      return apiError(res.error || 'Ошибка обновления сотрудника', 'UPDATE_FAILED', 400);
    }

    return apiSuccess({ success: true, id });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Деактивация сотрудника: employees.deactivate */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePermission('employees.deactivate');

    const res = await toggleEmployeeActive(id, false);
    if (!res.success) {
      return apiError(res.error || 'Ошибка деактивации сотрудника', 'DEACTIVATE_FAILED', 400);
    }

    return apiSuccess({ success: true, deactivated_id: id });
  } catch (err) {
    return handleApiError(err);
  }
}
