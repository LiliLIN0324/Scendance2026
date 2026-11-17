# G2 施工图（2026-11-16，基底 `origin/main @ d0f3801d`）

- 目的：把 G2 从「等 #110 真机确认 + 丽丽 flow 稳定」变成「条件一到就能照图施工」。
- 性质：只读分析产出，**未改一行代码**，不触碰冻结面（`site-plan.ts` 必填结构、`outdoor-agent-contract` 九方法签名、M3 影子）。
- 明细见两份取证报告：
  - `.g1-reports/g2-m3-blueprint.md`（411 行，M3a/M3b 逐文件清单）
  - `.g1-reports/g2-m2-walls-blueprint.md`（48 KB，M2 墙体契约 A/B 取舍与契约草案）

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| M3a 能独立开工吗 | **能**。只动会话/身份，不碰契约。8 个生产文件（7 改 + 新增 `lib/project-identity.ts`）+ 6 个测试；建议先 S1–S4 四步灰度 |
| M3b 现在能做吗 | **不能**。`floors`（3D 楼层）与 `levels`（设计层）语义不等价，且 `walls` 目前在契约里根本不存在；须等 M2-walls 落地 + `PlanSnapshot{plan, shell}` 信封拍板 |
| M2 墙体怎么建模 | **独立可选 `walls` 折线集合**（方案 A）。B（塞进 facilities）在数据模型上不成立：`PlanFacility` 是「点 + 旋转角 + 矩形边长」，表达不了折线 + 厚度 + 洞口，且会污染模板目录、模型选择、生成链路与物料计数 |
| 九方法要改吗 | **不用**。写入口走已有的可选 `applyPlan(next, expected)`，或新增可选 `applyWalls?`（新增不改既有签名） |

## 1. M3 现状链路（一句话版）

- 会话槽今天由 **`layout.id`** 派生：`room-organizer.tsx:338` `projectSessionScope(layout.id ?? outdoorProjectIdProp)`，键形如 `project:<layout.id>`。
- 外壳的 `outdoorProjectId` 只在 `workspace-shell.tsx:102` 启动时定一次；**切项目只改 URL**（`cloud-panel.tsx:340-345`），所以会话实际「跟活动走、不跟项目走」。
- activity token 又读 prop，与 scope 是两套身份 → **不改这条通道，M3a 等于没做**。
- 历史快照存的是 `RoomLayout`（`floors/items/walls/roof`），回读走 `review-share-page/load-plan.ts`；`version-history` 是单 ring。

## 2. M3a 施工清单（scope：`layout.id` → `projectId`）

> 定性：不是换键名，而是把「存储槽身份」与「活动换代身份」拆开。云项目绑定（`layout.id === projectId`）几乎零迁移。

| # | 文件 | 要点 |
|---|---|---|
| A1 | **新增** `lib/project-identity.ts` | `currentProjectId()` / `subscribeProjectId()` / `projectIdSnapshot()`；优先级：controller 快照 → 已解析 `outdoorProjectId`（含 `?project=` 深链）→ `default-outdoor`。**切项目后必须能推送变更** |
| A2 | `lib/project-session-scope.ts` | 保留 `projectSessionScope` 签名；新增 `legacyActivitySessionScope(layoutId)` / `isProjectScope(scope)` |
| A3 | `room-organizer.tsx:338` | `sessionScope = projectSessionScope(currentProjectId())`，不再读 `layout.id` |
| A4 | `room-organizer.tsx:337,341-344` | legacy 槽改为两条：旧外壳槽 + 上一个活动槽；迁移走 **copy 不删** |
| A5 | `room-organizer.tsx:347-351` | `activityScopeSource` 的 `getScope` 走项目 scope，`subscribe` 接 A1 |
| A6 | `lib/activity-session-epoch.ts` | token 增加 `identity`；scope 变→重订阅+换代，identity 变→仅换代；`isCurrent` 三者同验。**纯内存语义，必须一次到位，不可半开** |
| A7 | `lib/floor-session-epoch.ts` | 走同一 `ActivityScopeSource`，保留 `floorIndex/floorId`；M2 `levels` 稳定后再换 level id |
| A8 | `lib/assistant-scope-registry.ts` | 新增 `copyScopeHistory`（搬不删）、`forgetScopeName/aliasScopeName`；淘汰策略改最近使用 |
| A9 | `hooks/use-assistant-sessions.ts` | `scopedStores` 加淘汰；旧 `project:<layout.id>` 槽登记为 legacy 并从「其他历史」隐藏 |
| A10 | `panels/agent-panel.tsx:670,4117` | 不单独改，但**必须与 A6 同批**，否则 `sessionScopeIsCurrent` 恒真 |
| A11 | `room-organizer.tsx:4141-4147` | `onBindProject` 保留写 `layout.id`，但身份变更必须经 A1 推送 |

三场景口径：新建/切换项目（切项目必须补 A1 推送点）、同项目多活动（槽共享、靠 identity 换代）、旧会话兼容（同槽零迁移；本机草稿按 copy 迁移；旧 `activity:`/`draft:` 槽不迁，UI 标只读）。

