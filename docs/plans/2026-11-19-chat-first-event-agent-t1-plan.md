# T1 施工方案（2026-11-19 14:40）

依据：T0 基线 `docs/plans/2026-11-19-chat-first-event-agent-t0-baseline.md` 的 G4–G8。
性质：**方案，未落码**。每条给出「改哪个文件哪一段、改成什么、怎么验、风险」。

## 0. T0 三项「未核实」的复核结论

| 项 | 复核结果 | 证据 |
| --- | --- | --- |
| 固定推荐按钮 | **修正：不是按钮，是本地目录**。`wedding-venue-catalog.ts` 有 6 条硬编码杭州婚礼场地（西湖园林、西子宾馆（草坪）、柳莺里、夕上·虎跑1934、金溪山庄（草坪）…），经 `findWeddingVenues` 关键字匹配、`rebuiltWeddingVenues`/`rebuiltSceneRefs`(120) 注入模型上下文；`outdoor-agent-understanding.ts:14` 是唯一引用方 | `Select-String wedding-venue-catalog`、`WEDDING_VENUES`(33) |
| 待解决事项卡 | **确认没有独立卡**。只有 `outdoor-task-card.tsx:23` 的 `blocked: '需要补充'` 状态标签，无缺项清单/依据入口 | `outdoor-task-card.tsx:6,23` |
| 成果与过程记录卡 | **部分存在**：导出预览卡在 `agent-panel.tsx:620`（渲染）/`2942-2989`（意图与确认），有「确认前不下载」的诚实口径；**缺**版本号、阶段截图、变更摘要 | `agent-panel.tsx:620,794,2942` |

修正说明：T0 第 4 节把「固定推荐按钮」列为未核实是对的；现在定位到它其实是 `WEDDING_VENUES` 这 6 条本地目录 + 关键字匹配，属 T2「真实检索」的替换对象，不只是 UI 按钮问题。

## 1. 五个增量（按风险从低到高）

### T1-a 失败卡给出真实环节与出路（低风险）

- 改：`agent-confirm-cards.tsx:31`「没搜到候选场地。换个说法再说一句，或点右栏「地图选址」手动圈。」→ 拆成三行：**试了什么**（关键词＋已查范围）、**已保留什么**（已确认场地/已有边界不动）、**下一步**（改关键词 / 换搜索范围 / 手动圈选三选一，并能直接点）。
- `:62`「都不是，换个说法」→「都不合适，按条件再找」或「换个范围再找」，并把当前条件原样带进下一轮。
- 怎么验：`npm --prefix frontend run test -- agent-panel.react.test.tsx -t "候选"`（现有面板测试里有候选文案断言，先跑一遍确认哪些会红）；无专属测试，需新增 2 条断言（空候选时三个要素都在、点击后条件不丢）。
- 风险：低。纯文案＋按钮回调，不动数据流。

### T1-b 主工作流卡双位置挂载合并（中风险）

- 现状：`agent-panel.tsx:4693`（`beforeLatestQuestion`）与 `:4707`（底部）挂同一 `outdoorWorkflowCard`，靠 `waitingOutdoorReply` 互斥。
- 改：只保留一个挂载位置（建议底部主位），等待态改为卡内 loading 行，不再搬位置；删掉 `beforeLatestQuestion={waitingOutdoorReply ? outdoorWorkflowCard : undefined}`。
- 怎么验：`agent-panel.react.test.tsx` 的等待态用例；手动核对「发送后卡不跳位」。
- 风险：中。`Bubbles` 的 `beforeLatestQuestion` 还承担滚动锚点，需确认移除后不丢「自动滚到最新问题」。

### T1-c 同阶段三份进度合一（中高风险）

- 现状：卡内 caption(414) ＋ `OutdoorTaskCard`(4718) ＋ `ToolCallTrace`(4745) 同时在讲进度。
- 改：保留 `ToolCallTrace` 作唯一「当前执行状态」，`OutdoorTaskCard` 降级为历史折叠块（`<details>`），卡内 caption 只在无 trace 时出现。
- 怎么验：现有 `tool-trace`、`outdoor-task-card` 相关断言 + `agent-panel.react.test.tsx`；需新增「三处不同时出现」断言。
- 风险：高。`composeProcessStrip`/`ProcessFailure` 与失败态耦合（`lib/turn-process.ts`），改动会牵到失败卡与取消。

### T1-d 占位插画换真实候选/预览（中风险）

- 现状：`StageThumb`(61) 固定 SVG，渲染在 414；注释自述「不声称是真实轮廓」。
- 改：有真实候选/边界时渲染真实轮廓缩略（复用 `case-thumb.tsx` 的画法），无真实数据时整块不渲染而不是放示意图。
- 怎么验：`agent-panel.react.test.tsx` + 新增「无真实数据时无 StageThumb」断言。
- 风险：中。紧邻 `showScopeGuide`(339) 分支，容易把「范围未定时的手画引导」一起删掉。

### T1-e 审批降级（中风险）

- 现状：`outdoor-workflow-card.tsx:340-354` 只要 `pendingPlan` 就出「批准并执行」；`explicitProposalApproval`（hook 侧）另有判断。
- 改：按监督档位＋风险分级：普通可撤销布置直接执行并回述假设；仅覆盖/删除/付费保留确认。需要先在 hook 里暴露「本轮动作风险等级」，属跨文件改动。
- 怎么验：`use-outdoor-agent-workflow.react.test.tsx`（74 例）里批准相关用例。
- 风险：中高。会碰 `explicitProposalApproval` 与既有「不偷跑」口径，必须先读 `hooks/use-outdoor-agent-workflow.ts` 的批准路径。

## 2. 建议顺序

T1-a → T1-d → T1-b → T1-c → T1-e。理由：a/d 是局部渲染，b/c 动挂载与失败态耦合，e 要动 hook 契约。

## 3. 本轮为何未落码（如实）

本轮 14:30 开工、15:00 硬截止，扣掉复核与写方案只剩不到 20 分钟。T1 的每一项都要改 `agent-panel.tsx`(5030 行) 或 `outdoor-workflow-card.tsx`(1089 行)，并同步 `agent-panel.react.test.tsx` 的断言；在冻结前改到一半会留下「测试红、卡片位置错乱」的工作树，比不改更糟。所以本轮交付**方案**，不交付半成品代码。

下一轮起点：T1-a（失败卡），先跑一遍现有候选文案断言确认基线，再改文案与回调，最后跑 `agent-panel.react.test.tsx` 与新增 2 条断言。
