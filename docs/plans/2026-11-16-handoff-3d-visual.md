# 幕景 3D 视觉 spec：人物 / 道具 / 灯光 / 动作 / B2 验收

> 性质：**只读视觉审计 + 规范草案**。本轮不改代码、不生成新资产、不调用任何付费生成、不扣费。
> 基线：`fix/outdoor-walk-control` @ `b997da81`，工作树有并行未提交改动（含 `outdoor-plan-3d.tsx`、`use-outdoor-walk.ts`）。
> 本文所有结论都标了证据等级：
> - **[A] 代码/文件直接读到**：可复现，但不等同于真机视觉通过。
> - **[B] 计划文档记录**：来自 `2026-11-16-people-asset-pipeline.md` / `2026-11-16-main-sync-and-prop-actions.md`，未在本轮重新全量核验。
> - **[C] 必须真人看**：骨骼朝向、材质观感、遮挡、贴地观感、LOD 切换手感等，单测覆盖不到。

---

## 0. 一页结论

| 审计项 | 结论 | 一句话依据 |
| --- | --- | --- |
| 人物比例 | **不统一** | 室内漫游玩家按 **1.65 m**，目录人物 / 户外人群 / 户外玩家按 **1.75 m**；同一个人换场景会矮 10 cm [A] |
| 人物朝向 | **代码口径统一为 +Z，资产未验证** | 程序化人形明确“facing +Z”，路线/机位都按 `forward=(sin yaw, cos yaw)`；GLB 归一化只缩放/居中，没有旋转补偿 [A][C] |
| 脚底基准 | **平地基本统一，地形/台面不统一** | 所有 GLB 实例脚底归零；户外玩家固定 `baseY=0.052`，**完全忽略 `frame.y` 与地形高度** [A] |
| 坐姿 | **不统一** | 玩家按“坐姿头顶高度”对齐，NPC 按“髋关节到椅面”对齐；两套锚点、两套缓存 [A] |
| 第三人称镜头 | **参数统一，构图未定义** | 共用 `VIEW_RIG_OFFSETS`（后拉 4 m / 右偏 0.65），但没有“人物占画面多少、头部留白多少”的验收口径 [A] |
| 道具尺度 | **大体可信，局部偏大/偏浮** | 摊位柜台 0.95、帐篷柱 2.15、厕所 2.25 与 1.75 人协调；舞台台面 0.7 偏高且无踏步；缺失 3D 的设施用 8 cm 悬浮贴纸 [A] |
| 道具材质/颜色/风格 | **不统一** | 三套材质家族：程序化纯色低模、GLB PBR、写实人物贴图；同一场景里没有统一色彩/粗糙度基准 [A] |
| 灯光/阴影 | **不统一，且户外没有阴影** | 室内 ACES + 2048 阴影贴图；户外只设 sRGB，**没有 toneMapping、没有 shadowMap、太阳不 castShadow** [A] |
| 地面接触感 | **有系统性缺陷** | 户外无接触阴影；室内高面数人物可能被 `degradeOversizedGlb` 关掉投影/接收阴影 [A，需真机确认] |
| 近景/远景 LOD | **未接通** | 27 个 far 档 GLB 已上传，但前端 **零引用** `people/lod1`，运行期永远取 hero；当前树也没有 `lib/asset-lod.ts` [A][B] |
| talk / wave | **没有资产，也没有接通** | 16 个 labor crowd GLB 按 E7c 逐个解析只有 `Idle_Loop` / `Walk_Loop`（本轮抽检一致）；`talk: null` 保留；wave 全仓无 clip；按 E 只会回退 idle + 短提示 [A][B] |
| 坐/起身过渡 | **没有 clip，靠交叉淡入** | `Stand_To_Sit` / `Sit_To_Stand` 名字保留但永远取不到；上游明确拒绝这些 id [B] |

**一句话结论**：当前 3D 的“人”能站、能走、能坐，但**比例、坐姿锚点、阴影、LOD、talk/wave 五件事没有形成统一视觉口径**；其中 talk/wave/LOD 不是“待优化”，是**没有交付**，B2 不能按“已接通”验收。

---

## 1. 审计范围与证据

### 1.1 读过的材料

| 类别 | 文件 |
| --- | --- |
| 计划 | `docs/plans/2026-11-16-people-asset-pipeline.md` |
| 计划 | `docs/plans/2026-11-16-main-sync-and-prop-actions.md` §B2.4a、§E1、§E3–E7c |
| 交接 | `docs/plans/2026-11-16-handoff-people-walk.md` |
| 人物 | `three/people-model.ts`、`three/people-anim.ts`、`three/glb-assets.ts`、`three/outdoor-player-avatar.ts`、`hooks/use-walk-avatar.ts`、`builders/builders-people.ts`、`builders/human-figure.ts` |
| 道具 | `three/plan-props-builder.ts`、`three/furniture-builders.ts`、`three/plan-model-layer.ts`（入口）、`lib/constants.ts` |
| 灯光/材质 | `three/lighting.ts`、`three/render-look.ts`、`three/scene-lighting.ts`、`components/outdoor-plan-3d.tsx` 的 renderer / light / avatar 段 |
| 漫游 | `hooks/use-outdoor-walk.ts`、`lib/walk-view-modes.ts`、`lib/walk-seat.ts`、`lib/seat-placement.ts` |
| 资产 | 本地 `.cache/aholo/upload/people/*.glb` 16 个 labor GLB 的 JSON chunk |

### 1.2 GLB 实测（只读解析，不解码 meshopt）

样本 `7a9f1e21-8c34-4d52-a101-b00000000001.glb`：

| 项 | 实测 |
| --- | --- |
| 节点 / 蒙皮 | 54 nodes / 1 skin |
| 动画 | `Idle_Loop`（2.50 s）、`Walk_Loop`，各 53 通道 |
| 骨骼 | `mixamorig:Hips …`，Mixamo 标准 52 关节 |
| 必需扩展 | `EXT_meshopt_compression`、`EXT_texture_webp`、`KHR_mesh_quantization` |
| 根节点 | `Armature` + `geometry_0`，**没有额外旋转** |

E7c 记录 16 个 labor GLB **逐个解析均只有 2 条 clip**；本轮抽检 a101 复核一致。计划文档记录的 27 个 hero 资产是 **3 条**（含 `Sit_Idle_Loop`）——这两批不是同一份资产，**验收必须逐资产查，不能按“27 个都有”推断**。

