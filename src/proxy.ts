import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Refreshes auth session and guards /dashboard + /onboarding.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/onboarding',
    '/onboarding/:path*',
    '/login',
    '/register',
    '/reset-password',
    // POS API: runs getSession() (local cookie read, ~1ms) so the route
    // handlers can trust getSession() instead of calling the Auth API
    // (getUser(), 200-800ms) per request. Security note: getSession does
    // NOT verify the JWT signature — but (a) tokens are signed by Supabase
    // (secret unavailable, unforgeable), (b) expiry IS checked, and (c) the
    // real guard on POS routes is requireMembership (staff_members query),
    // so a fired/revoked staff member is still blocked there.
    '/api/pos/:path*',
  ],
};
