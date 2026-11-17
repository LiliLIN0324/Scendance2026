# 幕景 Scendance2026 交接计划（2026-11-16，Asia/Shanghai）

给后续 Agent 接着做。本文只记录截至 **2026-11-16 19:23**、活动布置 bot 停掉全部本地 Cursor 命令行 Agent 时的工作树状态。  
**所有改动都还在工作区，未 commit、未 push、未开 PR、未部署。** 终树明确：额度已重置，先不要为消耗而再开大量高档 Agent；先整理、验收，再按任务推进。

---

## 0. 一眼看懂

| 状态 | 内容 |
|------|------|
| 仓库 | `C:\幕景\Scendance2026` |
| 分支 | `fix/outdoor-walk-control`（跟踪 `origin/fix/outdoor-walk-control`） |
| HEAD | `b997da81`「fix(outdoor): 按 Google 实测收敛为 29/44 控件」 |
| 已改（已跟踪） | 42 个文件，约 +3189 / −670 |
| 新增（本轮相关） | 罗盘/定位/绘图工具/OFM 证据与测试等一批未跟踪文件，见第 8 节 |
| 机器 | 用户 Windows 电脑 Alder（`machineId 8480ca3b-8f9c-45cb-8ec6-ae958b11f5e3`） |
| Node | 必须用 `C:\Users\endTree\tools\node-v24.22.3-win-x64\node.exe`（系统 Node 22 会失败） |
| Git | 不在默认 PATH，先 `$env:Path = "C:\Program Files\Git\cmd;$env:Path"` |
| 命令行环境 | PowerShell only（不要用 bash） |
| 本地 Agent | 已全部 `taskkill`，剩余 0 路 |

代码层面（单元测试）已落地较多：OFM 缓存去毒、并发合并、aholo 加载去重、分享图 1 信息架构、谷歌地图罗盘弯箭头、右下角控件堆、左栏图标、绘图五工具展开、漫游若干 bug。  
**几乎都没有在真实编辑器 / 真机上点过。** 这是下一步最大的缺口，也是部署前的硬门。

---

## 1. 硬规则（后续 Agent 必须遵守）

1. **不要 commit / push / 开 PR / 合 main / 部署**，除非终树亲口说「合」或明确要求提交、部署。
2. **不要改** `frontend/components/room-organizer/panels/scendance-workspace.tsx`。注意：本轮已改过它的测试 `scendance-workspace.react.test.tsx`（漫游小人、2D/3D 图标相关）。继续动测试可以，不要为了改测试去改本体。
3. **不要改现有合同字段、routeBridge 已有九个方法的签名、session scope、`SitePlanData`、`OutdoorTaskProgress`、物料生成入参。** 可以新增 bridge 方法。
4. **手术级修改**，不要整文件重写。动手前先 `git status` / `git diff` 看当前工作树，不要覆盖别人刚写好的去重和缓存修复。
5. **不要把临时验证文件提交进仓库**，尤其是：
   - `frontend/components/room-organizer/lib/.verify-ofm-evidence.test.ts`
   - 仓库根一堆 `.verify-*.txt`、`.tmp-*`、`.local-backup-*`、`.g1-reports/`
   - `docs/plans/ia-mapping/_shots/` 里大量调试截图（本轮前就有，不要当本轮产物提交）
6. `openfreemap-evidence.ts` 里仍留着进入调试（`debug("enter")` / `window.__ofmDebug`）。**真机验收通过后再删掉调试，不要带着调试部署。**
7. 部署配方（仅在本地 + 真机验收通过、终树同意之后）：
   ```
   cd frontend
   # 用 Node24
   node package-pages.mjs
   node next build
   wrangler pages deploy out --project-name scendance-scene-planner --branch main --commit-dirty=true
   ```
   OAuth 账号在 Alder 上（Endtree@proton.me）。生产：`https://scendance-scene-planner-ewz.pages.dev/` 与 `https://68abe8bc.scendance-scene-planner-ewz.pages.dev`。
8. 测试命令模板（在 `frontend` 目录）：
   ```
   & C:\Users\endTree\tools\node-v24.22.3-win-x64\node.exe node_modules\vitest\vitest.mjs run <相对路径> --maxWorkers=1
   ```
