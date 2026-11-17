# 室内残留死代码审计与最小删除（origin/main @ 3e376b41）

> 本文是 `2026-11-17-indoor-shell-reference-scan.md` 的续篇：上一轮只做引用面分档，本轮在**干净远端基线**上做全量依赖图核实，落一次最小删除，并把「为什么室内残留仍然一项都删不掉」的证据固定下来。
> 只读盘点 + 4 个零引用原语删除；不含任何 R 线（壳体/three/状态/提案链）退役动作。

## 0. 一句话结论

室内残留**没有可独立删除项**：最薄的模块也有 1 个生产引用，链最终都收在 `room-organizer.tsx` 壳体或 `agent-panel.tsx` 提案链上。全树真正零引用的只有 13 个文件：第一轮删 4 个通用 UI 原语；第二轮按 owner「无源码消费者且不影响现状」口径再删 5 个休眠/未挂载组件及其孤儿样式，并摘掉 2 个无消费者的 npm 依赖；剩余 4 个有「按名引用」或「测试读源码」的硬依赖，保留。

## 1. 基线与分支

| 项 | 值 |
| --- | --- |
| 基线 | `origin/main @ 3e376b41`（`git rev-parse --short` 实测核对） |
| 清理分支 | `chore/remove-unused-ui-primitives`（从 `origin/main` 切出） |
| 删除提交 | `74b6494d` |
| 工作树 | 独立 worktree `.worktrees/ui-primitives-cleanup`，未触碰 `fix/outdoor-walk-control` 的 230 项在途改动 |
| Node | v26.2.0（满足 `engines: >=24.15 <25 \|\| >=26`） |

## 2. 口径与方法

1. `git archive origin/main frontend` 导出干净树到临时目录（**不用脏工作树 grep**）。
2. 解析 `frontend/` 下全部 **1414 个 `.ts/.tsx`** 的引用：`import ... from`、`export ... from`、副作用 `import '...'`、动态 `import('...')`、`require('...')`；
   解析相对路径、`@/` / `~/` 别名，按 `.ts/.tsx/.d.ts/index.ts/index.tsx` 逐个落文件。
3. 建反向依赖图，统计每个文件的**生产引用数**与**测试引用数**（测试口径：`*.test.ts(x)`、`*.react.test.tsx`、`__tests__/`）。
4. 以「入口（`app/**` 的 page/layout/route 等 + 配置文件）+ 全部测试文件」为根做可达性遍历（679 个根），不可达的非测试非入口文件即**死簇**。
5. 对候选用 `git grep` 全仓复核**按名引用**（字符串路径、CLI 用法、manifest、文档），并检查 barrel `index.ts` 转出口。
6. 动态/字符串引用无法由图覆盖的，一律按保留处理。

## 3. 零引用 / 死簇清单（全树仅 13 项）

| 模块（相对 `frontend/`） | 生产引用 | 测试依赖 | barrel/动态/按名引用 | 判定 | 依据 |
| --- | --- | --- | --- | --- | --- |
| `components/ui/card.tsx` | 0 | 0 | 无 | **已删** | 全仓 0 命中 |
| `components/ui/input.tsx` | 0 | 0 | 无 | **已删** | 全仓 0 命中 |
| `components/ui/label.tsx` | 0 | 0 | 无 | **已删** | 全仓 0 命中 |
| `components/ui/select.tsx` | 0 | 0 | 无 | **已删** | 全仓 0 命中 |
| `components/room-organizer/components/outdoor-view-switch.tsx` | 0 | 0 | 无 | **已删（第二轮）** | 从未挂载；原注释「保留待后续整体清理」经 owner 确认后清除 |
| `components/room-organizer/panels/library-chat.tsx` | 0 | 0 | 无 | **已删（第二轮）** | 休眠组件；`.sc-library-chat*` 样式删除，仅 `.sc-library-chat-choices` 因 `material-create-cell` 仍在用而保留 |
| `components/room-organizer/panels/scene-chat.tsx` | 0 | 0 | 无 | **已删（第二轮）** | 已不挂载；`.sc-scene-chat*` 样式一并删除 |
| `components/room-organizer/panels/plan-candidate-list.tsx` | 0 | 0 | 无 | **已删（第二轮）** | 面板未接线；纯函数层 `plan-candidate-preview` / `-apply` 有测试覆盖，保留待 M5 |
| `components/room-organizer/panels/plan-candidate-card.tsx` | 1（仅 `plan-candidate-list.tsx`） | 0 | 无 | **已删（第二轮）** | 同上，随 list 一并删除 |
| `evals/brief/run.ts` | 0 | 0 | **按名引用** | 保留 | `evals/brief/README.md:8/17`：`node scripts/run-ts.mjs frontend/evals/brief/run.ts` |
| `evals/brief/run-coverage.ts` | 0 | 0 | **按名引用** | 保留 | 同 README:32 |
| `lib/investor-report.ts` | 0 | **有（读源码）** | 无 | 保留 | `lib/brand-tokens.test.ts:63` `read('lib/investor-report.ts')`；且 D 层业务事实保留口径 |
| `scripts/measure-space/scene.ts` | 0 | 0 | **按路径引用** | 保留 | `scripts/measure-space/run.mjs:14` esbuild `entryPoints` |

