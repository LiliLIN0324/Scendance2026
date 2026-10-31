# 场地尺寸不跟着改 + 空地入口找不到 — 可跑通方案

> 日期：2026-10-27（Asia/Shanghai）  
> 来源：用户（Scendance）反馈 —「有模板时尺寸不会跟着改；默认空地入口被藏，找不到」  
> 约束：**先跑通逻辑，不管牛逼模型**；本文只出方案，**不改产品代码、不 commit**。  
> 建议下一执行卡：**Qoder**

---

## 0. 结论（先看这）

| # | 现象 | 根因（一条） | 推荐最小改法 |
|---|---|---|---|
| 1 | 有模板时尺寸不会跟着改 | 载入 `scenePreset` 后，壳体/画布/简报把「模板」当成固定场馆：`raiseVenue` 直接 return null；3D 只挂 GLB 结构不按 `width/height` 重建；角标只显示模板名、不显示米数；Agent 卡片 `lengthRaw/widthRaw` 也不跟模板同步 | 有模板时：改尺寸 → **卸模板、改立矩形空壳**（或明确提示「模板场馆结构固定，要改尺寸请先回空地」）；载入模板时把预设米数写入对话/简报，角标同时显示「模板名 · L×W」 |
| 2 | 默认空地入口找不到 | `VenueShapePresets`（「选择空白场地形状」）在 `9d592b5`（AI-native 面板收口）被整文件删掉；场景模板轨只剩 GLB 预设；CSS 仍写着「空白场地与模板共用轨道」但 UI 已无空地卡。**不是 T-UI 文档故意永久藏入口**，是更早一轮「去表单」误删了规格仍标 **in** 的 `A.venue-blank` | 在「场景模板」轨最前加回一张「空白场地」卡（矩形即可），一点即卸 `scenePreset`、立可改尺寸的壳体 |

---

## 1. 代码定位（读过什么）

### 1.1 模板与尺寸

| 路径 | 作用 |
|---|---|
| `frontend/.../lib/scene-presets.ts` | 各模板名义尺寸（如 popup 12×8、gym 70×76） |
| `frontend/.../three/scene-presets.ts` → `layoutFromPreset` | 载入时 **会** 写入 `width/height/scenePreset` |
| `frontend/.../panels/scene-presets-panel.tsx` | 物料抽屉「场景模板」轨；`onApply(loadScenePreset)` |
| `frontend/.../lib/agent-proposal.ts` → `raiseVenue` | **`if (base.scenePreset \|\| base.backendSceneV2) return null`** —— 有模板就不重搭壳体 |
| `frontend/.../panels/agent-panel.tsx` → `runLocal` | `raiseVenue` 为 null 时只做 `applyLayout({ ...current, width, height })`，数字改了、结构不动 |
| `frontend/.../hooks/use-scene-effects.ts` | `layout.scenePreset` 时 **只** `createPresetStructure`，**不**按 `layout.width/height` 建墙/地板 |
| `frontend/.../room-organizer.tsx` 画布角标 | `scenePreset ? 模板名 : "L × W m"`；详情区写「概念场馆」不写面积 |
| `frontend/.../panels/agent-panel.tsx` → `recap.dims` / `ActivityBrief` | 尺寸文案来自对话 `lengthRaw/widthRaw` 或 `venueUp`；**载入模板不会填 raw，且 `venueUp` 不认 `scenePreset`** → 简报常仍是「尺寸还没定」 |

### 1.2 空地入口

