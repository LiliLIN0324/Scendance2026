# D1 验收 · 采集单 → 上传/重建（Aholo）· 2026-10-30

> 仓：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`（本机，非云端）  
> 授权：用户 t559u「嗯！D1开动！ D0的修改放在我的电脑本地哦！」  
> **结果：PASS**（vitest 相关文件；UI 干跑路径）  
> 未 commit / push / tag；默认干跑，未新建扣额度的 Lux3D / World 任务。

## 必须看见

| 项 | 结果 |
|---|---|
| 圈画/演示圈画后可打开采集单 | PASS · D0 立壳后浮层收起；再点左轨「地图」采集单仍在（`map-venue-overlay.react.test.tsx`） |
| 采集单旁有上传入口，接到现有 Aholo 重建 | PASS · 「去上传现场素材」→ `onReconUpload` → 左栏 Aholo「场地重建」并带上地名/应拍数；文件选择走 `/recon-upload` + `/world-recon` 形状 |
| 成功路径（mock）可挂环境预览 | PASS · 默认「干跑模拟」：选视频/≥20 张 →「干跑重建」→「挂环境预览（干跑）」回调 `hangDemoEnvironment`（等同 D0 hang，替换观感层 .spz） |
| 禁止高德/卫星当重建素材 | PASS · 采集单卡、导出 HTML、重建面板、教程卡均写明禁令 |
| 相关 vitest | PASS · 见下方命令 |

## 失败即停（均未触发）

- 仍声称用高德图重建
- 上传与采集单完全脱节
- splat 进碰撞/落盘几何（干跑仍走既有环境预览层）
- 擅自 commit / push

## 复现

```text
# 终端 1（干跑可不启；真调才需要）
node tools/aholo/lux3d-dev-proxy.mjs          # 127.0.0.1:3199

# 终端 2
cd frontend; npx next dev                     # :3000；卡死则 :3001

浏览器 http://127.0.0.1:3000/editor
1. 左轨「地图」→「演示圈画 · 12×8 m」（或手画后生成户外场地）
2. 浮层收起、画布挂 D0 历史环境预览；再点「地图」看到采集单
3. 「去上传现场素材」→ 左栏切到 Aholo「场地重建」，名称/应拍数已填
4. 保持「干跑模拟」勾选 → 选一段 .mp4（或 ≥20 张照片）→「干跑重建（不扣额度）」
5. 「挂环境预览（干跑）」→ 画布观感层挂 shipped 样例 .spz（壳体+glTF 不变）

真调（会扣额度）：取消「干跑模拟」，需 proxy + LUX3D_API_KEY，走 /recon-upload → /world-recon → 轮询 →「在 3D 场景预览」。

自动化：
cd frontend
npx vitest run components/room-organizer/lib/site-capture.test.ts components/room-organizer/lib/site-recon-mock.test.ts components/room-organizer/panels/site-capture-card.react.test.tsx components/room-organizer/panels/map-venue-overlay.react.test.tsx components/room-organizer/panels/lux3d-direct-test.react.test.tsx
```

## 改动摘要（相对 D0 WIP，未提交）

- `lib/site-recon-mock.ts` (+test) · 干跑任务号/完成态/禁令文案
- `panels/lux3d-direct-test.tsx` · 默认干跑开关；真调标注扣额度；干跑挂载回调；禁令
- `panels/lux3d-direct-test.react.test.tsx` · 采集单预设 + 干跑挂载
- `panels/site-capture-card.tsx` (+test) · 禁令
- `lib/site-capture.ts` · 导出 HTML 禁令
- `panels/aholo-guide-card.tsx` · 重建教程禁令
- `room-organizer.tsx` · `onHangMockScene={hangDemoEnvironment}`

## 未做 / 风险

- 规划 Page「D1 流线」（圈内主客流线加密站位）未做——非本轮硬门槛
- 多边形真实轮廓壳体（D3）、卫星贴地底图未做
- 干跑挂的仍是历史宴会厅样例 .spz，不是本场真重建；真场须关干跑并上传现场素材
- 上传入口仅 `NODE_ENV===development` 可见（与既有 Aholo 左栏一致）；生产构建无此钮
- 未跑 Playwright 全屏探针（D0 探针仍可用；本轮以 vitest + 干跑 UI 为准）
