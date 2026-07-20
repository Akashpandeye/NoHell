-- NoHell production security baseline.
-- Apply through the Supabase CLI/SQL Editor before deploying the secured API routes.
-- Application data is accessed only by the server's service-role client; anon and
-- authenticated Supabase roles intentionally receive no table privileges.

begin;

-- Repair safe defaults before constraints are added.
update public.users
set sessions_used = greatest(coalesce(sessions_used, 0), 0),
    plan = case when plan = 'pro' then 'pro' else 'free' end;

update public.sessions
set total_watch_seconds = greatest(coalesce(total_watch_seconds, 0), 0),
    status = case
      when status in ('active', 'paused', 'completed', 'abandoned') then status
      else 'active'
    end;

-- Referential integrity. `not valid` keeps this migration deployable on existing
-- projects; validate each constraint after repairing any legacy orphaned rows.
alter table public.sessions
  add constraint sessions_user_id_fkey
  foreign key (user_id) references public.users(id)
  on delete cascade not valid;

alter table public.notes
  add constraint notes_session_id_fkey
  foreign key (session_id) references public.sessions(id)
  on delete cascade not valid;

alter table public.bookmarks
  add constraint bookmarks_session_id_fkey
  foreign key (session_id) references public.sessions(id)
  on delete cascade not valid;

alter table public.users
  add constraint users_sessions_used_nonnegative_check
  check (sessions_used >= 0) not valid,
  add constraint users_plan_check
  check (plan in ('free', 'pro')) not valid;

alter table public.sessions
  add constraint sessions_status_check
  check (status in ('active', 'paused', 'completed', 'abandoned')) not valid,
  add constraint sessions_watch_seconds_nonnegative_check
  check (total_watch_seconds >= 0) not valid,
  add constraint sessions_goal_not_blank_check
  check (length(btrim(goal)) > 0) not valid;

alter table public.notes
  alter column created_at set default now(),
  add constraint notes_timestamp_nonnegative_check
  check ("timestamp" >= 0) not valid,
  add constraint notes_type_check
  check (type in ('theory', 'important', 'syntax', 'logic')) not valid,
  add constraint notes_content_not_blank_check
  check (length(btrim(content)) > 0) not valid;

alter table public.bookmarks
  alter column created_at set default now(),
  add constraint bookmarks_timestamp_nonnegative_check
  check (timestamp_seconds >= 0) not valid,
  add constraint bookmarks_label_not_blank_check
  check (length(btrim(label)) > 0) not valid;

alter table public.sessions
  add column if not exists idempotency_key uuid;

create unique index if not exists idx_sessions_user_idempotency_key
  on public.sessions(user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_sessions_user_created_at
  on public.sessions(user_id, created_at desc);
create index if not exists idx_notes_session_timestamp
  on public.notes(session_id, "timestamp", created_at);
create index if not exists idx_bookmarks_session_timestamp
  on public.bookmarks(session_id, timestamp_seconds);

-- Creates a single session and consumes free-tier usage in the same transaction.
-- Only the server service-role client can invoke this RPC.
create or replace function public.begin_learning_session(
  p_user_id text,
  p_video_id text,
  p_video_title text,
  p_goal text,
  p_checkpoints jsonb,
  p_started_at timestamptz,
  p_idempotency_key uuid
)
returns table (session_id uuid, outcome text)
language plpgsql
set search_path = public
as $$
declare
  locked_user public.users%rowtype;
  existing_id uuid;
begin
  insert into public.users (id) values (p_user_id)
  on conflict (id) do nothing;

  select * into locked_user
  from public.users
  where id = p_user_id
  for update;

  select id into existing_id
  from public.sessions
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if existing_id is not null then
    return query select existing_id, 'existing'::text;
    return;
  end if;

  if locked_user.plan <> 'pro' and locked_user.sessions_used >= 5 then
    return query select null::uuid, 'limit_reached'::text;
    return;
  end if;

  insert into public.sessions (
    user_id, video_id, video_title, goal, checkpoints, started_at, status, total_watch_seconds, idempotency_key
  ) values (
    p_user_id, p_video_id, p_video_title, p_goal, coalesce(p_checkpoints, '[]'::jsonb), p_started_at,
    'active', 0, p_idempotency_key
  ) returning id into existing_id;

  if locked_user.plan <> 'pro' then
    update public.users
    set sessions_used = sessions_used + 1
    where id = p_user_id;
  end if;

  return query select existing_id, 'created'::text;
end;
$$;

revoke all on function public.begin_learning_session(text, text, text, text, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_learning_session(text, text, text, text, jsonb, timestamptz, uuid)
  to service_role;

-- Remove the development-only open policies. With RLS enabled and no replacement
-- policy, browser anon/authenticated clients cannot access private application rows.
drop policy if exists "Allow all on users" on public.users;
drop policy if exists "Allow all on sessions" on public.sessions;
drop policy if exists "Allow all on notes" on public.notes;
drop policy if exists "Allow all on bookmarks" on public.bookmarks;

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.notes enable row level security;
alter table public.bookmarks enable row level security;

revoke all on table public.users from anon, authenticated;
revoke all on table public.sessions from anon, authenticated;
revoke all on table public.notes from anon, authenticated;
revoke all on table public.bookmarks from anon, authenticated;

commit;
