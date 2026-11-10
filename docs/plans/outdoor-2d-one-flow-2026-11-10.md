# 一条链：2D 规划 ↔ 3D 场景 ↔ 交付（P4 计划）

日期：2026-11-10 · 分支 `feat/outdoor-2d` · 作者：协作会话（用户口述需求，AI 整理）

## 0. 用户要的到底是什么

按时间顺序收拢用户原话（不翻译、不改写）：

- m01270「达到我的2d的布置和现有3d巧妙结合的目的就行。不要忘记oneplan的参考」
- m01410「标注区和地球一定要把功能结合在一起」
- m01419「我现在在画面里面看不到那个图标库」
- m01437「要深度去做分析，看怎么打通全流程。而不是在画面不停地把功能随便摆放」
- m01456「左侧目前我只有左上一个agent，其他的眼睛什么都可以去掉」
- m02015「空间里面的场景信息记录是不是该换位置？」
- m02033「3d里面我也希望用我的2d的地图作为底图，而不是之前的高德的api」
- m02037「导出 分享 发布 应该是一起的」

一句话目标：**同一个场地，只有一份规划数据、一张画布、一套交付入口；3D 只是这张平面的另一种看法，而不是另一套系统。**

## 1. 现状（已核实到文件）

| 维度 | 室内「标注」 | 户外「地图规划」 |
| --- | --- | --- |
| 数据 | `LayoutPlanDraft`（`frontend/lib/plan-annotation.ts`：zone/route/measure/door，中心原点米制） | `SitePlanData`（`supabase/functions/_shared/site-plan.ts`：zones/facilities/routes/nodes/workers/measurements，anchor 相对 ENU） |
| 画布 | 3D canvas 上的 SVG 覆盖层 `frontend/components/room-organizer/canvas-2d/plan-overlay.tsx` | 独立双 canvas `frontend/components/room-organizer/components/outdoor-plan-canvas.tsx`（底图瓦片层 + 业务图层） |
| 交互 | `hooks/use-plan-annotations.ts`（预览/撤销/提交），引导卡 `panels/annotation-guide.tsx` | 9 个编辑模式 + 顶部工具条 + 左栏三页签（图层/信息/物件库） |
| 落到 3D | `frontend/lib/plan-approve.ts`（zoneType → 家具配方）→ `layout.floors[].items` | `three/plan-footprint-builder.ts` + `three/plan-props-builder.ts`（`ROOM_OBJECT_TAGS.PlanFootprint` 图层，不进 `items`） |
| 交付 | `panels/share-menu.tsx`（发布/评审链接/导出交接） | 画布右上 导出 + 分享（`components/outdoor-plan-overlay.tsx`） |
| 底图 | 3D 场景/平面图 | 瓦片（OSM/Carto/天地图）+ 3D 地面贴图走**高德静态图 API**（`lib/amap-venue.ts` `fetchSatelliteGroundDataUrl` → `layout.floorPlanImage` + `layout.mapGroundFrame`） |

问题不是「功能少了」，是**同一件事有三份表示、三个入口**，所以每加一个功能都只能再摆一个钮。

## 2. 五个决定

### D1 一份数据：`SitePlanData` 是唯一真相

- 平面上的分区 / 动线 / 出入口 / 设施 / 人员 / 测量，全部落在 `SitePlanData`，存 `localStorage` 的 `scendance-outdoor-plan-v1:<projectId>`（已有），将来同结构上云。
- 室内旧的 `LayoutPlanDraft` **不删**，改成边界处的适配器：`lib/plan-unify.ts`
  - `layoutPlanDraftToSitePlan(draft, { width, depth }) → SitePlanData`
  - `sitePlanToLayoutPlanDraft(plan, { width, depth }) → LayoutPlanDraft`
  - 坐标口径：annotation 是房间中心原点（x 东、z 南）；SitePlan 是 anchor 相对 ENU（x 东、y 北）。换算 `planX = annoX + width/2`、`planY = depth/2 - annoZ`（与 `lib/outdoor-venue-sync.ts` 的 `shellVenueToPlanBoundary` 同一套）。
  - 语义映射：室内 `roundtable/desk/photo/rest` 在 SitePlan 里落到 `semantic:'audience'` + 原名进 `name`；`预留区/消防疏散` → `semantic:'reserved'`（keep-out 语义一致）；`stage/checkin/parking/loading/queue/medical/vip` 一一对应。
  - `plan-approve`（zoneType → 家具）继续读 `LayoutPlanDraft`：读之前用适配器转一次，agent 面板与评分链路零改动。
