# 建筑高度数据 · 来源统计

> 自动生成，请勿手改；唯一写入方见 [OWNERSHIP.md](OWNERSHIP.md)。生成日期 2026-11-09。

## 来源与口径

| 项 | 内容 |
|---|---|
| 建筑轮廓 | `xihu-ring.osm`（Overpass `out geom`）+ 5 个补丁簇，只取 `building≠no`、闭合、面积 ≥12 m² 的 way |
| 样区轮廓 | `east-shore.osm`（700 m 视宽样区），291 栋 |
| 高度栅格 | `cnbh-x121y31.tif`，10 m，EPSG:32651 |
| 坐标系 | 轮廓 WGS84（EPSG:4326）；栅格采样 EPSG:32651 |
| 覆盖范围 | WGS84 经度 120.0891–120.2522，纬度 30.1883–30.2861 |
| 覆盖栋数 | 6569 |

## 总量

| 项 | 值 |
|---|---:|
| 建筑记录 | 6569 |
| 有非零高度 | 6569（100%） |
| 轮廓面积 <12 m² 跳过 | 10 |
| 标记 `suspect` | 926 |
| overlay 补录 | 5 |

## overlay 补录（`data/landmark-footprints.geojson`）

| id | 名称 | 高度 | 等级 | 几何 |
|---|---|---:|---:|---|
| `map-jingci`（名称映射） | 净慈寺 → `229726947` | 不改 | — | 既有轮廓 |
| `map-yuewang`（名称映射） | 岳王庙 → `436322031` | 不改 | — | 既有轮廓 |
| `x-baochu-ta` | 保俶塔 | 45.3 | A* | approximate |
| `x-huanqiu-zhongxin` | 环球中心 | 170.0 | A* | approximate |
| `x-huawun-dasha` | 华润大厦 | 230.0 | A* | approximate |
| `x-raffles-t1` | 杭州来福士 T1 | 250.0 | A* | approximate |
| `x-raffles-t2` | 杭州来福士 T2 | 250.0 | A* | approximate |

## 等级分布（全环湖 6569 栋）

| 等级 | 来源 | 条数 | 占比 |
|---|---|---:|---:|
| A | 官方 / 设计方 / 结构论文 / 实测 | 10 | 0.15% |
| A* | 媒体·百科等二手口径的总高（非官方公示） | 7 | 0.11% |
| B | OSM height 标签 | 367 | 5.59% |
| C | 层数×层高 derived / OSM levels / CNBH 栅格 | 5428 | 82.63% |
| D | 街区类型推断 | 757 | 11.52% |

> `A*` 是**独立等级**，不是 A 的别名：它有公开总高，但只来自媒体 / 百科等二手口径，未经规划公示或图纸佐证，因此不并入 A。等级顺序 A > A\* > B > C > D。

## `value_kind` 分布（C 级不再是一个暗桶）

| `value_kind` | 含义 | 条数 |
|---|---|---:|
| `measured` | 现场实测 | 0 |
| `reported_official` | 官方 / 设计方 / 结构论文公布总高 | 9 |
| `reported_media` | 媒体·百科等二手口径总高 | 7 |
| `mapped` | OSM `height` 标签 | 368 |
| `derived_layers` | 公开层数 × 按用途层高 | 20 |
| `derived_osm_levels` | OSM `building:levels` × 3.2 | 36 |
| `cnbh_raster` | CNBH 10 m 栅格采样 | 5372 |
| `inferred` | 街区类型推断 | 757 |

> **`cnbh_raster` 与 `derived_layers` 必须分开看。** 两者在 C 级里混装时，前者带 10 m 栅格的系统性低估，后者误差是 ±(0.5 m × 层数)，精度差一个量级。统计与下游取用都要按 `value_kind` 分流。

| height_source | 条数 |
|---|---:|
| `survey` | 0 |
| `landmark_official` | 9 |
| `landmark_media` | 7 |
| `osm_height` | 368 |
| `landmark_layers` | 20 |
| `osm_levels` | 36 |
| `cnbh` | 5372 |
| `typology` | 757 |

## 700 m 样区（291 栋）

| 项 | 数量 | 覆盖率 |
|---|---:|---:|
| 有 `height` 标签 | 0 | 0.00% |
| 有 `building:levels` | 2 | 0.69% |
| 本文件给出高度 | 291 | 100.00% |

| 等级 | 条数 | 占样区 |
|---|---:|---:|
| A | 1 | 0.34% |
| A* | 2 | 0.69% |
| B | 0 | 0.00% |
| C | 260 | 89.35% |
| D | 28 | 9.62% |

| height_source | 条数 |
|---|---:|
| `survey` | 0 |
| `landmark_official` | 1 |
| `landmark_media` | 2 |
| `osm_height` | 0 |
| `landmark_layers` | 9 |
| `osm_levels` | 2 |
| `cnbh` | 249 |
| `typology` | 28 |

| `value_kind` | 条数 |
|---|---:|
| `measured` | 0 |
| `reported_official` | 1 |
| `reported_media` | 2 |
| `mapped` | 0 |
| `derived_layers` | 9 |
| `derived_osm_levels` | 2 |
| `cnbh_raster` | 249 |
| `inferred` | 28 |

## 口径说明

- `value_kind`：`measured`（实测）/ `mapped`（OSM `height` 标签）/ `reported_official`（官方·设计方·结构论文总高）/ `reported_media`（媒体·百科等二手口径总高）/ `derived_layers`（公开层数 × 按用途层高）/ `derived_osm_levels`（OSM levels × 3.2）/ `cnbh_raster`（CNBH 栅格采样）/ `inferred`（类型推断）。
- `is_measured` 仅实测为 true；`is_inferred` 对 `derived_layers` / `derived_osm_levels` / `cnbh_raster` / `inferred` 为 true。
- CNBH 采纳下限 3 m；**超过 30 m 不再退回 D**，而是保留采样值并标 `suspect=true`、`confidence=0.35`（高值有截断风险，但量级仍优于街区层数档）。本次采样值 >30 m 的共 558 条，其中 344 条按保留值落 C，其余 214 条已被地标覆盖表按公开层数接管。
- 地标覆盖表（31 条）与补充记录（1 条）见脚本内 `LANDMARKS` / `SYNTHETIC`，逐条依据见 `docs/40-地标高度清单-20261109.md`。
- `derived_layers` 记录必须带 `layers` / `floor_m` / `layers_source` / `floor_basis` 四个字段，能追溯到「层数来自哪、层高用了哪档」。
- 无 footprint 的补充记录 id 形如 `<parent_way_id>-<slug>`，生成时断言不与任何 OSM way_id 冲突；`footprint=none`，坐标取父记录形心，不代表单体轮廓（当前：`970028320-tower`）。
- D 级由 200 m 街区类型 + `fnv1a(way_id)` 固定取档，跨刷新稳定。
- `survey`（现场实测）当前 0 条，接入后应覆盖为最高优先级。
