create schema if not exists scene_private;
revoke all on schema scene_private from public, anon, authenticated;
grant usage on schema scene_private to service_role;

create table scene_private.studios (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 120)
);
create table scene_private.members (
  studio_id uuid references scene_private.studios on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  display_name text not null check (length(display_name) between 1 and 80),
  primary key (studio_id, user_id)
);
create index members_user_idx on scene_private.members (user_id, studio_id);
create table scene_private.projects (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references scene_private.studios,
  created_by uuid not null references auth.users,
  name text not null check (length(name) between 1 and 120),
  scene jsonb not null, revision bigint not null default 0,
  lease_user uuid references auth.users, lease_session uuid,
  lease_generation bigint not null default 0, lease_expires timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (jsonb_typeof(scene->'objects') = 'array' and jsonb_array_length(scene->'objects') <= 50 and scene->>'schemaVersion' = '1')
);
create index projects_studio_updated_idx on scene_private.projects (studio_id, updated_at desc);
create table scene_private.materials (id text primary key, name text not null, size jsonb not null);
insert into scene_private.materials values
 ('chair','椅子','{"width":0.5,"depth":0.5,"height":0.85}'),
 ('table','桌子','{"width":1.2,"depth":0.6,"height":0.75}'),
 ('reception','签到台','{"width":1.8,"depth":0.6,"height":1}'),
 ('backdrop','背景板','{"width":3,"depth":0.15,"height":2.4}'),
 ('display','展架','{"width":0.8,"depth":0.4,"height":1.8}'),
 ('partition','隔断','{"width":1.2,"depth":0.1,"height":1.8}'),
 ('carpet','地毯','{"width":2,"depth":3,"height":0.01}'),
 ('decoration','装饰道具','{"width":0.4,"depth":0.4,"height":0.6}');
