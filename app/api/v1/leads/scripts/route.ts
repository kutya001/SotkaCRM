import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';
import { SALES_SCRIPTS, SALES_SCRIPT_CATEGORIES } from '@/lib/sales/scripts';
import { PLATFORM_TARIFFS } from '@/lib/sales/tariffs';

const STAGES = ['Все', 'Открыт', 'Обработан', 'Назначен', 'Подписан'];

export async function GET(req: NextRequest) {
  try {
    await requirePermission('leads.scripts');
    const { searchParams } = new URL(req.url);
    const stage = searchParams.get('stage');
    const category = searchParams.get('category');

    let scripts = SALES_SCRIPTS;
    if (stage && stage !== 'Все') scripts = scripts.filter((s) => s.stage === stage);
    if (category) scripts = scripts.filter((s) => s.category === category);

    return apiSuccess({
      scripts,
      categories: SALES_SCRIPT_CATEGORIES,
      stages: STAGES,
      tariffs: PLATFORM_TARIFFS,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
