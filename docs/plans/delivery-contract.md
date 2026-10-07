# 幕景最小交付契约

最新范围（2026-10-07）：普通物料场景的本地执行工作单和可审阅导出已实现，复用既有编辑与持久化。下文云交付方案保留为后续候选，不代表已增加云接口或迁移。当前完整进度见 [开发检查点](../DELIVERY-PROGRESS-2026-10-07.md)。

日期：2026-10-07（Asia/Shanghai）
状态：本地 handoff 契约与单元测试已实现；下文项目级云接口、迁移和验收清单仍为候选方案。
核对基线：`codex/delivery-research-20261007` / `d139da72694cca53809eba444ee1c5b909cdb627`。

## 本轮已实现的本地契约

[delivery-contract.ts](../../supabase/functions/_shared/delivery-contract.ts) 导出 `handoffSchema`、`Handoff` 和 `handoffLimits`，用于逐实例本地记录及导出包；它没有 cloud revision、验收人、验收时间或账号授权语义。前端复用这一 schema，不再复制校验规则。

`handoffSchema.parse({})` 精确得到 `{"ownerName":"","dueDate":"","acceptance":"","status":"todo","evidenceUrls":[],"evidenceNote":""}`；`reviewedBasis` 缺省，不自动生成。每次解析的默认链接数组独立。姓名、日期、验收条件、证据说明及链接去掉首尾空白；reviewedBasis 是前端基于物件与场地固定字段序列化的核对依据，原样保存。

| 字段 | 上限与规则 |
| --- | --- |
| ownerName | 80 字符；普通草稿允许空 |
| dueDate | 空串或真实 `YYYY-MM-DD` 日期，年份 0001–9999；不转换为时间戳 |
| acceptance | 1000 字符；普通草稿允许空 |
| status | todo / doing / review / accepted，默认 todo |
| evidenceUrls | 最多 5 个互不重复的绝对 HTTP/HTTPS 链接，每条 2048 字符；拒绝账号密码、控制字符和内部空白；保留原查询参数，仅校验、不访问 |
| evidenceNote | 1000 字符，默认空 |
| reviewedBasis | 可选，最多 16384 字符；不代表云修订或不可变审计 |

todo/doing 可以保留未完成字段。review 必须有非空负责人、期限、验收条件。accepted 继承这三项要求，还必须有至少一个合法证据链接或非空证据说明，并有非空 reviewedBasis；纯空白不满足条件。未知字段和错误类型严格拒绝，不自动编造姓名、时间、证据或验收结论。

[delivery-contract.test.ts](../../tests/delivery-contract.test.ts) 覆盖精确默认值、独立默认数组、真实日期与世纪闰年、未知字段、状态要求、证据二选一、非空核对依据、URL 协议/查询参数/不访问、字段长度/数量及类型边界。2026-10-07 定向测试 **65 项通过**，根 `npm run typecheck` 通过。综合检查与前端持久化、导出验收由导演统筹；这些结果不表示下述云方案已经实现。

---

## 1. 后续云阶段候选决策与边界

推荐在 `scene_private.projects` 增加一个 `delivery jsonb` 列，保存一个版本化交付文档。每个场景物件实例最多一条交付项，记录执行说明、负责人或承接方、期限、进度、证据链接和最近一次人工验收。团队先用它完成自己的布展与外包交接。

交付项的业务键是 **`(projectId, SceneObject.id)`**。同一个 `assetId` 可以摆放多个实例，BOM 会聚合同规格物料，两者都不能代表某件待执行物件。复制物件生成新 UUID，新实例不会继承交付状态；原实例更换模型但保留 UUID，仍对应原交付项，已验收结果须重新核对。

首版限定为已保存的云项目、现有 owner/editor 成员和单项目整份交付文档。外包负责人用展示文字记录，可以填“某供应商／某负责人”；这不创建账号、邀请或授权。纯本地场景可以先做前端草稿，不能显示“已同步”或“已验收入库”。

