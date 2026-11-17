# 2026-11-16 工作台 UI / 设计系统审计（只读）

> 状态：**只读审计，未改任何代码，未 commit / push / 部署。**
> 基线：`C:\幕景\Scendance2026` 当前工作树磁盘实读（`frontend/`），对照 `docs/05-设计规范.md` v2.5.12、`docs/visual-2026/` 图标与工具轨审计、`docs/plans/tool-rail-unification-2026-11-13.md`、`docs/plans/2026-11-16-main-sync-and-prop-actions.md` §B2 / §D1。
> 取证方式：源码与 CSS 选择器逐条核对；**本轮未启动 dev server、未采集新截图**。每条给出可直接在 DevTools 定位的选择器与建议截图名，执行者按 1440×900 / 768×1024 / 375×812 三档补图归档即可。
> 约束：只出设计判断与 CSS / 结构建议；不碰业务逻辑、状态机、接口；不直接改 `outdoor-plan-3d.tsx` / `outdoor-plan-canvas.tsx` / `room-organizer.tsx` / `scendance-workspace.tsx`。
> 基线提醒：工作树本身已有未提交 WIP（`git status` 含 `globals.css`、`outdoor-plan-3d.tsx`、`outdoor-plan-canvas.tsx` 等），本稿一律以**磁盘当前内容**为准，不以 HEAD 为准；审计过程未写入这些文件。

---

## 0. 结论先行

当前工作台不是「没有设计系统」，而是**同一套系统在三处各说各话**：

1. **Token 真相分裂。** `--plane` 在代码里是 `#FFFFFF`（`globals.css:56`），在规范里是 `#F4F5F7`（`05-设计规范.md:41`），而 `outdoor-plan-tokens.ts` 又把 `fieldBg` 写成 `#f4f5f7` 并注明「= --plane」。结果：**所有靠 `--plane` 表达的 hover / 禁用底在白色面板上等于没有底**，组件只好各自补 hex，越补越多。
2. **触达尺寸系统性低于硬下限。** 规范禁「可点击区域小于 32px」（`05-设计规范.md:128`），现状桌面同屏并存 30 / 29 / 28 / 27 / 16×32 五种，只有移动端工具条老老实实 44。
3. **第二套品牌色被整体搬进来。** 右下角是「Google Maps 网页版一比一复刻」（`globals.css:2204` 注释自述），带进 `#f9ab00` / `#1a73e8` / `#202124` / `#5f6368` / `#dadce0` 与蓝色焦点环、蓝色投影。产品规范只允许品牌绿两处点睛、禁彩色投影，这一簇同时破了三条。
4. **面板各自建私有设计系统。** 生成面板一个卡片内 7 档字号（9.5–13）、5 种圆角；分享面板 6 档字号、5 种圆角；工作台样式表硬编码 `font-size` 303 条、19 个取值，圆角 21 个取值。
5. **图标族与档位没收口。** Material + lucide + 自绘同列混排（`#tool-select` 菜单里同屏三族），15 / 14 / 13 / 18 / 11 / 12 六个中间档仍在。

这五条不解决，后面逐组件改只会继续长新特例。

---

## 1. 基线：规范硬规则 vs 代码实际值

| 维度 | 规范硬规则 | 代码实际 | 判定 |
|---|---|---|---|
| 中性色 `--plane` | `#F4F5F7`，用于 hover / 禁用底（规范 §一.1） | `--plane: #FFFFFF`（`globals.css:56`）；同文件注释又写「禁旧奶油 #F4F5F7」 | **冲突** |
| 字号 | 仅 7 档：24/20/16/14/14/12/11；同区 ≤3 档；禁私有字号（规范 §二） | 工作台样式表（`globals.css` + `panels/*.css`）硬编码 303 条、19 个值（8–40px），含 9.5 / 10.5 / 11.5 / 12.5 / 13.5 | **违规** |
| 圆角 | `--r-sm 10` / `--r-md 14` / `--r-lg 18`；禁 <4px；禁超半高胶囊（发送键除外） | 同一批样式表 21 个取值；`6px`×44、`8px`×71 为主，另有 1/2/3/4/5/7/9/11/12/16/17/20/22/24 | **违规** |
| 阴影 | E0 无 / E1 `0 6px 18px .10` / E2 `0 16px 48px .18` / E3 `0 1px 2px .06`；禁彩色投影（规范 §一.4） | 出现 `0 10px 26px .10`、`0 4px 14px .10`、`0 8px 28px .08`、`0 18px 48px .26`、`rgba(26,115,232,.22)` 蓝投影 | **违规** |
| 图标 | 16 行内 / 20 控件 / 24 面板空态 / 32 整页；一列不混族；禁未登记描边（规范 §一.4） | 24 左轨 / 20 工具 / 18 折叠箭头 / 15·14 菜单 / 13 Bingo / 11·12 户外 token / 8 副标 | **违规** |
| 触达 | ≥32px；禁小热区（规范 §一.4 禁则） | 30 / 29 / 28 / 27 / 16×32 同屏并存 | **违规** |
| 品牌绿 | 全产品只两处：选中指示、发送键；静息不用绿 | 漫游钮静息为 Google 黄 `#f9ab00`；选中为 `#e8f0fe` + `#1a73e8` 蓝环 | **违规** |
| 空态 | 面板空态最小高 150，24 图标 + H3 + P2 + 一个动作（规范 §三.5） | 左栏空态是单行 CAP 文案（`.sc-lib-empty`），无图标无动作 | **违规** |

> 说明：规范文件与 `globals.css` 顶部的「冷石画廊白」注释本身也互相矛盾（一边写「底·画布 #F4F5F7」，一边写「禁旧奶油 #F4F5F7」）。这不是执行问题，是**规范文本需要先拍板**，见 §8 决策 1。

### 1.1 与 11-14 审计文档的差异（已修 / 未修 / 新增）

| 11-14 审计结论 | 当前磁盘 | 状态 |
|---|---|---|
| 左轨槽位圆角 12 偏离 r-sm 10 | `globals.css:1347` 已 `border-radius:10px` | ✅ 已修 |
| 左轨 capture 26 / Bingo 13 越档 | glyph 已 24；Bingo svg 仍 13 | ◐ 半修 |
| 右轨 30×30 | 桌面 34×34（`globals.css:1835`），≤640 高 26 | ◐ 已改但仍不统一 |
| 覆盖层 34×34 | 现 30（右上）/ 29（右下） | ◐ 越改越小 |
| 禁用三套 `.45/.35/.55` | 现 `.7/.55/.55`（`1849/1832/2120/2933`） | ❌ 未统一，只换了数值 |
| 静息态品牌绿（漫游钮深绿字） | 现改为 Google 黄 + 蓝环 + 伪阴影 | ❌ 更严重 |
| 字符图标 ▢ / ◱ | 已移除，换正式图标 | ✅ 已修 |
| `opacity:.35` 内联 | 已移除 | ✅ 已修 |
| 覆盖层内联样式 | 2D 工具栏卡仍是 inline；3D HUD 全 inline | ❌ 未动 |
| 图标三枚自绘 | `HandStopIcon` / `MoveSceneIcon` / `GridSnapIcon` 仍在用 | ❌ 未动 |

