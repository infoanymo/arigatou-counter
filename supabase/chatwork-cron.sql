-- Run this in the Supabase SQL Editor after deploying chatwork-notification.
-- It sends the previous month's thank-you summary at 09:00 JST on the 3rd of every month.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  project_url_secret_id uuid;
  service_key_secret_id uuid;
begin
  select id
    into project_url_secret_id
  from vault.secrets
  where name = 'okiari_project_url';

  if project_url_secret_id is null then
    perform vault.create_secret(
      'https://vvyvwexipecuvxuoquci.supabase.co',
      'okiari_project_url',
      'Okiari Supabase project URL for monthly Chatwork notification'
    );
  else
    perform vault.update_secret(
      project_url_secret_id,
      'https://vvyvwexipecuvxuoquci.supabase.co',
      'okiari_project_url',
      'Okiari Supabase project URL for monthly Chatwork notification'
    );
  end if;

  select id
    into service_key_secret_id
  from vault.secrets
  where name = 'okiari_service_role_key';

  if service_key_secret_id is null then
    perform vault.create_secret(
      'PASTE_SUPABASE_SERVICE_ROLE_OR_SECRET_KEY_HERE',
      'okiari_service_role_key',
      'Okiari Supabase service key for monthly Chatwork notification'
    );
  else
    perform vault.update_secret(
      service_key_secret_id,
      'PASTE_SUPABASE_SERVICE_ROLE_OR_SECRET_KEY_HERE',
      'okiari_service_role_key',
      'Okiari Supabase service key for monthly Chatwork notification'
    );
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'okiari-chatwork-monthly-thank-you'
  ) then
    perform cron.unschedule('okiari-chatwork-monthly-thank-you');
  end if;
end;
$$;

select cron.schedule(
  'okiari-chatwork-monthly-thank-you',
  '0 0 3 * *',
  $$
  select
    net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'okiari_project_url'
      ) || '/functions/v1/chatwork-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'okiari_service_role_key'
        ),
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'okiari_service_role_key'
        )
      ),
      body := jsonb_build_object('action', 'send-monthly')
    ) as request_id;
  $$
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'okiari-chatwork-good-voices') then
    perform cron.unschedule('okiari-chatwork-good-voices');
  end if;
end;
$$;

-- 5分ごとにChatworkの新着メッセージを確認し、設定キーワードに一致する声を保存する。
select cron.schedule(
  'okiari-chatwork-good-voices',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'okiari_project_url') || '/functions/v1/chatwork-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'okiari_service_role_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'okiari_service_role_key')
    ),
    body := jsonb_build_object('action', 'sync-good-voices')
  ) as request_id;
  $$
);
