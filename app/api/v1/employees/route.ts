import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getEmployees, createEmployee } from '@/app/employees/actions';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = searchParams.get('search') || undefined;
    const role = searchParams.get('role') || undefined;
    const isActive = searchParams.get('isActive') || undefined;
    const sortBy = searchParams.get('sortBy') || undefined;
    const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || undefined;

    const res = await getEmployees({
      page,
      pageSize,
      search,
      role,
      isActive,
      sortBy,
      sortOrder,
    });

    return apiSuccess({
      items: res.employees,
      total: res.totalCount,
      page,
      pageSize,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();

    const res = await createEmployee(body);
    if (!res.success) {
      return apiError(res.error || 'Ошибка добавления сотрудника', 'CREATE_FAILED', 400);
    }

    return apiSuccess({ success: true, id: res.userId }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
