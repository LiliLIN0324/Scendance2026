# 户外人物漫游 · 远景路线图（素材 / 对应 / 动线 / 视角交互 / 权限对话）（2026-11-14）

> 基底：三期落点文档 `2026-11-14-outdoor-walk-avatar-third-person.md`（avatar / 三视角 / 坐姿设计，文档已进 main；对应代码切片按三期 §7 顺序落地）。
> 本文是三期下游的**远景切片规划**，不替代三期已排定的验收口径；三期没做完的部分不在本文重复展开。
> 讨论结论（2026-11-14 夜，用户拍板）：五步走——素材生成化、2D↔3D 对应打通、动线三类流、视角与 E 交互、分权限对话接微信。
> 路径口径：除明确写 `frontend/lib/...` 外，下文 `hooks/`、`components/`、`lib/`、`three/` 均相对 `frontend/components/room-organizer/`。

## 0. 本轮拍板记录

1. **素材**：静态低模逐步替换为 Aholo 生成角色。walk-roles 共 11 条可走角色——6 个古风演员（performer）+ 5 条制服角色（保安 / 警察 / 志愿者 / 主管 / 管理员）；**2026-11-14 复核**：11 条 `people/<assetId>.glb` 在 R2 全部 HTTP 200，取样文件头魔数 `glTF` 确认真模型，早先"5 条占位无 GLB"的判断作废。远端 labor 分支另预留 8 岗 × 男女 16 个槽位（`ready=false`，未出模）。**绑骨链路要我们固化成批次能力**——PEOPLE-03 已在一个汉服角色上实跑通过绑骨 + 两条动作重定向，但还不是可复用流程。
2. **角色设计**：外观从活动岗位目录出发（现场一般有哪些人），不从零臆造角色。
3. **2D↔3D 对应**：自动匹配为主，预留手动覆盖入口。
4. **动线**：先让大家动起来；人流 / 车流 / 后勤流基于真实进出口与道路分析；角色有自己的活动范围；**主角避让行人，车流不可横穿**。
5. **视角**：参考成熟游戏案例定参数。**能交互的尽量交互**，分阶段落地；对话按 E 触发，先预设台词、后接 Agent；拾取 / 使用物品后置。
6. **权限与微信**：权限指活动项目组里的不同成员；不登录软件的人，后续可与其对应建模沟通、消息直接发到对方微信。最复杂，最后排。

## 1. 现状盘点（代码证据）

### 1.1 人物素材：三条线并存

| 线 | 位置 | 状态 |
|---|---|---|
| walk 角色（可走动画人） | `lib/walk-roles.ts`，11 条：6 古风演员（唐女 / 唐男 / 宋女 / 明女 / 明男 / 宋男）+ 5 制服（保安 / 警察 / 志愿者 / 主管 / 管理员），R2 云端 | Aholo 链地产物：参考图 → 四视图 → G1 GLB → 绑骨 → 重定向 `Idle_Loop` / `Walk_Loop`；带头像缩略图、`walkable`、`crowdType`。2026-11-14 HEAD + `glTF` 魔数复核 11 条全部可用 |
| 制服 walk 角色 | 同上文件 5 条（security / police / volunteer / manager / admin） | 已随整批上云，云端漫游 GLB 实际存在；无对应制服低模，人群布点这几类仍出人位标记 |
| labor 预留槽（远端未合并分支） | 分支 `feat/labor-gender-aholo-people` 的 `lib/labor-gender.ts` | 8 岗（消防 / 经理 / 医务人员 / 警察 / 保安 / 管理员 / 主管 / 志愿者）× 男女 = 16 槽，assetId 占名、`ready=false`；未出模不请求云端 GLB |
| 静态低模 | `lib/crowd-types.ts` `CROWD_TYPE_MODELS`，showcase slug | 站姿低模，无骨骼无动画；挂 staff / medical / fire / exhibitor / audience |
| 室内模特 | `assets/` `people.glb`（Quaternius CC0） | 室内链路专用，户外不引用 |

生成链路脚本：`tools/aholo/people02-chain.mjs`（`refimage / fourview / img3d / get` 分步，每步人审再进下一步）。
绑骨现状：Aholo humanoid auto-rig 端点 `POST /animations/rig/task/create`、查询 `GET /animations/rig/task/get?taskid=`；**PEOPLE-03 已库内实跑**：18.96 MB 原模 → 220 s 内出 41.82 MB 带骨 GLB（15 credits），两条动作重定向各 6 credits；证据目录产物上云后已清理，结论存 `docs/39` §D。重定向端点路径与入参仍需按新 openapi 复核；`sculpture-rig-local/bind-sculpture.py` 是雕塑专用 blender 脚本，不通用人形。
硬限制（绑骨 / 重定向）：只认标准人形，必须 T/A-pose、Y-up Z-front；不能带武器 / 飘带 / 尾巴；3DGS 不能绑；输入不能带关键帧；素材不对返回 `status=4` 且无 error 字段。

