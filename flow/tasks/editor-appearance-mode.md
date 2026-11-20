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

### 2026-11-20 第八 / 九轮：内联样式白表面收尾 + 基线失败归类

- **全量 Vitest 基线归属**（`.tmp-vitest-round8.txt`：34 文件失败 / 524 例失败 / 9790 通过）：
  - 最大宗 `agent-panel.react.test.tsx`（457 中 427 失败），stderr 反复 `getSnapshot is not a function`；组件与测试相对 HEAD 无改动，父提交 291ef7e5 上测试 mock 的 `controller` 就缺 `getSnapshot/subscribe`，属既有桩级联失败，非外观回归。
  - 其余错误归类：759 条 `getSnapshot is not a function`、54 条 `el.scrollTo is not a function`（jsdom 缺）、7 条 `discardPreviewForHistoryReview is not a function`，余下 AssertionError 为业务状态机不匹配（`scope` vs `zones`、清单条数、话术文本），与主题无关。
  - 33 个其余失败文件逐一 grep，无任何文件 import appearance/Appearance/is-theme-dark；外观线代码已入 HEAD 提交 a0252ea5。
  - 定向测试：`appearance.test.ts` + `cloud-panel` + `share-menu` 共 128 例全通过。

- **第八轮 CSS 补遗**（面板内联浅底 / 低对比文字回暗色 token，CSS 层覆盖，未改 `outdoor-plan-tokens.ts` 常量）：
  - `workbench-shelf.css`：拖高抓手 `.sc-shelf-grip` 字面 `#fff` 回 `--paper`。
  - `case-admin.css`：分享弹窗内案例运营表单 field 标签/输入/草稿卡/分隔线/版本文字回暗色。
  - `commercial-dossier-panel.css`：warn `#fff5e5` / err `#fff5ed` 浅暖底回低透明 tint + `--warn` / `--err` 文字。
  - `activity-task-suggestion-view.css`：ats-warning / ats-error 同款 tint 覆盖。
  - `agent-panel.css`：think 状态文字回 `--warn`；历史决策标签 approved/withdrawn/replaced 与详情块回绿调 / 琥珀 / 中性暗底。

- **第九轮内联样式浮层 / 气泡 / 卡片挂类 + 暗色覆盖**（JSX 只加 className 钩子，颜色仍走 CSS `!important`，未改内联常量与业务逻辑）：
  - `ConfirmModal.tsx`：确认弹层卡片 / 标题栏 / 正文 / 取消钮回 `--paper/--plane/--ink-soft`，确认绿钮保留。
  - `asset-detail-modal.tsx`：详情弹窗卡片 / 标题栏 / 关闭钮 / 字段块 / 描述块 / 页脚 / 次钮回暗色，放置绿钮保留；预览图占位底回 `--plane`。
  - `outdoor-plan-interactions.tsx` 导引气泡 `[data-testid=guide-bubble]`：纸面 / 箭头方块 / 正文 / 步进号 / 次钮 / 主钮回暗色。
  - `f3-coach-bubble.tsx`：F3 教练气泡卡片回暗色纸面，绿底「知道了」保留。
  - `outdoor-plan-canvas.tsx`：扫描错误浮条 `.sc-scan-error-toast`；画布浮层 `plan-context-menu`（右键实体菜单）、`conflict-detail`（冲突详情卡）、`plan-placement-bar`（放置中浮条 + 「放置中」徽标 + 取消钮 + kbd）、`annotate-note-input`（文本标注输入框）、`facility-model-*` 模型缩略钮、`facility-multi-copy` / `cross-multi-delete` 多选条回暗色。
  - 工具卡底部 sticky 动作行「生成或导入模型」白底细条回 `--paper`；`.sc-model-action` 三格按钮回 `--plane` / `--hair` / `--ink-soft`（hover/active 回 `--plane-deep`）；设施设置 / 备注手风琴开关顶发丝线与文字回暗色。
  - `scendance-workspace.tsx`：`.sc-my-items` 标题与「再放一件」chips 回暗色；`.sc-floor-blocked-note` 楼层受限提示回绿调暗底。
  - `plan-card.tsx`：规划草案卡挂 `.sc-plan-card` 等钩子，整卡 / 阶段块 / 分数条 / 建议块 / 冲突行 / 分区徽标 / 选中版本行 / 次钮 / 取消钮 / 输入框 / 琥珀横幅回暗色 token。
  - `creative-studio.tsx`：提案卡 `.cr-recipe-badge` 徽标与选中版本钮 `aria-pressed=true` 回绿调暗底。

