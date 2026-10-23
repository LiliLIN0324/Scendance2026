# 更新记录

## 属性面板改成双击才弹 — 2026-10-23

- 从物料库把物料放到场地上，不再顺手掀开「物料属性」：四个放置入口（点物料卡、拖到画布、冲突后补点一次、生成模型库加入）一律只选中、不开面板。
- 单击画布里的物料也只选中。要看尺寸/颜色/朝向，**双击那一件**，或者点工具轨的「选中物料」。面板已经开着时，单击别的物料仍然实时切换内容。
- 双击由两个视图各自的拾取层上报「打到了哪一件」：3D 在 `dblclick` 上补一次射线，2D 补一次 `hitTest2DItems`。没有拿当前选中项代替 —— 试过，双击空地也会把上次选中那件的面板掀起来。另外 Chrome 的 `pointerdown.detail` 恒为 0（实测），点击计数只在 `dblclick` 上，所以只能挂 `dblclick`，不能在按下时猜。
- 收起左栏时工具轨那颗按钮的悬停说明改成「先在画布上双击一件物料」，把新手势带出来。
- 真机实测（1440×900，CDP 真实鼠标事件）：放置沙滩折叠椅 → 物料数 5→6、左栏保持收起；单击空间绿植 → 左栏仍收起；同点双击 → 左栏 `has-properties` 打开、属性面板可见；关掉后再双击打不到物料的位置 → 保持收起。
- 涉及：`three/drag-handlers.ts`、`hooks/use-canvas-2d-interaction.ts`、`room-organizer.tsx`、`panels/scendance-workspace.tsx`，以及 `three/drag-handlers.test.ts`、`hooks/use-canvas-2d-interaction.react.test.ts`（各加 2 条双击用例）、`panels/scendance-workspace.react.test.tsx`（放置断言改 `keepPanel`）。

## 左栏不再自己弹开 + Agent 关闭后的浮窗卡片 — 2026-10-23

- 左栏改成只由按钮开合。原来在画布点一件物料，刚关掉的左栏会自己掀起来：`creative-studio` 把「工作区是否展开」回报给左栏的那条 effect 依赖了父组件回调，而回调按 `leftMode` 建，点选物料把 `leftMode` 一切 → 回调换身份 → effect 重跑 → 把还留着的 `workspaceExpanded=true` 重新报一遍，左栏就开了。回报回调改走 ref，effect 只在展开状态真的变化时跑（`resizeWorkspace` 里本来就有直接调用，不会漏报）。
- 同一轮真机复查又抓到一颗接错的按钮：选中某件物料后点工具轨「活动需求」，左栏纹丝不动。原因是跟随选中项的那条 effect 也听 `leftMode`，刚切到活动资料就被按回「选中物料」。改成只在选中项真的变化时才跟着换内容，实测「选中物料 ⇄ 活动需求」来回切都生效。
- 工具轨新增常驻的「选中物料」一颗（未选中时禁用并说明「先在场地里点选一件物料」）：左栏收起时面板内那颗切换按钮是 `display:none`，点不到，没有这颗就等于关上门再没有把手。
- Agent 栏右上角那颗 × 关掉后，原来只剩一条 34px 通高竖排把手——看不出能点、也看不出 Agent 在做什么。换成画布右上角一张浮窗卡片：头像 + 「晴光 Agent · 状态」+「第 N/5 步 · 阶段名」，点一下恢复整栏。实测 1440×900 下卡片 168×44，命中测试落在卡片自身。
- 卡片位置按工具列那颗「撤销」的悬停纸条定：一开始右缘压在 1376，正好把往左探出的纸条切掉半截（放大截图才看得出来）。改成让开 `--sc-rail-width + 62px`、层级降到工具列之下，实测纸条完整可读。
- 画布上「Agent 已先填好，确认就出方案 →」那颗胶囊，在 Agent 栏关着时点下去只 `focus()` 一个不存在的 `#step-cta`，毫无反应；改成找不到就把浮窗卡片点开。
- 物料属性面板顶上的英文眉标 `OBJECT PROPERTIES` 删掉（下面就是「物料属性」，窄屏那条规则本来就把它藏了），随之清掉两条已无人用的 `.sc-eyebrow` 规则。
- 涉及：`panels/creative-studio.tsx`、`room-organizer.tsx`、`panels/agent-panel.tsx`、`panels/item-context-popover.tsx`、`app/globals.css`。

