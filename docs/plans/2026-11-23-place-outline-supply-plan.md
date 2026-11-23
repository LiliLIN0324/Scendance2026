# 场地轮廓供给与反馈回灌完整规划

> 日期：2026-11-23 ｜ 状态：**规划稿，待拍板；未落码、未写库** ｜ 提出：R8 干净链路真机实测（A 案·临安青山湖水上森林）
> 触发：站端选中「青山湖水上森林」后轮廓五路全落空，仅落定位钉；线上探测三个查询词均返回 `shape:null`，预埋 hints 查无此条。复盘发现：检索链路只读不回写、缺反馈收集、缺自绘边界沉淀，供给只靠早期人工录入的 50 余条。
> 硬边界：不碰独占五文件（`use-import-export.ts` / `use-splat-preview.ts` / `three/splat-preview.ts` / `room-organizer.tsx` / `scendance-workspace.tsx`）；不碰几何基线两文件（`three/scan-placement.ts` / `furniture-builders.ts`）；数据库迁移、Edge Function 契约、根依赖与治理配置属人 review 项，不在本轮擅自落码（AGENTS.md §六、§八）。

## 一、目标与非目标

### 1.1 目标

1. 建立稳定的**分层轮廓供给**：预埋共享库 → 自动挖掘 → 本机记忆 → 反馈沉淀 → 兜底自画，命中即停，逐级降级。
2. 补齐**轮廓未命中的反馈回传**：哪些场地挖不到、用户是否手画了边界，结构化回收，供优先描边与回灌。
3. 放宽**自动挖掘召回**：把 OSM 里本就有面要素、但当前标签/门槛/别名过滤掉的城公园、林地、校区救回来。
4. 打通**自绘边界沉淀飞轮**：手画/校正的可信边界先入本机记忆，高频且经人工校验的回灌共享库，库随使用生长。
5. 完成既有预埋数据**治理**：去重、清单与线上表对账、录入口径校验。

### 1.2 非目标

- 不接入付费商用 AOI（高德/百度地块轮廓）数据源；授权、合规与计费另立议题。
- 不把用户草稿边界自动当作真实场地轮廓直接入库；回灌前必须经过几何可信校验与人工核对。
- 不改米制尺度、贴地、朝向等几何基线；不重构既有 Agent 规划主链路。
- 不在本期放开"匿名自动写共享库"；共享库写入只走受控脚本 / service_role / 校验 RPC。
- 不替用户圈定活动边界；边界范围（草坡平台 vs 整片林区）属用户决策。

## 二、现状代码事实（只读拆解，2026-11-23）

### 2.1 检索与展示链路

| 环节 | 文件 | 现状 |
| --- | --- | --- |
| 候选搜索/排序 | `frontend/components/room-organizer/lib/place-search-options.ts` | hints 标「有轮廓」的 POI 排最前，其次行政区选区，最后仅定位钉 POI；`isOutlineHint` 只认可信面 |
| 轮廓拉取 | `frontend/components/room-organizer/lib/place-area.ts` | `fetchPlaceShape` 调 `/api/place-shape`；挖到可信面写 localStorage（`scendance.place-shape.v1`，14 天，max40）；垃圾几何不写缓存 |
| 检索 Hook | `frontend/components/room-organizer/hooks/use-place-shape-lookup.ts` | 一次检索、无自动重试；前端 21s 总超时 abort，降级只落钉 |
| 提示条 | `frontend/components/room-organizer/components/outdoor-plan-overlay.tsx`（约 1252–1259） | `shapeLoading`→「正在圈范围…」；否则「暂未取得真实范围，可在地图上手画」 |
| 服务端抢答 | `functions/api/place-shape.ts` | stock 优先（150ms 宽限）→ photon → Overpass 按名 way/relation → 空间命中 400m 面要素 → 道路线型兜底；总预算 20s，单 Overpass 25s、photon 6s，坏镜像 60s 熔断 |
| 预埋读取 | `functions/api/place-stock-config.ts`、`place-shape-hints.ts` | REST 读 Supabase `place_shapes`；hints 按名 ilike 返回点数/名字，不含多边形 |

### 2.2 缓存与写入现状（关键结论）

