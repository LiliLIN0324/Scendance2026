# 工作台外观模式（跟随系统 / 浅色 / 深色）

2026-11-19。用户反馈编辑器左侧面板一片纯白、长时间盯很亮眼，提出加外观模式：跟随系统、浅色、深色、跟随底图。结论：做三档，**不做「跟随底图」**；本任务只动前端工作台 chrome，不碰后端契约、画布渲染与导出产物。

## 成熟案例对照

- Figma（同品类设计编辑器）：Theme = Light / Dark / System 三档；入口在 Preferences > Theme，也可命令搜索；**主题只重绘 chrome（工具栏、面板、菜单、文件浏览器），画布与图层颜色保持原样**；主题设置按设备存本机，不同步到账号、不影响协作方。<RichMediaReference>["https://help.figma.com/hc/en-us/articles/5576781786647","https://wpdean.com/how-to-change-figma-to-dark-mode/"]</RichMediaReference>
- Next.js 无闪烁通行做法：`<head>` 内联阻塞脚本先读 localStorage + `prefers-color-scheme`，首帧前把主题 class 挂到根节点；生产构建靠这个，开发态 Strict Mode 重挂载后由 `useLayoutEffect` 再补一次。<RichMediaReference>["https://nextjs.org/docs/app/guides/preventing-flash-before-hydration","https://www.matthewswong.com/en/blog/dark-mode-nextjs-system-aware/"]</RichMediaReference>
- 本仓现状：Tailwind 已配 `darkMode: ['class']`；`globals.css` 有 shadcn HSL 三元组 + 冷石 L1 语义 token 两层；组件 CSS 经 `--wk-*` / `--sc-*` 别名消费 L1，符合 docs/05 §四 三层架构「出暗色只改 L0/L1，组件零改动」的前置条件。`.pc-glass--dark` 只用于两个浮层提示，不是全量暗色。

## 设计决定

1. **三档**：`system`（默认）/ `light` / `dark`。`system` 实时跟随 `matchMedia('(prefers-color-scheme: dark)')`，系统切换时自动重算。
2. **不做「跟随底图」**：面板亮度去读场地底图平均亮度，会把外壳和画布内容耦合，换图就来回翻色；自动推导的文字对比度无法保证 AA。日后若要压暗，单独留手动「面板压暗」开关即可，不进本期。
3. **本机存储，不走云端偏好**：Figma 主题即设备级。主题键独立存 localStorage（`scendance.appearance.v1`），不扩 `AccountPreferences` / `/preferences` PATCH 白名单，不改 Edge Functions 契约（项目规范：后端契约需人 review）。
4. **作用域 = 编辑器 chrome**：`.sc-workbench` 外壳、左轨、左卡抽屉、右栏、顶栏、工具菜单、设置/账户对话框、浮层提示。**不跟随主题**：2D/3D 画布渲染颜色、平面图/PDF/PNG/SVG/镜头单导出、官网/简介/定价/案例/分享查看页、登录页。
5. **挂载方式**：主题 class 挂 `document.body`（`is-theme-dark`）。设置对话框经 `createPortal` 挂到 `document.body`（cloud-panel.tsx:938），不在 `.sc-workbench` DOM 子树里，挂 body 才能让对话框一起变暗；编辑器卸载时移除 class，营销页不受影响。React context 跨 portal 传递状态。
6. **入口**：设置 → 个人 → 新增「外观」分组，「主题模式」行，分段控件 跟随系统 / 浅色 / 深色，复用现有 `sc-unit-seg` 样式。不另加顶栏快捷钮（二期再议）。
7. **暗色 token 只改 L1**：在暗色作用域内重映射 `--paper/--plane/--plane-deep/--hair/--hair-soft/--faint/--muted/--ink-soft/--ink/--green-*` 与 shadcn HSL 三元组；组件 CSS 不写暗色分支。审计并收编编辑器 chrome 里的硬编码白/近白字面量（如 `--sc-surface: #ffffff`、`#f8fafc` 兜底），改回 token。
8. **对比度**：暗色下正文/背景 ≥ 4.5:1、大字 ≥ 3:1（docs/05 §五）。暗色中性阶在实施时逐项核对；品牌绿在深底上调浅一档用于选中/主操作。

