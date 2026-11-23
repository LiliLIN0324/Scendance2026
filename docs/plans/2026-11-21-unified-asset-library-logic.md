# 统一资产库与 Agent 调用逻辑盘点（2026-11-21）

> 状态：**逻辑盘点 + 目标模型提案，待评审**。本轮不改产品代码、不动持久化 schema、不改后端契约；线框表达见 `design-drafts/chat-panel-wireframe-v2-2026-11-21.html`。
>
> 触发：用户提出「所有能生成的素材——物料、人物、空间等——都归到一个库，像 Flowith 那样一枚『＋』直接调用」，并问这样是否让 Agent 更好调用。
>
> 一句话：方向成立。统一库既是**条目集合**，也是**生成入口集合**；分类（物料/人物/空间/风格）与来源（公共/团队/本人/本机/会话）正交。对 Agent 更友好的前提，是先收口三件事：**统一身份键、统一条目模型、生成产物回写同一注册表**。

## 1. 结论先行

1. **地基大半已在**：公共目录、我的生成、会话导入、人物登记表、场地壳、风格套、收藏、最近使用都有各自清单；物料 + 人物 + 生成已部分合流在 `online-model-library.tsx`。缺的是一层聚合表达与回写闭环，不是从零造库。
2. **Agent 调用会更顺**，但不是「把清单摆进同一个面板」就自动成立：现状身份键分散、条目模型不一、生成回写归属不一致，Agent 找候选要跨八份清单、匹配要兼容三路身份（见 §3.3）。
3. **目标模型**：一条目带稳定 id、分类、来源、持久化层级、能力与状态；「＋」按分类路由到既有生成/采集链路，产物回写同一注册表（§4）。
4. **边界不回退**：空间只有采集重建、没有文生场地；人物整人/换装/姿态开放度未定；手动导入 GLB 会话内有效；不引入 Flowith 那种图片参考角色（§6）。

## 2. 现状盘点：条目现在分存哪些清单（代码核实）

| # | 清单 | 条目形状 | 身份键 | 来源 / 持久化 | 生成能力 | 代码指针 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 公共物料目录 | `OnlineModel`：slug/assetId/名/原词/bucket/子类/宽深高/缩略/glb | slug、assetId | L3 公共目录 + 随包索引（528 登记 / 990 GLB） | 库内不可生成，只能选用 | `lib/online-models.ts`、`assets/library/asset-ids.json` |
| 2 | 我的生成（物料） | `GeneratedMaterialCard`：id/名/图/shipped/cloud/占地/描述/参考图 | id；摆放 slug `generated:library-<assetId>` | 本机注册表 → 保存方案时上传桥四态（local/uploading/uploaded/failed）上 L1；sha256 去重 | 文生 3D / 图生 3D | `lib/generated-material-cards.ts`、`lib/material-generate.ts` |
| 3 | 会话导入 GLB | `CatalogItem`（`my-items`） | glbUrl | 模块级内存数组，上限 40，刷新失效；不上云 | 无生成，本机文件导入 | `lib/my-items.ts`、`panels/local-glb-import.tsx` |
| 4 | 人物登记表 | `PersonSlot`：id/crowdType/性别/款/名/图/source/walkable/assetId/slug/legacy | PersonSlot.id、assetId | 云端 R2 `people/`；基线登记 + 验收批次；legacy 只读别名 | 分步链路：参考形象 → 四视图 → 静态人形 → 绑骨 → 动作重定向；**验收通过前不写人物库** | `lib/people-registry.ts`、`panels/character-design-panel.tsx`、`lib/character-generate.ts` |
| 5 | 空间 / 场地 | 场地壳 `VenueTemplate`/`SavedVenue`；扫描条目 assetId；云端案例目录 | templateId、savedVenue.id、扫描 assetId | 场地壳 localStorage（上限 24）；扫描登记在浏览器来源隔离存储；案例走后端会话 | 采集重建 + `.spz/.ply` 直传本机代理；**无文字生成场地链路** | `lib/venue-library.ts`、`panels/space-panel.tsx`、`lib/scan-upload.ts` |
| 6 | 风格套 | `StyleBundle`：整组搭配 | bundle id | 本机保存复用 | 非生成产物；当前搭配可另存为套 | `lib/style-bundles.ts` |
| 7 | 收藏 / 自建标签 | favorites、customTags、assignments | slug / 资产号 | localStorage（`scendance:material-library-meta`） | — | `lib/material-library-meta.ts` |
| 8 | 最近用过 | slug 列表 | slug | localStorage，上限 14 | — | `online-model-library.tsx` `ONLINE_RECENT_KEY` |
| 9 | 团队 / 消息 | 成员、私信、官方通知 | userId | 后端工作室；协作触点，**不是素材条目** | — | `lib/team-data.ts`、`lib/team-messages.ts`、`panels/messages-panel.tsx` |

