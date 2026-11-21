# Scendance 文档地图（DOC-MAP）

> **本页由脚本生成，不要手改。** 重新生成：`node scripts/doc-scan.mjs`（Node ≥ 20，无依赖）。
> 生成时间：2026-11-21 15:17；扫描口径见页尾「生成口径」。
> 分工：本页只回答「有哪些文件、多大、什么时候动过」；**要读什么看 [README.md](README.md)**，按用途归类看 [INDEX.md](INDEX.md)。

## 一、全景

| 位置 | md | 体量 | 收什么 |
| --- | ---: | ---: | --- |
| docs/（根目录） | 55 | 0.9 MB | 现行规格 / 计划 / 参考：编号文档 + 无编号页 |
| docs/plans/ | 121 | 2.5 MB | 在建方案、交接、批次交付记录 |
| docs/archive/ | 115 | 1.3 MB | 历史：report / plan / research / visual / legacy / example |
| docs/evidence/ | 71 | 0.3 MB | 实测证据（回执、截图说明、探针记录） |
| docs/research/ | 21 | 0.3 MB | 调研长文 |
| docs/ 其他子目录 | 10 | 0.1 MB | contracts / quality / oneplan-icons / release-notes |
| flow/ | 28 | 0.4 MB | 任务卡、决策、进展流水 |
| frontend/ | 20 | 0.1 MB | 前端模块自带说明 |
| tools/ | 7 | 0.0 MB | 离线工具说明 |
| 其他模块 | 24 | 0.2 MB | assets / data / deliverables / supabase / learning-library 等 |
| 仓库根 | 9 | 1.0 MB | 协作、交接、变更、记忆 |
| agent 草稿（未入库） | 26 | 0.5 MB | agent 运行产物与会话草稿，不参与文档体系 |
| **合计** | **507** | **7.7 MB** | 其中可读文档 481 份（7.2 MB），agent 草稿 26 份 |

## 二、`docs/` 根目录（55 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [02-交付与Agent能力.md](<02-交付与Agent能力.md>) | 45.9 | 2026-11-21 | 02 · 交付与 Agent 能力：缺什么、按什么优先级补、怎么验收 |
| [48-PetitMaker-Agent对标实测-20261121.md](<48-PetitMaker-Agent对标实测-20261121.md>) | 8.0 | 2026-11-21 | PetitMaker（谷地工坊）Agent 对标实测报告（2026-11-21） |
| [49-Agent工具循环与双交付形态-对标收敛卡-20261121.md](<49-Agent工具循环与双交付形态-对标收敛卡-20261121.md>) | 8.6 | 2026-11-21 | Agent 工具循环与双交付形态——PetitMaker 对标收敛卡（2026-11-21） |
| [50-谷地工坊交互逻辑拆解与落地卡-20261121.md](<50-谷地工坊交互逻辑拆解与落地卡-20261121.md>) | 8.7 | 2026-11-21 | 谷地工坊交互逻辑拆解与落地卡（2026-11-21） |
| [63-Agent合格度与断点审计-20261121.md](<63-Agent合格度与断点审计-20261121.md>) | 24.3 | 2026-11-21 | 63 · 什么算一个合格的 AI Agent：三层判据与幕景实测断点 |
| [DOC-MAP.md](<DOC-MAP.md>) | 82.9 | 2026-11-21 | Scendance 文档地图（DOC-MAP） |
| [INDEX.md](<INDEX.md>) | 23.7 | 2026-11-21 | 文档索引（2026-11-13 手工整理版） |
| [README.md](<README.md>) | 11.1 | 2026-11-21 | Scendance 文档总览 |
| [05-设计规范.md](<05-设计规范.md>) | 40.1 | 2026-11-20 | Scendance 2026 设计规范 v2.5.18 |
| [47-户外Agent设计智能升级计划-20261117.md](<47-户外Agent设计智能升级计划-20261117.md>) | 36.9 | 2026-11-20 | 户外 Agent 设计智能升级计划（2026-11-17） |
| [58-成熟案例库与物料参考-20261118.md](<58-成熟案例库与物料参考-20261118.md>) | 10.4 | 2026-11-20 | 58 · 成熟案例库与物料参考（2026-11-18） |
| [01-素材与3D重建.md](<01-素材与3D重建.md>) | 45.9 | 2026-11-19 | 西湖场地素材与 3D 重建技术路线（合并稿） |
| [59-Agent评测集与打分口径-20261118.md](<59-Agent评测集与打分口径-20261118.md>) | 8.0 | 2026-11-19 | 59 · Agent 评测集与打分口径（2026-11-18） |
| [60-阈值审计与案例校准-20261118.md](<60-阈值审计与案例校准-20261118.md>) | 8.0 | 2026-11-19 | 60 · 阈值审计与案例校准（2026-11-18） |
| [61-真实场地档案抽取-20261118.md](<61-真实场地档案抽取-20261118.md>) | 6.9 | 2026-11-19 | 61 · 真实场地档案抽取：能抽到什么、能算几条（2026-11-18） |
| [62-OSM建筑轮廓与真实数据判据-20261118.md](<62-OSM建筑轮廓与真实数据判据-20261118.md>) | 5.3 | 2026-11-19 | 62 · OSM 建筑轮廓：真实数据第一次算出判据（2026-11-18） |
| [57-Agent底座语料-场地证据与判据集-20261118.md](<57-Agent底座语料-场地证据与判据集-20261118.md>) | 11.6 | 2026-11-18 | 57 · Agent 底座语料：场地证据 × 判据集 × 场景模板 × 物料参数（2026-11-18） |
| [11-AI系统提示词.md](<11-AI系统提示词.md>) | 7.8 | 2026-11-17 | AI 系统提示词 |
| [46-虚拟场地纸面模式规格-20261117.md](<46-虚拟场地纸面模式规格-20261117.md>) | 5.3 | 2026-11-17 | 46 - 虚拟场地纸面模式规格（2026-11-17） |
| [46-Agent运行卫生上线手册-20261116.md](<46-Agent运行卫生上线手册-20261116.md>) | 6.6 | 2026-11-16 | Agent 运行卫生：上线、观察与回滚（20261116） |
| [COMPASS_TURN_ARROWS_PLAN.md](<COMPASS_TURN_ARROWS_PLAN.md>) | 6.4 | 2026-11-16 | 3D 罗盘两侧转向箭头复刻计划（交接） |
| [medium-layout-fix-list.md](<medium-layout-fix-list.md>) | 11.8 | 2026-11-16 | 中等尺寸布局（769–1080）改造记录 |
| [19-西湖户外重建接力.md](<19-西湖户外重建接力.md>) | 10.5 | 2026-11-13 | 49 - 西湖户外重建接力（scene-3d-outdoor → Aholo World） |
| [21-双端入口与统一任务表.md](<21-双端入口与统一任务表.md>) | 37.1 | 2026-11-13 | 51 · 双端入口与统一任务表（2026-11-05） |
| [25-Scendance需求清单.md](<25-Scendance需求清单.md>) | 15.4 | 2026-11-13 | Scendance 需求清单与分批执行计划 |
| [29-重建样本归档.md](<29-重建样本归档.md>) | 15.6 | 2026-11-13 | 29 · 重建样本归档（SC-25，2026-11-07） |
| [32-SC19-容量边界复验.md](<32-SC19-容量边界复验.md>) | 27.8 | 2026-11-13 | SC-19 · P1 复验容量边界 — 交付记录 |
| [43-Agent场地理解与自动排布P0计划-20261112.md](<43-Agent场地理解与自动排布P0计划-20261112.md>) | 28.7 | 2026-11-13 | 43 · Agent 场地理解与自动排布 P0 计划（V-1～V-5，2026-11-12） |
| [44-户外V1-V5-Box收尾验收-20261113.md](<44-户外V1-V5-Box收尾验收-20261113.md>) | 41.4 | 2026-11-13 | 户外 V1–V5：BOX 收尾与待验收（2026-11-13） |
| [45-户外Agent-V1-V5对话主链重构矩阵-20261113.md](<45-户外Agent-V1-V5对话主链重构矩阵-20261113.md>) | 42.8 | 2026-11-13 | 45 · 户外 Agent V1–V5 对话主链重构矩阵 |
| [55-小程序上线路线与主体约束.md](<55-小程序上线路线与主体约束.md>) | 15.9 | 2026-11-13 | 55 · 小程序上线路线与主体约束（2026-11-05） |
| [56-小程序定位重构.md](<56-小程序定位重构.md>) | 15.5 | 2026-11-13 | 56 · 小程序定位重构：从「采集工具」到「微信里的 Scendance 窗口」（2026-11-05） |
| [42-地理优先主线改造清单-20261111.md](<42-地理优先主线改造清单-20261111.md>) | 13.3 | 2026-11-12 | 42 · 地理优先主线改造清单（2026-11-11） |
| [39-Aholo能力与用途评估-20261108.md](<39-Aholo能力与用途评估-20261108.md>) | 15.5 | 2026-11-10 | 39 · Aholo 能力评估与用途（2026-11-08） |
| [40-地标高度清单-20261109.md](<40-地标高度清单-20261109.md>) | 33.2 | 2026-11-10 | 40 · 西湖地标建筑高度清单（核对版） |
| [41-缺失地标补录方案-20261109.md](<41-缺失地标补录方案-20261109.md>) | 19.2 | 2026-11-10 | 41 · 缺失地标补录方案（2026-11-09） |
| [27-首单需求卡-HallD5演练.md](<27-首单需求卡-HallD5演练.md>) | 9.6 | 2026-11-09 | SC-02 · P0 定义首单输入 — 首单需求卡（Hall D5 演练） |
| [26-品牌规划.md](<26-品牌规划.md>) | 6.9 | 2026-11-08 | 品牌规划（2026-11-06） |
| [36-MP-DEL交付包规格.md](<36-MP-DEL交付包规格.md>) | 13.6 | 2026-11-08 | 36 · MP-DEL 交付包规格（v1 冻结） |
| [37-MP-PLAN风格brief规格.md](<37-MP-PLAN风格brief规格.md>) | 4.2 | 2026-11-08 | 37 · MP-PLAN 风格 brief（C1） |
| [23-智能采集升级提案.md](<23-智能采集升级提案.md>) | 9.1 | 2026-11-07 | 53 · 智能采集升级提案（图片 vs 视频 → 视频 + 实时引导） |
| [28-价格口径对照.md](<28-价格口径对照.md>) | 17.5 | 2026-11-07 | 28 · 价格口径对照（SC-34 · P2） |
| [33-西湖新素材分段清单.md](<33-西湖新素材分段清单.md>) | 8.4 | 2026-11-07 | 33 · 西湖新素材分段清单（XH-01） |
| [06-产品定位钉.md](<06-产品定位钉.md>) | 4.5 | 2026-11-05 | 幕景产品定位钉（2026-10-26） |
| [07-商业计划书.md](<07-商业计划书.md>) | 3.5 | 2026-11-05 | 幕景商业计划书（精简钉版 · 2026-10-26） |
| [09-平面图上传主路径.md](<09-平面图上传主路径.md>) | 1.3 | 2026-11-05 | 平面图上传主路径（产品钉 · 2026-10-31） |
| [12-AI使用额度.md](<12-AI使用额度.md>) | 0.8 | 2026-11-05 | AI 使用额度 |
| [13-HTTP-API与前端接入.md](<13-HTTP-API与前端接入.md>) | 16.2 | 2026-11-05 | HTTP API 与前端接入 |
| [14-后端设计.md](<14-后端设计.md>) | 9.8 | 2026-11-05 | 后端设计 |
| [15-按次付费与额度.md](<15-按次付费与额度.md>) | 16.1 | 2026-11-05 | 45 · 按次付费与额度（PAYATHON 2026 · Vibe Pay） |
| [16-小程序变现调研与接入路线.md](<16-小程序变现调研与接入路线.md>) | 4.8 | 2026-11-05 | 46 · 小程序变现调研与接入路线（2026-11-05） |
| [22-资产台账与3DGS可编辑方案.md](<22-资产台账与3DGS可编辑方案.md>) | 13.3 | 2026-11-05 | 资产台账与 3DGS 可编辑方案 |
| [24-Web端三个产品问题.md](<24-Web端三个产品问题.md>) | 9.2 | 2026-11-05 | 54 · Web 端三个产品问题（2026-11-05） |
| [03-测试与构建健康度.md](<03-测试与构建健康度.md>) | 11.6 | 2026-11-04 | 03 · 测试与构建健康度（只读盘点） |
| [04-Golden-Path-规格与实测.md](<04-Golden-Path-规格与实测.md>) | 34.6 | 2026-11-04 | Golden Path 规格与实测：从上传图纸到扫码开工（2026-11-04） |