## 暗色中性阶提案（实施时按对比度复核微调）

| L1 token | 浅色现值 | 暗色提案 | 用途 |
|---|---|---|---|
| `--paper` | `#FFFFFF` | `#1C1F24` | 面板 / 卡片 / 输入底 |
| `--plane` | `#F4F5F7` | `#25282F` | hover / AI 气泡 / 禁用底 |
| `--plane-deep` | `#ECEDEF` | `#2D3038` | pressed 底 |
| `--hair-soft` | `#EFEFF1` | `#26292F` | 次级分隔线 |
| `--hair` | `#E4E4E7` | `#363A42` | 主分隔线 / 控件描边 |
| `--faint` | `#A6AAB2` | `#6B7078` | 禁用文字/图标 |
| `--muted` | `#71767E` | `#9BA1AC` | 辅助文字 / 占位 |
| `--ink-soft` | `#55585F` | `#C9CED6` | 次级文字 / 图标 |
| `--ink` | `#141416` | `#EDF0F2` | 主文字 |
| `--green` | `#4A7C59` | `#7FB58F` | 选中指示 / 发送 |
| `--green-deep` | `#35624A` | `#93C7A3` | 选中文字 |
| `--green-pale` | `#EEF3EF` | `rgba(74,124,89,.20)` | 选中底（小面积） |

## 实施清单

1. `frontend/components/room-organizer/lib/appearance.ts`：`AppearanceMode = 'system' | 'light' | 'dark'`；存储键、读写（走 `safe-storage`）；`resolveAppearance(mode, systemDark): 'light' | 'dark'`；纯函数可单测。**已落地。**
2. `appearance.test.ts`：默认值、三档解析、system 跟随、非法值回退。**已落地，7 例通过。**
3. `useAppearance()` / `useAppearanceOptional()` + Context：当前 mode / resolved / isDark / setMode；`useLayoutEffect` 同步 body class；`system` 模式订阅 `matchMedia` 变化。挂在 RoomOrganizer 根部，portal 对话框同上下文。**已落地。**
4. ~~`app/layout.tsx` 内联阻塞脚本~~ **本期不做（决策变更）**：编辑器 chunk 为 `ssr:false` 客户端加载，没有先于脚本画出的 SSR HTML 骨架；Provider 内 `useLayoutEffect` 在首帧前同步 body class 即可，无需在 `layout.tsx` 注入阻塞脚本，也不动营销页/登录页。
5. `globals.css`：`body.is-theme-dark` 作用域重映射 L1 hex + shadcn HSL 三元组；`.sc-workbench / .sc-cloud-dialog` 局部别名回挂 L1；主钮、品牌 tooltip、绿底/墨底按钮在暗色下反转；收编硬编码白值到 token。**已落地。**
6. `settings-page.tsx`：个人页「外观 · 主题模式」分段行；可选 props `appearanceMode` / `onAppearanceModeChange`。**已落地。**
7. `cloud-panel.tsx`：`useAppearanceOptional()` 取上下文传给 SettingsPage；对话框 class 跟随暗色作用域。**已落地。**
8. 文档：`docs/05-设计规范.md` §四.2 改为工作台 chrome 三档 scope + 暗色 token 表。**已落地。**

### 二轮 CSS 收编（本轮）

- 中性表面 / 文本字面量改回 token：splat 按钮与输入、物料卡 hover、@supports 兜底底、模式选择条、输入框底、生产汇总条、运行提示条、历史记录灰字、占位符、进度条、在线点、警告/错误文字等。
- 暗色反转覆盖组：墨底白字主钮（Agent 确认/发送/选择/场地查询、创作室生成与本人气泡、方案主钮、模式卡头部钮、执行清单主钮、操作主钮、计划主行动钮）→ `--primary / --primary-foreground`；绿底白字点睛钮（区域提案、完成步骤、发送工具、环境开关、确认钮、清单确认、分区选择、气泡发送、移动端发送钮）→ 深绿 `#35624A` 底白字（白字对比度 7.0:1）；未读徽标 → 深红 `#BF4F48`（4.74:1）。