| 路径 | 作用 |
|---|---|
| ~~`panels/venue-shape-presets.tsx`~~ | **已删**（commit `9d592b5`）。原有长方形/正方形/L 形「空白场地」按钮 + `createVenueShape` |
| 旧 `scene-presets-panel.tsx`（`e647c80`） | 顶部曾挂 `<VenueShapePresets/>`，再下列 GLB 模板 |
| 现 `scene-presets-panel.tsx` | **只** map `SCENE_PRESETS`，无空地卡 |
| `panels/workbench-shelf.css` ~404 | 注释仍写「空白场地与模板共用同一条横向轨道」——注释过期 |
| `docs/AI-NATIVE-MODULES.md` | `A.venue-blank` = **in**（空白进场须可出方案） |
| `docs/AI-NATIVE-FOR-EXECUTORS.md` §3A | 本期 in：**空白场地**；验收「空白进场 → 预填卡可见 → 可不上传直接出方案」 |
| `docs/T-UI-VISIBLE-INTERACTION.md` / `ACTIVITY-FLOW-…` | 藏的是六 Tab、空闲绿钮、n/4 向导感；**未要求删除空白场地入口** |

对话路径仍能在无 `scenePreset` 时靠说「12×9」走 `raiseVenue` 立壳；但用户要的是**看得见的默认空地入口**，且一旦进了模板就回不去。

---

## 2. 对照文档：是不是故意藏？

| 文档 | 态度 |
|---|---|
| AI-NATIVE / MODULES | **要保留**空白场地（`A.venue-blank` in） |
| T-UI / ACTIVITY-FLOW | 收口表单与绿钮，**未授权**删空地入口 |
| 代码史 | `9d592b5` 为「简化自然语言面板」删掉 venue-shape + 手动尺寸表单；空地入口一并没了 |

→ **属于误删/未补替代入口，不是产品钉「永远不要空地按钮」。** chat-first 可以保留，但需要一张可见的「空白场地」卡（或等价左栏/模板轨入口），逻辑与说「12×9」立壳一致。

---

## 3. 推荐改法（最小、逻辑正确）

### 3.1 问题 1：有模板时尺寸跟着改

**产品语义（钉死一条，避免歧义）：**

> GLB 模板 = 固定概念场馆外壳。要改「布置用边界米数」，必须离开模板、换成可伸缩矩形壳；不允许假装把体育馆 GLB 拉成 12×9。

**实现（推荐，单路径）：**

1. **Agent / 确认尺度**（`runLocal` + 将来任何 `setWidth/setHeight` 入口）：若 `layout.scenePreset` 存在，且新尺度与当前 `width/height` 不同：
   - 先 `raiseVenue` 等价逻辑：**清除 `scenePreset`**，用 `buildVenueShell` + `backendSceneToLayout` 立新壳；
   - 物料：能放下的保留（现有 `raiseVenue` 已有 keep/clear 逻辑），放不下的撤并播报件数；
   - 对话说一句：「模板场馆结构固定，已按你说的 L×W 换成空白壳体，可继续布置。」
2. **载入模板时同步读数**：`ScenePresetsPanel` / `onApplyCreative` 成功后，把 `SCENE_PRESETS[key].width/depth` 写入 Agent 的 `lengthRaw/widthRaw` + `scaleOrigin='typed'`（或等价），让左栏简报与右栏 recap 立刻显示模板米数。
3. **画布角标**：`模板名 · L×W m`（有模板也显示米数）；详情区用 `venueArea` 或 `width*height`，不要只写「概念场馆」。
4. **可选护栏**：Room Settings / 结构面板若在模板态露出改尺寸，同样走「卸模板→立壳」，或 disabled + 文案「先回空白场地」。

**不要做：** 只改 `layout.width/height` 却继续挂原 GLB（现状伪更新）；不要上复杂 GLB 等比缩放（本阶段不碰牛逼模型/观感）。

### 3.2 问题 2：恢复默认空地入口

**实现（推荐，最小）：**

1. 在 `scene-presets-panel.tsx` 的 `sc-preset-rail` **最左侧**加一张固定卡：
   - 文案：**空白场地**
   - 副文：`12 × 8 m · 可改尺寸`（示意，与旧 rectangle 默认一致即可）