三层模型库口径（沿用反馈文档 §10.3，不重复核实）：L1 本人云 `assets.owner_id = me`；L2 团队 `studio_assets` 提交—审核—approved；L3 公共 `published_assets` + `library_assets`。

## 3. Agent 现在怎么调用这些条目

### 3.1 提议 → 核对 → 确认才落画布

- 对话产出候选提案；库存核对 `candidate-inventory.ts`：身份三路 `material_id` / `asset_id` / `type` + 尺寸 + 可用数；代码注释明确**不能以名称猜测身份**。
- 落位守卫 `catalog-placement-guard.ts`：场景、楼层、登录身份、会话 epoch 任一变化即判失效；批量插入只认自己那批的同步变更，不被 ABA 挽回。
- 画布条目身份字段：`materialId` / `assetId` / `type` / `glbUrl` / `source`（generated / public_library / …）。

### 3.2 生成链路现状

- **物料**：对话点名生成 → staged 订阅 → 生成面板；`material-generate.ts` 两条 lane——direct 本机代理 / cloud 服务端队列；pending 任务号存 localStorage，完成后进「我的生成」。
- **人物**：`CharacterDesignPanel` 五步分步验收；产物在面板内预览，验收前不写登记表、不分配 assetId。
- **空间**：场地采集、扫描上传、案例选用；没有「一句话生成场地」。

### 3.3 现状对 Agent 不友好的五点

1. **身份键分散**：slug / assetId / materialId / type / `generated:library-<id>` / `local-glb:*` / people assetId / venue templateId 并存，提案匹配要三路兼容，新增条目还要再补一种。
2. **清单分散**：要找一个可放置物件，得跨公共目录、我的生成、我的物品、人群表、场地壳、风格套、收藏、最近使用八份清单拼候选。
3. **条目模型不统一**：各清单字段形状不同；能力（可放置 / 可生成 / 可上云）与状态（本机 / 上传中 / 已上云 / 失败 / 会话内）没有挂在同一条目上。
4. **回写归属不一致**：物料回「我的生成」；人物验收前不落库；空间不入库；导入件会话即弃。生成产物在下一轮对话里未必能被再次引用到。
5. **会话内件与持久件混排**：Agent 可能把只在本次编辑有效的导入件，当成可跨项目复用的资产去提议。

## 4. 目标模型：统一条目 + 正交维度（提案，未落地）

### 4.1 条目统一字段

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `id` | 稳定全局身份，带命名空间前缀：`catalog:` / `generated:` / `people:` / `venue:` / `style:` / `imported:` | 跨轮次、跨面板引用的锚点 |
| `kind` | `material` / `people` / `space` / `style` | 分类，决定表单与摆位规则 |
| `name` / `originalName` / `thumb` | 文本 / 地址 | 展示与搜索 |
| `source` | `catalog` / `team` / `mine` / `generated` / `imported` / `template` | 来源，与 L1–L3 库对应 |
| `persistence` | `session` / `local` / `cloud` | 复用范围；Agent 提议复用前先看这一位 |
| `cloudState` | `local` / `uploading` / `uploaded` / `failed` / `—` | 仅生成件；沿用现有四态 |
| `identity` | 下游解析用 slug / assetId / assetUrl | 保留现状三路，不逼下游一次改完 |
| `dimensions` | 宽深高 | 人物 / 空间可空 |
| `placement` | `ready` / `by-reference` / `not-placeable` | 空间基底是引用而非摆位物件 |
| `generate` | `none` / `text` / `image` / `flow`（分步） / `capture`（采集） | 这条目支持哪种创建方式 |
| `tags` / `favorite` / `recent` | 指针 | 收藏、标签、最近使用挂到同一 id 上 |
| `license` / `sourceLabel` | 文本 | 沿用现有授权与来源标注口径 |

### 4.2 两个正交维度

- **分类 `kind`**：决定交互规则。物料 = 尺寸 / 颜色材质 / 数量 / 删除；人物 = 岗位 / 人数 / 朝向 / 动作 / 所属动线 / 落座（不含尺寸颜色）；空间 = 选用基底，不摆位；风格 = 整组落画布。
- **来源 `source` × `persistence`**：决定可见性、权限与复用范围。L3 公共目录、L2 团队 approved、L1 本人云、本机注册表、会话内存，五层各有边界。

### 4.3 生成路由与回写

