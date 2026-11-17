# 2026-11-16 新 main 研究、道具动作与续跑队列

本文给后续定时任务用：先读这份，再读 `2026-11-16-outdoor-agent-progress.md` 末尾的切片 A 记录。
只做本地改动，不 commit / push / 开 PR / 部署，除非终树明确说「合」。

## 1. 远端事实（2026-11-16 21:00 左右）

- 当前分支 `fix/outdoor-walk-control`，HEAD `b997da81`，工作树未提交（42 个已跟踪文件 +3189/−670，另有新增文件）。
- `origin/main` = `7ddafd31`，比 HEAD 多 **26 个提交**；HEAD 是 main 的祖先，没有分叉。
- 本轮新 main 的主要提交组：
  - 室内门：`09ad68aa` 分区画门符号；`2417ff5b` 关掉分区自动门、图标库补到六种门；`54137efd` 门在室内分区边 10px 内贴边吸附、法线定向、贴边高亮。
  - 分层指令：`939b424b` 解析层（现在做 / 后面留 / 环境口径）；`796b3267` 样板按室外集会口径重写；`596f1735` 接进工作流气泡。
  - 可见进度与流式摘要：`ede46aba`、`0cb48425`、`e813b31e`、`e9fedccd`、`9d52da14`、`7ddafd31`。
  - 一版预览只落一次：`a7c6bc38`（ApplyOnce 票号接在分区确认前）。
  - 登录卡：`ef578988`（范围已确认后不再要求重选地址）。
- main 与本地脏工作树只有 **5 个文件重叠**：
  - `components/outdoor-plan-canvas.tsx`（main +63 门吸附，本地 +281 罗盘/旋转，最需要小心）
  - `panels/agent-panel.tsx`、`panels/agent-panel.css`、`panels/mobile-shell.css`
  - 进度文档
- `origin/feat/people06-labor`（`8bf2f68f`）是另一条更前的支线：人物 GLB 两档 LOD、坐姿 clip、E 键交互注册表、`person-action-state`。**它不在 main 里**（`origin/main` 没有 `person-action-state.ts`），与本地 7 个文件重叠（walk/3d/glb/proxy），不能整支合并，只能挑模块。

## 2. 对丽丽这版改动的判断（可拿去讨论）

### 2.1 「有出入口的宏观室内」

- 实际落地是：**室内分区 + 手动摆放的门符号 + 门贴边吸附**。
- 门是普通设施（物件库里的门图标，六种：门 / 双开门 / 推拉门 / 旋转门 / 卷帘门 / 折叠门），不是墙体开口，也不生成门洞几何。
- 分区不再自动长门（`2417ff5b` 明确关掉）；用户从图标库摆门，落在室内分区边 10px 内时吸到边上、角度取边法线。
- 出入口是另一套：`PlanNode` 的入口 / 出口 / 出入口节点，动线端点可吸附；截图里的「出入口 1/2」是节点，不是门。
- 结论：这是**图纸语义**上的宏观室内，不是可步行、可碰撞的室内壳体。它和「过去要淘汰的室内」区别在于不造墙、不建房间，只给场地分区一个有门的边界。这个方向成立，但门与出入口目前是两套数据，后续要想清楚「门是否参与人流/动线计算」。

### 2.2 「AI 识别最佳 / 备选道具」

- 在 `origin/main` 里没有找到按评分排序「最佳/备选」的代码。现有是：
  - `plan-facility-models.ts`：每个设施最多给 5 个模型候选（内置映射 + 在线物料库 + 生成模型）。
  - `facility-generated-models.ts`：新生成的模型排最前，回填属性卡候选首位。
- 所以截图里的「默认 / 遮棚展位 / 条纹遮棚 / 蓝色市集…」更像是**固定候选列表**，不是 AI 打分后的最佳/备选。
- 如果丽丽要的是「AI 推荐最佳、其余为备选」，需要在候选列表上加一层排序理由（尺寸匹配、语义匹配、是否可坐/可交互、生成质量），并把「最佳」作为显式字段返回；这层目前没有。
- 现有生成链路是通的：属性卡「文字生成 / 图片生成 / 导入 GLB」→ `outdoor-facility-generate` → `facility-generated-models` 轮询 → 落盘注册 → 3D 按 slug 解析。积分测试要在真机手动跑一次，不能由定时任务反复扣。

### 2.3 「3D 道具摆放」

- 这条在本地工作树里已经存在，不是新 main 新加的：户外 3D 按设施/场景物件渲染，生成模型走 `loadFacilityModelOverride`，2D 占地会重置为模型真实尺寸，3D 等比跟随。
- 新 main 主要补的是门图标、门吸附和 agent 流式反馈，不是 3D 摆放本身。

### 2.4 合并判断

- 不建议现在 merge main：本地还有一整批未验收的户外改动，main 的 `components/outdoor-plan-canvas.tsx` 门吸附会和本地罗盘/旋转改动在同一文件里打架。
- 建议顺序：先把本地切片 A/B 验收完 → 单独用 worktree 把 main 的门 / 分层指令 / 流式摘要逐个 cherry-pick 或小合并 → 再合 `feat/people06-labor` 的坐姿与交互模块。
- 所有合并都要等终树说「合」。

## 3. 道具 → 人物动作分类（丽丽的要求）

现状：

- `seat-placement.ts` 已能识别椅 / 沙发 / 凳 / 长椅，并给坐面高、坐姿眼高。
- 本地工作树已有坐姿相机、坐姿 clip、`use-walk-avatar` 坐姿对齐。
- `feat/people06-labor` 已有 E 键交互注册表、`seatInteractables`、`person-action-state`（idle / talk / walk / sit / wave / emote）。
- 缺口：**只有「坐」一类**，没有把道具类型映射到可交互动作的公共层；也没有 UI 把「这把椅子可以坐、这张桌子可以交谈」露出来。

建议分层：

1. **纯函数层** `lib/prop-interactions.ts`（本轮已落）：道具 → 类别（seat / table / stage / booth / display / barrier / plant / vehicle / unknown）→ 可用动作 + 对应人物动作 + 提示文案。坐具继续复用 `seat-placement`，不另造一套判定。
2. **场景派生层**：`outdoor-interactables.ts` 除了 seat，再派生 talk / wave 目标；交互注册表仍用同一套 `nearbyEntries`。
3. **UI 层**：靠近道具时提示卡显示「E 坐下 / E 交谈 / E 挥手」；没有 clip 的动作不出现（`resolvePersonAction` 已有回退）。
4. **生成兜底**：候选里没有合适道具时，属性卡「生成一个」走积分生成；只在真人确认时跑一次。

动作口径建议：

| 道具类别 | 交互 | 人物动作 | 备注 |
|---|---|---|---|
| 椅 / 沙发 / 凳 / 长椅 | 坐下 / 起身 | sit | 已有坐面高与眼高 |
| 桌 / 柜台 / 吧台 | 交谈 | talk | 站立，不落座 |
| 舞台 | 挥手 / 表演 | wave / emote | 一次性动作，播完回 idle |
| 摊位 / 展位 | 交谈 | talk | 摊主或顾客视角 |
| 展柜 / 展架 | 观看 / 交谈 | talk | 先不做独立「观看」clip |
| 围栏 / 锥 / 水马 | 无 | — | 不注册交互 |
| 绿植 / 垃圾桶 | 无 | — | 不注册交互 |

