# T-VENUE-FEEL 自检 — 场地手感收口（别扭点）

> 日期：2026-10-27 · 环境：`localhost:3000`（Next.js dev）+ mock 后端（localhost:3099，dev@mock.local 自动登录）
> 方法：单测（vitest）+ 真机走查（headless 浏览器，证据为当页快照文本与截图：`%TEMP%\trae\screenshots\scendance-initial.png`、`scenario-b-final.png`）

## 1. 验收清单

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 1. 空白场地：≤1 次显性点击能立 12×8 空壳 | **PASS** | 左栏简报文字链「空白场地 · 12 × 8 m」一次点击立壳；Agent 一句「空白场地立好了：12 × 8 m…」；角标变 12 × 8 m。`agent-panel.tsx` `startBlankVenue`（`sc-brief-blank-link`，L1184） |
| 1b. 简报有米数，无「尺寸还没定」 | **PASS** | 简报场地行「室内 · 12 × 8 m · 96 m²」（点击后）；全文无「尺寸还没定」。场地已立时文字链自动隐藏（`known = agent.venueUp`），不重复打扰 |
| 2. 「改成 15×10」（无模板）：角标/简报变；无布置预览卡、无绿钮、无预览作废黄条 | **PASS** | 角标 15 × 10 m；`gen-progress` 不存在；`.sc-agent-panel .btn-primary` 计数 **0**；全文无「画布改过了」「预览作废」；Agent 恰一句「场地改成 15 × 10 m。」。路径：`isVenueSizeOnly` → `resizeVenueOnly`（提案静默收回，不另发恐吓条，L699-711） |
| 3. 载入青序 →「改成 20×12」：卸模板立壳、一句说明、无恐吓黄条、撤销回青序 | **PASS** | 角标 20 × 12 m；Agent 一句「已离开模板：模板物件已撤，自有物料能留的都留了，按新尺寸 20 × 12 m 立了矩形壳。」；无黄条、无绿钮；撤销后角标恢复「青序 · 香氛快闪 · 12 × 8 m」。说明文案 `presetShellNote`（L644-648）；落盘走 `onApply`（进撤销历史） |
| 4. 回归：「40 人，室内 12×9」仍预览→确认布置 | **PASS** | 出提案卡（`plan-proposal`，「座位 16 / 40」）+ 恰 1 颗绿「确认布置」（`.btn-primary` 计数 1）；与改尺寸路径分离（同句带人数 → `runLocal`，不带 → `resizeVenueOnly`） |

## 2. 三条别扭点的代码落点

1. **仅改尺寸不拉「预览→确认」**：意图识别 `isVenueSizeOnly`（`workbench-agent.ts`，带人数/活动/时段即转 `runLocal`）；`resizeVenueOnly` 只立壳 + 一句 `sizeOnlyNote`，不进生成、不挂提案。
2. **空白场地少绕一层**：简报文字链直连 `startBlankVenue`（与模板轨首卡同一 `createBlankVenue`），不必先开物料库；简报场地行始终给真实米数。
3. **卸模板文案轻量化**：`presetShellNote` 一句说清「模板物件已撤，自有物料能留的都留了」；无第二颗确认；恐吓黄条只在用户手动改画布撞上挂着的提案时出现（改尺寸路径先静默收提案，故不触发）。

## 3. 测试与环境

- `agent-panel.react.test.tsx`（含 T-VENUE-FEEL 分组：「reports template meters…without a proposal」「still previews and asks for confirmation when the sentence also names people」等）+ `scene-presets-panel` + `scendance-workspace` 三套件全绿。
- `npx tsc --noEmit` 退出码 0。
- 真机走查四场景见 §1；撤销回模板态（验收 3 后半）已真机验证。
- 附带确认：`onApply` 收口后壳体落盘进撤销历史（85ed11c），是验收 3「撤销可回模板态」成立的前提。

## 4. 待核（未扩 scope）

1. **载入模板的提示位置**：真机对话里没有「已载入青序」一句——提示在场景模板轨面板的 notice 区（`scene-presets-panel.tsx` L40），这是「不重复播报」的设计选择，不是漏播。若希望载入也在对话里说一句，另开卡。
2. **生成进度瞬态**：回归场景真机未截到「读场地/gen-progress」（本地生成快，轮询粒度没赶上），该项由 T-05 单测「shows only progress while generating」覆盖且绿。
3. ~~**初始简报面积数**：首进默认态简报显示「10 × 8 m · 150 m²」~~ **已定性（2026-10-27 复核）：非代码 bug。** 彻底清空（localStorage + sessionStorage + indexedDB）后初始简报为「室内 · 10 × 8 m」（干净态 `venueUp=false`，面积不显示，只给与角标同源的米数）；此前 150 m² 是 indexedDB 残留的上会话 15×10 draft——hydrate 后 `backendVenue.polygon`（150㎡）与 `layout.width/height`（10×8）异帧，`venueArea()` 走 polygon 分支所致。任一显性场地操作（空白场地/改尺寸/出方案）都会让两源同步。不修。
4. 未 commit / push（按卡片「未点名不 commit」停等验收）。

## 5. 复验（2026-10-27 下午，HEAD 已叠 T-VISUAL-2026 色板与 T-06 图标化收口）

四条验收真机重跑全部 PASS，确认后续改动未回归本卡行为：

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| 1 空白场地文字链 | PASS | 一次点击 →「空白场地立好了：12 × 8 m…」；简报 12 × 8 m · 96 m²。`feel-a-blank.png` |
| 2 只改尺寸不出提案 | PASS | 「改成 15×10」→ 角标/简报 15 × 10 m · 150 m²；无进度、无绿钮（btn-primary=0）、无黄条；恰一句短播报。`feel-b-size.png` |
| 3 青序→20×12 卸模板+撤销 | PASS | 「已离开模板：模板物件已撤，自有物料能留的都留了，按新尺寸 20 × 12 m 立了矩形壳。」；无黄条、无绿钮；撤销回「青序 · 香氛快闪 · 12 × 8 m」。`feel-c-preset.png` / `feel-c-undo.png` |
| 4 回归带人数出提案 | PASS | 「40 人，室内 12×9」→ 提案卡「座位 16 / 40 · 还差 24」+ 恰 1 颗绿「确认布置」。`feel-d-proposal.png` |

截图存 `.scratch/feel-*.png`（本地临时，不入库）。
