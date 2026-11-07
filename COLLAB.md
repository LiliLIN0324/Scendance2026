# COLLAB.md — 与 Qoder（账号 LiliLIN0324）的文件所有权边界

建立日期：2026-11-05
适用仓库：Scendance2026（main 分支，Cloudflare Pages 从 main 自动构建）
起因：computer-use 插件实测无法挂载（`ide_mcp.config.ext.computer-use not found`），改为在仓库内约定协作边界。

> 本文件只约定「谁改哪块、怎么改、怎么提交」，不替代代码规范与设计文档。
> 任何一方要改动另一方独占的区域，先走第四节「待协商」流程。

---

## 一、渲染 / 导出链路：归我方独占（Qoder 不要直接改）

以下 5 个文件构成一条闭环，任一环变动都会让成图静默失效（不报错、只是图不对）：

- `frontend/components/room-organizer/hooks/use-import-export.ts`
- `frontend/components/room-organizer/hooks/use-splat-preview.ts`
- `frontend/components/room-organizer/three/splat-preview.ts`
- `frontend/components/room-organizer/room-organizer.tsx`
- `frontend/components/room-organizer/panels/scendance-workspace.tsx`

**为什么独占：**

1. 导出合成 3DGS 刚验通：成图 **1920×1080、2,722,871 B**，与「无点云」对照组**逐像素 diff 69.24%**——说明真实场地确实进了成图。这个结论依赖上面五处协同：`room-organizer.tsx` 注入 `paintFrame`，`use-import-export.ts` 用它走同一条渲染路径，`scendance-workspace.tsx` 负责档位与触发。
2. `use-import-export.ts` 的 `resolution` 分支（固定 1920×1080 起算、导出时改 `camera.aspect` / `pixelRatio` 再还原）**目前没有单测覆盖**；改坏了构建仍会通过，只有出图时才发现。
3. 需要调整导出尺寸、档位、点云合成顺序时，由我方先补测试再改；Qoder 侧只提需求，不直接编辑这五处。

## 二、几何基线：禁改

- `frontend/components/room-organizer/three/scan-placement.ts`
- `frontend/components/room-organizer/three/furniture-builders.ts`

**为什么禁改：** 现有基线已实测达标——**3° 斜场贴地残差 0.0 mm**，**69 件布置 0/69 超差**。证据在 `docs/evidence/measure-2026-11-05/`。这两处承载米制尺度、贴地与朝向的唯一真值，改动会让所有历史方案的尺寸悄悄漂移，且不易被 UI 察觉。

## 三、提交纪律

- 不用 `git add -A`、`git add .`、`git commit -a`；**只按明确路径 add 自己改过的文件**。
- 提交前先自查：`git status`、`git diff --stat`，确认没有捎带别人的半成品。
- 不提交 `.env`、任何密钥、`.temp/`、`exports/`、`docs/evidence` 下新生成的证据文件。
- 反面案例：`8362728` 一次性把 **108 个文件**（付费、采集、导出、文档、台账、脚本）收进一个提交，把多条在途分支的边界全部打穿。不要重复这种收口方式。

## 四、要改上面任何区域：先登记，后动手

在文末「待协商」表里加一行，写明：**意图 + 涉及文件 + 时间 + 提出方**，等我方确认后再改。未登记直接改的，按回退处理，不进入评审。

### 待协商