> 未做：远程 R2 的 hero/far 逐字节回读、浏览器实机截图、meshopt 解码后的真实包围盒。绝对单位受 `KHR_mesh_quantization` 影响，不能拿 accessor min/max 直接当米；运行期以 `normalizeGlbInstance` 的包围盒归一为准。

---

## 2. 人物：比例、朝向、脚底、坐姿、第三人称

### 2.1 比例：三套身高并存

| 使用场景 | 标称身高 | 代码位置 | 后果 |
| --- | --- | --- | --- |
| 物料目录「成人」 | **1.75 m** | `lib/constants.ts:163` | 2D/3D 摆人、碰撞、标注的基准 |
| 程序化人形 | **1.75 m** | `builders/human-figure.ts:5` `FIGURE_HEIGHT` | 兜底人形与目录一致 |
| 室内漫游玩家 | **1.65 m** | `hooks/use-walk-avatar.ts` 构造 `FurnitureItem` 时 `height: 1.65` | 同一角色进室内比户外矮 10 cm |
| 户外人群 NPC | **1.75 m** | `outdoor-plan-3d.tsx` crowd `item.height: 1.75` | 与目录一致 |
| 户外漫游玩家 | **1.75 m** | `outdoor-player-avatar.ts` `OUTDOOR_PLAYER_AVATAR_HEIGHT` | 与人群一致 |

补充：

- 绑骨 GLB 走 `normalizeGlbInstance(..., uniformScale=true)`，按 `dimensions.height / size.y` **统一缩放**；肩宽/身高比例保留，不会被三轴拉伸 [A]。
- 程序化人形按 `item.height / FIGURE_HEIGHT` 缩放；目录人物 1.75 时就是原尺寸 [A]。
- 人物碰撞盒仍用目录的 `width: 0.5, depth: 0.3`；GLB 实际肩宽可能与 0.5 m 不一致，视觉宽度与碰撞宽度没有绑定 [A]。

**判断：不统一。** 室内 1.65 是一个孤例；它会让同一个“唐女”在室内外切换时明显变矮，也会让室内坐姿眼高、门框比例、第三人称构图全部偏一档。

**规范建议**

- `SPEC-P-01`：所有人物资产、目录人物、玩家 avatar 统一 **1.75 m** 标称身高；允许 ±0.02 m 资产差异。
- `SPEC-P-02`：如需矮个/儿童角色，必须新增独立 `height` 档并在目录里显式标注，不能把 1.65 当“玩家默认”。
- `SPEC-P-03`：碰撞盒与视觉肩宽绑定；至少 `width` 取资产包围盒 XZ 的最大边，`depth` 取 0.35–0.45，不再固定 0.3。

### 2.2 朝向：代码假设 +Z，资产没有补偿

代码里所有“前”都是 +Z：

- 程序化人形注释明确 “feet on y = 0, facing +Z” [A]。
- 路线朝向 `Math.atan2(dx, dz)`，机位 `forward = (sin yaw, cos yaw)` [A]。
- 第三人称相机偏移按 `forward` 反推后向；行走时 `bodyYaw = atan2(movedX, movedZ)` [A]。
- `normalizeGlbInstance` 只做 `-center.x / -bounds.min.y / -center.z` + 缩放，**没有 `rotation.y` 修正** [A]。

**判断：口径统一，但资产是否真朝 +Z 没有视觉证据。** 如果某个 GLB 出模朝 -Z，它会倒着走，而代码不会报错、单测也发现不了（测试用假 actor）。

**规范建议**

- `SPEC-P-04`：人物 GLB 资产验收必须包含“+Z 正面、脚底 y=0、原点在双脚中间”三项；任一不满足，入仓前在资产侧修正，不在运行期加魔术旋转。
- `SPEC-P-05`：B2 必须做“向前走 5 m，看脸是否朝行进方向”的实机项；不能只看 HUD 的 `yaw` 数值。

### 2.3 脚底基准：平地靠常数，地形靠猜

| 场景 | 脚底公式 | 问题 |
| --- | --- | --- |
| GLB 归一化 | `origin.position.y = -bounds.min.y`，脚底在 group 的 y=0 | 正确，前提是资产包围盒包含脚 |
| 室内玩家 | `y = frame.y - scene.position.y - headOffset`，站立 `headOffset = 1.6` | 用固定眼高 1.6 反推脚底；模型 1.65 时脚底≈0，但眼高与模型头高不是同一基准 |
| 户外玩家 | `group.position.y = 0.052 + seatedY`，站立 `seatedY=0` | **完全不用 `frame.y`，也不读地形/台面高度**；平地正确，坡地/舞台/台阶必错 |
| 户外人群 | `crowdLayer.position.y = 0.052`，人物 local y=0 | 平地正确；人群若被放到台面/坡地，仍贴 0.052 |
| 室内人群 | 家具层 local y=0，楼层基准由场景负责 | 平地正确；跨楼层/坡地没有统一抬升层 |

关键代码事实：

- 户外场景的 `PLAN_LAYER_BASE_Y = 0.052`，模型层、场景层、人群层都挂在这个高度 [A]。
- 户外玩家控制器注释明确“脚底固定 `baseY`，落座用实测 `sitHeadY` 对齐” [A]。
- `OutdoorWalkFrame.y` 是 **眼高 1.6 m**（`use-outdoor-walk.ts` 默认 `eyeHeight = 1.6`），不是脚底高度 [A]。
- 户外控制器 `setFrame` 的 `group.position.set(frame.x, baseY + seatedY, frame.z)` 只在落座时用 `frame.y`，站立时丢弃 [A]。

**判断：平地统一，非平地不统一。** B2 的“脚底贴地，不悬空、不沉 5.2 cm”只在**平地**成立；一旦走到舞台、台阶、坡地或垫高平台，脚底不会跟随。

**规范建议**

- `SPEC-P-06`：定义 `groundY(x,z)` 为“地形高度 + 层基准”，所有人物（玩家/NPC）脚底 = `groundY`；禁止再用固定 `baseY` 代替。
- `SPEC-P-07`：第一版可以限制“漫游只允许平地”，但必须在碰撞/边界里显式拦舞台与台阶，不能让人走上去再穿模。
- `SPEC-P-08`：坐姿脚底单独校验：坐姿 clip 的脚不一定落在 y=0，必须允许“脚略前伸/略离地”，但不能整只脚陷进地面。

