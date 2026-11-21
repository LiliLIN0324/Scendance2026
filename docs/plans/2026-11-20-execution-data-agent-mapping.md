# 执行资料 × Agent 落地对照表（2026-11-20）

> 口径：第一性原理拆解后的本地方案对照，**本轮未改代码、未提交、未部署**。
> 目标：保留执行资料的本质数据要素，把六页签按用户动作重组为「清单 / 核对 / 交付」三段，并界定 Agent 能起草什么、人必须确认什么。
> 边界：不改共享契约字段、不另起 wire schema；台账继续留本机，不上云；远端只存方案快照、资产与分享链接。

## 一、三段定义

| 段 | 用户动作 | 对应现状 | 核心问题 |
|---|---|---|---|
| 清单（起草） | 把画布方案翻译成可执行的任务、工单、来源、数量约定 | 活动安排 / 物料工作单 / 制作计划 / 数量点验 | 要做什么、谁关联哪几件物料 |
| 核对（缺口） | 看哪些还没闭环、哪些有冲突 | 现状散落在各表单的状态与校验 | 齐了没、差在哪 |
| 交付（导出 / 留存） | 生成给执行团队 / 客户的文件，或备份恢复 | 导出面板六类产物 + 本机备份 | 带走什么、怎么读回 |

## 二、清单段：数据对象 × 字段 × Agent 起草 × 人工确认

状态机基线：任务 / 工单 `todo → doing → review → accepted`；点验 `pending / checked / disputed`。

### A1 活动任务（`event-operations-contract.ts` · `eventOperationTaskSchema`）

| 项 | 内容 |
|---|---|
| 现有字段 | `title`、`phase`（preparation / setup / event / teardown）、`plannedStartAt`、`plannedEndAt`、`ownerName`、`contractorName`、`contactName`、`contactPhone`、`zoneId`、`acceptance`、`status`、`objectIds[]`、`actualStartedAt`、`actualFinishedAt`、`evidenceNote`、`evidenceUrls[]`、`reviewedBasis` |
| Agent 可起草 | `title`（具体动作）、`phase`、`acceptance`（可人工核对的完成条件）、`objectIds`（关联画布物料）；依据仅限已确认的对话需求与当前画布 |
| 人必须确认 / 填写 | `ownerName`、`contractorName`、`contactName`、`contactPhone`、计划时间、`zoneId`（可给建议，人定）；`actual*`、`evidenceNote`、`evidenceUrls`、`reviewedBasis` 现场回填 |
| 现状 | **已有链路**：`activity-task-runner` 出建议 → 前端勾选 → 人工待核 → 保存读回；保存后再补负责人和时间 |
| 校验红线 | `review` / `accepted` 必须有负责人与完成条件；`accepted` 必须有现场核对说明与核对依据 |

### A2 物件工单（`delivery-contract.ts` · `handoffSchema`，挂在物件 `handoff`）

| 项 | 内容 |
|---|---|
| 现有字段 | `ownerName`、`dueDate`、`acceptance`、`status`、`evidenceUrls[]`、`evidenceNote`、`reviewedBasis` |
| Agent 可起草 | 按物料类别给默认 `acceptance`（如数量、尺寸、摆放位置核对）；初始 `status = todo`；关联对应物件 |
| 人必须确认 / 填写 | `ownerName`、`dueDate`；`review` / `accepted` 的验收条件；`accepted` 的证据链接或说明、`reviewedBasis` |
| 现状 | **纯人工**，无 Agent 草稿入口 |
| 校验红线 | `review` / `accepted` 必须有负责人、期限、验收条件；`accepted` 必须有证据与核对依据 |

### A3 制作计划 · 人员配置（`production-plan-contract.ts` · `productionStaffingSchema`）

| 项 | 内容 |
|---|---|
| 现有字段 | `roleName`、`shiftLabel`、`taskIds[]`、`headcount`、`sourceType`（unspecified / internal / outsourced）、`sourceName`、`plannedArrivalAt`、`plannedDepartureAt` |
| Agent 可起草 | `roleName`（按任务推岗位）、`taskIds` 关联；`headcount` 可按人数 / 布局给建议但标「待核」；`sourceType` 保持 `unspecified` |
| 人必须确认 / 填写 | `headcount` 确认、`sourceType`、`sourceName`、到场 / 离场时间 |
| 现状 | **纯人工** |
| 校验红线 | 到场不得晚于离场；引用任务不能缺失或歧义 |

