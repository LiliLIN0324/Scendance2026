# M3b/M3c 地基切片记录（基线与验收）

> 目标：把不依赖拍板、不碰壳体装配的 plan 侧纯函数先做完，供 G2 解锁后直接接线。
> 分支 `feat/m3-plan-foundations`，基线 `origin/main @ 13258414`，未 push。

## 1. A3 · plan 历史快照纯函数（M3b）

新增 `frontend/components/room-organizer/lib/plan-history.ts`，不含 React、不读时钟、不碰存储：

| 能力 | 口径 |
| --- | --- |
| `commitPlanHistory(history, previous, limit?)` | 旧快照入 past；redo 清空；与栈顶相同（可注入 `planSnapshotsEqual`）不重复入栈 |
| `undoPlanHistory(history, current, limit?)` | 弹 past 栈顶作回退快照；当前快照推入 future；空栈原样返回 |
| `redoPlanHistory(history, current, limit?)` | 与 undo 对称；重做后 past 同样受上限约束 |
| `PLAN_HISTORY_LIMIT = 30` | 与 canvas `UNDO_LIMIT` 同值，接线时两处必须同源 |
| `canonicalPlanJson` / `planSnapshotsEqual` | 对象键排序、数组保序、undefined 键省略；用于去重/对账，不作为持久化格式 |

测试 `plan-history.test.ts` 9 条：提交/去重/上限 30/撤销/重做/空栈/往返/规范化/内容比较。

**未做（G2 隔离）**：canvas 仍用 `historyRef` / `redoRef` 内联栈；本轮只提供可复用纯函数，不改壳体、不改撤销按钮行为。

## 2. A4 · 导出覆盖补强（M3c）

### 2.1 覆盖矩阵（本轮后）

| 实体 | 清单 | CSV | GeoJSON | 图例 | PNG/PDF |
| --- | --- | --- | --- | --- | --- |
| boundary | —（非实体行） | —（按设计不占实体行） | ✓ Polygon | ✓ | ✓ |
| zone | ✓ | ✓ | ✓ | ✓ | ✓ |
| facility | ✓ | ✓ | ✓ | ✓ | ✓ |
| route | ✓ | ✓ | ✓ | ✓ | ✓ |
| node | ✓ | ✓ | ✓ | ✓ | ✓ |
| worker | ✓ | ✓ | ✓ | ✓ | ✓ |
| vehicle | ✓ | ✓ | ✓ | ✓ | ✓ |
| measurement | ✓ | ✓ 数值走 metric；**本轮补备注列** | **本轮补 LineString / Polygon + 读数** | ✓ | ✓（计数进 deck 统计） |
| annotation | ✓ | ✓（note 文本进备注列） | **本轮补 Point / LineString / Polygon** | —（按设计不进图例） | 画布渲染 |

### 2.2 本轮代码

- `site-plan-geojson.ts`：新增测量与标注 Feature。
  - 测量：`distance` / `path` → `LineString`（`length_m`）；`area` → 闭合 `Polygon`（`area_m2`）。
  - 标注：`note` / `circle` → `Point`（`circle` 另带 `radius_m`，GeoJSON 无圆几何）；`line` → `LineString`；`rect` → 在 ENU 内按对角两点还原四角后投影的闭合 `Polygon`；`triangle` → 闭合 `Polygon`。
  - 输出顺序固定为 boundary → zone → facility → route → node → worker → vehicle → measurement → annotation；旧 plan（无测量/标注）字节不变。
- `site-plan-csv.ts`：`entityDetail` 补 `measurement` 分支，备注列不再为空；14 列表头与行序不变。
- 测试：geojson 新增 3 条、CSV 新增 1 条，覆盖几何类型、闭合环、读数、属性与旧 plan 字节稳定。

**未做**：annotations 不进图例/PDF 图例（自由标注按设计不占图例行）；boundary 不进 CSV 实体行（CSV 是实体清单，边界走 GeoJSON/PNG/PDF）。

## 3. 旧 schema 投影路径（只读登记）

| 入口 | 现状 | 结论 |
| --- | --- | --- |
| `frontend/components/review-share-page/load-plan.ts` | `loadReviewPlan` 返回 `{ layout: RoomLayout }`，评审/分享页仍按旧室内 layout 读 | 只读兼容层；M3 切换后需要「旧快照 → plan 投影」或保留该只读分支 |
| `frontend/components/room-organizer/lib/site-plan-migrate.ts` | `previewLegacyMigration` 预览迁移报告；`materializeLegacyDraft` 产出 `SitePlanSnapshot` 并经 schema 校验 | 已有一次性投影通路；缺的是旧云项目读取时的自动提示/投影入口（未接线） |
| `frontend/app/cases/garden-flower-show/garden-sample.ts` | 内置旧样例（RoomLayout） | 演示数据，不参与线上读取 |
| `frontend/app/plan-share/page.tsx` | plan 分享页 | 已是 plan 口径，无旧 schema 依赖 |

待拍板：旧云项目只读提示 vs 打开时一次性投影；决定 R3 是否保留旧读降级通路。

## 4. G2 隔离区（本轮不碰）

1. canvas 接入 `plan-history`：替换 `historyRef`/`redoRef`，需同时核对 30 步上限、`canUndo` 暴露、Agent 撤销入口。
2. plan 写守卫：现仍 `assertLayoutWrite`（`useWorkspaceWriteGuards` 绑 `local-write-lease`）；plan 侧需要独立的 lease 语义与错误文案，属壳体装配。
3. `sitePlanSnapshot` 持久化/回写：revision 单调、updatedAt、与 3D 镜像同步的契约未定。
4. `migrateFacilities` 调用方接线（`libraryEntry`/`modelSlug` 注入）随 M2 壳体解锁。

## 5. 验收

- `tsc --noEmit`：exit 0。
- 定向测试：`plan-history` 9 条、`site-plan-geojson` 12 条、`site-plan-csv` 新增 1 条，全绿。
- 全量 vitest 基线仍为 109 个 jsdom/localStorage 失败（Node 26 环境问题，与本次改动无关）。
