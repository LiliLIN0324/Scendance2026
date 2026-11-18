# §C 六项口径决策卡（2026-11-18）

> 一页用完：拍板、留痕、解锁。**本卡不是开工单**，拍板后按 §5 的切片另开。
> 代码锚点：`origin/main @ 63b11ae1`（成文当日）。现状描述都指向具体文件，不引用行号做长期锚。
> 前置：§8「未拍板前不动的面」仍然有效——不改 `planFacilitySchema` / `sourceAssetId` / `modelOverride` 约束，不在纯函数层加载 manifest，不把 3D 字段塞 notes，不新建 plan 租约，不动 lawn/market 与 8 个室内预设。

## 0. 拍板回执（已收到）

```
C1 A、C4 A、C5 A，其余按推荐
```

| 项 | 选项 | 拍板人 | 日期 |
| --- | --- | --- | --- |
| C1 / C2 / C3 / C4 / C5 / C6 | C1 A、C4 A、C5 A、C3 A、C2 A、C6 A | 用户（endTree） | 2026-11-18 |

- 不按推荐的项，直接写「C5 B」这样的短句；未提到的按推荐。
- 已同步：`2026-11-17-g1-closure-status.md §8` 表头已改为「已拍板 + 日期」，本卡作为附件引用。

## 1. 六项对照

| 项 | 已核实的现状 | 推荐 | 选别的要付什么 | 不拍板的后果 |
| --- | --- | --- | --- | --- |
| **C1** assetId ↔ slug | `merged.json` 976 slug / 528 带 UUID / 448 无 id；`asset-ids.json` 762 URL → 528 id；OnePlan manifest 549 条、395 slug、与 merged 交集 0。plan 侧 `sourceAssetId` 是 1–160 字符串、`modelOverride` 是 slug；迁移已把 `assetId` 直通 `sourceAssetId` | **A 严格分离**：`assetId` 只存后端 id，`modelOverride` 只存 slug，迁移不硬猜；G2 再把 `sourceAssetId` 收紧为 UUID | **B（统一 slug）**：528 条有 id 物料丢掉后端 id，生成/计费/溯源按 id 的链路改成 slug 反查；而 448 条无 id 的 slug 反查不到 id，只能允许空值——等于把「可空」写进契约，迁移与物料卡都要重跑。**C（新增 `assetNamespace`）**：改 `planFacilitySchema` + 前后端 wire + 迁移双写，撞 G1 冻结面（`SitePlanData` 既有字段），要走契约评审 | 迁移继续「不硬猜」，物料卡写入口径改不动；G2 收紧 `sourceAssetId` 无法开工 |
| **C4** 旧云项目投影 | `/editor/?project=<id>` 打开；`cloud-panel` 的 `openRequested` → `getProject` → `backendSceneToLayout` → `acceptScene` 直接换进 `RoomLayout`；`readOnlyProjects` 只在 `projection.requiresOriginalSceneForWrite` 时置位；plan 草稿键是 `scendance-outdoor-plan-v1:<projectId>` | **A 只读旧视图 + 显式「复制为 plan 草稿」**，不自动改写原项目 | **B（打开即投影）**：同一 projectId 只有一个 plan 草稿键，自动投影会直接覆盖用户已有的 plan 草稿；原项目被静默改写后没有回滚点；`readOnlyProjects` 分支失效。属数据损坏级，不是体验级。**C（砍旧入口）**：存量项目链接失效，客户与执行方手里的旧链接 404，R3 也没有降级通路 | R3 是否保留迁移降级通路定不了；C4 切片无法开 |
| **C5** plan lease | 本地写租约 = `lib/local-write-lease.ts` 的 capability + `localWriteCapabilityGuard`；后端 lease 形状 `{projectId, sessionId, generation, revision, expiresAt}`（`lib/backend-session.ts` 内 `update({lease})`）；plan 持久化未接；plan 自己有独立 revision（`outdoor-plan-sync.ts` 的 `saveOutdoorPlan` 返回 `{conflict, revision}`） | **A 复用本地 capability + 项目级 lease 守卫 plan 写**，plan 落盘另加 revision 检查；多人编辑专用租约后议 | **B（新建 plan 专用租约）**：后端要加表/接口/过期清理/时钟口径，至少一个后端切片；且与项目级 lease 双租约并存，优先级、失效顺序都要再定一轮，B3 直接延期。**C（plan 写先不做）**：B3 写守卫不能 plan 化，R2/R3 卡住，导出与写路径继续挂 layout 守卫 | B3（导出与写守卫 plan 化）不能开工 |
| **C3** 室内特化字段 | `FurnitureItem` 有 WiFi/CCTV/`signalRange`/锥角四件套/`elevation`/`structuralOpeningId`/`structuralColumnId`/`wallId`/`price`/`handoff`；`PlanFacility` 没有；迁移器明确不落 `notes` | **A 留在 3D/RoomLayout，不迁 plan、不塞 notes**；迁移器如实标 lossy | **B（塞 notes）**：不可检索、不可校验，后续 3D 语义要解自由文本才能用，等于欠一个解析器。**C（新增 `indoor3d` 子对象）**：契约膨胀 + 3D 渲染同步 + 迁移映射，而户外 plan 目前没有消费方 | 迁移器无法标 lossy，字段要么丢要么乱塞；M2 收口说不清 |
| **C2** manifest 加载 | `public/oneplan-icons/manifest.json` 549 条，是构建期抓取产物；纯函数只吃注入的 `entries`（`findLibraryEntryByTemplateId` / `facilityLibrarySizeResolver`） | **A 壳体启动静态加载一次并注入**，迁移与画布共用同一份 | **B（纯函数直接 import）**：破坏注入边界，纯函数单测要读整份 JSON，bundle 变大，manifest 更新要重新打包。**C（运行时 fetch）**：多一层失败态、缓存与版本漂移，离线不可用 | 迁移拿不到真实占地尺寸，只能留注入点，M2 的占地仍不准 |
| **C6** lawn/market 预设 | `ScenePresetKey` 含 lawn/market，GLB 已打包；`SCENE_PRESET_FACILITY_PREFIX` 已能把预设落成 `scene-preset:<key>` 设施；8 个室内预设随 E3 整组卸 | **A 保留为户外样例**，按现有前缀落 plan，不新增预设 schema | **B（迁到 plan 预设体系）**：新 schema + 新面板 + 迁移，而现有路径已通，收益为零。**C（跟室内预设一起删）**：丢两个户外样例，演示与回归少两个基线 | 无（不阻塞任何切片） |