## 三、`docs/plans/`（在建，按最后改动倒序）（121 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [2026-11-16-outdoor-evidence-matrix.md](<plans/2026-11-16-outdoor-evidence-matrix.md>) | 35.6 | 2026-11-21 | 三类证据对照表（M7.1） |
| [2026-11-18-79-walkthrough-checklist.md](<plans/2026-11-18-79-walkthrough-checklist.md>) | 20.9 | 2026-11-21 | 79 六条真机走查清单（2026-11-18） |
| [2026-11-19-chat-first-event-agent-progress.md](<plans/2026-11-19-chat-first-event-agent-progress.md>) | 22.3 | 2026-11-21 | 执行进度台账：聊天驱动完整活动设计 |
| [2026-11-19-contest-wedding-next-plan.md](<plans/2026-11-19-contest-wedding-next-plan.md>) | 88.1 | 2026-11-21 | 3D 赛事参赛方案 · 下一步规划（2026-11-19） |
| [2026-11-20-79-closure-runbook.md](<plans/2026-11-20-79-closure-runbook.md>) | 22.3 | 2026-11-21 | 79 门禁走查 · 逐条收尾方案（手把手版，2026-11-20） |
| [2026-11-20-79-closure-snapshot.md](<plans/2026-11-20-79-closure-snapshot.md>) | 35.5 | 2026-11-21 | 79 解局 · 2026-11-20 本轮进度快照（交接用，非发布结论） |
| [2026-11-20-79-jieyu-handoff-plan.md](<plans/2026-11-20-79-jieyu-handoff-plan.md>) | 21.9 | 2026-11-21 | 79 解隅（解局）接手计划 |
| [2026-11-20-editor-copy-cut-review.md](<plans/2026-11-20-editor-copy-cut-review.md>) | 32.5 | 2026-11-21 | 编辑器文案删改评审稿（2026-11-20） |
| [2026-11-20-权限体系建设方案.md](<plans/2026-11-20-权限体系建设方案.md>) | 16.5 | 2026-11-20 | 权限体系建设方案：成熟产品对照与分期落地（2026-11-20） |
| [2026-11-20-生成物可见性权限分层研究.md](<plans/2026-11-20-生成物可见性权限分层研究.md>) | 14.6 | 2026-11-20 | 生成物可见性与权限分层研究（2026-11-20） |
| [2026-11-20-cloud-storage-deployment-runbook.md](<plans/2026-11-20-cloud-storage-deployment-runbook.md>) | 13.3 | 2026-11-20 | 云存储能力上线 runbook |
| [2026-11-20-cloud-storage-integration-acceptance.md](<plans/2026-11-20-cloud-storage-integration-acceptance.md>) | 45.5 | 2026-11-20 | 云存储 A/B/C 三任务独立验收与集成检查报告 |
| [2026-11-20-cloud-storage-sharing-cases-execution.md](<plans/2026-11-20-cloud-storage-sharing-cases-execution.md>) | 26.3 | 2026-11-20 | 云端存储、保存、共享与国内案例：跨 AI 执行计划 |
| [2026-11-20-cloud-storage-task-a.md](<plans/2026-11-20-cloud-storage-task-a.md>) | 10.6 | 2026-11-20 | Task A — 后端权限与统一契约（2026-11-20） |
| [2026-11-20-cloud-storage-task-b.md](<plans/2026-11-20-cloud-storage-task-b.md>) | 12.7 | 2026-11-20 | B 上传归档与完整保存（实施记录） |
| [2026-11-20-cloud-storage-task-c.md](<plans/2026-11-20-cloud-storage-task-c.md>) | 8.2 | 2026-11-20 | 任务 C：案例库与共享实施记录 |
| [2026-11-20-cross-loop-inbox-plan.md](<plans/2026-11-20-cross-loop-inbox-plan.md>) | 10.7 | 2026-11-20 | 三线合流计划：执行资料 × Bingo 评审 × 消息收件箱（2026-11-20） |
| [2026-11-20-execution-data-agent-mapping.md](<plans/2026-11-20-execution-data-agent-mapping.md>) | 14.7 | 2026-11-20 | 执行资料 × Agent 落地对照表（2026-11-20） |
| [2026-11-20-people-registry-unification.md](<plans/2026-11-20-people-registry-unification.md>) | 21.9 | 2026-11-20 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [2026-11-20-publish-flow-closure-plan.md](<plans/2026-11-20-publish-flow-closure-plan.md>) | 20.8 | 2026-11-20 | 右上角发布：流程闭环与交互改进计划 |
| [2026-11-20-publish-flow-interface-contract.md](<plans/2026-11-20-publish-flow-interface-contract.md>) | 14.1 | 2026-11-20 | 右上角发布改造 · A/B/集成 共同接口约定 |
| [2026-11-20-publish-remaining-acceptance-plan.md](<plans/2026-11-20-publish-remaining-acceptance-plan.md>) | 16.7 | 2026-11-20 | 右上角发布：剩余验收与并行执行计划 |
| [2026-11-20-supabase-usage-budget-plan.md](<plans/2026-11-20-supabase-usage-budget-plan.md>) | 6.9 | 2026-11-20 | Supabase 用量止血与 50 用户容量计划 |
| [2026-11-20-venue-agent-baseline-and-acceptance.md](<plans/2026-11-20-venue-agent-baseline-and-acceptance.md>) | 38.8 | 2026-11-20 | 场地自主规划 · 本轮基线与验收记录 |
| [2026-11-20-venue-agent-interaction-design-plan.md](<plans/2026-11-20-venue-agent-interaction-design-plan.md>) | 12.9 | 2026-11-20 | 场地自主规划交互与设计提升计划 |
| [2026-11-20-venue-agent-interaction-handoff.md](<plans/2026-11-20-venue-agent-interaction-handoff.md>) | 16.3 | 2026-11-20 | 场地自主规划交互 P1 · 交接说明（2026-11-20） |
| [2026-11-08-单Agent工具矩阵.md](<plans/2026-11-08-单Agent工具矩阵.md>) | 6.1 | 2026-11-19 | 幕景单 Agent 与工具矩阵 |
| [2026-11-19-chat-first-event-agent-cutoff-report.md](<plans/2026-11-19-chat-first-event-agent-cutoff-report.md>) | 5.4 | 2026-11-19 | 15:00 截止报告（2026-11-19 15:00:08） |
| [2026-11-19-chat-first-event-agent-execution.md](<plans/2026-11-19-chat-first-event-agent-execution.md>) | 18.9 | 2026-11-19 | 聊天驱动完整活动设计：跨 AI 执行任务书 |
| [2026-11-19-chat-first-event-agent-t0-baseline.md](<plans/2026-11-19-chat-first-event-agent-t0-baseline.md>) | 10.4 | 2026-11-19 | T0 现状与范围（2026-11-19 14:18） |
| [2026-11-19-chat-first-event-agent-t1-plan.md](<plans/2026-11-19-chat-first-event-agent-t1-plan.md>) | 8.4 | 2026-11-19 | T1 施工方案（2026-11-19 14:40） |
| [2026-11-19-huajia-material-bom.md](<plans/2026-11-19-huajia-material-bom.md>) | 94.7 | 2026-11-19 | 花家山庄室外草坪 · 物料清单与 BOM |
| [2026-11-19-huajia-plan-handover.md](<plans/2026-11-19-huajia-plan-handover.md>) | 10.5 | 2026-11-19 | 花家山庄婚礼 · 户外布置起稿 —— 交接说明 |
| [2026-11-19-zero-photo-lane.md](<plans/2026-11-19-zero-photo-lane.md>) | 45.4 | 2026-11-19 | 零照片链路 · 产品化文案与口径（2026-11-19） |
| [2026-11-16-outdoor-agent-progress.md](<plans/2026-11-16-outdoor-agent-progress.md>) | 233.5 | 2026-11-18 | 户外 Agent 强化执行进度 |
| [2026-11-16-vehicle-entity-contract-118.md](<plans/2026-11-16-vehicle-entity-contract-118.md>) | 39.2 | 2026-11-18 | 车辆实体落盘契约（118） |
| [2026-11-17-b1-b4-execution-cards.md](<plans/2026-11-17-b1-b4-execution-cards.md>) | 11.2 | 2026-11-18 | B1–B4 执行卡（G2 壳体解耦） |
| [2026-11-17-c1-generation-run.md](<plans/2026-11-17-c1-generation-run.md>) | 50.0 | 2026-11-18 | C1 真实生成执行记录（2026-11-17） |
| [2026-11-17-decouple-execution-plan.md](<plans/2026-11-17-decouple-execution-plan.md>) | 16.4 | 2026-11-18 | 去室内化后续执行计划（成文锚点 main @ 8446b33f，2026-11-17） |
| [2026-11-17-event-producer-bot-gap-plan.md](<plans/2026-11-17-event-producer-bot-gap-plan.md>) | 22.7 | 2026-11-18 | 对照 Event Producer Bot 提示词的能力差距与提升计划（v3） |
| [2026-11-17-event-profile-p0-contract.md](<plans/2026-11-17-event-profile-p0-contract.md>) | 19.2 | 2026-11-18 | eventProfile P0 契约草案（v2 · 字段表 + 迁移面 + 只读聚合） |
| [2026-11-17-g1-closure-status.md](<plans/2026-11-17-g1-closure-status.md>) | 15.7 | 2026-11-18 | G1 纯函数地基收口状态 × 剩余前置清单（2026-11-17） |
| [2026-11-18-79-rootcause-and-gaps.md](<plans/2026-11-18-79-rootcause-and-gaps.md>) | 12.4 | 2026-11-18 | 79 根因与可执行缺口（2026-11-18） |
| [2026-11-18-c-decisions-card.md](<plans/2026-11-18-c-decisions-card.md>) | 9.3 | 2026-11-18 | §C 六项口径决策卡（2026-11-18） |
| [2026-11-18-settings-cases.md](<plans/2026-11-18-settings-cases.md>) | 8.0 | 2026-11-18 | 设置分层与快捷键参考：成熟案例补充 |
| [2026-11-18-settings-layers.md](<plans/2026-11-18-settings-layers.md>) | 40.5 | 2026-11-18 | Scendance 设置改版方案（评审稿） |
| [2026-11-18-shortcut-learning.md](<plans/2026-11-18-shortcut-learning.md>) | 9.2 | 2026-11-18 | 快捷键学习系统：三层交付与成熟案例 |
| [2026-11-19-outdoor-acceptance-rollup.md](<plans/2026-11-19-outdoor-acceptance-rollup.md>) | 6.7 | 2026-11-18 | 户外 Agent 批次验收结论（M0–M7 汇总，轮次 104） |
| [2026-11-19-outdoor-m7-pr-draft.md](<plans/2026-11-19-outdoor-m7-pr-draft.md>) | 4.9 | 2026-11-18 | PR 草稿 · 户外走查与发布事实链（M7 第一批） |
| [2026-11-17-indoor-deadcode-audit-3e376b41.md](<plans/2026-11-17-indoor-deadcode-audit-3e376b41.md>) | 10.3 | 2026-11-17 | 室内残留死代码审计与最小删除（origin/main @ 3e376b41） |
| [2026-11-17-m2-facility-finish-slices.md](<plans/2026-11-17-m2-facility-finish-slices.md>) | 8.7 | 2026-11-17 | M2 facility 映射收尾 · 可执行切片清单（基线 13258414） |
| [2026-11-17-m3-foundations-slices.md](<plans/2026-11-17-m3-foundations-slices.md>) | 5.0 | 2026-11-17 | M3b/M3c 地基切片记录（基线与验收） |
| [2026-11-17-outdoor-inspector-fit.md](<plans/2026-11-17-outdoor-inspector-fit.md>) | 3.6 | 2026-11-17 | 户外属性卡版式：「文字生成」点不动（2026-11-17） |
| [2026-11-17-roam-behavior-layer.md](<plans/2026-11-17-roam-behavior-layer.md>) | 25.6 | 2026-11-17 | 漫游人物行为层（流线 → 分区 → 落座）设计方案 |
| [2026-11-16-outdoor-agent-upgrade.md](<plans/2026-11-16-outdoor-agent-upgrade.md>) | 28.8 | 2026-11-16 | 户外 Agent 强化执行计划 |
| [2026-11-16-outdoor-release-rollback.md](<plans/2026-11-16-outdoor-release-rollback.md>) | 6.6 | 2026-11-16 | 户外 Agent 回退手册与发布阻断条件（M7.3） |
| [2026-11-16-people-asset-pipeline.md](<plans/2026-11-16-people-asset-pipeline.md>) | 14.1 | 2026-11-16 | 人物 / 载具 GLB 资产管线（2026-11-16） |
| [2026-11-11-people05-crowd-uniform-batch.md](<plans/2026-11-11-people05-crowd-uniform-batch.md>) | 2.4 | 2026-11-12 | PEOPLE-05 活动岗位制服批次 |
| [2026-11-11-演示回放系统.md](<plans/2026-11-11-演示回放系统.md>) | 4.4 | 2026-11-11 | 演示回放系统（tour-reel）· 幕景前端升级规格 |
| [2026-11-08-isometric-sf-拆解与复刻差异诊断.md](<plans/2026-11-08-isometric-sf-拆解与复刻差异诊断.md>) | 25.9 | 2026-11-10 | Isometric SF 拆解 × hangzhou-map-lab 复刻差异诊断 |
| [2026-11-10-outdoor-event-planning.md](<plans/2026-11-10-outdoor-event-planning.md>) | 53.2 | 2026-11-10 | Scendance 真实场地活动规划升级 |
| [2026-11-08-智能建造验证记录.md](<plans/2026-11-08-智能建造验证记录.md>) | 34.6 | 2026-11-09 | 智能建造验证记录（2026-11-08） |
| [2026-11-09-标注候选应用边界.md](<plans/2026-11-09-标注候选应用边界.md>) | 5.3 | 2026-11-09 | 标注候选应用边界（本地实验） |
| [2026-11-09-正式站闭环验收清单.md](<plans/2026-11-09-正式站闭环验收清单.md>) | 7.4 | 2026-11-09 | 正式站闭环验收清单 |
| [2026-11-09-production-conversation.md](<plans/2026-11-09-production-conversation.md>) | 3.6 | 2026-11-09 | 正式站独立对话接口接入 |
| [2026-11-07-幕景四个入口与智能建造架构.md](<plans/2026-11-07-幕景四个入口与智能建造架构.md>) | 7.6 | 2026-11-08 | 幕景四个入口与智能建造架构 |
| [2026-11-07-幕景智能建造闭环图.md](<plans/2026-11-07-幕景智能建造闭环图.md>) | 7.9 | 2026-11-08 | 幕景智能建造：从想法到可审阅方案 |
| [2026-11-07-智能Chat验收清单.md](<plans/2026-11-07-智能Chat验收清单.md>) | 10.0 | 2026-11-08 | 智能 Chat 连续对话与建造验收 |
| [2026-11-07-智能Chat主计划.md](<plans/2026-11-07-智能Chat主计划.md>) | 11.2 | 2026-11-08 | 幕景智能 Chat 与活动智能建造主计划 |
| [2026-11-07-Agent能力与工具盘点.md](<plans/2026-11-07-Agent能力与工具盘点.md>) | 9.0 | 2026-11-08 | 幕景 Agent 能力、工具与验证盘点 |
| [2026-11-08-幕景总体架构与产品演进路线.md](<plans/2026-11-08-幕景总体架构与产品演进路线.md>) | 7.4 | 2026-11-08 | 幕景总体技术架构与产品演进路线 |
| [2026-11-06-智能建造计划-评审版.md](<plans/2026-11-06-智能建造计划-评审版.md>) | 8.3 | 2026-11-06 | Scendance2026 智能建造计划（评审版）｜2026-11-06 |
| [2026-11-06-智能建造究极计划-v2.md](<plans/2026-11-06-智能建造究极计划-v2.md>) | 10.0 | 2026-11-06 | 智能建造究极计划 v2：可托付的智能建造（2026-11-06） |
| [v340-alignment-audit.md](<plans/ia-next-prep-2026-11-04/v340-alignment-audit.md>) | 1.8 | 2026-11-05 | v3.4.0 与 IA 四角色重划对齐审计 |
| [index.md](<plans/ia-next-prep-2026-11-04/index.md>) | 9.5 | 2026-11-04 | S2/S3/S4 第二轮并行施工前审 · 总索引（hub） |
| [s2-playbook-and-decisions.md](<plans/ia-next-prep-2026-11-04/s2-playbook-and-decisions.md>) | 24.0 | 2026-11-04 | S2「Bingo 转审校台」可执行任务书 + 待拍板决策简报（分片 B 第二刀） |
| [s3-entry-audit.md](<plans/ia-next-prep-2026-11-04/s3-entry-audit.md>) | 36.0 | 2026-11-04 | S3「空间/物料面板化」入口审计 + 施工卡（分片 A，只读前置） |
| [s4-execution-pack.md](<plans/ia-next-prep-2026-11-04/s4-execution-pack.md>) | 37.5 | 2026-11-04 | S4 清理与回归 — 执行包（分片 C · 第二轮只读前置审计） |
| [index.md](<plans/ia-s1-prep-2026-11-04/index.md>) | 14.1 | 2026-11-04 | IA 重划 S1 前置只读审计 · 总索引（hub） |
| [s11-gallery-card.md](<plans/ia-s1-prep-2026-11-04/s11-gallery-card.md>) | 27.2 | 2026-11-04 | S1.1「活动开场画廊」审计 + 施工卡（分片 A） |
| [s2-review-audit.md](<plans/ia-s1-prep-2026-11-04/s2-review-audit.md>) | 32.0 | 2026-11-04 | S2「Bingo 转审校台」静态链路审计（分片 B） |
| [s4-cleanup-inventory.md](<plans/ia-s1-prep-2026-11-04/s4-cleanup-inventory.md>) | 25.3 | 2026-11-04 | S4 清理与全量回归 — 盘点清单（分片 C · 只读前置审计） |
| [2026-11-04-ia-role-rework-ledger.md](<plans/2026-11-04-ia-role-rework-ledger.md>) | 31.9 | 未入库 | 四角色 IA 重划导演台账 — 活动 / 审校 Bingo / 空间 / 物料 |
| [2026-11-05-activity-case-studies.md](<plans/2026-11-05-activity-case-studies.md>) | 15.6 | 未入库 | 活动场景案例研究：可迁移的空间手法 |
| [2026-11-05-activity-space-norms.md](<plans/2026-11-05-activity-space-norms.md>) | 34.3 | 未入库 | 活动场景量化空间规范表 |
| [2026-11-05-agent-migration-map.md](<plans/2026-11-05-agent-migration-map.md>) | 30.1 | 未入库 | AI 智能建造 / 场地规划智能体 —— 代码落点与迁移地图 |
| [2026-11-05-ai-spatial-agents-deep-dive.md](<plans/2026-11-05-ai-spatial-agents-deep-dive.md>) | 6.9 | 未入库 | AI 空间/布局生成智能体深度调研（2026-11-05） |
| [2026-11-05-ai-spatial-agents-survey.md](<plans/2026-11-05-ai-spatial-agents-survey.md>) | 10.0 | 未入库 | AI 生成/编辑空间布局 · 项目调研（2026-11-05） |
| [2026-11-05-batch10-agent-steering-delivery.md](<plans/2026-11-05-batch10-agent-steering-delivery.md>) | 3.1 | 未入库 | 第 10 批交付：运行中改道（steering）全链路 |
| [2026-11-05-batch11-agent-phase-progress-delivery.md](<plans/2026-11-05-batch11-agent-phase-progress-delivery.md>) | 2.2 | 未入库 | 第 11 批交付：阶段化进度 |
| [2026-11-05-batch12-validate-receipt-delivery.md](<plans/2026-11-05-batch12-validate-receipt-delivery.md>) | 4.1 | 未入库 | 第 12 批交付：校验回执从「通过/不通过」升级为「差多少、哪一条」 |
| [2026-11-05-batch13-agent-phase-persist-delivery.md](<plans/2026-11-05-batch13-agent-phase-persist-delivery.md>) | 3.6 | 未入库 | 第 13 批交付：阶段落库 + 运行条主标题换成阶段 |
| [2026-11-05-batch7-outcome-audit-delivery.md](<plans/2026-11-05-batch7-outcome-audit-delivery.md>) | 13.5 | 未入库 | 第 7 批收尾交付：让「本次结果」真的出现在审校台上 |
| [2026-11-05-batch8-agent-run-timeline-delivery.md](<plans/2026-11-05-batch8-agent-run-timeline-delivery.md>) | 11.2 | 未入库 | 第 8 批前端接线交付：活动脸显示真实运行过程（第 8 批 · 第一段） |
| [2026-11-05-intergenerational-and-constrained.md](<plans/2026-11-05-intergenerational-and-constrained.md>) | 8.4 | 未入库 | 代际共融与受限场地降级：配方库判据增量 |
| [2026-11-05-m1-m5-gap-roadmap.md](<plans/2026-11-05-m1-m5-gap-roadmap.md>) | 7.1 | 未入库 | M1–M5 移植差距清单：幕景「智能建造」骨架对标 PetitMaker（谷地工坊） |
| [2026-11-05-petitmaker-agent-teardown.md](<plans/2026-11-05-petitmaker-agent-teardown.md>) | 18.5 | 未入库 | 谷地工坊智能体逆向：协议、提示词与可迁移设计 |
| [2026-11-05-petitmaker-playtest.md](<plans/2026-11-05-petitmaker-playtest.md>) | 13.8 | 未入库 | PetitMaker 真机实操记录（2026-11-05） |
| [2026-11-05-playtest-matrix.md](<plans/2026-11-05-playtest-matrix.md>) | 17.7 | 未入库 | 谷地工坊多场景实操：4 组实验与迁移清单 |
| [2026-11-05-smart-build-next-phase.md](<plans/2026-11-05-smart-build-next-phase.md>) | 35.1 | 未入库 | 智能建造下一程升级计划：M1–M5 活接深度与 Agent 机制补课 |
| [2026-11-08-brief-request-guard-draft.md](<plans/2026-11-08-brief-request-guard-draft.md>) | 2.1 | 未入库 | 单轮简报请求防重与限频草案 |
| [2026-11-08-circle-draw-save-fix.md](<plans/2026-11-08-circle-draw-save-fix.md>) | 7.1 | 未入库 | 圈画保存断点 · 根因与修复记录（P0-1） |
| [2026-11-08-minimax-brief-first-sample-runbook.md](<plans/2026-11-08-minimax-brief-first-sample-runbook.md>) | 4.0 | 未入库 | MiniMax 单条简报首次实测：待核对方案 |
| [2026-11-08-minimax-budget-transaction-design.md](<plans/2026-11-08-minimax-budget-transaction-design.md>) | 6.9 | 未入库 | MiniMax 整趟预留：未部署设计与放行条件 |
| [2026-11-10-hangzhou-city-art-execution.md](<plans/2026-11-10-hangzhou-city-art-execution.md>) | 5.9 | 未入库 | 杭州真实结构与等距城市画风执行计划 |
| [2026-11-10-hangzhou-iso-hubin-capture.md](<plans/2026-11-10-hangzhou-iso-hubin-capture.md>) | 3.5 | 未入库 | 湖滨三公园至东坡路 · 等距样片采集 |
| [2026-11-10-hangzhou-isometric-map-research.md](<plans/2026-11-10-hangzhou-isometric-map-research.md>) | 8.0 | 未入库 | 杭州等距像素地图可行性调研 |
| [2026-11-10-outdoor-2d-one-flow.md](<plans/2026-11-10-outdoor-2d-one-flow.md>) | 9.9 | 未入库 | 一条链：2D 规划 ↔ 3D 场景 ↔ 交付（P4 计划） |
| [2026-11-12-sidebar-entry-unification.md](<plans/2026-11-12-sidebar-entry-unification.md>) | 27.4 | 未入库 | 侧边栏入口统一设计方案（讨论稿 · 2026-11-12，11-13 复核校正） |
| [2026-11-13-commercial-agreements.md](<plans/2026-11-13-commercial-agreements.md>) | 7.9 | 未入库 | 幕景的报价、合同与履约流程 |
| [2026-11-13-delivery-frontend.md](<plans/2026-11-13-delivery-frontend.md>) | 151.9 | 未入库 | 场景物料到执行交接：前端实施方案 |
| [2026-11-13-discussion-and-sketch-review.md](<plans/2026-11-13-discussion-and-sketch-review.md>) | 12.8 | 未入库 | 幕景工作区优化分析 |
| [2026-11-13-executor-readback-review.md](<plans/2026-11-13-executor-readback-review.md>) | 9.2 | 未入库 | 已下载交接材料：执行方回读验收 |
| [2026-11-13-outdoor-first-person-walk.md](<plans/2026-11-13-outdoor-first-person-walk.md>) | 10.7 | 未入库 | 户外规划 3D · 第一人称漫游一期（裸步行）设计与验收记录（2026-11-13） |
| [2026-11-13-outdoor-map-decommission.md](<plans/2026-11-13-outdoor-map-decommission.md>) | 56.0 | 未入库 | 室内壳体退役 × 地图能力迁建：详细规划（2026-11-13） |
| [2026-11-13-outdoor-map-unification.md](<plans/2026-11-13-outdoor-map-unification.md>) | 56.0 | 未入库 | 户外地图收敛：唯一一套可 2D↔3D 直切的地图（2026-11-13） |
| [2026-11-13-reliability-loop.md](<plans/2026-11-13-reliability-loop.md>) | 48.2 | 未入库 | 幕景持续改进目标与检查记录 |
| [2026-11-13-tool-rail-unification.md](<plans/2026-11-13-tool-rail-unification.md>) | 23.5 | 未入库 | 左右工具轨 × 地图控件统一重设计方案（2026-11-13） |
| [2026-11-14-indoor-decouple-targets.md](<plans/2026-11-14-indoor-decouple-targets.md>) | 25.0 | 未入库 | 室内去耦合 · 目标落点登记（main 基底，2026-11-14） |
| [2026-11-14-outdoor-walk-avatar-third-person.md](<plans/2026-11-14-outdoor-walk-avatar-third-person.md>) | 14.3 | 未入库 | 户外人物漫游 · 三期落点设计（avatar / 视角 / 坐姿）（2026-11-14） |
| [2026-11-14-outdoor-walk-roadmap.md](<plans/2026-11-14-outdoor-walk-roadmap.md>) | 32.8 | 未入库 | 户外人物漫游 · 远景路线图（素材 / 对应 / 动线 / 视角交互 / 权限对话）（2026-11-14） |

