create extension if not exists pgcrypto;

create schema if not exists app_private;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  company_name text,
  avatar_url text,
  avatar_scale integer not null default 100 check (avatar_scale between 80 and 180),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists company_name text,
  add column if not exists avatar_url text,
  add column if not exists avatar_scale integer not null default 100;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_avatar_scale_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_scale_check
      check (avatar_scale between 80 and 180);
  end if;
end;
$$;

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
  kind text not null default 'thank_you' check (kind in ('thank_you', 'community_post')),
  message text,
  created_at timestamptz not null default now()
);

alter table public.thank_you_events
  add column if not exists kind text not null default 'thank_you',
  add column if not exists message text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.thank_you_events'::regclass
      and conname = 'thank_you_events_kind_message_check'
  ) then
    alter table public.thank_you_events
      add constraint thank_you_events_kind_message_check
      check (
        (kind = 'thank_you' and message is null)
        or (kind = 'community_post' and char_length(btrim(message)) between 1 and 500)
      );
  end if;
end;
$$;

create table if not exists public.thank_you_likes (
  event_id uuid not null references public.thank_you_events (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.thank_you_likes
  add column if not exists reaction text not null default 'like';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.thank_you_likes'::regclass
      and conname = 'thank_you_likes_pkey'
      and pg_get_constraintdef(oid) <> 'PRIMARY KEY (event_id, user_id, reaction)'
  ) then
    alter table public.thank_you_likes drop constraint thank_you_likes_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.thank_you_likes'::regclass
      and conname = 'thank_you_likes_pkey'
  ) then
    alter table public.thank_you_likes
      add constraint thank_you_likes_pkey primary key (event_id, user_id, reaction);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.thank_you_likes'::regclass
      and conname = 'thank_you_likes_reaction_check'
  ) then
    alter table public.thank_you_likes
      add constraint thank_you_likes_reaction_check
      check (reaction in ('like', 'love', 'clap', 'celebrate', 'thanks', 'strong', 'sparkle', 'heart_eyes'));
  end if;
end;
$$;

create table if not exists public.thank_you_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.thank_you_events (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.thank_you_adjustments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods (id) on delete restrict,
  admin_user_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  delta integer not null check (delta <> 0),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.chatwork_settings (
  id smallint primary key default 1 check (id = 1),
  api_token text,
  room_id text,
  rooms jsonb not null default '[]'::jsonb
    constraint chatwork_settings_rooms_array_check check (jsonb_typeof(rooms) = 'array'),
  enabled boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chatwork_monthly_notifications (
  id uuid primary key default gen_random_uuid(),
  target_month date not null,
  room_id text not null default '',
  room_name text,
  status text not null check (status in ('sent', 'failed')),
  cumulative_count integer check (cumulative_count >= 0),
  monthly_count integer check (monthly_count >= 0),
  message_body text not null,
  chatwork_message_id text,
  response jsonb,
  error_message text,
  sent_at timestamptz,
  triggered_by text check (triggered_by in ('admin', 'cron')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chatwork_monthly_notifications_target_month_room_id_key
    unique (target_month, room_id)
);

alter table public.chatwork_settings
  add column if not exists rooms jsonb not null default '[]'::jsonb;

update public.chatwork_settings
set rooms = '[]'::jsonb
where rooms is null;

alter table public.chatwork_settings
  alter column rooms set default '[]'::jsonb;

alter table public.chatwork_settings
  alter column rooms set not null;

update public.chatwork_settings
set rooms = jsonb_build_array(
  jsonb_build_object(
    'id', room_id,
    'name', 'ルーム ' || room_id,
    'roomId', room_id,
    'messageTemplate',
      E'[toall]\n[info][title]内容：ありがとう集計[/title]\n担当部署：CS/CX\n【通知内容】\n累計ありがとう：{{cumulativeTotal}}\n{{targetMonth}}のありがとう：{{monthlyTotal}}[/info]',
    'enabled', true
  )
)
where coalesce(jsonb_array_length(rooms), 0) = 0
  and room_id is not null
  and room_id <> '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chatwork_settings'::regclass
      and conname = 'chatwork_settings_rooms_array_check'
  ) then
    alter table public.chatwork_settings
      add constraint chatwork_settings_rooms_array_check
      check (jsonb_typeof(rooms) = 'array');
  end if;
end $$;

alter table public.chatwork_monthly_notifications
  add column if not exists room_id text;

alter table public.chatwork_monthly_notifications
  add column if not exists room_name text;

update public.chatwork_monthly_notifications
set room_id = coalesce(
  nullif(room_id, ''),
  (
    select nullif(settings.room_id, '')
    from public.chatwork_settings as settings
    where settings.id = 1
  ),
  'legacy'
)
where room_id is null or room_id = '';

alter table public.chatwork_monthly_notifications
  alter column room_id set default '';

alter table public.chatwork_monthly_notifications
  alter column room_id set not null;

do $$
begin
  alter table public.chatwork_monthly_notifications
    drop constraint if exists chatwork_monthly_notifications_target_month_key;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chatwork_monthly_notifications'::regclass
      and conname = 'chatwork_monthly_notifications_target_month_room_id_key'
  ) then
    alter table public.chatwork_monthly_notifications
      add constraint chatwork_monthly_notifications_target_month_room_id_key
      unique (target_month, room_id);
  end if;
end $$;

create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists periods_active_idx on public.periods (is_active, starts_on desc);
create index if not exists thank_you_events_period_created_idx
  on public.thank_you_events (period_id, created_at desc);
create index if not exists thank_you_events_period_user_idx
  on public.thank_you_events (period_id, user_id);
create index if not exists thank_you_events_user_idx
  on public.thank_you_events (user_id);
create index if not exists thank_you_events_kind_idx
  on public.thank_you_events (period_id, kind, created_at desc);
create index if not exists thank_you_likes_user_idx
  on public.thank_you_likes (user_id);
create index if not exists thank_you_comments_event_created_idx
  on public.thank_you_comments (event_id, created_at asc);
create index if not exists thank_you_comments_user_idx
  on public.thank_you_comments (user_id);
create index if not exists thank_you_adjustments_period_created_idx
  on public.thank_you_adjustments (period_id, created_at desc);
create index if not exists thank_you_adjustments_admin_user_idx
  on public.thank_you_adjustments (admin_user_id);
create index if not exists chatwork_monthly_notifications_created_idx
  on public.chatwork_monthly_notifications (created_at desc);
create index if not exists chatwork_monthly_notifications_target_month_idx
  on public.chatwork_monthly_notifications (target_month desc);

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
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
  insert into public.profiles (id, email, display_name, company_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'company_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        company_name = coalesce(public.profiles.company_name, excluded.company_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
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

drop trigger if exists chatwork_settings_touch_updated_at on public.chatwork_settings;
create trigger chatwork_settings_touch_updated_at
before update on public.chatwork_settings
for each row execute function app_private.touch_updated_at();

drop trigger if exists chatwork_monthly_notifications_touch_updated_at on public.chatwork_monthly_notifications;
create trigger chatwork_monthly_notifications_touch_updated_at
before update on public.chatwork_monthly_notifications
for each row execute function app_private.touch_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function app_private.handle_new_user();

insert into public.profiles (id, email, display_name, company_name, avatar_url)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1)),
  raw_user_meta_data ->> 'company_name',
  raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;

