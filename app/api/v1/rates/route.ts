import { NextRequest } from 'next/server';
import { requireAnyPermission, requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getEmployeeRates, upsertEmployeeRate } from '@/app/rates/actions';

/** Ставки сотрудников: rates.manage или employees.menu */
export async function GET(_req: NextRequest) {
  try {
    await requireAnyPermission(['rates.manage', 'employees.menu']);
    const res = await getEmployeeRates();
    if (res.error) {
      return apiError(res.error, 'FETCH_RATES_ERROR', 400);
    }
    return apiSuccess({ items: res.rates });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Сохранение ставки: rates.manage */
export async function POST(req: NextRequest) {
  try {
    await requirePermission('rates.manage');
    const body = await req.json();

    const res = await upsertEmployeeRate(body);
    if (!res.success) {
      return apiError(res.error || 'Ошибка сохранения ставки', 'SAVE_RATE_ERROR', 400);
    }

    return apiSuccess({ success: true, message: 'Ставка успешно сохранена' }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
