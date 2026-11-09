# 户外 2D 复刻 · 验收报告（H 批）

> 2026-11-10 中午验收 · 分支 `feat/outdoor-2d` · 目标「争取完成空间布局」
> 12 点验收契约对照（HANDOFF 顶部）：① H0-a+H0-b 完成且有证据（H0-c 尽力）② H1-a 完成、H1-b 尽力 ③ 每轮回填可查 ④ 本报告

## 一、验收契约对照

| 契约项 | 状态 | 证据 |
| --- | --- | --- |
| ① H0-a 天地图瓦片代理 | ✅ 完成 | `functions/api/tdt-tiles.ts`+`tdt-env.ts`；`tdt-pages-tiles.test.ts` 6/6；根 tsc 0、前端 tsc 0 |
| ① H0-b 满铺探针页 | ✅ 完成 | `frontend/app/tdt-probe/`；`tdt-probe.test.ts` 6/6；build 16/16 含 `/tdt-probe`；浏览器实测 mock 渲染 100% 填充+图层切换 |
| ① H0-c 尺度/坐标/报告（尽力） | ✅ 完成 | `lib/tdt-probe-scale.ts(.test)` 4/4；报告 `docs/evidence/tdt-probe-2026-11-10.md`；OSM/指针测距/额度实测为待 key 或尽力项 |
| ② H1-a SitePlan 契约 | ✅ 完成 | `supabase/functions/_shared/site-plan.ts`；`tests/site-plan.test.ts` 7/7、根 tsc 0 |
| ② H1-b 版本化子资源（尽力） | ⚠️ 前端侧完成 | `lib/site-plan-store.ts` 版本化存储+并发冲突+与 scene 并存；`site-plan-store.test.ts` 5/5；云端表/权限接线归 B 留评审 |
| ③ 每轮回填可查 | ✅ | HANDOFF 认领表同步至 `e3f9243`，本分支 8 个 H 批提交 |
| ④ 验收报告 | ✅ 本文件 | `docs/evidence/noon-report-2026-11-10.md` |

## 二、已完成卡片与提交

| 卡 | 内容 | 提交 | 验证 |
| --- | --- | --- | --- |
| H0-a | 天地图瓦片代理 | `3e96d2c` | key 只留服务端、白名单图层、双主机轮询、失败占位 SVG |
| H0-b | 满铺探针页 | `314c845` | EPSG:3857 画布、矢量/影像切换、注记叠加、比例尺/署名/回到场地、无 key 降级占位网格 |
| H0-c | 尺度夹具+对位+报告 | `2af99e5` | 500×500m 双底图一致 ≤1cm；GCJ-02↔WGS84 往返<1m |
| H1-a | SitePlan 数据契约 | `112522d` | 米制 ENU+UUID+版本快照信封+派生几何与指纹 |
| H1-b(前端) | 版本化存储+并存 | `3a81e4d` | 快照/版本/并发冲突保护/与 scene 并存 |
| 回填 | HANDOFF 认领表 | `e3f9243` | 24h 认领表同步 |

## 三、关键实现要点

- **瓦片代理**：`TDT_KEY` 只在 Pages 环境变量，浏览器只打 `/api/tdt-tiles`，响应不带 `tk`；图层白名单 `vec_w/cva_w/img_w/cia_w`（同后缀配对）；每瓦片双主机（t0–t7 轮询×2）8s 超时，失败回占位 SVG。
- **满铺探针**：独立路由不动现有 `AmapVenuePicker` 主路径；无 key 时前端画程序化占位网格，满铺/缩放/拖拽/图层切换仍可验证，状态栏显式标「待 key 实测」。
- **SitePlan 契约**：局部米制 ENU（x 东/y 北 ±5km）、GCJ-02 显式锚点、9 类分区、设施实例（templateId+尺寸+主归属）、三类动线（人行/车辆/后勤，widthM 可选缺宽不虚构）、出入口节点、人员点位，全部带 UUID。
- **版本化存储**：前端契约层演示快照装载、版本单调递增、并发冲突（REVISION_CONFLICT）、与旧 scene 并存（互不覆盖）——不落线上 schema，云端接线归 B。

## 四、诚实标注的遗留

1. **天地图 key 未到位** → 真瓦片渲染、影像/矢量实际对位、额度实测留待 key（相关项标「待 key 实测」，不算失败）。
2. **H0-b 尽力项**：OSM 海外回落、指针测距读数未落地，留待 H2 画布组件。
3. **H1-b 云端接线**：表+权限+契约测试的线上部分归 B 角色评审，本分支只做了前端契约层（接口不变，B 可实现线上适配器）。
4. **未跑 deploy/build 全门禁**：本分支只本地提交、未 push 未部署（纪律要求），验收在干净分支通过 typecheck+vitest。

## 五、下一步建议

- 申请天地图 key → 真瓦片对账 + 额度实测 → 回填 P0b 计划。
- 接 H2 满铺画布组件 + 图层栈（依赖 H0-b, H1-c）；H1-c 迁移演练待 H1-b 云端接线后。
- 12 点验收后由用户确认是否继续 H2 线。

> AI 生成 · 二十四轮 H 批验收

> AI生成
