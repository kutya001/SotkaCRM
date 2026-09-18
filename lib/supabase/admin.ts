import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

// Сервисный клиент с правами Service Role (обход RLS)
// ИСПОЛЬЗОВАТЬ ТОЛЬКО НА СЕРВЕРЕ (Route Handlers, Server Actions)
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin credentials are not properly configured.');
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