## Agent 栏右上角：是关掉，不是收起 — 2026-10-23

- 右栏 Agent 头部那颗按钮点下去整个面板消失、只剩右缘一条竖排「Agent」把手——这是关闭，但悬停写的是「收起 Agent」、图标还是 `》|`（收合符号）。改成「关闭 Agent」+ × 图标；把手仍写「打开 Agent」，关—开读起来对得上。
- 顺带把「关闭 / 收起」分工定下来：真正只折叠、面板还在原地的才叫收起 —— 聊天区内的「收起聊天 / 展开聊天」（带 `aria-expanded`）、物料库的「收起物料库 / 展开物料库」保持不动；`creative-studio` 头部那颗 × 与隐藏的助手入口按钮一并改成「关闭聊天 / 关闭助手」。
- 真机复查顺手抓到一处压住：氛围条（漫游/人群/晴朗/正午）底边 888，物料库把手顶边 866，1440×900 下把手被压掉左半截「物料库」三字。氛围条改 `bottom: 44px` 让出把手那一行，实测两档（1440×900、1280×700）各留 10px 间隙；抽屉展开时仍走原来的 `--sc-shelf-height` 抬升规则。
- 涉及：`panels/agent-panel.tsx`、`panels/creative-studio.tsx`、`room-organizer.tsx`、`panels/workbench-shelf.css`、`panels/creative-studio.react.test.tsx`。

## 中文界面里的英文残留 — 2026-10-23

- 多选胶囊整条改中文：`N items selected · drag to move together` → 「N 件 · 已选中 · 拖动即整体移动」，`Copy / Group / Ungroup / Save as set` → 复制 / 成组 / 解组 / 存为组合，悬停说明与「组合名称」输入框一并跟上（原来写的是 `Set name`、`My set`）。
- 提示文案改中文并去掉不存在的指引：分享链接复制成功/被拒、备份文件过大、存储已满、超上限只载入一部分、本机布置打不开 —— 原先指向的 `Manage → Saved Layouts → History` 在本产品里没有这个入口，改成只说「原件已另存一份，不会被覆盖」。
- 读屏与悬停标签改中文：`Dismiss`→关闭提示、`Link to copy`→待复制的链接、`View options`→视图选项、`Wall visibility`→墙体显示、`Apply paint to`→墙面刷漆范围、`Pick a custom colour`→自选颜色、`Delete the recovered copy`→删除恢复出来的副本；墙面朝向 `All/N/E/S/W` → 全部/北/东/南/西。
- 文件读取抛出的英文错误（`Invalid layout file`、`Invalid image dimensions`、`Canvas unavailable`、`Image encoding failed`、超体积提示）统一中文，同步 4 处测试断言。
- 涉及：`panels/viewport.tsx`、`panels/chip-controls.tsx`、`panels/status-toast.tsx`、`panels/view-options.tsx`、`panels/wall-paint-panel.tsx`、`panels/recovery-entry.tsx`、`room-organizer.tsx`、`hooks/use-import-export.ts`、`hooks/use-layout-persistence.ts`、`lib/persistence.ts`、`lib/file-io.ts`。

## 参考底图搬进「图纸尺寸」 — 2026-10-23

- 「参考底图」不再浮在画布右上角：改由 `referenceImagePanel` 插槽渲染到左栏「图纸与尺寸」→「图纸与场地对应核对」区块，紧挨「更多：图纸重建与场地核对」，跟同区折叠行同样式（11px 灰字 + 原生展开三角、内容左侧细线缩进）。
- 上一轮为让开工具列加的右上偏移随之删除（`globals.css` 里两条 `.sc-scene-viewport .sc-reference-image*` 规则与一条已失效的 `.sc-reference-image-trigger` 规则一并清掉）。实测画布右上角浮层数量归零。
- 删掉重复说明：旧场景的「旧图按场地宽深示意放置，不代表已标定或实测准确。」与上方 notice 同义，移除；面板内控件块高度 320px → 254px。
- 涉及：`panels/reference-image-controls.tsx`、`panels/reference-image-controls.css`、`panels/creative-studio.tsx`、`room-organizer.tsx`、`app/globals.css`。

## 真机复查：压住与裁切 — 2026-10-23

