# B1-e 真机走查复核 · 生产站（2026-11-23）

> 去室内化主线 B1（会话/身份解耦）收口前的独立验收复核。本文件只记录本轮回生产站真实浏览器取证结果；历史本地桩 dev 环境结论见 `2026-11-21-indoor-decommission-goal.md` §真机走查（:350-361），**不冒充本轮生产站通过**。

## 0. 元信息

- **验收对象**：B1 会话 scope / 身份双轨（云项目 UUID、本机 `house-*`、禁止第三身份）与三条 flow：flow1 切项目不串数据、flow2 云工作区新建活动、flow3 刷新续开；外加本机 `house-*` 对照。
- **站点**：`https://scendance-scene-planner-ewz.pages.dev/`（生产静态导出，编辑器路径 `/editor/?project=<uuid>`）。
- **会话**：团队 `endTree的工作室`，当前角色负责人；成员「幕景 · 编辑」；页面无登录卡（登录态有效，账号身份字段未核实）。
- **授权与边界**：默认只读；用户已授权可真实创建云端项目，但本轮创建步未走到；未删除任何云端项目；未改生产码 / 测试；未提交、未 `git add`、未 push、未部署。
- **判定纪律**：PASS 必须有真实浏览器证据；UUID 格式正确不等于云项目存在；URL 变了不等于会话没串。无证据条目记 BLOCKED，不写 PASS。

## 1. 判定总表

| 条目 | 状态 | 一句话结论 |
|---|---|---|
| 既有云项目进入链路诊断 | ✅ 已闭环 | 产品链路人工可用；自动化阻塞根因已定位 |
| flow1 A↔B 切项目不串数据 | ⚠️ 部分旁证 / BLOCKED | 深链本地裸槽 A→B→A 活动名/需求句不串；六张云卡逐卡双击已取证（5 NOT_FOUND、1 只读），云端健康项目 A→B→A 不串对照仍缺 |
| flow2 待核 `2538691c…` 清单排他 | ⛔ BLOCKED | 清单可见但 DOM 不暴露 UUID；缺清单 UUID 排他与单项目 404/200 状态码；NOT_FOUND 回执已复现 |
| flow2 云工作区新建活动 | ⚠️ 部分旁证 / BLOCKED | 「新方案」入口可达，被 VenuePicker 场地选择流接管；未选场地、未点「开始规划」，发号 mint 未走查 |
| flow3 刷新续开与落点 | ⚠️ 部分旁证 / BLOCKED | 带参刷新身份与内容保持、活动列表异步恢复 10 个；云端是否回读未证实 |
| 本机 `house-*` 双轨对照 | ⚠️ 部分旁证 / BLOCKED | `house-*` 不当云项目、不发单项目云 GET；指定槽内容恢复未证实 |

## 2. 逐条证据

### 2.1 既有云项目进入链路（诊断闭环）

- **人工对照截图证据**：双击云卡后弹出浏览器原生确认框——「打开云端版本会替换当前画布。当前草稿将保留为本地恢复点。继续吗？」[确定 / 取消]。说明 React `enterProject → confirmReplace` 链路在产品侧正常走到确认步。
- **自动化排查（已排除项）**：
  - 选择器误匹配已纠正：云卡 `aria-label` 为「打开 …，双击进入」，前缀 `^="打开"` 会误匹配到「打开助手」按钮。
  - 按钮 `disabled=false`，无「他人编辑中」锁定标签，非只读 viewer。
  - 命中检查 `elementFromPoint` 命中按钮内封面 IMG，未被覆盖层拦截。
  - 事件探针：原生 `click` / `dblclick` / `keydown` 均到达按钮（计数递增），但 React handler 未发起 `GET /projects/<uuid>`、未弹业务 confirm、控制台无报错。
- **根因定性**：自动化环境双重限制——① 原生 `window.confirm` 未被显式 accept，被默认按「取消」驳回，流程中止；② 隔离世界内手动派发的原生 `dblclick` / `keydown` 触不达 React 处理器（**更正**：CDP 双击 `clicks=2` 路径本轮可用，见 2.7）；普通 `onClick` 经 CDP 坐标单击可用。**这是自动化驱动局限，不等于产品缺陷**；人工双击可进入。
- **已进入的云项目**：`583dbff1-a3f0-47a4-bdea-d7598e7aa76b`（人工双击进入），URL `?project=583dbff1…`；标题「做200人发布会，签到台放西侧入口，留出通道」；左侧活动列表「共 10 个」，画布「当前物料 0 件」（两个计数不同，勿混）；红线 4 点 40.0×30.0 m / 1200 ㎡。本机存在该裸 UUID 的 plan / flow / session / bodies 信封（按 `project:583…` scope 落盘，非 `house-` 前缀）。

- **现场复现：双击非当前云卡 → 确定后未替换（2026-11-23 用户人工操作）**：账户中心清单共 6 卡——当前项目「周末共创工作坊」（标记「当前 · 场景已保存 · v0」）+ 5 张可双击云卡（新活动 11-23 18:38、我的活动方案、新活动 11-18 07:46、自动验证-确认循环、Flow C 直径测试）。用户双击其中一张非当前卡，原生 confirm「打开云端版本会替换当前画布…继续吗？」点确定后，画布未被替换，落下红字回执「项目已不存在或已被删除，当前画布仍是本机草稿，可继续编辑。」；当前项目「周末共创工作坊」保留未丢。链路判定：confirm 已生效，随后 `enterProject → controller.getProject(project.id)` 未取到该项目，进 catch 保留草稿并渲染 `PROJECT_NOT_FOUND`。**未钉死项**：被双击的具体卡号与 GET `/projects/<id>` 状态码（404 已删/不存在 vs 403 无权限）未抓到——网络缓冲被轮询清空（`total=0`），云卡 DOM 不暴露 UUID。清单中「自动验证-确认循环」「Flow C 直径测试」两张无封面缩略图（`no-thumb`），是否对应云端场景/版本缺失待核。

### 2.2 flow1 切项目不串数据 — 部分旁证 / BLOCKED

**本轮新增：URL 深链裸槽 A→B→A 对照（本地信封槽，非云端双击切换）**

- 本机裸 UUID plan 槽三个：`9a889d2b-…`、`583dbff1-…`（A）、`80c3158d-…`（B）。
- **A 基线**：活动名「新活动 11-18 07:46」，需求句「做200人发布会，签到台放西侧入口，留出通道」，活动列表 10 个，红线 4 点 40.0×30.0 m / 1200 ㎡。
- **B 深链** `?project=80c3158d-498a-41b1-a15e-5611029add91`：活动名「我的活动方案」，需求句「我想在临安青山湖水上森林办一场下午的瑜伽疗愈活动…」，活动列表 10 个；未显示 A 的「11-18 07:46」活动名。
- **切回 A** `?project=583dbff1…`：活动名仍为「新活动 11-18 07:46」、需求句仍为「发布会…」、红线保持；未被 B 的「我的活动方案 / 瑜伽疗愈」串入。
- **口径限定**：这是本机裸 UUID 本地信封槽之间经 URL 参数导航的槽隔离旁证；**不等同卡片墙双击进入云端项目的切换**。两个裸 UUID 槽是否各自回读云端，本轮未抓到单项目 GET 证据。

**仍受阻的部分（云端第二项目切换）**

