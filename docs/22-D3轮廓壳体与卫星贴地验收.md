# D3 验收 · 多边形真轮廓壳体 / 卫星贴地底图 · 2026-10-30

> 仓：本机 `Scendance2026` · **未 commit / push** · **不开云端**  
> 规划真源 Page：「地图×高斯×Aholo 进 3D」· D3  
> 给人看的进展：`docs/visual-2026/aholo-product-gap-2026.html` · `user-flow-map-2026.html`  
> 前置：D0 / D1 / D1-流线 / D2 PASS  
> **禁止**把卫星/高德图当 3DGS 重建素材；卫星贴地仅可选参考底图。

## 必须看见

| 项 | 期望 |
|---|---|
| 真轮廓壳体 | 圈画多边形进 3D 按点列立壳（`venue.shape=polygon` + `polygon[]`）；无点列才退化为轴对齐矩形 |
| 演示非矩形 | 「演示圈画 · L 轮廓」立 L 形壳体，2D 俯视/3D 地面轮廓不是矩形 |
| 卫星贴地可选 | 圈画面板勾选「卫星贴地参考底图（可选·默认关）」；贴地后屏上「参考底图·不可作重建素材」 |
| 禁令一致 | 与 `RECON_MATERIAL_BAN` 一致；`floorPlanImage` / `satelliteGroundRef` 不进采集上传 / Aholo 重建 |
| 硬钉 | 高德只定场；splat=观感；布置仍壳体+glTF；不 commit/push/开云端/真扣额度 |

## 失败即停

- 有点列仍只立轴对齐矩形却声称真轮廓
- 默认打开卫星贴地，或把卫星图塞进重建上传
- 擅自 commit / push / 开云端扣费任务

## 复跑

```text
cd frontend
npx vitest run components/room-organizer/lib/amap-venue.test.ts components/room-organizer/lib/venue-shell.test.ts
```

浏览器：`/editor` → 左轨地图 →「演示圈画 · L 轮廓」→ 俯视见 L 壳；再勾选卫星贴地参考 → 再生 → 地面见参考底图文案。

## 改动摘要

- `lib/amap-venue.ts` · `polygonToLocalMeters` / `fitPolygonToShellLimit` / 卫星占位与标记；`createVenueFromPick` 走真轮廓
- `lib/venue-shell.ts` · `polygonMeters` → `shape:'polygon'`
- `lib/agent-proposal.ts` · 透传轮廓；`rebuildableShell` 允许多边形地图壳重立
- `panels/amap-venue-picker.tsx` · L 演示 + 卫星贴地开关（默认关）
- `three/structure-builder.ts` · 可选卫星参考贴地
- `docs/visual-2026/aholo-product-gap-2026.html` · D3 已做
- `docs/visual-2026/user-flow-map-2026.html` · C 泳道一句

## 未做

- 未拉取真实高德静态卫星瓦片（占位 SVG 已带禁令文案；真瓦片仍不得进重建）
- 未真扣 Aholo 额度