首版不增加活动订单、报价、收付款、供应商账户、附件存储、独立任务中心、多级审批或跨项目统计。现有 `generation_jobs`、`reconstruction_jobs`、`agent_runs`、`requests` 的费用用于 AI 运行核算，不得映射为活动成本或付款记录。

| 方案 | 能满足的首版需求 | 代价与边界 | 采用条件 |
| --- | --- | --- | --- |
| 项目级 delivery JSON | 实例交付、人工验收、整单读取与保存；复用项目权限、租约、修订 | 同一项目一次只有一名编辑者；更新整份文档；对象引用需要事务校验；只保留最近一次验收 | **云阶段推荐候选**，确认跨设备需求后再实施 |
| delivery_items + acceptance_events 等多表 | 按任务分工、独立并发、不可变验收历史、数据库索引和统计 | 新增行权限、负责人关系、并发规则、事件模型及迁移；SceneObject 仍在 JSON 内，不能直接做实例 FK | 确认需要多人同时更新不同任务、不可变审计或跨项目报表时，再单独立项 |

JSON 的短板是明确的产品限制，不用预设多表或第二套版本机制掩盖它。

## 2. 唯一共享契约

后续云实现另行审查并扩展共享契约，沿用已有 `*-contract.ts` 模式。`supabase/functions/_shared/delivery-contract.ts` 当前仅声明本地 handoff schema/types/limits；以下 Delivery DTO 尚未实现，不能与 Handoff 混用或覆盖本地字段。本地与云 schemas 各自只在共享契约中声明，供客户端复用。云 schema 可导入现有 `uuid`、`leaseSchema`、`sceneSchema`、`objectSchema`，不把交付字段塞入严格的 Scene v1/v2。

API 校验输入和响应，`client/scene-client.ts` 与前端导入同一文件的 schemas/types，不能各写一份接口或只用 `as Delivery` 断言。字段列表如下；这是待实现 DTO，当前仓库尚无这些导出。

```ts
type DeliveryStatus = 'todo' | 'doing' | 'ready' | 'accepted';

type DeliveryItemInput = {
  objectId: string;                  // SceneObject.id，UUID
  instruction: string;               // 执行或验收要求，最多 500 字符
  assignee: string;                  // 展示文字，最多 80 字符；空串表示待分配
  dueOn: string | null;              // 真实 YYYY-MM-DD 日期；null 表示未排期
  status: DeliveryStatus;
  evidenceUrls: string[];            // 最多 3 条持久 HTTPS 链接
  acceptanceNote: string;            // 最多 500 字符
};

type AcceptanceRecord = {
  recordedBy: string;                // 服务端取得的 Auth actor UUID
  recordedAt: string;                // 服务端 UTC 时间，ISO 8601
  projectRevision: number;           // 验收写入成功后的项目修订号
  objectSnapshot: SceneObject;       // 验收时保存的实例规格与位置
  note: string;                      // 验收时 acceptanceNote 的快照
  evidenceUrls: string[];            // 验收时链接快照；不归档链接目标内容
};

type DeliveryItem = DeliveryItemInput & {
  lastAcceptance: AcceptanceRecord | null;
};

type DeliveryInput = { schemaVersion: 1; items: DeliveryItemInput[] };
type Delivery = { schemaVersion: 1; items: DeliveryItem[] };

type DeliveryItemState = {
  objectId: string;
  linkState: 'linked' | 'missing';
  effectiveStatus: DeliveryStatus | 'needs_review' | 'missing';
};

type DeliverySnapshot = {
  projectId: string;
  name: string;
  revision: number;
  updatedAt: string;
  snapshotAt: string;                // 服务端生成响应快照的时间
  sceneHash: string;                 // sha256(canonical(scene))，64 位小写 hex
  scene: Scene;                     // 与 delivery 来自同一项目行快照
  delivery: Delivery;
  itemStates: DeliveryItemState[];
};

type PutDelivery = {
  sessionId: string;
  generation: number;
  expectedRevision: number;
  delivery: DeliveryInput;
};
```

