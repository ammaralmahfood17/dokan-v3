
-- ============================================================================
-- 0000 — 0000_baseline_consolidated.sql
-- ============================================================================
-- ============================================================================
-- 0000_baseline_consolidated.sql — Dokan v2 consolidated baseline
-- ============================================================================
-- WHAT THIS IS
--   The single squashed migration representing the CURRENT production schema,
--   reconstructed by pg_dump of the live database (2026-08-02) — not
--   hand-assembled. Replaces the previous 0001-0059 migration chain.
--
-- USE
--   Bootstrap a brand-new environment (new Supabase project, local dev,
--   staging, CI, disaster recovery). Do NOT re-apply to the existing
--   production project — it already has this exact state; its tracking table
--   has been synced to record only this baseline (see migration-history-sync).
--
-- WHAT'S INCLUDED
--   - public schema: 20 tables, enums, sequences, indexes (58),
--     11 functions, 45 RLS policies, triggers, grants (82)
--   - handle_new_user_safety() trigger on auth.users (added manually below —
--     it lives outside the public schema so pg_dump --schema=public omits it)
--
-- GENERATED: 2026-08-02 via pg_dump --schema-only --schema=public
-- ============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4 (Ubuntu 18.4-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'Dokan SaaS - Legacy tables dropped (Phase 4 cleanup). New schema only.';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'super_admin',
    'owner',
    'manager',
    'staff'
);


--
-- Name: business_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.business_status AS ENUM (
    'pending',
    'active',
    'suspended'
);


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'call_staff',
    'bill_request',
    'new_order',
    'system'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'preparing',
    'ready',
    'delivered',
    'cancelled'
);


--
-- Name: order_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_type AS ENUM (
    'dinein',
    'walkin',
    'drivethru'
);


--
-- Name: plan_interval; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.plan_interval AS ENUM (
    'monthly',
    'yearly'
);


--
-- Name: service_request_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_request_type AS ENUM (
    'waiter',
    'bill'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'cancelled'
);


--
-- Name: generate_basic_slug(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_basic_slug(input text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
declare
  s text;
begin
  s := lower(coalesce(input, ''));
  -- very rough Arabic to latin (extend as needed)
  s := translate(s,
    'أإآاابتثجحخدذرزسشصضطظعغفقكلمنهويةىئؤء٠١٢٣٤٥٦٧٨٩',
    'aaaabtthjkhddrzsssdttaghfqklmnhwyayyuw000000000');
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := regexp_replace(s, '^-+|-+$', '', 'g');
  s := regexp_replace(s, '-{2,}', '-', 'g');
  if s = '' or s is null then
    s := 'store-' || substr(md5(random()::text), 1, 6);
  end if;
  return left(s, 48);
end;
$_$;


--
-- Name: handle_new_user_safety(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_safety() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  user_full_name text;
  base_slug text;
  final_slug text;
  new_project_id uuid;
  suffix int := 0;
begin
  -- Only act if this user has no staff_members yet (lightweight check)
  if exists (
    select 1 from public.staff_members where user_id = new.id
  ) then
    return new;
  end if;

  -- Skip if user came through our main API (set from_api=true in user_metadata)
  if new.raw_user_meta_data ? 'from_api' and new.raw_user_meta_data->>'from_api' = 'true' then
    return new;
  end if;

  -- Only create project for users created outside the API (e.g. Supabase dashboard)
  user_full_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    split_part(new.email, '@', 1),
    'متجري'
  );

  base_slug := public.generate_basic_slug(user_full_name);

  -- Ensure unique slug (lightweight loop)
  final_slug := base_slug;
  while exists (select 1 from public.projects where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  -- Create a minimal project
  insert into public.projects (name, slug, currency, primary_color, is_active)
  values (
    user_full_name,
    final_slug,
    'BHD',
    '#4338CA',
    true
  )
  returning id into new_project_id;

  -- Create owner membership
  insert into public.staff_members (project_id, user_id, role)
  values (new_project_id, new.id, 'owner');

  return new;
end;
$$;


--
-- Name: is_project_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_member(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.staff_members sm
    where sm.project_id = p_project_id and sm.user_id = auth.uid()
  );
$$;


--
-- Name: is_project_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_owner(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.staff_members sm
    where sm.project_id = p_project_id
      and sm.user_id = auth.uid()
      and sm.role = 'owner'
  );
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.super_admins where user_id = auth.uid());
$$;


--
-- Name: next_order_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_order_number(p_project_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_next integer;
begin
  insert into public.daily_order_counters (project_id, date, counter)
  values (p_project_id, current_date, 1)
  on conflict (project_id, date)
  do update set counter = daily_order_counters.counter + 1
  returning counter into v_next;

  return v_next;
end;
$$;


--
-- Name: orders_protect_amounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_protect_amounts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if old.total_amount is distinct from new.total_amount then
    raise exception 'total_amount cannot be modified after insert (%)', new.id using errcode = 'RLS001';
  end if;
  if old.order_number is distinct from new.order_number then
    raise exception 'order_number cannot be modified after insert (%)', new.id using errcode = 'RLS001';
  end if;
  return new;
end;
$$;


--
-- Name: project_has_no_members(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.project_has_no_members(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select not exists (
    select 1 from public.staff_members sm where sm.project_id = p_project_id
  );
$$;


--
-- Name: rate_limit_check(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rate_limit_check(p_key text, p_limit integer, p_window_ms integer) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count int;
  v_reset_at timestamptz;
  v_now timestamptz := now();
  v_remaining int;
  v_reset_in numeric;
begin
  select count, reset_at into v_count, v_reset_at
  from public.rate_limits
  where key = p_key;

  if v_reset_at is null or v_now > v_reset_at then
    insert into public.rate_limits (key, count, reset_at)
    values (p_key, 1, v_now + (p_window_ms || ' milliseconds')::interval)
    on conflict (key) do update
      set count = 1, reset_at = excluded.reset_at;
    return json_build_object('allowed', true, 'remaining', p_limit - 1, 'reset_in', p_window_ms);
  end if;

  if v_count >= p_limit then
    v_reset_in := extract(epoch from (v_reset_at - v_now)) * 1000;
    return json_build_object('allowed', false, 'remaining', 0, 'reset_in', v_reset_in);
  end if;

  update public.rate_limits set count = count + 1 where key = p_key;
  v_remaining := p_limit - v_count - 1;
  v_reset_in := extract(epoch from (v_reset_at - v_now)) * 1000;
  return json_build_object('allowed', true, 'remaining', v_remaining, 'reset_in', v_reset_in);
end;
$$;


--
-- Name: sync_business_subscription_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_business_subscription_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  update public.businesses
    set subscription_status = new.status
    where id = new.business_id;
  return new;
end;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    name_en text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: daily_order_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_order_counters (
    project_id uuid NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    counter integer DEFAULT 0 NOT NULL
);


--
-- Name: order_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    project_id uuid NOT NULL,
    event text NOT NULL,
    old_status text,
    new_status text,
    actor_user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_audit_logs_event_check CHECK ((event = ANY (ARRAY['created'::text, 'status_changed'::text, 'cancelled'::text])))
);


--
-- Name: TABLE order_audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.order_audit_logs IS 'Phase 3: Lightweight audit trail for orders';


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,3) NOT NULL,
    addons jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT order_items_quantity_check1 CHECK ((quantity > 0)),
    CONSTRAINT order_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'preparing'::text, 'ready'::text]))),
    CONSTRAINT order_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: order_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_seq
    START WITH 100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_sequences (
    project_id uuid NOT NULL,
    day date NOT NULL,
    last_n integer DEFAULT 0 NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    table_id uuid,
    type public.order_type DEFAULT 'dinein'::public.order_type NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    total_amount numeric(10,3) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    order_number integer DEFAULT 0 NOT NULL,
    service_type text,
    CONSTRAINT orders_service_type_check CHECK (((service_type IS NULL) OR (service_type = ANY (ARRAY['waiter'::text, 'bill'::text])))),
    CONSTRAINT orders_total_amount_check CHECK ((total_amount >= (0)::numeric))
);


--
-- Name: COLUMN orders.service_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.service_type IS 'Null = real order, ''waiter'' = call waiter, ''bill'' = request bill';


--
-- Name: product_addons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_addons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    name text NOT NULL,
    price numeric(10,3) DEFAULT 0 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    CONSTRAINT product_addons_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    category_id uuid,
    name text NOT NULL,
    name_en text,
    description text,
    price numeric(10,3) NOT NULL,
    image_url text,
    is_available boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT products_price_check1 CHECK ((price >= (0)::numeric))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    currency text DEFAULT 'BHD'::text NOT NULL,
    primary_color text DEFAULT '#4338CA'::text NOT NULL,
    logo_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    reset_at timestamp with time zone NOT NULL
);


--
-- Name: service_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    table_id uuid NOT NULL,
    type public.service_request_type NOT NULL,
    is_resolved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])))
);


--
-- Name: tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    branch_id uuid,
    number integer NOT NULL,
    slug text NOT NULL,
    qrcode text DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: telegram_link_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_link_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    code text NOT NULL,
    created_by uuid,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: telegram_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    chat_id text NOT NULL,
    kind text DEFAULT 'user'::text NOT NULL,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT telegram_links_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'group'::text])))
);


--
-- Name: categories categories_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey1 PRIMARY KEY (id);


--
-- Name: daily_order_counters daily_order_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_order_counters
    ADD CONSTRAINT daily_order_counters_pkey PRIMARY KEY (project_id, date);


--
-- Name: order_audit_logs order_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_logs
    ADD CONSTRAINT order_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey1 PRIMARY KEY (id);


