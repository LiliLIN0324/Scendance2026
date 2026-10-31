# T-06 画布静默 · 自检

> 2026-10-27 · 卡：`docs/T-06-CANVAS-QUIET.md` · 环境：`http://127.0.0.1:3026/editor`（headless Chrome 155 + CDP，1440×900，未登录本地工作台，演示规则生成）
> 结论：§6 十条验收 **PASS**（其中两条附「待核」说明，见 §5）。未 commit / push / 部署 / 开 PR，停等验收。
>
> **追加（2026-10-27 下午，用户点名「只留图标、禁旁注说明书」）**：顶左删「3D 场景/2D 平面」kind 旁注（尺寸钮 title 保留说明）、底中把手删「物料库」文字（aria-label 不变）、氛围 toggle 删「氛围」文字（补 aria-label="氛围"）。真机复验五项静默项 + 抽屉开合 + 更多菜单全部 PASS，截图 `.scratch/t06-idle.png / t06-drawer-open.png / t06-more-open.png`；单测契约同步（把手 `textContent` 不含「物料库」），vitest 2 套件全绿、tsc 0、eslint 0 error。原十条验收中「顶左只剩一行 3D 场景 · 尺寸」的描述自本追加起以「只留尺寸」为准。

## 1. §6 验收 checkbox