- **第九轮门禁**：`typecheck` exit 0；`lint` 0 error（2044 条均既有 import/order warning）；定向回归 12 文件 356 例通过，5 例失败与 round8 基线逐条相同（`plan-card` 1、`plan-card-safety` 2、`scene-delivery-panel` 2，业务状态机不匹配，非本轮引入）；`build` 静态导出 exit 0，oneplan 产物扫描违规 0（日志 `.tmp-build-round9.txt`）。
- **WebView 状态核对**：三档 localStorage 落盘与 body `is-theme-dark` 类一致——light 去 class、dark 挂 class、system 跟随 OS（本机 prefersDark=true）挂 class；本轮新增的 8 组暗色选择器均已进运行时 CSSOM；当前已渲染 chrome 扫描无残留浅白表面（命中的白色仅为 `.sc-rail-eye` 眼睛与图标白色字形，刻意保留）。
- **仍待真实 Chrome 复核（截图通道本轮不可用）**：BUA WebView 视口塌陷 0×0，`screenshot` 报 `viewport unavailable`、`snapshot` 报 `snapshot failed: 1`；桌面主平面授权 `switch_desktop('main')` 超时，不能转本机 Chrome 目视。下列浮层在暗色下的实绘仍需真机确认：确认弹层、资产详情弹窗、导引 / F3 气泡、放置中浮条、右键菜单、冲突详情卡、规划草案卡、我的物品 chips、楼层受限提示；以及四轮遗留的右轨圆钮 / 分享钮 / 图层卡 / 底部把手。WebView `getComputedStyle` 背景回读与实绘存在已知不一致，源码级联 + CSSOM 命中不能替代目视。
- **刻意保留不动**：OSM 瓦片、地图 attribution / 比例尺、`#D9E3EA` 占位空状态、图层缩略图画面、色板白描边、2D/3D 渲染器、目录 chip 色点本体、绿底 / 墨底反转主钮白字、头像 `.sc-rail-eye`、缩略图深色 scrim 白字标签、独立项目管理页 `.sc-studio-manager-delete-project` 浅红底；`lib/plan-export/svg.ts` 白背景属导出产物，不在 chrome 作用域。

### 第十轮（2026-11-20）：tooltip 特异性修复、muted 别名回挂、外观入口迁到账户菜单

- **问题 1 · tooltip 白字浅底（用户实测截图）**：`data-tip` 暗色覆盖选择器只写了 `.sc-workbench .sc-mode-rail [data-tip]`，而基础规则链挂了 `.is-docked-layout.is-mode-rail` 更多类，特异性更高，暗色覆盖被压过——`background` 退回浅色 `--wk-ink`、`color` 仍是 `#fff`，左轨 Bingo 胶囊白字压浅底不可读。修复：覆盖选择器完整复刻基础规则链（nav-brand / mode-rail / tool-column / 物料抽屉把手四类），暗色统一 `--ink` 底 + `--paper` 字；抽屉把手原本漏在覆盖外，一并补上。
- **问题 2 · 次级文字偏暗**：`.sc-workbench` 规则把 `--wk-muted` 钉死成浅色 `#71767E`，直接声明在工作台元素上，盖过 `body.is-theme-dark` 的暗色别名继承，次级文字退回浅灰、深底上对比不足。补 `body.is-theme-dark .sc-workbench { --wk-muted: #9BA1AC; }` 在元素上挂回暗色 muted。
- **外观入口迁移（用户指令）**：三档外观选择从设置弹窗「个人」页移到点开头像的账户下拉菜单（「设置」与「支持」之间）；行内显示当前档，展开三档 `menuitemradio` + 当前档打勾，选中不落关闭菜单。设置页移除外观区块、局部 state/effect、图标 import 与旧 `.sc-appearance-menu*` 样式；标签与顺序抽到 `lib/appearance.ts`（`APPEARANCE_LABELS` / `APPEARANCE_MODE_ORDER`）共享。
- **第十轮门禁**：`typecheck` exit 0；`lint` 0 error（2044 条既有 import/order warning）；`appearance.test` 7 例 + `account-menu.hover.react` 2 例共 9 例通过；`build` 静态导出 exit 0，oneplan 产物扫描违规 0。WebView 核对：账户菜单三档切换落盘 `scendance.appearance.v1`、body `is-theme-dark` 类、行内标签一致；设置页已无「外观」kicker（剩余：读数与标注 / 吸附 / 快捷键）。
- **本轮遗留（任务 #18）**：灵动岛胶囊 `.sc-activity-island-main` / `.sc-activity-island-name` 暗色下计算色仍是 `#141416` 深字，压在 `--plane` 上对比约 1.1:1；父级 bar/group 颜色已是浅墨，按钮层颜色被某条尚未定位的规则压回浅墨，下一轮继续查全局 button 颜色来源并补暗色覆盖。另有 `#55585F` 图标在深底上对比 2.95 待核。
- **本轮未 push**：改动在本地攒着，待真机目视复核后再一次性推 main。

