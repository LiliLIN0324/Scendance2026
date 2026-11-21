# 左右工具轨 × 地图控件统一重设计方案（2026-11-13）

> 状态：方案阶段，未改代码。按既定偏好：本地分支攒改动 → tsc + 定向测试 + 真机验收通过后再一次性推 main，不逐小改开 PR。
> 基线：`main` 工作树实读（右轨 `scendance-workspace.tsx`、覆盖层 `outdoor-plan-overlay.tsx`、样式 `globals.css`）。既有互补文档：`2026-11-12-sidebar-entry-unification.md`（左轨入口与图标族，已定稿）、`2026-11-13-outdoor-map-unification.md`（外壳与去室内化路线）、`2026-11-13-outdoor-map-decommission.md`（M/R 切片路线）。
> 配套草图：`docs/visual-2026/tool-rail-unification-sketch-2026-11-13.html`。

## 0. 问题与结论先行

用户观察到三处不统一：左轨组件、右轨组件、右下地图簇；另问「层数上下钮为什么 main 里看不到」。

1. **楼层上下钮没有丢**：代码仍在 `scendance-workspace.tsx` 684–697 `.sc-floor-switcher`，被 `{!outdoorEditing && (...)}` 条件包裹——户外地图接管后楼层是室内结构概念，户外态隐藏；户外方案层（levels）走画布自身左栏图层面板。截图处于户外地图态，所以右轨看不到上下三角。详见 §3。
2. **三套钮规格并存**：左轨 40px 透明裸钮、右轨 30px 白色圆气泡、右下/右上 34px 内联圆钮；底色、描边、阴影、选中态、图标族、禁用态、角标、分隔线各走一套。
3. **统一方向不是推翻左轨已定稿**：左轨入口三族归位与左缘绿条选中态已随 11-12/11-13 两轮拍板落地；本轮把右轨与地图簇向同一套令牌、同一套基础钮族对齐，跨栏只统一规格令牌，不互换左/右已定的选中表达与图标族分工。

## 1. 现状盘点（工作树实读）

### 1.1 左轨 `.sc-mode-rail`
代码：`room-organizer.tsx` 轨钮组装块；样式：`globals.css` 1097–1326。

| 序 | 组件 | 图标来源 | 容器/状态 |
|---|---|---|---|
| 1 | 总控门厅 `WorkbenchBrandToggle` | `RailAvatar` door PNG 28px + 白眼 | 40×40 触达；active 左缘 3px 绿条 |
| 2 | Bingo `BingoRailButton` | 28px 圆徽标（待发空圆 / 待评数字 / 回执勾形）+ 15px 角标 | 同 40 触达；三态描边 + 轻光晕 |
| 3 | 空间 | Material `grid_view`（`LayoutGrid`），26px | `.sc-rail-disc` 40×40、圆角 12、透明 |
| 4 | 物料 | Material `inventory_2`（`Box`），26px | 同上 |
| 5 | 拍摄场地 | 自绘描边 camera SVG 26px + 右下「3D」8px 副标 | 同上；规范内待换 `photo_camera` |
| 6 | 户外规划 | Material `public`（`Globe`），26px | 同上 |
| 7 | 成员 `RailTeamBlock` | 照片/首字母圆片 32px + 15px 未读角标 | hover 只压暗头像，不换底色 |
| 轨脚 | 草稿文案、标注开关、设置 `MoreHorizontal`、账户头像 34px 圆 | Material / 头像 | foot `border-top: 1px hair` |

样式口径：轨宽 64px、`--wk-paper` 底、右 1px hair；钮透明底、`--r-sm` 10px、无描边无阴影；hover `--wk-plane`；active 左缘 3px `--wk-green` 条 + 墨字 600；禁用 plane 底 + faint 字，`opacity: 1`；状态点 9px 小圆；tooltip 向右出墨黑胶囊 11px；分隔 `.sc-rail-divider` 1px hair。

### 1.2 右轨 `#tool-column .sc-tool-column`
代码：`panels/scendance-workspace.tsx` 682–902；样式：`globals.css` 1645–1756。