### 遗留跟进（真机验收时再过一遍）

- 语义浅底 tint 面板在暗色下仍偏亮：`activity-task-suggestion-view.css` 警告/错误浅底、`commercial-dossier-panel.css` 警告/错误浅底、`agent-panel.css` 历史决策标签 rgba 浅底、`ap-head-status--think` 暖灰状态。需要时给 L1 补一组暗色 tint token（如 `--green-pale-dark`、`--warn-pale-dark`、`--err-pale-dark`），不在本批硬凑。
- 状态色点：在线/忙碌蓝点 `#0668e5`、决策灰，暗色下按语义复核明度。
- `capture-guide` 扫描流程组件、地图 attribution 文字与阴影、色板白描边、导出/渲染器配色，不在本轮 chrome 作用域，保持原色。

## 验证与边界

### 已跑命令（2026-11-19 夜）

- `npm --prefix frontend run typecheck`：通过（`tsc --noEmit` 无报错）。
- `appearance.test.ts`：7 例通过；改动关联面（appearance / cloud-panel.react / settings-menu.react）97 例通过。
- `npm --prefix frontend run lint`：0 error；既有 `import/order` 等 warning 为仓库基线，本轮新增文件无 error。
- `npm --prefix frontend run build`：静态导出成功，exit 0；oneplan 产物扫描违规 0。
- 全量前端套件本轮有基线失败（jsdom 缺 `ResizeObserver`、图例格式化、auth-js unhandled rejection 等），报告中无 appearance / Provider 相关失败；**推 main 前需在干净基线复跑一次对照**，确认失败集合不扩大。

### 2026-11-20 真机二轮（本地 dev 3210，系统偏好深色）

- 左轨图标激活态反黑已修：`solid-icons.tsx` 选中填充 `currentColor`（= 按钮 active 的 `--ink`），镂空细节走 `var(--paper)`；此前钉死 `#141416` 黑块压在暗色轨底、只剩一条白缝。浏览器复核：激活图标填充浅墨 `rgb(237,240,242)`，接缝/加号/大陆镂空压暗 `rgb(28,31,36)`；浅色档未回归。`solid-icons.react.test.tsx` 断言同步到 style 属性，5 例通过。
- 创作室 `generation-sheet.css` 补全暗色覆盖块：卡片壳、头部分段、输入/描述框、投放区、两张创建卡、开关、提示词框、主/次钮、场地档变体全部回挂暗色 L1 token。
- 工作台/对话框滚动条在暗色下回暗轨道（globals 通用规则，不碰地图控件）。
- Agent 面板残留（待真机复核）：`.ap-delivery-entry`（执行资料钮）、`.sc-task-example`（需求例句行）在工具会话内计算值仍显示 UA 白底；源码侧已加高特异性 + `!important` 暗色长手覆盖（字面量 #1C1F24/#25282F/#363A42/#EDF0F24），级联与选择器匹配已核对，但浏览器工具回读与实际 paint 不一致，需在真实浏览器再看一眼。`.btn-primary` 搜索地点钮按既有反转 primary 设计保留浅底深字。
- 本轮复核命令：`typecheck` 通过；`solid-icons / agent-task-examples / appearance` 共 15 例通过；`lint` 0 error（仅既有 import/order warning）。全量套件基线失败集合未逐项对照，推 main 前需干净基线复跑。

### 2026-11-20 真机三轮：户外地图 chrome 与浮层残留