- **运行时链路全程只读**：读 stock 表 + 读 OSM 公共镜像；服务端无任何 POST/PUT 写 `place_shapes`（grep 到的 POST 均发往 Overpass）。
- 挖到的轮廓只进两处临时缓存：服务端 isolate 进程内 Map（`shapeCache` max64，重启即失）；前端 localStorage（14 天）。
- **写共享库只有独立脚本**：`tools/place-shapes/upsert-place-shape.mjs --apply`，需 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`；本地 `.env.local` 目前仅有 anon key，缺 url 与 service_role，`--apply` 本轮不可行。
- 本机当前只缓存"系统挖到的"轮廓；**用户自绘/校正的边界不进缓存、不回灌、不可跨会话复用**。

### 2.3 预埋库匹配口径

- 表：Supabase `public.place_shapes`（线上直连可读，无对应 migration 文件）；字段 `name / name_norm / kind / polygon / bounds`。
- 命中规则（`lookupPlaceStock`）：`name_norm` 归一精确相等（去城市前缀、去标点空白），near 落在 bounds ±0.01 内，**唯一命中**才返回；多义不返回。
- 线上现状：50 余条杭州公园/商场/校区/广场；`湖滨银泰·IN77` 重复 7 条；`venues.json` 6 条西湖草坪 polygon 全空、未入库；本轮新加「青山湖水上森林」条目在本地清单、未入库。

### 2.4 反馈现状

- `frontend/components/room-organizer/panels/feedback-dialog.tsx`：手动开 GitHub Issue，可附方案信息/截图/UA；无自动上报、无结构化落表、无缺轮廓专项通道。
- 数据库 RLS 先例：`supabase/migrations/20261118190000_review_share_pins.sql`——表 `enable row level security`、`revoke all from anon/authenticated`，读写走 `security definer` RPC，仅 `grant execute` 给 anon/authenticated。本规划新表沿用此模式。

### 2.5 可信度门（复用，不另造）

`lib/place-shape-quality.ts`：`isDisplayablePlaceShape`（可展示）/ `isPersistablePlaceShape`（可入库，线型一律不算）；面 ≥3 点、不自交、面积 ≥20㎡；`normalizeOutlineName` 归一；`namesReferToSamePlace` 同义判断。

## 三、总体分层供给模型

```
① 共享预埋库 place_shapes   高频/标杆/已校验场地，全用户永久秒出
② 自动挖掘 OSM             城公园/广场/商场/校区等有面要素的长尾（本期放宽召回）
③ 本机记忆                 本设备自绘/校正过的可信边界，跨会话复用，14–30 天
④ 反馈沉淀                 未命中场地结构化回收；带边界的作为回灌候选，人工校验后入①
⑤ 兜底自画                 以上皆无：图上/纸面自画，给尺寸依据与比例尺锚定，不卡死流程
```

命中即停；任一层失败不阻塞，降级到下一层。共享库是人工校验后的真源，本机记忆是个人草稿，二者不混同。

## 四、改动规划

### 模块 A · 预埋数据治理与录入链路

**A1 补录「青山湖水上森林」**
- 本地清单 `tools/place-shapes/venues.json` 已加草稿条目（名字/地址/圈地说明，polygon 空）。
- 边界点列取信源：在产品卫星图上沿真实林缘/草坡描边界 → 导出 GeoJSON（`downloadPlanGeoJson`，`properties.kind=boundary` 的 Polygon，GCJ-02 `[lng,lat]`）→ 脚本 `--from-geojson <file> --name "青山湖水上森林" --append` 回灌；不手估经纬度。
- 凭据补齐后 `--apply` 写库，再走线上公开接口 `/api/place-shape?name=...&near=...` 回读验证出框。
- 圈地范围（草坡舞台平台 vs 整片水杉林）先由用户拍板，描点列提交前给用户核对。

**A2 线上表去重与唯一约束**
- 核查 `place_shapes.name_norm` 是否有唯一索引；对重复行（IN77 ×7）合并保留几何最优一条，其余删除。
- 脚本增加去重/合并报告：同 `name_norm` 多行时列几何点数、面积、bounds，给出保留建议，不静默删行。

**A3 清单与线上表对账**
- 扩展 `upsert-place-shape.mjs` 预演/校验模式：输出三类差异——清单有表无、表有清单无、polygon 为空未描边；`--verify-only` 回读线上并与清单 diff。
- 对账结果落本地报告，不自动改线上。

**A4 录入口径校验**
- 入库前强制：GCJ-02 `[lng,lat]`、≥3 点、`isPersistablePlaceShape` 通过、bounds 非退化、name_norm 与常用搜索词一致；线型/垃圾几何拒绝入库。
- `drawWhat` 注明圈的是哪块地、不含哪些区域（林区/湖面/栈道），避免后代误扩。

### 模块 B · 自动挖掘召回放宽（functions/lib，非独占/基线）

**B1 空间命中标签扩充**
- `spatialAreaStage` 当前标签：building / landuse / leisure / amenity / shop / tourism / man_made / natural。
- 明确纳入 `natural=wood|forest`、`leisure=park|garden|nature_reserve`；保留类型白名单，不把任意 `natural` 都收进来。

**B2 郊野/公园面积门槛分级**
- 现状硬门槛：面要素面积 > 9e6㎡（3km×3km）滤除。改为分级：建筑/院落用紧门槛；公园/林地/景区放宽上限，但仍滤区域级行政地块；阈值集中为常量并可按标签分级，不在代码里散落魔法数。

**B3 别名与分段扩充**
- `shapeNameCandidates` / 归一：剥离城市前缀；补充常见后缀（景区、森林公园、湿地公园、水上乐园、度假区）与简称/全称互含判断；分段 around 半径按场地量级收敛，避免全城正则扫。

**B4 落空提示与兜底尺寸依据**
- 未识别到轮廓时，提示如实写明「未识别到场地轮廓，可在地图上手画」，不伪装成已出真实范围。
- 兜底矩形必须标注推算依据（人均占地 × 人数）与可调区间；无人数/依据时不出具体㎡，只给占位与下一步。
- 文案遵循 AGENTS.md §九：一句现状 + 一句下一步，不堆免责小字。

**B5 落空原因可观测**
- 记录未命中原因分类：无面要素 / 名字不匹配 / 超门槛 / 点不在面内 / 镜像超时熔断；供模块 D 聚合，不存敏感信息。

### 模块 C · 本机记忆层（自绘边界可复用）

**C1 自绘边界入本机缓存**
- 现状缓存只收挖掘结果；放开为：用户在图上闭合手画、或校正后提交的可信边界，经 `isPersistablePlaceShape` 校验后写入本机记忆缓存。
- 缓存键：地点名归一 + 锚点经纬度（沿用 `shapeCacheKey` 口径）；存来源标记（`source: manual | stock | osm`），与挖掘结果区分。

**C2 优先级与失效**
- 同地点再次进入：本机记忆 → stock → 挖掘；记忆边界可被用户重画覆盖。
- TTL 与容量复用现有 localStorage 机制（评估 14 天是否对自绘边界偏短）；草稿边界不进共享库、不上云。

**C3 草稿与真源分离**
- 本机记忆只服务本设备本次选址；不改变 `plan.boundary` 作为方案几何真源的地位；刷新/换设备后记忆缺失时回退自画，不报错。

### 模块 D · 结构化反馈回传（新表 + security definer RPC，人 review）

**D1 新表 `public.place_shape_misses`（migration，待 review）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text pk | 客户端生成幂等键 |
| `name` | text | 用户查询词原文 |
| `name_norm` | text | 归一后，去重/聚合键 |
| `lng` / `lat` | double precision | 定位钉坐标（GCJ-02） |
| `miss_source` | text | `osm` / `stock` / `none`；落空原因分类 |
| `drawn_polygon` | jsonb nullable | 用户随后手画的可信边界点列；无可画边界为 null |
| `note` | text nullable | 用户备注（长度上限） |
| `status` | text | `open` / `seeded` / `ignored`，默认 `open` |
| `hit_count` | int | 同地点短时合并计数，默认 1 |
| `created_at` / `updated_at` | timestamptz | 默认 now() |

索引：`(name_norm, created_at)`；`status` 单列索引供回看。

**D2 RPC 与 RLS（沿用 review_share_pins 先例）**
- 表 `enable row level security`，`revoke all from anon, authenticated`。
- `place_miss_append(...)`：`security definer`，校验坐标范围、名字长度、多边形可信（复用质量门），字段白名单；`on conflict (id) do nothing`；同 `name_norm` + 坐标网格短时合并 `hit_count`。
- `place_miss_list(p_status, p_limit)`：definer，供后台/内部回看；不向匿名开放全表枚举。
- 仅 `grant execute` 给 anon/authenticated；不开放表直连 insert/select。

**D3 前端静默采集**
- 未命中且用户在该场地停留、或随后完成手画时，后台 `place_miss_append`：带查询词、near、落空来源、（可选）手画边界、（可选）备注。
- 失败静默，不阻断选址、不弹错；不采账号、密钥、设备标识以外的隐私字段；同地点会话内去重，不重复上报。

**D4 反馈入口双轨**
- 提示条/菜单加「反馈这个场地缺轮廓」动作；结构化 RPC 为主，复用 `feedback-dialog` 预填地点+坐标+边界摘要开 GitHub Issue 作为轻量兜底（甲方案保留）。
- 入口文案只留动作事实句，不加解释小字。

**D5 后台回看**
- 按 `hit_count` 倒序列出高频缺轮廓场地；带 `drawn_polygon` 的标记为「可回灌候选」；`status` 流转 open → seeded / ignored。

### 模块 E · 回灌飞轮（人工校验后入共享库）

**E1 候选转录入**
- D5 中带可信边界的 miss 条目，经校验脚本导出为 `venues.json` 候选或 GeoJSON；人工核对边界与圈地范围后，走 A1 受控脚本 `--apply` 入 `place_shapes`。

**E2 状态闭环**
- 回灌成功后把对应 miss 置 `seeded`；之后同地点上报命中 stock，不再新增 open 行。

**E3 写入权限**
- 共享库写入只走 service_role 脚本或受控 definer RPC；anon 不可直写 `place_shapes`。
- 边界回灌前必须过几何可信门 + 人工核对；用户草稿不自动升级为共享轮廓。

**E4 远期自动闸门（不在本期放开）**
- 可选：高频 + 几何可信 + 多次一致的边界进入"待人工抽检"队列；抽检通过后入库。本期不实现匿名自动写库。

### 模块 F · 观测、测试与验收

**F1 命中来源与耗时埋点**
- 记录每次轮廓结果来源（`stock` / `osm:stage` / `cache-local` / `manual` / `none`）、耗时、落空原因分类；不存敏感信息。
- 与现有进程缓存、localStorage 口径对齐，不另造遥测真源。

**F2 测试分层**
- 纯函数：归一/同义、分级门槛、去重合并、可信度门、缓存键与失效。
- 服务端：RPC 校验拒绝非法坐标/垃圾多边形、幂等不重复插、计数合并、状态流转；stock 匹配唯一/多义不命中。
- 前端：提示条条件渲染、反馈预填、本机记忆读写与覆盖、手画边界不混入共享库。
- 既有套件回归：户外规划、搜索排序、轮廓解析相关测试不回退。

## 五、文件边界（预估，实施前再核对目录规范）

| 模块 | 文件/位置 | 边界判定 |
| --- | --- | --- |
| A | `tools/place-shapes/venues.json`、`tools/place-shapes/upsert-place-shape.mjs` | 工具脚本与清单，非独占非基线 |
| B | `functions/api/place-shape.ts`、`frontend/.../lib/place-area.ts`、`place-shape-quality.ts`、`place-search-options.ts` | functions/lib 侧；不改几何基线 |
| C | `frontend/.../lib/place-area.ts`、`hooks/use-place-shape-lookup.ts` | 前端缓存与 hook |
| D | 新 migration `supabase/migrations/<ts>_place_shape_misses.sql`；新 Edge Function 或复用既有 function 挂 RPC；前端采集 hook/组件 | DB 与函数契约属人 review |
| E | `tools/place-shapes/` 脚本扩充；回看视图另议 | 受控写入 |
| F | 对应 `tests/`、`frontend/**/*.test.ts(x)` | 测试侧 |

**不碰**：独占五文件、几何基线两文件；不另起并行 wire schema（契约以 `supabase/functions/_shared/domain.ts`、`client/scene-client.ts` 为准）。

## 六、分阶段排期

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| P0 数据补录与治理 | A1 水上森林描边回灌（待边界拍板 + 凭据）；A2 去重；A3 对账脚本；A4 口径校验 | 线上回读出框；重复行清单与处理建议；对账报告可跑 |
| P1 召回放宽与提示口径 | B1 标签扩充；B2 门槛分级；B3 别名分段；B4 落空提示与尺寸依据；B5 原因分类 | 城公园/林地可召回；落空文案与兜底依据到位；纯函数+服务端测试绿 |
| P2 本机记忆 | C1 自绘边界入缓存；C2 优先级/失效；C3 草稿与真源分离 | 同设备重进复用自绘边界；换设备/过期回退自画不报错 |
| P3 结构化反馈 | D1 表 + D2 RPC/RLS；D3 采集；D4 双轨入口；D5 回看 | miss 可上报、可去重聚合、可后台列表；migration 经人 review |
| P4 回灌飞轮 | E1 候选转录入；E2 状态闭环；E3 权限；E4 远期闸门评估 | 带边界候选可受控回灌并置 seeded；anon 不可直写共享库 |

推荐顺序：P0 → P1 → P2 先形成可用小闭环；P3 待 miss 场景被观测到一定量后开工；P4 接 P3 数据，不提前做自动写库。

## 七、验收脚本（真机 + 定向测试）

| 场景 | 操作 | 通过条件 |
| --- | --- | --- |
| 预埋出框 | 搜「青山湖水上森林」并选点 | 命中 stock，返回可信多边形；定位钉让位边界；bounds 包住锚点 |
| 城公园召回 | 选一个 OSM 有 leisure=park / natural=wood 的场地 | 空间命中间出对应面，不被门槛误滤；点在面内才取该面 |
| 多义不冒框 | 同名多地或区域级地块 | 不返回错误轮廓；降级只落钉并给手画提示 |
| 自绘复用 | 手画闭合边界提交，刷新会话后重进同地点 | 本机记忆调出同一边界；来源标 manual；不上云 |
| 反馈上报 | 轮廓未命中后停留/手画 | RPC 写入一条 miss；同地点会话内不重复；失败不阻断选址 |
| 回灌闭环 | 高频 miss 带边界，人工核对后入库 | 入 place_shapes，miss 置 seeded；再次搜索命中 stock |
| 去重对账 | 跑对账脚本 | 列出重复行、清单/表差异、空 polygon 条目；不自动删线上 |
| 隐私与权限 | 匿名端直连 miss 表 / place_shapes 写 | 被 RLS 拒绝；只能经 RPC execute；无账号密钥字段上报 |

验证命令（AGENTS.md §四）：`npm --prefix frontend run typecheck`、定向 Vitest、`run lint`、`run build`；根 `npm test` 与 `run check:edge`；记录原始输出与存量失败，不以测试通过替代真机画面验收。

## 八、风险、天花板与待拍板

### 8.1 数据源天花板（代码不可消除）

- OSM 对国内郊野公园/水上森林覆盖稀疏：无名林地面、游览 node 无几何；名字对不上；大片林地超门槛。代码放宽只能救回"OSM 本就有面"的场地，变不出真实轮廓。
- 高德/百度 AOI 为自有数据，公开拿不到；接入属付费授权议题，不在本规划默认范围。

### 8.2 风险

- 自绘边界质量参差：未经校验直接入共享库会污染检索；必须过可信门 + 人工核对。
- 反馈上报被刷：需限流、去重、字段白名单、坐标范围校验。
- 召回放宽后误框：门槛分级与"点在面内"双重约束保留，多义不命中。
- 凭据缺口：P0 写库依赖 `SUPABASE_URL` + `SERVICE_ROLE_KEY`；缺凭据只出预演与 GeoJSON 草稿。

### 8.3 待拍板项（决策点，未代选）

1. 水上森林边界圈哪块：活动草坡舞台平台，还是整片水上森林景区；取点方式（站端手画导出 GeoJSON 回灌 / 提供可读数卫星图描点）。
2. 召回放宽尺度：林地/公园面积上限放到多大；是否纳入 `nature_reserve` 等更多标签。
3. 反馈是否采集用户手画边界点列（涉及几何上传，而非仅文字+坐标）。
4. 本机记忆 TTL 与容量；是否允许跨设备同步（同步即上云，另立隐私议题）。
5. 回灌飞轮是否在本期排期，还是先做 P0–P2、P3/P4 视 miss 数据再定。
6. 是否启动付费商用 AOI 数据源的授权与可行性调研。

## 九、交付范围与当前状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| P0 数据补录与治理 | **草稿待续** | venues.json 条目已加；边界点列待取；线上表去重/对账脚本待做；写库凭据待补 |
| P1 召回放宽 | **未开工** | 现状链路与门槛已拆解，改动点待拍板后落码 |
| P2 本机记忆 | **未开工** | 现状只缓存挖掘结果 |
| P3 结构化反馈 | **未开工** | 沿用 review_share_pins 的 RLS/RPC 模式；migration 待 review |
| P4 回灌飞轮 | **未开工** | 写入权限与人工校验闸门待确认 |

本规划本身不部署、不改契约；所有 DB 迁移、Edge Function 与共享库写入动作在实施前须经人 review。现场实测备忘见 `docs/evidence/agent-live-test-2026-11-22/r8-clean-run-pending.md`。
