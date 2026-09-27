import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiSuccess, apiError, handleApiError } from '@/lib/api/handler';

const LoginSchema = z.object({
  login: z.string().min(3, 'Логин должен содержать минимум 3 символа'),
  password: z.string().min(6, 'Пароль должен содержать минимум 6 символов'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const valid = LoginSchema.parse(body);

    const cleanLogin = valid.login
      .trim()
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/@internal\.sotka\.kg$/, '');

    const syntheticEmail = `${cleanLogin}@internal.sotka.kg`;
    const supabase = await createClient();

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: syntheticEmail,
      password: valid.password,
    });

    if (authError || !authData.user) {
      return apiError(
        'Неверный логин или пароль. Проверьте правильность введенных данных.',
        'INVALID_CREDENTIALS',
        401
      );
    }

    // Проверяем статус учетной записи в CRM
    const adminSupabase = createAdminClient();
    const { data: profile, error: profileError } = await adminSupabase
      .from('users')
      .select('user_id, full_name, login, role, is_active, color')
      .eq('auth_id', authData.user.id)
      .single();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      return apiError('Профиль сотрудника не найден в CRM', 'USER_NOT_FOUND', 404);
    }

    if (!profile.is_active) {
      await supabase.auth.signOut();
      return apiError(
        'Ваша учетная запись заблокирована или отключена администратором.',
        'ACCOUNT_DISABLED',
        403
      );
    }

    return apiSuccess({
      user: {
        id: profile.user_id,
        name: profile.full_name,
        login: profile.login,
        role: profile.role,
        color: profile.color,
      },
      token: authData.session?.access_token,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