- 全量 DOM 扫描（`.sc-workbench *` 计算背景，R/G/B>210）逐面板过：空间、物料、Bingo 左栏无白表面；户外/创作/Agent 残留集中在地图浮层与少数按钮。
- 已补 `globals.css` 暗色覆盖块（长手字面量兜底，避免按钮上 var 链回退 UA 白）：
  - `.oc-cluster` 容器回暗色纸面 + 暗描边 + 深投影；`.oc-gm-round`（2D/框选/漫游/眼睛）、`.oc-gm-zoom` 缩放条回 `#2D3038` 平面、`#363A42` 描边、`#C9CED6` 图标；罗盘 `#202124` 本就暗色，` :not(.oc-gm-compass)` 排除不被覆盖；眼睛 `.is-ghost-eye` 同回暗色平面。
  - `.oc-layer-entry` 左下图层卡回 `#25282F` + 暗描边；纸面格网 `--hair-soft`；`.oc-layer-strip` 弹层条、`.oc-map-details` 浮层回纸面，行文字跟墨色 token。
  - 户外图层行 `[data-testid="outdoor-levels-row"]` 与其 `levels-popover`：内联 `#fff` 表面/近黑字用 `!important` 压回暗色。
  - `.sc-left-close` 关闭钮、`.sc-share-trigger` 分享钮长手暗色兜底（含 active 绿描边态）。
  - `.oc-dock-handle` 底部「工具」把手长手暗色兜底。
- `generation-sheet.css`：`.gs-create-file-input` 由 clip 改 `display:none`，替掉浏览器原生「选择文件」白钮标签（label 仍可点开选择器）。
- `agent-panel.css`：`.ap-composer-field.ap-panel-field` 输入外壳、`.ap-add-menu` 加号浮窗回暗色纸面 + 暗描边。
- 复核命令：`typecheck` exit 0；`appearance` 7 例、`solid-icons` 5 例、`agent-task-examples` 3 例通过；`build` 静态导出 exit 0，oneplan 产物扫描 3375 文件违规 0。
- **待真实浏览器复核**（本 Aha 工具会话对按钮背景的 getComputedStyle/实绘存在已知不一致：规则能 matches、CSSOM 能查到 `!important` 暗色声明，回读仍可能是 UA 白）：右轨 2D/框选/漫游/眼睛钮、右上分享钮、左下图层卡、底部把手在真实 Chrome 是否随暗色重绘；若仍发白，优先查这些按钮是否被后续更高特异性的 `background` 规则或内联样式覆盖。
- 未决保留（画布/地图内容不动）：OSM 瓦片、`outdoor-plan-3d` 的 `#D9E3EA` 占位空状态、地图 attribution/比例尺、图层缩略图画面内容。

### 2026-11-20 真机四轮：户外目录树低对比文字 + 左轨空隙结论

- 截图反馈目录树（区域 / 用地红线 / 分区类型 / 路线 / 车 / 室内 / 基础设施 / 工作人员 / 活动包与图元 / 物件库 611 件）在暗色下近黑压暗底。DOM + 源码核对：组头 / 子组头 / 条目行内联 `PLANNING_SURFACE.panelText=#141416`，一级组头内联 `panelBorder=#E4E4E7` 亮发丝；Lucide 图标经 `color=` prop 把 stroke 写成近黑。常量与 2D canvas `ctx.fillStyle` 共用，不改 `outdoor-plan-tokens.ts`，在 CSS 层覆盖。
- `globals.css` 追加暗色覆盖（作用域 `.is-outdoor-card`，`!important` 压内联字面量）：
  - `button` / `[role=button]` 文字回 `--ink`，顶部发丝回 `--hair`；图标 `color`+`stroke` 回 `--ink-soft`；`aria-pressed=true` 行文字回 `--ink`。
  - 清单统计值 `dd` 回 `--ink-soft`；`select` / `option` 文字 `--ink`、底色 `--plane`；图层宿主 `#outdoor-panel-host-layers` 内 div/span 回 `--ink-soft`；`.sc-plan-sheet` 及其 div 回 `--ink-soft`。
  - 浏览器复扫六个户外宿主（library/inventory/layers/levels/measure/annotate），残留近黑 / 深灰文字 0 条；证据 `accept-dark-catalog-tree.png`、`accept-dark-outdoor-inventory.png`。
