'use client';

import * as React from 'react';
import Link from 'next/link';
import { Layers, ArrowLeft, Loader2, FileCode } from 'lucide-react';
import 'swagger-ui-dist/swagger-ui.css';
import '@/app/docs/swagger-theme.css';

interface SwaggerDocsProps {
  url?: string;
}

export function SwaggerDocs({ url = '/openapi.json' }: SwaggerDocsProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let isMounted = true;
    import('swagger-ui-dist').then(({ SwaggerUIBundle }) => {
      if (!isMounted || !containerRef.current) return;
      SwaggerUIBundle({
        url,
        domNode: containerRef.current,
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        presets: [SwaggerUIBundle.presets.apis],
      });
      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [url]);

  return (
    <div className="swagger-dark-theme min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Верхняя навигационная панель Apple Island */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl bg-zinc-950/80 border-b border-zinc-800/60 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 transition-colors text-xs font-semibold"
            title="Вернуться в панель управления CRM"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
            <span>В CRM</span>
          </Link>

          <div className="h-4 w-px bg-zinc-800 mx-1 hidden sm:block" />

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-md shadow-blue-500/20 flex-shrink-0">
              <Layers className="w-4.5 h-4.5" strokeWidth={2} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-zinc-100 tracking-tight">
                  SotkaCRM API
                </span>
                <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/30 text-[10px] font-mono font-bold">
                  OpenAPI 3.0.3
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">
                Шлюз синхронизации и контракты интеграции с Sotka HQ
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 text-xs font-medium transition-colors"
            title="Просмотреть чистый JSON спецификации"
          >
            <FileCode className="w-3.5 h-3.5 text-blue-400" strokeWidth={2} />
            <span className="hidden sm:inline">Спецификация</span>
            <span className="font-mono text-[10px] text-zinc-500">JSON</span>
          </a>
        </div>
      </header>

      {/* Основной контейнер Swagger UI */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 relative">
        {isLoading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" strokeWidth={2} />
            <span className="text-xs font-semibold text-zinc-400">
              Загрузка интерактивной документации Swagger...
            </span>
          </div>
        )}
        <div ref={containerRef} className={isLoading ? 'hidden' : 'block'} />
      </main>

      {/* Подвал */}
      <footer className="border-t border-zinc-800/60 py-4 text-center text-xs text-zinc-500">
        <span>SotkaCRM API Integration Gateway &copy; 2026</span>
      </footer>
    </div>
  );
}
