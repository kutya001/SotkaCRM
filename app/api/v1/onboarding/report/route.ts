import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { buildTrainingReport } from '@/lib/services/onboarding';

/** Прохождение обучения всеми активными сотрудниками (вкладка «Обучение» в модуле «Сотрудники») */
export async function GET() {
  try {
    await requirePermission('employees.training');
    return apiSuccess(await buildTrainingReport());
  } catch (err) {
    return handleApiError(err);
  }
}