> 远端 labor 分支（未并入 main）对素材解析的改动：契约 `worker` 加可选 `gender: male | female`（旧快照兼容，缺省按 male）；`resolveLaborPersonModel(role, gender, index)` 返回三态来源 `aholo`（就绪槽位）/ `lowpoly`（现有低模）/ `fallback`（人位标记），自定义点不出人物；人群类型新增 `executive`（经理）。分支与本地 chat 线文件零重叠，合入风险低。

### 1.2 2D ↔ 3D 对应

- 展开逻辑在 `lib/plan-crowd-placement.ts`：岗位 `role` 关键词 → `crowdType` → 低模 slug（取模轮换）；黄金角螺旋散布，单岗上限 24 实例；无模型出人位柱降级。
- **两套模型登记未打通**：walk 模型集合（`walk-roles.crowdType`）与低模集合（`CROWD_TYPE_MODELS`）分离，状态三态 `walk / lowpoly / todo`（`crowdTypeModelStatus`）。远端 labor 分支把解析升级为 `role + gender → Aholo 槽 / 低模 / 回落`，并带 `modelSource` 来源标记；合入后以此为单一映射雏形。
- 设施层已有可参照的手动覆盖机制：V-5「图标候选 ↔ `modelOverride` ↔ 3D 换模型」（`plan-model-layer`）；人物层还没有同等入口。
- 2D 岗位目前是色点 / 人位标记，不显示角色头像；walk 角色有 `/assets/avatars/*.jpg` 缩略图，低模没有图标。分支面板 `labor-gender-control.tsx` 在同一岗位图标上切男女，不做第二套图标。

### 1.3 动线：契约齐了，3D 实体还没跟上

- 契约（`supabase/functions/_shared/site-plan.ts`）：
  - `plan.routes`：`kind = pedestrian | vehicle | service`，带 `audiences`（visitors / staff / security / performers / service）、`oneWay`、`widthM`、`startNodeId / endNodeId`、`color`、`notes`。
  - `plan.workers`：`role / audience / count / position / routeIds / activityZoneIds / zoneId / color`。
- 2D：V-4 `flow-sim` 沿路线的流动密度标记模拟，只读、不写规划、不作疏散认证。
- 3D 现状：户外人群按岗位点**静态散布**（`outdoor-plan-3d.tsx` `plan-crowd` 层）；室内 `lib/crowd-route.ts` 最多 3 人格子巡逻；**户外 3D 没有沿 `plan.routes` 行走的实体**；车辆 / 后勤流无模型、无动画。
- 可复用引擎：`lib/person-route.ts` 已是成熟路线跟随纯函数——闭环 / 折返、路点暂停、受阻掉头、平滑转向、里程与圈数、边界夹取；但它接室内 `WalkRoute`（场景坐标、房间中心原点），户外 `PlanRoute` 是 ENU 坐标，需要适配器而不是直接搬。

### 1.4 视角与交互

- 一期：裸第一人称步行（`hooks/use-outdoor-walk.ts`，指针锁 / WASD / Shift / 边界钳制 / Esc 两步退出）。
- 三期已设计：first / third / shoulder 三视角 + 坐姿；**鸟瞰视角不在三期方案内**。
- 交互现状：无 E 键交互系统；漫游内没有 NPC 对话；现有对话是侧边 Agent 主链（V1–V5），不在漫游态内触发。
- 室内可对照（只读不 import 行为）：`use-walkthrough.ts` 视角偏移、`use-walk-avatar.ts` 每帧摆位 / 混合、`lib/walk-seat.ts` 就近座椅判定。

### 1.5 权限与微信

- 受众枚举五类 `visitors / staff / security / performers / service`，可作权限基础。
- 微信目前只出现在小程序 / 虚拟支付 / 开放平台语境（`docs/55`）；**没有角色对话 → 微信的通道**，也没有项目成员 ↔ 3D 角色的映射。

## 2. 参考案例与可复用资产

### 2.1 视角分工（游戏通行口径）

| 视角 | 用途 | 成熟做法要点 |
|---|---|---|
| 第一人称 | 代入、瞄准 | 机位 = 眼高；自身 avatar 隐藏；FOV 按步行体感 |
| 第三人称 | 看角色动作 / 外观 | 角色背后，注视胸口 1.2 m；视距可在 1–30 m 调；俯仰 ±89° |
| 越肩（过肩） | 看清交互目标 | 右后方，后距短、略降肩 |
| 鸟瞰 / 2.5D 俯视 | 看全局动线、岗位分布 | 高位大俯角，围绕角色旋转；与环绕镜头衔接 |

