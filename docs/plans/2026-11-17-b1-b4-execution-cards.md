# B1–B4 执行卡（G2 壳体解耦）

> 计划基线：main `e0e1cdf8`（2026-11-17）。开工前先 `git fetch && git rebase origin/main`，文中行号/函数位置均为参考值，以届时 `origin/main` 为准。
> 来源：`2026-11-17-decouple-execution-plan.md §3`。本文件只拆执行卡，不改决策口径、不写实现代码。
> 硬门槛：#79 V1–V5 真机 flow 稳定；B3 额外等 C5 拍板（推荐 A：复用本地 capability + 项目级 lease）。B1/B2 不等 C1/C4。
> 分派：一卡一 worktree/分支，严格按 B1 → B2 → B3 → B4 串行；后一卡从前一卡合入后的 main 切，不叠分支。

## 0. 每张卡通用的开工/交付门禁

- [ ] Node 版本档：v26.2.0；vitest 4.1.12；Node 22 禁止跑全量/build；24 与 26 不混跑。
- [ ] 已 rebase 到最新 `origin/main`，并记录开工 SHA。
- [ ] 冻结面未破：routeBridge 九方法签名、`SitePlanData` 既有字段、`OutdoorTaskProgress` 结构、物料生成链路入参不变。
- [ ] 未碰并行在途线（people/漫游、`scendance-workspace` 系列），未回灌、未 revert 他人提交。
- [ ] `tsc --noEmit` exit 0；相关定向 vitest 全绿；`npm run build` exit 0。
- [ ] 全量 vitest 与最新锚点台账对照：台账外新失败文件、或台账内 failed 数上涨，先单独复跑，仍失败才算回归。
- [ ] 涉及交互的卡已做真机 flow 走查（不只跑测试）。
- [ ] 提交前 `git diff --cached --name-only` 与 `git show --stat HEAD` 双核对，不夹带他人在途文件。
- [ ] 回滚路径已确认：影子双写/旧调用适配器在验收前保留。

> 台账注意：现有台账锚在 `0a59f7b0`，main 已前进。若开工时 main 与台账锚点差距较大，先按最新 main 重采一份台账，或只比较「失败文件集合 + 单文件 failed 数」，不要把绝对失败数直接对照旧锚点。

## 1. 卡间顺序

| 卡 | task | 依赖 | 可开始条件 |
| --- | --- | --- | --- |
| B1 | #48 3a 会话 scope | #79 flow 稳定 | #79 通过；B1 预检完成 |
| B2 | #49 3b 历史换 plan | B1 合入 | B1 验收并合 main |
| B3 | #50 3c 导出/守卫 | B2 + C5 拍板 | C5=A 并明确 lease 口径 |
| B4 | #51 3d 镜像退役 | B1–B3 | B3 验收并合 main |

---

## 卡 B1 · 3a 会话 scope 残留收尾

- **task**：#48
- **状态**：☐ 待开工　☐ 预检　☐ 实现　☐ 验收　☐ 合入
- **分支建议**：`feat/g2-b1-session-scope`
- **依赖**：#79 V1–V5 真机 flow 稳定（B1 不依赖 C1/C4）。

### 预检

- [ ] 重对 `room-organizer.tsx`：主 `sessionScope` 当前仍是 `projectSessionScope(layout.id ?? outdoorProjectIdProp)`（约 :355）。
- [ ] 重对同口径 `getStoreSessionScope`（约 :422），确认两处必须同批改。
- [ ] 重对 `activityScopeSource`（约 :364）已注入 project 源，确认 tracker 不再回读 layout。
- [ ] 重对 #128 触碰面：`room-organizer.tsx` / `creative-studio.tsx` / `space-panel.tsx` / `scendance-workspace.tsx` / `workspace-shell.tsx`，scope 拼接点以届时 main 为准。
- [ ] 列出当前所有 `activity:` 键的写入/读取点，确认归属域后再改。

### 范围（只做这些）

- [ ] 主 `sessionScope` 去掉 `layout.id` 回退，纯走 `projectSessionScope(projectId)`；projectId 来源按届时壳体现状确定，不新增第二套 scope。
- [ ] `getStoreSessionScope` 同口径，避免面板与画布各算一套。
- [ ] floor / venue tracker 订阅源从 layoutStore 重绑到 `plan.levels` / 边界几何；tracker 的 scope 源与主 scope 同源。
- [ ] `activity:` 键按域归位：`creative-studio` chatScope、`bingo-audit-card` scopeKey、`venue-facts-panel` / `space-panel` venueFactScope、`floor-session-epoch` scope、`scene-delivery-panel` note scope、环境偏好键、评审链接 identity scope。

