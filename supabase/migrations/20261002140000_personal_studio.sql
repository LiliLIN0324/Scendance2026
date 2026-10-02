-- Give a confirmed new account its own workspace, never access to the demo studio.
create function scene_private.provision_personal_studio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  profile jsonb := to_jsonb(new);
  studio_id uuid;
  display_name text;
begin
  if profile->>'email_confirmed_at' is null or
     exists(select 1 from scene_private.members where user_id=new.id) then
    return new;
  end if;
  display_name := coalesce(nullif(left(btrim(profile->'raw_user_meta_data'->>'display_name'),80),''),'场景创作者');
  insert into scene_private.studios(name) values(display_name || '的工作室') returning id into studio_id;
  insert into scene_private.members(studio_id,user_id,role,display_name)
    values(studio_id,new.id,'owner',display_name);
  return new;
end $$;
revoke all on function scene_private.provision_personal_studio() from public,anon,authenticated;
create trigger provision_personal_studio after insert or update on auth.users
  for each row execute function scene_private.provision_personal_studio();

-- Backfill only confirmed accounts without any membership. The trigger is idempotent.
update auth.users as u set id=u.id where to_jsonb(u)->>'email_confirmed_at' is not null
  and not exists(select 1 from scene_private.members where user_id=u.id);
