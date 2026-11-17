# M2 facility 映射收尾 · 可执行切片清单（基线 13258414）

> A1/A2/A1-5 切片：**纯函数 / 契约新增 / 对照测试**层，不接壳体、不动会话与历史绑定。本文件记录已落部分与后续可执行切片，供 G2 解锁后按序接线。

## 1. 基线与边界

| 项 | 值 |
| --- | --- |
| 基线 | `origin/main @ 13258414`（零引用清理合入后） |
| 切片分支 | `feat/m2-facility-mapping-finish` |
| 冻结面 | routeBridge 九方法签名、`SitePlanData` 既有字段、会话 scope、壳体装配均不动 |
| 本轮只动 | facility 迁移纯函数、`site-plan` 可选 `walls` 契约、walls 迁移纯函数、物料库 templateId 反查；不接壳体 |

## 2. A1 已落（本分支）

### A1-1 `modelOverride` / `sourceAssetId` 挂接

- 新增 `FacilityMigrationOptions.modelSlug(item)` 注入点：`assetId ↔ 物料库 slug` 对应关系未拍板，迁移器**不硬猜**，只在物件带 `assetId` 或 `glbUrl` 时询问调用方。
- `item.assetId` 在 1–160 字符内时直通契约既有字段 `sourceAssetId`（不新增字段、不改签名）。
- slug 经 `trim` 后必须在 1–160 内，否则不落 `modelOverride`；无模型引用的普通物件不调用 resolver、不落键。

### A1-2 `libraryEntry` 尺寸校准注入点

- 新增 `FacilityMigrationOptions.libraryEntry(templateId)`：纯函数层读不到 manifest，由调用方接 `oneplan-library` 条目后传 `{ width, depth }`。
- 仅对 `oneplan` / `misc` 生效；`builtin` 仍用内置模板尺寸（厕位 2.4×1.2、舞台 8×6）。
- 非法尺寸（0、负数、NaN、>100 m）一律回落 2×2，不把脏尺寸带进 plan。
- 图标不进 plan 契约（渲染层按 `templateId` 反查），本轮不虚构字段。

### A1-3 兜底口径与对照测试

- 保留既有口径：名称 trim 后 60 字符、备注 trim 后 500 字符、空名回落「通用物件」、非法色丢弃、非法旋转角归 0。
- `plan-facility-migration.test.ts` 13 → **18 条**：新增库条目校准、非法尺寸回落、resolver 仅对有模型引用物件生效、非法 slug 丢弃、sourceAssetId 直通与超长丢弃。
- 无 `options` 时尺寸与 override 行为不变（2×2、无 `modelOverride`）；唯一差异是带 `assetId` 的 glb 物件会直通契约既有可选字段 `sourceAssetId`，旧调用方无需改签名。

## 3. 后续可执行切片（按依赖排序）

| 切片 | 内容 | 前置 | 是否碰壳体 |
| --- | --- | --- | --- |
| **A1-4 调用方接线** | 迁移入口接 `libraryEntry` / `modelSlug` 注入 | M2 壳体物料接 plan（G2） | 是，暂不做 |
| **A1-5 物料库反查** | ✅ `findLibraryEntryByTemplateId` + `facilityLibrarySizeResolver`；assetId→slug 映射待定 | 无 | 否 |
| **A2-1 walls 契约** | ✅ `planWallSchema` + 可选 `walls`（上限 500） | 口径见 §4 | 否 |
| **A2-2 walls 迁移纯函数** | ✅ `migrateWalls`：帧变换、退化跳过、厚度/高度校验、中点分区 | A2-1 | 否 |
| **A3-1 plan 历史快照纯函数** | ✅ 已在 `feat/m3-plan-foundations` 落地 | — | 否 |
| **A4-1 导出覆盖盘点** | ✅ GeoJSON 补测量/标注；CSV 补测量备注 | — | 否 |
| **A4-2 plan 写权限断言** | ⏸ 需 plan lease 语义（G2） | 拍板 | 是 |

每片验收统一：`tsc --noEmit` 0 + 该片定向测试全绿 + 不新增全量失败；不混入主工作树在途改动。

## 4. A2 walls 已落（2026-11-17 默认口径）

契约 `site-plan.ts` 新增可选 `walls`：
- `points` 恰 2 点（单线段；折线由多段拼）；
- `thicknessM` 0.05–5、`heightM` 0.5–20，缺失/超界不写（不虚构）；
- `kind` exterior/interior、`status` detected/inferred/confirmed 直通；
- `color`、`zoneId` 可选；上限 500 段；旧数据不带照常解析。
- `levelId` 可选（一期契约带上）：迁移侧无楼层映射时经 `levelIdForFloor` 注入，缺省不写。
- 纳入 `superRefine`：跨集合 id 去重、`zoneId` 悬空、`levelId` 悬空（levels 缺省时不得携带）。