- 库内一枚「＋」按 `kind` 路由：物料 → 描述 / 图片生成表单；人物 → 分步角色设计面板；空间 → 采集 / 上传向导；风格 → 把当前搭配另存为套。
- 产物回写同一注册表的对应分区：物料 → 我的生成；人物 → 验收通过后写登记表；空间 → 场地库。回写后条目带新状态与稳定 id，下一轮对话可按 id 引用、再编辑、再摆放。
- 未开通的能力：「＋」置灰并写明原因，不放假按钮；人物分步未走完、空间未接通文生时，按现状能力表达。

## 5. 这样对 Agent 调用好在哪（逐条对应 §3.3）

1. **一个查询面**：全部可放置条目按 kind / source / state 过滤，Agent 不用再拼八份清单。
2. **唯一身份锚点**：命名空间稳定 id 为主，下游身份三路保留兼容；落位守卫与提案核对有确定锚点，不靠名字猜。
3. **能力与状态随条目走**：Agent 能看出能不能放、能不能生成、上没上云、是不是会话内件；提议复用前先读 `persistence`，不会把会话导入件当持久资产。
4. **生成回写闭环**：产物落同一注册表，后续轮次能引用 id、再生成、再摆放；不再出现「生成完找不到」的断链。
5. **语义与权限分开**：Agent 按业务语义选 `kind`，按权限选 `source`；公共目录条目与个人生成物不会被混为一谈。

## 6. 边界与不做（沿用前序口径）

- 不承诺实时多人共编；团队共享素材的范围另定（租约式单持编辑权）。
- 空间只有采集重建与直传，没有一句话生成场地；人物整人生成、换装、换姿态开到哪一步未定。
- 手动导入 GLB 会话键不持久化、不上云；收藏当前纯本地；上传沿用 10MB 上限、sha256 去重、license 来源标注。
- 不引入图片参考资产类型：Flowith 「角色」是跨镜头保持同一张脸的参考图，我方素材是 3D 物件 / 漫游角色，语义不照搬，「每个镜头同一张脸」这类文案不进产品。
- 本轮只盘逻辑与目标模型；涉及持久化 schema 与后端契约的改动单列评审，不进前端线框默认项。

## 7. 开放决策（待评审，不替现状拍板）

| 编号 | 待拍板 | 现状 | 倾向 |
| --- | --- | --- | --- |
| L1 | 统一条目先做前端聚合层（不改下游注册表），还是收敛底层 schema | 八份清单各管各的 | 先聚合层，下游注册表不动；schema 收敛排后端契约评审 |
| L2 | 空间页收录边界：扫描场地 / 地图基底 / 楼层 / 案例壳各收哪些 | 空间条目全在空间卡与地图来源体系 | 基底与扫描入库，楼层随方案走，不单独成条目 |
| L3 | 人物「＋」开放到哪一步：参考形象生成 / 整人 / 换装 / 姿态 | 五步分步，静态人形占位，验收前不落库 | 先接参考形象 → 四视图 → 人形；绑骨/重定向后置 |
| L4 | 模板「复制一份到我的库」是否本期做 | 基线直接选用，无副本语义 | 物料可后补；人物模板随人物库一起评 |
| L5 | 收藏上云、本机导入上云优先级 | 收藏 localStorage；导入会话内存 | 沿用反馈文档 §10.5：P1 收藏上云，P2 导入上 L1 |

## 8. 代码指针

- 物料目录：`frontend/components/room-organizer/lib/online-models.ts`
- 我的生成：`lib/generated-material-cards.ts`、`lib/material-generate.ts`、`lib/lux3d-import.ts`
- 会话导入：`lib/my-items.ts`、`panels/local-glb-import.tsx`
- 人物：`lib/people-registry.ts`、`lib/crowd-types.ts`、`lib/walk-roles.ts`、`panels/character-design-panel.tsx`、`lib/character-generate.ts`
- 空间：`lib/venue-library.ts`、`panels/space-panel.tsx`、`lib/scan-upload.ts`、`lib/plan-splat-placement.ts`
- 风格：`lib/style-bundles.ts`
- 元数据：`lib/material-library-meta.ts`
- 落位与核对：`lib/catalog-placement-guard.ts`、`lib/candidate-inventory.ts`、`lib/catalog-drag.ts`
- 库面板宿主：`panels/online-model-library.tsx`、`panels/generation-sheet.tsx`、`panels/material-create-cell.tsx`
- 对标与布局：`docs/plans/2026-11-21-workbench-layout-benchmark-target.md`；反馈记录 `deliverables/Flowith-IA反馈-2026-11-21.md` §10、§14

## 9. Flowith 实地走查记录（2026-11-21 晚，已登录会话只读）

> 走查对象：`flowith.io`（个人空间，会话「彩带畲歌里的周末」）。只读取与点击展开，未提交生成、未改账号状态；截图证据 `design-drafts/flowith-char-create.png` 等。