| 验收问题 | 结论 | 证据 |
|---|---|---|
| 空闲零引导气泡：画布上没有「说一句需求就能出方案」类常驻 pill | **PASS** | 真机空闲 DOM：`idlePill=false`、`stageIcons=[]`；`ap-canvas-pill` 只在生成中、生成失败、重叠警告、漫游退出时渲染。`00-idle.png`；`agent-panel.react.test.tsx` 18/18 |
| 预览说明会淡出：出提案时出现，约 2s 后不常驻挡画面 | **PASS** | 真机：说明出现时 `className=sc-preview-caption / aria-hidden=false`；2.8s 后 `is-faded`、计算样式 `opacity:0; visibility:hidden`；移出再移入画布后重新出现（采样 `opacity:0.623`，淡入中）。`03/04/05-*.png` |
| 右竖条默认短：空闲可见工具 ≤ 4（含「更多」），网格/尺寸/缩放/导出不在默认条上 | **PASS** | 真机空闲：`railCount=4`，四颗为 撤销 / 2D / 3D / 视角 / 更多工具；`tool-redo / tool-grid / tool-dims / tool-fullscreen / tool-zoom-* / tool-export` 均不在默认 DOM。`00-idle.png`；单测断言同项 |
| 更多里能力还在：网格、尺寸、缩放、导出可用 | **PASS** | 真机打开更多：7 项（重做 / 网格吸附 / 标注尺寸 / 看全场 / 缩小 / 放大 / 导出效果图）；网格点击后 `aria-pressed=true` 再点回 false；导出为二级面板（视角 4 档、画质 3 档、导出 PNG），返回可回列表；真实鼠标点画布空白处与 Esc 都能收起。`02-more-open.png`、`08-export-in-more.png`、`10-export-zoom.png`；单测覆盖重做/网格/尺寸/缩放/看全场回调 |
| 氛围默认收起：空闲不自动展开漫游/人群/天气/时段 | **PASS** | 真机空闲 `#tool-atmosphere aria-expanded=false`，`sc-atmosphere-group` 不存在；点开才铺出四条。单测同项 |
| 物料库仍可开：底中把手一点能开抽屉 | **PASS** | 真机点 `#material-drawer-handle`（真实鼠标坐标 730,879）：`aria-expanded=true`、`#workbench-material-shelf` 出现；再点收起。`09-material-drawer.png` |
| T-UI / T-05 未破：左轨三图标、活简报、生成中无确认、座位缺口改法、一屏一绿、Undo 清右栏 | **PASS** | 真机：左轨三图标在；左栏简报随对话更新为 16 人 / 室内 12×9 m / 108 ㎡；生成中 `#step-cta=false`；30 人 12×9 提案 `座位 16 / 30 · 还差 14` + 「加座，再排一版」，点后 30 座、旧确认消失；每状态右栏 `.btn-primary` 最多 1 颗，确认后 0；确认出摘要、撤销后右栏清空。`03/04/06/07/11-*.png`；`agent-panel.react.test.tsx` 18/18 |
| Out 未破：无 mood / 3dgs / 真 LLM / 新绿钮 / 按钮旁说明书；未擅自 commit/push/部署 | **PASS** | 未接任何新模型或 3dgs；画布空闲 `.btn-primary=0`、提案态仅右栏 1 颗；删掉的是引导气泡，没有新增说明书；`git status` 仅卡片 §3 内文件（外加两处 CSS，见 §5） |
| 相关 vitest 全绿；`npx tsc --noEmit` 干净；本卡改动文件 eslint 0 error | **PASS** | 卡 §7 两套件 **2 files / 32 tests passed**；`npx tsc --noEmit` 退出码 0；eslint 本卡四个 TS/TSX 文件 **0 error**（3 条既有 warning，未新增）；全量见 §4 |
| 真机证据写入本文件（至少：空闲全画布、淡出前后、打开更多三张） | **PASS** | 截图存 `C:\Users\13266\AppData\Local\Temp\t06-shots\`（临时目录、不入库）：`00-idle`、`03-caption-visible`、`04-caption-faded`、`02-more-open` 为主证，另有 7 张补充 |

## 2. 真机走查

方法：dev server `127.0.0.1:3026`；app 内浏览器截图仍返回 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，改用本机 Chrome headless + CDP 驱动与截图（`--headless=new --disable-gpu`，独立 profile `cdp-t06`，端口 9335）。临时截图不入库。

### 2.1 空闲态：四周安静

- 画布顶左只剩一行 `3D 场景 · 10 × 8 m`；点数与面积不显示。
- 右竖条四颗：撤销、`3D`（2D/3D）、视角、`…`；网格/尺寸/缩放/看全场/导出全部不在。
- 底左「氛围」收起；底中「物料库」为浅色小把手，无箭头。
- 画布上没有引导气泡；右栏 `.btn-primary=0`。
- 证据：`00-idle.png`。

### 2.2 顶栏明细：点一下才展开

- 点尺寸文字 → `aria-expanded=true`，第二行出现 `5 件物料 · 80.0 m²`，仍在顶栏内、不挡场；再点收起。
- 证据：`01-heading-detail.png`。

### 2.3 「更多」：短名单外的能力还在

- 点 `…` → 7 项菜单，文字常显、不吃图标猜谜；点画布空白处或 Esc 收起（`aria-expanded` 回 `false`）。
- 网格吸附点击 `aria-pressed` 在 true/false 间切换。
- 导出效果图 → 面板内切换为导出选项（视角 4 档、画质 3 档、导出 PNG），`← 导出效果图` 返回列表；面板为 `role=dialog`，不再嵌套第二层浮层。
- 证据：`02-more-open.png`、`08-export-in-more.png`、`10-export-zoom.png`。

### 2.4 预览说明：出现 → 淡出 → 回到画布再闪

- 发「16 人，室内 12×9，办个工作坊」→ 候选出现时说明可见（`03-caption-visible.png`）。
- 约 2 秒后淡出（0.6s 过渡），`is-faded` + `opacity:0; visibility:hidden`（`04-caption-faded.png`）。
- 指针移出画布再移入 → 说明重新出现，再停约 2 秒（`05-caption-refresh.png` 抓到淡入中的 `opacity:0.623`）。

### 2.5 确认与撤销

- 提案卡「按 16 人摆了 16 座」，右栏恰一颗绿「确认布置」。
- 确认 → 摘要卡出现、提案卡消失、绿钮 0（`06-confirmed.png`）。
- 撤销 → 画布回原样、摘要卡消失、右栏不残留确认（`07-undone.png`）。

### 2.6 T-05 座位缺口回归

- 30 人 / 12×9：提案 `座位 16 / 30 · 还差 14`，「加座，再排一版」在产品原位（右栏卡内文字链）。
- 点击后 → 生成中 `#step-cta=false`、提案卡消失；新版 `按 30 人摆了 30 座`，右栏仍一颗绿钮；确认后出摘要（`11-proposal-export-two-greens.png` 为提案态截图）。

### 2.7 物料库

- 点把手 → 抽屉打开（`aria-expanded=true`，`#workbench-material-shelf` 出现），再点收起；入口未删、数据逻辑未改（`09-material-drawer.png`）。

## 3. 本轮改动要点（仅非显然项）