9. 终树有 ADHD：对外说明一次一小步；本交接文档可以写全，执行时仍按任务切片。

---

## 2. 产品背景与原始问题（不要走回头路）

团队：幕景宇宙，终树/丁科智 + 林丽丽，杭州 AIGC 文化艺术，工商注册前。产品线之一是活动布置 / Scendance 室外规划器。

### 2.1 OpenFreeMap 证据线（最初主线）

生产编辑器刷新或点「预览按用途复用我的物料」时，曾出现：

- 9 路并发 `/api/site-context`（上游 Overpass 503/卡住）
- 0 路 OFM TileJSON / tiles
- `window.__ofmDebug` 为 `null`（当时调试写在 `Promise.allSettled` 之后，**不能**据此判断 `fetchOfmEvidence` 没进函数）

根因（已定位并在代码里修）：

1. `loadOfmTileSource` 把**第一个调用方的 AbortSignal** 绑到**共享 TileJSON fetch** 上，取消会毒死所有等待方，缓存被清空，证据线退回 Overpass。
2. `createOutdoorMapContext().load()` 每次都 `loader.invalidate`，会话恢复/多实例造成 **stampede**。

现有会话可复用（不要再为了「证明有问题」去刷生产，除非做验收）：

- 地址：`https://scendance-scene-planner-ewz.pages.dev/editor`
- session：`scendance:outdoor-flow:project:house-uat5t1nz`，stage=objects
- anchor（gcj-02）lng=`120.163749` lat=`30.25283`，radius≈342.9，边界已在

### 2.2 终树后续点名的产品改动（都要保留在计划里）

- 右下角复刻 Google Maps 控件，**尤其是图 3 罗盘左右两枚会随朝向旋转的弯箭头**，2D/3D 都要有。
- 漫游模式各种 bug，参考成熟游戏 / Street View。
- aholo 生成模型加载与表现优化。
- 分享面板：图 1 是终树自己改过的版本（逻辑对），图 2 是早期也是当时线上版本。按图 1 信息架构改，先不谈视觉。
- 右下角漫游小人、左上/左侧图标，要参考成熟产品优化。
- 绘图工具条：终树觉得「T / 矩形下拉」很怪，**不如五个工具全部暴露**（T、矩形、圆形、三角形、线段）+ 颜色。

参考图在活动布置 bot 的附件目录（本机 box）：

- 罗盘/控件堆：会话早期附件（2D 堆、3D 堆、罗盘特写）
- 分享图 1 / 图 2
- 漫游小人、左侧栏：`/home/box/agent-data/agents/d4b0b3fb-59d8-4f51-af30-a82d3cfebb38/attachments/` 下 2026-11-16 晚间几张

---

## 3. 已做完（代码 + 定向单元测试，尚未真机验收）

下面「已做完」是指：对应命令行 Agent 写了代码、并报告相关 vitest 通过。**不是**「可以上线」。多路 Agent 改过同一批文件，后续必须以**当前工作树**为准，不要只信某一份日志。

### 3.1 OpenFreeMap / 地图证据

**已做：**

- `frontend/components/room-organizer/lib/openfreemap-tiles.ts`  
  - 共享 TileJSON **不再**绑定调用方 `AbortSignal`。  
  - 取消只拒绝该等待方，共享 fetch 继续。  
  - 导出 `resetOfmTileSourceForTests()`。  
  - 失败只在当前这次仍占缓存位时清空，下次会重试。  
  - 进入时若 signal 已 abort，不再新开 fetch。
- 新测试：`openfreemap-tiles.test.ts`（后轮报告 7 例通过；最初 3 例核心场景：取消不毒死、并发只 fetch 一次、失败后重试）。
- 新实现：`openfreemap-evidence.ts` + `openfreemap-evidence.test.ts`。`outdoor-map-context.ts` 在 `plan.anchor` 时 **OFM 优先**，失败再 fallback `/api/site-context`。
- 并发合并：同一 `project + 边界 + 版本` 的多次 `load` 共享一次 OFM/兜底；取消一路不打断共享请求；不再对同一 requestKey 反复 `invalidate`。
- 新测试：`outdoor-map-context.concurrency.test.ts`（后轮报告 **21 passed**，修过夹具锚点与并发语义）。
- 清理轮还补过：取消方立刻 `AbortError`，共享结果仍写入缓存；进行中请求按 key 放进 Map。

