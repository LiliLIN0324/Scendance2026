# 户外规划 3D · 第一人称漫游一期（裸步行）设计与验收记录（2026-11-13）

> 范围：户外 3D 组件只做**裸第一人称步行**；纯视图层接入，不挡旧 M3 退役链。
> 本文是独立一条线，不修改 `outdoor-map-decommission-2026-11-13.md` 的既有退役结论。

## 1. 一期拍板口径（严格执行）

- 户外 3D 视图下解除右轨漫游钮禁用；**2D 视图与室内态行为保持不变**。
- 进漫游：停用 OrbitControls，挂 three `PointerLockControls`，鼠标移动控制 yaw/pitch。
- WASD / 方向键步行，Shift 加速；米制速度（步行 1.8 m/s，冲刺 ×2）；眼高固定 1.6 m，Y 不随地形浮动。
- 边界钳制：用 `plan.boundary` 多边形做点内判断；环不足 3 点（未画起步）不做越界判定。
- 退出：Esc 先退指针锁，第二次 Esc（或再点漫游钮）退出，回环绕视角并恢复 OrbitControls；退出后恢复左键编辑 / 中键环绕的手势划分。

### 明确不做（deferred，代码里不预埋类型耦合）

- **二期**：设施占地 / 墙线段碰撞（等 M2 实体落地）。
- **三期可选**：座位、findSeat、坐姿、第三人称 avatar / 肩视角。

## 2. 状态放置与自管方式

旧室内链路的启用态是 `view.walkthroughMode`（`lib/types.ts`），派生 `walkthroughActive = isActive && view.walkthroughMode && !view.view2D`，多处挂载条件依赖它。一期**不翻这个位**，避免 `OutdoorPlan3D` 在漫游中被卸载。

新增一条独立信号，挂在 `room-organizer.tsx` 工作台层：

- `const [outdoorWalkActive, setOutdoorWalkActive] = useState(false)`。
- `toggleOutdoorWalk(on)`：进时在按钮手势内同步 `requestOutdoorWalkPointerLock()`，再置位；出时置回 false。
- 组件内自管：`OutdoorPlan3D` 通过 props 接收 `walkEnabled` / `onWalkExit`，控制器（hook）在组件内部挂载与清理，不回写 `view.walkthroughMode`。
- 收口复位：离开户外 3D 接管（切 2D / 实景隔离 / 收起）时，effect 依据 `outdoor3dTakeoverActive / outdoor2DOpen / scanIsolated` 把 `outdoorWalkActive` 复位；hook 随 `walkEnabled=false` 清理指针锁与监听。

右轨按钮态（`scendance-workspace.tsx`）：

- `outdoorActions` 扩展 `walkActive` / `walkIn3D` / `toggleWalk`。
- `walkIn3D = outdoor3dTakeoverActive && !outdoor2DOpen && !walkthroughActive`：只有户外 3D 接管视图可进；2D 仍禁用并保留原提示。
- 按下态读独立信号 `walkActive`，不读室内 `view.walkthroughMode`。

## 3. 控制器接线与生命周期

新 hook：`hooks/use-outdoor-walk.ts`。

- 输入：`enabled`、`canvasRef`、`cameraRef`、`orbitRef`、`boundary`、`eyeHeight=1.6`、`walkSpeed=1.8`、`onExit`。
- 启用即停 OrbitControls（`orbit.enabled = false`），动态 import `PointerLockControls` 挂到户外画布；`adoptWalkPointerLock` 接住按钮手势里早到的锁。
- 进场落点：当前 x/z 在边界内就站原地；在环外（环绕镜头拉到场外）落到边界质心；眼高固定，朝向保持当前 yaw/pitch。
- RAF 步行循环：水平前向 / 右向量解算位移，逐轴过 `constrainWorldToBoundary` 钳制；`player.y = eyeHeight` 每帧钉死。
- 指针锁兜底：浏览器拒锁 / 掉锁后进入 `drag` / `unlocked` 相位，左键拖拽看视角，WASD 照常走；曾成功过的锁点按可重新抢锁（与室内同一套兜底手感参数）。
- 退出路径：`keydown Escape`——锁未释放时浏览器预留；锁已释放后第二次 Esc 调 `onExit`。
- 清理：cancel RAF → 摘监听 → `controls.unlock() / disconnect()` → 恢复进漫游前相机机位 → `orbit.enabled = true`。

