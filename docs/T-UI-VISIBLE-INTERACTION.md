# T-UI 交互可见改 — 任务卡

> 卡号：**T-UI**（给 Qoder 执行的可见交互大砍）
> 用户点名：2026-10-26。T-01–T-04 落地后截图仍像经典表单：左栏六 Tab（活动安排/物料工作单/制作计划/数量点验/导出/本机备份）、右栏常驻绿钮「导出给搭建方」、抬头「交付 4/4」进度条，聊天只剩侧栏。**本卡目标是肉眼可见的交互翻盘，不是再补一份隐形能力。**
> 依赖：T-01～T-04 已有对话 / 预览 / 确认链路可复用；本卡不重开前四卡算法范围。
> 产品钉：chat-first；左轨永远只有布置 / 评审 / 执行三图标（永不第四）；空闲态零绿主钮；提案态只留一颗「确认布置」；晴光 3D 毛绒头像；无 3dgs；本卡不接真 AI（mock 大脑 OK，演示条必留）；未点名不 commit / push / 部署。

---

## 1. 一句话目标

把 `/editor` 从「表单工作台 + 侧栏聊天」改成**看得见的 chat-first**：左轨三图标只切对话上下文；左栏变成跟聊天同步的活动简报；右栏空闲零绿钮、去掉「交付 4/4」向导感；导出/布置一律「意图 → 预览卡 → 一颗确认」；修掉画布 Undo 后右栏仍停在 `planReady` 的同步洞。**不改生成算法、不接真模型、不动 14 键、不碰氛围/3dgs。**

---

## 2. In（本卡只改这些路径）

开卡前已对仓库核对：六 Tab 在 `scene-delivery-panel.tsx`；常驻绿「导出给搭建方」与 `n/4` 进度在 `agent-panel.tsx`；左轨三模式在 `room-organizer.tsx` + `workbench-mode.ts`；「确认应用」与 `directApply` 在 `creative-studio.tsx`；T-03 自检已记 Undo→`planReady` 不同步。

| 路径 | 改动 |
|---|---|
| `frontend/components/room-organizer/room-organizer.tsx` | AI-native 下：左轨三图标只切 `workbenchMode` / 对话上下文，**禁止**因切评审/执行而把左栏换成六 Tab 整页表单；左栏默认改为「活动简报」（名称 / 人数 / 场地尺寸），数字从 Agent 对话 recap 同步，不要求人再填一遍表单。左轨图标数保持 3。 |
| `frontend/components/room-organizer/lib/workbench-mode.ts` | 仅在文案/hint 需要时微调；**不**增加第四 mode；标签可贴近「布置 / 评审 / 执行」口语，但图标仍三枚。 |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | ① 隐藏或弱化抬头 `n/4` + `STAGES` 向导进度（用户感知「交付 4/4」）；② **空闲态**去掉所有 `btn-primary` 绿主钮（含常驻「导出给搭建方」「下一步：给甲方看」「准备客户评审」等常驻绿入口）；③ 导出/交接走对话意图 → 预览卡 → 唯一确认钮（布置统一「确认布置」，导出统一「确认导出」——**禁止**第二颗「确认应用」）；④ 画布工具栏 Undo 后必须清掉 `planReady` / 预览卡 / 提案态（修 T-03 §6 已知缺口）；⑤ 演示条文案保持「演示环境 · 方案由本机规则生成…」。 |
| `frontend/components/room-organizer/panels/agent-panel.css` | 只补简报条、隐藏进度条、空闲态无绿钮所需样式；不改 14 键、不改左轨尺寸体系、不换 logo。 |
| `frontend/components/room-organizer/panels/agent-panel.react.test.tsx` | 新增/更新：空闲无绿主钮；无六 Tab；导出意图→预览→一颗「确认导出」；Undo 后 `planReady`/预览卡清空；演示条仍在；左轨仍三 mode。 |
| `frontend/components/room-organizer/panels/creative-studio.tsx` | 剩余「确认应用」文案一律改「确认布置」；`directApply` 默认保持 `false`；「明确指令直接应用」开关隐藏或深埋（演示路径点不到轻易直应用）。 |
| `frontend/components/room-organizer/panels/creative-studio.react.test.tsx` | 断言按钮名「确认布置」；默认非 directApply；设置里不再轻易暴露直应用（或隐藏后旧路径测不通则改测「找不到该开关」）。 |
| `frontend/components/room-organizer/panels/scene-delivery-panel.tsx` | AI-native 编辑器主路径下**不再**以左栏六 Tab（活动安排 / 物料工作单 / 制作计划 / 数量点验 / 导出 / 本机备份）作为默认壳；导出能力保留，但入口改为对话意图 + 预览确认，或深埋到「工具」而非左栏主舞台。不删导出实现本身。 |
| `frontend/components/room-organizer/panels/scene-delivery-panel.css` | 仅配合「主路径隐藏六 Tab」的必要样式；不重做导出页视觉。 |
| `frontend/components/room-organizer/lib/workbench-agent.ts` + `.test.ts` | 如需：补「导出 / 给搭建方 / 出交接」等意图识别，落到预览卡而非直接打开六 Tab；不改布置生成算法。 |
| `docs/T-UI-SELF-CHECK.md` | 新增：验收 checkbox + 真机前后截图说明 + 待核 |
| `CHANGELOG.md` | 追加 T-UI 一条 |

