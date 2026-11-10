# H5-a 导出证据（2026-11-10 · 二十五轮 · feat/outdoor-2d）

## 交付内容

| 项 | 文件 | 说明 |
| --- | --- | --- |
| CSV 清单导出 | `lib/site-plan-csv.ts` | 14 字段表头、RFC4180 转义、UTF-8 BOM（Excel 双击直开）、行序稳定（类型枚举序+名称序，同 plan 字节一致可对账）、ENU 坐标列+GCJ-02 锚点经纬度列、问题标记列 |
| PNG 快照导出 | `lib/site-plan-png.ts` | 72/300 DPI 两档、快照布局纯函数（实体外接框+40m 边距自动框住全部实体、图例面板高度按条目数）、比例尺（1/2/5×10^n 整刻度自动换算）、北箭头、图例（buildPlanLegend 同源）、版本号署名行（r{revision}+DPI+时间+OSM 署名） |
| 导出菜单激活 | `outdoor-plan-interactions.tsx` | ExportMenu 增 enableExports：PNG/CSV/分享可点，GeoJSON 仍如实标「即将上线」 |
| 演示页接线 | `app/outdoor-plan/page.tsx` | CSV→downloadPlanCsv；PNG→取画布 DOM 合成 300 DPI 下载 |

## 验证记录

- 单测：`site-plan-csv.test.ts` 8/8（转义/BOM+表头/行序/字节稳定/逗号引号转义/坐标与锚点列/问题标记/node 标签）；`site-plan-png.test.ts` 7/7（外接框/布局与图例带/图例条目数/比例尺整刻度/北箭头朝上/署名含 OSM/DPI 两档）
- typecheck：前端 tsc 0 错
- build：`.next-h5a` Compiled successfully
- 浏览器实测（localhost:8783，OSM 真瓦片）：
  1. 菜单四项状态正确：PNG/CSV/只读分享可点，GeoJSON 禁用「即将上线」
  2. CSV 点击→真实下载 `pinghu-market-2026-11-10.csv`（2,425 B），验证：BOM 字节 EF BB BF ✓、表头 14 字段 ✓、数据 19 行 ✓、观众区行坐标 50.00/32.50 ✓、锚点经纬度列 ✓
  3. PNG 点击→真实下载 `site-plan-r1-2026-11-10-300dpi.png`（dataURL 1.47 MB，300 DPI 合成）
  4. 控制台 0 error

## 诚实标注

- PNG 快照底为纯色（不嵌瓦片）：瓦片随视图变化不可复现，快照以「可复现+可打印」为先；瓦片底快照在 H5-b 分享页按需另议
- PNG 比例尺/图例/北箭头为 Canvas 2D 程序绘制，视觉精度未做印刷级审查
- GeoJSON 导出归 H5-c

## 证据文件

- `pinghu-market-2026-11-10.csv`：实测下载的 CSV 原文件（BOM+14 列+19 行）

> AI 生成 · H 批第 16 卡