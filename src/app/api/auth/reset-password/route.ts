import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';

/**
 * POST /api/auth/reset-password
 * Sends a password reset email to the user.
 * Rate limited to prevent abuse.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'البريد الإلكتروني مطلوب' }, { status: 400 });
    }

    // Rate limit: 2 requests per email per 5 minutes
    const limitResult = await rateLimit(`reset:${email}`, {
      limit: 2,
      windowMs: 5 * 60 * 1000,
      keyPrefix: 'auth-reset',
    });

    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const supabase = await createClient();
    // NEVER trust the Origin header for a security-critical email link — an
    // attacker controls it and could harvest the recovery code. Use a fixed
    // production origin (mirrors the previous fallback constant).
    //
    // IMPORTANT: redirect straight to /update-password, NOT /auth/callback.
    // The verify 303 lands with the session in the URL FRAGMENT
    // (#access_token=...) — fragments never reach the server, so a server
    // callback route would drop the token and bounce to /login. The browser
    // client (createBrowserClient) parses the fragment on load, which is
    // exactly what /update-password does.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://www.dokanstore.xyz/update-password',
    });

    if (error) {
      console.error('[Reset Password]', error);
      // Don't reveal if email exists or not (security)
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Reset password API error:', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