### B1 门吸附 × 本地罗盘冲突图（2026-11-16）

范围：`origin/main` 的三个门提交 vs 本地 `fix/outdoor-walk-control` 脏树里的罗盘/旋转改动。结论：**没有真文本冲突**；`54137efd` 的 tsx 补丁对当前脏树 `git apply --check` 7 个 hunk 全过，最大偏移 +43（2026-11-16 复测；旧记 +42）。

| main 提交 | 改的文件 | 关键插入点（工作树行号） | 与本地改动的关系 |
| --- | --- | --- | --- |
| `09ad68aa` 室内分区画门符号，门进图标库 | `lib/outdoor-plan-canvas.ts`、`lib/oneplan-library.ts`、`door.svg` | 门符号绘制、图标库目录 | 本地对该 lib 无内容改动（status 的 M 只是 mtime），lib 零冲突 |
| `2417ff5b` 关自动门，图标补到六种 | `lib/outdoor-plan-canvas.ts`、`lib/oneplan-library.ts`、六种 door.svg | 删除 09ad 的自动门，扩 `oneplan-library` | 同上；**必须紧接 09ad**，单挑 2417 会因删不掉 `indoorZoneDoor` 失败 |
| `54137efd` 门贴边 10px 吸附 | `components/outdoor-plan-canvas.tsx`（+63）、新增 `lib/plan-door-snap.ts` | import 238；常量 723；`doorSnapRef` 1480；`draw()` 2723；落位 4098；点击 4287；`mousemove` 7511 | 同函数不同行段：draw / 鼠标 / 落位各占一段；import 与本地 78/289、257 仅相邻 |

本地罗盘/旋转 hunk 的位置：import 78/289；`bearingRef` 1421；`draw` 罗盘变换 2509–2513；`eventPlanPoint` 3663；`pan` 3686；`zoom` 3741；缩放手柄 3949–3959；工具条 JSX 8705–8715。

语义复核点：

- 10px 阈值用未旋转的 `planPointToPixel`，而 `eventPlanPoint` 已用 `uprightDelta` 反旋；旋转下两点距离不变，逻辑自洽，但合完仍要手测一次贴边与法线方向。
- `draw()` 里 main 的门贴边高亮插在 `drawZoneLayer`（2708）之后；本地罗盘变换包在外层，高亮会一起转，不要重复反旋。
- 门 = `PlanFacility`（六种 door templateId + `rotationDeg`）；出入口 = `PlanNode`（entry/exit/both）。`plan-door-snap` 只读 `zone.environment`，不引用 nodes，两套数据仍未同步。

建议顺序（不自动执行，等终树明确说「合」）：

1. 先把本地罗盘/旋转 WIP 单独收口（提交需终树授权；否则用独立 worktree 试合，别把脏树当基线）。
2. `09ad68aa`：门符号与图标库，lib 改动可直接过。
3. `2417ff5b`：紧接上一步，关自动门并补六种门；不要跳过 09ad。
4. `54137efd`：新增 `plan-door-snap.ts` + tsx 七个 hunk；合完跑 `plan-door-snap.test.ts`、`oneplan-door-icon.test.ts` 与 canvas 相关 lib 测试，再手测 10px 贴边。

回滚：三笔分开提交，按 `54137efd` → `2417ff5b` → `09ad68aa` 逆序 revert；不要只回滚 09ad，否则 2417 的删除对象不存在。

### B2 真机验收清单（2026-11-16）

状态：**清单已交付，尚未实机执行**。下面的勾只能在真人浏览器里打；没打勾不得说“已验收”。

环境与前置：

- Node 24；`cd frontend; npm run dev`（交接记录用 3210，实际端口以启动输出为准）。
- 浏览器开 DevTools 的 Network / Console；主视口 1440×900，另开 375 宽复核导航。
- 样例项目：`house-uat5t1nz` 或任何同时有 anchor + boundary 的方案；分享发布、aholo 需要登录态与真实资源。
- 每项留证据：截图或 30–60 秒录屏、Network 过滤结果、页面时间、HEAD、端口、项目名。失败记 `BLOCKED`，不要记 `PASS`。
- OFM 的 `debug()` / `window.__ofmDebug` 验收通过前不要删。

#### B2.1 OFM Network

| # | 操作 | 通过标准 |
| --- | --- | --- |
| 1 | 打开有 anchor + 边界的项目，stage=objects，刷新 | 页面正常起，无未捕获异常 |
| 2 | 点「预览按用途复用我的物料」 | 进入预览，不白屏 |
| 3 | Network 过滤 `openfreemap`、`site-context`、`.pbf` | 出现 `tiles.openfreemap.org/planet` 的 TileJSON 与版本化 `.pbf` |
| 4 | 数 `/api/site-context` 请求 | 不应再出现 9 条相同请求；OFM 成功时不落 site-context |
| 5 | 看道路 / 建筑证据 | 能画出来；只有 OFM 失败才回退 site-context |

#### B2.2 分享三受众

| # | 操作 | 通过标准 |
| --- | --- | --- |
| 1 | 打开分享面板 | 三栏：`发给客户` / `送评审方` / `内部协作`，默认选中「发给客户」 |
| 2 | 未发布时逐栏看空态 | 出现对应「未发布 / 未生成漫游」下一步文案，不出现死按钮 |
| 3 | 切到「送评审方」 | 没有「导出 N 项资料」/「导出交接」 |
| 4 | 切到「内部协作」 | 出现「导出交接」或「导出 N 项资料」 |
| 5 | 发布当前版本 | 右侧出预览 + 二维码；生成中显示占位，失败留链接并可重画 |
| 6 | 键盘 `←` / `→` / `Home` / `End` | 焦点与选中栏同步移动，`aria-selected` 正确 |

#### B2.3 罗盘弯箭头

| # | 操作 | 通过标准 |
| --- | --- | --- |
| 1 | 2D 下点左 / 右箭头 | 每次转 90°，方向与箭头一致 |
| 2 | 点针 | 回正北 |
| 3 | 按住针拖动 | 跟手，松手停住，不跳变 |
| 4 | 切 3D 重复 1–3 | 2D/3D 同转，文字保持朝上 |
| 5 | 步行档转罗盘 | 转的是视线，不是地图底图 |
| 6 | 看尺寸与热区 | 44px 级别、左右热区可点、不压缩放条 |

#### B2.4 漫游碰撞

| # | 操作 | 通过标准 |
| --- | --- | --- |
| 1 | 进入 / 退出漫游 | 机位不甩、不穿地；退出后 2D/3D 正常 |
| 2 | 拒绝指针锁后单击 | 不再报错刷屏，可继续用拖拽看 |
| 3 | 漫游中切 2D/3D | 自动退出漫游，无锁残留 |
| 4 | WASD / 加速 | 移动平滑；在输入框里按 WASD 不走路 |
| 5 | 撞围栏 / 建筑 / 道具 | 不穿模、不弹飞；贴边可接受 |
| 6 | 走到边界 / 坡地 | 不穿地、不掉出场地 |