### 9.1 首页 / 项目层

- 左导航：空间切换（个人空间）、新建、媒体历史（`/gallery`）、应用（`/apps`）、知识花园（`/knowledge`）；下分置顶、项目（「幕景」，可创建新项目、展开）、最近（按今天/昨天/更早分组，带排序方式）。
- 主区作曲器：占位「让灵感开始流动，@ 引用任意文件，/ 使用任意技能」；已引用素材沉淀为 chips：风格 / 产品 / 角色 / 技能，chip 带具体条目名。
- 作曲器左：＋（上传文件/图片、连接、在项目中工作）；右：Agent 选择（Agent Flo）、模型档位（High）、偏好（自定义）、语音、发送。
- 「你的画布」最近会话卡片网格；内容分类行：全部 / 视频 / 图片编辑 / 人像与角色 / 营销与电商 / 创意生成 + 查看全部。

### 9.2 会话内「参考」面板（素材库 / 文件）

顶部两枚页签 + 关闭钮；素材库筛选条：**全部 / 角色 / 场景 / 产品 / 风格**。

- 通用交互提示：「点一下放到画布上，或拖到画布、拖进消息里」。
- 每分类首枚虚线新建卡：新建角色 / 新建场景 / 新建产品 / 新建风格（全部页统称「新建」）。
- 自有条目：缩略图 + 名称 + 一句描述 + 「更多操作」菜单。
- 模板区：标题「模板」+ 说明「现成的 X，使用时会复制一份到你的素材库」。角色模板按钮为「预览 名」；场景 / 产品 / 风格为「使用「名」」。模板带风格标签（写实 / 动漫 / 3D 卡通 / 儿童绘本 / 吉祥物 / 像素）与一句描述。
- 样本量：角色模板 15、场景模板 12、产品模板 12、风格模板 12。
- 全部页：自有条目按类混排；模板按角色 / 场景 / 产品 / 风格分组，每组带「查看全部」。

**文件页签**：上传内容 / 生成内容切换；图片 / 视频筛选；搜索媒体；选择 / 收藏；全部画布 · 排序方式；空态「暂无参考——上传或生成的图片会出现在这里，加入对话即可用来引导下一次生成。」

### 9.3 角色创建卡（点「新建角色」后落在对话/画布侧，非模态）

- 标题「新建角色」；说明「在你做的每张图、每段视频里，保持同一张脸和同样的形象。」
- 方式切换：上传照片 | 一句话描述。
- 字段：名字（占位「比如：林夏」）、描述（占位「可选：年龄、体型、标志性服装」）。
- 风格档：跟随参考图 / 写实 / 动漫 / 3D 卡通 / 儿童绘本 / 吉祥物 / 像素。
- 注记「存到你的素材库」；主钮「创建并生成设定图」。

### 9.4 画布层（对照用，不照搬）

节点式画布：对话节点、生成结果节点、分组（如「…10」）；右浮轨：插入自由节点、搜索节点、镜头、评论、历史记录、反馈；「新分支 +」；小地图、整理节点、发送键、缩放、帮助。会话顶：素材库开关、会话名、打开创作台、积分、邀请成员或 Agent。

### 9.5 对幕景可借鉴 / 不可照搬

**可借鉴**

1. **素材库与文件分两区**：可复用资产条目 vs 本会话上传/生成的媒体——对应我方「公共/团队/本人目录」与「我的生成/会话导入件」的分层。
2. **分类条 + 每类一枚虚线新建卡**；自有区在上、模板区在下；模板文案明确「复制一份到你的库」。
3. 条目 = 缩略图 + 名称 + 一句描述；点选与拖拽两种落位；条目动作收进「更多操作」。
4. **创作卡落在对话侧而非模态**：字段轻（名字 + 描述 + 风格档），产物去向用「存到你的素材库」注记，不打断画布。
5. 已引用素材在作曲器沉淀成 chips（风格/产品/角色/技能）；对应我方对话里引用已放物料/人物。
6. 文件页按上传/生成、图片/视频分筛，带搜索、收藏、跨画布排序。

**不可照搬**

1. 角色 = 跨镜头保持同一张脸的 2D 参考形象；我方人物是 3D 漫游角色 / 人群低模，没有「同一张脸跨镜头」语义，相关文案与链路不搬。
2. 模板角色是预设人脸；我方人物基线是岗位 × 性别 × 款槽位，「模板复制一份」的语义需另定（L4）。
3. 画布是视频分镜节点流 + 新分支；我方是单场景地图规划，不引入节点分支画布。
4. 媒体历史 / 应用 / 知识花园是内容平台概念；我方项目与版本历史已有独立链路，不另开平行导航。
