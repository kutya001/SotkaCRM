import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { KNOWN_TOUR_IDS, getOnboardingProgress, saveOnboardingProgress } from '@/lib/services/onboarding';

const ProgressSchema = z.object({
  tour_id: z.string().refine((id) => KNOWN_TOUR_IDS.includes(id), 'Неизвестный тур обучения'),
  status: z.enum(['in_progress', 'completed', 'skipped']),
  steps_seen: z.number().int().min(0).max(100),
  total_steps: z.number().int().min(0).max(100),
  tour_version: z.number().int().min(1).max(1000).optional(),
});

/** Мое прохождение обучения по модулям */
export async function GET() {
  try {
    const ctx = await requireAuth();
    return apiSuccess(await getOnboardingProgress(ctx.profile.user_id));
  } catch (err) {
    return handleApiError(err);
  }
}

/** Отметить начало, завершение или пропуск тура (tour_id «all» — обучение целиком) */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth();
    const parsed = ProgressSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || 'Ошибка валидации', 'VALIDATION_ERROR', 422, parsed.error.issues);
    }
    return apiSuccess(await saveOnboardingProgress(ctx.profile.user_id, parsed.data));
  } catch (err) {
    return handleApiError(err);
  }
}