#### B2.4a E7b 后新增：玩家 GLB 检查

E7b 已把**户外第三人称玩家**从胶囊体换成当前 `walkRole` 的 GLB；原 B2.4 只覆盖碰撞与机位，真人跑 B2 时补下面几条。仍属于 `B2-run`，**未执行、未打勾**。

| # | 操作 | 通过标准 |
| --- | --- | --- |
| 1 | 3D 接管后打开 Network，过滤 `people/` | 出现当前角色 `people/<assetId>.glb`；进入漫游前预加载，不是第三人称才请求 |
| 2 | 进入漫游，按 HUD `outdoor-walk-view` 或 `F5` 切第三人称 | 看到当前角色 GLB，不是蓝胶囊；脚底贴地，不悬空、不沉 5.2 cm |
| 3 | 再切第一人称 / 鸟瞰 | 玩家模型隐藏；切回第三人称重新出现，相机不穿模 |
| 4 | 在左侧「物料」的漫游角色分组换一个 ready 角色 | 旧 GLB 消失、新 GLB 出现，不叠加；地图和镜头不重建；Network 只新增新角色请求 |
| 5 | 退出漫游、切 2D/3D、刷新后再进 | 无旧 avatar 残留，无 WebGL / mixer 报错，仍显示当前角色 |
| 6（可选） | DevTools 阻断当前 `people/<assetId>.glb` 后重进 3D | 第三人称仍有胶囊体兜底，不空场；恢复网络后可重试加载 |

验收锚点：`data-testid="outdoor-walk-hud"`、`outdoor-walk-view`、`outdoor-interact-hint`、`outdoor-action-note`。注意 `sc-walk-avatar-controls` 只属于室内 `walkthroughActive`，不是户外漫游的角色切换入口；户外换角色走左侧「物料」的漫游角色分组。

#### B2.5 aholo 多模型

| # | 操作 | 通过标准 |
| --- | --- | --- |
| 1 | 场景里放 ≥2 个 aholo 模型，刷新 | 都出现；占位态可见，不长时间白模 |
| 2 | Network 过滤 `3199` / `lux3d` / `.glb` / `lod-meta` | 同一任务号、同一 `metaUrl` 并发只打一次代理 |
| 3 | 同一资产重复出现 | GLB 缓存命中，不重复下载；缓存键按落盘 URL 的资产 UUID 对齐 |
| 4 | 切楼层 / 删除模型 | 不再用的模型卸载，内存不持续涨 |
| 5 | 连续拖动 / 旋转 | 不卡顿到不可操作，无请求风暴 |

#### B2.6 记录模板

```text
时间：2026-11-__ __:__  HEAD：________  端口：____  浏览器：________  视口：1440×900 / 375
项目：________
OFM：PASS / FAIL / BLOCKED  证据：________
分享：PASS / FAIL / BLOCKED  证据：________
罗盘：PASS / FAIL / BLOCKED  证据：________
漫游：PASS / FAIL / BLOCKED  证据：________
aholo：PASS / FAIL / BLOCKED  证据：________
阻塞原因：________
```

已知可能阻塞：未登录 / 无样例项目、分享发布依赖后端、OFM 上游不可达、aholo 资源或代理未起。阻塞时只记录，不用相邻能力代替。

### D1 375 宽左侧导航复核（2026-11-16）

结论：**原“整组不可见”证据不足，先按误报处理**。375 宽实际入口不是 `展开导航栏`（`WorkbenchBrandToggle`，在桌面左轨内部），而是独立按钮 `助理菜单`（`button.sc-mobile-agent-entry`）。探针的可见按钮清单里已有 `助理菜单`，但没有先点它，所以四个导航项仍处于“菜单未展开”的隐藏态。

代码链：

- `room-organizer.tsx:475`：`mobileRailOpen` 默认 `false`。
- `room-organizer.tsx:4541`：左轨 `data-mobile-open={mobileRailOpen ? 'true' : 'false'}`。
- `room-organizer.tsx:4651–4666`：`助理菜单` 按钮，点击 `setMobileRailOpen(v => !v)`；`aria-controls="sc-agent-rail"`。
- `mobile-shell.css:10–12`：桌面隐藏 `sc-mobile-agent-entry`；`150–185` 在 `≤768px` 把它设为 `display:grid`、固定左下、`z-index:77`；左轨默认 `opacity:0; visibility:hidden`，只有 `[data-mobile-open="true"]` 才显示。
- `workbench-brand-toggle.tsx`：`展开导航栏` 按钮本身在左轨内；左轨收起时它不可见是预期，不是第二个入口。

剩余可能：如果点 `助理菜单` 后仍不出四个入口，再查 `main` 是否带 `is-chrome-hidden`。`app/globals.css:1121–1127` 会用更高 specificity 把左轨重新压成 `visibility:hidden`；但 16:10 的探针同时看到了 `分享 / 指北针 / 2D/3D`，这些在干净看图模式会被隐藏，说明当时 `chromeHidden` 应为 `false`，不是本轮首因。

复验（375×812，不改代码）：

1. 点 `助理菜单`，确认左轨 `data-mobile-open` 变为 `true`，`空间 / 物料 / 场地 / 户外规划` 四个入口可见。
2. 点 `空间`，确认左卡打开、菜单自动收起；再点 `助理菜单` 能重新打开。
3. 若仍不可见，记录 `main.className` 是否含 `is-chrome-hidden`、左轨 computed `visibility/opacity`、按钮 `getBoundingClientRect()`，再决定是清 `chromeHidden` 还是加移动端 `[data-mobile-open="true"]` 覆盖。**不要在未复验前改全局 `.is-chrome-hidden`。**

**2026-11-16 21:58 实测结果（Playwright + 本机 Chrome，375×812，`/editor?r=1`）：**

- 初始：`main` 无 `is-chrome-hidden`；左轨 `data-mobile-open=false`、`visibility:hidden`；`助理菜单` `visible=true`；四个导航项均 `visible=false`（预期）。
- 点 `助理菜单`：左轨 `data-mobile-open=true`、`visibility:visible`；四个导航项全部 `visible=true`。
- 点 `空间`：`main` 变为 `has-left-column`，左轨收起、四个导航项回到 `visible=false`（预期），`助理菜单` 仍可见；控制台 0 错误。
- 结论：**原“375 左侧导航整组不可见”是探针未展开菜单导致的误报，不是需要改 CSS 的产品缺陷。**

### E1 people06 坐姿 / 交互链路接入图（2026-11-16）

研究对象：`origin/feat/people06-labor` @ `8bf2f68f`，未进 `origin/main`。结论：**当前工作树已经把“能坐”这条链基本接齐；缺的是“坐下以外”的动作 API 与道具 → 人物动作的生产接线。**