--
-- Name: order_sequences order_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_sequences
    ADD CONSTRAINT order_sequences_pkey PRIMARY KEY (project_id, day);


--
-- Name: orders orders_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey1 PRIMARY KEY (id);


--
-- Name: product_addons product_addons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_addons
    ADD CONSTRAINT product_addons_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey1 PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: projects projects_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_slug_key UNIQUE (slug);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);


--
-- Name: service_requests service_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_pkey PRIMARY KEY (id);


--
-- Name: staff_members staff_members_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_members
    ADD CONSTRAINT staff_members_pkey1 PRIMARY KEY (id);


--
-- Name: staff_members staff_members_project_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_members
    ADD CONSTRAINT staff_members_project_id_user_id_key UNIQUE (project_id, user_id);


--
-- Name: tables tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_pkey PRIMARY KEY (id);


--
-- Name: telegram_link_codes telegram_link_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_code_key UNIQUE (code);


--
-- Name: telegram_link_codes telegram_link_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_pkey PRIMARY KEY (id);


--
-- Name: telegram_links telegram_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_links
    ADD CONSTRAINT telegram_links_pkey PRIMARY KEY (id);


--
-- Name: telegram_links telegram_links_project_id_chat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_links
    ADD CONSTRAINT telegram_links_project_id_chat_id_key UNIQUE (project_id, chat_id);


--
-- Name: idx_addons_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addons_product ON public.product_addons USING btree (product_id);


--
-- Name: idx_categories_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_project ON public.categories USING btree (project_id);


--
-- Name: idx_categories_project_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_project_sort ON public.categories USING btree (project_id, sort_order);


--
-- Name: idx_order_audit_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_audit_order ON public.order_audit_logs USING btree (order_id);


--
-- Name: idx_order_audit_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_audit_project_created ON public.order_audit_logs USING btree (project_id, created_at DESC);


--
-- Name: idx_orders_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_project ON public.orders USING btree (project_id);


--
-- Name: idx_orders_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_project_created ON public.orders USING btree (project_id, created_at DESC);


--
-- Name: idx_orders_project_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_project_number ON public.orders USING btree (project_id, order_number);


--
-- Name: idx_orders_project_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orders_project_number_unique ON public.orders USING btree (project_id, (((created_at AT TIME ZONE 'UTC'::text))::date), order_number) WHERE (service_type IS NULL);


--
-- Name: idx_orders_project_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_project_status ON public.orders USING btree (project_id, status) WHERE (status <> ALL (ARRAY['delivered'::public.order_status, 'cancelled'::public.order_status]));


--
-- Name: idx_orders_project_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_project_status_created ON public.orders USING btree (project_id, status, created_at DESC);


--
-- Name: INDEX idx_orders_project_status_created; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_orders_project_status_created IS 'Phase 3: Hot path for orders list + kitchen + recent orders';


--
-- Name: idx_orders_service_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_service_type ON public.orders USING btree (service_type) WHERE (service_type IS NOT NULL);


--
-- Name: idx_orders_table_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_table_created ON public.orders USING btree (project_id, table_id, created_at DESC);


--
-- Name: idx_product_addons_product_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_addons_product_available ON public.product_addons USING btree (product_id, is_available);


--
-- Name: idx_products_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_project ON public.products USING btree (project_id);


--
-- Name: idx_products_project_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_project_available ON public.products USING btree (project_id, is_available);


--
-- Name: idx_products_project_category_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_project_category_available ON public.products USING btree (project_id, category_id, is_available);


--
-- Name: INDEX idx_products_project_category_available; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_products_project_category_available IS 'Phase 3: Menu rendering + product filtering';


--
-- Name: idx_projects_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_slug ON public.projects USING btree (slug);


--
-- Name: idx_push_sub_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_sub_project ON public.push_subscriptions USING btree (project_id);


--
-- Name: idx_push_subscriptions_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_project_id ON public.push_subscriptions USING btree (project_id);


--
-- Name: idx_service_requests_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_requests_open ON public.service_requests USING btree (project_id, is_resolved, created_at DESC);


--
-- Name: idx_staff_members_project_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_members_project_user ON public.staff_members USING btree (project_id, user_id);


--
-- Name: idx_staff_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_members_user_id ON public.staff_members USING btree (user_id);


--
-- Name: idx_staff_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_project ON public.staff_members USING btree (project_id);


--
-- Name: idx_tables_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tables_branch ON public.tables USING btree (branch_id);


--
-- Name: idx_tables_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tables_project ON public.tables USING btree (project_id);


--
-- Name: idx_telegram_link_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telegram_link_codes_code ON public.telegram_link_codes USING btree (code);


--
-- Name: idx_telegram_links_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telegram_links_project ON public.telegram_links USING btree (project_id);


--
-- Name: order_items_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_status_idx ON public.order_items USING btree (status);


--
-- Name: tables_project_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tables_project_number_unique ON public.tables USING btree (project_id, number);


--
-- Name: tables_project_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tables_project_slug_unique ON public.tables USING btree (project_id, slug);


--
-- Name: orders orders_protect_amounts_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_protect_amounts_trigger BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_protect_amounts();


--
-- Name: categories categories_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: daily_order_counters daily_order_counters_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_order_counters
    ADD CONSTRAINT daily_order_counters_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: order_audit_logs order_audit_logs_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_logs
    ADD CONSTRAINT order_audit_logs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_audit_logs order_audit_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_audit_logs
    ADD CONSTRAINT order_audit_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey1 FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey1 FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_sequences order_sequences_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_sequences
    ADD CONSTRAINT order_sequences_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: orders orders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: orders orders_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE SET NULL;


--
-- Name: product_addons product_addons_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_addons
    ADD CONSTRAINT product_addons_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey1 FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: products products_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: service_requests service_requests_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: service_requests service_requests_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE CASCADE;


--
-- Name: staff_members staff_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_members
    ADD CONSTRAINT staff_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: staff_members staff_members_user_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_members
    ADD CONSTRAINT staff_members_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: tables tables_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: telegram_link_codes telegram_link_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: telegram_link_codes telegram_link_codes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: telegram_links telegram_links_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_links
    ADD CONSTRAINT telegram_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: product_addons addons_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY addons_delete ON public.product_addons FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_addons.product_id) AND public.is_project_member(p.project_id)))));


--
-- Name: product_addons addons_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY addons_insert ON public.product_addons FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_addons.product_id) AND public.is_project_member(p.project_id)))));


--
-- Name: product_addons addons_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY addons_member_read ON public.product_addons FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_addons.product_id) AND public.is_project_member(p.project_id)))));


--
-- Name: product_addons addons_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY addons_public_read ON public.product_addons FOR SELECT TO anon USING (((is_available = true) AND (EXISTS ( SELECT 1
   FROM (public.products p
     JOIN public.projects pr ON ((pr.id = p.project_id)))
  WHERE ((p.id = product_addons.product_id) AND (pr.is_active = true))))));


--
-- Name: product_addons addons_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY addons_update ON public.product_addons FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_addons.product_id) AND public.is_project_member(p.project_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_addons.product_id) AND public.is_project_member(p.project_id)))));


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_delete ON public.categories FOR DELETE TO authenticated USING (public.is_project_member(project_id));


--
-- Name: categories categories_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_insert ON public.categories FOR INSERT TO authenticated WITH CHECK (public.is_project_member(project_id));


--
-- Name: categories categories_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_member_read ON public.categories FOR SELECT TO authenticated USING (public.is_project_member(project_id));


--
-- Name: categories categories_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_public_read ON public.categories FOR SELECT TO anon USING (((is_active = true) AND (EXISTS ( SELECT 1
   FROM public.projects pr
  WHERE ((pr.id = categories.project_id) AND (pr.is_active = true))))));


--
-- Name: categories categories_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_update ON public.categories FOR UPDATE TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: daily_order_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_order_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: order_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: order_audit_logs order_audit_logs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_audit_logs_insert ON public.order_audit_logs FOR INSERT WITH CHECK (public.is_project_member(project_id));


--
-- Name: order_audit_logs order_audit_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_audit_logs_select ON public.order_audit_logs FOR SELECT USING (public.is_project_member(project_id));


--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items order_items_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_staff_all ON public.order_items USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND public.is_project_member(o.project_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND public.is_project_member(o.project_id)))));


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_staff_insert ON public.orders FOR INSERT WITH CHECK (public.is_project_member(project_id));


--
-- Name: orders orders_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_staff_select ON public.orders FOR SELECT USING (public.is_project_member(project_id));


--
-- Name: orders orders_staff_update_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_staff_update_status ON public.orders FOR UPDATE USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: product_addons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_addons ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: products products_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_delete ON public.products FOR DELETE TO authenticated USING (public.is_project_member(project_id));


--
-- Name: products products_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_insert ON public.products FOR INSERT TO authenticated WITH CHECK (public.is_project_member(project_id));


--
-- Name: products products_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_member_read ON public.products FOR SELECT TO authenticated USING (public.is_project_member(project_id));


--
-- Name: products products_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_public_read ON public.products FOR SELECT TO anon USING (((is_available = true) AND (EXISTS ( SELECT 1
   FROM public.projects pr
  WHERE ((pr.id = products.project_id) AND (pr.is_active = true))))));


--
-- Name: products products_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_update ON public.products FOR UPDATE TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: projects projects_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_delete_owner ON public.projects FOR DELETE USING (public.is_project_owner(id));


--
-- Name: projects projects_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_insert_authenticated ON public.projects FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: projects projects_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_member_read ON public.projects FOR SELECT TO authenticated USING (public.is_project_member(id));


--
-- Name: projects projects_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_public_read ON public.projects FOR SELECT TO anon USING ((is_active = true));