所有对象严格拒绝未知字段。`items` 最多 500 项且 `objectId` 唯一；未跟踪的场景物件不必生成空交付项。字段均显式传入，客户端新建一项时使用 `instruction: ''`、`assignee: ''`、`dueOn: null`、`status: 'todo'`、`evidenceUrls: []`、`acceptanceNote: ''`。服务端合并生成 `lastAcceptance`，客户端不得提交、伪造或回填它。

字符串按 schema 规定 trim；链接不重写查询参数或大小写。`dueOn` 校验日历日期，例如拒绝 `2026-02-30`，不能仅用正则；它是团队按 Asia/Shanghai 使用的日历日，不转换为 UTC 午夜。验收时间使用 UTC；前端按用户时区展示。

每条链接最多 2048 字符，必须能解析为绝对 HTTPS URL，拒绝用户名/密码、控制字符及重复链接。服务器不抓取、预览或检查目标站点。响应链接作为文字和安全外链呈现，不插入 HTML，不在页面加载时自动访问。普通文本按文本渲染。

沿用 API JSON 请求上限 **256,000 字节**，另外限制服务端生成后的完整 `delivery` JSON 存储体积为 **200,000 UTF-8 字节**，含验收快照。存储上限以数据库最终值的 `octet_length(delivery::text)` 为权威；前端的 JSON.stringify 字节数只能提前提示，因为 JSONB 文本序列化的空白可能不同。项目可以有 500 件物件，但不能同时把每项每字段都填到最大值；超限不得截断或部分保存。

## 3. 读取与保存接口

接口使用现有 `scene-api`、Bearer 会话、CORS、JSON 错误结构及 `Cache-Control: no-store`。

| 接口 | 请求 | 结果与权限 |
| --- | --- | --- |
| GET `/projects/:id/delivery` | 无正文 | `200 DeliverySnapshot`；当前工作室 owner/editor 可读；不要求租约 |
| PUT `/projects/:id/delivery` | `PutDelivery` | `200 DeliverySnapshot`；当前成员 + 有效编辑租约 + 修订一致；整份替换输入字段 |

项目创建或旧项目的默认存储值为 `{"schemaVersion":1,"items":[]}`，GET 返回空列表而非 404。`:id` 从路径解析，正文不允许传 `projectId`、`studioId`、actor、修订结果或验收审计字段。

GET 一次读取项目行中的 name/revision/scene/delivery/updated_at，再以这份已捕获的 scene 计算 hash 与派生状态。不能先 GET 场景、再独立 GET 交付后拼成一个“当前版本”。不改变项目修订，也不获取编辑权。DTO 的 `revision` 始终是项目全局修订号，不叫 `sceneRevision`。

PUT 在同一数据库事务中完成以下工作，复用 `scene_private.require_lease` 的项目行锁与鉴权语义。

1. 从已验证 JWT 得到 actor，检查项目未删除且 actor 是当前工作室成员。
2. 锁定项目行，核对 actor/sessionId/generation/有效期限与 `expectedRevision`，再检查实例绑定和验收规则。
3. 将输入字段与已有服务端验收记录合并；按规则生成或保留最近一次验收。校验最终体积。
4. 一次更新 `delivery`、`revision = revision + 1`、`updated_at`，不覆盖 scene；返回这一行的完整快照。

任何失败回滚全部变更。每次成功 PUT 恰好增加一次修订，即使内容等同；不承诺请求幂等重放，不自动重试写请求。响应丢失时先 GET 核对结果，不能拿旧修订号重发后将冲突解释为失败。

不新增 deliveryRevision，不另发一套交付租约。交付保存、场景保存、项目改名和提案应用共用项目修订号；因此交付写入也会使基于旧修订的 AI 提案失效。90 秒租约的续期、释放与 generation 规则不变。

### 错误契约

仍返回 `{"error":{"code":"…","details":…}}`。仅获授权后返回实例校验细节，不泄露别的项目或成员信息。

