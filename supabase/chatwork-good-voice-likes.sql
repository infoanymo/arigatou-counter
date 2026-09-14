create table if not exists public.chatwork_good_voice_likes (
  voice_id uuid not null references public.chatwork_good_voices (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (voice_id, user_id)
);

alter table public.chatwork_good_voice_likes enable row level security;

drop policy if exists "chatwork_good_voice_likes_select_for_active_users" on public.chatwork_good_voice_likes;
create policy "chatwork_good_voice_likes_select_for_active_users"
on public.chatwork_good_voice_likes
for select
to authenticated
using (app_private.current_user_is_active());

drop policy if exists "chatwork_good_voice_likes_insert_own_for_active_users" on public.chatwork_good_voice_likes;
create policy "chatwork_good_voice_likes_insert_own_for_active_users"
on public.chatwork_good_voice_likes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
);

drop policy if exists "chatwork_good_voice_likes_delete_own_for_active_users" on public.chatwork_good_voice_likes;
create policy "chatwork_good_voice_likes_delete_own_for_active_users"
on public.chatwork_good_voice_likes
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and app_private.current_user_is_active()
);

grant select, insert, delete on public.chatwork_good_voice_likes to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chatwork_good_voice_likes'
  ) then
    alter publication supabase_realtime add table public.chatwork_good_voice_likes;
  end if;
end;
$$;
