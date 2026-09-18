import Link from 'next/link';
import {
  QrCode,
  ChefHat,
  ClipboardList,
  Store,
  Smartphone,
  Zap,
} from 'lucide-react';

// سنة الحقوق بتوقيت البحرين (خادم UTC قد يعرض 2026 بينما البحرين في 2027
// عند منتصف ليلة 31 ديسمبر — Intl مرة واحدة لا إعادة حساب في كل render)
const COPYRIGHT_YEAR = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  timeZone: 'Asia/Bahrain',
}).format(new Date());


const FEATURES = [
  {
    icon: QrCode,
    title: 'قائمة QR للطاولات',
    desc: 'كل طاولة لها رابط ورمز QR. العميل يطلب خلال ثوانٍ.',
  },
  {
    icon: ClipboardList,
    title: 'طلبات لحظية',
    desc: 'الطلبات تصل فوراً إلى لوحة الطلبات ونقطة البيع.',
  },
  {
    icon: ChefHat,
    title: 'شاشة مطبخ (KDS)',
    desc: 'شاشة مطبخ فاتحة عالية التباين، تميّز حالة كل طلب بلونها مع تنبيه صوتي للطلبات الجديدة.',
  },
  {
    icon: Smartphone,
    title: 'PWA قابل للتثبيت',
    desc: 'ثبّت التطبيق على الجوال أو التابلت بدون متجر.',
  },
  {
    icon: Store,
    title: 'متعدد الفروع',
    desc: 'إدارة الفروع والطاولات والمنتجات من مكان واحد.',
  },
  {
    icon: Zap,
    title: 'جاهز في 7 دقائق',
    desc: 'من التسجيل إلى أول طلب حقيقي في أقل من سبع دقائق.',
  },
] as const;

export default function LandingPage() {
  return (
    <div className="landing-shell min-h-dvh">
      <header className="landing-nav sticky top-0 z-[var(--z-sticky)] border-b border-white/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-bold">
              د
            </div>
            <span className="text-base font-bold">دكان</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost btn-sm">
              دخول
            </Link>
            <Link href="/register" className="btn btn-primary btn-sm">
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <p className="section-title mb-3">للمقاهي والمطاعم وعربات الطعام</p>
          <h1 className="landing-title mx-auto max-w-3xl font-extrabold text-[var(--color-text)]">
            من التسجيل إلى أول طلب
            <br />
            <span className="landing-title-accent">في أقل من 7 دقائق</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[var(--color-text-secondary)]">
            أنشئ متجرك، أضف منتجاتك، اطبع QR للطاولات، واستقبل الطلبات على
            شاشة المطبخ ونقطة البيع — بالعربية وRTL بالكامل.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className="btn btn-primary btn-lg">
              إنشاء حساب
            </Link>
            <Link href="/login" className="btn btn-secondary btn-lg">
              لدي حساب
            </Link>
          </div>
        </section>

        <section className="border-y border-white/80 bg-white/65">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="landing-feature card">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-1 text-sm font-bold">{f.title}</h3>
                  <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-text-muted)]">
        © {COPYRIGHT_YEAR} دكان — منصة طلبات للمؤسسات الصغيرة
      </footer>
    </div>
  );
}
