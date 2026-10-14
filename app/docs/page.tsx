import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth/check-role';
import { SwaggerDocs } from '@/components/docs/SwaggerDocs';

export const metadata: Metadata = {
  title: 'API Gateway Docs | SotkaCRM',
  description: 'Интерактивная Swagger UI документация API шлюза синхронизации SotkaCRM и внешних контрактов Sotka HQ',
};

/** Документация API доступна при праве docs.menu */
export default async function DocsPage() {
  let canAccessDocs = false;
  try {
    const ctx = await requireAuth();
    canAccessDocs = ctx.can('docs.menu');
  } catch {
    redirect('/login');
  }

  if (!canAccessDocs) {
    redirect('/');
  }

  return <SwaggerDocs url="/openapi.json" />;
}
