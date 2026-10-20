-- AI DataFlow: shared agency workspace, roles, pipeline stage, appointments, notes timeline
-- Run once in the Supabase SQL editor BEFORE deploying the matching code.
-- Safe to run more than once, and safe for the currently deployed code (it only adds things).

-- 1) Roles and active flag for staff accounts ---------------------------------------------
alter table public.app_users add column if not exists role text not null default 'sales';
alter table public.app_users add column if not exists active boolean not null default true;

do $$
begin
  alter table public.app_users
    add constraint app_users_role_check check (role in ('admin', 'consultant', 'sales'));
exception when duplicate_object then null;
end $$;

-- The oldest account (the agency owner) becomes admin, but only if no admin exists yet.
update public.app_users
set role = 'admin'
where id = (select id from public.app_users order by created_at asc limit 1)
  and not exists (select 1 from public.app_users where role = 'admin');

-- 2) Client workflow: pipeline stage, assignment, appointment -------------------------------
alter table public.clients add column if not exists stage text not null default 'lead';
alter table public.clients add column if not exists assigned_to text references public.app_users(id) on delete set null;
alter table public.clients add column if not exists appointment_at timestamptz;
alter table public.clients add column if not exists appointment_notes text;

do $$
begin
  alter table public.clients
    add constraint clients_stage_check
    check (stage in ('lead', 'appointment-set', 'discovery', 'analysis', 'proposal-sent', 'won', 'lost'));
exception when duplicate_object then null;
end $$;

create index if not exists clients_assigned_to_idx on public.clients(assigned_to);
create index if not exists clients_appointment_at_idx on public.clients(appointment_at);

-- 3) Shared data must not disappear when a staff account is removed --------------------------
-- user_id now means "created by". Deleting a user must be blocked while they own records
-- (deactivate people from the Team page instead of deleting them).
alter table public.clients drop constraint if exists clients_user_id_fkey;
alter table public.clients
  add constraint clients_user_id_fkey foreign key (user_id) references public.app_users(id) on delete restrict;

alter table public.recommendations drop constraint if exists recommendations_user_id_fkey;
alter table public.recommendations
  add constraint recommendations_user_id_fkey foreign key (user_id) references public.app_users(id) on delete restrict;

-- 4) Notes and activity timeline per client ---------------------------------------------------
create table if not exists public.client_notes (
  id text primary key,
  client_id text not null references public.clients(id) on delete cascade,
  author_id text not null references public.app_users(id) on delete restrict,
  kind text not null default 'note',   -- 'note' (typed by a person) or 'event' (stage, assignment, appointment)
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists client_notes_client_idx on public.client_notes(client_id, created_at desc);
alter table public.client_notes enable row level security;

-- Check afterwards:  select email, role, active from public.app_users order by created_at;
