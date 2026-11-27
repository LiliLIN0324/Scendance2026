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

## 八、S2 / S3 目标与验收口径（2026-11-25 用户拍板「都定目标完成」）

### S2（`mapGround*` 定位字段退役）

**目标**：layout 不再是定位的存放处，`mapGroundPolygon` / `mapGroundFrame` / `mapLngLat`
（以及他们的布尔开关 `satelliteGroundRef`）全部以 `plan.ground` 为唯一正源。

**验收（三条同时成立才算 S2 完成）**：
1. 静态：写侧 0 处——`grep` 上述标识符在**赋值**位置（`xxx.mapGroundPolygon =`、对象字面量里出现、`applyLayout({...mapGround...})`）应为 0；
   允许剩下的只有「读 layout 兜底」形态。
2. 读侧：所有读点要么走 `resolveGround(layout, plan)`，要么函数显式收 `ground` 入参；兜底分支保留，
   但每条兜底在代码里标明「旧 JSON 兼容，迁移后删」。
3. 数据：一次性迁移把旧 layout 的定位四件套写进 `plan.ground`（幂等、只在 plan 缺字段时写、可重跑），
   跑过之后兜底分支可整段删除。

### S3（贴地字节字段退役）

**目标**：`lib/types.ts` / `lib/schema.ts` 里不再有 `floorPlanImage` / `floorPlanOpacity`；
那个存着 4 万字节 data URL 的字段从 RoomLayout 上消失，底图只活在 `plan.ground.image`。

**验收**：
1. `grep -r floorPlanImage | floorPlanOpacity` 在 `frontend/` 与 `supabase/` 的非测试源码里为 **0**；
   唯一例外是迁移脚本，且只在 `LegacyRoomLayout` 类型下读旧 JSON。
2. `plan-ground.ts` 的 `layoutGroundPatch()` 只剩定位投影，且**不再有**任何字节字段；
   `lib/amap-venue.ts` 的 `applySatelliteGroundPatch` 不再产出字节。
3. 旧数据：迁移脚本把 `floorPlanImage` → `plan.ground.image`（`floorPlanOpacity` → `opacity`），
   与 S2 迁移同一支脚本、同一遍扫描完成。
4. 3D/2D 成图对照：迁移前（有字节）与迁移后（只剩 plan）在**非户外 + 有卫星/纸面底图**的草稿上各导一张，
   像素差 0（因为读点早已改读 `resolveGround`；这条是对「改读改对了」的反证）。

### 分批（静态计数来自 2026-11-25 实测，非测试文件）

| 批 | 文件（命中数） | 状态 |
| --- | --- | --- |
| 1 | `lib/scene-anchor.ts`（5）、`lib/outdoor-venue-sync.ts`（6）、`room-organizer.tsx` 反向播种、`use-scene-effects` 蓝色边界环 | **本轮已落**（函数加可选 `ground` 入参，没给就回退 layout，行为等价） |
| 2 | `lib/venue-scale-basis.ts`（2）+ `lib/venue-fact-epoch.ts` + `agent-panel.tsx:1642` | **本轮落了一半**：`venueScaleBasis(layout, ground?)` 已加可选正源入参，并有用例钉住「换源后字符串逐字相同」（`venue-scale-basis.test.ts`）；三个调用点仍走 layout 单参，留到批 5 连删字段一起翻。用户选 C：先靠迁移消除失配风险，再换源 |
| 3 | `lib/amap-venue.ts`（73）+ `panels/scendance-workspace.tsx`（28） | 与 #38 同批：旧卫星开关整簇随壳体退役 |
| 4 | `canvas-2d/render.ts`（24，已有 `ground?`，剩兜底）、`three/room-builder.ts`（20）、`use-review-capture.ts`（6）、`layout-reducer.ts`（6）、`west-lake-basemap.ts`（19） | **2D 渲染读点已接（`f20c9e31` 之后）**：`render.ts` 本来就收 `ResolvedGround`，真正缺的是「谁把正源递进来」——本轮补上 `use-canvas-2d-interaction`（入参 + 重绘选项）、`plan-thumb`（新增可选 `ground`）、`minimap`（透传）、`viewport`（`ViewportProps.ground`），并在 `room-organizer.tsx` 用一份 `useMemo(() => resolveGround(layout, plan))` 同时喂给 2D 交互重绘与 `<Viewport>`。`use-review-capture` / `use-scene-effects` 早已递 ground。**`three/room-builder.ts` 不接 ground**：它是随 #38 退役的旧室内壳体，接了也没有可达路径；`layout-reducer.ts` 的 6 处是「删字节」的写侧动作，属 S3；`west-lake-basemap.ts` 的 19 处是旧 JSON 清理与 `satelliteGroundRef=false` 落写，随 S3 改吃 plan.ground |
| 5 | `lib/types.ts`（7）、`lib/schema.ts`（22）、`plan-ground.ts`（27）、`version-history.ts`（4） | **S3 收口**：删字段 + 迁移脚本 + 旧版本历史兼容 |

