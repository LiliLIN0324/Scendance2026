# M2 facility 映射收尾 · 可执行切片清单（基线 13258414）

> A1 切片：**纯函数 / 契约新增 / 对照测试**层，不接壳体、不动会话与历史绑定。本文件记录已落部分与后续可执行切片，供 G2 解锁后按序接线。

## 1. 基线与边界

| 项 | 值 |
| --- | --- |
| 基线 | `origin/main @ 13258414`（零引用清理合入后） |
| 切片分支 | `feat/m2-facility-mapping-finish` |
| 冻结面 | routeBridge 九方法签名、`SitePlanData` 既有字段、会话 scope、壳体装配均不动 |
| 本轮只动 | `plan-facility-migration.ts` 纯函数 + 其对照测试 |

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
| **A1-4 调用方接线** | 迁移入口接 `oneplan-library` 的 `libraryEntry` 查询与 slug 解析器 | M2 壳体物料接 plan（G2） | 是，暂不做 |
| **A1-5 assetId↔slug 对照** | 核 `assets/library/merged.json` 主键与 `glbUrl` 的可判定关系，定 resolver 实现 | 物料库主键口径拍板 | 否 |
| **A2-1 walls 契约** | `SitePlanData` 新增可选 `walls` 集合（points[2] + thicknessM/heightM/kind/status/zoneId） | 四问拍板 | 否（schema 侧） |
| **A2-2 walls 迁移纯函数** | `InteriorWall` 两端点经迁移帧逆变换；door/window 转 node 跳过 | A2-1 | 否 |
| **A3-1 plan 历史快照纯函数** | 快照序列化 / 比对 / 上限口径抽成可复用函数，供 M3b 换绑 | 无 | 否 |
| **A4-1 导出覆盖盘点** | 盘 `plan-export` 对 boundary/zone/facility/route/node/worker/measurement/annotation 的缺口 | 无 | 否 |
| **A4-2 plan 写权限断言** | 纯函数级 plan 写权限断言，供 M3c 替换 `assertLayoutWrite` | 无 | 否 |

每片验收统一：`tsc --noEmit` 0 + 该片定向测试全绿 + 不新增全量失败；不混入主工作树在途改动。

## 4. 仍未决（动工前需拍板）

1. walls 四问：线段 vs 折线、厚度/高度谁进 2D、碰撞/遮挡口径、集合上限。
2. `assetId ↔ 物料库 slug` 的判定来源（merged.json 主键 / templateId 反查 / 人工映射表）。
3. oneplan 真实占地：需 manifest 条目，纯函数层只能留注入点（本切片已留）。
4. 室内特化字段（WiFi/CCTV/锥角/elevation/structural 引用/price/handoff）：落 `notes` 还是留 3D 层。
5. 旧云项目读旧室内 schema：只读提示 vs 一次性投影（决定 R3 是否留降级通路）。
