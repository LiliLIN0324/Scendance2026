# HANDOFF.md — Scendance2026 跨会话交接

新会话第一句：

> 先读HANDOFF.md。

最后更新：2026-11-07。只维护这一份交接单，结束前更新顶部状态。后半部是历史记录，若与顶部冲突，以顶部及链接证据为准。

## 优先接力 · 西湖新素材与地图空间体验

2026-11-07 交接。用户把地图和空间列为这一轮重点，体验对标高德。用这批实拍做一个可验收的「找到地点 → 看懂周边与范围 → 进入实景空间 → 放置物件 → 返回地图」案例。地图交互承接场地定位和空间设计。先跑一处能验证的样板，再扩展多个点位。

- **原包**：原仓库根目录的 `11.6.zip` 已迁至 [D 盘归档](/D:/Scendance2026/archives/11.6.zip)（22,596,012,979 B）。仓库根目录和 Downloads 的副本均在确认与 D 盘归档的 SHA-256 一致后移除，校验值 `89b7913cb823aa0920b2b51a4bebe30ee8b94cca2782dc56a12c18e581489c7b6`。DJI 文件名显示拍摄日期 2026-11-06，时间 15:44:03–17:23:37，编号 0219–0254。
- **素材位置**：[D 盘西湖原片](/D:/Scendance2026/scene-3d-outdoor/xihu-2026-11-06)。D 盘路径用于本机采集工作，旧批次继续使用仓库的 `scene-3d-outdoor/`。同名 MP4 是原片，LRF 是预览代理。
- **验收状态**：已解压并通过 ZIP CRC 和逐文件大小校验，共 72 个文件、22,950,463,068 B（36 MP4 + 36 LRF）。
- **杭州城市地图调研**：参考 Isometric SF，先用西湖东岸做可定位、可拼接的等距像素地图小样，验证后在独立仓库持续生产瓦片，并通过场地锚点接入 Scendance。派发 HZ-01 至 HZ-05 见 [调研与验收](docs/plans/hangzhou-isometric-map-research.md)。
- **接力原则**：先读 [COLLAB.md](COLLAB.md) 和 [地图锚点方案](docs/20-场地资产地理底图提案.md)。素材、剪辑、临时重建产物放 D 盘，Git 只提交明确范围内的代码、文档或经过选择的项目资产。现有地图、LOD 和相机可能有未提交改动，先核对再分工。

### 素材与实景处理

| 卡片 | 执行步骤 | 验收 |
| --- | --- | --- |
| XH-01 · P0 素材分段 | 按拍摄时间快速预览 LRF，记录每段的内容、时长、清晰度、运动轨迹、遮挡与候选地标。同名 MP4/LRF 视为同一段。检查是否存在可信 GPS 或轨迹元数据。 | 形成 36 段清单，包含原片文件名、时间、地点线索、定位来源、置信度和用途。地点不确定时标「待核对」。先挑 2–3 段连续、稳定、有多视角的候选。 |
| XH-02 · P0 单段重建 | 从 XH-01 选一段原始 MP4。先用低成本代理或抽帧检查重叠、曝光与运动，再按选定范围准备短片。复用仓库已有 AHOLO 视频链路，在有本次素材上传和额度授权时提交一单。 | 记录输入文件及时间段、方法、档位、任务号、终态、错误原文和产物。成功后实际读取 SPZ/PLY 并截图。失败则用同一份证据说明是上传、重建还是产物读取失败。 |
| XH-03 · P0 实景定位 | 给成功资产匹配可辨认的岸线、建筑角点或入口，优先使用可信坐标和已知长度。记录定位、北向、比例与来源，按现有资产入口挂入场景。 | 用至少两个可辨认控制点对齐实景与地图，报告残差。再用一处独立已知距离核对尺度。缺可靠参照时仅标「示意定位」，留给用户校准。依赖 XH-02。 |

### 地图与空间实现

| 卡片 | 执行步骤 | 验收 |
| --- | --- | --- |
| MAP-01 · P0 高德式找地点 | 复用现有高德适配和地图入口，检查输入联想、POI 地址/区县、结果落点、缩放至场地、明确确认定位。覆盖桌面键盘和手机触控。 | 输入「西湖」及一个具体西湖地标，结果可区分同名地点。连续搜索时旧请求不会覆盖新结果；预览地点、取消搜索和确认写入锚点有明确区别。空结果和服务失败可恢复。 |
| MAP-02 · P0 看懂整个区域 | 优先核对现有整景区底图、岸线、水面、路网与比例尺。把「看全西湖」「回到场地」「北向」做成可复验的操作。 | 桌面和手机都能看清范围、当前场地落点和缩放后的上下文。保留地图来源及署名。反复切换底图和相机视角，实景锚点位置保持稳定。 |
| MAP-03 · P0 地图到实景 | 先实现一条可靠链路：全湖概览显示轻量场地点位，选场地后定位到范围，近景加载或细化点云，进入空间后仍能回到概览。沿用现有相机与 LOD 实现，先测再调阈值。 | 录屏覆盖概览→场地→实景→返回。概览阶段检查网络与解码开销；在加载阈值附近往返，检查重复请求、资源泄漏和画面闪烁。点云失败时仍可看到点位与范围。依赖 MAP-02。 |
| MAP-04 · P0 空间尺度和状态 | 统一使用 `sceneAnchor` 表达场地与地图的变换。区分采集坐标与高德 GCJ-02，在已有坐标边界处理转换，核对现有米制几何和北向。场景内的可测空间和点云分层。 | 有坐标的场景保存重开后落点、方向和物件尺寸一致。移动地图相机、切底图不会移动已摆物件。无坐标场地仍可在米制网格上摆放。记录同一地标的误差与来源。依赖 MAP-01/02，真实样片使用 XH-03。 |
| MAP-05 · P1 空间工作流验收 | 在西湖样板里跑「搜地点 → 确认场地 → 进实景 → 量一处已知长度 → 放一件已知尺寸物件 → 保存重开 → 回到概览」。比对高德同一地点的搜索、落点和比例尺体验。 | 桌面和手机各一轮，回填设备、网络、首屏、实景就绪时间、请求量、对齐误差与最明显的三个操作问题。证据包括全湖、近景、实景三个画面。依赖 MAP-01 至 MAP-04 及 XH-03。 |

**派发顺序**：XH-01 与 MAP-01/02 可以分开领。拿到素材候选后推进 XH-02。用仓库现有茶亭资产提前走查 MAP-03/04，换入新批次资产后再做 MAP-05。每轮在本节回填卡片状态、证据路径和阻塞条件。

> **卡片回填（2026-11-07，ZCode 会话）**：**XH-01 ✅**——36 段全量清单落 [docs/33](docs/33-西湖新素材分段清单.md)（元数据 `D:\…\xihu-2026-11-06\_catalog\manifest.json` + 6 张抽帧拼图 `sheets/`；4 处换场断档、6 个地点群、强地标：慕才亭/玉带晴虹匾额）。**XH-02 候选已定**：0233（174s 园林走拍，首选）→ 0234（同园连续）→ 0220（65s 湖面+候船亭）；提交 AHOLO 仍等用户对「本批上传+额度」授权（卡片原文条件），未动上传。GPS：各段有 DJI `djmd` 遥测轨但未解析，机器无 exiftool；地点置信度逐段标注，○=待核对。**MAP-01 代码侧已执行**（联想+竞态守卫+取消/键盘+测试 19 例全绿）、**MAP-02**（署名常驻+矢量线宽测试）、**MAP-04**（GCJ-02↔WGS-84 纯工具+边界约定），详见「已完成与证据」首行。MAP-01/02 的真机 UI 实测（触控、真联想结果）归 SC-03 走查一并看。
>
> **卡片回填（2026-11-07 四轮，ZCode 会话）**：**MAP-03 ✅（代码+浏览器走查）**——LOD 门控扩到任意调研底图、POI 视距点位直推、点位层/POI 挂载竞态修复、「回概览」旧焦点闭包修复；浏览器 E2E 实录概览（spz 0 请求）→点场地点位→推近翻转→回概览横幅恢复，全链路通过（证据链见「已完成与证据」首行）。**MAP-04 收尾 ✅**——`SceneAnchor.source/accuracyM` 元数据、`AholoAssetGeo` 扩 `telemetry`（WGS-84，喂图前自动过 `wgs84ToGcj02`）+ `headingDeg`（锚点朝向通路，现无生产者为死分支）、圈画锚点补 `source:'picker'`；schema 放行+往返测试。**MAP-05 待 XH-02 新资产**（真样片对齐误差、手机走查）。剩余缺口：多 geo 场地互切时新场地落位用 stride 偏移不落 geo 位置（v3.3.0 并排协作模式的既有设计，XH 批次真有第二个 geo 场地时再收口）；LOD 阈值 100/200 m 未按真机手感调（先测再调的「测」归 MAP-05）。

