import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { leadActorFrom } from '@/lib/leads/status-rules';
import { findPhoneDuplicates } from '@/lib/services/lead-duplicates';
import { PG_UUID_REGEX } from '@/lib/validations';

/**
 * Проверка дубликата номера перед сохранением лида: лиды с тем же номером и продавец платформы.
 * Только предупреждение — сохранить лид можно. Чужие лиды — без имени клиента.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('leads.menu');
    const { searchParams } = new URL(req.url);
    const phone = (searchParams.get('phone') || '').trim();
    const countryCode = searchParams.get('country_code');
    const exclude = searchParams.get('exclude');

    if (!phone) return apiError('Укажите номер телефона', 'MISSING_PHONE', 400);
    if (exclude && !PG_UUID_REGEX.test(exclude)) return apiError('Некорректный идентификатор лида', 'VALIDATION_ERROR', 422);

    return apiSuccess(await findPhoneDuplicates(leadActorFrom(ctx), phone, countryCode, exclude));
  } catch (err) {
    return handleApiError(err);
  }
}