若实现时发现左栏简报状态必须经 `lib/agent-proposal.ts` 或 Agent context 透传，可**最小增量**加可选字段，并在自检「待核」写明；禁止借机重写生成器。

---

## 3. Out（明确不做）

- **T-mood / 氛围**：mood / 天气 / Bloom / 室内雨 / bake / NPC —— 零氛围码。
- **3dgs / splat / 重建供应商对接**：不碰 `3dgs-demo`、不接重建流水线。
- **真 LLM / 新 API Key / 去演示条**：mock 大脑可留，**演示环境条必须保留**；禁止假装已接真模型。
- **14 键工具列**：不增不减不挪位置；座位数算法（40→16 等）挂下轮。
- **西湖样例 / mujing-universe / 新页面 / 新站点**：不做。
- **commit / push / 部署 / 擅自开 PR**：未另点名一律不做；合入只由人。
- **重做 T-01～T-04 算法**：布置生成、体检几何、评审 HTML/云链能力不借本卡重写；只改「看得见的壳与入口」。
- **左轨第四图标**：禁止。
- **空闲态第二颗绿钮或「确认应用」并存**：禁止。

---

## 4. 交互钉

1. **左轨永远三图标**：布置 / 评审 / 执行（对应 `layout` / `review` / `delivery`）。切换**只**改聊天上下文与 Agent 模式，**不得**把主舞台换成带六 Tab 的整页表单。六 Tab 条（活动安排、物料工作单、制作计划、数量点验、导出、本机备份）在 AI-native 主路径须杀掉或隐藏。
2. **左栏 = 活简报**：展示名称、人数、场地尺寸（及对话已收集的同类字段）；人在聊天里说「80 人」「12×9」后，左栏数字更新，**不必**再去表单重填。
3. **右栏空闲零绿主钮**：没有提案/预览时，禁止常驻「导出给搭建方」「下一步：给甲方看」等大绿 `btn-primary`。抬头「交付 4/4」类进度条隐藏或改成不制造向导感的轻提示（优先隐藏）。
4. **提案/导出确认唯一主钮**：布置预览主钮文案统一 **「确认布置」**；导出预览主钮统一 **「确认导出」**；全屏同时只允许一颗绿主钮。禁止再出现第二颗「确认应用」。
5. **导出路径**：人说「导出给搭建方 / 出交接 / 导出物料」→ 右栏出预览卡（说明导什么、仍是本机）→ 点「确认导出」才触发既有导出；不是空闲就挂着绿钮。
6. **creative-studio**：「确认应用」→「确认布置」；`directApply` 默认 `false`；直应用开关隐藏或深埋，演示点不到。
7. **Undo 同步（必修）**：画布工具栏「撤销」后，右栏必须离开 `planReady` / 清掉预览卡与提案态，与画布一致（补 T-03-SELF-CHECK §6.1）。
8. **演示条**：保留「演示环境 · 方案由本机规则生成，未连接真实 AI 模型」（或等价，不得弱化「未接真模型」语义）。
9. **晴光**：继续用现有 3D 毛绒切图路径；不换扁平/Bingo；本卡不重做头像资产，只保证不被进度条/绿钮抢走注意力。