已无同名源的条目（无需动作，与上一轮排除项一致）：`lib/room-shapes.ts`、`lib/bounded-edit-validation.ts`、`lib/wall-mount-heights.ts`、`lib/furniture-catalog.ts`、`lib/local-shared-seating-draft.ts`。

## 4. 仅测试引用的 20 个模块（不是孤儿）

| 分组 | 模块 | 保留依据 |
| --- | --- | --- |
| 在途纯函数/契约层 | `plan-layout-migration`、`plan-candidate-apply`、`plan-traffic-preview`、`outdoor-demo-plan`、`site-plan-migrate`、`site-plan-store` | M2/M5 已落码待接线（车辆契约、H1-b 版本化存储等），删除即拆在途工作 |
| 休眠面板 | `venue-facts-panel`、`structural-properties-panel`、`recovery-entry`、`readonly-draft-export` | HANDOFF 多轮记录「组件本体与测试休眠保留」 |
| 测试基建 | `lib/__testfixtures__/fixtures.ts`（180 个测试引用）、`lib/__testshims__/gltf-blob-image-loader.ts` | 删除会连带 180 个用例 |
| 其它 | `lib/library.ts`、`outdoor-facility-generate.tsx`、`local-write-lease-provider.tsx`、`lib/fixtures/hall-d5.ts`、`lib/fixtures/g402-silver-simulation.ts`、`lib/reconstruction-edit-prototype.ts`、`lib/source-capability-storage.ts`、`lib/venue-source-confirmation.ts` | 各自测试同时覆盖其他存活模块（场地事实 3c、草稿租约、恢复链路等）；`outdoor-facility-generate` 属物料生成链路 |

## 5. 室内残留为什么一项都删不掉（引用链）

| 模块 | 生产引用 | 引用方 |
| --- | --- | --- |
| `three/dormers.ts` | 1 | `three/roof.ts` |
| `three/neighbours.ts`、`three/item-labels.ts`、`three/entrance.ts` | 1 / 1 / 1 | `hooks/use-scene-effects.ts` |
| `three/scan-placement.ts` | 1 | `three/splat-preview.ts` |
| `hooks/use-scene-effects`、`use-three-scene`、`use-npcs`、`use-floor-keep-out`、`use-walk-avatar`、`use-layout-persistence`、`lib/drop-zone`、`lib/wall-snap` | 各 1 | `room-organizer.tsx`（经 `components/room-organizer/index.ts` barrel 挂到 `app/`） |
| `lib/local-plan.ts` → `lib/rest-area-plan.ts`、`lib/entrance-block-check.ts` | 1 / 1 | `panels/agent-panel.tsx`（提案链） |
| `lib/walk-seat.ts` | 1 | `hooks/use-walkthrough.ts` |
| 主干 | `schema.ts` 26、`structural-layout` 42、`use-layout-store` 13、`scene-delivery` 13、`opening-snap` 16、`floor-keep-out` 12、`initial-layout` 5、`layout-reducer` 5、`use-layout-state` 7、`use-history` 3 | 壳体/面板/提案/持久化/分享页 |
| three 场景簇 | `room-builder` 10、`furniture-builders` 5、`wall-openings` 5、`interior-walls` 4、`drag-handlers` 4、`wall-patterns` 3、`structure-builder` 3、`roof` 2、`baseboard` 2、`floor-patterns` 2、`footprint-outline` 2 | `use-scene-effects` / `scene-delivery` / `proposal-preview` |
| 座位/家具链 | `table-seat-plan` 8、`seat-requirement` 5、`ring-seating` 2、`seating-allocation` 2、`local-seating-*` 1–3、`furniture-sets` 6、`furnishing-select` 6、`stairs` 6 | agent-proposal / brief-agent / event-layout-agent / 室内放置 |

