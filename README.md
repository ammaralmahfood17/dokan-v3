# دكان (Dokan)

Multi-tenant PWA SaaS for cafés, restaurants, and food trucks in the Gulf.

**Core value:** Registration → first real order in under 7 minutes.

## Stack

- Next.js (App Router) + TypeScript (strict)
- Tailwind CSS + enterprise design tokens
- Supabase (Auth, Postgres, Realtime, RLS)
- `qrcode` for table QR generation
- Cairo font, Lucide icons
- Arabic-first RTL, mobile-first

## Features (MVP)

1. Email/password auth + session (Supabase)
2. Guided onboarding (project + branding + owner staff record)
3. Multi-tenant isolation via `projects` + `staff_members`
4. Products, categories, addons
5. Branches + tables with slug + QR
6. Public menu at `/{projectSlug}/menu/{tableSlug}`
7. Secure public order API (server-side pricing)
8. Realtime Orders + Kitchen Display + POS
9. Installable PWA

## Quick start

```bash
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL

npm install
npx supabase db push   # applies supabase/migrations/0001_dokan_schema.sql
npm run dev
```

## Definition of Done path

1. Register → redirected to `/onboarding`
2. Create store (name, slug, currency, color) → `/dashboard` checklist
3. Add product → create branch + table → view QR
4. Open `/{slug}/menu/{tableSlug}` → place order
5. Order appears on Orders + Kitchen → move status to delivered

Public writes never hit Supabase from the browser. All go through:

- `POST /api/public/order`
- `POST /api/public/waiter`
- `POST /api/public/bill`
- `POST /api/pos/order` (authenticated staff)

## Project structure

```
src/app/
  page.tsx                 Landing
  login/  register/        Auth
  onboarding/              Create project
  dashboard/               Staff app + checklist
  [projectSlug]/menu/[tableSlug]/  Public menu
  api/public/order|waiter|bill
  api/onboarding/project
  api/pos/order
  api/auth/callback

src/lib/
  types.ts  database.types.ts  utils.ts  order-pricing.ts  project.ts
  supabase/ client | server | admin | middleware

supabase/migrations/0001_dokan_schema.sql
```

## Design tokens

| Token | Value |
|-------|-------|
| Primary | `#4F46E5` |
| Background | `#F8FAFC` |
| Surface | `#FFFFFF` |
| Text | `#0F172A` / `#475569` |
| Border | `#E2E8F0` |
| Radius | 8–10px |
| Font | Cairo |
## Production Status

- Live at https://www.dokanstore.xyz (Vercel auto-deploy from `master`)
- All phases done: security hardening, tenant isolation, atomic order RPCs,
  subscription enforcement (manual cash), super-admin dashboard (audit log,
  analytics, impersonation, project create/archive/delete)
- Migrations applied via `npx supabase db push` (project:
  `smhleaeujwfebefjuwoe`) — latest is 0017; NOT squashed yet
- E2E: Playwright against production — `npx playwright test` (7 specs,
  incl. money path, POS, tenant isolation, subscription, super-admin)
- Deployment: `git push origin master` → GitHub → Vercel. No manual steps.

