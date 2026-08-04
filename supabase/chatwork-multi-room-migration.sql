-- Run this once in the Supabase SQL Editor before deploying the updated
-- chatwork-notification Edge Function.

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

create index if not exists chatwork_monthly_notifications_target_month_idx
  on public.chatwork_monthly_notifications (target_month desc);