| 场景 | HTTP / code | 客户端处理 |
| --- | --- | --- |
| 缺少或失效的会话 | `401 UNAUTHENTICATED` | 保留草稿，停止写入 |
| 无成员权限、项目不存在或已删除 | `404 PROJECT_NOT_FOUND` | 同一结果，不探测项目存在性 |
| 租约过期、错误 session/generation、被移除成员后的旧租约 | `409 LEASE_LOST`；被移除后也可能先得到 `PROJECT_NOT_FOUND` | 停止写入，重新读取权限及租约 |
| 旧修订，包括同 session 并发场景写入 | `409 REVISION_CONFLICT` | 保留草稿，重读并人工合并；不静默覆盖 |
| 重复 UUID、未知字段、错误日期/状态/链接或伪造审计字段 | `400 VALIDATION_ERROR` | 修正输入；不阻断无关业务读取 |
| 新交付项不属于本项目当前 scene.objects | `422 DELIVERY_OBJECT_INVALID` | 不能用 assetId、BOM 行键、结构墙体 ID 或其他项目实例 ID 替代 |
| 尝试修改已断链项，而非原样保留或删除 | `422 DELIVERY_OBJECT_MISSING` | 删除该记录，或显式选择当前实例重新建立交付项 |
| accepted 缺负责人、缺验收文字且无证据，或实例缺失 | `422 DELIVERY_ACCEPTANCE_INVALID` | 完成必要记录后再验收 |
| 已 accepted 项仍保持 accepted，却修改其输入字段 | `409 DELIVERY_ACCEPTANCE_REOPEN_REQUIRED` | 先将状态改为 ready/doing/todo，再修改和验收 |
| 请求超上限 / 最终交付文档超上限 | `413 FILE_TOO_LARGE` / `422 DELIVERY_TOO_LARGE` | 精简文字或链接；保留本地草稿 |

JSON 格式和媒体类型继续使用已有 `INVALID_JSON`、`JSON_REQUIRED`。新的数据库错误须按上表映射，不能依赖 PGlite fixture 的宽泛 409 映射代表真实 HTTP 行为。

## 4. 验收、改场景与删除断链

状态含义固定为 `todo` 待执行、`doing` 执行中、`ready` 待验收、`accepted` 已人工验收。首版不强制逐级流转，可以直接录入已有线下验收；accepted 必须是操作者明确选择的状态。

从非 accepted 状态变为 accepted 时，服务端以事务中当前保存的 SceneObject 生成 `lastAcceptance`，记录 actor、数据库时间、写入后的 revision，以及验收文字/证据链接的快照。负责人必须非空，验收文字和证据至少有一项。它表示团队成员记录的一次人工验收，不表示供应商已在线签字或证据已经核实。

accepted 状态及所有输入字段均不变时，整份 PUT 保留原验收人、时间与快照，不能因编辑另一项重新盖章。accepted 状态下更改负责人、期限、要求、验收文字或链接，须先重开该项。重开保留 `lastAcceptance` 供核对；再次明确验收后替换为最近一次记录。首版不承诺完整历史或不可变审计；显式删除交付项也会移除该项最近验收，界面须说明这一后果。

**场景修改必须在共享 `scene_private.save_scene` 内同步处理交付有效性**，不能只在前端删除按钮补检查。现有普通保存、提案应用和历史恢复都走这个入口；追加迁移应保留全部原有场景、资产、版本与结构约束。

