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
      const res = await request<any>(`/api/v1/leads/${encodeURIComponent(id)}/link-seller`, {
        method: 'DELETE',
      });
      invalidateNamespaces('leads', 'sellers', 'connections', 'dashboard', 'analytics');
      return res;
    },
    batch: async (data: {
      lead_ids: string[];
      action: 'change_status' | 'change_assigned' | 'delete';
      status?: string;
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
    syncSotka: async (offset = 0, limit = 50) => {
      const res = await request<{ synced_count: number; total_available: number; duration_ms: number }>(
        '/api/v1/sellers/sync',
        {
          method: 'POST',
          body: JSON.stringify({ offset, limit }),
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
      managerId?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      bypassCache?: boolean;
    }) =>
      request<any>(`/api/v1/connections${buildQuery(params)}`, {
        method: 'GET',
        bypassCache: params?.bypassCache,
      }),
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
    accrueAll: async (month?: string) => {
      const res = await request<{
        success: boolean;
        settlement_month: string;
        connection_bonuses_created: number;
        maintenance_bonuses_created: number;
        total_created: number;
        message: string;
      }>('/api/v1/connections/accrue-all', {
        method: 'POST',
        body: JSON.stringify({ month, settlement_month: month }),
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
};
