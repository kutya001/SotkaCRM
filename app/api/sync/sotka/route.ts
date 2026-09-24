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
import {
  parseDateToISO,
  resolveSotkaPlan,
  normalizeSotkaSeller,
  formatSellerPhone,
} from '@/lib/sotka';
import type { Database } from '@/types/database.types';

export const dynamic = 'force-dynamic';

async function handleSync(request: Request) {
  const startTime = Date.now();
  let token = '';
  let syncedSellersCount = 0;
  let syncedPaymentsCount = 0;
  const warnings: string[] = [];

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

    // Справочник тарифов для предотвращения нарушения foreign key sellers_plan_id_fkey
    const { data: dbPlans } = await adminSupabase
      .from('plans')
      .select('plan_id, plan_name');

    const dbPlansMap = new Map<string, string>();
    const validPlanIds = new Set<string>();

    if (dbPlans) {
      for (const p of dbPlans) {
        validPlanIds.add(p.plan_id);
        dbPlansMap.set(p.plan_id.toLowerCase(), p.plan_id);
        dbPlansMap.set(p.plan_name.toLowerCase(), p.plan_id);
      }
    }

    let sellerOffset = 0;
    const sellerLimit = 100;
    let hasMoreSellers = true;
    const CHUNK_SIZE = 200;
    const MAX_EXECUTION_MS = 12000; // 12 секундный защитный барьер для Serverless (Vercel)

    while (hasMoreSellers) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        warnings.push('Лимит времени Serverless (12 сек): синхронизация продавцов приостановлена.');
        break;
      }

      const { items, total } = await fetchSellersOverview(token, sellerOffset, sellerLimit);

      if (items.length === 0) {
        hasMoreSellers = false;
        break;
      }

      // 3.1. Пакетная предварительная регистрация новых/неизвестных тарифов
      const plansToUpsertMap = new Map<string, Database['public']['Tables']['plans']['Insert']>();
      for (const item of items) {
        const rawPlan = item.plans?.[0];
        if (
          rawPlan &&
          typeof rawPlan === 'string' &&
          rawPlan.trim() &&
          rawPlan.trim().toLowerCase() !== 'без тарифа'
        ) {
          const cleanName = rawPlan.trim();
          const resolved = resolveSotkaPlan(cleanName, dbPlansMap, validPlanIds);
          if (!resolved.planId || !validPlanIds.has(resolved.planId)) {
            const cleanSlug = cleanName
              .toUpperCase()
              .replace(/[^A-Z0-9А-ЯЁ]/gi, '')
              .slice(0, 16);
            const newPlanId = `PLN-${cleanSlug || 'CUSTOM'}`;
            plansToUpsertMap.set(newPlanId, {
              plan_id: newPlanId,
              plan_name: cleanName,
              price: 2500.0,
              billing_period: 'Месяц',
              description: 'Автоматически зарегистрирован при синхронизации Sotka API',
              is_active: true,
              updated_at: new Date().toISOString(),
            });
            validPlanIds.add(newPlanId);
            dbPlansMap.set(newPlanId.toLowerCase(), newPlanId);
            dbPlansMap.set(cleanName.toLowerCase(), newPlanId);
          }
        }
      }

      if (plansToUpsertMap.size > 0) {
        try {
          const batchPlans = Array.from(plansToUpsertMap.values());
          await adminSupabase.from('plans').upsert(batchPlans, { onConflict: 'plan_id' });
        } catch (planErr) {
          console.warn('[Sotka Sync] Не удалось пакетно создать тарифы:', planErr);
        }
      }

      const normalizedSellers = items.map((item) => {
        const orgKey =
          item.organization_id !== undefined && item.organization_id !== null
            ? `org_${item.organization_id}`
            : '';
        const phoneKey = item.seller_phone
          ? `phone_${formatSellerPhone(item.seller_phone, item.iso_code)}`
          : '';
        const preservedManagerId =
          (orgKey && existingManagersMap.get(orgKey)) ||
          (phoneKey && existingManagersMap.get(phoneKey)) ||
          null;

        return normalizeSotkaSeller(item, {
          dbPlansMap,
          validPlanIds,
          preservedManagerId,
        });
      });

      const sellersToUpsert: Database['public']['Tables']['sellers']['Insert'][] =
        normalizedSellers.map((s) => ({
          seller_phone: s.seller_phone,
          seller_name: s.seller_name,
          store: s.store,
          plan_id: s.plan_id,
          plan_name: s.plan_name,
          balance: s.balance,
          moderation: s.moderation,
          is_active: s.is_active,
          registered_at: s.registered_at,
          last_activity: s.last_activity,
          employees_count: s.employees_count,
          outlets_count: s.outlets_count,
          brands: s.brands,
          organization_id: s.organization_id || null,
          manager_id: s.manager_id || null,
          synced_at: s.synced_at,
        }));

      // Дедупликация продавцов по organization_id / seller_phone в рамках текущего батча
      const sellersMap = new Map<string, Database['public']['Tables']['sellers']['Insert']>();
      for (const s of sellersToUpsert) {
        const key = s.organization_id || s.seller_phone;
        sellersMap.set(key, s);
      }
      const uniqueSellers = Array.from(sellersMap.values());

      // 3.2. Чанкинг вставки продавцов порциями по CHUNK_SIZE записей
      for (let i = 0; i < uniqueSellers.length; i += CHUNK_SIZE) {
        const chunk = uniqueSellers.slice(i, i + CHUNK_SIZE);
        let { error: sellersUpsertError } = await adminSupabase
          .from('sellers')
          .upsert(chunk, { onConflict: 'organization_id' });

        if (sellersUpsertError) {
          console.warn(
            '[Sotka Sync] Предупреждение upsert по organization_id, fallback на seller_phone:',
            sellersUpsertError.message
          );
          const { error: phoneErr } = await adminSupabase
            .from('sellers')
            .upsert(chunk, { onConflict: 'seller_phone' });
          sellersUpsertError = phoneErr;
        }

        if (sellersUpsertError) {
          console.error('[Sotka Sync] Ошибка upsert продавцов:', sellersUpsertError);
          throw new Error(`Ошибка сохранения продавцов: ${sellersUpsertError.message}`);
        }
      }

      syncedSellersCount += uniqueSellers.length;
      sellerOffset += items.length;

      if (sellerOffset >= total || items.length < sellerLimit) {
        hasMoreSellers = false;
      }
    }

    // 4. Выгрузка транзакций (изолирована в try/catch для предотвращения отката синхронизации продавцов)
    try {
      let txOffset = 0;
      const txLimit = 100;
      let hasMoreTx = true;

      while (hasMoreTx) {
        if (Date.now() - startTime > MAX_EXECUTION_MS) {
          warnings.push('Лимит времени Serverless (12 сек): синхронизация транзакций приостановлена.');
          break;
        }

        const { items, total } = await fetchTransactions(token, txOffset, txLimit);

        if (items.length === 0) {
          hasMoreTx = false;
          break;
        }

        const paymentsToUpsert: Database['public']['Tables']['payments']['Insert'][] = items.map((item) => {
          const rawDigits = item.user_phone ? String(item.user_phone).replace(/\D/g, '') : '';
          const normalizedPhone = rawDigits.startsWith('996')
            ? rawDigits
            : `996${rawDigits}`;

          return {
            payment_id: String(item.payment_id),
            user_phone: normalizedPhone,
            user_name: item.user_name || null,
            user_id: item.user_id ? String(item.user_id) : null,
            amount: roundMoney(item.amount),
            date_time: parseDateToISO(item.date_time) || new Date().toISOString(),
            tran_type: item.tran_type || 'topup',
            description: item.description || null,
            status: item.status || 'succeeded',
            synced_at: new Date().toISOString(),
          };
        });

        // Дедупликация платежей по payment_id в рамках текущего батча
        const paymentsMap = new Map<string, Database['public']['Tables']['payments']['Insert']>();
        for (const p of paymentsToUpsert) {
          paymentsMap.set(p.payment_id, p);
        }
        const uniquePayments = Array.from(paymentsMap.values());

        // Чанкинг вставки платежей порциями по CHUNK_SIZE
        let hasChunkError = false;
        for (let i = 0; i < uniquePayments.length; i += CHUNK_SIZE) {
          const chunk = uniquePayments.slice(i, i + CHUNK_SIZE);
          const { error: paymentsUpsertError } = await adminSupabase
            .from('payments')
            .upsert(chunk, { onConflict: 'payment_id' });

          if (paymentsUpsertError) {
            console.error('[Sotka Sync] Ошибка upsert платежей:', paymentsUpsertError);
            warnings.push(`Ошибка сохранения порции платежей: ${paymentsUpsertError.message}`);
            hasChunkError = true;
            break;
          }
        }

        if (hasChunkError) {
          break;
        }

        syncedPaymentsCount += uniquePayments.length;
        txOffset += items.length;

        if (txOffset >= total || items.length < txLimit) {
          hasMoreTx = false;
        }
      }
    } catch (txErr: any) {
      console.warn('[Sotka Sync] Выгрузка транзакций завершилась с предупреждением:', txErr?.message);
      warnings.push(`Транзакции не синхронизированы: ${txErr?.message || 'Маршрут недоступен'}`);
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
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: any) {
    console.error('[Sotka Sync] Критическая ошибка синхронизации Sotka API:', err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Неизвестная ошибка при синхронизации',
        syncedSellers: syncedSellersCount,
        sellersCount: syncedSellersCount,
        syncedPayments: syncedPaymentsCount,
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
