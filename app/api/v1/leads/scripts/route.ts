import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import salesScriptsData from '@/data/sales-scripts.json';

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const stage = searchParams.get('stage');

    let scripts = salesScriptsData;
    if (stage && stage !== 'Все') {
      scripts = scripts.filter((s: any) => s.stage === stage);
    }

    return apiSuccess({
      scripts,
      stages: ['Все', 'Открыт', 'Обработан', 'Назначен', 'Подписан'],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
