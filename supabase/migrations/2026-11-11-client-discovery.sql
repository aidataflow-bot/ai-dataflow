-- AI DataFlow: discovery questionnaire answers stored on the client
-- Run once in the Supabase SQL editor. Export CSVs of clients, recommendations and client_notes first
-- (the Free plan has no automatic backups).
-- Safe to run more than once, and safe for the currently deployed code: it only adds a column with a default.
-- The code works before and after this runs; until it has run, discovery answers cannot be saved
-- (the page says so) and every client simply has none.

alter table public.clients
  add column if not exists discovery jsonb not null default '{}'::jsonb;

-- Shape: { "answers": { "<question id>": "<answer>" }, "updated_at": "<iso>", "updated_by": "<app_users.id>" }
comment on column public.clients.discovery is 'Discovery questionnaire answers (SOP 001, Stage 3); question ids are defined in lib/discovery.js';