案例参照：原神 UGC 镜头模板把第一人称 / 3D 背镜头 / 越肩 / 2.5D 俯视做成可配置模板，参数含视距范围、俯仰角范围、视点偏移、镜头碰撞开关、FOV；镜头碰撞默认开（机位被挡时回退）。视角分工通行结论：瞄准用第一人称、看角色用第三人称、看全局飞上天。
> 已确认口径（2026-11-14）：鸟瞰机位**可缩放（距离）、可环绕（方位角）**，本质是以玩家为焦点的球轨相机（yaw / pitch / distance 三自由度 + 上下限 + 阻尼），不是 third/shoulder 那种固定身后偏移；默认跟随角色朝向，手动拖拽接管、停顿数秒后回跟。待真机调参：距离范围（参照第三人称 1–30 m）、俯角下限（避免穿地）、起始视角；三期 third 后 4.0 m / shoulder 后 1.5 m 的口径保留。

### 2.2 代码资产（许可证已核，three 0.186 / React 18 / TS 5.6）

| 能力 | 包 | 许可证 | 备注 |
|---|---|---|---|
| Steering 行为 + NavMesh 寻路，NPC 漫游 / 跟随 / 分离避让 | `yuka` | MIT | 轻量，不上重型导航库时首选 |
| NavMesh 生成 / A* / 人群模拟 / 临时障碍，three 辅助件 | `recast-navigation`、`@recast-navigation/three` | MIT | 需把场景几何体烘焙成 navmesh；后置引入 |
| 网格寻路（three 绑定） | `three-pathfinding` | MIT | 备选 |
| 骨骼规范化 + 动画重定向到任意 humanoid GLB | `@three-ws/retarget` | Apache-2.0 | three >=0.150；新模型比例不一时套标准 Idle/Walk |

现有可复用：`use-outdoor-walk`（步进 / 钳制 / 退出）、`use-walk-avatar`（混合器 / 可见性 / 帧摆位）、`createWalkAvatar`（`Idle_Loop` + `Walk_Formal_Loop | Walk_Loop` 取剪辑，缺任一返回 null）、`buildPerson`（几何人占位）、`person-route`（路线跟随引擎）、`crowd-route`（格子巡逻）、`plan-crowd-placement`（散布）、`walk-seat`（就近坐具）。

### 2.3 绑骨路线（按工程量从小到大）

1. **云端 rig 端点跑通 + 离线验收批次流程固化**（近期）：沿用「生成 → 四视图 → G1 → 云端绑骨 → 重定向 → 验收上云」，把分步脚本和验收口径做成可复用批次流程。参考图姿态红线沿用 PEOPLE-05：全身入画见鞋脚、A 字站姿双臂外展、纯白背景、衣摆不拖地；G1 出模先查下肢完整再送绑骨。
2. **浏览器内重定向**（并行预研）：绑骨仍在云端 / 离线出骨架，前端用重定向库把标准 Idle/Walk 套到新模型上，省逐人手工调动画。
3. **运行时自动蒙皮**（暂缓）：浏览器内自动权重蒙皮是难题，不自研；需要时接 AccuRIG / Mixamo 类专用工具或云端服务出骨架。

## 3. 切片设计（远景，依赖三期先落地）

### 3.0 本轮已落地的纯函数原型（本地未提交，未接组件）

四个独立纯函数模块，不依赖 WebGL / three，共 37 个单测全绿；tsc exit 0、eslint 0，邻近回归（person-route / crowd-route / placement / boundary / seat / walk-collision / engage / outdoor-walk hook / crowd-types / site-plan-routes）保持绿。组件接线留待对应切片。

- `lib/outdoor-walk-view.ts`：视角机位计算。`first / third / shoulder / bird` 四档预设（third 后 4.0 右 0.65、shoulder 后 1.5 右 0.42 降 0.18）；**bird 为球轨相机**：`yaw`（环绕偏置）/ `pitch`（俯角）/ `distance`（缩放距离），`clampBirdOrbit` 限幅（距离 1–30 m、俯角 20°–85°、yaw 归一化），坏参数回落默认；输出相机位置 / 注视点 / avatar 可见性；`cycleOutdoorWalkView` 循环序 third → shoulder → bird → first。球轨阻尼、拖拽接管与回跟由 hook 层接。
- `lib/outdoor-route-follower.ts`：户外 ENU 路线跟随者。按 `pedestrian / vehicle / service` 分档速度与暂停；闭环循环 / 折返 / oneWay 到头停住；平滑转向、里程、圈数、退化路线静止。分离避让、navmesh、受阻掉头未预埋，随 P3 切片接。
- `lib/outdoor-route-proximity.ts`：车辆路线横穿判定。点到折线距离、车辆宽度带（缺省 3.0 m）、`blockedByVehicleRoutes` 聚合拦截；行人 / 后勤路线不拦截。退回与提示由 hook 层处理。
- `lib/outdoor-interaction-target.ts`：交互对准。可交互物注册表（seat / booth / sign / door / npc），默认可达半径 1.6 m；半径内取最近目标、同距按 id 稳定排序；射线对准 / 高亮浮标 / E 触发由 hook 层接。