- **左轨中段大空隙**：核对源码 `.sc-mode-rail` 为 `justify-content: space-between`，顶部门厅 + 导航图标组贴顶，底部账户组 `margin-top: auto` 贴底并带发丝分隔；空隙是两分组图标轨的既定布局，与主题无关（浅色档同样存在）。对照成熟案例（Openit / Weather / Hugeicons 等图标轨）同为「顶部导航簇 + 底部头像簇、中段留空、发丝线分隔」，不判为缺陷，未改布局。截图左缘亮绿线非轨道边框：轨道 `border-left 0`、无绿色 box-shadow，来自画布选中框轮廓。
- 本轮复核命令：`typecheck` exit 0；`appearance` 7 + `solid-icons` 5 + `agent-task-examples` 3 例通过；`build` 静态导出 exit 0，oneplan 产物扫描 3381 文件违规 0。期间 `.next-dev` 开发缓存因 Fast Refresh 反复 runtime error 损坏，已清缓存重启 dev（后台任务 eff030d8，端口 3210）。
- 仍待真实 Chrome 复核：右轨 2D / 框选 / 漫游 / 眼睛钮、右上分享钮、执行资料钮、例句行、模型选择白输入壳在暗色下是否真重绘（Aha 会话 CSSOM 回读与实绘不一致的既有问题；本轮截图里右轨圆钮与执行资料钮仍显白底，下次真机优先查后续高特异性 `background` 规则或内联样式）。

### 2026-11-20 第五轮：chrome 边缘层次 + 地图浮层可读兜底

- **结论（受众心理口径）**：固定 chrome（图标轨 / 左栏）皮肤只跟随用户主题，**不做逐地图适配**——地图是可变画布，chrome 是固定家具，工具型受众预期控件位置/颜色稳定；昼夜换肤是全局预设，不按瓦片局部反应。需要适配的是压在地图上的浮层可读性：中性半透明底 + 描边 + 阴影，而非配色相迎。
- **边缘处理**：不做羽化渐变（地图栅格内容多变，写死渐变色会在绿/水/灰/未来暗图上显脏；边缘内侧控件也需要不透明底）。改用中性窄边投影：
  - 新增 token `--e-edge`：浅色 `2px 0 12px -4px rgba(20,20,22,.12)`；`body.is-theme-dark` 覆盖 `2px 0 14px -4px rgba(0,0,0,.5)`。
  - 挂到 `.sc-left-column` 与 `.sc-mode-rail` 基础规则；769–1080 浮层卡布局仍沿用 `--e1` 浮层阴影（媒体查询覆盖），≤768 手机外壳不变。
- **地图/画布浮层暗色兜底补齐**（此前未覆盖、源码确认仍在渲染）：
  - `.sc-geo-compass-card` 罗盘卡：白底回 `--plane-deep` + `--hair` 描边 + 暗投影；蓝北针/灰南针保留。
  - `.sc-splat-transform-tools` 高斯变换工具条：白底回 `--paper`，描边 `--hair`，投影压暗；坐标轴红/绿/蓝语义色保留。
  - `.sc-shape-loading-pill` 搜地点排队胶囊：白底回 `--paper`，文字回 `--ink`。
  - `.oc-map-details` 地图详情浮层内部：关闭钮/分区线/标签/名称/副标题/缩略图/置顶钮回暗色 token，选中绿态保留。
