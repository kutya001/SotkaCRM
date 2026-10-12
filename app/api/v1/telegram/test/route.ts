import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatTelegramMessage, isTelegramConfigured, sendTelegramMessage } from '@/lib/telegram/bot';

/** Тестовое сообщение самому себе */
export async function POST() {
  try {
    const { profile } = await requireAuth();
    if (!isTelegramConfigured()) {
      return apiError('Telegram-бот не настроен', 'TELEGRAM_NOT_CONFIGURED', 503);
    }

    const admin = createAdminClient() as unknown as SupabaseClient<any>;
    const { data: user } = await admin
      .from('users')
      .select('telegram_chat_id')
      .eq('user_id', profile.user_id)
      .maybeSingle();

    if (!user?.telegram_chat_id) {
      return apiError('Telegram не подключен', 'TELEGRAM_NOT_LINKED', 400);
    }

    await sendTelegramMessage(
      user.telegram_chat_id,
      formatTelegramMessage('Проверка связи', `${profile.full_name}, уведомления SotkaCRM работают.`)
    );
    return apiSuccess({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
