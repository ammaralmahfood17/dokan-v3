# ARCHITECTURE.md — دكان (Dokan)

معمارية النظام الحالية — **2026-08-02**. صفحة واحدة تُقرأ قبل أي تغيير معماري.

## المكدس

```
Next.js 16 (App Router) + React 19 + TypeScript strict
Supabase: Auth (email/password) + Postgres + RLS + Realtime
Vercel (auto-deploy من master push)
Tailwind CSS v4 (tokens في @theme داخل globals.css — لا tailwind.config)
Sentry (monitoring) · @vercel/kv (rate-limit cache) · web-push (إشعارات) · qrcode
```

## تدفق الطلب (الرئيسي)

```
زبون → QR → /{projectSlug}/menu/{tableSlug} (عام، بلا تسجيل)
     → POST /api/public/order → تسعير من الخادم (order-pricing.ts)
     → Supabase: insert orders + order_items (batch, max items)
     → Realtime → Dashboard (Orders + KDS Kitchen) → تحديث فوري
```

## طبقات الكود

```
src/
├── proxy.ts                      # Next.js Proxy (middleware) — جلسة Supabase + حماية المسارات
├── app/
│   ├── [projectSlug]/menu/[tableSlug]/   # القائمة العامة (QR)
│   ├── login|register|reset-password|update-password|onboarding
│   ├── dashboard/                # pos, orders, kitchen, products, tables, analytics, settings
│   └── api/                      # 14 route handlers (كلها server-side)
├── lib/
│   ├── supabase/                 # server.ts (async createClient) + client.ts + middleware.ts
│   ├── cache/index.ts            # CacheProvider interface (KV معزول — التبديل لـ Upstash = سطر)
│   ├── rate-limit.ts             # KV → Supabase RPC → in-memory (fallback chain)
│   ├── order-pricing.ts          # التسعير من الخادم (addons + كميات)
│   ├── push.ts / telegram.ts     # إشعارات web-push + بوت تيليجرام
│   ├── database.types.ts         # أنواع Supabase المولدة (npm run db:types)
│   └── utils.ts / types.ts / error-categories.ts
└── components/                   # ui/ + dashboard/ + pos/ (Polaris-style)
```

## الـ API Routes (14)

| المسار | الغرض | Rate-limited |
|---|---|---|
| `/api/auth/signup` | إنشاء حساب + مشروع + owner | ✅ |
| `/api/auth/callback` | OAuth callback | |
| `/api/auth/reset-password` | إعادة تعيين | ✅ |
| `/api/onboarding/project` | إعداد المشروع والعلامة | |
| `/api/pos/order` | طلب من الـ POS | ✅ |
| `/api/pos/cancel` | إلغاء طلب (الطريق الوحيد للإلغاء) | |
| `/api/public/order` | طلب من QR (عام) | ✅ |
| `/api/public/bill` | طلب الفاتورة | ✅ |
| `/api/public/waiter` | طلب النادل | ✅ |
| `/api/push/subscribe` / `unsubscribe` | إشعارات | |
| `/api/telegram/link` + `webhook` | ربط تيليجرام | |
| `/api/vitals` | web vitals beacon | |

## الـ Rate Limiting (3 طبقات)

```
1. @vercel/kv (Redis)      → shared عبر instances (KV_URL مفعّل)
2. Supabase RPC            → rate_limit_check (fallback)
3. in-memory Map           → آخر ملاذ (per-instance فقط)
```
الـ abstraction في `src/lib/cache/` — الـ providers قابلة للتبديل (KV → Upstash = تغيير سطر واحد في `getCacheProvider()`).

## الأمان (غير قابل للتفاوض)

1. **RLS على كل جدول** — العزل عبر `staff_members` + `is_project_member()`، لا `project_id` من العميل.
2. **التسعير من الخادم فقط** — `orders.total_amount` محمي بـ trigger، الـ client لا يرسل مبلغًا.
3. **Service role في الخادم فقط** — `SUPABASE_SERVICE_ROLE_KEY` لا يصل للمتصفح أبدًا.
4. **دوال حساسة مقفلة**: `next_order_number` + `rate_limit_check` → service_role فقط.
5. **Trigger أمان على auth.users** — يمنع إنشاء مشروع تلقائي للمستخدمين القادمين من API.
6. Rate limiting على كل مسارات الكتابة العامة (منع السبام).

## القرارات المعمارية الموثقة

| القرار | السبب |
|---|---|
| **عزل KV خلف interface** (2026-08-02) | تجنب vendor lock-in مع @vercel/kv — التبديل لـ Upstash لاحقًا سطر واحد |
| **سكواش 59 migration → baseline واحد** (2026-08-02) | القضاء على 59 ملف متضخم — `0000_baseline_consolidated.sql` من pg_dump حي، مُتحقق منه على قاعدة فارغة |
| **إلغاء ميزة الفروع** (0041) | تبسيط — `branch_id` متروك |
| **إلغاء الطباعة 80mm** | عملاء العربات بلا طابعات — الكود محفوظ |
| **أرقام طلبات يومية** (0039/0052) | ترقيم يعيد التصفير كل يوم لكل مشروع |
| **`service_type` NULL = طلب حقيقي** | تمييز طلبات QR/POS عن طلبات النادل/الفاتورة |

## سير العمل (للمطورين والوكلاء)

- فرع واحد: `master` — commits متسلسلة، push → Vercel auto-deploy.
- قبل الـ commit: `npx tsc --noEmit` + `npm run build` + `npm run lint`.
- أي migration جديد: `0001_...` فما فوق على الـ baseline (0000).
- للوكلاء: `AGENTS.md` هو العقد — اقرأه قبل أي تعديل.

## البيئة (Env vars)

```
NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
SUPABASE_SERVICE_ROLE_KEY          # server-only
NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   # web-push
TELEGRAM_BOT_TOKEN / USERNAME / WEBHOOK_SECRET
SENTRY_DSN / SENTRY_AUTH_TOKEN
NEXT_PUBLIC_SITE_URL
```