## 四、`docs/archive/`（历史，原文不改写）（115 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [2026-10-14-开放日样例.md](<archive/example/2026-10-14-开放日样例.md>) | 8.4 | 2026-11-05 | 假设演练｜30人社群共创开放日 |
| [2026-10-02-本地运行与维护.md](<archive/legacy/2026-10-02-本地运行与维护.md>) | 11.7 | 2026-11-05 | 本地运行、云端维护与恢复 |
| [2026-10-07-Cloudflare部署.md](<archive/legacy/2026-10-07-Cloudflare部署.md>) | 8.1 | 2026-11-16 | Cloudflare Pages 与 GitHub 自动部署 |
| [2026-10-29-AI接力手册.md](<archive/legacy/2026-10-29-AI接力手册.md>) | 26.7 | 2026-11-10 | 幕景 Scendance AI 接力手册 v2.0 — 2026-10-29 |
| [2026-11-02-版本更新文案.md](<archive/legacy/2026-11-02-版本更新文案.md>) | 7.5 | 2026-11-05 | 版本更新文案规范 |
| [2026-11-04-晴光IP还原锚.md](<archive/legacy/2026-11-04-晴光IP还原锚.md>) | 4.7 | 2026-11-05 | 晴光 Qingguang — IP 角色还原锚（Phase 0） |
| [2026-11-04-提供商配置.md](<archive/legacy/2026-11-04-提供商配置.md>) | 3.4 | 2026-11-05 | 提供商配置入口 |
| [2026-11-04-邮件验证码找回.md](<archive/legacy/2026-11-04-邮件验证码找回.md>) | 4.4 | 2026-11-05 | 邮件注册与六位验证码找回密码 |
| [2026-11-04-自建Supabase教程.md](<archive/legacy/2026-11-04-自建Supabase教程.md>) | 12.6 | 2026-11-05 | 用自己的 Supabase 项目当后端（tutorial） |
| [2026-11-04-DeepSeek发布操作.md](<archive/legacy/2026-11-04-DeepSeek发布操作.md>) | 4.6 | 2026-11-05 | DeepSeek 发布操作 |
| [18-T-Aholo重建链路修复与复验.md](<archive/plan/18-T-Aholo重建链路修复与复验.md>) | 3.5 | 2026-11-13 | 48 · T-Aholo重建链路修复与复验（给 Trae） |
| [20-场地资产地理底图提案.md](<archive/plan/20-场地资产地理底图提案.md>) | 10.1 | 2026-11-13 | 50 · 场地资产地理底图提案（待拍板） |
| [2026-10-07-分阶段产品计划.md](<archive/plan/2026-10-07-分阶段产品计划.md>) | 6.2 | 2026-11-05 | 幕景分阶段产品计划 |
| [2026-10-07-工作区模式.md](<archive/plan/2026-10-07-工作区模式.md>) | 13.8 | 2026-11-05 | Binggo 工作区：目标、模式与执行路径 |
| [2026-10-07-活动执行契约.md](<archive/plan/2026-10-07-活动执行契约.md>) | 15.7 | 2026-11-05 | 活动执行安排：最小契约建议 |
| [2026-10-07-交付恢复核查.md](<archive/plan/2026-10-07-交付恢复核查.md>) | 3.6 | 2026-11-05 | 本地执行与恢复链路核查 |
| [2026-10-07-最小交付契约.md](<archive/plan/2026-10-07-最小交付契约.md>) | 30.7 | 2026-11-05 | 幕景最小交付契约 |
| [2026-10-07-Agent开源参考.md](<archive/plan/2026-10-07-Agent开源参考.md>) | 19.4 | 2026-11-05 | Agent 开源参考与幕景接入记录 |
| [2026-10-08-场景对话同屏.md](<archive/plan/2026-10-08-场景对话同屏.md>) | 4.6 | 2026-11-05 | 场景与对话同屏的工作台 |
| [2026-10-08-场景活动备份.md](<archive/plan/2026-10-08-场景活动备份.md>) | 41.3 | 2026-11-05 | 场景与活动备份 |
| [2026-10-08-对话状态检查.md](<archive/plan/2026-10-08-对话状态检查.md>) | 3.8 | 2026-11-05 | 助手开关与对话状态检查 |
| [2026-10-08-制作计划契约.md](<archive/plan/2026-10-08-制作计划契约.md>) | 10.4 | 2026-11-05 | 制作计划 v1：独立本地契约 |
| [2026-10-09-本地场景服务.md](<archive/plan/2026-10-09-本地场景服务.md>) | 7.2 | 2026-11-05 | 本地活动与场景服务连接 |
| [2026-10-09-成果流程借鉴.md](<archive/plan/2026-10-09-成果流程借鉴.md>) | 4.9 | 2026-11-05 | 从 Trooly 手册借鉴幕景的项目成果流程 |
| [2026-10-09-客户方案评审.md](<archive/plan/2026-10-09-客户方案评审.md>) | 24.4 | 2026-11-05 | 客户方案评审包 · 第一增量 B |
| [2026-10-09-物料点验契约.md](<archive/plan/2026-10-09-物料点验契约.md>) | 6.3 | 2026-11-05 | 数量点验契约 v1 |
| [2026-10-09-制作计划导出.md](<archive/plan/2026-10-09-制作计划导出.md>) | 10.0 | 2026-11-05 | 制作计划内部交接HTML |
| [2026-10-09-专业能力依据.md](<archive/plan/2026-10-09-专业能力依据.md>) | 5.5 | 2026-11-05 | 专业能力依据与采用范围 |
| [2026-10-10-活动任务接模型.md](<archive/plan/2026-10-10-活动任务接模型.md>) | 18.9 | 2026-11-05 | 活动任务建议接真实模型：现码调查与待审接线契约 |
| [2026-10-10-AIHOT源码采用.md](<archive/plan/2026-10-10-AIHOT源码采用.md>) | 14.9 | 2026-11-05 | AIHOT 源码学习与幕景采用范围 |
| [2026-10-10-PetitMaker-Agent.md](<archive/plan/2026-10-10-PetitMaker-Agent.md>) | 24.4 | 2026-11-05 | PetitMaker Agent 源码学习与幕景后端采用 |
| [2026-10-10-PetitMaker差距.md](<archive/plan/2026-10-10-PetitMaker差距.md>) | 13.5 | 2026-11-05 | PetitMaker 恢复链后续差距检查 |
| [2026-10-10-PetitMaker成果.md](<archive/plan/2026-10-10-PetitMaker成果.md>) | 25.9 | 2026-11-05 | PetitMaker 成果与数据流对照 |
| [2026-10-10-PetitMaker路线.md](<archive/plan/2026-10-10-PetitMaker路线.md>) | 5.6 | 2026-11-05 | PetitMaker 全面学习与幕景改造 |
| [2026-10-10-PetitMaker源码.md](<archive/plan/2026-10-10-PetitMaker源码.md>) | 13.6 | 2026-11-05 | PetitMaker 源码机制研究 |
| [2026-10-10-TapTap参考.md](<archive/plan/2026-10-10-TapTap参考.md>) | 4.1 | 2026-11-05 | TapTap 制造：引擎与创作工作台参考 |
| [2026-10-16-AI原生升级.md](<archive/plan/2026-10-16-AI原生升级.md>) | 20.4 | 2026-11-05 | 幕景 Scendance · AI-Native 升级蓝图 v1 |
| [2026-10-27-活动流程AI原生.md](<archive/plan/2026-10-27-活动流程AI原生.md>) | 11.0 | 2026-11-05 | 幕景 · 活动组织流程 AI-Native 框架（2026-10-27） |
| [2026-10-27-Agent框架选型.md](<archive/plan/2026-10-27-Agent框架选型.md>) | 4.6 | 2026-11-05 | Agent 框架选型与集成记录（2026-10-27） |
| [2026-10-28-Aholo集成规划.md](<archive/plan/2026-10-28-Aholo集成规划.md>) | 11.9 | 2026-11-05 | Aholo 集成宏观规划(v1,2026-10-28) |
| [2026-10-29-09-Taste与IA备忘录(SCOPED).md](<archive/plan/2026-10-29-09-Taste与IA备忘录(SCOPED).md>) | 18.9 | 2026-11-05 | Scendance（幕景）Taste & IA Memo — 2026-10-29 |
| [2026-11-02-空间物料Chat设计.md](<archive/plan/2026-11-02-空间物料Chat设计.md>) | 12.2 | 2026-11-05 | 空间 / 物料 两个 chat 的设计 |
| [2026-11-04-新手指引重写.md](<archive/plan/2026-11-04-新手指引重写.md>) | 12.1 | 2026-11-05 | 新手指引重写规格（2026-11-04） |
| [2026-11-04-Agent空间能力.md](<archive/plan/2026-11-04-Agent空间能力.md>) | 25.1 | 2026-11-05 | 03 · Golden Path 第④步设计：Agent 空间操作与「预览—确认—执行」 |
| [2026-11-04-GoldenPath规格.md](<archive/plan/2026-11-04-GoldenPath规格.md>) | 10.3 | 2026-11-05 | 07 · Golden Path 规格与验收（2026-11-04） |
| [2026-11-16-handoff-v5-generation.md](<archive/plan/2026-11-16-handoff-v5-generation.md>) | 9.2 | 2026-11-21 | 幕景 V5 生成安全切片交接（2026-11-16） |
| [2026-11-18-79-handoff-next-agent.md](<archive/plan/2026-11-18-79-handoff-next-agent.md>) | 9.0 | 2026-11-21 | 79 剩余工作交接单（2026-11-18 晚 · 交给下一个 agent） |
| [2026-11-18-lux3d-generation-closure.md](<archive/plan/2026-11-18-lux3d-generation-closure.md>) | 9.7 | 2026-11-21 | Lux3D 生成闭环复核与最小补齐（2026-11-18） |
| [2026-11-19-agent-t2-t3-handoff.md](<archive/plan/2026-11-19-agent-t2-t3-handoff.md>) | 3.9 | 2026-11-21 | T2 / T3 接手记录 |
| [HANDOFF-CONVERSATION-DEPLOY.md](<archive/plan/HANDOFF-CONVERSATION-DEPLOY.md>) | 2.7 | 2026-11-21 | 对话接入收尾交接（2026-11-09，代码已进 PR 86） |
| [original-scene-edit-design.md](<archive/plan/original-scene-edit-design.md>) | 1.9 | 2026-11-13 | 含未核验原文的云场景：授权编辑设计 |
| [reconstruction-edit-review-design.md](<archive/plan/reconstruction-edit-review-design.md>) | 3.9 | 2026-11-13 | 重建候选人工修改：受控版本设计草案 |
| [08-Aholo资产与3DGS预览.md](<archive/report/08-Aholo资产与3DGS预览.md>) | 8.9 | 2026-11-13 | 任务一 · 任务二：GLB 本机资产与 3DGS 环境预览（2026-10-30） |
| [10-AI场景助理接入.md](<archive/report/10-AI场景助理接入.md>) | 3.6 | 2026-11-13 | AI 场景助理接入 |
| [17-Aholo重建真调排查.md](<archive/report/17-Aholo重建真调排查.md>) | 8.9 | 2026-11-13 | 47 · Aholo World 重建真调排查（2026-11-05） |
| [2026-10-02-登录接入.md](<archive/report/2026-10-02-登录接入.md>) | 3.3 | 2026-11-05 | Scendance 登录接入 |
| [2026-10-02-项目交接归档.md](<archive/report/2026-10-02-项目交接归档.md>) | 2.9 | 2026-11-05 | 完整项目交接 · 2026-10-02 |
| [2026-10-09-本轮验证记录.md](<archive/report/2026-10-09-本轮验证记录.md>) | 8.0 | 2026-11-05 | 本轮验证记录 |
| [2026-10-09-编辑器首次上线.md](<archive/report/2026-10-09-编辑器首次上线.md>) | 2.4 | 2026-11-05 | 现有编辑器首次上线 |
| [2026-10-09-场景模板发布.md](<archive/report/2026-10-09-场景模板发布.md>) | 5.1 | 2026-11-05 | Complete scene templates release |
| [2026-10-09-独立后端部署.md](<archive/report/2026-10-09-独立后端部署.md>) | 8.4 | 2026-11-05 | 独立后端部署记录 |
| [2026-10-09-访客入口发布.md](<archive/report/2026-10-09-访客入口发布.md>) | 3.4 | 2026-11-05 | 登录页访客入口发布 |
| [2026-10-09-混元3D启用.md](<archive/report/2026-10-09-混元3D启用.md>) | 6.0 | 2026-11-05 | Scendance 混元 3D 接入与启用 |
| [2026-10-09-开放工作台发布.md](<archive/report/2026-10-09-开放工作台发布.md>) | 5.7 | 2026-11-05 | 默认开放工作台 |
| [2026-10-09-图纸重建发布.md](<archive/report/2026-10-09-图纸重建发布.md>) | 6.5 | 2026-11-05 | 图纸重建与云工作台统一发布记录 |
| [2026-10-09-图纸重建验收.md](<archive/report/2026-10-09-图纸重建验收.md>) | 9.2 | 2026-11-05 | 图纸与照片重建验收记录 |
| [2026-10-09-账户面板发布.md](<archive/report/2026-10-09-账户面板发布.md>) | 3.7 | 2026-11-05 | 账户面板生产发布记录 |
| [2026-10-09-中文模型库整合.md](<archive/report/2026-10-09-中文模型库整合.md>) | 7.8 | 2026-11-05 | 中文模型库整合验收 |
| [2026-10-09-AI助理配置.md](<archive/report/2026-10-09-AI助理配置.md>) | 2.8 | 2026-11-05 | AI 助理配置与前端交接 |
| [2026-10-09-Binggo资产升级.md](<archive/report/2026-10-09-Binggo资产升级.md>) | 5.2 | 2026-11-05 | Binggo 模型与材质升级 |
| [2026-10-09-Cloudflare建站.md](<archive/report/2026-10-09-Cloudflare建站.md>) | 3.6 | 2026-11-05 | Scendance 独立 Cloudflare 项目与域名 |
| [2026-10-09-debug1003修复.md](<archive/report/2026-10-09-debug1003修复.md>) | 10.0 | 2026-11-05 | debug1003 修复与验收 |
| [2026-10-09-DeepSeek回退.md](<archive/report/2026-10-09-DeepSeek回退.md>) | 5.5 | 2026-11-05 | DeepSeek Agent 改造前快照与回退 |
| [2026-10-09-DeepSeek上线.md](<archive/report/2026-10-09-DeepSeek上线.md>) | 5.1 | 2026-11-05 | DeepSeek Agent 上线与回退记录 |
| [2026-10-09-Plan后端审计.md](<archive/report/2026-10-09-Plan后端审计.md>) | 15.8 | 2026-11-05 | PLAN v0.2 后端实现与配置对照 |
| [2026-10-09-Plan接口发布.md](<archive/report/2026-10-09-Plan接口发布.md>) | 7.4 | 2026-11-05 | PLAN 接口复核与正式发布 |
| [2026-10-09-v041兼容验收.md](<archive/report/2026-10-09-v041兼容验收.md>) | 9.9 | 2026-11-05 | v0.4.1 兼容修改与验收记录 |
| [2026-10-28-T-Aholo物料入口.md](<archive/report/2026-10-28-T-Aholo物料入口.md>) | 4.1 | 2026-11-05 | T-AHOLO-ENTRY · 接回「物料建模 / Lux3D」入口 + 修招呼语字面 \n |
| [2026-10-30-D0地图圈画验收.md](<archive/report/2026-10-30-D0地图圈画验收.md>) | 3.5 | 2026-11-05 | D0 演示链路验收 · 地图圈画 + 历史 splat + GLB · 2026-10-30 |
| [2026-10-30-D1采集上传验收.md](<archive/report/2026-10-30-D1采集上传验收.md>) | 4.0 | 2026-11-05 | D1 验收 · 采集单 → 上传/重建（Aholo）· 2026-10-30 |
| [2026-10-30-D1流线站位验收.md](<archive/report/2026-10-30-D1流线站位验收.md>) | 2.1 | 2026-11-05 | D1 流线验收 · 圈内主客流线加密站位 · 2026-10-30 |
| [2026-10-30-D2场地观感验收.md](<archive/report/2026-10-30-D2场地观感验收.md>) | 1.7 | 2026-11-05 | D2 验收 · Aholo 场地观感产品化 · 2026-10-30 |
| [2026-10-30-D2真重建验收.md](<archive/report/2026-10-30-D2真重建验收.md>) | 2.4 | 2026-11-05 | D2 验收 · 真重建进画布 · 2026-10-30 |
| [2026-10-30-D3轮廓壳体验收.md](<archive/report/2026-10-30-D3轮廓壳体验收.md>) | 2.7 | 2026-11-05 | D3 验收 · 多边形真轮廓壳体 / 卫星贴地底图 · 2026-10-30 |
| [2026-10-31-T-3D验收细节.md](<archive/report/2026-10-31-T-3D验收细节.md>) | 4.5 | 2026-11-05 | T-3D- 验收细节（给 Trae / Qoder / DSH） |
| [2026-11-01-十八席会诊.md](<archive/report/2026-11-01-十八席会诊.md>) | 15.9 | 2026-11-05 | 幕景 Scendance · 十八席会诊评估 |
| [2026-11-03-三态文案审计.md](<archive/report/2026-11-03-三态文案审计.md>) | 25.1 | 2026-11-05 | 三态文案审计：空 / 加载 / 错误（frontend/） |
| [2026-11-04-测试构建健康度.md](<archive/report/2026-11-04-测试构建健康度.md>) | 10.7 | 2026-11-05 | 测试与构建健康度（只读盘点） |
| [2026-11-04-交付能力审计.md](<archive/report/2026-11-04-交付能力审计.md>) | 27.7 | 2026-11-05 | 05 · P2-5「升级最终方案交付」能力审计与设计 |
| [2026-11-04-项目清理记录.md](<archive/report/2026-11-04-项目清理记录.md>) | 16.4 | 2026-11-05 | 项目级清理记录 · 2026-11-04 |
| [2026-11-04-GoldenPath体检.md](<archive/report/2026-11-04-GoldenPath体检.md>) | 12.2 | 2026-11-05 | 08 · Golden Path 现状体检（2026-11-04） |
| [2026-11-05-地图圈画偏移.md](<archive/report/2026-11-05-地图圈画偏移.md>) | 2.7 | 2026-11-05 | T-MAP-ALIGN-OFFSET · 圈画区域与 3D 渲染偏移 |
| [30-SC04-场地输入核对.md](<archive/report/30-SC04-场地输入核对.md>) | 20.8 | 2026-11-13 | SC-04 · P0 核对场地输入 — 交付记录 |
| [31-SC05-保存恢复核对.md](<archive/report/31-SC05-保存恢复核对.md>) | 22.1 | 2026-11-13 | SC-05 · P0 复验保存和恢复 — 代码核对记录 |
| [34-依赖漏洞分类清点.md](<archive/report/34-依赖漏洞分类清点.md>) | 21.9 | 2026-11-13 | 34 · 依赖漏洞分类清点（Dependabot 42 条 open 告警） |
| [35-XH02-单段重建回执.md](<archive/report/35-XH02-单段重建回执.md>) | 3.9 | 2026-11-13 | XH-02 单段重建回执（2026-11-07，0233 拒收 + 0234 双档秒败） |
| [AGENT-ENTRY.md](<archive/report/AGENT-ENTRY.md>) | 4.1 | 2026-11-21 | 统一 Agent 入口 |
| [VERIFICATION-v0.3.0.md](<archive/report/VERIFICATION-v0.3.0.md>) | 2.8 | 2026-11-21 | v0.3.0 验收记录 |
| [2026-10-25-3DGS调研.md](<archive/research/2026-10-25-3DGS调研.md>) | 5.4 | 2026-11-05 | 3DGS 调研 · 幕景 Scendance |
| [2026-10-27-Agent在场感.md](<archive/research/2026-10-27-Agent在场感.md>) | 7.6 | 2026-11-05 | 晴光 Agent 在场感调研 |
| [2026-11-01-场景脚本评审.md](<archive/research/2026-11-01-场景脚本评审.md>) | 49.4 | 2026-11-05 | 场景脚本 → 编译器 → 候选方案：对抗式代码评审 |
| [2026-11-01-生成机制收口.md](<archive/research/2026-11-01-生成机制收口.md>) | 21.2 | 2026-11-05 | 两份开源实现的共同点，以及幕景 3.0.0 的落地 |
| [2026-11-01-生成链路基线.md](<archive/research/2026-11-01-生成链路基线.md>) | 18.9 | 2026-11-05 | 幕景 Scendance 3.0.0 生成链路基线审计（2026-11-01） |
| [2026-11-01-生成链路索引.md](<archive/research/2026-11-01-生成链路索引.md>) | 1.7 | 2026-11-05 | 生成链路调研（2026-11-01） |
| [2026-11-01-五系统交叉验证.md](<archive/research/2026-11-01-五系统交叉验证.md>) | 33.1 | 2026-11-05 | 同类系统横向调研：我们用 5 个系统交叉验证「生成架构」共性，并定位幕景缺的 3 个机制 |
| [2026-11-01-音乐生成链路.md](<archive/research/2026-11-01-音乐生成链路.md>) | 47.7 | 2026-11-05 | oddeNova「一句话 → 正在响的音乐」生成链路研究 |
| [2026-11-01-智能建造链路.md](<archive/research/2026-11-01-智能建造链路.md>) | 50.6 | 2026-11-05 | PetitMaker「智能建造」生成链路研究 |
| [2026-11-04-3D重建路线.md](<archive/research/2026-11-04-3D重建路线.md>) | 43.3 | 2026-11-05 | 西湖场地素材 → Scendance 可用 3D 场景：技术路线调研 |
| [2026-11-04-素材核查缺口.md](<archive/research/2026-11-04-素材核查缺口.md>) | 26.0 | 2026-11-05 | 西湖场地素材核查与采集缺口（scene-3d，2026-11-04） |
| [2026-11-04-协作模式调研.md](<archive/research/2026-11-04-协作模式调研.md>) | 21.7 | 2026-11-05 | 中国同类产品「项目管理与协作」调研及 Scendance 落地方案 |
| [2026-11-04-Agent与人协作.md](<archive/research/2026-11-04-Agent与人协作.md>) | 22.3 | 2026-11-05 | Mirasim「Agent 与人」协作模式研究 + Scendance 落地改造清单 |
| [2026-11-04-GoldenPath缺口.md](<archive/research/2026-11-04-GoldenPath缺口.md>) | 16.3 | 2026-11-05 | 04 结论与路线图：Golden Path 差距地图（2026-11-04） |
| [38-Taste与IA备忘录.md](<archive/research/38-Taste与IA备忘录.md>) | 18.9 | 2026-11-13 | Scendance（幕景）Taste & IA Memo — 2026-10-29 |
| [2026-10-31-视觉方向.md](<archive/visual/2026-10-31-视觉方向.md>) | 3.8 | 2026-11-05 | 幕景工作台 · 2026 视觉方向 v1 |
| [2026-11-03-视觉稿说明.md](<archive/visual/2026-11-03-视觉稿说明.md>) | 1.3 | 2026-11-05 | 幕景工作台 · 2026 最终视觉稿 |