**用户口径（2026-11-25，选 C）**：先靠迁移把值搬进 `plan.ground`，再换基线来源，用迁移消掉「换源导致旧记忆失配 → 误报重新确认场地尺寸」的风险。迁移这一半代码里已经存在：`planGroundSync` 判 `to-plan` 就交给画布 `applyGround` 写正源（`plan-ground.test.ts` 有用例），这里只是把「换源等价」这条也钉住，等批 5 一起翻调用点。

**两条硬边界（动 S3 前必须先处理）**：
- `three/scan-placement.ts`（3 处命中）是 AGENTS.md §六 的**禁改几何基线**：里面调用 `sceneAnchorOf(layout)`。
  删字段必须同时给它换形参或改成显式 `ground`，属「动基线」，要先在 `HANDOFF.md` 登记并说明不改数学、只换取值来源。
- 云端存量方案：`sitePlanDataSchema` 的 `ground` 是可选的，迁移脚本要能处理「plan 里没有 ground、layout 里有字节」的老方案；
  任何一步都不能让老方案在迁移中途变空白地（底线：防丢存量）。

## 九、迁移实测（2026-11-25，`plan-ground-migrate.test.ts`）

用户要求「你来实测」，即由我跑一遍真迁移而不是只给方案。浏览器里写 localStorage 造夹具这条路已经否决：
本机 19 个标签、前台是 Supabase SQL 编辑器，`bu.js()` / `page_info()` 取的是「当时附着的标签」，
同一 cell 内会漂移（上一轮已因此把夹具键误写进 supabase 域，事后按 `location.origin` 守卫清掉）。
所以改成**跑真函数、真落盘、真读回**，环境用 `memoryStorage()`（与 `outdoor-project-store.test.ts` 同一套 `KeyValueStorage`）。

`frontend/components/room-organizer/lib/plan-ground-migrate.test.ts` 四条：

1. **旧方案打开一次就长出正源**：layout 有 40 字节级 data URL + 四角多边形 + frame + center，plan 无 `ground`
   → `planGroundSync` 判 `to-plan` → ground 的 `image` / `polygon` / `center` / `frame` 与 layout 逐项相同
   → 按画布 `applyGround` 的动作挂上 plan → `saveOutdoorProjectRecord`（真 `sitePlanDataSchema`）落盘
   → `readOutdoorProjectRecord` 读回，`ground.image` 仍在。
2. **第二次打开不再写**（`already-current`），且 layout 缓存原样留着（`floorPlanImage` / `mapGroundPolygon` 都在盘上）——
   S2 迁移只动 plan，不动 layout；删缓存要等 S3。
3. **正源已有别的图不被 layout 覆盖**（防丢存量）：`plan.ground.image` 仍是那张新图。
4. **layout 只有定位没有字节**时，迁过去的 ground 也只有定位，不造空图。

另跑了一次**真机备份**（`docs/evidence/2026-11-25-ground-read/storage-backup-house-y4ry0n56.json` 原值，
一次性 temp 测试、跑完即删）：`house-y4ry0n56` 的 layout 既无字节也无 `mapGround*`
→ `planGroundFromLayout` 返回 null → `planGroundSync` 判 `no-ground-anywhere`。
即真机上「没底图的方案」迁移不会凭空造 ground，符合「只补不缺」。

**验证口径（亲测原始输出）**：`npx tsc --noEmit` 0；`eslint plan-ground-migrate.test.ts` 0（无 warning）；
定向 5 例 + 4 套件 93 passed；全量前端 `845 passed | 6 skipped`（10801 passed / 152 skipped / 0 failed）。
另：全量首跑有 1 例 App 渲染红（`render(<App />)` 附近），同命令复跑两遍全绿，判环境抖动、非本改动引入。

