/**
 * SotkaCRM API SDK Client
 * Единый типизированный клиент для обращения к REST API v1.
 */

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  code?: string;
  details?: any;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('Content-Type') || '';
  let data: any = null;

  if (contentType.includes('application/json')) {
    data = await response.json();
  } else if (contentType.includes('text/csv')) {
    data = await response.blob();
    return data as T;
  } else {
    data = await response.text();
  }

  const serverTiming = response.headers.get('Server-Timing');
  if (process.env.NODE_ENV !== 'production' && serverTiming) {
    console.debug(
      `[API SDK] ${options.method || 'GET'} ${endpoint} | Server-Timing: ${serverTiming}`
    );
  }

  if (!response.ok) {
    const errorMsg = data?.error || response.statusText || 'Ошибка сетевого запроса';
    const err = new Error(errorMsg) as Error & {
      code?: string;
      details?: any;
      status: number;
      retryAfter?: number;
    };
    err.code = data?.code || 'HTTP_ERROR';
    err.details = data?.details;
    err.status = response.status;
    if (response.status === 429) {
      err.retryAfter = data?.retry_after
        ? Number(data.retry_after)
        : Number(response.headers.get('Retry-After')) || 60;
    }
    throw err;
  }

  return data as T;
}

function buildQuery(params?: Record<string, any>): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : '';
}

