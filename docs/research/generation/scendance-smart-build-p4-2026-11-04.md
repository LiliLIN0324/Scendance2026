# 智能建造 P4 收尾：生成前可行域探测、读白只承诺可达座位、件/座单位收口（2026-11-04）

> 工作树实况记录，不是复盘文章。分支 `feat/smart-build-scene-script`（自 tip `110f348` v3.3.0 开枝），**未 commit、未 push、未合 main**；下文所有 `file:line` 按 2026-11-04 工作树记录，后续提交会让行号漂移。验证运行时为 Node v24.19.0（`.nvmrc` 钉 24.15.0；PATH 默认 node 是 v22.23.2，Node 26 的环境性问题见基线篇 §5）。前置背景读 [`scendance-generation-synthesis-2026-11-01.md`](scendance-generation-synthesis-2026-11-01.md) 与 [`scene-script-code-review-2026-11-01.md`](scene-script-code-review-2026-11-01.md)。

## 0. 结论速览

1. P4 做了四件事：**①上限前置探测**——座位区在摆任何东西之前，逐格空跑探到这套排法能坐几座；**②读白只承诺可达**——气泡里座位那句从念要价（「80 座」）改成念探针结果（「按这版排法最多 20 座（要 80）」）；**③件/座单位收口**——人头缺口按「座」记一条 `count: 0` 的诊断，不再换算成「没放进去 75 件」这种没人会数的件数；**④加座走两扇门**——脚本填满门与旧启发式密排门各跑一遍，只在座位真的变多时换边，按钮不许多余。
2. 三道门（预览 / 确认 / 撤销）一行没动，落盘仍只走 `onApplyCreative`；没有新增 wire schema，前后端仍共用 `supabase/functions/_shared/scene-script-contract.ts` 这一份契约加前端 `PlanDiagnostic` 这一本账。
3. 证据（Node v24.19.0 实跑）：7 个 lib 套件 **96/96 绿**、`agent-panel.react` **46/46 绿**、`tsc --noEmit` **exit 0**、`npm run build`（静态导出 13 页）**exit 0**；:3001 浏览器两个超载场景全程冒烟，截图 5 张存 `development-evidence/p4-smoke-*.png`。
4. 三个诚实边界：密排门（旧 `proposePlan`）会带 2 起重叠警告，P4 让它能赢但没修旧引擎；通道/入口净空的**生成前掩码**仍未做（11-01 路线图只完成容量侧）；加载期那条 React `setState-in-render` 报错是既有代码，不在本次 diff。

## 1. P4 在路线图里的位置

11-01 横向调研 [`parallel-systems-generation-2026-11-01.md`](parallel-systems-generation-2026-11-01.md) 的「改动 3：布置前先算容量/可行域（硬约束掩码 + 容量账本）」给了规格与三个风险，综合篇 §7 第 4 条把它排为第四步：「容量反算与『最多 N 座』文案已落地……下一步是把主通道 ≥1.2 m、入口净空在生成**前**变成可行性掩码」。P0–P3 完成后实况与原设想有两处偏差，P4 按偏差收口：

| 11-01 的设想 | 到 P3 为止的实况 | P4 的处置 |
|---|---|---|
| 新建独立纯函数模块 `venue-feasibility.ts`，内含 `capacityOf / feasibleSlotsFor` | 编译器里已有 `fillSeating` 容量反算，但容量是**摆完之后数**出来的，读白先于摆放生成，只能念要价 | 不新建模块、不引入第二套几何口径：在编译器内部把「试摆」拆出只读的 `fitsBatch`，探针与真实摆放共用同一道几何闸（§2.1） |
| 「先返回这块地最多能坐多少，再让人做选择题」 | 文案说「场地最多摆得下 N 座」，但 N 只是整排桌椅这一种排法的槽位数，证明不了这块地的极限 | 同时给两个数：这套排法探到的 `ceiling` 与按面积的宽松上界 `upper`；对人只说「这一版排到 N 座就是头」，证词边界写进代码注释与断言（§2.2） |
| 诊断原因枚举复用 `layout-review` 单一来源，避免两套文案 | P3 已把脚本 refusals 折进共享 `PlanDiagnostic`，但「座」的缺口仍被折成「件」，且同一句数字念两遍 | `PlanDiagnostic` 增 `seats/capacity` 两个口径字段，原因词表导出为 `DIAGNOSTIC_REASON` 单一来源（§2.4） |