## 五、`docs/evidence/`（证据）（71 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [2026-11-04-混元资产核查.md](<evidence/2026-11-04-混元资产核查.md>) | 3.4 | 2026-11-05 | GLB 资产核查与交付边界 |
| [2026-11-18-live-build-review-round5.md](<evidence/79/00/2026-11-18-live-build-review-round5.md>) | 4.7 | 2026-11-19 | 线上构建复核 · 第五轮补扫（2026-11-18 晚） |
| [2026-11-18-live-build-review.md](<evidence/79/00/2026-11-18-live-build-review.md>) | 6.3 | 2026-11-18 | 线上构建复核：三处修复是否已部署（2026-11-18 晚） |
| [2026-11-19-deploy-gap.md](<evidence/79/00/2026-11-19-deploy-gap.md>) | 5.7 | 2026-11-19 | 部署缺口证据：正式站前端已写云端副本，后端没有对应端点 |
| [2026-11-19-deploy-resolution.md](<evidence/79/00/2026-11-19-deploy-resolution.md>) | 5.5 | 2026-11-19 | 部署缺口已闭合：scene-api v64（当前 v65）+ 两条户外迁移（2026-11-19） |
| [2026-11-19-case01-round6.md](<evidence/79/01/2026-11-19-case01-round6.md>) | 3.6 | 2026-11-19 | 1 用例 · 第六轮：空白项目 + 组合需求 + 地图确认地点及范围（2026-11-19） |
| [2026-11-19-case01-round7.md](<evidence/79/01/2026-11-19-case01-round7.md>) | 3.7 | 2026-11-19 | 1 复跑（2026-11-19 11:23）：新选址面板走通，分区用途回合被上游判 invalid |
| [2026-11-19-case01-v10-formal.md](<evidence/79/01/2026-11-19-case01-v10-formal.md>) | 4.4 | 2026-11-20 | 1 正式站 v10：空白项目 + 复合需求 → 候选 → 范围 → 应用 |
| [2026-11-19-case01-v8.md](<evidence/79/01/2026-11-19-case01-v8.md>) | 2.0 | 2026-11-19 | 1 v8：空白项目 + 组合需求，地点解析失败卡住（2026-11-19） |
| [2026-11-19-case01-v9-local.md](<evidence/79/01/2026-11-19-case01-v9-local.md>) | 3.7 | 2026-11-19 | 1 本地构建复验：组合需求 → 真实候选 → 12 点边界（2026-11-19） |
| [2026-11-18-case02-same-name-poi.md](<evidence/79/02/2026-11-18-case02-same-name-poi.md>) | 8.3 | 2026-11-18 | 2 两个同名地点，地图选中其中一个（真机走查 · 2026-11-18） |
| [2026-11-18-case02-selection-readback.md](<evidence/79/02/2026-11-18-case02-selection-readback.md>) | 2.7 | 2026-11-18 | 2 遗留补证：选中后 project 读取与零写（2026-11-18 第四轮） |
| [2026-11-18-case03-blocked.md](<evidence/79/03/2026-11-18-case03-blocked.md>) | 0.8 | 2026-11-18 | 3 改口被采纳 — blocked（2026-11-18 第四轮） |
| [2026-11-18-case03-round5-supplement.md](<evidence/79/03/2026-11-18-case03-round5-supplement.md>) | 2.1 | 2026-11-19 | 3 改口被采纳 — 第五轮补充取证（2026-11-18） |
| [2026-11-19-case04-v10-formal.md](<evidence/79/04/2026-11-19-case04-v10-formal.md>) | 5.6 | 2026-11-20 | 4 正式站 v10：无范围先发设计句，再改人数 |
| [2026-11-19-case04-v2-v5.md](<evidence/79/04/2026-11-19-case04-v2-v5.md>) | 3.4 | 2026-11-19 | 4 无范围设计句与人数/预算改口（v2–v5，2026-11-19） |
| [2026-11-19-case04-v9-local.md](<evidence/79/04/2026-11-19-case04-v9-local.md>) | 2.5 | 2026-11-19 | 4 本地构建复验：已有范围/分区上只改人数（2026-11-19） |
| [2026-11-18-case05-cdp-offline-supplement.md](<evidence/79/05/2026-11-18-case05-cdp-offline-supplement.md>) | 3.3 | 2026-11-18 | 5 补充：CDP 网络栈离线（2026-11-18 第四轮） |
| [2026-11-18-case05-offline.md](<evidence/79/05/2026-11-18-case05-offline.md>) | 9.5 | 2026-11-18 | 5 地图部分、离线或无路网（真机走查 · 2026-11-18） |
| [2026-11-18-case06-blocked.md](<evidence/79/06/2026-11-18-case06-blocked.md>) | 0.8 | 2026-11-18 | 6 四类阻塞界面落点 — blocked（2026-11-18 第四轮） |
| [2026-11-19-case06-not-logged-in.md](<evidence/79/06/2026-11-19-case06-not-logged-in.md>) | 4.3 | 2026-11-19 | 6 用例 · 分支一：未登录（2026-11-19 第六轮） |
| [2026-11-19-case06-trigger-runbook.md](<evidence/79/06/2026-11-19-case06-trigger-runbook.md>) | 14.5 | 2026-11-19 | 6 用例 · 剩余三类阻塞的可执行触发 runbook（2026-11-19 第六轮） |
| [2026-11-18-case07-blocked-no-proposal.md](<evidence/79/07/2026-11-18-case07-blocked-no-proposal.md>) | 3.7 | 2026-11-18 | 第四轮走查：3 / 6 / 7 / 8 / 9 blocked 登记（2026-11-18） |
| [2026-11-18-case07-round5-supplement.md](<evidence/79/07/2026-11-18-case07-round5-supplement.md>) | 5.2 | 2026-11-19 | 7 待预览时说「等等」— 第五轮补充取证（2026-11-18） |
| [2026-11-19-case07-08-round6.md](<evidence/79/07/2026-11-19-case07-08-round6.md>) | 6.8 | 2026-11-19 | 7 / 8 用例 · 第六轮真机复验（2026-11-19） |
| [2026-11-18-case08-blocked.md](<evidence/79/08/2026-11-18-case08-blocked.md>) | 0.9 | 2026-11-18 | 8 应用中刷新 / 双点确认 / 切项目 — blocked（2026-11-18 第四轮） |
| [2026-11-18-case08-round5-supplement.md](<evidence/79/08/2026-11-18-case08-round5-supplement.md>) | 3.8 | 2026-11-19 | 8 刷新 / 双点确认 / 切项目 — 第五轮补充取证（2026-11-18） |
| [2026-11-18-case09-blocked.md](<evidence/79/09/2026-11-18-case09-blocked.md>) | 0.6 | 2026-11-18 | 9 确认后撤销、重开旧草稿 — blocked（2026-11-18 第四轮） |
| [2026-11-18-case09-round5-supplement.md](<evidence/79/09/2026-11-18-case09-round5-supplement.md>) | 3.1 | 2026-11-19 | 9 确认后撤销、重开旧草稿 — 第五轮补充取证（2026-11-18） |
| [2026-11-19-case09-round6.md](<evidence/79/09/2026-11-19-case09-round6.md>) | 4.2 | 2026-11-19 | 9 用例 · 第六轮：确认后撤销 → 再应用一次（2026-11-19） |
| [2026-11-19-case09-v3.md](<evidence/79/09/2026-11-19-case09-v3.md>) | 2.5 | 2026-11-19 | 9 v3 复跑：手画边界后仍未取得同轮云端写读（2026-11-19） |
| [2026-11-19-log-correlation-round6.md](<evidence/79/10/2026-11-19-log-correlation-round6.md>) | 6.3 | 2026-11-19 | 10 · 服务端日志关联（第六轮补证，2026-11-19） |
| [2026-11-19-log-correlation-runbook.md](<evidence/79/10/2026-11-19-log-correlation-runbook.md>) | 11.3 | 2026-11-19 | 10 · 服务端日志关联的可执行方案（2026-11-19） |
| [2026-11-18-case11-exports.md](<evidence/79/11/2026-11-18-case11-exports.md>) | 5.1 | 2026-11-18 | 11 导出与旧云 Agent Run（真机走查 · 2026-11-18 第四轮） |
| [2026-11-18-case11-round5-button-matrix.md](<evidence/79/11/2026-11-18-case11-round5-button-matrix.md>) | 1.6 | 2026-11-19 | 11 导出入口矩阵 — 第五轮补充（2026-11-18） |
| [2026-11-19-case05-11-round6.md](<evidence/79/11/2026-11-19-case05-11-round6.md>) | 4.0 | 2026-11-19 | 5 用例 · 第六轮：离线（CDP 级）+ 11 导出与旧云 Agent Run（2026-11-19） |
| [2026-11-19-signoff-checklist.md](<evidence/79/2026-11-19-signoff-checklist.md>) | 15.1 | 2026-11-21 | 79 户外发布门禁 · 第六轮验收与签字清单（2026-11-19） |
| [2026-11-20-main-baseline-crosscheck.md](<evidence/79/2026-11-20-main-baseline-crosscheck.md>) | 7.3 | 2026-11-21 | 79 台账缺口 × origin/main 现状对照（2026-11-20，只读核对） |
| [README.md](<evidence/79/README.md>) | 4.8 | 2026-11-19 | 79 发布证据门禁 |
| [README.md](<evidence/aholo/people03-hanfu-rig/README.md>) | 0.9 | 未入库 | PEOPLE-03 古风样板自动绑骨 |
| [README.md](<evidence/aholo/people03b-hanfu-rig/README.md>) | 0.9 | 未入库 | PEOPLE-03b 正统汉服样板：绑骨 + Idle/Walk |
| [RERUN.md](<evidence/aholo/people04-hanfu-batch/song-m/RERUN.md>) | 0.4 | 未入库 | song-m rerun 2026-11-09 — SUCCESS |
| [BRIEF.md](<evidence/aholo/people05-crowd-uniform-batch/BRIEF.md>) | 2.4 | 未入库 | PEOPLE-05 活动岗位制服批次 |
| [README.md](<evidence/aholo/sculpture-rig-tpose/README.md>) | 6.2 | 2026-11-07 | 雕塑 T-Pose 派生 + 回 Aholo 绑骨（第 3 轮） |
| [README.md](<evidence/aholo/sculpture-rig/README.md>) | 2.5 | 2026-11-07 | 雕塑 humanoid auto-rig 实测记录 |
| [README.md](<evidence/C1/README.md>) | 1.3 | 2026-11-08 | C1 · MP-PLAN 风格 brief 三套（2026-11-08） |
| [H-batch-summary-2026-11-10.md](<evidence/H-batch-summary-2026-11-10.md>) | 4.0 | 2026-11-10 | H 批·户外 2D 复刻 总结（2026-11-10 · 收口） |
| [H1c-migrate-tokens-2026-11-10.md](<evidence/H1c-migrate-tokens-2026-11-10.md>) | 3.9 | 未入库 | H1-c · 旧项目迁移演练 + 视觉 design tokens（户外 2D 复刻 · H 批） |
| [README.md](<evidence/H2b-boundary-zones-2026-11-10/README.md>) | 6.5 | 未入库 | H2-b · 边界绘制 + 语义分区（验证证据） |
| [README.md](<evidence/H2c-facility-templates-2026-11-10/README.md>) | 3.7 | 未入库 | H2-c 设施模板拖放 · 页面行为证据（2026-11-10 07:00 接力轮） |
| [README.md](<evidence/H2d-routes-nodes-workers-2026-11-10/README.md>) | 5.4 | 未入库 | H2-d 三类动线 + 出入口节点 + 人员层 · 浏览器实测证据 |
| [README.md](<evidence/H3a-measure-stats-2026-11-10/README.md>) | 4.9 | 未入库 | H3-a 米制测量 + 派生统计 · 页面行为证据 |
| [README.md](<evidence/H3b-conflicts-2026-11-10/README.md>) | 4.6 | 未入库 | H3-b 冲突规则 + 可定位标记 · 页面行为证据 |
| [README.md](<evidence/H3c-info-panel-legend-2026-11-10/README.md>) | 4.3 | 未入库 | H3-c 规划信息面板 + 图例生成器 · 实测证据（2026-11-10 12:00 接力轮） |
| [README.md](<evidence/H4a-visual-tokens-2026-11-10/README.md>) | 5.2 | 未入库 | H4-a 视觉复刻：design tokens 全量 + 类型胶囊/图层/工具图标（Lucide 自绘同风格） |
| [README.md](<evidence/H4b-interactions-2026-11-10/README.md>) | 2.4 | 2026-11-10 | H4-b 交互复刻证据（2026-11-10 · 二十五轮 · feat/outdoor-2d） |
| [README.md](<evidence/H5a-exports-2026-11-10/README.md>) | 2.3 | 2026-11-10 | H5-a 导出证据（2026-11-10 · 二十五轮 · feat/outdoor-2d） |
| [README.md](<evidence/H5b-share-pdf-2026-11-10/README.md>) | 2.5 | 2026-11-10 | H5-b 只读分享 + PDF 演示稿证据（2026-11-10 · 二十五轮 · feat/outdoor-2d） |
| [TRIAL-LOG.md](<evidence/marble-trial/TRIAL-LOG.md>) | 2.6 | 未入库 | Marble 实跑记录（西湖茶亭 0194 抽帧） |
| [README.md](<evidence/measure-2026-11-05/README.md>) | 1.9 | 未入库 | 空间与布置实测口径（2026-11-05） |
| [noon-report-2026-11-10.md](<evidence/noon-report-2026-11-10.md>) | 5.5 | 2026-11-10 | 户外 2D 复刻 · 验收报告（H 批） |
| [README.md](<evidence/outdoor-default-anchor-2026-11-11/README.md>) | 3.7 | 未入库 | 户外默认地理锚点 + 右侧「隐藏底图」开关 — 2026-11-11 |
| [README.md](<evidence/outdoor-layers-tools-2026-11-11/README.md>) | 4.5 | 未入库 | 户外 2D · 顶部工具条并入左栏图层卡（OnePlan 手风琴）— 2026-11-11 |
| [README.md](<evidence/outdoor-library-oneplan-2026-11-11/README.md>) | 5.1 | 未入库 | 物件库复刻 OnePlan 布局 + 底图面板微调 + 底部单图标钮收口 — 2026-11-11 |
| [README.md](<evidence/SC-16/README.md>) | 3.9 | 2026-11-08 | SC-16 · 首单交付验收（B3） |
| [support_email_draft.md](<evidence/scene3d-recon-2026-11/support_email_draft.md>) | 3.6 | 未入库 | 致 Aholo 官方（lux3d@qunhemail.com）问询草稿 |
| [tdt-probe-2026-11-10.md](<evidence/tdt-probe-2026-11-10.md>) | 5.7 | 2026-11-10 | 天地图满铺探针报告（H0-a / H0-b / H0-c） |
| [README.md](<evidence/V5a-coldstone-reskin-2026-11-10/README.md>) | 2.6 | 2026-11-12 | V5-a 视觉收敛冷石画廊白（2026-11-10 · 二十五轮 · feat/outdoor-2d） |
| [2026-11-18-round2.md](<evidence/walk-2026-11-18-round2/2026-11-18-round2.md>) | 4.5 | 2026-11-18 | 户外漫游第二轮真机走查（2026-11-18 夜） |
| [2026-11-19-walk-audit.md](<evidence/walk-2026-11-18-round2/2026-11-19-walk-audit.md>) | 4.5 | 2026-11-19 | 漫游第三轮：通行体检 / 流线导航 / 观景位（2026-11-19 凌晨） |
| [walkthrough-2026-11-18.md](<evidence/walk-2026-11-18/walkthrough-2026-11-18.md>) | 5.7 | 2026-11-18 | 户外漫游 W1/W2/W3 真机走查（2026-11-18） |

