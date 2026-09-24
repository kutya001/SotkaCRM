import type { SellerModerationStatus } from '@/types/database.types';

export interface SotkaAuthResponse {
  status?: string;
  access?: string;
  access_token?: string;
  token?: string;
  role?: string;
  refresh?: string;
  detail?: {
    access?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Элемент реестра продавцов из Sotka API (GET /api/private/v1/admin/sellers-overview/)
 */
export interface SotkaSellerOverviewItem {
  organization_id: number | string;
  seller_name: string;
  seller_phone: string;
  iso_code?: string;
  store?: string;
  stores?: string[];
  moderation?: 'approved' | 'pending' | 'rejected' | 'blocked' | string;
  is_active?: boolean;
  outlets_count?: number;
  employees_count?: number;
  plans?: string[];
  brands?: string[] | string;
  balance?: number | string;
  registered_at?: string | null;
  last_activity?: string | null;
  [key: string]: any;
}

/**
 * Алиас для обратной совместимости
 */
export type SotkaSellerItem = SotkaSellerOverviewItem;

/**
 * Корневой ответ API реестра продавцов (всегда обернут в свойство detail)
 */
export interface SotkaSellersOverviewResponse {
  status?: string;
  detail: {
    items: SotkaSellerOverviewItem[];
    total: number;
    on_platform?: number;
    pending_moderation?: number;
    approved_moderation?: number;
    blocked_organizations?: number;
    total_balance?: number;
    [key: string]: any;
  };
}

/**
 * Детальная карточка продавца (GET /api/private/v1/admin/sellers-overview/{organization_id}/)
 */
export interface SotkaSellerDetail {
  contacts?: {
    name?: string;
    phone?: string;
    iso_code?: string;
    [key: string]: any;
  };
  store?: {
    name?: string;
    address?: string;
    region?: string;
    points?: number;
    employees?: number;
    moderation?: string;
    is_active?: boolean;
    [key: string]: any;
  };
  legal_data?: {
    form?: string;
    inn?: string;
    tax_address?: string;
    [key: string]: any;
  };
  platform?: {
    tariff?: string | null;
    subscription_status?: string | null;
    last_activity?: string | null;
    registered_at?: string | null;
    [key: string]: any;
  };
  brands?: string[];
  moderation_history?: Array<{
    status?: string;
    comment?: string;
    created_by?: string;
    created_at?: string;
    [key: string]: any;
  }>;
  transactions?: {
    items?: any[];
    total?: number;
    total_topups?: number;
    total_charges?: number;
    total_amount?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Ответ детальной карточки продавца
 */
export interface SotkaSellerDetailResponse {
  status?: string;
  detail: SotkaSellerDetail;
}

/**
 * Нормализованная модель продавца для CRM и Supabase
 */
export interface NormalizedSotkaSeller {
  sotka_id: string;
  external_id: string;
  organization_id: string;
  name: string;
  seller_name: string;
  phone: string;
  seller_phone: string;
  store_name: string;
  store: string;
  moderation_status: SellerModerationStatus;
  moderation: SellerModerationStatus;
  is_active: boolean;
  outlets_count: number;
  employees_count: number;
  balance: number;
  brands: string | null;
  plans: string[];
  plan_id: string | null;
  plan_name: string;
  registered_at: string | null;
  last_activity: string | null;
  manager_id?: string | null;
  synced_at: string;
}

export interface SotkaTransactionItem {
  payment_id: string | number;
  user_phone: string;
  iso_code?: string;
  user_id?: number | string;
  user_name?: string;
  amount?: number;
  date_time?: string;
  tran_type?: string;
  description?: string;
  status?: string;
  [key: string]: any;
}

export interface FetchParams {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, string | number | boolean | undefined>;
  pathParams?: Record<string, string | number>;
  token?: string;
  cache?: RequestCache;
}

export interface SyncResult {
  success: boolean;
  syncedSellers: number;
  sellersCount: number;
  syncedPayments: number;
  paymentsCount: number;
  durationMs: number;
  timestamp: string;
  error?: string;
  warnings?: string[];
}