### 2.4 坐姿：两套锚点、两套缓存

当前有两条坐姿链：

| 链路 | 对齐方式 | 代码 | 结果 |
| --- | --- | --- | --- |
| 玩家（室内/户外） | 量 `sitHeadY`（坐姿第 0.6 s 的 head 世界高度），`group.y = seatEyeY - sitHeadY` | `use-walk-avatar.ts`、`outdoor-player-avatar.ts` | 头对齐“坐姿眼高” |
| NPC（静态岗位人物） | 量坐姿 `hipsRelY`，`group.y = baseY + (seatHeight - hipsRelY)` | `people-anim.ts:109` | 髋对齐椅面 |

问题：

1. **锚点不同**：玩家保证“眼睛在椅面上方 0.63 m”，NPC 保证“髋在椅面上”。同一把椅子、同一个模型，玩家和 NPC 的屁股高度可能差几厘米。
2. **缓存不同**：玩家 `sitHeadY` 每个 actor 只量一次；NPC `sitLift` 每个 group 只量一次。NPC 换到另一把不同高度的椅子且保持坐姿时，`setSeated` 只更新 `seatHeight`，**不会清 `sitLift`**，会继续用旧抬升 [A]。
3. **没有过渡 clip**：`Stand_To_Sit` / `Sit_To_Stand` 永远取不到；只靠 0.18–0.25 s 交叉淡入。站立→坐下的前 0.15 s，腿会从站姿直接插到坐姿，容易穿椅面。
4. **没有脚部 IK**：坐姿脚的位置由 clip 决定，不同椅高会悬空或陷地。

**判断：不统一。**

**规范建议**

- `SPEC-P-09`：统一以 **髋关节到椅面** 为唯一坐姿锚点；玩家和 NPC 共用同一测量函数。
- `SPEC-P-10`：`sitLift` 必须与 `(assetId, seatHeight)` 绑定；椅高变化或换座时清缓存重测。
- `SPEC-P-11`：v1 允许 0.2 s 交叉淡入代替 `Sit_Down`，但验收要接受“过渡期腿短暂穿椅面”；若产品不接受，必须补过渡 clip。
- `SPEC-P-12`：坐姿验收同时看“髋贴椅面、脚不陷地、膝盖不穿桌/扶手”，不能只看头高。

### 2.5 第三人称镜头：参数统一，构图无标准

`VIEW_RIG_OFFSETS` [A]：

| 档位 | 后拉 | 右偏 | 高度修正 | 第三人称 |
| --- | --- | --- | --- | --- |
| `orbit` | 0 | 0 | 0 | 否（鸟瞰） |
| `first` | 0 | 0 | 0 | 否 |
| `third` | **4.0 m** | **0.65 m** | 0 | 是 |
| `shoulder` | **1.5 m** | **0.42 m** | **−0.18 m** | 是 |

现状：

- 相机锚点是眼高 1.6 m；玩家模型 1.75 m，第三人称时相机略低于头顶，4 m 外构图通常能看全身 [A]。
- 没有“人物占画面比例”的规范；4 m 在 52° FOV 下，1.75 m 人约占画面高度的 30–40%，但没有验收阈值。
- 没有 avatar 淡出/近裁剪保护；`shoulder` 1.5 m 时相机可能贴到后脑，遮挡靠射线回退，不靠模型透明。
- 第一人称/鸟瞰隐藏 GLB 已收敛到 `outdoorPlayerPresentation`，这一点是统一的 [A]。
- 室内 `useWalkAvatar` 只负责模型，机位在 `use-walkthrough`；是否复用这套 `VIEW_RIG_OFFSETS` 本轮未核实，但室内外至少没有同源的构图验收模板 [A][C]。

**判断：镜头参数统一，但“什么算好看/能验收”没有定义；室内外也不是同一套。**

**规范建议**

- `SPEC-P-13`：第三人称 4 m 时，人物完整身高占画面 **25–40%**，头顶留白 ≥8%，脚底不贴画面下沿。
- `SPEC-P-14`：`shoulder` 1.5 m 时，后脑不得占画面 >25%，相机不得穿入头发/肩部；否则退回 `third`。
- `SPEC-P-15`：第一人称、鸟瞰、退出漫游、接管 NPC 四种状态必须同时隐藏 GLB 与胶囊体（当前纯函数已覆盖，验收按状态矩阵看）。
- `SPEC-P-16`：室内外共用一套“第三人称构图”验收模板；参数可以不同，阈值必须同源。

---

## 3. 道具：尺度、材质、颜色、风格

### 3.1 尺度：以 1.75 m 人为参照

`plan-props-builder.ts` 的构件尺寸 [A]：

| 道具 | 关键尺寸 | 与 1.75 m 人的关系 | 判断 |
| --- | --- | --- | --- |
| 帐篷 | 柱高 2.15；顶棚 0.85–1.5；檐裙 0.32 | 柱顶略高于人头顶 0.4 m | 合理 |
| 舞台 | 台面 0.70；桁架 4.1；音箱 0.95 | 台面到人大腿中段；无踏步 | **偏高，且缺踏步/坡道** |
| 市集摊位 | 柜台 0.95；顶棚 2.35；背板 1.62 | 柜台到髋；顶棚高 0.6 m | 合理 |
| 餐车 | 轮 0.34；车身 2.25；售卖窗底约 1.94 | 车窗到胸口 | 合理 |
| 移动厕所 | 厢体 2.25；门板高 1.755，中心 0.945 | 门洞净高约 1.82，头顶余量约 0.07 m | 合理但偏紧 |
| 安保岗亭 | 基座 0.22 + 亭身 2.05 + 顶 0.12 | 总高 2.39 | 合理 |
| 垃圾桶 | 高 1.0 | 到人大腿 | 合理 |
| 无 3D 模型的设施 | 地面贴纸抬升 **0.08 m** | 贴纸悬浮 8 cm | **掠射角可见“浮起”，与真模型冲突** |

补充：