## 六、`docs/research/`（调研长文）（21 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [2026-11-12-户外2D3D对齐-排查与收口.md](<research/2026-11-12-户外2D3D对齐-排查与收口.md>) | 27.3 | 2026-11-13 | 户外 2D/3D 对齐（51）排查与收口记录 |
| [_findings-browser-2026-11-11.md](<research/_findings-browser-2026-11-11.md>) | 20.8 | 2026-11-11 | 浏览器三车道压测发现清单（2026-11-11） |
| [_findings-code-2026-11-11.md](<research/_findings-code-2026-11-11.md>) | 17.0 | 2026-11-11 | 代码静态猎手发现清单（2026-11-11 · 车道 4） |
| [2026-11-10-yuquan-flower-show-photo-index.md](<research/2026-11-10-yuquan-flower-show-photo-index.md>) | 14.1 | 2026-11-11 | 杭州植物园 2026 菊展 · 照片索引与玉泉鱼跃试排依据 |
| [2026-11-11-全线压测-多代理扫查.md](<research/2026-11-11-全线压测-多代理扫查.md>) | 23.0 | 2026-11-11 | 全线压测 · 多代理扫查汇总（2026-11-11） |
| [2026-11-11-线上走查-广州45人切片.md](<research/2026-11-11-线上走查-广州45人切片.md>) | 12.1 | 2026-11-11 | 线上走查：广州会议室6 · 45人社区健康讲座切片（2026-11-11） |
| [2026-11-11-petitmaker-界面模式走查-补充.md](<research/2026-11-11-petitmaker-界面模式走查-补充.md>) | 9.6 | 2026-11-11 | PetitMaker 界面/交互走查 · 补充（2026-11-11 晚） |
| [2026-11-11-petitmaker-agent-run-学习.md](<research/2026-11-11-petitmaker-agent-run-学习.md>) | 4.5 | 2026-11-11 | PetitMaker 智能体首跑实测：卡片与交互模式清单（2026-11-11） |
| [2026-11-06-真实场地基准-HallD5.md](<research/2026-11-06-真实场地基准-HallD5.md>) | 13.2 | 2026-11-09 | 真实场地基准：首个端到端测试样本（2026-11-06） |
| [2026-11-09-模型接入与智能体运行.md](<research/2026-11-09-模型接入与智能体运行.md>) | 1.9 | 2026-11-09 | 模型接入与智能体运行：实施参考 |
| [2026-11-06-智能建造-实现与验收.md](<research/2026-11-06-智能建造-实现与验收.md>) | 9.4 | 2026-11-08 | 智能建造纵向链路：实现与验收记录 |
| [2026-11-07-公开活动与缺资料验收.md](<research/2026-11-07-公开活动与缺资料验收.md>) | 5.7 | 2026-11-08 | 公开资料与缺资料验收：G402 银发交流活动（模拟） |
| [2026-11-07-活动会话迁移设计-未启用.md](<research/2026-11-07-活动会话迁移设计-未启用.md>) | 5.9 | 2026-11-08 | 活动会话从本地迁至云项目：待验证设计（未启用） |
| [2026-11-07-开源智能Chat可复用方法.md](<research/2026-11-07-开源智能Chat可复用方法.md>) | 5.8 | 2026-11-08 | 开源智能 Chat：对幕景可复用的方法 |
| [2026-11-06-智能建造差距矩阵与路线图.md](<research/2026-11-06-智能建造差距矩阵与路线图.md>) | 21.3 | 2026-11-06 | 智能建造差距矩阵与路线图（2026-11-06） |
| [2026-11-06-智能建造对标升级.md](<research/2026-11-06-智能建造对标升级.md>) | 19.8 | 2026-11-06 | 智能建造对标升级研究（2026-11-06） |
| [README.md](<research/generation/README.md>) | 2.3 | 2026-11-05 | 生成链路调研（2026-11-01） |
| [scendance-smart-build-p4-2026-11-04.md](<research/generation/scendance-smart-build-p4-2026-11-04.md>) | 19.4 | 2026-11-05 | 智能建造 P4 收尾：生成前可行域探测、读白只承诺可达座位、件/座单位收口（2026-11-04） |
| [activity-ai-workbench-gallery-2026-11-04.md](<research/ia-2026-11-04/activity-ai-workbench-gallery-2026-11-04.md>) | 24.0 | 2026-11-04 | 分片 A：活动 — AI 主对话工作台 / 开场画廊 竞品调研底稿 |
| [review-bingo-canvas-annotation-2026-11-04.md](<research/ia-2026-11-04/review-bingo-canvas-annotation-2026-11-04.md>) | 25.9 | 2026-11-04 | 分片 B · 审校 Bingo：画布钉点评审对标调研底稿 |
| [space-materials-tool-panels-2026-11-04.md](<research/ia-2026-11-04/space-materials-tool-panels-2026-11-04.md>) | 32.8 | 2026-11-04 | 分片 C（空间 / 物料）IA 重划调研：工具面板如何不人格化、生成动作如何收进库面板 |

