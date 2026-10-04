-- Packaged public scene references retain their fixed architecture and node identity.
-- Ordinary and unknown models still require an authorized cloud asset ID.
create or replace function scene_private.preset_node_count(preset text) returns integer
language sql immutable set search_path = '' as $$
  select case preset when 'gym' then 307 when 'popup' then 42 when 'bar' then 38
    when 'cafe' then 46 when 'conference' then 212 when 'lawn' then 135
    when 'market' then 57 when 'museum' then 23 when 'office' then 76
    when 'studio' then 24 else 0 end
$$;
alter table scene_private.projects drop constraint projects_scene_version_check;
alter table scene_private.projects add constraint projects_scene_version_check check(
  jsonb_typeof(scene->'objects') = 'array' and scene->>'schemaVersion' in ('1','2')
  and (not scene ? 'scenePreset' or scene_private.preset_node_count(scene->>'scenePreset') > 0)
  and jsonb_array_length(scene->'objects') <= case when scene_private.preset_node_count(scene->>'scenePreset') > 0 then 500 else 50 end
);
create or replace function scene_private.check_assets(actor uuid, doc jsonb) returns void
language plpgsql set search_path = '' as $$
declare o jsonb; aid uuid; preset_count integer := scene_private.preset_node_count(doc->>'scenePreset');
begin
  if (doc->>'schemaVersion') not in ('1','2') or jsonb_typeof(doc->'objects') is distinct from 'array' or jsonb_array_length(doc->'objects') > (case when preset_count > 0 then 500 else 50 end) or (doc ? 'scenePreset' and preset_count = 0) then raise exception 'INVALID_SCENE'; end if;
  for o in select value from jsonb_array_elements(doc->'objects') loop
    if o ? 'presetNode' then
      if o->>'materialId' is distinct from 'asset' or o ? 'assetId'
        or jsonb_typeof(o->'presetNode') is distinct from 'number'
        or (o->>'presetNode') !~ '^[0-9]+$'
        or (o->>'presetNode')::numeric >= preset_count then raise exception 'INVALID_PRESET_NODE'; end if;
    elsif o->>'materialId' = 'asset' then
      aid := (o->>'assetId')::uuid;
      if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format='glb') then raise exception 'ASSET_FORBIDDEN'; end if;
    elsif not exists(select 1 from scene_private.materials where id=o->>'materialId') or o ? 'assetId' then raise exception 'INVALID_MATERIAL';
    end if;
  end loop;
  if doc->'venue' ? 'floorplanAssetId' then
    aid := (doc->'venue'->>'floorplanAssetId')::uuid;
    if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format in ('png','jpeg','webp')) then raise exception 'ASSET_FORBIDDEN'; end if;
  end if;
  if doc->>'schemaVersion'='2' then
    if jsonb_typeof(doc->'structure'->'walls') is distinct from 'array' or jsonb_typeof(doc->'structure'->'openings') is distinct from 'array' or jsonb_typeof(doc->'structure'->'columns') is distinct from 'array' or jsonb_typeof(doc->'sources') is distinct from 'array' or jsonb_array_length(doc->'sources')>12 then raise exception 'INVALID_SCENE'; end if;
    for o in select value from jsonb_array_elements(doc->'sources') loop
      aid := (o->>'assetId')::uuid;
      if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format in ('png','jpeg','webp')) then raise exception 'ASSET_FORBIDDEN'; end if;
    end loop;
  end if;
end $$;

create or replace function scene_private.bill_of_materials(doc jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(g) order by g.name, g."materialId", g."assetId", g.size::text, g.color, g.notes),'[]'::jsonb) from (
    select o->>'materialId' as "materialId", o->>'assetId' as "assetId", coalesce(m.name,a.name,'预设物件 '||(o->>'presetNode')) as name,
      o->'size' as size, o->>'color' as color, coalesce(o->>'notes','') as notes,
      case when a.source='hunyuan' then '概念道具，实物待确认' else '' end as notice, count(*)::integer as quantity
    from jsonb_array_elements(doc->'objects') o
    left join scene_private.materials m on m.id=o->>'materialId'
    left join scene_private.assets a on a.id=(o->>'assetId')::uuid
    group by o->>'materialId',o->>'assetId',coalesce(m.name,a.name,'预设物件 '||(o->>'presetNode')),o->'size',o->>'color',coalesce(o->>'notes',''),a.source
  ) g
$$;