2. 点击逻辑（复用旧 `createVenueShape` 的矩形分支，或直接调现成 `buildVenueShell` + `backendSceneToLayout`）：
   - 卸掉 `scenePreset` / 旧 GLB 物件策略与载入模板相同（`preserveCurrentActivity` + 未改动一键 / 已改动二次确认）
   - 得到带 `backendSceneV2` 的空壳（无物料或仅结构标记）
   - 同步 Agent 尺寸 raw = 该壳 L×W
3. 不必一次恢复正方形/L 形；**一张矩形空地卡即可跑通**。L 形可另卡。
4. 改 CSS 注释，去掉「空白已在轨」的谎；若一卡被挤出可视区，保证横滚起始在空白卡。

**入口发现：** 底栏抽屉 →「场景模板」Tab → 第一张「空白场地」。简报/对话可提示：「要空地去场景模板第一张，或直接说 12×9」。

---

## 4. 验收步骤（人肉可跑）

### A. 空地入口

1. 打开 `/editor`，打开底栏物料抽屉 → **场景模板**。
2. **第一张**可见「空白场地」。
3. 点确认后：画布无 GLB 模板壳；角标显示 `12 × 8 m`（或所选默认）；左栏简报场地有米数；`layout.scenePreset` 为空且有可改壳体（`backendSceneV2` 或等价墙）。
4. 对话再说「改成 15×10」→ 壳体与角标、简报米数都变成 15×10。

### B. 有模板时改尺寸

1. 载入任一模板（如「青序 · 香氛快闪」）。
2. 角标出现 **模板名 + 12×8 m**（或该模板名义尺寸）；简报「场地」同步有数，不再「尺寸还没定」。
3. 对话说「改成 20×12」→  
   - 模板 GLB 结构消失；  
   - 立起 20×12 空壳（或保留放得下的物料）；  
   - 角标/简报均为 20×12；  
   - Agent 有一句说明「已离开模板、按新尺寸立壳」。
4. 撤销一步可回到模板态（走现有 `applyLayout` 历史即可）。

### C. 回归（勿破）

1. 无模板时说「40 人，室内 12×9」→ 仍预览→确认布置（T-02 路径）。
2. 空闲右栏仍零绿主钮；左轨仍三图标（T-UI）。
3. 相关 vitest：`scene-presets*`、`agent-panel*`、`agent-proposal*` 相关套件绿；`tsc --noEmit` 干净。

---

## 5. 建议下一卡（给 Qoder）

**卡名建议：** `T-VENUE-SIZE-BLANK`（场地尺寸跟模板 + 空白场地入口）

**In 文件（预计）：**

- `frontend/components/room-organizer/panels/scene-presets-panel.tsx`（+ 空白卡）
- `frontend/components/room-organizer/lib/agent-proposal.ts`（`raiseVenue`：有 `scenePreset` 时改为「卸模板再立壳」，或拆 `replacePresetWithShell`）
- `frontend/components/room-organizer/panels/agent-panel.tsx`（`runLocal` 走新路径；载入模板同步 dims；播报文案）
- `frontend/components/room-organizer/room-organizer.tsx`（角标文案）
- 可选小文件：恢复精简版 `venue-shape-presets.tsx`（仅 rectangle）或把 `createBlankVenue(layout)` 放进 `venue-shell.ts`
- 对应 `*.test.ts(x)` + 本方案验收 checkbox 写入 `docs/T-VENUE-SIZE-BLANK-SELF-CHECK.md`（由执行卡建）

**Out：** 不接真模型；不做 GLB 缩放；不恢复 L 形/多形状；不改 14 键；不 commit/push 除非用户另点名。

**成功标准：** 上节验收 A+B 全过；逻辑先跑通即可。

---

## 6. 给用户的一句话

模板场馆现在是「外壳锁死 + 角标不报米数」，所以你会觉得尺寸不跟着改；空白场地按钮在 AI-native 收表单时被删掉了，规格里其实还要它。下一张卡让 Qoder：模板轨加回「空白场地」，改尺寸则卸模板立壳，角标/简报同步米数。