| 变化 | 同事务处理 |
| --- | --- |
| 场景物件未变化，或只改 camera/lighting/其他实例 | 对应交付状态与验收保持；不以项目 revision 不同直接判作失效 |
| venue 或 structure 内容变化 | 所有 accepted 项转 ready，保留最近验收，重新确认场地与摆放依据；首版按完整 JSONB 比较，来源或结构证据字段的变化也可能触发复核 |
| 已 accepted 物件的完整 SceneObject JSON 有变化 | 改该交付项 `status` 为 ready，保留旧 `lastAcceptance`；新验收需要明确操作 |
| 删除已绑定物件 | 保留交付项、负责人、期限、要求和旧验收；accepted 转 ready；读取派生 `linkState: missing`、`effectiveStatus: missing` |
| 恢复同 UUID 的物件 | 恢复实例连接并保留交付文字；删除时已撤回的 accepted 不自动恢复，仍须人工验收 |
| 复制或重新创建相似物件，UUID 不同 | 原项仍断链，新实例无交付项；不能靠相同 assetId/规格自动迁移负责人或验收 |
| 从场景移除 asset 引用 | 沿用已有 project_assets 保留逻辑；该资源授权不能证明实例仍存在 |

比较 SceneObject、venue 和 structure 使用数据库 JSONB 内容相等判定，无需第二套对象修订或 SQL 哈希算法；v1 的缺省 structure 视为空，v1/v2 场地转换也按此规则核对。改变模型、尺寸、位置、旋转、颜色、备注、锁定等任何实例字段都会触发已验收项复核，规则保守且可解释。scene 与这些交付变化一次更新，全局 revision 只加一；失败时一起回滚。

交付 PUT 的引用校验只接受当前 scene.objects 中的 UUID。为了清理历史断链，允许已有 missing 项输入字段原样保留，或从列表显式移除；不能新建 missing 项、修改 missing 项或验收它。重新绑定用“移除旧项 + 为选定当前 UUID 建新项”，新项不会继承服务端验收记录。不要自动过滤不存在的 UUID，这会丢失已经交给执行方的记录。

GET 的 `itemStates` 不持久化：先判断实例存在性，再判断状态。missing 优先显示；ready 项若保留的验收快照与当前实例不同，显示 needs_review；accepted 必须存在 `lastAcceptance` 且其中 objectSnapshot 与当前实例相同，否则也显示 needs_review。其他情况显示输入状态。这个防御性读取规则防止旧数据或遗漏写入口显示错误验收，不替代事务中的状态撤回。同 UUID 恢复为原规格后仍是 ready，不因旧快照相等自动恢复 accepted。

项目删除沿用现有 tombstone、owner、修订与忙碌检查。delivery 随项目行保留，但删除后两个新接口均拒绝访问，既有分享继续撤销，不新增删除例外。工作室成员移除继续在项目行锁下撤销租约；交付负责人是文字，不产生账号权限，也不因成员移除改写外包信息。`lastAcceptance.recordedBy` 保留原 UUID 作为内部历史事实，不代表此人仍是成员。

## 5. 前端依赖与写入顺序

前端方案需依赖以下后端行为，不能仅增加一个表格后通过 generic businessRequest 保存。

- 在 `BackendSession` 内增加 getDelivery/saveDelivery，复用当前身份、请求 scope、租约与 `operationPending`。复用 renameProject/saveScene 的版本更新模式：成功后同步项目、session revision 和 lease revision。所有项目写入串行；避免场景自动保存与交付 PUT 使用同一个 expectedRevision。
- 进入交付面板按 projectId + revision 绑定快照。GET 与当前编辑场景的修订不一致时保留本地草稿并提示重读，不覆盖正在编辑的场景。
- 尚未保存的新增物件不能提交交付。需要先成功保存场景，再用返回修订和保存后的对象 UUID 保存交付。验收和正式导出前处理场景草稿及交付草稿，读取最后一次一致快照；前端草稿不是验收依据。
- 以 objectId 定位单件，BOM 可用于显示统计或跳转列表。前端派生分组不能充当后端交付键；walls/openings/columns 尚不支持交付绑定。
- 显示断链记录和“待复核”，给出选定实例重建或显式删除入口；不静默清空记录。场景保存结果即使沿用原 SaveResult，也要使交付缓存失效并重读，因为后端可能撤回某项验收。
- 网络错误、401、租约丢失、修订冲突均保留草稿。租约或修订失效按现有写保护处理；字段校验错误只显示在相关交付操作中。
- accepted 是人工动作。场景撤销、历史恢复和重新读取不得自动选中 accepted 或自动补写验收。

