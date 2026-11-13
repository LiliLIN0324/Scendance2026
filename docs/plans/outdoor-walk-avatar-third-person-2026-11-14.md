# 户外人物漫游 · 三期落点设计（avatar / 视角 / 坐姿）（2026-11-14）

> 基底：main 已含一期「裸第一人称步行」（`21a05ef8`）与视觉收口（`ff800d28`）。
> 本文是一期设计稿 `outdoor-first-person-walk-2026-11-13.md` 的后续切片，不改动其验收结论。
> 目标：在一期户外步行控制器之上**独立层叠**人物 avatar、首/三/肩视角、坐姿；一行不碰室内旧 walkthrough / avatar / 座椅分配链路。
> 路径口径：除明确写 `frontend/lib/...` 外，下文 `hooks/`、`components/`、`lib/`、`three/`、`panels/` 均相对 `frontend/components/room-organizer/`。

## 1. 三期范围

- **avatar 角色模型**：第三人称 / 肩视角下显示自身角色；第一人称隐藏。
- **视角切换**：第一人称 ↔ 第三人称 ↔ 近肩视角，漫游内循环切换，不退出漫游。
- **坐姿**：就近可坐设施 → 坐下（锁位 + 座高相机）→ 起立；移动中自动起立。
- **地形 Y 跟随**：可延后（见 §4.5）。

### 明确不做（沿用一期 deferred，不预埋类型耦合）

- 设施占地 / 墙线段碰撞：等二期 M2 实体落地；三期坐姿只做落点与相机高度，不做落座碰撞推挤。
- 不接入室内 `FurnitureItem[]` / `InteriorWall[]` 碰撞类型；不套室内座椅分配（`seating-allocation` / `table-seat-plan` / `ring-seating`）。
- 不翻旧室内 `view.walkthroughMode`；不挂 `.is-walkthrough` CSS 壳体。

## 2. 一期已就位的衔接点（动手前核对，均在 main）

### 2.1 控制器 `hooks/use-outdoor-walk.ts`

- 入参：`enabled / canvasRef / cameraRef / orbitRef / boundary / eyeHeight=1.6 / walkSpeed=1.8 / onExit`；返回 `{ phase }`。
- 内部闭包持有 `player: THREE.Vector3`（每帧步进、`constrainWorldToBoundary` 钳制、`player.y = eyeHeight` 钉死）；yaw/pitch 由 `PointerLockControls` / 拖拽兜底写在相机四元数上。
- 相位：`pending | locked | drag | unlocked`；Esc 两步退出；拒锁走拖拽兜底。
- **三期缺口**：`player` 位置 / yaw / moving 目前不透出闭包，avatar 每帧需要这些值。

### 2.2 3D 组件 `components/outdoor-plan-3d.tsx`

- 引用：`sceneRef / cameraRef / controlsRef / rendererRef`；`useOutdoorWalk({...})` 在组件顶部挂载（`:311`）。
- 渲染循环 `loop()`（`:1245`）每帧 `controls?.update()` → 手柄 → `renderer.render(scene, camera)`。
- 模型加载先例：`ensureGlbAsset(url, url)` → `createCachedGlbModel(item, false)`，`modelRunRef` 做晚到模型/卸载守卫；人群层 `crowdLayer` 已有「几何人位柱 `CylinderGeometry(0.26,0.3,1.7)` / GLB 人 0.6×0.6×1.75」两条退化路径。
- 编辑桥手势：`walkEnabledRef.current` 为真时 `pointerdown/move/up` 提前 return，左键让给指针锁；三期沿用。
- 画布 id：`OUTDOOR_WALK_CANVAS_ID = 'sc-outdoor-viewport-3d'`（`lib/walk-engage.ts`）。

### 2.3 壳体层状态（`room-organizer.tsx` / `panels/scendance-workspace.tsx`）

- 独立信号 `outdoorWalkActive`；`toggleOutdoorWalk(on)` 在按钮手势内先行 `requestOutdoorWalkPointerLock()`。
- `outdoorActions`：`walkActive / walkIn3D / toggleWalk`；`walkIn3D = outdoor3dTakeoverActive && !outdoor2DOpen && !walkthroughActive`。
- `toggleWalkthrough` 分流：户外 3D 接管走 `toggleOutdoorWalk`，其余走旧 `startWalk / exitWalkthrough`。

