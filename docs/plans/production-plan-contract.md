# 制作计划 v1：独立本地契约

2026-10-08定义共享契约；2026-10-09已接入前端类型、界面、本地保存、V2备份恢复、公开分享剥离和云转换保护，并提供内部交接导出。完整状态见[制作计划检查点](../DELIVERY-PROGRESS-2026-10-09.md)。现有云Scene、路由和迁移未扩展，不表示云端已支持制作计划。

实现：[production-plan-contract.ts](../../supabase/functions/_shared/production-plan-contract.ts)。测试：[production-plan-contract.test.ts](../../tests/production-plan-contract.test.ts)。完整后续范围继续遵循 [产品计划](product-evolution.md)。

## 真源与当前范围

制作计划是可缺省的项目本地计划块，由前端 `RoomLayout.productionPlan?` 承载。活动任务仍以原 `EventOperations.tasks` 为真源，物件仍以原实例 ID 为真源。人员与取得记录只关联原 `taskIds/objectIds`，不复制任务、场地、来宾数、模型或账户目录。

采用项目层独立记录，而不是仅挂在会随删除消失的物件里。删除任务/物件时保留原引用，显示断链供人工重新安排；不能按同名物件、模型资产、分组结果或供应方名称自动重挂。`assetId` 表示模型资源，不是实物产品、库存或供应商身份。计划的岗位人数不是 `CreativeBrief.guests`，也不是已到场人数。

v1 只记录岗位/班次需求、人员来源、计划到离场、物料取得方式及范围、预算上限和人工估算。没有招聘、实名名单、实际到场、确认报价、费用发生、支付/收款、自动排程或不可回滚事件。所有对象均为严格 schema，未知字段会拒绝，不会把未来事实字段静默保存在计划里。

## 对外接口

| 导出 | 用途 |
| --- | --- |
| `productionPlanSchema` / `ProductionPlan` | 显式制作计划的唯一解析入口与输出类型 |
| `optionalProductionPlanSchema` | 缺省 `undefined` 保持缺省，不自动建立本地业务块；不接受根计划 `null` |
| `productionBudgetSchema` / `ProductionBudget` | 预算上限及范围、依据 |
| `productionStaffingSchema` / `ProductionStaffing` | 一行岗位/班次需求 |
| `productionAcquisitionSchema` / `ProductionAcquisition` | 一行实物取得计划 |
| `productionEstimateSchema` / `ProductionEstimate` | 一行独立人工总额估算 |
| `productionStaffSources` / `productionAcquisitionMethods` | 前端选择值，不另建枚举 |
| `productionPlanLimits` | 每类最多500行、每行引用数组最多500项；标题120、来源/供应方80、说明1000、旧物件编号128字符 |
| `resolveProductionPlanReferences` | 对当次项目快照解析缺失、歧义、未关联状态；不修改计划 |
| `productionEstimateSummary` | 精确汇总已录入估算，保留未知状态；不生成报价或全项目费用 |

计划根字段为 `schemaVersion:1`、`dataKind`、`currency:'CNY'`、`budget`、`staffing`、`acquisitions`、`estimates`。资料性质直接复用既有 `unspecified/rehearsal/real`；`real` 只表示操作者声明这是真实项目的计划，不代表供应方承诺或现场已发生。

显式解析 `{}` 得到版本1、性质unspecified、币种CNY、预算null和三个空数组。未提供计划时须调用 optional schema 或保持字段不存在；不要给所有旧项目自动创建空块，导致无业务资料的旧云项目被新门禁阻挡。记录 ID、角色/标题、时间、金额和关联均不自动编造。

## 字段与约束

| 部分 | 字段 |
| --- | --- |
| `budget` | 可为null；对象包含 `limitMinor:number\|null`、`scopeNote`、`basisNote`。录入已知上限（包括0）必须提供非空白覆盖范围和依据 |
| `staffing[]` | 必填 `id/roleName`；`shiftLabel`；`taskIds`；`headcount:number\|null`；`sourceType=unspecified/internal/outsourced`、`sourceName`；`plannedArrivalAt/plannedDepartureAt:string\|null` |
| `acquisitions[]` | 必填 `id/title`；`taskIds/objectIds`；`method=unspecified/existing/rental/purchase/fabrication`；`supplierName/specificationNote/sourceNote/transportScope/installationScope` |
| `estimates[]` | 必填 `id/title`；`taskIds/objectIds`；`amountMinor:number\|null`、`basisNote`。录入已知金额（包括0）必须有非空白人工依据 |

人数及金额都是非负安全整数。CNY金额以分为单位，禁止浮点元值、NaN、Infinity、负值或不安全整数。未知为null，0必须是明确录入值。每条估算是人工填的本行总额，不是单价；没有数量、单位、报价或付款语义。关联20个椅子只是20个空间实例的关联，不能自动证明实物可得数量或计算租金。后续确认实物数量与计价方式时另审扩展。

角色/标题必非空白，班次标签可空；其他未录文字为空。文本原文（包括前后空格、缩进和换行）保持原样，只用trim判断必要依据是否非空。源说明不是自动抓取的证据，也不是受鉴权的审批记录。