### A4 制作计划 · 来源方式（`productionPlan` · `productionAcquisitionSchema`）

| 项 | 内容 |
|---|---|
| 现有字段 | `title`、`taskIds[]`、`objectIds[]`、`method`（unspecified / existing / rental / purchase / fabrication）、`supplierName`、`specificationNote`、`sourceNote`、`transportScope`、`installationScope` |
| Agent 可起草 | `title`、`objectIds` 关联；按物料类别建议 `method`；`specificationNote` 取物料尺寸规格 |
| 人必须确认 / 填写 | `method` 确认、`supplierName`、`transportScope`、`installationScope`、`sourceNote` |
| 现状 | **纯人工** |
| 校验红线 | 任务 / 物件引用不能缺失或歧义；未关联记为待核 |

### A5 制作计划 · 估算（`productionPlan` · `productionEstimateSchema`）

| 项 | 内容 |
|---|---|
| 现有字段 | `title`、`taskIds[]`、`objectIds[]`、`amountMinor`、`basisNote` |
| Agent 可起草 | `title`、任务 / 物件关联；**`amountMinor` 不估**，未知保持未知 |
| 人必须确认 / 填写 | `amountMinor` 与 `basisNote`（有金额包括零，必须填非空依据） |
| 现状 | **纯人工** |
| 预算 | `budget.limitMinor` 有上限时须填覆盖范围与依据；估算只覆盖已录行，不含报价、成交或付款 |

### A6 点验 · 数量约定（`material-checkin-contract.ts` · `agreementObject` / `sheetObject`）

| 项 | 内容 |
|---|---|
| 现有字段 | 单：`title`、`acquisitionSnapshot{title, supplierName, specificationNote}`、`unit`（piece / set）、`agreements[]`、`events[]`；约定：`agreedQuantity`、`basisNote`、`supersedesId`；事件：`kind`（receive / return / correction / void）、`batchRef`、`quantity`、`checkState`、`occurredAt`、`fromPartyName`、`toPartyName`、证据 |
| Agent 可起草 | 按画布件数 / 套装给 `agreedQuantity` 建议，标「待核」；`acquisitionSnapshot` 取来源标题与规格 |
| 人必须确认 / 填写 | `agreedQuantity` 确认与 `basisNote`（已知数量含零必须有依据）；现场收发事件、批次、交接双方、争议与证据 |
| 现状 | **纯人工**；现场事件不预填 |
| 校验红线 | 已核点验必须明确数量（未知不能当零）、批次与交接双方，并保留说明或证据；约定版本只能有一个根，不能分叉 / 循环 |

## 三、核对段：缺口聚合（只读，不产生新台账）

| 编号 | 扫描项 | 数据来源 | Agent 角色 |
|---|---|---|---|
| B1 任务缺口 | 无负责人、无完成条件、无计划时间、未关联物料 | A1 | 只读扫描，在对话里报缺口并给跳转；不写状态 |
| B2 工单缺口 | 无负责人、无期限、无验收条件；`review` / `accepted` 缺证据 | A2 | 同上 |
| B3 计划缺口 | 人员未关联任务；来源未关联任务 / 物件；估算缺依据；预算超限 | A3–A5 | 同上 |
| B4 点验缺口 | 约定数量缺依据；`disputed` 事件；收发未闭环 | A6 | 同上 |
| B5 对话—台账差异 | 对话已记录但台账未记的需求（人数 / 类型 / 签到 / 舞台 / 无障碍等） | 见第四节 | 列出差异条目，标「来自对话，待核对」，不自动覆盖台账 |

## 四、对话需求回灌对照（`dialogue-handoff.ts` → 台账落点）

> 现状：对话结构化需求只在导出 HTML 时并列附一份「待核对」段，不回灌台账。下表是回灌目标；回灌条目一律标「来自对话，待核对」，人确认后才进台账。

