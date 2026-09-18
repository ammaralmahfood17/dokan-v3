import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--color-bg)] px-4 text-center">
      <h1 className="text-2xl font-bold">الصفحة غير موجودة</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">
        الرابط غير صحيح أو الصفحة نُقلت.
      </p>
      <Link href="/" className="btn btn-primary">
        العودة للرئيسية
      </Link>
    </div>
  );
}
