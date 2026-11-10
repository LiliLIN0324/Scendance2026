# H5-b 只读分享 + PDF 演示稿证据（2026-11-10 · 二十五轮 · feat/outdoor-2d）

## 交付内容

| 项 | 文件 | 说明 |
| --- | --- | --- |
| 分享编解码 | `lib/site-plan-share.ts` | base64url 编解码、宽容解析（损坏返回 null）、`#snapshot=` hash 读取、buildShareLink |
| 只读分享页 | `app/plan-share/page.tsx` | 接收方视角：标题「只读规划分享」+ 快照 r{revision} + 统计条 + 画布（无 onPlanChange 无编辑工具）+ 图例页脚 + OSM 署名；快照缺失/非法如实展示「分享不存在或已失效」；演示快照兜底标注 |
| PDF 演示稿 | `lib/site-plan-pdf.ts` | 数据驱动页面（封面/总览+图例/分组清单）、打印管线注入（A4 宽隐藏容器、@media print 仅显示演示稿）、封面嵌 72 DPI 快照图、署名含 OSM |
| ShareDialog 扩展 | `outdoor-plan-interactions.tsx` | 链接输入框+复制按钮（clipboard API+已复制态）、「打印 PDF 演示稿」入口 |
| 演示页接线 | `app/outdoor-plan/page.tsx` | shareLink 生成（origin+/plan-share+#snapshot）、打印回调（composePlanPng 72 DPI + printPlanDeck） |

## 验证记录

- 单测：`site-plan-pdf.test.ts` 6/6（封面+总览+分组清单页/空组不输出/问题标记 ⚠/图例行同源/署名含 r+OSM；编解码往返无损/损坏安全拒绝）
- typecheck：前端 tsc 0 错；csv+png+pdf 三套 21/21 回归
- 浏览器实测（localhost:8783）：
  1. 分享弹窗：链接输入框（`http://localhost:8783/plan-share#snapshot=…`）、复制链接按钮、打印 PDF 按钮齐全
  2. `/plan-share` 直开：标题「只读规划分享」、双画布渲染、**无任何编辑工具**（只读语义成立）、底部图例 7 条 +「接收方只读 · 底图 © OpenStreetMap contributors」
  3. 打印 PDF：window.print 拦截验证调用 1 次、注入容器含封面（r1+快照图标注）/总览（24000 m²/3 分区/6 设施/238.1 m 动线/6 人/3 冲突）/图例（场地边界×1、舞台区×1…）
- 快照 codec 往返：encode→decode revision/name/长度无损（测试断言）

## 诚实标注

- 本地分享链接是 base64url 快照进 hash 的**演示形态**：长 URL、无撤销失效；生产接线归 B（快照表+token 撤销），页面消费契约（SitePlanSnapshot）与生产一致
- PDF 走浏览器打印管线（「另存为 PDF」本地下载），未做打印样式逐浏览器回归
- 分享页「撤销即失效」在本地形态下=删除链接；生产 token 撤销归 H5-c/B 接线

> AI 生成 · H 批第 17 卡