借的外部机制不变：Holodeck 的硬/软约束分离（硬约束不过线就没有候选，LLM 无否决权）、LayoutGPT 的单位显式声明与逐件溢出度量、ATISS「先给定可接受位置区域再放」。本次没有重读上游仓库，机制出处与许可证边界仍以 11-01 各篇为准。

## 2. 四项决定与设计

### 2.1 上限前置探测：探针在写第一个字节之前跑完

`scene-script-compiler.ts` 原先只有 `acceptBatch`：试摆一整组，成功就把候选层写进 `current`。P4 把它拆成两层：

- `fitsBatch`（`scene-script-compiler.ts:222`）只算不写：在副本上跑完全部碰撞/结构/边界检查，摆得进就返回 `next` 候选层，摆不进返回原因码（`E_ROLE_UNFIT / E_KEEP_OUT / E_SET_BLOCKED / E_FINAL_GEOMETRY`），调用方的画布一个字节都不动。
- `acceptBatch`（`:247`）变成薄封装：调 `fitsBatch`，只有接受时才把 `next` 交给 `current`。生产路径行为不变，探针因此能复用**完全相同**的 `hasCollisions` / `canApplyLayoutGeometry` / `floorKeepOut`，不存在「算得出、放不下」的第二套几何口径——这正是 11-01 规格点名的头号风险。

`fillSeating`（`:442`）的工序因此改成「先探后排」：

1. 对不旋转与旋转 90° 两种朝向，把网格里每个槽位都用 `fitsSet` 空跑一遍（`:466-477`），活下来的槽位进 `live`，第一个拒因留给报错；
2. 朝向按活槽数排序取多的，一样多时取不旋转的——同一份脚本永远给同一间房，确定性不靠 Map 迭代顺序；
3. `ceiling = 活槽数 × 每组座位数`（`:483`）。顶死在座位区里的锁定衣柜吃掉的是永久格，容量跟着降，回归集有专门一条钉住它；
4. 之后才进入原有 `settle` 有界收束（上限仍为 6 遍），要价先收窄到活槽数（`:503`），缺的人头不再触发几十次「整组被拒」。

连一组桌椅都摆不下的窄区在探针阶段就出局，直接判 `ROLE_UNFIT` 不走网格——P1-1 那条「2 m 宽场地报最多 26 座」的老回归被同一机制继续挡住。

### 2.2 两个上限：这套排法的顶，不是这块地的极限

整排桌椅在切割处必然浪费地，把槽位数说成「场地最多 N 座」是一句证明不了的话。P4 同时算两个数：

- `ceiling`：§2.1 逐格探到的、**这套整排摆法**可达的座位数，对人说话只用它；
- `upper`：按每组占地（含 `SET_GAP_M`）与座位区可用面积反推的宽松上界（`:490-492`），`upper - ceiling` 就是这套排法没吃干的余地。它只出现在 `W_CAPACITY` issue 的补充句里（`:383-385`，「按面积粗算这块座位区还余着约 N 座的地，要多吃干得换排法」），不进对用户的承诺。

话术语律被钉成测试断言：气泡与 issue 文案里不得出现「这块地最多 / 这块座位区最多」，允许的说法只有「按这套排法这块座位区排到 N 座就是头」与「按这版排法最多 N 座（要 X）」（回归集「排到顶是这套排法的顶，不是这块地的极限」）。

### 2.3 读白只承诺这版排得到的数

`describeSceneScript`（`scene-script.ts:218`）增加可选参数 `seatingCeilings`，座位区一行三种句式，非座位区逐字不变：

- 探到的上限 ≥ 要价：照旧念要价（要多少就能给多少，不啰嗦）；
- 上限为 0：「这一版连一组桌椅都排不进（要 X）」；
- 0 < 上限 < 要价：「按这版排法最多 N 座（要 X）」（`:233`）。

编译器在座位区跑完、`seatCeilings` 填好之后才重新生成读白（`scene-script-compiler.ts:358`），取代摆场前那句只知道要价的 `summary`。区角色名同时抽成 `SCENE_SCRIPT_ROLE_LABEL`（`scene-script.ts:204`），读白与诊断共用一套叫法。要价本身没有消失：它留在括号里、留在卡片「座位 K / N」那一行，也留在 `guests` 字段里。

### 2.4 件/座单位收口：同一件事只按一个单位说一次

