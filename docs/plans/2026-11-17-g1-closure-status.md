# G1 纯函数地基收口状态 × 剩余前置清单（2026-11-17）

> 口径：只读盘点 `origin/main`，不改代码、不拆旧链。对照 `docs/plans/outdoor-map-decommission-2026-11-13.md` 的 M/R 切片路线与 §7.5 合入梯度。
> 基线锚点：main `c9706da5`（含 walls 图例切片 `84849e66`；`10a54bec` 标注工具条线已随 M7 合入，不属退役重构；M7 只动 outdoor 状态卡/标注工具，不涉及 G1 稳定面）。
> 冻结面（G1 稳定面，动 M3 前不得改）：routeBridge 九方法签名、`SitePlanData` 既有字段、`OutdoorTaskProgress`、物料生成链路入参、会话 scope 现状。

## 1. 已合入 main 的 G1 落地项

### 1.1 M1 五钮地图化 ✅
- 楼层 / 漫游 / 网格 / 测量 / 标注回调从 layoutStore 改派地图 canvas / 3D 句柄；未接住的钮置灰保留提示，不回退室内壳。
- 状态：代码完成，真机 2D/3D 已走查。

### 1.2 M4 出入口收尾 ✅
- 节点创建前置选类型（入口 / 出口 / 两用）；落点 `inferNodeZoneId` 自动归属 + 属性卡显式覆盖。

### 1.3 M5 智能体桥接扩充 ✅
- 九方法签名未动；新增 `applyWorkers` / `applyMeasurements` / `applyAnnotations` / `getLevels` / `setActiveLevel` / `addFacility` / `removeFacility` / `updateFacility`。
- 遗留：对话内各实体提案生成 + 预览确认卡链、墙体工具，随 M2 / 后续切片。

### 1.4 M2 物料与墙体（纯函数 / 契约层收口，壳体接线未接）

| 能力 | 产物 | 提交 |
| --- | --- | --- |
| 分区 / 人员 / 动线迁移 | `plan-layout-migration.ts`、`site-plan-routes.ts`、`plan-facility-mapping.ts`、`plan-facility-migration.ts`、`plan-migration-frame.ts` | 基线在位 |
| facility 注入点 | `modelOverride` / `sourceAssetId` / `libraryEntry` | `4a170700` |
| walls 契约集合 | `site-plan.ts` 可选 `walls`（points[2] / thicknessM / heightM / kind / status / color / zoneId / levelId，上限 500；旧数据不带照常解析） | `ed43c547` |
| walls 迁移执行器 | `plan-wall-migration.ts`（帧逆变换、退化/非有限数 skipped、越界字段只丢字段、中点归属分区、门窗不凭空转 node） | `ed43c547` |
| 物料库反查 | `findLibraryEntryByTemplateId`、`facilityLibrarySizeResolver` | `404f4511` |
| walls 校验纳入 refine | id 跨集合去重、levelId 图层引用、zoneId 悬空校验；补回 levelId 注入 | `4552a1d4` |
| walls 并入迁移总入口 | `migrateLayoutToPlan` 返回 `walls`，skipped `source='wall'`，复用已构建 zones | `e0b58662` |
| 数据导出带墙 | GeoJSON 墙 `LineString`（kind=wall、长/厚/高/zone）；CSV 14 列墙补充行 | `1391cc09` |
| 图例墙体组 | `buildPlanLegend` 外墙 / 内墙 / 未标类型三桶，count 段数 + 总长；PDF / PNG / share / 画布四路径共用 | `84849e66` |

**迁移覆盖登记**：levels 未迁（户外先合成单默认层，多层映射随 levels 接线）；measurements / annotations 不适用旧室内 layout；室内特化字段（WiFi/CCTV/vision cone/elevation/structural 引用/price/handoff）未迁，归属口径待决。

### 1.5 M3 会话 / 历史 / 导出（仅地基纯函数，壳体换绑属 G2）

| 子项 | 已落地地基 | 提交 | 壳体现状（G2 挂起） |
| --- | --- | --- | --- |
| 3a 会话 scope | `projectSessionScope(projectId)` 纯函数；tracker 可选 scope 源注入路径 | 基线在位 | 过渡态：activity tracker 已注入 project scope 源；主 `sessionScope` 仍 `layout.id ?? outdoorProjectIdProp` 双源回退，`legacySessionScope` 承接历史；纯 projectId 成套切换、floor/venue tracker 重绑属 G2 |
| 3b 历史 | `plan-history.ts`：栈 / 上限 30 / 规范化序列化去重，不含 React/时钟/存储；`useHistory` 已是泛型 `<T>` | `187cc4ae` | 壳体 `useHistory(layout, actions.applyLayout)` 仍绑 RoomLayout；换类型只在调用点 |
| 3c 导出 / 守卫 | GeoJSON 补测量/标注几何，CSV 补测量备注；plan-export 已有 download/dxf/print/svg/visibility/geometry | `533230c0` | 写守卫仍 `assertLayoutWrite`；plan 写守卫待 plan lease 语义 |
| 3d 回写镜像 | — | 未做 | false 侧 `shellVenuePatchFromPlanBoundary` 回写镜像保留，待真侧正源稳定后退役 |