- 收益：物件库（397 件）与室内家具走同一张「设施表」，3D 与清单都只读这一份。

### D2 一张画布：地图 / 平面图只是底图不同

- `outdoor-plan-canvas.tsx` 增加 `planBase: 'map' | 'floor'`：
  - `map`：现有瓦片管线（OSM/Carto/天地图）。
  - `floor`：不拉瓦片，画房间轮廓（`layout.width/height` + `backendVenue.polygon`）+ 网格 + 已有家具的俯视轮廓（复用 `canvas-2d/render.ts` 的 `worldToScreen` 口径），边界即房间轮廓。
- 工具条与编辑模式**完全共用**：选择 / 画分区 / 画动线 / 量距离 / 标出入口 / 放物件 / 编辑顶点。
- 入口收敛：左轨「规划活动区域」（旧标注入口）改为直接打开这张画布（`floor` 底图、当前层、分区工具）；`annotation-guide.tsx` 那套「画区域/画路线/量距离/标出入口」四个钮退役，文案由工具条统一提供。
- 3D 里点「2D / 3D」= 切换视角，不再切换产品。

### D3 一个交付簇：导出 / 分享 / 发布（右上角）

- 画布右上固定一组三枚：`导出 ▾` · `分享` · `发布`，2D/3D 两种视图都在同一位置、同一顺序。
- 语义绑定同一份快照：
  - 导出：2D 视图导出平面 PNG/PDF，3D 视图导出效果图（现状保留）。
  - 分享：只读规划链接（现有 `/plan-share` + 快照 rN）。
  - 发布：现有 `panels/share-menu.tsx`（方案预览/手机看方案/项目大纲/发布当前版本/发评审链接/导出交接/到场清单）。
- 实现：`ShareMenu` 增加 `variant:'rail'|'canvas'`；画布交付簇渲染 `<ShareMenu variant="canvas">`，3D 右轨不再单独保留发布钮（同一功能只留一个入口），右轨工具排测试同步更新。

### D4 3D 地面贴我们自己的 2D 地图（替换高德静态图）

- 现状：`lib/amap-venue.ts` 的 `fetchSatelliteGroundDataUrl` 拉高德 `v3/staticmap`，写 `layout.floorPlanImage` + `layout.mapGroundFrame`，3D 地板用它作贴图。
- 改为：**用我们 2D 画布的瓦片管线离屏合成**同一张图——
  - 新增 `lib/plan-ground-capture.ts`：`capturePlanGround({ center, zoom, bboxMeters, pixelRatio }) → { dataUrl, frame }`，内部复用 `lib/plan-tile-cache.ts` 的 `BasemapTileCache` + `paintBasemapTiles`（同源瓦片、同源缓存，不会两套底图打架），按 bbox 算瓦片网格、离屏 canvas 合成、`toDataURL`。
  - `frame` 写进 `layout.mapGroundFrame`（`MapGroundFrame`：bounds/center/zoom），保证 3D 贴图与 2D 画布逐像素对齐。
  - 高德路径保留为「可选图源」（`ensureSatelliteGround` 只在没有 2D 地图时兜底），默认走自绘。
- 收益：底图只有一套；用户在右下角选的底图（OSM/Carto/天地图）直接决定 3D 地面长什么样。