- 用无头 Chrome 在 1440×900、1280×700、1280×600 三档实测截图，专挑只有真机才看得出来的毛病。
- 画布右上角「参考底图」和 Agent 胶囊被工具列压掉半截：两者右移让开 46px 纸条，实测重叠归零。
- 工具列改为按内容收高（仍保证不越进抽屉），不再在按钮下面拖出一条约 180px 的空白纸条。
- 场景模板卡两处硬伤：轨道继承了旧库的 18px 下边距、白留一截；名称行 18px 装不下 22px 的字，模板名被裁掉半行。现在轨道铺满、名称行 20px，缩略图 69px → 85px。
- 「独立本地预览」标记从视口底部中央移到顶栏，不再盖住抽屉里的卡片和灯光选项。
- 涉及：`app/globals.css`、`panels/workbench-shelf.css`、`panels/agent-panel.css`、`components/workspace-shell.tsx`。

## 工作台尺寸与手感 — 2026-10-23

- 抽屉默认加高到 212px（最低可拖到 176px）：缩略图从约 37px 高变成 60px 上下，模板图约 86px，看得出是什么再点。
- 横向轨道不再画滚动条：改用两端渐隐提示还有内容（`data-overflow`），卡片文字不会被滚动条压住；悬停卡片取消上移，避免被轨道上边缘切掉。
- 右侧工具列收进画布：14 个等大圆盘 → 10 个 32px 方按钮 + 白纸底板，高度限制在画布内，不再一路压到抽屉上；悬停/聚焦即在左侧浮出名称。
- 氛围四项（漫游、人群、天气、时段）搬到画布左下角一条带文字的胶囊栏，天气与时段直接显示当前值；弹出菜单朝上开。
- 空白场地卡改成绿描边白底，不再灰扑扑；画布抬头收成一行轻标注；右侧 Agent 栏宽度改为 `clamp(284px,27vw,336px)`，把宽度还给 3D 画布。
- 涉及：`app/globals.css`、`hooks/use-horizontal-rail.ts`、`panels/workbench-shelf.css`、`panels/scendance-workspace.tsx`、`panels/creative-studio.css`、`panels/agent-panel.css`。

## 物料抽屉改横排 — 2026-10-23

- 抽屉保持一行高：物料卡与场景模板都横着走，滚轮/触控板直接变横向滚动，删掉卡片区域的纵向下拉。
- 键盘：轨道聚焦后 ← → 走一张卡，PageUp/PageDown 翻页，Home/End 到两端；拖到末尾出现「再显示 24 个」，不再单独占一行计数。
- 场景模板与「长方形/正方形/L 形」空白场地合进同一条轨道，缩略图在上、名称在下；替换已有布置时改成卡内确认，不再弹浏览器对话框。
- 删掉重复文字：模板描述只在悬停与读屏名里出现；「桌椅、展台和人物都可移动…概念方案」「空白场地形状，尺寸可再改」「共 528 个 · 已显示 24 个」等说明行移除。
- 抽屉顶边仍可拖动调高（本机记住高度），拖高只放大缩略图。
- 涉及：`hooks/use-horizontal-rail.ts`（新增）、`panels/online-model-library.tsx`、`panels/scene-presets-panel.tsx`、`panels/venue-shape-presets.tsx`、`panels/scendance-workspace.tsx`、`panels/workbench-shelf.css`、`app/globals.css`。

## 3D 效果图导出 — 2026-10-23

- 右侧工具条「导出效果图」弹出面板：视角（跟随当前 / 整体 / 俯视 / 人视）× 画质（标清 1× / 高清 2× / 超清 3×），一键下载 PNG。
- 高分辨率导出：渲染时按倍率提升 pixelRatio 并重绘，完成后恢复相机与渲染器原状，画布不闪动。
- 2D 平面模式回退为现有截图路径（按当前分辨率导出）。
- 涉及：`hooks/use-import-export.ts`（`exportRenderImage`）、`panels/scendance-workspace.tsx`（导出面板）、`room-organizer.tsx`、`panels/workbench-shelf.css`。

## 编辑器 IA Phase 1 — 2026-10-16

