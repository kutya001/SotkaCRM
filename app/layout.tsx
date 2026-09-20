import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'SotkaCRM — Система управления продажами',
  description: 'CRM-платформа автоматизации отдела продаж и учета лидов сервиса Sotka',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SotkaCRM',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

import { cookies } from 'next/headers';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/components/auth/AuthProvider';
import type { UserRole } from '@/types/database.types';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const rawRole = cookieStore.get('crm_role')?.value;
  const initialRole =
    rawRole && ['admin', 'consultant', 'smm'].includes(rawRole)
      ? (rawRole as UserRole)
      : undefined;
  const rawName = cookieStore.get('crm_user_name')?.value;
  const initialUserName = rawName ? decodeURIComponent(rawName) : undefined;
  const initialUserLogin = cookieStore.get('crm_user_login')?.value;

  return (
    <html lang="ru" suppressHydrationWarning className={inter.variable}>
      <body suppressHydrationWarning className="font-sans antialiased selection:bg-zinc-800 selection:text-white dark:selection:bg-zinc-200 dark:selection:text-zinc-900">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider
            initialRole={initialRole}
            initialUserName={initialUserName}
            initialUserLogin={initialUserLogin}
          >
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