租约 acquire 返回场景与 revision 的现有格式可以保留；取得新租约后必须读取匹配版本的 delivery，再提交交付写入。项目切换或身份切换须丢弃旧请求的回包，沿用当前 scope/epoch 防护。

与并行的 [前端方案](delivery-frontend.md) 对接时，应区分本地首版和本契约的云接入阶段。本地 `handoff.dueDate/acceptance/status: review` 分别适配为 `dueOn/instruction/status: ready`，按云契约的字段限额校验；不要再声明一套 API DTO。本地证据或“已验收”不能自动变成服务端验收，首次迁入按未验收状态保存后由成员明确验收。本地删除/撤销恢复的记录处理也不能直接充当云 PUT：云端保留断链项，撤销到旧规格不恢复 accepted；云接入后必须重读和遵守本文的状态规则。本地导出没有服务端项目修订时须标明本地来源，不能伪造 DeliverySnapshot 元数据。

## 6. 证据链接、附件与导出版本

首版 evidenceUrls 是用户提供的外链。可以记录验收照片所在共享位置或说明文档；链接存取权限、内容是否改变、链接能维持多久由其所在服务负责。不能把现有 300 秒资产签名 URL 当成持久验收材料，不保存会话 token、临时预览地址或浏览器 blob URL。不复用模型/floorplan 的 assets 表冒充交付附件。

未来附件需要独立的上传及权限契约：私有存储、稳定 attachment ID、文件类型/体积校验、项目授权、按需签名、删除/留存策略。若要求不可变证据，还需内容摘要与验收事件引用。到此需求成立时再迁移，首版不预建 bucket、上传 API、附件表或供应商入口。

首版导出由前端基于 **一次成功 GET/PUT 的 DeliverySnapshot** 生成可审查的交接文件，不新增公开分享或后台导出任务。文件头必须写入以下元数据，CSV 每行重复关键版本字段或随同一包携带 manifest，不能只凭下载文件名识别版本。

```ts
type HandoffExportVersion = {
  exportSchemaVersion: 1;
  projectId: string;
  projectName: string;
  projectRevision: number;
  sceneSchemaVersion: 1 | 2;
  sceneHash: string;
  deliverySchemaVersion: 1;
  snapshotAt: string;     // 服务端捕获快照的时间
  exportedAt: string;     // 客户端生成文件的时间，不能冒充验收时间
};
```

导出逐实例列出 objectId、当前规格/位置、执行要求、负责人、期限、进度及人工验收摘要；BOM 汇总只能作为附表。未跟踪物件数量、未分配负责人、未验收项须明确显示，不得由空列表推导“全场完成”。断链、needs_review 或未保存草稿存在时只能输出明确标注的待核对草案，不能生成标作可执行定稿的文件。

导出采用专用字段白名单，不能直接序列化整个内部 GET 响应；排除 scene.objects[].notes、来源图片/尺寸证据、账号 UUID 等内部信息，人工验收只展示必要时间和结果。执行要求、负责人和用户选择的证据链接属于交接内容，导出前由团队检查其适用范围。对 CSV 做正确引号转义并防止文本被表格软件当作公式执行。前端报告的未验收是进度，不得自动替团队下验收结论。

sceneHash 用现有 `canonical` + `sha256` 算法，代表这份 scene 全文；delivery-only 或改名可能改变 projectRevision 而不改变 sceneHash，两者都保留。实例验收记录中的 projectRevision 可以早于导出修订，只要实例快照仍一致；不把它当成当前文件版本。导出是下载时保存的一份快照，后来修改场景或交付不会更新已发文件。

现有 publications 冻结 scene/BOM/revision，没有 delivery。**首版 `/publish`、`/share/read` 不增加交付字段**，客户只读链接继续沿用现有内容；该链接不能被叫作执行交付定稿。若以后需要在线外包交接，应另行定义冻结 delivery 的 publication 字段和专用公开投影、权限及撤销策略，不能让匿名分享读取实时项目 delivery。

