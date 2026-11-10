# H4-b 交互复刻证据（2026-11-10 · 二十五轮 · feat/outdoor-2d）

## 交付内容

| 项 | 文件 | 说明 |
| --- | --- | --- |
| 渐进引导状态机 | `lib/site-plan-guide.ts` | 三步渐进披露（welcome→layers→edit）、完成/跳过/重看、localStorage 宽容解析 |
| 引导 UI + 导出菜单 + 分享弹窗 | `components/outdoor-plan-interactions.tsx` | GuideBubble（毛玻璃气泡+步数+CTA+跳过）、ExportMenu（四项 OnePlan 对齐、点外关闭）、ShareDialog（毛玻璃+Esc 关闭+遮罩点击关闭）、useGuide hook（持久化注入） |
| 演示页接线 | `app/outdoor-plan/page.tsx` | 标题升 H4-b、导出/分享入口、重看引导入口、分享弹窗接统计数据 |
| 顺带修复 | `outdoor-plan-canvas.tsx` | onWheel passive 监听 preventDefault 告警（控制台 3 error→0） |

## 验证记录

- 单测：`site-plan-guide.test.ts` 8/8（渐进顺序/跳过/幂等/宽容解析/重看/内容完整/导出四项/分享文案）
- typecheck：前端 tsc 0 错
- build：`.next-h4b` Compiled successfully，`/outdoor-plan` 静态页产出（仅既有 import/order warning）
- 浏览器实测（localhost:8783，OSM 真瓦片）：
  1. 清 localStorage 后引导 1/3「这是你的场地画布」出现 → 完成 → 2/3「右侧是图层栈」→ 完成后引导消失、标题栏出现「重看引导」按钮
  2. 引导状态持久化：`outdoor-plan-guide-v1` 写入 `{"done":["welcome","layers","edit"],"dismissed":false}`
  3. 导出菜单四项形态齐全（PNG 快照/CSV 清单/GeoJSON/只读分享），三项如实标「即将上线」禁用，只读分享可点
  4. 只读分享→毛玻璃弹窗打开：标题「分享只读规划」、快照摘要（r1 · 13:46:58 · 3 分区 · 3 设施 · 3 动线 · 6 人员）、Esc 关闭生效、遮罩点击关闭生效
  5. 控制台 0 error（onWheel 修复后）

## 截图

- `h4b-share-dialog.png`：分享弹窗打开态（毛玻璃）
- `outdoor-plan-live-preview.png`：完整画布（信息面板四页签+六层+编辑工具+冲突标记）

## 诚实标注

- PNG/CSV/GeoJSON 导出实现归 H5-a/H5-c，本卡只落菜单形态（禁用+即将上线），不虚标可用
- 分享弹窗链接生成归 H5-b，本卡是形态预览（摘要文案如实写「即将上线」）
- 选中态对比度以品牌绿+白字统一（AA），未做单独色觉审查

> AI 生成 · H 批第 15 卡

> AI生成