## 七、`docs/` 其余子目录（10 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [vitest-baseline-63b11ae1.md](<quality/vitest-baseline-63b11ae1.md>) | 14.3 | 2026-11-18 | 全量 vitest 基线失败台账 · origin/main @ 63b11ae1 |
| [ATTRIBUTION.md](<oneplan-icons/ATTRIBUTION.md>) | 11.5 | 2026-11-17 | 第三方图标素材清单（OnePlan 物件库快照） |
| [NAMES.md](<oneplan-icons/NAMES.md>) | 50.1 | 2026-11-17 | OnePlan 物件名 ↔ 图标文件对照表 |
| [vitest-baseline-0a59f7b0.md](<quality/vitest-baseline-0a59f7b0.md>) | 11.3 | 2026-11-17 | 全量 vitest 基线失败台账 · origin/main @ 0a59f7b0 |
| [4.0.0.md](<release-notes/4.0.0.md>) | 2.5 | 2026-11-06 | 4.0.0 智能建造升级 — 给丽丽的变更说明 |
| [2026-10-14-参数化资产契约.md](<contracts/2026-10-14-参数化资产契约.md>) | 2.1 | 2026-11-05 | 固定参数化资产 |
| [2026-10-14-预设场景契约.md](<contracts/2026-10-14-预设场景契约.md>) | 2.2 | 2026-11-05 | 已归档场景预设 |
| [2026-10-14-资产定制契约.md](<contracts/2026-10-14-资产定制契约.md>) | 3.3 | 2026-11-05 | 不可变材质与纹理派生资产 |
| [2026-10-14-DeepSeek-Agent契约.md](<contracts/2026-10-14-DeepSeek-Agent契约.md>) | 3.5 | 2026-11-05 | DeepSeek 场景 Agent |
| [2026-11-04-Supabase业务契约.md](<contracts/2026-11-04-Supabase业务契约.md>) | 3.5 | 2026-11-05 | Supabase 业务接入契约 |