---

## 2. P0 · 阻断级（先修这 5 条，否则后续每个组件都在补特例）

### P0-1 `--plane` 双值：hover / 禁用底在白色面板上消失

- **页面 / 组件**：全站；左轨悬停、左栏卡 hover、禁用按钮、菜单 hover、户外卡 hover。
- **文件 / 选择器**：`frontend/app/globals.css:56`；消费点如 `.sc-mode-rail button:hover`（`globals.css:1311`）、`.sc-mode-rail button:disabled`（`1322`）、`.sc-tool-column > button:disabled`（`1849`）、`.oc-cluster button:disabled`（`2120`）、`.sc-aholo-card:hover`（`1540` 附近）。
- **证据**：
  - `--paper:#FFFFFF`、`--plane:#FFFFFF` 两值相同（`globals.css:55-56`）。
  - 规范要求 `--plane:#F4F5F7`（`docs/05-设计规范.md:41`），`outdoor-plan-tokens.ts` 的 `PLANNING_SURFACE.fieldBg:'#f4f5f7'` 注释亦写「= --plane」。
  - 大量写法用 `var(--wk-plane, #f4f5f7)` 兜底，但变量存在，兜底永远不生效。
- **设计判断**：hover 与禁用是「按钮五态」的两态；底色与纸面同值等于取消这两态。左轨按钮无描边无投影，hover 只剩字色变化，触控/鼠标反馈弱于规范预期；禁用按钮只剩 faint 字，用户难以区分「不可用」与「次要」。
- **建议改法（CSS / 结构）**：
  1. 先拍板 `--plane` 取值（建议按规范 `#F4F5F7`），只改 `:root` 一处；
  2. `--plane-deep` 保持 `#ECEDEF` 做 pressed；
  3. 删除 `globals.css` 顶部「禁旧奶油 #F4F5F7」的自相矛盾注释；
  4. 全仓把 `var(--wk-plane, #f4f5f7)` 的兜底去掉，避免掩盖变量缺失；
  5. 加一条视觉回归：左轨 hover / 禁用、左栏卡 hover、菜单 hover 四处截图对比。
- **验收**：`getComputedStyle(document.documentElement).getPropertyValue('--plane')` 为 `#F4F5F7`；左轨 hover 与纸面有可测色差（ΔE > 2）；禁用按钮与常规按钮底色不同。

### P0-2 触达尺寸系统性低于 32px 硬下限

- **页面 / 组件**：户外 2D 右上分享簇、右下地图簇、罗盘转向箭头、分享/交付面板动作行、生成面板底部动作、工具菜单行。
- **文件 / 选择器**：
  - `.oc-cluster.oc-tr button` 30×30（`globals.css:2141`；`#tool-share` 同为 30，`2147`）
  - `.oc-gmaps button.oc-gm-round` 29×29（`globals.css:2208` `--oc-gm-control:29px`）
  - `.oc-gm-turn` 16×32（`globals.css:2250-2256`，`calc(29px*.55)` × `calc(29px*1.1)`）
  - `.sc-publish-actions > button` 约 27 高（`globals.css:2921-2928`，padding 6+9、字号 11.5）
  - `.gs-actions` / `.gs-primary` 28 高（`generation-sheet.css`）
  - 菜单行图标 15、勾 14（`scendance-workspace.tsx:1020-1022`）
- **证据**：规范禁则明写「可点击区域小于 32px」（`05-设计规范.md:128`）；`main-sync §B2.3` 对罗盘的验收口径是「44px 级别、左右热区可点」，与 16×32 直接矛盾。
- **设计判断**：这不是「略小」，是**同一屏五种尺度的工具钮**：移动端工具条 44 / 桌面右轨 34 / 右上分享 30 / 右下地图 29 / 罗盘箭头 16×32。用户在不同角区对「一颗工具钮该多大」没有稳定预期；小热区在 1440 下尚可点，在 768 触屏与手写笔场景直接掉到可用性线下。
- **建议改法（CSS / 结构）**：
  1. 建 `--tool-size`：桌面 36（或 40），紧凑 ≤640 高 32，移动 44；`--tool-hit` 用伪元素把视觉 30 的钮热区补到 44，不改视觉直径；
  2. 罗盘左右箭头改为**整圆四象限热区**（结构：`.oc-gm-compass-wrap` 内 4 个 `button`，各占 44×22 或 22×44，视觉只画两枚箭头），满足 B2.3；
  3. 分享面板动作行最小高 34，字号回 12；生成面板动作 32–36；
  4. 菜单行图标统一 16、勾 16（Material `check`）。
- **验收**：`document.querySelectorAll('button')` 中，可见且非文字的按钮 `getBoundingClientRect()` 宽高均 ≥32（桌面）/ ≥44（375 触控档）；罗盘四向热区均 ≥44×22。

### P0-3 右下角搬进第二套配色：Google Maps 一比一复刻

- **页面 / 组件**：户外 2D 右下地图簇（罗盘 / 缩放 / 2D-3D / 定位 / 漫游 / 看图）、地图详情面板、地图类型弹层。
- **文件 / 选择器**：
  - `.oc-cluster.oc-gmaps`（`globals.css:2204-2440`）：`--oc-gm-shadow-active` 用 `#1a73e8` 蓝环 + `rgba(26,115,232,.22)` 蓝投影；罗盘 `background:#202124`、图标 `#f1f3f4`
  - `.oc-gm-walk` 静息 `#f9ab00`，选中 `#e8f0fe` + 蓝环（`2559-2570`）
  - `.oc-map-details` 用 `#202124 / #3c4043 / #dadce0 / #9aa0a6 / #f1f3f4`（`2032-2090`）
  - `.sc-map-type-row.is-active` 用 `#2f6bff`、名称 `#1d4ed8`（`2800` 附近）
- **证据**：规范只允许品牌绿两处点睛、语义色只做状态文字/描边、**禁彩色投影**（`05-设计规范.md:34/54/149`）。当前同屏出现绿、Google 蓝、Google 黄三套强调色，且蓝环是「选中」的第二套语义。
- **设计判断**：几何与信息架构（29/44、右下角列、罗盘单独）可以借 Google，**颜色不能借**。现在用户看到的不是「幕景的地图控件」，是「嵌了 Google 控件的地图」。更糟的是蓝环只出现在漫游/地图控件上，和右轨绿描边选中态形成两套「选中」语言。
- **建议改法（CSS / 结构）**：
  1. 保留 `--oc-gm-*` 几何变量，新增颜色变量并全部映射到 token：`--oc-gm-bg: var(--paper)`、`--oc-gm-fg: var(--ink-soft)`、`--oc-gm-active-ring: var(--green)`、`--oc-gm-shadow: var(--e3)`；
  2. 罗盘深底改 `--ink`（保留可读性），指针红保留为地理语义例外；
  3. 删除 `#1a73e8` / `#f9ab00` / `#e8f0fe` / `#2f6bff` / `#1d4ed8` 全部出现；
  4. 漫游钮与室内 `#tool-walk` 用同一套：静息 `ink-soft`，选中绿边 + `green-deep`。
