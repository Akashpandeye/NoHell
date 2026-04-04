-- ==========================================================================
-- NoHell — Supabase schema
-- Run this in the Supabase SQL Editor to create the required tables.
-- ==========================================================================

-- Users (Clerk user ID as primary key)
create table if not exists users (
  id                       text primary key,
  onboarding_completed     boolean   default false,
  onboarding_completed_at  timestamptz,
  profile                  jsonb,
  onboarding_answers       jsonb,
  sessions_used            integer   default 0,
  plan                     text      default 'free',
  created_at               timestamptz default now()
);

-- Learning sessions
create table if not exists sessions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text      not null,
  video_id             text      not null,
  video_title          text      not null,
  goal                 text      not null,
  checkpoints          jsonb     default '[]'::jsonb,
  started_at           timestamptz not null,
  ended_at             timestamptz,
  status               text      not null default 'active',
  total_watch_seconds  integer   default 0,
  recall_questions     jsonb,
  created_at           timestamptz default now()
);

-- AI-generated notes
create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid      not null,
  "timestamp" integer   not null,
  type        text      not null,
  content     text      not null,
  created_at  timestamptz not null
);

-- User bookmarks
create table if not exists bookmarks (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid      not null,
  timestamp_seconds integer   not null,
  label             text      not null,
  created_at        timestamptz not null
);

-- Indexes for common queries
create index if not exists idx_sessions_user_id    on sessions(user_id);
create index if not exists idx_notes_session_id    on notes(session_id);
create index if not exists idx_bookmarks_session_id on bookmarks(session_id);

-- -------------------------------------------------------------------------
-- RLS — Auth is handled by Clerk, not Supabase Auth.
-- The policies below are permissive for development. Tighten for production
-- (e.g. verify Clerk JWT via a custom Supabase function).
-- -------------------------------------------------------------------------
alter table users     enable row level security;
alter table sessions  enable row level security;
alter table notes     enable row level security;
alter table bookmarks enable row level security;

create policy "Allow all on users"     on users     for all using (true) with check (true);
create policy "Allow all on sessions"  on sessions  for all using (true) with check (true);
create policy "Allow all on notes"     on notes     for all using (true) with check (true);
create policy "Allow all on bookmarks" on bookmarks for all using (true) with check (true);