| 组 | 钮 | 出镜条件 | 图标 |
|---|---|---|---|
| 楼层 | `.sc-floor-switcher`（`1F` 胶囊 + 上/下三角） | `!outdoorEditing` 隐藏 | 自绘 `FloorTriangle` |
| 交付 | 分享 `ShareMenu` | `!(publishHidden || outdoorEditing)` | Material `ios_share` |
| 场景 | 移动整体场景 `#tool-move-scene` | `sceneMoveEnabled` | 自绘 `MoveSceneIcon` |
| 工具 | 抓手/选择菜单 `#tool-select`（H/S） | 常开 | 自绘 `HandStopIcon` / Material `near_me` |
| 视图 | 2D/3D `#tool-2d3d` | `!outdoorEditing` 隐藏 | Material `view_compact`/`view_in_ar` |
| 工具 | 测量 `#tool-measure` / 标注 `#tool-annotate` / 属性 `#tool-selection` | `outdoor?.setInspector` | `OUTDOOR_TOOL_ICONS`（`straighten`/`edit_note`/`tune`） |
| 实景 | 高斯/轮廓 `#tool-environment-view` | `environmentViewEnabled` | Material `layers` |
| 工具 | 第一人称漫游 `#tool-walk` | 常开；户外 `disabled` + 内联 `opacity .35` | Material `footprint` + 左侧深绿文字 label |
| 工具 | 网格吸附 `#tool-grid` | 常开；户外 `disabled` + 内联 `opacity .35` | 自绘 `GridSnapIcon` |
| 地图 | 底图切换 `#tool-ground-source` | `geoGroundActive && !outdoorEditing` | 菜单 |
| 地图 | 地图类型 `#tool-map-type` / 卫星 `#tool-satellite` | `satelliteVenue && !outdoorEditing && !geoGroundActive` | Material `map`/`satellite` |
| 历史 | 撤销 `#tool-undo` / 重做 `#tool-redo` | 常开；户外接 `outdoor.canUndo/canRedo` | Material `undo`/`redo` |
| 视图 | 缩小 `#tool-zoom-out` / 放大 `#tool-zoom-in` | 常开；户外接 `outdoor.zoomBy` | IconPark 实心镜片族 |
| 交付 | 导出效果图 `#tool-export` | `onExportImage && !outdoorEditing` | Material `photo_camera` |
| 氛围 | 人群/天气/时段/灯光 `#tool-atmosphere` | `showAtmosphere` | Material `groups`/`sunny`/`rainy`/`light_mode`/`wb_sunny` |

样式口径：列宽 44px、`right:12 top:12`、gap 4；钮 30×30 正圆、`--wk-paper` 底、1px 透明边、投影 `0 1px 3px rgb(20 20 22/.12)`；hover 投影 `0 2px 6px/.16`；禁用 faint 字 + `opacity .45`；`.is-active` 绿描边 `--wk-green` + 绿字 `--wk-green-deep`；`#tool-select.is-off` 虚线描边；tooltip 向左出；`<640px` 高钮缩 26px；分隔 `.sc-tool-sep` 20×1px hair。

### 1.3 覆盖层：右上交付钮 + 右下地图簇
代码：`components/outdoor-plan-overlay.tsx` 489–658。

- 右上 `#tool-outdoor-share`：34×34 圆，**整组内联样式**——白 `#ffffff` 底、`1px #e4e4e7` 边、投影 `0 4px 14px rgb(20 20 22/.10)`、16px 自绘上传 SVG；`right:72`（给 3D 楼层芯片让位）；打开统一交付面板 `OutdoorDeliveryPanel`。
- 右下 `#tool-outdoor-source`：34×34 圆，**内联样式**——`PLANNING_SURFACE.panelBg` 底、`panelBorder` 边、同档投影；字符 `▢/◱` 作图标；弹 252px 底图面板（OSM / Carto 浅深 / 高德街道 / 卫星 / 注记 / 纸面模式 / 重看引导）。
- 缩放 +/- 目前在右轨底部（`#tool-zoom-out/in`），未随地图簇成组。