| 日期 | 提出方 | 意图 | 涉及文件 | 状态 |
| --- | --- | --- | --- | --- |
| 2026-11-05 | Qoder（LiliLIN0324） | 补登记（改动早于 COLLAB.md）：应用调研底图时清掉旧场地的 `mapGroundFrame/mapGroundPolygon/mapLngLat`，否则卫星贴地会用旧坐标重写 `sceneAnchor`，把底图甩到千公里外。只动 `applyResearchArea` 一段。 | `frontend/components/room-organizer/room-organizer.tsx` | 已吸收（2026-11-07 提交 7f4209c：presetId 保锚点分支演进覆盖「清旧坐标」诉求，主要风险已由 amap-venue 的 researchArea 守卫替代；分支 feat/research-basemap-anchor 无需再合并） |
| 2026-11-05 | Qoder（LiliLIN0324） | 补登记（改动早于 COLLAB.md）：导出成图时隐藏点云定位辅助（网格、footprint 边线、基准面、锚点标记）；`SplatPaint` 增加可选 `guides`，预览行为不变。只动导出传参与辅助层可见性。 | `frontend/components/room-organizer/hooks/use-splat-preview.ts`、`frontend/components/room-organizer/three/splat-preview.ts` | 已吸收（2026-11-07 提交 aaf8abd，内容与分支 b8848ec 等价；feat/clean-export-guides 无需再合并） |
| 2026-11-05 | Qoder（LiliLIN0324） | 让调研底图真正垫在 3D 点云下面：点云是独立背景栈、主场景后画，底图留在主场景里无论多低都会盖住点云。改为渲染背景层时把 `research-basemap` 临时并入点云场景，**主场景画完再挪回**（先挪回会被主场景重画一遍，照样压住点云）；同时自动铺图（`researchArea.scanAssetId`）时概览取景不再套用 1600 m 底图框。用户已确认「改」，西湖场同机位 A/B 截图已验（有/无底图，茶亭像素一致）。 | `frontend/components/room-organizer/three/splat-preview.ts`、`frontend/components/room-organizer/room-organizer.tsx` | 已提交（underlay 挪栈随 7f4209c，lodUrl/frameTick 随 e6cb502） |
| 2026-11-07 | ZCode 会话 | 4 项长期失败测试的断言对齐（只改测试不改组件）：map-venue-overlay 2 项对齐「圈完即收」（组件 1556 行用户文案、1789 行注释、同文件 D0 用例三重背书现行行为）；venue-picker 2 项把入口改到空间脸 chip「新建/换场地」（v3.3.0 110f348 已挪）。测试为 Qoder 所写，若对设计意图有异议可回退本提交另行对表。 | `frontend/components/room-organizer/panels/map-venue-overlay.react.test.tsx`、`venue-picker.react.test.tsx` | 已执行（提交 3371ade，两文件 12/12 过），待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | SC-19 修复 #1：把左栏「活动需求」的需求人数接进 2D 三版打分——`generateScoredPlans` 增加 `targetCapacity` 入参（读 `brief-headcount-store` 模块镜像，镜像由 creative-studio 的 brief 副作用按「非脚手架」谓词写入），装不下时方案卡出「装不下 N 人 + 建议降到」降容话术（docs/27 B4 断点补上）。只动 scoredPlans 计算处一个 hunk + 1 行 import。 | `frontend/components/room-organizer/room-organizer.tsx`（另涉及 `panels/creative-studio.tsx`、`panels/brief-headcount-store.ts`，均非独占区） | 已执行（见 HANDOFF SC-19 行），待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | SC-19 §五.4 必留通道输入（SC-20 输入侧）：① `generateScoredPlans` 调用从只传 zone 改为传**全量 draft 标注**（zone+route+door+measure；各消费端均按 kind 过滤）——修复「门弧检查与 verified assurance 在产品里从未激活」的接线缺口，同时让 route 折线进入评分；② `zoneTypesForSuggestions` 对无 zoneType 的区不再假报圆桌；③ 批准零家具时的兜底文案对「只画了预留区」的草案说人话。生成/评分纯函数层（plan-annotation/plan-approve/plan-scoring/flow-constraints/human-factors）的配套改动不在独占区，随本提交入库。 | `frontend/components/room-organizer/room-organizer.tsx`（scoredPlans 调用、suggestions 过滤、onApprove 空文案三处 hunk） | 已执行，待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | 纯注释勘误（零行为改动）：docs/49 已于 73ce40c 重命名为 docs/19，独占区内 3 处注释仍引用旧号，`replace_all` 只改 `docs/49`→`docs/19` 字面量（L1903/L2404/L2530 附近）。 | `frontend/components/room-organizer/room-organizer.tsx`（仅注释）；非独占区另有 `panels/agent-panel.tsx` 注释 2 处、`docs/23` 引用 1 处 | 已执行，待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | MAP-03 地图到实景（独占区四处 hunk）：① `splatLodEnabled` 门控从「仅整景区 presetId」扩到「有任意调研底图 + 有点云环境」——scanAssetId 自动铺图/地名定位的概览视距同样不解码点云（沿用 splat-lod.ts 的 100/200 m 滞回，阈值不动）；② `applyRealVenue` 在视距 LOD=poi 时改为立即 `zoomToVenue`——原实现把 zoom 挂在 `pendingVenueZoomRef` 等 splat ready，但 poi 态 splat 被 defer 永不 ready，点位点击会死等不推近；非 poi 路径保持「等 splat ready 再 zoom」不变；③ 新增 `fitOverviewAfterFocusClear`（ref+rAF）：走查实测「底图 chip 回概览」同步调 `fitToRoom` 读到旧焦点闭包，取景停在场地框而非全湖——chip 的 `onFrameOverview` 与底图重置 effect 两处调用点改走它；④ import 区新增 `SceneAnchorSource`/`wgs84ToGcj02` 两行（配套 MAP-04）。 | `frontend/components/room-organizer/room-organizer.tsx` | 已执行，待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | MAP-04 收尾接线（独占区两处 hunk）：① `applyResearchArea` 加可选第二参 `meta: { source?, orientationDeg? }`，锚点落 `source` 元数据（默认 'manual'，整景区新建锚点 source='preset'）；② scanAssetId 自动铺图处——geo `source:'telemetry'`（WGS-84 遥测，通路预留）先过 `wgs84ToGcj02` 再喂 `createResearchArea`，`asset.geo.headingDeg` 存在时经 meta.orientationDeg 写入锚点朝向。现网 geo 全是 picker/manual/lookup（GCJ-02），行为零变化；telemetry/headingDeg 生产者出现前均为死分支。 | `frontend/components/room-organizer/room-organizer.tsx`（applyResearchArea 签名 + scanBasemap effect 一段）；非独占区配套：types/SceneAnchor 元数据字段、schema 校验放行、aholo-assets geo 扩 'telemetry'+headingDeg、amap-venue 两处锚点补 source:'picker' | 已执行，待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | PEOPLE-04 人物路线布点接线（独占区四处 hunk，零删除）：① 状态三件 `routeDrawItemId/routeDraft/routeDrawHint`（首个路点存草稿——单点路线过不了 schema 校验不能提前进 item；两点起直接提交 `actions.updateItem(walkRoute)`）；② `handleEmptyClick` 加 routeDraw 分支（routePointError 校验→草稿/提交，撤销边界靠 useHistory 自动快照，同 addInteriorWall 不 commitNow）+ deps 两行；③ `floorPickOnly` 追加 `|| routeDrawItemId !== null`（绘制中所有画布点击落到地面坐标，与画墙/测距同机制）；④ `<ItemContextPopover>` 传 `routeDrawing/routeDrawHint/onToggleRouteDrawing/onUndoRoutePoint` 四个 props（popover/PersonSections 均非独占区）。另加 stopRouteDraw + Esc/离开属性面板/取消选中三个收摊 effect、toggleRouteDraw/undoRoutePoint 两个回调、`routePointError` import 一行。 | `frontend/components/room-organizer/room-organizer.tsx`；配套非独占区：lib/person-route.ts（新）、three/people-anim.ts（新）、builders-people、use-three-scene、use-scene-effects、walk-collision、schema、types、item-context-popover | 已执行（浏览器 E2E：里程与路线逐段对账、闭环两圈、受阻折返解锁），待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | PEOPLE-04 后半·近景跟拍（独占区一处主题 hunk，零删除）：① 新增 `followPersonId` state + `toggleFollowPerson` 回调（toggle `setPersonFollowTarget(id, onEnd)`，目标被删时由 follow 模块回调 `setFollowPersonId(null)` 自动收摊；进入跟拍若在 2D 视图自动切回 3D）；② `<ItemContextPopover>` 加传 `following/onToggleFollow` 两 props。跟拍相机驱动不进本文件：tick 侧在 use-three-scene（非独占区）调 `advancePersonFollow(camera, controls, walkthroughActive)`，相机态不持久化、随场景删除自动退出。 | `frontend/components/room-organizer/room-organizer.tsx`；配套非独占区：three/person-follow.ts（新）、three/people-anim.ts（+personFollowSample 访问器）、hooks/use-three-scene.ts（tick 一行）、panels/item-context-popover.tsx（人物区按钮） | 已执行（单测 + 浏览器 E2E 跟拍位移与人物同步），待 Qoder 复核 |
| 2026-11-07 | ZCode 会话 | PEOPLE 收口两件（独占区一处主题 hunk，零删除）：① `handleEmptyClick` 路线布点分支加**贴障预检提示**——布点时 `buildWalkColliders`（排除被绘人物本人）+ 新纯函数 `walkerClearanceAt` 量距最近障碍的距离，< `ROUTE_WAYPOINT_CLEARANCE_WARN_M`(0.5m) 时 `setRouteDrawHint` 提示「可能被推挤折返徘徊」但**不阻断**（1.2s 受阻掉头仍兜底，用户可能就是要贴桌走）；import 区 +2 行（person-route 常量、walk-collision 两函数）。② 配套非独占区：2D 平面图行走者实时位置（`render.ts` 加 `personSample` 可选采样器，人物脚印/线符/选择框画到采样位；`drawPersonRoutes` 虚线折线投影路线，配色/闭环规则与 3D 同款）+ `use-scene-effects.ts`（2D paint effect 传 `personSample: personFollowSample` + 动画人物非零时挂 250ms 重绘 interval，注册表生命周期事件都伴随 layout 变化自动重评估）。 | `frontend/components/room-organizer/room-organizer.tsx`（handleEmptyClick 一段 + import 两行）；配套非独占区：canvas-2d/render.ts、hooks/use-scene-effects.ts、lib/walk-collision.ts（+walkerClearanceAt）、lib/person-route.ts（+常量）、render.test.ts（+5 例）、walk-collision.test.ts（+6 例） | 已执行（walk-collision 37 + render 27 + person-route 13 + people-anim 8 + person-follow 8 + popover 35 全绿；tsc 0 错；build exit 0；页面侧路线折线像素级对上预期路点，行走标记像素级确认归 SC-03 前台），待 Qoder 复核 |