户外画布挂独立 id：`OUTDOOR_WALK_CANVAS_ID = 'sc-outdoor-viewport-3d'`（`walk-engage.ts`），与室内 `sc-viewport-3d` 分开。

编辑手势隔离：漫游态下 `OutdoorPlan3D` 的 `pointerdown/move/up` 编辑桥入口提前 return，左键让给指针锁视角；中键环绕随 OrbitControls 停用一并失效。

## 4. 边界坐标映射（动手前对照现有代码核对）

- 规划 ENU：`x` 东向米、`y` 北向米（`PlanPoint`）。
- three 世界：`x` 东、`y` 上、`z = -北`。
- 反查口径与 `eventToPlanHit`（`outdoor-plan-3d.tsx`）一致：`pt = { x: groundHit.x, y: -groundHit.z }`。
- 纯函数（`lib/outdoor-walk-boundary.ts`，不依赖 WebGL）：
  - `worldToEnu(wx, wz)` → `{ x: wx, y: -wz }`；`enuToWorld(ex, ny)` → `{ x: ex, z: -ny }`。
  - `pointInBoundaryRing(point, ring)`：射线法；边上 / 顶点按在内处理；环 <3 点返回 true（不判定）。
  - `boundaryCentroid(ring)`：进场质心落点；空环返回 null。
  - `constrainWorldToBoundary(from, to, ring)`：x 轴候选在外回退 x，再试 y 轴候选，贴着边界边滑动；环 <3 点原样放行。

## 5. 复用了室内哪些件

- `lib/walk-engage.ts`：`adoptWalkPointerLock` / `walkPointerLocked` 原样复用；新增户外画布 id 与 `requestOutdoorWalkPointerLock`（同手势规则：必须在点击回调内发起）。
- `hooks/use-walkthrough.ts`：骨架参考——指针锁相位同步、WASD 键集、RAF 循环、Esc 两步退出、拒锁拖拽兜底。**砍掉** colliders / seats / avatar / 第三人称 / 坐姿。
- `lib/walk-collision.ts`：一期**不接**；`buildWalkColliders` 入参绑 `FurnitureItem[] / InteriorWall[]`，户外不套这套室内类型。
- three `PointerLockControls` 依赖现成（室内已在用），无新增三方依赖。

## 6. 与旧 walkthroughMode 链路的耦合点

- 挂载条件 `room-organizer.tsx:4774`：`outdoorPlan && (outdoor3dTakeover || outdoor3dWarm) && !walkthroughActive && !scanIsolated`。户外漫游不置 `walkthroughActive`，组件保持挂载；独立信号 `outdoorWalkActive` 不参与该条件。
- `toggleWalkthrough(on)` 分流：户外 3D 接管（`outdoor3dTakeover && outdoorPlan && !scanIsolated`）走 `toggleOutdoorWalk`；其余仍走旧 `startWalk / exitWalkthrough`。
- 室内 `useWalkthrough`、角色 / 坐姿 / avatar 链路一行未动。
- 遗留观察（留给后续清理，本期不拆）：`walkthroughActive` 仍驱动若干 CSS 壳体（`.is-walkthrough` 隐藏左栏 / 工具轨等）；户外漫游故意不挂这个 class，右轨退出钮保持可见。
- 声明顺序约束：`outdoorActions` memo 位于 `outdoorPlan`（~1779）、`scanIsolated`（~2492）之前，`walkIn3D` 只能引用前置状态（`outdoor3dTakeoverActive / outdoor2DOpen / walkthroughActive`）；实景隔离与无 plan 的兜底由下游 `outdoor3dTakeover` 条件把关，memo 内不反向引用后置变量（避免 TDZ）。

## 7. 测试与类型

- 边界纯函数单测：`lib/outdoor-walk-boundary.test.ts`（**13 例**：内 / 外 / 边 / 顶点 / 空环 / 两点环 / 偏移场地 / 三角形 / 映射往返 / 质心 / 步进钳制 / 越轴回退 / 对角回退 / 空环放行）。
- 指针锁可 mock：`hooks/use-outdoor-walk.react.test.ts`（**3 例**：拒锁落 drag、第二次 Esc 调 onExit、禁用态保持 pending 不动相机）；`walk-engage.test.ts` 补户外画布请求例（合计 **6 例**）。
- 定向回归（Node24 / vitest v4，均绿）：walk-collision 37、walk-seat 8、outdoor-plan-canvas 31、overlay merge 2、scene/crowd/splat placement 各 6–8、workspace 27、室内 hook 6+3、tokens 10、guide 14、routes 12、footprint-lock 18、catalog 5、models 25、three/outdoor 9、basemap-tiles 5、footprint-builder 6、utility-shortcut-boundary 35。既有基线债（agent-panel 39 failed）未触碰、未扩红。
- 类型：`tsc --noEmit` exit 0。