### 1.4 左下：2D/3D 胶囊 + 比例尺/罗盘/署名
- `OutdoorViewSwitch`：2D/3D 分段胶囊，`room-organizer` 独立挂载在左下动作簇；墨黑皮肤，不在右轨。
- `components/geo-scale-compass.tsx`：比例尺 + 指北针 + 图源署名胶囊（截图左下「贡献者」即 attribution）。

## 2. 不一致对照（磁盘实证）

| 维度 | 左轨 | 右轨 | 覆盖层地图/交付钮 | 问题 |
|---|---|---|---|---|
| 槽位 | 40×40（disc） | 30×30 | 34×34 | 三档槽位；触达低于 32–40 建议 |
| 形状 | 圆角 12（disc）/ `--r-sm` 10 | 正圆 50% | 正圆 999 | 两种用途两种形状，尚未令牌化 |
| 底色 | 透明 | `--wk-paper` 白 | `panelBg`/白 | 裸钮与气泡钮混用 |
| 描边 | 无 | 1px 透明 | 1px 实 hair | 三套口径 |
| 阴影 | 无（E0） | `0 1px 3px/.12` | `0 4px 14px/.10` | 投影轻重断层，且覆盖层投影超出 E1 口径 |
| 选中态 | 左缘 3px 绿条 | 绿描边 + 绿字 | 无选中态 | 两种表达；属已定分工，令牌需对齐 |
| 图标族 | 形体 PNG / Material / 头像 / 自绘 SVG | Material + 自绘图标 + IconPark 缩放 | 字符 + 自绘 SVG | 26px 越规范档；字符按钮待换正式图标 |
| 图标尺寸 | 28 / 26 | 20（IconPark 78%） | 16 / 14 | 规范档 16/20/24/32，现状 26、14 越档 |
| 禁用态 | plane 底、faint 字、`opacity 1` | faint 字 + `opacity .45` | 无禁用 | 禁用反馈两套；walk/grid 另用内联 `.35` |
| 角标 | 15px 圆 err 底白字 10px、2px paper 描边 | 无 | 无 | 口径只在左轨定义，右轨/地图未复用 |
| 分隔 | divider 1px hair；foot `border-top` | 20×1px hair | 无 | 分组线两种口径 |
| 样式落点 | CSS 类 | CSS 类 | 大量内联 style | 主题变量无法统一接管；禁用透明度散落内联 |
| tooltip | 右出黑胶囊 11px | 左出黑胶囊 11px | 左出 | 方向随轨位置，规格一致 |

### 2.1 2026-11-14 磁盘复核补充（工作树实读）

在 §2 对照基础上，本轮重读 JSX 与 CSS 后补录的实测漂移点：

- **静息态品牌绿**：`#tool-walk` 未选中即 `color: #35624A`（globals.css 1726），属静息态用品牌绿，违反「品牌绿只给选中指示 / 发送键」；选中再显绿边 + green-deep 字。
- **图标越档补充**：选择菜单行图标 15px、`Check` 14px（scendance-workspace.tsx 726/729/732/735）；左轨 capture 图标槽 26px、Bingo 徽标 svg 13px（globals.css 1264/1278）；均不在 16/20/24/32 档内。
- **第三套禁用口径**：楼层箭头柱 `:disabled` `opacity .55`（globals.css 1690），与右轨 `.45`、内联 `.35` 并列；统一收口到 plane 底 + faint 字 + opacity 1。
- **地图簇自有色未接令牌**：罗盘红针 `#c0392b`、署名胶囊 `rgba(18,20,26,.45)`、署名圆角 6px（globals.css 817–823）；红针属地图领域语义可保留，署名圆角回 r-sm，底色接令牌。
- **字符图标**：右下底图钮用字符 `▢/◱` 占位（outdoor-plan-overlay.tsx 663），待换已登记 `map`/`layers` 族正式图标。
- **2D/3D 胶囊**：`outdoor-view-switch.tsx` 走 `PLANNING_SURFACE` / `PLANNING_SEGMENTED` / `PLANNING_TEXT` 内联常量，墨黑皮肤，未接全局令牌。
- 配套盘点草图：`docs/visual-2026/style-audit-2026-11-14.html`（三族实测快照 + 维度对照表 + P0/P1/P2 调整清单）。

