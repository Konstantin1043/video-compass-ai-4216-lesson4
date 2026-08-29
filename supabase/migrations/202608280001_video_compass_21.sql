-- VideoCompass AI 2.1: durable jobs, shared cache, history, shares and limits.
-- Apply after 202608270001_auth_and_daily_credits.sql.

create extension if not exists pgcrypto;

create table if not exists public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null check (length(cache_key) between 20 and 180),
  video_id text not null check (length(video_id) = 11),
  canonical_url text not null,
  language text not null check (language in ('ru', 'en', 'lv')),
  model text not null,
  prompt_version text not null,
  status text not null default 'queued'
    check (status in ('queued', 'transcript_processing', 'transcript_ready', 'ai_processing', 'completed', 'failed', 'expired')),
  video_title text,
  video_author text,
  thumbnail_url text,
  transcript_text text,
  transcript_segments jsonb not null default '[]'::jsonb,
  transcript_original_characters integer not null default 0,
  transcript_sent_characters integer not null default 0,
  transcript_shortened boolean not null default false,
  analysis jsonb,
  analysis_text text,
  error_code text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  last_accessed_at timestamptz not null default now()
);

create index if not exists analysis_results_cache_idx
  on public.analysis_results (cache_key, status, completed_at desc);
create unique index if not exists analysis_results_active_cache_uniq
  on public.analysis_results (cache_key)
  where status in ('queued', 'transcript_processing', 'transcript_ready', 'ai_processing');
create index if not exists analysis_results_created_idx
  on public.analysis_results (created_at desc);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  result_id uuid not null references public.analysis_results(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'transcript_processing', 'transcript_ready', 'ai_processing', 'completed', 'failed', 'cancelled', 'expired')),
  credit_reserved boolean not null default false,
  cache_hit boolean not null default false,
  favorite boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  deleted_at timestamptz
);

create index if not exists analysis_jobs_user_created_idx
  on public.analysis_jobs (user_id, created_at desc) where deleted_at is null;
create index if not exists analysis_jobs_result_idx
  on public.analysis_jobs (result_id);

create table if not exists public.analysis_shares (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz
);

create index if not exists analysis_shares_owner_idx
  on public.analysis_shares (user_id, created_at desc);

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  scope text not null check (length(scope) between 2 and 48),
  key_hash text not null check (length(key_hash) = 64),
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_lookup_idx
  on public.rate_limit_events (scope, key_hash, created_at desc);

alter table public.analysis_results enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.analysis_shares enable row level security;
alter table public.rate_limit_events enable row level security;

drop policy if exists "Users can view own analysis jobs" on public.analysis_jobs;
create policy "Users can view own analysis jobs"
  on public.analysis_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can view own analysis shares" on public.analysis_shares;
create policy "Users can view own analysis shares"
  on public.analysis_shares for select to authenticated
  using ((select auth.uid()) = user_id);

-- The browser never reads shared results or rate events directly. All access
-- passes through the server, which uses a separate Secret key.
revoke all on public.analysis_results from public, anon, authenticated;
revoke all on public.analysis_jobs from public, anon, authenticated;
revoke all on public.analysis_shares from public, anon, authenticated;
revoke all on public.rate_limit_events from public, anon, authenticated;

-- The backend Secret key is translated by Supabase to the service_role role.
-- Grant only the data operations used by the server; browser roles remain revoked.
grant select, insert, update, delete on public.analysis_results to service_role;
grant select, insert, update, delete on public.analysis_jobs to service_role;
grant select, insert, update, delete on public.analysis_shares to service_role;
grant select, insert, update, delete on public.rate_limit_events to service_role;

create or replace function public.consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_oldest timestamptz;
begin
  if p_limit < 1 or p_limit > 500 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_RATE_LIMIT';
  end if;

  select count(*), min(created_at)
    into v_count, v_oldest
  from public.rate_limit_events
  where scope = p_scope
    and key_hash = p_key_hash
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    allowed := false;
    retry_after_seconds := greatest(1, ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))::integer);
    return next;
    return;
  end if;

  insert into public.rate_limit_events (scope, key_hash) values (p_scope, p_key_hash);
  allowed := true;
  retry_after_seconds := 0;
  return next;
end;
$$;

