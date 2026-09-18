export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'admin' | 'consultant' | 'smm';
export type LeadStatus = 'Открыт' | 'Обработан' | 'Назначен' | 'Подписан' | 'Отмена';
export type ClientLifecycleStatus = 'новый' | 'подключен' | 'сопровождение' | 'готов' | 'отменен';
export type MaintenanceStatus = 'начислено' | 'выплачено' | 'отменено';
export type PayoutCategoryType = 'аванс' | 'выплата зп' | 'бонус' | 'прочие начисления' | 'удержание';
export type SellerModerationStatus = 'approved' | 'pending' | 'rejected' | 'blocked';

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          user_id: string;
          auth_id: string | null;
          login: string;
          full_name: string;
          phone: string | null;
          role: UserRole;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          user_id?: string;
          auth_id?: string | null;
          login: string;
          full_name: string;
          phone?: string | null;
          role?: UserRole;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          auth_id?: string | null;
          login?: string;
          full_name?: string;
          phone?: string | null;
          role?: UserRole;
          is_active?: boolean;
          created_at?: string;
        };
      };
      plans: {
        Row: {
          plan_id: string;
          plan_name: string;
          price: number;
          billing_period: string;
          description: string | null;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          plan_id: string;
          plan_name: string;
          price: number;
          billing_period?: string;
          description?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          plan_id?: string;
          plan_name?: string;
          price?: number;
          billing_period?: string;
          description?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      plans_history: {
        Row: {
          history_id: string;
          plan_id: string;
          plan_name: string;
          old_price: number;
          new_price: number;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: {
          history_id?: string;
          plan_id: string;
          plan_name: string;
          old_price: number;
          new_price: number;
          changed_by?: string | null;
          changed_at?: string;
        };
        Update: {
          history_id?: string;
          plan_id?: string;
          plan_name?: string;
          old_price?: number;
          new_price?: number;
          changed_by?: string | null;
          changed_at?: string;
        };
      };
      sellers: {
        Row: {
          seller_phone: string;
          seller_name: string;
          store: string;
          plan_id: string | null;
          plan_name: string;
          balance: number;
          moderation: SellerModerationStatus;
          is_active: boolean;
          registered_at: string | null;
          last_activity: string | null;
          employees_count: number;
          outlets_count: number;
          brands: string | null;
          organization_id: string | null;
          manager_id: string | null;
          synced_at: string;
        };
        Insert: {
          seller_phone: string;
          seller_name: string;
          store?: string;
          plan_id?: string | null;
          plan_name?: string;
          balance?: number;
          moderation?: SellerModerationStatus;
          is_active?: boolean;
          registered_at?: string | null;
          last_activity?: string | null;
          employees_count?: number;
          outlets_count?: number;
          brands?: string | null;
          organization_id?: string | null;
          manager_id?: string | null;
          synced_at?: string;
        };
        Update: {
          seller_phone?: string;
          seller_name?: string;
          store?: string;
          plan_id?: string | null;
          plan_name?: string;
          balance?: number;
          moderation?: SellerModerationStatus;
          is_active?: boolean;
          registered_at?: string | null;
          last_activity?: string | null;
          employees_count?: number;
          outlets_count?: number;
          brands?: string | null;
          organization_id?: string | null;
          manager_id?: string | null;
          synced_at?: string;
        };
      };
      leads: {
        Row: {
          lead_id: string;
          created_at: string;
          client_name: string;
          phone: string;
          country_code: string;
          status: LeadStatus;
          instagram: string | null;
          comment: string | null;
          created_by: string;
          assigned_to: string | null;
          seller_phone: string | null;
          linked_at: string | null;
          updated_at: string;
        };
        Insert: {
          lead_id?: string;
          created_at?: string;
          client_name: string;
          phone: string;
          country_code?: string;
          status?: LeadStatus;
          instagram?: string | null;
          comment?: string | null;
          created_by: string;
          assigned_to?: string | null;
          seller_phone?: string | null;
          linked_at?: string | null;
          updated_at?: string;
        };
        Update: {
          lead_id?: string;
          created_at?: string;
          client_name?: string;
          phone?: string;
          country_code?: string;
          status?: LeadStatus;
          instagram?: string | null;
          comment?: string | null;
          created_by?: string;
          assigned_to?: string | null;
          seller_phone?: string | null;
          linked_at?: string | null;
          updated_at?: string;
        };
      };
      payments: {
        Row: {
          payment_id: string;
          user_phone: string;
          user_id: string | null;
          user_name: string | null;
          amount: number;
          date_time: string;
          tran_type: string;
          description: string | null;
          status: string;
          synced_at: string;
        };
        Insert: {
          payment_id: string;
          user_phone: string;
          user_id?: string | null;
          user_name?: string | null;
          amount: number;
          date_time: string;
          tran_type: string;
          description?: string | null;
          status: string;
          synced_at?: string;
        };
        Update: {
          payment_id?: string;
          user_phone?: string;
          user_id?: string | null;
          user_name?: string | null;
          amount?: number;
          date_time?: string;
          tran_type?: string;
          description?: string | null;
          status?: string;
          synced_at?: string;
        };
      };
      connections: {
        Row: {
          connection_id: string;
          seller_phone: string;
          seller_name: string;
          store: string;
          manager_id: string;
          assigned_by: string;
          assigned_at: string;
          status: string;
          plan_id: string | null;
          plan_price: number;
          connection_fee_percent: number;
          connection_fee_amount: number;
          accrual_month: string;
          maintenance_months_limit: number;
          maintenance_months_accrued: number;
          client_status: ClientLifecycleStatus;
        };
        Insert: {
          connection_id?: string;
          seller_phone: string;
          seller_name: string;
          store: string;
          manager_id: string;
          assigned_by: string;
          assigned_at?: string;
          status?: string;
          plan_id?: string | null;
          plan_price?: number;
          connection_fee_percent?: number;
          connection_fee_amount?: number;
          accrual_month: string;
          maintenance_months_limit?: number;
          maintenance_months_accrued?: number;
          client_status?: ClientLifecycleStatus;
        };
        Update: {
          connection_id?: string;
          seller_phone?: string;
          seller_name?: string;
          store?: string;
          manager_id?: string;
          assigned_by?: string;
          assigned_at?: string;
          status?: string;
          plan_id?: string | null;
          plan_price?: number;
          connection_fee_percent?: number;
          connection_fee_amount?: number;
          accrual_month?: string;
          maintenance_months_limit?: number;
          maintenance_months_accrued?: number;
          client_status?: ClientLifecycleStatus;
        };
      };
      employee_rates: {
        Row: {
          rate_id: string;
          user_id: string;
          connection_percent: number;
          maintenance_percent: number;
          effective_from: string;
          created_at: string;
          created_by: string;
        };
        Insert: {
          rate_id?: string;
          user_id: string;
          connection_percent?: number;
          maintenance_percent?: number;
          effective_from: string;
          created_at?: string;
          created_by: string;
        };
        Update: {
          rate_id?: string;
          user_id?: string;
          connection_percent?: number;
          maintenance_percent?: number;
          effective_from?: string;
          created_at?: string;
          created_by?: string;
        };
      };
      client_maintenance: {
        Row: {
          maintenance_id: string;
          connection_id: string;
          accrual_month: string;
          seller_phone: string;
          manager_id: string;
          plan_id: string | null;
          plan_price: number;
          maintenance_percent: number;
          maintenance_amount: number;
          status: MaintenanceStatus;
          accrued_at: string;
          accrued_by: string | null;
        };
        Insert: {
          maintenance_id?: string;
          connection_id: string;
          accrual_month: string;
          seller_phone: string;
          manager_id: string;
          plan_id?: string | null;
          plan_price: number;
          maintenance_percent?: number;
          maintenance_amount: number;
          status?: MaintenanceStatus;
          accrued_at?: string;
          accrued_by?: string | null;
        };
        Update: {
          maintenance_id?: string;
          connection_id?: string;
          accrual_month?: string;
          seller_phone?: string;
          manager_id?: string;
          plan_id?: string | null;
          plan_price?: number;
          maintenance_percent?: number;
          maintenance_amount?: number;
          status?: MaintenanceStatus;
          accrued_at?: string;
          accrued_by?: string | null;
        };
      };
      employee_payouts: {
        Row: {
          payout_id: string;
          user_id: string;
          accrual_month: string;
          payout_date: string;
          amount: number;
          payout_category: PayoutCategoryType;
          payment_method: string;
          comment: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          payout_id?: string;
          user_id: string;
          accrual_month: string;
          payout_date?: string;
          amount: number;
          payout_category: PayoutCategoryType;
          payment_method: string;
          comment?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          payout_id?: string;
          user_id?: string;
          accrual_month?: string;
          payout_date?: string;
          amount?: number;
          payout_category?: PayoutCategoryType;
          payment_method?: string;
          comment?: string | null;
          created_by?: string;
          created_at?: string;
        };
      };
      outlets: {
        Row: {
          outlet_id: string;
          seller_phone: string;
          store_name: string;
          latitude: number;
          longitude: number;
          manager_id: string | null;
          created_at: string;
        };
        Insert: {
          outlet_id?: string;
          seller_phone: string;
          store_name: string;
          latitude: number;
          longitude: number;
          manager_id?: string | null;
          created_at?: string;
        };
        Update: {
          outlet_id?: string;
          seller_phone?: string;
          store_name?: string;
          latitude?: number;
          longitude?: number;
          manager_id?: string | null;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: UserRole;
      };
      get_current_crm_user_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
    };
    Enums: {
      user_role: UserRole;
      lead_status: LeadStatus;
      client_lifecycle_status: ClientLifecycleStatus;
      maintenance_status: MaintenanceStatus;
      payout_category_type: PayoutCategoryType;
      seller_moderation_status: SellerModerationStatus;
    };
  };
}