### 1.6 质量基线台账 ✅
- `docs/quality/vitest-baseline-63b11ae1.md/.csv`：116 失败文件，列 `file,failed,total,skipped`；已知 flaky 单列。旧 `0a59f7b0` 版保留为历史快照，不再用于对照。
- 规则：台账外新失败文件、或台账内 failed 数上涨，先单独复跑仍失败才算回归；复跑须与台账同 Node 版本档（台账 v26.2.0；engines `>=24.15 <25 || >=26`，Node22 禁跑，24/26 不混跑）；里程碑后重采新锚点台账，旧台账只判增量不对照绝对数。
- 提交：`20d5c5f7`（台账）、`d2ffb4e8`（版本档 + 锚点刷新）、`e1e50cbe`（锁定 vitest 4.1.12）。

## 2. 墙体覆盖矩阵

| 层 | 状态 | 说明 |
| --- | --- | --- |
| 迁移入 plan（总入口 → walls） | ✅ | `migrateLayoutToPlan` 已接 wall 执行器 |
| CSV 墙行 | ✅ | `wallRows` |
| GeoJSON 墙 LineString | ✅ | 长 / 厚 / 高 / zone |
| 图例清单（段数 / 总长 / 内外墙） | ✅ | 共享 `buildPlanLegend` |
| 2D 画布图面墙线 | ❌ | 画布尚未消费 `plan.walls`（UI 渲染层） |
| PNG / PDF 图纸墙线 | ❌ | 图纸本体来自 2D 画布快照；图面仍无墙线，图例有计数 |
| plan 级 DXF / SVG | ❌ | 现有 `layoutToDxf` / `layoutToSvg` 是室内 layout 级，画 `floor.interiorWalls`；plan 级导出器需新建 |

## 3. 剩余缺口：按三类前置归类

### A. 等 UI / 渲染线解锁（非纯函数，不属 G1）
1. **画布消费 `plan.walls`**：2D 渲染墙线段；接住后 PNG/PDF 图纸墙线一并带出。
2. 墙体在画布的放置 / 拖动 / 选中等交互（M2 壳体接线）。
3. floor / venue tracker 订阅源从 layoutStore 重绑到 plan.levels / 边界几何（依赖 M2 levels 接线稳定）。

### B. 新功能（需新建，不属现有纯函数补全）
1. plan 级 DXF 导出器（当前只有室内 layout 级）。
2. plan 级 SVG 导出器（当前只有室内 layout 级）。

### C. 产品口径待拍板（不定，壳体接线与守卫接不上）
1. **assetId ↔ 物料库 slug 命名空间**：`FurnitureItem.assetId` 与 aholo / walk-role 共用命名空间；契约 `modelOverride` 存物料库 slug 而非 glbUrl，映射口径待核。
2. **manifest 加载链路**：oneplan 真实占地尺寸需 manifest 条目，纯函数层反推不可得，只能留注入点。
3. **室内特化字段归属**：WiFi/CCTV/锥角/elevation/structural 引用/price/handoff 落 `notes` 还是留 3D 层终稿。
4. **旧云项目投影策略**：`/editor/?project=<id>` 无 mode 读旧室内 schema，只读提示还是一次性投影到 plan（影响 R3 是否留迁移降级通路）。
5. **plan lease 语义**：影响 plan 写守卫能否 plan 化。
6. **户外两个旧预设** `lawn` / `market`：迁 SitePlan 草稿体系还是先留户外样例；8 个室内预设随 G3 整组卸，后端 preset-manifest / domain / scene-resources / backend-adapter 须成套评估。

## 4. M3 G2 挂起项（等 V1–V5 真机 flow 稳定后成套合）

- 3a 残留：主 `sessionScope` 去掉 `layout.id` 回退，纯走 `projectSessionScope(projectId)`；floor / venue tracker 订阅源从 layoutStore 重绑 plan.levels / 边界几何；遗留 `activity:` 键按域归位（creative-studio / bingo-audit-card / venue-facts-panel / floor-session-epoch / scene-delivery-note / 环境偏好键 / 评审链接）。
- 3b：`useHistory` 快照从 RoomLayout 换 SitePlanData；`commitHistoryNow` 改挂 plan 历史；apply 回写 plan 通路。
- 3c：导出全量消费 plan；写守卫 `assertLayoutWrite` → plan 写权限；环境 / 场地核对前置改地图语境。
- 3d：删 `handleOutdoorPlanChange` false 侧 layout patch；`applyOutdoorGroundBasemap` 对 layout 的 `floorPlanImage` / `sceneAnchor` 写入改挂 plan / 视图记忆。
- 成套边界：3a activity tracker scope 源、壳体 scope 拼接、agent-panel 比对须同批改，不可拆两半。

