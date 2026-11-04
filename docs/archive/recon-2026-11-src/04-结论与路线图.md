# 04 结论与路线图：Golden Path 差距地图（2026-11-04）

> 输入：`01-素材核查与采集缺口.md`、`02-3D重建技术路线调研.md`（`03-agent-空间能力设计.md` **不存在**，Agent 缺口改以代码实测为准）。
> 目标：普通用户 10 分钟内完成一次真实空间创作——①选真实场景/导入扫描 ②Lux3D 生成原创装置 ③自动进场景并调位置大小 ④Agent 改方案 ⑤保存并生成可分享 3D 方案。
> 核查方式：**只读**代码与文档，未改源码、未 commit、未 push。代码证据标注 `文件:行`，不确定处显式标注。核查时刻 2026-11-04；部分文件正被并行任务修改，涉及处已注明。

---

## 0. 一句话结论

**西湖这批素材产不出「可编辑、可量尺寸」的真实场景（0/32 有可用坐标、无平移基线、无尺度、夜间曝光跨 16 倍）；而 Golden Path 眼下更硬的卡点不在素材，而在链路上的「生成与取回只能在本机开发代理跑」「生成物/扫描资产只存本机、云保存被硬拦」「场地导入没有入口」「标定与落地能力写了但没接到界面」。第一批动作应是拆掉前两处本机依赖并暴露标定/落地，而不是继续调重建参数。**

---

## 1. 支撑事实（从 01/02 压缩，只留决定性项）

**素材上限**

- 有效唯一静态图 24 张，全部同一晚 249 秒内、同一机位、云台原地旋转；yaw 仅覆盖 102.6°，无平移基线。SfM/3DGS 都会在初始化阶段退化（01 §0、§4.3）。
- 0/32 文件有可用坐标：26 张 `GpsStatus="Invalid"`、经纬度为 0；6 段视频无任何位置标签（01 §2.1）。
- 无 GCP、无测距、无 IMU/点云，产物无法落到米制（01 §6）。
- 因此**现有素材最多交付**：一张全景氛围贴图 + 一份误差 10%–20% 的人工体块草图；不能出闭合 mesh、不能出可漫游 splat、不能落图（01 §8）。

**重采门槛（若要做真实场景）**

- ≥200 张、3 层环绕 + 俯视、相邻重叠 70–80%、必须靠平移产生视差、2–3 个尺度基准、白天/均匀光、清场；最低可交付约 120–180 张（01 §6、§10）。
- 节奏：许可 → 样片采集 → Aholo 与本地 gsplat 同批 A/B → 定路线 → 50–100 m 分块批量（02 §5.5）。
- 已知外部不确定性：Aholo 户外为 Beta、定价未公开；西湖属管制空域，需提前申请与属地报备（02 §1.2、§3.6、§6.3）。

**技术路线（只作为 Golden Path 的实现手段）**

- 推荐组合：3DGS 做观感层（`.spz` 优先），轻量 GLB 做结构/落地基准，水面与天空在引擎里补（02 §0.1）。
- 编辑器现状：GLB 上限 10 MB 且必须自包含；splat 只做背景层，**不参与拾取/落地**（02 §1.1、§1.3）。
- Aholo 室内实测约 15 分钟出 SPZ/PLY/pano；户外质量未验证（02 §1.2）。

> 结论：素材核查的结论没有反转，但它**不挡 Golden Path 的前五个工程卡点**——那些卡点用现成扫描或演示场景就能复现和修复。重采是"接真实西湖案例"的前置，不是"跑通链路"的前置。

---

## 2. Golden Path 五步差距地图

### ① 选真实场景 / 导入扫描

| 项 | 结论 |
| --- | --- |
| 现状 | 三条入口都不完整：空白场地、已有云项目、平面图→结构重建（平面图上传 + 两点标尺，`reconstruction-panel.tsx:181-187,296`）。3DGS 扫描能挂进编辑器（`room-organizer.tsx:1836-1841`），但入口在 Lux3D 直连面板内，且依赖本机代理。新项目默认自动挂「演示宴会厅」高斯（`room-organizer.tsx:1261-1265`）。 |
| 卡在哪 | 普通用户没有「选一个真实场地就开始」的入口；场地选择器明确写着「模板与导入在下一期」（`venue-picker.tsx:6`）；采集规划只产出工单，不导入点云（`site-capture.ts:139`）。 |
| 证据 | 场地选择器只有 blank / project / new 三种选择（`venue-picker.tsx:17,121-131`）；扫描入口在 `lux3d-direct-test.tsx:24-39`；默认环境是演示资产（`room-organizer.tsx:1261-1265`）。 |
| 负责模块 | `panels/venue-picker.tsx`、`room-organizer.tsx`（环境默认与环境选择）、`panels/lux3d-direct-test.tsx`、`lib/site-capture.ts` |
| 最小修复 | 场地卡新增「选已扫描场地 / 导入扫描」：列出已发布 `.spz`（带 meters）作为可选场地，选中即 `startSplat`；无扫描时保留「地图圈画 + 采集单」路径。验收：新用户 3 次点击内进入真实场地，无需先建空白项目。 |