### 3.0.1 视角骨架接线（2026-11-14 本地，未提交）

纯函数之上已接出可在 dev 3210 走查的视角骨架，未碰室内 walkthrough / avatar / 座椅链路：

- `hooks/use-outdoor-walk.ts`：回传 `playerRef`（position / yaw / moving 每帧快照，退出复位静止）；options 增 `viewMode` / `birdOrbitRef`；步进末尾按档位叠加机位——`first` 眼位直出不动，`third / shoulder` 只拉位置、朝向仍归指针锁 / 拖拽，`bird` 走球轨并注视胸口。
- `hooks/use-outdoor-walk-avatar.ts`（新）：户外独立占位人节点，world 直连不扣壳体偏移；几何人 `buildPerson` 占位，每帧跟 playerRef 摆位 / 朝向，可见性随 `VIEW_PRESETS` 翻转（first 隐藏，其余显示）；卸载摘除 + `disposeOwnedModel`。动画 GLB avatar 留待三期 §3.2。
- `components/outdoor-plan-3d.tsx`：组件内 `walkViewMode` 状态（退出漫游复位 first）；HUD 视角切换钮 + F5 循环（third → shoulder → bird → first，忽略长按重复与输入框聚焦，preventDefault 拦刷新）；`birdOrbitRef` 传给 hook。
- **后置**：球轨阻尼、拖拽接管与停顿回跟尚未接；边界外机位回退沿一期逐轴滑动近似。鸟瞰环绕 / 缩放输入已在 §3.0.2 落地。
- 验收：户外漫游相关 59 单测全绿；`tsc --noEmit` exit 0；eslint 0 error（残留均为基线 import/order 与既有 exhaustive-deps warning）；dev 3210 `/editor?r=1` 页面 200、无编译错误标记。

### 3.0.2 P4a-2 鸟瞰环绕 / 缩放输入（2026-11-14 本地，未提交）

球轨输入已接进 hook，纯函数与接线单测齐备，真机手感待通道恢复后走查：

- `lib/outdoor-walk-view.ts`：`applyBirdOrbitDrag(orbit, dx, dy, sensitivity=0.005 rad/px)` 右拖 yaw 增、上抬鼠标 pitch 增；`zoomBirdOrbit(orbit, wheelDeltaY, factor=1.12)` 上滚拉近 / 下滚拉远，按 `deltaY/100` 折算指数倍率；两者都走 `clampBirdOrbit` 限幅（距离 1–30 m、俯角 20°–85°、yaw 归一化）。
- `hooks/use-outdoor-walk.ts`：`bird` 分支拖拽分流到球轨（写回 `birdOrbitRef`，不再转相机四元数）；挂 wheel 监听（`passive:false`，bird 态 `preventDefault`），其余视角不拦截滚轮；**进入 bird 即 `controls.unlock()`**——鸟瞰是轨道视角，握着第一人称指针锁时鼠标坐标冻结、环绕会失灵，退锁后指针恢复可见，走非锁拖拽路径；切回 third/shoulder 后由点按画布重新抢锁兜底。
- 测试：view 层球轨拖拽 / 缩放 7 例 + hook 层 bird 滚轮接线 1 例；户外 5 文件共 48 单测绿，`tsc --noEmit` exit 0，eslint 0 error（6 条均为基线 import/order 与 exhaustive-deps warning）。
- **2026-11-14 晚 headless 真机复验（主目录独立 dev 3211，复用 3199 代理；3210 属并行会话 worktree 旧代码，不作验收环境）**：仓库自带 Playwright 1.64.1 + chromium-1254 直连本地页面，绕过不可用的 bu/cu 通道。四档循环文案正确（first→third→shoulder→bird→first）；调试桥 `rig.camPos` 实测：first `[0,1.6,57.38]`、third `[0.65,1.6,61.38]`、shoulder `[0.42,1.42,58.88]`、bird `[0,8.13,61.38]`；bird 滚轮两格距离 8→约 6.4 m，cam `[0,6.72,60.57]`；bird 拖拽 120px 后 `[3.60,8.13,59.13]`，yaw 偏转、距离与高度不变；bird 拉近后占位小人可见；console 无 error、无 ≥400 请求。
- **本轮修复的阻断 bug**：3D 主循环每帧 `controls.update()`，`OrbitControls.enabled=false` 只拦用户输入，`update()` 仍按内部球轨把相机写回，覆盖 hook 设的 third/shoulder/bird 机位。已改为漫游态（`walkEnabledRef.current` 为真）跳过 `controls.update()`，机位交给 walk hook；退出漫游后主循环恢复 update，OrbitControls 基于当前相机重新算球轨。
- **遗留待真机目视**：①视角钮点击命中——headless 按钮中心点 `elementFromPoint` 命中按钮自身，但右轨 dock 图标 span 在按钮边缘曾拦截 Playwright 真实点击，真机用户点击是否受影响待肉眼确认；②环绕 / 缩放灵敏度、阻尼与停顿回跟手感待真机目视调参；③切回 third/shoulder 点按重抢锁是否顺畅；④指针锁异常路径下 bird 拖拽坐标是否需回退 `movementX/Y`。