- 自动化第二次切换受阻：对「我的活动方案」等云卡尝试 CDP 双击、ref 双击、原生 dblclick 派发、聚焦后 Enter，均未发起项目加载请求；`confirm` 已在探针中应答为继续仍无动作。
- 未取得云端 A→B 会话隔离、切回 A 不丢会话的生产站真机对照（卡片墙双击云项目切换）。
- **不沿用历史桩环境结论冒充生产站通过**：台账 :353-357 的 A↔B 不串不丢，是本地桩 54329 + dev 3210、owner 桩账号、预置 A/B 两个项目环境下的取证，与本轮生产站不是同一环境。

### 2.3 flow2 待核项目 `2538691c-4de8-4c90-9062-f19a5da72bcd` — BLOCKED（部分旁证）

- **本机信封**：`localStorage` 键名枚举，无任何含 `2538691c` 的 plan / flow / session / brief 信封（`keys=[]`）。
- **深链观察**：`?project=2538691c…` 打开后，URL 的 project 参数一度保留；页面未见「项目已不存在或已被删除」的即时回执；画布回落最近本地缓存（「新活动 11-18 07:46」）。
- **清单旁证（本轮新增）**：账户中心「所有方案」dialog 成功拉起，列表为 1 行本机草稿（当前·本机·未上传）+ 6 张云卡——「新活动 11-23 18:38」「我的活动方案」「新活动 11-18 07:46」「自动验证-确认循环」「周末共创工作坊」「Flow C 直径测试」，加「新方案」入口。**云卡 DOM 不暴露项目 UUID**：按钮无 `data-project-id` / `data-id` / `href`，UUID 绑定在 React state，界面层读不到清单 UUID。
- **NOT_FOUND 回执复现（本轮新增）**：dialog 底部出现红字「链接中的项目已不存在或已被删除；当前画布仍是本机草稿，可继续编辑。」（`PROJECT_NOT_FOUND` 文案，`backend-session.ts:361`）。说明未命中云端时回执路径会被渲染；但回执是否伴随清参、单项目 404 状态码，本轮未抓到。
- **网络**：resource timing 与 `network_requests` 缓冲被 `studios` / `notices/unread` 轮询不断清空（`total=0`），未捕获到 `GET /projects/2538691c…` 的 404/200 状态码，也未取得清单响应体的 UUID 排他。
- **不能判定**：缺 `listProjects` 清单 UUID 排他 + 单项目 GET 状态码，既不能判云端不存在（FAIL），也不能判存在（PASS）。
- **背景挂账**：台账 :361 记录该 id 是本地桩 dev 环境第十一轮新建活动 mint 出的**裸槽 UUID**，不是生产云项目；按 C4 终态口径，既非云项目号、又非 `house-*` 前缀的第三身份不应存在，槽轨道归属随 B2/B3 定稿。

### 2.4 flow2 云工作区新建活动 — 部分旁证 / BLOCKED

**本轮新增：入口可达，被 VenuePicker 场地选择流接管（未走到发号步）**

- 账户中心「所有方案」dialog 可正常拉起；底部「新方案」按钮（`sc-file-new`，aria-label「新方案」）可见、非禁用。
- 点击「新方案」后**未直接发号 mint**：源码链路 `cloud-panel.tsx:1449-1453` 先派发 cancelable 的 `scendance:start-new-project` 事件；`agent-panel.tsx:4259-4263` 监听并 `preventDefault()` 调 `startVenuePicker()`，由工作台场地选择器接管。
- 真机旁证：点击后 `.sc-venue-overlay`（`role=dialog`，aria-modal，标题「换场地 / 新建」）被挂载，DOM rect 宽 716（截图视口内未铺出，疑定位在画布下层或容器裁剪）；`.sc-venue-picker-grid` 内 10 张场地卡：从空白开始 / 从地图开始 / 复刻示例 / 已有项目（`projects.map`）/ 新建项目（起名字）。底部「取消」与「开始规划」(`sc-venue-picker-go`，`confirm`) 按钮；只有点「开始规划」才进入 `createProject` 发号。
- **本轮止步位置**：未选场地卡、未填名称、未点「开始规划」；按 Esc 关闭浮层（`closeVenuePicker`），overlay DOM 移除，URL 仍为根路径、无新 UUID；未真实创建任何云端项目。
- **未走查项**：`createProject → 标准云 UUID → 跳 /editor/?project=<uuid>` 的真机发号链路未触发；云新建槽轨道（云 UUID vs `house-*`）与 B2/B3 口径对齐前不代建。
- 本机新建 `createFreshActivity → house-<uuid> → ?project=<id>&mode=outdoor` 路径同样未主动触发（本机草稿创建不在本轮明确授权范围内，保守不代建）。
- 历史桩环境 flow2 mint 独立槽未闭环，见台账 :359-361（写租约排队自愈、新槽为裸 UUID 等）。

### 2.5 flow3 刷新续开与落点 — 部分旁证 / BLOCKED

- **已观察到的一致性旁证**：带参 `?project=583dbff1…` 刷新后，URL 保留 project 参数；需求句「做200人发布会…」保持；红线 4 点 40.0×30.0 m / 1200 ㎡ 保持；本地 plan / flow / session / bodies 信封按裸 UUID scope 落盘；未回落到本机草稿「新活动 11-23 18:38」。
- **本轮 reload 加固**：重载瞬间活动列表处于「正在读取活动列表…」过渡态（计数 1 个），等待稳定后恢复为「共 10 个」；活动名「新活动 11-18 07:46」保持。说明刷新后会话身份与列表恢复链路可走完，未在过渡态回落草稿。
- **未证实项**：刷新是否重新回读云端单项目 `GET /projects/583…` 未抓到证据（`network_requests` 缓冲被 `notices`/`studios` 轮询清空，`total=0`，resource timing 仅见 `studios`）。云权威回读与纯本地缓存续开，在只读条件下无法区分。
- 历史桩环境 flow3 按方案 B 续开符合预期，见台账 :352。

### 2.6 本机 `house-*` 双轨对照 — 部分旁证 / BLOCKED

- 深链 `?project=house-146b05eb-c8a1-48b7-a636-937a251afc37&mode=outdoor`：URL 保留 `house-*` 前缀与 `mode=outdoor`；resource timing 仅有列表 `GET /projects` 与 `studios`，**未发起该槽单项目云 GET** —— `house-*` 未被当作云项目打开，双轨身份判定正确（对齐 `geometry-workbench.isLocalProjectParam` / `projectLinkKind`）。
- **未证实项**：指定 `house-` 槽内标题/物料是否准确恢复，受「不读取 localStorage 值」约束未逐槽比对；画布回落显示最近缓存内容。
- 摘要给定的对照槽 `house-ab81438e-fc22-47bc-8e73-085762bdaf73`，本机无任何信封。
- 本机现存完整 UUID 形态 `house-` 槽：`146b05eb` / `c49ace4e` / `7b4c753c` / `61eea7e0` / `c5dae262` / `47d4d88f` / `3448ed0f` / `61b46977`（另有若干短码 `house-xxxxxxxx` 槽）。

### 2.7 六张云卡逐卡双击取证（本轮真机，2026-11-24 复核）

