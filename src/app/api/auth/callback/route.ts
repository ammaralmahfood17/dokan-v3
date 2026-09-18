import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Handles Supabase email confirmation / magic-link redirects.
 * Exchanges ?code= for a session cookie, then sends the user to onboarding.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/onboarding';
  // Open-redirect guard: only allow same-origin relative paths.
  const safeNext =
    next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
      ? next
      : '/onboarding';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
