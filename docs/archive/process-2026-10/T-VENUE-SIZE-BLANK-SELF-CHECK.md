# T-VENUE-SIZE-BLANK — 自检

日期：2026-10-27 · 开发服务器 `http://127.0.0.1:3026/editor` · 未 commit / push / 部署

## A 空地

- [x] 底栏 → 场景模板 → **第一张**「空白场地」
  - 真机：`.sc-preset-rail` 第一张卡文本为「空白场地」，缩略位写着 `12 × 8 m · 可改尺寸`，其后再排 10 个模板。
- [x] 点后无 GLB 模板壳；角标 `12 × 8 m`；简报有米数；`scenePreset` 空
  - 真机读数：角标 `12 × 8 m`；简报 `场地 室内 · 12 × 8 m · 96 m²`；物料 `还没排`；底栏提示「已换成可改尺寸的空白场地…」。
  - 自动存档里 `scenePreset: null`、`width: 12`、`height: 8`、`backendSceneV2` 有值、模板 GLB 件数 0；3D 画面是矩形空壳 + 门洞。
- [x] 对话「改成 15×10」→ 壳/角标/简报都变
  - 真机读数：角标 `15 × 10 m`；简报 `室内 · 15 × 10 m · 150 m²`；Agent 播报「场地立起来了：15 × 10 m…」。
  - 自动存档 `width: 15`、`height: 10`、`backendSceneV2` 有值，`scenePreset` 仍为空。

## B 有模板改尺寸

- [x] 载入任一模板 → 角标 **模板名 + 米数**；简报场地有数（不再「尺寸还没定」）
  - 真机载入「青序 · 香氛快闪」后角标 `青序 · 香氛快闪 · 12 × 8 m`；简报 `室内 · 12 × 8 m · 96 m²`，不再出现「尺寸还没定」。
- [x] 对话「改成 20×12」→ GLB 消失、立 20×12 壳；角标/简报同步；有一句说明
  - 真机读数：角标 `20 × 12 m`；简报 `室内 · 20 × 12 m · 240 m²`；Agent 播报「已离开模板，按新尺寸 20 × 12 m 立了一块矩形空壳，可以继续布置。」
  - 自动存档 `scenePreset: null`、`width: 20`、`height: 12`、`backendSceneV2` 有值、模板 GLB 件数 0；底栏提示同步成「已离开模板，现在按新尺寸立的是矩形空壳。」
- [x] 撤销可回模板态
  - 真机点「撤销」后角标回到 `青序 · 香氛快闪 · 12 × 8 m`；简报回到 `室内 · 12 × 8 m · 96 m²`、42 件模板物件；自动存档 `scenePreset: "popup"`、`width: 12`、`height: 8`；底栏提示回到「已载入青序 · 香氛快闪…」。

## C 回归

- [x] 无模板说「40 人 12×9」仍预览→确认
  - 真机：逐帧生成时只有进度卡、无绿钮；落稳后右侧只有一颗绿钮「确认布置」，卡上写 `座位 16 / 40 · 还差 24`；确认后角标 `12 × 9 m`、简报 `40 人 · 室内 · 12 × 9 m · 108 m²`、21 件物料。
- [x] 相关测试绿
  - 定向：`agent-proposal.test.ts`、`scene-presets-panel.react.test.tsx`、`agent-panel.react.test.tsx` → **50 passed / 50**。
  - 全量：`npx vitest run --maxWorkers=2` → **3665 passed / 3 failed (3668)**；3 条失败均为本轮之前的已知债，数量与基线一致（基线 3658 通过 + 本轮新增 7 条）：
    - `lib/backend-generation.test.ts` › rejects late previews after releasing the lease and opening another project
    - `lib/project-review.test.ts` › 30-person rehearsal review example › matches an actual offline HTML…
    - `components/room-organizer/three/scene-presets.test.ts` › editable scene archives › opens every gym fixture…

## 静态检查

- `npx tsc --noEmit`：0 error。
- `npx eslint`（改动的 7 个文件）：0 error；仅有仓库既有的 import/order、exhaustive-deps 与 `<img>` 警告。

## 实现要点

- 模板改尺寸走新增的 `replaceVenueWithShell`：卸掉 `scenePreset` 与模板 GLB 物件，按新米数 `buildVenueShell`；放得下的自有物料保留，放不下的散件撤掉并报数，锁着又压墙的直说原因。
- 空白场地卡用同一套壳体生成（12×8 m，无模板 GLB），有现存布置时先在卡内确认再替换；活动需求与任务记录照旧保留。
- 载入模板/空壳后，右栏 `lengthRaw/widthRaw` 跟随场地真实米数（`typed`），简报不再把模板场地报成「尺寸还没定」。
- 角标永远是 `模板名 · L×W m` 或 `L×W m`；明细里不再写「概念场馆」，统一报面积。

## 改动文件

- `frontend/components/room-organizer/panels/scene-presets-panel.tsx`
- `frontend/components/room-organizer/panels/workbench-shelf.css`
- `frontend/components/room-organizer/lib/agent-proposal.ts`
- `frontend/components/room-organizer/panels/agent-panel.tsx`
- `frontend/components/room-organizer/room-organizer.tsx`
- `frontend/components/room-organizer/lib/agent-proposal.test.ts`
- `frontend/components/room-organizer/panels/scene-presets-panel.react.test.tsx`
- `frontend/components/room-organizer/panels/agent-panel.react.test.tsx`

## 未做（按卡 Out）

- GLB 等比缩放 / 3DGS / 真模型
- 多形状空地（仅矩形）
- commit / push / 部署