- `PlanDiagnostic` 增加 `seats`（人头缺口）与 `capacity`（这区给得起的顶）两个可选字段（`diagnostics.ts:27-33`）；原因词表从模块私有 `REASON` 改为导出的 `DIAGNOSTIC_REASON`（`:37`），新增 `ROLE_UNFIT / KEEP_OUT` 两个码，编译器与卡片念同一本账。
- 编译器侧 `sceneScriptDiagnostics`（`scene-script-compiler.ts:94`）把拒绝折成两类：物料被拒按区记件，`Σ count` 恒等于 `dropped`；人头缺口单独记一条 `count: 0` 的座位条，不抢「没放进去 N 件」那句的数字。`mergeDiagnostics` 合并时座位缺口累加、上限取大（`diagnostics.ts:71-89`）。
- 展示侧 `outcomeLines`（`run-outcome.ts:85`）只统计 `count > 0` 的物料条；只有一条原因时不再把数字念两遍（老文案「没放进去 2 件：改到锁定的物料 2 件」是口吃）。人头缺口唯一的人脸是卡片座位行（`agent-panel.tsx:1726`），同屏不再出现第二种单位。

### 2.5 加座两扇门：按钮点下去必须改变结果

P1-3 修好后「加座」能走到座位优先分支，但 P4 发现脚本门在要价已超上限时，`guests: null` 填满得到的还是同一排槽位，按钮可能再次失效。`localPlan`（`local-plan.ts:53-67`）现在把两扇门都跑一遍：

1. **脚本填满门**：`scriptAttempt({ ...input, guests: null })`，整排摆法的顶；
2. **旧启发式密排门**：`fallbackPlan(input)`（即原 `proposePlan`），排得更密但几何纪律更松；
3. 按座位数降序排序，只有最优者**严格多于**当前座位才返回，且标明 `via: 'script' | 'fallback'` 与 `fallbackReason`；否则原样落回脚本版，UI 上按钮直接不渲染（`agent-panel.tsx:1728-1729`：能再加时显「加座，再排一版」，两扇门都到顶时改显「这一版排到 N 座就是头；要再多人，得换更大的场地或按站立留空」）。

`local-plan.test.ts` 钉死两件事：12×9/200 人场景下加座必须真多坐（`priority.seats > plain.seats`），且走 fallback 时带「更密的排法」原因；门口测试同时钉死读白数字等于 `plan.capacity`、`dropped` 为 0 且诊断里存在座位条。

## 3. 接线点清单（当前工作树行号）

| 关注点 | 位置 |
|---|---|
| 本地唯一生成门，脚本优先、失败回退 | `lib/local-plan.ts:42`；两扇门比座位 `:53-67`；零座位回退 `:71-76` |
| 只读试摆 / 真实整组接受 | `lib/scene-script-compiler.ts:222` `fitsBatch`、`:247` `acceptBatch` |
| 先探后排、双上限、收窄要价 | `lib/scene-script-compiler.ts:442` `fillSeating`、`:483` ceiling、`:490-492` upper |
| 脚本拒绝折进共享诊断 | `lib/scene-script-compiler.ts:94` `sceneScriptDiagnostics`；容量 issue `:378-385` |
| 读白三句式与角色名单一来源 | `lib/scene-script.ts:204` `SCENE_SCRIPT_ROLE_LABEL`、`:218-234` `describeSceneScript`；编译器调用点 `scene-script-compiler.ts:358` |
| 共享词表与双单位字段 | `lib/diagnostics.ts:37` `DIAGNOSTIC_REASON`、`:71` `mergeDiagnostics`、`:108` `describeDiagnostics` |
| 卡片账单按件过滤、单因不复读 | `lib/run-outcome.ts:62` `buildOutcome`、`:85` `outcomeLines` |
| 方案上的容量字段 | `lib/agent-proposal.ts:91` `capacity?` |
| 气泡先念读白再念共享账 | `panels/agent-panel.tsx:161` `scriptSummaryOf`、`:888-889` 拼气泡 |
| 生成门接线（`proposePlan` 直调已移除） | `panels/agent-panel.tsx:1005` `localPlan(...)` |
| 卡片座位行 / 加座钮 / 终态话术 | `panels/agent-panel.tsx:1726`、`:1728`、`:1729` |
| 前后端契约（未新增第四套 schema） | `supabase/functions/_shared/scene-script-contract.ts`（11-01 已建，P4 未改形状） |

## 4. 验证证据（2026-11-04 实跑）