| 对话字段 | 含义 | 台账落点 |
|---|---|---|
| `event` | 活动类型 | 任务标题 / 活动上下文 |
| `headcount`（+ `strength`） | 人数及要求强度 | 人员配置 `headcount` 依据；布置量核对 |
| `venueIO` / `lengthM` / `widthM` / `areaM2` | 室内外、尺寸、面积 | 场地上下文，不写任务行 |
| `layoutMode` | 布置方式 | 布置上下文；桌椅配置核对 |
| `checkin` / `rest` / `stage` / `allSeated` | 签到 / 休息区 / 舞台 / 全场入座 | 对应任务建议（A1） |
| `mobility` | 行动辅助 / 无障碍通行 | 通行条件提示或任务行 |
| `peoplePerDesk` / `seatingSpecs` | 每桌人数、桌椅规格 | 物料清单与工单规格核对 |
| `inventoryMention` | 对话提到物料但未核验 | 物料清单待核提示（B5） |
| `originalPreservation` | 原物保留要求与数量 | 保留原物任务行（A1） |
| `comparison.headcount` / `comparison.event` | 对话与手工记录是否一致 | 差异提示进 B5，不自动改数 |

## 五、交付段：产物 × 服务对象 × 门禁

| 产物 | 契约 / 入口 | 服务对象 | 前置门禁 |
|---|---|---|---|
| 活动执行资料草案 HTML | `exportActivityHandoff` | 内部执行团队 | 先保存各表单；点验读取完成；对话需求仅作待核对附录 |
| 执行时间表 HTML | `timetable` | 现场统筹 | 活动安排已有任务；计划 / 实际 / 负责人 / 复核分列 |
| 活动安排 CSV | `operations` | 执行团队 | 点验资料已读取 |
| 物料清单 CSV | `materials` | 采购 / 搭建 | 画布物料已定稿 |
| 平面 DXF | `plan-export/dxf` | 搭建放样 | 无未定位物件；几何可导出 |
| 交付清单 CSV | `manifest` | 交接核对 | 逐行列可带走文件、件数与缺失原因 |
| 本机草案 JSON / CSV / 可校验草案 | `local-json` / `local-csv` / `local-verified` | 本机留档 | 仅本地活动；不含模型、图片、私密链接；不是云端备份 |
| 场景 GLB / JSON | `glb` / `json` | 二次编辑 / 归档 | 核对工作单状态；未定位 / 预览中不导 |
| 本机备份 V3 / V4 | `local-project-backup-panel` | 留存与恢复（**不是交付物**） | 完整包不含模型二进制、聊天、临时地址、后台识别任务 |

通用门禁：存在未应用的方案预览、方案未稳、点验未就绪、简报未就绪、云项目边界不支持时，就地提示，不静默导出。

## 六、边界与禁止项

1. **Agent 只起草，不代填责任信息**：负责人、对接人、联系方式、供应商、价格、证据链接 / 说明，必须人填；Agent 不代填、不声称已执行或已保存。
2. **未知保持未知**：人数、数量、日期、地点、费用、现场条件未确认时留空，不推测；不推导消防、承重、法规或安全结论。
3. **草稿不落盘**：所有建议先预览，人逐条勾选 / 修改后写入台账；写入后读回核对，资料变化使旧建议失效时须重新核对。
4. **存储边界不变**：任务、工单、计划、点验、备份留本机；云项目只读与可导出，录入禁用；不把本地记录混进云端（`handoff-cloud-guard`）。
5. **契约不动**：复用现有五份共享 schema（operations / handoff / production / checkin / dialogue），本次只改前端视图组织与生成入口，不并行新格式。
6. **与 Bingo 不合并**：Bingo 收上游客户反馈，执行台账是下游落地；反馈闭环结果可回写工单状态，面板保持分开。

## 七、建议优先级