### 2.4 室内可对照件（只读参考，不 import 行为）

- `WalkViewMode = 'first' | 'third' | 'shoulder'`（`hooks/use-walkthrough.ts:16`）。
- 第三人称相机偏移（`use-walkthrough.ts:583-587`）：
  - `third`：相机沿 `cameraForward` 后移 4.0 m、沿 `right` 右偏 0.65 m；
  - `shoulder`：后移 1.5 m、右偏 0.42 m、再降 0.18 m。
- 朝向 yaw：`atan2(moving ? movedX : forward.x, moving ? movedZ : forward.z)`。
- `hooks/use-walk-avatar.ts`：`createWalkAvatar(item)` → `{ group, mixer, idle, walk }`；`frame({ x, y, z, yaw, moving, thirdPerson, delta })` 每帧摆位置 / 朝向 / 可见性 / 动画混合；`buildPerson` 出几何人占位。**注意**：室内 `frame` 会扣 `scene.position` 壳体偏移，户外场景无该壳体组，移植时坐标直接用 world。
- `three/glb-assets.ts:298 createWalkAvatar`：剪辑取 `Idle_Loop` 与 `Walk_Formal_Loop`（或 `Walk_Loop`），缺任一返回 `null`。
- `lib/walk-seat.ts`：`SeatTarget { id, x, z, eyeY }`；`findSeat(seats, point, floorY)`；`SEAT_TYPES`；`seatSurfaceHeight`。
- 室内视角切换：壳体层 `walkViewMode` state + `cycleWalkView` 循环，按钮「第三人称 / 近肩视角 / 第一人称 · F5 切换」（`room-organizer.tsx:2599/2601/4825`）。

### 2.5 坐标口径（沿用一期纯函数）

- ENU：`x` 东向米、`y` 北向米；three：`x` 东、`y` 上、`z = -北`。
- 互转：`worldToEnu(wx, wz)` / `enuToWorld(ex, ny)`（`lib/outdoor-walk-boundary.ts`）。

## 3. 设计切片

### 3.1 玩家姿态透出（前置，不改步进逻辑）

一期 `player` 在 hook 闭包内。三期把姿态提升为可被 avatar 节点读取的引用：

- `useOutdoorWalk` 增回传 `playerRef`（`MutableRefObject<{ position: THREE.Vector3; yaw: number; moving: boolean; seated: boolean }>`），每帧在 step 末尾写入：
  - `position` = 当前 `player`；
  - `yaw` = `atan2(forward.x, forward.z)`（静止时沿用当前前向，口径同 §2.4）；
  - `moving` = 本帧位移 > 阈值（沿用室内 `0.0001`）；
  - `seated` = 坐姿锁定位（§3.4 写入）。
- 相机朝向仍由指针锁四元数控制，`yaw` 只用于 avatar 朝向与第三人称机位，不反向驱动相机。
- 退出 / 禁用清理时，`playerRef` 复位到静止初值，避免 avatar 残留上一帧位姿。

### 3.2 户外独立 avatar 节点

新 hook：`hooks/use-outdoor-walk-avatar.ts`（对照 `use-walk-avatar`，但 world 直连）。

**挂载与生命周期**

- 入参：`enabled`、`sceneRef`、`playerRef`、`viewMode`、`avatarUrl?`、`runGuard`（复用 `modelRunRef` 思路：plan 切换 / 卸载后晚到模型直接丢弃）。
- 节点挂到场景独立组 `plan-walk-avatar`（与 `crowdLayer` 平级）；卸载 `removeFromParent` + `disposeOwnedModel`，mixer `stopAllAction / uncacheRoot`。
- 动画推进：hook 内 `mixer.update(delta)`（与一期 RAF 同帧），不依赖室内 `advanceGlbAnimations` 注册表。

**模型来源策略（两级退化）**

1. 带动画人物 GLB：`ensureGlbAsset` → `createWalkAvatar` 同款，要求 `Idle_Loop` + `Walk` 剪辑；行走 / 站立 `crossFadeFrom` 0.16s 混合（同室内手感）。
2. 无动画 / 加载失败 / `createWalkAvatar` 返回 `null`：`buildPerson` 几何人占位（与人群位柱同口径，深色区分自身角色），静默降级，不打断漫游。
3. 默认 avatar 资源待定（见 §9.1）；本期不引入室内家具库类型，`FurnitureItem` 仅作模型适配临时结构，不进户外契约。

