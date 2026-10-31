# D2 验收 · 真重建进画布 · 2026-10-30

> 仓：本机 `Scendance2026` · **未 commit / push** · **不开云端**  
> 规划真源 Page：「地图×高斯×Aholo 进 3D」· D2 真重建进画布  
> 给人看的进展：`docs/visual-2026/aholo-product-gap-2026.html`  
> 前置：D0 / D1 / D1-流线 / D2-UX PASS  
> **默认干跑**；真调须扣额度确认闸；本刀未新建扣费任务。

## 必须看见

| 项 | 期望 |
|---|---|
| 默认干跑 | 场地重建勾选「干跑模拟」；不打代理、不扣额度 |
| 缺本场包标明 | 干跑态 / 干跑成功后屏上「仍缺本场包」+ 宴会厅样例说明；底栏样例标「样例·非本场」 |
| 扣额度确认闸 | 关干跑后须勾选「我确认本次提交将消耗 Aholo 额度」才可真提交 |
| 真成功挂本场 | 有 .spz 产物时按钮「挂本场环境预览（替换样例）」→ `openScenePreview` 落盘并打开环境抽屉，替换观感层 |
| 硬钉 | 卫星不可作重建素材；splat=观感（不进碰撞/落盘几何） |

## 失败即停

- 继续用宴会厅历史包冒充本场且无「仍缺本场包」标注
- 关干跑后无确认闸即可真提交
- 擅自 commit / push / 开云端扣费任务

## 复跑

```text
cd frontend
npx vitest run components/room-organizer/lib/site-recon-mock.test.ts components/room-organizer/panels/lux3d-direct-test.react.test.tsx
```

浏览器（干跑）：`/editor` → 观感 → 场地重建 → 选视频 → 干跑重建 → 「挂样例环境预览（仍缺本场包）」→ 见仍缺本场包文案。

真调（会扣额度，须主人明确确认后再跑）：关干跑 → 勾选额度确认闸 → 上传现场素材 → 轮询成功 → 「挂本场环境预览（替换样例）」。

## 改动摘要

- `lib/site-recon-mock.ts` · `VENUE_PACKAGE_MISSING` / `MOCK_HANG_DONE_NOTE` / `CREDIT_CONFIRM_LABEL` / `VENUE_PACKAGE_HUNG`
- `panels/lux3d-direct-test.tsx` · 额度确认闸；本场包状态；干跑挂样例文案；真成功挂本场按钮
- `panels/environment-preview.tsx` · shipped 样例标「样例·非本场」
- `room-organizer.tsx` · `openScenePreview` 同步打开环境预览抽屉
- `docs/visual-2026/aholo-product-gap-2026.html` · D2 行更新

## 未做

- 本机未跑真实扣费重建（无现场素材包、未过主人额度确认）
- D3 多边形轮廓壳体 / 卫星贴地底图