计划到离场复用现有活动时间字段的ISO带时区、真实日历、非零年份及最多毫秒规则。两端已录时离场不得早于到场；允许同一时刻或跨午夜。时间为空不猜，岗位时段不从任务工作时段复制，也不要求未完成规划已经覆盖所有任务。

三个数组内及彼此之间的记录UUID必须唯一，大小写别名比较为同一身份，输出不改写。任务引用为UUID；物件引用兼容旧128字符编号。UUID引用忽略大小写做比较，其他legacy编号逐字、区分大小写；单行内重复引用拒绝，不同行可共享同一任务/物件。例如同一签到任务有两个岗位，同一物件关联制作与运输计划。

## 关联与估算纯函数

`resolveProductionPlanReferences(plan, {taskIds, objectIds})` 的已知集合必须来自同一当前项目快照，不是全局人员/物件目录。返回扁平数组，顺序为staffing、acquisition、estimate，每条包含：

`kind/id/missingTaskIds/missingObjectIds/ambiguousTaskIds/ambiguousObjectIds/unassigned/needsReview`。

引用不存在会保留原引用并放入missing；已知集合有重复身份则放入ambiguous，不挑第一项冒充绑定成功。岗位无任务关联、取得计划无物件关联会标unassigned；项目级估算可以无任务/物件关联。needsReview仅汇总上述关联问题，不表示已完成对规格、来源、人数或预算的业务审核。schema允许孤立记录，解析状态由后续前端显示。

`productionEstimateSummary(plan)` 返回 `knownTotalMinor/recordedTotalMinor/unknownEstimateIds/allRecordedAmountsKnown/overLimit`。空估算列表的已录合计为0，但完整已录估算为null；存在未知金额时完整合计仍为null。非空且各行金额已知时返回精确已录合计。已知估算合计超出安全整数会在schema层拒绝。

上限不存在则overLimit为null；已知部分已超过上限时为true；所有已录行金额已知且未超为false；剩余金额未知且已知部分未超时为null。**false只说明这些已录估算未超过上限，不证明全项目费用完整或不会超支。** 超预算的合法计划可保存，应显示提醒而不是阻止用户记录现状。

每个估算行应是独立、可加总的费用范围。schema无法识别包含其他行的人工汇总值或语义重复收费，不能同时把“项目总估算”和其全部明细当独立费用相加。也不按引用、标题或供应方名称偷偷合并费用。

## 接入与放行依赖

1. 前端共用本契约，补types、布局解析/白名单、reducer及原保存路径。旧项目保持缺省；空值、原文字、身份和孤立引用不能被修复丢弃。新增计划需参与适当的本地修订/异步输入过期检查。
2. 完整编辑备份保留计划及资料性质；更新覆盖声明与版本读取策略，严格兼容原v1/旧布局。恢复预检必须展示覆盖范围，同ID/跨scope、失败补偿与撤销均需验证，不能遗留旧资料或混版导出。
3. 对设计快照、模板替换、复制和删除明确语义：计划可复制，但新记录需新ID并重核关联；不复制/回滚后续实际到场、费用发生或收付款事实。孤立业务记录保留；完整备份恢复是档案恢复，不代表现实事件被撤销。
4. 原活动任务的负责人/承接团队保持原真源。新岗位需求、人数、来源、计划到离场及取得规格/供应范围若影响条件，须纳入对应任务/工单复核依据；旧记录说明和原验收状态保留为待复核，不自动升级为确认。预算/费用提醒不等于空间验收。
5. 完整编辑JSON/备份保留；公开分享必须递归去除整个productionPlan，包含方案簿嵌套布局。不要只删金额留下人员来源、供应方或内部估算依据。
6. 客户评审只按明确披露白名单取同快照字段，标资料性质。估算不能显示成报价，未知不能写免费；内部分工和来源默认不外带。报价/客户确认/权限仍是后续独立证据。
7. 新业务块须加入根布局和方案簿的云转换、候选应用与恢复保护。当前Scene、adapter和client没有业务存储接口，不能硬塞字段或静默丢弃；先保持本地真源，将来云同步须整体扩契约、权限/冲突并以双账号实际验证。

## 验证与扩展边界

本批定向测试覆盖缺省、明示0与未知、文字/编号保留、金额安全及依据、越限合法、计划时区/日历/顺序、严格拒绝未来事实字段、UUID别名与旧编号、缺失/歧义关联和估算汇总。根类型检查及新模块Deno检查用于确认当前Node/Edge可消费这个独立模块；不等于路由或UI已接入。

后续同批验收应使用明确演练：签到岗位2人，到离场与任务时段不同；20个椅子关联一条租赁计划，另有已有物料；预算上限为明确假设，估算有人工依据，未知仍null。实际操作保存→刷新→备份→恢复，删除任务/物件后保留缺失引用，复制不重用业务记录ID，分享不泄漏，云转换保留本地原稿，评审保持同快照与资料性质。

实际到场人数/时间、人员名单、确认报价、费用发生、收付款计划与实际、变更与复盘仍在已授权完整范围内。扩展前须区分计划、可变估算和不可回滚事实，说明来源、记录时点、权限及补偿/版本语义；不能给v1偷偷添事实字段，也不能把当前未实现范围说成完成。