## 8. 真机验收记录（dev 3210 `/editor?r=1`）

走查环境：自动化浏览器（PointerLock API 被拒，走拖拽兜底相位；真实浏览器锁路径与室内同一套 `PointerLockControls`）。截图存 `docs/plans/outdoor-walk-shots/`（未跟踪，不入库）。

| 项 | 结果 | 证据 |
|---|---|---|
| 2D 平面漫游钮保持禁用 | `#tool-walk` `disabled=true`，aria-label 仍为「户外地图为环绕视角，暂不支持第一人称漫游」 | DOM 读取 |
| 切到户外 3D 接管后钮解除禁用 | 按钮文案「第一人称漫游」，无 disabled、无禁用提示 | DOM 读取 |
| 点钮进漫游 | HUD「WASD / 方向键行走 · Shift 加速 · Esc 退出漫游」出现；钮变「退出漫游」并高亮；`OutdoorPlan3D` 保持挂载（指北针 / 比例尺 / 高德底图仍在） | `02-walk-active.png` |
| 漫游中组件不被旧链路卸载 | 进漫游后 `[data-testid=outdoor-plan-3d]` 仍可读；未翻 `view.walkthroughMode` | DOM 读取 |
| 再点钮退出漫游 | HUD 消失；钮回「第一人称漫游」；环绕机位恢复（ elevated 轨道视角可见货车 / 桌椅 / 蓝色边界框 / 底图）；3D 仍挂载 | `03-after-exit-orbit.png` |
| 退出后环绕 / 编辑手势 | OrbitControls 恢复 `enabled=true`，相机机位回存入视点；左键编辑桥在漫游态已被提前挡下，退出后恢复 | 代码清理路径 + 截图 |
| console | 漫游链路 **无 JS 异常 / 报错栈**；观测到的 `ERR_CONNECTION_REFUSED` 均为 `/api/*` 代理 / 地图瓦片等环境网络资源失败（与步行代码无关，walk 路径不发请求）；`THREE.PointerLockControls: Unable to use Pointer Lock API` 是自动化浏览器拒锁，由拖拽兜底接住，真实浏览器走指针锁 | console / network 读取 |

**未在页面直读相机位移**：本会话调试桥 `window.__scendancePlan3dDebug` 未挂（既有非生产门控，本期未改动该块），无法在真机上数值核对 WASD 落点；步行步进与边界钳制由 `outdoor-walk-boundary.test.ts` 13 例纯函数覆盖，hook 拖拽相位 / 退出由 `use-outdoor-walk.react.test.ts` 覆盖。真机按键过程未触发任何 error。

**截图清单**
- `docs/plans/outdoor-walk-shots/02-walk-active.png`：漫游态，HUD + 高亮漫游钮，3D 场景在位。
- `docs/plans/outdoor-walk-shots/03-after-exit-orbit.png`：退出后环绕视角，钮回 inactive，边界框 / 设施 / 底图正常。

## 9. 未处理耦合点 / 妥协记录

- tsc：`frontend` 目录 `tsc --noEmit` 最终 **exit 0**（期间另一线程正在改 `supabase/functions/_shared/api.ts` 的 provider/model 槽位，一度出现两条该文件内的类型报错，复核时已清零；本期前端文件无 TS 报错）。
- 地形跟随：一期眼高固定 1.6 m，不平缓坡 / 台阶；地形 Y 浮动留待后续。
- 边界钳制是逐轴回退的滑动近似，不是最近边投影；贴角处可能小幅贴边，设施碰撞二期再解。
- 真机调试桥 `__scendancePlan3dDebug` 本会话未挂（既有非生产门控，本期未改），未能在页面直读相机坐标做位移 / 落点数值核对；该回退仅影响真机观测，不影响控制器逻辑。