### 3.0.3 内置示范场地 · 一键漫游（2026-11-14 本地，未提交）

背景：空方案进漫游有两道门槛——2D 平面态右轨漫游钮禁用（提示「环绕视角暂不支持第一人称」），即便切进 3D 也是空蓝、无边界/步道/物件可参照。用户拍板方向 A：预置一套样例场地，独立入口一键载入直接漫游；**不改默认空草稿语义**，刷新/清空后回到空白起步。

- **数据层** `lib/outdoor-sample-plan.ts`（纯数据，不含 three/WebGL）：约 70×45 m 矩形场地，北侧舞台区、中南观众区，一条人行步道串入口→观众区→舞台前→出口；6 设施（舞台台面/双摊位/餐车/医疗帐篷/安保岗亭）+ 4 组岗位人员；锚点沿用 `DEFAULT_OUTDOOR_PLAN_ANCHOR`（平湖秋月 preset），实体 ID 固定序列 UUID。`outdoor-sample-plan.test.ts` 6 例：zod 契约解析、边界闭合、模板合法、点位落界内、路线端点节点存在、ID 全局唯一。
- **注入链路**（父级原本只经 `onPlanChange` 单向回写，2D 画布/overlay 内部持有各自 plan state，无反向渠道）：
  - 画布 `OutdoorPlanCanvasHandle` 新增 `replacePlan(next)`：清选中 → `commitPlan(next)`（进历史可撤销）→ 重绘；
  - overlay `OutdoorPlanOverlayHandle` 新增 `loadPlan(next)`：`normalizePlanFacilityFootprints` 规整后 `setPlan` 镜像 state，并调 `canvasApiRef.replacePlan`；回写父级与自动落盘走既有 effect（`onPlanChange` 上报 + 防抖 autosave）；
  - room-organizer `loadSampleOutdoorPlan`：`outdoorOverlayRef.current?.loadPlan(SAMPLE_OUTDOOR_PLAN)`，随后关 splat 变换、`outdoor2DOpen=false`、`outdoor3dTakeoverActive=true`、view 退出 walkthrough。
- **入口控件**：户外面板「添加物件」页签宿主首项一张卡片（`data-testid=sample-plan-entry` / `sample-plan-load`），标题「示范场地」+ 一行说明 + 「载入并进入漫游」按钮；可视化卡片，不堆说明文案。
- **落盘口径**：未改动 `createStarterOutdoorPlan()` 默认起步空草稿工厂；样例载入经既有 autosave 落到当前本机草稿（与手动绘制保存同路径），清空当前草稿或新建活动即回空白。
- **验收（真机 3211 主目录 dev，复用 3199 代理；3210 为 worktree 旧代码不作验收）**：清本机草稿后空起步，入口卡片/按钮各 1；初始 `#tool-walk` disabled、提示环绕视角；点载入后漫游钮 enabled、文案「第一人称漫游」、环绕机位 `[0,35.85,57.38]`；进漫游 pressed、「退出漫游」、眼高 `[0,1.6,0]`、HUD「WASD/方向键行走·Shift 加速·Esc 退出漫游 视角：第一人称·F5」；图层树已放置 15 件、边界 4 点、舞台区/观众区各 1、设施 6、人员 4 组、步道 1、入口/出口各 1；2D 平面与 3D 俯视截图目视边界矩形、分区色块、步道折线、设施点位齐全；console 0 error。回归：户外/人群/漫游邻近 8 文件 62 例 vitest 全绿，`tsc --noEmit` 0 错，eslint 0 error（残留均为基线 import/order 与既有 exhaustive-deps warning）。
- **遗留**：样例设施仍走公共占位低模（餐车呈灰色厢式货车、部分设施浮空/偏大，属既有占位模型问题，未在本轮读 Box3 定位）；#19 3D 接管态分享入口、#20 瓦片按真实成功数回退 paper 本轮未动。