## 八、`flow/`（任务卡与流水）（28 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [editor-appearance-mode.md](<../flow/tasks/editor-appearance-mode.md>) | 49.9 | 2026-11-21 | 工作台外观模式（跟随系统 / 浅色 / 深色） |
| [进展.md](<../flow/进展.md>) | 191.5 | 2026-11-13 | 协作进展 |
| [decisions.md](<../flow/decisions.md>) | 8.3 | 2026-11-13 | 产品与协作决策 |
| [plan.md](<../flow/plan.md>) | 9.9 | 2026-11-13 | 幕景长期开发计划 |
| [activity-task-api-implementation.md](<../flow/tasks/activity-task-api-implementation.md>) | 5.0 | 2026-11-13 | 活动任务建议：真实服务端接线 |
| [activity-task-suggestions.md](<../flow/tasks/activity-task-suggestions.md>) | 5.1 | 2026-11-13 | 活动上下文与任务建议：先接同一业务真源 |
| [aihot-code-learning.md](<../flow/tasks/aihot-code-learning.md>) | 4.0 | 2026-11-13 | AIHOT源码学习与幕景优化 |
| [binggo-launcher-refinement.md](<../flow/tasks/binggo-launcher-refinement.md>) | 5.7 | 2026-11-13 | Binggo 入口：常驻头像与按需提示 |
| [commercial-domain-proposal.md](<../flow/tasks/commercial-domain-proposal.md>) | 32.9 | 2026-11-13 | 商务约定领域：首切片设计提案 |
| [commercial-storage-handoff.md](<../flow/tasks/commercial-storage-handoff.md>) | 11.8 | 2026-11-13 | 商务本机记录与原件包接线交接 |
| [commercial-ui-integration.md](<../flow/tasks/commercial-ui-integration.md>) | 7.5 | 2026-11-13 | 合同与约定：下一段界面接入 |
| [compact-canvas-frame.md](<../flow/tasks/compact-canvas-frame.md>) | 2.7 | 2026-11-13 | 素材架、工具轨道与助手共享画布空间 |
| [director-acceptance.md](<../flow/tasks/director-acceptance.md>) | 9.6 | 2026-11-13 | 导演验收与优先级 |
| [execution-timetable-acceptance.md](<../flow/tasks/execution-timetable-acceptance.md>) | 2.8 | 2026-11-13 | 执行时间表接入验收 |
| [layout-intent-review.md](<../flow/tasks/layout-intent-review.md>) | 2.7 | 2026-11-13 | 工作台布局原意核对 |
| [local-activity-ai-next.md](<../flow/tasks/local-activity-ai-next.md>) | 2.7 | 2026-11-13 | 同活动继续 AI 场景编辑：下一切片 |
| [petitmaker-agent-checkpoint-failure.md](<../flow/tasks/petitmaker-agent-checkpoint-failure.md>) | 3.3 | 2026-11-13 | PetitMaker Agent机制：保存不确定时停止后续模型 |
| [petitmaker-file-io-reliability.md](<../flow/tasks/petitmaker-file-io-reliability.md>) | 2.6 | 2026-11-13 | PetitMaker成果机制：文件IO失败完整收口 |
| [petitmaker-workbench-refinement.md](<../flow/tasks/petitmaker-workbench-refinement.md>) | 7.0 | 2026-11-13 | PetitMaker参考：底部素材与工作台减繁 |
| [production-plan-contract-audit.md](<../flow/tasks/production-plan-contract-audit.md>) | 2.3 | 2026-11-13 | 制作计划契约审计待办 |
| [project-review-library-handoff.md](<../flow/tasks/project-review-library-handoff.md>) | 6.6 | 2026-11-13 | 方案评审草稿与冻结文件 · 执行交接 |
| [public-model-cold-reopen.md](<../flow/tasks/public-model-cold-reopen.md>) | 4.5 | 2026-11-13 | 可信公共模型：普通本机冷重开 |
| [quantity-checkin-next.md](<../flow/tasks/quantity-checkin-next.md>) | 1.9 | 2026-11-13 | 下一切片候选：租赁物料点验 |
| [recording-delivery-matrix.md](<../flow/tasks/recording-delivery-matrix.md>) | 13.6 | 2026-11-13 | 录音驱动的开发与验收 |
| [reference-plan-acceptance.md](<../flow/tasks/reference-plan-acceptance.md>) | 3.0 | 2026-11-13 | 参考底图独立验收 |
| [version-candidate-plan.md](<../flow/tasks/version-candidate-plan.md>) | 7.4 | 2026-11-13 | 下一完整版本候选：活动执行与项目成果 |
| [workbench-simplification.md](<../flow/tasks/workbench-simplification.md>) | 3.5 | 2026-11-13 | 工作台顶栏与聊天入口精简 |
| [workspace-entry-consistency.md](<../flow/tasks/workspace-entry-consistency.md>) | 2.1 | 2026-11-13 | 工作台打开、关闭与编辑入口的一致性 |