---

## 5. 验收 checkbox（PASS/FAIL）

必须能截图前后对比：

- [ ] **空闲右栏无绿导出钮**：`/editor` 空闲态看不到常驻大绿「导出给搭建方」；也无第二颗常驻绿主钮。
- [ ] **左栏无六 Tab**：主路径看不到「活动安排 / 物料工作单 / 制作计划 / 数量点验 / 导出 / 本机备份」Tab 条；左轨仍只有三枚流程图标。
- [ ] **左栏简报跟聊天**：在对话说人数/尺寸后，左栏简报出现对应数字，无需表单重填。
- [ ] **导出意图 → 预览 → 一确认**：说导出相关意图后出现预览卡，再点唯一「确认导出」；过程中没有「确认应用」第二钮。
- [ ] **布置确认文案统一**：提案预览主钮为「确认布置」（creative-studio 残留「确认应用」已改名）。
- [ ] **Undo 清右栏**：确认布置后点画布工具栏撤销 → 画布回退且右栏 `planReady`/预览卡同步清空。
- [ ] **演示条仍在**：可见「演示环境 · 方案由本机规则生成…」。
- [ ] **Out 未破**：无 mood/3dgs/真 LLM/14 键改动/第四左轨图标；未 commit/push/部署。
- [ ] 本卡相关 vitest 全绿；`npx tsc --noEmit` 干净；改动文件 eslint 0 error。
- [ ] 真机证据写入 `docs/T-UI-SELF-CHECK.md`（含空闲右栏、左栏无六 Tab、导出意图、Undo 同步的前后说明或截图路径）。

---

## 6. 自测命令

```bash
cd frontend
npx vitest run components/room-organizer/panels/agent-panel.react.test.tsx \
  components/room-organizer/panels/creative-studio.react.test.tsx \
  components/room-organizer/lib/workbench-agent.test.ts \
  components/room-organizer/lib/workbench-mode.test.ts
npx tsc --noEmit
npx eslint components/room-organizer/room-organizer.tsx \
  components/room-organizer/lib/workbench-mode.ts \
  components/room-organizer/lib/workbench-agent.ts \
  components/room-organizer/panels/agent-panel.tsx \
  components/room-organizer/panels/agent-panel.react.test.tsx \
  components/room-organizer/panels/creative-studio.tsx \
  components/room-organizer/panels/creative-studio.react.test.tsx \
  components/room-organizer/panels/scene-delivery-panel.tsx
```

真机：`127.0.0.1:3026/editor` —— 先截空闲右栏+左栏 → 聊天改人数看左简报 → 说导出看预览与一确认 → 布置确认后工具栏撤销看右栏是否清空。

---

## 7. 停手规则

- 只改 §2 列出的路径；蓝图与代码不符就停手标「待核」，**不静默扩 scope**。
- 工作树若已有未提交改动：本卡**不 commit、不 push、不部署、不开 PR**；合入只由人另点名。
- 不做氛围、不做 3dgs、不接真模型、不改 14 键、不加左轨第四图标。
- 做完先按 §5 自测，结果写入 `docs/T-UI-SELF-CHECK.md`，再向用户报告并停等验收——**不要**自行开下一张卡。

版本 2026-10-26 · 用户要求可见交互翻盘后开卡 · 实现 AI（Qoder）只改本卡 In 列表。