| 模块 | 分支状态 | 当前工作树 | 结论 |
| --- | --- | --- | --- |
| `lib/seat-placement.ts` | 有 `seatTargetOf` / `seatFacilityTargets` | 与分支同文 | 已有，直接复用 |
| `lib/walk-seat.ts` | 室内 FurnitureItem 坐具判定 | 与分支同文 | 已有；户外不走它 |
| `lib/interact-registry.ts` | 条目、近邻、注册表 | 与分支同文 | 已有，E 键地基 |
| `hooks/use-walk-avatar.ts` | 坐姿 clip + 坐姿头高对齐 | 与分支同文 | 已有；漫游玩家能坐 |
| `three/people-anim.ts` | 坐姿抬升 + `resolvePersonAction` + `setPersonAction` / `personActionState` | 有坐姿抬升，**缺外部动作 API**；与分支差 266 行 | 需手工合，不能整文件覆盖 |
| `three/glb-assets.ts` | 两档 LOD + `Sit_Idle_Loop` / `Idle_Talking_Loop` | 已有 sit / talk 片段读取；**缺 LOD** | 按需挑 LOD，不要整文件搬 |
| `components/outdoor-plan-3d.tsx` | 设施 / 座位两套条目 + E 键 | 已换 A2 的 `propInteractables` + A3 属性卡 | 只挑动作接线，不能合整文件 |
| `lib/person-action-state.ts` | 40 行纯函数 + 6 例测试 | **本轮已落**（未接线） | 可直接用；见 §E3 |

已确认的缺口：

1. **E 键对桌 / 摊位 / 舞台目前只出提示，不播动作。** `outdoor-plan-3d.tsx` 的 `onInteract` 只有类型定义，全仓没有调用方传值；A2 的非 seat 条目注册后回调是 `undefined`。
2. **道具条目没有携带 `personAction`。** `propInteractables` 只给 label；要在 E 时知道该播 talk / wave，需要把 `propInteractionProfile` 的动作挂到条目或按 facility id 回查。
3. **没有“对谁播”的目标。** 漫游里可见的人是玩家 avatar，不是 `people-anim` 注册的 NPC；分支的 `setPersonAction` 只作用于注册表里的人。是先让玩家做 talk/wave，还是找最近岗位人物，需要产品拍板。
4. **wave / emote 没有 clip。** 当前资产只有 `Idle_Loop` / `Walk_*` / `Sit_Idle_Loop` / `Idle_Talking_Loop`；分支的 resolver 会把缺片段的 wave 回退 idle，所以舞台“挥手”目前只能是文案，不能假装播了。
5. **talk 片段在户外岗位 avatar 上被显式置空。** `outdoor-plan-3d.tsx` 注册人物时 `talk: null`；`createWalkAvatar` 也只返回 idle / walk / sit。要真播交谈，需把 `Idle_Talking_Loop` 接进 avatar 或注册项。

建议最小接入顺序（仍不 commit）：

1. 直接拿 `lib/person-action-state.ts` + 测试：动作缺片段回退 idle，wave/emote 归一次性动作。
2. 给 `InteractableEntry` 加可选 `personAction`（或按 facility id 回查），让 `propInteractables` 把 seat→sit、table/booth→talk、stage→wave 带出来；不改合同字段。
3. 先接玩家 avatar：给 `use-walk-avatar` 加 `requestAction('talk' | 'wave')`，用现有 mixer 播 `Idle_Talking_Loop`，wave 缺片段则回退 idle；E 按下时调它，保持相机不动。
4. 再接 NPC：用 `people-anim` 的 `setPersonAction(id, action)` 控制最近岗位人物；有 `follower` 的实例不硬切，避免和路线打架。
5. 最后补舞台一次性动作的“播完回 idle”；没有 clip 前不把它标成已交付。

不要做：整支 merge people06；覆盖当前 `outdoor-plan-3d.tsx`；把 `talk: null` 当成已支持交谈；在无 wave clip 时声称“挥手已接通”。

### E2 main 剩余提交 × 本地树（2026-11-16）

`origin/main` 现为 `7ddafd31`，比 `b997da81` 多 **26 个提交**。其中已包含 `fix/outdoor-walk-control` 的 4 个合并 PR（#119–#122）和 375 户外卡片标题栏修复 `2c6d4319`；本地工作树仍是旧基线 + 未提交改动。

**重叠文件只有 5 个**：4 个代码文件 + 进度文档。对 4 个代码文件逐份跑 `git diff HEAD..origin/main -- <file>` 的 `git apply --check`，全部可应用：

| 文件 | main 改动 | 本地改动 | 检查结果 | 结论 |
| --- | --- | --- | --- | --- |
| `panels/mobile-shell.css` | +5，1 hunk，户外卡片标题栏 | +8，focus-visible + 角标偏移 | 1 hunk 通过，offset +8 | 可直接拿；与本地两段互不相邻 |
| `components/outdoor-plan-canvas.tsx` | +60/−3，7 hunk，门吸附 | +121/−182，罗盘/旋转 | 7 hunk 全过，offset +2/−8/−14/+43 | 按 B1 顺序；合完必须跑 canvas/罗盘测试 |
| `panels/agent-panel.css` | +18，2 hunk，流式草稿 + 思考记录 | +4，focus-visible | 2 hunk 通过，offset +4 | 可应用；依赖下方新组件 |
| `panels/agent-panel.tsx` | +27/−11，14 hunk，分层指令/流式/登录文案/ApplyOnce/计划批准 | +1，`aria-pressed` | 14 hunk 全过，offset ≤1 | 文本无冲突；**不能只拿此文件**，需按功能组一起接 |
| `docs/plans/2026-11-16-outdoor-agent-progress.md` | 多轮追加（17–28） | 本地已追加 A/B/D/E | 未自动试合 | 手动保留双方记录，禁止用 main 版覆盖本地 |

功能依赖分组（供后续“合”时拆）：

1. **手机卡片**：`2c6d4319` 只改 `mobile-shell.css` + 进度文档；直接拿 CSS 即可，补一条 375 实机复验。
2. **门**：`09ad68aa` → `2417ff5b`（必须紧跟）→ `54137efd`；见 §B1。
3. **分层指令**：`instruction-layers.ts`、`outdoor-layered-task.ts`、`outdoor-agent-planning.ts` + 各自测试，再接 `agent-panel.tsx` 的 import/bounce。
4. **流式问答**：`agent-run-events.ts`、`agent-bubbles.tsx`、`agent-run-panel.tsx`、`agent-chat-store.ts`、`client/scene-client.ts`、`frontend/lib/backend-session.ts`、Supabase `agent-events` / migration、`agent-panel.tsx` 的 `streamPreview` 与 CSS。注意后端 migration，不能只改前端。
5. **户外摘要 / 思考记录 / 计划批准**：`outdoor-workflow-card.tsx`、`use-outdoor-agent-workflow.ts`、`outdoor-agent-understanding.ts`、`agent-panel.tsx` 的 `OutdoorThoughtRecord` / `pendingPlan` / CSS。
6. **登录文案**：`outdoor-login-copy.ts` + test，再接 `agent-panel.tsx` 的 placeholder。
7. **ApplyOnce**：`outdoor-apply-once.ts` + test，再接 `agent-panel.tsx` 的 `zoneApplyOnceRef`。