insert into public.periods (name, starts_on, ends_on, target_count, is_active)
select '今期', current_date, (current_date + interval '3 months')::date, 1000, true
where not exists (select 1 from public.periods where is_active = true);

alter table public.profiles enable row level security;
alter table public.periods enable row level security;
alter table public.thank_you_events enable row level security;
alter table public.thank_you_likes enable row level security;
alter table public.thank_you_comments enable row level security;
alter table public.thank_you_adjustments enable row level security;
alter table public.chatwork_settings enable row level security;
alter table public.chatwork_monthly_notifications enable row level security;

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
with check (app_private.current_user_is_admin());

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

drop policy if exists "thank_you_events_update_own_community_posts" on public.thank_you_events;
create policy "thank_you_events_update_own_community_posts"
on public.thank_you_events
for update
to authenticated
using (
  user_id = (select auth.uid())
  and kind = 'community_post'
  and app_private.current_user_is_active()
)
with check (
  user_id = (select auth.uid())
  and kind = 'community_post'
  and app_private.current_user_is_active()
);

drop policy if exists "thank_you_events_delete_own_community_posts" on public.thank_you_events;
create policy "thank_you_events_delete_own_community_posts"
on public.thank_you_events
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and kind = 'community_post'
  and app_private.current_user_is_active()
);

drop policy if exists "thank_you_adjustments_select_for_active_users" on public.thank_you_adjustments;
create policy "thank_you_adjustments_select_for_active_users"
on public.thank_you_adjustments
for select
to authenticated
using (app_private.current_user_is_active());

drop policy if exists "thank_you_likes_select_for_active_users" on public.thank_you_likes;
create policy "thank_you_likes_select_for_active_users"
on public.thank_you_likes
for select
to authenticated
using (app_private.current_user_is_active());

drop policy if exists "thank_you_likes_insert_own_for_active_users" on public.thank_you_likes;
create policy "thank_you_likes_insert_own_for_active_users"
on public.thank_you_likes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
);

drop policy if exists "thank_you_likes_delete_own_for_active_users" on public.thank_you_likes;
create policy "thank_you_likes_delete_own_for_active_users"
on public.thank_you_likes
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
);

drop policy if exists "thank_you_likes_update_own_for_active_users" on public.thank_you_likes;
create policy "thank_you_likes_update_own_for_active_users"
on public.thank_you_likes
for update
to authenticated
using (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
)
with check (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
);

drop policy if exists "thank_you_comments_select_for_active_users" on public.thank_you_comments;
create policy "thank_you_comments_select_for_active_users"
on public.thank_you_comments
for select
to authenticated
using (app_private.current_user_is_active());

drop policy if exists "thank_you_comments_insert_own_for_active_users" on public.thank_you_comments;
create policy "thank_you_comments_insert_own_for_active_users"
on public.thank_you_comments
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
);

drop policy if exists "thank_you_adjustments_insert_for_admins" on public.thank_you_adjustments;
create policy "thank_you_adjustments_insert_for_admins"
on public.thank_you_adjustments
for insert
to authenticated
with check (
  admin_user_id = (select auth.uid())
  and app_private.current_user_is_admin()
  and exists (
    select 1
    from public.periods
    where periods.id = thank_you_adjustments.period_id
      and periods.is_active = true
  )
);

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.periods to authenticated;
grant select, insert, update, delete on public.thank_you_events to authenticated;
grant select, insert, update, delete on public.thank_you_likes to authenticated;
grant select, insert on public.thank_you_comments to authenticated;
grant select, insert on public.thank_you_adjustments to authenticated;
revoke all on public.chatwork_settings from anon, authenticated;
revoke all on public.chatwork_monthly_notifications from anon, authenticated;

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

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thank_you_adjustments'
  ) then
    alter publication supabase_realtime add table public.thank_you_adjustments;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thank_you_likes'
  ) then
    alter publication supabase_realtime add table public.thank_you_likes;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thank_you_comments'
  ) then
    alter publication supabase_realtime add table public.thank_you_comments;
  end if;
end;
$$;