- **验收**：上述样式段内 grep 无 `#1a73e8|#f9ab00|#e8f0fe|#2f6bff|#1d4ed8|#202124|#5f6368`；选中态颜色只有 `--green` 一种语义。

### P0-4 生成面板自成一套私有设计系统

- **页面 / 组件**：左栏「生成」卡片（`GenerationSheetHost`）。
- **文件 / 选择器**：`components/room-organizer/panels/generation-sheet.css` 全文；`.sc-generation-card .gs-*`。
- **证据**（同一张 320px 卡内）：
  - 字号 7 档：9.5（`.gs-kbd`）、10（`.gs-file` / `.gs-foot`）、10.5（`.gs-task-text small` / `.gs-link` / `.gs-hint`）、11（`.gs-seg button` / `.gs-field` / `.gs-credit`）、11.5（`.gs-drop-text strong`）、12（`.gs-question` / `.gs-task-text strong` / 输入）、13（`gs-head strong`）；
  - 圆角 5 种：5（kbd）、6（seg / field）、7（actions）、8（icon tile / seg）、10（task / composer）；
  - 局部 hex 15+：`#5b6067` `#3f4249` `#9aa0a7` `#a8641a` `#3c6a4d` `#c8d3c8` `#fafafb` `#f7f7f8` `#cfd8cf` `#f2f6f2`；
  - 禁用 `.gs-primary[disabled]{opacity:.55}`，又一套禁用口径；
  - 焦点用 `box-shadow:0 0 0 3px rgb(74 124 89 / 8%)`，是彩色投影。
- **设计判断**：规范明写「禁止面板自建私有字号系统」「同区同时可见字号 ≤3 档」。生成面板是本次审计里最典型的反例：一个卡片内 7 档字号 + 5 种圆角，视觉上会显得「碎、软、不像主产品」。
- **建议改法（CSS / 结构）**：
  1. 字号压到 3 档：卡头 14/600、正文 12/400、提示 11/400；`9.5/10.5/11.5` 全删；
  2. 圆角只留 `--r-sm`（任务行 / 输入 / 分段容器）与 `--r-md`（外层）两种；kbd 用 4px 例外需登记，或直接去掉 kbd 样式；
  3. 颜色全部接 `--ink` / `--ink-soft` / `--wk-muted` / `--hair` / `--plane` / `--warn` / `--green`；
  4. 禁用走统一类，去掉 `opacity:.55`；
  5. 焦点环改 `outline:2px solid var(--ink-soft)`，不用绿光晕。
- **验收**：该文件 `font-size` 唯一值 ≤3；`border-radius` 唯一值 ≤2（不含 999）；无裸 hex；禁用无 opacity。

### P0-5 禁用态与选中态口径不统一（含「2D/3D 永远显示选中」）

- **页面 / 组件**：右轨楼层箭头、右轨通用钮、户外簇按钮、分享主按钮、生成主按钮、2D/3D 钮。
- **文件 / 选择器**：
  - `.sc-floor-switcher-arrows button:disabled{opacity:.55}`（`globals.css:1832`）
  - `.sc-tool-column > button:disabled{opacity:.7}`（`1849`）
  - `.oc-cluster button:disabled{opacity:.7}`（`2120`）
  - `.sc-publish-primary:disabled{opacity:.55}`（`2933`）
  - `.gs-primary[disabled]{opacity:.55}`（`generation-sheet.css`）
  - `#tool-2d3d` 的 `className="is-active"` 恒定（`scendance-workspace.tsx:1030`），只有 `aria-pressed` 随状态变
- **证据**：规范禁用 = `--plane` 底 + `--faint` 字 + `opacity:1`（`05-设计规范.md:157-164`）。现状两个透明度值（.55 / .7）+ plane 底（等于白）+ faint 字。
- **设计判断**：整钮降透明度会让禁用按钮「看起来像加载中/被遮住」，而不是「明确不可用」；更严重的是 `#tool-2d3d` 永远绿边，用户在 2D 下会以为当前是 3D。选中态是画布工具最关键的反馈，不能靠 `aria-pressed` 单独承担。
- **建议改法（CSS / 结构）**：
  1. 建 `.tool-btn` 基础类 + `[disabled]` 统一规则：`background:var(--plane); color:var(--faint); opacity:1; box-shadow:none`；
  2. 删除上述 4 处局部 opacity；
  3. `#tool-2d3d` 的 `is-active` 改为绑定 `showing3D`（纯 className 表达式，不动逻辑），或统一改成 `aria-pressed` 选择器 `[aria-pressed="true"]` 上色；
  4. 禁用按钮补 `aria-disabled` + `data-tip` 说明原因（楼层已有 title，可复用）。
- **验收**：禁用态计算样式 `opacity===1` 且底色为 `--plane`；`#tool-2d3d` 在 2D 下无绿边、3D 下有绿边；全站 `:disabled` 规则只剩一条来源。

---

## 3. P1 · 高优（统一体系，影响观感与可访问性）

### P1-1 字号体系：303 条硬编码、19 个取值、同区超 3 档

- **页面 / 组件**：全站；重灾区为分享面板、生成面板、户外属性卡、地图详情、漫游 HUD。
- **文件 / 选择器**：`app/globals.css`、`panels/*.css` 全量；`.sc-publish-card`（10 / 10.5 / 11 / 11.5 / 12 / 13）、`.oc-map-details`（10 / 11 / 12 / 14 / 15）、`.gs-*`（9.5–13）、属性卡（10 / 11 / 12）。
- **证据**：`font-size: Npx` 共 303 条，取值 8/9/9.5/10/10.5/11/11.5/12/12.5/13/13.5/14/14.5/15/16/18/20/28/40；规范只允许 7 档（`05-设计规范.md:88`）且同区 ≤3 档（`:90`）。
- **设计判断**：0.5px 级差在 1x 屏不可辨、在 2x 屏只会让基线跳动；面板之间「标题谁大谁小」失去可比性。这是「看起来不统一」的最大来源，比颜色更明显。
- **建议改法**：
  1. 以 `--fs-h3/--fs-p1/--fs-p2/--fs-cap` 为唯一来源，面板内最多用 3 档；
  2. 10 / 10.5 / 11.5 / 12.5 / 13.5 全部就近归并（10→11、10.5→11、11.5→12、12.5→12、13.5→14）；
  3. 建立 stylelint 规则禁 `font-size: Npx`（只允许 token），先 warning 后 error；
  4. 分享/生成/属性三处作为样板先改。
- **验收**：六个面板内 `font-size` 唯一值 ≤3；全站裸 `font-size: Npx` 递减到 0。