**可见性**

- `viewMode === 'first'`：avatar 组 `visible = false`（自身不可见，同室内 `thirdPerson` 反相）。
- `third / shoulder`：`visible = true`；位置 = `playerRef.position`，朝向 = `playerRef.yaw`；坐姿时位置锁到座椅点。

### 3.3 视角模式与相机偏移

**状态**

- 户外独立 `walkViewMode: WalkViewMode`（联合类型可复用 §2.4 取值，状态自管，不读室内 `walkViewMode`），挂壳体层，与 `outdoorWalkActive` 并列。
- 切换入口：漫游态 HUD 按钮 + 快捷键 F5（循环 `third → shoulder → first → third`，同室内循环序）；切视角不退出漫游、不重挂指针锁、不停 OrbitControls 停用态。

**相机偏移（在一期 step 把 `player` 写进相机之后叠加）**

- `first`：`camera.position = player`（眼高 1.6，现状不动）。
- `third`：`camera.position += forward * (-4.0) + right * 0.65`；注视高度胸口 1.2 m（对照 §2.4）。
- `shoulder`：`camera.position += forward * (-1.5) + right * 0.42`，`y -= 0.18`。
- `forward / right` 由相机当前水平朝向解算（沿用一期 `camera.getWorldDirection` + `right.crossVectors(forward, camera.up)`）；偏移只动位置，yaw/pitch 仍归指针锁 / 拖拽。
- 第三人称机位要做边界兜底：相机被拉到边界外时，沿偏移方向回退到边界内（复用 `constrainWorldToBoundary` 思路；一期是逐轴滑动近似，沿用同一口径，不引最近边投影）。

### 3.4 坐姿（受限落地）

**座椅来源**

- 候选来自 `plan.facilities` 中可坐类型；具体类型映射待 M2 facility 类型表确认（可参照隔离分支 `5d3bbbf5` 的 facility 迁移分类）。本期先用既有设施字段兜底，不依赖未合入的 M2 walls 契约。
- 户外纯函数 `lib/outdoor-walk-seat.ts`：移植 `findSeat` 口径，入参户外设施列表 + player ENU，返回 `SeatTarget { id, x, z, eyeY }`；不套 `FurnitureItem[]`。

**状态机**

- `standing → near(检测到就近座椅) → seated → standing`。
- 坐下：`player` 锁到 `seat.x / seat.z`，相机高度用 `seat.eyeY`；avatar 位置对齐座椅点；移动键按下即起立，回到座位旁站立点（对照室内 `sitDown / standUp`，`walkFrom` 记录起身点）。
- 动画：有坐姿剪辑再切；多数 GLB 只有 idle/walk，**无坐姿剪辑时退化为下沉到座高 + 几何姿态占位**，不强行播无效动画。
- 碰撞：本期不做座椅占地推挤；落座/起立落点仍过边界钳制。

### 3.5 地形 Y 跟随（可延后）

- 一期眼高固定 1.6 m，不平缓坡 / 台阶。三期若无可靠地形高度数据，继续固定站立眼高 + 座高；地形 Y 浮动列入后续切片，不在本期预埋高度查询耦合。

## 4. 隔离边界（硬约束）

- 不翻 `view.walkthroughMode`；`outdoorWalkActive` 仍是唯一户外漫游信号；组件挂载条件不依赖室内 `walkthroughActive`。
- 不挂 `.is-walkthrough` 壳体 class；右轨退出钮保持可见。
- 不改 `routeBridge` 九方法签名；不接室内 `walk-collision` / `walk-seat` / 座椅分配 / `useWalkthrough` / `useWalkAvatar` 行为。
- 户外画布 id 独立；编辑桥手势挡下逻辑沿用一期 `walkEnabledRef`。
- 不依赖隔离分支上的 M2 walls 契约、智能体线 model 槽位切片；那些未验收、未合 main。
- 壳体坐标偏移口径只在室内链路用；户外 avatar / 相机一律 world 坐标。

## 5. 状态与 UI 落点

