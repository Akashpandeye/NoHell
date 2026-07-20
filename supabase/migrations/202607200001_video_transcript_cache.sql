-- Global, service-role-only YouTube transcript cache with atomic fetch leases.
begin;

create table if not exists public.video_transcript_cache (
  video_id          text primary key
                    check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  status            text not null
                    check (status in ('fetching', 'ready', 'unavailable', 'failed')),
  lines             jsonb,
  source            text check (source in ('external', 'direct')),
  error_code        text,
  error_message     text,
  error_retryable   boolean,
  error_provider    text check (error_provider in ('external', 'direct', 'policy', 'cache')),
  retry_after       timestamptz,
  lease_token       uuid,
  lease_expires_at  timestamptz,
  attempt_count     integer not null default 0 check (attempt_count >= 0),
  fetched_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (
    (status = 'fetching' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'fetching' and lease_token is null and lease_expires_at is null)
  ),
  check (
    status <> 'ready'
    or coalesce(
      case
        when jsonb_typeof(lines) = 'array'
          then jsonb_array_length(lines) > 0 and source is not null
        else false
      end,
      false
    )
  )
);

create index if not exists idx_video_transcript_cache_retry_after
  on public.video_transcript_cache(retry_after)
  where status in ('unavailable', 'failed');

create or replace function public.claim_video_transcript(
  p_video_id text,
  p_force boolean,
  p_lease_seconds integer
)
returns table (
  outcome text,
  cache_status text,
  lines jsonb,
  source text,
  error_code text,
  error_message text,
  error_retryable boolean,
  error_provider text,
  retry_after timestamptz,
  lease_token uuid,
  fetched_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  cached public.video_transcript_cache%rowtype;
  new_lease uuid := gen_random_uuid();
  lease_until timestamptz := now() + make_interval(
    secs => greatest(10, least(coalesce(p_lease_seconds, 35), 120))
  );
begin
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid video id' using errcode = '22023';
  end if;

  insert into public.video_transcript_cache (
    video_id, status, lease_token, lease_expires_at, attempt_count
  ) values (
    p_video_id, 'fetching', new_lease, lease_until, 1
  )
  on conflict (video_id) do nothing
  returning * into cached;

  if found then
    return query select
      'claimed'::text, cached.status, cached.lines, cached.source,
      cached.error_code, cached.error_message, cached.error_retryable,
      cached.error_provider, cached.lease_expires_at, cached.lease_token,
      cached.fetched_at, cached.updated_at;
    return;
  end if;

  select * into cached
  from public.video_transcript_cache as transcript_cache
  where transcript_cache.video_id = p_video_id
  for update;

  if cached.status = 'ready' then
    return query select
      'cached'::text, cached.status, cached.lines, cached.source,
      cached.error_code, cached.error_message, cached.error_retryable,
      cached.error_provider, cached.retry_after, null::uuid,
      cached.fetched_at, cached.updated_at;
    return;
  end if;

  if not coalesce(p_force, false)
     and cached.status in ('unavailable', 'failed')
     and cached.retry_after is not null
     and cached.retry_after > now() then
    return query select
      'negative'::text, cached.status, cached.lines, cached.source,
      cached.error_code, cached.error_message, cached.error_retryable,
      cached.error_provider, cached.retry_after, null::uuid,
      cached.fetched_at, cached.updated_at;
    return;
  end if;

  if cached.status = 'fetching'
     and cached.lease_expires_at is not null
     and cached.lease_expires_at > now() then
    return query select
      'busy'::text, cached.status, cached.lines, cached.source,
      cached.error_code, cached.error_message, cached.error_retryable,
      cached.error_provider, cached.lease_expires_at, null::uuid,
      cached.fetched_at, cached.updated_at;
    return;
  end if;

  update public.video_transcript_cache as transcript_cache
  set status = 'fetching',
      lines = null,
      source = null,
      error_code = null,
      error_message = null,
      error_retryable = null,
      error_provider = null,
      retry_after = null,
      lease_token = new_lease,
      lease_expires_at = lease_until,
      attempt_count = transcript_cache.attempt_count + 1,
      updated_at = now()
  where transcript_cache.video_id = p_video_id
  returning * into cached;

  return query select
    'claimed'::text, cached.status, cached.lines, cached.source,
    cached.error_code, cached.error_message, cached.error_retryable,
    cached.error_provider, cached.lease_expires_at, cached.lease_token,
    cached.fetched_at, cached.updated_at;
end;
$$;

create or replace function public.finalize_video_transcript(
  p_video_id text,
  p_lease_token uuid,
  p_status text,
  p_lines jsonb,
  p_source text,
  p_error_code text,
  p_error_message text,
  p_error_retryable boolean,
  p_error_provider text,
  p_retry_after timestamptz
)
returns table (updated boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  if p_status not in ('ready', 'unavailable', 'failed') then
    raise exception 'invalid transcript status' using errcode = '22023';
  end if;
  if p_status = 'ready' and (
    p_source is null
    or p_source not in ('external', 'direct')
    or not coalesce(
      case
        when jsonb_typeof(p_lines) = 'array' then jsonb_array_length(p_lines) > 0
        else false
      end,
      false
    )
  ) then
    raise exception 'ready transcript requires lines and source' using errcode = '22023';
  end if;

  update public.video_transcript_cache as transcript_cache
  set status = p_status,
      lines = case when p_status = 'ready' then p_lines else null end,
      source = case when p_status = 'ready' then p_source else null end,
      error_code = case when p_status = 'ready' then null else p_error_code end,
      error_message = case when p_status = 'ready' then null else left(p_error_message, 1000) end,
      error_retryable = case when p_status = 'ready' then null else p_error_retryable end,
      error_provider = case when p_status = 'ready' then null else p_error_provider end,
      retry_after = case when p_status = 'ready' then null else p_retry_after end,
      lease_token = null,
      lease_expires_at = null,
      fetched_at = case when p_status = 'ready' then now() else transcript_cache.fetched_at end,
      updated_at = now()
  where transcript_cache.video_id = p_video_id
    and transcript_cache.status = 'fetching'
    and transcript_cache.lease_token = p_lease_token;

  get diagnostics affected = row_count;
  return query select affected = 1;
end;
$$;

revoke all on table public.video_transcript_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.video_transcript_cache to service_role;

revoke all on function public.claim_video_transcript(text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.claim_video_transcript(text, boolean, integer)
  to service_role;
revoke all on function public.finalize_video_transcript(text, uuid, text, jsonb, text, text, text, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_video_transcript(text, uuid, text, jsonb, text, text, text, boolean, text, timestamptz)
  to service_role;

alter table public.video_transcript_cache enable row level security;

commit;