### P1-2 圆角体系：21 个取值，6/8px 占主导

- **页面 / 组件**：全站；生成、分享、地图详情、属性卡、缩略图、kbd。
- **文件 / 选择器**：`.gs-*`（5/6/7/8/10）、`.sc-publish-*`（7/8/10/999）、`.oc-map-details`（8）、属性卡（8/12）、`.sc-tool-key`（4）。
- **证据**：`border-radius: Npx` 取值 1/2/3/4/5/6/7/8/9/10/11/12/14/16/17/18/20/22/24/99/999；其中 6px 44 次、8px 71 次，规范档 10/14/18 反而少。
- **设计判断**：产品语言是「厚实圆角、宁大勿小」，现状视觉读起来是「2px 网格的编辑器 UI」。同一张分享卡里 7/8/10/999 四种圆角，边界会显得随手。
- **建议改法**：
  1. 主档只留 10 / 14 / 18；缩略图与地图瓦片允许 8（登记为「图像例外」）；kbd 允许 4（登记为「键帽例外」）；
  2. 删除 5/6/7/9/11/12/16/17/20/22/24；
  3. 胶囊统一 999（chips / 分段 / 圆钮），不再出现 99。
- **验收**：全站圆角唯一值 ≤6（10/14/18/8/4/999），且每类都有登记理由。

### P1-3 六面层级与卡头基线不一致

- **页面 / 组件**：左栏卡片、生成卡、属性卡、分享卡、工具轨、地图簇。
- **文件 / 选择器**：`.sc-left-heading{min-height:40px}`（`globals.css:974`）、`.gs-head{height:48px}`（`generation-sheet.css`）、属性卡头部 `padding:6px`（`outdoor-plan-canvas.tsx:11517`）、`.sc-tool-column` 宽 44 `right:12 top:12`（`globals.css:1793`）、`.oc-tr{top:14;right:20}`（`1977`）、`.oc-br{bottom:20;right:20}`（`1978`）。
- **证据**：同类「卡片头」40 / 48 / 约 32 三种高度；卡片内边距 16（左栏）、12（生成）、6+（属性卡）；右上角同时存在 30px 分享簇与属性卡（12 圆角、26px 图标块），没有统一角区栅格。
- **设计判断**：用户扫视左栏时，卡片头高低跳动会让「标题—内容」的节奏断裂；右上角三件套（分享、属性卡、搜索条）各自定位，缺少 8px 模数的角区规则。
- **建议改法**：
  1. 卡头统一 48px（含 16 左右内边距），卡体 padding 16；
  2. 角区建 8px 栅格：右上 `top:16 right:16`、右下 `bottom:16 right:16`、左下 `bottom:16 left:16`，所有簇/卡只允许贴这四个锚点；
  3. 右上分享簇与属性卡改成同一列 flex（分享在上、属性卡在下），或属性卡固定 `top: 64` 起排。
- **验收**：1440 下四个角区元素的 `getBoundingClientRect()` 边距均为 8 的倍数；卡头高度只有 48 一种。

### P1-4 图标越档与混族

- **页面 / 组件**：左轨、右轨工具菜单、分享面板、属性卡、Bingo、户外图例。
- **文件 / 选择器**：
  - `HandStopIcon size={15}` + lucide `Check size={14}` + Material `near_me` 同菜单（`scendance-workspace.tsx:1016-1022`）
  - 属性卡折叠箭头 18（`outdoor-plan-canvas.tsx:11548`）、关闭 18（`11560`）
  - Bingo svg 13（`globals.css:1388`）、3D 副标 8px（`1373-1378`）
  - `PLANNING_ICON_SIZES = { legend:12, capsule:11, tool:12 }`（`outdoor-plan-tokens.ts`）
  - 分享面板 `Upload 15 / Copy 15 / ExternalLink 15`，漫游组 `Copy 14 / ExternalLink 14`（`share-menu.tsx:443-461`）
- **证据**：规范档 16/20/24/32；现状 8/11/12/13/14/15/18 七个中间档；同一菜单三族混排（Material + lucide + 自绘）。
- **设计判断**：图标是工具栏的「字重」；同列不同族/不同档，视觉上像拼贴。15 与 16 的差别用户说不清，但会觉得「有的图标糊、有的锐」。
- **建议改法**：
  1. 档位只留 16（行内）/ 20（控件）/ 24（左轨、面板空态）/ 32（整页空态）；
  2. 菜单行统一 16，勾换 Material `check` 16；
  3. 属性卡折叠/关闭 18 → 16；Bingo 13 → 16 或登记为徽标例外；3D 副标 8px 文字改为 10px 且登记；
  4. 三枚自绘按 11-14 审计去向收编：`open_with` / `grid_3x3` / `pan_tool`（缺资产则登记例外，描边 1.6、收框 80%）。
- **验收**：图标尺寸集合 ⊆ {16,20,24,32}（例外≤2 且登记）；`#tool-select` 菜单内只剩一族。

### P1-5 空态、加载态、错误态各写各的

- **页面 / 组件**：左栏物料空态、3D 空场提示、地图底图失败、分享未发布、二维码生成中/失败、搜地点加载。
- **文件 / 选择器**：
  - `.sc-lib-empty`（`workbench-shelf.css:502`）单行 CAP，无图标无动作
  - 3D 空场 `outdoor-3d-empty-hint`：深色胶囊 toast（`outdoor-plan-3d.tsx:2443`）
  - 底图未取到：深色胶囊（`outdoor-plan-3d.tsx:2609`）
  - 分享空态：`emptyCopy.web / emptyCopy.walk` 文案（`share-menu.tsx:451/464`），视觉是 P 行
  - 二维码 pending/failed：虚线框 + warn（`globals.css:2940-2949`）
  - 搜地点 spinner：`.sc-plan-place-search-spinner`
- **证据**：规范空态 = 24 图标 + H3 + P2 + 一个动作，面板最小高 150（`05-设计规范.md:233-247`）；加载 = plane 呼吸 1.2s；失败 = 描边换 err + ghost 重试。
- **设计判断**：现在有三种「空」：单行灰字、深色浮胶囊、虚线框。用户无法形成「这里是空的」的统一识别；3D 空场用深色 toast 更像报错，而不是引导。
- **建议改法**：
  1. 建 `.sc-empty`（面板）/ `.sc-empty--inline`（行内）两个结构：图标 24 + 标题 16 + 说明 12 + 一个 ghost 动作；
  2. 3D 空场提示改为画布居中的浅色空态卡（白底 hair 边），不用深色 toast；
  3. 加载统一 skeleton（plane 块 1.2s 呼吸），spinner 只用于 ≤2s 的局部刷新；
  4. 失败统一 err 描边 + 原位重试，不弹 toast。
- **验收**：三处空态共用同一 class；面板空态高度 ≥150；失败态有可点的重试。

### P1-6 断点碎片化，768 档出现「反向跳变」

