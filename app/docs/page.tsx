import type { Metadata } from 'next';
import { SwaggerDocs } from '@/components/docs/SwaggerDocs';

export const metadata: Metadata = {
  title: 'API Gateway Docs | SotkaCRM',
  description: 'Интерактивная Swagger UI документация API шлюза синхронизации SotkaCRM и внешних контрактов Sotka HQ',
};

export default function DocsPage() {
  return <SwaggerDocs url="/openapi.json" />;
}