**触达方式更正**：本轮用 CDP 双击 `bu.click(ref, clicks=2)` 成功触达云卡 `onDoubleClick` handler——URL 切到对应云 UUID、发出 `lease/acquire`、`sources`、`lease/renew` 请求。早前 2.1 / §3「dblclick 合成事件触不达 React」的结论需部分更正：CDP 双击路径可用；`onKeyDown Enter` 与隔离世界内派发的原生事件仍触不达。`confirmReplace`（`cloud-panel.tsx:627-628`）在草稿 `!dirty` 时**不弹 confirm** 直接放行，故本轮多数卡未出现原生确认框。

逐卡结果（双击后读 URL、面板回执 `.sc-account-footnote/.sc-account-error`、卡状态、封面）：

| # | 卡名 | 项目 UUID | 双击后 URL | 面板回执 | 卡状态 | 封面 | 定性 |
|---|---|---|---|---|---|---|---|
| 1 | 新活动 11-23 18:38 | `394e2174-37e5-4859-bf28-b9e926bb0d56` | `?project=394e2174…` | 项目已不存在或已被删除，当前画布仍是本机草稿 | （无当前标记） | 有 | `PROJECT_NOT_FOUND` |
| 2 | 我的活动方案 | `80c3158d-498a-41b1-a15e-5611029add91` | `?project=80c3158d…` | 项目已不存在或已被删除，当前画布仍是本机草稿 | 当前 · 场景已保存 v0 | 有 | `PROJECT_NOT_FOUND` |
| 3 | 新活动 11-18 07:46 | `583dbff1-a3f0-47a4-bdea-d7598e7aa76b` | `?project=583dbff1…` | 编辑权已到期或交接，草稿已保留 | 当前 · 只读 | 有 | **项目存在，只读打开**（非 NOT_FOUND） |
| 4 | 自动验证-确认循环 | `99acd050-6b07-47a6-bec8-0b1f14aafe39` | `?project=99acd050…` | 项目已不存在或已被删除，当前画布仍是本机草稿 | 当前 · 场景已保存 v0 | 无 | `PROJECT_NOT_FOUND` |
| 5 | 周末共创工作坊 | `9a889d2b-0e71-45bd-90b7-d9f36f7b665d` | `?project=9a889d2b…` | 项目已不存在或已被删除，当前画布仍是本机草稿 | 当前 · 场景已保存 v0 | 有 | `PROJECT_NOT_FOUND` |
| 6 | Flow C 直径测试 | `73b1a823-1faf-4bb9-96bc-13a1332a8726` | `?project=73b1a823…` | 项目已不存在或已被删除，当前画布仍是本机草稿 | 当前 · 场景已保存 v0 | 无 | `PROJECT_NOT_FOUND` |

**汇总**：6 张云卡中 **5 张 `PROJECT_NOT_FOUND`**（#1/2/4/5/6），仅 **#3 `583dbff1` 项目存在、以只读进入**。NOT_FOUND 卡画布均未被云场景替换，仍是本机草稿；其中 4 张卡面标「场景已保存 v0」，该本地/陈旧标记与后端实际可回读状态不一致。两张无封面卡（#4/#6）均落在 NOT_FOUND，但封面缺失与回读失败的因果未单独证实。

**后端只读核查（静态 SQL / RPC，未打库、未重放接口）**：

- 云卡数组来自 `controller.listProjects()` → `GET /projects`（`backend-session.ts:980`）；本机草稿在卡片墙是独立一张卡（`cloud-panel.tsx:1363-1365`「当前 · 本机 / 本机 · 未上传」），不混进 `projects` 数组。`:312` 乐观补卡只补「当前打开项」，不批量补残留。
- RPC `scene_rpc`：`projects.list`（`20261003120000_project_deletion.sql:21-27`）条件 `deleted_at is null AND is_member(actor, studio_id)`；`projects.get`（同迁移 `:28-45`、`scene_core.sql:201-205`）条件行存在 + `is_member` + `deleted_at is null`。**两处过滤口径一致**，清单有卡、单项目 NOT_FOUND 不能归因于软删标记口径差。
- 前端 NOT_FOUND 由 `getProject` → `request('/projects/<id>')` 抛 `PROJECT_NOT_FOUND` 映射（`backend-session.ts:361`、`1544`）；该 code 在后端 `require_lease`/get 分支由「行不存在 / 非成员 / 已软删」抛出。

**遗留 BLOCKED（本轮不能定性）**：

- 单项目 GET 的真实 HTTP 状态码（404 行不存在/无权限/已软删 vs 502 场景损坏 vs 空场景）未抓到：`network_requests` 只保留归一化 `status:"ok"`，不含 HTTP code；缓冲又被 `studios`/`notices` 轮询挤出。
- 「list 返回、get NOT_FOUND」的数据层根因（项目行缺失 / 成员关系被移除 / 工作室软删 / 场景字段损坏 / 前后端 RPC 部署版本不一致）需有数据库只读访问或 Edge Function 日志后复核；本轮不打库、不绕过 API。
- #3 只读进入后未取得写租约（`编辑权已到期或交接`），其场景内容是否完整回读、与本机信封是否一致，未逐字段比对。

### 2.8 生产站新构建复核（2026-11-24 下午，B1 失效隔离真机）

> 前置：身份四态 + 失效隔离代码已在远端 main（`9400ef6c`，`git ls-remote origin main` 实证同提交）；生产静态站加载的是含新口径的构建（chunk 含「无法访问 / 本机备份 / orphan- / STUDIO_NOT_FOUND / 本机缓存副本 / 失效（」；早前误判旧构建是中文中点/空格编码匹配问题）。

**项目墙静态 DOM（面板「所有方案」打开后枚举）**

- 1 张本机草稿 + 6 张云卡；失效折叠区 `.sc-account-invalid` 为 `null`（不存在空壳；列表里 7 个 `details.sc-file-more` 是卡片「更多操作」菜单，非失效区）。
- 6 张云卡 `disabled=false`，无只读 / 缓存 / 失效徽标；本机活动列 9 个槽（`sc-activity-card-clickable`）均留在本机列，未被误判进云失效区。
- 页面无「离线 / 网络失败 / 稍后重试」类回执。

**单卡进入取证：`394e2174-37e5-4859-bf28-b9e926bb0d56`（新活动 11-23 18:38）**

- 双击进入后 URL 挂到 `?project=394e2174…`；底部 `.sc-account-error` 红字：「项目已不存在或已被删除，当前画布仍是本机草稿，可继续编辑。」（`PROJECT_NOT_FOUND` 文案，`backend-session.ts:361`）；当前卡徽标「当前 · 失效 · 本机草稿」（`saveStatus` 中 `missingProjectIsThisCanvas` 分支）。
- 画布未被云端场景替换，仍是本机草稿；本机信封 / 草稿未删、未覆盖——符合「失效只读保留备份、不删不迁不改 id」口径的表现。
- 截图（本地 temp，不入库）：`b1e-394e-opened.png`（进入后画布 + 左侧活动名）、`b1e-394e-notfound.png`（项目墙网格 + 底部 NOT_FOUND 回执条）。

**网络与代码链路（静态核对 + 缓冲观察）**