- **页面 / 组件**：整个工作台外壳。
- **文件 / 选择器**：`globals.css` 的 `@media`：768（18 处）、760（4 处）、720、680、480、340、1080、1081；`mobile-shell.css:18` 的 768。
- **证据**：
  - 761–768px 区间：移动外壳已生效（44px 工具条），但 760 以下的收窄规则没生效 → 底中条仍用 `max-width:calc(100vw-150px)`、按钮 34/38；到 760 突然变 30px、`-96px`。宽度越小按钮反而先大后小。
  - 地图簇 29px 在 ≤768 没有覆盖，仍小于 44 触控。
- **设计判断**：断点应是产品状态的分界（桌面 / 平板 / 手机），不是零散补丁。768 与 760 并存会让 iPad 竖屏（768）落在两套规则之间。
- **建议改法**：
  1. 只保留 3 个断点：`≤640`（手机）、`641–1024`（平板）、`≥1025`（桌面）；如必须 768，统一到 768，删除 760/720/680；
  2. 用容器查询（`.sc-canvas-stage` 已是 container）替代画布内部断点；
  3. 地图簇在 ≤768 补 40/44 覆盖。
- **验收**：`rg '@media \(max-width'` 唯一断点 ≤3；768 与 760 下底中条尺寸一致；iPad 竖屏无「按钮变大」。

### P1-7 分享/交付面板：一张卡里 5 种圆角、6 档字号、27px 按钮

- **页面 / 组件**：右上「分享」→ `sc-publish-card`（三受众 / 发布 / 二维码 / 导出）。
- **文件 / 选择器**：`.sc-publish-card`（`globals.css:2853` 起）、`.sc-publish-actions > button`（`2921`）、`.sc-publish-row > button`（`2969`）、`.sc-publish-tip p`（`2902`）、`.sc-publish-qr-frame`（`2935`）。
- **证据**：
  - 字号 10（kicker）/10.5（chip）/11（dt）/11.5（按钮、正文）/12（说明）/13（标题）；
  - 圆角 999（chip）/10（卡、预览）/8（按钮、二维码）/7（受众行）/5（预览角标）；
  - 动作按钮 padding 6×9 + 11.5 字 ≈ 27 高；
  - 预览底 `#F7F5F0`、字 `#4E544E`（`2907-2910`）是旧奶油/旧灰；
  - **发布后双栏没有小屏回退**：`.sc-publish-card.is-published .sc-publish-split{grid-template-columns:minmax(0,1fr) minmax(200px,240px)}`（`2867`）全站无媒体查询覆盖；375 下卡宽 351、内容 331，右栏最少 200，主栏只剩约 120px。
- **设计判断**：交付面板是客户面前最常出现的一屏，现在像「工具弹层」而不是「交付单」；5 种圆角 + 6 档字号让它在 640 宽两栏时显得密而碎。
- **建议改法**：
  1. 卡 `--r-md`，内部按钮/输入 `--r-sm`，chip 999，删除 7/5；
  2. 字号三档：13 标题 / 12 正文 / 11 kicker；
  3. 动作按钮高 34–36，主按钮 36；
  4. 预览底改 `--plane`，字 `--ink-soft`；
  5. 受众 tab 提到 34 高（对齐 `PLANNING_SEGMENTED` 的 34/13/600）；
  6. 发布后双栏加回退：`@media (max-width: 560px){ .sc-publish-split{grid-template-columns:minmax(0,1fr)} }`（或容器查询），375 下预览/二维码顺排。
- **验收**：该卡字号 ≤3 档、圆角 ≤4 种（含 999）；动作按钮 ≥34 高；无 `#F7F5F0`。

### P1-8 漫游 HUD：三条深色胶囊 + 全内联 + 375 必溢出

- **页面 / 组件**：户外 3D 漫游 HUD、交互提示、动作提示、纸面兜底提示。
- **文件 / 选择器**：
  - `outdoor-walk-hud`（`outdoor-plan-3d.tsx:2495`）：`top:16`、`whiteSpace:nowrap`、`fontSize:12/lineHeight:18`、`borderRadius:10`、`background:rgba(18,20,26,.72)`
  - `outdoor-walk-view` 按钮：`borderRadius:6`、`padding:2px 8px`（`2520-2530`）
  - `outdoor-interact-hint`：`top:56`、radius 10、键帽 radius 5（`2541`）
  - `outdoor-action-note`：`top:92`、radius 9（`2578`）
  - 纸面提示：`bottom:16`、radius 8（`2609`）
- **证据**：四条提示分别 10 / 10 / 9 / 8 圆角，padding 6×12 / 6×12 / 5×11 / 4×10；全部 inline；`nowrap` + 长中文（「接管中 · XX · WASD 移动角色 · 左键环绕 · 滚轮缩放 · Esc 退出漫游」）在 375 宽一定超视口。
- **设计判断**：漫游是沉浸态，HUD 应「少而稳」；现在顶部三条竖排常驻，信息密度接近调试面板，且和搜索条（left 16 top 16）、分享簇（right 20 top 14）抢同一带。375 下横排溢出会直接产生横向滚动或裁切。
- **建议改法（结构，不改相机/输入逻辑）**：
  1. 建 `.sc-walk-hud` 容器：`left:50%; top:12; transform:translateX(-50%); max-width:calc(100vw-32px); display:flex; flex-direction:column; gap:6`；
  2. 主 HUD 允许两行：第一行「接管中 · 名字」+ 视角按钮，第二行操作提示；`white-space:normal`；
  3. 交互提示与动作提示改为同一容器的第二/第三条，不再各自 `top:56/92`；
  4. 统一 radius `--r-sm`、padding 6×12、12/18 字号；键帽 radius 4 登记例外；
  5. 375 下只保留「WASD · Esc 退出」短句，长句收进帮助。
- **验收**：375×812 下 HUD `scrollWidth <= clientWidth`；四条提示共用 1 个容器、1 种圆角；无 inline style。

### P1-9 属性卡（户外工具卡）：投影超档、图标块/箭头越档

- **页面 / 组件**：户外 2D 右上「测量 / 标注 / 属性」三张卡。
- **文件 / 选择器**：`outdoor-plan-canvas.tsx:11490-11570`（卡片容器、头部、26px 图标块、18px 折叠箭头、28px 关闭）。
- **证据**：`borderRadius:12`、`boxShadow:'0 10px 26px rgba(20,24,32,.10)'`（非 E1/E2 档）、图标块 26×26 r8、折叠 18、关闭 28、计数 10px；字号来自 `PLANNING_TYPOGRAPHY`（12/11/10）。
- **设计判断**：属性卡是「面板」而不是「浮钮」，应走 `--r-md` + E1；26px 图标块既不是 24 也不是 20，和左轨 24、工具 20 都错位。
- **建议改法**：
  1. 卡 `--r-md`（14）+ `--e1`；拖动时 `--e2`；
  2. 图标块 24×24，内图标 16；折叠/关闭 16；计数 11；
  3. 头部高 44，padding 8×10；
  4. 字号 12/11 两档（标题/正文），去掉 10 的 hint。