## 3. 「楼层上下钮在 main 里找不到」核查结论

- **代码在 main**：`scendance-workspace.tsx` 684–697，`.sc-floor-switcher` = `1F` 标签胶囊 + `FloorTriangle` 上/下箭头；回调 `changeVisibleFloor(delta)`；`addFloorBlocked` 时出阻塞提示。
- **为什么截图看不到**：整段包在 `{!outdoorEditing && (...)}`（684 行），注释 683 行写明「2026-11-13 M1：户外地图接管后楼层是室内结构概念，右轨楼层钮隐藏；户外方案层（levels）切换走画布自身的图层面板」。截图是户外地图态，条件为假，钮不渲染。
- **户外方案层入口**：左栏卡片头部 levels 胶囊（层名 + `1/N` + 新建）+ levels-popover 列表；桥接 `getLevels()/setActiveLevel(levelId)` 已在 M5 接给智能体。
- **口径漂移提示**：`outdoor-map-decommission` 14i 曾记录「五颗钮条件包裹已逐段回退、JSX 回到 HEAD 原状」；但当前工作树磁盘上楼层、2D/3D、分享、导出、底图/卫星仍是 `!outdoorEditing` 隐藏包裹，漫游/网格是禁用包裹。**以当前磁盘 JSX 为准**；若 14i 的回退 intended，需在 #24 地图能力接入时重新对齐这两处记录。
- **两套层概念分开命名**：室内「楼层 floor」（建筑结构层，`1F`）；户外「方案层 level」（同一方案内叠加层，`1/N`），文案与图标不得混用。

## 4. 已定约束（不可推翻，来自设计规范与 14 系列定稿）

摘自 `docs/05-设计规范.md` v2.5.12 与 `outdoor-map-decommission` M1/M5 定稿：

1. **图标族分工**：通用 UI 用本地 Material Symbols Rounded（FILL 1、weight 300、currentColor）；角色形体、人物头像、PlotCraft/物料领域图形为例外；仅搜索/缩放用 IconPark 实心镜片族；户外面板内部工具线条族是领域例外，不拉进左/右轨。禁未登记描边图标、禁同列混族、禁 emoji 代图标。
2. **图标尺寸档**：16（行内）/ 20（控件）/ 24（面板空态）/ 32（整页空态）；不用 12 与 14/18/22 中间档；图形收至框内 78%–90% 视觉缩放。
3. **品牌绿 `#4A7C59` 全产品只两处**：选中指示、发送键；语义色 ok/warn/err 只做状态文字、状态点、描边，不做大色块；选中不做绿底容器。
4. **圆角**：`--r-sm` 10 / `--r-md` 14 / `--r-lg` 18；禁 <4px 胆怯圆角；发送键圆除外。
5. **阴影层级**：E0 默认无投影；E1 `0 6px 18px/.10` + hair（菜单/popover/tooltip）；E2 `0 16px 48px/.18`（模态/抽屉）；E3 `0 1px 2px/.06` 唯一例外给左轨激活卡。禁彩色投影、默认给卡片投影。
6. **按钮五态**：常规/悬停/聚焦/点击/禁用；禁用 plane 底 + faint 字；`:focus-visible` 外描边 2px `--ink-soft` offset 2px；可点击区域 ≥32px。
7. **右轨定稿（14k/14l）**：尺寸标注 dims 归账户偏好 `showMeasurements`，不回右轨圆钮；视角预设 preset 彻底删除，机位归导出成图链路；2D/3D 走左下胶囊；楼层、漫游、网格出镜，回调待接地图能力；未接住的钮置灰保留提示，不回退室内壳。
8. **工作流**：逐切片走 tsc + 定向测试 + 真机探针（DOM 钮清单、canvas 数、console 无新报错）；不引入全量新回归；攒本地验收后一次性推 main。

## 5. 统一重设计方案

### 5.1 抽一套共享工具钮令牌（CSS 变量 + 基础类，不改业务逻辑）

在 `globals.css` 沉淀左右轨与地图簇共用的钮令牌，现状散落的硬值（30/34/40、#e4e4e7、.10/.12/.16/.35）一律接变量：