create or replace function public.claim_analysis_stage(p_result_id uuid)
returns table (claimed boolean, stage text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_locked_until timestamptz;
begin
  select status, locked_until into v_status, v_locked_until
  from public.analysis_results
  where id = p_result_id
  for update;

  if v_status is null then
    raise exception 'RESULT_NOT_FOUND';
  end if;

  if v_status in ('completed', 'failed', 'expired') then
    claimed := false;
    stage := v_status;
    return next;
    return;
  end if;

  if v_status in ('transcript_processing', 'ai_processing')
     and v_locked_until is not null and v_locked_until > now() then
    claimed := false;
    stage := v_status;
    return next;
    return;
  end if;

  if v_status in ('queued', 'transcript_processing') then
    stage := 'transcript_processing';
  else
    stage := 'ai_processing';
  end if;

  update public.analysis_results
  set status = stage, locked_until = now() + interval '5 minutes', updated_at = now()
  where id = p_result_id;
  update public.analysis_jobs
  set status = stage, updated_at = now()
  where result_id = p_result_id and deleted_at is null;

  claimed := true;
  return next;
end;
$$;

create or replace function public.save_transcript_stage(
  p_result_id uuid,
  p_video_title text,
  p_video_author text,
  p_thumbnail_url text,
  p_transcript_text text,
  p_transcript_segments jsonb,
  p_original_characters integer,
  p_sent_characters integer,
  p_shortened boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.analysis_results
  set status = 'transcript_ready',
      video_title = left(nullif(trim(p_video_title), ''), 300),
      video_author = left(nullif(trim(p_video_author), ''), 200),
      thumbnail_url = left(nullif(trim(p_thumbnail_url), ''), 600),
      transcript_text = left(coalesce(p_transcript_text, ''), 300000),
      transcript_segments = coalesce(p_transcript_segments, '[]'::jsonb),
      transcript_original_characters = greatest(0, p_original_characters),
      transcript_sent_characters = greatest(0, p_sent_characters),
      transcript_shortened = p_shortened,
      locked_until = null,
      updated_at = now(),
      last_accessed_at = now()
  where id = p_result_id and status = 'transcript_processing';

  if not found then raise exception 'INVALID_STAGE'; end if;

  update public.analysis_jobs
  set status = 'transcript_ready', updated_at = now()
  where result_id = p_result_id and deleted_at is null;
end;
$$;

create or replace function public.complete_analysis_stage(
  p_result_id uuid,
  p_analysis jsonb,
  p_analysis_text text,
  p_model text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.analysis_results
  set status = 'completed', analysis = p_analysis, analysis_text = p_analysis_text,
      model = p_model, error_code = null, locked_until = null,
      completed_at = now(), updated_at = now(), last_accessed_at = now()
  where id = p_result_id and status = 'ai_processing';
  if not found then raise exception 'INVALID_STAGE'; end if;

  update public.analysis_jobs
  set status = 'completed', error_code = null, completed_at = now(), updated_at = now()
  where result_id = p_result_id and deleted_at is null;

  update public.credit_events e
  set status = 'consumed', updated_at = now()
  from public.analysis_jobs j
  where j.result_id = p_result_id and j.request_id = e.request_id
    and j.credit_reserved and e.status = 'reserved';
end;
$$;

create or replace function public.fail_analysis_stage(p_result_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_refund record;
begin
  update public.analysis_results
  set status = 'failed', error_code = left(coalesce(p_error_code, 'UNEXPECTED_ERROR'), 80),
      locked_until = null, updated_at = now()
  where id = p_result_id and status not in ('completed', 'failed', 'expired');

  update public.analysis_jobs
  set status = 'failed', error_code = left(coalesce(p_error_code, 'UNEXPECTED_ERROR'), 80), updated_at = now()
  where result_id = p_result_id and deleted_at is null and status <> 'completed';

  for v_refund in
    select e.request_id, e.user_id
    from public.credit_events e
    join public.analysis_jobs j on j.request_id = e.request_id
    where j.result_id = p_result_id and j.credit_reserved and e.status = 'reserved'
    for update of e
  loop
    update public.credit_events set status = 'refunded', updated_at = now()
    where request_id = v_refund.request_id and status = 'reserved';
    update public.profiles set credits = least(10, credits + 1), updated_at = now()
    where user_id = v_refund.user_id;
  end loop;
end;
$$;

create or replace function public.count_external_analyses_since(p_since timestamptz)
returns bigint
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select count(*)
  from public.analysis_results
  where created_at >= p_since
    and status <> 'expired';
$$;

create or replace function public.cleanup_video_compass()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jobs integer := 0;
  v_results integer := 0;
  v_shares integer := 0;
  v_limits integer := 0;
  v_stale record;
begin
  for v_stale in
    select id from public.analysis_results
    where status not in ('completed', 'failed', 'expired')
      and updated_at < now() - interval '24 hours'
  loop
    perform public.fail_analysis_stage(v_stale.id, 'JOB_EXPIRED');
    update public.analysis_results set status = 'expired' where id = v_stale.id;
  end loop;

  delete from public.analysis_shares
  where expires_at < now() or (revoked_at is not null and revoked_at < now() - interval '7 days');
  get diagnostics v_shares = row_count;

  with ranked as (
    select id, row_number() over (partition by user_id order by created_at desc) as position
    from public.analysis_jobs where deleted_at is null and favorite = false
  )
  update public.analysis_jobs j
  set deleted_at = now(), status = case when status = 'completed' then status else 'expired' end
  from ranked r
  where j.id = r.id and (j.created_at < now() - interval '30 days' or r.position > 30);
  get diagnostics v_jobs = row_count;

  delete from public.analysis_results r
  where r.updated_at < now() - interval '24 hours'
    and not exists (select 1 from public.analysis_jobs j where j.result_id = r.id and j.deleted_at is null);
  get diagnostics v_results = row_count;

  delete from public.rate_limit_events where created_at < now() - interval '24 hours';
  get diagnostics v_limits = row_count;

  return jsonb_build_object('jobs', v_jobs, 'results', v_results, 'shares', v_shares, 'limits', v_limits);
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_analysis_stage(uuid) from public, anon, authenticated;
revoke all on function public.save_transcript_stage(uuid, text, text, text, text, jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.complete_analysis_stage(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.fail_analysis_stage(uuid, text) from public, anon, authenticated;
revoke all on function public.count_external_analyses_since(timestamptz) from public, anon, authenticated;
revoke all on function public.cleanup_video_compass() from public, anon, authenticated;

grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.claim_analysis_stage(uuid) to service_role;
grant execute on function public.save_transcript_stage(uuid, text, text, text, text, jsonb, integer, integer, boolean) to service_role;
grant execute on function public.complete_analysis_stage(uuid, jsonb, text, text) to service_role;
grant execute on function public.fail_analysis_stage(uuid, text) to service_role;
grant execute on function public.count_external_analyses_since(timestamptz) to service_role;
grant execute on function public.cleanup_video_compass() to service_role;