### 第十一轮（2026-11-20）：地点搜索浮条恢复 + 外观入口改右侧悬停 flyout

- **地点搜索浮条误删恢复**：提交 `a0252ea5`（rebase 取远端基底）把 `outdoor-plan-overlay.tsx` 左上角「搜地点」浮条整段摘掉——`PlanPlaceSearch` import、`venueSearchSync` 只读同步 memo、`usePlaceShapeLookup` 的 `start` 解构、`handOverPlaceToChat` / `clearPlaceRangePreview` 助手与 JSX 浮条块。已按 `a0252ea5^` 删除前版本逐段忠实恢复；对应 merge 测试旧「不挂载」断言改回「已挂载 + testid 正确 + 输入框在 DOM」。
- **外观行改二级 flyout（用户截图反馈）**：行面不再内联显示当前档文字（旧 `.sc-account-menu-value` + 内嵌 `.sc-account-menu-appearance-pop` 已删），与「支持 ›」同构——悬停行在右侧浮出三档列表面板，当前档行内绿色打勾。`account-menu.tsx` 把支持行一套 flyout 机制泛化复用：`supportOpen` 布尔改为联合态 `openMenu: null | 'support' | 'appearance'`，派生 `supportOpen` / `appearanceOpen`；ref 拆 support / appearance 两组（row / flyout / bridge / button）；关闭定时器共享 `cancelClose` / `scheduleClose`；定位 effect 按 `openMenu` 取对应 ref 走 `placeSupportFlyout` + `gapBridge`；Esc 先收子菜单再关主菜单；右方向键进面板、左方向键回触发器、上下键遍历。三档仍是 `APPEARANCE_MODE_ORDER`（跟随系统 / 浅色 / 深色）`menuitemradio`；选中后保留面板回显打勾，不主动关主菜单。CSS：旧内嵌列表规则清理，`.sc-account-menu-flyout [role=menuitemradio]` 两端对齐、选中加粗 + 绿勾。
- **第十一轮门禁**：`typecheck` exit 0；定向测试 account-menu 8 例（含新增外观 flyout：无内联档名、三档齐全、当前档 `aria-checked=true`、点浅色回调 `light`）+ appearance / settings-page / cloud-panel / outdoor-plan-overlay 共 114 例通过；`lint` 0 error（既有 import/order warning，account-menu.tsx 一条同属基线风格）；`build` 静态导出 exit 0，oneplan 产物扫描 3455 文件违规 0。
- **WebView 核对**：菜单行面文本仅「外观 ›」；外观 flyout 三档、深色选中打勾；点浅色落盘 `light`、body 去 `is-theme-dark`、勾移到浅色；切回跟随系统落盘 `system`、OS 深色下 body 挂回 `is-theme-dark`；切支持行时外观 flyout 互斥关闭，支持六项条目正常。
- **搜地点胶囊暗色残留补修（用户实测截图）**：左上角 `.sc-plan-place-search-field` 字面 `#ffffff` 白底，而 `--sc-ink` 在暗色下解析成浅墨，白底下浅字不可读；下拉 `.sc-plan-place-search-options` 同是字面白底。在 `globals.css` 暗色段按目录搜索胶囊同口径补整组覆盖：field / 选项列表回 `--paper` 底 + `--hair` 边 + 暗阴影，文字回 `--ink`，图标 / 序号 / 地址 / 徽标回 `--ink-soft`，序号底 `--plane-deep`，选中行 `--plane`，清空钮 hover `--plane-deep`，spinner 边色回 `--hair` / `--ink-soft`；占位走 `--wk-muted`。WebView 回读 field 底 `rgb(28,31,36)`、字 `rgb(237,240,242)`、边 `rgb(54,58,66)`、图标 `rgb(201,206,214)`。
- **测量标尺卡片暗色残留补修（用户实测截图）**：底部 `measure-ruler-card` 背景已走暗色纸面，但标题 / 读数 / 提示 / 关闭钮 / 边框仍是 `PLANNING_SURFACE` 浅色常量（`#141416` / `#e4e4e7` / `rgba(15,22,32,.62)`），暗底深字。在 `globals.css` 暗色段按既有 `data-testid` 钩子模式补 `!important` 覆盖：卡片回 `--paper` 底 + `--hair` 边 + 暗阴影，标题与读数回 `--ink`，提示回 `--ink-soft`，关闭钮回 `--ink-soft`；距离/面积小弹层 `.sc-measure-pop` 此前已是暗色，未动。WebView 进入测量模式回读：卡底 `rgb(28,31,36)`、字 `rgb(237,240,242)`、边 `rgb(54,58,66)`、提示与关闭钮 `rgb(201,206,214)`。
- **测量卡片视觉改版（用户反馈「挺丑，成熟案例怎么调整」）**：原卡片把空状态提示语（「点起点开始，可连续加段」/「拖出矩形或点选闭合」）当成 18px/700 读数渲染，标题、读数、提示三层权重拉不开，提示句还与标题语义重复。改版为紧凑三层浮动卡：标题 11px/600 `--ink-soft` caption；有真实读数时读数 20px/700 `--ink` 表格数字，空状态降级为 13px/500 `--wk-muted` 占位；提示收成一行 10.5px `--wk-muted`（距离「单击加点，拖动量一段 · 双击结束」/ 面积「单击描点，近首点闭合 · 双击结束」，删掉「退出自动清线」长句）。颜色/排版从内联 `PLANNING_SURFACE` 常量迁到 `.sc-measure-ruler-*` token 类，明暗自适应，撤换上一轮按 `data-testid` 的暗色 `!important` 覆盖块。WebView 回读：距离空状态标题 `rgb(201,206,214)` 11px、占位 `rgb(155,161,172)` 13px/500、提示 10.5px；面积模式占位与提示文案正确。
- **已知限制**：BUA 会话视口塌陷 0×0，`snapshot` / 坐标点击不可用，交互走 JS 派发；flyout 在真实窗口右侧展开的实绘观感、搜地点下拉选项展开态实绘、测量卡片有真实读数时的大字实绘仍待真机目视。画布上标尺文字走 2D canvas 绘制，底图瓦片仍为浅色，未随主题反转。全量 Vitest 基线失败集合本轮未重跑归类（沿用第八/九轮归属）。
- **本轮未 push**：改动在本地攒着，待真机目视复核后再一次性推 main；`cloud-panel.tsx` / `cloud.css` 另混有早前归档盘点改版（`sc-archive-*`）在制改动，提交时需区分 hunk。

