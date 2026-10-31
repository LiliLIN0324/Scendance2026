-- One grouping rule for the bill of materials. The agent runner and delivery
-- export share supabase/functions/_shared/bom.ts; this function implements the
-- same key over stored scenes: material, normalized asset UUID, preset node,
-- size, color, notes and material source. Normalizing the asset UUID keeps
-- casing aliases of one archival asset in a single procurement row.
create or replace function scene_private.bill_of_materials(doc jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(g) order by g.name, g."materialId", g."assetId", g.size::text, g.color, g.notes),'[]'::jsonb) from (
    select o->>'materialId' as "materialId", (o->>'assetId')::uuid as "assetId",
      coalesce(m.name,a.name,'预设物件 '||(o->>'presetNode')) as name,
      o->'size' as size, o->>'color' as color, coalesce(o->>'notes','') as notes,
      case when a.source='hunyuan' then '概念道具，实物待确认' else '' end as notice,
      count(*)::integer as quantity
    from jsonb_array_elements(doc->'objects') o
    left join scene_private.materials m on m.id=o->>'materialId'
    left join scene_private.assets a on a.id=(o->>'assetId')::uuid
    group by o->>'materialId',(o->>'assetId')::uuid,o->>'presetNode',
      coalesce(m.name,a.name,'预设物件 '||(o->>'presetNode')),o->'size',o->>'color',coalesce(o->>'notes',''),a.source
  ) g
$$;
