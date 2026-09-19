import { createBrowserClient } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

let clientInstance: SupabaseClient<Database> | null = null;

export function createClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined' && clientInstance) {
    return clientInstance;
  }

  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ) as unknown as SupabaseClient<Database>;

  if (typeof window !== 'undefined') {
    clientInstance = client;
  }

  return client;
}