**测试记录：** TileJSON + 地图上下文并发 + 原上下文 + 路网/证据，有一轮合计 **39 passed**；并发文件单独 **21 passed**；TileJSON 复查 **7 passed**。

**未完成：**

- 真机 / 生产验收：刷新与点「预览按用途复用我的物料」时，应看到 OFM TileJSON/tiles，不应再打出 9 路 site-context。
- 验收后删除 `debug()` / `window.__ofmDebug`，不要提交 `.verify-ofm-evidence.test.ts`。
- 全量 `tsc` + 更大范围回归尚未作为「可部署」门槛跑完（有过局部 `tsc --noEmit` 无新错的报告）。
- 中间一版进度文档曾写并发测试 3 例因锚点夹具（`120,30` vs 平湖秋月）变红，后轮已补测试并报绿——**再跑一遍确认，不要只信旧日志。**

### 3.2 aholo 生成模型加载

**已做（两轮）：**

1. 缓存双键修复：`glbCacheKeyForUrl`，设施层与 `ensureGlbAsset` 用同一 UUID 键，避免同一 `.glb` 下两遍、解析两份。
2. `importAholoAsset` 按 taskid/url in-flight 去重（并发只 POST 一次）。
3. `loadAholoSceneMeters` 合并重复 `/meta`。
4. 后轮加码：最多同时下载 2 个；解析排队；户外等 3D 可见再换真模型；>2048 贴图缩小；>8 万顶点关阴影；非当前楼层约 20 秒后丢掉 GPU 模板；本机代理同一签名链接并发只下一次。

**主要文件：**

- `lib/aholo-assets.ts` + test
- `lib/aholo-model-placement.ts` + test
- `three/glb-assets.ts` + test（diff 很大，约 +289，**复查时要小心是否混进了额外改动**）
- `three/plan-model-layer.ts` + test
- `components/outdoor-plan-3d.tsx`
- `hooks/use-glb-assets.ts` + test
- `tools/aholo/lux3d-dev-proxy.mjs` + test（后轮加了代理侧去重）

**测试记录：** 第一轮 5 文件 **97 passed**；后轮前端 9 文件 **131 passed** + 代理相关 **7 passed**。

**未完成：** 真实户外场景里多物件同时加载、切楼层、失败占位，需要在编辑器里看是否卡顿、是否仍重复请求。

### 3.3 分享面板（图 1 信息架构）

**已做：** `panels/share-menu.tsx` + `share-menu.react.test.tsx`，以及 `frontend/app/globals.css` 少量样式。

按图 1：

- 先分栏：**发给客户 / 送评审方 / 内部协作**（键盘 ←/→、Home/End，`aria-selected`，只有当前栏在 Tab 序）。
- 每栏都有：方案网页（发布当前版本 / 复制链接 / 打开）、3D 漫游（生成 / 复制 / 打开 / 重新生成；无链接时后三项禁用）。
- **发给客户**：含 PNG / CSV / GeoJSON 勾选 +「导出 N 项资料」。
- **送评审方**：方案网页 + 漫游 + 发评审链接，**不出现文件导出**。
- **内部协作**：上述 + 导出交接、打开资料、到场清单 + 导出勾选。
- 各栏未发布 / 未生成漫游有空态说明；发布或生成后对应句子消失。
- 发布成功后卡片变宽，右侧方案预览 + 本地二维码；未发布或发布失败不出现右栏。
- 二维码区分「正在生成」和「画不出来」（可再画一次，不重打发布接口）。
- 导出接到现有能力：2D PNG 优先规划快照，失败再抓屏；3D PNG 抓三维画面；CSV / GeoJSON 走覆盖层清单。

**测试记录：** 分享测试从 9 → 11 → 12 → 13 → 14 → **17 passed**（以当前文件为准，再跑一次）。从未在浏览器里打开工作台点过分享卡。