- 所有程序化道具在 `fitToDeclared` 里被强制缩放到目录 `width/depth/height` [A]；如果目录尺寸与真实构件不一致，模型会被三轴拉伸（例如椅子被拉宽、桌子被压扁）。
- GLB 道具同样走 `normalizeGlbInstance`，非绑骨资产 **三轴独立缩放** 到目录尺寸 [A]；导入的餐桌/椅子比例可能被目录值改掉。
- 舞台 0.7 m 的台面在漫游碰撞里是障碍物；如果 B2 要求“能走上舞台”，当前没有踏步，会变成“看得到、上不去”。

**规范建议**

- `SPEC-R-01`：以 1.75 m 人为唯一尺度参照；所有道具标注“真实高度”，不再只写目录盒。
- `SPEC-R-02`：舞台台面 0.70 保留可以，但必须补 **2–3 级踏步或坡道**；否则验收项只写“不可上人”。
- `SPEC-R-03`（可选）：移动厕所门洞净高约 1.82，1.75 m 人可通过但余量只有 7 cm；若要做无障碍/高个角色，门洞应 ≥1.95。
- `SPEC-R-04`：没有 3D 模型的设施，贴纸抬升从 0.08 降到 **0.01–0.02**，或改成“地面色块 + 图标”不抬升；8 cm 是可见悬空。
- `SPEC-R-05`：GLB 道具禁止无条件三轴拉伸到目录盒；至少保留“等比 + 只调占地”的选项，或在资产入库时写入真实尺寸。

### 3.2 材质与风格：三套语言同场

| 家族 | 代表 | 材质 | 观感 |
| --- | --- | --- | --- |
| 程序化道具 | 帐篷、舞台、摊位、餐车、厕所、岗亭、垃圾桶 | `MeshStandardMaterial`，纯色 `PALETTE`，默认 `roughness 0.82 / metalness 0.04` | 干净、扁平、低模、像建筑模型 |
| GLB 道具 | 物料库里的桌椅/设施 | PBR 贴图，按目录尺寸缩放，可被 `item.color` 乘色 | 写实或半写实，取决于资产 |
| 人物 | 27 个 hero GLB / 16 个 labor | 2K WebP 照片贴图，206k 顶点级 | 写实，皮肤/衣服有细节 |

冲突点：

1. **人物写实 vs 道具扁平**：同一画面里人会像“贴上去的照片”，帐篷/舞台像“纸模”。这不是审美偏好，是材质语言不一致。
2. **角色色身份丢失**：程序化兜底人物用 `baseColor = roleColor` 染色；GLB 加载时 `modelItem.color = '#ffffff'`，**完全不染**。于是 GLB 一到，彩色小人瞬间变成写实角色，岗位色只剩标签 [A]。
3. **GLB 道具被乘色**：`createCachedGlbModel` 在 `item.color !== '#ffffff'` 时对所有材质 `color.multiply(tint)` [A]；带贴图的资产会被整体压暗/偏色，皮肤也会被染。目录默认色不是白色时，导入即偏色。
4. **没有材质 LOD**：2K 贴图在 50 m 外仍是 2K；`cloneOwnedGlb` 每个实例克隆材质与贴图 [A]，人群越多显存越线性涨。
5. **没有磨损/污渍/边缘高光**：程序化道具全部是“新出厂”纯色；户外场地如果有草地/土地/雨天，塑料感会更强。

**规范建议**

- `SPEC-R-06`：确定一条主风格。建议 **“写实人物 + PBR 主道具 + 远处扁平道具”** 的三层策略，而不是让所有道具都停在纯色低模。
- `SPEC-R-07`：角色色只用于 **标签/小配件/围裙/胸牌**，不染皮肤；GLB 人物保持原贴图。
- `SPEC-R-08`：GLB 道具的 `item.color` 默认必须是 `#ffffff`；只有用户显式改色才乘色，且乘色前排除皮肤/植被类材质。
- `SPEC-R-09`：近景 10 m 内的主道具（舞台、摊位、帐篷、餐车）至少有一张 PBR 贴图或程序化磨损；远景可继续纯色。
- `SPEC-R-10`：人物与道具共用同一套色彩管理（见 §4.1），否则室内外/编辑器/分享页会三套颜色。

---

## 4. 灯光、阴影、地面接触、LOD

### 4.1 室内外不是同一条渲染管线

| 项 | 室内编辑器 | 户外 3D |
| --- | --- | --- |
| 色彩空间 | sRGB | sRGB [A] |
| 色调映射 | **ACES Filmic**，exposure 1.05（`render-look.ts`） | **未设置**，Three 默认 `NoToneMapping` [A] |
| 阴影 | `shadowMap.enabled = true`，PCF，2048 | **未开启 `shadowMap`** [A] |
| 主光 | Directional 1.05，`castShadow = true`，正交范围 ±24 m，bias −0.0005（`lighting.ts:33-46`） | Directional 1.15，**没有 `castShadow` / shadow camera** [A] |
| 补光 | Hemisphere 0.55 + ambient + spots（事件光照） | Hemisphere 1.05，无 ambient/spot [A] |
| 雾 | 场景预设 | `Fog(25000, 90000)`，只影响极远 [A] |
| 地面 | 地板/草地网格，接收阴影 | 纸面是 `MeshBasicMaterial`；底图瓦片未见 `receiveShadow` 路径，**没有接收阴影的地面材质** [A] |

**后果：**

- 同一个 GLB 人物，在室内有 ACES 压高光、暖色主光、接触阴影；到户外变成无 tone mapping、无阴影、强半球光。**颜色和明暗会明显不同**，不是“同一资产同一观感”。
- 户外所有道具虽然 `castShadow=true`，但没有灯接收阴影，**等于不投影**。人物脚底再准，也会像“贴”在地图上。
- 室内人物阴影还有一个隐藏闸门：`degradeOversizedGlb` 对 **顶点数 > 80,000** 的网格直接 `castShadow = false; receiveShadow = false` [A]。计划文档记录 hero 人物单资产 **206,192 顶点** [B]，如果属实，**所有 hero 人物在室内也不会投影/接收阴影**。这条必须以真机截图确认，但代码路径已经存在。

### 4.2 地面接触感

当前没有独立的接触阴影/环境光遮蔽方案：

- 没有 blob shadow、没有 decal、没有 SSAO/GTAO。
- 室内靠 Directional shadow map；户外没有。
- 纸面是 unlit 材质；底图瓦片也没有 `receiveShadow` 路径，阴影即使开启也不会落在上面。
- 人物脚底与地面的“接触”只靠几何位置，不靠明暗。

**规范建议**