检查方法备注：不要用 `git show ... | git apply --check` 直接走 PowerShell 管道，CRLF/编码会让好补丁报 `patch does not apply`。先把 diff 写成 UTF-8 临时文件，再 `git apply --check --verbose <patch>`；本次结果就是按这个口径得到的。临时补丁已删。

结论：**代码层没有文本冲突，真正风险在语义与依赖**——`agent-panel.tsx` 的 14 个 hunk 能落，但它引用的新模块/后端不一起拿就会 tsc 红；`outdoor-plan-canvas.tsx` 能落，但门吸附与本地罗盘要在同一轮跑测试和手测。仍等终树说「合」再动手。

### E3 person-action-state 纯函数落地（2026-11-16）

按 E1 第 1 步从 `origin/feat/people06-labor` 取纯函数层，不改任何现有播放/场景行为：

- 新增 `frontend/components/room-organizer/lib/person-action-state.ts`
  - `personActionHasClip(action, clips)`
  - `resolvePersonAction(requested, clips)`：缺片段回退 `idle`，`idle` 也缺返回 `null`
  - `LOOP_PERSON_ACTIONS` / `ONE_SHOT_PERSON_ACTIONS`、`isLoopAction` / `isOneShotAction`
- 新增 `person-action-state.test.ts`，覆盖动作自解析、sit/talk 缺片回退、空 clips 返回 null、wave/emote 回退与循环/一次性分类。

验证：

```text
vitest components/room-organizer/lib/person-action-state.test.ts --maxWorkers=1 --testTimeout=15000
  1 file / 6 tests passed
tsc --noEmit -p tsconfig.json
  TSC_EXIT=0
```

边界：当前没有任何生产代码 import 这个模块；`people-anim.ts`、`use-walk-avatar.ts`、`outdoor-plan-3d.tsx` 均未改。它只把“缺片段不要播空动作”的口径固化成可测纯函数，下一步才接 `propInteractables` 的 `personAction` 与玩家/NPC 动作。

### E4 可交互条目携带 personAction（2026-11-16）

把 E3 的解析层接到条目数据上，但仍不触发播放：

- `interact-registry.ts`：`InteractableEntry` 新增可选 `personAction?: PersonAction`；缺省表示只提示、不播动作。
- `outdoor-interactables.ts`：
  - `seatInteractables` 的 seat 条目固定带 `personAction: 'sit'`，座位元数据与原有行为不变；
  - `propInteractables` 的非座位条目带 `profile.personAction`：桌/柜台/摊位/展柜→`talk`，舞台→`wave`；围栏/绿植/车辆不带动作。
- 测试补强：seat→sit、table→talk、stage→wave、惰性道具→undefined。

验证：

```text
outdoor-interactables 14 + prop-interactions 11 + person-action-state 6 = 31 passed
interact-registry 11 passed
tsc --noEmit -p tsconfig.json  TSC_EXIT=0
```

边界：`outdoor-plan-3d.tsx` 没有消费 `entry.personAction`，E 键对桌/舞台仍不会播动作；本轮只把“该播什么”带到条目上。下一步才是玩家 avatar/NPC 的实际播放。

### E5 人物动作 API 与最近 NPC（2026-11-16）

在 `three/people-anim.ts` 补真实动作层，不改户外玩家胶囊体：

- `playClip` 改用 `resolvePersonAction`：缺片段回退 idle，idle 也缺则保持当前姿态。
- `setPersonAction(id, action)`：静态人物切换动作；有路线 follower 的实例不硬切。
- `personActionState(id)`：返回 requested / current / sitting / hasClips，供交互层判断是否真的播了。
- `setNearestPersonAction(position, action, radius)`：只选已挂场景、无 follower、未被接管、未暂停的最近 NPC；没有候选返回 null。

测试补在 `people-anim.test.ts`：静态人物 talk→idle、wave 缺片段回退、最近 NPC 选择与半径外 null；12 例通过。

### E6 E 键道具动作接线（2026-11-16）

`components/outdoor-plan-3d.tsx` 的非座位条目现在会把 `entry.personAction` 接到最近静止 NPC：

- 桌 / 摊位 / 展柜 → `talk`，舞台 → `wave`，搜索半径 3.2 m；
- 座位仍走原 `toggleSeatEntry`，不改坐姿相机与座位行为；
- 没有 NPC，或人物资产缺该片段时，HUD 出一条 1.8 s 短提示（`outdoor-action-note`），不冒充已播放；
- 外部 `onInteract` 仍照旧调用。

验证：`people-anim 12 + outdoor-interactables 14 + interact-registry 11 = 37 passed`；`tsc --noEmit` 0。未做浏览器 E2E；户外玩家胶囊体仍不会播 talk/wave，这是已知边界。

### F 当前可协作状态（2026-11-16 22:45）

已完成的可演示链路：

- 座位：椅 / 沙发 / 凳 / 长椅仍是原 `toggleSeatEntry`，坐姿相机、坐面高、起身逻辑未改。
- 桌 / 柜台 / 摊位 / 展柜：靠近按 E，找 3.2 m 内最近静止 NPC 播 `talk`。
- 舞台：按 E 请求 `wave`；当前人物资产没有 wave clip，实际会回退 idle，并提示“这个人物暂时没有该动作片段”。
- 没有可响应 NPC 时提示“附近没有可交谈的人 / 可回应的人”，不会静默失败。

复跑口径：

```text
10 个相关测试文件：147 passed
  people-anim / glb-assets / outdoor-interactables / prop-interactions /
  interact-registry / person-action-state / use-outdoor-walk /
  walk-collision / walk-seat / gm-walk-motion
tsc --noEmit -p tsconfig.json：TSC_EXIT=0
```

手测 E6（需要样例项目 + 岗位点位 + 至少一个已加载 GLB 的人物）：

1. 进入户外漫游，走到桌子 / 摊位旁，确认 HUD 出现「E 交谈 · 名称」。
2. 按 E，附近静止 NPC 应切到 `Idle_Talking_Loop`；走开或再按其它动作后回到 idle。
3. 对舞台按 E，若没有 wave clip，应出现短提示而不是无反应。
4. 没有 NPC 时按 E，应出现「附近没有可交谈的人」。
5. 座位仍应只切换坐下 / 起身，不触发 NPC 动作。

已知边界：户外玩家 avatar 仍是胶囊体，不是 GLB；这轮接的是场景 NPC。没有做浏览器 E2E，也没有真实 crowd GLB 的视觉验收。

### E7 户外玩家 avatar 接 GLB：可行性与前置（2026-11-16 22:49，只读）

结论：**能接，但不建议直接把室内 `useWalkAvatar` 整段搬进户外 3D。** 建议新增一个户外专用控制器，保留现有胶囊体作为加载失败兜底；本轮只读，没有改代码。

#### 已核实事实

