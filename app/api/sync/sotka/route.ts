import { NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  authenticateSotkaAdmin,
  logoutSotkaSession,
  fetchSellersOverview,
  fetchTransactions,
} from '@/lib/services/sotka-api';
import { roundMoney } from '@/lib/utils/money';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

async function handleSync(request: Request) {
  const startTime = Date.now();
  let token = '';
  let syncedSellersCount = 0;
  let syncedPaymentsCount = 0;

  try {
    // 0. Валидация серверной конфигурации окружения
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[Sotka Sync] Отсутствует SUPABASE_SERVICE_ROLE_KEY в переменных среды');
      return NextResponse.json(
        {
          success: false,
          error:
            'Серверная конфигурация Supabase не завершена: переменная SUPABASE_SERVICE_ROLE_KEY отсутствует в Environment Variables.',
        },
        { status: 500 }
      );
    }

    const sotkaPhone = process.env.SOTKA_API_PHONE;
    const sotkaPassword = process.env.SOTKA_API_PASSWORD;
    if (!sotkaPhone || !sotkaPassword) {
      console.error('[Sotka Sync] Отсутствуют учетные данные SOTKA_API_PHONE или SOTKA_API_PASSWORD');
      return NextResponse.json(
        {
          success: false,
          error:
            'Учетные данные Sotka API (SOTKA_API_PHONE / SOTKA_API_PASSWORD) не заданы в Environment Variables.',
        },
        { status: 500 }
      );
    }

    // 1. Проверка прав: Bearer CRON_SECRET (для Vercel Cron) или активная сессия администратора
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCronAuthorized = Boolean(
      cronSecret && authHeader && (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret)
    );

    if (!isCronAuthorized) {
      const userSupabase = await createServerSupabase();
      const {
        data: { user },
        error: userError,
      } = await userSupabase.auth.getUser();

      if (userError || !user) {
        return NextResponse.json(
          { error: 'Требуется авторизация.' },
          { status: 401 }
        );
      }

      const { data: profile } = await userSupabase
        .from('users')
        .select('role, is_active')
        .eq('auth_id', user.id)
        .single();

      if (!profile || profile.role !== 'admin' || !profile.is_active) {
        return NextResponse.json(
          { error: 'Доступ запрещен. Запуск синхронизации разрешен исключительно роли «admin».' },
          { status: 403 }
        );
      }
    }

    const adminSupabase = createAdminClient();

    // 2. Авторизация во внешнем API
    token = await authenticateSotkaAdmin();

    // 3. Выгрузка продавцов
    // ИНВАРИАНТ: считываем существующие привязки manager_id, чтобы не затереть локальные назначения
    const { data: existingSellers } = await adminSupabase
      .from('sellers')
      .select('seller_phone, manager_id');

    const existingManagersMap = new Map<string, string | null>();
    if (existingSellers) {
      existingSellers.forEach((s) => {
        if (s.manager_id) {
          existingManagersMap.set(s.seller_phone, s.manager_id);
        }
      });
    }

    let sellerOffset = 0;
    const sellerLimit = 100;
    let hasMoreSellers = true;

    while (hasMoreSellers) {
      const { items, total } = await fetchSellersOverview(token, sellerOffset, sellerLimit);

      if (items.length === 0) {
        hasMoreSellers = false;
        break;
      }

      const sellersToUpsert: Database['public']['Tables']['sellers']['Insert'][] = items.map((item) => {
        const rawDigits = item.seller_phone.replace(/\D/g, '');
        const normalizedPhone = rawDigits.startsWith('996')
          ? rawDigits
          : `${item.iso_code || '996'}${rawDigits}`;

        // Сохраняем локально назначенного менеджера
        const preservedManagerId = existingManagersMap.get(normalizedPhone) || null;

        return {
          seller_phone: normalizedPhone,
          seller_name: item.seller_name || 'Без имени',
          store: item.stores?.[0] || 'Без названия',
          plan_id: item.plans?.[0] ? `PLN-${item.plans[0]}` : null,
          plan_name: item.plans?.[0] || 'Без тарифа',
          balance: roundMoney(item.balance),
          moderation: (item.moderation as any) || 'pending',
          is_active: item.is_active ?? true,
          registered_at: item.registered_at || null,
          last_activity: item.last_activity || null,
          employees_count: item.employees_count || 0,
          outlets_count: item.outlets_count || 0,
          brands: Array.isArray(item.brands) ? item.brands.join(', ') : item.brands || null,
          organization_id: item.organization_id ? String(item.organization_id) : null,
          manager_id: preservedManagerId,
          synced_at: new Date().toISOString(),
        };
      });

      const { error: sellersUpsertError } = await adminSupabase
        .from('sellers')
        .upsert(sellersToUpsert, { onConflict: 'seller_phone' });

      if (sellersUpsertError) {
        console.error('Ошибка upsert продавцов:', sellersUpsertError);
        throw new Error(`Ошибка сохранения продавцов: ${sellersUpsertError.message}`);
      }

      syncedSellersCount += items.length;
      sellerOffset += items.length;

      if (sellerOffset >= total || items.length < sellerLimit) {
        hasMoreSellers = false;
      }
    }

    // 4. Выгрузка транзакций
    let txOffset = 0;
    const txLimit = 100;
    let hasMoreTx = true;

    while (hasMoreTx) {
      const { items, total } = await fetchTransactions(token, txOffset, txLimit);

      if (items.length === 0) {
        hasMoreTx = false;
        break;
      }

      const paymentsToUpsert: Database['public']['Tables']['payments']['Insert'][] = items.map((item) => {
        const rawDigits = item.user_phone.replace(/\D/g, '');
        const normalizedPhone = rawDigits.startsWith('996')
          ? rawDigits
          : `996${rawDigits}`;

        return {
          payment_id: String(item.payment_id),
          user_phone: normalizedPhone,
          user_name: item.user_name || null,
          user_id: item.user_id ? String(item.user_id) : null,
          amount: roundMoney(item.amount),
          date_time: item.date_time || new Date().toISOString(),
          tran_type: item.tran_type || 'topup',
          description: item.description || null,
          status: item.status || 'succeeded',
          synced_at: new Date().toISOString(),
        };
      });

      const { error: paymentsUpsertError } = await adminSupabase
        .from('payments')
        .upsert(paymentsToUpsert, { onConflict: 'payment_id' });

      if (paymentsUpsertError) {
        console.error('Ошибка upsert платежей:', paymentsUpsertError);
        throw new Error(`Ошибка сохранения платежей: ${paymentsUpsertError.message}`);
      }

      syncedPaymentsCount += items.length;
      txOffset += items.length;

      if (txOffset >= total || items.length < txLimit) {
        hasMoreTx = false;
      }
    }

    const durationMs = Date.now() - startTime;
    console.info(
      `[Sotka Sync] Успешно завершено за ${durationMs}ms: продавцов=${syncedSellersCount}, платежей=${syncedPaymentsCount}`
    );

    return NextResponse.json({
      success: true,
      syncedSellers: syncedSellersCount,
      sellersCount: syncedSellersCount,
      syncedPayments: syncedPaymentsCount,
      paymentsCount: syncedPaymentsCount,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Ошибка в процессе синхронизации Sotka API:', err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Неизвестная ошибка при синхронизации',
        sellersCount: syncedSellersCount,
        paymentsCount: syncedPaymentsCount,
      },
      { status: 500 }
    );
  } finally {
    // 5. Гарантированная инвалидация сессии в Sotka API
    if (token) {
      await logoutSotkaSession(token);
    }
  }
}

export async function POST(request: Request) {
  return handleSync(request);
}

export async function GET(request: Request) {
  return handleSync(request);
}
