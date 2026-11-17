# 2026-11-16 人物 / 道具 / 漫游交接（C 类 + B2.4a 预验收）

分支：`fix/outdoor-walk-control`　HEAD：`b997da81`　工作树：未提交（多人并行）
本轮只做「户外玩家 GLB + 道具交互证据」这一条线，没有 commit / push / PR / 部署。

- 未改：`generation-sheet*`、`model-generation*`、`facility-generated-models*`、`openfreemap-*`、`outdoor-map-context*`、`panels/scendance-workspace.tsx`。
- 未改：合同字段、`routeBridge`、session scope、`SitePlanData`、`OutdoorTaskProgress`、物料生成入参。
- 未生成任何付费资产；未冒充 B2 PASS；未改共享进度文档。
- **B2-run 仍未执行**：需要真人登录 + 样例项目，本文件只提供清单、代码证据与证据模板。

---

## 1. E7b 玩家 GLB 复核结论

复核对象：`three/outdoor-player-avatar.ts`、`components/outdoor-plan-3d.tsx` 的 avatar / walk / 交互段、`room-organizer.tsx` 的 `walkRole` 传参（只读）。

| # | B2.4a 项 | 代码事实 | 本地结论 |
| --- | --- | --- | --- |
| 1 | Network 预加载 `people/<assetId>.glb` | `walkRoleGlbUrl()` → `${CLOUD_ASSETS_BASE}/people/${assetId}.glb`（`lib/cloud-assets.ts:32-34`）；`OutdoorPlan3D` 的独立 effect 在 `sceneRef` 就绪后立即 `createOutdoorPlayerAvatar`（`outdoor-plan-3d.tsx:755-790`），effect 依赖里没有 `walkEnabled`，与第三人称切换无关 | 代码路径成立；真实请求待真人看 Network |
| 2 | 第三人称显示 GLB | 主循环把 `outdoorPlayerPresentation(...).showGlb` 传给控制器；控制器脚底固定在 `PLAN_LAYER_BASE_Y=0.052`（`outdoor-player-avatar.ts` `setFrame`） | 纯函数与控制器单测覆盖；视觉/贴地待真人 |
| 3 | 第一人称 / 鸟瞰隐藏 | `thirdPerson=false` 时 `showPlayer/showGlb/showCapsule` 全 false；胶囊体与 GLB 走同一判定（`outdoor-plan-3d.tsx:2183-2202`） | 单测覆盖；相机穿模待真人 |
| 4 | 换角色不叠加 | 角色变化只重跑 avatar effect，不进场景重建依赖；cleanup 先 `dispose()` 旧 handle，`.then` 里再兜底 dispose 旧实例；`ensureGlbAsset` 按 assetId 缓存 | 单测覆盖 dispose 生命周期；Network「只新增新角色」待真人 |
| 5 | 退出 / 切 2D/3D / 刷新无残留 | 退出漫游：`walkEnabled=false` → 全隐藏；场景重建：mount cleanup `dispose()` + `playerAvatarRunRef` 递增，晚到加载结果直接释放；卸载清 `playerCapsuleRef` | **刷新这一条有已知缺口**：`walkRoleId` 没有持久化，刷新回默认「唐女」，不是刷新前选的角色（`room-organizer.tsx:2654`，本轮不可改该文件） |
| 6 | GLB 失败 / 断网保留胶囊体 | 默认加载器 `ensureGlbAsset → createWalkAvatar`；加载失败、抛错、缺 idle/walk 都返回 `null`，控制器不入场景；主循环 `hasGlb=false` → 显示胶囊体 | 单测覆盖失败/抛错；真实断网待真人（可 DevTools 阻断） |

补充事实：

- `createWalkAvatar` 要求 `Idle_Loop` + `Walk_Loop`（或 `Walk_Formal_Loop`），否则返回 `null`（`three/glb-assets.ts:697-715`）。
- `ensureGlbAsset` 失败后状态为 `error`，下次调用会新建请求，恢复网络后可重试；不会把失败永久缓存。
- `sc-walk-avatar-controls` 是室内 `walkthroughActive` 的控件，不是户外换角色入口；户外换角色走左侧「物料」的漫游角色分组。

本轮把「胶囊体 / GLB 两套 visible 各自为政」收敛成单一判定：

```ts
// three/outdoor-player-avatar.ts
outdoorPlayerPresentation({ walkEnabled, thirdPerson, controlled, hasGlb })
// => { showPlayer, showGlb, showCapsule }
```

