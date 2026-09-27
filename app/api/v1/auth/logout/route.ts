import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return apiSuccess({ success: true, message: 'Сессия успешно завершена' });
  } catch (err) {
    return handleApiError(err);
  }
}