### 3.4 Google Maps 罗盘与右下角控件堆

**已做：**

- 新组件：`gm-compass.tsx`、`gm-compass-host.tsx`、`lib/gm-compass-bearing.ts` 及测试。
- 深色圆盘、红白针、左右弯箭头画在同一层，随朝向一起转；2D/3D 共用一枚。
- 左箭头 `orbitByDelta(+π/2)`（视图顺时针 90°），右箭头相反；点针回正北；拖针跟手转。
- 2D 补了 `getBearing` / `orbitByDelta` / `resetNorth`（回正北只清方位，不改视口中心）。
- 点箭头时改用实时方位，避免 90ms 采样造成指针跳一下。
- 定位钮：`gm-locate.ts`、`gm-locate-button.tsx`、`gm-locate-host.tsx`。有场地时蓝心定位点 +「正在定位」；无范围时变红 +「无法定位：还没有可框选的场地」。
- 2D/3D 钮改成等轴立方体（扁块=平面，立方体=立体），文案留在 DOM 里不显示。
- 缩放 +/−：29×58 连体条，圆角约 8px，中缝内收。
- 尺寸口径（对照 Google 实测）：普通控件 29×29、圆角约 0.28×边长、间距 4px、罗盘 44px、缩放 29×58。阴影收到 `--oc-gm-*` token。
- 方位更新节流：小抖动不重绘，旋转只改 transform。
- 统一中文 tooltip（罗盘：向左/向右旋转 90°、拖动旋转 · 点击回正北）。
- 文档：`docs/COMPASS_TURN_ARROWS_PLAN.md`；进度写入 `docs/plans/2026-11-16-outdoor-agent-progress.md`。

**测试记录：** 罗盘相关从 5 → 17 → 20；控件堆 15；定位 7；token/缩放等多文件局部绿。均无真实地图点击。

**未完成：** 这是终树最在意、也最容易「看起来不对」的一块。必须对着他给的图 3（弯箭头）和 2D/3D 控件堆截图做视觉验收。旧指北针按钮可能仍在 DOM 里被新罗盘盖住，确认有没有重复或挡点击。

### 3.5 漫游模式

**已做（多轮叠加，文件：`use-outdoor-walk.ts` 改动很大，约 +422，需通读）：**

- 浏览器永久拒绝指针锁后，单击不再反复 `requestPointerLock`（对齐室内）。
- 退出时重置 `lockedOnceRef`，再进相位正确。
- 退出恢复 `OrbitControls.target`，并保存/恢复相机位置与朝向；清阻尼，避免第一帧甩视角。
- WASD 指数平滑加减速；失焦后清输入。
- 切 2D/3D 前先收口漫游，避免指针锁残留。
- 步行档关闭 orbit 的 zoom/pan/rotate，退出时恢复；仅 `walkEnabled` 时接管鼠标键。
- 非鸟瞰步行方位改用视线 / `walkFrame.yaw`。
- 移动端步行 `touch-action: none`。
- 设施/场景占地碰撞：身体贴盒滑移；第三人称镜头遇墙停在墙前（有一轮 88 测通过，含 `walk-collision`）。
- 穿地：鸟瞰不把相机压到 1.6m 眼高；步行最低约 0.45m；近处俯角/近裁剪保护。
- 指针锁与拖拽灵敏度对齐（约 0.002 rad/px）；输入框内 WASD 不走路；方向键不滚页面。
- 步行/跟随档里，罗盘旋转的是当前视线，不拧已停用的环绕中心。

**测试记录：** 从 36 → 62 → 88 不等，取决于跑了哪些文件。请一次性重跑：

```
use-outdoor-walk.react.test.ts
walk-view-modes.test.ts
gm-compass-bearing.test.ts
gm-compass-host.test.tsx
outdoor-walk-boundary.test.ts
walk-engage.test.ts
walk-collision（若存在）
```

**未完成：** 真机指针锁、碰模型、穿地、与罗盘/2D3D 联动，必须在编辑器里走一遍。碰撞与镜头是后加的，可能和手感预期不完全一致，需要终树看。