| Token | 建议值 | 说明 |
|---|---|---|
| `--tool-size` | 40×40（桌面）；窄高 `<640px` 36×36 | 触达对齐规范 ≥32；现右轨 30、覆盖层 34 上收 |
| `--tool-shape-round` | `--r-full` 999 | 编辑器工具钮（右轨、地图簇） |
| `--tool-shape-square` | `--r-sm` 10 | 面板导航钮（左轨 disc 现 12，对齐 `--r-sm`） |
| `--tool-bg` | `--wk-paper` | 工具钮统一白底；左轨导航钮保持透明裸钮为族例外 |
| `--tool-border` | 1px `--wk-hair`，默认透明 | 选中/悬浮再显边 |
| `--tool-shadow-rest` | E0 或 E3 级 `0 1px 2px/.06` | 取代覆盖层 `0 4px 14px` 超出 E1 的投影 |
| `--tool-shadow-hover` | `0 2px 6px/.16` | 对齐现右轨 hover |
| `--tool-icon` | 20px 槽，图形 78%–90% | 收齐 26/14 越档；头像/形体例外 28 |
| `--tool-disabled` | plane 底 + `--wk-faint` 字，`opacity 1` | 取代右轨 `.45` 与覆盖层 `.35` 内联 |
| `--tool-badge` | 15px 圆、err 底白字 10px、2px paper 描边 | 复用左轨 `.sc-rail-member-badge` 口径 |
| `--tool-sep` | 20×1px `--wk-hair`，组间 1 根 | 左右同口径；左轨 divider 同值 |
| `--tool-tip` | 11px 墨黑胶囊 `--r-sm`，11/15 | 左轨右出、右轨/地图簇左出 |

### 5.2 两种钮族（沿用规范分工，不混形）

- **导航族（左轨）**：切面板/身份；圆角方、透明底、左缘绿条选中；图形三族归位（形体 / Material / 头像）。已定稿，本轮只收尺寸档与令牌。
- **工具族（右轨 + 地图簇）**：画布动作；正圆、paper 底、hair 边、轻投影；选中态绿描边 + green-deep 字；开关类同一字形 + `aria-pressed`，关闭态可用虚线描边（现 `#tool-select.is-off` 范式）。
- **保留的族例外**：门厅形体、成员头像、户外面板线条工具、IconPark 缩放三枚。

### 5.3 状态与反馈

- 五态接入基础类：rest / hover / focus-visible / active / disabled；禁用走 plane + faint，不整钮降透明度。
- 选中双属性：颜色 + 描边/底色；不只靠图标颜色（规范 §一.4）。
- 户外未接住的能力（漫游、网格）：置灰 + tooltip 说明，不触发室内壳；提示文案现状已就位，禁用样式从内联 `.35` 迁到类。
- 角标统一 15px 口径；Bingo 双计数主圆 P、角标 L（11-13 第二轮定稿）维持不动。

### 5.4 图标收敛

- 右轨/地图簇工具钮登记进 `solid-icons.tsx` / `outdoor-tool-icons.ts` 既有映射表；自绘 `HandStopIcon`/`MoveSceneIcon`/`GridSnapIcon` 若有同语义 Material 形优先替换，确属领域图形的保留登记例外。
- **2026-11-14 码点核对后三枚去向**（对照 `material-symbol-codepoints.ts` 与 `public/material-symbols/rounded/`）：
  - `MoveSceneIcon`（移动整体场景，十字四向箭头）→ 换 `open_with`（码点 `0xe89f` 已登记），无需补字体子集。
  - `GridSnapIcon`（网格吸附，井字+落点块）→ 换 `grid_3x3`（码点 `0xf015` + fill.svg 已登记）；active 态右下落点块去掉，选中只由按钮绿边/绿字 + `aria-pressed` 承接，图标不变实。
  - `HandStopIcon`（抓手/平移视图）→ 本地码点表与 fill 资产均无手形；首选补登记 Material `pan_tool`（补码点 + rounded fill SVG）；本期不补子集则自绘手登记为领域例外，描边宽与收框对齐工具族。
  - 弹层选中勾由 lucide `Check` 14px 换 Material `check`（码点 `0xe668` + check-fill.svg 已登记），行内 16 档。
  - 对照盘点草图：`docs/visual-2026/icon-audit-2026-11-14.html`。
