import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { getPlans, createPlan } from '@/app/plans/actions';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const res = await getPlans();
    if (res.error) {
      return apiError(res.error, 'FETCH_PLANS_ERROR', 400);
    }
    return apiSuccess({ items: res.plans });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();

    const res = await createPlan(body);
    if (!res.success) {
      return apiError(res.error || 'Ошибка создания тарифа', 'CREATE_PLAN_ERROR', 400);
    }

    return apiSuccess({ success: true, plan_id: body.plan_id }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
