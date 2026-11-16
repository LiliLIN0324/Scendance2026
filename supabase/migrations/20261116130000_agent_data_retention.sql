-- Retention and account deletion for agent data.
--
-- `agent_runs.input` holds the full brief, up to 12 recent messages and a whole
-- scene snapshot; `proposals` holds base_scene + candidate. Nothing in the repo
-- ever removed them, and both `agent_runs.owner_id` and `proposals.user_id`
-- referenced auth.users with NO ACTION, so deleting an account failed.
--
-- This migration adds one explicit purge entry point and makes account deletion
-- keep the business record while dropping the person: owner/user become NULL.
-- Active runs are never touched; unexpired proposals are never touched.

create or replace function scene_private.purge_agent_data(p_keep_days integer default 30, p_proposal_grace_hours integer default 24)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_runs integer:=0; v_props integer:=0;
begin
  if p_keep_days is null or p_keep_days<1 or p_proposal_grace_hours is null or p_proposal_grace_hours<1 then
    raise exception 'INVALID_RETENTION';
  end if;
  -- Unexpired proposals may still be applied; keep them for the grace window
  -- after expiry so a late retry can still be explained.
  delete from scene_private.proposals p
    where p.applied_at is null
      and p.expires_at < clock_timestamp() - make_interval(hours=>p_proposal_grace_hours);
  get diagnostics v_props = row_count;
  -- Only terminal runs. queued/running rows are evidence of work in flight.
  delete from scene_private.agent_runs r
    where r.state in ('complete','failed','cancelled')
      and r.created_at < clock_timestamp() - make_interval(days=>p_keep_days);
  get diagnostics v_runs = row_count;
  return jsonb_build_object('runsDeleted',v_runs,'proposalsDeleted',v_props);
end $$;
revoke all on function scene_private.purge_agent_data(integer,integer) from public,anon,authenticated;
grant execute on function scene_private.purge_agent_data(integer,integer) to service_role;

-- Account deletion: keep the run/proposal rows for project history, drop the
-- personal identifier. Constraint names are the PostgreSQL defaults; both blocks
-- are idempotent so a re-run is safe.
do $$ begin
  if exists(select 1 from pg_constraint where conrelid='scene_private.agent_runs'::regclass
    and conname='agent_runs_owner_id_fkey' and confdeltype<>'n') then
    alter table scene_private.agent_runs drop constraint agent_runs_owner_id_fkey;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='scene_private.agent_runs'::regclass
    and conname='agent_runs_owner_id_fkey') then
    alter table scene_private.agent_runs alter column owner_id drop not null;
    alter table scene_private.agent_runs add constraint agent_runs_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete set null;
  end if;
end $$;

do $$ begin
  if exists(select 1 from pg_constraint where conrelid='scene_private.proposals'::regclass
    and conname='proposals_user_id_fkey' and confdeltype<>'n') then
    alter table scene_private.proposals drop constraint proposals_user_id_fkey;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='scene_private.proposals'::regclass
    and conname='proposals_user_id_fkey') then
    alter table scene_private.proposals alter column user_id drop not null;
    alter table scene_private.proposals add constraint proposals_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end $$;