create table scene_private.assets (
  id uuid primary key, owner_id uuid not null references auth.users,
  name text not null check (length(name) between 1 and 120),
  source text not null check (source in ('hunyuan', 'polyhaven', 'upload')),
  source_id text, source_url text, license jsonb not null,
  storage_path text not null unique,
  format text not null check (format in ('glb', 'png', 'jpeg')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index assets_owner_idx on scene_private.assets (owner_id, created_at desc);
create table scene_private.project_assets (
  project_id uuid references scene_private.projects on delete cascade,
  asset_id uuid references scene_private.assets,
  primary key (project_id, asset_id)
);
create index project_assets_asset_idx on scene_private.project_assets (asset_id, project_id);
create table scene_private.publications (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references scene_private.projects,
  revision bigint not null, name text not null, scene jsonb not null, materials jsonb not null,
  asset_ids uuid[] not null, created_by uuid not null references auth.users, created_at timestamptz not null default now()
);
create index publications_project_idx on scene_private.publications (project_id, created_at desc);
create table scene_private.shares (
  id uuid primary key default gen_random_uuid(), publication_id uuid not null references scene_private.publications,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'), revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index shares_publication_idx on scene_private.shares (publication_id);
create table scene_private.proposals (
  id uuid primary key, project_id uuid not null references scene_private.projects,
  user_id uuid not null references auth.users, session_id uuid not null, generation bigint not null,
  base_revision bigint not null, local_revision bigint not null, base_hash text not null,
  base_scene jsonb not null, candidate jsonb not null, explanation text not null, warnings jsonb not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'), applied_at timestamptz
);
create index proposals_project_idx on scene_private.proposals (project_id);

create function scene_private.is_member(actor uuid, studio uuid) returns boolean
language sql stable set search_path = '' as $$
  select actor is not null and exists(select 1 from scene_private.members where studio_id = studio and user_id = actor)
$$;
create function scene_private.can_use_asset(actor uuid, asset uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from scene_private.assets a where a.id = asset and
    (a.owner_id = actor or exists(select 1 from scene_private.project_assets pa
      join scene_private.projects p on p.id = pa.project_id
      where pa.asset_id = a.id and scene_private.is_member(actor,p.studio_id))))
$$;
create function scene_private.check_assets(actor uuid, doc jsonb) returns void
language plpgsql set search_path = '' as $$
declare o jsonb; aid uuid;
begin
  if doc->>'schemaVersion' is distinct from '1' or jsonb_typeof(doc->'objects') is distinct from 'array' or jsonb_array_length(doc->'objects') > 50 then raise exception 'INVALID_SCENE'; end if;
  for o in select value from jsonb_array_elements(doc->'objects') loop
    if o->>'materialId' = 'asset' then
      aid := (o->>'assetId')::uuid;
      if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format='glb') then raise exception 'ASSET_FORBIDDEN'; end if;
    elsif not exists(select 1 from scene_private.materials where id=o->>'materialId') or o ? 'assetId' then raise exception 'INVALID_MATERIAL';
    end if;
  end loop;
  if doc->'venue' ? 'floorplanAssetId' then
    aid := (doc->'venue'->>'floorplanAssetId')::uuid;
    if not scene_private.can_use_asset(actor,aid) or not exists(select 1 from scene_private.assets where id=aid and format in ('png','jpeg')) then raise exception 'ASSET_FORBIDDEN'; end if;
  end if;
end $$;
create function scene_private.bill_of_materials(doc jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(g) order by g.name, g."materialId", g."assetId", g.size::text, g.color, g.notes),'[]'::jsonb) from (
    select o->>'materialId' as "materialId", o->>'assetId' as "assetId", coalesce(m.name,a.name) as name,
      o->'size' as size, o->>'color' as color, coalesce(o->>'notes','') as notes,
      case when a.source='hunyuan' then '概念道具，实物待确认' else '' end as notice, count(*)::integer as quantity
    from jsonb_array_elements(doc->'objects') o
    left join scene_private.materials m on m.id=o->>'materialId'
    left join scene_private.assets a on a.id=(o->>'assetId')::uuid
    group by o->>'materialId',o->>'assetId',coalesce(m.name,a.name),o->'size',o->>'color',coalesce(o->>'notes',''),a.source
  ) g
$$;
create function scene_private.public_scene(doc jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_set(jsonb_set(doc,'{venue}',(doc->'venue')-'floorplanAssetId'),'{objects}',
    coalesce((select jsonb_agg(o-'notes') from jsonb_array_elements(doc->'objects') o),'[]'))
$$;
create function scene_private.public_materials(items jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(spec || jsonb_build_object('quantity',quantity) order by spec::text),'[]'::jsonb)
  from (select item-'notes'-'quantity' as spec,sum((item->>'quantity')::integer) as quantity
    from jsonb_array_elements(items) item group by item-'notes'-'quantity') grouped
$$;
create function scene_private.immutable_publication() returns trigger
language plpgsql set search_path = '' as $$ begin raise exception 'IMMUTABLE_PUBLICATION'; end $$;
create trigger publication_immutable before update or delete on scene_private.publications for each row execute function scene_private.immutable_publication();

create function scene_private.require_lease(actor uuid, input jsonb, check_revision boolean default true)
returns scene_private.projects language plpgsql set search_path = '' as $$
declare p scene_private.projects;
begin
  select * into p from scene_private.projects where id=(input->>'projectId')::uuid for update;
  if not found or not scene_private.is_member(actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p.lease_user is distinct from actor or p.lease_session is distinct from (input->>'sessionId')::uuid or
    p.lease_generation is distinct from (input->>'generation')::bigint or p.lease_expires is null or p.lease_expires <= clock_timestamp() then raise exception 'LEASE_LOST'; end if;
  if check_revision and p.revision is distinct from (input->>'expectedRevision')::bigint then raise exception 'REVISION_CONFLICT'; end if;
  return p;
end $$;
create function scene_private.save_scene(actor uuid, input jsonb, doc jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare p scene_private.projects;
begin
  p := scene_private.require_lease(actor,input);
  perform scene_private.check_assets(actor,doc);
  update scene_private.projects set scene=doc, revision=revision+1, updated_at=clock_timestamp() where id=p.id returning * into p;
  -- Reference grants survive removal so immutable publications keep their resource access.
  insert into scene_private.project_assets(project_id,asset_id)
    select p.id,(o->>'assetId')::uuid from jsonb_array_elements(doc->'objects') o where o ? 'assetId'
    union select p.id,(doc->'venue'->>'floorplanAssetId')::uuid where doc->'venue' ? 'floorplanAssetId'
    on conflict do nothing;
  return jsonb_build_object('id',p.id,'revision',p.revision,'scene',p.scene,'updatedAt',p.updated_at);
end $$;

-- Only service_role can execute this invoker function. The Edge handler verifies the JWT
-- with Auth.getUser() and supplies actor; clients cannot supply a trusted actor themselves.
create function public.scene_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p scene_private.projects; pub scene_private.publications; s scene_private.shares;
  proposal scene_private.proposals; a scene_private.assets; result jsonb; aid uuid;
begin
  if p_action = 'share.read' then
    select * into s from scene_private.shares where token_hash=p_data->>'tokenHash' and revoked_at is null;
    if not found then raise exception 'SHARE_NOT_FOUND'; end if;
    select * into pub from scene_private.publications where id=s.publication_id;
    return jsonb_build_object('publicationId',pub.id,'name',pub.name,'revision',pub.revision,'createdAt',pub.created_at,
      'scene',scene_private.public_scene(pub.scene),
      'materials',scene_private.public_materials(pub.materials),
      'assets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'storagePath',storage_path,'metadata',metadata,'source',source,'sourceUrl',source_url,'license',license)) from scene_private.assets where id=any(pub.asset_ids)),'[]'));
  end if;
  if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_action = 'studios' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'name',st.name,'role',m.role,'displayName',m.display_name)) from scene_private.studios st join scene_private.members m on m.studio_id=st.id where m.user_id=p_actor),'[]');
  elsif p_action = 'projects.list' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (select pr.id,pr.name,pr.studio_id,pr.revision,pr.updated_at,
      case when pr.lease_expires>clock_timestamp() then m.display_name end as current_editor,pr.lease_expires
      from scene_private.projects pr left join scene_private.members m on m.studio_id=pr.studio_id and m.user_id=pr.lease_user
      where scene_private.is_member(p_actor,pr.studio_id) order by pr.updated_at desc limit 100) x),'[]');
  elsif p_action = 'projects.create' then
    if not scene_private.is_member(p_actor,(p_data->>'studioId')::uuid) then raise exception 'FORBIDDEN'; end if;
    perform scene_private.check_assets(p_actor,p_data->'scene');
    insert into scene_private.projects(studio_id,created_by,name,scene) values ((p_data->>'studioId')::uuid,p_actor,p_data->>'name',p_data->'scene') returning * into p;
    insert into scene_private.project_assets select p.id,(o->>'assetId')::uuid from jsonb_array_elements(p.scene->'objects') o where o ? 'assetId'
      union select p.id,(p.scene->'venue'->>'floorplanAssetId')::uuid where p.scene->'venue' ? 'floorplanAssetId' on conflict do nothing;
    return to_jsonb(p);
  elsif p_action = 'assets.list' then
    return coalesce((select jsonb_agg(to_jsonb(x)-'storage_path') from (select * from scene_private.assets where owner_id=p_actor order by created_at desc limit 100) x),'[]');
  elsif p_action = 'assets.get' then
    aid := (p_data->>'assetId')::uuid;
    if not scene_private.can_use_asset(p_actor,aid) then raise exception 'ASSET_NOT_FOUND'; end if;
    select * into a from scene_private.assets where id=aid; return to_jsonb(a);
  elsif p_action = 'assets.register' then
    if not exists(select 1 from scene_private.members where user_id=p_actor) then raise exception 'FORBIDDEN'; end if;
    insert into scene_private.assets(id,owner_id,name,source,source_id,source_url,license,storage_path,format,byte_size,sha256,metadata)
      values ((p_data->>'id')::uuid,p_actor,p_data->>'name',p_data->>'source',p_data->>'sourceId',p_data->>'sourceUrl',p_data->'license',p_data->>'storagePath',p_data->>'format',(p_data->>'byteSize')::integer,p_data->>'sha256',p_data->'metadata') returning * into a;
    return to_jsonb(a)-'storage_path';
  end if;
  select * into p from scene_private.projects where id=(p_data->>'projectId')::uuid for update;
  if not found or not scene_private.is_member(p_actor,p.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p_action = 'projects.get' then
    return to_jsonb(p) || jsonb_build_object('materials',scene_private.bill_of_materials(p.scene),'current_editor',
      case when p.lease_expires>clock_timestamp() then (select display_name from scene_private.members where studio_id=p.studio_id and user_id=p.lease_user) end);
  elsif p_action = 'projects.rename' then
    perform scene_private.require_lease(p_actor,p_data);
    update scene_private.projects set name=p_data->>'name',revision=revision+1,updated_at=clock_timestamp() where id=p.id returning * into p; return to_jsonb(p);
  elsif p_action = 'lease.acquire' then
    if p.lease_expires > clock_timestamp() and (p.lease_user is distinct from p_actor or p.lease_session is distinct from (p_data->>'sessionId')::uuid) then raise exception 'LEASE_BUSY'; end if;
    update scene_private.projects set lease_user=p_actor,lease_session=(p_data->>'sessionId')::uuid,
      lease_generation=lease_generation + case when lease_user=p_actor and lease_session=(p_data->>'sessionId')::uuid and lease_expires>clock_timestamp() then 0 else 1 end,
      lease_expires=clock_timestamp()+interval '90 seconds' where id=p.id returning * into p;
    return jsonb_build_object('sessionId',p.lease_session,'generation',p.lease_generation,'expiresAt',p.lease_expires,'revision',p.revision,'scene',p.scene);
  elsif p_action in ('lease.renew','lease.release') then
    perform scene_private.require_lease(p_actor,p_data,false);
    update scene_private.projects set lease_expires=case when p_action='lease.renew' then clock_timestamp()+interval '90 seconds' else clock_timestamp() end where id=p.id returning * into p;
    return jsonb_build_object('sessionId',p.lease_session,'generation',p.lease_generation,'expiresAt',p.lease_expires,'revision',p.revision);
  elsif p_action = 'scene.save' then
    return scene_private.save_scene(p_actor,p_data,p_data->'scene');
  elsif p_action = 'lease.check' then
    perform scene_private.require_lease(p_actor,p_data); perform scene_private.check_assets(p_actor,p_data->'scene'); return to_jsonb(p);
  elsif p_action = 'proposals.store' then
    perform scene_private.require_lease(p_actor,p_data);
    perform scene_private.check_assets(p_actor,p_data->'candidate');
    insert into scene_private.proposals(id,project_id,user_id,session_id,generation,base_revision,local_revision,base_hash,base_scene,candidate,explanation,warnings)
      values ((p_data->>'id')::uuid,p.id,p_actor,(p_data->>'sessionId')::uuid,(p_data->>'generation')::bigint,p.revision,(p_data->>'localRevision')::bigint,p_data->>'baseHash',p_data->'scene',p_data->'candidate',p_data->>'explanation',p_data->'warnings') returning * into proposal;
    return to_jsonb(proposal);
  elsif p_action = 'proposals.apply' then
    perform scene_private.require_lease(p_actor,p_data);
    select * into proposal from scene_private.proposals where id=(p_data->>'proposalId')::uuid and project_id=p.id and user_id=p_actor for update;
    if not found or proposal.applied_at is not null or proposal.expires_at<=clock_timestamp() or proposal.base_revision<>p.revision or
      proposal.session_id is distinct from p.lease_session or proposal.generation<>p.lease_generation or
      proposal.local_revision is distinct from (p_data->>'localRevision')::bigint or proposal.base_hash is distinct from p_data->>'baseHash' then raise exception 'STALE_PROPOSAL'; end if;
    result := scene_private.save_scene(p_actor,p_data,proposal.candidate);
    update scene_private.proposals set applied_at=clock_timestamp() where id=proposal.id;
    return result || jsonb_build_object('previousScene',proposal.base_scene,'undoGroup',proposal.id);
  elsif p_action in ('publish','shares.list','shares.revoke') then
    if p.created_by<>p_actor and not exists(select 1 from scene_private.members where studio_id=p.studio_id and user_id=p_actor and role='owner') then raise exception 'FORBIDDEN'; end if;
    if p_action='publish' then
      if p.revision is distinct from (p_data->>'expectedRevision')::bigint then raise exception 'REVISION_CONFLICT'; end if;
      insert into scene_private.publications(project_id,revision,name,scene,materials,asset_ids,created_by)
        values (p.id,p.revision,p.name,p.scene,scene_private.bill_of_materials(p.scene),
          array(select distinct (o->>'assetId')::uuid from jsonb_array_elements(p.scene->'objects') o where o ? 'assetId'),p_actor) returning * into pub;
      insert into scene_private.shares(publication_id,token_hash) values (pub.id,p_data->>'tokenHash') returning * into s;
      return jsonb_build_object('shareId',s.id,'publicationId',pub.id,'revision',pub.revision,'createdAt',pub.created_at);
    elsif p_action='shares.list' then
      return coalesce((select jsonb_agg(jsonb_build_object('shareId',sh.id,'publicationId',pv.id,'revision',pv.revision,'createdAt',sh.created_at,'revokedAt',sh.revoked_at)) from scene_private.shares sh join scene_private.publications pv on pv.id=sh.publication_id where pv.project_id=p.id),'[]');
    else
      update scene_private.shares set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=(p_data->>'shareId')::uuid and publication_id in (select id from scene_private.publications where project_id=p.id);
      if not found then raise exception 'SHARE_NOT_FOUND'; end if; return '{"revoked":true}';
    end if;
  end if;
  raise exception 'UNKNOWN_ACTION';
end $$;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='scene_private' loop
    execute format('alter table scene_private.%I enable row level security',t);
  end loop;
end $$;
revoke all on all tables in schema scene_private from public,anon,authenticated;
revoke all on all functions in schema scene_private from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema scene_private to service_role;
grant execute on all functions in schema scene_private to service_role;
revoke all on function public.scene_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scene_rpc(uuid,text,jsonb) to service_role;
