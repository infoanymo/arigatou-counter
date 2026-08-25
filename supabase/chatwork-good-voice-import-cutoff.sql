-- Chatworkの「いいお声」は2026-08-25 00:00 JST以降のみ自動取り込みする。
-- 同日より前の自動取り込みデータだけを削除し、手動登録データは保持する。

begin;

create or replace function app_private.process_chatwork_good_voice_sync() returns integer
language plpgsql security definer
set search_path=public,app_private,extensions,net,pg_catalog
as $function$
declare
  req record;
  message jsonb;
  payload jsonb;
  raw_body text;
  voice_body text;
  message_id text;
  newest_message_id text;
  newest_send_time bigint;
  current_send_time bigint;
  imported integer:=0;
begin
  for req in
    select q.request_id,q.room_id,q.room_name,r.status_code,r.content
    from app_private.chatwork_good_voice_http_requests q
    join net._http_response r on r.id=q.request_id
    where q.processed_at is null
    order by q.created_at
  loop
    if req.status_code=200 then
      begin
        payload:=req.content::jsonb;
      exception when others then
        payload:='[]'::jsonb;
      end;

      if jsonb_typeof(payload)='array' then
        newest_message_id:=null;
        newest_send_time:=null;

        for message in select value from jsonb_array_elements(payload)
        loop
          message_id:=coalesce(message->>'message_id','');
          raw_body:=coalesce(message->>'body','');
          current_send_time:=coalesce((message->>'send_time')::bigint,0);

          if message_id<>'' and (newest_send_time is null or current_send_time>=newest_send_time) then
            newest_send_time:=current_send_time;
            newest_message_id:=message_id;
          end if;

          if message_id<>''
             and current_send_time >= extract(epoch from timestamptz '2026-08-25 00:00:00+09')::bigint
             and position('【お声共有】' in raw_body)>0 then
            voice_body:=split_part(split_part(raw_body,'【お声共有】',2),'[/info]',1);
            voice_body:=btrim(regexp_replace(voice_body,'\[/?(info|title)\]','','gi'));

            if voice_body<>'' then
              insert into public.chatwork_good_voices(
                chatwork_message_id,room_id,room_name,author_name,message_body,sent_at
              )
              values(
                message_id,
                req.room_id,
                req.room_name,
                nullif(message->'account'->>'name',''),
                voice_body,
                case when current_send_time>0 then to_timestamp(current_send_time) else now() end
              )
              on conflict(chatwork_message_id) do nothing;

              if found then
                imported:=imported+1;
              end if;
            end if;
          end if;
        end loop;

        if newest_message_id is not null then
          insert into public.chatwork_good_voice_sync_state(room_id,last_message_id,updated_at)
          values(req.room_id,newest_message_id,now())
          on conflict(room_id) do update
          set last_message_id=excluded.last_message_id,updated_at=excluded.updated_at;
        end if;
      end if;
    end if;

    update app_private.chatwork_good_voice_http_requests
    set processed_at=now()
    where request_id=req.request_id;
  end loop;

  delete from app_private.chatwork_good_voice_http_requests
  where processed_at is not null
    and created_at<now()-interval '7 days';

  return imported;
end
$function$;

delete from public.chatwork_good_voices
where chatwork_message_id is not null
  and sent_at < timestamptz '2026-08-25 00:00:00+09';

commit;