| 事实 | 证据 |
| --- | --- |
| 室内漫游已经用 GLB 玩家，`useWalkAvatar` 不是死代码 | `room-organizer.tsx:2654-2657` 生成 `walkRoleUrl`；`3065-3066` 调 `useWalkAvatar(walkAvatarOn, walkRoleUrl, sceneRef, ...)` |
| 户外玩家仍是胶囊体 | `outdoor-plan-3d.tsx:1001-1013` 用 `CapsuleGeometry` + `SphereGeometry` 建 `plan-walk-avatar`；`2122-2131` 每帧只摆手位/朝向，没有 mixer |
| 户外 crowd 已经会加载 GLB | `outdoor-plan-3d.tsx:1098-1116`：`ensureGlbAsset` → `createWalkAvatar` → `registerPersonAnim` |
| `createWalkAvatar` 只返回 idle / walk / sit | `glb-assets.ts:697-715`；**不返回 talk**，坐姿 `sit` 可为 null |
| 本地兜底 `people.glb` 有 idle / talk / walk，没有 sit | `assets/README.md:12-13`；`people-model.test.ts:51-56` |
| people06 的 27 个云端角色文档记录为 3 条 clip（Idle / Walk / Sit） | `docs/plans/2026-11-16-people-asset-pipeline.md:165`；是否每个资产都有 talk 必须逐个验，不能假设 |
| 户外地面有 5.2 cm 基准 | `outdoor-plan-3d.tsx:126` `PLAN_LAYER_BASE_Y = 0.052`；胶囊体按这个 y 摆，`useWalkAvatar` 的 y 公式没有这个偏移 |
| 漫游帧已带 `delta` / `seated` / `seatHeight`，但 ref 类型没带 | `use-outdoor-walk.ts:32-44`；`outdoor-plan-3d.tsx:411` 的 `walkFrameRef` 只有 x/y/z/yaw/moving/thirdPerson |
| 场景只在图源 / 初始视口 / anchor 变化时重建 | `outdoor-plan-3d.tsx:2314` 的依赖数组；普通 plan 编辑不重建 |
| `createWalkAvatar` 是克隆实例，缓存释放不会直接弄坏已建好的实例 | `glb-assets.ts:532-562`、`697-715`；但必须自己 `disposeOwnedModel` + 停 mixer |

#### 先修 E6 的 talk 空片段

`outdoor-plan-3d.tsx:1114` 把 crowd 的 `talk` 明确写成 `null`。E6 的流程是 `setNearestPersonAction` → `playClip` → `resolvePersonAction`，缺 talk 时会回退 idle；随后 `personActionState(target).current !== 'talk'`，界面出“这个人物暂时没有该动作片段”。所以**桌 / 摊位按 E 目前不是“NPC 在交谈”，而是“选到了 NPC 但没有 talk 片段”**。37 例测试用的是自带 talk clip 的假实例，没有覆盖户外真实注册项。

修复顺序不能反：

1. 先确认目标 crowd 资产到底有没有 `Idle_Talking_Loop`；没有就不要把“交谈”写成已接通。
2. 若资产有，给 `createWalkAvatar` 增加可选 `talk` 返回，并把它传进 `registerPersonAnim` 的 `clips.talk`；不要再写死 `null`。
3. 若目标资产没有，保留“缺片段”提示，或换有 talk 的资产；不要用 idle 冒充交谈。

#### 推荐接入路径

**E7a（下一步代码切片，先不接场景）**：新增 `three/outdoor-player-avatar.ts`，只做户外玩家控制器：

- 用 `ensureGlbAsset(assetId, url)` + `createWalkAvatar` 加载；失败或缺少 idle/walk 时保留胶囊体。
- 输入帧包含 `x/y/z/yaw/moving/thirdPerson/seated/delta`；站立时脚底放 `baseY`，落座时按 `sitHeadY` 对齐，**始终加 `PLAN_LAYER_BASE_Y`**。
- 维护 idle/walk 交叉淡化；`seated` 且 `avatar.sit` 存在才切 sit，缺 sit 不把角色沉到地面。
- 不创建室内 `useWalkAvatar` 里的“游客” NPC，也不带打招呼状态。
- `dispose()` 停 mixer、`uncacheRoot`、`disposeOwnedModel`；用 generation/run guard 拦晚到加载。
- 可选 `talk` 由控制器透出；`wave` 没有片段就不假装播放。

**E7b（接场景）**：给 `OutdoorPlan3D` 增加一个 `walkRole` 入参（assetId / url / name），从 `room-organizer.tsx:4986` 现有的 `walkRoleUrl` 传入；不改 `SitePlanData`、routeBridge 或合同字段。保留 `avatarGroup` 和胶囊体，GLB 加载成功后才替换子节点；动画循环 `2122-2131` 改调控制器；清理段 `2291-2293` 释放控制器。

**不要**把 `walkRoleUrl` 加进 `2314` 的场景重建依赖：那会在换角色时重建整张地图。用独立的加载 effect + `sceneEpoch`（或控制器自己的 scene 引用）处理换角色和 anchor 重建。`walkFrameRef` 类型也要补 `delta` / `seated`，否则控制器拿不到动画时间。

#### 需要产品拍板

- 玩家在桌边按 E 时，是玩家自己 `talk`，还是最近 NPC `talk`？两者都播会像双人同时自言自语；建议玩家优先，NPC 只在不接管玩家时响应。
- 舞台 `wave` 当前没有资产；缺片段时保留“暂时没有该动作片段”，不要用 idle 冒充挥手。
- 换角色是否要户外即时热切。第一版可以只要求“进漫游前选好角色”，热切作为 E7c。

#### 验收口径

- 第三人称显示 GLB，第一人称隐藏；走路/idle 正常切换；坐下对齐椅面，不起身时不沉地。
- 网络失败或资产缺 idle/walk 时仍显示胶囊体，不白屏、不抛未捕获异常。
- 换角色 / anchor 重建后不残留旧 avatar；旧 mixer 与几何释放。
- `tsc --noEmit` 0；控制器纯单测覆盖加载失败、sit 缺失、站/坐 y、dispose。

### E7a 户外玩家 avatar 控制器（2026-11-16 22:55）

新增 `three/outdoor-player-avatar.ts`，只做“已取得 GLB actor 之后”的控制器，不接 `OutdoorPlan3D`、不改生产入口。

- `createOutdoorPlayerAvatar({ scene, role, load? })`：加载失败、加载后缺 idle/walk 都返回 `null`，场景不变；成功才 `scene.add(group)`，初始只播 idle、`visible=false`。
- 帧输入 `x/y/z/yaw/moving/thirdPerson/seated/delta`；站立脚底固定 `baseY`（默认 `OUTDOOR_PLAYER_AVATAR_BASE_Y=0.052`），落座用实测 `sitHeadY` 对齐，y 额外加底座。
- 没有 `Sit_Idle_Loop` 或量不到 head 节点时**不切坐姿、不沉地**；起身后按 `moving` 重新切 walk/idle。
- `dispose()` 停 mixer、`uncacheRoot`、移出场景并 `disposeOwnedModel`；`setFrame` 在 dispose 后静默返回。
- 不创建室内 `useWalkAvatar` 的游客 NPC，不接打招呼；也不包含 talk/wave/LOD。

