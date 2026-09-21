export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      client_maintenance: {
        Row: {
          accrual_month: string
          accrued_at: string
          accrued_by: string | null
          connection_id: string
          maintenance_amount: number
          maintenance_id: string
          maintenance_percent: number
          manager_id: string
          plan_id: string | null
          plan_price: number
          seller_phone: string
          status: Database["public"]["Enums"]["maintenance_status"]
        }
        Insert: {
          accrual_month: string
          accrued_at?: string
          accrued_by?: string | null
          connection_id: string
          maintenance_amount: number
          maintenance_id?: string
          maintenance_percent?: number
          manager_id: string
          plan_id?: string | null
          plan_price: number
          seller_phone: string
          status?: Database["public"]["Enums"]["maintenance_status"]
        }
        Update: {
          accrual_month?: string
          accrued_at?: string
          accrued_by?: string | null
          connection_id?: string
          maintenance_amount?: number
          maintenance_id?: string
          maintenance_percent?: number
          manager_id?: string
          plan_id?: string | null
          plan_price?: number
          seller_phone?: string
          status?: Database["public"]["Enums"]["maintenance_status"]
        }
        Relationships: [
          {
            foreignKeyName: "client_maintenance_accrued_by_fkey"
            columns: ["accrued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_maintenance_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["connection_id"]
          },
          {
            foreignKeyName: "client_maintenance_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_maintenance_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "client_maintenance_seller_phone_fkey"
            columns: ["seller_phone"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["seller_phone"]
          },
        ]
      }
      connections: {
        Row: {
          accrual_month: string
          assigned_at: string
          assigned_by: string
          client_status: Database["public"]["Enums"]["client_lifecycle_status"]
          connection_fee_amount: number
          connection_fee_percent: number
          connection_id: string
          maintenance_months_accrued: number
          maintenance_months_limit: number
          manager_id: string
          plan_id: string | null
          plan_price: number
          seller_name: string
          seller_phone: string
          status: string
          store: string
        }
        Insert: {
          accrual_month: string
          assigned_at?: string
          assigned_by: string
          client_status?: Database["public"]["Enums"]["client_lifecycle_status"]
          connection_fee_amount?: number
          connection_fee_percent?: number
          connection_id?: string
          maintenance_months_accrued?: number
          maintenance_months_limit?: number
          manager_id: string
          plan_id?: string | null
          plan_price?: number
          seller_name: string
          seller_phone: string
          status?: string
          store: string
        }
        Update: {
          accrual_month?: string
          assigned_at?: string
          assigned_by?: string
          client_status?: Database["public"]["Enums"]["client_lifecycle_status"]
          connection_fee_amount?: number
          connection_fee_percent?: number
          connection_id?: string
          maintenance_months_accrued?: number
          maintenance_months_limit?: number
          manager_id?: string
          plan_id?: string | null
          plan_price?: number
          seller_name?: string
          seller_phone?: string
          status?: string
          store?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "connections_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "connections_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "connections_seller_phone_fkey"
            columns: ["seller_phone"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["seller_phone"]
          },
        ]
      }
      employee_payouts: {
        Row: {
          accrual_month: string
          amount: number
          comment: string | null
          created_at: string
          created_by: string
          payment_method: string
          payout_category: Database["public"]["Enums"]["payout_category_type"]
          payout_date: string
          payout_id: string
          user_id: string
        }
        Insert: {
          accrual_month: string
          amount: number
          comment?: string | null
          created_at?: string
          created_by: string
          payment_method: string
          payout_category: Database["public"]["Enums"]["payout_category_type"]
          payout_date?: string
          payout_id?: string
          user_id: string
        }
        Update: {
          accrual_month?: string
          amount?: number
          comment?: string | null
          created_at?: string
          created_by?: string
          payment_method?: string
          payout_category?: Database["public"]["Enums"]["payout_category_type"]
          payout_date?: string
          payout_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_payouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_payouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      employee_rates: {
        Row: {
          connection_percent: number
          created_at: string
          created_by: string
          effective_from: string
          maintenance_percent: number
          rate_id: string
          user_id: string
        }
        Insert: {
          connection_percent?: number
          created_at?: string
          created_by: string
          effective_from: string
          maintenance_percent?: number
          rate_id?: string
          user_id: string
        }
        Update: {
          connection_percent?: number
          created_at?: string
          created_by?: string
          effective_from?: string
          maintenance_percent?: number
          rate_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_rates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          client_name: string
          comment: string | null
          country_code: string
          created_at: string
          created_by: string
          instagram: string | null
          lead_id: string
          linked_at: string | null
          phone: string
          seller_phone: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          client_name: string
          comment?: string | null
          country_code?: string
          created_at?: string
          created_by: string
          instagram?: string | null
          lead_id?: string
          linked_at?: string | null
          phone: string
          seller_phone?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          client_name?: string
          comment?: string | null
          country_code?: string
          created_at?: string
          created_by?: string
          instagram?: string | null
          lead_id?: string
          linked_at?: string | null
          phone?: string
          seller_phone?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leads_seller_phone_fkey"
            columns: ["seller_phone"]
            isOneToOne: true
            referencedRelation: "sellers"
            referencedColumns: ["seller_phone"]
          },
        ]
      }
      outlets: {
        Row: {
          created_at: string
          latitude: number
          longitude: number
          manager_id: string | null
          outlet_id: string
          seller_phone: string
          store_name: string
        }
        Insert: {
          created_at?: string
          latitude: number
          longitude: number
          manager_id?: string | null
          outlet_id?: string
          seller_phone: string
          store_name: string
        }
        Update: {
          created_at?: string
          latitude?: number
          longitude?: number
          manager_id?: string | null
          outlet_id?: string
          seller_phone?: string
          store_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlets_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "outlets_seller_phone_fkey"
            columns: ["seller_phone"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["seller_phone"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          date_time: string
          description: string | null
          payment_id: string
          status: string
          synced_at: string
          tran_type: string
          user_id: string | null
          user_name: string | null
          user_phone: string
        }
        Insert: {
          amount: number
          date_time: string
          description?: string | null
          payment_id: string
          status: string
          synced_at?: string
          tran_type: string
          user_id?: string | null
          user_name?: string | null
          user_phone: string
        }
        Update: {
          amount?: number
          date_time?: string
          description?: string | null
          payment_id?: string
          status?: string
          synced_at?: string
          tran_type?: string
          user_id?: string | null
          user_name?: string | null
          user_phone?: string
        }
        Relationships: []
      }
      plan_prices: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          plan_id: string
          price: number
          price_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          plan_id: string
          price: number
          price_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          plan_id?: string
          price?: number
          price_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      plans: {
        Row: {
          billing_period: string
          description: string | null
          is_active: boolean
          plan_id: string
          plan_name: string
          price: number
          updated_at: string
        }
        Insert: {
          billing_period?: string
          description?: string | null
          is_active?: boolean
          plan_id: string
          plan_name: string
          price: number
          updated_at?: string
        }
        Update: {
          billing_period?: string
          description?: string | null
          is_active?: boolean
          plan_id?: string
          plan_name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      plans_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          history_id: string
          new_price: number
          old_price: number
          plan_id: string
          plan_name: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          history_id?: string
          new_price: number
          old_price: number
          plan_id: string
          plan_name: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          history_id?: string
          new_price?: number
          old_price?: number
          plan_id?: string
          plan_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_history_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      sellers: {
        Row: {
          balance: number
          brands: string | null
          employees_count: number
          is_active: boolean
          last_activity: string | null
          manager_id: string | null
          moderation: Database["public"]["Enums"]["seller_moderation_status"]
          organization_id: string | null
          outlets_count: number
          plan_id: string | null
          plan_name: string
          registered_at: string | null
          seller_name: string
          seller_phone: string
          store: string
          synced_at: string
        }
        Insert: {
          balance?: number
          brands?: string | null
          employees_count?: number
          is_active?: boolean
          last_activity?: string | null
          manager_id?: string | null
          moderation?: Database["public"]["Enums"]["seller_moderation_status"]
          organization_id?: string | null
          outlets_count?: number
          plan_id?: string | null
          plan_name?: string
          registered_at?: string | null
          seller_name: string
          seller_phone: string
          store?: string
          synced_at?: string
        }
        Update: {
          balance?: number
          brands?: string | null
          employees_count?: number
          is_active?: boolean
          last_activity?: string | null
          manager_id?: string | null
          moderation?: Database["public"]["Enums"]["seller_moderation_status"]
          organization_id?: string | null
          outlets_count?: number
          plan_id?: string | null
          plan_name?: string
          registered_at?: string | null
          seller_name?: string
          seller_phone?: string
          store?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sellers_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sellers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      users: {
        Row: {
          auth_id: string | null
          color: string
          created_at: string
          full_name: string
          is_active: boolean
          login: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          auth_id?: string | null
          color?: string
          created_at?: string
          full_name: string
          is_active?: boolean
          login: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Update: {
          auth_id?: string | null
          color?: string
          created_at?: string
          full_name?: string
          is_active?: boolean
          login?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_crm_user: {
        Args: {
          p_full_name: string
          p_login: string
          p_password: string
          p_phone?: string
          p_role?: Database["public"]["Enums"]["user_role"]
        }
        Returns: string
      }
      get_analytics_summary: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_current_crm_user_id: { Args: never; Returns: string }
      get_current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_employee_rate_on_month: {
        Args: { p_month?: string; p_user_id: string }
        Returns: {
          connection_percent: number
          maintenance_percent: number
        }[]
      }
      get_leads_funnel_stats: { Args: never; Returns: Json }
      get_payouts_summary: {
        Args: { p_accrual_month?: string; p_user_id?: string }
        Returns: Json
      }
      get_plan_price_on_date: {
        Args: { p_date?: string; p_plan_id: string }
        Returns: number
      }
      get_sellers_kpi_stats: { Args: never; Returns: Json }
      get_synthetic_email: { Args: { p_login: string }; Returns: string }
      link_lead_to_seller: {
        Args: {
          p_assigned_by?: string
          p_lead_id: string
          p_manager_id?: string
          p_seller_phone: string
        }
        Returns: Json
      }
      process_employee_payout_atomic: {
        Args: {
          p_accrual_month: string
          p_amount: number
          p_comment: string
          p_created_by: string
          p_payment_method: string
          p_payout_category: Database["public"]["Enums"]["payout_category_type"]
          p_payout_date: string
          p_user_id: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      client_lifecycle_status:
        | "новый"
        | "подключен"
        | "сопровождение"
        | "готов"
        | "отменен"
      lead_status: "Открыт" | "Обработан" | "Назначен" | "Подписан" | "Отмена"
      maintenance_status: "начислено" | "выплачено" | "отменено"
      payout_category_type:
        | "аванс"
        | "выплата зп"
        | "бонус"
        | "прочие начисления"
        | "удержание"
      seller_moderation_status: "approved" | "pending" | "rejected" | "blocked"
      user_role: "admin" | "consultant" | "smm"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      client_lifecycle_status: [
        "новый",
        "подключен",
        "сопровождение",
        "готов",
        "отменен",
      ],
      lead_status: ["Открыт", "Обработан", "Назначен", "Подписан", "Отмена"],
      maintenance_status: ["начислено", "выплачено", "отменено"],
      payout_category_type: [
        "аванс",
        "выплата зп",
        "бонус",
        "прочие начисления",
        "удержание",
      ],
      seller_moderation_status: ["approved", "pending", "rejected", "blocked"],
      user_role: ["admin", "consultant", "smm"],
    },
  },
} as const

export type UserRole = Database['public']['Enums']['user_role'];
export type LeadStatus = Database['public']['Enums']['lead_status'];
export type ClientLifecycleStatus = Database['public']['Enums']['client_lifecycle_status'];
export type MaintenanceStatus = Database['public']['Enums']['maintenance_status'];
export type PayoutCategoryType = Database['public']['Enums']['payout_category_type'];
export type SellerModerationStatus = Database['public']['Enums']['seller_moderation_status'];
