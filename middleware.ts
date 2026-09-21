import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image
     * - favicon.ico, icon.svg, sitemap.xml, robots.txt
     * - manifest.webmanifest, manifest.json
     * - static assets (.svg, .png, .jpg, .jpeg, .gif, .webp, .ico, .woff, .woff2, .css, .js)
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|manifest.json|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|css|js)$).*)',
  ],
};