- `SPEC-L-01`：室内外统一色彩管线；至少户外也走 `applyRendererLook`（ACES + sRGB + PCF）。
- `SPEC-L-02`：户外开启 shadowMap，太阳 `castShadow`；阴影相机范围按场地包围盒算，不能照搬室内 ±24 m。
- `SPEC-L-03`：给每个近景人物加 **接触阴影**（blob/decal 或运行时 shadow map 二者之一）；没有接触阴影，B2 的“贴地”只能算几何通过，视觉不算通过。
- `SPEC-L-04`：重新评估 80k 顶点关阴影的阈值。人物 206k 顶点是正常资产，不应和“生成模型防爆显存”共用一条规则；建议按 **资产类别 + 距离** 决定，而不是按顶点数一刀切。
- `SPEC-L-05`：阴影分级：近景 3 个 hero 投影；中景人群只接收不投影或 blob；远景不投影。

### 4.3 LOD：far 档已上传，但运行时没用

事实：

- 计划文档记录：27 个 hero（≤3.54 MB / 382,720 三角面） + 27 个 far（≤2.46 MB / 236,326 三角面），已上传 R2；hero 覆盖 `people/<id>.glb`，far 在 `people/lod1/<id>.glb` [B]。
- 前端 **没有任何 `people/lod1` 引用**；`grep` 全 `frontend/` 零命中 [A]。
- 当前树没有 `lib/asset-lod.ts`；计划文档提到的 `shouldRejectAsset` / 0.18 / 0.06 在本工作树不存在 [A]。
- 所有人物加载都走 `ensureGlbAsset(assetId, glbUrl)`，URL 由 `walkRoleGlbUrl()` / crowd 资产给出，**没有距离或档位参数** [A]。
- `GLB_DOWNLOAD_SLOTS = 2`，下载并发只有 2 [A]；人群 N 个 hero 会排队。
- `cloneOwnedGlb` 每个实例克隆 geometry / material / texture [A]；2K 贴图 × N 个实例，显存线性增长。

**判断：LOD 数据层完成，运行层未交付。** 不能在 B2 里写“LOD 已接通”；最多写“far 资产已上传，前端未消费”。

**规范建议**

- `SPEC-L-06`：定义 LOD 切换距离。建议：相机到人 **<12 m 用 hero，12–35 m 用 far，>35 m 用 billboard/impostor 或隐藏**。
- `SPEC-L-07`：LOD 切换不能闪烁；用 0.5–1 m 滞回，切换时保持同一 mixer 时间比例（或直接 crossfade 0.15 s）。
- `SPEC-L-08`：人群超过 8 人时，强制 far 或 instancing；不能 8 × 382k 三角面 + 8 × 2K 贴图全开。
- `SPEC-L-09`：在 Network 面板必须能看到 `lod1` 请求才算接通；只看到 `people/<id>.glb` 就是没接通。

---

## 5. 动作 clip 与资产缺口

### 5.1 现有 clip 矩阵

| 资产族 | idle | walk | sit | talk | wave | 坐/起身过渡 |
| --- | --- | --- | --- | --- | --- | --- |
| 程序化人形（兜底） | 关节摆动 | 关节摆动 | 无 | 无 | 无 | 无 |
| 本地 `assets/people.glb` | `Idle_Loop` | `Walk_Loop` | **无** | `Idle_Talking_Loop` | 无 | 无 |
| 16 个 labor crowd GLB（本地实测） | `Idle_Loop` | `Walk_Loop` | **无** | **无** | **无** | 无 |
| 27 个 hero 角色（文档记录） | `Idle_Loop` | `Walk_Loop` | `Sit_Idle_Loop` | **无** | **无** | 无 |
| 户外玩家控制器 | 有 | 有 | 有（若资产带） | **故意不暴露** | **故意不暴露** | 无 |

> 注意 16 labor 与 27 hero 的差异：本地 labor 实测 2 条，文档 hero 记录 3 条。**不能把“27 个都有 sit”套到 labor 人群上。**

### 5.2 已确认的“没有”

1. **talk 在 crowd 上被显式置空**：`outdoor-plan-3d.tsx` 注册 crowd 时 `talk: null`；注释明确“不能把交谈写成已接通” [A]。
2. **wave 全仓没有 clip**；舞台按 E 请求 `wave`，`resolvePersonAction` 回退 `idle`，HUD 出“缺片段”提示 [A]。
3. **玩家 avatar 没有 talk/wave API**：`OutdoorPlayerAvatarAction = 'idle' | 'walk' | 'sit'` [A]；E 键只驱动最近 NPC，不驱动玩家。
4. **坐/起身过渡没有**：`Stand_To_Sit` / `Sit_To_Stand` 只是命名预留，`applyAction` 取不到 clip 就安静返回 [A][B]。
5. **没有 emote / point / guide / carry / phone** 等岗位动作；舞台、导览、安保、保洁都只能 idle/walk。
6. **没有 idle 变体**：所有人站久了都是同一个 `Idle_Loop`，相位只靠 `stanceSeed` 错开 [A]。

### 5.3 不能用 idle 冒充的判定

当前代码的诚实度是够的：

- `resolvePersonAction(requested, clips)` 缺片段回退 `idle`；`personActionState.current` 会显示 `idle`，不是 `talk` [A]。
- HUD 出 `outdoor-action-note` 短提示（1.8 s）说明“缺哪种 clip” [A]。
- 因此：**“按 E 有提示” ≠ “交谈已接通”**。

B2 的判定必须写成：

| 情况 | 判定 |
| --- | --- |
| 按 E 后人物肩膀/头/手有明显非 idle 动作，持续 ≥1.5 s | 可判 talk/wave PASS（还要确认 clip 名） |
| 按 E 后只有 HUD 提示，人物仍 idle | **BLOCKED（缺资产）**，不是 PASS |
| 按 E 后无提示、无动作 | FAIL（交互链断） |
| 玩家自己没有任何动作，只有 NPC 动 | 若产品定义“对 NPC 交谈”，可接受；若定义“玩家交谈”，FAIL |

**规范建议**