### 4.1 自动化

| 命令（工作目录 `frontend/`，运行时 node v24.19.0） | 结果 |
|---|---|
| `node node_modules/vitest/vitest.mjs run scene-script scene-script-compiler local-plan scene-script-regressions agent-proposal diagnostics run-outcome` | **7 文件 / 96 例全过**，2.27s（diagnostics 5、run-outcome 6、scene-script 14、compiler 11、regressions 24、local-plan 8、agent-proposal 28） |
| `node node_modules/vitest/vitest.mjs run panels/agent-panel.react.test.tsx` | **46/46 全过**，42.0s；stderr 有 §5.3 那条既有 Warning，无失败 |
| `node node_modules/typescript/bin/tsc --noEmit` | **exit 0**，全仓零类型错误 |
| `node npm-cli.js run build`（`package-pages` + `next build` 静态导出） | **exit 0**，「Compiled successfully in 28.5s」，13 页全部静态生成；lint 只有存量 import-order/hooks 依赖 Warning，无 error |

node24 下 jsdom 的 `localStorage` 正常，基线篇记录的 Node 26 `--localstorage-file` 兼容问题本轮不需要绕过。

### 4.2 浏览器冒烟（`next dev -p 3001`，未连云）

Dev server 用 node24 启动（`frontend/node_modules/next/dist/bin/next dev -p 3001`，日志 `.dev-3001.2026-11-04.out.log` / `.err.log`），首页 HTTP 200。两个场景走完同一套「预览 → 确认 → 撤销」，文案为现场实抄：

**场景 A：brief「80 人圆桌晚宴，室内 15×10」**（截图 `p4-smoke-1-preview.png` 起）

1. 首版气泡读白：「主舞台 14.3 × 1.5 m · 前场通道 14.3 × 1.2 m · **座位 14.3 × 5.0 m，按这版排法最多 20 座（要 80）** · 签到台 2.4 × 1.3 m · 角隅绿植 1.6 × 1.3 m，3 件。放进 30 件 · 撤掉 5 件。」卡片只有「座位 20 / 80 · 还差 60」与「加座，再排一版」，**没有**「没放进去 60/75 件」之类按件的人头账。
2. 点「加座，再排一版」（`p4-smoke-2-add-seats.png`）：密排门赢，气泡「放进 86 件 · 撤掉 5 件」，卡片「按 80 人摆了 80 座」，按钮消失；同时出现「2 件挤在一起或压到墙：签到台、Dining Table」警告（见 §5.1）。
3. 点「确认布置」（`p4-smoke-3-applied.png`）：「写进画布了：这一版一共 86 件物料，都能直接拖；不想要就撤销一步，整体退回来。」卡片转为「这一版布置」，3D 候选从线框变实体，重叠件黄色标出。
4. 点工具栏「撤销」（`p4-smoke-4-undone.png`）：86 件整体退回，卡片收掉，气泡「画布改过了（撤销或手动调整），「这一版布置」的卡我收了；要再出一版随时说。」

**场景 B：新会话，brief「200 人圆桌晚宴，室内 12×9」**（`p4-smoke-5-ceiling.png`）

1. 首版读白「座位 11.3 × 4.1 m，**按这版排法最多 16 座（要 200）**」，卡片「座位 16 / 200 · 还差 184」，放进 25 件、撤掉 5 件，无按件的人头拒绝句。
2. 点「加座」：密排门给到 94 座（放进 100 件），卡片「座位 94 / 200 · 还差 106」，终态行实文「**这一版排到 94 座就是头；要再多人，得换更大的场地或按站立留空。**」——无「场地最多」字样、无二次加座按钮，同样带 2 起重叠警告。

控制台全程只有：WebGL D3D 着色器编译 warning（原生实现噪声）与一条 React `setState-in-render` 报错（§5.3，加载期出现一次，后续交互无新增报错）。

## 5. 没做、做不到与已知问题

### 5.1 密排门的两起重叠是旧引擎的账，P4 没修

两个场景里只要加座走到 fallback（`proposePlan`），都稳定报「签到台、Dining Table」2 件挤压/压墙，确认后黄色标出、可手动调。脚本门（编译器）零重叠，但整排摆法座位少；密排门座位多但继承旧启发式的几何瑕疵。P4 的职责是把两扇门的**取舍如实摆给人**（座位数对比 + 重叠警告 + 黄标），没有在本轮重写旧引擎。要不要让密排门也过 `canApplyLayoutGeometry` 硬筛，是下一轮独立决定，不能悄悄混进 P4。

