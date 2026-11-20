-- ============================================================================
-- 云存储、完整保存与官方案例：Task A 审核 SQL（2026-11-20）
-- 状态：2026-11-20 已按用户接手完成的授权定向应用；仍不进自动迁移链。
-- 包含真实验收修订：归档 MIME 补全、完整清单资源使用权限检查。
--
-- 本文件为 public.cloud_storage_rpc 及其表结构建立最小能力面：
--   1. 平台超级管理员（C01）：scene_private.platform_admins + 审计；
--   2. 官方共同工作区（C02）：scene_private.official_workspace（单行）；
--   3. 全类型归档（C03/C04 后端半边）：scene_private.archive_assets + upload_intents
--      （直传登记、大小/哈希复核、幂等重试对账）；
--   4. 完整项目保存（C06 后端半边）：scene_private.complete_projects
--      （复用 projects 的成员校验与租约/CAS，清单含 scene/outdoor/sources/依赖）；
--   5. 不可变完整发布（C08–C10 后端半边）：cloud_cases + cloud_case_versions，
--      发布复用既有 publications（不可变触发器不变）+ complete_publications
--      （户外 payload 与已发布依赖快照）；
--   6. 受控完整分享（C12/C13 后端半边）：复用 shares（token hash + revoked_at）。
--
-- 复用而非重建：成员归属/租约/CAS 沿用 scene_private.require_lease 与
-- is_member；publication 不可变性沿用既有触发器；share token 语义沿用 shares 表。
-- 不改既有表；不猜管理员 UUID（首次授权见文末「首授流程」）。
--
-- 回滚：drop 下列新表与新函数即可（都不被既有 RPC 引用）；
-- cloud_storage_rpc 未挂进 scene_rpc 委托链，撤除不影响线上现有动作。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 平台超级管理员（C01）与最小审计
-- 规则：唯一可信来源是这张服务端表；昵称/邮箱/个人工作室 owner/可改 profile
-- 一律不作为依据。撤权即时对后续请求生效（is_platform_admin 每次实时查表）。
-- ---------------------------------------------------------------------------
create table if not exists scene_private.platform_admins (
  user_id uuid primary key references auth.users on delete cascade,
  granted_by uuid references auth.users,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  note text check (note is null or length(note) <= 400)
);

create table if not exists scene_private.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('grant', 'revoke')),
  target uuid not null references auth.users on delete cascade,
  actor uuid not null references auth.users,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. 官方共同工作区（C02）：单行注册表。两位管理员通过 platform_admins 共管，
--    普通个人 owner 不能借 asset/project/case ID 触碰官方内容。
-- ---------------------------------------------------------------------------
create table if not exists scene_private.official_workspace (
  id text primary key default 'official' check (id = 'official'),
  studio_id uuid not null references scene_private.studios on delete cascade,
  enabled_by uuid not null references auth.users,
  enabled_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. 幂等请求登记：写动作按 (actor, fingerprint) 记录结果，重试返回原确认；
--    不同指纹同号 → IDEMPOTENCY_CONFLICT。指纹由 Edge 对去掉 requestId 的
--    canonical 请求体做 SHA-256（Edge 是受信服务端，与 actor 同级信任）。
-- ---------------------------------------------------------------------------
create table if not exists scene_private.cloud_requests (
  actor uuid not null references auth.users on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  action text not null,
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor, fingerprint)
);

