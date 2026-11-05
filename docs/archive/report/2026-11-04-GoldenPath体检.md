# 08 · Golden Path 现状体检（2026-11-04）

> 方式：隔离快照（独立 `.next`，端口 3300）真实点击，playwright 走查；只读源码，未改源码、未 commit/push。
> 规格与判定口径见 [07-Golden-Path-规格与验收](file:///07-Golden-Path-规格与验收.md)。
> 差距定义见 [04-结论与路线图](file:///04-结论与路线图.md)、[05-交付能力审计与设计](file:///05-交付能力审计与设计.md)。

---

## 0. 结论先行

**Golden Path 现在断在第 1 步（真实场地入口）和第 2 步（生成只在本机开发环境可用）；能走到第 5 步，但分享出去会丢件或丢真实环境。**

最关键的三个阻碍：

1. **没有「选一个真实场地」的入口**（G3）：空间里只有 1 个「宴会厅 A」；换场地只有空白/云项目；「重建真实场地」是采集流程（≥20 张照片、默认干跑挂样例），不是已有扫描的选用入口。
2. **生成/取回只在本机开发环境可用**（G1）：表单可填，但提交依赖扣额度与本机代理；普通用户/生产构建走不通。
3. **分享链路对真实资产不可靠**（G2 + G5）：未登录不能发布；含本机库件的方案会静默丢件（6 件→5 件），与 Agent 灯混合时直接报「分享链接不完整」；分享页没有 3DGS 环境，也没有物料清单。

纯操作耗时约 **1 分钟**（不含生成）；生成等待按 3–5 分钟计，理论上可进 10 分钟。**但第 1、2、5 步的可用性断点让普通用户走不完，实际是「走不通」，不是「超时」。**

---

## 1. 五步实测

| 步骤 | 状态 | 现象 | 归属模块 | 证据截图（绝对路径） |
|---|---|---|---|---|
| ① 选真实场景/导入扫描 | **半通** | 空间面板场景列表 1 个「宴会厅 A」；「新建/换场地」只有「从空白开始 12×8m」和云项目（需登录）；「重建真实场地」存在，但要求 20 张照片/1 段视频，默认「干跑」，只挂宴会厅样例 | `panels/space-panel.tsx`、`venue-picker.tsx`、`site-capture.ts`、`room-organizer.tsx` | `C:\Users\13266\.dsh\bot\workspace\Scendance2026\.temp\golden-path\shots\v-01-space.png`<br>`…\v-02-venue-swap.png`<br>`…\v-03-recon.png` |
| ② 输入需求生成装置 | **半通** | 「生成物料→通过描述生成物料」表单可达、可填，文案「确认扣额度后才会提交」；**未点生成**（避免消耗真实额度）。生产可用性由代码证据：`isLux3dLocalProxy()` 要求 development + 127/localhost | `material-generate.ts`、`lux3d-import.ts`、`aholo-assets.ts` | `…\v-05-generate.png` |
| ③ 自动进场景并调位置大小 | **半通** | 库件点一下即可加入画布（5→6 件），出现移动/旋转/缩放工具条；**「生成完成自动进画布」无法验证**（无已完成 Lux3D 任务）；无用户可见标定入口 | `online-model-library.tsx`、`layout-reducer.ts`、`use-splat-preview.ts`、`calibration-hud.ts` | `…\v-06-add.png` |
| ④ Agent 改方案 | **半通** | 移动可用且精确：`把共创桌往西挪 2 米` → `Δx=-2.000`，确认后落盘；**缩放错误**：`放大 10%` 后宽 1.2→0.24（0.2×）；**数量错误**：`加两盏暖色灯光` 只新增 1 件，回复「加了 1 件」；提案/确认/撤回机制正常 | `workbench-agent.ts`（`plan.revise`）、`agent-panel.tsx`、`layout-reducer.ts` | `…\v-07-move.png`<br>`…\v-08-scale.png`<br>`…\v-09-light.png`<br>`…\p3-07-scale-proposal.png`<br>`…\p3-08-light-proposal.png` |
| ⑤ 保存并生成可分享方案 | **半通** | 自动保存正常；干净场景可匿名生成只读链接（5 件、0 编辑控件、canvas=1）；未登录发布提示「登录后再发布」；**含库件后分享页只显示 5 件（画布 6 件），静默丢件**；**7 件（库件+Agent 灯）链接报「分享链接不完整或已损坏」**；分享页无真实环境、无物料表 | `share-menu.tsx`、`share-snapshot.ts`、`app/view/page.tsx`、`layout-preview.tsx`、`backend-adapter.ts` | `…\v-12-publish.png`<br>`…\v-13-share-link.png`<br>`…\v-14-view.png`<br>`…\p3-04-view-clean.png`<br>`…\p3-06-view-library.png`<br>`…\p4-02-view-lamp.png` |

### 五步计时（本轮实测）

| 段 | 实测 |
|---|---|
| ① 打开空间 → 看到场景 | ~10 s |
| ② 打开生成表单 → 填写 | ~6 s（未提交） |
| ③ 库件加入画布 → 工具条出现 | ~2 s |
| ④ 移动 + 确认；缩放/灯光各一轮 | ~20 s |
| ⑤ 打开发布 → 生成链接 → 客户页首帧 | ~18 s（首帧 5–12 s 波动） |
| 生成等待（Lux3D） | 3–5 min（文档口径，本轮未提交） |
| **合计（不含生成）** | **约 60–90 s**；加上生成约 4–6 min |

> 以 07 的口径（T0 画布可交互 → T5 客户页首帧），当前「能用」的路径约 4–6 分钟，数值上可进 10 分钟；但第 1/2/5 步不可用，**计时没有意义**。

---

## 2. G1–G7 逐条实测

| 差距 | 状态 | 实测现象 | 证据 |
|---|---|---|---|
| **G1** 生成/取回只在开发环境+本机代理 | **断**（生产） | UI 表单存在且可填；提交需确认扣额度；代码门槛 `NODE_ENV=development` 且 host 为 127/localhost；错误文案仍要求运行 `tools/aholo/lux3d-dev-proxy.mjs` | `…\v-05-generate.png`；[aholo-assets.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/aholo-assets.ts#L7-L15)、[lux3d-import.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/lux3d-import.ts#L94-L97) |
| **G2** 资产只存本机、云保存被拦 | **断** | 未登录点「发布当前版本」→「登录后再发布」；含本机库件的只读分享静默丢件；代码仍有 `LOCAL_ASSET_NOT_UPLOADED` 阻断 | `…\v-12-publish.png`、`…\p3-06-view-library.png`、`…\p3-04-view-clean.png`；[backend-adapter.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/backend-adapter.ts#L170-L172) |
| **G3** 没有「选真实场地/导入扫描」 | **断** | 场景 1 个；无「已扫描场地/导入扫描」入口；换场地只有空白/云项目；重建是采集流程而非选用 | `…\v-01-space.png`、`…\v-02-venue-swap.png`、`…\v-03-recon.png` |
| **G4** 标定/基准面/锚点/落地未暴露 | **半通** | 场地尺寸自动校到 splat（23.8×16.1）；`use-splat-preview` 已返回 `calibrate/setGround/addAnchor/landingPlan`；但空间面板全页搜不到「校准/标定/基准面/落地」入口，HUD 未挂载 | `…\v-11-g4.png`；[use-splat-preview.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/hooks/use-splat-preview.ts#L605-L624) |
| **G5** 分享版缺真实环境 | **断** | 只读页是 3D 布局示意（墙+桌椅），无 3DGS 现场背景；也无物料清单；标签仍写「只读 3D 方案」 | `…\p3-04-view-clean.png`、`…\p4-02-view-lamp.png` |
| **G6** Agent 不能精确改单件 | **半通** | 移动精确（Δx=-2.000，误差 0）；缩放 10% 实际变成 0.2×；「两盏」只加 1 盏；文案把缩放说成「挪/转」 | `…\v-07-move.png`、`…\p3-07-scale-proposal.png`、`…\p3-08-light-proposal.png` |
| **G7** 西湖素材不可用 + 空域 | **断** | 非 UI 项：0/32 文件有可用坐标、无平移基线、无尺度；空域与报备待核实。本轮未重新采集 | 见 [01 素材核查](file:///01-素材核查与采集缺口.md) §0/§2/§6 |

---

## 3. 本轮四项修复复验（无回归）

| 修复项 | 结果 | 实测 | 证据 |
|---|---|---|---|
| 分享链接只读 | **通过（干净场景）** | 未登录新页打开 `#s1=`，标题「只读 3D 方案」，副标「只读 · 不可编辑 · 5 件物件」，canvas=1，编辑控件=0，页面错误=0；链接 751 字符 | `…\p3-04-view-clean.png`、`…\v-14-view.png` |
| 物料成套 | **通过（应用内）/ 分享侧未覆盖** | Agent「出物料清单」7 件、发布大纲 7 件、总控汇总 7 件一致；风格成套「按风格配一套」可打开 10 套推荐并可派给 Bingo。**分享页不含物料表** | `…\v-10-inventory.png`、`…\v-15-door.png`、`…\v-16-door-dispatch.png`、`…\p3-04-view-clean.png` |
| 结构入口 | **通过** | 空间面板「结构」一行可展开；普通壳体显示总宽/总长/层高，改 23.8→20 后「应用」生效并提示「场地尺寸已更新，可撤销」 | `…\p3-01-structure-open.png`、`…\p3-02-structure-applied.png`、`…\v-04-structure.png` |
| 总控汇总 | **通过** | 总控显示项目名、Bingo/空间/物料入口、「分派结果」；派给空间后记录可见；汇总含「383.2 ㎡ · 7 件物料」「没有重叠，也没超出场地」 | `…\v-15-door.png`、`…\v-16-door-dispatch.png` |

**回归风险（需修，但不属本轮四项）**：分享快照对「本机库件」处理不一致——仅库件 → 能开但 6 件变 5 件（静默丢件）；库件 + Agent 灯 → 直接报「分享链接不完整」。干净场景与仅 Agent 灯场景正常（6 件）。判定为 G2 的既有缺口，本轮未改。

---

## 4. 阻塞与排期

### 必须按顺序

| 顺序 | 项 | 原因 | 交接点 |
|---|---|---|---|
| 1 → 2 | **G1 → G2** | G2 的「生成物上传拿 assetId」需要 G1 的服务端中转与上传口令 | 生成产物 → 资产上传接口 |
| 2 → 3 | **G2 → G5** | 分享快照要带环境 `.spz`，必须先有云端 assetId 与共享 URL | 资产注册表 → 发布快照 / `ScenePreview`/`LayoutPreview` 背景层 |

### 可并行

| 项 | 可并行理由 | 涉及文件（避免同文件冲突） |
|---|---|---|
| **G3** 真实场地入口 | 只动空间/场地选择，不依赖生成与上传 | `space-panel.tsx`、`venue-picker.tsx`、`site-capture.ts` |
| **G4** 标定/落地入口 | 底层已接线，只差 UI 与 HUD | `use-splat-preview.ts`、`calibration-hud.ts`、`room-organizer.tsx`（与 G3 分文件） |
| **G6** Agent 精确编辑 | 逻辑已在 `workbench-agent.ts`，只修缩放/数量/文案 | `workbench-agent.ts`、`agent-panel.tsx`、`layout-reducer.ts` |
| **G7** 西湖重采与空域 | 非代码，独立推进 | 采集/许可流程 |

> 推荐开工顺序：**G1 与 G3 同时起（不同文件）→ G2 → G4 与 G6 并行 → G5**；G7 全程独立，不阻塞前六项。
> 本轮发现的即时 bug（按最小改动排序）：① 分享丢件/链接不可读的提示与阻断（G2 症状）；② 缩放因子 0.2×（`plan.revise`）；③ 「两盏」只加 1 盏（数量解析）；④ 分享页补环境与物料（G5）。**本轮未改任何源码。**

---

## 5. 截图索引（绝对路径）

- 入口与第 1 步：`C:\Users\13266\.dsh\bot\workspace\Scendance2026\.temp\golden-path\shots\v-00-entry.png`、`v-01-space.png`、`v-02-venue-swap.png`、`v-03-recon.png`
- 第 2 步：`…\shots\v-05-generate.png`
- 第 3 步：`…\shots\v-06-add.png`
- 第 4 步：`…\shots\v-07-move.png`、`v-08-scale.png`、`v-09-light.png`、`v-10-inventory.png`、`p3-07-scale-proposal.png`、`p3-08-light-proposal.png`
- 第 5 步：`…\shots\v-12-publish.png`、`v-13-share-link.png`、`v-14-view.png`、`p3-03-share-clean.png`、`p3-04-view-clean.png`、`p3-05-share-library.png`、`p3-06-view-library.png`、`p4-01-share-lamp.png`、`p4-02-view-lamp.png`
- 修复复验：`…\shots\p3-01-structure-open.png`、`p3-02-structure-applied.png`、`v-04-structure.png`、`v-15-door.png`、`v-16-door-dispatch.png`
- 结果 JSON：`C:\Users\13266\.dsh\bot\workspace\Scendance2026\.temp\golden-path\g1-g7-result.json`、`p3-result.json`、`p4-result.json`

---

## 6. 环境与清理

- 3000/3210 被并行会话占用且共享 `.next`，未使用；本次使用隔离快照 `.temp/golden-path/run`（独立 `.next`，端口 3300）。
- 走查结束已停止 3300 进程（PID 41496），端口已释放；`.temp/golden-path` 仅含走查脚本、截图与结果，未进入源码目录。
- 并行改动导致的临时现象：① 编译警告 `'SceneApiError' is not exported from '@/lib/backend-session'`（activity-task-workspace.tsx、creative-studio.tsx）；② 一次 React「Cannot update a component while rendering」告警。页面功能未受影响，均标注为**属并行任务、当前不稳定**。
