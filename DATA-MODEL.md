# DATA-MODEL.md — دكان (Dokan)

نموذج البيانات الحالي — **مصدر الحقيقة**: `supabase/migrations/0000_baseline_consolidated.sql` (pg_dump من القاعدة الحية، 2026-08-02). أي تغيير على الـ schema يجب أن يبدأ من هذا الملف.

## نظرة عامة

16 جدول في `public` schema، كلها مع RLS مفعّل. النمط الأساسي: **multi-tenant** — كل صف مرتبط بـ `project_id`، والعزل عبر `staff_members` (لا يُثق أبدًا بـ `project_id` من العميل — يُشتق من `auth.uid()`).

## الـ Enums

| النوع | القيم |
|---|---|
| `app_role` | `super_admin`, `owner`, `manager`, `staff` |
| `business_status` | `pending`, `active`, `suspended` |
| `notification_type` | `call_staff`, `bill_request`, `new_order`, `system` |
| `order_status` | `pending`, `preparing`, `ready`, `delivered`, `cancelled` |
| `order_type` | `dinein`, `walkin`, `drivethru` |
| `plan_interval` | `monthly`, `yearly` |
| `service_request_type` | `waiter`, `bill` |
| `subscription_status` | `trialing`, `active`, `past_due`, `cancelled` |

## الجداول والعلاقات

```
projects 1─∞ categories 1─∞ products 1─∞ product_addons
projects 1─∞ tables
projects 1─∞ staff_members ∞─1 auth.users
projects 1─∞ orders 1─∞ order_items
projects 1─∞ orders 1─∞ order_audit_logs
projects 1─∞ service_requests (table-scoped)
projects 1─∞ push_subscriptions (user-scoped)
projects 1─∞ telegram_links / telegram_link_codes
projects 1─1 daily_order_counters / order_sequences (أرقام الطلبات اليومية)
```

### `projects` — الكيانات المستأجرة (الشركات)
| عمود | النوع | ملاحظات |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| name | text NN | |
| slug | text NN UNIQUE | يُولَّد بـ `generate_basic_slug()` |
| currency | text NN | default `BHD` — BHD/KWD = 3 خانات عشرية |
| primary_color | text NN | default `#4338CA` |
| logo_url | text | |
| is_active | boolean NN | default true |
| created_at | timestamptz NN | default now() |

### `staff_members` — العضوية والأدوار (قلب الـ RLS)
| عمود | النوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| project_id | uuid NN FK→projects | |
| user_id | uuid NN FK→auth.users | |
| role | text NN | `owner`, `manager`, `staff` (check constraint) |
| created_at | timestamptz NN | |

> **الأهم أمنيًا**: سياسات `is_project_member(p_project_id)` / `is_project_owner()` تتحقق من وجود صف هنا — لا يكفي `auth.uid() = user_id`.

### `orders` — الطلبات
| عمود | النوع | ملاحظات |
|---|---|---|
| id | uuid PK | |
| project_id | uuid NN FK | |
| table_id | uuid FK→tables | nullable (walkin/drivethru) |
| type | order_type | |
| status | order_status | default pending |
| total_amount | numeric(10,3) NN | check ≥ 0 — **محمي من التعديل** عبر trigger |
| order_number | integer NN | يومي عبر `next_order_number()` |
| service_type | text | **`NULL` = طلب حقيقي** (غير waiter/bill) |
| notes / created_at | | |

> `orders_protect_amounts_trigger` يمنع تغيير `total_amount` بعد الإنشاء — التسعير دائمًا من الخادم.

### `order_items` — بنود الطلب
| عمود | النوع |
|---|---|
| id | uuid PK |
| order_id | uuid NN FK→orders |
| product_id | uuid FK→products (nullable — حذف المنتج لا يكسر السجل) |
| product_name | text NN (لقطة وقت الطلب) |
| quantity | int NN check > 0 |
| unit_price | numeric(10,3) NN check ≥ 0 |
| addons | jsonb NN default `[]` (لقطة الـ addons المختارة) |
| notes | text |
| status | text default `pending` — `pending`/`preparing`/`ready`/`delivered` |