### ② Lux3D 生成原创装置

| 项 | 结论 |
| --- | --- |
| 现状 | 文生 / 图生两条提交入口已存在，任务号存本地，轮询 `/task` 取回 `.glb` 并直接入库，不再要求「下载→转换→上传」（`material-generate.ts:121-135`、`lux3d-import.ts:58-79`）。生成约 3–5 分钟（`aholo-guide-card.tsx:10`）。 |
| 卡在哪 | **只在 development + 127.0.0.1/localhost 才启用**（`aholo-assets.ts:4-15`）；否则只提示、不提交（`material-generate.ts:103-104`），取回也直接失败（`lux3d-import.ts:94-97`）。普通用户与生产环境完全不可用，且「起代理脚本」本身就是人工步骤。 |
| 证据 | `isLux3dLocalProxy()` 要求 `NODE_ENV === 'development'`（`aholo-assets.ts:14`）；错误文案要求用户运行 `node tools/aholo/lux3d-dev-proxy.mjs`（`lux3d-import.ts:65`）。 |
| 负责模块 | `lib/material-generate.ts`、`lib/lux3d-import.ts`、`lib/aholo-assets.ts`、`tools/aholo/lux3d-dev-proxy.mjs` |
| 最小修复 | 把代理端点升级为服务端托管的中转 API（保留本地开关做开发），密钥留在服务端；前端只依赖一个 base URL。验收：生产构建下「提交 → 取回 → 入库」闭环成功，用户全程不碰终端。 |

### ③ 自动进场景并调位置大小

| 项 | 结论 |
| --- | --- |
| 现状 | GLB 入库前有统一归一化（单位/轴向/底面中心，`glb-normalize.ts:10-15`）；生成物可一键落画布（`room-organizer.tsx:2166`）；扫描挂载后按最长边等比缩放（`splat-preview.ts:88-91`），并把场地宽深校到高斯实测（`room-organizer.tsx:1842-1857`）。 |
| 卡在哪 | ①生成物**不会自动进场景**，仍要用户点「放入」；②缩放只认「最长边等比」，米制可信度未被验证；③标定比例、基准面、锚点、落地清单虽已实现，**但没有返回给调用方**，界面也无人消费（`use-splat-preview.ts:405-463` 有实现，`:490` 的 return 未包含；`calibration-hud.ts` 未挂载，仅声明 `hudRef` 于 `use-splat-preview.ts:143`）。 |
| 证据 | `use-splat-preview.ts` 的返回类型声明了 `calibrate/setGround/addAnchor/landingPlan`（`:122-130`），实际 return 未带（`:490`）——截至核查时刻接线未完成；splat「仅用于环境氛围展示，不参与布置与碰撞计算」（`aholo-guide-card.tsx:20`，02 §1.3）。 |
| 负责模块 | `three/splat-preview.ts`、`hooks/use-splat-preview.ts`、`three/calibration-hud.ts`、`room-organizer.tsx` |
| 最小修复 | 生成成功即自动落到场地中心并选中（失败降级为「放入」按钮）；把 `calibrate/setGround/landingPlan` 真正返回，并在空间面板给一行「比例校准」入口 + HUD 角标；验收：生成→出现在场景 ≤1 步；已知长度校准后误差 ≤2%；刷新后标定仍在；物件落地误差 ≤2 cm。 |

### ④ Agent 改方案