- **验收**：三张卡投影只有 E1/E2；图标块 24；头部 44。

### P1-10 左栏空态与「加载中」缺统一结构（与 P1-5 同源，单列左栏）

- **页面 / 组件**：左栏「物料 / 空间 / 拍摄场地」卡片。
- **文件 / 选择器**：`.sc-lib-empty`、`.sc-compact-shelf .sc-material-empty`（`workbench-shelf.css:163/186`）。
- **证据**：空态 = `font-size:var(--fs-cap)` 单行 + 可选 svg，无标题、无动作；加载只有文字。
- **判断**：左栏是主入口，空态却比弹层还弱；用户第一次进来看到一行灰字，不知道下一步。
- **建议改法**：复用 P1-5 的 `.sc-empty--inline`，一行图标 16 + 一句 12 + 一个 ghost 动作（如「导入 GLB」「去物料库」）。
- **验收**：左栏三张卡空态均有动作入口。

---

## 4. P2 · 中低优（清理与规范化）

### P2-1 覆盖层与 3D HUD 的内联样式迁移

- **文件 / 选择器**：`outdoor-plan-3d.tsx`（HUD 四条、空态、dialog）、`outdoor-plan-canvas.tsx`（属性卡）、`outdoor-view-switch.tsx`（PLANNING_* 内联）。
- **判断**：主题变量接管不到，改一处要改四遍；也是 P1-8 的根因。
- **改法**：只做「样式搬家」——把 inline 提成 class，值先照抄，再逐条接 token；不动任何事件与状态。
- **验收**：上述文件 `style={{` 数量降到 ≤5（仅动态坐标例外）。

### P2-2 阴影超档与彩色投影清理

- **文件 / 选择器**：`0 10px 26px .10`（属性卡）、`0 4px 14px .10`（交付钮旧值）、`0 8px 28px .08`（`.sc-canvas-share`）、`0 18px 48px .26`（detached 浮窗）、`rgba(26,115,232,.22)`（漫游）、`rgb(74 124 89 / 8%)`（生成焦点）。
- **判断**：阴影是层级语言，不是装饰；现在有 5 套「浮起」。
- **改法**：静态卡 E0；浮层 E1；模态/抽屉 E2；左轨激活卡 E3；删除彩色投影。
- **验收**：`box-shadow` 唯一值 ≤4 + 1 个 focus ring。

### P2-3 旧色残留

- **文件 / 选择器**：`.sc-publish-shot{background:#F7F5F0}` / `.sc-publish-plan-ground{fill:#F7F5F0}` / `#4E544E`（`globals.css:2907-2910`）；`.sc-properties` 背景 `#f8fafc`（`905`）。
- **判断**：冷石白体系里混入暖奶油与蓝灰，截图对比会明显发黄/发蓝。
- **改法**：统一 `--plane` / `--hair-soft` / `--paper`。
- **验收**：全站无 `#F7F5F0` / `#f8fafc` / `#4E544E`。

### P2-4 低于 CAP 的文字档

- **文件 / 选择器**：`.sc-rail-3d-tag{font-size:8px}`（`globals.css:1373-1378`）、`.sc-rail-draft{font-size:10px}`（`1265`）、`.gs-kbd{9.5px}`、`.sc-publish-kicker{10px}`（`2878`）、`.sc-map-type-note{10px}`（`2850`）。
- **判断**：8–10px 中文在 1x 屏不可读，且 10px `#9aa0a7` 对白底对比约 2.5:1，不达 AA。
- **改法**：最小 11（CAP）；确需角标用 10 但仅限非信息性装饰，并保证对比 ≥4.5。
- **验收**：信息性文字最小 11px；对比达标。

### P2-5 图标资产缺口登记（承接 11-14 审计）

- **文件 / 选择器**：`HandStopIcon` / `MoveSceneIcon` / `GridSnapIcon`（`scendance-workspace.tsx:363/500/506`）；`material-symbol-codepoints.ts` 与 `public/material-symbols/rounded/`。
- **判断**：三枚自绘短期可留，但必须登记例外（用途、描边 1.6、收框 80%、尺寸 20），否则下一轮又会有人照着画第四枚。
- **改法**：按 `icon-audit-2026-11-14` 的去向表执行；缺 `open_with` fill 的补资产，缺 `pan_tool` 的补码点或登记例外。
- **验收**：`docs/visual-2026` 例外登记表与实际使用一一对应。

### P2-6 命名与文案层级

- **文件 / 选择器**：`图层`（左栏）vs `方案层`（levels）；`属性`（右轨）vs `工具与属性`（浮窗）vs `属性卡`；`分享` / `交付` / `发布` 三个词指同一链路。
- **判断**：同一功能三个名字，用户会在搜索/求助时对不上。
- **改法**：出 10 个术语的对照表，UI 文案与 aria-label 同步；不改逻辑。
- **验收**：grep 三个词，UI 文案只剩一种主称谓。

---

## 5. 六面层级与对齐：现状一张表

| 面 | 定位 / 尺寸 | 层级 | 对齐基线 | 主要问题 |
|---|---|---|---|---|
| 左轨 `.sc-mode-rail` | 64 宽；钮 40×40、glyph 24、r10 | `z40` | 顶 8、组间 1px、脚 border-top | 基本合规；3D 副标 8px、Bingo 13 越档 |
| 左栏 `.sc-left-column` | 240–480（默认 320）；卡头 40；padding 16/18 | `z31` | 卡头左 8/14 | 卡头 40 vs 生成 48；空态弱 |
| 右轨 `.sc-tool-column` | 44 宽；`right:12 top:12`；钮 34（`1793`/`1835`） | `z35` | gap 4、sep 20×1 | 与右上簇 30 / 右下 29 不同尺；`#tool-2d3d` 假选中 |
| 右上簇 `.oc-tr` | `top:14 right:20`；分享 30 | `z35` | 与搜索条中心对齐（注释） | 30 触达不足；与属性卡同角区无栅格 |
| 右下簇 `.oc-br` | `bottom:20 right:20`；29 / 罗盘 44 | `z35` | 列 gap 4 | Google 配色；29 触达；转向 16×32 |
| 左下 `.oc-bl` + 2D/3D | `.oc-bl`：`bottom:4 left:51`；2D/3D 胶囊 34（`OutdoorViewSwitch` 独立挂载） | — | 与比例尺/署名同带 | 34 高与分段 token 一致；署名 r6 偏小；胶囊仍是墨黑皮肤未接全局 |
| 属性卡 | inline `r12`、`0 10px 26px` | 40–80 | 头部 6 padding | 投影超档；26 图标块；与分享簇抢角 |
| 漫游 HUD | `top:16/56/92` 三条；nowrap | `z35` | 居中 | 溢出、4 圆角、全内联 |