- **移动端入口泄漏修复**：`.sc-mobile-agent-entry` / `.sc-mobile-capture-entry` / `.sc-mobile-dock` 基础 `display:none` 从仅按组件分片加载的 `mobile-shell.css` 提入常驻 `globals.css`；≤768px 展开仍由 mobile-shell 媒体查询接管。dev 复核两枚入口 `display:none`、0×0；生产构建 CSS 已含隐藏规则。
- 复核命令：`typecheck` exit 0；`appearance` 7 例通过；`lint` 0 error（1939 条均既有 import/order warning）；`build` 静态导出 exit 0，产物 CSS 含 `--e-edge` 与三组浮层暗色覆盖选择器。dev WebView 读取：暗色档 `--e-edge` 解析为 `rgba(0,0,0,.5) 2px 0 14px -4px`，轨道投影生效；左栏当前为浮层卡布局，投影为 `--e1`（符合预期）。
- **仍待真实 Chrome 复核**：边缘投影在亮瓦片/暗瓦片上的实际浓淡；罗盘卡、高斯工具条、排队胶囊、地图详情浮层在暗色下的真实重绘（Aha 会话背景回读/实绘不可信的既有限制）。全量测试套件失败集合尚未与干净基线逐项对照（既有：jsdom 缺 ResizeObserver 级联、图例 `2 × 2 m m`、auth-js unhandled rejection）。

### 2026-11-20 第六轮：缩放条对比 + 外观入口菜单浮层（本地登录打通）

- **右下缩放连体条暗色对比**：基色 `#5f6368` 压暗平面不足。`globals.css` 暗色段补 `.oc-gm-zoom button.oc-gm-zoom-btn` 回 `#C9CED6`，hover 底 `#25282F`，首钮分隔线 `#363A42`。WebView 回读放大/缩小两钮 color 均为 `rgb(201,206,214)`、字重 400、20×20；浅色档仍走基色 `#5f6368`（未被暗色覆盖污染）。
- **外观入口改参照图 2 的行触发器 + 浮层菜单**（`settings-page.tsx` / `cloud.css`）：
  - 触发器 `.sc-appearance-menu-trigger`：Palette 图标 + 标题「外观」+ 当前档文字 + ChevronRight（开态旋转 90°）；容器修饰 `sc-settings-group--menu{overflow:visible}`（默认 group `overflow:hidden` 会裁掉浮层）。
  - 浮层 `.sc-appearance-menu-pop` `role=menu`，三枚 `menuitemradio`：跟随系统 / 浅色 / 深色；选中项 `is-active` 加粗，末尾绿色勾；点选后回写 `scendance.appearance.v1` 并收起浮层；document `pointerdown` 点外部关闭。
  - **选择器修复**：solid-icons 渲染的是 Material Symbol `<span class="sc-material-symbol">`，不是 `<svg>`；原 `.is-active svg` 未命中，勾继承前景色 `#EDF0F2`。改为 `.is-active .sc-material-symbol{color:var(--wk-green)}`，WebView 回读选中勾 `rgb(127,181,143)`。
- **本地登录卡点排查与打通**：旧 54329 进程由 `dev:integration` 起，缺省 origins 不含 `localhost:3210`，预检被判 `test_origin_forbidden` 且不带 ACAO 头；`frontend/.env.local` 公钥与 fixture `sb_publishable_local_integration_only` 实际一致（长度 37）。改用 `dev:agent` 重启桩后端（origins 显式含 3210），OPTIONS 预检 204 + ACAO 放行；密码端点直连 200 返回 access_token。fixture 三账号 `owner/editor/outsider@scendance.test`，密码 `local-integration-only`，数据退出即重置。
- **WebView 实测**：三档即时切换，body `is-theme-dark` 与 localStorage 落盘一致（system→OS 深色、light 去 class、dark 挂 class）；浮层三档、选中绿勾、外部点击关闭、触发器当前档回显均通过；截图 `probe-zoom-dark.png`、`probe-appearance-menu-dark.png`、`probe-appearance-pop-dark.png`。
- 复核命令：`typecheck` exit 0；`appearance` 7 例通过；`lint` 0 error（1939 条既有 import/order warning）。
- **仍待真实 Chrome 复核**：缩小号笔画偏细，WebView 实绘里仍显弱（颜色已与放大号一致，差异来自字形笔画；Aha 会话实绘不可信）；右轨其余圆钮、分享钮、图层卡、底部把手、Agent 例句/输入壳白表面残留（见四轮遗留）。

### 2026-11-20 第七轮：标注工具卡 / 模式提示胶囊 / 搜索放大镜