| 项 | 结论 |
| --- | --- |
| 现状 | 对话产出「候选方案」：整套重排（`agent-proposal.ts:323`）或按请求加件（`:479`）；确认前不写画布，确认后统一走 `onApply`，撤销历史保留（`agent-proposal.ts:16-26`、`agent-panel.tsx:970-1020`）；云端方案走 `applyPreview()`（`agent-panel.tsx:1043-1064`）。 |
| 卡在哪 | 只有「重出一版整套 / 加几件」，没有「把舞台左移 2 米」「这张桌放大 10%」这类**精确动词级编辑**；用户仍要自己拖拽，达不到「无需 3D 知识」。 |
| 证据 | 提案入口只有 `proposePlan`（整套）与 `proposeAddition`（新增）；reducer 具备 `moveItem/resizeItem`（`hooks/layout-reducer.ts:517-554`）但未被 Agent 调用。 |
| 负责模块 | `lib/agent-proposal.ts`、`panels/agent-panel.tsx`、`hooks/layout-reducer.ts` |
| 最小修复 | 增加两个动词级工具：`moveItem`（目标 + 方向 + 距离）与 `resizeItem`（目标 + 比例），仍经 `onApply` 落盘；验收：自然语言「舞台往左 2 米」位移误差 ≤5 cm、「放大 10%」尺寸误差 ≤2%，均可撤销。 |

### ⑤ 保存并生成可分享 3D 方案

| 项 | 结论 |
| --- | --- |
| 现状 | 云保存有严格适配与校验（`backend-adapter.ts:140-224`）；发布链接 `/view#token` 会用 `ScenePreview` 渲染三维并附物料清单（`app/view/page.tsx:8,53`）；发布按钮路径已通（`share-menu.tsx:132-143`）。评审链接 `/review` 是纯本机、只有清单（`review-share.ts:4-15`）。 |
| 卡在哪 | ①本地模型（Lux3D 产物 / 大面积扫描）没有云端 `assetId` 时**直接抛 `LOCAL_ASSET_NOT_UPLOADED` 阻断保存**（`backend-adapter.ts:170-172`）；②分享快照只含场景与云端模型，**不含 3DGS 环境**，`ScenePreview` 用纯色背景（`scene-preview.tsx:83`）——客户看到的不是「真实场景里的方案」。 |
| 证据 | 资产注册表只写 `localStorage` + 本机代理 URL（`aholo-assets.ts:23,87`）；`SharedSnapshot` 无 splat 字段（`lib/share-api.ts:32-46`）。 |
| 负责模块 | `lib/aholo-assets.ts`（资产上传）、`lib/backend-adapter.ts`、`lib/share-api.ts`、`app/view/page.tsx`、`components/business/scene-preview.tsx` |
| 最小修复 | 生成/扫描入库时同步上传云端资产并拿到 `assetId` 再进目录；分享快照增加环境 `.spz` 地址，由 `ScenePreview` 作为背景层加载。验收：换设备手机打开链接，能看到真实场景背景 + 布置方案，全程不依赖本机存储。 |

---

## 3. 排序：挡住 Golden Path 的 vs 不挡的

档位沿用四档：**A 这周能做完 / B 需要重采才能做 / C 需要外部算力或预算 / D 暂时不做**。

### 挡住 Golden Path（按依赖顺序）

| # | 问题 | 为什么挡 | 档位 | 通过标准 |
| --- | --- | --- | --- | --- |
| G1 | 生成/取回只在开发环境+本机代理可用 | 普通用户第一步生成就走不通 | **A** | 生产构建下提交→取回→入库闭环，用户不碰终端 |
| G2 | 资产只存本机，云保存被 `LOCAL_ASSET_NOT_UPLOADED` 拦 | 步骤③的产物进不了步骤⑤ | **A**（依赖 G1 的上传口令） | 生成物跨设备可打开，无本机依赖 |
| G3 | 场地选择没有「导入扫描/选真实场地」 | 用户进不了真实场景，只能白纸或演示厅 | **A**（真实数据另需 B） | 3 次点击进入真实场地；扫描数据由已有资产提供 |
| G4 | 标定/基准面/锚点/落地未暴露 | 「位置关系可靠」不成立，步骤③验收不过 | **A** | 已知长度误差 ≤2%、刷新保留、落地误差 ≤2 cm |
| G5 | 分享版缺真实环境（无 splat 背景） | 步骤⑤「可对客户展示」打折 | **A**（依赖 G2） | 手机打开看到真实背景 + 方案 |
| G6 | Agent 不能精确改单个物件 | 步骤④退化为「手动拖拽」 | **A** | 位移/缩放误差达标且可撤销 |
| G7 | 西湖真实案例素材不可用 + 空域/报备未确认 | 影响「真实西湖」而非链路本身 | **B + C** | 重采样片按 01 §10 达标；许可与报备落地 |