- `peekProject`（`backend-session.ts:1397`）与 `getProject`（`:1535` → `:1544`）打**同一端点** `GET /projects/<id>`；`request`（`:699-736`）`catch` 末尾 `:735 throw error`，错误原样抛出、`code` 保留；`suppressProjectFailure`（第 9 参）只控制是否 `block(error)` 落会话级 error，不改变抛出的 `SceneApiError.code`。
- `reachabilityFromError` 仅 `PROJECT_NOT_FOUND` / `FORBIDDEN` / `STUDIO_NOT_FOUND` 判 `unreachable`；网络抖动 / 5xx / 无码归 `unknown`，不置永久失效。
- 缓冲观察：预检阶段多条 `GET /projects/<uuid>` 被归一化为 `ok`；`394e2174` 早期一次 GET 为 `net::ERR_PROXY_CONNECTION_FAILED` / `ERR_NETWORK_IO_SUSPENDED`（本机代理瞬断，非 HTTP 404；系统代理 `127.0.0.1:7897` 复测在监听，经代理到 supabase.co 边缘可达、pages.dev 200）；进入后有 `lease/renew` 轮询 `ok`。**单项目 GET 的真实 HTTP 状态码与响应体 `error.code` 仍未抓到**：`network_requests` 不保留 HTTP code / 响应体，缓冲被 `studios` / `notices` 轮询挤出。

**未定性根因（BLOCKED，不代判）**

面板预检未把这张 NOT_FOUND 卡折叠进失效区，两种候选尚未区分：

1. **peek 那一刻后端可达**：预检 `GET` 返回 200 摘要，进入 `getProject` 时才失败（两次请求间后端行 / 成员 / 软删状态变化，或完整场景读取才暴露损坏）。
2. **错误码未命中白名单**：peek 失败但抛出 `HTTP_ERROR` / `INVALID_RESPONSE` / `NETWORK_ERROR` 等非白名单码，被归 `unknown`，按设计留在活跃列表、不置永久失效。

定性仍需：可抓包环境取单项目 GET 状态码 + 响应体 `error.code`，或 DB 只读 / Function 日志核行存在性、成员关系、`deleted_at`、场景字段、RPC 部署版本。本轮不打库、不绕过 API。

**自动化触达更正（补充 §3）**

本轮在页面脚本内对按钮派发冒泡原生 `dblclick`（`new MouseEvent('dblclick',{bubbles:true,cancelable:true})`）**成功触达** React `onDoubleClick`：URL 切到云 UUID、发出 `lease` / `sources` / `lease/renew` 请求。`bu.click(ref, clicks=2)`、坐标 `left_double`、聚焦后 `press_key('Enter')` 本轮未稳定触达；`bu.cdp` 报 `Session with given id not found`。普通 `onClick`（菜单、面板打开）经坐标单击仍可用。

### 2.9 Supabase DB 只读旁证（2026-11-24 晚，控制台 SQL Editor，未写库）

> 入口：Supabase 控制台项目 `wkhfvnzgopjdzxlmycks` → SQL Editor；全部 `SELECT` 只读，未 `INSERT/UPDATE/DELETE`、未改迁移、未删项目。生产站账户菜单显示名 `endTree` / `endTree的工作室`。

**六卡 + 待核裸槽行状态（`scene_private.projects`）**

| UUID 前缀 | 行存在 | deleted_at | studio | created_by | objs | revision |
|---|---|---|---|---|---|---|
| `394e2174-…` 新活动 11-23 18:38 | 是 | NULL | `8b033463…` | `56356f34…`(endTree) | 0 | 0 |
| `80c3158d-…` 我的活动方案 | 是 | NULL | `8b033463…` | `56356f34…` | 0 | 0 |
| `583dbff1-…` 新活动 11-18 07:46 | 是 | NULL | `8b033463…` | `56356f34…` | 0 | 0 |
| `99acd050-…` 自动验证-确认循环 | 是 | NULL | `8b033463…` | `56356f34…` | 0 | 0 |
| `9a889d2b-…` 周末共创工作坊 | 是 | NULL | `8b033463…` | `56356f34…` | 5 | 0 |
| `73b1a823-…` Flow C 直径测试 | 是 | NULL | `8b033463…` | `56356f34…` | 0 | 0 |
| `2538691c-…` 待核裸槽 | **否（云端无行）** | — | — | — | — | — |

- 六卡 scene 结构合法：`schemaVersion='1'`、`objects` 为 array、`venue` 在；`lease_session` 非空。同 studio 另有 2 行已软删（`d4f89f6b…` objs 307、`775145ad…` objs 5，`deleted_at` 2026-11-09 13:41），不在六卡之列。
- 工作室 `8b033463-3511-4ac4-96d3-e558e49f507f`（endTree的工作室）`members` 仅 1 人：`56356f34-a34f-4745-b418-29e16e1de728` / `2487238628@qq.com` / display_name `endTree` / role `owner`。

**DB 迁移与 RPC 版本（与本地 main 对照）**

- `scene_private.projects` 实际 13 列：`id, studio_id, created_by, name, scene, revision, lease_user, lease_session, lease_generation, lease_expires, created_at, updated_at, deleted_at`——**无 `visibility` 列**。
- `supabase_migrations.schema_migrations` 最新已应用版本：`20261120120000 review_share_link_revoke`；本地 main 晚于此的迁移（含 `20261120150000_project_visibility`）**未应用到生产 DB**。
- DB 内最外层 `public.scene_rpc`（2298 字符）只含资产发布 / 列表分支，函数体**无 `PROJECT_NOT_FOUND`、无 `visibility` / `can_read_project`**；其委托内层 `scene_rpc_before_project_delete`（4073 字符）的项目判定为 `not found OR NOT is_member → PROJECT_NOT_FOUND`，与本地 `20261002060304_scene_core.sql:202` 一致，无 `deleted_at` / `visibility` 附加条件。`scene_private.is_member` DB 定义 = members 表存在性，与本地一致。

**本轮排除的 DB 层根因**

1. 行不存在——仅 `2538691c…` 成立；六卡行都在。
2. 已软删——六卡 `deleted_at` 均 NULL，排除。
3. 非成员——当前 UI 账号 endTree 即该 studio 唯一 owner 成员，`is_member` 应通过，排除。
4. scene 损坏——结构合法（sv=1、objects array、venue 在），排除。
5. private 可见性拦截——DB 无 `visibility` 列、函数无该分支，排除。

**仍未定性（BLOCKED，矛盾落在 DB 数据之外）**

按 DB 内层逻辑，endTree（`56356f34…`）对六卡应可读（`projects.get` 200），但真机进入仍抛 `PROJECT_NOT_FOUND`。剩余候选尚未分开：

- **会话 actor 错配**：UI 显示 endTree，但当前浏览器 JWT 实际 `sub` 未在「不读 token 重放」前提下核实。`auth.users` 中 `56356f34…` 最后登录 11-20 09:32；另有一批 11-20 凌晨无邮箱（NULL email/name）账号。若令牌 sub 落到幽灵账号，`is_member(幽灵id)=false` → 报 NOT_FOUND。
- **Function / DB 契约错配**：部署的 Edge Function 若为较新代码，调用了落后 DB 尚不存在的列 / 函数行为，异常被上层映射为 `PROJECT_NOT_FOUND`；需 Function 实时日志核对。
- 收口证据：Edge Function 日志取 `projects.get` 的 actor（sub）、RPC 异常码 / 栈；或在可抓包环境取单项目 GET 真实状态码 + 响应体 `error.code`。

