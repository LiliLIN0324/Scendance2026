# M1–M5 移植差距清单：幕景「智能建造」骨架对标 PetitMaker（谷地工坊）

| 项 | 值 |
|---|---|
| 对标对象 | Stry233/PetitMaker（petitmaker.com.cn），建造逻辑研究见 `docs/research/generation/petitmaker-construction-logic-2026-11-01.md` |
| 本清单目的 | 把研究结论落成「当前幕景差多少、补什么、按什么顺序」的施工清单，作为独立建造骨架线的开工依据 |
| 基线 commit | 0655d2d（merge v3.4.0 收口） |
| 日期 | 2026-11-05 |

---

## 0. 一句话结论

PetitMaker 的护城河是「**生成过程可计划、可校验、可重放、可归因**」。幕景现在只有半条预览门，缺的正是这五根骨架。好消息是：agent-proposal.ts 已经有纯计划的雏形（VenuePlan/PlanProposal/RevisionConflict），三道门已经存在，Bingo 审校已经是账本的半成品——**不是从零开始，是把已有零件串成 PetiMaker 那条流水线**。

---

## M1｜整份计划先于第一条命令存在（纯计划 IR）

| 项 | 现状 |
|---|---|
| 幕景已有 | `lib/agent-proposal.ts`：`VenueInput/VenuePlan`（raiseVenue/replaceVenueWithShell）、`PlanInput/PlanProposal`（proposePlan）、`RevisionConflict` + move/rotate/scale/remove/recolor ops（revisePlan）。这些是**纯函数、不碰 zustand、可在 vitest 里单测**——已经是 PetitMaker 风格的计划 IR。 |
| 幕景缺 | ①计划只覆盖「场地壳子 + 物料加减/微调」，没有六阶段那样的分区→动线→结构物→软装→铺地顺序；②计划产物直接被 onApply 一把糊到 RoomLayout，没有「计划→校验→才落地」的分层；③没有 seed/configHash，同一句话重说一遍结果不可复现。 |
| 移植动作 | **M1-A** 把 proposePlan 产出物升级为带 `seed + configHash` 的 `Recipe`（场地/人数/活动/风格/seed 五要素可序列化），同配方复算同结果。**M1-B** 在 agent-proposal 里加 `designLayout(recipe): LayoutPlan` 纯函数分区层（zone/circulation/anchors/dressing 四段），暂不接 UI，只在 vitest 里断言。 |
| 成本 | M1-A 约 0.5 天；M1-B 约 3 天。纯函数，不动 three.js，不碰三道门。 |
| 优先级 | **P0**——M4/M5 都依赖它。 |

## M2｜写入只有一道门：Command → 两阶段规则 → 返回值

| 项 | 现状 |
|---|---|
| 幕景已有 | `onApplyCreative` 三道门（绿框预览→唯一确认→撤销），所有 AI/布置写入都收在这一个入口；`commitHistoryNow` 每次写入前落历史。 |
| 幕景缺 | ①写入形状不统一：拖放 placeFromCatalog、键盘 confirmPlacement、onPreviewAi→onApplyCreative、onLoadLayout（云端读档）各自一条路径，没有粗粒度 Command 联合类型；②没有 pre/post 校验规则注册器，非法摆放（穿墙/越界/压主通道）靠用户自己看出来；③失败是 toast/异常，不是结构化 `{success:false, errors[]}`。 |
| 移植动作 | **M2-A** 定义 `SceneCommand` 联合（PlaceAsset/RemoveAsset/UpdateTransform/SetSurface/ReflowZone/ApplyPlan），三个写入路径全部收口成构造命令对象。**M2-B** 写 `CommandExecutor`：resolve→preValidate→执行→postValidate，非法命令返回错误数组（含证据：哪个物件/哪一格），不抛异常。规则先用最小集：越界、重叠、压主通道。 |
| 成本 | M2-A 约 2 天（动 room-organizer 多处调用点，要小心回归）；M2-B 约 2 天。 |
| 优先级 | **P0**——这是「越聪明越要管住手」的闸门。 |

## M3｜几何不靠生成一次完事，靠定点收束