### 3.6 左栏图标、漫游小人、无障碍、tooltip

**已做：**

- 左轨：聊天、通知圆、宫格、公文包、加号、双圆、底部头像，统一 40px 按钮、间距 4px、描边 1.6、选中淡绿底 + 左侧 3px 绿条；选中不再改成实心填充。涉及 `solid-icons.tsx`、`agent-panel`、`rail-team-block`、`settings-menu`、`workbench-brand-toggle`、`bingo-rail-button`、`cloud-panel`、`mobile-shell.css` 等。
- 漫游小人：黄头橙身、白圆底；选中浅蓝底 + 蓝环；悬停微倾。2D 与户外共用。改动了 `scendance-workspace.react.test.tsx`（本体未改）。
- 无障碍：左栏与右下角 `aria-pressed` / 名称 / 2px 焦点环。
- 中文 tooltip 统一 token。

**测试记录：** 左栏相关 16；workspace 测试 33–34；tooltip 一轮报 103 passed（范围较大，需确认没有误报）。

**未完成：** 对照终树截图做视觉验收（左栏选中绿条、通知红点、小人像不像 Google pegman）。下面第 4 节有几路「左栏红点 / 宫格 / 加号」在停机时日志为空，可能没做完。

### 3.7 绘图 / 标注工具条

**已做：**

- 新组件：`annotate-draw-tools.tsx`、`annotate-color-bar.tsx` 及测试。
- **T、矩形、圆形、三角形、线段平铺**，不再先打开形状下拉。
- 颜色点（紫、墨、绿、蓝、橙、粉）+ 细/粗线宽始终可见，不收进二级菜单。

**测试记录：** 颜色条 3；与工具条合计 6。无画布实地点击。

**未完成：** 对照终树聊天截图做视觉验收；快捷键任务（`use-annotate-draw-shortcuts.ts` 已有未跟踪文件）在停机时日志为空，要确认是否接上。

---

## 4. 做到一半 / 被叫停（日志为空或未收回报告）

2026-11-16 19:23 按终树要求停掉全部本地 Agent。以下任务**启动了但日志为空**（有的可能已改了文件但没写完报告，有的可能几乎没动）。接着做之前，先 `git diff` / 搜对应新文件，避免重复或覆盖。

| 任务 id | 原定目标 | 提示词文件 |
|---------|----------|------------|
| plus-btn-x | 左侧加号按钮外观与菜单入口一致性 | `C:\Users\endTree\tools\agent-prompts\plus-btn-x.md` |
| icon-grid-x | 左侧宫格图标对齐与点击态 | `...\icon-grid-x.md` |
| walk-exit-x | 漫游退出恢复相机/控件（部分可能已被 walk-follow / walk-x2 覆盖） | `...\walk-exit-x.md` |
| north-reset-x | 指北针复位与罗盘一体的手感 | `...\north-reset-x.md` |
| draw-shortcuts-x | 绘图五工具快捷键（磁盘上已有 `use-annotate-draw-shortcuts.ts`，需确认完成度） | `...\draw-shortcuts-x.md` |
| compass-hit-x | 罗盘弯箭头点击热区与旋转手感 | `...\compass-hit-x.md` |
| left-badge-x | 左侧通知红点与选中绿条尺寸对齐 | `...\left-badge-x.md` |
| walk-icon-motion-x | 漫游小人选中/悬停微动效（icons-walk 已做一版悬停，需核对是否重复） | `...\walk-icon-motion-x.md` |

