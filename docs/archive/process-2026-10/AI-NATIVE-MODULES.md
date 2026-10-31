# 幕景 Scendance · 升级模块表

> 伴生：`AI-NATIVE-UPGRADE-v1.md`。实现 AI 先读蓝图 §0–§1，再按本表过滤。  
> **DO NOT EXECUTE CODE NOW**。in = 本升级规格要做；out = 明确不做/延期。  
> 未知依赖标「待核」。

| module_id | owner_surface | in/out | acceptance（摘要） | depends_on |
|---|---|---|---|---|
| `shell.workbench` | `/editor` 壳：左轨+画布+右栏 | **in** | 单壳；无独立策划/执行页；阶段切换不丢场景 | — |
| `shell.stage-rail` | 左轨三图标 布置/评审/执行 | **in** | 三图标常驻可点；与锁定约束一致（不删左轨） | `shell.workbench` |
| `shell.logo` | 顶栏原稿 mark | **in** | 与用户锁定 logo 一致，无替换 | — |
| `shell.tool-column` | 画布右 14 键工具列 | **in** | 14 键分组顺序在；撤销/导出在原位 | `shell.workbench` |
| `shell.topbar-stage-label` | 顶栏阶段文案（可与左轨并存） | **in**（弱） | 不与左轨抢唯一入口；双显策略待 PM | `shell.stage-rail` |
| `ia.no-duplicate-pages` | 路由与面板收敛 | **in** | 不新增合同/点验独立路由；资料进阶段/对话 | `shell.workbench` |
| `A.venue-blank` | 空白场地 | **in** | S01 空房间+预填可出方案 | `shell.workbench` |
| `A.basemap-image` | 图片底图投影 | **in** | S02–S04；α≈0.6；仅参照不识别墙 | `A.venue-blank` |
| `A.manual-dims` | 人工 L×W 米 | **in** | 1–500；非法红框；未填主按钮不可点 | `A.basemap-image` |
| `A.indoor-outdoor` | 室内/户外开关 | **in** | S07；仅户外露雨天提议 | `A.manual-dims` |
| `A.nav-measure` | 视角/2D3D/尺寸显示/全屏/缩放 | **in** | 均走工具列现键；不另造条 | `shell.tool-column` |
| `A.units-coords` | 米制 + XZ 契约 | **in** | 保存重开一致；wall≠furniture | 现有 scene schema |
| `A.dxf-first-mvp` | DXF 导入确认墙 | **out→next MVP** | 本期 S05 琥珀转图；不渲染假墙 | `A.units-coords`；@平面图 |
| `A.dwg-pdf-native` | DWG/PDF 原生 | **out** | 本期同 S05 提示 | `A.dxf-first-mvp` |
| `A.photo-metric-scan` | 照片自动测完整建筑 | **out** | 不宣称 | — |
| `A.multi-floor` | 多层/吊挂 | **out** | — | — |
| `B.select-transform` | 选移旋缩 | **in** | 真实改场景；可撤销 | `A.units-coords` |
| `B.duplicate-lock` | 复制/删除/锁 | **in** | 锁后 Agent/工具不可改 | `B.select-transform` |
| `B.group` | 成组/解组 | **in**（待核现状） | 有则接确认规则；无则标待核不假装 | `B.select-transform` |
| `B.library-place` | 物料抽屉放置 | **in** | 放置后可编；模板在 tab | `B.select-transform` |
| `B.properties` | 选中属性米制 | **in** | 与聊天不互盖主操作 | `B.select-transform` |
| `B.undo-redo` | 历史栈 | **in** | 工具列+Agent「撤回」同栈 | `shell.tool-column` |
| `B.agent-propose-apply` | 提案预览确认 | **in** | S10 绿框/虚线；无静默覆盖 | `D.tool-loop` |
| `B.overlap-marks` | 重叠/超出琥珀标 | **in** | 非消防结论 | `B.select-transform` |
| `B.realtime-collab` | 多人同编 | **out** | 仍轮流租约 | — |
| `C.client-review` | 评审阶段客户交付 | **in** | 只读链接或 HTML；无编辑控件 | `shell.stage-rail` |
| `C.view-route` | `/view/` | **in** | 令牌；撤销失效；手机可看 | `C.client-review` |
| `C.share-revoke` | 分享撤销 | **in** | 撤销后拒绝 | `C.view-route` |
| `C.export-html-offline` | 离线评审 HTML | **in** | 次要入口；含清单只读 | `C.client-review` |
| `C.publish-dual-exit` | 云发布 vs 评审双出口 | **in**（叙事） | 主出口唯一策略待 PM；代码先不删能力 | @产品经理 |
| `C.exec-ops` | 执行阶段本机资料 | **in** | 安排/工作单/计划/点验边界文案 | `shell.stage-rail` |
| `C.exec-exports` | CSV/JSON/GLB/交接 HTML 等 | **in** | 件数与场景一致；菜单在按钮下 | `C.exec-ops` |
| `C.contract-esign-pay` | 电子签/支付/开票 | **out** | — | — |
| `C.cloud-exec-collab` | 云端执行双人协作 | **out** | 未验收不宣称 | — |
| `D.qingguang-persona` | 晴光 3D 毛绒头像+命名 | **in** | 无 Bingo/扁平；**32/40 毛绒裁切**（另备 24/@2x） | @IP角色设计 |
| `D.chat-first-rail` | 右栏对话优先 | **in** | 头 48px；预填卡；一主按钮 | `shell.workbench` |
| `D.status-badges` | 做好了/发现问题 | **in** | 点+文字；不用头像角标 | `D.chat-first-rail` |
| `D.prefill-intake` | 类型/人数/场地卡 | **in** | Agent 先填用户点改 | `D.chat-first-rail` |
| `D.layout-generate` | 出方案中/停/失败 | **in** | S08/S09；已摆可留 | `D.tool-loop` |
| `D.tool-loop` | agent-runs 工具契约 | **in** | 白名单工具；发布不在默认工具 | 现有 DEEPSEEK_AGENT |
| `D.confirm-destructive` | 破坏性确认 | **in** | 清场/整替/批删须确认 | `B.agent-propose-apply` |
| `D.no-silent-navigate` | 不静默离画布 | **in** | 无擅自 `/projects` 跳转 | `D.tool-loop` |
| `D.ambience-nudge` | 天气等提议 | **in** | 只调工具列同一控件 | `shell.tool-column`、`A.indoor-outdoor` |
| `D.hy3-new` | 新 HY3 生成 | **out** | RETIRED 保持 | — |
| `D.long-memory` | 跨项目记忆 | **out** | — | — |
| `X.design-before-code` | 规格门禁 | **in** | 无验收清单不改 frontend | 本蓝图 |
| `X.evidence-screenshots` | 实现期证据 | **in** | 关键态截图+测例 | 各 in 模块 |
| `X.no-push-without-nod` | 发布纪律 | **in** | 无用户 nod 不 push/部署 | — |

