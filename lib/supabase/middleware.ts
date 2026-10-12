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

  const pathname = request.nextUrl.pathname;
  const isAuthPage = pathname.startsWith('/login');
  const isApiRoute = pathname.startsWith('/api');
  const isOpenApiJson = pathname.startsWith('/openapi.json');

  // Fast-path: проверка наличия токена сессии Supabase Auth в cookie заголовках
  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some(
    (c) =>
      c.name.startsWith('sb-') &&
      (c.name.includes('-auth-token') || c.name.includes('access-token') || c.name.includes('token'))
  );

  // Если авторизационных кук нет вообще:
  if (!hasAuthCookie) {
    if (isAuthPage || isApiRoute || isOpenApiJson) {
      // На странице входа, в API или спецификации пропускаем без сетевого запроса к Supabase Auth
      return supabaseResponse;
    }
    // На защищенных страницах (включая /docs) моментально редиректим на /login без внешнего сетевого вызова
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
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

  // 2. Редирект неавторизованных пользователей (если токен был невалиден/просрочен)
  if (!user && !isAuthPage && !isApiRoute && !isOpenApiJson) {
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
  if (user && !isApiRoute && !isAuthPage && !isOpenApiJson) {
    // Куки crm_* доступны клиенту на запись и используются только для UI — права берутся
    // из app_metadata пользователя (getUser читает его с сервера Auth). У заблокированного
    // сотрудника роль в app_metadata сброшена (миграция 029), поэтому идем в таблицу users.
    let role = (user.app_metadata?.role as string | undefined) || undefined;
    let isActive = role ? 'true' : undefined;

    if (role && request.cookies.get('crm_role')?.value !== role) {
      supabaseResponse.cookies.set('crm_role', role, { path: '/', httpOnly: false, sameSite: 'lax' });
      supabaseResponse.cookies.set('crm_active', 'true', { path: '/', httpOnly: false, sameSite: 'lax' });
    }

    if (!role) {
      const { data: profile } = await supabase
        .from('users')
        .select('role, is_active')
        .eq('auth_id', user.id)
        .single();

      if (profile) {
        role = profile.role;
        isActive = profile.is_active ? 'true' : 'false';
        supabaseResponse.cookies.set('crm_role', role, { path: '/', httpOnly: false, sameSite: 'lax' });
        supabaseResponse.cookies.set('crm_active', isActive, { path: '/', httpOnly: false, sameSite: 'lax' });
      }
    }

    // Если учетная запись заблокирована: завершаем сессию, иначе /login → / → /login зацикливается
    if (isActive === 'false') {
      await supabase.auth.signOut({ scope: 'local' });
      supabaseResponse.cookies.delete('crm_role');
      supabaseResponse.cookies.delete('crm_active');
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('error', 'blocked');
      return createRedirectWithCookies(url, supabaseResponse);
    }

    // Маршруты /admin/*, /plans/* и /docs разрешены строго для роли admin
    if (
      (pathname.startsWith('/admin') || pathname.startsWith('/plans') || pathname.startsWith('/docs')) &&
      role !== 'admin'
    ) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return createRedirectWithCookies(url, supabaseResponse);
    }

    // Роли smm запрещен доступ к продавцам, платежам, связям, выплатам, аналитике и тарифам
    const restrictedForSmm = ['/sellers', '/payments', '/connections', '/payouts', '/analytics', '/plans', '/rates'];
    if (
      role === 'smm' &&
      restrictedForSmm.some((prefix) => pathname.startsWith(prefix))
    ) {
      const url = request.nextUrl.clone();
      url.pathname = '/leads';
      return createRedirectWithCookies(url, supabaseResponse);
    }
  }

  return supabaseResponse;
}