### 2.10 Edge Function 日志旁证（2026-11-24 晚，控制台 Unified Logs，只读观察）

> 入口：Supabase 控制台 → Observability → Logs；过滤 `Log Type = edge function`、时间窗 `Last 24 hours`（23 Nov 16:21 – 24 Nov 16:21），按 `pathname` 逐卡核对 `GET /functions/v1/scene-api/projects/<uuid>`。未重放请求、未读令牌、未写库。

**六卡单项目 GET 状态码（裸路径，不含 lease/sources 子路径）**

| UUID 前缀 | GET 200 | OPTIONS 204 | 404/403/409 | 5xx | 备注 |
|---|---|---|---|---|---|
| `394e2174-…` | 2 | 2 | 0 | 0 | 另有 `lease/acquire` 200 ×2、`lease/renew` 24、`sources` 2 |
| `80c3158d-…` | 多次（09:42–15:17） | 成对 | 0 | 0 | 该路径 Edge Function 共 65 条，2xx 65、4xx 0 |
| `583dbff1-…`（可打开对照） | 多次 | 成对 | 0 | 0 | 共 54 条，2xx 54、4xx 0 |
| `99acd050-…` | 22 | 22 | 0 | 0 | — |
| `9a889d2b-…` | 23 | 23 | 0 | 0 | — |
| `73b1a823-…` | 22 | 22 | 0 | 0 | — |

- 全窗 Edge Function **5xx = 0**；4xx 仅 `/notices/unread`（404，轮询）与 `/studios/<id>/messages/unread` 等轮询路径，**没有任何 `/projects/<uuid>` 落入 4xx**。
- `394e2174…` 首条 200 日志 Raw JSON 关键字段：`request.sb.auth_user = 56356f34-a34f-4745-b418-29e16e1de728`、`jwt.payload.subject = 56356f34…`、`role = authenticated`、`status_code = 200`、`response.content_length = 1001`（真实项目 JSON，非错误壳）、`execution_time_ms = 174`、region `ap-northeast-1`、`deployment_id …81`。
- 时间线：`394e` 两次 GET（15:17:10、15:20:36）成对 OPTIONS 预检；其后 `lease/acquire` 200、`lease/renew` 24 次心跳——后端层面该项目可读、可拿写租约、可续期。

**据此排除的两个后端候选**

1. **会话 actor 错配 → 排除。** 日志 `sub` / `auth_user` 即 endTree 本人（`56356f34…`，该 studio 唯一 owner），后端成员校验放行并返回 200；令牌未落到幽灵账号。
2. **Function / DB 契约错配致异常 → 排除。** 5xx 为 0，单项目 GET 正常返回 1001B 项目 JSON，未出现被上层映射成 `PROJECT_NOT_FOUND` 的未捕获异常。

**剩余矛盾（BLOCKED，落在前端，不在后端数据 / 鉴权 / 函数运行时）**

后端对六卡均可读可租，但真机仍把其中五卡标 `PROJECT_NOT_FOUND`。可打开的 `583dbff1` 与被判失效的 `80c3158d` 后端日志形态一致（多次 GET 全 200、无 4xx），后端状态不区分二者。下一步需在前端侧定性：200 响应到达后，身份 / 会话 scope 比对（`layout.id` ↔ `cloud.project.id` ↔ geometryBinding）或旧 `layout.id` 双源回退，是否把可读云项目误判为不存在；需可抓包环境取单项目 GET 响应体 `error.code` 与前端会话快照对照。

### 2.11 前端静态链路落点定性（2026-11-24 晚，只读代码核查，未改生产码）

> 方法：沿「双击进入 → getProject → 会话/身份比对 → 回执渲染」逐跳核查生产码；每条落点标证据级别：**已证**（代码静态可断定）/ **需抓包**（须真机网络或会话快照闭合）。

**码的唯一来源（已证）**

- `client/scene-client.ts:113-116`：仅当 `!response.ok` 才解析 body `error.code`；**200 响应不产生 `PROJECT_NOT_FOUND`**，缺省码为 `HTTP_ERROR`。
- 全前端生产码无一处 `new SceneApiError('PROJECT_NOT_FOUND')`（Grep 仅命中文案映射 `backend-session.ts:361` 与面板读取处）；前端不自行编造该码。
- `failure()`（`backend-session.ts:346-348`）：ZodError → `INVALID_RESPONSE`；无码普通 Error → `NETWORK_ERROR`；均不等于 `PROJECT_NOT_FOUND`。

**进入链路的请求与可能抛出的码（已证）**

- `openRequested`（`cloud-panel.tsx:572`）→ `getProject(id,…)`（`:585`）→ `GET /projects/:id`（`backend-session.ts:1544`）。该裸 GET 六卡日志全 200（§2.10），不可能由它回 404/NOT_FOUND。
- `claimEditRight`（`:560-569`）→ `acquireLease` → `POST …/lease/acquire`；其错误在 `:566` 被 catch 吞为「先按只读打开」提示，**不上升为 NOT_FOUND 回执**；`394e` acquire 日志 200。
- `getProjectInSession`（`backend-session.ts:1540-1557`）本地可抛：`INVALID_RESPONSE`(502，`:1546` id 不符 / `:1370` sceneSchema.parse)、`ORIGINAL_SCENE_REVIEW_REQUIRED`(409，`:1547`)、`SESSION_CHANGED`(409，`:703`/`:710` scope 失配)——**均非 `PROJECT_NOT_FOUND`**。
- 本机守卫回调（`assertNoLocalHandoffCloudTransition`、`checkSwitch`）抛普通 `Error`（本地交接 / 画布改动提示），无 code，不归 NOT_FOUND。

**面板失效标记与回执渲染（已证）**

- `unreachableProjects` 仅由 peek catch 且 `reachabilityFromError(error)==='unreachable'` 写入（`cloud-panel.tsx:986`）；peek 即裸 GET `/projects/:id`（`backend-session.ts:1399`），日志 200 → 不置失效。六卡活跃显示与此一致（真机失效折叠区为空）。
- 回执渲染 `cloud-panel.tsx:1789`：条件 `cloud.error.code==='PROJECT_NOT_FOUND'` 且 `missingProjectIsThisCanvas`（`:951`，`cloud.project.id===layout.id`）。`error` 由 `block()` 写入（`backend-session.ts:541-543`）；`selectProject` 成功选中时清 `error:null`（`:1374`）。
- 身份分类 `classifyProjectIdentity`：仅 `reachability==='unreachable'` 才降级；`unknown`（网络/5xx/无码）不判 orphan（`project-identity.ts:70-97`）。

**未闭合疑点（需抓包 / 会话快照，BLOCKED）**

