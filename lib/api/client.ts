/**
 * SotkaCRM API SDK Client
 * Единый типизированный клиент для обращения к REST API v1 с поддержкой
 * In-Memory SWR-кэширования (0ms latency на cache hit) и автоматической инвалидации.
 */

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  code?: string;
  details?: any;
}

export interface RequestOptions extends RequestInit {
  bypassCache?: boolean;
  ttl?: number; // кастомный TTL в миллисекундах (по умолчанию 30 000 мс)
}

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry>();
const DEFAULT_TTL = 30_000; // 30 секунд

/**
 * Инвалидация кэша по префиксу или регулярному выражению
 */
export function invalidateCache(pattern?: string | RegExp): void {
  if (!pattern) {
    memoryCache.clear();
    return;
  }
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  for (const key of Array.from(memoryCache.keys())) {
    if (regex.test(key)) {
      memoryCache.delete(key);
    }
  }
}

function invalidateNamespaces(...namespaces: string[]): void {
  for (const ns of namespaces) {
    invalidateCache(ns);
  }
}

async function executeFetch<T>(
  endpoint: string,
  options: RequestOptions,
  cacheKey?: string
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
  let data: any = null;

  if (response.status === 204) {
    data = null;
  } else if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else if (contentType.includes('text/csv')) {
    data = await response.blob().catch(() => null);
    return data as T;
  } else {
    data = await response.text().catch(() => '');
  }

  const serverTiming = response.headers.get('Server-Timing');
  if (process.env.NODE_ENV !== 'production' && serverTiming) {
    console.debug(
      `[API SDK] ${options.method || 'GET'} ${endpoint} | Server-Timing: ${serverTiming}`
    );
  }

  if (!response.ok) {
    let errorMsg = 'Ошибка сетевого запроса';
    if (typeof data === 'object' && data !== null) {
      errorMsg = data.error || data.message || response.statusText || errorMsg;
    } else if (typeof data === 'string' && data.trim().length > 0) {
      const cleanText = data.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
      errorMsg = cleanText.length > 200 ? `${cleanText.slice(0, 200)}...` : (cleanText || response.statusText || errorMsg);
    } else {
      errorMsg = response.statusText || errorMsg;
    }

    const err = new Error(errorMsg) as Error & {
      code?: string;
      details?: any;
      status: number;
      retryAfter?: number;
    };
    err.code = (typeof data === 'object' && data?.code) ? data.code : 'HTTP_ERROR';
    err.details = typeof data === 'object' ? data?.details : data;
    err.status = response.status;
    if (response.status === 429) {
      err.retryAfter = data?.retry_after
        ? Number(data.retry_after)
        : Number(response.headers.get('Retry-After')) || 60;
    }
    throw err;
  }

  // Обновляем кэш при успешном GET
  if (cacheKey && (!options.method || options.method === 'GET')) {
    memoryCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });
  }

  return data as T;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const isGet = !options.method || options.method === 'GET';
  const isBlob = endpoint.includes('/export');
  const cacheKey = `GET:${endpoint}`;

  // SWR Кэш для GET-запросов (0ms cache hit)
  if (isGet && !isBlob && !options.bypassCache) {
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      const ttl = options.ttl ?? DEFAULT_TTL;

      if (age < ttl) {
        // Фоновая фоновая ревалидация (SWR) если прошло более 5с
        if (age > 5_000) {
          executeFetch<T>(endpoint, options, cacheKey).catch(() => {});
        }
        return cached.data as T;
      } else {
        // Данные устарели: фоновая ревалидация с отдачей stale-данных
        executeFetch<T>(endpoint, options, cacheKey).catch(() => {});
        return cached.data as T;
      }
    }
  }

  return executeFetch<T>(endpoint, options, isGet && !isBlob ? cacheKey : undefined);
}

function buildQuery(params?: Record<string, any>): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'bypassCache' || key === 'ttl') continue;
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : '';
}

