# #2 遗留补证：选中后 project 读取与零写（2026-11-18 第四轮）

> 承接第三轮 `2026-11-18-case02-same-name-poi.md`。上一轮抓取窗口漏了「选中之后有没有 project 读请求」这一条，本轮在规范域名上补齐。
> 结论：**选中路径上不存在 scene-api project 读取，也不存在方案写请求**；#2 云端零写证据成立。

## 1. 复现输入

- 站点：`https://scendance-scene-planner-ewz.pages.dev/`，登录态有效。
- 检索词：「街心公园」。
- 候选（`/api/amap-place?keywords=街心公园&limit=6&center=120.146037,30.252192`，200）id 与坐标逐条核对第三轮证据 JSON，一致。
- 窄视口（CSS 宽 829px）下候选被遮挡，真实点击被 `BU_TARGET_OBSCURED` 挡住；改用键盘 `ArrowDown` + `Enter` 完成选择。

## 2. 选中后的本地归属回读

`scendance-place-recent-v1`（选中后写入，含 id/name/address/lng/lat）首条：

| 字段 | 值 |
| --- | --- |
| id | `B0FFMBT7FG` |
| name | 街心公园 |
| address | 学府树中街与学府树北街交叉口西北侧 |
| lng | 116.332721 |
| lat | 40.034093 |

次条为历史选择 `B0FFIMEKW0` 杭州湖滨银泰 in77（120.163749, 30.252830）。

## 3. 选中路径上的请求（网络缓冲读数）

本轮选择动作之后出现的非瓦片请求：

- `/api/place-shape-hints?q=街心公园`（轮廓提示）
- `/api/tdt-area?keywords=街心公园&limit=3&near=120.146037,30.252192`（天地图区域）
- OSM 底图瓦片若干

**没有**出现：

- `scene-api` 的 project / outdoor-plan 读取；
- 任何 `PUT` / `POST` / `PATCH` / `DELETE` 方案写请求。

> 订正上一轮「生产端单源高德」的记录：本轮检索除高德外还触发了天地图 `tdt-area` 与轮廓提示 `place-shape-hints`，正式站是多源拼装候选；同名对仍来自高德源（第三轮结论不变）。

## 4. plan 锚点状态

当前草稿 `9a889d2b-0e71-45bd-90b7-d9f36f7b665d` 的 plan 锚点仍是：

```
120.1460368, 30.2521924 · crs gcj-02 · source "preset"
```

轮廓尚未采纳进边界——「按所选 POI 轮廓落地边界」是选址确认之后的步骤，不属 #2 本条范围；本轮不据此判断边界归属。

## 5. 判定备注

- 本用例不应有写：本轮选中路径写请求 **0**，零写条件满足。
- 选中几何归属以 `place-recent` 首条 id/坐标为准，与所选 POI 一致；另一条同名候选未被误选。
- 本轮未补到「选中后读取 project」的云端读请求——因为这条路径上本就没有该读请求；登记为「选中路径不存在 project 读取」，不编造一次不存在的读取。