`migrateWalls(layout, boundary, gen, zones?)`：
- 两端经 `framePoint` 逆变换并夹进边界；端点非有限数/两端重合进 skipped；
- 厚度/高度超界只丢字段、保留墙段；
- 归属分区按线段中点命中；楼层 → 图层经 `levelIdForFloor` 注入，缺省不写；门/窗无独立结构，不凭空转 node；
- 超过 500 段的墙进 skipped，保留前 500 段。

测试：`plan-wall-migration.test.ts` 8 条 + `site-plan-walls-schema.test.ts` 6 条（重复 id / 悬空 zoneId / 悬空 levelId / 合法通过 / 阈值）。

## 5. A1-5 物料库反查已落

- `findLibraryEntryByTemplateId(entries, templateId)`：支持 `oneplan:` 与存量 `library:` 前缀，按 kind/slug 匹配；
- `facilityLibrarySizeResolver(entries)`：直接作为 `migrateFacilities` 的 `libraryEntry` 注入；
- 测试：`oneplan-library-entry-lookup.test.ts` 4 条。

## 6. 仍未决

1. `assetId ↔ 物料库 slug`：merged.json 有 `assetId` 字段，但前端 `FurnitureItem.assetId` 同时被 aholo/walk-role 使用，需确认命名空间后再做映射（本轮只做 templateId 反查）。
2. oneplan manifest 的运行时加载：纯函数层只接受注入，接线时由壳体提供条目。
3. 室内特化字段（WiFi/CCTV/锥角/elevation/structural 引用/price/handoff）：落 `notes` 还是留 3D 层。
4. 旧云项目读旧室内 schema：只读提示 vs 一次性投影（决定 R3 是否留降级通路）。
5. plan 写权限断言需要 plan lease 语义（G2）。

## 7. 第二轮补强（本轮）

### 7.1 walls 并入迁移总入口

- `migrateLayoutToPlan` 现在返回 `walls`，`LayoutMigrationSkip.source` 增加 `'wall'`；
- 执行顺序：zones → workers/routes → facilities → walls；墙体分区归属复用已构建的 zones；
- 退化墙段与端点非法继续进 `skipped`，与 facility skipped 合并；
- 测试：总入口新增 1 条（墙段落入 + 退化 skipped），空布局断言补 `walls: []`。

### 7.2 导出面补墙体

- GeoJSON：墙体输出 `LineString`，属性 `kind=wall`、`type`（外墙/内墙/墙体）、`length_m`、`thickness_m`、`height_m`、`zone`；顺序紧跟 boundary，旧 plan 字节不变；
- CSV：墙体作为导出补充行追加在实体清单之后，仍 14 列，`名称=墙体 <短 id>`、`分类=外墙/内墙/墙体`、`数量读数=厚 <值>`、`长度` 列给线段长；面板清单不加墙体筛选维度；
- 测试：GeoJSON +2、CSV +2（含旧 plan 字节稳定）。

### 7.3 其余导出格式复核（2026-11-17）

| 格式 | plan 墙体 | 说明 |
| --- | --- | --- |
| CSV | ✅ | `wallRows` 补充行，14 列对齐 |
| GeoJSON | ✅ | 墙体 `LineString` + 长/厚/高/zone |
| PNG / PDF（print） | ❌ | 快照来自 2D 画布，画布尚未消费 `plan.walls`；PDF 统计与图例也无墙体 |
| DXF / SVG | ❌（plan 级） | `plan-export/dxf|svg` 是室内 `layout` 导出，已含 `interiorWalls`；plan 级尚无这两种导出器 |
| download | — | 通用下载 helper，不是一种导出格式 |

结论：墙体在**数据导出**（CSV/GeoJSON）已对称；图纸类缺口在画布渲染与 plan 级 DXF/SVG 导出器，属 UI/新功能，不在纯函数层收口。

## 8. 旧 layout → plan 迁移覆盖登记

| 旧数据 | plan 落点 | 状态 |
| --- | --- | --- |
| `FloorLayout.zones` | `zones` | ✅ 已迁（矩形四角 → 闭合环） |
| `person` 物件 | `workers` | ✅ 已迁（count=1） |
| `walkRoute` | `routes` | ✅ 已迁（步行线） |
| 其余 `items` | `facilities` | ✅ 已迁（builtin/oneplan/misc/skip 四档） |
| `interiorWalls` | `walls` | ✅ 本轮并入总入口 |
| `FloorLayout` 楼层 | `levels` | ❌ 未迁：多层平铺为同一批实体，不生成 plan 图层；墙体可经 `levelIdForFloor` 注入，但总入口尚未传 |
| 旧测量 | `measurements` | — 不适用：旧 layout 无对应实体 |
| 旧标注 | `annotations` | — 不适用：旧 layout 无对应实体 |
| 室内特化字段 | — | ❌ 未迁：WiFi/CCTV/锥角/elevation/structural 引用等仍留 3D 层或 notes（待产品口径） |