export const api = {
  // Управление кэшем
  cache: {
    invalidate: (pattern?: string | RegExp) => invalidateCache(pattern),
    clear: () => memoryCache.clear(),
    get: (key: string) => memoryCache.get(key),
    get size() {
      return memoryCache.size;
    },
  },

  // 1. Авторизация
  auth: {
    login: (credentials: { login: string; password: string }) =>
      request<any>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      }),
    logout: () => {
      invalidateCache();
      return request<{ success: boolean }>('/api/v1/auth/logout', {
        method: 'POST',
      });
    },
    me: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/auth/me', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
  },

  // 1.1. Роли и доступы
  roles: {
    getAll: (options?: { bypassCache?: boolean }) =>
      request<{ items: RoleItem[]; catalog: unknown }>('/api/v1/roles', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    create: async (data: RoleInput) => {
      const res = await request<RoleItem>('/api/v1/roles', { method: 'POST', body: JSON.stringify(data) });
      invalidateNamespaces('roles', 'employees', 'auth');
      return res;
    },
    update: async (id: string, data: Partial<RoleInput>) => {
      const res = await request<RoleItem>(`/api/v1/roles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('roles', 'employees', 'auth');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deleted_id: string }>(`/api/v1/roles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      invalidateNamespaces('roles', 'employees', 'auth');
      return res;
    },
  },

  // 2. Главная панель
  dashboard: {
    getKpi: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/dashboard/kpi', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    getFunnel: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/dashboard/funnel', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    getActivity: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/dashboard/activity', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
  },

  // 3. Лиды
  leads: {
    getAll: (params?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      assigned_to?: string;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      bypassCache?: boolean;
    }) =>
      request<any>(`/api/v1/leads${buildQuery(params)}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
    getById: (id: string, options?: { bypassCache?: boolean }) =>
      request<any>(`/api/v1/leads/${encodeURIComponent(id)}`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    create: async (data: any) => {
      const res = await request<any>('/api/v1/leads', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('leads', 'dashboard', 'analytics');
      return res;
    },
    update: async (id: string, data: any) => {
      const res = await request<any>(`/api/v1/leads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('leads', 'dashboard', 'analytics');
      return res;
    },
    updateStatus: async (id: string, status: string, cancelReason?: string) => {
      const res = await request<any>(`/api/v1/leads/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, cancel_reason: cancelReason }),
      });
      invalidateNamespaces('leads', 'dashboard', 'analytics');
      return res;
    },
    updateAssigned: async (id: string, assignedTo: string | null) => {
      const res = await request<any>(`/api/v1/leads/${encodeURIComponent(id)}/assigned`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_to: assignedTo }),
      });
      invalidateNamespaces('leads', 'dashboard', 'analytics');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deleted_id: string }>(
        `/api/v1/leads/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('leads', 'dashboard', 'analytics');
      return res;
    },
    linkSeller: async (id: string, sellerPhone: string, managerId?: string) => {
      const res = await request<any>(`/api/v1/leads/${encodeURIComponent(id)}/link-seller`, {
        method: 'POST',
        body: JSON.stringify({ seller_phone: sellerPhone, manager_id: managerId }),
      });
      invalidateNamespaces('leads', 'sellers', 'connections', 'dashboard', 'analytics');
      return res;
    },
    unlinkSeller: async (id: string) => {
      const res = await request<any>(`/api/v1/leads/${encodeURIComponent(id)}/unlink-seller`, {
        method: 'POST',
      });
      invalidateNamespaces('leads', 'sellers', 'connections', 'dashboard', 'analytics');
      return res;
    },
    batch: async (data: {
      lead_ids: string[];
      action: 'change_status' | 'change_assigned' | 'delete';
      status?: string;
      cancel_reason?: string;
      assigned_to?: string | null;
    }) => {
      const res = await request<any>('/api/v1/leads/batch', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('leads', 'dashboard', 'analytics');
      return res;
    },
    getScripts: (stage?: string, options?: { bypassCache?: boolean }) =>
      request<any>(`/api/v1/leads/scripts${buildQuery({ stage })}`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    getWhatsAppLink: (id: string) =>
      request<{ phone: string; client_name: string; direct_url: string }>(
        `/api/v1/leads/${encodeURIComponent(id)}/whatsapp`,
        {
          method: 'GET',
        }
      ),
  },

  // 4. Продавцы
  sellers: {
    getAll: (params?: {
      page?: number;
      pageSize?: number;
      search?: string;
      moderation?: string;
      isActive?: string;
      managerId?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      bypassCache?: boolean;
    }) =>
      request<any>(`/api/v1/sellers${buildQuery(params)}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
    getById: (id: string, options?: { bypassCache?: boolean }) =>
      request<any>(`/api/v1/sellers/${encodeURIComponent(id)}`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    create: async (data: any) => {
      const res = await request<any>('/api/v1/sellers', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('sellers', 'dashboard', 'analytics');
      return res;
    },
    update: async (id: string, data: any) => {
      const res = await request<any>(`/api/v1/sellers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('sellers', 'dashboard', 'analytics');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deleted_id: string }>(
        `/api/v1/sellers/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('sellers', 'dashboard', 'analytics');
      return res;
    },
    batch: async (data: {
      seller_ids: string[];
      action: 'change_manager' | 'delete';
      manager_id?: string | null;
    }) => {
      const res = await request<any>('/api/v1/sellers/batch', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('sellers', 'connections', 'dashboard', 'analytics');
      return res;
    },
    /** Консультант берет свободного одобренного продавца себе (подключение ждет подтверждения) */
    /** Подключить продавца с участниками и сопровождением по месяцам (043); создающий — обязательный участник */
    connect: async (
      sellerPhoneOrId: string,
      data: { participants: string[]; maintenance?: { month_index: number; user_ids: string[] }[] }
    ) => {
      const res = await request<{
        success: boolean;
        seller_phone: string;
        connection_id?: string;
        confirmation_status?: 'pending' | 'confirmed';
        skipped?: string[];
        message?: string;
      }>(`/api/v1/sellers/${encodeURIComponent(sellerPhoneOrId)}/connect`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('sellers', 'connections', 'leads', 'payouts', 'dashboard', 'analytics');
      return res;
    },
    takeSelf: async (sellerPhoneOrId: string) => {
      const res = await request<{
        success: boolean;
        seller_phone: string;
        manager_id: string;
        connection_id?: string;
        confirmation_status?: 'pending' | 'confirmed';
        message?: string;
      }>(`/api/v1/sellers/${encodeURIComponent(sellerPhoneOrId)}/take`, {
        method: 'POST',
      });
      invalidateNamespaces('sellers', 'connections', 'dashboard', 'analytics');
      return res;
    },
    checkAvailableLeads: (options?: { bypassCache?: boolean }) =>
      request<{ has_available_leads: boolean; available_count: number }>(
        '/api/v1/sellers/available-leads-check',
        {
          method: 'GET',
          bypassCache: options?.bypassCache,
        }
      ),
    linkLead: async (sellerPhone: string, leadId: string) => {
      const res = await request<any>(`/api/v1/sellers/${encodeURIComponent(sellerPhone)}/link-lead`, {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId }),
      });
      invalidateNamespaces('sellers', 'leads', 'connections', 'dashboard', 'analytics');
      return res;
    },
    unlinkLead: async (sellerPhoneOrId: string) => {
      const res = await request<any>(`/api/v1/sellers/${encodeURIComponent(sellerPhoneOrId)}/unlink-lead`, {
        method: 'POST',
      });
      invalidateNamespaces('sellers', 'leads', 'connections', 'dashboard', 'analytics');
      return res;
    },
    getTransactions: (sellerPhoneOrId: string, options?: { bypassCache?: boolean }) =>
      request<{
        organization_id: string | number | null;
        seller_phone: string;
        transactions: {
          items: Array<{
            id?: string | number;
            date?: string;
            type?: string;
            description?: string;
            amount?: number;
            status?: string;
          }>;
          total: number;
          total_topups: number;
          total_charges: number;
          total_amount: number;
        };
        warning?: string;
      }>(`/api/v1/sellers/${encodeURIComponent(sellerPhoneOrId)}/transactions`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    /** Обновление итогов транзакций Sotka HQ (пополнения / списания) для продавцов без итогов или с устаревшими */
    refreshHqTotals: async (params?: { stale_hours?: number | null; limit?: number }) => {
      const res = await request<{ refreshed: number; queued: number; remaining: number }>('/api/v1/sellers/hq-totals', {
        method: 'POST',
        body: JSON.stringify(params || {}),
      });
      invalidateNamespaces('sellers');
      return res;
    },
    /** Без параметров синхронизирует весь реестр Sotka HQ, с limit — одну порцию */
    syncSotka: async (params?: { offset?: number; limit?: number }) => {
      const res = await request<{ synced_count: number; total_available: number; duration_ms: number }>(
        '/api/v1/sellers/sync',
        {
          method: 'POST',
          body: JSON.stringify(params || {}),
        }
      );
      invalidateNamespaces('sellers', 'dashboard', 'analytics');
      return res;
    },
  },

  // 5. Подключения
  connections: {
    getAll: (params?: {
      page?: number;
      pageSize?: number;
      search?: string;
      accrualMonth?: string;
      clientStatus?: string;
      /** pending | confirmed | rejected | all */
      confirmation?: string;
      managerId?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      bypassCache?: boolean;
    }) =>
      request<any>(`/api/v1/connections${buildQuery(params)}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
    /** Подтверждение / отклонение подключения администратором (причина обязательна при reject) */
    setConfirmation: async (id: string, action: 'confirm' | 'reject', reason?: string) => {
      const res = await request<{
        success: boolean;
        connection_id: string;
        confirmation_status: 'confirmed' | 'rejected';
        seller_phone: string;
        message?: string;
      }>(`/api/v1/connections/${encodeURIComponent(id)}/confirmation`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reason }),
      });
      invalidateNamespaces('connections', 'sellers', 'leads', 'payouts', 'profile', 'dashboard', 'analytics');
      return res;
    },
    create: async (data: any) => {
      const res = await request<any>('/api/v1/connections', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('connections', 'sellers', 'leads', 'payouts', 'dashboard', 'analytics');
      return res;
    },
    update: async (id: string, data: any) => {
      const res = await request<any>(`/api/v1/connections/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('connections', 'sellers', 'leads', 'payouts', 'dashboard', 'analytics');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deleted_id: string }>(
        `/api/v1/connections/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('connections', 'sellers', 'leads', 'payouts', 'dashboard', 'analytics');
      return res;
    },
    getById: (id: string, options?: { bypassCache?: boolean }) =>
      request<any>(`/api/v1/connections/${encodeURIComponent(id)}`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    getAccruals: (id: string, options?: { bypassCache?: boolean }) =>
      request<{ connection: any; accruals: any[] }>(`/api/v1/connections/${encodeURIComponent(id)}/accruals`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    updateAccrual: async (connectionId: string, accrualId: string, data: any) => {
      const res = await request<any>(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/accruals/${encodeURIComponent(accrualId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        }
      );
      invalidateNamespaces('connections', 'payouts', 'profile');
      return res;
    },
    deleteAccrual: async (connectionId: string, accrualId: string) => {
      const res = await request<any>(
        `/api/v1/connections/${encodeURIComponent(connectionId)}/accruals/${encodeURIComponent(accrualId)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('connections', 'payouts', 'profile');
      return res;
    },
    runBilling: async (billingMonth?: string) => {
      const res = await request<{
        success: boolean;
        billing_month: string;
        generated_accruals: number;
        message: string;
      }>('/api/v1/connections/maintenance/billing', {
        method: 'POST',
        body: JSON.stringify({ billing_month: billingMonth }),
      });
      invalidateNamespaces('connections', 'payouts', 'profile', 'dashboard', 'analytics');
      return res;
    },
    runMaintenance: async (targetMonth?: string) => {
      const res = await request<any>('/api/v1/connections/maintenance/fk', {
        method: 'POST',
        body: JSON.stringify({ target_month: targetMonth }),
      });
      invalidateNamespaces('connections', 'payouts', 'dashboard', 'analytics');
      return res;
    },
    accrueAll: async (month?: string, accrualType: 'all' | 'connection' | 'maintenance' = 'all') => {
      const res = await request<{
        success: boolean;
        settlement_month: string;
        accrual_type: string;
        connection_bonuses_created: number;
        maintenance_bonuses_created: number;
        maintenance_skipped_same_month?: number;
        total_created: number;
        message: string;
        notice?: string;
      }>('/api/v1/connections/accrue-all', {
        method: 'POST',
        body: JSON.stringify({ month, settlement_month: month, accrual_type: accrualType }),
      });
      invalidateNamespaces('connections', 'payouts', 'profile', 'dashboard', 'analytics');
      return res;
    },
    /** Сотрудники подключения (042): подключивший (с подтверждением) и сопровождение по месяцам */
    /** Сотрудники подключения (042/043): участники (первый — основной) и сопровождающие по месяцам */
    assignStaff: async (
      id: string,
      data: { participants?: string[]; maintenance?: { month_index: number; user_ids: string[] }[] }
    ) => {
      const res = await request<{
        success: boolean;
        connectionId: string;
        participantsChanged: boolean;
        managerChanged: boolean;
        confirmed: boolean;
        maintenanceUpdated: number;
        skipped: string[];
      }>(`/api/v1/connections/${encodeURIComponent(id)}/staff`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('connections', 'sellers', 'leads', 'payouts', 'profile', 'dashboard', 'analytics');
      return res;
    },
    batch: async (data: {
      action: 'update_maintenance_months' | 'accrue_selected' | 'confirm_selected' | 'assign_staff' | 'delete_selected';
      connection_ids: string[];
      payload?: {
        months_total?: number;
        maintenance_months_total?: number;
        mode?: string;
        month?: string;
        settlement_month?: string;
        participants?: string[];
        maintenance?: { month_index: number; user_ids: string[] }[];
      };
    }) => {
      const res = await request<any>('/api/v1/connections/batch', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('connections', 'payouts', 'profile', 'dashboard', 'analytics');
      return res;
    },
  },

  // 6. Выплаты
  payouts: {
    getAll: (params?: {
      page?: number;
      pageSize?: number;
      search?: string;
      accrualMonth?: string;
      category?: string;
      userId?: string;
      tab?: 'all' | 'accruals' | 'deductions' | 'payouts';
      operationType?: string;
      operationSign?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      bypassCache?: boolean;
    }) =>
      request<any>(`/api/v1/payouts${buildQuery(params)}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
    getUnpaidAccruals: (params: {
      employeeId?: string;
      settlementMonth?: string;
      bypassCache?: boolean;
    }) =>
      request<{
        employee_id: string;
        settlement_month: string | null;
        accruals: any[];
        total_unpaid_amount: number;
      }>(
        `/api/v1/payouts/unpaid-accruals${buildQuery({
          employeeId: params.employeeId,
          settlementMonth: params.settlementMonth,
        })}`,
        {
          method: 'GET',
          bypassCache: params?.bypassCache,
        }
      ),
    create: async (data: any) => {
      const res = await request<any>('/api/v1/payouts', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('payouts', 'connections', 'profile', 'dashboard', 'analytics');
      return res;
    },
    calculate: (params: { accrual_month?: string; employee_id?: string }) =>
      request<any>('/api/v1/payouts/calculate', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    getPayrollSheet: (params: { employeeId?: string; month?: string; bypassCache?: boolean }) =>
      request<any>(`/api/v1/payouts/payroll-sheet${buildQuery(params)}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
    update: async (id: string, data: any) => {
      const res = await request<any>(`/api/v1/payouts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('payouts', 'dashboard', 'analytics');
      return res;
    },
    batch: async (
      data:
        | {
            action: 'update';
            ids: string[];
            changes: {
              settlement_month?: string;
              actual_date?: string;
              payment_method?: string;
              operation_type?: string;
              note?: string | null;
            };
          }
        | { action: 'delete'; ids: string[] }
    ) => {
      const res = await request<{ success: boolean; updated?: number; deleted?: number; skipped?: number }>(
        '/api/v1/payouts/batch',
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      invalidateNamespaces('payouts', 'connections', 'profile', 'dashboard', 'analytics');
      return res;
    },
    updateStatus: async (id: string, status: string, transactionRef?: string) => {
      const res = await request<any>(`/api/v1/payouts/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, transaction_ref: transactionRef }),
      });
      invalidateNamespaces('payouts', 'dashboard', 'analytics');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deleted_id: string }>(
        `/api/v1/payouts/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('payouts', 'connections', 'profile', 'dashboard', 'analytics');
      return res;
    },
  },

  // 7. Сотрудники
  employees: {
    getAll: (params?: {
      page?: number;
      pageSize?: number;
      search?: string;
      role?: string;
      isActive?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      bypassCache?: boolean;
    }) =>
      request<any>(`/api/v1/employees${buildQuery(params)}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
    create: async (data: any) => {
      const res = await request<any>('/api/v1/employees', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('employees', 'profile', 'analytics');
      return res;
    },
    update: async (id: string, data: any) => {
      const res = await request<any>(`/api/v1/employees/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('employees', 'profile', 'analytics');
      return res;
    },
    updateColor: async (id: string, color: string) => {
      const res = await request<any>(`/api/v1/employees/${encodeURIComponent(id)}/color`, {
        method: 'PATCH',
        body: JSON.stringify({ color }),
      });
      invalidateNamespaces('employees', 'profile', 'analytics');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deactivated_id: string }>(
        `/api/v1/employees/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('employees', 'profile', 'analytics');
      return res;
    },
    /** Массовые действия: set_active (is_active), set_role (role_id) */
    batch: async (data: { action: 'set_active' | 'set_role'; ids: string[]; is_active?: boolean; role_id?: string }) => {
      const res = await request<{ success: boolean; updated: number; skipped?: string[] }>('/api/v1/employees/batch', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('employees', 'profile', 'analytics');
      return res;
    },
  },

  // 8. Тарифы
  rates: {
    getAll: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/rates', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    create: async (data: any) => {
      const res = await request<any>('/api/v1/rates', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('rates');
      return res;
    },
    update: async (id: string, data: any) => {
      const res = await request<any>(`/api/v1/rates/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('rates');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deleted_id: string }>(
        `/api/v1/rates/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('rates');
      return res;
    },
  },

  // 9. Бизнес-планы
  plans: {
    getAll: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/plans', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    create: async (data: any) => {
      const res = await request<any>('/api/v1/plans', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('plans');
      return res;
    },
    update: async (id: string, data: any) => {
      const res = await request<any>(`/api/v1/plans/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('plans');
      return res;
    },
    delete: async (id: string) => {
      const res = await request<{ success: boolean; deleted_id: string }>(
        `/api/v1/plans/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      invalidateNamespaces('plans');
      return res;
    },
    /** Массовые действия: delete, set_active (is_active) */
    batch: async (data: { action: 'delete' | 'set_active'; ids: string[]; is_active?: boolean }) => {
      const res = await request<{ success: boolean; affected: number }>('/api/v1/plans/batch', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('plans');
      return res;
    },
  },

  // 10. Аналитика
  analytics: {
    getSummary: (startDate?: string, endDate?: string, options?: { bypassCache?: boolean }) =>
      request<any>(`/api/v1/analytics/summary${buildQuery({ startDate, endDate })}`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    getFunnel: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/analytics/funnel', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    getEmployees: (options?: { bypassCache?: boolean }) =>
      request<any>('/api/v1/analytics/employees', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    exportData: async () => {
      const blob = await request<Blob>('/api/v1/analytics/export', {
        method: 'POST',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sotkacrm_export.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
  },

  // 11. Профиль
  profile: {
    get: (userId?: string, options?: { bypassCache?: boolean }) =>
      request<any>(`/api/v1/profile${buildQuery({ userId })}`, {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
    getPayrollSheet: (params?: { employeeId?: string; month?: string; bypassCache?: boolean }) =>
      request<{
        employee: {
          user_id: string;
          full_name: string;
          role: string;
          login: string;
          color?: string;
        } | null;
        employee_id: string;
        month: string;
        opening_balance: number;
        total_accrued: number;
        total_deductions: number;
        total_paid: number;
        closing_balance: number;
        accruals: any[];
        deductions: any[];
        payouts: any[];
      }>(`/api/v1/profile/payroll${buildQuery({ employeeId: params?.employeeId, month: params?.month })}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
    changePassword: async (data: { newPassword: string; targetUserId?: string }) => {
      const res = await request<any>('/api/v1/profile/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidateNamespaces('profile', 'auth/me');
      return res;
    },
    updatePreferences: async (preferences: { theme?: string; layout_wide?: boolean }) => {
      const res = await request<any>('/api/v1/profile/preferences', {
        method: 'PATCH',
        body: JSON.stringify(preferences),
      });
      invalidateNamespaces('profile', 'auth/me');
      return res;
    },
    getPermissions: (options?: { bypassCache?: boolean }) =>
      request<{
        role: string;
        is_admin: boolean;
        can_access_docs: boolean;
        can_sync_api: boolean;
        can_manage_rates: boolean;
        can_manage_plans: boolean;
        can_manage_employees: boolean;
      }>('/api/v1/profile/permissions', {
        method: 'GET',
        bypassCache: options?.bypassCache,
      }),
  },

  // 12. Telegram-уведомления
  telegram: {
    status: () =>
      request<{
        configured: boolean;
        bot_username: string | null;
        linked: boolean;
        username: string | null;
        linked_at: string | null;
        prefs: { payroll: boolean; connections: boolean; leads: boolean; tasks: boolean; broadcast: boolean };
        pending: { code: string; deep_link: string | null; expires_at: string } | null;
      }>('/api/v1/telegram', { method: 'GET', bypassCache: true }),
    createLink: () =>
      request<{
        code: string;
        bot_username: string;
        deep_link: string;
        expires_at: string;
        webhook_ok: boolean;
        webhook_reason: string | null;
      }>('/api/v1/telegram/link', { method: 'POST' }),
    unlink: () => request<{ success: boolean }>('/api/v1/telegram/link', { method: 'DELETE' }),
    updatePrefs: (prefs: Partial<{ payroll: boolean; connections: boolean; leads: boolean; tasks: boolean; broadcast: boolean }>) =>
      request<{ prefs: { payroll: boolean; connections: boolean; leads: boolean; tasks: boolean; broadcast: boolean } }>(
        '/api/v1/telegram',
        { method: 'PATCH', body: JSON.stringify({ prefs }) }
      ),
    sendTest: () => request<{ success: boolean }>('/api/v1/telegram/test', { method: 'POST' }),
    broadcastStats: () =>
      request<{ configured: boolean; total: number; by_role: Record<string, number> }>(
        '/api/v1/telegram/broadcast',
        { method: 'GET', bypassCache: true }
      ),
    broadcast: (data: { message: string; title?: string; roles?: string[] }) =>
      request<{ queued: number; sent: number; failed: number; skipped?: number; message: string }>(
        '/api/v1/telegram/broadcast',
        { method: 'POST', body: JSON.stringify(data) }
      ),
    // Модуль «Telegram» (администратор)
    adminOverview: () =>
      request<{
        configured: boolean;
        bot: { username: string; name: string } | null;
        webhook: {
          url: string | null;
          secret_configured: boolean;
          pending_updates: number;
          last_error: string | null;
          last_error_at: string | null;
        } | null;
        outbox: { total: number; pending: number; sent: number; failed: number; skipped: number };
        employees: {
          user_id: string;
          full_name: string;
          login: string;
          role: string;
          color: string | null;
          is_active: boolean;
          linked: boolean;
          username: string | null;
          linked_at: string | null;
          prefs: { payroll: boolean; connections: boolean; leads: boolean; tasks: boolean; broadcast: boolean };
          sent_count: number;
          last_sent_at: string | null;
        }[];
        linked_total: number;
      }>('/api/v1/telegram/admin/overview', { method: 'GET', bypassCache: true }),
    adminOutbox: (params: { status?: string; kind?: string; user_id?: string; limit?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.status) qs.set('status', params.status);
      if (params.kind) qs.set('kind', params.kind);
      if (params.user_id) qs.set('user_id', params.user_id);
      if (params.limit) qs.set('limit', String(params.limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request<{
        items: {
          id: string;
          user_id: string | null;
          kind: string;
          title: string;
          body: string;
          status: string;
          attempts: number;
          error: string | null;
          created_at: string;
          sent_at: string | null;
          recipient: { user_id: string; full_name: string; login: string; role: string; color: string | null } | null;
        }[];
        total: number;
      }>(`/api/v1/telegram/admin/outbox${suffix}`, { method: 'GET', bypassCache: true });
    },
    adminRetry: (id: string) =>
      request<{ success: boolean; status: string; error: string | null }>(`/api/v1/telegram/admin/outbox/${id}/retry`, {
        method: 'POST',
      }),
    /** Массовые действия над журналом сообщений: retry (повторить неотправленные), delete */
    adminOutboxBatch: (data: { action: 'retry' | 'delete'; ids: string[] }) =>
      request<{ success: boolean; affected: number; sent?: number; failed?: number }>('/api/v1/telegram/admin/outbox/batch', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    adminUnlinkUser: (userId: string) =>
      request<{ success: boolean; was_linked: boolean }>(`/api/v1/telegram/admin/users/${userId}/link`, { method: 'DELETE' }),
    adminUpdateUserPrefs: (
      userId: string,
      prefs: Partial<{ payroll: boolean; connections: boolean; leads: boolean; tasks: boolean; broadcast: boolean }>
    ) =>
      request<{ prefs: { payroll: boolean; connections: boolean; leads: boolean; tasks: boolean; broadcast: boolean } }>(
        `/api/v1/telegram/admin/users/${userId}/link`,
        { method: 'PATCH', body: JSON.stringify({ prefs }) }
      ),
    dispatchNow: () =>
      request<{ success: boolean; claimed: number; sent: number; failed: number; skipped: number; deferred: number }>(
        '/api/telegram/dispatch',
        { method: 'POST' }
      ),
  },

  // Задачи сотрудников
  tasks: {
    getAll: (params?: { status?: string; assigned_to?: string }) =>
      request<{ items: TaskItem[]; total: number }>(`/api/v1/tasks${buildQuery(params)}`, { method: 'GET', bypassCache: true }),
    create: (data: TaskInput) => {
      invalidateCache('/api/v1/tasks');
      return request<TaskItem>('/api/v1/tasks', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: Partial<TaskInput> & { status?: string; result_note?: string | null }) => {
      invalidateCache('/api/v1/tasks');
      return request<TaskItem>(`/api/v1/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      invalidateCache('/api/v1/tasks');
      return request<{ success: boolean }>(`/api/v1/tasks/${id}`, { method: 'DELETE' });
    },
    /** Массовые действия: change_status, change_assigned, delete (права проверяются по каждой задаче) */
    batch: (data: { action: 'change_status' | 'change_assigned' | 'delete'; ids: string[]; status?: string; assigned_to?: string | null }) => {
      invalidateCache('/api/v1/tasks');
      return request<{ success: boolean; affected: number; skipped: { task_id: string; reason: string }[] }>('/api/v1/tasks/batch', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },

  // Планы по подключениям
  goals: {
    getAll: (params?: { period_kind?: string; user_id?: string }) =>
      request<{ items: PlanItem[]; total: number; employees: PlanEmployee[]; today: string }>(
        `/api/v1/goals${buildQuery(params)}`,
        { method: 'GET', bypassCache: true }
      ),
    create: (data: {
      scope: 'personal' | 'team';
      user_id?: string | null;
      period_kind: string;
      period_date: string;
      target_count: number;
      note?: string | null;
    }) => request<PlanItem & { replaced: boolean }>('/api/v1/goals', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { target_count?: number; note?: string | null }) =>
      request<PlanItem>(`/api/v1/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ success: boolean }>(`/api/v1/goals/${id}`, { method: 'DELETE' }),
    /** Массовые действия: delete, set_target (target_count) */
    batch: (data: { action: 'delete' | 'set_target'; ids: string[]; target_count?: number }) =>
      request<{ success: boolean; affected: number }>('/api/v1/goals/batch', { method: 'POST', body: JSON.stringify(data) }),
  },
};

export interface TaskUserRef {
  user_id: string;
  full_name: string;
  login: string;
  role: string;
  color: string | null;
}

export interface TaskItem {
  task_id: string;
  title: string;
  description: string | null;
  status: 'Открыт' | 'Назначен' | 'Выполнен' | 'Отложен' | 'Отмена';
  priority: 'low' | 'normal' | 'high';
  assigned_to: string | null;
  created_by: string;
  due_date: string | null;
  completed_at: string | null;
  result_note: string | null;
  created_at: string;
  updated_at: string;
  assigned_user: TaskUserRef | null;
  creator: TaskUserRef | null;
  is_overdue: boolean;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  priority?: 'low' | 'normal' | 'high';
}

export interface PlanEmployee {
  user_id: string;
  full_name: string;
  login: string;
  role: string;
  color: string | null;
  is_active: boolean;
}

export interface PlanItem {
  plan_id: string;
  scope: 'personal' | 'team';
  user_id: string | null;
  period_kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_year' | 'yearly';
  period_start: string;
  period_end: string;
  target_count: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  user: PlanEmployee | null;
  actual_count: number;
  percent: number;
  remaining: number;
  progress_status: 'done' | 'active' | 'overdue' | 'upcoming';
  elapsed_share: number;
}

export interface RoleItem {
  role_id: string;
  code: string;
  name: string;
  description: string | null;
  base_role: 'admin' | 'supervisor' | 'consultant' | 'smm';
  is_system: boolean;
  is_admin: boolean;
  sort_order: number;
  permissions: string[];
  users_count: number;
}

export interface RoleInput {
  name: string;
  description?: string | null;
  base_role?: 'admin' | 'supervisor' | 'consultant' | 'smm';
  permissions?: string[];
}