### P1 素材链路收口

- **统一角色登记表**：人群类型 + 性别 → 首选 Aholo 槽位 / walk 模型 / 低模 / 占位，登记外观来源、模型标识、状态、头像、动画剪辑、受众；合并现在 walk-roles 与 CROWD_TYPE_MODELS 两套登记，并接 labor 分支的 16 槽与 `modelSource` 三态标记。
- **已落地（2026-11-14，本地未提交）**：消除 walk 集合双写——`CROWD_TYPES_WITH_WALK_MODELS` 改为从 `WALK_ROLES` 经 `walkRoleCrowdType` 反推（缺省 performer），不再在 crowd-types 硬编码一份类型清单；`crowd-types.test.ts` 锁三条一致性断言（推导集合 == 登记、每个 walk 角色归入 walk 态、类型仅在拥有 walk 角色时判 walk）。验收：crowd-types 6 例 + 人物/人群/漫游邻近 7 文件 101 例 vitest 全绿，`tsc --noEmit` 0 错，改动文件 eslint 0 问题；真机 3211 物料「不同人群」11 类全部渲染，计数 walk 11（performer 6 + 制服 5）/ 低模 20（staff4 medical1 fire1 exhibitor2 audience12），演员 6 张与保安 1 张卡片头像加载正常、0 console 报错。
- **已落地（2026-11-14 晚，人物设计链骨架，本地未提交）**：人物 Aholo 链路四段在代理 / 服务层 / 面板三层就位，产物验收前不入库、不分配 assetId、不批量付费。
  - **代理** `tools/aholo/lux3d-dev-proxy.mjs`：新增 `/ref-image`（多模态参考图）、`/four-view`（四视图）、`/rig`（绑骨）、`/retarget`（动作重定向）四个转发端点；入参校验 `httpsUrl`（公网 HTTPS，拒本机/凭据/http）、`animationList`（1..10 条非空 ≤64 字）、`luxTaskId`（兼容数字号/字符串/`{taskId}`）；轮询复用既有 `GET /task?taskid=`。期间修了并列人物分支复用 text/world 块内 `let taskid` 不可见导致的 ReferenceError（人物分支改局部 `createdTaskId`）。代理 node:test 219 例全绿。
  - **服务层** `lib/character-generate.ts`：`submitCharacterReference / submitCharacterFourView / submitCharacterRig / submitCharacterRetarget` 四个直连提交函数 + `imageOutputOf / modelOutputOf` 产物挑选；动作预设对齐前端剪辑（`Idle_Loop` 待机、`Walk_Loop` 行走、`Idle_Talking_Loop` 交谈）；代理未开返回可读 stub 提示，网络异常归 `unknown`，不编任务号、不自动转云端。配套 15 例。
  - **目录** `lib/crowd-types.ts`：抽 `crowdDirectory()` 统一返回每类人群的状态 / 状态文案 / walk 角色 assetId 列表 / 低模 slug 列表；面板内联分组仍待切换到该查询。配套 8 例。
  - **流程与面板** `lib/character-flow.ts`（五步顺序定义、默认动作 Idle+Walk、next/previous 纯函数，6 例）+ `panels/character-design-panel.tsx`（分步面板，挂物料「不同人群」页签顶部「设计新角色」入口）：参考形象 → 四视图 → 静态人形 → 绑骨 → 动作重定向；参考图 / 四视图 / 绑骨 / 重定向接通服务层，静态人形步占位预留；动作勾选默认 Idle+Walk、交谈可选；额度确认勾选后才提交，每步手动「取回」轮询产物，面板内预览、不写人物库。
  - **验收（真机 3211 主目录 dev，复用 3199 代理）**：人物 / 目录 / 流程 / 库组件邻近 6 文件 90 例 vitest 全绿（含 `online-model-library.react.test.tsx` 40 例）；代理 node:test 219 绿；`tsc --noEmit` 0 错；改动文件 eslint 0 error；headless Playwright 走通 物料 → 不同人群 → 设计新角色，五步面板渲染、console 0 error。
  - **只读网关探针结论**：国内 `api.aholo3d.cn` 与国际 `api.aholo.ai/global` 的 `task/list` 均 HTTP 200、`c=0`、有 `d`，本机 key 两网关鉴权都通过；已知号 7190317 两网关都 `c=-1 task not found`（属对方账号 / 任务已不在本机 key 下，不据此判定网关隔离）。人物端点代理沿用 `base`（默认 global，可由 `LUX3D_BASE_URL` 整体切 cn）。