提示词和部分日志在：`C:\Users\endTree\tools\agent-prompts\`、`C:\Users\endTree\tools\agent-logs\`。

---

## 5. 还没做完、但已经可以继续的工作（优先顺序）

请按这个顺序做。不要再「为了消耗」平行狂开高档模型，除非终树再次要求。

### P0 — 先看清楚、再验收（不写新功能）

1. **通读当前 diff**，特别是大文件，确认没有互相打架或误伤：
   - `frontend/app/globals.css`（+602，极大）
   - `hooks/use-outdoor-walk.ts`（+422）
   - `panels/share-menu.tsx`（+334）
   - `three/glb-assets.ts`（+289）
   - `components/outdoor-plan-canvas.tsx`（+281 / −部分）
   - `components/outdoor-plan-3d.tsx`（+181）
   - `room-organizer.tsx`、`solid-icons.tsx`
   - `tools/aholo/lux3d-dev-proxy.mjs`
   - `three/furniture-builders.ts`（+7，确认是否顺手改的）
2. **用 Node24 重跑一套定向测试**（不要信旧日志数字）。建议至少覆盖：
   - OFM：`openfreemap-tiles.test.ts`、`openfreemap-evidence.test.ts`、`outdoor-map-context.test.ts`、`outdoor-map-context.concurrency.test.ts`
   - 分享：`share-menu.react.test.tsx`
   - 罗盘/控件：`gm-compass*.test.*`、`gm-locate*.test.*`、`gm-control-stack.test.ts`、`gm-mode-icon.test.ts`
   - 漫游：上一节列出的 walk 测试
   - aholo / glb：`aholo-assets`、`aholo-model-placement`、`glb-assets`、`plan-model-layer`、`facility-generated-models`、代理测试
   - 绘图：`annotate-draw-tools`、`annotate-color-bar`、快捷键测试（若已接线）
   - 左栏 / a11y / workspace 测试
3. 跑一遍相关 `tsc --noEmit`。
4. **本地拉起编辑器，按终树截图做视觉 + 操作验收清单**（见第 6 节）。这是目前最值钱的一步。

### P1 — 验收通过后才能动的收尾

5. 删掉 OFM 临时调试（`__ofmDebug` / 多余 `console.warn`），删除或忽略 `.verify-ofm-evidence.test.ts`。
6. 列出**准备提交的文件白名单**（不要把 `.verify-*`、ia-mapping 截图、临时备份打进去）。`bingo-rail-button.tsx` 有 LF/CRLF 警告，提交前统一换行。
7. 等终树说「合」再 commit；等真机确认 OFM 与控件都过关再按第 1 节配方部署。不为小改动开 PR。

### P2 — 仍缺的产品完成度（代码可能已有，但行为未在真机确认，或明明被叫停）

8. **罗盘弯箭头视觉**：对照图 3，确认月牙形状、左右热区、2D/3D 同转、拖针/回正北、与地图旋转同步、文字保持朝上。这是终树反复强调、别的 agent「复刻不好」的点。
9. **右下角整列**：2D/3D 立方体、定位进行中/失败、缩放条、罗盘 44px、漫游小人（黄头橙身是否够像 pegman）、间距阴影是否接近 Google。
10. **左栏**：对照终树两张左轨截图（默认 vs 选中绿条），通知红点、宫格、公文包、加号、双圆、头像。
11. **绘图五工具平铺**：对照他觉得「很奇怪」的下拉，确认五个工具 + 颜色条都露在外面，快捷键是否可用。
12. **分享图 1**：浏览器里走一遍三受众、发布、二维码、导出、空态、键盘切栏。
13. **漫游真机**：进入/退出、拒绝指针锁、WASD、碰模型、穿地、2D/3D 切换、罗盘在步行档是否转视线。
14. **OFM 真机**：用第 2.1 节会话，看 Network 是否先 TileJSON/tiles，而不是 9 路 site-context。
15. **aholo 真机**：多模型同时出现时的请求数、卡顿、占位、切楼层卸载。

### P3 — 可以做、但不要和 P0/P1 抢

16. 核对并补完第 4 节被叫停任务（先读 diff）。
17. 若视觉验收认为 pegman / 弯箭头仍不像，只改外观，不要再掀漫游逻辑。
18. 375 宽左侧导航曾在进度文档里记为「下一条产品修复」，本轮没作为主线。
19. 其他图标「如果确实需要再优化」——终树授权过，但要有对照，不要为改而改。
20. 全量测试里若有红，先分清是本轮回归还是原本就红。

---

## 6. 真机验收清单（建议复制到待办）

环境：Alder 上本地 dev 或（部署后）生产编辑器。Node24。不要为了验收去改生产配置。

**OFM**

- [ ] 打开已有项目 `house-uat5t1nz`（或同等有 anchor + 边界的方案），stage=objects
- [ ] 刷新，再点「预览按用途复用我的物料」
- [ ] Network：应出现 `tiles.openfreemap.org/planet` 与版本化 `.pbf`；不应再出现 9 条相同 `/api/site-context`
- [ ] 道路/建筑证据能画出来；OFM 失败时才落到 site-context
- [ ] 验收通过后再删调试代码

**分享**

- [ ] 三受众分栏逻辑与空态文案符合图 1
- [ ] 发布后右侧预览 + 二维码；失败/生成中态正确
- [ ] 送评审方没有导出勾选；客户/内部有「导出 N 项资料」
- [ ] 键盘可切栏

**右下角**

- [ ] 罗盘弯箭头随朝向转，左右点击转 90°，点针回北，拖针跟手；2D 和 3D 都对
- [ ] 控件尺寸/间距接近 29/44/4px 口径
- [ ] 定位：有场地 / 无场地两种反馈
- [ ] 2D/3D 立方体图标可辨
- [ ] 缩放条 +/− 不重叠、热区正确
- [ ] 漫游小人选中/未选中可辨

**漫游**

- [ ] 进入、退出机位不甩
- [ ] 指针锁拒绝后单击不再报错刷屏
- [ ] 切 2D/3D 会退出漫游且无锁残留
- [ ] WASD 加速平滑；输入框中按 WASD 不走路
- [ ] 碰撞与穿地可接受
- [ ] 步行档转罗盘是转视线

**左栏与绘图**

- [ ] 左栏与终树截图比：间距、选中绿条、红点
- [ ] 绘图五个工具都在外面，颜色和线宽一直可见

---

## 7. 关键路径与入口（给不熟仓库的 Agent）

| 主题 | 主要路径 |
|------|----------|
| OFM 瓦片 | `frontend/components/room-organizer/lib/openfreemap-tiles.ts` |
| OFM 证据 | `.../lib/openfreemap-evidence.ts` |
| 地图上下文 | `.../lib/outdoor-map-context.ts`（生产 TypeScript 里 `"/api/site-context"` 字面量主要在这里的 fallback） |
| 分享 | `.../panels/share-menu.tsx` |
| 罗盘 | `.../components/gm-compass.tsx`、`gm-compass-host.tsx`、`lib/gm-compass-bearing.ts` |
| 定位 | `.../components/gm-locate-*.tsx`、`lib/gm-locate.ts` |
| 漫游 | `.../hooks/use-outdoor-walk.ts`、`components/outdoor-plan-3d.tsx`、`lib/walk-view-modes.ts` |
| aholo | `lib/aholo-assets.ts`、`lib/aholo-model-placement.ts`、`three/glb-assets.ts`、`three/plan-model-layer.ts`、`tools/aholo/lux3d-dev-proxy.mjs` |
| 左栏图标 | `frontend/components/solid-icons.tsx`、`panels/agent-panel.tsx` 等 |
| 绘图 | `components/annotate-draw-tools.tsx`、`annotate-color-bar.tsx`、`hooks/use-annotate-draw-shortcuts.ts` |
| 全局样式 / token | `frontend/app/globals.css`（`--oc-gm-*` 等） |
| 进度草稿 | `docs/plans/2026-11-16-outdoor-agent-progress.md`、`docs/COMPASS_TURN_ARROWS_PLAN.md` |

线上试玩（旧部署，不含本轮未部署改动）：`https://scendance-scene-planner-ewz.pages.dev/`