### `categories` / `products` / `product_addons` — القائمة
- `categories`: name, name_en, sort_order, is_active
- `products`: name/name_en, description, price (numeric(10,3) NN), image_url, is_available, sort_order, category_id FK
- `product_addons`: name, price, is_available — لقطات خاصة بالمنتج

### `tables` — الطاولات
| عمود | النوع |
|---|---|
| id | uuid PK |
| project_id | uuid NN FK |
| branch_id | uuid (متروك — ميزة الفروع أُزيلت في 0041) |
| number | int NN |
| slug | text NN — مسار الـ QR `/{projectSlug}/menu/{tableSlug}` |
| qrcode | text NN — `encode(gen_random_bytes(16))` |
| is_active | boolean NN |

### `service_requests` — طلب النادل/الفاتورة
project_id + table_id NN + type (`waiter`/`bill`) + is_resolved

### `order_audit_logs` — سجل تدقيق الطلبات
order_id + project_id + event + old_status/new_status + actor_user_id + metadata jsonb — يُكتب عبر RLS على كل تغيير حالة.

### `push_subscriptions` — إشعارات الويب
project_id + user_id + endpoint/p256dh/auth (web-push) + user_agent. فريد على endpoint.

### `telegram_links` / `telegram_link_codes` — ربط تيليجرام
- `telegram_links`: project_id + chat_id + kind (`user`/`group`) + label
- `telegram_link_codes`: code + expires_at — رمز ربط مؤقت

### `rate_limits` — fallback للـ rate limiting
key PK + count + reset_at — يُستخدم عندما لا يتوفر Vercel KV (fallback الثاني بعد KV وقبل in-memory).

### `daily_order_counters` / `order_sequences` — ترقيم الطلبات اليومي
`next_order_number(p_project_id)` يستخدمها لإرجاع رقم تسلسلي يومي لكل مشروع.

## الدوال (RPCs)

| الدالة | الغرض |
|---|---|
| `next_order_number(p_project_id)` | رقم الطلب اليومي التالي — **service_role فقط** (مُسحوب من anon/authenticated) |
| `rate_limit_check(p_key, p_limit, p_window_ms)` | عدّاد rate limit — service_role فقط |
| `is_project_member(p_project_id)` | هل المستخدم عضو بالمشروع (لباقي السياسات) |
| `is_project_owner(p_project_id)` | هل المستخدم مالك |
| `is_super_admin()` | |
| `project_has_no_members(p_project_id)` | لمنع إنشاء مشروع ثانٍ للمستخدم |
| `orders_protect_amounts()` | trigger: منع تعديل total_amount |
| `handle_new_user_safety()` | trigger على auth.users: يمنع الإنشاء التلقائي لمشروع للمستخدمين القادمين من API |
| `sync_business_subscription_status()` | trigger |
| `update_updated_at()` | trigger عام |
| `generate_basic_slug(input)` | توليد slug من الاسم العربي (translate → regexp) |

## RLS — 45 سياسة

التوزيع: categories(5), products(5), product_addons(5), projects(5), staff_members(5), tables(5), orders(3), push_subscriptions(3), telegram_links(3), order_audit_logs(2), telegram_link_codes(2), order_items(1), service_requests(1).

**القواعد غير القابلة للكسر**:
1. أي سياسة على جدول فيه `project_id` **يجب** أن تتضمن `is_project_member(project_id)` أو ما يعادلها — `auth.uid() = user_id` وحده لا يكفي.
2. `next_order_number` و `rate_limit_check`: `REVOKE ALL ... FROM PUBLIC` ثم `GRANT ... TO service_role` فقط — لا يصل إليها anon/authenticated.
3. `orders.total_amount` محمي بـ trigger — الـ client لا يرسل المبلغ.

## الملاحظات

- `daily_order_counters` و `order_sequences` كلاهما موجود — `order_seq` sequence (من 0005) متروك/لقطة تاريخية، الترتيب الفعلي يتم عبر الدالة والجداول.
- `branch_id` في `tables` متروك من ميزة أُزيلت (0041) — لا تُستخدم.
- `order_items.product_id` nullable عمدًا — الحفاظ على سجل الطلب عند حذف المنتج.