高德参考：[输入提示与 POI 搜索](https://lbs.amap.com/api/javascript-api-v2/guide/services/autocomplete) · [地图坐标与基础类型](https://lbs.amap.com/api/javascript-api-v2/guide/abc/basetype) · [比例尺、测距与缩放插件](https://lbs.amap.com/api/javascript-api-v2/guide/abc/plugins)。

## 优先接力 · AHOLO 绑骨人物库与多人实景漫游

用户希望在西湖等真实场地里看到**多个人物沿场地路线走动**，尤其是**中国古风、汉服旅拍和西湖街拍风**。允许用已绑骨的模板人物先跑通，也要逐步补齐有辨识度的角色。优先验证 AHOLO 能力，让同一条生产链覆盖参考图、人物 GLB、自动绑骨、动作重定向，以及实拍视频重建场地。

**建议首批 6 人**，先交付 1 名古风样板和 2 名模板人物，实景三人同场通过后扩到 6 人。数量是首轮派发目标。

| 角色 | 造型与用途 |
| --- | --- |
| 古风样板 | 西湖汉服旅拍，浅色对襟或交领上衣、青绿裙、轻便盘发。全身轮廓清楚，先用窄袖、离地裙摆和能分辨双脚的造型。 |
| 古风街拍 | 宋制风格、米白与黛蓝，短外衫、明晰的腰线，适合湖边行走和停步取景。 |
| 新中式游客 | 盘扣短上衣、深色长裤、低调发饰。让轮廓和配色与其他角色明显不同。 |
| 古风男游客 | 窄袖短打或改良长衫，靛色或墨绿色，衣摆留出步幅。 |
| 模板游客 A | 复用仓库已绑骨的人物，做浅色休闲服。用于快速验证摆放、缩放和行走。 |
| 模板游客 B | 复用相同骨架体系，调整体型、服装与色板。用于多人共享资源、独立动作和性能对照。 |

街拍感用服饰、配色、发型和镜头表现。参考图用原创角色，或使用获授权的图片。绑骨输入以中性站姿为准，采用 A/T Pose，手臂和躯干留间隙，双腿可区分。团扇、油纸伞、相机、飘带等在动作验收后再做附件。

| 卡片 | 执行步骤 | 验收与依赖 |
| --- | --- | --- |
| PEOPLE-01 · P0 模板三人测试 | 先核对现有 `people-model.ts`、`builders-people.ts`、`glb-assets.ts` 和第一人称 `use-walkthrough.ts`。用已绑骨模板在已有西湖茶亭场景测试三个独立实例，逐一确认动画实际生效。 | 三人能独立开始、暂停、换动作和移除。对同一个 GLB 验证独立骨架、贴地比例和资源复用，删除其中一人后其余仍正常。 |
| PEOPLE-02 · P0 AHOLO 古风样板 | 为古风样板做全身中性站姿参考。优先试 AHOLO 多模态生图、单图四视图、G1 或 G1-Turbo 图生 3D。拿到 GLB 后检查四肢分离、裙摆、正背一致和缺面。 | 保存参考图、请求参数、任务号、来源及 GLB。四视图的衣装、朝向和角色一致性不足时，先修参考或用一张合格参考重做小样。 |
| PEOPLE-03 · P0 AHOLO 自动绑骨与动作 | 使用 AHOLO 数字人自动绑骨，把通过检查的 rigged GLB 送去动作重定向，首轮验证 `Idle_Loop`、`Walk_Loop`。后续再按服务当前动作目录挑停步观景、转身、打招呼或拍照动作。 | GLB 有有效 skin、关节权重和动画轨道。浏览器实际播放时，角色能走且双脚、袖口、裙摆无明显滑步和穿插。若 `MODEL_NOT_RIGGABLE`，记录原文，先调整姿势或服装，等量替换输入再复测。依赖 PEOPLE-02。 |
| PEOPLE-04 · P0 实景路线和跟随视角 | 在茶亭样板用米制平面画两条短路线，每条 2–4 个路点，配合现有相机和碰撞数据。先支持模板人物沿路线停走、转向和循环；再支持近处跟拍一人，以及回到地图概览。 | 人物走过的距离与路线相符。连续跑两圈，无跳点、明显悬空、越界或穿过已标注障碍。行走速度匹配步幅，记录动画根位移与场景移动的处理方式。近景退出后视角、相机控制和资源状态正确。依赖 PEOPLE-01，可与 PEOPLE-02/03 并行。 |
| PEOPLE-05 · P1 扩充六人素材库 | 古风样板通过后再跑其他角色。优先复用已通过的骨架与动作集，用 AHOLO 生图或材质迁移做配色和服装变化，再筛选真正需要重新建模的角色。 | 6 个可选人物条目有缩略图、风格、身高、文件大小、动作列表、任务或授权来源。模板、换装变体与新模型明确标识。分批生成，保存每阶段结果，避免重复提交已完成任务。依赖 PEOPLE-01/03。 |
| PEOPLE-06 · P1 西湖多人验收 | 将 AHOLO 古风人物与模板人物一起放进实景，先跑 3 人，随后测 6 人。覆盖站立、行走、跟随、换场、保存重开，以及需要交付的预览路径。 | 同场可看出至少一名古风角色与模板角色；各自路线和速度可复现，换场后无遗留动画。记录桌面和手机帧时间、加载体积及峰值资源情况，附古风样板近景和多人实景录屏。依赖 PEOPLE-03/04，6 人验收依赖 PEOPLE-05。 |

**AHOLO 串联顺序**：场地用本页 XH-01～03 的视频重建路线；人物走「参考图 → 图生 3D → 自动绑骨 → 动作重定向 → 实景验收」。人物素材库先以已有茶亭场景和模板解除工程依赖，西湖新场地通过定位后再接入。批量前核对实际接口权限、素材使用权和任务额度，记录任务 ID、终态与资产路径。

**空间实现边界**：第一人称漫游已有围栏和几何碰撞逻辑，人物路线先从已标定的可走面和障碍读取。AHOLO 3DGS 提供实景外观，人物脚底和通行依据仍由米制可走面决定。已有抱臂雕塑的小鞠躬样件沿用原用途，本节的巡游对象是新人物与模板角色。

**下一次派发**：先领 PEOPLE-01 或 PEOPLE-02。两者可并行。卡片回填「基线 / AHOLO 任务号和终态 / GLB 与动作 / 场景和路线 / 截图或录屏 / 下一步」。

> **卡片回填（2026-11-07 五轮，ZCode 会话）**：**PEOPLE-01/04 实现已由并行会话落在共享树上（未提交，本会话零改动）**，本会话做全量核对与验证：
> - **改动范围**：`lib/types.ts`+`lib/schema.ts`（`PersonAction`/`personPaused`/`WalkRoute` + 校验白名单与修复器）、新建 `lib/person-route.ts`（纯几何路线引擎：闭环/折返、停留、平滑转向、碰撞滑行、界内夹取、里程表，12 例测试）、新建 `three/people-anim.ts`（按 item id 存续的动画注册表：重建续走、暂停冻结、脱离摘除、程序化兜底，8 例测试含真实 people.glb 回读）、`builders-people.ts`（绑骨/程序化双路注册）、`use-scene-effects.ts`（行走上下文/阴影刷新入口/路线可视化折线+路点）、`use-three-scene.ts`（渲染循环每帧 `advancePeopleAnimations`）、`walk-collision.ts`（带路线人物不再生成静态碰撞盒）、`item-context-popover.tsx`（人物动画三动作+暂停恢复+行走路线：画布布点/撤销/清除/环形折返/步速停留 UI）、`room-organizer.tsx`（路线布点模式：`floorPickOnly` 扩展 + `handleEmptyClick` 草稿→提交接线 + Esc/失焦/取消选中收摊）。
> - **验证**：定向 5 套件 195 例全绿（person-route 12 / people-anim 8 / schema 109 / walk-collision 31 / item-context-popover 35）；`npx tsc --noEmit` 0 错误；`NEXT_DIST_DIR=.next-ci npm run build` exit 0（14 路由）；全量 vitest **4881 过 / 37 失败 = 既有 11 个漂移文件**（project-review-library、agent-preset-flow 两个波动项复跑即过），无一例本轮引入。
> - **浏览器探针走查（dev 3030）**：注入三人布局（巡游/交谈/静态）→ `window.__peopleWalkStates`（dev 构建探针）返回注册表恰两条目：walker（`hasFollower:true`、`routePoints:4`、`attached:true`）+ talker，静态客正确不入表——**schema→布局加载→builder→注册表接线全通**。**行走画面未验成**：IAB 标签被 Chromium 遮挡节流、rAF 完全停摆（`advanceCalls:0`——该计数器是 `advancePeopleAnimations` 第一行，0 调用=渲染 tick 从未跑；绘制缓冲停在 300×150 默认值；置前台/录屏强制出帧均救不回）。**环境问题非代码缺陷**，并行会话 08:03 加的 advanceCalls/stepCalls 探针正是排查工具。
> - **PEOPLE-01/04 剩余验收（归在途会话收尾，勿代提交）**：前景窗口复测三人独立（暂停/恢复/换动作/移除其一其余正常）、画布点击画路线、里程对账屏上可见；COLLAB 待协商表登记 room-organizer.tsx 两处 hunk 后提交。

来源：[AHOLO 能力总览](https://labs.aholo.ai/api-docs/intro) · [自动绑骨与动作重定向](https://labs.aholo.ai/api-docs/release-notes) · [官方 SDK 动作示例](https://labs.aholo.ai/api-docs/en/sdk/typescript)。

## 当前任务

- **产品主线**：幕景 Scendance 是活动场地方案工作台。用已有场地或尺寸平面完成圈区、出方案、复核、客户确认和执行交接。近期产品评估建议先验证一个真实活动的交付闭环。
- **用户已授权的待办**：在 AHOLO 官方实景重建工作台，用同一批 63 张茶室照片做一次网页对照。记录上传、创建和最终状态的页面原文、任务号与截图。
- **仓库基线**：2026-11-07 五轮：树上有一批**并行会话在途未提交的 PEOPLE-01/04 实现**（人物动作/行走路线全链路），本会话已做全量验证（测试/tsc/build 全绿）与浏览器探针走查，见「优先接力 · AHOLO 绑骨人物库」五轮回填块。四轮基线（MAP-03/04）已在 tag `v3.7.0`（7061b85，已推远端）。并行会话仍在活跃改树（08:15 仍在写 people-anim.ts 探针），**任何提交前先重查 `git status -sb` 和 [COLLAB.md](COLLAB.md)，PEOPLE 在途文件勿代提交**。
- **任务派发**：见 [Scendance 需求清单](docs/25-Scendance需求清单.md)。按依赖每次领一张，优先验证一单从方案到交付的闭环。

## 已完成与证据

| 工作 | 当前结果 |
| --- | --- |
| MAP-03 地图到实景 + MAP-04 收尾（2026-11-07 四轮，ZCode 会话） | **MAP-03**：① LOD 门控 `splatLodEnabled` 从「仅整景区 presetId」扩到「有任意调研底图+有点云环境」（room-organizer L1533 一行），scanAssetId 自动铺图/地名定位的概览同样不解码点云；② `applyRealVenue` 在视距 LOD=poi 时立即 `zoomToVenue`（原实现等 splat ready 但 poi 态 splat 被 defer 永不 ready——点位点击死等不推近，浏览器走查坐实后修复）；③ `SceneGeoDots`/`SplatLodMarker` 加 500ms 心跳重投影（走查实测：初次 update 跑在相机取景落定前、落定帧无 change 事件，点位永不渲染；心跳 + 值没变不 setState 双保险）；④ 新增 `fitOverviewAfterFocusClear`（ref+rAF）：「底图 chip 回概览」同步调 `fitToRoom` 读到旧焦点闭包、取景停在场地框，chip 与底图重置 effect 两处改走它。**浏览器 E2E 实录**（dev 3030+mock 3099，注入带 geo 样例场地驱动）：概览 spz **0 请求**（网络/解码开销=0）→ 点场地点位 → 相机推近 + LOD 翻转横幅消失 → 点云 404 时点位/底图/壳体仍在 → chip 回概览 9.1 km 横幅恢复；截图存于会话 artifacts（`C:\Users\13266\.zcode\cli\artifacts\…\call_*-tool-result-*.png` 四张）。**MAP-04**：`SceneAnchor` 加 `source`（picker/manual/lookup/asset-geo/preset 白名单）+`accuracyM`（≥0 可选，不编数字）；`AholoAssetGeo` 扩 `telemetry`（WGS-84 遥测预留，scanAssetId 铺图前自动过 `wgs84ToGcj02`，现网全是 GCJ-02 行为零变化）+`headingDeg`（锚点朝向通路；「壳体平面图上方=采集朝向」的语义假设未经真资产核验，校准归 MAP-05）；`createVenueFromPick`/`ensureSatelliteGround` 锚点补 `source:'picker'`；schema 校验放行+白名单防扩散，存档往返测试 1 例、splat-lod 状态机测试 9 例（新建）、scene-geo-dots 挂载测试 4 例（新建）。**验证**：定向 16 套件 279 例全绿；`npx tsc --noEmit` 0 错误；`NEXT_DIST_DIR=.next-ci npm run build` exit 0。COLLAB 待协商表已登记（独占区四处 hunk + amap-venue 两处）。 |
| MAP-01/02/04 地图空间缺口执行 + XH-01 素材清单（2026-11-07 三轮，ZCode） | **MAP-01 找地点**：`amap-venue-picker.tsx` 补齐三件——① 输入联想（`AMap.AutoComplete` 进插件表 + 250ms 防抖 + 下拉 `role=listbox`，区划/地址区分同名地点，无坐标 tip 转 POI 搜索不出假坐标）；② 竞态守卫（搜索与联想各自 seq 序号，慢的旧响应不覆盖新结果；`search(keywordOverride)` 支持 tip 转搜）；③ 取消/键盘（「清空搜索」按钮、Escape 收联想、↓/↑/Enter 导航；status 加 `role=status` 并把「已定位」改为「已定位预览」，文案明示写入锚点只发生在「生成户外场地」——预览/取消/确认三态分清）。**MAP-02 看懂区域**：`geo-basemap-input.tsx` 加常驻署名（动态底图「底图 © 高德地图」、整景区「底图 © 高德地图 · 范围线/水面 © OpenStreetMap 贡献者」，`data-testid=geo-basemap-attribution`）；新建 `three/research-overlays.test.ts` 钉线宽公式（clamp 1–8px、1000m≈4.68px 回归钉、单调性）。**MAP-04 空间尺度**：新建 `lib/geo-coords.ts`（GCJ-02↔WGS-84 公开拟合算法，`wgs84ToGcj02`/`gcj02ToWgs84` 迭代收敛 <1e-9°，境外原样返回）+ 5 例测试；**不假接线**——现资产 geo 只有 picker/lookup（本身即 GCJ-02），真正 WGS-84 边界在 `room-organizer.tsx:2548`（scanAssetId 自动铺图直喂 `asset.geo`），已在 `lib/aholo-assets.ts` 的 `AholoAssetGeo` 类型注释写死约定「EXIF/遥测来源必须先过 wgs84ToGcj02」，接线等有 WGS-84 生产者再动独占区。**XH-01**：36 段清单落 [docs/33](docs/33-西湖新素材分段清单.md)（ffprobe 全量 + 抽帧拼图判读；候选 0233/0234/0220；djmd 遥测未解析如实标注）。**docs/49→docs/19 注释勘误**：agent-panel ×2、room-organizer ×3（仅注释，COLLAB 已登记）、docs/23 ×1。**验证**：定向 6 套件 19+53 全绿（新增 geo-coords 5 / research-overlays 4 / amap-venue-picker 5，geo-basemap-input 5 含署名 2 例，amap-venue 22、scene-anchor 13、agent-panel 53 均绿）；scendance-workspace 8 失败=HANDOFF 已记载的历史漂移（数量一致非本轮引入）；`npx tsc --noEmit` 0 错误；`NEXT_DIST_DIR=.next-ci npm run build` exit 0（14 条路由）。 |
| SC-19 §五.4 必留通道输入补齐（2026-11-07 深夜二轮，SC-20 输入侧） | docs/32 §五.4/补测 8 已回填 ✅，docs/32 状态改「§五 1~6 全部执行完毕」。**① reserved keep-out 区型**：`ZoneSemanticType` + `'reserved'`（标签「预留区」，预留区/消防疏散共用），画布区类型条经 ZONE_SEMANTIC_LABELS 自动多出第 6 钮；`planZones` 对 reserved 不摆家具也不进 skipped（留空是语义本身），其余区家具压进必留区（内缩 0.02m 核心）→ hard `KEEP_OUT_INTRUDED`（`evaluateKeepOut`，按区聚合点名件数，扣 -3/条）。**② route 折线参与评分**：`evaluateRouteClear` 把 route 按 `ROUTE_CORRIDOR_WIDTH_M=1.2m` 展宽走廊，线段-矩形距离（Liang-Barsky 相交 + 端点/角点最短距离）< 半宽−容差 → hard `ROUTE_BLOCKED`（扣 -3/条）；官方 1.2m 块间走道居中走线不误杀。**③ 兜底封堵**：`planZones` 无 zoneType 不再兜底成圆桌——落 skipped「没选类型」（docs/32 S1③ 的「注入区被摆满 3 桌 24 椅」关闭）。**④ 额外接线缺口修复**：room-organizer 原来只把 zone 标注传给 `generateScoredPlans`，门/动线在 UI 边界被丢弃——**门弧检查与 assurance=verified 在产品里从未激活过**；现传全量 draft 标注（各消费端按 kind 过滤），画真门后产品路径出 verified、DOOR_UNKNOWN 消失、DOOR_SWEEP_BLOCKED 可判 hard。room-organizer.tsx 三处 hunk 已按 COLLAB 纪律登记待 Qoder 复核；附带入库 brief-agent 的标签映射改用 ZONE_SEMANTIC_LABELS（reserved 进枚举后的 TS 收口）。**验证**：定向 18 套件 288 例全绿（anti 23 含 SC-20 describe 四例、flow-constraints 22 含新单元 6 例、plan-approve 35、brief-agent/agent-panel 76）；`npx tsc --noEmit` 0 错误；`NEXT_DIST_DIR=.next-ci npm run build` exit 0（14 条路由）。UI 走查（画预留区/动线/真门看徽标与横幅）归 SC-03。 |
| SC-19 修复卡执行（2026-11-07 深夜二轮，5 项修复 + 回归网落地） | docs/32 §五清单执行回填（`docs/32-SC19-容量边界复验.md` 状态已改「复验完成」）：**① targetCapacity 接线**——新增 `panels/brief-headcount-store.ts` 模块镜像（与 agent-chat-store 同款模式），creative-studio 按「非脚手架」谓词（与右栏 formBrief 判定同源，脚手架默认 24 不算说过的人数）镜像 `brief.guests`，room-organizer `targetCapacityForScoring` 传入 `generateScoredPlans`，docs/27 B4 超容量话术在真实 UI 生效；COLLAB 待协商表已登记。**② G5 圆桌**——TABLE_DIAMETER 1.2→1.8（与 catalog 同步）、CHAIR_RING_RADIUS 0.9→1.22（同时满足 8 椅弦长 ≥0.9 与椅不进桌面）、pitch ≥ 2×环半径+阈值+0.1 舍入余量、zone 内缩含整圈椅子（下限 1.9→3.6m）；**执行中发现第三层根因**：45° 斜向环椅的轴对齐 AABB 角戳进自家圆桌包围盒（径向 1.22 够远但逐轴 dx=dz≈0.86<1.145）→ 新增 `isRingChairOfTable` 共享判定（ownerTableId 配对+径向 ≥ 桌半径+椅半宽−容差的**径向自守卫**，环半径改小豁免自动失效），wall 退距层与 detectFurnitureOverlap 双侧接入，wall 退距不再吞斜椅；丢弃语义保留但 reason 分两种事实（真内移→「贴墙放不下」/没挪就撞→「位置压住」）。**③ G7 rest**——`rowsRest` 对坐距直接 import `AISLE_CLEARANCE_THRESHOLD_M`（单一真相），rest 最小深度动态化 2.0→2.3。**④ G1**——plan-card 版行徽标（INFEASIBLE→⛔ 不可行 / INSUFFICIENT_INPUT→⚠ 缺尺寸未核验）、draft_unverified 出「门未确认，待核验草案」小字、REC=null 出「三版都有硬冲突」横幅+去重硬冲突清单。**⑤ 文案**——skipped 计数「{N} 个区被跳过」→「{N} 项被跳过」（skipped 混含整块区与单件，「项」对两种都诚实）；圆桌超容量降容行带「圆桌区按当前配方一区最多 3 桌 × 8 椅」。**回归网**：anti 新增 SC-19 圆桌 e2e 两例（16×10 in 19×15 → REC 可行 24 座、装不下 250、降到约 20=floor(cap/10)×10）+ S1② rest 带不再错杀整版；plan-approve.test 新增环几何回归 3 例；新建 plan-card.react.test 5 例、brief-headcount-store.test 3 例。**验证**：定向 12 套件全绿；`npx tsc --noEmit` 0 错误；`NEXT_DIST_DIR=.next-ci npm run build` exit 0（14 条路由）；全量 4819 过/38 失败（= 11 个已定性漂移文件 + agent-preset-flow 1 项，后者与本轮改动无 import 路径交集，属 jsdom/GLTF 环境类，见「卡住的问题」）。 |
| --- | --- |
| Round-2 派卡（2026-11-07 深夜，六卡） | 均为「待核对·已产出待复核」，落在 docs/27~32：**SC-02** 首单需求卡（Hall D5 演练；用例 A 120 人课桌 A1~A12 + 用例 B 250 人超容 B1~B6；基准 18/18 绿）；**SC-34** 价格口径对照（490/990/2990 分 vs 文档 999/2997/9990 两套账复核成立；**免费额度代码为零**；**退款有文案无实现**；9 项待拍板）；**SC-25** 重建样本归档（四组字节级回读；C1~C14 已证 + U1~U8 未知；茶室失败原因仍未知）；**SC-04** 场地输入核对（5 处已知尺寸自动化复测全绿；比例/门/不可占确认状态有 UI；缺口 G1/G3/G5）；**SC-05** 保存恢复核对（四验收点成立，304 用例全过；缺口：本地方案不跨设备无提示、缺资产无集中台账）；**SC-19** 容量边界复验（142/142 绿+探针实测：**圆桌路径全灭**、**targetCapacity 未接线 UI（B4 永不触发）**、未知门不假通过多层背书、新登记 **G7** rest 区自产 INFEASIBLE）。 |
| 浏览器 E2E 冒烟（2026-11-07 深夜，HEAD 代码） | dev 3030（`NEXT_DIST_DIR=.next-dev-z`）+ mock 3099：/editor 正常加载；点「整景区」后西湖卫星底图铺开、**景区范围线+水面叠加渲染**、「World 高斯空间 · 宴会厅 A · 9.1 km · 近到 100 m 显示点云」**视距 LOD 横幅真实生效**（远距点云延后挂载）。7f4209c/ed003b0/schema 修复全链路在真页面可用。SC-03 全量走查未做：并行会话在同树活跃改前端，走查结果无法归因 HEAD；docs/30/31/32 交接注记已备齐，宜专门时间窗做。 |
| 在途改动按主题收口（2026-11-07 深夜） | `9adbf7b` 之上 13 个提交：`afb54bf` 构建卫生（NEXT_DIST_DIR+gitignore，public/scans 不入库）→ `7f4209c` 整景区静态底图+锚点 → `e6cb502` 点云字节 LOD → `ed003b0` 整景区视距 LOD → `e0e0495` venueScan 覆盖修复 → `aaf8abd` 导出 guides → `ec24ef4` 雕塑动画验证 → `4970a6c` 采集就绪 → `c9fe28a` 付费入口下线 → `a2d9bb8` UI 面板打磨 → `6bce406` 品牌 P0（compare 位图删+品牌规划落 docs/26）→ `4afa51f` aholo 工具脚本 → `a8ba9b9` 注释勘误。热文件按 hunk 拆分（room-organizer 4 主题、splat-preview 3 主题、types/schema 2 主题）；`frontend/public/scans/`（38MB 本地 LOD 夹具）进 gitignore 不入库。分支 feat/research-basemap-anchor 与 feat/clean-export-guides 已被工作区吸收（COLLAB 待协商表已回填），无需合并可弃。 |
| SC-01 干净基线复验（2026-11-07 深夜，首次全量） | 树干净（代码=HEAD）后：`npx tsc --noEmit` **0 错误**；`npx vitest run` **全量 318 文件：307 过 / 11 文件 37 项失败**（历史首次跑全量——上一轮 SC-01 只跑 18 个定向套件）；`$env:NEXT_DIST_DIR='.next-ci'; npm run build` **exit 0，14 条路由**。11 个失败文件逐一定性：①jsdom 环境限制——structure-satellite 5（canvas 2D 未实现）、scene-presets 等（WebGL context 无法创建，全日志 113×）；②远端测试与现行组件漂移（与已修 4 项同类）——assets-panel 7（期望「素材库」钮）、scendance-workspace 8（钮数 15 vs 13，整景区等新钮入列）、scene-delivery 8（多层文案改了）、nav-chrome 1（断言源码含 toggleNavColumns 重构）、workbench-rail-head 1（左轨 4 格 vs 3）、space-panel/lux3d-direct-test/share/structure-v2。**无一项由本轮提交引入**（本轮内容增量仅 schema 放行+2 个测试文件对齐，均不在失败链路；各主题定向套件全绿）。 |
| 修 schema 存档拒收整景区底图真 bug（2026-11-07 深夜） | `isResearchArea` 只认卫星代理 URL，带 `/basemap/xihu-scenic-z15.jpg` 预置底图的布局存档读回时 `isRoomLayout` 整份拒收、`parseStoredLayout` 返回 null。现放行 `/basemap/<安全名>` 同源静态图并校验 `presetId`（今天仅 'xihu-scenic'），schema.test 补往返用例（108/108 过）。随 `7f4209c`。MAP-04 的「保存重开一致」直接受益。 |
| 4 项长期失败测试清零（2026-11-07 深夜） | 根因是 Qoder 自己提交里测试与实现脱节（dda1863 同一提交内测试与组件「圈完即收」及同文件 D0 用例互相矛盾；b6ffa32 写死从未存在的按钮名，110f348 又把入口挪到空间脸）。只改测试断言对齐现行交互，提交 `3371ade`，两文件 12/12 过；已在 COLLAB 待协商表登记待 Qoder 复核。 |
| docs/25 编号撞车收口 | 需求清单 23:57 先建留 25；品牌规划 23:58 后建改 docs/26（P0 拍板内容未动）。随 `6bce406` 入库。 |
| 同步远端 | 上一轮曾快进 42 个提交至 `2f78747`，本地改动恢复且无冲突。同步前留有 stash 备份 `be5b367`。编制需求清单时已核对，后续 12 个提交也已进入本地 main。2026-11-07 第二轮会话独立复核：`git merge --ff-only` 到 `9adbf7b`，方式 stash(含未跟踪)→ff→pop，零冲突；双方改动只碰 `.gitignore`/`agent-panel.css`/`room-organizer.tsx` 三个文件且 hunk 不重叠。`.gitignore` 补 `frontend/.next-*/`（隔离构建目录不再进 untracked）。 |
| SC-01 执行基线（2026-11-07） | 基线 `9adbf7b` + 工作区在途改动上：`npx tsc --noEmit` **0 错误**；18 套件 **281+53 项测试通过**（本地改动 7 套 146：scene-anchor/schema/geo-basemap-input/canvas-heading/camera-presets/recon-readiness/glb-anim-verify；远端新套件 11 套 135：plan-scoring×2/plan-approve/hall-benchmark/brief-extract-contract/auto-zone-apply/door-privacy/door-render/plan-overlay/use-layout-store/plan-annotations；agent-panel 53）；构建 `cd frontend` → `$env:NEXT_DIST_DIR='.next-ci'; npm run build` **exit 0**，14 条路由全出（警告全部为既有 import-order/lint 风格类）。可重复命令如上。4 项既有测试失败与环境问题分列「卡住的问题」。**注意这不是干净工作区**：底图/LOD/采集就绪等在途改动仍在树上，干净基线复验需独立 worktree。 |
| 修 venueScan 覆盖真 bug | Bingo「调研西湖」原先 `onApply({ ...live.current, researchArea })` 整张覆盖**渲染期快照**：查询等待期间挂载的 `venueScan`/`sceneAnchor` 会被旧快照冲掉，且绕开锚点逻辑。现改为 `LayoutAgentProvider` 新增必填 `onApplyResearchArea` prop，agent 调研与手动「底图定位」共用 docs/49 的 `applyResearchArea`（store 现取布局 + 场景锚点唯一变换）；画布切 3D 在 agent 侧补。3 个测试文件的全部挂载点补 `onApplyResearchArea={vi.fn()}`。 |
| 修 3 个 TS 错误 | 上轮 LOD 在途工作 `frameTick` 签名收得太紧（`PerspectiveCamera`），绘制入口 `SplatPaint` 只给 `THREE.Camera`；函数体只读 `camera.position`，签名放宽（`three/splat-preview.ts` frameTick）。 |
| 产品评估 | 本地布局评分、审批、门和隐私四个核心测试套件共 50 项通过。远端已加真实场地基准用例、降容理由、门弧与未知门信息处理，以及物料短缺清单逻辑。在线客户主流程未复验，全量类型检查主动停止，本轮无全量检查结论。见 [主流程实测](docs/04-Golden-Path-规格与实测.md)、[交付缺口](docs/24-Web端三个产品问题.md)。 |
| 雕塑本地绑骨 | 原 GLB 保留。Blender 导出 4 骨骼、约 2 秒的 `Sculpture_Small_Bow`，GLB 回读确认蒙皮有效，峰值位移约 13.6 cm、脚底固定、首尾回到同姿势。工作区另有编辑器动画验证记录，见 [GLB](docs/evidence/aholo/sculpture-rig-local/sculpture-local-rig.glb)、[Blender 源文件](docs/evidence/aholo/sculpture-rig-local/sculpture-local-rig.blend)、[回读报告](docs/evidence/aholo/sculpture-rig-local/validation.json)、[编辑器画面对照](docs/evidence/aholo/sculpture-rig-local/editor-diff.json)。 |
| 茶室照片 API 复测 | 本地 SfM 主组 63 张，归一 EXIF 方向后去掉 EXIF、JPEG RGB、最长边 2048，`scene=space`、`taskQuality=low`。任务 `3FO4K4RL8KM8` 创建 HTTP 200，约 122 秒后观测到 `FAILED`，没有错误字段或 SPZ/PLY。见 [回执](docs/evidence/aholo/recheck-tearoom-3FO4K4RL8KM8/report.json)、[输入清单](docs/evidence/aholo/recheck-tearoom-3FO4K4RL8KM8/input-manifest.json)。 |
| 图片通道对照 | 同一套开放平台上传流程中，寺庙 32 张照片的 5 个对照任务均成功并生成 SPZ。西湖茶亭也有实拍视频成功。旧报告中「图片通道整体故障」已被照片对照反驳，茶室云端失败阶段仍未知。见 [寺庙 SPZ](docs/evidence/aholo/chan-temple-2048-rep1/3FO4K4RKHRTI.spz)、[户外重建记录](docs/19-西湖户外重建接力.md)。 |

## 卡住的问题

- **浏览器动效走查被 IAB 遮挡节流卡住（2026-11-07 五轮实测）**：ZCode 桌面窗口被遮挡/后台时，IAB 标签的 requestAnimationFrame 被 Chromium 完全暂停——evaluate 内 rAF 计帧超时、`advanceCalls:0`、canvas 绘制缓冲停在 300×150 默认值；把浏览器面板置前台（visibility capability）和录屏强制出帧都救不回。PEOPLE-01/04 的行走画面验收与后续任何动画类走查，必须在 ZCode 窗口真实处于前台时做，或改用系统 Chrome 手动复测（DOM 级交互与探针读数不受影响，仍可用）。
- **全量套件 38 项失败（12 文件，2026-11-07 二轮复测）**：11 文件与首轮定性一致（jsdom 环境限制 + 远端测试与现行组件漂移，逐文件定性见「已完成与证据」SC-01 行）；新增可见的 `three/agent-preset-flow.test.ts` 1 项（GLTFLoader 读 gym.glb，jsdom 环境类）——与本轮 SC-19 改动**无 import 路径交集**（three/scene-presets → glb-assets/schema/types，均未触碰），非本轮引入。处置建议不变：环境类给 vitest 装 `canvas`/headless-gl 或显式 skip；漂移类按 docs/25 派发复验卡逐套对表（同已修 4 项的做法）。
- **AHOLO 网页对照还没执行**。Computer Use 能识别 Chrome 窗口，但因无法核实浏览器 URL 而停止。AutoGLM 扩展的页面显示「连接成功」，任务端仍回「扩展未登录」，尚未确认两者是否接到同一个浏览器会话。用户已授权上传，避免重复询问授权或让用户代做。照片从原片按输入清单重新生成并逐项核对字节数，存于 [网页上传目录](docs/evidence/aholo/recheck-tearoom-3FO4K4RL8KM8/web-upload-images/)。网页尚无上传、重建任务或报错。
- **交付闭环缺证据**。已有机位图、DXF、物料 CSV 和只读分享，但缺少用一个真实活动验证同一版本的方案能否让甲方确认、让执行团队直接使用。现有材料不足以判断付费、复用或节省工时。
- **原雕塑的 AHOLO 自动绑骨仍失败**。三单 `MODEL_NOT_RIGGABLE`，双臂屈在胸前，袖子融合。现有本地样件把折叠双臂合用一骨、下身固定，适合原地鞠躬。此前约定地图不做行走，`Walk_Loop` 未验证。
- **C 盘又满了（2026-11-07 实测 0 字节可用）**。本轮已清可再生缓存救回约 6.5 GB（根 `.temp/` 4.6 GB、`frontend/.next-ci`/`.next-local`、npm cache、Temp 两天前旧文件）。**Downloads 22.6 GB 与 HANDOFF 十一节的批 2/批 3 清理仍待用户批准**；D 盘还有 186 GB，大资产应一律落 D。
- **并行会话同树工作（2026-11-07 实发）**：本轮提交期间用户另开的 chat 同时在改 HANDOFF、写 `docs/plans/hangzhou-isometric-map-research.md`（未跟踪，未入库，归那个会话）。共享树纪律：动手前和提交前都要重查 `git status`，别人的未跟踪产物不卷进自己的提交。
- **`docs/evidence/` 的 ignore 规则仍过宽**（整目录忽略，见历史第五段），新证据无法入库且删除不可从 git 恢复，待收窄白名单。
- **GitHub Dependabot 报 42 个依赖漏洞（2026-11-07 push 时提示：2 critical / 16 high / 21 moderate / 3 low）**：存量状态，非本轮引入；清点入口 https://github.com/LiliLIN0324/Scendance2026/security/dependabot 。尚未逐项核对是否影响运行时（多数可能在 devDependencies 或传递依赖），收口前先分类再升级。
- 小程序体验版二维码、价格配置口径和真机采集体验见后面的历史记录，恢复对应工作前先核对状态。

## 下一步

1. **XH-02 单段重建（P0，只差授权）**：素材已就绪——首选 [docs/33](docs/33-西湖新素材分段清单.md) 候选 0233（174s 园林走拍，白天多视角），对照 0234（同园连续）；备选 0220（65s 湖面+候船亭）。等用户对「本批素材上传 + 额度」点头后，复用 `tools/aholo/` 视频链路提交一单（录输入时间段/任务号/终态/产物读取；失败全退的计费口径见记忆档）。**提交前先问一次授权，卡片原文条件未满足前不动上传。**
2. **PEOPLE-01/04 收尾（P0，归在途会话）**：五轮已验证实现全绿（见「优先接力 · AHOLO 绑骨人物库」回填块），剩前景窗口浏览器走查（rAF 遮挡节流复测）+ COLLAB 登记独占区 hunk + 提交。之后 PEOPLE-02（AHOLO 古风样板参考图/图生 3D）与 PEOPLE-04 茶亭路线走查可续。
3. **SC-03 走查当前流程（P0，与 XH-02 无依赖可先行）**：输入用 docs/27 用例 A/B；重点人工核对 A1/A11/A12/B6 四条非自动化断言 + docs/30/31/32 三份交接注记。**UI 侧验收点已积压三轮**：圆桌区方案可行（24 座）、「装不下 N 人 + 建议降到」、⛔ 徽标；区类型条「预留区」钮、动线硬冲突横幅（REC=null）、真门 verified；**再加两处**：选址浮层输入「西湖」出联想下拉且同名条目可区分、底图常驻署名（动态=高德，整景区=高德+OSM）。走查结果回填 docs/32 §五。宜在并行会话不改前端时做（dev `cmd /c "set NEXT_DIST_DIR=.next-dev-z&& cd frontend && npm run dev -- --port 3030"` + mock 3099；角落按钮 locator click 会超时，用 `tab.cua.click` 坐标点；**画布对持续渲染不空闲，cua.scroll/连点也会超时——DOM 元素用 `locator.evaluate(el => el.click())` 派发真点击**）。
4. **MAP-05 空间工作流验收（P1，依赖 XH-02 新资产）**：搜地点 → 确认场地 → 进实景 → 量一处已知长度 → 放一件已知尺寸物件 → 保存重开 → 回到概览；桌面+手机各一轮，回填设备/网络/首屏/实景就绪时间/请求量/对齐误差与三个最明显的操作问题。**顺带收口两个 MAP-03 遗留**：① 多 geo 场地互切时新场地落位用 stride 偏移不落 geo 投影位（v3.3.0 并排协作模式既有设计，第二个真 geo 场地出现时改 `selectEnvironment` 落位）；② LOD 阈值 100/200 m 按真机手感调；③ `AholoAssetGeo.headingDeg`→锚点朝向的语义校准（真资产进来后核「壳体平面图上方=采集朝向」假设）。
5. **SC-20 复核硬约束/偏好的全链表达（输入侧已接）**：复核草案卡上「硬冲突不进推荐、偏好未满足有说明」的呈现是否完整；顺带评估 reserved 区是否要给画布专属配色（当前与普通区同款绿框，仅徽章文字区分）。
6. **价格拍板（SC-34 §二 9 项）**：SKU 金额/免费额度/退款链路等全部等用户点头；**付费入口恢复必须排在价格拍板之后**（否则 ¥4.90 旧价见用户，负毛利）。
7. **继续网页对照（SC-24）**。先确认工具连接到了用户已登录且可控制的浏览器会话，再打开 [AHOLO 工作台](https://studio.aholo3d.cn/)。使用上面的 63 张 JPEG，室内空间、最低质量档，只创建一次，等终态并记录原文。浏览器连接仍失败时，记录工具具体阻塞，避免把它记为 AHOLO 重建失败。
8. **做一次真实活动交付（SC-17）**。选有明确人数、场地和日期的活动，用现有扫描或尺寸平面出两个备选。让甲方确认一版，把同版本的效果图、尺寸平面、物料清单和分享链接交给执行方。记录耗时、人工补件和实际采用的文件。docs/27 演练卡可作真实卡片的模板。
9. **磁盘清理批 2/批 3 等用户批准**；并行会话的杭州等距地图调研 `docs/plans/hangzhou-isometric-map-research.md` 仍未入库（归那个会话，勿卷进本线提交）。

## 踩过的坑

- **「人物/动画不动」先对探针再怀疑代码**（2026-11-07 五轮）：IAB 遮挡节流下 rAF 全停，`people-anim` 的 `advanceCalls` 计数器（函数第一行自增）为 0 就是「渲染 tick 从未跑过」的铁证，同时 canvas 绘制缓冲会停在 300×150 默认值；这不是引擎 bug，换前台窗口复测即可。`window.__peopleWalkStates`（仅 dev 构建）可读注册表条目/里程/附着状态。
- **有 worldId 只代表受理**。按终态、错误字段和实际产物分别记账。`FAILED` 时 `progress=1` 也不表示成功。开放平台国内网关建任务要带 `x-source: openapi`，缺头曾误报「文件链接不对」。
- **重建阶段的失败归因要有对照**。本地 SfM 配准成功、上传成功、云端重建成功是三件事。寺庙能过并不能解释茶室为什么失败。
- **浏览器连接与认证要分开核对**。扩展的「连接成功」不能证明任务所用会话已认证。临时目录可能被清理，复测素材以证据目录和清单为准。
- **绑骨要验证实际形变**。原雕塑 GLB 以模型中心为原点，初次按地面为零放骨骼，权重写进了 GLB 但网格几乎不动。按实际底面校准后再回读动画。拉宽融合衣袖也没有得到有效 T-Pose。
- **点云提供观感，尺寸与碰撞依赖独立几何**。导出验证需用确实含定位辅助的场景，否则 `guides:false` 的对照没有验证到目标分支。
- **并行工作区要保护**。开发和构建分离 `NEXT_DIST_DIR`，避免共用 `.next` 的清单冲突。不要用 `git add -A` 把构建缓存、证据大图和别人的改动卷入提交。
- **C 盘满的表现是「工具静默崩」不是报错**（2026-11-07 实踩）：vitest 直接退出（ENOSPC / exit 4294963241），Bash 工具自己临时区满导致输出丢失。先查磁盘再怀疑代码。清理顺序：根 `.temp/` → `frontend/.next-ci`/`.next-local` → npm cache → Temp 两天前旧文件，约 7 GB；`C:\Users\13266\Downloads`（22.6 GB）是用户数据不能动。
- **提交前重查 `git status`**：并行会话会往共享树里写新文件（本轮中途出现另一会话的调研文档）；hunk 拆分提交用「备份全量→checkout HEAD→Edit 重放→add→还原」比手写 patch 稳。
- **画布页面浏览器自动化三板斧**（2026-11-07 MAP-03 走查实测）：① 画布持续渲染不空闲，`cua.click/scroll` 等空闲会超时（右轨角落按钮、连点 zoom 全军覆没）；② DOM 元素（点位/chip/气泡）用 `locator.evaluate(el => el.click())` 派发真点击，绕开 actionability 等待；③ React 状态更新异步刷 DOM，断言要 `waitFor` 不能同步读。**屏幕空间层挂在相机后渲染会踩双竞态**：初挂 update 跑在相机取景落定前 + 落定帧无 change 事件 = 元素永不出现；插桩定位（容器上加 data-* 属性 + React fiber 读 props）比盲猜投影快得多。

---

## 历史记录（保留原始排查与接力细节）

以下是 11 月 5–6 日的阶段性记录。其中「当前任务」「下一步」为原记录当时的状态。雕塑章节中的失败结论指 AHOLO 自动绑骨，后续本地绑骨已成功，见顶部。

## 一、当前任务

Scendance2026：把「拍照/视频采集 → 3DGS 重建 → Web 画布交付」这条链路做成可售产品；这一轮在推**小程序采集器可用性 + 按次付费闭环**（可用率、定价、付费通道三件套）。

## 二、已完成（2026-11-05 这批）

- **导出合成 3DGS 打通**：`paintFrame` 接进导出管线，成图 1920×1080、2,722,871 B；与「无点云」对照逐像素 diff 69.24%（证据见 `COLLAB.md:24`，产物在 `exports/effect-splat-guides-off-1920x1080-20261105-083425.png`）。
  - **但这条分支没被真正走到**：默认场景（酒店大堂）没有 `splatGuide` 三组物件，`guides:false` 是空操作；新图与旧图字节完全相同，只能说明「没改坏」，不能说明「guides 生效」。
- **小程序 0.1.2 已上传**：包体 1,253,737 B（CLI 体积报告 `.temp/mp-automator/preview-layer.txt`），编译无报错，AppID `wxd16c2833f4591a29`。
- **采集页两个真机 bug 已修**：
  - 「太远」恒触发：原判据量的是**照片短边像素**而非距离；改为硬拦只留糊/重复，偏小偏暗偏亮降级软提示，桩数据 0/5 → 3/5。
  - 层判定接上姿态：`|beta|` <72° 俯拍 / 72–108° 平视 / >108° 仰拍，±6° 滞回；手动选层后姿态再动 8° 收回判定权；`beta==null` 时出第 4 颗胶囊「无法判定」并锁快门。
- **docs 全量审计**：138 份，1,683,622 → 1,682,572 字节；4 处重复合并（−1,710 B）、4 处过时修正；报告 `.reports/docs-audit-2026-11/audit.md`。
- **Web 体检**：P0 4 / P1 7 / P2 7（共 18 条，W-01–W-18），全表 `.reports/web-audit-2026-11/issues.md`。
- **`COLLAB.md` 已建立**：与 Qoder（LiliLIN0324）的文件所有权边界 + 提交纪律。
- **西湖点云 × 调研底图层级（Qoder 侧，未提交）**：底图原先被主场景在点云之后重画一遍，任何高度都盖住 3D。现在底图只随点云所在的背景栈画一次，主场景渲染完才搬回；同机位 A/B（有/无底图）茶亭像素一致。同时 `researchArea.scanAssetId` 的自动铺图不再套 1600 m 底图做概览取景。改动仅 `three/splat-preview.ts` + `room-organizer.tsx`，已在 `COLLAB.md` 待协商表登记。
- **地理底图改锚点驱动（本会话，未提交）**：`sceneAnchor` 成为场景坐标↔地理坐标唯一变换，底图按锚点投影（`lib/scene-anchor.ts`、`three/research-basemap.ts`）；`mapGroundFrame` 不再读进世界定位，只剩 `frameFromAnchor` 推出来的一个视图（立壳卫星贴图 UV）。`applyResearchArea` 里「异地框架 >3 km 就清空」的补丁已删，改为铺图时无条件移除 frame/polygon/center。实测：12 km 底图与场景地面最大偏差 2.02 m（z15 瓦片 4.13 m/px）；相机 `minDistance` 2 m，`maxDistance` 随焦点 = 焦点框对角线 ×3（茶亭 36.8 m / 场地 60.4 m / 全湖 51.7 km）。

## 三、卡住的问题

- **体验版二维码**：只能在 `mp.weixin.qq.com` 后台生成，CLI 与插件都做不到；登录态拿不到（Chrome 只有 Default profile、Cookies 被占用）。**需要用户扫码**。
- **computer-use 扩展**：包本体在 `D:\Programs\Trae CN\resources\app\extensions\byted-solo.builtin-mcp\node_modules\@byted-solo\computer-use-mcp`（v0.81.3），`plugin-config.json` 里 `user_enabled` / `app_origin_enabled` 均为 true（08:02 写入），但 IDE 主进程 00:29 启动 → 运行期从未注册。**需要 `Developer: Reload Window`**。
- **价格两套账**：代码 `pay_skus` 仍是 `scan_1 = 490`（¥4.90），`docs/45` 定 ¥9.99 / ¥24.99；`PAY_DAILY_JOB_LIMIT` 3 次/天 vs `docs/45` 的 1 次/月。**没人拍板，未改**。
- **待删文档**：5 份共 62,049 B（34、team/reports/A/A01、33、27、42-1.0.1），清单已出，未执行。
- **产品开关**：「三层覆盖」删不删、姿态不可用时是否允许手动拍摄，都等用户点头。

## 四、下一步计划

1. 修 `.next` 冲突（dev 与 build 共用 `frontend/.next`，导致 `/pricing`、`/review/<id>` 500）：用 `NEXT_DIST_DIR` 分离后一次解决 3 条 P0。
2. W-04：Web 端补上传/分片直传通道（24h，最大缺口）。
3. 研究线：#3 微信虚拟支付后台实测（能否建商户号、发 1 分钱沙箱单）→ #2 五个不同场景各 1 条 60s 视频，测成功率 p。
4. 找一个带 `sceneAnchor` 的地理底图场景，重跑导出 A/B，把 `guides:false` 分支真正压到。

## 五、踩过的坑（救命用）

- 微信开发者工具装在 **D 盘**：`D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`；扫 C 盘与 `%LOCALAPPDATA%` 都会判错。
- 「太远」判据量的是**照片短边像素**，不是距离；手机 `takePhoto quality:'high'` 普遍短边 720。
- 层判定曾读默认 `layerIndex=1`，全页没接 `onDeviceMotionChange`，所以「怎么拍都是视线」。
- 3000 端口 500 **不是代码缺陷**：dev 与 build 共用 `frontend/.next`（`next.config.mjs:11` 默认 `'.next'`）；`NEXT_DIST_DIR=.next-local` 起在 3020，12 条路由全 200。
- 模拟器里 `beta` 必然 null，在模拟器上验姿态判定无效。
- 提交 `8362728` 是 Qoder（LiliLIN0324）把整个工作区一次性 `add` 收进去（**108 文件、+63,085 行**），不是它写了新功能。
- `.gitignore:45` 把 `docs/evidence/aholo/` 放宽成整个 `docs/evidence/`，以后新证据无法入库。
- `miniprogram-automator` 在根 `package.json:30` 的 `dependencies`，应归 `devDependencies`。
- `frontend/.local-map*.mjs`、`.local-final.mjs` 这类调试脚本 `.gitignore` 无对应规则；当前目录已清理，谁再生成谁记得别被 `git add` 带上。

---

## 六、雕塑绑骨（2026-11-06）

**目标**：给 Lux3D 图生雕塑绑骨。后经用户拍板「地图上不动就不动」，**不做行走代码改动**，只验证绑骨链路本机可跑通。

**资产**：`docs/evidence/aholo/sculpture-img2-3d/4676340-unpacked/MODEL.glb`，985,424 B，19,883 顶点 / 28,888 三角面，0.846×1.800×0.842 m，米制 Y-up 底面贴地。**全程只读，未改。**

**结论：Aholo 自动绑骨走不通，停滞在这里。**（修订：这一尊后来用**外部绑骨**成功，只能原地鞠躬，见第十段；Aholo 侧结论不变。） 三次 Aholo `POST /lux3d/v1/animations/rig/task/create` 全部 `MODEL_NOT_RIGGABLE`，无任何产物，`retarget`（`rigModelUrl` 必填）无从提交。积分接口不返回。

| taskId | 提交物 | 耗时 | 失败原文 |
| --- | --- | --- | --- |
| 4734738 | 原始 GLB | 191 s | `{"error":{"code":"MODEL_NOT_RIGGABLE","message":"主体为类人形角色，但双臂弯曲抱于身前，不符合可绑骨的T-Pose或A-Pose站姿要求。"}}` |
| 4736139 | T-Pose（横向平移 DX 0.34） | 28 s | `...双臂屈肘交叠于身前，不符合可绑骨基础站姿要求。` |
| 4736194 | T-Pose（DX 0.36 / 手团 R 0.24） | 23 s | `...但其手臂呈抱臂姿态，不符合可绑骨的T-Pose或A-Pose基础站姿要求。` |

重试额度（最多 1 次）已用尽。

**T-Pose 派生结果**（`docs/evidence/aholo/sculpture-rig-tpose/MODEL-tpose.glb`，812,712 B）：宽 0.846073 → **1.406383 m**（+0.560310），深 0.842209（0），高 1.800000（0），顶点/三角面不变，臂展/身高 0.470 → 0.781，移动顶点 6,948。但外张质量集中在 0.90–1.45 m 一条板状带，1.50 m 处硬断层。

**根因（别再重复踩）**：
- 手臂与袍身、底座是**一张融合网格**，没有可独立驱动的臂部件；单手到肩距离仅 0.409 m。
- Blender 自动权重 `Bone Heat Weighting: failed to find solution for one or more bones`，手臂骨骼权重覆盖率 **0**，形变完全不发生；envelope 只到 0.964、手工胶囊 0.9895。
- 绕肩刚性旋转**方向本身就是错的**：解析解算出「手臂正好水平」的那一版宽度到 1.102，但剪影里被甩出去的是**肩部衣料**，手臂仍抱在胸前；旋到底袖料会飞到 1.84 m（高过头顶）。
- 换成横向平移能把宽度推到 1.406，分类器判语从「抱臂」变成「屈肘交叠」「抱臂姿态」——它读到外张了，但仍认定手臂形态是抱臂。**宽度不是判据，臂的形态才是。**

**下一步（按用户指定顺序，但需先解决根因）**：建骨架 → 把双臂拉平 → apply 形变 → 回传 rig → retarget `Walk_Loop`。此路在前四版已证伪，直接重开会复现 `MODEL_NOT_RIGGABLE`。真正可行的三条：
1. 放弃绑骨，雕塑静止（与「地图上不动就不动」一致）。
2. 用 img2-3d / text2-3d 重新生成一尊**手臂张开或下垂**的雕塑再绑骨，而不是改造这一尊。
3. 人工重拓扑出可分离的手臂，或换通用人形模型穿这尊的贴图——超出本轮范围。

**环境（已装好，可直接用）**：Blender **4.5.10 LTS**（build 2026-05-19，hash `6dc0b208d1b5`），内置 Python 3.11.11。**（修订：上一轮记的便携路径 `D:\tools\blender\blender-4.5.10-windows-x64\blender.exe` 已删，现用安装版 `D:\Program Files\Blender Foundation\Blender 4.5\`，见第十一段。）** glTF 插件可用。winget 装不了（退出码 1602，MSI 需提权），改官方 zip 便携解压；官方站被 Cloudflare 拦，走清华镜像下满 **398,911,842 B / 27 s**，`tar -xf` 解压 15 s，SHA256 `EF6D846B8015F47ADE6DF3F9322CE17419080A5D922FA562B6C966064FE30DCE`。**下载已完成，无半截文件、无残留 zip。**

**证据**：`docs/evidence/aholo/sculpture-rig/README.md`（第 1 轮）、`docs/evidence/aholo/sculpture-rig-tpose/README.md`（本轮，含安装记录、逐层 max|x| 表、四视图与正交剪影）。脚本：`derive_tpose_v5.py`（采用）、`derive_tpose_v4.py`（旋转版对照）、`analyze_silhouette.py`、`render_glb.py`、`diag_coords.py`；`sculpture-rig/run-rig.mjs` 新增 `LUX3D_GLB` / `LUX3D_OUT` 环境变量可换输入与输出目录。

**未完成**：retarget `Walk_Loop`（被阻塞）；`skins`/`JOINTS_0`/`WEIGHTS_0`/`animations` 四项核验（无对象可查）；沿路线行走的代码改动（用户已明确不做）。

### 换线：UniRig 本地跑（2026-11-06 傍晚）

Aholo 那条**正式放弃**，不再消耗额度。改走 UniRig（VAST-AI-Research，MIT）本地推理，输入仍用原始 `MODEL.glb`（只读）。

**硬件体检结论：这台机器跑不了，卡两层，未做任何安装。**

| 项 | 实测 |
| --- | --- |
| GPU | NVIDIA GeForce RTX 3050 Ti Laptop |
| 显存 | **4096 MiB 总，已占用 2156 MiB，余约 1.9 GB** |
| 驱动 / CUDA | 580.97 / CUDA 13.0 |
| Python | 3.12.10（`C:\Users\13266\AppData\Local\Programs\Python\Python312\python.exe`），**无 conda**，py launcher 只有 3.12 |
| 磁盘 | C 剩 33.3 GB / D 剩 206.4 GB |
| 内存 | 15.8 GB |
| 系统 | Windows 11 家庭版 |

UniRig 官方要求（README + requirements.txt）：Python **3.11**、torch ≥2.3.1、`spconv-{cuda}`、`torch_scatter`/`torch_cluster`（需按 torch+cuda 版本取轮子）、**`flash_attn`**、`bpy==4.2`、`open3d`、`pyrender`、权重来自 `huggingface.co/VAST-AI/UniRig`。

- **第一层卡点：显存**。4 GB 总容量（还得先腾出被图形界面占的 2.1 GB），而 UniRig 是稀疏卷积 + transformer 推理，社区反馈普遍需 ≥8 GB，跑起来必然 CUDA OOM。
- **第二层卡点：`flash_attn` 在 Windows 上没有预编译轮子**，源码编译要 CUDA Toolkit + MSVC，Windows 上成功率极低。
- 次要：本机只有 Python 3.12（官方要 3.11）、无 conda；`bpy==4.2` 需 cp311 轮子。

**下一步待定**（需用户选择）：租云 GPU（最省事，8–16 GB 即可）；或换不需要 flash_attn 的替代实现；或放弃自动绑骨（同前述三条）。


---

## 七、地图 / 底图：整景区静态底图（2026-11-06）

**目标**：把西湖风景名胜区整幅底图垫进 3D 场景（原定三步：①整景区底图 ②范围线+水面矢量 ③100 m 内切点云）。用户中途要求提速，**只做第 1 步并出一张总览图**后收口。

**做到哪一步**
- ✅ 第 1 步代码完成，`npx tsc --noEmit` exit 0（先删除 dev 生成的陈旧 `frontend/.next-local/types`，它引用了已不存在的 `app/review/[id]/page.js`）。
- ⛔ 第 2 步（`xihu-scenic-area-osm-13164471.geojson` 717 点主环+5 碎片、`xihu-water-osm-2308774.geojson`）、第 3 步（<100 m 点云 / >200 m POI、滞回、总览不加载）**未开始**。
- 🟡 浏览器实测：编辑器里点「整景区」后底图能加载，西湖轮廓可辨；但总览截图**未落盘**（agent 汇报保存路径，`docs/evidence/basemap-20261105/` 下实际没有 png），且现场目测「未铺满画布、疑似拉伸」，**未复核**。

**改过哪些文件（行号按本轮收口时）**
- `frontend/components/room-organizer/lib/research-area.ts`：`:60` 加 `presetId?`、`:190` 预置底图不再响应换半径/换样式、`:227-250` `XIHU_SCENIC_PRESET` + `createPresetResearchArea()`。
- `frontend/components/room-organizer/lib/types.ts`：`:445` `presetId?: 'xihu-scenic'`（RoomLayout 结构里同步字段）。
- `frontend/components/room-organizer/panels/geo-basemap-input.tsx`：`:6` 引入、`:74/:80` 预置底图隐藏半径/样式、`:119-131` 新增「整景区」按钮（`data-testid="geo-basemap-preset"`）。
- `frontend/components/room-organizer/room-organizer.tsx`：`:2372-2382` `applyResearchArea` 对 `presetId` **保留已有 sceneAnchor**（不再把锚点搬到 bbox 中心）。
- 新增静态资源（未入库）：`frontend/public/basemap/xihu-scenic-z15.jpg`（1,447,595 B）、`xihu-scenic-area.geojson`（19,144 B）、`xihu-water.geojson`（69,517 B）。后两个是第 2 步备用，尚未被代码引用。
- **未动**：`three/scan-placement.ts`、`three/furniture-builders.ts`、`hooks/use-splat-preview.ts`、`three/splat-preview.ts`；`room-organizer.tsx` 仅 `applyResearchArea` 一处最小改动（COLLAB.md 独占区，按约定只做必要 diff，未登记新行）。
- `frontend/tsconfig.json` 被 dev 自动追加的 `.next-local/types/**/*.ts` 已还原为 HEAD 版本（`git diff` 为空）。

**底图接进去没有**：**接进去了（可用），但未经像素级验收。**
- 方案取舍：选「静态图放 `frontend/public/`」而不是「代理加免压缩直通」——整景区图固定、只拼一次，静态资源无长边 2048 限流、像素可复现；代价是仓库/部署多 1.38 MB 且范围改动要重新拼图。代理直通则每次请求仍要拼 110 块瓦片、依赖高德上游、且每次像素可能变。
- 无第二套 geo→world：`bounds` 设为图片精确裁切范围（W120.0714663 / S30.1777743 / E120.1737028 / N30.2736397），中心/尺寸/偏航仍由 `researchArea.bounds + sceneAnchor` 推出。按 z15 墨卡托算，该 bbox 对应 2382.30×2585.30 px，与图片 2382×2585 对齐；线性纬度 vs 墨卡托的最大内部偏差 **0.32 px**。

**卡在哪**
1. 总览截图没落盘，铺满/拉伸未被证实也没被证伪。
2. 底图是「已有锚点的场景垫大图」，但实测时浏览器先点了「杭州西湖→定位」，锚点被挪到西湖 POI 中心后再铺图；茶亭锚点是否仍在原位**没核对**。
3. 四角/边界线像素偏差、build exit code、底图加载字节与首帧耗时**都还没测**。

**下一步（恢复时按此顺序）**
1. 重开 dev：`cd frontend` → `npm run dev -- --port 3030`（需要 3199 代理时用同一脚本，它会在无代理时自拉）。
2. 打开 `http://127.0.0.1:3030/editor`，**先确认 `sceneAnchor` 是茶亭原始经纬度**，再点「整景区」；截一张总览存 `docs/evidence/basemap-20261105/scenic-overview.png`。
3. 查「未铺满」：若是透视画幅留白（正常），换正交/拉高相机复拍；若与 `fitToRoom` 焦点有关，看 `use-camera-presets` 的 `overview` 是否取到 `researchBasemapPlacement` 的 9.83×10.60 km。
4. 第 2 步：GeoJSON→`Line2`/`ShapeGeometry`，挂到 `RESEARCH_BASEMAP_TAG` 组随点云背景栈一起画（`renderOrder -10` 底图 / `-9` 矢量），线宽公式 `clamp(1, 8, 6 m × h/(2·d·tan(fov/2)))`。
5. 第 3 步：水平距离 `hypot(camera.x, camera.z)`；进入 <100 m、退出 >120 m；>200 m 显示 POI；总览不调用 `startSplat`（不得先解 1.3M 点）。
6. 补验收：四角偏差 ±1 px、`npx tsc --noEmit`、`$env:NEXT_DIST_DIR='.next-ci'; npm run build` 的 exit code、底图 1,447,595 B 的加载耗时。

**可复现命令（PowerShell）**
```powershell
cd frontend
npx tsc --noEmit                                  # 若 .next-local/types 陈旧：Remove-Item -Recurse -Force .next-local/types
$env:NEXT_DIST_DIR = '.next-ci'; npm run build    # 跑完记得 Remove-Item Env:NEXT_DIST_DIR
```

---

## 八、Aholo 图片通道的边界已测清——死因是张数，不是拍摄方式（2026-11-06）

**三组对照，一组比一组清楚。**

| 张数 | 上传 | 登记 | 结果 |
| --- | --- | --- | --- |
| 20（室内走拍） | 20/20 ready | — | 作业 8.0 秒失败：`Fewer than 12 photos have reliable camera positions` |
| 63 | 全量 | 24（38.1%） | 2.59M 点 |
| 130 | 全量 | 38（29.2%） | 作业 108.6 秒、1,843,754 点、ply 457,252,690 B、spz 61,654,317 B、status succeeded、error null |

130 张这组产物在 `docs/evidence/aholo/scan-room130-2048/`。

**结论**：登记率约 30%，最低门槛是 12 张可靠位姿。实操 **≥40 张起步、≥80 张留 2× 余量**。20 张那组不是拍得差，是过不了 12 张这条线。

**两条服务端硬约束（今天新测出）**：
1. 一条 job 至少 12 张：`A reconstruction requires 12 to 1000000 valid uploaded images.`
2. 同一 scene 内画幅和镜头必须一致，混装**在上传阶段就拒**：`Keep the same aspect ratio and lens within one scene`

**`quality:"high"` 对图片会 422 硬拒**：`quality 'high' applies only to a reconstruction imported from an INSV or OSV`。它只对 INSV/OSV 导入有效，普通照片一律用默认档。

**尺度**：`scale.json` 全部 `mode:"relative"`、`has_metric_scale=false`、`meters_per_unit=null`、`world_up:[0,-1,0]`、`world_up_source:"photos_low_confidence"`。**能看，但没有米制尺度**，必须走场地标定。

**接口**：web-scan 有公开 OpenAPI（`studio.aholo3d.cn/api/web-scan/v1/openapi.json`，632 KB）。调用链 `POST /reconstructions` → `PUT /reconstructions/{pid}/images/{fid}?sequence=N` → `POST /reconstructions/{pid}/jobs`。脚本 `tools/aholo/scan-chain.mjs`，key 只读 `AHOLO_SCAN_KEY`，日志脱敏。日配额：`projects_per_day 100`、`active_builds 3`、`import_gib_per_day 64`，不扣积分。

**两个判读细节**：`progress=1` 不是失败信号，判终态只认 `status`；`capture_seconds` 对批量导入是**入库时间窗**，不是拍摄时长。

---

## 九、户外那批：29 张在任何合法形态下都提交不了（2026-11-06）

**29 张全量传到第 11 张被拒**（画幅不一致）；按画幅分组后，同画幅组只有 **10 张**，建 job 时报 12 张门槛。**没有 job、没有产物**，所以不存在「户外 vs 室内」的 scale 对比。

**四条根因，全是素材侧的**：
1. 跨 3 个不相关场地（17:45 神像 / 19:10 广场 / 19:33 茶室，时间跨 1h52m）。
2. 4 种画幅混装：9:16 十张 / 8:3 六张 / 16:9 八张 / 1:1 五张——中途切了变焦或画幅模式。
3. 真正户外的只有 12 张，且连续组仅 10 张。
4. GPS 全 0。

**给拍摄端的硬规范**：一个场地一次拍完；锁死单一画幅（16:9 或 3:4），全程不变焦、不切模式；连续绕场走拍，同一物体覆盖左/正/右三面；**≥40 张起步、≥80 张留余量**；别把多趟拍摄混进同一目录。

证据：`docs/evidence/aholo/scan-outdoor-29/outdoor-blockers.json`、`scan-fail.json`。

---

## 十、雕塑：能动了，但只能鞠躬，走不了路（2026-11-06）

**Aholo 侧绑骨三次全拒**，`MODEL_NOT_RIGGABLE`：`主体为类人形角色，但双臂弯曲抱于身前，不符合可绑骨的T-Pose或A-Pose站姿要求`。taskId 4734738 / 4736139 / 4736194，重试额度用尽（原始三条原文见第六段）。

**派生双臂张开的 T-Pose 版本也没救**：宽度 0.846 → 1.406 m，自动权重覆盖率 **0**——手臂与袍身是同一张融合网格，没有可独立驱动的部件。

**UniRig 本机跑不了**：RTX 3050 Ti Laptop、显存 4 GB / 可用 1.9 GB，UniRig 需 ≥8 GB，`flash_attn` 无 Windows 轮子。**没装任何东西。**

**最终有效的产物是外部绑的**：`docs/evidence/aholo/sculpture-rig-local/sculpture-local-rig.glb`（1,217,480 B）。

| 核验项 | 实测 |
| --- | --- |
| 蒙皮 | 1 个 skin，`JOINTS_0` / `WEIGHTS_0` 齐全 |
| 权重覆盖 | 19,922 / 19,922 = **100%** |
| 动画 | clip `Sculpture_Small_Bow` 2.0 s |
| 位移 | 第 25 帧最大 13.6 cm，9,409 顶点在动 |
| 循环 | 首尾归零，可循环 |

**局限写死**：只有 4 根骨（`base → torso → head / folded_arms`），`folded_arms` 只管 533 顶点（**2.7%**），所以只能整体鞠躬/起伏，**走不了路**。副作用：几何被垂直居中，bbox z −0.9…+0.9，**不再底面贴地**。

**接入位置**（行号按本轮）：
- `frontend/components/room-organizer/lib/glb-assets.ts`：CachedAsset 约 L15、加载约 L96-97 / L282-285、`SkeletonUtils.clone` 约 L119、非均匀缩放约 L161、`createCachedGlbModel` 约 L165-199、dispose 约 L230。
- `frontend/components/room-organizer/hooks/use-three-scene.ts` 约 L217-234；**L229 的 dirty-flag 早退必须让动画续跑**（`mixer.update(dt)` 要放在早退之前或之外）。
- 非均匀缩放任要改等比方案，否则鞠躬幅度在 X/Z 方向会被拉伸。

---

## 十一、环境与机器状态（2026-11-06 收口）

**Blender 安装版**在 `D:\Program Files\Blender Foundation\Blender 4.5\`，**932,388,214 B / 5,732 文件**，`--version` = `Blender 4.5.10 LTS / 2026-05-19`。MSI **360,173,568 B**，SHA256 `38A3F6EE…C957` 与官方一致。**便携版已删**（第六段记的 `D:\tools\blender\...` 已不存在）。

**MSI 静默安装的坑**：目录变量是 `INSTALL_ROOT`（`WIXUI_INSTALLDIR = INSTALL_ROOT`），传 `INSTALLDIR` 会**静默装回 C 盘**，不报错。

**`Start-Process` 起的 GUI 会被 job object 回收**，改用 `explorer.exe` 或 `Invoke-CimMethod Win32_Process.Create`。

**C 盘清理**：批 1 已执行，释放 **12,613,068,048 B（12.61 GB）**，C 从 34.48 GB → **46.74 GB**。含 Temp 4.88 GB（剩 504 MB 被占用跳过）、回收站 2.75 GB 全清、codex-runtimes 1.69 GB、npm+pip 1.91 GB、四个更新包 1.85 GB。
- 批 2（需关 Chrome / Qoder / ACE Studio，约 **6.8 GB**）**未执行**。
- 批 3（迁移飞书 13.38 GB、腾讯 3.03 GB、豆包 2.05 GB 到 D 盘）**未执行**。
- 批 2、批 3 都需用户批准后再动。

---

## 十二、遗留与待决（2026-11-06）

- **空 reconstruction 待清理**：`dd4bac7a824644578678bd28583a927d`、`68779929750445f8a94068ec227e85a3`，以及 `0939269611ae48e5b9d1d8e2f0b7f663`（躺着 10 张图、无 job、无产物）。**等用户点头再删。**
- **`docs/evidence/` 的 ignore 规则被放宽成整个目录**（同第五段那条），删除**不能从 git 恢复**，需收窄回 `docs/evidence/aholo/` 之类的白名单。
- **当前 Chrome 是临时 `user-data-dir` 的 CDP 窗口**，原始 Chrome 未恢复；网页对照重启前先恢复到用户自己的会话。
- **61.6 MB 的 spz 尚未标定尺度落进西湖画布**（登记率 29.2% 那组，见第八段）。
- **`docs/55` 编号仍空着**（原计划写 Studio 生成链路逆向规格）。

> 下次开新会话第一句：先读 HANDOFF.md。