---

## 8. 工作树文件清单（本轮相关）

### 8.1 已跟踪、有修改（`git diff --stat`）

见仓库内 `git diff --stat`。核心已在上文列出。另有：`openfreemap-buildings.ts`、`plan-tile-cache.ts`、`hooks/use-scene-effects.ts`、`outdoor-plan-overlay.tsx`、`outdoor-plan-canvas.tsx` 等，可能是控件宿主或缓存键对齐，接手时一并看 diff。

### 8.2 本轮新增、建议纳入「产品改动」审阅的未跟踪文件

```
frontend/components/room-organizer/components/annotate-color-bar.tsx
frontend/components/room-organizer/components/annotate-color-bar.test.tsx
frontend/components/room-organizer/components/annotate-draw-tools.tsx
frontend/components/room-organizer/components/annotate-draw-tools.test.tsx
frontend/components/room-organizer/components/control-tips.test.ts
frontend/components/room-organizer/components/gm-compass.tsx
frontend/components/room-organizer/components/gm-compass.test.tsx
frontend/components/room-organizer/components/gm-compass-host.tsx
frontend/components/room-organizer/components/gm-compass-host.test.tsx
frontend/components/room-organizer/components/gm-control-stack.test.ts
frontend/components/room-organizer/components/gm-locate-button.tsx
frontend/components/room-organizer/components/gm-locate-button.test.tsx
frontend/components/room-organizer/components/gm-locate-host.tsx
frontend/components/room-organizer/components/gm-mode-icon.test.ts
frontend/components/room-organizer/components/gm-walk-motion.test.ts
frontend/components/room-organizer/hooks/use-annotate-draw-shortcuts.ts
frontend/components/room-organizer/hooks/use-annotate-draw-shortcuts.react.test.ts
frontend/components/room-organizer/lib/annotate-draw-shortcuts.ts
frontend/components/room-organizer/lib/annotate-draw-shortcuts.test.ts
frontend/components/room-organizer/lib/gm-compass-bearing.ts
frontend/components/room-organizer/lib/gm-compass-bearing.test.ts
frontend/components/room-organizer/lib/gm-locate.ts
frontend/components/room-organizer/lib/gm-locate.test.ts
frontend/components/room-organizer/lib/map-chrome-publish.ts
frontend/components/room-organizer/lib/map-chrome-publish.test.ts
frontend/components/room-organizer/lib/openfreemap-evidence.ts
frontend/components/room-organizer/lib/openfreemap-evidence.test.ts
frontend/components/room-organizer/lib/openfreemap-tiles.test.ts
frontend/components/room-organizer/lib/outdoor-map-context.concurrency.test.ts
frontend/components/room-organizer/panels/a11y-icon-buttons.react.test.tsx
docs/COMPASS_TURN_ARROWS_PLAN.md   （若尚未被跟踪，以 git status 为准；diff stat 显示已跟踪并 +42）
```