**这条实测覆盖不到的**：`adoptPlan → onPlanChange → 保存` 那段 React 接线只在代码上核对
（`outdoor-plan-canvas.tsx:5102 applyGround` → `2876 adoptPlan` → `2879 onPlanChange`），没有走真浏览器；
以及「老方案自动迁移后刷新页面，2D/3D 底图是否还画得出来」这一条成图对照，仍要等 S3 收口时在真机补。

## 十、S2 写侧赋值位清单（2026-11-25 实测，验收第 1 条的自证）

§八 验收第 1 条写的是「写侧 0 处」。按代码逐条数下来，S2 阶段**做不到字面 0**，只剩三类，各有去处：

| 位置 | 形态 | 判定 |
| --- | --- | --- |
| `lib/plan-ground.ts:70-76` `layoutGroundPatch` | 把 ground 投影回 layout（`satelliteGroundRef` / `mapGroundPolygon` / `mapLngLat` / `mapGroundFrame` 四处） | **设计保留**：这是 `to-layout` 方向唯一的写点，也是 3D 卫星 UV 与室内进场的视图缓存来源；S1 起它已不投影字节。S3 删字段时一并删除，删前 3D 必须全部改读 `resolveGround` |
| `lib/amap-venue.ts`（474/727/766-769/779-780/818-823/849-852/859/901/905/923/926） | 地图选址 / 旧卫星开关写 `mapGround*` 与 `satelliteGroundRef` | **随 #38 同批（批 3）**：入口门禁是「地图选址 venue + 非户外编辑 + 非 GeoGround」，户外渲染不到 |
| `panels/scendance-workspace.tsx`（835/839/861/870） | `applyLayout({ satelliteGroundRef: true, ... })` | **随 #38 同批（批 3）**：同一簇旧卫星开关 |
| `lib/west-lake-basemap.ts:129` | `next.satelliteGroundRef = false` | **S3 批 5**：旧 JSON 清理器改吃 `plan.ground` 时一并改 |

读侧（不是写）另有 `structure-builder.ts:188/233`（Three 材质 `userData` 标记）、`use-scene-effects.ts:441`（传给壳体的开关，不是 layout）、`event-operations.ts:86` / `scene-handoff.ts:28` / `venue-scale-basis.ts:30-31` / `agent-panel.tsx:1643-1644`（全是读兜底）。

结论：**S2 可做的部分已做完**——读侧 2D 两处补上正源、其余读点早已递 ground 或走 `resolveGround`；
剩下三类写点分别等 #38（批 3）与 S3（批 5），不是遗漏。

验证（本轮亲测原始输出）：`npx tsc --noEmit` 0；`eslint` 六个改动文件 0 error（存量 warning 不动）；
新增 `panels/plan-thumb.react.test.tsx` 3 例（给 ground 时递到渲染器 / 不给时选项无该键 / 小地图原样透传）；
全量前端 `845 passed | 6 skipped`（1 例 `app/page.test.tsx` 15s 超时红，单跑 9 passed | 1 skipped 绿，判并发抖动）；
`npm --prefix frontend run build` 静态导出成功、oneplan 产物违规 0。

未覆盖：`use-canvas-2d-interaction` 这条没有单测（它要 `useLayoutActions` store 上下文，起一个 hook 测试成本高于收益），
只经 tsc + 代码核对；`three/room-builder.ts` 刻意没接 ground。
## 十一、#38 整簇退役前置图谱（2026-11-25 静态核对）

批 3 与 #38 必须同时动，理由是把「旧卫星开关」这一簇当整体看：它写的是 layout 字节与定位，
读的是同两个字段，UI 只挂在同一对门禁上。拆开动会返工两次。

**簇内成员（非测试源码，行号取 2026-11-25 现状）**

| 成员 | 位置 | 门禁 |
| --- | --- | --- |
| `satelliteVenue` | `scendance-workspace.tsx:595` | `isMapOutdoorLayout(layout) \|\| layout.satelliteGroundRef !== undefined \|\| isSatelliteGroundImage(layout.floorPlanImage)` |
| `satelliteOn` | `scendance-workspace.tsx:596` | `satelliteGroundWanted(layout)` |
| 自动补图 effect | `scendance-workspace.tsx:805-824` | `geoGroundActive` 早退（S1 已加）→ `satelliteOn` → 缓存里没有对齐的卫星图 |
| `turnSatellite` / `chooseBasemap` | `:825` / `:842` | 两者都只在下面两个 UI 上可达 |
| 地图类型菜单 | `:1176-1197` | `satelliteVenue && !outdoorEditing && !geoGroundActive` |
| 卫星贴地开关 | `:1199-1201` | 同上 |
| `amap-venue.ts` 写侧族 | `applySatelliteGroundPatch` / `ensureSatelliteGround` / `ensurePlanGround` / `hideSatelliteGround`（474/727/766-770/779-780/818-823/849-852/859/901/905/923/926） | 只被上面三处调用 |