export const api = {
  // 1. Авторизация
  auth: {
    login: (credentials: { login: string; password: string }) =>
      request<any>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      }),
    logout: () =>
      request<{ success: boolean }>('/api/v1/auth/logout', {
        method: 'POST',
      }),
    me: () =>
      request<any>('/api/v1/auth/me', {
        method: 'GET',
      }),
  },

  // 2. Главная панель
  dashboard: {
    getKpi: () =>
      request<any>('/api/v1/dashboard/kpi', {
        method: 'GET',
      }),
    getFunnel: () =>
      request<any>('/api/v1/dashboard/funnel', {
        method: 'GET',
      }),
    getActivity: () =>
      request<any>('/api/v1/dashboard/activity', {
        method: 'GET',
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
    }) =>
      request<any>(`/api/v1/leads${buildQuery(params)}`, {
        method: 'GET',
      }),
    getById: (id: string) =>
      request<any>(`/api/v1/leads/${encodeURIComponent(id)}`, {
        method: 'GET',
      }),
    create: (data: any) =>
      request<any>('/api/v1/leads', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<any>(`/api/v1/leads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    updateStatus: (id: string, status: string, cancelReason?: string) =>
      request<any>(`/api/v1/leads/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, cancel_reason: cancelReason }),
      }),
    updateAssigned: (id: string, assignedTo: string | null) =>
      request<any>(`/api/v1/leads/${encodeURIComponent(id)}/assigned`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_to: assignedTo }),
      }),
    delete: (id: string) =>
      request<{ success: boolean; deleted_id: string }>(
        `/api/v1/leads/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      ),
    linkSeller: (id: string, sellerPhone: string, managerId?: string) =>
      request<any>(`/api/v1/leads/${encodeURIComponent(id)}/link-seller`, {
        method: 'POST',
        body: JSON.stringify({ seller_phone: sellerPhone, manager_id: managerId }),
      }),
    unlinkSeller: (id: string) =>
      request<any>(`/api/v1/leads/${encodeURIComponent(id)}/link-seller`, {
        method: 'DELETE',
      }),
    getScripts: (stage?: string) =>
      request<any>(`/api/v1/leads/scripts${buildQuery({ stage })}`, {
        method: 'GET',
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
    }) =>
      request<any>(`/api/v1/sellers${buildQuery(params)}`, {
        method: 'GET',
      }),
    getById: (id: string) =>
      request<any>(`/api/v1/sellers/${encodeURIComponent(id)}`, {
        method: 'GET',
      }),
    create: (data: any) =>
      request<any>('/api/v1/sellers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<any>(`/api/v1/sellers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean; deleted_id: string }>(
        `/api/v1/sellers/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      ),
    checkAvailableLeads: () =>
      request<{ has_available_leads: boolean; available_count: number }>(
        '/api/v1/sellers/available-leads-check',
        {
          method: 'GET',
        }
      ),
    linkLead: (sellerPhone: string, leadId: string) =>
      request<any>(`/api/v1/sellers/${encodeURIComponent(sellerPhone)}/link-lead`, {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId }),
      }),
    syncSotka: (offset = 0, limit = 50) =>
      request<{ synced_count: number; total_available: number; duration_ms: number }>(
        '/api/v1/sellers/sync',
        {
          method: 'POST',
          body: JSON.stringify({ offset, limit }),
        }
      ),
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
    }) =>
      request<any>(`/api/v1/connections${buildQuery(params)}`, {
        method: 'GET',
      }),
    create: (data: any) =>
      request<any>('/api/v1/connections', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<any>(`/api/v1/connections/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean; deleted_id: string }>(
        `/api/v1/connections/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      ),
    runMaintenance: (targetMonth?: string) =>
      request<any>('/api/v1/connections/maintenance/fk', {
        method: 'POST',
        body: JSON.stringify({ target_month: targetMonth }),
      }),
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
    }) =>
      request<any>(`/api/v1/payouts${buildQuery(params)}`, {
        method: 'GET',
      }),
    create: (data: any) =>
      request<any>('/api/v1/payouts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    calculate: (params: { accrual_month?: string; employee_id?: string }) =>
      request<any>('/api/v1/payouts/calculate', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    update: (id: string, data: any) =>
      request<any>(`/api/v1/payouts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    updateStatus: (id: string, status: string, transactionRef?: string) =>
      request<any>(`/api/v1/payouts/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, transaction_ref: transactionRef }),
      }),
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
    }) =>
      request<any>(`/api/v1/employees${buildQuery(params)}`, {
        method: 'GET',
      }),
    create: (data: any) =>
      request<any>('/api/v1/employees', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<any>(`/api/v1/employees/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    updateColor: (id: string, color: string) =>
      request<any>(`/api/v1/employees/${encodeURIComponent(id)}/color`, {
        method: 'PATCH',
        body: JSON.stringify({ color }),
      }),
    delete: (id: string) =>
      request<{ success: boolean; deactivated_id: string }>(
        `/api/v1/employees/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      ),
  },

  // 8. Тарифы
  rates: {
    getAll: () =>
      request<any>('/api/v1/rates', {
        method: 'GET',
      }),
    create: (data: any) =>
      request<any>('/api/v1/rates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<any>(`/api/v1/rates/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean; deleted_id: string }>(
        `/api/v1/rates/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      ),
  },

  // 9. Бизнес-планы
  plans: {
    getAll: () =>
      request<any>('/api/v1/plans', {
        method: 'GET',
      }),
    create: (data: any) =>
      request<any>('/api/v1/plans', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<any>(`/api/v1/plans/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ success: boolean; deleted_id: string }>(
        `/api/v1/plans/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      ),
  },

  // 10. Аналитика
  analytics: {
    getSummary: (startDate?: string, endDate?: string) =>
      request<any>(`/api/v1/analytics/summary${buildQuery({ startDate, endDate })}`, {
        method: 'GET',
      }),
    getFunnel: () =>
      request<any>('/api/v1/analytics/funnel', {
        method: 'GET',
      }),
    getEmployees: () =>
      request<any>('/api/v1/analytics/employees', {
        method: 'GET',
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
    get: (userId?: string) =>
      request<any>(`/api/v1/profile${buildQuery({ userId })}`, {
        method: 'GET',
      }),
    changePassword: (data: { newPassword: string; targetUserId?: string }) =>
      request<any>('/api/v1/profile/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updatePreferences: (preferences: { theme?: string; layout_wide?: boolean }) =>
      request<any>('/api/v1/profile/preferences', {
        method: 'PATCH',
        body: JSON.stringify(preferences),
      }),
    getPermissions: () =>
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
      }),
  },
};
