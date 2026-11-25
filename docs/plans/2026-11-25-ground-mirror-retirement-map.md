# 贴地底图镜像退役（#38 ⑤）执行地图

日期：2026-11-25。范围：`layout` 的 6 个贴地字段（`floorPlanImage` / `floorPlanOpacity` /
`satelliteGroundRef` / `mapGroundPolygon` / `mapLngLat` / `mapGroundFrame`）何时能真正删掉。

## 一、先摆事实：读方不止「室内壳体」

`Select-String` 统计（`frontend/components/room-organizer`，排除 `*.test.*`）：
**43 个文件、456 处命中**。前 12 名：

| 文件 | 命中 | 这一处是什么 |
| --- | --- | --- |
| `lib/amap-venue.ts` | 97 | 高德选址/拼图：写镜像 + 判「这是不是地图贴地」 |
| `lib/plan-ground.ts` | 42 | 正源↔缓存换算本体（B4 新增） |
| `panels/scendance-workspace.tsx` | 41 | 档位与触发（独占文件） |
| `lib/schema.ts` | 35 | 持久化 schema 里的字段定义 |
| `hooks/use-scene-effects.ts` | 31 | 2D/3D 重绘；户外分支已短路、2D 已接 ground |
| `canvas-2d/render.ts` | 28 | 2D 卫星贴图（已接 ground） |
| `lib/west-lake-basemap.ts` | 26 | 西湖范围内的底图清理（按经纬判范围） |
| `three/room-builder.ts` | 20 | 室内壳体地面纹理 |
| `panels/agent-panel.tsx` | 18 | 场地记忆 / 空场地判定（④ 已接 `groundRecorded`） |
| `room-organizer.tsx` | 16 | 壳体写镜像 + 同步（独占文件） |
| `three/structure-builder.ts` | 14 | 室内壳体卫星 UV |
| `hooks/layout-reducer.ts` | 8 | reducer 里清/写缓存 |

**结论：不是「室内壳体删了就完事」**。`amap-venue` / `west-lake-basemap` / `ground-basemap`
这些是**户外**仍在用的地图子系统，读的是经纬多边形与框（`mapGroundPolygon` / `mapLngLat` /
`mapGroundFrame`），不是底图字节。删字段会同时打穿户外选址与西湖清理，所以字段退役必须
按「字节」与「定位」分开处理。

## 二、三段式（每段独立可验，不攒大招）

**S1 字节退役（只删 `floorPlanImage` / `floorPlanOpacity`）**
- 前置已具备：2D 卫星贴图、评审截图、交付核对基、空场地判定四处已改读 `plan.ground`。
- 仍需处理：`three/room-builder.ts`、`three/structure-builder.ts`（室内 3D 地面纹理与 UV）——
  这两个随 #38 室内壳体退役一起消失，不该单独接线。
- 验收：同一份「盐官古城」夹具，2D 出图 `drawImage` 参数序列与改前逐项相等；
  室内壳体的成图对照只在壳体退役那一笔做。

**S2 定位退役（`mapGroundPolygon` / `mapLngLat` / `mapGroundFrame` / `satelliteGroundRef`）**
- 前置：`amap-venue`、`west-lake-basemap`、`ground-basemap`、`scene-anchor`、`venue-scale-basis`
  全部改读 `plan.ground.polygon / center / frame`。
- 这一段的语义风险最高：西湖清理与贴地判定都靠这些字段，读错会把用户底图误删或按错朝向贴图。
- 验收：经纬夹具下逐函数「改前/改后返回的 patch 或布尔值相等」。

**S3 契约与类型收口**
- `lib/schema.ts` 与 `lib/types.ts` 里删字段定义（35 + 7 处），`lib/plan-ground.ts`
  去掉 layout 兜底分支，`planGroundSync` 从三态收成两态。
- 验收：`typecheck` 全绿 + `build` exit 0 + 存量数据迁移脚本（旧项目 layout → plan 一次）。

## 三、卡点（为什么我现在不往下删）

1. **没有视觉证据**：本机 bu 视口 `w=0/h=0`，`screenshot` 报 `BUA page viewport is unavailable`，
   3D 成图取不到画面。AGENTS.md §六已写明：渲染/导出链路改坏了 `typecheck` 与 `build` 照样通过，
   只有真出图才发现。
2. **S2 会改「通过 / 不通过」之外的语义**：西湖清理是删除动作，判错就是删用户图。
3. **S1 的真验收在 #38 壳体退役那一笔**，两件事同一批触点，拆开做等于同一处改两遍。

## 四、S2 第一刀（已完成：西湖清理搬到正源侧）

`lib/west-lake-basemap.ts` 新增 `purgeWestLakePlanGround(plan)`，`lib/outdoor-project-store.ts`
的 `readOutdoorProjectRecord` 读 plan 记录时下沉执行。原因：只剥 layout 缓存，`planGroundSync`
会在下一次同步时从正源把底图补回来，等于没删。