- 顶层模式：`布置 | 评审 | 执行`（左窄流程轨 + 画布优先浮层）；策划 brief 嵌在布置，无独立策划模式。
- 执行壳：交付面板 tabs 含导出 / 本机备份；评审模式浮层「发给客户」。
- 降级：合同、重建、场地照片、流程指南进「更多」或一次性教练；代码保留。
- 氛围：布置工具条「漫游｜人群｜天气｜时段」；保留 weather/NPC/walkthrough 引擎；与「现场灯光」文案分离。详见 [docs/EDITOR_IA_PHASE1.md](docs/EDITOR_IA_PHASE1.md)。

## Phase 1.5 — 氛围内联修正 — 2026-10-16

- 氛围从左浮层 `AtmospherePanel` 改为底栏胶囊内联：**漫游｜人群｜天气▾｜时段**（默认全关；人群旁注「约 3 人」）。
- 不再与素材架抢白板；引擎 hooks 未改。详见 [docs/EDITOR_IA_PHASE1.md](docs/EDITOR_IA_PHASE1.md)。

## 1.0.1 — 2026-10-10

活动场地与执行工作台合入main：紧凑单排素材、侧边工具和助手共享画布，按剩余比例完整取景；资料关闭与未发送草稿保留。任务候选、合同原件、执行时间表、项目成果及可信公共模型恢复沿用已核流程。保留main的自有Supabase、Tokendance网关、匿名登录、域名及标准资源打包配置，根与前端版本同步1.0.1。

具体功能和验证边界见[1.0.1发布说明](docs/RELEASE-1.0.1.md)。Pages自动部署前端；新后台任务接口和数据库、真实模型与现场效果分别验收。

## 1.0.0 — 2026-10-09

- **自有部署**：后端改为自有 Supabase 项目 `wkhfvnzgopjdzxlmycks`；前端由 Cloudflare Pages 通过 GitHub 集成自动构建发布，地址 `https://scendance-scene-planner-ewz.pages.dev`。DeepSeek 仍直连官方 `api.deepseek.com`（`deepseek-flash`），使用自有 API key。
- **文档整顿**：1.0 之前的发布与验收记录整体移入 [docs/archive/](docs/archive/)，活文档中的旧项目与旧域名引用一并更正。
- **版本号**：根目录与 `frontend/` 均从 `0.6.0` 升到 `1.0.0`。
- **清理旧原型**：删除根目录独立静态原型的 `index.html`、`app.js`、`style.css`、`models.html`、`model-preview.js`、`serve.py`、`preview-webgl-desktop.jpg`、`preview-webgl-mobile.jpg`、`VALIDATION.md` 及 `docs/mockups/`。`renderer-webgl.js` 因官网三维演示仍在使用而保留。
- **验证边界**：本次只改部署配置、发布脚本目标与文档；未改产品功能、数据库结构或 Edge Function 逻辑。

## 开发分支工作台检查点 — 2026-10-10

活动任务建议接入人工选择、摘要确认、稳定提案、保存读回及原执行表；合同原件可在资料分类管理。底部素材按需展开，Agent异常持久化停止继续执行，修改已有物件遵守选中范围。公共模型在可信编号和来源核对后恢复，保存失败及新几何继续编辑保持可核对。

本机演练、真实模型与正式云分别记录，包版本仍为0.6.0。详见[功能与验证边界](docs/DELIVERY-PROGRESS-2026-10-10-WORKBENCH.md)。

## 0.6.0 — 2026-10-03

图纸与照片重建的独立预览版本，开发分支为 `codex/floorplan-to-3d`，尚未合并至 main 或部署到原站。

- 新增 Scene v2：多边形场地、参数化墙体、门窗开口、柱子、来源证据及确认尺寸；保留 v1 读取并阻止静默降级保存。
- 支持最多 12 张图纸或照片、私有来源上传、尺寸清单和图上两点标定；照片提供还原现场和重新布置模式。
- 接入独立重建队列、识别与规划调用、待核对状态、候选预览和确认应用，包含预算、去重、编辑租约及版本检查。
- 前后端共用放置校验，覆盖移动、旋转、缩放、复制、批量操作及 AI 应用；无效拖放回到有效位置。
- 支持结构编辑、保存恢复及撤销重做；保留原版默认墙面、地板和材质参数。
- 提供独立持久化本地预览：`npm run dev:floorplan`。详细验证见 [验收记录](docs/archive/floorplan-verification.md)。
- **验证边界**：本地测试与构建通过；真实 DeepSeek／混元调用、识别精度及独立 Supabase 云环境仍待配置和验收。本版本不代表真实识别已验收。