- 覆盖层字符按钮 `▢/◱` 换成已登记地图图标（`map`/`layers` 族），避免字体差异变形。
- 左轨拍摄场地自绘 camera 随整栏方案换 `photo_camera`（既有待定项，不属本轮右轨范围）。
- 图标尺寸收齐到 20（控件）/16（行内）；26px 现状核齐到 24 或 20。

### 5.5 地图控件角区归位（对照 Google / Mapbox / MapLibre 惯例）

地图控件与编辑器工具列分簇，不都塞进右轨一竖列：

| 角区 | 现状 | 建议 |
|---|---|---|
| 右上 | 交付钮 34px 内联 | 独立交付簇；换工具族基础类，去内联样式 |
| 右下 | 底图钮 34px；缩放 +/- 在右轨底部 | 底图钮 + 缩放 +/- 成右下地图簇（缩放随地图句柄 `zoomBy`）；罗盘在缩放上方或右上 |
| 左下 | 2D/3D 胶囊、比例尺、罗盘、署名 | 保持；署名/Logo 贴左下，比例尺左上或左下 |
| 右轨 | 撤销/重做、测量/标注/属性、选择、漫游、网格、氛围、导出 | 只留编辑器动作；地图图源/缩放归地图簇 |

> 待拍板：缩放钮是否从右轨底部挪到右下地图簇（地图惯例 vs 现状习惯，需真机对照）；罗盘落点。

### 5.6 层数控件口径

- 室内楼层：保留右轨 `.sc-floor-switcher`；外观向工具族令牌对齐（白胶囊 + 箭头柱现状是深色圆头，是否改白底圆钮二选一，见 §7）。
- 户外方案层：保留左栏头部 levels 胶囊 + 弹层；层级切换不回右轨上下三角。
- 若真机验收发现多层时需要快速上下切换，再在地图簇旁补同规格层级胶囊，不回退到室内楼层钮形制。

### 5.7 内联样式清理

- `outdoor-plan-overlay.tsx` 右上交付钮、右下底图钮、面板行的内联尺寸/边框/投影迁入 CSS 类，接 `PLANNING_SURFACE` 与全局令牌；`#tool-walk`/`#tool-grid` 的 `opacity .35` 内联迁到禁用类；楼层阻塞提示胶囊内联样式接 token。
- 主题切换时控件外观一并跟随，不再有硬值漏网。

## 6. 组件清单与逐组件落地节奏

对照 petitmaker 一个组件一个组件改；顺序按「令牌先行 → 右轨工具钮 → 地图簇 → 左轨收档 → 禁用/角标收口」：

| 步 | 组件 / 落点 | 改动 | 验收 |
|---|---|---|---|
| 1 | 令牌与基础类 | `globals.css` 抽 `--tool-*` 变量与 `.tool-btn` 基础类；业务零改动 | 现有视觉回归对照截图 |
| 2 | 右轨历史/视图 | undo/redo/zoom-out/zoom-in 接基础类 | 定向测试 + 真机钮清单 |
| 3 | 右轨画布工具 | select/measure/annotate/selection/walk/grid/environment-view 接类；禁用态收口 | 工具三态、禁用提示 tooltip |
| 4 | 右轨交付/氛围 | share/export/atmosphere 接类；条件出镜口径维持 | 弹层开合、aria-pressed |
| 5 | 地图簇 | 右上交付钮、右下底图钮去内联；字符图标换正式形；缩放归位待拍板 | 底图面板、缩放句柄 |
| 6 | 楼层切换器 | 形制对齐令牌；条件包裹现状维持 | 室内出镜/户外隐藏两态 |
| 7 | 左轨收档 | 26px 图标核档、disc 圆角对齐 `--r-sm`；不改选中绿条与三族 | 左轨既有测试不回归 |
| 8 | 禁用/角标/分隔收口 | 禁用类、角标类、sep 类全轨复用 | 无障碍走查：键盘焦点、aria-label |