结论不变：只能按 `M3 → R2 → R3 → R4` 整组卸，零散删除必断链。

## 6. 本轮删除与门禁

**第一轮删除（提交 `74b6494d`，4 文件 / −169 行）**：
`frontend/components/ui/card.tsx`、`input.tsx`、`label.tsx`、`select.tsx`。

**第二轮删除（owner 口径：无源码消费者、不影响现状）**：
- 5 个未挂载组件：`components/room-organizer/components/outdoor-view-switch.tsx`、`panels/library-chat.tsx`、`panels/scene-chat.tsx`、`panels/plan-candidate-list.tsx`、`panels/plan-candidate-card.tsx`。
- 孤儿样式：`workbench-shelf.css` 的 `.sc-library-chat*`（保留 `.sc-library-chat-choices`，`material-create-cell` 仍在用）、`space-browser.css` 的 `.sc-scene-chat*`；两处引用这些组件的陈旧注释同步改写。
- 无消费者依赖：`frontend/package.json` 去掉 `@radix-ui/react-label`、`@radix-ui/react-select`，`package-lock.json` 由 `npm install --package-lock-only` 重新生成（−675 行）；`@radix-ui/react-slot` 仍被 `ui/button.tsx` 使用，保留。

| 门禁 | 第一轮 | 第二轮 |
| --- | --- | --- |
| `npm run typecheck`（`tsc --noEmit`） | exit 0 | exit 0 |
| `npm run test`（`vitest run`，654 文件） | 111 失败 / 543 通过（基线 109 / 545） | **109 失败 / 545 通过**（与基线一致，1706 vs 1707 用例为抖动） |
| `npm run build`（package-pages + `next build` + oneplan 校验） | exit 0 | exit 0 |

**测试差异归因（既有抖动，非本轮引入）**：
- 仅删除后失败：`share.test.ts`、`agent-preset-flow.test.ts`、`structure-satellite.test.ts`；仅基线失败：`plan-traffic-layer.test.ts`。
- 四者均为 3.6–5.5 秒级时序敏感用例，且都不引用被删文件；在删除态单独复跑 **4/4 全绿**。
- 全量既有失败主因是 Node 26 环境：`localStorage is not available because --localstorage-file was not provided`，与改动前一致，属预存问题，未顺手修。

## 7. 未决与后续

1. `components/ui/button.tsx` 仍被休眠面板 `recovery-entry.tsx` 引用，**不随本批成组删除**；待该面板退役时一并评估。
2. `scene-chat-intent.ts`、`plan-candidate-preview.ts`、`plan-candidate-apply.ts` 现在只剩测试引用；它们是有测试覆盖的纯函数层，按「测试也是消费者」口径保留，等 M5 接线或场景库退役时再定去留。
3. 其余室内残留（three 场景簇、状态/schema 主干、座位/提案链、室内 hooks、立壳面板）全部留待 `M3 → R2 → R3 → R4`；`schema.ts` 类型最后删。
4. 若确认 `scene-chat-intent` / `plan-candidate-preview` 也不再用，可连同各自测试一起删，属下一轮候选。

## 8. 复现命令

```powershell
$env:Path = "C:\Program Files\Git\cmd;$env:Path"
git rev-parse --short origin/main            # 期望 3e376b41
git worktree add .worktrees/ui-primitives-cleanup -b chore/remove-unused-ui-primitives origin/main
# frontend/ 下
npm run typecheck
npm run test
npm run build
```