1. **〔2026-11-24 第三轮登录态已闭合〕** 抓到真实非 2xx：`GET /scene-api/notices/unread` → **404 `{"error":{"code":"PROJECT_NOT_FOUND"}}`**（轮询 14 次全 404）；同窗口 `GET /studios/<id>/messages/unread` → 200 `[]`。projects 裸 GET 在探针注入前已返回（200，DB 旁证）。该 404 来自**平台官方通知未读数**轮询，与项目本体无关。根因方向：`20261120140000_official_notices.sql` 迁移头注「草案，待 review；未部署到云端」，生产旧 `scene_rpc` 不认识 `official.notices.unread` action，兜底抛 PROJECT_NOT_FOUND（待 DB 只读复核生产是否存在 `official_notifications` 表与新 RPC）。
2. **〔部分闭合〕** 当前登录态真机网格与画布**未渲染任何 NOT_FOUND 回执**（`:361`「项目已不存在…当前画布仍是本机草稿」、`:627`「链接中的项目已不存在…」两种文案均未命中）。前端静态核查：notices 404 经 `useOfficialNotices`/`useOfficialUnread`（`lib/official-notices.ts`）**局部消化**——前者 catch 写局部 `error` state，仅在 messages-panel 提示行渲染；后者 catch 静默保留旧未读数；二者都不写 `controller.error`、不进身份分类。旧观测时代六卡误标是否同源于此轮询错误被旧代码串入 controller.error，需逐卡进入复核确认。
3. `cloud.project.id === layout.id` 比对：B1 阶段 `layout.id` 双源回退遗留可能造成 id 错配，影响 `:951` 是否显示回执；需读前端会话快照（controller snapshot project.id / layout.id / geometryBinding.cloudProjectId）对照。**仍未闭合**（生产构建未暴露 controller 句柄，fiber 树未取到实例）。

**2026-11-24 晚 · 第二轮只读探针观测（访客态）**

- 生产站该标签 Supabase 会话已失效：账户菜单身份显示「访客」，rail 为「登录后查看消息 / 团队成员」占位。会话存储经静态核查为 `@supabase/ssr` **cookie**（`lib/supabase/client.ts`：`createBrowserClient`，`auth.autoRefreshToken:false`，`cookieOptions.maxAge=90d`，cookie 名前缀 `sb-`）；本地只读枚举未见 supabase localStorage/IndexedDB 会话（旧 `scendance:studio:<uid>` 缓存与 assistant 会话键不算认证材料），按安全边界未读取 cookie 值或令牌。`autoRefreshToken:false` 意味着 cookie 到期后前端不会自动续期，过期即回访客。面板渲染 `sc-auth-form`（邮箱密码登录 / 访客进入）。
- 在访客态于页面内注入只读 fetch 探针（包装 `window.fetch`，clone 响应读取状态码与错误体，不改写响应、不重放、不读令牌）：打开账户面板全程 `__sceneProbe` 为 **0 条 scene-api 请求**——访客态被守卫拦在云请求之前，不产生 NOT_FOUND。
- 生产构建未把 controller 实例挂到全局；沿 React fiber 树（含 `ref.current` / context `value` 下钻）未取到 BackendSession 实例，内存快照暂不可直读。
- 旁证：NOT_FOUND 回执只可能在**登录态会话内**产生；当前标签要复现登录态六卡与回执，须先人工登录（邮箱密码 / magic link），自动化不代填凭据、不重放已存令牌。

**2026-11-24 晚 · 第三轮登录态实测（reload 后会话恢复）**

- 更正上一轮「会话失效」判断：cookie 会话其实仍有效。首次读到「访客」是 SPA 内存身份快照未刷新；`navigate("reload")` 重新读取 cookie 后身份恢复为登录态，「正在读取活动列表…」，rail 占位消失。
- 稳定附着通路：bu 常规帧 / `bu.js` 在多标签间反复错位到 Supabase 标签；`bu._native.send_cdp(tool="resync", method="Runtime.evaluate", page_id=<生产站 targetId>)` 可直指定生产站帧求值，不漂移（`Runtime.evaluate` 仅在 `resync`/`screenshot`/`click_and_handle_dialog` 工具白名单内放行）。
- 登录态打开「所有方案」网格：本机草稿 1 张（`is-current is-draft`「本机 · 未上传」）+ 六张云卡 `sc-file-card`，**六卡均无失效 / unreachable / invalid 类名，卡片文案无「失效」「已不存在」**。
- 探针（页面主世界包装 `window.fetch`）在网格打开窗口内仅捕获两类轮询：`notices/unread 404` ×14、`messages/unread 200` ×14；未捕获 projects/list、projects/<id> GET、peek（这些在 reload 后、探针注入前已完成）。
- 静态链路：`lib/official-notices.ts` 的 `useOfficialNotices` 局部 `error` state（messages-panel 提示行）、`useOfficialUnread` catch 静默保留旧值；notices 错误不上浮到 controller 会话 error，也不进入 `classifyProjectIdentity` reachability 判定。

## 3. 自动化环境局限（复核记录，不作为产品缺陷定性）

- 原生 click 经 CDP 坐标单击可触发 React `onClick`（账户菜单、卡片墙 dialog 可正常打开）。
- 云卡 `onDoubleClick`：**CDP 双击 `bu.click(ref, clicks=2)` 本轮可触达 React handler**（见 2.7）；早前隔离世界内手动派发的原生 dblclick、`onKeyDown Enter` 仍触不达；普通 `onClick` 通道不受影响。
- 原生 `window.confirm` 必须显式 accept；自动化未处理时被默认驳回，等同点「取消」。
- 生产静态导出 DOM 无 `__reactFiber$` 挂载键，无法反查 React state / controller 快照；页面未暴露调试句柄。
- `network_requests` / `console_messages` 缓冲被 `notices/unread`、`messages/unread`、`studios` 轮询不断挤出早期 `/projects` 请求；reload 后缓冲重置。
- 浏览器自动化脚本运行在隔离世界，对 `window.confirm` 等全局的覆写不影响页面主世界。

## 4. 观察到的待核现象（挂账，不当场改码）

1. **深链回落路径**：未知裸 UUID / 云 UUID 深链未回读单项目即渲染本地最近缓存；本轮已复现 `PROJECT_NOT_FOUND` 红字回执（「链接中的项目已不存在或已被删除；当前画布仍是本机草稿…」），但回执是否伴随清参、单项目 404/200 状态码本轮仍未抓到。需在可抓包环境复核：未命中云端时是否按设计清参、提示并保留本机草稿。
2. **文案与身份不一致风险**：侧栏段名「本机活动」不等于 `house-*` 身份；身份以 `projectLinkKind` / `activityIdentityKind` 为准，段名易把裸 UUID 云缓存误读成本机活动。
3. **第三身份实例**：`2538691c…` 裸 UUID 槽是 C4 口径待淘汰的第三身份；槽轨道归属（云端 mint vs 本机 `house-*`）随 B2/B3 身份口径定稿。
4. **团队项目态下，左侧本机活动切换被身份守卫拦截（本轮现场观察）**：存在两套互不相通的切换通道——
   - 右侧账户中心云卡（`sc-file-hit`）：双击走 `enterProject → controller.getProject(云id) → acceptScene`，后端取得到才替换画布；取不到落 `PROJECT_NOT_FOUND`。
   - 左侧本机活动草稿（`sc-activity-card-clickable`，「新活动 11-22 …」等）：点击走 `switchActivity → restoreBackup(..., 'activity-switch') → restoreBackupNow → assertLocalRestore()`（`local-activities-panel.tsx:178`、`creative-studio.tsx:875-878`）。该守卫要求 `isLocalActivityWorkspace(controller)` 为真；当前身份被判团队/云端项目时直接抛「当前活动已是团队项目，本机备份恢复只在草稿上可用。请先在「项目」里新建项目，再恢复备份。」
   - 现场：URL `?project=80c3158d-…`（裸 UUID），`projectLinkKind` 判 `cloud`（`project-identity.ts:28`）→ `hasRequestedCloudProject()=true` → `isLocalActivityWorkspace=false`（`geometry-workbench.ts:37-41`）。左侧条目未置灰（`openLocked=false`：`localActivitySwitchAvailable()=true`，`local-project-restore.ts:12`），但点击后在运行时身份守卫被挡回。
   - **对照实验（真机）**：深链本机 `house-146b05eb-…&mode=outdoor`，notice 无「已是团队项目 / 备份恢复只在草稿上可用」回执，也无「项目已不存在」回执，左侧本机活动条目可点；同机裸 UUID `80c3158d-…` 槽两条回执并存。差异只来自 URL 身份判定，支持「格式误判」定性。
   - **发号侧根因**：`withHouseId`（`ids.ts:25-28`）仅在 layout 无 id 时补 `house-<后缀>`；layout 已带裸 UUID id 时**原样保留**，不重写前缀。历史裸 UUID 本机槽（`80c3158d` / `9a889d2b` / `583dbff1` 本地缓存）由此留存为第三身份；现役空白新建走 `createFreshActivity` 发 `house-*` 短码。
   - **边界定性**：裸 UUID 按规则一律算云项目号，而本机历史缓存槽也用裸 UUID 落盘（第三身份实例）；于是身份被判云端、本机切换通道关闭，云端回读又可能 NOT_FOUND。此为 B1 解耦期身份口径边界，随 B2/B3 定稿；本轮只记录，未改码。同名「新活动 11-18 07:46」同时出现在左侧本机列表与右侧云卡，段名「本机活动」不等于 `house-*` 身份（见现象 2）。