## 2. C5 补丁（拍板前必须补的一句）

**问题**：后端 lease 的 `revision` 是 **scene** revision，plan 有**自己的** revision（`saveOutdoorPlan` 的 `{conflict, revision}`）。若直接拿 scene revision 去校验 plan 落盘，结果是二选一的坏结果：scene 与 plan 同步时恒真（等于没校验），不同步时误拦（用户明明没并发也被拒）。

**建议口径（写进 C5 拍板结论）**：

> plan 写用 **plan revision** 做 compare-and-set；lease 只提供「谁有写权 / 项目归属 / 是否过期」，**不借 revision**。冲突时以 plan revision 拒绝并提示重载，不改写、不合并。

三条备选与代价：

| 备选 | 代价 | 结论 |
| --- | --- | --- |
| 借 scene revision 校验 plan | 恒真或误拦，且掩盖真实冲突 | 不可取 |
| 在 lease 里加 `planRevision` 字段 | 改后端契约与响应，B3 等一个后端切片 | 有并发需求再议 |
| lease 只给写权 + plan 自己的 revision 做 CAS | 不动后端，plan 存储已有 revision | **推荐** |

已核对的文件：`frontend/lib/local-write-lease.ts`（capability 守卫）、`frontend/lib/backend-session.ts`（lease 形状与 `expiresAt`）、`frontend/components/room-organizer/lib/outdoor-plan-sync.ts`（plan 侧 `conflict` / `revision`）。

## 3. C1 / C4 数据底稿（复算用）

| 数据 | 规模 | 结论 |
| --- | --- | --- |
| `assets/library/merged.json` | 976 条 model、976 个唯一 slug | 3D 物料主键是 slug |
| 其中带 `assetId` | 528 条，全 UUID、无重复 | assetId 只覆盖一部分 |
| 不带 `assetId` | 448 条（open-extra 213、scendance-icon-props 220、其余 15） | 不能假定每个 slug 都有后端 id |
| `assets/library/asset-ids.json` | 762 个 glb URL → 528 个唯一 assetId | 同 id 可有多个 URL 别名 |
| `frontend/public/oneplan-icons/manifest.json` | 549 条 / 395 slug，与 merged 交集 **0** | 第三套命名空间，不参与 C1 转换 |

C4 存储事实：plan 草稿按 project 单键（`scendance-outdoor-plan-v1:<projectId>`），一个 projectId 只有一个 plan 槽位——这是「打开即投影」会造成覆盖的直接原因。

## 4. 治理冲突已修正（2026-11-18）

`2026-11-17-decouple-execution-plan.md §0.4` 原写「一次性推 main；不为小改动开 PR」，与 `AGENTS.md §六`「`main` 必须走 PR，不得直推」冲突。已按下面这句改掉：

> 本地攒好 tsc + 定向测试 +（涉及交互的）真机验收后，**按 `AGENTS.md §六` 开 PR 到 main**，由人评审合并；不直推 main，不为小改动拆多个 PR。

同轮一并更新：计划 §0.3、`g1-closure-status.md`、`2026-11-17-b1-b4-execution-cards.md` 的台账锚点已从 `0a59f7b0` 换成 `63b11ae1`（116 失败文件）。

## 5. 拍板后 24 小时内可动的切片

| 顺序 | 切片 | 依赖 | 产出 |
| --- | --- | --- | --- |
| 1 | C1 两处守卫：迁移 `modelSlug` 注入、物料卡写入 | 仅 C1 拍板 | 不收紧 schema，只守「slug 不进 `sourceAssetId`、UUID 不进 `modelOverride`」 |
| 2 | C4 显式「复制为 plan 草稿」动作（旧视图只读） | C4 拍板 | 新增入口，不在 `acceptScene` 里偷做投影 |
| 3 | C5 写守卫 plan 化（B3 的前半） | C5 拍板 + §2 口径 | `assertLayoutWrite` → plan 写权限，plan 落盘 CAS |
| 4 | C3 lossy 标记 / C2 manifest 注入 / C6 不动 | 默认包确认 | 三项都是小改，随默认走 |

## 6. 本卡不包含

- 不是发布批准：C 线拍板与 #79 发布门禁是两条线，互不替代。
- 不授权改 schema、不授权接壳体、不授权动预设、不授权新建租约。
- 不替执行 agent 决定「B/C 更好」——代价已列，风险归属在你。
