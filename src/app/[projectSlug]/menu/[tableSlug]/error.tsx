'use client';

/**
 * Public-menu error boundary (UX-report C5).
 * The storefront page had no error.tsx — any render/data throw white-screened
 * the customer's menu with zero recovery. Kept deliberately lightweight:
 * customers are not staff; no error detail dump (the dashboard variant has
 * that for admins). Retry resets the segment; home link is the escape hatch.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import * as Sentry from '@sentry/nextjs';

export default function PublicMenuError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main
      dir="rtl"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
    >
      <span style={{ fontSize: '40px' }} aria-hidden="true">
        ☕
      </span>
      <h1 style={{ fontSize: '20px', fontWeight: 700 }}>حصل خطأ غير متوقع</h1>
      <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', maxWidth: '320px' }}>
        ما قدرت أحمّل القائمة الحين — جرّب مرة ثانية، وإذا استمرت المشكلة اسأل الكاشير.
      </p>
      <button
        type="button"
        onClick={reset}
        className="btn btn-primary"
        style={{ minHeight: '44px' }}
      >
        إعادة المحاولة
      </button>
      <Link
        href="/"
        style={{ fontSize: '13px', color: 'var(--color-primary)', textDecoration: 'underline' }}
      >
        العودة للرئيسية
      </Link>
    </main>
  );
}
