-- 0002: drop the legacy handle_new_user_safety trigger.
-- WHY: it silently creates a default store for ANY auth user inserted
-- outside /api/auth/signup (Supabase dashboard, admin tooling, imports),
-- hijacking the deliberate 3-step onboarding (name → slug → currency/theme)
-- and minting unchosen slugs. The signup route already sets
-- user_metadata.from_api='true' to dodge it — a workaround for a trigger
-- the v3 architecture (src/app/api/auth/signup/route.ts header comment)
-- explicitly rejects. Verified live 2026-09-19: admin-created test user
-- without from_api got an instant store + bypassed onboarding entirely.
-- No real users/projects depend on it (v3 launched with 0 merchants).

DROP TRIGGER IF EXISTS on_auth_user_created_safety ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_safety();
