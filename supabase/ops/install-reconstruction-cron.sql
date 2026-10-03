-- Apply only after migration, API and reconstruction-worker deployment.
-- The independent worker secret must already exist in Vault and Edge secrets.
-- This does not enable the Hunyuan generation schedule or change either budget.
do $$ begin
  if (select count(*) from vault.decrypted_secrets where name in ('scene_project_url','scene_reconstruction_worker_secret')) <> 2 then
    raise exception 'Configure exactly one project URL and reconstruction worker secret in Vault first';
  end if;
end $$;
select cron.schedule('scene-reconstruction-poll','* * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='scene_project_url') || '/functions/v1/reconstruction-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='scene_reconstruction_worker_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 145000
  );
$job$);