- `SPEC-A-01`：talk / wave 必须是“可见身体动作 + clip 名可核”两项同时满足；缺一不可。
- `SPEC-A-02`：缺片段时保留提示，但 UI 文案不能写“正在交谈/正在挥手”；建议写“这个角色暂无交谈动作”。
- `SPEC-A-03`：v1 至少给 **3–5 个主角色** 配 `Idle_Talking_Loop`，不要 27 个全做；舞台 wave 至少 1–2 个角色。
- `SPEC-A-04`：坐/起身过渡可以用交叉淡入替代，但必须在验收里注明“过渡期可能穿椅面”；不能写“过渡已交付”。

---

## 6. 必须设计拍板的事项

> 下列每一项都会改变实现或验收口径；未拍板前，按“当前默认行为”记录，不擅自扩 scope。

| # | 问题 | 选项 | 建议 | 不拍板的后果 |
| --- | --- | --- | --- | --- |
| D1 | 桌边按 E，谁交谈？ | A 玩家自己；B 最近 NPC；C 两者都 | **B 为主，玩家坐下时才 A**；玩家 talk 需先有 clip | 当前是 B，但玩家永远不动；用户会以为“玩家不会说话” |
| D2 | 舞台挥手是否是交付项？ | A 必须；B 只做提示；C 删掉 E 文案 | **A 或 C，不能 B 长期挂着** | 现在按 E 只回 idle + 提示，舞台像“坏了” |
| D3 | 人物统一身高？ | A 全 1.75；B 保留 1.65 室内；C 按角色分档 | **A** | 同角色室内外差 10 cm，坐姿/门框全偏 |
| D4 | 坐姿锚点？ | A 髋对椅面；B 头对眼高；C 两套 | **A，玩家/NPC 共用** | 玩家和 NPC 坐同一把椅子高度不一致 |
| D5 | LOD 是否本期要求？ | A 必须 far 切换；B 只上传不接；C 限制人数 | **A（至少人群 >8 强制 far）** | 8 个 hero = 300 万三角面 + 16 张 2K 贴图 |
| D6 | 阴影预算？ | A 近景 hero 投影；B 全关；C 全开 | **A** | 户外全无阴影；室内 hero 可能被 80k 阈值关掉 |
| D7 | 主风格？ | A 写实人物 + PBR 主道具；B 全写实；C 全低模 | **A** | 人物像照片、道具像纸模，画面不成立 |
| D8 | 角色色怎么保留？ | A 只标签；B 小配件；C 染衣服 | **B** | GLB 一到岗位色消失，现场认不出角色 |
| D9 | 缺 clip 的提示文案/时长？ | A 1.8 s 短提示；B 常驻角标；C 不提示 | **A + 属性卡常驻“无此动作”** | 用户按 E 只看到一闪而过的提示，以为没反应 |
| D10 | 刷新是否保留当前角色？ | A 保留；B 回默认 | **A（产品要求）或明确写 B** | 当前刷新回“唐女”，B2 第 5 条会 FAIL |

---

## 7. B2 真人验收清单（看什么、在哪看、什么算过）

### 7.1 前置

- 真人登录 + 有 anchor / boundary 的样例项目（如 `house-uat5t1nz` 或同等）；至少 8 个 workers、1 个桌/摊位、1 个舞台、1 把椅子。
- `cd frontend; npm run dev`；Chrome 1440×900；DevTools 开 Network / Console。
- 进入 `/editor?r=1`，切户外 3D；漫游角色选一个 ready 角色。
- 关键锚点：`data-testid="outdoor-walk-hud"`、`outdoor-walk-view`、`outdoor-interact-hint`、`outdoor-action-note`。
- dev-only 探针：`window.__scendancePlan3dDebug.avatar` → `{ role, mode: 'glb'|'capsule', visible, action, seated }`。
- Network 过滤：`people/`、`lod1`、`.glb`。
- 注意：`sc-walk-avatar-controls` 是**室内** `walkthroughActive` 的控件，不是户外换角色入口；户外换角色走左侧「物料」的漫游角色分组。

### 7.2 验收项

| # | 看什么 | 在哪看 / 怎么操作 | 什么算过 | 什么算不过 |
| --- | --- | --- | --- | --- |
| V1 | GLB 是否真的加载 | 进 3D（不必先漫游），Network 过滤 `people/` | 出现当前角色 `people/<assetId>.glb`；`avatar.mode === 'glb'` | 只有胶囊体；404/超时；`mode === 'capsule'` |
| V2 | 人物身高 | 第三人称站在摊位/帐篷旁，截图含 0.95 m 柜台、2.15 m 帐篷柱 | 头顶接近 1.75 m 参考；与柜台/柱比例不跳 | 比 1.75 参考矮/高 >3 cm；和室内同一角色差 10 cm |
| V3 | 脚底贴地（平地） | 第三人称，脚部特写，地面有网格/砖缝 | 鞋底与地面间隙 ≤2 cm；不沉入 | 悬空 >5 cm；鞋底埋地；整个人像贴片 |
| V4 | 朝向 | 向前走 5 m，再从侧后方看 | 脸/胸朝行进方向 ±15°；不是倒着走 | 背朝行进方向；横着滑行；原地转圈 |
| V5 | 第三人称构图 | `third` 档，4 m 外，截图 | 全身可见；身高占画面 25–40%；头顶留白 ≥8%；脚不切边 | 头被切；人只占 10%；相机穿进身体 |
| V6 | 第一/鸟瞰隐藏 | 按 `outdoor-walk-view` 或 `F5` 循环 | 第一/鸟瞰 `avatar.visible=false`；切回 third 恢复；相机不穿模 | 第一人称还看到后脑；鸟瞰留下半透明人影 |
| V7 | 玩家坐姿 | 走到椅子按 E 坐下，侧面截图 | 髋贴椅面（≤3 cm）；脚不陷地；膝盖约 90°；不穿扶手 | 屁股悬空/陷进椅面；脚穿地；整个人浮在椅子上 |
| V8 | 玩家/NPC 坐姿一致 | 同一把椅子，先玩家坐，再让 NPC 坐（或反过来） | 两者髋高差 ≤3 cm；头高差 ≤5 cm | 一个坐垫上、一个坐垫下；NPC 换椅后还停在旧高度 |
| V9 | 道具尺度 | 站在舞台/摊位/厕所/垃圾桶旁，平视截图 | 舞台台面 0.70±0.05；柜台 0.95±0.05；厕所 2.25±0.08；垃圾桶 1.0±0.05 | 柜台到腰以上；舞台到胸口；厕所门顶头；垃圾桶到腰 |
| V10 | 材质/颜色一致性 | 同一角色室内截图 vs 户外截图；同一道具近景/远景 | 肤色不被岗位色染；室内外色相不突变；近景无糊图 | 室内暖、户外灰；皮肤发绿/发红；2K 贴图在 2 m 内仍糊 |
| V11 | 阴影/接触感 | 晴天/默认光照，人物脚边近景 | 脚下有接触阴影；阴影方向与太阳一致；不“浮” | 完全没有影子；影子只在一只脚；影子方向相反 |
| V12 | 人群 LOD | 8 人以上人群，相机从 5 m 拉到 30 m，Network 过滤 `lod1` | 近距离 hero；远距离出现 `lod1` 请求或明显降面；切换不闪 | 永远只有 `people/<id>.glb`；30 m 外仍是 382k 面；切换闪白 |
| V13 | 桌/摊位 talk | 走到桌/摊位，按 E；看人物肩膀/头/手 | 有非 idle 动作 ≥1.5 s；clip 名可核；不是只有 HUD 提示 | 只有 `outdoor-action-note`；人物仍 idle；玩家完全不动 |
| V14 | 舞台 wave | 走到舞台，按 E | 有可见挥手/抬臂动作；不是 idle | 只出“缺片段”提示；人物仍 idle |
| V15 | 缺片段诚实性 | 对没有 talk 的角色按 E | 明确提示“暂无该动作”；不写“正在交谈” | 文案写“交谈中”但人不动；静默无反应 |
| V16 | 换角色/刷新 | 左侧物料换角色；退出漫游→2D→3D→刷新 | 旧 GLB 消失、新 GLB 出现、不叠加；刷新后仍是当前角色 | 两个模型叠在一起；刷新回“唐女”；WebGL/mixer 报错 |
| V17 | 性能 | 8 人人群 + 近景，1440×900，DevTools Performance | ≥30 FPS；显存不持续涨；无长任务 >200 ms | <20 FPS；每次换角色显存 +几百 MB；风扇狂转 |

