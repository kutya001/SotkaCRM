import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SwaggerDocs } from '@/components/docs/SwaggerDocs';

export const metadata: Metadata = {
  title: 'API Gateway Docs | SotkaCRM',
  description: 'Интерактивная Swagger UI документация API шлюза синхронизации SotkaCRM и внешних контрактов Sotka HQ',
};

export default async function DocsPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  // Запрашиваем роль текущего пользователя из представления employees
  const { data: employee } = await supabase
    .from('employees')
    .select('role')
    .or(`user_id.eq.${user.id},auth_id.eq.${user.id}`)
    .maybeSingle();

  if (!employee || employee.role !== 'admin') {
    redirect('/');
  }

  return <SwaggerDocs url="/openapi.json" />;
}
