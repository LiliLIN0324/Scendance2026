-- Run after deployment. Store scene_project_url and scene_worker_secret in Vault first.
-- This file intentionally contains no secret values and is not an automatic migration.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if (select count(*) from vault.decrypted_secrets where name in ('scene_project_url','scene_worker_secret')) <> 2 then
    raise exception 'Configure exactly one scene_project_url and scene_worker_secret in Vault first';
  end if;
end $$;
select cron.schedule('scene-generation-poll','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='scene_project_url') || '/functions/v1/generation-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='scene_worker_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  );
$job$);