### 不成套拆（必须同批）

- [ ] activity tracker scope 源、壳体 scope 拼接、agent-panel 的 scope 比对三者同批改；拆一半会让 `isCurrent` 与 scope 比对失败，提案/导出/拖拽一起失效。

### 不做

- 不删 layoutStore、不删室内墙模型（R 线）。
- 不换历史快照（B2）。
- 不做导出/写守卫 plan 化（B3）。
- 不删 `legacySessionScope` 历史承接；旧草稿会话不回读属可接受过渡态，留到后续退役。

### 验收

- [ ] 切项目不串会话；同一项目刷新/恢复草稿后 session 仍连续。
- [ ] 定向测试：`project-session-scope`、`agent-panel`、activity/project/floor/venue/assistant-active 相关用例全绿。
- [ ] `tsc` / `build` / 全量台账对照通过；无新增失败文件。
- [ ] 真机：切项目、刷新、恢复草稿、打开 agent 面板各走一遍。
- [ ] 回滚：layoutStore 影子双写保留；异常时可回退读 layout 投影。

### 交付记录

- [ ] 开工 SHA：__________　合入 SHA：__________
- [ ] 测试日志路径：__________
- [ ] 未做/遗留：__________

---

## 卡 B2 · 3b 历史快照换 plan

- **task**：#49
- **状态**：☐ 待开工　☐ 预检　☐ 实现　☐ 验收　☐ 合入
- **分支建议**：`feat/g2-b2-history-plan`
- **依赖**：B1 已验收并合入 main。

### 预检

- [ ] 重对 `useHistory(layout, …)` 调用点（约 :1702）与 `commitHistoryNow` 全部调用点（约 :1820 / :1885 / :1903，后续以 grep 为准）。
- [ ] 确认 `plan-history.ts` 的栈/上限 30/规范化序列化去重口径可直接复用；`useHistory` 泛型 `<T>` 无需改。
- [ ] 确认 `commitPlan` / overlay 回写通路是唯一 plan 正源，不在历史层再写 layout。
- [ ] 列出所有依赖 `actions.applyLayout` 的历史回滚路径。

### 范围（只做这些）

- [ ] 历史快照对象从 `RoomLayout` 换 `SitePlanData`；`useHistory` 的调用点换类型，不改纯函数层。
- [ ] `commitHistoryNow` 散布的物料增删/选中/墙操作改挂 plan 历史。
- [ ] undo/redo 的 apply 回写 plan（经 overlay/`commitPlan`），不再 `actions.applyLayout`。
- [ ] 切项目/切活动时历史栈隔离或清空，避免跨项目撤销。

### 不做

- 不删 RoomLayout 类型与 layoutStore（R 线）。
- 不改导出/写守卫（B3）。
- 不删镜像回写（B4）。
- 不把 3D 特化字段塞进历史快照（按 C3 推荐 A 留 3D 层）。

### 验收

- [ ] 撤销/重做只改 plan，不改 layout 副本。
- [ ] 物料增删、墙体操作、选中态切换均可正确 Undo/Redo；Undo/Redo 可用状态上报不回归。
- [ ] 切项目后不会撤销到上一个项目的快照。
- [ ] 定向测试全绿；`tsc` / `build` / 全量台账对照通过。
- [ ] 真机：连续编辑 10 步以上、Undo/Redo 混合、切项目再回来。
- [ ] 回滚：保留旧 layout 历史适配器到验收；必要时 revert 单个切片。

### 交付记录

- [ ] 开工 SHA：__________　合入 SHA：__________
- [ ] 测试日志路径：__________
- [ ] 未做/遗留：__________

---

## 卡 B3 · 3c 导出与写守卫 plan 化

- **task**：#50
- **状态**：☐ 待开工　☐ 预检　☐ 实现　☐ 验收　☐ 合入
- **分支建议**：`feat/g2-b3-export-guard`
- **依赖**：B2 已合入 + **C5 已拍板且为 A**（复用本地 capability + 项目级 lease，plan 落盘加 revision 检查）。C5 未定则本卡不开工。

### 预检

