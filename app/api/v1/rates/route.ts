import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getEmployeeRates, upsertEmployeeRate } from '@/app/rates/actions';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const res = await getEmployeeRates();
    if (res.error) {
      return apiError(res.error, 'FETCH_RATES_ERROR', 400);
    }
    return apiSuccess({ items: res.rates });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
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