- **P1 遗留**：①面板仍内联分组，未切换到 `crowdDirectory()` 查询；②labor 分支 16 槽与 `modelSource` 三态标记尚未合入本 main；③人物链路接缝待补：四视图 / 图生 3D 入参代理只认 PNG/JPEG dataURL，上游公网产物 URL 转 dataURL 的回链未做；静态人形 G1 复用物件出模链路及其 pending 入库归属待接；产物 URL 在 ref→fourview→G1→rig→retarget 间的自动链式流转未接；④`multimodal-to-image` 端点文档标注公开 API 404，但 PEOPLE-06 manifest 有 9 张成功参考图（taskId 7189834 等），矛盾待真调核对；⑤PEOPLE-06 16 槽 PR 113 未合、Pages 构建失败，本轮未发起批量付费、未上云、未改槽位 ready。
- **替换批次**：静态低模按优先级逐步生成替换（观众 → 工作人员 → 展商 → 医护 / 消防）；每批走 §2.3 路线 1，验收前不入库、不提交、不上云（沿用 PEOPLE-05 口径）。首批生成目录（分支 8 岗 × 男女）待产品确认。
- **降级**：无绑骨 / 无 Idle+Walk 剪辑 → 几何人占位 / 人位标记，静默降级不打断漫游；槽位 `ready=false` 时不请求云端 GLB。
- 角色外观维度（性别 / 服装 / 配色 / 配饰）以岗位目录为准；首批不做参数化换皮。

### P2 2D ↔ 3D 对应打通

- 单一映射：`role + gender → 模型候选列表`（Aholo 槽位优先，其次低模，回落人位标记）；自动选首选，保留手动 `modelOverride`（参照设施 V-5 入口）；以 labor 分支 `resolveLaborPersonModel` 为雏形，合入后再补覆盖入口。
- 2D 岗位显示类型图标 / 角色头像；2D 选中岗位 ↔ 3D 高亮该组实例，反向定位同理。
- 同类型多外观：确定性 index 轮换（刷新不跳，口径同散布偏移）；可手动指定。
- 无模型类型降级：人位柱 / 图标占位，状态在登记表可见。

### P3 动线模拟

- **P3a 人流（先做）**：把 `plan.routes`（`pedestrian`）ENU 折线适配到路线跟随引擎；先匀速循环 + 个体分离避让，不接 navmesh；角色在所属 `zoneId / activityZoneIds` 范围内活动，出区即回。
- **P3b 车流**：`vehicle` 路线；车型先占位体后换模型；速度档位；装卸停靠点；**主角不可横穿**——进入车辆路线时拦截 / 提示退回（口径区别于人流的侧身避让）。
- **P3c 后勤流**：`service` 路线，工作人员 / 手推车；受众与物理通道隔离，不穿表演区 / 展位。
- **后置**：navmesh 烘焙与真实避障；进出口 / 道路分析对接 V-2 路网提案；子口驳线连主流线（V-4 既有思路）。

### P4 视角与交互

- **P4a 鸟瞰视角**：作为三期三视角之外的第四机位；高位大俯角、注视角色、可环绕；切视角不退出漫游、不重挂指针锁。
- **P4b 交互框架**：可交互物注册表（座椅 / 摊位 / 展牌 / 门 / NPC）；统一范式——对准（射线 + 距离阈值）→ 高亮 / 浮标提示「E」→ 按键触发；一期先接座椅（三期坐姿），其余物类分批补。
- **P4c NPC 对话**：E 触发；预设话术先行（岗位 / 类型挂台词表）；对话卡片接现有 Agent 主链后置。
- **P4d 拾取 / 使用物品**：后置，不进交互框架首版。

### P5 权限对话与微信（远期，先定形态再排期）

- 角色身份 ↔ 项目成员映射；区域准入按 `audience / zone`（观众不进后勤区等）。
- 对话形态待定义：玩家 ↔ NPC、NPC 氛围闲聊、还是多真人在线互聊，三者工程量不同。
- 微信通道候选：小程序订阅消息 / 客服消息 / 企业微信 / 分享卡片；主体资质、后端接口、成员映射方式单列，不与漫游主线耦合。

## 4. 隔离边界（沿用三期硬约束）

- 不翻室内 `view.walkthroughMode`；`outdoorWalkActive` 仍是唯一户外漫游信号；不挂 `.is-walkthrough` 壳体 class。
- 不接室内 `FurnitureItem[] / InteriorWall[]` 碰撞类型，不套座椅分配 / `useWalkthrough / useWalkAvatar` 行为。
- 户外 avatar / 相机一律 world 坐标；壳体坐标偏移只在室内链路用。
- 动线模拟只读 `SitePlanData`，不写规划、不作疏散安全认证。
- 不在未验收的隔离分支契约（M2 walls / 智能体线槽位）上预埋耦合。

## 5. 测试与验收口径

**纯函数（不依赖 WebGL）**