-- ---------------------------------------------------------------------------
-- 4. 归档资产（C03）：全类型私有文件。与 scene_private.assets 分表——assets 的
--    format/byte_size 约束服务的是「可摆放场景物料」契约（现上限 32MiB），
--    大扫描不塞同一张表；两者都在完整清单里登记，发布语义见 deps.visibility。
--    byte_size 上限 2GiB 是协议值；生产桶上限需另行批准（见文末第 8 节）。
-- ---------------------------------------------------------------------------
create table if not exists scene_private.archive_assets (
  id uuid primary key,
  owner_id uuid not null references auth.users,
  studio_id uuid references scene_private.studios,  -- null = 个人私有
  name text not null check (length(name) between 1 and 200),
  kind text not null check (kind in ('model', 'scan', 'floorplan', 'photo', 'attachment')),
  format text not null check (format ~ '^[a-z0-9]{1,16}$'),
  byte_size bigint not null check (byte_size between 1 and 2147483648 - 1),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  -- full = 服务端已逐字节复核 SHA-256；size-only = 仅核对对象大小（超过阈值直传）
  integrity text not null default 'full' check (integrity in ('full', 'size-only')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists archive_assets_owner_idx on scene_private.archive_assets (owner_id, created_at desc);
create index if not exists archive_assets_studio_idx on scene_private.archive_assets (studio_id, created_at desc)
  where studio_id is not null;

-- 上传意图（C04 后端半边）：对象成功但登记失败时，同一次上传可重试 complete；
-- 同 (actor, request_id) 重试 prepare 复用同一 uploadId/storage_path。
create table if not exists scene_private.upload_intents (
  id uuid primary key,
  actor uuid not null references auth.users,
  request_id uuid not null,
  studio_id uuid references scene_private.studios,
  name text not null check (length(name) between 1 and 200),
  kind text not null check (kind in ('model', 'scan', 'floorplan', 'photo', 'attachment')),
  format text not null check (format ~ '^[a-z0-9]{1,16}$'),
  byte_size bigint not null check (byte_size between 1 and 2147483648 - 1),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null,
  state text not null default 'pending' check (state in ('pending', 'complete', 'failed')),
  asset_id uuid references scene_private.archive_assets,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists upload_intents_request_idx on scene_private.upload_intents (actor, request_id);

-- ---------------------------------------------------------------------------
-- 5. 完整项目保存（C06 后端半边）：清单按 projectId 存最新一版，版本对齐
--    projects.revision（写入需持租约 + expectedRevision CAS）。sources 私有，
--    发布路径在 SQL 层强制剥离。
-- ---------------------------------------------------------------------------
create table if not exists scene_private.complete_projects (
  project_id uuid primary key references scene_private.projects on delete cascade,
  manifest jsonb not null,
  revision bigint not null,
  created_by uuid not null references auth.users,
  updated_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. 不可变完整发布（C08–C10）：complete_publications 把「户外 payload + 已发布
--    依赖快照」挂到既有 publications 行上（publication 本体仍不可变）；
--    cloud_cases 是案例指针（stable_id → 当前 publication + 版本号），
--    cloud_case_versions 是发布/恢复/下架流水（C15 最小审计的一部分）。
-- ---------------------------------------------------------------------------
create table if not exists scene_private.complete_publications (
  publication_id uuid primary key references scene_private.publications,
  outdoor jsonb,
  deps jsonb not null default '[]',  -- [{assetId,name,kind,format,storagePath,metadata}]
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);

create table if not exists scene_private.cloud_cases (
  id uuid primary key default gen_random_uuid(),
  stable_id text not null unique
    check (stable_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' and stable_id not in ('manage')),
  title text not null check (length(title) between 1 and 120),
  description text not null default '' check (length(description) <= 4000),
  category text not null default '' check (length(category) <= 120),
  cover_asset_id uuid references scene_private.assets,
  sort_order integer not null default 0,
  project_id uuid not null references scene_private.projects,
  provenance text not null default '' check (length(provenance) <= 4000),
  draft jsonb not null,           -- 最近一次完整清单快照（服务端从 complete_projects 复制）
  draft_revision bigint not null,
  current_publication_id uuid references scene_private.publications,
  current_version integer not null default 0,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cloud_cases_project_idx on scene_private.cloud_cases (project_id);

create table if not exists scene_private.cloud_case_versions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references scene_private.cloud_cases on delete cascade,
  version integer not null,
  publication_id uuid not null references scene_private.publications,
  action text not null check (action in ('publish', 'restore', 'unpublish')),
  actor uuid not null references auth.users,
  at timestamptz not null default now(),
  -- unpublish 流水与同版本号的 publish 行共存，不撞号；同一版本重复 unpublish 被指针判空挡住。
  unique (case_id, version, action)
);

grant select, insert, update, delete on
  scene_private.platform_admins,
  scene_private.platform_admin_audit,
  scene_private.official_workspace,
  scene_private.cloud_requests,
  scene_private.archive_assets,
  scene_private.upload_intents,
  scene_private.complete_projects,
  scene_private.complete_publications,
  scene_private.cloud_cases,
  scene_private.cloud_case_versions
to service_role;

-- ---------------------------------------------------------------------------
-- 7. SQL 帮助函数（service_role 专用，与 scene_private 其他函数同口径）
-- ---------------------------------------------------------------------------
create or replace function scene_private.is_platform_admin(actor uuid) returns boolean
language sql stable set search_path = '' as $$
  select actor is not null and exists(
    select 1 from scene_private.platform_admins
    where user_id = actor and revoked_at is null)
$$;

create or replace function scene_private.official_studio() returns uuid
language sql stable set search_path = '' as $$
  select studio_id from scene_private.official_workspace where id = 'official'
$$;

-- 写动作幂等闸：指纹 = canonical(请求体含 requestId) 的 SHA-256（Edge 计算）。
-- 重试（同 actor + 同 requestId + 同内容）→ 返回已存结果；
-- 同 requestId 不同内容/动作 → IDEMPOTENCY_CONFLICT；
-- 新 requestId 相同内容 → 视为新的主动操作，允许再次执行。
-- 失败事务整体回滚，不留幽灵登记。
create unique index if not exists cloud_requests_actor_request_idx
  on scene_private.cloud_requests (actor, request_id);

create or replace function scene_private.cloud_claim(p_actor uuid, p_fingerprint text, p_action text, p_request_id uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare existing scene_private.cloud_requests;
begin
  select * into existing from scene_private.cloud_requests
    where actor = p_actor and request_id = p_request_id limit 1;
  if found then
    if existing.fingerprint is distinct from p_fingerprint or existing.action is distinct from p_action then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    if existing.result is not null then return existing.result; end if;
    -- 已登记但未完成（上次执行未落结果）：继续执行，稍后由 cloud_finish 落结果。
    return null;
  end if;
  insert into scene_private.cloud_requests(actor, fingerprint, action, request_id)
    values (p_actor, p_fingerprint, p_action, p_request_id);
  return null;
end $$;

create or replace function scene_private.cloud_finish(p_actor uuid, p_fingerprint text, p_result jsonb) returns void
language sql set search_path = '' as $$
  update scene_private.cloud_requests set result = p_result
    where actor = p_actor and fingerprint = p_fingerprint
$$;

-- 依赖解析：assetId 命中 assets（可摆放物料）或 archive_assets（归档原件）其一。
create or replace function scene_private.cloud_dep_row(p_asset uuid) returns jsonb
language sql stable set search_path = '' as $$
  select q.row from (
    select jsonb_build_object('assetId', a.id, 'name', a.name, 'kind', 'scene-asset',
             'format', a.format, 'storagePath', a.storage_path, 'metadata', a.metadata,
             'byteSize', a.byte_size, 'sha256', a.sha256, 'integrity', 'full',
             'createdAt', a.created_at) as row
      from scene_private.assets a where a.id = p_asset
    union all
    select jsonb_build_object('assetId', x.id, 'name', x.name, 'kind', x.kind,
             'format', x.format, 'storagePath', x.storage_path, 'metadata', x.metadata,
             'byteSize', x.byte_size, 'sha256', x.sha256, 'integrity', x.integrity,
             'createdAt', x.created_at) as row
      from scene_private.archive_assets x where x.id = p_asset
  ) q limit 1
$$;

-- 发布依赖快照：只取 visibility='published' 的依赖并逐个解析原件；
-- 任何解析失败都说明「依赖未归档完」，发布被拒（DEPENDENCY_INCOMPLETE）。
create or replace function scene_private.cloud_published_deps(p_manifest jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare d jsonb; row_rec jsonb; collected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_manifest->'dependencies') is distinct from 'array' then
    raise exception 'DEPENDENCY_INCOMPLETE'; end if;
  for d in select value from jsonb_array_elements(p_manifest->'dependencies')
           where value->>'visibility' = 'published' loop
    row_rec := scene_private.cloud_dep_row((d->>'assetId')::uuid);
    if row_rec is null then raise exception 'DEPENDENCY_INCOMPLETE'; end if;
    collected := collected || jsonb_build_array(row_rec);
  end loop;
  return collected;
end $$;

-- 场景所需 asset 必须全部在已发布依赖里；缺失即拒发（契约：不能发布引用
-- 私有原件或未归档依赖的案例）。
create or replace function scene_private.cloud_check_scene_covered(p_manifest jsonb, p_deps jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare o jsonb; need uuid; have uuid[];
begin
  have := array(select (d->>'assetId')::uuid from jsonb_array_elements(p_deps) d);
  if jsonb_typeof(p_manifest->'scene'->'objects') = 'array' then
    for o in select value from jsonb_array_elements(p_manifest->'scene'->'objects') where value ? 'assetId' loop
      need := (o->>'assetId')::uuid;
      if not (need = any(have)) then raise exception 'DEPENDENCY_INCOMPLETE'; end if;
    end loop;
  end if;
  if p_manifest->'scene'->'venue' ? 'floorplanAssetId' then
    need := (p_manifest->'scene'->'venue'->>'floorplanAssetId')::uuid;
    if not (need = any(have)) then raise exception 'DEPENDENCY_INCOMPLETE'; end if;
  end if;
end $$;

-- 不可变发布原子创建：publication（既有不可变表）+ complete_publications
-- 同一事务落库；失败则两者都不存在。expectedRevision 与项目当前版本不符即拒。
create or replace function scene_private.cloud_publish_snapshot(
  p_actor uuid, p_project uuid, p_expected_revision bigint, p_outdoor jsonb, p_dep_rows jsonb
) returns jsonb
language plpgsql set search_path = '' as $$
declare p scene_private.projects; pub scene_private.publications; pub_ids uuid[];
begin
  select * into p from scene_private.projects where id = p_project for update;
  if not found or p.deleted_at is not null then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  pub_ids := array(select (d->>'assetId')::uuid from jsonb_array_elements(p_dep_rows) d
                     where exists(select 1 from scene_private.assets a where a.id = (d->>'assetId')::uuid));
  insert into scene_private.publications(project_id, revision, name, scene, materials, asset_ids, created_by)
    values (p.id, p.revision, p.name, p.scene, scene_private.bill_of_materials(p.scene), pub_ids, p_actor)
    returning * into pub;
  insert into scene_private.complete_publications(publication_id, outdoor, deps, created_by)
    values (pub.id, p_outdoor, p_dep_rows, p_actor);
  return jsonb_build_object('publicationId', pub.id, 'revision', pub.revision);
end $$;

-- 完整清单登记（save 与 upsert-case 共用校验）：依赖必须可解析；场景引用必须
-- 列入依赖；sources 不参与发布（发布层强制剥离）。
create or replace function scene_private.cloud_check_manifest(p_manifest jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare d jsonb;
begin
  if pg_column_size(p_manifest) > 16777216 then raise exception 'MANIFEST_TOO_LARGE'; end if;
  if jsonb_typeof(p_manifest->'dependencies') is distinct from 'array' then
    raise exception 'DEPENDENCY_INCOMPLETE'; end if;
  for d in select value from jsonb_array_elements(p_manifest->'dependencies') loop
    if scene_private.cloud_dep_row((d->>'assetId')::uuid) is null
      then raise exception 'DEPENDENCY_INCOMPLETE'; end if;
  end loop;
  perform scene_private.cloud_check_scene_covered(p_manifest, p_manifest->'dependencies');
end $$;

-- Knowing an asset ID does not authorize publishing it through a personal project.
-- Public case dependencies remain reusable so independent case copies can save normally.
create or replace function scene_private.cloud_check_manifest_access(p_actor uuid, p_manifest jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare d jsonb; asset uuid;
begin
  for d in select value from jsonb_array_elements(p_manifest->'dependencies') loop
    asset := (d->>'assetId')::uuid;
    if not scene_private.can_use_asset(p_actor, asset)
      and not exists(select 1 from scene_private.archive_assets a where a.id = asset
        and (a.owner_id = p_actor or (a.studio_id = scene_private.official_studio()
          and scene_private.is_platform_admin(p_actor))))
      and not exists(select 1 from scene_private.cloud_cases c
        join scene_private.complete_publications cp on cp.publication_id = c.current_publication_id
        where exists(select 1 from jsonb_array_elements(cp.deps) dep where dep->>'assetId' = asset::text))
      then raise exception 'ASSET_NOT_FOUND'; end if;
  end loop;
end $$;

create or replace function scene_private.cloud_case_view(case_row scene_private.cloud_cases) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', case_row.id, 'stableId', case_row.stable_id, 'title', case_row.title,
    'description', case_row.description, 'category', case_row.category,
    'coverAssetId', case_row.cover_asset_id, 'sortOrder', case_row.sort_order,
    'projectId', case_row.project_id, 'provenance', case_row.provenance,
    'manifest', case_row.draft, 'manifestRevision', case_row.draft_revision,
    'currentVersion', case_row.current_version, 'status',
      case when case_row.current_publication_id is null then 'unpublished' else 'published' end,
    'publicationId', case_row.current_publication_id,
    'publishedAt', case_row.published_at, 'unpublishedAt', case_row.unpublished_at,
    'updatedAt', case_row.updated_at)
$$;

-- ---------------------------------------------------------------------------
-- 8. public.cloud_storage_rpc：唯一入口；security invoker + 仅 service_role 可执行，
--    actor 由 Edge 在 Auth.getUser() 验证后传入，客户端无法自报身份。
-- ---------------------------------------------------------------------------
create or replace function public.cloud_storage_rpc(p_actor uuid, p_action text, p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  intent scene_private.upload_intents;
  arch scene_private.archive_assets;
  cp scene_private.complete_projects;
  case_row scene_private.cloud_cases;
  proj scene_private.projects;
  pub_rec scene_private.publications;
  share_row scene_private.shares;
  share_rec record;
  dep jsonb; dep_row jsonb; result jsonb; pub jsonb; ver integer; inserted boolean; claim_path text;
  fingerprint text := p_data->>'fingerprint';
  -- 避开 plpgsql 变量/列名同名：request_id 是 upload_intents/cloud_requests 的列名，
  -- on conflict 目标里的同名标识会被变量替换，必须用不同名变量。
  claim_request uuid;
begin
  -- ---- 公开只读入口（匿名） -------------------------------------------------
  if p_action = 'cloud.cases.list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.stable_id, 'title', c.title, 'description', c.description,
          'category', c.category, 'provenance', c.provenance, 'coverAssetId', c.cover_asset_id,
          'coverPath', case when c.cover_asset_id is not null and exists(
              select 1 from scene_private.complete_publications pcp
              where pcp.publication_id = c.current_publication_id
                and exists(select 1 from jsonb_array_elements(pcp.deps) d
                  where d->>'assetId' = c.cover_asset_id::text))
            then a.storage_path else null end,
          'sortOrder', c.sort_order,
          'publicationId', c.current_publication_id, 'revision', pub_row.revision,
          'version', c.current_version, 'publishedAt', c.published_at, 'updatedAt', c.updated_at)
        order by c.sort_order, c.updated_at desc)
      from scene_private.cloud_cases c
      join scene_private.publications pub_row on pub_row.id = c.current_publication_id
      left join scene_private.assets a on a.id = c.cover_asset_id
      where c.current_publication_id is not null limit 200
    ), '[]'::jsonb);
  end if;
  if p_action = 'cloud.case.read' then
    select * into case_row from scene_private.cloud_cases
      where stable_id = p_data->>'stableId' and current_publication_id is not null;
    if not found then raise exception 'CASE_NOT_FOUND'; end if;
    select * into pub_rec from scene_private.publications where id = case_row.current_publication_id;
    select pcp.outdoor, pcp.deps into dep, dep_row
      from scene_private.complete_publications pcp where pcp.publication_id = pub_rec.id;
    return jsonb_build_object(
      'id', case_row.stable_id, 'title', case_row.title, 'description', case_row.description,
      'category', case_row.category, 'version', case_row.current_version,
      'publishedAt', case_row.published_at, 'projectId', case_row.project_id,
      'publicationId', pub_rec.id, 'revision', pub_rec.revision,
      'scene', scene_private.public_scene(pub_rec.scene),
      'materials', scene_private.public_materials(pub_rec.materials),
      'outdoor', dep, 'deps', dep_row);
  end if;
  if p_action = 'cloud.share.read' then
    select pub.id as publication_id, pub.revision, pub.scene, pub.materials, pcp.outdoor, pcp.deps
      into share_rec from
      scene_private.shares s
      join scene_private.publications pub on pub.id = s.publication_id
      left join scene_private.complete_publications pcp on pcp.publication_id = pub.id
      where s.token_hash = p_data->>'tokenHash' and s.revoked_at is null;
    if not found then raise exception 'SHARE_NOT_FOUND'; end if;
    return jsonb_build_object(
      'publicationId', share_rec.publication_id, 'revision', share_rec.revision,
      'scene', scene_private.public_scene(share_rec.scene),
      'materials', scene_private.public_materials(share_rec.materials),
      'outdoor', share_rec.outdoor, 'deps', share_rec.deps);
  end if;

  -- ---- 以下动作全部要求已登录 ----------------------------------------------
  if p_actor is null then raise exception 'UNAUTHENTICATED'; end if;

  if p_action = 'cloud.capabilities' then
    return jsonb_build_object('version', 1,
      'superAdmin', scene_private.is_platform_admin(p_actor),
      'officialStudioId', scene_private.official_studio());
  end if;

  -- 平台管理员闸（C01）：以下动作仅超级管理员；每次实时查表，撤权即时生效。
  if p_action in ('cloud.admin.grant', 'cloud.admin.revoke',
                  'cloud.case.upsert', 'cloud.case.publish', 'cloud.case.unpublish',
                  'cloud.case.restore', 'cloud.case.versions', 'cloud.case.drafts.list') then
    if not scene_private.is_platform_admin(p_actor) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  end if;

  if p_action = 'cloud.admin.grant' then
    claim_request := (p_data->>'requestId')::uuid;
    result := scene_private.cloud_claim(p_actor, fingerprint, p_action, claim_request);
    if result is not null then return result; end if;
    insert into scene_private.platform_admins(user_id, granted_by, note)
      values ((p_data->>'targetUserId')::uuid, p_actor, p_data->>'note')
      on conflict (user_id) do update set revoked_at = null, granted_by = excluded.granted_by,
        granted_at = clock_timestamp(), note = excluded.note;
    insert into scene_private.platform_admin_audit(action, target, actor)
      values ('grant', (p_data->>'targetUserId')::uuid, p_actor);
    result := jsonb_build_object('targetUserId', p_data->>'targetUserId', 'granted', true);
    perform scene_private.cloud_finish(p_actor, fingerprint, result);
    return result;
  end if;
  if p_action = 'cloud.admin.revoke' then
    claim_request := (p_data->>'requestId')::uuid;
    result := scene_private.cloud_claim(p_actor, fingerprint, p_action, claim_request);
    if result is not null then return result; end if;
    update scene_private.platform_admins set revoked_at = clock_timestamp()
      where user_id = (p_data->>'targetUserId')::uuid and revoked_at is null;
    if not found then raise exception 'ADMIN_NOT_FOUND'; end if;
    insert into scene_private.platform_admin_audit(action, target, actor)
      values ('revoke', (p_data->>'targetUserId')::uuid, p_actor);
    result := jsonb_build_object('targetUserId', p_data->>'targetUserId', 'revoked', true);
    perform scene_private.cloud_finish(p_actor, fingerprint, result);
    return result;
  end if;

  -- ---- 归档上传（C03/C04）---------------------------------------------------
  if p_action = 'cloud.upload.prepare' then
    claim_request := (p_data->>'requestId')::uuid;
    result := scene_private.cloud_claim(p_actor, fingerprint, p_action, claim_request);
    if result is not null then return result; end if;
    if p_data->>'studioId' is not null then
      if scene_private.official_studio() is null then raise exception 'OFFICIAL_WORKSPACE_REQUIRED'; end if;
      if (p_data->>'studioId')::uuid is distinct from scene_private.official_studio()
        or not scene_private.is_platform_admin(p_actor) then raise exception 'FORBIDDEN'; end if;
    end if;
    claim_path := p_actor::text || '/' || claim_request::text || '/' || (p_data->>'sha256') || '.' || (p_data->>'format');
    insert into scene_private.upload_intents(id, actor, request_id, studio_id, name, kind, format,
        byte_size, sha256, storage_path)
      values (gen_random_uuid(), p_actor, claim_request,
        nullif(p_data->>'studioId','')::uuid, p_data->>'name', p_data->>'kind', p_data->>'format',
        (p_data->>'byteSize')::bigint, p_data->>'sha256', claim_path)
      on conflict (actor, request_id) do update set updated_at = clock_timestamp()
      returning * into intent;
    -- 复用同 (actor,request_id) 意图时保持原 storage_path（直传地址稳定，重传 409 由存储层拒）。
    result := jsonb_build_object('uploadId', intent.id, 'assetId', intent.asset_id,
      'state', intent.state, 'storagePath', intent.storage_path, 'uploadUrl', null, 'token', null);
    perform scene_private.cloud_finish(p_actor, fingerprint, result);
    return result;
  end if;
  if p_action = 'cloud.upload.register' then
    -- 不走 claim：意图状态机自身幂等（pending→complete，重复调用返回同一资产）。
    select * into intent from scene_private.upload_intents
      where id = (p_data->>'uploadId')::uuid and actor = p_actor for update;
    if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
    if intent.state = 'complete' then
      select * into arch from scene_private.archive_assets where id = intent.asset_id;
      return jsonb_build_object('asset', to_jsonb(arch) - 'storage_path', 'reused', true);
    end if;
    if intent.state is distinct from 'pending' then raise exception 'UPLOAD_STATE_INVALID'; end if;
    if intent.byte_size is distinct from (p_data->>'actualByteSize')::bigint
      then raise exception 'UPLOAD_INTEGRITY_FAILED'; end if;
    insert into scene_private.archive_assets(id, owner_id, studio_id, name, kind, format, byte_size,
        sha256, storage_path, integrity, metadata)
      values (intent.id, p_actor, intent.studio_id, intent.name, intent.kind, intent.format,
        intent.byte_size, intent.sha256, intent.storage_path, p_data->>'integrity', '{}')
      on conflict (id) do nothing;
    inserted := found;
    select * into arch from scene_private.archive_assets where id = intent.id;
    if not inserted then
      -- 内容寻址 id 已存在：同一文件重复登记受控合并，校验哈希一致才复用。
      if arch.sha256 is distinct from intent.sha256 or arch.owner_id is distinct from p_actor
        then raise exception 'UPLOAD_INTEGRITY_FAILED'; end if;
    end if;
    update scene_private.upload_intents set state = 'complete', asset_id = arch.id,
      updated_at = clock_timestamp() where id = intent.id;
    return jsonb_build_object('asset', to_jsonb(arch) - 'storage_path', 'reused', not inserted);
  end if;
  if p_action = 'cloud.upload.intent' then
    select * into intent from scene_private.upload_intents
      where id = (p_data->>'uploadId')::uuid and actor = p_actor;
    if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
    return jsonb_build_object('uploadId', intent.id, 'state', intent.state,
      'assetId', intent.asset_id, 'storagePath', intent.storage_path,
      'byteSize', intent.byte_size, 'sha256', intent.sha256,
      'name', intent.name, 'kind', intent.kind, 'format', intent.format,
      'studioId', intent.studio_id, 'createdAt', intent.created_at);
  end if;
  if p_action = 'cloud.assets.list' then
    if p_data->>'studioId' is not null then
      if scene_private.official_studio() is null then raise exception 'OFFICIAL_WORKSPACE_REQUIRED'; end if;
      if (p_data->>'studioId')::uuid is distinct from scene_private.official_studio()
        or not scene_private.is_platform_admin(p_actor) then raise exception 'FORBIDDEN'; end if;
      return coalesce((select jsonb_agg(to_jsonb(x) - 'storage_path') from (
        select * from scene_private.archive_assets where studio_id = scene_private.official_studio()
        order by created_at desc limit 200) x), '[]'::jsonb);
    end if;
    return coalesce((select jsonb_agg(to_jsonb(x) - 'storage_path') from (
      select * from scene_private.archive_assets where owner_id = p_actor
      order by created_at desc limit 200) x), '[]'::jsonb);
  end if;
  if p_action = 'cloud.assets.url' then
    select * into arch from scene_private.archive_assets
      where id = (p_data->>'assetId')::uuid
        and (owner_id = p_actor
             or (studio_id is not null and studio_id = scene_private.official_studio()
                 and scene_private.is_platform_admin(p_actor)));
    if not found then raise exception 'ASSET_NOT_FOUND'; end if;
    return to_jsonb(arch);
  end if;

  -- ---- 完整项目保存（C06）：复用成员校验 + 租约 + revision CAS --------------
  if p_action = 'cloud.project.save' then
    claim_request := (p_data->>'requestId')::uuid;
    result := scene_private.cloud_claim(p_actor, fingerprint, p_action, claim_request);
    if result is not null then
      -- 幂等重放（2026-11-20 集成验收修订）：登记表只存瘦身回执（不含 manifest），
      -- 避免每次保存都把一份可达 16MiB 的清单复制进 cloud_requests.result；
      -- manifest 以 complete_projects 的当前行为准重建，返回形状与首次确认一致。
      if result ? 'manifest' then return result; end if;
      select * into cp from scene_private.complete_projects
        where project_id = (result->>'projectId')::uuid;
      if found then
        return jsonb_build_object('projectId', cp.project_id, 'revision', cp.revision,
          'manifest', cp.manifest, 'confirmedAt', result->>'confirmedAt',
          'dependencyCount', jsonb_array_length(cp.manifest->'dependencies'));
      end if;
      return result;
    end if;
    -- 复用既有 require_lease：成员校验 + 租约（sessionId/generation）+ expectedRevision CAS 一次完成。
    proj := scene_private.require_lease(p_actor, p_data);
    perform scene_private.cloud_check_manifest(p_data->'manifest');
    perform scene_private.cloud_check_manifest_access(p_actor, p_data->'manifest');
    insert into scene_private.complete_projects(project_id, manifest, revision, created_by, updated_by)
      values (proj.id, p_data->'manifest', (p_data->>'expectedRevision')::bigint, p_actor, p_actor)
      on conflict (project_id) do update set manifest = excluded.manifest, revision = excluded.revision,
        updated_by = excluded.updated_by, updated_at = clock_timestamp()
      returning * into cp;
    result := jsonb_build_object('projectId', cp.project_id, 'revision', cp.revision,
      'manifest', cp.manifest, 'confirmedAt', clock_timestamp(),
      'dependencyCount', jsonb_array_length(cp.manifest->'dependencies'));
    perform scene_private.cloud_finish(p_actor, fingerprint, jsonb_build_object(
      'projectId', cp.project_id, 'revision', cp.revision, 'confirmedAt', result->>'confirmedAt',
      'dependencyCount', jsonb_array_length(cp.manifest->'dependencies')));
    return result;
  end if;
  if p_action = 'cloud.project.get' then
    select * into proj from scene_private.projects where id = (p_data->>'projectId')::uuid;
    if not found or not scene_private.is_member(p_actor, proj.studio_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
    select * into cp from scene_private.complete_projects where project_id = proj.id;
    if not found then raise exception 'COMPLETE_PROJECT_NOT_FOUND'; end if;
    return jsonb_build_object('projectId', cp.project_id, 'revision', cp.revision,
      'manifest', cp.manifest, 'updatedAt', cp.updated_at,
      'dependencyCount', jsonb_array_length(cp.manifest->'dependencies'));
  end if;

  -- ---- 案例运营（C08–C10）：官方项目 + 管理员；草稿=服务端复制的完整清单 ----
  if p_action = 'cloud.case.drafts.list' then
    return coalesce((select jsonb_agg(scene_private.cloud_case_view(c) order by c.updated_at desc)
      from scene_private.cloud_cases c limit 200), '[]'::jsonb);
  end if;
  if p_action = 'cloud.case.upsert' then
    claim_request := (p_data->>'requestId')::uuid;
    result := scene_private.cloud_claim(p_actor, fingerprint, p_action, claim_request);
    if result is not null then return result; end if;
    if scene_private.official_studio() is null then raise exception 'OFFICIAL_WORKSPACE_REQUIRED'; end if;
    select * into proj from scene_private.projects where id = (p_data->>'projectId')::uuid;
    if not found or proj.deleted_at is not null or proj.studio_id is distinct from scene_private.official_studio()
      then raise exception 'PROJECT_NOT_FOUND'; end if;
    select * into cp from scene_private.complete_projects where project_id = proj.id;
    if not found then raise exception 'COMPLETE_PROJECT_NOT_FOUND'; end if;
    select * into case_row from scene_private.cloud_cases
      where stable_id = p_data->>'stableId' for update;
    if found and case_row.project_id is distinct from proj.id
      then raise exception 'FORBIDDEN'; end if;
    -- 新建走 expectedVersion=0；已存在的案例按当前版本 CAS。
    if found and case_row.current_version is distinct from (p_data->>'expectedVersion')::integer
      then raise exception 'CASE_VERSION_CONFLICT'; end if;
    if not found and coalesce((p_data->>'expectedVersion')::integer, 0) is distinct from 0
      then raise exception 'CASE_VERSION_CONFLICT'; end if;
    if p_data->>'coverAssetId' is not null and p_data->>'coverAssetId' != 'null' then
      if not exists(select 1 from jsonb_array_elements(cp.manifest->'dependencies') d
        where d->>'visibility' = 'published' and d->>'assetId' = p_data->>'coverAssetId')
        then raise exception 'DEPENDENCY_INCOMPLETE'; end if;
    end if;
    insert into scene_private.cloud_cases(stable_id, title, description, category, cover_asset_id,
        sort_order, project_id, provenance, draft, draft_revision, created_by)
      values (p_data->>'stableId', p_data->>'title', p_data->>'description', p_data->>'category',
        nullif(p_data->>'coverAssetId','')::uuid, (p_data->>'sortOrder')::integer, proj.id,
        p_data->>'provenance', cp.manifest, cp.revision, p_actor)
      on conflict (stable_id) do update set title = excluded.title, description = excluded.description,
        category = excluded.category, cover_asset_id = excluded.cover_asset_id,
        sort_order = excluded.sort_order, provenance = excluded.provenance,
        draft = excluded.draft, draft_revision = excluded.draft_revision, updated_at = clock_timestamp()
      returning * into case_row;
    result := scene_private.cloud_case_view(case_row);
    perform scene_private.cloud_finish(p_actor, fingerprint, result);
    return result;
  end if;
  if p_action in ('cloud.case.publish', 'cloud.case.unpublish', 'cloud.case.restore') then
    claim_request := (p_data->>'requestId')::uuid;
    result := scene_private.cloud_claim(p_actor, fingerprint, p_action, claim_request);
    if result is not null then return result; end if;
    select * into case_row from scene_private.cloud_cases where stable_id = p_data->>'stableId' for update;
    if not found then raise exception 'CASE_NOT_FOUND'; end if;
    if case_row.current_version is distinct from (p_data->>'expectedVersion')::integer
      then raise exception 'CASE_VERSION_CONFLICT'; end if;
    if p_action = 'cloud.case.publish' then
      select * into proj from scene_private.projects where id = case_row.project_id for update;
      if not found or proj.deleted_at is not null or proj.studio_id is distinct from scene_private.official_studio()
        then raise exception 'PROJECT_NOT_FOUND'; end if;
      if proj.revision is distinct from (p_data->>'expectedRevision')::bigint then raise exception 'REVISION_CONFLICT'; end if;
      perform scene_private.cloud_check_manifest_access(p_actor, case_row.draft);
      dep_row := scene_private.cloud_published_deps(case_row.draft);
      perform scene_private.cloud_check_scene_covered(case_row.draft, dep_row);
      pub := scene_private.cloud_publish_snapshot(p_actor, proj.id, (p_data->>'expectedRevision')::bigint,
        case_row.draft->'outdoor', dep_row);
      ver := case_row.current_version + 1;
      insert into scene_private.cloud_case_versions(case_id, version, publication_id, action, actor)
        values (case_row.id, ver, (pub->>'publicationId')::uuid, 'publish', p_actor);
      update scene_private.cloud_cases set current_publication_id = (pub->>'publicationId')::uuid,
        current_version = ver, published_at = clock_timestamp(), unpublished_at = null,
        updated_at = clock_timestamp() where id = case_row.id returning * into case_row;
    elsif p_action = 'cloud.case.unpublish' then
      if case_row.current_publication_id is null then raise exception 'CASE_NOT_FOUND'; end if;
      insert into scene_private.cloud_case_versions(case_id, version, publication_id, action, actor)
        values (case_row.id, case_row.current_version, case_row.current_publication_id, 'unpublish', p_actor);
      update scene_private.cloud_cases set current_publication_id = null,
        unpublished_at = clock_timestamp(), updated_at = clock_timestamp()
        where id = case_row.id returning * into case_row;
    else
      if not exists(select 1 from scene_private.cloud_case_versions v
        where v.case_id = case_row.id and v.publication_id = (p_data->>'publicationId')::uuid)
        then raise exception 'CASE_NOT_FOUND'; end if;
      if not exists(select 1 from scene_private.complete_publications pcp
        where pcp.publication_id = (p_data->>'publicationId')::uuid)
        then raise exception 'CASE_NOT_FOUND'; end if;
      ver := case_row.current_version + 1;
      insert into scene_private.cloud_case_versions(case_id, version, publication_id, action, actor)
        values (case_row.id, ver, (p_data->>'publicationId')::uuid, 'restore', p_actor);
      update scene_private.cloud_cases set current_publication_id = (p_data->>'publicationId')::uuid,
        current_version = ver, published_at = clock_timestamp(), unpublished_at = null,
        updated_at = clock_timestamp() where id = case_row.id returning * into case_row;
    end if;
    result := scene_private.cloud_case_view(case_row);
    perform scene_private.cloud_finish(p_actor, fingerprint, result);
    return result;
  end if;
  if p_action = 'cloud.case.versions' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'version', v.version, 'publicationId', v.publication_id, 'revision', pub_row.revision,
        'action', v.action, 'actorId', v.actor, 'createdAt', v.at)
      order by v.version desc, v.at desc)
      from scene_private.cloud_case_versions v
      join scene_private.cloud_cases c on c.id = v.case_id
      join scene_private.publications pub_row on pub_row.id = v.publication_id
      where c.stable_id = p_data->>'stableId'), '[]'::jsonb);
  end if;

  -- ---- 完整受控分享（C12/C13）：复用 shares；令牌哈希入库，token 只回一次 ---
  if p_action = 'cloud.share.create' then
    claim_request := (p_data->>'requestId')::uuid;
    result := scene_private.cloud_claim(p_actor, fingerprint, p_action, claim_request);
    if result is not null then return result; end if;
    select * into proj from scene_private.projects where id = (p_data->>'projectId')::uuid for update;
    if not found or proj.deleted_at is not null or not scene_private.is_member(p_actor, proj.studio_id)
      then raise exception 'PROJECT_NOT_FOUND'; end if;
    if proj.revision is distinct from (p_data->>'expectedRevision')::bigint then raise exception 'REVISION_CONFLICT'; end if;
    select * into cp from scene_private.complete_projects where project_id = proj.id;
    if not found then raise exception 'DEPENDENCY_INCOMPLETE'; end if;
    perform scene_private.cloud_check_manifest_access(p_actor, cp.manifest);
    dep_row := scene_private.cloud_published_deps(cp.manifest);
    perform scene_private.cloud_check_scene_covered(cp.manifest, dep_row);
    pub := scene_private.cloud_publish_snapshot(p_actor, proj.id, (p_data->>'expectedRevision')::bigint,
      cp.manifest->'outdoor', dep_row);
    insert into scene_private.shares(publication_id, token_hash)
      values ((pub->>'publicationId')::uuid, p_data->>'tokenHash') returning * into share_row;
    -- 结果只存标识，不存令牌（服务端仅存哈希）；丢失令牌走 shares.list + 撤销重建。
    result := jsonb_build_object('shareId', share_row.id, 'publicationId', pub->>'publicationId',
      'revision', pub->>'revision', 'token', null);
    perform scene_private.cloud_finish(p_actor, fingerprint, result);
    -- token 经独立通道返回一次；同一请求的重试按幂等闸返回上面的原确认（token=null）。
    return result || jsonb_build_object('issuedToken', p_data->>'issuedToken');
  end if;

  raise exception 'UNKNOWN_ACTION';
end $$;

revoke all on function public.cloud_storage_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.cloud_storage_rpc(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 9. 生产对象存储桶扩容（仅在人工批准后执行；测试夹具中同步生效以便验证）
-- 当前桶上限 32MiB、mime 白名单不含扫描/附件，直传大扫描会被存储层拒。
-- 2GiB 与 mime 集合是协议配套值，可以按成本决定调小，但不能不改。
-- ---------------------------------------------------------------------------
update storage.buckets set
  file_size_limit = 2147483648,
  allowed_mime_types = array[
    'model/gltf-binary','image/png','image/jpeg','image/webp','application/pdf',
    'application/zip','application/json','text/plain','text/csv','application/octet-stream',
    'video/mp4','video/quicktime','application/x-spz','application/x-ply',
    'image/svg+xml','application/dxf','application/acad',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation']
where id = 'scene-assets';

-- ---------------------------------------------------------------------------
-- 10. 首次授权流程（C01，人工执行；不写死任何 UUID）
-- 1) 两位管理员在账号注册后，由运维从 auth.users 按确认过的账号（邮箱核对 +
--    第二因素确认）取出 UUID；2) 在生产库手工执行：
--      insert into scene_private.platform_admins(user_id, granted_by, note)
--        values ('<已核对的UUID>', null, '首次授权：<日期>/<审批人>');
--      insert into scene_private.official_workspace(studio_id, enabled_by)
--        select m.studio_id, '<已核对的UUID>' from scene_private.members m
--        where m.user_id = '<已核对的UUID>' and m.role = 'owner' limit 1;
--    （official_workspace 用谁名下的工作室承载官方内容，须在 review 时明确，
--    不自动挪走任何现有个人项目。）
-- 3) 撤权：
--      update scene_private.platform_admins set revoked_at = now() where user_id = '<UUID>';
--    审计记录随后续 cloud.admin.* 动作自动累积。
-- ---------------------------------------------------------------------------
