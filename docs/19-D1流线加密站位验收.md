# D1 流线验收 · 圈内主客流线加密站位 · 2026-10-30

> 仓：本机 `Scendance2026` · **未 commit / push**  
> 规划真源 Page：「地图×高斯×Aholo 进 3D」· D1 流线采集  
> 给人看的进展：`docs/visual-2026/aholo-product-gap-2026.html` · `user-flow-map-2026.html`  
> 前置：D0 / D1 采集干跑 / D2 观感产品化已 PASS

## 必须看见

| 项 | 期望 |
|---|---|
| 地图可画主客流线 | 圈边界后「画主客流线」；未画则用默认长轴流线 |
| 站位沿流线加密 | `capturePlanForVenue` / `capturePlanAlongFlow`；mode=`flow`；非边界环 |
| 采集单/导出 | 标题「沿流线」；俯视图含流线折线；禁令仍在 |
| 接现有浮层 | MapVenueOverlay → SiteCaptureCard；上传 hint 含「沿流线」 |
| 硬钉 | 高德不定重建素材；splat=观感（本刀未改重建管线） |

## 失败即停

- 只有边界站位却声称「流线建模」
- 擅自 commit / push / 开云端额度任务

## 复跑

```text
cd frontend
npx vitest run components/room-organizer/lib/site-capture.test.ts components/room-organizer/panels/site-capture-card.react.test.tsx components/room-organizer/panels/map-venue-overlay.react.test.tsx
```

浏览器：`/editor` → 左轨地图 → 演示圈画（或手画+流线）→ 再开地图见沿流线采集单 → 导出 HTML。

## 改动摘要

- `lib/site-capture.ts` · `defaultGuestFlow` / `capturePlanAlongFlow` / `capturePlanForVenue`；导出 SVG 画流线
- `panels/amap-venue-picker.tsx` · 「画主客流线」；demo/生成带 flow
- `panels/agent-panel.tsx` · MapVenueOverlay 走 `capturePlanForVenue`
- `panels/site-capture-card.tsx` · 沿流线文案
- `docs/visual-2026/aholo-product-gap-2026.html` · P1 流线已做
- `docs/visual-2026/user-flow-map-2026.html` · C 泳道文案