验证：`outdoor-player-avatar.test.ts` 6 例通过（加载失败/抛错、站立与第一人称隐藏、idle↔walk、坐姿 y、缺 sit 兜底、dispose）；`tsc --noEmit -p tsconfig.json` 返回 `TSC_EXIT=0`。

边界：没有生产 import，没有接场景，没有浏览器 E2E；下一片 E7b 才把控制器接进 `OutdoorPlan3D`。

### E7b 户外玩家 avatar 接场景（2026-11-16 23:08）

把 E7a 控制器接进 `OutdoorPlan3D`，不改合同字段、routeBridge、`SitePlanData` 或 `scendance-workspace.tsx`。

- `OutdoorPlan3DProps` 新增可选 `walkRole`（`assetId / glbUrl / name`）；`room-organizer.tsx` 从现有 `walkRole` + `walkRoleUrl` 传入。
- 独立加载 effect 用 `sceneEpoch` 处理场景重建，不把 `walkRoleUrl` 加进场景重建依赖；换角色只重载 avatar，不重建整张地图。
- 加载成功才隐藏胶囊体；加载中、失败、缺角色都保留胶囊体兜底。切角色时先恢复胶囊体，再异步换新模型。
- `walkFrameRef` 改用 `OutdoorWalkFrame`，主循环把 `delta / seated / thirdPerson` 一起交给控制器；第一人称、鸟瞰、接管 NPC 时控制器隐藏。
- 场景清理先 `dispose()` 控制器并递增 generation，晚到的加载结果直接释放；胶囊体引用同时清空。

验证：

```text
outdoor-player-avatar.test.ts：7 passed（新增“dispose 后挂新角色”生命周期例）
核心回归：11 个文件 154 passed
tsc --noEmit -p tsconfig.json：TSC_EXIT=0
```

边界：没有浏览器 E2E；没有真实 crowd GLB 的视觉验收；玩家模型会在 3D 场景建立后即预加载，不是等进入漫游才加载。

### E7c crowd talk 片段核验（2026-11-16 23:08，结论为“不接线”）

逐个解析 `.cache/aholo/upload/people/` 下 16 个 labor GLB 的 JSON chunk：**全部只有 `Idle_Loop`、`Walk_Loop`，没有 `Idle_Talking_Loop`**。`docs/plans/2026-11-16-people-asset-pipeline.md` 记录 27 个角色资产均为 `Idle_Loop / Walk_Loop / Sit_Idle_Loop` 三条，也没有 talk。本地 `people.glb` 虽有 talk，但不是 crowd 使用的角色资产。

因此本轮**不把 `talk: null` 改成假接通**：保留 `null`，让 `people-anim` 回退 idle，并让 E6 继续给“这个人物暂时没有该动作片段”的短提示；舞台 wave 同样不冒充。代码只补了证据注释。要真正让桌 / 摊位交谈，需要先为 crowd 资产生成或换入带 `Idle_Talking_Loop` 的 GLB（涉及真实重定向/积分，需真人授权）。

### C1 生成额度跑通预检（2026-11-16 23:19，只读，未打勾）

性质：只读路径核对；没有点击「生成」、没有提交任务、没有消耗额度、没有改代码。`C1` 仍未打勾。

#### 入口与真实组件

1. 户外规划选中设施 → 属性卡模型条下三格：
   - `facility-model-generate`「文字生成」→ `openGenerationSheet({ task: 'model', scope: 'facility', source: 'text', facility })`（`outdoor-plan-canvas.tsx:9486-9492`）
   - `facility-model-upload`「图片生成」→ 同一面板 `source: 'image'`（9496-9502）
   - `facility-model-import-glb`「导入 GLB」→ 本地文件，不扣额度（9506-9512）
2. 实际界面是左栏统一生成面板 `GenerationSheetHost`（`room-organizer.tsx:4678`），标题「生成模型」，目标行 `data-testid="generation-target"` 显示 `用于「设施名」`；不是弹窗。
3. **`components/outdoor-facility-generate.tsx` 当前没有生产引用**（只被自己的测试引用）。它虽然有更完整的 `submission` 锁和 taskid 回执，但 C1 不能拿它当入口；此前把它当 C1 入口是误判。若要复用它，需另开接线项，不在本轮。
4. 提交链：`submitModelJob`（`lib/model-generation.ts:58`）→ `controller.createGenerationJob(prompt, crypto.randomUUID(), { kind, ...provider })`（`lib/backend-session.ts:1791`）。面板不让人选引擎：HY-3D 优先，未开通才落 Aholo（`pickEngine`）。

#### 额度闸门与记录点

- `generationNeedsCredit`：文字/图片模型为 true，导入 GLB 为 false（`lib/generation-sheet.ts:153-157`）。
- 面板只有勾选 `消耗额度` 才点亮主按钮 `data-testid="generation-primary"`（`panels/generation-sheet.tsx:440-456`）；未登录/只读/能力未就绪时主按钮 disabled，原因在 `title`（`generationBlockReason`）。
- 成功提交后，`recordFacilityGenerateLink` 先把设施暂存，`consumeFacilityGenerateLink(job.id, ...)` 把任务写成 `localStorage['scendance:facility-generate-links']` 的一条 link；link 里有 `taskid / facilityId / facilityName / name / submittedAt`。**面板提示只显示 `已提交：「描述」...`，不显示 task id**，所以 C1 记录要在 DevTools Network 或 localStorage 取。
- `createGenerationJob` 的服务端幂等键是 `requestId`（本次点击生成的一次性 UUID）；面板不持久化 `requestId`，也没有「结果未知」锁。若 POST 后网络中断，`submitModelJob` 会抛错，面板只显示普通失败；服务端可能已创建收费任务。**此时绝不能二次点击**，只能查 `GET /jobs` / 任务记录。
- 计费是项目 AI 预算表 `scene_private.budgets` 的 `reserved_cents / committed_cents`，实际金额 `requests.actual_cents`；客户端 `GET /jobs` 只返回 `generation_jobs`（含 `provider_usage`），不含 `actual_cents`，**当前 UI 不显示具体金额**。C1 的「扣费」需要后台/管理端，或确认 `provider_usage` 里含费用字段；若拿不到金额，只能记「任务已创建、金额不可见」，不能写 PASS。

#### C1 真人执行卡（只跑一次）

前置：

- 真人登录云项目、项目可写、生成能力已就绪；描述已填时，勾选后主按钮才可用。
- 选一个低风险设施，用文字描述；图片生成先不做，减少变量。
- 打开 DevTools Network，过滤 `jobs`；记录提交前的时间、预算/账单基线（若管理端可见）。

步骤：

1. 选中设施 → 点「文字生成」；确认标题「生成模型」、目标行 `用于「…」`。
2. 填写描述，等能力读取完，勾选「消耗额度」。
3. 只点一次「生成」。记录：请求时间、`POST /jobs` 的 `requestId`、HTTP 状态、响应 `id`。
4. 在 Console 执行：
   `JSON.parse(localStorage.getItem('scendance:facility-generate-links') || '[]')`
   记录最新一条的 `taskid / facilityId / facilityName / submittedAt`。
