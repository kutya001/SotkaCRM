import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/check-role';
import { apiSuccess, handleApiError } from '@/lib/api/handler';

export async function PATCH(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json();

    // Preferences can be stored in cookie or client state
    const response = apiSuccess({
      success: true,
      preferences: {
        theme: body.theme,
        layout_wide: body.layout_wide,
      },
    });

    if (body.theme) {
      response.cookies.set('crm_theme', body.theme, { path: '/', maxAge: 60 * 60 * 24 * 365 });
    }
    if (body.layout_wide !== undefined) {
      response.cookies.set('crm_layout_width', body.layout_wide ? 'wide' : 'compact', {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