- 有 GLB：`showGlb=true`、`showCapsule=false`，不会叠两个身体。
- 加载中 / 失败 / 断网 / 缺角色：`showCapsule=true`，第三人称不空场。
- 第一人称 / 鸟瞰 / 退出漫游 / 接管 NPC：三者全 false。

参考成熟 3D 场景的 request-generation 做法，把加载生命周期也抽成可单测的槽：

```ts
// three/outdoor-player-avatar.ts
const slot = createOutdoorPlayerAvatarSlot({ scene }); // 场景一段
slot.setRole(walkRole);                                 // 角色一段，挂槽即预加载
slot.setRole(nextRole);                                 // 同步 dispose 旧实例，旧加载晚到直接释放
slot.status; // empty | loading | ready | failed
```

组件里场景槽与角色槽是两个 effect：场景重建只换槽，换角色只换代际，不把 `walkRole` 加进场景重建依赖。槽的单测覆盖了：预加载、快速换角色不叠加、旧加载晚到释放、失败不进场景、dispose 后忽略帧、移除角色清模型。

## 2. 本轮改动文件

| 文件 | 改动 |
| --- | --- |
| `frontend/components/room-organizer/three/outdoor-player-avatar.ts` | 新增 `outdoorPlayerPresentation` 纯函数与类型；新增 `createOutdoorPlayerAvatarSlot` 生命周期槽（预加载、换代、晚到释放、失败兜底）；补「talk/wave 故意不暴露」的证据注释 |
| `frontend/components/room-organizer/components/outdoor-plan-3d.tsx`（仅 avatar / walk / 交互段） | 主循环改用 `outdoorPlayerPresentation`；场景槽与角色槽拆成两个 effect；移除 `showPlayerCapsule` 双状态与 `walkRoleRef`；补 dev-only `__scendancePlan3dDebug.avatar`（`mode/status/visible/action/seated`）；缺片段提示改用 `personActionUnavailableNote` |
| `frontend/components/room-organizer/lib/prop-interactions.ts` | 新增 `personActionUnavailableNote(action)`：talk 明说缺 `Talk` clip，wave 明说缺 `Wave` clip，不用 idle 冒充 |
| `frontend/components/room-organizer/three/outdoor-player-avatar.test.ts` | 新增 11 例：4 例显示口径 + 7 例槽生命周期（预加载、快速换角色、晚到释放、失败、dispose、移除角色、帧转发） |
| `frontend/components/room-organizer/lib/prop-interactions.test.ts` | 新增 1 例缺片段提示文案 |

没有改 `room-organizer.tsx`；`walkRole` 传参保持 E7b 原样（`room-organizer.tsx:5000-5004`）。

## 3. 本地已执行检查

Node：`C:\幕景\Scendance2026\.tmp-node24\node-v24.15.0-win-x64\node.exe` → `v24.15.0`。

聚焦测试（第一次，槽生命周期加入前）：

```text
vitest run outdoor-player-avatar + prop-interactions + outdoor-interactables + people-anim
  --maxWorkers=1 --testTimeout=15000
  4 files / 49 tests passed
```

槽生命周期与最终回归（第二次）：

```text
outdoor-player-avatar.test.ts
  1 file / 18 tests passed（控制器 7 + 显示口径 4 + 槽生命周期 7）

vitest run outdoor-player-avatar / people-anim / glb-assets / outdoor-interactables /
  prop-interactions / interact-registry / person-action-state /
  use-outdoor-walk / walk-collision / walk-seat / walk-view-modes
  --maxWorkers=1 --testTimeout=15000
  11 files / 178 tests passed  VITEST_EXIT=0
```

补跑：`components/gm-walk-motion.test.ts` 1 file / 1 test passed。

`tsc --noEmit -p tsconfig.json`（最终）：

```text
TSC_EXIT=0
```

说明：中途曾出现 `panels/generation-sheet.tsx:106/110` 两条 TS2379，属于并行对话的未提交改动；复跑时该线已收口，整仓 tsc 回到 0。本轮没有改该文件。

静态锚点复核（`outdoor-plan-3d.tsx` 当前行号）：

```text
2476  data-testid="outdoor-walk-hud"
2501  data-testid="outdoor-walk-view"
2522  data-testid="outdoor-interact-hint"
2559  data-testid="outdoor-action-note"
 756  const slot = createOutdoorPlayerAvatarSlot({ scene })   // 场景就绪建槽
 767  playerAvatarSlotRef.current?.setRole(walkRole ?? null) // 挂槽即预加载
2182  thirdPerson: avatarPresentation.showGlb                // 第一人称/鸟瞰隐藏
```

