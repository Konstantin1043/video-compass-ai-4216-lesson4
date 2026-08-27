-- VideoCompass AI: профили, ежедневные кредиты и атомарное списание.
-- Выполните файл один раз в Supabase SQL Editor.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 10 check (credits between 0 and 10),
  credit_day date not null default ((now() at time zone 'Europe/Riga')::date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_events (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null check (length(video_id) = 11),
  language text not null check (language in ('ru', 'en', 'lv')),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_events_user_created_idx
  on public.credit_events (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.credit_events enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can view own credit events" on public.credit_events;
create policy "Users can view own credit events"
  on public.credit_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.get_credit_status()
returns table (credits_remaining integer, next_reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Riga')::date;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  update public.profiles as p
  set credits = 10, credit_day = v_today, updated_at = now()
  where p.user_id = v_user_id and p.credit_day < v_today;

  select p.credits
  into credits_remaining
  from public.profiles as p
  where p.user_id = v_user_id;

  next_reset_at := ((v_today + 1)::timestamp at time zone 'Europe/Riga');
  return next;
end;
$$;

create or replace function public.reserve_analysis_credit(
  p_request_id uuid,
  p_video_id text,
  p_language text
)
returns table (credits_remaining integer, next_reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Riga')::date;
  v_credits integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_language not in ('ru', 'en', 'lv') or length(p_video_id) <> 11 then
    raise exception 'INVALID_ANALYSIS_REQUEST';
  end if;
  if exists (select 1 from public.credit_events where request_id = p_request_id) then
    raise exception 'DUPLICATE_REQUEST';
  end if;

  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select p.credits
  into v_credits
  from public.profiles as p
  where p.user_id = v_user_id
  for update;

  update public.profiles as p
  set credits = 10, credit_day = v_today, updated_at = now()
  where p.user_id = v_user_id and p.credit_day < v_today
  returning p.credits into v_credits;

  if v_credits <= 0 then
    raise exception 'NO_CREDITS';
  end if;

  update public.profiles as p
  set credits = p.credits - 1, updated_at = now()
  where p.user_id = v_user_id
  returning p.credits into credits_remaining;

  insert into public.credit_events (request_id, user_id, video_id, language)
  values (p_request_id, v_user_id, p_video_id, p_language);

  next_reset_at := ((v_today + 1)::timestamp at time zone 'Europe/Riga');
  return next;
end;
$$;

create or replace function public.commit_analysis_credit(p_request_id uuid)
returns table (credits_remaining integer, next_reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Riga')::date;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.credit_events as e
  set status = 'consumed', updated_at = now()
  where e.request_id = p_request_id
    and e.user_id = v_user_id
    and e.status = 'reserved';

  update public.profiles as p
  set credits = 10, credit_day = v_today, updated_at = now()
  where p.user_id = v_user_id and p.credit_day < v_today;

  select p.credits
  into credits_remaining
  from public.profiles as p
  where p.user_id = v_user_id;

  if credits_remaining is null then
    raise exception 'ANALYSIS_REQUEST_NOT_FOUND';
  end if;

  next_reset_at := ((v_today + 1)::timestamp at time zone 'Europe/Riga');
  return next;
end;
$$;

create or replace function public.refund_analysis_credit(p_request_id uuid)
returns table (credits_remaining integer, next_reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Riga')::date;
  v_refunded uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.profiles as p
  set credits = 10, credit_day = v_today, updated_at = now()
  where p.user_id = v_user_id and p.credit_day < v_today;

  update public.credit_events as e
  set status = 'refunded', updated_at = now()
  where e.request_id = p_request_id
    and e.user_id = v_user_id
    and e.status = 'reserved'
  returning e.request_id into v_refunded;

  if v_refunded is not null then
    update public.profiles as p
    set credits = least(10, p.credits + 1), updated_at = now()
    where p.user_id = v_user_id;
  end if;

  select p.credits
  into credits_remaining
  from public.profiles as p
  where p.user_id = v_user_id;

  next_reset_at := ((v_today + 1)::timestamp at time zone 'Europe/Riga');
  return next;
end;
$$;

revoke all on function public.get_credit_status() from public, anon;
revoke all on function public.create_profile_for_new_user() from public, anon;
revoke all on function public.reserve_analysis_credit(uuid, text, text) from public, anon;
revoke all on function public.commit_analysis_credit(uuid) from public, anon;
revoke all on function public.refund_analysis_credit(uuid) from public, anon;

grant execute on function public.get_credit_status() to authenticated;
grant execute on function public.reserve_analysis_credit(uuid, text, text) to authenticated;
grant execute on function public.commit_analysis_credit(uuid) to authenticated;
grant execute on function public.refund_analysis_credit(uuid) to authenticated;
grant select on public.profiles to authenticated;
grant select on public.credit_events to authenticated;