另有未跟踪文档：`docs/plans/2026-11-16-g1-close.md`、`docs/plans/2026-11-16-g2-construction-blueprint.md`，**不一定是本轮产物**，接手时不要误提交，先问或先读。

### 8.3 明确不要当成果提交

- `frontend/components/room-organizer/lib/.verify-ofm-evidence.test.ts`
- 仓库根 `.verify-*`、`.tmp-*`、备份目录
- `docs/plans/ia-mapping/_shots/` 下大量 png/jpg

---

## 9. 给后续 Agent 的推荐执行切片（可直接当任务书）

**切片 A — 工作树体检（先做）**  
读本文 + `git status` + 大文件 diff；重跑第 5 节测试清单；写一份「当前红/绿」到进度文档末尾。不改功能。

**切片 B — 真机视觉验收**  
按第 6 节打勾。只记录问题，不立刻大重构。把「不像 Google / 不像图 1」的条目标优先级。

**切片 C — 修验收问题（每条一个小 PR 式改动，但仍不提交，除非终树要求）**  
优先：罗盘弯箭头、pegman、绘图五工具、分享实机、漫游进出。

**切片 D — OFM 真机验收与去调试**  
通过后删除 debug，准备白名单提交。

**切片 E — 被叫停任务收尾**  
只补第 4 节里 diff 证明没做完的部分。

不要开云端 Cloud Agent 来改这份脏工作树（容易另开分支/PR，和终树「本地、不开 PR」冲突），除非终树改口。

---

## 10. 记录来源

- 本机 Git 工作树（Alder，2026-11-16 19:23 左右）
- 命令行 Agent 日志：`C:\Users\endTree\tools\agent-logs\`
- 任务提示词：`C:\Users\endTree\tools\agent-prompts\`
- 既有进度：`docs/plans/2026-11-16-outdoor-agent-progress.md`

日志是 Agent 自称结果，以仓库里的文件和你重跑的测试为准。
