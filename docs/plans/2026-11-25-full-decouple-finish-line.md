# 全部完成 · 终线目标与收口清单（2026-11-25 用户拍板）

用户口径（本会话）：「定个目标全部完成」「继续完成，不做完不停」「E3E4 直接做」「第一性原理」。
本文是这条主线的收口合同：**满足 §1 四条件才算完成**，其余都是过程。

---

## §1 终线（可验证的四条件）

1. **室内渲染链彻底不存在**：`use-three-scene`、`use-scene-effects`、`use-npcs`、`use-walkthrough`、`panels/viewport`、`panels/minimap`、室内 2D 编辑态，源码中零引用。
2. **室内专属数据与能力不存在**：`layoutStore` / `layout-reducer` / `use-layout-state` 不再作为布局正源；`FloorLayout.interiorWalls/zones/height`、`drawWallMode`、`wallDisplay`、`snapToWall`、`opening-snap`、`stairs`、`floor-keep-out`、室内碰撞 `hasCollisions` 的室内分支全部退役；户外物料与导出改由 `SitePlanData`（plan 正源）承担。
3. **身份单一源**：全仓 `layout.id ?? 'local'` / `layout.id??'local'` 归零；`RoomEditorContextValue` 带 `projectId`；持久桶 scope 一律走 projectId / `outdoorPlanSlotId`，不存在 `layout.id` 裸回退。
4. **没有二分与外写镜像**：`isOutdoorProject` 二分判断不存在；`seededPlanFromLayout` 与 layout→plan 回写镜像不存在；打开任何项目只走一条「plan 为唯一正源」的路径。

## §2 完成门的命令（每次收口必须全绿）

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test        # 只认定向套件绿；全量 flaky 不算红
npm --prefix frontend run build       # 静态导出必须成功
```

真机（3002）走查必须覆盖：户外 2D 地图、户外 3D 接管、空间页（案例/示例/实景）、放一件物料、导出、分享链接。
控制台 0 error；`.sc-scene-viewport` 不存在。

静态闸（收口前 grep，必须为 0 或仅剩契约文件）：

```bash
grep -rn "use-three-scene\|use-scene-effects\|use-npcs\|use-walkthrough" frontend/components frontend/app
grep -rn "layout.id ?? 'local'\|layout.id??'local'" frontend
grep -rn "isOutdoorProject\|seededPlanFromLayout" frontend
```

## §3 切片顺序（每片自带验收，绿了才进下一片）

| # | 切片 | 关键改动 | 验收 |
|---|---|---|---|
| S1 | 死 3D 引擎退役 | 删 `use-three-scene` + `use-canvas-2d-interaction` + `use-item-drag` 的壳体挂载；`use-import-export` 签名改为不再收 renderer/scene/camera refs；`use-camera-presets`/`use-scene-zoom` 一并退役 | tsc 0；canvas-session / import-export / review-capture 套件绿；真机导出仍能出图（或明确记录改为 plan 渲染） |
| S2 | 室内墙门楼层退役 | `FloorLayout` 去 `interiorWalls/zones/height`；`drawWallMode`/`wallDisplay`/`snapToWall`/`opening-snap`/`stairs`/`floor-keep-out` 删；`hasCollisions` 只留通用占地分支；户外共用的几何先抽到 `lib/` 再删室内入口 | tsc 0；layout-reducer / item-drag / geometry 套件绿 |
| S3 | 布局仓收口 | `layoutStore`/`use-layout-state`/`layout-reducer` 退役；布局读写改 plan 正源；旧本机草稿走一次性迁移或只读 | tsc 0；project-restore / backup / export 套件绿；真机重开旧项目验证 |
| S4 | 身份单源 | `RoomEditorContextValue` 加 `projectId`；78 处 `layout.id` scope 读点改 projectId / `outdoorPlanSlotId` | 静态闸归零；各面板套件绿；真机切项目无串数据 |
| S5 | 二分与镜像 | 删 `isOutdoorProject`、`seededPlanFromLayout`、layout→plan 回写；入口只走 plan | tsc 0；share / scene-delivery / manifest 套件绿；真机分享与导出复验 |
| S6 | 文案与残留 | `scendance-workspace` 的 `!outdoorEditing` 室内兜底块、氛围 UI、旧注释与 shortcut 文案清理 | tsc 0；workspace 套件绿；真机右轨无室内件 |

## §4 不做与红线

- 不伪造户外资产：仓库里没有真户外 `.spz`，三张示例缩略图仍是原室内全景，等真包入库再换。
- 不删用户数据：示例/案例/实景扫描只换入口与命名，不删文件、不搬文件。
- 独占 5 文件（`room-organizer.tsx`、`use-import-export.ts`、`use-splat-preview.ts`、`three/splat-preview.ts`、`scendance-workspace.tsx`）动前必须在 `HANDOFF.md`《协作区变更登记》加行。
- 几何基线 `three/scan-placement.ts`、`three/furniture-builders.ts` 不就地改。
- 只按明确路径 `git add`；不 `git add -A`；不频繁 push，攒到整批验收后一次性推。

## §5 进度

- [x] E1 立壳入口并入地图草稿
- [x] E2 卸 Viewport 与室内 three/2D（含 E2-c）
- [x] E3 二～七刀：人群 / 光照 / 摄像机预览 / 人物模型 / 场景效果引擎 / 天气
- [x] 空间入口恢复 + 示例场景中性化
- [ ] S1 死 3D 引擎退役（进行中）
- [ ] S2 室内墙门楼层退役
- [ ] S3 布局仓收口
- [ ] S4 身份单源
- [ ] S5 二分与镜像
- [ ] S6 文案与残留