浏览器探测（Playwright + 本机 Chrome，headless，1440×900，匿名态，只读）：

```text
1) 3211 端口：进程跑在 .worktrees\g1-merge\frontend，不是当前工作树，代码可能较旧；
   探测到 __scendancePlan3dDebug 无 avatar 字段、__glbAssetCache 空、0 个 people/ 请求。
   结论：3211 不能作为本轮证据，已停止使用。
2) 3212 端口：从当前工作树 next dev 启动（Node 24，已停止并确认端口关闭）。
   匿名打开 /editor 停在「正在打开幕景工作台」；outdoor 组件未挂载，
   __scendancePlan3dDebug 不存在，0 个 people/ 请求，Console 0 error。
   结论：没有登录态 / 样例项目，浏览器和 Network 取证 BLOCKED；
   这不是产品失败，也不能据此写 PASS。
```

本轮没有登录、没有修改项目、没有点生成、没有留下浏览器会话；临时 dev server 与探测脚本已清理。

## 4. B2.4a 实机清单（未执行，禁止预填 PASS）

前置：真人登录 + 有 anchor 和 boundary 的样例项目（`house-uat5t1nz` 或同等）；`cd frontend; npm run dev`；DevTools 开 Network / Console；视口 1440×900；另开 375 宽只复核导航。每项留截图或 30–60 秒录屏、Network 过滤结果、页面时间、HEAD、端口、项目名。

| # | 操作 | 通过标准 | 证据 |
| --- | --- | --- | --- |
| 1 | 进入户外 3D（不必先点漫游），Network 过滤 `people/` | 出现当前角色 `people/<assetId>.glb`；是 3D 场景一建好就请求，不是切第三人称才请求 | 请求 URL / 时间 / 状态 |
| 2 | 进漫游，HUD `outdoor-walk-view` 或 `F5` 切第三人称 | 看到当前角色 GLB，不是蓝色胶囊；脚底贴地，不悬空、不沉 5.2 cm | 截图 + `__scendancePlan3dDebug.avatar` |
| 3 | 切第一人称、再切鸟瞰 | 玩家模型隐藏；切回第三人称重新出现；相机不穿模 | 截图 ×3 |
| 4 | 左侧「物料」→ 漫游角色分组换一个 ready 角色 | 旧 GLB 消失、新 GLB 出现，不叠加；地图和镜头不重建；Network 只出现新角色请求（已缓存过的角色可能 0 新请求） | 录屏 + Network |
| 5 | 退出漫游 → 切 2D → 切回 3D → 刷新后再进 | 无旧 avatar 残留，无 WebGL / mixer 报错；刷新后应显示“当前角色”（注意：当前实现会回默认「唐女」，见第 6 节） | 截图 + Console |
| 6（可选） | DevTools 阻断当前 `people/<assetId>.glb` 后重进 3D | 第三人称仍有胶囊体兜底，不空场；取消阻断、重新进入/换角色后可重试加载 | 截图 + Network（blocked） |

辅助判据（dev-only，Console）：

```js
window.__scendancePlan3dDebug.avatar
// { role: "<assetId>", mode: "glb" | "capsule", visible: true/false,
//   action: "idle" | "walk" | "sit" | null, seated: false }
```

- `mode` 为 `glb` 且第三人称 `visible:true`，才算看到 GLB。
- 第一人称 / 鸟瞰应 `visible:false`；切回第三人称恢复。
- 断网时应 `mode:"capsule"`、第三人称 `visible:true`。

## 5. 证据模板（复制填写）

```text
时间：2026-11-__ __:__    HEAD：________    端口：____
浏览器：________    视口：1440×900 / 375    项目：________
登录态：是 / 否        样例项目 anchor+boundary：是 / 否

B2.4a-1 预加载：PASS / FAIL / BLOCKED
  people/ 请求：________（assetId / 状态 / 时间）
  是否在进入漫游前：是 / 否
B2.4a-2 第三人称 GLB：PASS / FAIL / BLOCKED
  avatar.mode：glb / capsule    avatar.visible：____    贴地：____
  截图：________
B2.4a-3 第一/鸟瞰隐藏：PASS / FAIL / BLOCKED
  第一人称 visible：____    鸟瞰 visible：____    截图：________
B2.4a-4 换角色不叠加：PASS / FAIL / BLOCKED
  旧 GLB 消失：是 / 否    新 GLB 出现：是 / 否    地图重建：是 / 否
  Network 新请求：________
B2.4a-5 退出/2D/3D/刷新：PASS / FAIL / BLOCKED
  残留：有 / 无    Console 错误：________
  刷新后角色：________（当前实现会回默认「唐女」）
B2.4a-6 断网兜底（可选）：PASS / FAIL / BLOCKED
  mode：capsule / glb    空场：是 / 否    恢复后重试：成功 / 失败

Console 未捕获异常：有 / 无（贴首条）
WebGL / mixer 警告：有 / 无
阻塞原因：________
结论：PASS / FAIL / BLOCKED（BLOCKED 不得写成 PASS）
```

