create extension if not exists pgcrypto;

create schema if not exists app_private;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  target_count integer not null check (target_count > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on <= ends_on)
);

create table if not exists public.thank_you_events (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods (id) on delete restrict,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists periods_active_idx on public.periods (is_active, starts_on desc);
create index if not exists thank_you_events_period_created_idx
  on public.thank_you_events (period_id, created_at desc);
create index if not exists thank_you_events_period_user_idx
  on public.thank_you_events (period_id, user_id);

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        updated_at = now();

  return new;
end;
$$;

create or replace function app_private.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and status = 'active'
  );
$$;

create or replace function app_private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    and app_private.current_user_is_active();
$$;

revoke all on function app_private.touch_updated_at() from public, anon, authenticated;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
revoke all on function app_private.current_user_is_active() from public, anon, authenticated;
revoke all on function app_private.current_user_is_admin() from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.current_user_is_active() to authenticated;
grant execute on function app_private.current_user_is_admin() to authenticated;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function app_private.touch_updated_at();

drop trigger if exists periods_touch_updated_at on public.periods;
create trigger periods_touch_updated_at
before update on public.periods
for each row execute function app_private.touch_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function app_private.handle_new_user();

insert into public.profiles (id, email, display_name)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

insert into public.periods (name, starts_on, ends_on, target_count, is_active)
select '今期', current_date, (current_date + interval '3 months')::date, 1000, true
where not exists (select 1 from public.periods where is_active = true);

alter table public.profiles enable row level security;
alter table public.periods enable row level security;
alter table public.thank_you_events enable row level security;

drop policy if exists "profiles_select_for_active_users_or_self" on public.profiles;
create policy "profiles_select_for_active_users_or_self"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or app_private.current_user_is_active());

drop policy if exists "profiles_update_for_admins" on public.profiles;
create policy "profiles_update_for_admins"
on public.profiles
for update
to authenticated
using (app_private.current_user_is_admin())
with check (true);

drop policy if exists "periods_select_for_active_users" on public.periods;
create policy "periods_select_for_active_users"
on public.periods
for select
to authenticated
using (app_private.current_user_is_active());

drop policy if exists "periods_insert_for_admins" on public.periods;
create policy "periods_insert_for_admins"
on public.periods
for insert
to authenticated
with check (app_private.current_user_is_admin());

drop policy if exists "periods_update_for_admins" on public.periods;
create policy "periods_update_for_admins"
on public.periods
for update
to authenticated
using (app_private.current_user_is_admin())
with check (app_private.current_user_is_admin());

drop policy if exists "thank_you_events_select_for_active_users" on public.thank_you_events;
create policy "thank_you_events_select_for_active_users"
on public.thank_you_events
for select
to authenticated
using (app_private.current_user_is_active());

drop policy if exists "thank_you_events_insert_own_for_active_users" on public.thank_you_events;
create policy "thank_you_events_insert_own_for_active_users"
on public.thank_you_events
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
  and exists (
    select 1
    from public.periods
    where periods.id = thank_you_events.period_id
      and periods.is_active = true
  )
);

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.periods to authenticated;
grant select, insert on public.thank_you_events to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thank_you_events'
  ) then
    alter publication supabase_realtime add table public.thank_you_events;
  end if;
end;
$$;