- 视角偏移：first 不偏移；third / shoulder 偏移量与正交；bird 球轨距离 / 俯角限幅、yaw 归一化、坏参数回落；朝向向量正交；边界外机位回退。
- 路线跟随：已覆盖闭环 / 折返 / oneWay 停住 / 路点暂停 / 里程与圈数 / 退化路线静止；受阻掉头、出区返回随 P3a 再接。
- 映射表：role + gender → 候选顺序、手动覆盖优先、未知类型兜底占位；轮换确定性。
- 范围判定：点在活动区内 / 外；车辆路线横穿拦截。

**hook / 组件（mock three）**

- 视角切换不退出漫游、不重挂指针锁；avatar 可见性随视角翻转。
- 交互对准：距离内 / 外浮标显隐；E 键只触发当前目标；卸载摘除监听与模型。
- 无动画模型降级几何人，不抛错。

**回归（不得扩红）**

- 一期边界 / engage / walk hook 基线；三期切片完成后其单测保持绿。
- 室内既有 `walk-collision / walk-seat` 等不触碰、不转红；`tsc --noEmit` exit 0。
- 基线备注（2026-11-14 夜全量跑测）：main 工作树存在一批与人物漫游无关的既有失败（页面路由 / 后端集成 / 座位结构 / 场景图层 / agent 面板等约 43 文件），报错为夹具 undefined、常量漂移、jsdom 导航未实现等环境与既有回归；本轮四个新模块不被任何既有文件引用，自身 37 个单测与邻近回归全绿、tsc / eslint 0。既有失败不在本轮处理，接手机会时另行归类修复。
- 本地线定向复核（2026-11-14 上午，对齐 main 前置验收）：前端 m2 纯函数 72 绿；chat 两级菜单子集 10 绿；后端 chat-provider / hoist / providers / assistant-chat / api 共 88 绿。仍红的 42 条（agent-panel 39、brief-extract-api 1、brief-conversation-api 2）已在 origin/main  detached worktree 复跑确认**基线同样红**，非本地未推提交引入。chat 实现线另有已对齐 main 的分支 `feat/two-level-on-main`（3 提交，独立 worktree），主目录 main 上独有内容为 m2 测试加固与 decouple 文档登记；对齐时 chat 实现以该分支为准。

**真机走查**（dev 3210 `/editor?r=1`）

- 各视角机位与自身 avatar 显隐；人流沿路线循环、不叠人；车辆路线不可横穿；E 键座椅坐下 / 起立；NPC 预设对话弹出。

## 6. 开放问题（开工前需产品 / 资产确认）

1. 鸟瞰球轨参数真机取值：距离范围、俯角下限、环绕灵敏度、手动接管后回跟时长；默认起始视角。
2. Aholo rig / 重定向端点在新 API 下能否跑通；跑不通时的绑骨兜底工具链。**新 API 文档（base URL、端点、鉴权头、入参、状态枚举、产物格式）待提供后对照现有 `/lux3d/v1/...` 与 `/animations/rig/...` 更新链路一节。**
3. 车流车型清单、速度档位、装卸停靠点的数据来源。
4. 角色活动范围与沿路线巡游的优先级：区内随机游走优先，还是沿路线走优先。
5. NPC 预设话术数据源；Agent 接入的边界（哪些岗位可接实时对话）。
6. 微信通道形态、项目成员 ↔ 角色映射方式、所需主体资质与后端接口。
7. 生成角色的数量预算与单批费用口径（参照 PEOPLE-05：5 人 × 5 步，25–35 次付费任务预备）。
8. 首批生成目录确认：labor 分支 8 岗 × 男女 16 槽是否即首批 Aholo 角色清单。
9. 出网环境备注：Node 原生 fetch 默认不读 `HTTP_PROXY / HTTPS_PROXY`，本机经代理出网时脚本 / dev 代理需显式走代理；线上代调在边缘函数内，不走本机代理。

## 7. 建议顺序

0. **基线对齐（前置）**：chat 实现采用已对齐 main 的 `feat/two-level-on-main`；主目录 main 独有的 m2 测试加固与 decouple 文档登记随后追并；再并入 labor 分支（文件零重叠）；全量回归；攒好验收后再一次性推 main，不逐小步开 PR。
1. 三期切片落地：avatar 节点 → 三视角 → 坐姿（三期 §7 顺序）。
2. P1 角色登记表收口 + 首批静态低模替换；绑骨端点验收（待新 API 对照）。
3. P2 对应打通 + 手动覆盖入口。
4. P3a 人流沿路线；P4a 鸟瞰球轨；P4b 交互框架 + 座椅。
5. P3b / P3c、P4c 对话、P4d 拾取随后；P5 形态定义后再排期。
