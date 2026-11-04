# v3.4.0 与 IA 四角色重划对齐审计

| 项 | 值 |
|---|---|
| 审计范围 | v3.4.0 五个 commit（采集引导页 45be32b / MobileAgentDock 544ac1e / Lux3D 入库 4ab4427 / door 矢量化 6a44e4c / lucide-react 79238b3） |
| 对照基准 | ia-role-rework-ledger-2026-11-04 §3-D「库为主体生成是库内动作」+ T3-T7 封堵口径 |
| 日期 | 2026-11-05 |

## 结论

v3.4.0 主干与 IA 四角色**大体对齐**：MobileAgentDock 是纯启动器、Lux3D 入库只是后端资产 API、door 矢量化与依赖更新零 UI 触碰；**三道门（onApplyCreative 预览→确认→撤销）与 reviewSlot 封堵未被新入口绕过**。需要跟进的全部是「旧称呼/禁词回潮」与孤儿文件清理，共高 7 / 中 5 / 低 3。

## 高优先（7）

1. 「高斯 / Aholo / 3DGS」禁词回潮 19 处，集中 6 文件：capture-guide.tsx（7）、lux3d-direct-test.tsx（8）、aholo-guide-card.tsx（4）、space-panel.tsx:118、agent-panel.tsx:1362、room-organizer.tsx:1396/2294/2306。
2. 孤儿簇：agent-review-ledger.tsx + lib/review-ledger.ts + lib/review-ledger.test.ts（挂载点已随 S1/T3 拆除，文件随合并回灌）。
3. agent-chat.tsx:13/25/93 注释残留「总控」三处。
4. agent-panel.tsx runResearchCommand 绕 onPreview 直写（与「库为主体生成是库内动作」口径不一致）。

## 中优先（5）

5-9. v3.4.0 新 surface 的旧称呼「门庭/总控」散点（待下一轮文案批统一刷）。

## 低优先（3）

10-12. 审计报告自身格式、测试注释、tag 标注等。

## 处置

- 孤儿文件下一轮删除（需确认无 import）。
- 禁词与「总控」文案统一在下一批「文案清扫」过一遍。
- runResearchCommand 接线归 M2 Command 门批处理。