| 优先级 | 动作 | 依据 |
|---|---|---|
| P0 | 收入口：砍抬头常驻 pill，布置卡保留一个上下文触发点（「整理执行清单」）；六页签先不拆 | 双入口冗余、术语化、主动性最低 |
| P0 | 核对视图：把各表单状态与缺口聚合成一屏（B1–B5），不新增录入 | 用户视角是「齐了没」，不是翻表单 |
| P1 | 物件工单草稿（A2） | 物料已在画布，数据最现成 |
| P2 | 制作计划草稿（A3–A5） | 依赖工单与任务先行 |
| P3 | 点验数量约定草稿（A6） | 现场事件仍纯人工，仅约定行可建议 |
| P4 | 对话需求回灌台账（第四节） | 依赖前三段草稿结构就位 |

## 八、分工归属（我方前端 / 丽丽 Agent 设计 / 后端契约评审）

判定原则：视图、入口、本机状态只读聚合归前端；提示词、runner、模型输出与校验归 Agent 设计；新增字段、run 类型、RPC、迁移、Edge 契约、根依赖归后端（role B），走 review PR，前端不私改。

### 8.1 我方前端可直接做（不依赖 Agent）

| 对照表条目 | 落点层 | 说明 |
|---|---|---|
| P0 入口收拢：砍抬头常驻 pill，布置卡保留一个触发点 | `panels/agent-panel.tsx`；左轨入口在 `room-organizer.tsx`（`AGENTS.md` 第六节独占区） | 只改入口挂载与可见性；不碰 paintFrame、导出档位、点云合成顺序 |
| P0 核对视图 B1–B4 缺口聚合 | 前端只读本机 operations / handoff / production / checkin | 规则复用现有契约校验：缺负责人 / 期限 / 验收条件 / 证据、任务与物件引用缺失或歧义、预算超限、点验争议；不新增录入 |
| 现有表单字段展示、状态流转 UI、门禁提示文案 | 各台账面板 | 不改字段含义 |
| 交付段产物分组、入口、缺件提示 | `scene-delivery-panel.tsx` | 不改成图合成链路 |
| 本地文档、单测、`typecheck` / `build` 验收 | frontend 测试与构建 | 按 AGENTS.md 跑前端校验 |

### 8.2 丽丽 Agent 设计侧（提示词 + runner + 输出契约）

| 对照表条目 | 落点层 | 说明 |
|---|---|---|
| A1 任务建议迭代 | `activity-task-runner.ts` system 提示词、`activity-task-contract.ts` 请求 / 结果 schema、`validateActivityTaskResult` | 已有链路，只迭代字段口径与校验 |
| A2 物件工单草稿 | 新增或扩展 runner 输出 workorder 草稿；按物料类别给默认验收条件 | 上下文给物件摘要；输出只含草稿字段，负责人 / 期限留空 |
| A3–A5 制作计划草稿 | 人员 / 来源 / 估算行建议 | method 建议、规格取物料；金额不估，估算依据必须人填 |
| A6 点验约定草稿 | 约定数量建议 | 依据留空；现场收发事件不预填 |
| B5 对话—台账差异判定与话术、第四节回灌抽取规则 | 模型抽取与提示词 | 回灌条目标「来自对话，待核对」 |
| 主动缺口提醒 | Agent 对话话术 | 约定何时报哪条缺口、跳转哪里 |

### 8.3 前后端衔接（丽丽出草稿，我方接草稿）

- **前端**：上下文白名单装配（沿用 `lib/activity-task-suggestions.ts` 模式）、草稿预览、勾选 / 修改、落盘读回、指纹变更检测、旧建议失效重核。
- **Agent 侧**：草稿生成与输出校验；任何草稿不得绕过人工确认直接写台账。

### 8.4 后端 / 契约侧（role B，review PR）

- 草稿类型若需要新字段、新 agent-run 类型、新 RPC action、migration、Edge Function 契约或根依赖，由后端评审；现有五份共享 schema 字段不动。
- 模型 provider、额度与并发闸门在后端。

### 8.5 我方不直接动的区域

- 根 `AGENTS.md` 第六节：渲染 / 导出闭环五文件、几何基线两文件；确需改动先在 `HANDOFF.md`《协作区变更登记》登记，不直改。
- 不另起并行 wire schema；不把本机台账混上云端。
