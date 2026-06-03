-- AI DataFlow Supabase schema
-- Run this in the Supabase SQL editor before deploying to Vercel.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id text primary key,
  email text not null unique,
  first_name text not null,
  last_name text not null,
  name text not null,
  company text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  company_name text not null,
  contact_name text not null,
  email text not null,
  phone text,
  industry text not null,
  company_size text,
  location text,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recommendations (
  id text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  client_id text references public.clients(id) on delete set null,
  process_area text not null,
  description text not null,
  current_tools text,
  team_size text,
  urgency text,
  goals jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  results jsonb not null,
  status text not null default 'not-started',
  is_favorite boolean not null default false,
  impact_score numeric,
  priority text not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_user_id_idx on public.clients(user_id);
create index if not exists recommendations_user_id_idx on public.recommendations(user_id);
create index if not exists recommendations_client_id_idx on public.recommendations(client_id);

alter table public.app_users enable row level security;
alter table public.clients enable row level security;
alter table public.recommendations enable row level security;

-- The Vercel API uses SUPABASE_SERVICE_ROLE_KEY server-side.
-- Do not expose the service role key in frontend code.