### 7.3 判定规则

- **PASS**：可见动作/尺寸/构图达标 + 截图或 30–60 s 录屏 + Console 无未捕获异常。
- **FAIL**：可见偏差超过阈值，或行为与文案不符。
- **BLOCKED**：缺登录/样例项目/资产/网络；**BLOCKED 不得写成 PASS**。
- **N/A**：功能不在本期 scope，必须显式列出，不能用 N/A 掩盖缺失。

### 7.4 已知陷阱（验收时直接写进备注）

1. **刷新回默认角色**：`walkRoleId` 是 `useState(DEFAULT_WALK_ROLE_ID)`，没有持久化；刷新会回“唐女”，V16 按实际记录 FAIL/备注。
2. **talk 仍然是 null**：16 个 labor GLB 只有 Idle/Walk；不要因为 HUD 有提示就判 PASS。
3. **wave 永远回 idle**：舞台按 E 只会出“缺片段”提示；V14 只能 BLOCKED 或 FAIL。
4. **LOD 没接通**：Network 永远看不到 `lod1`；V12 按 FAIL（未实现）记录，不要写“已优化”。
5. **户外无阴影**：V11 很可能 FAIL；这是管线缺失，不是单个资产问题。
6. **室内 hero 可能无阴影**：如果 206k 顶点 > 80k 阈值成立，`degradeOversizedGlb` 会关掉 cast/receive；V11 要分室内/户外两张截图。
7. **换角色会闪胶囊体**：旧 GLB dispose 到新 GLB 加载完成之间显示胶囊体是兜底，不是叠加；>2 s 才判 FAIL。
8. **`outdoor-action-note` 是失败提示，不是成功回执**。

### 7.5 证据模板

```text
时间：2026-11-__ __:__    HEAD：________    分支：________    端口：____
浏览器：________    视口：1440×900    项目：________
登录态：是 / 否        样例项目 anchor+boundary：是 / 否
当前角色：________    人群数量：____

V1  GLB 加载：PASS / FAIL / BLOCKED    mode：glb / capsule    URL：________
V2  身高：PASS / FAIL / BLOCKED        实测：____ m（参考 1.75）
V3  脚底平地：PASS / FAIL / BLOCKED    间隙：____ cm
V4  朝向：PASS / FAIL / BLOCKED        偏差：____°
V5  第三人称构图：PASS / FAIL / BLOCKED 占画面：____%  头顶留白：____%
V6  第一/鸟瞰隐藏：PASS / FAIL / BLOCKED visible：____ / ____
V7  玩家坐姿：PASS / FAIL / BLOCKED    髋-椅面：____ cm  脚：贴地/悬空/陷地
V8  玩家/NPC 坐姿一致：PASS / FAIL / BLOCKED  头高差：____ cm
V9  道具尺度：PASS / FAIL / BLOCKED    舞台/柜台/厕所/垃圾桶：____
V10 材质颜色：PASS / FAIL / BLOCKED    室内外差异：________
V11 阴影接触：PASS / FAIL / BLOCKED    室内：有/无  户外：有/无
V12 LOD：PASS / FAIL / BLOCKED        lod1 请求：有/无  远距面数：____
V13 桌/摊位 talk：PASS / FAIL / BLOCKED  动作：________  clip：________
V14 舞台 wave：PASS / FAIL / BLOCKED     动作：________  clip：________
V15 缺片段诚实性：PASS / FAIL / BLOCKED  文案：________
V16 换角色/刷新：PASS / FAIL / BLOCKED   叠加：有/无  刷新角色：________
V17 性能：PASS / FAIL / BLOCKED          FPS：____  显存：____

Console 未捕获异常：有 / 无（首条：________）
WebGL / mixer 警告：有 / 无（首条：________）
阻塞原因：________
结论：PASS / FAIL / BLOCKED（BLOCKED 不得写成 PASS）
```

---

## 8. 资产清单

### 8.1 已有