### 5.2 通道/入口的生成前掩码仍未做

11-01「改动 3」规格里的 `FeasibilityRules`（主通道 1.2 m、入口净空 1.5 m 等）与独立 `venue-feasibility.ts` **没有落地**。当前通道以脚本里的 aisle 区 + `floorKeepOut` 禁入和软警告存在，探针保证座位不压通道，但「入口净空够不够」不会在生成前算成掩码。综合篇 §7 第 4 条因此只完成容量侧，通道侧保持开放，建议下一轮先统一 `layout-review` 与编译器的通道常量再做，避免体检与生成两张皮。

### 5.3 既有的 React 报错不是本次引入

控制台报错 `Cannot update a component (SessionHistoryOverlay) while rendering a different component (LayoutAgentProvider)`，根因在 `panels/agent-panel.tsx:341`：`say()` 的 `setBubbles` updater 里同步调了 `touchActiveSessionRef.current()`（`:337-343`）。该回调在 tip 就存在，P4 只改了 `say` 的调用处与 `ProposalCard` 文案，没动 updater；React 测试 46 例带着这条 Warning 全绿。修法应把 touch 移出 updater（effect 或事件体内直调），留作独立改动，不混进本枝。

### 5.4 其他边界

- `upper` 是按面积的粗算上界，只用于「还余着约 N 座的地」这种量级提示，不是 packing 证明，也不进任何断言数字。
- 本轮没有跑仓库根全量套件（基线篇记录的 Node 26 环境红与 PowerShell 子进程超时与本枝无关）；node24 下本枝相关套件与构建全绿，根套件是否在 node24 全绿未验证。
- `next start` 与 `next.config.mjs` 的 `output: 'export'` 不兼容，冒烟只能用 `next dev`；静态导出成品用任意静态服务器预览。
- `via / fallbackReason / upper / issues` 目前是数据与测试口径，UI 不直接展示 fallback 原因，用户只能从结果差异感知换了排法。

## 6. 复现方法

```powershell
# 运行时：C:\Users\endTree\.dsh\runtime\node24\node_modules\node\bin\node.exe（v24.19.0）
# 工作目录：C:\mujing\Scendance2026\frontend

# 1) 冒烟服务（静态导出仓不能用 next start）
& $node node_modules/next/dist/bin/next dev -p 3001
# 浏览器开 http://localhost:3001，新会话输入「80 人圆桌晚宴，室内 15×10」，走 加座 → 确认布置 → 撤销

# 2) 本枝相关测试
& $node node_modules/vitest/vitest.mjs run scene-script scene-script-compiler local-plan scene-script-regressions agent-proposal diagnostics run-outcome
& $node node_modules/vitest/vitest.mjs run panels/agent-panel.react.test.tsx

# 3) 类型与构建
& $node node_modules/typescript/bin/tsc --noEmit
& $node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
```

## 7. 本轮改动文件（15 个路径，均未提交）

| 文件 | 性质 |
|---|---|
| `lib/scene-script.ts`、`lib/scene-script-compiler.ts` | P4 主体（探针、双上限、读白、共享诊断） |
| `lib/local-plan.ts` | 加座两扇门 |
| `lib/diagnostics.ts`、`lib/run-outcome.ts`、`lib/agent-proposal.ts` | 双单位账本与词表 |
| `panels/agent-panel.tsx` | 气泡/卡片话术与生成门 |
| `lib/scene-script.test.ts`、`lib/scene-script-compiler.test.ts`、`lib/local-plan.test.ts`、`lib/scene-script-regressions.test.ts`、`lib/run-outcome.test.ts`、`panels/agent-panel.react.test.tsx` | 测试（含 P4 新增回归） |
| `supabase/functions/_shared/scene-script-contract.ts` | 11-01 已建的共享契约，本枝带入 |
| `frontend/package-lock.json` | 依赖锁微调 |

浏览器证据：`development-evidence/p4-smoke-1-preview.png`、`p4-smoke-2-add-seats.png`、`p4-smoke-3-applied.png`、`p4-smoke-4-undone.png`、`p4-smoke-5-ceiling.png`；命令日志：仓库根 `.p4-lib-tests.log`、`.p4-react-tests.log`、`.p4-tsc.log`、`.p4-build.log`、`.dev-3001.2026-11-04.{out,err}.log`。