## 5. R 线退役状态（全部 ⬜，死守 M→R 顺序，不先拆旧）

| 切片 | 依赖 | 状态 |
| --- | --- | --- |
| R1 立壳入口并入地图草稿 | M3a 草稿通路 | ⬜ 未动 |
| R2 卸保活 Viewport / 室内 three/2D | M1 + M3b/3c | ⬜ 未动 |
| R3 删 layoutStore 与室内墙模型 | M2 + R2 | ⬜ 未动 |
| R4 删二分概念与回写链路 | R3 | ⬜ 未动 |

关键路径 `M3 → R2 → R3 → R4`；M3 不完成，R2/R3 不能动。

## 6. 基线债与工程卫生（验收后一次清，现在不动）

- **#12 基线债未清**：台账只是「对照是否本轮回归」的机制；失败本体（three 几何碰撞、Agent/面板夹具、静态结构断言脱节）与 tsc 类型债仍在。
- **待清理对照物**（验收后）：`feat/m2-*`、`feat/m3-*`、`feat/plan-legend-walls`、`release/*` 分支；`.worktrees/baseline-origin`、`.worktrees/legend-walls` 等临时 worktree；旧本地 `main` 分叉（`0f831efa`，落后远端）；OFM 诊断旁路 `openfreemap-evidence.ts` 的 `debug()` / `window.__ofmDebug`；`.verify-ofm-evidence.test.ts` 及散落 `.verify-*.txt` / `.tmp-*`。
- 在途并行文件（`scendance-workspace.tsx` + 测试、people/漫游线）不碰、不回灌。

## 7. 当前阶段判断

- G1 纯函数 / 契约层已基本见底：不碰壳体、不等产品口径能做的切片本轮清完。
- 下一步可控动作：推进 §3-C 待决口径拍板（哪怕先定 assetId↔slug、旧云投影两项）；其余等渲染线解锁接画布墙体、等智能体 V1–V5 flow 稳定后成套进 G2，再按依赖顺序进 R 线。
- 不建议再硬挖纯函数切片；再往下即 G2 壳体换绑，须成套推进。

## 8. §C 决策（已拍板 2026-11-18）

> **拍板记录（2026-11-18）**：C1 A、C4 A、C5 A，其余按推荐（C3 A / C2 A / C6 A）。拍板人：用户（endTree）。
> 本表从「建议」转为执行口径；按表中「解锁」另开切片，未列动作仍受 §8.2 约束。