--
-- Name: projects projects_update_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_update_member ON public.projects FOR UPDATE USING (public.is_project_member(id));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_delete ON public.push_subscriptions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: push_subscriptions push_subscriptions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_insert ON public.push_subscriptions FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM public.staff_members sm
  WHERE ((sm.user_id = auth.uid()) AND (sm.project_id = push_subscriptions.project_id))))));


--
-- Name: push_subscriptions push_subscriptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_select ON public.push_subscriptions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: service_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: service_requests service_requests_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_requests_staff ON public.service_requests USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: staff_members staff_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_delete_owner ON public.staff_members FOR DELETE USING (public.is_project_owner(project_id));


--
-- Name: staff_members staff_insert_by_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_by_owner ON public.staff_members FOR INSERT TO authenticated WITH CHECK ((public.is_project_owner(project_id) AND (role = ANY (ARRAY['manager'::text, 'staff'::text]))));


--
-- Name: staff_members staff_insert_first_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_insert_first_owner ON public.staff_members FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (role = 'owner'::text) AND public.project_has_no_members(project_id)));


--
-- Name: POLICY staff_insert_first_owner ON staff_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY staff_insert_first_owner ON public.staff_members IS 'Only first owner of an empty project may self-insert';


--
-- Name: staff_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_members staff_select_own_or_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_select_own_or_owner ON public.staff_members FOR SELECT USING (((user_id = auth.uid()) OR public.is_project_owner(project_id)));


--
-- Name: staff_members staff_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_update_owner ON public.staff_members FOR UPDATE USING (public.is_project_owner(project_id));


--
-- Name: tables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;

--
-- Name: tables tables_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tables_delete ON public.tables FOR DELETE TO authenticated USING (public.is_project_member(project_id));


--
-- Name: tables tables_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tables_insert ON public.tables FOR INSERT TO authenticated WITH CHECK (public.is_project_member(project_id));


--
-- Name: tables tables_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tables_member_read ON public.tables FOR SELECT TO authenticated USING (public.is_project_member(project_id));


--
-- Name: tables tables_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tables_public_read ON public.tables FOR SELECT TO anon USING (((is_active = true) AND (EXISTS ( SELECT 1
   FROM public.projects pr
  WHERE ((pr.id = tables.project_id) AND (pr.is_active = true))))));


--
-- Name: tables tables_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tables_update ON public.tables FOR UPDATE TO authenticated USING (public.is_project_member(project_id)) WITH CHECK (public.is_project_member(project_id));


--
-- Name: telegram_link_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_link_codes telegram_link_codes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telegram_link_codes_insert ON public.telegram_link_codes FOR INSERT WITH CHECK (public.is_project_member(project_id));


--
-- Name: telegram_link_codes telegram_link_codes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telegram_link_codes_select ON public.telegram_link_codes FOR SELECT USING (public.is_project_member(project_id));


--
-- Name: telegram_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_links telegram_links_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telegram_links_delete ON public.telegram_links FOR DELETE USING (public.is_project_member(project_id));


--
-- Name: telegram_links telegram_links_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telegram_links_insert ON public.telegram_links FOR INSERT WITH CHECK (public.is_project_member(project_id));


