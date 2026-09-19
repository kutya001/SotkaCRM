import { createServerClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database.types';

function createRedirectWithCookies(url: URL, sourceResponse: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  sourceResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  }) as unknown as SupabaseClient<Database>;

  // 1. Извлечение пользователя из сессии
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthPage = pathname.startsWith('/login');
  const isApiRoute = pathname.startsWith('/api');

  // 2. Редирект неавторизованных пользователей
  if (!user && !isAuthPage && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return createRedirectWithCookies(url, supabaseResponse);
  }

  // 3. Редирект авторизованных со страницы входа
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return createRedirectWithCookies(url, supabaseResponse);
  }

  // 4. Защита маршрутов по ролевой модели (RBAC)
  if (user && !isApiRoute && !isAuthPage) {
    // Получаем профиль пользователя
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (profile) {
      // Если учетная запись заблокирована
      if (!profile.is_active) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.searchParams.set('error', 'blocked');
        return createRedirectWithCookies(url, supabaseResponse);
      }

      // Маршруты /admin/* и /plans/* разрешены строго для роли admin
      if (
        (pathname.startsWith('/admin') || pathname.startsWith('/plans')) &&
        profile.role !== 'admin'
      ) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        return createRedirectWithCookies(url, supabaseResponse);
      }

      // Роли smm запрещен доступ к продавцам, платежам, связям, выплатам, аналитике и тарифам
      const restrictedForSmm = ['/sellers', '/payments', '/connections', '/payouts', '/analytics', '/plans', '/rates'];
      if (
        profile.role === 'smm' &&
        restrictedForSmm.some((prefix) => pathname.startsWith(prefix))
      ) {
        const url = request.nextUrl.clone();
        url.pathname = '/leads';
        return createRedirectWithCookies(url, supabaseResponse);
      }
    }
  }

  return supabaseResponse;
}