5. 回到画布，等属性卡 `facilityGenerateStatus` 轮询（15s）与候选回填；选中候选，确认 GLB 显示。
6. 记录 `GET /jobs/<id>` 的 `state / provider_usage / asset_id`；若管理端有 `requests.actual_cents` 或预算变化，记录金额。
7. 确认只有一条 `POST /jobs`、一个 job id、一次候选回填；不重复提交。

PASS：一次 POST → 一个 job id → link 落盘 → 候选回填 → GLB 可用；金额/预算变化与一单一致。

FAIL：重复 POST/重复 job、候选不回填、GLB 不可用、两笔扣费。

BLOCKED：无登录/云项目/能力；只能拿到任务但拿不到扣费金额（且 `provider_usage` 不含费用）；POST 结果未知。

红线：

- 任何网络错误/超时后不重试，不换来源再试；先查任务与费用。
- 不用「导入 GLB」冒充 C1；它明确不扣额度。
- 不用旧 `OutdoorFacilityGenerate` 的截图/回执冒充统一面板验收。
- 不把 `provider_usage` 当金额，除非确认字段含费用。

#### 预检发现的 C1 风险（不改代码，等真人/产品决定）

1. 统一面板不显示 task id；C1 只能从 Network/localStorage 取。
2. 统一面板没有 `requestId` 持久化与 unknown 锁；网络中断可能已收费，但没有旧弹窗那套「不重发」保护。
3. `consumeFacilityGenerateLink` 写的 link 不带 `projectId`；`listFacilityGenerateLinks(undefined, generationProjectId)` 对无 projectId 的 link 一律放行，多项目且设施 id 重名时可能被别的项目轮询到。C1 单项目单设施不受影响，但多项目验收要小心。
4. `provider_usage` 不等于金额；`actual_cents` 客户端不可见，C1 的「扣费」需要管理端。
5. 提交失败时 staged link 不会被清；10 分钟内另一次生成成功可能消费到上一个设施，低概率但存在。

## 4. 15 分钟续跑队列

每轮只做一项，做完打勾并写结果；没有可做项就只读研究，不改代码。

- [x] A1 `lib/prop-interactions.ts` + 单测：椅子→坐、桌子→交谈、舞台→挥手、围栏/绿植→无。
- [x] A2 把 `prop-interactions` 接进 `outdoor-interactables`：新增 `propInteractables`（坐具仍走 seat；桌/摊位/舞台给「交谈 / 挥手」文案；围栏等保留原名），并接到 `outdoor-plan-3d` 的注册表。23 例通过，tsc 干净。复核后修掉：真实 `PlanFacility` 没有 `ref`，改用 `modelOverride ?? templateId`；不再用标签单独判坐具；补强 kind 断言；岗亭不再误判摊位、餐车按售卖摊位交谈。现 24 例通过。
- [x] A3 在属性卡里露出只读「可交互：坐下 / 交谈」，靠近道具时的 3D 提示沿用 A2 的 `E` 文案；不改 `scendance-workspace.tsx`。25 例通过，tsc 干净。
- [x] B1 为 main 的门吸附与本地 `outdoor-plan-canvas.tsx` 罗盘改动画冲突图，写一份 cherry-pick 顺序。结论：无真文本冲突；顺序 `09ad68aa` → `2417ff5b` → `54137efd`，详情见 §B1。
- [x] B2 真机验收清单已写入 §B2：OFM Network、分享三受众、罗盘弯箭头、漫游碰撞、aholo 多模型，含步骤、通过标准、取证模板。**实机尚未执行**。
- [ ] B2-run 按 §B2 在真人浏览器里逐项打勾并留证（需登录 / 样例项目；不冒充已验收）。
- [ ] C1 积分生成跑通一次（必须真人在场，记录任务 id 与扣费，不重试）。预检已完成，见 §C1；入口是统一生成面板，不是 `outdoor-facility-generate.tsx`；仍未打勾。
- [x] D1 375 宽左侧导航复核：原报告把桌面轨内的 `展开导航栏` 当入口；实际入口是可见的 `助理菜单`，四入口需先展开菜单。结论见 §D1，暂不改 CSS。
- [x] D1-verify 按 §D1 在 375 宽实测：`助理菜单` 可点开，空间/物料/场地/户外规划四项全部可见；点空间能开左卡并收起菜单，控制台 0 错误。误报确认，无需改 CSS。
- [x] E1 people06 坐姿 / 交互链路只读研究：核心座位链已在当前树；缺 `person-action-state`、人物动作 API 与道具→动作接线。详见 §E1。
- [x] E2 main 剩余提交 × 本地树只读冲突图：26 个提交、5 个重叠文件；4 个代码文件整份 diff 均可应用，风险在功能依赖与语义，不在文本冲突。详见 §E2。
- [x] E3 `lib/person-action-state.ts` + 单测落地：缺片段回退 idle、wave/emote 一次性分类；6 例通过，tsc 0。未接任何现有播放逻辑。详见 §E3。
- [x] E4 可交互条目携带 `personAction`：seat→sit、桌/摊位→talk、舞台→wave、惰性道具不带；31 + 11 例通过，tsc 0。E 键仍未播放。详见 §E4。
- [x] E5 人物动作 API：`setPersonAction` / `personActionState` / `setNearestPersonAction`，缺片段回退 idle；12 例通过。详见 §E5。
- [x] E6 E 键道具动作：非座位条目驱动最近静止 NPC（talk/wave，半径 3.2 m），无目标/缺片段给短提示；37 例通过，tsc 0。玩家胶囊体仍未接 GLB 动作。详见 §E6。
- [x] F 交接状态：核心回归 10 文件 147 例通过、tsc 0；手测口径与已知边界写入 §F。
- [x] E7 户外玩家 avatar 接 GLB 只读可行性：确认室内 `useWalkAvatar` 已接线、户外仍是胶囊体；发现 crowd `talk: null` 使桌边 E 实际只出“缺片段”提示；接入顺序与底座偏移写入 §E7。未改代码。
- [x] E7a 新增 `three/outdoor-player-avatar.ts` 控制器 + 单测（不接场景；含失败兜底 / sit / y 基准 / dispose）。6 例通过，tsc 0。
- [x] E7b 把控制器接进 `OutdoorPlan3D`，从 `room-organizer.tsx` 传 `walkRole`；保留胶囊体兜底。7 例控制器测试 + 11 文件 154 例核心回归通过，tsc 0。
- [x] E7c 核验 crowd 资产 clip：16 个 labor GLB 逐个解析、27 个角色清单记录均无 `Idle_Talking_Loop`；保留 `talk: null` 与缺片段提示，只加证据注释，不冒充“交谈/挥手”。

## 5. 定时任务约束

- 每 15 分钟一轮，单轮不超过一个小切片；改完必须跑对应 vitest（Node24）与必要 `tsc --noEmit`。
- 不 commit / push / 部署；不碰 `panels/scendance-workspace.tsx` 本体；不改既有合同字段与 bridge 签名。
- 不自动消耗积分；C1 只能由真人发起。
- 结果追加到 `2026-11-16-outdoor-agent-progress.md`，不要新建一堆临时文件。