- [ ] 确认 C5 口径已写入文档，且 lease 字段（projectId/sessionId/generation/revision/expiresAt）可用。
- [ ] 重对 `assertLayoutWrite` 的全部调用点，区分「保存」与「历史回放/预览」。
- [ ] 重对导出入口：plan 级 CSV/GeoJSON/PNG/PDF；`plan-export/dxf|svg` 是 layout 级，不在本卡消费。
- [ ] 确认 plan 导出已有测试与夹具，避免只测布局级旧导出。

### 范围（只做这些）

- [ ] CSV / GeoJSON / PNG / PDF 全量消费 `SitePlanData` 快照；导出内容与 plan 当前快照一致。
- [ ] `assertLayoutWrite` → plan 写权限：本地 capability + 项目级 lease + plan revision 检查；拒绝过期/被撤销的写。
- [ ] 环境 / 场地核对前置改为地图语境；不再以 RoomLayout 的室内字段作为前置。
- [ ] 保留旧 layout 导出路径到验收，作为回滚；验收后由 B4/R 线统一退役。

### 不做

- 不新建 plan 级 DXF/SVG（关卡 D）。
- 不改 `SitePlanData` 既有字段；不新增 plan 租约类型（C5=A）。
- 不动画布墙体渲染（关卡 C）。
- 不删 layoutStore（R 线）。

### 验收

- [ ] 导出定向测试：CSV/GeoJSON/PNG/PDF 内容与 plan 快照一致；图例墙体组随之出现。
- [ ] 写守卫测试：无 capability、lease 过期、revision 变化、session 切换均被拒绝；正常写可通过。
- [ ] 导出/保存不读 layout 正源；grep 无本卡新增的 layout 读取。
- [ ] `tsc` / `build` / 全量台账对照通过；真机导出 + 保存各走一遍。
- [ ] 回滚：旧导出路径与旧守卫适配器保留到验收；异常可单点回退。

### 交付记录

- [ ] 开工 SHA：__________　合入 SHA：__________
- [ ] C5 拍板记录：__________
- [ ] 测试日志路径：__________
- [ ] 未做/遗留：__________

---

## 卡 B4 · 3d 回写镜像退役

- **task**：#51
- **状态**：☐ 待开工　☐ 预检　☐ 实现　☐ 验收　☐ 合入
- **分支建议**：`feat/g2-b4-mirror-retire`
- **依赖**：B1–B3 全部验收并合入 main。

### 预检

- [ ] 重对 `handleOutdoorPlanChange` 的 false 侧 layout patch 与 `shellVenuePatchFromPlanBoundary` 调用点。
- [ ] 重对 `applyOutdoorGroundBasemap` 对 layout 的 `floorPlanImage` / `sceneAnchor` 写入。
- [ ] 确认 plan 正源稳定，B1–B3 已无「写 plan 必须回写 layout」的依赖。
- [ ] 列出所有仍读 layout 镜像字段的消费方，逐一确认改挂 plan/视图记忆。

### 范围（只做这些）

- [ ] 删 `handleOutdoorPlanChange` false 侧 layout patch；`shellVenuePatchFromPlanBoundary` 不再参与真侧回写。
- [ ] `applyOutdoorGroundBasemap` 的 `floorPlanImage` / `sceneAnchor` 写入改挂 plan / 视图记忆。
- [ ] 清掉本卡范围内残留的镜像分支与注释；保留 D 层业务字段。

### 不做

- 不删 layoutStore / 室内墙模型（R3）。
- 不删二分概念 `isOutdoorProject`（R4）。
- 不动 people/漫游并行线。

### 验收

- [ ] plan ↔ layout 镜像字段无漂移；grep 无本卡应删的回写分支。
- [ ] 地面底图 / 场景锚点写入落 plan 或视图记忆，不再写 layout。
- [ ] `tsc` / `build` / 全量台账对照通过；真机切换底图、移动场地、保存后重开。
- [ ] 回滚：影子双写保留；异常可恢复旧 patch 单点回退。

### 交付记录

- [ ] 开工 SHA：__________　合入 SHA：__________
- [ ] 测试日志路径：__________
- [ ] 未做/遗留：__________

---

## 2. 卡外事项（不在 B1–B4 开工范围）

- C 线（画布消费 `plan.walls`、PNG/PDF 图面墙线）等 B 线壳体接线完成后另拆卡。
- D 线（plan 级 DXF/SVG）是新功能，独立排期。
- E 线（R1–R4）必须等 B 线全部完成，顺序不可颠倒。
- §C 的 C1/C4/C3/C2/C6 未拍板前，不改对应字段/加载链路/预设。
- #12 基线债修复与工程卫生留到验收后一次清。