| 层 | 新增 / 复用 | 说明 |
|---|---|---|
| 壳体 `room-organizer.tsx` | `outdoorWalkViewMode` state、`cycleOutdoorWalkView` | 与 `outdoorWalkActive` 并列；`toggleOutdoorWalk` 退出时复位到默认 `third`（或 `first`，产品定） |
| 工作台 `scendance-workspace.tsx` | 漫游态视角切换钮 | 文案「第一人称 / 第三人称 / 近肩视角」；仅 `walkIn3D` 且漫游中可用 |
| 3D 组件 `outdoor-plan-3d.tsx` | 挂 `useOutdoorWalkAvatar`；把 `playerRef` 传入；HUD 增视角提示 | avatar 组进 scene；run guard 复用 `modelRunRef` |
| 控制器 `use-outdoor-walk.ts` | 透出 `playerRef`；坐姿锁位写入 `seated` | 步进 / 钳制 / 退出路径不变 |
| 新纯函数 `lib/outdoor-walk-seat.ts` | 户外 findSeat / SeatTarget | 与 `outdoor-walk-boundary.ts` 同级，不依赖 WebGL |

## 6. 测试与验收口径

**纯函数（不依赖 WebGL）**

- 视角偏移：`first` 不偏移；`third` 后 4.0 / 右 0.65；`shoulder` 后 1.5 / 右 0.42 / 低 0.18；朝向向量正交。
- yaw 解算：静止沿用前向；行走按位移方向。
- 户外 findSeat：就近命中、距离阈值、空列表返回 null、座高 `eyeY`。
- 坐姿状态机：standing→near→seated→standing；移动中起立；边界外座椅不命中。

**hook / 组件测试（mock three）**

- 视角切换不退出漫游、不重挂指针锁；avatar 可见性随 `viewMode` 翻转。
- 坐姿锁位后相机高度 = `seat.eyeY`；起立回起身点。
- 禁用 / 卸载路径：mixer 停动作、模型摘除、无残留监听。
- 无动画模型退化为几何人占位，不抛错。

**回归（不得扩红）**

- 一期：边界 13 例、engage 6 例、walk hook 3 例保持绿。
- 室内既有：`walk-collision` 37、`walk-seat` 8 等不触碰、不转红；agent-panel 39 条基线债维持现状不清。
- 类型：`tsc --noEmit` exit 0。

**真机走查（dev 3210 `/editor?r=1`）**

1. 户外 3D 进漫游，默认视角下可见自身 avatar（几何占位或 GLB）。
2. F5 / 按钮循环 third → shoulder → first；第一人称自身隐藏，第三/肩可见且随 WASD 行走、朝向跟随。
3. 就近座椅坐下：相机降到座高，avatar 对位；按移动键起立。
4. 退出漫游回环绕，avatar 摘除，OrbitControls 复能；链路无 JS 异常。

## 7. 建议切片顺序（每片独立可验收）

- **3.1 视角模式 + 相机偏移**：先用几何人占位 avatar，跑通 first/third/shoulder 切换与机位。
- **3.2 动画 avatar 接入**：GLB 优先 + 几何人退化，行走/idle 动画混合。
- **3.3 坐姿**：户外 findSeat 移植 + 坐下/起立 + 座高相机（无坐姿剪辑走退化）。
- **3.4 地形 Y 跟随**：按需，前置地形高度数据。

## 8. 沿用一期的遗留妥协（不在本期解决）

- 边界钳制是逐轴回退滑动近似，非最近边投影；第三人称相机拉远后的边界兜底沿用同口径。
- 调试桥 `__scendancePlan3dDebug` 一期未挂；三期若需数值直读 avatar 落点 / 相机机位，再补该门控。
- 真机自动化浏览器拒指针锁走拖拽兜底；真实浏览器走同一套 `PointerLockControls`。

## 9. 开放问题（开工前需产品 / 资产确认）

1. **默认 avatar GLB**：用哪个人物模型？云端素材库（`outdoor-personal-library.ts` 检索口径）是否有带 `Idle_Loop` + `Walk` 剪辑的人像；没有则本期几何人占位先行。
2. **户外可坐设施类型清单**：哪些 facility 类型计入可坐（帐篷 / 摊位凳 / 座椅…）；依赖 M2 facility 分类，隔离分支可参照。
3. **第三人称表现**：是否需要地面阴影 / 投影占位；avatar 身高比例（对照人群 GLB 1.75 m）。
4. **坐姿动画**：目标模型是否带 sit 剪辑；没有时退化为下沉占位的可接受度。
5. **默认起始视角**：进漫游默认 `first`（现状）还是 `third`（可见自身）。