**层级判断**：右轨、右上簇、右下簇、HUD 全是 `z35`。虽然当前各自在不同容器里不一定真叠，但一旦属性卡拖到右上、HUD 出现在 2D 覆盖层上方，谁压谁取决于 DOM 顺序而不是语义。建议定 5 层：画布 0 / 画布控件 30 / 工具轨与角区 40 / 卡片与 HUD 50 / 弹层 80 / 模态 100。

**对齐判断**：现在有 3 套对齐基线（8px 角区、12/14/20 角区、居中），但没有一套写进 token。建议把「角区内边距 16、卡头 48、卡体 16、控件 gap 8」四件事写成 `--sc-layout-*`，六面共用。

---

## 6. 三档视口专项

### 6.1 375×812（手机）

| 检查项 | 现状 | 判定 | 改法 |
|---|---|---|---|
| 顶部工具条 | 44×44、横向滚动、隐藏滚动条（`mobile-shell.css:58-75`） | ✅ 触控达标；◐ 右侧露出不完整、无渐隐提示 | 加右缘渐隐 + `scroll-snap`；末尾固定「更多」 |
| 右上分享簇 | 30×30（`globals.css:2154` 强制 30） | ❌ 触控不足 | 移动端 44，或伪元素补热区 |
| 右下地图簇 | 29×29、罗盘 44、转向 16×32 | ❌ 严重不足 | 移动端 40/44；罗盘四象限热区 |
| 底中工具条 | `max-width:calc(100vw-96px)`、按钮 30、可换行 | ◐ 能放下但按钮 30 | 提到 36–40，允许两行 |
| 左轨入口 | 48px 圆钮、弹层五格（`mobile-shell.css:150-205`） | ✅ | 保持；标签 12px 可读 |
| 左卡抽屉 | 72vh、底部 96+8 | ✅ | 保持 |
| 漫游 HUD | nowrap 长句、`top:16` | ❌ 必溢出 | 见 P1-8 |
| 分享面板 | `min(360,100vw-24)`；发布后仍强制双栏（右栏最少 200） | ❌ 375 下主栏只剩约 120px | 见 P1-7：双栏加 560 断点回退 |
| 横向溢出 | 多处 `max-width` 兜底做得不错 | ◐ HUD / 地图详情 340 断点需实测 | 验收 `scrollWidth<=375` |
| 安全区 | `env(safe-area-inset-*)` 已用 | ✅ | 保持 |

### 6.2 768×1024（平板竖屏）

| 检查项 | 现状 | 判定 |
|---|---|---|
| 外壳 | ≤768 走移动外壳（`mobile-shell.css:18`） | ✅ 方向对 |
| 工具条 | 44 高、横向滚动 | ✅ |
| 底中条 | 761–768 仍是桌面 `-150px` + 34/38；≤760 才变 30/-96 | ❌ 反向跳变（P1-6） |
| 地图簇 | 29px 未覆盖 | ❌ 触控不足 |
| 左栏 | 变成 72vh 抽屉 | ◐ 平板其实有空间做并排，但可接受 |
| 分享面板 | `.sc-publish-card.is-published` 640 宽，768 下可用 | ✅ |
| 断点归属 | 768 同时命中移动外壳与部分桌面规则 | ❌ 需统一断点 |

### 6.3 1440×900（桌面）

| 检查项 | 现状 | 判定 |
|---|---|---|
| 三栏 | 64 + 320 + 画布 1056 | ✅ 比例合理 |
| 右轨 | 44 宽贴右 12 | ✅ 不遮画布主内容；◐ 与右上簇 30 不同尺 |
| 右上角 | 搜索 44@left16 / 分享 30@right20 / 属性卡 | ❌ 缺角区栅格（P1-3） |
| 右下角 | 罗盘 44 + 29 列 + 底中条 | ❌ 配色与触达（P0-2/3） |
| 左下角 | 2D/3D 胶囊 34 + 比例尺/署名 r6 | ◐ 署名圆角与底色未接 token |
| 分享面板 | 360 宽 / 发布后 640 双栏 | ✅ 尺寸合理；◐ 内部字号圆角碎 |
| 生成面板 | 320 卡、7 档字号 | ❌ P0-4 |
| 键盘焦点 | 左轨/工具轨有 2px ink-soft 环；地图簇蓝环/白环 | ❌ 焦点环两套 |
| 对比度 | muted 4.6 ✅；faint 仅禁用；10px `#9aa0a7` ≈2.5 ❌ | ❌ 小字不达标 |

---

## 7. 状态与图标专项

### 7.1 禁用态清单（统一前）

| 位置 | 选择器 | 现状 | 应为 |
|---|---|---|---|
| 右轨通用 | `.sc-tool-column > button:disabled` | `opacity:.7` + paper 底 | plane 底 + faint + opacity 1 |
| 楼层箭头 | `.sc-floor-switcher-arrows button:disabled` | `opacity:.55`，箭头 `#919693` | 同上 |
| 户外簇 | `.oc-cluster button:disabled` | `opacity:.7` | 同上 |
| 分享主按钮 | `.sc-publish-primary:disabled` | `opacity:.55` | 同上 |
| 生成主按钮 | `.gs-primary[disabled]` | `opacity:.55` | 同上 |
| 选择工具关闭 | `#tool-select.is-off` | 虚线边 `#b8b8b0` | 保留（开关 ≠ 禁用），但虚线色接 `--faint` |

### 7.2 空 / 加载 / 错误态清单

| 场景 | 现状 | 问题 | 建议 |
|---|---|---|---|
| 物料空 | 单行 CAP | 无标题/动作 | `.sc-empty--inline` |
| 3D 未画红线 | 深色胶囊 | 像报错 | 浅色空态卡 + 「切回 2D 画一圈」 |
| 底图失败 | 深色胶囊 | 无重试 | err 描边 + ghost 重试 |
| 分享未发布 | 文案行 | 无图标，视觉弱 | 统一空态块（小尺寸） |
| 二维码生成中 | 虚线框 | ✅ 方向对 | 加 skeleton 呼吸 |
| 搜地点加载 | spinner | ✅ | 保持 |
| 生成中 | 仅按钮文案「正在生成…」 | 无进度/骨架 | 卡片级 skeleton |

### 7.3 图标族现状

| 族 | 用在哪 | 问题 |
|---|---|---|
| Material Rounded 实心 | 主体（左轨、右轨、分享、地图） | 主族，保持 |
| lucide 线性 | 分享面板 `Check/Copy/Upload/ExternalLink`、搜地点 `Search` | 与 Material 同列混排；15/14 越档 |
| 自绘描边 | `HandStopIcon` / `MoveSceneIcon` / `GridSnapIcon` / Pegman | 未登记；描边 1.6–2 不一 |
| IconPark 镜片 | 缩放 | 登记例外，可保留或收编 |
| Google 语义色 | Pegman 黄 `#f9ab00` + 蓝环 + 伪 3D 阴影 | 属第二套视觉语言，建议只保留形体、去 Google 色 |

---

## 8. 需要产品拍板的点