---

## 已知未决工程项（只登记，不动手）

| # | 问题 | 现状 / 影响 |
| --- | --- | --- |
| 1 | `.gitignore` 把 `docs/evidence/aholo/` 放宽成整个 `docs/evidence/` | **已收口（2026-11-07）**：改为「默认不入库 + 白名单子目录」结构——白名单（sculpture-rig / sculpture-rig-local / sculpture-rig-tpose / recheck-tearoom 报告两件）已随本提交入库约 21 MB（含唯一有效绑骨交付物 sculpture-local-rig.glb/.blend，此前仅存本机盘、删了无法从 git 恢复）；spz/ply/zip/mp4/lrf/_hq.glb 与整包素材在所有证据目录一律排除。以后要入库新证据：在 `.gitignore` 的 `aholo/*` 重忽略行后加一行 `!docs/evidence/<sub>/` 并按需再排除重产物 |
| 2 | `deliverables/asset-ledger/glb-ledger.json` 属生成物入仓 | 1.53 MB / 5.3 万行，另有 CSV 322 KB；每次重新生成都会产生大 diff |
| 3 | `package.json` 依赖归类 | `miniprogram-automator` 放在 `dependencies`，应归 `devDependencies` |
| 4 | `frontend/.local-map.mjs`、`.local-map2.mjs`、`.local-map3.mjs`（另有 `.local-final.mjs`）未被 ignore | 调试脚本；谁做一次全量 add 就会被带上，提交前需确认 |

---

## 五、收尾纪律

- **长会话结束前必须更新根目录 `HANDOFF.md`**，五节固定：当前任务 / 已完成 / 卡住的问题 / 下一步计划 / 踩过的坑。
- **新会话开场第一句：「先读 HANDOFF.md」**，读完再动手。
- **永远维护同一份 `HANDOFF.md`**，不要另起 `HANDOFF-2.md`、`HANDOFF-日期.md` 之类的新文件；有新进展就覆盖旧内容。
- 数字类结论（字节、行号、接口返回）以仓库实测为准；复核不了的写「上传记录/外部后台」，不要编。