### 第十二轮（2026-11-20）：左轨按钮开合逻辑收敛——次级「待切回」态

- **背景（用户反馈）**：左轨「很多可以双选，点来点去不知道为什么出来、为什么回去」。源码 + 3210 实测定位：四车道（活动/Bingo/空间/物料）共用一张 Agent 卡单选互斥；创作、户外可与另一张卡进左栏堆栈双开；消息/私信与车道、创作互斥。核心脱钩点是车道被创作/拍摄/消息/私信盖住时，钮直接变暗成空钮样，但底层车道状态仍保留，此时点下去是「换回车道 + 挤掉占栏卡」，外观像关闭态、结果却是打开。
- **次级「待切回」态**：`room-organizer.tsx` 新增 `laneCovered`（personChat || messagesOpen || generationOpen || captureOpen）与 `isLaneRetained(id)`；`isLaneOpen` 同步补排 captureOpen。车道被盖住时钮挂 `is-retained`（内描边环 + `aria-pressed=true` / `aria-expanded=false`），tooltip「××：切回当前面板」，与从没打开的空钮区分；点击行为不变（换回车道）。CSS 环取 `--wk-ink-soft` 45% `color-mix` 内描边，亮暗跟随 token。
- **创作钮高亮口径拆分**：主态 active 只反映生成卡 `generationOpen`；拍摄向导 `captureOpen` 进次级 retained，提示「拍摄向导开着，点按切到生成」；`aria-expanded` 只跟生成卡。
- **户外钮口径对齐**：被业务卡盖住（`businessCardOpen`）时降次级 retained，提示「被业务卡盖住，点按切回」；active 只在面板可见时点亮，`aria-expanded` 同口径。
- **品牌钮改车道契约**：`WorkbenchBrandToggle` 旧 props `expanded`（导航列开合标签「收起/展开导航栏」）换成 `open` / `retained`；标签「打开 活动 / 收起 活动 / 活动：切回当前对话」，补 `aria-pressed`，`aria-controls="agent-panel"`。旧导航列文案与 `navToggleLabel` 依赖移除；组件测试同步到车道三态契约，旧 NavHarness（toggleNavColumns 演示桩）删除，lib 函数本身仍由 nav-chrome 测试覆盖。
- **第十二轮门禁**：`typecheck` exit 0；定向测试 workbench-brand-toggle 4 + bingo-rail-button 13 + workbench-rail-head 1 共 18 例通过；`lint` 0 error（2087 条既有 import/order warning 基线）；`build` 静态导出 exit 0，oneplan 产物扫描违规 0。
- **WebView 核对**：暗色序列 空间● → 创作盖住时 空间◐ → 点回 空间●；物料◐ retained；拍摄向导开着时创作钮◐；物料 + 户外双开各自独立收起；浅色 retained 环为深灰 45% 描边、白纸上可见。agent-panel.react.test.tsx 等失败为既有基线（旧 vitest-report.json 已列），本轮未引入新失败文件。
- **已知限制**：retained 环在窄轨 40px 触达区上的实绘观感、业务卡盖住户外面板的次级态真机目视未逐帧核对。
- **全量 Vitest 基线归类（2026-11-20 20:14，`.tmp-vitest-round12.txt`）**：830 套件 / 10659 用例，34 套件、524 用例失败，1 条 auth-js 未处理 rejection（既有 jsdom 桩缺 fetch.ok）。对照 11-18 旧基线 `frontend/vitest-report.json`（46 套件失败）：22 个基线套件本轮已转绿；9 个相对基线新增失败全部不属于本轮外观/在制改动——aholo 物料 slug 缺能力标签（catalog 在制，assets/library 未入提交）、fixture `INITIAL_LAYOUT` 空 items 致 scene-layers / cloud-material-draft / local-seating-draft 取值 undefined、尺寸度量文案空格漂移（`2 × 2 m` vs `2×2 m`）、plan-card 可行性出口文案、projects 路由断言、page 待确认提案按钮、use-outdoor-agent-workflow 状态机等业务流陈旧断言。本轮改动所涉套件（account-menu.hover、outdoor-plan-overlay.merge、workbench-brand-toggle、bingo-rail-button、workbench-rail-head、outdoor-plan-canvas 各件）全部通过。唯一轨邻套件 `rail-side-panels.react.test.tsx` 失败于源码字符串契约断言（守卫表达式已含 `!captureOpen` / `!personChat`，断言仍写旧子串），该守卫在 HEAD 即如此、测试文件未在本轮工作树内改动，属早先提交遗留的陈旧断言，未在本轮修。
- **三档真机补验**：`system` 档在系统暗色下刷新后正确挂回 `is-theme-dark`；浅色/暗色档前轮已验。