> 顺序建议：G1 → G2 → G4 → G3 → G5 → G6。G3/G5 可并行（前端改动不依赖 G1），G7 独立推进、不阻塞前六项。

### 不挡 Golden Path（可延后）

| # | 事项 | 判断 | 档位 |
| --- | --- | --- | --- |
| N1 | 西湖现有素材全景氛围贴图（01 §9.3 P0） | 只做氛围参考，不影响 10 分钟闭环 | **A**（成本低，但非必须） |
| N2 | 摄影测量闭合 mesh + Blender 精修（02 §5.4） | 仅在客户要求精确几何/可量面积时必要 | **B + C** |
| N3 | 西湖落图（真实经纬度） | 0 坐标，只能人工定点；不影响链路 | **B** |
| N4 | 家具级重建、点云拾取/布尔编辑 | 3DGS 本质不支持，编辑器也不依赖 | **D** |
| N5 | `/review` 评审链接上云 | `/view` 已能只读分享；评审是协作增强 | **D** |

---

## 4. 冲突与不确定

1. **01 文档内部数字不一致**：BLUF 写「54 秒视频」，但逐文件 `ffprobe` 台账合计约 **80.9 秒**（`01` §1.5）。**以台账为准**；BLUF 的 54 秒不可用于决策。
2. **03 号文档缺失**：`docs/recon-2026-11/` 目前只有 01、02。本文的「Agent 能力缺口」来自代码实测，不是既有结论；若 03 后续补上，需复核冲突。
3. **界面文案与实现的云/本机口径相反**：引导卡称「云端生成」（`aholo-guide-card.tsx:10,15`），实现却要求本机代理 + development（`aholo-assets.ts:14`）。对外表述**不可直接采信**，以代码为准；G1 修好后再统一文案。
4. **标定能力"有实现"与"已接线"的口径冲突**：`use-splat-preview.ts` 声明并实现了 `calibrate/setGround/addAnchor/landingPlan`，但截至核查时刻未在 return 中导出，且文件正被并行任务修改（两次读取间新增约 100 行）。本文按「未接线」记，**可信度中**；以验收实测为准。
5. **空域结论的证据强度被高估**：02 将「西湖不在适飞空域」标为高【A】，但其来源是 2026-07-28 征求意见反馈；「属地派出所报备」只有媒体口径（02 §6.1）。**结论方向可信，实操流程标待核实**，以最新通告为准。
6. **视频元数据的「没有」仅指现存文件**：视频已被第三方转码成 720p 并抹掉 DJI telemetry（01 §1.5），无法判断原始卡上是否存在位置数据；不要据此推断「拍摄时没定位」。
7. **Aholo 户外质量与计价未知**（02 §6.3）：G1/G2 修好后，真实场景能否达到演示质量仍未验证，需样片 A/B 后才能对外承诺。

---

## 5. 给非技术决策者的一段话（<300 字）

现在能做的：在空白场地上摆方案、用对话重排桌椅、把生成好的模型点一下放进场景、发布成手机可看的链接。缺的是普通用户能走通的一整条：直接选到真实场地、输入一句话生成装置、自动落位、尺寸可信、分享出去还能看到真实场景。这些环节目前都绑在开发机上：生成要用本机脚本，模型只存在这台电脑，扫描场景没有入口，量尺寸的校准也还没接到界面上。要花的力气：先做两件约一周的改造——把生成与取回搬到云端、把模型同步到云端；再把标定和落地接到界面。真正拍西湖场地还要另算：重新采集、空域许可和云端算力，属于第二阶段。

---

## 附录：关键证据索引

- 素材：[01-素材核查与采集缺口.md](file:///01-素材核查与采集缺口.md)；技术路线：[02-3D重建技术路线调研.md](file:///02-3D重建技术路线调研.md)
- 场地入口：[venue-picker.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/venue-picker.tsx#L6-L7)
- 默认演示环境：[room-organizer.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/room-organizer.tsx#L1261-L1265)
- 本机代理门槛：[aholo-assets.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/aholo-assets.ts#L4-L15)
- 生成取回：[lux3d-import.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/lux3d-import.ts#L94-L97)
- 标定未接线：[use-splat-preview.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/hooks/use-splat-preview.ts#L405-L490)
- 云保存硬拦：[backend-adapter.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/backend-adapter.ts#L170-L172)
- 分享无环境层：[scene-preview.tsx](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/business/scene-preview.tsx#L83)
- Agent 提案：[agent-proposal.ts](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/agent-proposal.ts#L323)
