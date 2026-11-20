-- Daily retention for agent runs, proposals and their child rows.
-- Mirrors install-generation-cron.sql: safe to install more than once.
create extension if not exists pg_cron;

do $$ begin
  if exists(select 1 from cron.job where jobname='agent-data-retention') then
    perform cron.unschedule('agent-data-retention');
  end if;
end $$;

-- 03:30 Asia/Shanghai. Keep 180 days of terminal runs and conversation turns, 24h of expired proposals.
select cron.schedule('agent-data-retention','30 3 * * *',$job$
  select scene_private.purge_agent_data(180,24);
$job$);