### 第十三轮（2026-11-20）：遗留暗色复核收口——主钮/徽标/灵动岛/浮层/测量读数

- **主操作钮**：`.sc-agent-panel .btn-primary` 暗色走 `--primary`（210 18% 90% 浅灰底）+ `--primary-foreground`（220 11% 12% 近黑字），对比足够，是中性反转而非白字浅底；户外工作流/结果卡主钮同谱系，实测可读。
- **当前徽标**：`.sc-activity-current` 暗色反相为浅底深字（#EDF0F2 / #1C1F24），对比约 14:1；状态色令牌暗色已提亮（ok #6FB585、warn #D9A95E、err #E07A72、green #7FB58F）。
- **灵动岛**：`.sc-activity-island-main` 活动名 `--wk-ink` 浅色、岛体 `--wk-plane` 深底，实测「周末共创工作坊」可读；改名输入框走 paper/ink 令牌自适应。
- **外观 flyout 修补**：选中档打勾图标是 `.sc-material-symbol` span，旧 CSS 只选 `svg`，绿色没生效（打勾仍是浅色）。`cloud.css` 选择器补到 `.sc-material-symbol`，实测选中「跟随系统」打勾变 `--wk-green` #7FB58F；浮层深底 #1C1F24、发丝 #363A42、文字 ink/ink-soft 层级正常。
- **搜地点下拉**：listbox 深底，主名 ink、地址 ink-soft、序号片 plane-deep + ink-soft，8 条建议项实测可读。
- **测量读数卡**：空态标题 ink-soft、占位/提示 muted #9BA1AC；真实读数 `.sc-measure-ruler-value` 20px/700/tabular-nums、颜色 `--ink`，暗色实测「370.8 m」浅色可读。
- **第十三轮门禁**：`account-menu.hover.react.test.tsx` 3 例通过；`typecheck` exit 0；`lint` 0 error（2087 条既有 import/order warning 基线）。
- **户外钮 retained 核对（#30）**：业务卡盖住户外面板时户外钮降 retained 次级态。访客会话 DOM 内仅有「登录并进入工作台」入口，评审/交付业务卡需登录并走方案流程，真实「业务卡盖住户外钮」状态流未在本轮点穿；改为在真机 DOM 上临时挂 `is-retained` 类回读 computed style：active 态 color `rgb(237,240,242)`（ink #EDF0F2）、box-shadow none；retained 态 color `rgb(201,206,214)`（ink-soft #C9CED6）、`box-shadow: oklab(0.849905 -0.00214672 -0.0121574 / 0.45) 0px 0px 0px 1px inset`、背景透明；截图左轨靶心钮内描边环与其余素面空钮可区分。该环与 Bingo/空间/物料 retained 共用 `globals.css` 2149–2156 规则，第十二轮已在其余钮上真机验过；临时挂类/属性核对完已 navigate 复位。
- **契约补断言**：`workbench-rail-head.react.test.tsx` 新增户外钮源码切片断言——active 仅在 `!businessCardOpen` 时挂、被盖时挂 `is-retained`、`aria-expanded` 同条件、tooltip「被业务卡盖住，点按切回」；定向测试 1 例通过，`typecheck` exit 0、`lint` 0 error。
- **未逐帧核对**：登录态评审/交付业务卡真实盖住户外面板的状态流（需登录 fixture 账号并走方案评审/交付流程，本轮未走）；flyout 非选中项是否降 ink-soft（当前与选中同为 ink，靠加粗 + 绿勾区分，与走查稿一致，未改）。

### 真机/浏览器验收清单（待人工跑）

- 三档切换即时重绘无刷新；`system` 跟随系统深浅切换；刷新后保留本机档位。
- 设置对话框、左卡、右栏、Agent / 创作室面板、浮层提示都跟随暗色；窄屏无横溢出。
- 画布内容与导出文件颜色不变；官网 / 登录 / 分享查看页仍为浅色。
- 复核遗留 tint 面板在暗色下的明度（见上节「遗留跟进」）。

### 不做

- 不改云端偏好契约、不动 3D/2D 渲染器配色、不做「跟随底图」、不加主题快捷钮、不碰小程序端。
- 按项目节奏：本地攒改动，tsc + 测试 + 真机验收通过后再一次性推 main；本轮不 stage/commit/push。