每步：Node24 清 `tsconfig.tsbuildinfo` → `tsc --noEmit` 0 → 定向 vitest 绿 → dev 3210 真机探针；不引入 #12 基线新回归；攒本地验收后一次性推 main。

## 7. 待决策项

1. **工具钮槽位**：右轨/地图簇从 30/34 上收到 40，还是保留 30 圆钮 + 补足 32 触达（建议 40，对齐 M3 默认与规范 ≥32）。
2. **楼层胶囊形制**：现深色圆头箭头柱是否改成白底工具族圆钮；还是保留深色识别态。
3. **缩放钮归位**：留右轨底部，还是挪右下地图簇成组（建议挪地图簇，待真机对照）。
4. **跨栏选中表达**：左绿条（导航族）vs 右绿描边（工具族）维持两套族语义，还是工具族也改用其他选中表达；建议维持分工，只对齐令牌。
5. **图标族终态**：右轨自绘三枚（HandStop/MoveScene/GridSnap）哪些可换 Material、哪些登记领域例外，逐枚对照 `outdoor-tool-icons.ts` 定。
6. **户外方案层快速切换**：是否需要在地图簇旁补层级上下入口。

## 8. 参考网站与范式

**地图控件角区惯例**
- Google Maps Controls（缩放右下、地图类型左上、全屏右上）：https://developers.google.com/maps/documentation/javascript/controls
- Mapbox GL JS NavigationControl / AttributionControl：https://docs.mapbox.com/mapbox-gl-js/api/markers/
- MapLibre Native ornament 位置（logo 左下 / 署名 / 罗盘右上 / 比例尺左上）：https://maplibre.org/maplibre-native/ios/latest/documentation/maplibre/mlnmapview/

**按钮与图标规格**
- M3 Icon buttons guidelines（40dp 容器、toggle 双属性、tooltip 描述动作）：https://m3.material.io/components/icon-buttons/guidelines
- M3 Icon buttons specs（尺寸/形状/状态层比例）：https://m3.material.io/components/icon-buttons/specs
- Material Web icon-button tokens：https://material-web.dev/components/icon-button/

**组件库对照**
- Radix Toolbar（分组/分隔/toggle 语义基座）：https://www.radix-ui.com/primitives/docs/components/toolbar
- shadcn/ui Toolbar：https://ui.shadcn.com/docs/components/toolbar
- Ant Design Button（按钮五态与禁用口径）：https://ant.design/components/button
- Lucide（仅作线条族对照；本项目通用图标仍以本地 Material Rounded 为准）：https://lucide.dev

## 9. 附录 · 代码索引

- 右轨：`frontend/components/room-organizer/panels/scendance-workspace.tsx`（nav 682；楼层 684–697；分享 698–701；选择 707–725；2D/3D 729–733；测量/标注/属性 735–743；实景 745–751；漫游 754–757；网格 759–761；底图 766–806；地图类型/卫星 807–831；撤销重做 834–837；缩放 841–844；导出 847–867；氛围 869–901）
- 覆盖层：`frontend/components/room-organizer/components/outdoor-plan-overlay.tsx`（右上交付 491–525；右下簇 529–658）
- 左轨组装：`frontend/components/room-organizer/room-organizer.tsx`；子组件 `panels/workbench-brand-toggle.tsx`、`bingo-rail-button.tsx`、`rail-team-block.tsx`、`settings-menu.tsx`、`cloud-panel.tsx`
- 样式：`frontend/app/globals.css`（左轨 1097–1326；右轨 1645–1756）
- 图标映射：`components/outdoor-tool-icons.ts`、`components/solid-icons.tsx`、`panels/material-symbol.tsx`；IconPark 缩放 `frontend/public/icon-park/`
- 地图控件：`components/geo-scale-compass.tsx`、`components/outdoor-view-switch.tsx`
- 关联计划：`2026-11-12-sidebar-entry-unification.md`、`2026-11-13-outdoor-map-unification.md`、`2026-11-13-outdoor-map-decommission.md`