**户外为什么够不到**：户外是 `geoGroundActive`（MapLibre + GeoGround 瓦片），两个按钮都被第三重门禁挡住，
自动补图在第一重就早退。所以这一簇现在只服务「地图选址的 venue 项目」——即曾经的室内遗线。

**退役后谁会用不到**：这类项目的 `plan.ground` 由迁移补齐（S2 已实测），3D 壳体与 2D 都改读 `resolveGround`，
所以**已经有过卫星底图的老方案不会变空白**；变的是「新画一块地图选址场地时不再自动拉卫星图」。

**三处要人拍板，我不代决**：

1. 「地图选址 venue」项目还要不要卫星贴地这个能力？取消 = 整簇连 `amap-venue` 三个函数一起删；保留 = 收进户外侧新实现，不能留在旧壳里。
2. 老方案的那些 `ground.image` 是留（只读展示）还是随清理一并清掉？留的话 `west-lake` 那种坐标清理器要改吃 plan。
3. 自动补图取消后，新场地拿底图靠哪条路径？（户外 GeoGround 已自带；纸面档要不要保留一次手动截取？）

**已拍板的部分**：`applySatelliteGroundPatch` 不再产字节必须与 `types.ts` / `schema.ts` 字段删除同批（S3），不能提前拆——
这条已在 HANDOFF 2026-11-25「B4/S1 停写续」里记过，本轮复核仍然成立。
## 十二、真机可达性复核（2026-11-25，本机草稿经用户批准改造后实测）

**门禁实况**：两处 UI 门禁都写死 `satelliteVenue && !outdoorEditing && !geoGroundActive`
（`scendance-workspace.tsx:1190` 地图类型菜单、`:1213` 卫星贴地），而 `outdoorEditing = outdoor != null`（`:575`）
——只要户外画布挂上，这一簇就连同撤销/重做一起被隐藏。

**本机三次构造尝试（全部走 3002 真机）**：

1. 把 layout 改成选址形状：name「西湖文化广场 · 规划区 30×20m」、`mapGroundPolygon` 4 点、`mapLngLat`、
   `satelliteGroundRef:false`、删掉 `floorPlanImage/floorPlanOpacity/mapGroundFrame`、删 `sceneAnchor` → 打开后仍被改回 `mode=outdoor`。
2. 把 layout `id` 改成 `venue-probe-1125` 并删该项目的户外计划槽（`scendance-outdoor-plan-v1:venue-probe-1125`）→
   路由依旧落到 `?project=house-y4ry0n56&mode=outdoor`。
3. 清 `scendance-outdoor-last-v1` / `scendance-outdoor-plan-activity-adopted-v1`，并新开标签走
   `?project=venue-probe-1125&mode=indoor` → URL 保住 indoor，但 `document.getElementById('tool-satellite')`
   与 `tool-map-type` 三次读 DOM 均为 `null`；展开「工具」工具条后仍无。

**结构性结论**：venue 项目只有一条生产路径——`venue-picker.tsx` 与 `space-panel.tsx` 一律
`window.location.assign('/editor/?project=<id>&mode=outdoor')`，因此必然挂户外画布、`outdoorEditing=true`；
唯一可能放行的是「室内项目 + layout 带卫星字段」这一组合，而现行 UI 已无生产该组合的入口。
也就是说 `fillSatellite` / `turnSatellite` / `chooseBasemap` 现在是**不可达代码**，删掉不改任何用户可见行为。
这把 #38 的「有没有行为回归风险」问题关掉了，但**「venue 卫星贴地能力是否保留」仍是要人拍板的那一问**（见 §十一 第 1 条）。

**存储复原**：实验期间改过的 `scendance-editor-local-v1` / `scendance-outdoor-last-v1` /
`scendance-outdoor-plan-activity-adopted-v1` 已按 `docs/evidence/2026-11-25-ground-read/storage-backup-house-y4ry0n56.json`
的原值写回（读回自证：`id=house-y4ry0n56`、`name=周末共创工作坊`、`poly=0`、有 `sceneAnchor`、`satelliteGroundRef=false`）；
实验里自建的 `scendance-outdoor-plan-v1:venue-probe-1125` 槽属本轮临时产物，未回写。

