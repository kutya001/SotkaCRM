'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface AuthState {
  error?: string;
  success?: boolean;
}

export async function login(prevState: AuthState, formData: FormData): Promise<AuthState> {
  const identifier = (formData.get('identifier') || formData.get('email')) as string;
  const password = formData.get('password') as string;

  if (!identifier || !password) {
    return { error: 'Пожалуйста, заполните логин и пароль.' };
  }

  const cleanIdentifier = identifier.trim();

  // Резолв логина: если введен чистый логин без @, приводим к email домена @sotka.kg
  const email = cleanIdentifier.includes('@')
    ? cleanIdentifier
    : cleanIdentifier === 'consultant1'
    ? 'consultant@sotka.kg'
    : cleanIdentifier === 'smm_operator'
    ? 'smm@sotka.kg'
    : `${cleanIdentifier}@sotka.kg`;

  const supabase = await createClient();

  // 1. Аутентификация через Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return { error: 'Неверный логин (email) или пароль.' };
  }

  // 2. Извлечение профиля и роли из таблицы users
  const profileRes = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authData.user.id)
    .single();

  if (profileRes.error || !profileRes.data) {
    await supabase.auth.signOut();
    return { error: 'Профиль сотрудника в CRM не найден. Обратитесь к администратору.' };
  }

  const userProfile = profileRes.data;

  // 3. Проверка флага активности (is_active = true)
  if (!userProfile.is_active) {
    await supabase.auth.signOut();
    return { error: 'Учетная запись отключена или заблокирована администратором.' };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