| 资产 | 数量/规格 | 状态 | 用途 |
| --- | --- | --- | --- |
| hero 人物 GLB | 27 个，≤3.54 MB，382,720 面，52 关节，2K WebP | R2 已上传 [B]；本地未全量回读 | 近景主角/玩家/NPC |
| far 人物 GLB | 27 个，≤2.46 MB，236,326 面，1K WebP | R2 已上传 [B]；**前端零引用** [A] | 远景人群（未接通） |
| 16 个 labor crowd GLB | 本地 `.cache/aholo/upload/people`，仅 Idle/Walk | 已实测 [A] | 岗位人群 |
| `assets/people.glb` | 本地兜底，Idle/Talk/Walk，无 Sit | 已存在 [B] | 室内程序化/兜底 |
| 程序化人形 | 1.75 m，关节摆动 | 已存在 [A] | 模型未加载时兜底 |
| 程序化道具 | 帐篷/舞台/摊位/餐车/厕所/岗亭/垃圾桶 | 已存在 [A] | 2D 设施 → 3D 低模 |
| GLB 道具 | 物料库 | 已存在 | 桌椅/设施真实模型 |

### 8.2 待补（按优先级）

| # | 资产/能力 | 优先级 | 说明 | 是否需付费/拍板 |
| --- | --- | --- | --- | --- |
| A1 | `Idle_Talking_Loop`（3–5 个主角色） | **P0** | 桌/摊位交谈的唯一前提；不能再用 idle 冒充 | **需真人授权重定向/积分** |
| A2 | `Wave` 一次性动作（1–2 个角色） | **P0** | 舞台交互的唯一前提；没有就删舞台 E 文案 | **需授权** |
| A3 | LOD1 运行期切换 | **P0** | far 已上传，缺代码；不是资产问题 | 不需付费，需改代码 |
| A4 | 接触阴影（blob/decal 或 shadowMap） | **P0** | 户外无阴影；室内 hero 可能被 80k 阈值关掉 | 不需付费，需改代码 |
| A5 | 人物 GLB 入仓校验（+Z / 脚底 y=0 / 1.75 m） | **P0** | 防止倒着走、悬空、比例漂移 | 不需付费 |
| A6 | `Stand_To_Sit` / `Sit_To_Stand` | P1 | 没有也能用交叉淡入；有则更顺 | **需授权** |
| A7 | idle 变体 2–3 条 | P1 | 避免所有人同一站姿 | **需授权** |
| A8 | `Walk_Formal_Loop` | P1 | 现在优先 Formal，没有就回 Walk；正式感更好 | **需授权** |
| A9 | 角色色配件/围裙/胸牌材质 | P1 | 保留岗位识别，不染皮肤 | 需美术 |
| A10 | 舞台踏步/坡道 | P1 | 0.7 m 台面没有踏步，人上不去 | 程序化即可 |
| A11 | PBR 主道具（舞台/摊位/帐篷/餐车） | P2 | 解决“纸模感” | 需美术 |
| A12 | emote / point / guide / carry | P2 | 岗位叙事；不影响 B2 主链 | 需授权 |

### 8.3 明确不做

- 不在本轮生成任何新人物/动作资产；不调用 retarget/生成接口；不扣积分。
- 不把 `talk: null` 改成“已接通”；不把 wave 回退 idle 写成“挥手”。
- 不把“far 已上传”写成“LOD 已接通”。
- 不用程序化关节摆动冒充 GLB talk/wave。

---

## 9. 建议的修复顺序（不改代码，仅排序）

1. **先定规范**：D3（1.75 统一）、D4（髋锚点）、D6（阴影预算）、D7（材质方向）四项拍板。
2. **再补“看得见”的底层**：户外 shadowMap / 接触阴影；室内 80k 阈值按资产类别拆开；户外 ACES 与室内对齐。
3. **再接 LOD**：先按距离切 far，再做滞回；人群 >8 强制 far；Network 能看到 `lod1` 才算完成。
4. **最后补动作资产**：先 3–5 个 talk、1–2 个 wave；有 clip 后再改 `createWalkAvatar` / crowd 注册项，不要反过来先写“已支持”。
5. **B2 按本文 §7 跑**；缺资产项记 BLOCKED，不记 PASS。

---

## 10. 证据索引（文件:位置）

| 事实 | 位置 |
| --- | --- |
| 成人目录 1.75 m | `frontend/components/room-organizer/lib/constants.ts:163` |
| 程序化人形 1.75 m / 脚底 y=0 / 面向 +Z | `three/builders/human-figure.ts:5` 及文件头注释 |
| 室内玩家 1.65 m | `hooks/use-walk-avatar.ts` 构造 `FurnitureItem` 处 |
| 户外玩家 1.75 m / baseY 0.052 | `three/outdoor-player-avatar.ts:25,31` |
| 户外玩家站立忽略 frame.y | `three/outdoor-player-avatar.ts` `setFrame` |
| 户外眼高 1.6 | `hooks/use-outdoor-walk.ts:242` |
| 第三人称 4 m / 0.65 / shoulder 1.5 / −0.18 | `lib/walk-view-modes.ts` `VIEW_RIG_OFFSETS` |
| NPC 坐姿髋对齐 | `three/people-anim.ts:109` |
| 玩家坐姿头对齐 | `hooks/use-walk-avatar.ts`、`three/outdoor-player-avatar.ts` `measureSitHeadY` |
| 人物 GLB 只返回 idle/walk/sit | `three/glb-assets.ts` `createWalkAvatar` |
| crowd talk 置空 | `components/outdoor-plan-3d.tsx:1172` |
| 80k 顶点关阴影 | `three/glb-assets.ts:41-42,398-423` |
| 室内 ACES + 阴影 | `three/render-look.ts`、`three/lighting.ts:33-46` |
| 户外只设 sRGB、无阴影 | `components/outdoor-plan-3d.tsx:838,847-850` |
| 道具尺寸/调色板 | `three/plan-props-builder.ts` `PALETTE` / `buildTent` / `buildStage` / `buildKiosk` / `buildFoodTruck` / `buildToilet` / `buildPost` / `buildBin` |
| 道具强制对表 | `three/furniture-builders.ts` `fitToDeclared` |
| 贴纸抬升 0.08 | `three/plan-props-builder.ts` `STICKER_ELEVATION` |
| 27 hero / far 规格 | `docs/plans/2026-11-16-people-asset-pipeline.md` |
| 16 labor 仅 Idle/Walk | 本地 GLB JSON chunk 实测；`docs/plans/2026-11-16-main-sync-and-prop-actions.md` §E7c |
| B2.4a 原始清单 | `docs/plans/2026-11-16-main-sync-and-prop-actions.md` §B2.4a |
| 刷新回默认角色 | `docs/plans/2026-11-16-handoff-people-walk.md` §6.2 |