**证据帧**：`docs/evidence/2026-11-25-ground-read/s3c-venue-indoor.png`（829×870）：室内视图打开
「西湖文化广场 · 规划区 30×20m」、左侧显示「搜索地点 / 在地图上手画活动范围」、右下 2D/3D 与「工具」，
而 `tool-satellite` 不在 DOM——即上文结论的现场帧。

## 十三、S3 收口第一刀真机实测（2026-11-25，`house-y4ry0n56` 夹具改造后复原）

**这一刀做了什么**：`planGroundSync` 只剩 `to-plan` / `none`，删掉 `to-layout` 反向投影；迁完当刻调 `stripLayoutGroundBytes`，把 layout 的 `floorPlanImage` / `floorPlanOpacity` / `satelliteGroundRef` 擦掉（`mapGroundPolygon` / `mapLngLat` / `mapGroundFrame` 三项定位仍留在 layout，因为禁改基线 `three/scan-placement.ts` 还在读）。落正源优先走画布 `applyGround`；画布还没挂载（首开即迁移）就直接 `writeGroundToPlan` + 同步 `outdoorPlanState`，两条路径任一落成才擦镜像。

**真机步骤（3002，单标签，先关掉重复标签防止双窗互相覆盖）**：

1. 在 `introduction.html`（同源静态页、不落盘）写夹具到 `scendance-editor-local-v1`：512×384 绿底斜纹 PNG 的 data URL（23,938 字符）、`floorPlanOpacity:0.94`、`satelliteGroundRef:true`、4 点 `mapGroundPolygon`、`mapLngLat`、合法 `mapGroundFrame{lng0:120.14972, lat0:30.27496, latMid:30.27456, scale:1, latSign:-1}`；同时清空三个 plan 记录的 `ground`。
2. 打开 `http://localhost:3002/editor`，等 9s 读回。

**读回结果（迁移成功）**：

- `layout`：`floorPlanImage` 0、`floorPlanOpacity` null、`satelliteGroundRef` null —— 三项镜像已擦；`mapGroundPolygon` 仍是 4 点、`mapGroundFrame` 原样保留 —— 定位留给基线。
- `plan.ground`（`scendance-outdoor-plan-v1:house-y4ry0n56`）：`image` 23,938、`polygon` 4 点、`satelliteRef:true` —— 图只存在正源这一份。
- `layout.id` 仍是 `house-y4ry0n56`，没被重建。

**踩到的两个坑（记下来，别重复）**：

- **夹具字段形状写错 = 整份 layout 被判损坏**：第一版 `mapGroundFrame` 写成 `{west,south,east,north}`，`isMapGroundFrame` 拒收 → 编辑器把草稿存进 `scendance-editor-local-v1-recovery-*` 并新建一份随机 id 的空 layout。真机上「id 每次打开都变」先查 `parseStoredLayout` 是不是把写进去的东西判坏了。
- **编辑器标签未卸载时写 localStorage 会被覆盖**：在 editor 页面里 `bu.js` 写夹具再 `navigate` 重载，旧页面卸载时把内存态写回，夹具当场没了。正确做法是先去同源静态页（`introduction.html`）写，再进编辑器。

**复原自证**：`layout` 回到 `id=house-y4ry0n56`、`floorPlanImage` 无、`satelliteGroundRef=false`、`mapGroundPolygon` 无；`plan.ground` 回到备份态（`img0 … poly4`）；实验里新建的三个 plan 槽（`house-h01slbx3` / `house-xkx33scp` / `house-wmv5mouy`）、`scendance-editor-local-v1-recovery-*` 与 `__s3bak_*` 备份键全部删除，读回 `keys: []`。

**证据帧**：`docs/evidence/2026-11-25-ground-read/s3d-migrate-real-2d.png`（迁移后现场）、`s3d-restored-2d.png`（复原后现场）。

**这一刀没证明的**：擦镜像后 2D/3D 是否还画得出那张图。夹具塞在户外 `geoGroundActive` 档，现场 2D 显示的是 MapLibre 地图地面（图被地图层盖住，属预期），这一帧不能用来断言成图；仍按 §九 的记号留待「一次性显式取图」或非地图档再验。