- **右竖条短名单**：默认四颗 `撤销 / 2D·3D / 视角 / 更多`；重做、网格吸附、标注尺寸、看全场、缩放、导出都进「更多」。撤销保持在最短路径。
- **导出改二级面板**：导出选项不再从画布右缘弹第二层浮层，而是在「更多」面板内切换（`sc-more-export sc-export-pop`，`role=dialog`，返回箭头回列表），避免嵌套浮层相互遮挡。Esc / 外点收起整组。
- **可访问名=可见文字**：菜单项只用可见文字做可访问名（不加冲突 `aria-label`），满足 label-in-name；`更多` 带 `aria-expanded` + `aria-controls`。
- **顶栏弱化**：尺寸改为文字样按钮，点一下展开点数/面积（`aria-expanded`/`aria-controls`）；明细第二行不常驻。
- **说明淡出**：候选身份稳定（`aiPreview.base === layout` 才成立），所以 2s 计时不会被无关渲染重置；指针进入画布时 bump 一个 `captionEpoch` 让说明再闪一次；淡出后 `aria-hidden=true`，不再被读屏反复播报。
- **空闲气泡**：`AgentCanvasOverlay` 删掉 empty / 文件错误类的引导 pill；生成中、失败、重叠、漫游退出等**警告**全部保留。
- **物料库把手**：去箭头、高度 22px、浅色无阴影、文字只留「物料库」；`id / aria-label / aria-expanded / aria-controls` 与展开逻辑不变。
- **CSS 特异性**：菜单项选择器提到 `.sc-workbench .sc-tool-column .sc-more-pop > button`，避免被工具列分组的居中规则覆盖。

## 4. 测试与环境

- 卡 §7 两套件：`npx vitest run components/room-organizer/panels/scendance-workspace.react.test.tsx components/room-organizer/panels/agent-panel.react.test.tsx` → **2 files / 32 tests passed**（14 + 18）。
- `npx tsc --noEmit`：退出码 0。
- `npx eslint`（`scendance-workspace.tsx`、其测试、`agent-panel.tsx`、`room-organizer.tsx`）：**0 error**，3 warning（`react-hooks/exhaustive-deps`、两条 `no-img-element`，均为全库既有、本卡未新增）。
- 全量 vitest（`npx vitest run --maxWorkers=2`）：**3658 passed / 3 failed（3661）**；3 条失败正是 T-UI 自检时记录的 HEAD 既有欠账，均不在本卡改动路径内：
  - `lib/backend-generation.test.ts`「rejects late previews after releasing the lease…」
  - `lib/project-review.test.ts`「matches an actual offline HTML generated from the existing backup…」
  - `components/room-organizer/three/scene-presets.test.ts`「opens every gym fixture at its archived position…」
  - 默认满线程跑会额外带出多套重型集成/RTL 套件失败（PGlite、jsdom 争内存），单跑或本 2-worker 跑均通过；本卡文件两套件在全量与单跑中都绿。
- 控制台：仅一条 `net::ERR_CONNECTION_REFUSED` → `http://localhost:3099/auth/v1/token`（本机未起 Supabase auth，非本卡引入；无 React 运行时报错）。

## 5. 待核（未扩 scope）

1. **CSS 路径越出 §3 枚举**：竖条/窗口/把手的既有样式在 `frontend/app/globals.css`，说明基础样式在 `frontend/components/room-organizer/panels/creative-studio.css`；按卡片「可最小增量改那一个文件」只加了竖条/更多/顶栏/把手与 `transition / is-faded` 两行，未动主题。若不接受这两处路径请指出。
2. **顶栏明细是「点一下」不是「悬停」**：卡 §2 允许两者；选点击是为触屏与键盘可达。若想悬停展开，可再换。
3. **空闲引导气泡是整颗删除**，不只默认隐藏：文件读取失败等状态现在只由右栏与顶部警告条承担，画布上不再有「说一句需求就能出方案」或文件错误 pill。若验收希望文件错误仍有一条画布短提示，另开卡补。
4. **短名单取舍**：重做进「更多」；「看全场」从原全屏位置进「更多」。全屏与视角未对调。
5. **提案态手动开画布导出面板时，视觉上会同时出现两颗绿**（导出 PNG 与右栏确认布置）；右栏 `.btn-primary` 仍只有 1 颗。此为 T-UI 既有样式（导出 CTA 一直在这张浮层里），本卡没有新增绿钮，也未重开 T-UI 去改它——按「一屏一绿」纪律保留为待核。
6. **全量 vitest 的既有欠账/负载偶发**：2-worker 全量 3658/3661，3 条失败与 T-UI 自检记录的 HEAD 既有欠账完全一致；满线程追加的失败单跑均通过，属本机负载偶发，非本卡回归。
7. 未 commit / push / 部署 / 开 PR / 开下一张卡。
