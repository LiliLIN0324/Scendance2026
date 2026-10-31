# T-VENUE-SIZE-BLANK — 场地尺寸跟改 + 空白场地入口

> 给 **Qoder**。真相源：`docs/VENUE-SIZE-AND-BLANK-ENTRY-2026-10-27.md`  
> **先跑通逻辑，不做 GLB 缩放 / 真模型。** 做完停，等验收；未点名不 commit。

## 钉死语义

GLB 模板 = 固定概念场馆外壳。要改布置用边界米数 → **卸模板、立可伸缩矩形壳**。禁止假装把体育馆 GLB 拉成 12×9。

## In（改这些）

1. `panels/scene-presets-panel.tsx` — 场景模板轨**最左**加「空白场地」卡（矩形，默认示意 12×8 m · 可改尺寸）
2. `lib/agent-proposal.ts` — 有 `scenePreset` 时改尺寸 → 卸模板再 `buildVenueShell`（或 `replacePresetWithShell`）；保留放得下的物料
3. `panels/agent-panel.tsx` — `runLocal` 走新路径；载入模板时写入 `lengthRaw/widthRaw`；播报「已离开模板、按新尺寸立壳」
4. `room-organizer.tsx` — 角标：`模板名 · L×W m`（有模板也显示米数）
5. 可选：精简 `createBlankVenue` 放 `venue-shell.ts`；相关 vitest

## Out（不做）

- GLB 等比缩放 / 3DGS / 牛逼模型  
- 一次恢复正方形·L 形多形状（矩形空地卡即可）  
- 破坏 T-UI：空闲零绿、左轨三图标  
- commit / push（除非用户另点）

## 验收

**A 空地**
1. 底栏 → 场景模板 → **第一张**「空白场地」
2. 点后无 GLB 模板壳；角标 `12 × 8 m`（或默认）；简报有米数；`scenePreset` 空
3. 对话「改成 15×10」→ 壳/角标/简报都变

**B 有模板改尺寸**
1. 载入任一模板 → 角标 **模板名 + 米数**；简报场地有数（不再「尺寸还没定」）
2. 对话「改成 20×12」→ GLB 消失、立 20×12 壳；角标/简报同步；有一句说明
3. 撤销可回模板态

**C 回归**：无模板说「40 人 12×9」仍预览→确认；相关测试绿。

## 自检

做完在 `docs/T-VENUE-SIZE-BLANK-SELF-CHECK.md` 勾 A/B/C，停。