| 项 | 现状 |
|---|---|
| 幕景已有 | onCatalogDrop→placeDiscrete 的落点判定（F3 正在补三档语义）。 |
| 幕景缺 | 没有「布置完跑一遍收敛器」：桌台挡主通道、花艺孤岛、椅区断头——这些在 PetitMaker 由 settle 定点循环解决，幕景目前完全靠人眼。 |
| 移植动作 | **M3-A** 先定义「合法布置图」判据：每件家具可达主通道、主通道不被堵、椅区连通。写 `settlePlacement(layout): {layout, fixed[]}` 纯函数（F3 的落点判定直接复用）。**M3-B** 生成落地后自动跑一遍，被修进清单接进 Bingo 审校台。 |
| 成本 | 约 3 天。 |
| 优先级 | **P1**——F3 完成后开工，否则判据没素材。 |

## M4｜候选在副本上生成，落地只重放命令并验指纹

| 项 | 现状 |
|---|---|
| 幕景已有 | 预览态（pendingPreview）：AI 方案先绿框预览，用户确认才写画布。这已经是「候选→确认」的雏形。 |
| 幕景缺 | ①没有「一次出 3 个候选对比」；②确认时不验指纹——用户在预览期间手动改过画布，旧候选还能盖上去（测试里已有「作废本地旧候选」用例，说明这是已知问题）；③候选是直接改了场景引用，不是命令序列，无法重放。 |
| 移植动作 | **M4-A** 候选保存成 `commands[] + baseFingerprint`（baseFingerprint = 当前布局对象 id+变换+资产 id 的稳定哈希），确认时先比对指纹，不一致就提示「画布已被改动，候选已失效」而不是硬盖。**M4-B** 出多候选（同 recipe 换 seed 出 3 版），预览卡横排切换。 |
| 成本 | M4-A 约 2 天；M4-B 约 2 天。 |
| 优先级 | **P0**——直接消灭「旧候选盖新画布」事故。 |

## M5｜降级必须留账：拒绝计数 + 溯源 taint

| 项 | 现状 |
|---|---|
| 幕景已有 | Bingo 审校台（pins：堵通道/越界/清单核对）、handoff 导出。 |
| 幕景缺 | ①一次生成跑完没有 Outcome 报表（放了几件、几件被拒、跳过哪些、为什么空）；②没有 provenance——「这张桌子是 AI 放的还是用户拖的、哪次生成放的」查不到；③被拒物件静默消失，用户以为成功了。 |
| 移植动作 | **M5-A** 生成返回 `GenerationOutcome{placed, refused[], skipped[], scopeEmpty?}`，接进 Bingo 脸的「本次报告」卡。**M5-B** 每个家具 item 挂 `createdBy: {opId, source: human|ai|procedural, seed?}`，导出 handoff 时可标注 AI 生成件占比。 |
| 成本 | M5-A 约 1.5 天；M5-B 约 2 天。 |
| 优先级 | **P1**——M2 完成后数据自然就有了，接线很便宜。 |

---

## 推荐施工顺序（与 F3/F4/F5 批衔接）

| 阶段 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| 第 1 批（当前 organizer 在跑） | F3 落点三档 / F4 搜索+最近用过 / F5 生成框双芯片 / v3.4.0 审计收口 | — | 本周内验收 |
| 第 2 批 | M1-A 配方 seed+hash；M4-A 指纹闸门 | M1-A | 1 周 |
| 第 3 批 | M2-A/B Command 门 + 最小规则集 | 第 2 批 | 1 周 |
| 第 4 批 | M3-A/B 布置收敛器；M5-A Outcome 报表 | M2 完成 | 1 周 |
| 第 5 批 | M1-B 四阶段布局纯函数；M4-B 多候选；M5-B provenance | 前四批 | 2 周 |

## 红线复述（动这条线时不变）

- 不绕 onApplyCreative 三道门（新骨架就是把它修得更硬，不是绕开）；不引新依赖、新色系；中文简体；功能优先；不动 3D/生成管线（Aholo/HY-3D/Lux3d/scene-script）——M1-M5 全部是数据层与写入层的重构，不碰模型与渲染。
