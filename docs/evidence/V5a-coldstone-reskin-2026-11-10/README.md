# V5-a 视觉收敛冷石画廊白（2026-11-10 · 二十五轮 · feat/outdoor-2d）

## 背景（用户拍板）

户外 2D 规划**不是独立产品**：需与主产品接上、视觉**完全服从**主产品设计系统。
此前 H 批演示页用自造深色主题（#0f1620 底/#182230 面板/浅字），与主产品
「冷石画廊白」规范（docs/05-设计规范.md v2.5.12 · globals.css）冲突。

## 改动（Phase 1 视觉收敛）

| 层 | 文件 | 改动 |
| --- | --- | --- |
| tokens | `lib/outdoor-plan-tokens.ts` | `PLANNING_SURFACE` 9 值全换规范值（panelBg=--paper 白/panelBorder=--hair 发丝线/panelText=--ink 墨字/fieldBg=--plane/activeBg=--green-pale/selectedBorder=--green #4A7C59/selectedBg=绿12%/warnText=--warn/dangerText=--err）；新增 `PLANNING_TEXT`（soft=--ink-soft/muted=--muted） |
| 交互层 | `components/outdoor-plan-interactions.tsx` | 引导气泡=白底+E1；导出菜单=白底+发丝线+r-md+E1；分享弹窗=模态规范（min(560,100vw-32)/r-lg 18/E2/32% 墨遮罩/H2 20px 标题/ghost 关闭/底部右对齐 secondary+primary）；主钮=墨底白字（--primary）、次钮/触发钮=ghost、菜单激活项=绿点睛；字号对齐 7 档字阶、fontFamily=inherit |
| 演示页壳 | `app/outdoor-plan/page.tsx` | 白底墨字/发丝线 header/ghost 工具钮/plane 下拉底/统计文字 ink-soft/冲突红=--err |
| 分享页壳 | `app/plan-share/page.tsx` | 同上演示页壳口径 |

## 验证

- 深色 hex 扫描：四文件残留 **0**（`#0f1620/#182230/#24334a/#35485f/#e7edf5/#cdd9ea/#93a4bc/旧绿 rgba` 全清）
- 测试：tokens 8/8（钉住新值 selectedBorder=#4a7c59）+ canvas 31/31 + guide 8/8 = 47/47；tsc 0
- 浏览器实测（8783）：main/header 背景 `rgb(255,255,255)`、文字 `rgb(20,20,22)`；视觉模型逐项复核——白底浅色风✓、面板白底细边深字✓、瓦片与图层正常✓；复核发现的「导出/分享」墨底主钮与相邻 ghost 不统一已修（触发钮归 ghost，墨底主钮只留弹窗底部）
- 截图：`coldstone-outdoor-plan.png`（换肤后）、`coldstone-final.png`（按钮统一后）

## 未动（如实标注）

- `/tdt-probe` 探针页保持深色——内部开发探针工具，非产品页面（Phase 2 嵌工作台时不迁移）
- 业务图层色（分区绿/设施橙/动线蓝/人员粉）保留——数据可视化色非 UI 壳色，白底瓦片上对比度已复核
- Phase 2（嵌入工作台，需动 `room-organizer.tsx` 独占文件）与 Phase 3（localStorage→项目体系）待用户确认入口后推进

> AI 生成 · 主产品视觉收敛 Phase 1