| 项 | 代码现状 | 选项 | 推荐 | 拍板后解锁 |
| --- | --- | --- | --- | --- |
| C1 assetId ↔ slug | `FurnitureItem.assetId` 是后端资产 id，`glbUrl` 是前端加载引用；plan 侧 `sourceAssetId` 是 1–160 字符串、`modelOverride` 是物料库 slug；迁移已把 `assetId` 直通 `sourceAssetId`，slug 只经注入 `modelSlug` 取，不硬猜 | A. 严格分离：assetId 只存后端 id，modelOverride 只存 slug；B. 统一用 slug；C. 新增 `assetNamespace` 字段 | **A**。G1 不改字段；先在迁移/物料卡两处守住「不把 slug 写进 sourceAssetId、不把 UUID 写进 modelOverride」。数据审干净后，G2 再把 `sourceAssetId` 收紧为 UUID | 迁移不再有命名空间歧义；3D 选型可按 slug 稳定回查 |
| C2 manifest 加载 | `public/oneplan-icons/manifest.json` 是 549 条权威清单；纯函数层拿不到全局 manifest，`findLibraryEntryByTemplateId(entries, …)` / `facilityLibrarySizeResolver(entries)` 都要求调用方注入条目 | A. 壳体启动时静态加载一次并注入；B. 纯函数直接 import manifest；C. 运行时 fetch 远端 manifest | **A**。manifest 是构建期抓取产物，随包发布；壳体加载一次，迁移与画布共用同一份 entries。B 破坏纯函数注入边界，C 多一层失败态且当前无动态库需求 | 迁移可拿真实占地；仍保持纯函数可测 |
| C3 室内特化字段 | `FurnitureItem` 有 WiFi/CCTV/`signalRange`/锥角四件套/`elevation`/`structuralOpeningId`/`structuralColumnId`/`wallId`/`price`/`handoff`；`PlanFacility` 没有这些字段；迁移器已明确本轮不落 notes | A. 留在 3D/RoomLayout，不迁 plan；B. 塞 `notes` 自由文本；C. 契约新增可选 `indoor3d` 子对象 | **A（G1）**。这些是室内 3D 语义，plan 是二维场地规划；B 不可检索、不可校验；C 等产品确认真需要「户外 plan 带摄像头/WiFi 语义」再开，且要 3D 渲染同步 | 迁移可如实标记 lossy；契约不膨胀 |
| C4 旧云项目投影 | 项目页用 `/editor/?project=<id>` 打开，无 mode；云项目走 `backendSceneToLayout` 旧室内 schema；plan 草稿按 projectId 单独存储 | A. 只读旧室内视图 + 显式「复制为 plan 草稿」；B. 打开即自动投影；C. 直接砍掉旧入口 | **A**。旧链接不断、原项目不被静默改写；投影只在用户点按后生成派生草稿。B 有数据语义风险，C 会打断存量项目 | 决定 R3 是否保留迁移降级通路；旧项目可平滑过渡 |
| C5 plan lease 语义 | 本地写租约是 capability + `localWriteCapabilityGuard`；后端快照已有项目级 lease（projectId/sessionId/generation/revision/expiresAt）；plan 持久化尚未接 | A. 近期复用「本地 capability + 项目级 lease」守卫 plan 写；B. 现在新建 plan 专用租约；C. plan 写先不做 | **A**。先复用现有租约，plan 落盘时再加 revision 检查；B 等多人同时编辑 plan 的真实需求；C 会挡住 3c 守卫迁移 | `assertLayoutWrite` 可 plan 化，3c 可继续 |
| C6 户外旧预设 lawn/market | `ScenePresetKey` 含 lawn/market，GLB 已打包；`SCENE_PRESET_FACILITY_PREFIX` 已能把预设落成 `scene-preset:<key>` 设施；8 个室内预设随 G3 整组卸 | A. 保留为户外样例预设，按现有设施前缀落 plan；B. 迁到 SitePlan 草稿预设体系；C. 跟室内预设一起删 | **A**。现有路径已通，不新增预设 schema；等 plan 预设体系真立项再迁 B。C 会丢掉两个户外样例 | 不需要 G1 代码动作 |

### 8.1 建议拍板顺序

1. **C1 + C4**：直接决定迁移正确性与 R3 降级通路，先定这两项即可继续。
2. **C5**：决定 3c 写守卫能否 plan 化。
3. **C3 → C2 → C6**：影响面小，可按上面推荐默认执行；有异议再单独改。

### 8.2 未拍板前不动的面

- 不改 `planFacilitySchema` / `sourceAssetId` / `modelOverride` 约束；
- 不在纯函数层加载 manifest；
- 不把 3D 特化字段写进 notes；
- 不新建 plan 级写守卫或租约；
- 不动 lawn/market 预设与室内预设清单。

### 8.3 C1/C4 只读备料（2026-11-17）

**C1 物料命名空间实测**（`assets/library/merged.json`、`assets/library/asset-ids.json`、`frontend/public/oneplan-icons/manifest.json`，三者均入库）：

| 数据 | 规模 | 结论 |
| --- | --- | --- |
| `merged.json` models | 976 条，976 个唯一 slug | 3D 物料主键是 slug |
| 其中带 `assetId` | 528 条，全部 UUID、无重复 | assetId 只覆盖一部分物料 |
| 不带 `assetId` | 448 条（`open-extra` 213、`scendance-icon-props` 220、其余 15） | 不能假定每个 slug 都有后端 id |
| `asset-ids.json` | 762 个 glb URL → 528 个唯一 assetId | 同一 assetId 可有多个加载 URL 别名 |
| OnePlan manifest | 549 条 / 395 个唯一 slug；与 merged slug 交集 **0** | OnePlan 模板 slug 与 3D 物料 slug 是第三套命名空间 |

结论：C1 推荐 A（严格分离）有数据支撑——`sourceAssetId` 只承载后端 UUID，`modelOverride` 只承载 `merged.json` slug，`templateId` 里的 `oneplan:` slug 不参与两者转换。528 条有 id 的物料可确定性反查；448 条无 id 的物料只能靠 slug 选型，不得伪造 assetId。

**C4 旧云读取链路**：`cloud-panel.tsx` 的 `openRequested` 走 `controller.getProject` → `backendSceneToLayout` → `acceptScene`，直接把旧 Scene 换进 `RoomLayout`；当前只有 `projection.requiresOriginalSceneForWrite` 会置 `readOnlyProjects`，普通旧室内项目没有「只读 + 复制为 plan 草稿」分支。推荐 A 可行，但需要新增显式动作，不能在现有 `acceptScene` 里偷做投影。
