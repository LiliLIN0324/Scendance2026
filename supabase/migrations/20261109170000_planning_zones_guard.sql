-- Planning-zone edit guard. No existing table columns or constraints change.
-- Rectangle v1 only. This migration does not enable the API or the frontend.
do $install$
declare proxy regprocedure; previous_save regprocedure; owner_id oid;
begin
  proxy:=pg_catalog.to_regprocedure('public.scene_rpc_before_agent(uuid,text,jsonb)');
  previous_save:=pg_catalog.to_regprocedure('scene_private.save_scene(uuid,jsonb,jsonb)');
  if proxy is null or previous_save is null or pg_catalog.to_regprocedure('scene_private.annotation_mark_proposal()') is null then raise exception 'PLANNING_ZONES_PREREQUISITE_MISSING'; end if;
  select p.proowner into owner_id from pg_catalog.pg_proc p where p.oid=proxy;
  if owner_id is distinct from (select r.oid from pg_catalog.pg_roles r where r.rolname=current_user) or
     not exists(select 1 from pg_catalog.pg_proc p where p.oid=proxy and p.proowner=owner_id and p.prosecdef and 'search_path=""'=any(p.proconfig)) or
     not exists(select 1 from pg_catalog.pg_proc p where p.oid=previous_save and p.proowner=owner_id and not p.prosecdef and 'search_path=""'=any(p.proconfig)) then
    raise exception 'PLANNING_ZONES_UNEXPECTED_FUNCTION';
  end if;

  execute $sql$create function scene_private.validate_planning_zones(doc jsonb) returns void
  language plpgsql immutable set search_path='' as $body$
  declare ext jsonb; zone jsonb; venue jsonb; ids text[]:=array[]::text[]; zid text; x numeric; z numeric; w numeric; d numeric; vw numeric; vd numeric;
  begin
    if jsonb_typeof(doc) is distinct from 'object' then raise exception 'PLANNING_ZONES_INVALID'; end if;
    if not (doc ? 'planningZones') then return; end if;
    ext:=doc->'planningZones';venue:=doc->'venue';
    if jsonb_typeof(ext) is distinct from 'object' or (ext-array['version','zones'])<>'{}'::jsonb or not (ext ?& array['version','zones']) or ext->'version'<>'1'::jsonb or jsonb_typeof(ext->'zones') is distinct from 'array' then raise exception 'PLANNING_ZONES_INVALID'; end if;
    if jsonb_array_length(ext->'zones')<1 or jsonb_array_length(ext->'zones')>32 or jsonb_typeof(venue) is distinct from 'object' or venue->>'shape' is distinct from 'rectangle' or jsonb_typeof(venue->'width') is distinct from 'number' or jsonb_typeof(venue->'depth') is distinct from 'number' then raise exception 'PLANNING_ZONES_INVALID'; end if;
    vw:=(venue->>'width')::numeric;vd:=(venue->>'depth')::numeric;
    if vw<=0 or vd<=0 or vw>200 or vd>200 then raise exception 'PLANNING_ZONES_INVALID'; end if;
    for zone in select value from pg_catalog.jsonb_array_elements(ext->'zones') loop
      if jsonb_typeof(zone) is distinct from 'object' or (zone-array['id','name','color','x','z','width','depth','zoneType','source'])<>'{}'::jsonb or not (zone ?& array['id','name','color','x','z','width','depth','source']) then raise exception 'PLANNING_ZONES_INVALID'; end if;
      if jsonb_typeof(zone->'id') is distinct from 'string' or jsonb_typeof(zone->'name') is distinct from 'string' or jsonb_typeof(zone->'color') is distinct from 'string' or jsonb_typeof(zone->'source') is distinct from 'string' or zone->>'source'<>'unverified' then raise exception 'PLANNING_ZONES_INVALID'; end if;
      zid:=zone->>'id';if length(btrim(zid))=0 or char_length(zid)>128 or char_length(zone->>'name')>200 or char_length(zone->>'color')>64 or zid=any(ids) then raise exception 'PLANNING_ZONES_INVALID'; end if;ids:=array_append(ids,zid);
      if (zone ? 'zoneType') and (jsonb_typeof(zone->'zoneType') is distinct from 'string' or zone->>'zoneType' not in ('roundtable','checkin','photo','rest','desk','reserved')) then raise exception 'PLANNING_ZONES_INVALID'; end if;
      if jsonb_typeof(zone->'x') is distinct from 'number' or jsonb_typeof(zone->'z') is distinct from 'number' or jsonb_typeof(zone->'width') is distinct from 'number' or jsonb_typeof(zone->'depth') is distinct from 'number' then raise exception 'PLANNING_ZONES_INVALID'; end if;
      x:=(zone->>'x')::numeric;z:=(zone->>'z')::numeric;w:=(zone->>'width')::numeric;d:=(zone->>'depth')::numeric;
      if x<0 or z<0 or w<=0 or d<=0 or trunc(x,9)<>x or trunc(z,9)<>z or trunc(w,9)<>w or trunc(d,9)<>d or x+w>vw or z+d>vd then raise exception 'PLANNING_ZONES_INVALID'; end if;
    end loop;
  end $body$;$sql$;

  execute $sql$create function scene_private.reject_planning_zones_on_create() returns trigger
  language plpgsql set search_path='' as $body$
  begin
    if new.scene ? 'planningZones' then raise exception 'PLANNING_ZONES_CREATE_UNSUPPORTED'; end if;
    return new;
  end $body$;$sql$;
  execute 'create trigger planning_zones_create_guard before insert on scene_private.projects for each row execute function scene_private.reject_planning_zones_on_create()';

  -- Existing public projections do not redact zones. Do not publish them silently.
  execute $sql$create function scene_private.reject_planning_zones_on_publish() returns trigger
  language plpgsql set search_path='' as $body$
  begin
    if new.scene ? 'planningZones' then raise exception 'PLANNING_ZONES_SHARING_UNSUPPORTED'; end if;
    return new;
  end $body$;$sql$;
  execute 'create trigger planning_zones_publish_guard before insert on scene_private.publications for each row execute function scene_private.reject_planning_zones_on_publish()';

  execute $sql$create or replace function scene_private.save_scene(actor uuid,input jsonb,doc jsonb) returns jsonb
  language plpgsql set search_path='' as $body$
  declare p scene_private.projects; edit jsonb; old_zones jsonb; new_zones jsonb;
  begin
    p:=scene_private.require_lease(actor,input);
    if p.scene->>'schemaVersion'='2' and doc->>'schemaVersion'='1' and input->>'restoreFromProposal' is null then raise exception 'SCHEMA_DOWNGRADE_FORBIDDEN'; end if;
    perform scene_private.validate_planning_zones(p.scene);
    perform scene_private.validate_planning_zones(doc);
    old_zones:=coalesce(p.scene->'planningZones','null'::jsonb);new_zones:=coalesce(doc->'planningZones','null'::jsonb);
    -- Proposal apply, history restore and original review must not redraw user zones, even with a proof.
    if old_zones is distinct from new_zones and (input ? 'restoreFromProposal' or input ? 'proposalId' or input ? 'candidateHash' or input->'scene' is distinct from doc) then raise exception 'PLANNING_ZONES_WRITE_PROTECTED'; end if;
    if old_zones is distinct from new_zones and not (input ? 'planningZonesEdit') then raise exception 'PLANNING_ZONES_EDIT_REQUIRED'; end if;
    if input ? 'planningZonesEdit' then
      edit:=input->'planningZonesEdit';
      if jsonb_typeof(edit) is distinct from 'object' or (edit-array['version','previous'])<>'{}'::jsonb or not (edit ?& array['version','previous']) or edit->'version'<>'1'::jsonb then raise exception 'PLANNING_ZONES_EDIT_INVALID'; end if;
      if edit->'previous' is distinct from old_zones then raise exception 'PLANNING_ZONES_STALE'; end if;
    end if;
    perform scene_private.check_assets(actor,doc);
    update scene_private.projects set scene=doc,revision=revision+1,updated_at=clock_timestamp() where id=p.id returning * into p;
    insert into scene_private.project_assets(project_id,asset_id)
      select p.id,(o->>'assetId')::uuid from jsonb_array_elements(doc->'objects') o where o ? 'assetId'
      union select p.id,(doc->'venue'->>'floorplanAssetId')::uuid where doc->'venue' ? 'floorplanAssetId'
      union select p.id,(o->>'assetId')::uuid from jsonb_array_elements(coalesce(doc->'sources','[]')) o
      on conflict do nothing;
    return jsonb_build_object('id',p.id,'revision',p.revision,'scene',p.scene,'updatedAt',p.updated_at);
  end $body$;$sql$;

  execute $sql$create or replace function public.scene_rpc_before_agent(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
  language plpgsql security definer set search_path='' as $body$
  declare r scene_private.agent_runs; marks jsonb; linked boolean:=false;
  begin
    if p_action in ('annotations.readiness','planning_zones.readiness') then
      perform public.scene_rpc_before_agent_unguarded(p_actor,'projects.get',p_data);
      if p_action='annotations.readiness' then return pg_catalog.jsonb_build_object('capability','annotation_preview_guard','version',1); end if;
      return pg_catalog.jsonb_build_object('capability','planning_zones','version',1);
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
end $install$;