### D5「场景信息记录」搬出「空间」

- 现状：「空间」面板（`panels/space-panel.tsx` + `lib/calibration-hud.ts`）混了两类东西：**场地来源**（实景扫描/示例/地图选址）和**场景信息记录**（空间标定 1:1、朝向、原点、基准高度、场景光照匹配）。
- 决定：空间 = 只回答「这是哪块场地」；场景信息记录移到**右栏顶部的场景状态条**（可展开的「场景」页签），内容改为只读摘要 + 「重新标定」入口；3D 顶右楼层芯片旁边显示场地尺寸/朝向摘要。
- 这样「空间」不再是一个什么都塞的设置抽屉。

## 3. 施工顺序（每阶段都可独立验收）

| 阶段 | 内容 | 主要文件 | 验收 |
| --- | --- | --- | --- |
| P4-a | 适配器 `plan-unify.ts` + 单测（坐标往返、语义映射、门/测量） | `frontend/components/room-organizer/lib/plan-unify.ts`(+test) | vitest 往返断言；tsc 0 |
| P4-b | 画布 `planBase:'map'\|'floor'` + 平面底图渲染；旧标注入口改道 | `outdoor-plan-canvas.tsx`、`room-organizer.tsx`、`annotation-guide.tsx` | 浏览器：开「规划活动区域」→ 同一张画布、floor 底图、能画分区；切回户外是地图底图 |
| P4-c | 交付簇：导出/分享/发布同组、同位置 | `outdoor-plan-overlay.tsx`、`panels/share-menu.tsx`、`scendance-workspace.tsx` | 浏览器：2D/3D 两态三钮都在右上、点开都对 |
| P4-d | 3D 地面用 2D 地图合成（替换高德默认） | `lib/plan-ground-capture.ts`(+test)、`lib/amap-venue.ts`、`room-organizer.tsx` | 浏览器：选 Carto 深色 → 3D 地面变深色卫星/街道图；`mapGroundFrame` 与 bbox 对齐 |
| P4-e | 场景信息记录搬出空间 + 空间瘦身 | `space-panel.tsx`、`calibration-hud.ts`、`room-organizer.tsx` | 浏览器：空间只剩场地来源；场景信息在状态条可展开 |
| P4-f | 3D 里点得中平面物件（`userData.type='furniture'` + id + revision bump），选中/删除/拖动反馈 | `three/plan-footprint-builder.ts`、`three/drag-handlers.ts`、`use-scene-effects.ts` | 浏览器：3D 里点帐篷 → 高亮 → Del 删除 → 2D 同步 |

## 4. 不做 / 缓做

- 不动 `supabase/functions/_shared/site-plan.ts` 的 zone 语义枚举（避免云端校验连带改动）；室内语义走「name + 适配器映射」。
- 不做云端草稿保存（Phase 3 子资源表），先保证本机一条链通。
- 不重写 3D 渲染管线；只加一个贴地面图层与一个拾取标记。
- 不动 `plan-approve` 的配方逻辑，只在读入处加适配器。

## 5. 风险

1. **坐标往返误差**：annotation 是中心原点、SitePlan 是 bbox 铺满；适配器用「bbox = 房间矩形」硬约束，两边尺寸必须一致，否则出现偏移 —— 单测覆盖往返与负坐标。
2. **交付簇重复入口**：`ShareMenu` 从右轨搬到画布会碰 `scendance-workspace.react.test.tsx` 的契约断言（要求 rail 里恰好 1 个「发布」）—— 同步改测试，不两头留。
3. **3D 贴图失真**：离屏合成的像素密度必须 ≥ 3D 地板所需；`plan-ground-capture` 按 `pixelRatio` 与 bbox 算分辨率，并保留 `mapGroundFrame` 供 `satelliteImageShellRect` 等既有函数消费。
4. **floor 底图与家具对齐**：必须复用 `canvas-2d/render.ts` 的 `worldToScreen`，不能另起一套缩放。