## 7. 追加迁移与实施边界

仓库基线有 **19 份迁移**，最后一份为 `20261003210000_preset_scene_access.sql`；根 README 的 16 份是旧快照记录。本轮不修改 README，也不将旧迁移重新执行或复制成新迁移。

实现阶段追加一个排序晚于现有迁移的新 SQL 文件；具体序号由执行该阶段时的迁移目录决定，不能预设仍是第 20 份。内容限于以下范围。

1. 新增 projects.delivery，使用非空版本化默认值；增加 JSON 顶层形状、items 数量和最终存储体积的约束。旧项目仍为 revision 原值、空交付文档，不凭场景或 AI jobs 反推历史交付。
2. 增加 delivery.get/delivery.put 的 scene_rpc 分支或受控包装，复用现有 service_role-only RPC 入口。新的分支同样检查未删除项目、当前成员；PUT 复用 require_lease。严格 DTO 校验由共享 TS 契约完成，数据库保障唯一实例键、绑定、验收生成和事务不变量，不能只信前端校验。
3. 追加替换当前 save_scene 实现，在原有所有逻辑上加入交付状态核对，保留 schema 降级保护、check_assets、资产引用保留及原返回字段。正常保存、proposals.apply、history.restore 均须经过相同检查。若实施时存在新增的 scene 更新入口，一并收敛到此入口。
4. 验收身份和时间在数据库事务内生成，objectSnapshot 从锁定项目的 scene 取得；不能用调用方提供的 actor/time/objectSnapshot。只返回完整成功快照。
5. 不新增可被 anon/authenticated 直读直写的表或 RPC grant；不放宽 RLS、既有 publish 权限、软删除保护或成员移除的锁顺序。不动旧 publication，不向既有客户分享增加字段。

Edge 实现加入两个路由、共享 schema 校验及明确错误映射；client/BackendSession 接入同一契约并更新项目修订。上述均是下一阶段待实现工作，本文不代表它们已经存在或上线。

本地验证使用全新隔离 PGlite 数据库同时覆盖“从零按序初始化”和“已有 19 份迁移 + 项目/发布数据后追加”。已有测试 fixture 校验迁移内容摘要，不能通过改旧迁移或清除真实本地数据绕过。发布数据库、Edge 和前端的顺序需另行审查；本轮不执行生产操作。

## 8. 必要验证与完成标准

以下是后续云实现的验收清单，**尚未实现或运行这些新增云测试**；本轮本地契约的 65 项定向测试结果见顶部。后续复用现有 fixtures 和测试框架，不引入新的测试基础设施。