- **标注浮卡 `.sc-outdoor-toolcard(--annotate)`**：`inspectorCardStyle()` 内联 panelBg/panelBorder/panelText 白字面，普通 CSS 压不过，按目录树先例在 `body.is-theme-dark` 作用域 `!important` 回暗色 token：卡壳 `--paper` + `--hair` + `--ink`，尖角 `::after` 同步；工具条与颜色条 `--plane`；工具钮未选中 `--ink-soft` 透明底，选中 `--green-pale` 底 + `--green` 边 + `--green-deep` 字；卡内实体行未选中 `--ink-soft`，选中绿浅底；关闭钮 / 删除钮回 `--ink-soft`；hint 回 `--ink-soft`。色点本体保留内联选中色，只把内圈白场环回 `--paper`；线宽钮选中态回 `--paper` + `--hair` 内圈；未选中色点深灰细圈回 `--hair`。
  - **回归修正**：初版通用 `button[aria-checked=true]{background:var(--paper)}` 把颜色点本体的彩色底也压成了纸面；收窄为只命中 `annotate-stroke-*`，色点保留 `sw.value`。
- **顶部模式胶囊 `[data-testid=outdoor-mode-chip]`**：内联白底/白边/近墨字回 `--paper` + `--hair` + `--ink`，投影压深。WebView 回读 `rgb(28,31,36)` / `rgb(237,240,242)` / `rgb(54,58,66)`，文案「当前：矩形 R · 再点一次或 Esc 退出」。
- **搜索放大镜字形**：`iconpark_search_solid` 镜片路径被整体 `fill=currentColor`，细节弧也同色，浅底上糊成全黑圆盘。`material-symbol.tsx` 给 loupe 表加 `ring?: true`：search 走描边圆环（`fill:none`，去掉细节弧），zoom_in/zoom_out 仍实心圆盘 + 白色负形符号。DOM 复核镜片 `fill=none`、两条 path（环 + 柄）。
- **其余搜索入口核源码**：`.sc-catalog-search-icon`（目录库 / 线上模型库胶囊）、`.sc-search-mini`、`.sc-session-search`、`.sc-button`（高德场地选择器）表面均挂 `--paper/--plane/--wk-*` 别名，暗色已回挂；唯一浅底是 `.btn-primary` 反转主钮（既有设计保留浅底深字），圆环字形与其深字一致。
- 复核命令：`tsc --noEmit` exit 0；外观 7 + 标注工具 6 + 颜色条 4 + 图标 6 共 23 例通过；ESLint 0 error（material-symbol 一条既有 import/order warning，非本轮引入）。dev WebView 实测：标注卡 bg `rgb(28,31,36)`、文字 `rgb(237,240,242)`、工具条/色条 `rgb(37,40,47)`；选中紫色点 bg `rgb(142,68,173)` 保留原色 + 纸面内圈；线宽钮选中 `rgb(28,31,36)`；截图 `probe-annotate-card-dark-v3.png`、`probe-mode-chip-dark-v3.png`。
- **仍待真实 Chrome 复核**：主钮浅底上圆环放大镜的笔画粗细；目录库/线上库/历史/高德场地选择器搜索框在暗色下的实绘（本轮未逐个展开这些面板）。

### 真机/浏览器验收清单（待人工跑）

- 三档切换即时重绘无刷新；`system` 跟随系统深浅切换；刷新后保留本机档位。
- 设置对话框、左卡、右栏、Agent / 创作室面板、浮层提示都跟随暗色；窄屏无横溢出。
- 画布内容与导出文件颜色不变；官网 / 登录 / 分享查看页仍为浅色。
- 复核遗留 tint 面板在暗色下的明度（见上节「遗留跟进」）。

### 不做

- 不改云端偏好契约、不动 3D/2D 渲染器配色、不做「跟随底图」、不加主题快捷钮、不碰小程序端。
- 按项目节奏：本地攒改动，tsc + 测试 + 真机验收通过后再一次性推 main；本轮不 stage/commit/push。
