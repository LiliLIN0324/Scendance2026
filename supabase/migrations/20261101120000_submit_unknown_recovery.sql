-- submit_unknown is the conservative answer to an ambiguous paid submission: a lost response may
-- still follow a charge, so generation_jobs never auto-resubmits a job whose vendor task id was
-- never persisted. That part stays. What was missing is any way *out* of the state: it sits inside
-- generation_single_active_idx (20261002060307_scene_jobs.sql:27), so a single lost response locked
-- every later generation for that member with GENERATION_BUSY, forever.
--
-- Two terminal exits, both ending in state 'failed' and never in a resubmit:
--   * automatic: jobs.claim (the worker's only entry point) sweeps submit_unknown rows that have not
--     been touched for the grace window. The vendor task id is gone, so the ambiguity cannot be
--     resolved by polling; the fence is released and the user can try again as a new request.
--   * manual: jobs.resolve_unknown clears one job immediately, owner-scoped, for support to run once
--     the vendor usage page shows whether the lost request was actually billed.
--
-- Chain stays append-only: this validator wrapper -> job_rpc_generation_v2 (the aholo validator,
-- still owning jobs.create pinning) -> job_rpc_generation_v1 (the original jobs state machine).
alter function public.job_rpc(uuid,text,jsonb) rename to job_rpc_generation_v2;
create function public.job_rpc(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; j scene_private.generation_jobs;
begin
  if p_action='jobs.resolve_unknown' then
    if p_actor is null then raise exception 'FORBIDDEN'; end if;
    select * into j from scene_private.generation_jobs where id=(p_data->>'id')::uuid;
    if not found then raise exception 'JOB_NOT_FOUND'; end if;
    if j.owner_id is distinct from p_actor then raise exception 'FORBIDDEN'; end if;
    if j.state<>'submit_unknown' then raise exception 'INVALID_JOB_TRANSITION'; end if;
    update scene_private.generation_jobs set state='failed',error_code='SUBMIT_RESULT_UNKNOWN_CONFIRMED',
      worker_token=null,worker_until=null,updated_at=clock_timestamp()
      where id=j.id returning * into j;
    update scene_private.requests set state='failed' where id=j.id and state='unknown';
    return to_jsonb(j);
  end if;
  if p_action='jobs.claim' then
    -- The grace window leaves the "提交结果待核对" notice visible long enough to check usage, and is
    -- short enough that the global active-generation fence does not stay taken for a whole day.
    update scene_private.generation_jobs set state='failed',error_code='SUBMIT_RESULT_UNKNOWN_EXPIRED',
      worker_token=null,worker_until=null,updated_at=clock_timestamp()
      where state='submit_unknown' and updated_at<clock_timestamp()-interval '10 minutes';
    update scene_private.requests r set state='failed' from scene_private.generation_jobs g
      where g.id=r.id and g.state='failed' and g.error_code='SUBMIT_RESULT_UNKNOWN_EXPIRED' and r.state='unknown';
  end if;
  return public.job_rpc_generation_v2(p_actor,p_action,p_data);
end $$;
revoke all on function public.job_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.job_rpc(uuid,text,jsonb) to service_role;