1. **`--plane` 到底取哪个值？** 规范 `#F4F5F7` vs 代码 `#FFFFFF`。建议按规范，否则 hover/禁用永远没有底。影响面：全站按钮态。
2. **工具钮统一到多大？** 建议桌面 36、移动 44、紧凑 32；地图簇不再保留 29。备选：桌面 40（更接近 M3），但右轨 44 宽要同步加到 48。
3. **Google Maps 复刻的边界。** 建议「几何与信息架构保留，颜色/投影/焦点环全部回品牌」。若坚持 1:1，需要修规范，承认第二套地图皮肤。
4. **圆角是否允许 8px 图像例外？** 建议允许缩略图/地图瓦片 8，其余只用 10/14/18；否则 71 处 8px 要全改，成本高。
5. **10px 字号是否彻底禁用？** 建议信息性文字最小 11；角标可 10 但需对比达标。涉及户外 hint、图例、生成 kbd、地图 note。
6. **分享面板动作行高度。** 建议 34–36；会影响 360 宽下的密度与 640 双栏排版，需要设计确认。
7. **属性卡三张是否允许并存？** 现在测量/标注/属性可同时开。若并存，右上角需要预留 3 张卡的列高；若互斥，交互更简单。
8. **漫游 HUD 常驻几条？** 建议主 HUD 一条（可两行）+ 交互提示按需出现；不要三条常驻。
9. **图标三枚自绘的终态。** 补 `pan_tool` / `open_with` 资产，还是登记例外？影响本轮能否把工具栏收成单族。
10. **左轨 26/24 档是否再降？** 当前已 24；若统一到 20，左轨会显得空，建议保持 24 并写进规范例外。

---

## 9. 建议执行顺序（每步可独立验收，不跨业务）

| 步 | 切片 | 改动范围 | 验收 |
|---|---|---|---|
| 1 | Token 拍板与修正 | `globals.css:55-56`、注释、`outdoor-plan-tokens.ts` 注释 | `--plane` 单值；hover/禁用四处截图 |
| 2 | 工具钮基础类 | 新增 `.tool-btn` / `--tool-size` / `--tool-hit`；右轨、地图簇、分享簇接类 | 触达 ≥32/44；选中态单一 |
| 3 | 地图簇去 Google 化 | `.oc-gmaps` 颜色变量、`#tool-walk`、地图详情、地图类型弹层 | grep 无蓝/黄；焦点环统一 |
| 4 | 三个面板收口 | 生成、分享、属性卡：字号/圆角/投影/禁用 | 每面板字号 ≤3、圆角 ≤3 |
| 5 | 空/加载/错误态 | 新增 `.sc-empty`，替换左栏、3D、分享 | 三处同构；面板空态 ≥150 |
| 6 | HUD 与断点 | 漫游 HUD 容器化；断点收敛到 3 个；375 复验 | 375 无横向溢出；768 不反向跳变 |
| 7 | 图标收编 | 菜单 16、勾 16、自绘三枚去向、登记表 | 图标尺寸 ⊆ {16,20,24,32} |

每一步都只动 CSS / className / 结构包裹，不动事件、状态、接口；改完跑 `tsc --noEmit` + 定向 vitest + 三档截图。

---

## 10. 验收口径（可直接执行）

前三条可直接跑；第 4、5 条需先把 `panel` / `disabledBtn` 换成本次要验的元素。

```js
// 1. Token 单值
getComputedStyle(document.documentElement).getPropertyValue('--plane').trim() === '#F4F5F7'

// 2. 可见按钮触达（桌面 ≥32，375 ≥44）
[...document.querySelectorAll('button')]
  .filter(b => b.offsetParent && b.getBoundingClientRect().width > 0)
  .map(b => [b.id || b.className, b.getBoundingClientRect()])
  .filter(([, r]) => r.width < 32 || r.height < 32)

// 3. 375 无横向溢出
document.documentElement.scrollWidth <= 375

// 4. 面板字号档数
const sizes = new Set([...panel.querySelectorAll('*')]
  .map(el => getComputedStyle(el).fontSize));
sizes.size <= 3

// 5. 禁用态不靠透明度
getComputedStyle(disabledBtn).opacity === '1'
```

截图归档建议命名：`audit/2026-11-16/{1440|768|375}-{tool-rail|left-card|share|generation|property|walk-hud|map-cluster}.png`。

---

## 11. 未覆盖 / 需真机复核

1. **未跑浏览器**：本稿所有判断来自源码/CSS；视觉重叠、真实换行、字体回退需在 1440/768/375 三档实测。
2. **右上角是否真叠**：属性卡宿主 `inspectorHostId` 在当前 workspace 未见挂载点，属性卡与分享簇是否互相遮挡需真机确认；P1-3 是「缺栅格」的结构判断，不是已证实的像素碰撞。
3. **768 底中条**：761–768 与 ≤760 的规则差异已确认，但具体重叠对象需截图。
4. **漫游 HUD 溢出**：按字符数与 `nowrap` 推断必超 375；需实测 `scrollWidth`。
5. **对比度**：`#9aa0a7` / `#a6aab2` / `#919693` 的对比值为估算，需用 axe 或对比工具复核具体字号/字重。
6. **键盘走查**：分享三栏有 roving tabindex（代码已实现），但地图簇、属性卡、HUD 的 Tab 顺序与焦点可见性未实测。
7. **未改共享进度文档**：本文件为新增 handoff，未触碰 `2026-11-16-outdoor-agent-progress.md` 等共享文档。

---

## 附：关键证据索引

- Token：`frontend/app/globals.css:55-56`（paper/plane）、`:75`（radius）、`:77`（e1）、`:93`（fs-cap）
- 左轨：`globals.css:1156-1420`（3D 副标 1373、Bingo 1388、hover 1311、disabled 1322）；`room-organizer.tsx`（组装）
- 右轨：`globals.css:1807-1880`；`scendance-workspace.tsx:996-1060`
- 地图簇：`globals.css:1977-1985`、`:2204-2440`
- 分享：`globals.css:2853-2985`；`share-menu.tsx:418-500`
- 生成：`generation-sheet.css` 全文
- 属性卡：`outdoor-plan-canvas.tsx:11490-11570`（r12 / 0 10px 26px / tile 26）
- 漫游 HUD：`outdoor-plan-3d.tsx:2495-2625`
- 户外 token：`frontend/lib/outdoor-plan-tokens.ts`（typography 10/11/12、icon 11/12、segmented 34/13）
- 规范：`docs/05-设计规范.md:34/41/88/90-95/128/130-149/157-164/233-247`
- 既有审计：`docs/visual-2026/style-audit-2026-11-14.html`、`icon-audit-2026-11-14.html`、`icon-system-audit-2026-11-14.html`
- 工具轨方案：`docs/plans/tool-rail-unification-2026-11-13.md` §2/§5
- 验收清单：`docs/plans/2026-11-16-main-sync-and-prop-actions.md` §B2.2/§B2.3/§D1