## 九、`frontend/`（20 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [README.md](<../frontend/README.md>) | 15.6 | 2026-11-21 | 幕景 Scendance · 活动场地工作台 |
| [SCENE-PRESETS.md](<../frontend/docs/SCENE-PRESETS.md>) | 1.7 | 2026-11-19 | 场景模板库（已移出本仓） |
| [README.md](<../frontend/lib/site-intelligence/README.md>) | 11.1 | 2026-11-13 | Site intelligence integration contract (implemented module; Chat… |
| [README.md](<../frontend/evals/brief/README.md>) | 4.2 | 2026-11-09 | 活动需求离线评测（合成样本） |
| [agent-eval-baseline.README.md](<../frontend/scripts/agent-eval-baseline.README.md>) | 1.2 | 2026-11-08 | 幕景 Agent 离线基线 |
| [evaluate-live-dialogues.README.md](<../frontend/scripts/evaluate-live-dialogues.README.md>) | 2.4 | 2026-11-08 | 隔离试用：批量对话与工具检查 |
| [CHANGELOG.md](<../frontend/CHANGELOG.md>) | 8.9 | 2026-11-07 | 前端版本记录 |
| [scoring-flow-spec.md](<../frontend/lib/scoring-flow-spec.md>) | 5.5 | 2026-11-06 | 第 12 批「能摆 → 会摆」接口冻结（内部 spec，不对外导出） |
| [ATTRIBUTION.md](<../frontend/public/icon-park/ATTRIBUTION.md>) | 0.4 | 2026-11-03 | IconPark attribution |
| [ATTRIBUTION.md](<../frontend/public/material-symbols/ATTRIBUTION.md>) | 0.9 | 2026-11-03 | Material Symbols attribution |
| [README.md](<../frontend/app/fonts/README.md>) | 0.6 | 2026-10-31 | SIL Open Font License 1.1 (summary for vendored files in this fo… |
| [README.md](<../frontend/components/room-organizer/assets/README.md>) | 0.9 | 2026-10-27 | Assets |
| [AGENTS.md](<../frontend/AGENTS.md>) | 1.0 | 2026-10-10 | Frontend ownership |
| [ASSET-SOURCES.md](<../frontend/ASSET-SOURCES.md>) | 1.6 | 2026-10-10 | Frontend model provenance |
| [README.md](<../frontend/public/showcase/assets/brand/logo-2026/README.md>) | 6.2 | 未入库 | logo-2026 · 「AI 的门」品牌留档 |
| [README.md](<../frontend/public/showcase/assets/brand/README.md>) | 6.2 | 未入库 | 幕景品牌资产 · 总索引 |
| [README.md](<../frontend/public/showcase/assets/generated/README.md>) | 1.0 | 未入库 | 生成素材存档 |
| [README.md](<../frontend/public/showcase/assets/library/README.md>) | 3.0 | 未入库 | 统一模型库 |
| [README.md](<../frontend/public/showcase/assets/models/README.md>) | 4.4 | 未入库 | assets/models/ —— 精选 fixture，不是物料库 |
| [README.md](<../frontend/public/showcase/assets/scenes/README.md>) | 1.5 | 未入库 | 场景类别建筑图 |

## 十、`tools/`（7 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [BATCH-NOTES-20261119.md](<../tools/aholo/BATCH-NOTES-20261119.md>) | 7.1 | 2026-11-20 | Aholo 临期积分批量补库 · 2026-11-19 晚 |
| [README.md](<../tools/replica-geo/README.md>) | 2.1 | 2026-11-18 | replica-geo · 案例配准与重描流程 |
| [README.md](<../tools/aholo/walkthrough/README.md>) | 1.6 | 2026-11-04 | Aholo 3DGS 场景漫游（实验页） |
| [README.md](<../tools/units-preview/README.md>) | 2.7 | 2026-10-22 | tools/units-preview |
| [README.md](<../tools/blender/README.md>) | 6.2 | 2026-10-10 | tools/blender |
| [README.md](<../tools/catalog/README.md>) | 3.7 | 2026-10-10 | tools/catalog |
| [README.md](<../tools/floorplan/README.md>) | 6.2 | 2026-10-10 | tools/floorplan |

## 十一、其他模块（24 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [63-飞书版-Agent合格度与断点.md](<../deliverables/63-飞书版-Agent合格度与断点.md>) | 11.0 | 2026-11-21 | 什么样的 AI Agent 才算合格？ |
| [outdoor-boundary-close-fix-2026-11-18.md](<../deliverables/outdoor-boundary-close-fix-2026-11-18.md>) | 9.8 | 2026-11-20 | 用地红线无法闭合 · 修复说明（2026-11-18） |
| [outdoor-map-editing-fix-acceptance-2026-11-20.md](<../deliverables/outdoor-map-editing-fix-acceptance-2026-11-20.md>) | 27.7 | 2026-11-20 | 户外地图编辑交互修复 · 独立验收（2026-11-20） |
| [outdoor-map-editing-interaction-audit-2026-11-20.md](<../deliverables/outdoor-map-editing-interaction-audit-2026-11-20.md>) | 31.3 | 2026-11-20 | 户外规划 · 地图编辑交互审计 |
| [pr-wip-outdoor-tests.md](<../deliverables/pr-wip-outdoor-tests.md>) | 3.4 | 2026-11-20 | WIP：户外方案 v1–v8 快照（279 例测试未过） |
| [README.md](<../data/agent-corpus/README.md>) | 4.1 | 2026-11-19 | Agent 底座语料（agent-corpus） |
| [agent-task.md](<../.github/ISSUE_TEMPLATE/agent-task.md>) | 0.8 | 2026-11-18 | --- |
| [H-batch-summary-2026-11-10.md](<../deliverables/H-batch-summary-2026-11-10.md>) | 4.0 | 2026-11-13 | H 批·户外 2D 复刻 总结（2026-11-10 · 收口） |
| [tdt-probe-2026-11-10.md](<../deliverables/tdt-probe-2026-11-10.md>) | 5.8 | 2026-11-13 | 天地图满铺探针报告（H0-a / H0-b / H0-c） |
| [building-heights-stats.md](<../data/building-heights-stats.md>) | 5.4 | 2026-11-10 | 建筑高度数据 · 来源统计 |
| [OWNERSHIP.md](<../data/OWNERSHIP.md>) | 5.4 | 2026-11-10 | data/building-heights.json · 唯一写入方规则 |
| [README.md](<../assets/brand/logo-2026/README.md>) | 6.2 | 2026-11-07 | logo-2026 · 「AI 的门」品牌留档 |
| [README.md](<../assets/brand/README.md>) | 6.0 | 2026-11-07 | 幕景品牌资产 · 总索引 |
| [research-a-constraint-graph.md](<../development-research/research-a-constraint-graph.md>) | 11.5 | 2026-11-06 | 研究线 A：约束图结构与 grounded planning 分工 |
| [research-b-corridor.md](<../development-research/research-b-corridor.md>) | 13.8 | 2026-11-06 | Research-B：走廊连通性与可达性建模规格 |
| [research-c-scoring-dimensions.md](<../development-research/research-c-scoring-dimensions.md>) | 15.8 | 2026-11-06 | 研究线 C — 打分维度 / Solver 接口 / 活动引擎数据结构对照 |
| [pull_request_template.md](<../.github/pull_request_template.md>) | 0.7 | 2026-11-04 | - [ ] 验收标准 1： |
| [README.md](<../assets/models/README.md>) | 4.4 | 2026-11-04 | assets/models/ —— 精选 fixture，不是物料库 |
| [README.md](<../assets/generated/README.md>) | 1.0 | 2026-10-30 | 生成素材存档 |
| [3d-expert.agent.md](<../.github/agents/3d-expert.agent.md>) | 6.0 | 2026-10-22 | --- |
| [README.md](<../assets/library/README.md>) | 3.0 | 2026-10-10 | 统一模型库 |
| [README.md](<../assets/scenes/README.md>) | 1.5 | 2026-10-10 | 场景类别建筑图 |
| [reconstruction-development.md](<../supabase/ops/reconstruction-development.md>) | 6.6 | 2026-10-10 | Reconstruction development runbook |
| [README.md](<../learning-library/oneplan-siteplans/README.md>) | 5.6 | 未入库 | OnePlan 经典案例学习库（Site plans we love） |

## 十二、仓库根（9 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [AGENTS.md](<../AGENTS.md>) | 9.3 | 2026-11-21 | 幕景 Scendance · 项目规范（AI 与人共同必读） |
| [ASSET-SOURCES.md](<../ASSET-SOURCES.md>) | 7.7 | 2026-11-21 | 3D asset sources |
| [CHANGELOG.md](<../CHANGELOG.md>) | 275.7 | 2026-11-21 | 更新记录 |
| [MEMORY.md](<../MEMORY.md>) | 2.8 | 2026-11-21 | Project memory |
| [HANDOFF.md](<../HANDOFF.md>) | 699.3 | 2026-11-20 | HANDOFF.md — Scendance2026 跨会话交接 |
| [SUPABASE-EGRESS-AUDIT.md](<../SUPABASE-EGRESS-AUDIT.md>) | 2.6 | 2026-11-20 | Supabase 出网清单（只读审计，2026-11-20） |
| [README.md](<../README.md>) | 7.7 | 2026-11-19 | 幕景 Scendance |
| [CONTRIBUTING.md](<../CONTRIBUTING.md>) | 2.3 | 2026-11-18 | 贡献与自动化约定 |
| [BACKEND.md](<../BACKEND.md>) | 2.3 | 2026-11-05 | 场景规划 Agent 后端 |

## 十三、agent 草稿（未入库）（26 份）

| 文件 | KB | 最后改动 | 首句 |
| --- | ---: | --- | --- |
| [SKILL.md](<../.agents/skills/aholo-reality-skill/SKILL.md>) | 8.1 | 未入库 | Aholo Reality |
| [2026-11-18.md](<../.memsearch/memory/2026-11-18.md>) | 2.0 | 未入库 | 2026-11-18 |
| [conversation-trace-plan.md](<../.trae/documents/conversation-trace-plan.md>) | 6.9 | 未入库 | 全链路对话留痕方案 |
| [plan-sess_27b473d0-3dc6-4ffa-ba4e-385c0391aac8.md](<../.zcode/plans/plan-sess_27b473d0-3dc6-4ffa-ba4e-385c0391aac8.md>) | 4.4 | 未入库 | {"context": "用户两个诉求：①「2D 的时候罗盘不能转」——2D 画布没有地图旋转管线（此前搁置项），罗盘在 2D … |
| [plan-sess_6baf284d-8a14-414c-818d-e31b61bcead1.md](<../.zcode/plans/plan-sess_6baf284d-8a14-414c-818d-e31b61bcead1.md>) | 5.3 | 未入库 | 户外项目主画布 3D 归一：直接复用 OutdoorPlan3D（接管态） |
| [plan-sess_6c6b5b81-1cfc-4c06-a6bd-2bb67528f866.md](<../.zcode/plans/plan-sess_6c6b5b81-1cfc-4c06-a6bd-2bb67528f866.md>) | 4.0 | 未入库 | 已爬取 OnePlan「Site plans we love」45 个案例的高清规划图建成本地学习库（learning-libr… |
| [plan-sess_9716f736-8398-4444-923a-fa1583dbdc9b.md](<../.zcode/plans/plan-sess_9716f736-8398-4444-923a-fa1583dbdc9b.md>) | 8.1 | 未入库 | V-5 全卡检查结论：V-5a（契约 modelOverride → 候选切换 UI → 3D 即时换模型）已落码全绿；V-5b… |
| [plan-sess_b853b358-8098-4aa9-8d47-0b1e60cc41b1.md](<../.zcode/plans/plan-sess_b853b358-8098-4aa9-8d47-0b1e60cc41b1.md>) | 0.9 | 未入库 | 三个快速修正（多图层系统探索已搁置，等你回来再续） |
| [plan-sess_c67ba7bc-6c58-4787-9ffa-01e5f307e83e.md](<../.zcode/plans/plan-sess_c67ba7bc-6c58-4787-9ffa-01e5f307e83e.md>) | 4.7 | 未入库 | 登录注册浮窗化(与账户入口合一) |
| [plan-sess_fabbda39-fed2-40c8-8f28-18148d60cb2d.md](<../.zcode/plans/plan-sess_fabbda39-fed2-40c8-8f28-18148d60cb2d.md>) | 4.5 | 未入库 | Chat 区域交互改造计划（对照谷地工坊 Beta） |
| [INDEX.md](<../.zwork/artifacts/0717c3a3-dccb-4543-ae60-e97a3d8fbabc/INDEX.md>) | 16.1 | 未入库 | 文档索引（2026-11-13 手工整理版） |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/1565d288-7121-479f-b4aa-d72a620ce913/2026-11-20-people-registry-unification.md>) | 19.8 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [INDEX.md](<../.zwork/artifacts/21c4a659-11a6-48ab-95a3-ea39e5f1dacb/INDEX.md>) | 16.2 | 未入库 | 文档索引（2026-11-13 手工整理版） |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/3ea43a6e-dced-457b-afb8-02ab5d6436bf/2026-11-20-people-registry-unification.md>) | 20.0 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [persistence-undo.md](<../.zwork/artifacts/713f1d04-6ccd-4e6e-8fd5-6e7ff7d90fb5/persistence-undo.md>) | 14.8 | 未入库 | 户外方案持久化 / 撤销链路审计 |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/749440ae-6774-48ca-84b6-c0dd94114faf/2026-11-20-people-registry-unification.md>) | 19.7 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/80d53974-7563-466b-bcc2-32f48eafbb37/2026-11-20-people-registry-unification.md>) | 21.8 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/87808bf0-6c7b-41e9-8e39-fc2bc15b626f/2026-11-20-people-registry-unification.md>) | 20.0 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [INDEX.md](<../.zwork/artifacts/98515b4f-aca7-4b49-b79a-9bc401e70672/INDEX.md>) | 16.1 | 未入库 | 文档索引（2026-11-13 手工整理版） |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/9ed441a9-4f40-44eb-9006-749ca0ffd8e7/2026-11-20-people-registry-unification.md>) | 19.6 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/bbae4941-fdfc-4a07-b5a5-e54fafc8c01f/2026-11-20-people-registry-unification.md>) | 19.7 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [2026-11-20-people-registry-unification.md](<../.zwork/artifacts/be180002-819d-4143-a384-77bd6e8fed10/2026-11-20-people-registry-unification.md>) | 21.9 | 未入库 | 人物登记表统一：不同人群去重与性别化（大改计划） |
| [CHANGELOG.md](<../.zwork/artifacts/fd70728f-d78a-4513-936b-d951e6478c78/CHANGELOG.md>) | 262.8 | 未入库 | 更新记录 |
| [0-研究员.md](<../.zwork/runs/867d3395/0-研究员.md>) | 2.8 | 未入库 | 研究员 — run 867d3395 participant 0 |
| [1-研究员.md](<../.zwork/runs/867d3395/1-研究员.md>) | 2.3 | 未入库 | 研究员 — run 867d3395 participant 1 |
| [2-研究员.md](<../.zwork/runs/867d3395/2-研究员.md>) | 2.1 | 未入库 | 研究员 — run 867d3395 participant 2 |

## 十四、自动体检（每次生成重算）

1. **编号占用**：`docs/` 根 50 份编号文档，占用 01–63；缺号 14 个（08/10/17/18/20/30/31/34/35/38/51/52/53/54）。
2. **重号**：46 号 2 份（`46-Agent运行卫生上线手册-20261116.md` / `46-虚拟场地纸面模式规格-20261117.md`）。
3. **`docs/plans/` 命名**：9 份无日期前缀（文件名看不出新旧，只能看本表的时间列）。
4. **未入库**：90 份 md 没有 git 记录（含 agent 草稿）；这些只在本机，别处 checkout 拿不到。
5. **体量最大**：`HANDOFF.md` 699.3 KB、`CHANGELOG.md` 275.7 KB、`.zwork/artifacts/fd70728f-d78a-4513-936b-d951e6478c78/CHANGELOG.md` 262.8 KB、`docs/plans/2026-11-16-outdoor-agent-progress.md` 233.5 KB、`flow/进展.md` 191.5 KB、`docs/plans/2026-11-13-delivery-frontend.md` 151.9 KB。

## 生成口径

- 扫描整个工作副本，排除 `node_modules` / `.next` / `out` / `.git` / `vendor` / `.turbo`；`.zwork`、`.zcode`、`.trae`、`.agents`、`.memsearch` 单列为 agent 草稿。
- `最后改动` = 该文件最近一次 git 提交日期（一次 `git log` 全量解析）；无记录写「未入库」。
- `首句` = 文件首个一级标题；无标题则取首个非空正文行；截断 64 字。是文件自述，不是评审结论。
- 本页不写结论、不替代 INDEX。要改本页格式，改 `scripts/doc-scan.mjs` 后重跑，不要直接编辑。