## 6. 阻塞与已知缺口（必须随证据一起记录）

1. **B2-run 未执行**：本轮没有真人登录、没有样例项目。匿名探测见第 3 节：当前工作树 3212 的 `/editor` 停在「正在打开幕景工作台」，3D 组件未挂载，0 个 `people/` 请求；3211 是 `g1-merge` worktree，不是当前代码。因此没有浏览器 / Network 截图，只有代码与单测证据；已启动的临时 dev server 已停止。
2. **刷新后角色回默认**：`walkRoleId` 是 `useState(DEFAULT_WALK_ROLE_ID)`，没有 localStorage / 项目字段持久化（`room-organizer.tsx:2654`）。B2.4a 第 5 条“刷新后仍显示当前角色”在当前实现下只能显示默认「唐女」；要修必须改 `room-organizer.tsx`，不在本轮允许文件内。真人验收时按实际记录 FAIL 或备注，不要写成 PASS。
3. **talk / wave 仍缺 clip**：16 个 labor crowd GLB 与玩家 GLB 只有 `Idle_Loop / Walk_Loop`，没有 `Idle_Talking_Loop` / Wave；本轮只把提示改成“缺哪种 clip”，`talk: null` 保持不变，不冒充“交谈/挥手已接通”。桌 / 摊位按 E 目前是“找到 NPC 但缺 talk 片段”的提示，不是真的在交谈。
4. **整仓 tsc 复跑为 0**：中途并行对话的 `panels/generation-sheet.tsx:106/110` 曾报 TS2379；最终复跑 `TSC_EXIT=0`。合并前仍建议再跑一次，避免别的线重新引入错误。
5. **无真实 crowd / 玩家 GLB 视觉验收**：单测用假 actor，不覆盖骨骼朝向、材质、比例、脚底贴地、相机遮挡等视觉问题；这些只能真人看。
6. **换角色时的胶囊体闪现**：旧 GLB dispose 后、新 GLB 加载完成前，第三人称会短暂显示胶囊体（兜底口径），不是叠加；若产品要求“加载中保留旧模型”，需要另做双实例过渡，本轮未做。

## 7. 复跑命令

```powershell
cd C:\幕景\Scendance2026\frontend
$node = "C:\幕景\Scendance2026\.tmp-node24\node-v24.15.0-win-x64\node.exe"
& $node node_modules\vitest\vitest.mjs run `
  components/room-organizer/three/outdoor-player-avatar.test.ts `
  components/room-organizer/lib/prop-interactions.test.ts `
  components/room-organizer/lib/outdoor-interactables.test.ts `
  components/room-organizer/three/people-anim.test.ts `
  --maxWorkers=1 --testTimeout=15000
& $node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json
```

预期：4 文件 56 例通过（outdoor-player-avatar 18 + prop-interactions 12 + outdoor-interactables 14 + people-anim 12）；tsc 应为 `TSC_EXIT=0`（若并行线再次引入错误，以当次为准）。

## 8. 下一步（按优先级）

1. 真人按第 4 节跑 B2.4a 六条，填第 5 节模板；第 5 条若因刷新回默认角色失败，先记 FAIL / 备注，不要改共享进度文档。
2. 若确认“刷新保留角色”是产品要求，另开一件改 `room-organizer.tsx`（或项目字段）的持久化任务，不塞进本轮。
3. talk / wave 要真接通，先为 crowd / 玩家资产准备带 `Idle_Talking_Loop` / Wave 的 GLB（涉及重定向或积分，需真人授权），再改 `createWalkAvatar` 与注册项；在资产到位前保持 `talk: null`。
4. 合并前再跑一次整仓 `tsc --noEmit`（本次复跑已 0），把整仓绿作为合并门禁。