## 5. 刻意没做的事

- 未读取 / 导出 Cookie、token、Supabase apikey、整段 localStorage；未重放带 Bearer 的后端接口。
- 未绕过 UI 直接打后端 API；未用 web_search / HTTP HEAD / 源码推断冒充真机通过。
- 未改 7 个独占 / 基线文件：`hooks/use-import-export.ts`、`hooks/use-splat-preview.ts`、`three/splat-preview.ts`、`room-organizer.tsx`、`panels/scendance-workspace.tsx`、`three/scan-placement.ts`、`three/furniture-builders.ts`。
- 未提交、未 push、未部署、未删云端项目；未主动新建本机草稿。

## 6. 证据与代码基线

- 截图（本地 temp，不入库）：`b1e-project-list.png`（云面板 6 云行 + 本机草稿行）、`b1e-project-list-2.png`（本轮账户中心「所有方案」网格：本机草稿 + 6 云卡 + 新方案）、`b1e-venue-picker.png`（点「新方案」后编辑器回落态，VenuePicker overlay 在 DOM 挂载、视口未铺出）、`b1e-after-open.png`（账户菜单浮层）、`b1e-house.png`（house 深链画布）；人工 confirm 截图为会话附件 `29b12485-…png`。
- 代码基线（行号对当前 main，引用前已复核）：
  - `frontend/lib/geometry-workbench.ts:14-42`：`isLocalProjectParam` / `isEditorLocalProjectLink` / `hasRequestedCloudProject` / `isLocalActivityWorkspace`。
  - `frontend/components/room-organizer/panels/cloud-panel.tsx:690-745`（`enterProject` / `editingBlocked`）、`:1231-1237`（`openAccountSection`）、`:1381-1409`（云卡 `canEnter` / `onDoubleClick` / `onKeyDown`）。
  - `frontend/components/room-organizer/panels/account-menu.tsx:250`（菜单「所有方案」→ `onOpenProjects`）。
  - `frontend/lib/backend-session.ts:361`（`PROJECT_NOT_FOUND` 文案）、`:980`（`listProjects`）、`:1397`（`peekProject`）、`:1535`（`getProject`）。
- 历史桩环境取证：`docs/plans/2026-11-21-indoor-decommission-goal.md` :350-361。

## 7. 待人工 / 后续环境补齐项

- 在可稳定抓包、可人工双击的环境，补 flow1 **云端**第二项目切换 + 切回不丢的生产站对照（深链本地裸槽隔离旁证已取得，见 2.2）。
- 取得 `listProjects` 响应体 UUID 清单与单项目 GET 状态码，对 `2538691c…` 做排他定性（云卡 DOM 不暴露 UUID，需从清单响应或分享链接取号）。
- 走查云工作区「新方案」选场地 →「开始规划」后的发号槽轨道（云 UUID vs `house-*`），与 B2/B3 口径对齐；入口→VenuePicker 接管链路已取证，见 2.4。
- 复核深链未命中云端时的清参与单项目 404/200 状态码（NOT_FOUND 回执文案已复现，清参与状态码未核）。
- 对 5 张 NOT_FOUND 卡（`394e2174` / `80c3158d` / `99acd050` / `9a889d2b` / `73b1a823`）的复核：后端只读旁证已收口（§2.9 DB、§2.10 日志）——行存在、未软删、成员为 owner、scene 合法、无 private 可见性列；24h 内六卡裸 GET 全 200、无 4xx/5xx，`394e` JWT sub = owner、acquire 200/renew 24 次；「会话 actor 错配」「Function/DB 契约错配」两后端候选排除。前端静态落点已定性（§2.11）：`PROJECT_NOT_FOUND` 唯一来源是后端非 2xx 响应体，前端不编造；进入链路裸 GET 200 不产生该码，peek 200 不置失效，成功选项目会清残留 error。
  - **缺口①〔第三轮登录态探针已闭合〕**：真实非 2xx 是 `GET /scene-api/notices/unread` → 404 `PROJECT_NOT_FOUND`（平台通知未读轮询，非项目本体）。根因静态链：生产旧 `scene_rpc`（迁移 `20261120140000_official_notices` 未上生产）在通用项目锁段先按 `projectId` 取项目，notices 请求 `p_data={}` 无 projectId → `not found` 抛 `PROJECT_NOT_FOUND`（`20261002060304_scene_core.sql:201-202`）。待 DB 只读复核：生产是否缺 `official_notifications` 表与替换版 `scene_rpc`。
  - **缺口②〔部分闭合〕**：当前登录态真机网格 / 画布无任何 NOT_FOUND 回执（361 / 627 两种文案均未命中）；notices 404 经 `useOfficialNotices` / `useOfficialUnread`（`lib/official-notices.ts`）局部消化，不写 `controller.error`、不进身份分类。旧观测时代六卡误标是否曾把该轮询错误串入 controller.error，需逐卡进入复核（进入会弹 confirm 替换画布，属人工决策点，自动化不代点）。
  - **缺口③〔仍未闭合〕**：`cloud.project.id ↔ layout.id ↔ geometryBinding.cloudProjectId` 比对；生产构建未暴露 controller 句柄、DOM 无 fiber 键、无 data-id，内存快照不可直读。
- 补一个健康、可写（持有租约）云项目的 A→B→A 真机切换样本；本轮唯一能打开的 `583dbff1` 为只读，未取得可写切换对照。

## 8. 第一性原理根因与解耦落点（用户反馈：「团队项目能切换，有的其他新建项目不行」）

### 8.1 正确身份模型（终态口径，对齐台账 C4 云为主）

一个活动只有一种身份，由**记录正源落在哪里**派生，两类互斥，不存在第三身份：