| 层级 | 必须证明的行为 |
| --- | --- |
| 共享契约 | 空文档、最多项数/字节限额、唯一 objectId、真实日历日期、状态、HTTPS URL 和未知字段；伪造 lastAcceptance 被拒绝；服务端响应也经过同一契约验证；含中文及 JSONB 序列化空白的临界体积按数据库权威规则判定 |
| 实例绑定 | 相同 assetId 的两个实例独立进度；BOM 行键、结构 ID、另一个项目的 UUID、未保存实例均不能建立绑定；新建与重复引用的非法输入无部分写入 |
| 权限 | outsider、匿名、已移除成员和 deleted project 的 GET/PUT 被拒绝；owner/editor 的现有租约规则一致；anon/authenticated 不能直接执行新增 RPC 或读写私有数据 |
| 并发与修订 | 有效 PUT 全局 revision +1 且 scene 不变；过期租约、错误 generation/session、旧 expectedRevision 拒绝；交付 PUT 与 scene.save 并发只有一个成功；另一个返回冲突，双方均不丢数据；旧 AI 提案失效 |
| 验收 | actor/time/objectSnapshot/revision 来自服务端；其他项更新不重盖章；accepted 字段修改须重开；重新验收记录新事实；证据和负责人条件成立；最终超限回滚，包括服务端新增快照 |
| 场景变更 | 普通保存、提案应用、历史恢复各覆盖删除/更换/移动已绑定实例；旧验收保留但状态撤回；venue/structure 改变撤回所有 accepted；无关实例或 camera/lighting 修改不撤回；scene + delivery 一次修订且失败整体回滚 |
| 断链 | 删除后交付项仍可读取且标 missing；不能验收或新建 missing 项；可以原样保留/显式移除；同 UUID 恢复不恢复 accepted；新 UUID 不自动接管旧记录 |
| 生命周期 | 项目删除仍保留内部项目/交付/既有 publication，接口及旧分享失效；成员移除旧租约不能再写，文字负责人和历史验收 UUID 不授予权限 |
| 分享边界 | 发布后修改 delivery、scene，旧分享仍读原发布 scene/BOM；旧/新分享返回内容都没有负责人、交付要求、证据、验收记录或实时 delivery；签名后重查撤销仍生效 |
| 迁移 | 从零与从 19 份迁移升级都通过；旧项目/修订/publications/费用数据不变且新增空交付文档；旧迁移摘要保持；现有项目、成员、发布和提案回归不退化 |
| 前端与导出 | 先存场景再绑定；写入排队并使用返回修订；冲突/身份切换保留或隔离草稿；场景保存后交付缓存刷新；导出场景和交付来自同一快照，版本/hash齐全，断链及未跟踪物件明确，内部字段和 CSV 公式不进入交接文件 |

实施阶段复用 `tests/fixtures.ts` 的隔离 PGlite、`tests/database.test.ts` 的权限/租约/并发模式、`tests/api.test.ts` 的 HTTP 完整流程，以及 `tests/project-delete.test.ts`、`tests/studios.test.ts`、`tests/reconstruction.test.ts` 的生命周期和公开信息清理断言。HTTP 错误码须另测真实 backend 映射。

新增实现后执行根 `npm run check` 和 `npm run check:edge`；前端实现落地后执行其 typecheck、交互测试与构建。隔离测试通过不代表生产迁移或真实活动验收通过，不需要为本功能调用付费 AI 供应商。

完成标准是团队能在一个云项目中明确分配单件执行责任、保存与复核人工验收，并导出带确定场景版本的执行清单；冲突、实例删除和场景变更都不会把过时记录显示成有效验收。

## 9. 源码核对依据

- [场景及租约契约](../../supabase/functions/_shared/domain.ts)：严格 Scene v1/v2、SceneObject UUID、实例唯一性、leaseSchema、canonical/sceneHash。
- [共享契约示例](../../supabase/functions/_shared/reconstruction-contract.ts) 与 [客户端](../../client/scene-client.ts)：前后端复用 `_shared` schema 的既有模式。
- [HTTP 路由](../../supabase/functions/_shared/api.ts)、[数据库错误映射](../../supabase/functions/_shared/backend.ts)、[前端会话](../../frontend/lib/backend-session.ts)：JSON 体积、保存入口、会话/版本更新、写保护及分享签名后的二次检查。
- [基础数据库](../../supabase/migrations/20261002060304_scene_core.sql)、[v2 保存与公开投影](../../supabase/migrations/20261003090000_scene_v2_reconstruction.sql)、[最新 BOM](../../supabase/migrations/20261003210000_preset_scene_access.sql)：全局项目修订、publication 不可变快照、BOM 聚合及资源引用保留。
- [项目软删除](../../supabase/migrations/20261003120000_project_deletion.sql)、[工作室和成员删除](../../supabase/migrations/20261003140000_empty_studio_deletion.sql)：已删除项目访问保护、分享撤销、成员租约失效与项目行锁。
- [数据库 fixture](../../tests/fixtures.ts)：隔离 PGlite、按序迁移、迁移摘要保护与服务端身份替身；本轮不把历史测试存在视作已经执行。
