# data/building-heights.json · 唯一写入方规则

## 谁可以写

**只有** `scripts/build-building-heights.py` 可以写这个文件。任何人不手工编辑 JSON。

- 写入方：建筑高度数据维护任务（当前为 Scendance 主仓数据维护会话）运行上述脚本。
- 脚本是唯一生成入口；`data/building-heights-stats.md` 由同一脚本同时产出，同样禁止手改。

## 其他人只能读

- 任何并行任务（等距样片渲染、前端、地图标注等）**只读** `data/building-heights.json`，不得写入、覆盖、清空、格式化。
- 需要不同口径时，写到自己的副本目录（例如本任务的 `.temp/` 或实验仓），不得改动本文件。

## 改动流程

1. 修改来源或分级逻辑 → 改脚本，不改产物。
2. 跑脚本 → 覆盖 `data/building-heights.json` 与 `data/building-heights-stats.md`（脚本用临时文件原子替换）。
3. `meta.sources` 里的路径与 SHA-256 必须随产物更新；`meta.counts` 必须与 stats 一致。
4. 产物变化先评审，再由维护任务提交；其他任务不得代为提交。

## 边界

- 源数据（OSM / CNBH 栅格）位于 `D:\Scendance2026\hangzhou-map-lab\data\`，**只读**。该目录属另一条任务，禁止向其写入任何文件。
- 地标补丁簇 OSM 位于 `D:\Scendance2026\scendance-map-data\landmark-*.osm`，同样是**只读输入**（由 Overpass 重新抓取生成），不进版本库。
- 本文件不对 `frontend/` 代码做任何约束；渲染端按 `source_grade` 自行决定是否显示、如何着色。
- 禁止把推断值标为实测：`value_kind=measured` 仅允许来自现场实测。

## schema 3 字段（2026-11-09 起）

| 字段 | 取值 | 说明 |
|---|---|---|
| `source_grade` | `A` / `A*` / `B` / `C` / `D` | 顺序 A > A\* > B > C > D。**`A*` 是独立等级，不是 A 的别名**：有公开总高，但只来自媒体 / 百科等二手口径，未经规划公示或图纸佐证。不得把 `A*` 折算进 A 的统计。 |
| `value_kind` | `measured` / `mapped` / `reported_official` / `reported_media` / `derived_layers` / `derived_osm_levels` / `cnbh_raster` / `inferred` | C 级必须按此分流。**`cnbh_raster`（10 m 栅格，高层系统性低估）与 `derived_layers`（层数×层高，误差 ±(0.5 m×层数)）精度差一个量级，不可混算。** |
| `layers` / `floor_m` | 数值 | 仅 `derived_layers`。高度 = `layers × floor_m`，由脚本计算，不手填。 |
| `layers_source` | 文本 | 仅 `derived_layers`。层数出自哪条来源，带 Sxx 编号。 |
| `floor_basis` | 文本 | 仅 `derived_layers`。用了哪一档层高（博物馆/百货/酒店/1920s 等）及理由。 |
| `provenance` | 文本 | 地标覆盖记录的可读依据，带 Sxx 编号。 |
| `landmark` | bool | 是否经人工核对覆盖。 |
| `synthetic` / `parent_way_id` / `footprint` / `geometry_note` | — | 无 OSM footprint 的补充记录。 |
| `overlay` / `geometry_source` / `footprint` | bool / 文本 / `approximate` | overlay 补录记录：`overlay=true`、`geometry_source=manual_trace`、`footprint=approximate`（手描近似，非实测轮廓）。 |
| `name_source` / `landmark_name` | `landmark_overlay` / bool | 仅名称映射：给既有 OSM 轮廓补名字，不改高度与几何。 |

## id 三套体系（2026-11-09 起）

| 类型 | 形如 | 来源 | 规则 |
|---|---|---|---|
| OSM way | `"159184108"` | `xihu-ring.osm` 或补丁簇 | 纯数字，即 OSM way_id；同 id 多文件出现时以先传入的文件为准 |
| 合成 id | `"<parent_way_id>-<slug>"` | 脚本内的无 footprint 补充记录 | 必须有 `synthetic=true`、`area_m2=0`、`footprint="none"` |
| overlay 自造 id | `"x-<slug>"` | `data/landmark-footprints.geojson` | 必须 `x-` 开头；脚本断言不与任何 OSM way_id、合成 id 或其他 overlay id 重复 |

- 三套 id 共用一个命名空间，**任何两条记录不得同 id**；脚本在写入前做冲突断言。
- overlay 的 `name_patch` 条目本身不产生新记录，`id` 仅作条目名，必须给 `target_id` 指向既有 OSM way。

## overlay 补录（`data/landmark-footprints.geojson`）

- 这是**输入文件**，不是产物：手工补录只改这里，再由脚本合并进 `building-heights.json`。脚本重跑时会保留，不会被覆盖掉。
- `mode=record`：必须给 `id`（`x-` 开头）、`height_m`、`Polygon` 几何；`height_source` 默认 `landmark_media`（A\*），`footprint` 固定写 `approximate`。
- `mode=name_patch`：必须给 `target_id` 与 `name`，只改名字，不动高度、不动几何。
- 优先级：`overlay > A landmark_official > A* landmark_media > …`。`record` 只新增 `x-` 记录，不改写既有 way 记录；`name_patch` 只改 `name` / `name_source`，高度与几何保持原值。

## 无 footprint 补充记录（合成 id）

- 形如 `<parent_way_id>-<slug>`，例如 `970028320-tower`。
- 脚本写入前断言该 id 既不等于任何 OSM way_id、也不与已有键重复，**不会出现两条同 id 记录**。
- 这类记录 `area_m2=0`、`footprint="none"`、坐标为父记录形心，**不代表单体轮廓**；下游按面积/多边形取用时必须先判断 `synthetic`。

## 已知取舍

- CNBH 采样值 >30 m 时**保留采样值**并标 `suspect=true`、`confidence=0.35`，不再退回 D 的街区层数档（旧规则会把 25 层的维景打成 6 m）。被地标覆盖接管的少数记录以覆盖值为准。