- **本机草稿**：plan / flow / session / bodies 信封在本机；id 前缀 `house-` / `default-outdoor` / `replica-`；本机通道（活动切换、备份恢复、点验）放开，不去云端查。
- **云端项目**：controller 挂着服务端项目、单项目 GET 可达（200）、标准 UUID；走云端进入 / 写租约 / 回写链路。
- **第三身份（不允许存在）**：既非本机前缀、后端又查无记录的裸 UUID 槽——终态不允许（台账 :59）。

### 8.2 现役错位链（格式判定驱动，非正源判定）

1. `projectLinkKind(id)`（`project-identity.ts:22-30`）：纯按字符串格式分类，标准 UUID → `cloud`；不看本机有无信封、不看 controller 是否挂云项目。
2. `hasRequestedCloudProject()`（`geometry-workbench.ts:29-34`）：仅凭 URL `project` 参数格式判 requestedCloud。
3. `isLocalActivityWorkspace()`（`geometry-workbench.ts:37-42`）：requestedCloud 时**早返回 false**，不再走后面读 controller snapshot / 本机信封的判定。
4. 结果：裸 UUID 历史本机槽被格式判云 → 本机切换 / 备份恢复 / 点验等通道全被守卫关闭；云端回读又 NOT_FOUND → 双重关闭，表现为「点不动 / 进不去」。
5. 发号侧：`withHouseId`（`ids.ts:25-28`）仅在 layout 无 id 时补 `house-<后缀>`；layout 已带裸 UUID id 时**原样保留**，不重写前缀。现役空白新建走 `createFreshActivity` 发 `house-*` 短码；裸 UUID 本机槽属历史存量 / 导入备份 / 云项目本地缓存残留。

### 8.3 真机对照证据

- `house-146b05eb-…&mode=outdoor`：notice 无「已是团队项目 / 备份恢复只在草稿上可用」回执，也无「项目已不存在」回执，左侧本机活动条目可点。
- 裸 UUID `80c3158d-…`：两条回执并存（团队项目守卫 + NOT_FOUND）。
- 差异只来自 URL 身份判定，支持「格式误判」定性；区分真云项目与本机裸槽的硬证据仍是后端单项目 GET 200/404（本轮未抓到状态码，见 7）。
- **2026-11-24 第三轮登录态**：六张云卡在网格全部正常列出，无失效 / unreachable / invalid 类名、无「已不存在」文案；唯一持续非 2xx 是 `notices/unread` 404（未部署迁移的轮询噪音）。**〔结论已更正，见 8.6〕**：该 404 当时判定为「已被前端局部隔离、未污染身份判定」，第四轮逐卡进入证伪——它经业务请求通道写进了会话 error，当前挂载卡被误标「失效 · 本机草稿」，已落码隔离。当前画布挂 `394e2174` 标题，但卡片身份呈现为「本机 · 未上传」草稿（`is-current is-draft`），云绑定状态仍需内存快照复核（缺口③）。

### 8.4 解耦落点（按台账 B1–B4 卡片归位，本轮不动码）

- **B1 会话 / 身份解耦**：身份判定正源从「id 字符串格式」切到「controller 挂载状态 + 本机信封 + 后端可达」三源一致；去 `layout.id ??` 裸回退（随 B2/B4 成套，见台账 :68）。
- **B2 历史快照换 plan**：历史裸 UUID 本机槽的识别与迁移口径；两份 brief 打通。
- **B3 导出与写守卫 plan 化**：写守卫按 plan scope + 项目级 lease / revision，不再靠 layout.id 判定身份。
- **B4 回写镜像退役**：旧裸槽键 / 偏好键一次性迁移（C2），镜像分支退役。
- **过渡期兜底（待拍板，不代推）**：`isLocalActivityWorkspace` 在 controller 未挂云项目、且本机存在该 scope 信封时，是否应不仅凭 URL 格式早返回 false；该兜底与 C4 终态（云为唯一正源）的关系随 B2/B3 定稿。

### 8.5 红线

本轮 B1-e 为验收复核：只取证与挂账，不改生产码 / 测试、不提交、不 push、不部署、不删云端项目；身份槽轨道口径随 B2/B3 定稿，不代拍板。修复批准后按 8.4 落点落对应卡片。

### 8.6 2026-11-24 晚第四轮更正：notices 404 确曾污染会话 error，已落码隔离

**推翻本节 2.11 / 缺口② / 8.3 里「notices 错误已被前端局部隔离、不写 controller.error」的静态结论**。第四轮登录态逐卡进入复核（confirm 已按用户本轮授权放行）：六卡 `GET /projects/<uuid>`、`lease/acquire`、`lease/renew`、`sources` 全 200，切项目先 release 旧租约 200；唯一非 2xx 是旧项目迟到 `lease/renew` 409 `LEASE_LOST`（释放竞态，非故障）。但回到网格后，当前挂载卡被标「当前 · 失效 · 本机草稿」，错误行渲染 `PROJECT_NOT_FOUND` 文案；全量探针 404 仅 `notices/unread`，项目链路零 404。

**根因链**：notices / 未读数经 `controller.businessRequest` → `request()` catch 对 business 请求走 `update({ error: failure(error) })`，把 404 的 `PROJECT_NOT_FOUND` 写进会话 `snapshot.error`；hook 自身 catch 只吞 promise rejection，清不掉已写入的会话 error。轮询再次 404 把 NOT_FOUND 写回，此时 `cloud.project.id === layout.id` 成立，`missingProjectIsThisCanvas`（`cloud-panel.tsx:951`）为真，当前云项目被误判「失效 · 本机草稿」。非当前挂载的其余五卡不受该残留 error 影响，故网格上身份干净。

**已落码修复（#81，提交 `e89e951c` 推 main，Pages 自动部署）**：`backend-session.ts` 新增 `auxRequest`（`suppressProjectFailure=true`），辅助 / 轮询请求失败只抛调用方、不写会话 error、不阻断画布，401 清登录分支保留；`workspace-api.ts` 将 notices 三函数与 team 未读数 / 私信列表 / 标已读切到 `auxRequest`，主动发信保留 `businessRequest`；`backend-session.test.ts` 补 business / aux 对照用例。门禁：根 / 前端 tsc 0、定向 216 绿、全量 10724 passed / 0 failed、build 0 违规。

**部署后生产复核（登录态，硬刷新穿透缓存）**：线上 3609 chunk 已含 `auxRequest`；探针 55 条，非 2xx 仅剩 `notices/unread` 404 `PROJECT_NOT_FOUND`（迁移未上，噪音仍在），`messages/unread` 全 200，项目链路 `projects/<uuid>` / `lease/acquire` / `sources` 全 200。网格五张非当前卡无身份档位、无错误条；当前卡显「当前 · 场景已保存 · v0」或「当前 · 只读」；上一轮被误标的 `73b1a823`（Flow C 直径测试）回网格后**不再标「失效 · 本机草稿」**，无 `PROJECT_NOT_FOUND` 文案、账户错误行清空。切到 `9a889d2b` 后链路 200、错误条清空。期间一条 `NETWORK_ERROR`「连接失败…写入暂停」为前一项目会话切换一次性残留（非 notices 404，fetch 层无 net:ERR），成功选项目后清除、未复现。生产迁移落后（notices `20261120140000` 未上生产）仍是该 404 的后端成因，属部署治理挂账，本轮未跑迁移。