## 3. M3b 为什么现在不能开工

| 阻塞 | 说明 |
|---|---|
| `floors` ≠ `levels` | 3D 楼层与设计层不是同一概念，直接映射会丢语义 |
| `walls` 不存在 | 当前 `SitePlanData` 无墙体集合，得等 M2 |
| 3D-only 字段无归处 | roof / 灯光 / 底图等在 `SitePlanData` 里没有对应位 |
| 结论 | 用 **`PlanSnapshot{plan, shell}` 信封**承载「设计数据 + 显示外壳」，M3b 的写侧双写（S6）等 M2-walls 与信封都定了再动 |

## 4. M2 墙体契约（方案 A）

现状：户外**没有任何墙体实体**。建筑禁区靠 `plan.buildings`（OSM 灰块，只读）+ `zones[].environment='indoor'`（手画禁区）双轨表达；墙只存在于室内 `RoomLayout.floors[i].interiorWalls`（注意：不是 `RoomLayout.walls`，后者不存在）。

契约草案（全部新增可选，不改必填结构）：

- `SitePlanData.walls?: PlanWall[]`（上限 500）
- `PlanWall`：`id`、`points`（2–64）、`thicknessM`、`heightM`、`openings[]`（`offsetM`/`widthM`/`heightM`/`sillM`）、材质/样式、`source: 'indoor' | 'outdoor'`、`kind/status`、可选 `zoneId`/`levelId`
- 洞口不硬卡墙长：schema 只做上界护栏，夹取交给纯函数，否则「先开洞再拉墙」会被拒

落地规模：P0 生产代码 **17 个文件**（2 新增 / 15 修改）+ 约 10 个测试；P1 2 个（冲突、3D 足迹）；P2 2 个（3D 挤出、2D→3D 同步）。五处按 `kind` 穷举的链路必须同步扩：图层令牌、编辑模式、导出（inventory/CSV/GeoJSON/PNG/PDF）、图例、交付面板——**这是 P0 工作量的大头**。

迁移：室内 `InteriorWall{x1,z1,x2,z2,thickness,height,kind,status}` → `points[2]` 直带；门窗 `structuralOpeningId` → `openings[]`（有损可解释）；旧项目只读降级。

## 5. 统一顺序与回滚

| 步 | 内容 | 开关 | 回滚 |
|---|---|---|---|
| S1 | A1/A11 项目身份通道（只新增不接线） | `PROJECT_IDENTITY_LIVE=false` | 删文件即可 |
| S2 | A6/A10 token 拆 scope/identity | 无开关 | 回退提交；**不可半开** |
| S3 | A3/A4/A5/A8 scope 切 projectId + copy 迁移 | `PROJECT_SCOPE_SWITCH` | 翻回 false，旧槽仍在（copy 不删） |
| S4 | A9 注册表/历史浮层收拾 | `LEGACY_SCOPES_READONLY` | 翻回 false |
| S5 | M3b 读侧双形态 | `PLAN_SNAPSHOT_READ` | 翻回 false |
| S6 | M3b 写侧双写 | `PLAN_SNAPSHOT_WRITE` | 翻回 false |
| S7 | 停写 layout 条目、review 降级 | — | **不可逆**，单独确认 |

M2 与 M3 的关系：M2-walls 是 M3b 的前置；M3a 可与 M2 并行设计，但 **M3b 编码必须晚于 M3a 合入**，否则守卫要在旧身份上重写一遍。

明确不做：不按 projectId 拆 `STORAGE_KEY`（会同时动自动保存、跨标签页、恢复点、recovery 四套机制）；不改 `sitePlanDataSchema` 必填结构；不为 walls 提前占位。

## 6. 验收口径

```pwsh
cd C:\幕景\Scendance2026\.worktrees\g1-base\frontend
$env:NODE_OPTIONS="--localstorage-file=./.tmp-vitest-ls"
npx vitest run <files>
npx tsc --noEmit
```

- **M3 基线已有 5 条红**（`session-generation` 4 条 + `venue-epoch` 1 条），另 1 条 flaky——**不是本轮回归**。
- 不带 `--localstorage-file` 会多出 14 条假红（与 G1 的 Node 26 localStorage 陷阱同源）。
- M2 最小闭环：画墙 → 开洞 → 吸附 → 撤销 → 导出 → 回读。
- 真机路径与逐文件用例名见两份明细报告 §5/§6。

## 7. 风险

1. **开洞与接头几何口径漂移**（M2 最大风险）：2D 断口与 3D 打洞不一致、撤销后洞口悬空。
2. **发布顺序**：旧客户端 `strictObject` 会拒收 `walls`，必须先发客户端再发写 `walls` 的版本。
3. **切项目 scope 滞后**（M3a 最大陷阱）：只改 URL 不推身份，scope 永远慢一拍。
4. **守卫半开**：A6 未落地时 `sessionScopeIsCurrent` 恒真，看似通过、实则不拦。

## 8. 外部阻塞（不变）

模型槽充值、登录态真机验收、Overpass 恢复、部署授权。四项不解，V2–V5 走不完，G2 的最后一道确认就始终缺位。