## 0.5.0 — 2026-10-03

官网首屏与全站视觉重做，并把官网接入生产构建。

- **首屏**：背景换成场地渲染图（三层 `background`：左侧压暗遮罩 + 场地图 + 深绿兜底，
  图片缺失时自动回退到兜底层，不会变成白块）；移除首屏的三维画布窗口
  （画布自带浅灰底，压在深色场地图上会变成亮矩形），改为设计稿里的浮动信息卡；
  实时三维演示保留在下方「三维场景」段。
- **顶栏**：编号导航改为 5 项并与页面真实章节一一对应（含高亮跟踪，
  此前占 7 屏的「场景类别」不在导航里、也无法被高亮）；去掉模糊 / 光斑 / 投影，
  改实心深绿胶囊；品牌贴左、动作按钮贴右。
- **段落节奏**：所有段落高度改用屏高 `svh` 限定（短段有下限、长段有上限），
  大字号做「vw 管宽屏 + svh 管矮屏」双重封顶。
- **字号层级**：全站字号从实测 29 种收敛到 8 种（另加品牌字 1 种），
  集中在 `:root` 令牌 + 样式表末尾的单一覆盖层。
- **配色**：全站从深青改为暖绿，工作台、云项目面板、品牌标与 favicon 同步。
- **官网打包**：`scripts/package-pages.mjs` 输出到 `frontend/public/`，
  打包前清空 `showcase/`（此前递归拷贝不删文件，改名前的旧图会一直被打进产物）；
  构建脚本自动包含 `/introduction` 介绍页。
- 新增 `assets/scenes/`：首屏背景图与场景类别素材。

## 0.4.0 — 2026-10-02

- 根目录静态首页替换：旧的「体育馆 / 48 小时黑客松」展示页改为「幕景 Scendance」产品首页。首屏保留透视三维视口，下方新增俯视三维建模区；两个视口共用 `renderer-webgl.js` 与同一套分区数据，点击任一视口会同步选中。
- 旧首页留档为 `docs/mockups/legacy-venue-index.html`，不再从站点入口链接。（1.0.0 已随旧原型删除。）
- 首页「导出方案」的 Markdown 标题与下载文件名由「场域 · 体育馆黑客松」改为「幕景 Scendance」。
- 全仓品牌名「场域」改为「幕景」，含 `frontend/` 的实现文案与测试断言。
- 主色统一为深青 `#0e7c78`；首页与工作台双向导航（首页「进入场景」↔ 工作台品牌 logo 回官网）。
- 合并 `feat/model-library`：新增 `scene/` 模型场景模板与模型库工具。

## 0.1.0 — 2026-10-02

首次整理后的 Scendance 项目版本。

- 活动场地编辑工作台：三维 / 二维视图、八类活动物料、属性编辑、撤销 / 重做、本地保存及 JSON 导入导出。
- Supabase 后端与前端接口集成：项目、编辑租约、版本校验保存、私有资产授权；保留本地 HTTP 联调与回归测试。
- Foundation 视觉参考改版：统一工作台、云项目弹层、加载 / 恢复界面、体育馆展示和模型预览的配色、玻璃材质及动效。
- 响应式面板、键盘焦点、减少动态效果和无背景模糊回退；修复手机属性面板被抽屉遮挡的问题。
- 保留模型来源、上游许可、设计研究及验收截图。

### 目录

- `frontend/`：当前可编辑工作台。
- `supabase/`、`client/`、`scripts/`、`tests/`：后端、接口辅助与验证。
- 根目录 `index.html`、`models.html`：独立体育馆展示与模型预览。（1.0.0 已删除。）
- `docs/`：设计参考、接口、部署和验证记录。

### 验证与边界

本轮视觉改版已通过前端 TypeScript、生产构建（含 lint）、171 项相关测试及桌面 / 手机宽度浏览器检查，详见 [视觉验收](docs/FOUNDATION_DESIGN_REFERENCE.md)。既有联调证据见 [前后端联调](docs/INTEGRATION.md)。

此版本不代表生产部署或真实 Supabase 云端完整验收。真实账号交接、第三方生成与客户发布仍需按部署文档继续验收；本地测试与云端能力分别记录。
