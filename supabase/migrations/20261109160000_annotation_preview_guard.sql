-- Annotation-aware preview-only guard. This changes no table structure.
-- Pre-existing unapplied proposals are expired, not deleted, because their
-- original source may already have been lost. The entire installation is one
-- transaction; a failed preflight or DDL statement leaves everything unchanged.
do $install$
declare
  owner_id oid; proxy_id regprocedure; outer_id regprocedure; old_id regprocedure;
  internal_name text; role_name text;
begin
  outer_id:=pg_catalog.to_regprocedure('public.scene_rpc(uuid,text,jsonb)');
  proxy_id:=pg_catalog.to_regprocedure('public.scene_rpc_before_agent(uuid,text,jsonb)');
  old_id:=pg_catalog.to_regprocedure('public.scene_rpc_before_agent_unguarded(uuid,text,jsonb)');
  if outer_id is null or proxy_id is null or old_id is null then raise exception 'ANNOTATION_GUARD_PREREQUISITE_MISSING'; end if;
  select p.proowner into owner_id from pg_catalog.pg_proc p where p.oid=outer_id;
  if owner_id is distinct from (select r.oid from pg_catalog.pg_roles r where r.rolname=current_user) then raise exception 'ANNOTATION_GUARD_UNEXPECTED_OWNER'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=outer_id and p.proowner=owner_id and not p.prosecdef and 'search_path=""'=any(p.proconfig)) or
     not exists(select 1 from pg_catalog.pg_proc p where p.oid=proxy_id and p.proowner=owner_id and p.prosecdef and 'search_path=""'=any(p.proconfig)) or
     not exists(select 1 from pg_catalog.pg_proc p where p.oid=old_id and p.proowner=owner_id and not p.prosecdef and 'search_path=""'=any(p.proconfig)) then
    raise exception 'ANNOTATION_GUARD_UNEXPECTED_FUNCTION';
  end if;
  foreach role_name in array array['service_role','anon','authenticated'] loop
    if pg_catalog.to_regrole(role_name) is null then raise exception 'ANNOTATION_GUARD_ROLE_MISSING'; end if;
    if pg_catalog.pg_has_role(role_name,owner_id,'MEMBER') then raise exception 'ANNOTATION_GUARD_UNSAFE_OWNER'; end if;
  end loop;
  if not pg_catalog.has_function_privilege('service_role',outer_id,'EXECUTE') or not pg_catalog.has_function_privilege('service_role',proxy_id,'EXECUTE') or
     pg_catalog.has_function_privilege('anon',outer_id,'EXECUTE') or pg_catalog.has_function_privilege('authenticated',outer_id,'EXECUTE') or
     pg_catalog.has_function_privilege('anon',proxy_id,'EXECUTE') or pg_catalog.has_function_privilege('authenticated',proxy_id,'EXECUTE') then
    raise exception 'ANNOTATION_GUARD_UNSAFE_PROXY';
  end if;
  foreach internal_name in array array['public.scene_rpc_before_agent_unguarded(uuid,text,jsonb)','public.scene_rpc_before_parametric(uuid,text,jsonb)',
    'public.scene_rpc_before_material_variants(uuid,text,jsonb)','public.scene_rpc_before_studio_delete(uuid,text,jsonb)',
    'public.scene_rpc_before_project_delete(uuid,text,jsonb)','public.scene_rpc_legacy(uuid,text,jsonb)'] loop
    old_id:=pg_catalog.to_regprocedure(internal_name);
    if old_id is null or not exists(select 1 from pg_catalog.pg_proc p where p.oid=old_id and p.proowner=owner_id) then raise exception 'ANNOTATION_GUARD_PREREQUISITE_MISSING'; end if;
    foreach role_name in array array['service_role','anon','authenticated'] loop
      if pg_catalog.has_function_privilege(role_name,old_id,'EXECUTE') then raise exception 'ANNOTATION_GUARD_UNSAFE_INTERNAL'; end if;
    end loop;
  end loop;
  -- Do not leave a deployment waiting indefinitely behind a live writer.
  perform pg_catalog.set_config('lock_timeout','10s',true);
  lock table scene_private.agent_runs,scene_private.agent_proposals,scene_private.projects,scene_private.proposals in access exclusive mode;

  execute $sql$create function scene_private.annotation_mark_proposal() returns trigger
  language plpgsql set search_path='' as $body$
  declare source jsonb; existing jsonb;
  begin
    select r.input into source from scene_private.agent_runs r where r.id=new.run_id for update;
    if not found or jsonb_typeof(source) is distinct from 'object' or ((source ? 'context') and jsonb_typeof(source->'context') is distinct from 'object') then raise exception 'ANNOTATION_SOURCE_UNKNOWN'; end if;
    if (source ? 'context') and (source->'context') ? 'annotationObservation' then
      select p.warnings into existing from scene_private.proposals p where p.id=new.proposal_id for update;
      if not found or jsonb_typeof(existing) is distinct from 'array' then raise exception 'ANNOTATION_SOURCE_UNKNOWN'; end if;
      if not exists(select 1 from pg_catalog.jsonb_array_elements(existing) w where w='{"code":"ANNOTATION_PREVIEW_ONLY","ids":[]}'::jsonb) then
        update scene_private.proposals set warnings=existing||'[{"code":"ANNOTATION_PREVIEW_ONLY","ids":[]}]'::jsonb where id=new.proposal_id;
      end if;
    end if;
    return new;
  end $body$;$sql$;
  execute 'create trigger annotation_mark_proposal after insert on scene_private.agent_proposals for each row execute function scene_private.annotation_mark_proposal()';

  execute $sql$create function scene_private.annotation_refresh_candidate_warnings() returns trigger
  language plpgsql set search_path='' as $body$
  declare entry jsonb; refreshed jsonb:='[]'::jsonb; authoritative jsonb;
  begin
    if jsonb_typeof(new.candidates) is distinct from 'array' then raise exception 'ANNOTATION_SOURCE_UNKNOWN'; end if;
    for entry in select value from pg_catalog.jsonb_array_elements(new.candidates) loop
      select p.warnings into authoritative from scene_private.proposals p join scene_private.agent_proposals l on l.proposal_id=p.id and l.run_id=new.id
        where p.id=(entry->'proposal'->>'id')::uuid and p.project_id=new.project_id and p.user_id=new.owner_id;
      if not found or jsonb_typeof(authoritative) is distinct from 'array' then raise exception 'ANNOTATION_SOURCE_UNKNOWN'; end if;
      refreshed:=refreshed||pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(entry,'{proposal,warnings}',authoritative,true));
    end loop;
    new.candidates:=refreshed;return new;
  end $body$;$sql$;
  execute 'create trigger annotation_refresh_candidate_warnings before update of candidates on scene_private.agent_runs for each row execute function scene_private.annotation_refresh_candidate_warnings()';

  execute $sql$create function scene_private.annotation_preserve_marker() returns trigger
  language plpgsql set search_path='' as $body$
  begin
    if old.expires_at<=clock_timestamp() and new.expires_at>old.expires_at then raise exception 'EXPIRED_PROPOSAL_IMMUTABLE'; end if;
    if jsonb_typeof(old.warnings)='array' and exists(select 1 from pg_catalog.jsonb_array_elements(old.warnings) w where w='{"code":"ANNOTATION_PREVIEW_ONLY","ids":[]}'::jsonb) then
      if jsonb_typeof(new.warnings) is distinct from 'array' or not exists(select 1 from pg_catalog.jsonb_array_elements(new.warnings) w where w='{"code":"ANNOTATION_PREVIEW_ONLY","ids":[]}'::jsonb) then raise exception 'ANNOTATION_MARKER_IMMUTABLE'; end if;
    end if;
    return new;
  end $body$;$sql$;
  execute 'create trigger annotation_preserve_marker before update of warnings,expires_at on scene_private.proposals for each row execute function scene_private.annotation_preserve_marker()';

  execute $sql$create or replace function public.scene_rpc_before_agent(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
  language plpgsql security definer set search_path='' as $body$
  declare r scene_private.agent_runs; marks jsonb; linked boolean:=false;
  begin
    if p_action='annotations.readiness' then
      perform public.scene_rpc_before_agent_unguarded(p_actor,'projects.get',p_data);
      return pg_catalog.jsonb_build_object('capability','annotation_preview_guard','version',1);
    end if;
    if p_action='proposals.apply' then
      select a.* into r from scene_private.agent_runs a join scene_private.agent_proposals l on l.run_id=a.id where l.proposal_id=(p_data->>'proposalId')::uuid for update of a;
      linked:=found;
      if linked and (r.state<>'complete' or not exists(select 1 from pg_catalog.jsonb_array_elements(r.candidates) c where c->'proposal'->>'id'=p_data->>'proposalId') or r.owner_id is distinct from p_actor or r.project_id is distinct from (p_data->>'projectId')::uuid) then raise exception 'STALE_PROPOSAL'; end if;
      perform 1 from scene_private.projects p where p.id=(p_data->>'projectId')::uuid for update;
      if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
      select p.warnings into marks from scene_private.proposals p where p.id=(p_data->>'proposalId')::uuid and p.project_id=(p_data->>'projectId')::uuid for update;
      if not found or jsonb_typeof(marks) is distinct from 'array' then raise exception 'ANNOTATION_SOURCE_UNKNOWN'; end if;
      if linked and (jsonb_typeof(r.input) is distinct from 'object' or ((r.input ? 'context') and jsonb_typeof(r.input->'context') is distinct from 'object')) then raise exception 'ANNOTATION_SOURCE_UNKNOWN'; end if;
      if (linked and (r.input ? 'context') and (r.input->'context') ? 'annotationObservation') or exists(select 1 from pg_catalog.jsonb_array_elements(marks) w where w='{"code":"ANNOTATION_PREVIEW_ONLY","ids":[]}'::jsonb) then raise exception 'ANNOTATION_PREVIEW_ONLY'; end if;
    end if;
    return public.scene_rpc_before_agent_unguarded(p_actor,p_action,p_data);
  end $body$;$sql$;
  update scene_private.proposals set expires_at=least(expires_at,clock_timestamp()) where applied_at is null;
end $install$;