**判据收窄（实测踩到的坑）**：最初按经纬 / 多边形 / URL 判「在西湖界内就删」，直接把
`outdoor-project-store.test.ts` 既有的 `plan.ground` 往返用例打红——那组坐标 120.1443 / 30.2465
正好落在西湖界内。这说明按坐标判会删掉**用户自己选的**西湖一带底图，是数据丢失。
按 2026-11-11 的口径（「默认进来那套不要」不等于「西湖范围内底图都不许存在」），
判据收窄为**只认旧预设图 `xihu-scenic-z15`**。

验证：`west-lake-basemap.test.ts` 12 / `outdoor-project-store.test.ts` 50 / `plan-ground.test.ts` 24，
3 文件 86 passed；`npm --prefix frontend run typecheck` 通过；两文件 eslint 无输出。

## 五、S1 真机对照（已做一次，结论：户外画面上没有镜像的可见读点）

用户授权后新建了临时草稿 `s1-ground-fixture`（陆家嘴 121.4737/31.2304，30×20 m），
底图用本机 3199 代理真拉的卫星 JPEG（43,980 B，HTTP 200），`plan.ground` 与 layout 镜像
同时写全（`floorPlanImage` / `floorPlanOpacity` / `mapGroundPolygon` / `mapLngLat` / `mapGroundFrame`）。

实测结果（证据 `docs/evidence/2026-11-25-ground-read/`，该目录被 .gitignore 排除）：
- 户外 2D 是 MapLibre 活图层（OSM 街道），**不画**镜像字节；
- 户外 3D 地面是 GeoGround 实时瓦片，同样不画镜像字节；
- 「效果图：按画布现况出 PNG」导出的是一张空白平面（只有范围框 + 锁图标 + 比例尺），
  底图一个像素都没进来。

也就是说：户外路径上，贴地字节字段已经没有任何可见读点；S1 的「改前/改后成图对照」
在户外做不出差异，真读点只剩室内壳体的 3D 地面纹理（`three/room-builder.ts`，
随 #38 退役）和 2D 画布渲染器（只有非户外项目可达，而它拿不到 plan 的 ground）。

顺带记一笔待查项：户外「效果图」导出空白，是否 MapLibre 画布没开 `preserveDrawingBuffer`
导致导出取不到地图层——与本镜像无关，但属于同一条渲染/导出链路，动 #38 前先确认。

## 六、S1 第二刀（2026-11-25，写侧封到「只剩随 #38 退役的那一处」）

用户拍板「现在就退役 S1 字节」。这一刀把生产可达的写侧收掉，并给 3D 壳体加正源入参：

| 位置 | 之前 | 现在 |
| --- | --- | --- |
| `panels/scendance-workspace.tsx` 自动补图 effect（803–821） | 只要 `satelliteOn` 就拉图并 `applySatelliteGroundPatch` 写 `floorPlanImage`/`floorPlanOpacity` | `geoGroundActive`（户外有锚点的 GeoGround 地图地面）直接不进，返回 `undefined`；deps 加 `geoGroundActive` |
| `three/structure-builder.ts` `buildStructureShell` | 贴地图、渐隐、描地判定读 `layout.floorPlanImage / floorPlanOpacity / satelliteGroundRef / mapGroundPolygon / mapGroundFrame` | 新增可选 `options.ground`（`ResolvedGround`）；给了就以它为准（`resolveGround` 结果），没给才回退 layout 旧字段（`scene-delivery` / `proposal-preview` 两个预览路径不传，行为不变） |
| `hooks/use-scene-effects.ts` | 壳体分支不传 ground | 在本 effect 顶部算出 `ground = resolveGround(layout, plan)`，壳体与 `buildRoom` 两路共用同一份 |

**为什么没有一并改 `fillSatellite` / `turnSatellite` / `chooseBasemap`**：那三处的入口在旧「卫星贴地」开关里，
门禁是 `satelliteVenue && !outdoorEditing && !geoGroundActive`（`scendance-workspace.tsx:1173/1196`），
户外项目根本渲染不到；可达的只有「地图选址 venue」这一条室内遗线，随 #38 壳体一起消失。
所以 `amap-venue.ts` 的 `applySatelliteGroundPatch` 仍会产生带字节的 layout patch，
**删它必须和 `lib/types.ts` / `lib/schema.ts` 的字段删除同批（S3）**——先删字段会在这三处直接编译失败，
而先删这三处又会把旧卫星开关变成「点了没反应」。这一点写进 §六 是给下一个动 S3 的人看的边界。

## 七、下一步（可立即接）

- 按 S2 的五个文件逐个出「读点 → 改读 plan 后的等价性」清单，每个文件配一组纯函数级夹具；
  这与 ①②③④ 的做法同源，不需要浏览器。
- 室内 `room-builder` 随 #38 删；`structure-builder` 已接 `options.ground`，#38 动工前先跑一次
  `npm --prefix frontend run build` + 壳体 15 套件作为基线。