--
-- Name: telegram_links telegram_links_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telegram_links_select ON public.telegram_links FOR SELECT USING (public.is_project_member(project_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION generate_basic_slug(input text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_basic_slug(input text) TO anon;
GRANT ALL ON FUNCTION public.generate_basic_slug(input text) TO authenticated;
GRANT ALL ON FUNCTION public.generate_basic_slug(input text) TO service_role;


--
-- Name: FUNCTION handle_new_user_safety(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user_safety() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user_safety() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user_safety() TO service_role;


--
-- Name: FUNCTION is_project_member(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_project_member(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_member(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_member(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION is_project_owner(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_project_owner(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_owner(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_owner(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_super_admin() TO anon;
GRANT ALL ON FUNCTION public.is_super_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_super_admin() TO service_role;


--
-- Name: FUNCTION next_order_number(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.next_order_number(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.next_order_number(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION orders_protect_amounts(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.orders_protect_amounts() TO anon;
GRANT ALL ON FUNCTION public.orders_protect_amounts() TO authenticated;
GRANT ALL ON FUNCTION public.orders_protect_amounts() TO service_role;


--
-- Name: FUNCTION project_has_no_members(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.project_has_no_members(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.project_has_no_members(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.project_has_no_members(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION rate_limit_check(p_key text, p_limit integer, p_window_ms integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rate_limit_check(p_key text, p_limit integer, p_window_ms integer) TO service_role;


--
-- Name: FUNCTION sync_business_subscription_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_business_subscription_status() TO anon;
GRANT ALL ON FUNCTION public.sync_business_subscription_status() TO authenticated;
GRANT ALL ON FUNCTION public.sync_business_subscription_status() TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.categories TO anon;
GRANT ALL ON TABLE public.categories TO authenticated;
GRANT ALL ON TABLE public.categories TO service_role;


--
-- Name: TABLE daily_order_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.daily_order_counters TO service_role;


--
-- Name: TABLE order_audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_audit_logs TO anon;
GRANT ALL ON TABLE public.order_audit_logs TO authenticated;
GRANT ALL ON TABLE public.order_audit_logs TO service_role;


--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_items TO anon;
GRANT ALL ON TABLE public.order_items TO authenticated;
GRANT ALL ON TABLE public.order_items TO service_role;


--
-- Name: SEQUENCE order_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.order_seq TO anon;
GRANT ALL ON SEQUENCE public.order_seq TO authenticated;
GRANT ALL ON SEQUENCE public.order_seq TO service_role;


--
-- Name: TABLE order_sequences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_sequences TO anon;
GRANT ALL ON TABLE public.order_sequences TO authenticated;
GRANT ALL ON TABLE public.order_sequences TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: TABLE product_addons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_addons TO anon;
GRANT ALL ON TABLE public.product_addons TO authenticated;
GRANT ALL ON TABLE public.product_addons TO service_role;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limits TO anon;
GRANT ALL ON TABLE public.rate_limits TO authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;


--
-- Name: TABLE service_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.service_requests TO anon;
GRANT ALL ON TABLE public.service_requests TO authenticated;
GRANT ALL ON TABLE public.service_requests TO service_role;


--
-- Name: TABLE staff_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_members TO anon;
GRANT ALL ON TABLE public.staff_members TO authenticated;
GRANT ALL ON TABLE public.staff_members TO service_role;


--
-- Name: TABLE tables; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tables TO anon;
GRANT ALL ON TABLE public.tables TO authenticated;
GRANT ALL ON TABLE public.tables TO service_role;


--
-- Name: TABLE telegram_link_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telegram_link_codes TO anon;
GRANT ALL ON TABLE public.telegram_link_codes TO authenticated;
GRANT ALL ON TABLE public.telegram_link_codes TO service_role;


--
-- Name: TABLE telegram_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telegram_links TO anon;
GRANT ALL ON TABLE public.telegram_links TO authenticated;
GRANT ALL ON TABLE public.telegram_links TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--



-- ============================================================================
-- Extensions the app depends on (pg_dump --schema=public omits these because
-- they're database-level objects, not public-schema objects — restored here
-- to match the live database exactly. unaccent was created by original
-- migration 0020_clean_business_slugs.)
-- ============================================================================
create extension if not exists unaccent with schema public;

-- ============================================================================
-- Trigger on auth.users (outside public schema — added manually)
-- Prevents auto-provisioning a project for API-created users; skips users
-- who already have staff_members. See original 0037/0038 migrations.
-- ============================================================================
CREATE TRIGGER on_auth_user_created_safety AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_safety();

-- ============================================================================
-- 0001 — 0001_security_hardening.sql
-- ============================================================================
-- ============================================================================
-- 0001_security_hardening.sql
-- Audit remediation (2026-08-03) — applies on top of 0000_baseline_consolidated.
--
-- 1.  CRITICAL: order_sequences was the ONLY table (of 16) with no RLS and
--     `GRANT ALL ... TO anon` — anonymous DML on a live counter table.
--     The table is dead (nothing in src/ references it; next_order_number uses
--     daily_order_counters) — hardening it is zero-cost either way.
-- 2.  CRITICAL-family: anon no longer needs INSERT/UPDATE/DELETE on ANY table.
--     The public menu (server-side anon) only SELECTs products/categories/
--     product_addons/tables/projects. Everything else goes through the
--     service_role admin client. Strip the blanket `GRANT ALL TO anon`.
-- 3.  project_has_no_members() granted to anon → account-takeover vector on
--     abandoned projects (anon could insert themselves as first owner).
-- 4.  tables_public_read exposes `qrcode` (the table's scan token) to anon —
--     revoke column-level SELECT on qrcode.
-- 5.  projects_update_member has USING but no WITH CHECK → a member could
--     change the project_id column (or any column) to a row they don't belong
--     to. Add a WITH CHECK that mirrors the USING.
-- 6.  is_super_admin()/sync_business_subscription_status() reference
--     super_admins/businesses which do not exist in this schema (baseline is
--     not a faithful copy of legacy prod). Create the minimal super_admins
--     table and make the trigger function a safe no-op when businesses is
--     absent (it is not used by the app).
-- 7.  GRANT hygiene: REVOKE ALL ON TABLE ... FROM anon for every table that
--     the public menu does not need; also revoke EXECUTE on internal trigger
--     helpers from anon/authenticated (they were only ever called by the
--     trigger, which runs as the table owner).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. order_sequences — enable RLS, strip anon/authenticated entirely.
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_sequences FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_sequences FROM anon;
REVOKE ALL ON TABLE public.order_sequences FROM authenticated;
-- service_role keeps its grants (it manages counters when needed).

-- ---------------------------------------------------------------------------
-- 2. Strip anon DML from every table; keep only the SELECTs the public menu
--    server-render path needs.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.categories FROM anon;
REVOKE ALL ON TABLE public.order_audit_logs FROM anon;
REVOKE ALL ON TABLE public.orders FROM anon;
REVOKE ALL ON TABLE public.order_items FROM anon;
REVOKE ALL ON TABLE public.products FROM anon;
REVOKE ALL ON TABLE public.product_addons FROM anon;
REVOKE ALL ON TABLE public.projects FROM anon;
REVOKE ALL ON TABLE public.staff_members FROM anon;
REVOKE ALL ON TABLE public.tables FROM anon;
REVOKE ALL ON TABLE public.rate_limits FROM anon;
REVOKE ALL ON TABLE public.daily_order_counters FROM anon;

-- Public menu reads (server component, anon role):
GRANT SELECT ON TABLE public.projects TO anon;
-- tables: column-level SELECT only — qrcode (the table's scan token) must
-- stay hidden from anon. Table-level grants would override the column revoke.
GRANT SELECT (id, number, slug, is_active, project_id) ON TABLE public.tables TO anon;
GRANT SELECT ON TABLE public.categories TO anon;
GRANT SELECT ON TABLE public.products TO anon;
GRANT SELECT ON TABLE public.product_addons TO anon;

-- ---------------------------------------------------------------------------
-- 3. project_has_no_members — anon must NOT be able to claim abandoned
--    projects (staff_insert_first_owner checks it with the caller's role;
--    anon callers would bypass the owner-role requirement).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.project_has_no_members(uuid) FROM anon;
-- keep authenticated + service_role grants (first-owner onboarding is an
-- authenticated flow).

-- ---------------------------------------------------------------------------
-- 4. tables_public_read — hide the qrcode scan token from anon.
-- ---------------------------------------------------------------------------
REVOKE SELECT (qrcode) ON TABLE public.tables FROM anon;

-- ---------------------------------------------------------------------------
-- 5. projects_update_member — WITH CHECK must match USING so a member cannot
--    reparent a project row out of their membership.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS projects_update_member ON public.projects;
CREATE POLICY projects_update_member ON public.projects
  FOR UPDATE
  USING (public.is_project_member(id))
  WITH CHECK (public.is_project_member(id));

-- ---------------------------------------------------------------------------
-- 6. Minimal super_admins + safe subscription-sync trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The legacy sync trigger referenced a `businesses` table that does not
-- exist here; make it a harmless no-op when the table is absent instead of
-- erroring on every staff INSERT.
CREATE OR REPLACE FUNCTION public.sync_business_subscription_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.businesses') IS NOT NULL THEN
    UPDATE public.businesses
       SET subscription_status = 'active'
     WHERE owner_user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Internal trigger helpers — revoke direct EXECUTE from anon/authenticated.
--    (Triggers run as the table owner; roles never call these directly.)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user_safety() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user_safety() FROM authenticated;
REVOKE ALL ON FUNCTION public.orders_protect_amounts() FROM anon;
REVOKE ALL ON FUNCTION public.orders_protect_amounts() FROM authenticated;
REVOKE ALL ON FUNCTION public.sync_business_subscription_status() FROM anon;
REVOKE ALL ON FUNCTION public.sync_business_subscription_status() FROM authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM authenticated;
REVOKE ALL ON FUNCTION public.generate_basic_slug(text) FROM anon;
REVOKE ALL ON FUNCTION public.generate_basic_slug(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.is_project_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_project_owner(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM anon;
-- is_super_admin stays callable by authenticated (admin UI checks it).

-- ============================================================================
-- 0002 — 0002_public_grant_revokes.sql
-- ============================================================================
-- ============================================================================
-- 0002_public_grant_revokes.sql
-- Follow-up to 0001: live prod used `=X` (PUBLIC) grants on functions —
-- NOT the `TO anon` form the squashed baseline showed — so `REVOKE ... FROM
-- anon` in 0001 removed nothing for those. This migration revokes the
-- PUBLIC grants and re-grants EXECUTE only to the roles that legitimately
-- call each function:
--   * is_project_member / is_project_owner / project_has_no_members are
--     invoked INSIDE RLS policy expressions for the authenticated role →
--     authenticated must keep EXECUTE (policies evaluate with the caller's
--     privileges, so removing it would break every authenticated query).
--   * anon never evaluates them (no anon policy calls them) → revoked.
--   * is_super_admin is used by the admin dashboard (authenticated).
--   * Trigger helpers (handle_new_user_safety, orders_protect_amounts,
--     sync_business_subscription_status, update_updated_at) run as the
--     table owner via triggers — no role needs direct EXECUTE.
--   * generate_basic_slug is called server-side via service_role.
-- Also: strip anon from the four legacy tables that live in prod but were
-- missing from the squashed baseline (their RLS requires auth.uid / a
-- project membership, so anon could never pass — but defense-in-depth).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Function PUBLIC grants → role-specific.
-- ---------------------------------------------------------------------------

-- RLS helpers — authenticated + service_role only.
REVOKE ALL ON FUNCTION public.is_project_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_project_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_owner(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.project_has_no_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_has_no_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_has_no_members(uuid) TO service_role;

-- Admin check — authenticated (dashboard) + service_role only.
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;

-- Server-side slug generation — service_role only.
REVOKE ALL ON FUNCTION public.generate_basic_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_basic_slug(text) TO service_role;

-- Trigger helpers — nobody calls these directly.
REVOKE ALL ON FUNCTION public.handle_new_user_safety() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.orders_protect_amounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_business_subscription_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Strip anon from the legacy tables missing from the baseline.
--    (Supabase's default event trigger grants ALL to anon on any new table,
--    so newly created super_admins also needs the explicit revoke.)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.push_subscriptions FROM anon;
REVOKE ALL ON TABLE public.service_requests FROM anon;
REVOKE ALL ON TABLE public.telegram_link_codes FROM anon;
REVOKE ALL ON TABLE public.telegram_links FROM anon;
REVOKE ALL ON TABLE public.super_admins FROM anon;
REVOKE ALL ON TABLE public.super_admins FROM authenticated;
-- telegram_links is read by the dashboard (authenticated) via
-- telegram-manager.tsx — the is_project_member RLS policy gates it.
GRANT SELECT ON TABLE public.telegram_links TO authenticated;
GRANT SELECT ON TABLE public.telegram_links TO service_role;
-- telegram_link_codes: used only server-side (webhook/link API) via
-- service_role. It also holds the one-time pairing codes.
GRANT SELECT, INSERT, DELETE ON TABLE public.telegram_link_codes TO service_role;
GRANT SELECT ON TABLE public.telegram_link_codes TO authenticated;
-- service_requests: legacy waiter/bill flow; authenticated staff may need
-- visibility for audit purposes — SELECT only.
GRANT SELECT ON TABLE public.service_requests TO authenticated;
GRANT SELECT ON TABLE public.service_requests TO service_role;
-- push_subscriptions: written by /api/push/subscribe & /unsubscribe via the
-- USER's session (server client, role = authenticated), and read by the
-- admin push sender (service_role). RLS gates rows to auth.uid() = user_id.
GRANT SELECT, INSERT, DELETE ON TABLE public.push_subscriptions TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.push_subscriptions TO service_role;

-- ============================================================================
-- 0003 — 0003_drop_order_sequences.sql
-- ============================================================================
-- ============================================================================
-- 0003_drop_order_sequences.sql
-- Drop the dead order_sequences table (audit remediation, 2026-08-03).
--
-- Verified dead before dropping:
--   * 0 rows in order_sequences (daily_order_counters holds the live data)
--   * no FK constraints reference it
--   * no functions/triggers reference it
--   * next_order_number() uses daily_order_counters exclusively
--   * no app code reads it (only a generated type def in database.types.ts,
--     which is removed in this change)
-- ============================================================================

DROP TABLE IF EXISTS public.order_sequences;

-- ============================================================================
-- 0004 — 0004_staff_notification_prefs.sql
-- ============================================================================
-- ============================================================================
-- 0004_staff_notification_prefs.sql
-- Per-staff notification channel control (item 3 of the notifications plan).
--
-- 1. staff_members.notify_push / notify_telegram — each staff member chooses
--    which channels receive order alerts (default: both ON).
-- 2. telegram_links.user_id — the webhook now records WHO created the link
--    code (telegram_link_codes.created_by), so user-linked chats can be
--    scoped to that staff member's telegram pref. Group chats and legacy
--    links stay NULL (project-level channel: always receives alerts).
-- 3. RLS/GRANT hardening on staff_members (same family as 0001):
--    a. Blanket GRANT ALL ... TO authenticated is revoked; re-granted as
--       SELECT / INSERT / DELETE + column-scoped UPDATE (notify_push,
--       notify_telegram) only. No code path updates other staff columns
--       today (only onboarding INSERTs), and this closes the path where a
--       staff member could self-elevate role/project via an UPDATE.
--    b. staff_update_owner gains WITH CHECK mirroring USING — an owner can
--       no longer reparent a staff row into a project they don't own.
--    c. NEW staff_update_own_prefs: a staff member can UPDATE only their own
--       row (USING == WITH CHECK == user_id = auth.uid()).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-staff notification preferences (default: everything ON).
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff_members
  ADD COLUMN notify_push boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_telegram boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. telegram_links.user_id — who linked this chat (NULL = group/legacy).
-- ---------------------------------------------------------------------------
ALTER TABLE public.telegram_links
  ADD COLUMN user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 3a. Replace blanket authenticated grants with precise ones.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.staff_members FROM authenticated;

GRANT SELECT ON TABLE public.staff_members TO authenticated;
-- staff_insert_first_owner / staff_insert_by_owner (onboarding + owner adds)
GRANT INSERT ON TABLE public.staff_members TO authenticated;
-- staff_delete_owner
GRANT DELETE ON TABLE public.staff_members TO authenticated;
-- Column-scoped: staff (and owners) may only touch their own pref columns via
-- UPDATE. role/project_id/name are immutable through the API for now.
GRANT UPDATE (notify_push, notify_telegram) ON TABLE public.staff_members TO authenticated;

-- ---------------------------------------------------------------------------
-- 3b. staff_update_owner — WITH CHECK must mirror USING (anti-reparenting).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS staff_update_owner ON public.staff_members;
CREATE POLICY staff_update_owner ON public.staff_members
  FOR UPDATE
  USING (public.is_project_owner(project_id))
  WITH CHECK (public.is_project_owner(project_id));

-- ---------------------------------------------------------------------------
-- 3c. staff_update_own_prefs — self-service channel toggles.
--     Column grant (notify_*) + this row policy = staff can flip ONLY their
--     own notification flags, nothing else.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS staff_update_own_prefs ON public.staff_members;
CREATE POLICY staff_update_own_prefs ON public.staff_members
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 0005 — 0005_security_hardening_round2.sql
-- ============================================================================
-- ============================================================================
-- 0005_security_hardening_round2.sql
-- Audit remediation round 2 (2026-08-04) — applies on top of 0004.
--
-- Fixes:
--   1. CRITICAL: projects.created_by — abandoned-project takeover.
--      staff_insert_first_owner let ANY authenticated user claim ANY project
--      with zero members (project_has_no_members) and become its owner.
--      Now the project must carry created_by = auth.uid().
--   2. CRITICAL: ALTER DEFAULT PRIVILEGES still auto-granted ALL to
--      anon/authenticated on every FUTURE table/sequence/function.
--      0001/0002 patched per-object; the defaults were the re-opener.
--   3. HIGH: orders UPDATE policy allowed editing ANY column (e.g.
--      service_type, total_amount). Client only ever writes `status` —
--      restrict UPDATE to that column.
--   4. HIGH: super_admins had no RLS (bypassed policies entirely).
--   5. LOW: order_seq sequence grant to anon/authenticated (dead legacy).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Abandoned-project takeover: add created_by to projects
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

-- Backfill from existing owner memberships (safe: only touches rows that
-- already have an owner). New projects must set created_by explicitly.
UPDATE public.projects p
SET created_by = sm.user_id
FROM public.staff_members sm
WHERE sm.project_id = p.id
  AND sm.role = 'owner'
  AND p.created_by IS NULL;

-- The old policy let any authenticated user self-insert as owner of ANY
-- memberless project. Require the project to be owned-by-the-creator.
DROP POLICY IF EXISTS staff_insert_first_owner ON public.staff_members;
CREATE POLICY staff_insert_first_owner ON public.staff_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND project_has_no_members(project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );
COMMENT ON POLICY staff_insert_first_owner ON public.staff_members IS
  'Only the creator of an empty project may self-insert as first owner';

-- handle_new_user_safety (trigger) also creates projects for users created
-- outside the API — stamp created_by there too.
CREATE OR REPLACE FUNCTION public.handle_new_user_safety() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  user_full_name text;
  base_slug text;
  final_slug text;
  new_project_id uuid;
  suffix int := 0;
begin
  -- Only act if this user has no staff_members yet (lightweight check)
  if exists (
    select 1 from public.staff_members where user_id = new.id
  ) then
    return new;
  end if;

  -- Skip if user came through our main API (set from_api=true in user_metadata)
  if new.raw_user_meta_data ? 'from_api' and new.raw_user_meta_data->>'from_api' = 'true' then
    return new;
  end if;

  -- Only create project for users created outside the API (e.g. Supabase dashboard)
  user_full_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    split_part(new.email, '@', 1),
    'متجري'
  );

  base_slug := public.generate_basic_slug(user_full_name);

  -- Ensure unique slug (lightweight loop)
  final_slug := base_slug;
  while exists (select 1 from public.projects where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  -- Create a minimal project
  insert into public.projects (name, slug, currency, primary_color, is_active, created_by)
  values (
    user_full_name,
    final_slug,
    'BHD',
    '#4338CA',
    true,
    new.id
  )
  returning id into new_project_id;

  -- Create owner membership
  insert into public.staff_members (project_id, user_id, role)
  values (new_project_id, new.id, 'owner');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Kill the default-privilege backdoor on FUTURE objects
-- ---------------------------------------------------------------------------
-- These run for the role that creates objects via migrations (`postgres`).
-- (supabase_admin is platform-managed; its default privileges cannot be
-- altered from `postgres`. All tables/sequences/functions deployed through
-- supabase migrations are owned by `postgres`, so this fully covers them.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. orders: restrict authenticated UPDATE to the status column
--    (kitchen + POS only ever write status; everything else is service_role)
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON TABLE public.orders FROM authenticated;
GRANT UPDATE (status) ON TABLE public.orders TO authenticated;
-- INSERT/SELECT/DELETE grants from the baseline remain untouched.

-- ---------------------------------------------------------------------------
-- 4. super_admins: enable RLS (was policy-less; any authenticated user could
--    read/insert into it). Only service_role / SECURITY DEFINER access now.
-- ---------------------------------------------------------------------------
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.super_admins FROM anon;
REVOKE ALL ON TABLE public.super_admins FROM authenticated;
GRANT ALL ON TABLE public.super_admins TO service_role;

-- ---------------------------------------------------------------------------
-- 5. order_seq: revoke anon/authenticated (dead legacy sequence)
-- ---------------------------------------------------------------------------
REVOKE ALL ON SEQUENCE public.order_seq FROM anon;
REVOKE ALL ON SEQUENCE public.order_seq FROM authenticated;

-- ---------------------------------------------------------------------------
-- 6. order_items: enforce product belongs to the SAME project as its order.
--    The RLS policy only checks the member belongs to the order's project;
--    nothing stopped a member from adding a product priced/owned by ANOTHER
--    tenant (arbitrary unit_price / cross-tenant price leak). This trigger
--    makes it impossible regardless of the write path (PostgREST or direct).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_items_validate_project() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_project uuid;
  v_product_project uuid;
begin
  -- Resolve the order's project and (when present) the product's project.
  select project_id into v_order_project
  from public.orders where id = NEW.order_id;

  if v_order_project is null then
    raise exception 'order_items: order % not found', NEW.order_id;
  end if;

  if NEW.product_id is not null then
    select project_id into v_product_project
    from public.products where id = NEW.product_id;

    if v_product_project is null then
      raise exception 'order_items: product % not found', NEW.product_id;
    end if;

    if v_product_project <> v_order_project then
      raise exception 'order_items: product belongs to a different project';
    end if;
  end if;

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_order_items_validate_project ON public.order_items;
CREATE TRIGGER trg_order_items_validate_project
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_validate_project();

-- ============================================================================
-- 0006 — 0006_projects_created_by_anon_hide.sql
-- ============================================================================
-- ============================================================================
-- 0006_projects_created_by_anon_hide.sql
-- Audit remediation round 2, second pass (2026-08-04).
--
-- 0005 just added public.projects.created_by. Because projects_public_read
-- (anon) exposes the WHOLE row of every active project, the new column
-- immediately leaked the owner's auth.users uuid to the public API.
--
-- Fix: strip the table-level anon SELECT on projects and re-grant it
-- COLUMN-scoped — exactly the pattern 0001 used to hide tables.qrcode.
-- Non-anon readers (authenticated / service_role) are unaffected.
-- ============================================================================

REVOKE SELECT ON TABLE public.projects FROM anon;

-- Menu / public surfaces only need identity + addressability; created_by
-- (internal ownership) stays private. is_active drives projects_public_read.
GRANT SELECT (id, name, slug, currency, primary_color, logo_url, is_active, created_at)
  ON TABLE public.projects TO anon;

-- ============================================================================
-- 0007 — 0007_order_transactional_and_number_hardening.sql
-- ============================================================================
-- ============================================================================
-- 0007_order_transactional_and_number_hardening.sql
-- Audit remediation round 2, third pass (2026-08-04).
--
-- 1. createSecureOrder was NOT transactional: order INSERT then order_items
--    INSERT in two round-trips, with a best-effort DELETE rollback. A crash
--    between the two leaves a member-visible orphan order. Fix: one
--    SECURITY DEFINER RPC that inserts both inside a single transaction.
--    Grants: service_role ONLY (every real-order write path already uses
--    the admin client).
--
-- 2. order_number DoS: orders_staff_insert (authenticated) let any member
--    insert orders with an arbitrary order_number — e.g. the next expected
--    number (breaking the unique index for the whole day) or huge values
--    (burning the sequence range). Fix:
--      a. Column-scoped INSERT grant on orders for authenticated WITHOUT
--         order_number — members physically cannot supply it anymore.
--      b. BEFORE INSERT trigger auto-fills order_number from the atomic
--         next_order_number() when it is still 0 (default) — the auto-fill
--         keeps waiter/bill/kitchen-style inserts working with a real number.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Atomic order + items creation (transactional)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_table_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_notes text,
  p_order_number integer,
  p_items jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_id uuid;
  v_item jsonb;
begin
  insert into public.orders (project_id, table_id, type, status, total_amount, notes, order_number)
  values (p_project_id, p_table_id, p_type::order_type, p_status, p_total_amount, p_notes, p_order_number)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, addons, notes)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce(v_item->'addons', '[]'::jsonb),
      v_item->>'notes'
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', p_total_amount,
    'order_number', p_order_number
  );
end;
$$;

REVOKE ALL ON FUNCTION public.create_order_transactional FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional TO service_role;
-- The order_items_validate_project trigger (0005) still fires inside this
-- RPC, so cross-project product smuggling is blocked on this path too.

-- ---------------------------------------------------------------------------
-- 2. order_number hardening
-- ---------------------------------------------------------------------------
-- (a) authenticated can no longer write the order_number column at all.
REVOKE INSERT ON TABLE public.orders FROM authenticated;
GRANT INSERT (project_id, table_id, type, status, total_amount, notes, service_type, created_at)
  ON TABLE public.orders TO authenticated;

-- (b) auto-fill order_number when it is left at its 0 default, so member
--     inserts (waiter/bill/kitchen flows) still get a real sequential number.
CREATE OR REPLACE FUNCTION public.orders_auto_number() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
begin
  -- Only real orders (service_type IS NULL) need a sequential number;
  -- waiter/bill zero-amount service rows use order_number = 0 on purpose.
  if NEW.service_type is null and NEW.order_number = 0 then
    NEW.order_number := public.next_order_number(NEW.project_id);
  end if;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_orders_auto_number ON public.orders;
CREATE TRIGGER trg_orders_auto_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_auto_number();

-- ============================================================================
-- 0008 — 0008_fix_create_order_type_cast.sql
-- ============================================================================
-- ============================================================================
-- 0008_fix_create_order_type_cast.sql
-- Fix: create_order_transactional (0007) declared p_type as text but the
-- orders.type column is an enum (order_type) — every call failed with
-- "column type is of type order_type but expression is of type text".
-- Recreate the function with the cast.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_table_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_notes text,
  p_order_number integer,
  p_items jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_id uuid;
  v_item jsonb;
begin
  insert into public.orders (project_id, table_id, type, status, total_amount, notes, order_number)
  values (p_project_id, p_table_id, p_type::order_type, p_status, p_total_amount, p_notes, p_order_number)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, addons, notes)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce(v_item->'addons', '[]'::jsonb),
      v_item->>'notes'
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', p_total_amount,
    'order_number', p_order_number
  );
end;
$$;

REVOKE ALL ON FUNCTION public.create_order_transactional FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional TO service_role;

-- ============================================================================
-- 0009 — 0009_fix_create_order_status_cast.sql
-- ============================================================================
-- ============================================================================
-- 0009_fix_create_order_status_cast.sql
-- Fix: 0008 added the p_type cast but orders.status is ALSO an enum
-- (order_status) — calls failed with "column status is of type order_status
-- but expression is of type text". Recreate with both casts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_table_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_notes text,
  p_order_number integer,
  p_items jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_id uuid;
  v_item jsonb;
begin
  insert into public.orders (project_id, table_id, type, status, total_amount, notes, order_number)
  values (p_project_id, p_table_id, p_type::order_type, p_status::order_status, p_total_amount, p_notes, p_order_number)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, addons, notes)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce(v_item->'addons', '[]'::jsonb),
      v_item->>'notes'
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', p_total_amount,
    'order_number', p_order_number
  );
end;
$$;

REVOKE ALL ON FUNCTION public.create_order_transactional FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional TO service_role;

-- ============================================================================
-- 0010 — 0010_advance_order_status_and_rpc_guards.sql
-- ============================================================================
-- ============================================================================
-- 0010_advance_order_status_and_rpc_guards.sql
-- Phase 1 pre-launch fixes (H1+H2 atomic KDS transitions + F1 RPC guards)
--
-- 1. H1/H2: advance_order_status() — ONE transactional, status-checked
--    transition for KDS. Fixes:
--      H1: a stale kitchen screen can no longer revive a cancelled order
--          (UPDATE ... WHERE status = p_expected_status + ROW_COUNT check
--          raising STALE_STATUS).
--      H2: orders.status and order_items.status now advance atomically —
--          no more order-updated/items-stuck window.
-- 2. F1: membership guards inside the three legacy SECURITY DEFINER RPCs
--    (create_order_transactional, next_order_number, rate_limit_check).
--    NOTE: the audit's suggested `IF NOT is_project_member(...)` cannot be
--    used verbatim — is_project_member reads auth.uid(), which is NULL under
--    service_role (the only role these RPCs are callable by). Instead we add
--    an explicit p_caller_user_id parameter and check membership for
--    coalesce(auth.uid(), p_caller_user_id):
--      - browser callers (authenticated): auth.uid() present → real check
--      - server callers (service_role): pass the authenticated staff id →
--        real check
--      - anonymous public order path: caller id is NULL → guard passes
--        (route-level validation + service_role-only EXECUTE still apply)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: membership check for an EXPLICIT user id (unlike is_project_member
-- which only reads auth.uid()). SECURITY DEFINER so internal RPC calls can
-- use it regardless of the caller's table grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_project_member_for(p_user_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select exists (
    select 1 from public.staff_members sm
    where sm.project_id = p_project_id and sm.user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_project_member_for(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_project_member_for(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_member_for(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- H1/H2: atomic, status-checked KDS order transition.
-- Called from the kitchen client (browser, authenticated) and potentially
-- from server code (service_role + p_caller_user_id).
-- Raises 'STALE_STATUS' when the order is not in the expected state — the
-- client shows "تم تحديث حالة هذا الطلب من جهاز آخر" and refetches.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_order_status(
  p_order_id uuid,
  p_expected_status text,
  p_new_status text,
  p_caller_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_project_id uuid;
  v_caller uuid;
  v_rows int;
begin
  -- Resolve the order's project — also proves the order exists.
  select project_id into v_project_id
  from public.orders
  where id = p_order_id;

  if v_project_id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- Tenant guard: caller (browser auth.uid() or explicit server-passed id)
  -- must be a member of the order's project. Rejects cross-tenant calls and
  -- any future grant widening on this RPC.
  v_caller := coalesce(auth.uid(), p_caller_user_id);
  if v_caller is null or not public.is_project_member_for(v_caller, v_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  -- Atomic status transition — only advances if the order is exactly in the
  -- expected state (blocks reviving cancelled orders from a stale screen).
  update public.orders
  set status = p_new_status::public.order_status
  where id = p_order_id
    and status = p_expected_status::public.order_status;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'STALE_STATUS: order state changed on another device'
      using errcode = 'P0001';
  end if;

  -- Advance line items in the SAME transaction. order_items.status is text
  -- with CHECK (pending|preparing|ready) — 'delivered' is order-level only,
  -- so items are left at 'ready' on delivery (matches the previous behaviour).
  if p_new_status in ('preparing', 'ready') then
    update public.order_items
    set status = p_new_status
    where order_id = p_order_id;
  end if;

  return jsonb_build_object('id', p_order_id, 'status', p_new_status);
end;
$$;

REVOKE ALL ON FUNCTION public.advance_order_status(uuid, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.advance_order_status(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_order_status(uuid, text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- F1: guard create_order_transactional.
-- DROP first: CREATE OR REPLACE with an extra parameter would create a NEW
-- overload, leaving the old unguarded signature callable.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_order_transactional(uuid, uuid, text, text, numeric, text, integer, jsonb);

CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_table_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_notes text,
  p_order_number integer,
  p_items jsonb,
  p_caller_user_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_caller uuid;
begin
  -- Tenant guard — see header comment. Anonymous public path passes NULL
  -- caller (route-level validation applies); authenticated POS passes the
  -- staff id so the RPC itself enforces membership.
  v_caller := coalesce(auth.uid(), p_caller_user_id);
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  insert into public.orders (project_id, table_id, type, status, total_amount, notes, order_number)
  values (p_project_id, p_table_id, p_type::order_type, p_status::order_status, p_total_amount, p_notes, p_order_number)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, addons, notes)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce(v_item->'addons', '[]'::jsonb),
      v_item->>'notes'
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', p_total_amount,
    'order_number', p_order_number
  );
end;
$$;

REVOKE ALL ON FUNCTION public.create_order_transactional FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional TO service_role;

-- ---------------------------------------------------------------------------
-- F1: guard next_order_number.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.next_order_number(uuid);

CREATE OR REPLACE FUNCTION public.next_order_number(
  p_project_id uuid,
  p_caller_user_id uuid DEFAULT NULL
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_next integer;
  v_caller uuid;
begin
  v_caller := coalesce(auth.uid(), p_caller_user_id);
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  insert into public.daily_order_counters (project_id, date, counter)
  values (p_project_id, current_date, 1)
  on conflict (project_id, date)
  do update set counter = daily_order_counters.counter + 1
  returning counter into v_next;

  return v_next;
end;
$$;

REVOKE ALL ON FUNCTION public.next_order_number FROM public;
GRANT EXECUTE ON FUNCTION public.next_order_number TO service_role;

-- ---------------------------------------------------------------------------
-- F1: guard rate_limit_check. This RPC has no project parameter (it is keyed
-- by an opaque string), so the guard fires only when the caller supplies
-- p_project_id — POS passes project+staff id, public routes pass none.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rate_limit_check(text, integer, integer);

CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_key text,
  p_limit integer,
  p_window_ms integer,
  p_project_id uuid DEFAULT NULL,
  p_caller_user_id uuid DEFAULT NULL
) RETURNS json
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_count int;
  v_reset_at timestamptz;
  v_now timestamptz := now();
  v_remaining int;
  v_reset_in numeric;
  v_caller uuid;
begin
  -- Defense-in-depth: when a project is provided, the caller must be a member.
  if p_project_id is not null then
    v_caller := coalesce(auth.uid(), p_caller_user_id);
    if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
      raise exception 'not authorized for this project' using errcode = '42501';
    end if;
  end if;

  select count, reset_at into v_count, v_reset_at
  from public.rate_limits
  where key = p_key;

  if v_reset_at is null or v_now > v_reset_at then
    insert into public.rate_limits (key, count, reset_at)
    values (p_key, 1, v_now + (p_window_ms || ' milliseconds')::interval)
    on conflict (key) do update
      set count = 1, reset_at = excluded.reset_at;
    return json_build_object('allowed', true, 'remaining', p_limit - 1, 'reset_in', p_window_ms);
  end if;

  if v_count >= p_limit then
    v_reset_in := extract(epoch from (v_reset_at - v_now)) * 1000;
    return json_build_object('allowed', false, 'remaining', 0, 'reset_in', v_reset_in);
  end if;

  update public.rate_limits set count = count + 1 where key = p_key;
  v_remaining := p_limit - v_count - 1;
  v_reset_in := extract(epoch from (v_reset_at - v_now)) * 1000;
  return json_build_object('allowed', true, 'remaining', v_remaining, 'reset_in', v_reset_in);
end;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_check FROM public;
GRANT EXECUTE ON FUNCTION public.rate_limit_check TO service_role;

-- ============================================================================
-- 0011 — 0011_fix_create_order_transactional_nullable_params.sql
-- ============================================================================
-- ============================================================================
-- 0011_fix_create_order_transactional_nullable_params.sql
-- The 0010 rewrite of create_order_transactional accidentally dropped the
-- nullable handling of p_table_id / p_notes that the original signature had
-- (callers legitimately pass NULL for table-less POS orders and optional
-- notes). Regenerate the function with DEFAULT NULL on both so the
-- generated client types stay compatible with the existing call sites.
--
-- NOTE: PostgreSQL requires that every parameter AFTER a defaulted one also
-- has a default (SQLSTATE 42P13), so the optional args are moved to the END
-- of the signature. Callers pass these by name (supabase.rpc), so argument
-- order does not affect them.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_order_transactional(uuid, uuid, text, text, numeric, text, integer, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_order_number integer,
  p_items jsonb,
  p_table_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_caller_user_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_caller uuid;
begin
  -- Tenant guard — see 0010 header comment. Anonymous public path passes
  -- NULL caller (route-level validation applies); authenticated POS passes
  -- the staff id so the RPC itself enforces membership.
  v_caller := coalesce(auth.uid(), p_caller_user_id);
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  insert into public.orders (project_id, table_id, type, status, total_amount, notes, order_number)
  values (p_project_id, p_table_id, p_type::order_type, p_status::order_status, p_total_amount, p_notes, p_order_number)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, addons, notes)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce(v_item->'addons', '[]'::jsonb),
      v_item->>'notes'
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', p_total_amount,
    'order_number', p_order_number
  );
end;
$$;

REVOKE ALL ON FUNCTION public.create_order_transactional FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional TO service_role;

-- ============================================================================
-- 0012 — 0012_subscription_enforcement.sql
-- ============================================================================
-- ============================================================================
-- 0012_subscription_enforcement.sql
-- Phase 2 — manual cash subscription enforcement (C1):
--   1. subscription_expires_at timestamptz on projects (default 30-day trial)
--   2. expire_subscriptions() — idempotent flipper run by pg_cron daily
--   3. renew_subscription() — owner-only manual renewal (cash collected)
--   4. pg_cron job registration (runs 03:00 daily)
--   5. Drop dead schema: sync_business_subscription_status() (references a
--      `businesses` table that never existed) + the three unused enums
--      subscription_status / plan_interval / business_status (verified: no
--      column or policy references them — the pg_dump baseline only defines
--      them and the dead function's body).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column + 30-day trial default for existing AND new projects.
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN subscription_expires_at timestamptz
  DEFAULT (now() + interval '30 days') NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Idempotent expiry flipper. SECURITY DEFINER so pg_cron (postgres role)
--    and service_role can both invoke it safely.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_count int;
begin
  update public.projects
  set is_active = false
  where is_active = true
    and subscription_expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_subscriptions() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Manual renewal (cash collected by the owner). Owner-only: the caller
--    must be an 'owner' staff member of the project (or a super admin).
--    Sets subscription_expires_at forward from max(now, current expiry) and
--    re-activates the store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.renew_subscription(
  p_project_id uuid,
  p_days integer DEFAULT 30,
  p_caller_user_id uuid DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_caller uuid;
  v_new_expiry timestamptz;
begin
  v_caller := coalesce(auth.uid(), p_caller_user_id);
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Owner of this project, or a global super admin.
  if not (
    exists (
      select 1 from public.staff_members sm
      where sm.project_id = p_project_id
        and sm.user_id = v_caller
        and sm.role = 'owner'
    )
    or exists (
      select 1 from public.super_admins sa
      where sa.user_id = v_caller
    )
  ) then
    raise exception 'owner only' using errcode = '42501';
  end if;

  update public.projects
  set subscription_expires_at =
        greatest(coalesce(subscription_expires_at, now()), now()) + (p_days || ' days')::interval,
      is_active = true
  where id = p_project_id
  returning subscription_expires_at into v_new_expiry;

  if v_new_expiry is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  return v_new_expiry;
end;
$$;

REVOKE ALL ON FUNCTION public.renew_subscription FROM public;
GRANT EXECUTE ON FUNCTION public.renew_subscription TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_subscription TO service_role;

-- ---------------------------------------------------------------------------
-- 4. pg_cron daily job at 03:00 server time. Registration runs inside the
--    migration, so a failure here fails the whole push loudly (never a
--    silently-unregistered job).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
begin
  -- Re-create cleanly if re-run
  if exists (select 1 from cron.job where jobname = 'dokan-expire-subscriptions') then
    perform cron.unschedule('dokan-expire-subscriptions');
  end if;
  perform cron.schedule(
    'dokan-expire-subscriptions',
    '0 3 * * *',
    'select public.expire_subscriptions();'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Drop dead schema (verified unused — see header).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sync_business_subscription_status();
DROP TYPE IF EXISTS public.subscription_status;
DROP TYPE IF EXISTS public.plan_interval;
DROP TYPE IF EXISTS public.business_status;

-- ============================================================================
-- 0013 — 0013_verify_cron_job.sql
-- ============================================================================
-- Temporary verification: confirm the cron job is actually registered.
-- Raises an exception (failing the push) if it is missing.
DO $$
declare
  r record;
  v_found boolean := false;
begin
  for r in
    select jobid, schedule, command, active
    from cron.job
    where jobname = 'dokan-expire-subscriptions'
  loop
    v_found := true;
    raise notice 'CRON JOB VERIFIED: jobid=% schedule=% active=% command=%',
      r.jobid, r.schedule, r.active, r.command;
  end loop;
  if not v_found then
    raise exception 'CRON JOB MISSING: dokan-expire-subscriptions was not registered';
  end if;
end;
$$;

-- ============================================================================
-- 0014 — 0014_revoke_broad_supabase_admin_default_privileges.sql
-- ============================================================================
-- ============================================================================
-- 0014_revoke_broad_supabase_admin_default_privileges.sql
-- F4: The baseline (0000, lines ~1969-2022) sets ALTER DEFAULT PRIVILEGES
-- granting ALL (incl. TRUNCATE/REFERENCES/TRIGGER) to anon/authenticated for
-- objects created by postgres AND by supabase_admin.
--
-- What this migration does:
--   * FOR ROLE postgres (the role migrations run as, i.e. everything WE create
--     going forward): replaces the broad ALL grants with the minimum PostgREST
--     + RLS actually need — SELECT/INSERT/UPDATE/DELETE on tables,
--     USAGE/SELECT on sequences, EXECUTE on functions. No TRUNCATE,
--     REFERENCES, TRIGGER, or DDL for anon/authenticated. New tables created
--     by migrations now need explicit grants (already the repo's practice:
--     0001/0002 hardening does exactly that).
--   * FOR ROLE supabase_admin: NOT touched. Supabase's managed Postgres runs
--     db push as `postgres`, which is not a member of supabase_admin and
--     cannot alter that role's default privileges (verified live: SET ROLE
--     supabase_admin → insufficient privilege). This repo never creates
--     schema via the dashboard (migrations only), so the supabase_admin
--     defaults are inert here. If we ever need them closed, it must be done
--     manually as supabase_admin via Supabase support/dashboard SQL.
--
-- Default privileges apply only at object-creation time: existing objects
-- (which have explicit grants from the baseline + 0001/0002) are untouched.
-- ============================================================================

-- ---------- TABLES (FOR ROLE postgres) ----------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- ---------- SEQUENCES (FOR ROLE postgres) ----------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ---------- FUNCTIONS (FOR ROLE postgres) ----------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;

-- ============================================================================
-- 0015 — 0015_super_admin_audit_and_seed.sql
-- ============================================================================
-- ============================================================================
-- 0015_super_admin_audit_and_seed.sql
-- Super Admin dashboard — Phase A foundation:
--   1. super_admin_audit_log table (separate from order_audit_logs, which is
--      order-specific with a CHECK constraint — not extendable).
--   2. super_admin_deactivate_project RPC (super-admin-only, same guard
--      pattern as renew_subscription: SECURITY DEFINER + internal check).
--   3. Seed Ammar's accounts as super_admins (table was empty).
--
-- SECURITY: super_admin_audit_log is service_role-only (REVOKE from
-- anon/authenticated, GRANT service_role) — same posture as super_admins.
-- RLS enabled with NO policies: the table is written via service-role RPCs /
-- routes only, and read only by the super-admin surface (service role).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit log table
-- ---------------------------------------------------------------------------
CREATE TABLE public.super_admin_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    action text NOT NULL,
    target_project_id uuid,
    target_user_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX super_admin_audit_log_created_at_idx
  ON public.super_admin_audit_log (created_at DESC);
CREATE INDEX super_admin_audit_log_actor_idx
  ON public.super_admin_audit_log (actor_user_id);
CREATE INDEX super_admin_audit_log_action_idx
  ON public.super_admin_audit_log (action);
CREATE INDEX super_admin_audit_log_project_idx
  ON public.super_admin_audit_log (target_project_id);

ALTER TABLE public.super_admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS; anon/authenticated have no grants.

REVOKE ALL ON TABLE public.super_admin_audit_log FROM anon;
REVOKE ALL ON TABLE public.super_admin_audit_log FROM authenticated;
GRANT ALL ON TABLE public.super_admin_audit_log TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Deactivate RPC (abuse / non-payment before natural expiry).
--    Super-admin-only, checked INSIDE the function (auth.uid() OR explicit
--    caller id — same coalesce pattern as renew_subscription).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_deactivate_project(
    p_project_id uuid,
    p_caller_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
    v_caller uuid;
    v_updated int;
begin
    v_caller := coalesce(auth.uid(), p_caller_user_id);
    if v_caller is null then
        raise exception 'not authenticated' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.super_admins sa
        where sa.user_id = v_caller
    ) then
        raise exception 'super admin only' using errcode = '42501';
    end if;

    update public.projects
    set is_active = false
    where id = p_project_id;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'project not found' using errcode = 'P0002';
    end if;

    return true;
end;
$$;

REVOKE ALL ON FUNCTION public.super_admin_deactivate_project FROM public;
GRANT EXECUTE ON FUNCTION public.super_admin_deactivate_project TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Seed Ammar's accounts (table was empty — 0 rows verified).
-- ---------------------------------------------------------------------------
INSERT INTO public.super_admins (user_id)
SELECT id FROM auth.users
WHERE email IN ('ammaralmahfood17@gmail.com', 'teatime@bh.com')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- 0016 — 0016_impersonation_sessions.sql
-- ============================================================================
-- ============================================================================
-- 0016_impersonation_sessions.sql
-- Phase C — super-admin "login as" support sessions.
--
-- SECURITY MODEL:
-- - No password is ever exposed or reset. The owner session is minted
--   server-side via admin.generateLink(magiclink) + verifyOtp(token_hash).
-- - The super admin's OWN session (tokens) is stored here so ending the
--   impersonation (or auto-expiry) can restore it — the admin never gets
--   logged out of their own account.
-- - Hard 30-minute expiry checked on EVERY request (layout); expired rows
--   are unusable even if a stale cookie survives.
-- - service_role-only table (RLS enabled, no policies, no anon/auth grants).
-- ============================================================================

CREATE TABLE public.impersonation_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    super_admin_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    target_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    target_project_id uuid,
    -- Tokens are secrets: never exposed to the client. The layout only reads
    -- expiry + identity; cookie swapping happens server-side.
    super_admin_session jsonb NOT NULL,
    target_session jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX impersonation_sessions_admin_idx
  ON public.impersonation_sessions (super_admin_user_id);
CREATE INDEX impersonation_sessions_target_idx
  ON public.impersonation_sessions (target_user_id);
CREATE INDEX impersonation_sessions_expires_idx
  ON public.impersonation_sessions (expires_at);

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only (bypasses RLS); anon/authenticated have no grants.

REVOKE ALL ON TABLE public.impersonation_sessions FROM anon;
REVOKE ALL ON TABLE public.impersonation_sessions FROM authenticated;
GRANT ALL ON TABLE public.impersonation_sessions TO service_role;

-- ============================================================================
-- 0017 — 0017_project_archive_and_hard_delete.sql
-- ============================================================================
-- ============================================================================
-- 0017_project_archive_and_hard_delete.sql
-- Phase D — manual project create/archive/hard-delete (super-admin only).
--
-- DESIGN:
-- - Soft-delete is the DEFAULT: deleted_at timestamp makes the project
--   invisible to staff (getCurrentProject guard) and hidden from listings.
--   Data is retained; a mistaken archive is recoverable by clearing the flag.
-- - Hard-delete is deliberately separate and harder: a dedicated RPC (the UI
--   requires typing the exact project name + a reason). All child rows are
--   removed by existing ON DELETE CASCADE FKs.
-- - Both RPCs are SECURITY DEFINER with the in-function super-admin check
--   (same pattern as renew_subscription / super_admin_deactivate_project).
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Soft-delete (archive). Reason is REQUIRED (stored in audit by the route).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_archive_project(
    p_project_id uuid,
    p_caller_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
    v_caller uuid;
    v_updated int;
begin
    v_caller := coalesce(auth.uid(), p_caller_user_id);
    if v_caller is null then
        raise exception 'not authenticated' using errcode = '42501';
    end if;

    if not exists (select 1 from public.super_admins sa where sa.user_id = v_caller) then
        raise exception 'super admin only' using errcode = '42501';
    end if;

    update public.projects
    set deleted_at = now(),
        is_active = false
    where id = p_project_id
      and deleted_at is null;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'project not found or already archived' using errcode = 'P0002';
    end if;

    return true;
end;
$$;

REVOKE ALL ON FUNCTION public.super_admin_archive_project FROM public;
GRANT EXECUTE ON FUNCTION public.super_admin_archive_project TO service_role;

-- ---------------------------------------------------------------------------
-- Hard-delete. Destructive by design — UI requires exact-name confirmation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_hard_delete_project(
    p_project_id uuid,
    p_caller_user_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
    v_caller uuid;
    v_updated int;
begin
    v_caller := coalesce(auth.uid(), p_caller_user_id);
    if v_caller is null then
        raise exception 'not authenticated' using errcode = '42501';
    end if;

    if not exists (select 1 from public.super_admins sa where sa.user_id = v_caller) then
        raise exception 'super admin only' using errcode = '42501';
    end if;

    -- All child rows cascade (FKs defined ON DELETE CASCADE in baseline).
    delete from public.projects
    where id = p_project_id;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'project not found' using errcode = 'P0002';
    end if;

    return true;
end;
$$;

REVOKE ALL ON FUNCTION public.super_admin_hard_delete_project FROM public;
GRANT EXECUTE ON FUNCTION public.super_admin_hard_delete_project TO service_role;

-- ============================================================================
-- 0018 — 0018_enable_realtime_for_orders.sql
-- ============================================================================
-- ============================================================================
-- 0018_enable_realtime_for_orders.sql
--
-- WHY: the kitchen + orders screens subscribe to postgres_changes on
-- `orders` / `order_items`, but neither table was in the realtime
-- publication. Channels reached SUBSCRIBED while ZERO events arrived, so
-- both screens silently fell back to their 30s poll — an order took up to
-- 30 seconds to appear on the kitchen screen. Verified live with a probe
-- project: INSERT event never arrived within 10s.
--
-- FIX: add both tables to the realtime publication (idempotent via DO
-- blocks — orders may already be a member on some projects). REPLICA
-- IDENTITY FULL is required so UPDATE/DELETE payloads carry the full old
-- row (the kitchen reads payload.old.id on DELETE).
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end $$;

alter table public.orders replica identity full;
alter table public.order_items replica identity full;

-- ============================================================================
-- 0019 — 0019_subscription_cutoff_hard.sql
-- ============================================================================
-- ============================================================================
-- 0019_subscription_cutoff_hard.sql
-- Close the ~24h revenue-leak window: the public menu + public order API
-- previously checked only projects.is_active, which pg_cron flips at 03:00
-- daily. A store whose subscription expired at 10:00 stayed live until the
-- next 03:00 cron run (~17h of free service).
--
-- Fix: expose a SECURITY DEFINER RPC that reads subscription_expires_at
-- directly (anon has column-scoped grants on projects — 0006 — and cannot
-- select that column). The public menu page and /api/public/order now call
-- this RPC; the cutoff is exact to the minute, independent of the cron.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_project_publicly_available(p_slug text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_is_active boolean;
  v_expires timestamptz;
begin
  select is_active, subscription_expires_at
    into v_is_active, v_expires
    from public.projects
   where slug = p_slug;

  -- Unknown slug → false. Inactive → false. Trial/expiry missing → false
  -- (fail closed — a store without an expiry should never serve orders).
  if v_is_active is null then
    return false;
  end if;

  return v_is_active
     and v_expires is not null
     and v_expires > now();
end;
$$;

-- anon needs to call it from the public menu page.
GRANT ALL ON FUNCTION public.is_project_publicly_available(text) TO anon;
GRANT ALL ON FUNCTION public.is_project_publicly_available(text) TO authenticated;

-- ============================================================================
-- 0020 — 0020_rate_limits_lockdown.sql
-- ============================================================================
-- ============================================================================
-- 0020_rate_limits_lockdown.sql
-- B4: جدول rate_limits داخلي — يجب ألا يصل إليه anon/authenticated إطلاقًا.
-- المشكلة: baseline (0000) يمنح ALL لـ anon + authenticated، مما يعني أن أي
-- زائر أو مستخدم مسجل يستطيع:
--   1) قراءة مفاتيح rate limit لجميع المتاجر (تسريب معلومات عن نشاط منافس)،
--   2) حذف سجلات rate limit (تعطيل حماية anti-spam)،
--   3) حقن سجلات وهمية (حرمان آخرين من الخدمة).
-- rateLimit() يكتب عبر service_role (src/lib/rate-limit.ts → createAdminClient)
-- لذا REVOKE من anon/authenticated لا يكسر أي مسار شرعي.
-- ============================================================================

REVOKE ALL ON TABLE public.rate_limits FROM anon;
REVOKE ALL ON TABLE public.rate_limits FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limits TO service_role;
