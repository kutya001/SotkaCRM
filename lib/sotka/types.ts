export interface SotkaAuthResponse {
  status?: string;
  access?: string;
  access_token?: string;
  token?: string;
  detail?: {
    access?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface SotkaSellerItem {
  seller_name?: string;
  seller_phone: string;
  iso_code?: string;
  stores?: string[];
  outlets_count?: number;
  employees_count?: number;
  plans?: string[];
  brands?: string[] | string;
  balance?: number;
  moderation?: 'approved' | 'pending' | 'rejected' | 'blocked' | string;
  is_active?: boolean;
  registered_at?: string;
  last_activity?: string;
  organization_id?: number | string;
  [key: string]: any;
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
