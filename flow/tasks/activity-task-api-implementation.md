# 活动任务建议：真实服务端接线

2026-10-10。root在PetitMaker组合核心验收后，正式授权原后端实施此前只读activity-task-agent-integration.md方案。完整目标是从当前活动显式选资料，经真实可调用接口得到建议，人工确认后保存读回并出执行表；这个服务端任务不是完整UI流程完成。

唯一后端owner：新共享任务上下文/建议/结果契约、既有Agent API/RPC分流与单次任务executor、唯一新SQL迁移及真实相关测试。可薄新增文件，不另建运行队列/存储引擎/平行EventOperations schema。客户端及所有共享UI属前端；既有activity-task-suggestions helper暂冻，确需共享schema替换先报最小两文件ownership，稳定proposal/receipt语义不改。

范围仅现已登录、有绑定服务project与有效lease的本机活动。URL remote project与summary local activityId可不同，成员/lease是服务鉴权，local标识/hash不是权限。未绑定明确不支持，不自动新建项目/上传整场景或拿公共local/假Scene绕过。

同agent-runs endpoint明确activity_tasks分支。仅传已披露summary+instruction，单次只读JSON调用，无Scene/catalog/resources/photos/合同/原件URL/本机fingerprint，无repair/JEV/工具侧效应。严格四字段建议，未知人员/时间/数量/费用不猜，模型不能分配task IDs/状态/证据/承诺；引用仅已披露记录。来源专业方法用既有runbook，不加新安全/报价阈值。

结果专属槽与complete同事务，GET/POST重放不多调用；写前失败无假成果、提交后响应丢失可查原结果。运行中deadline/原lease/actor变化阻止结果落存；本次前端异步操作期间身份/lease/相关资料变化拒迟到准备或确认，已取消结果不能确认。Scene默认请求/响应/已有fingerprint重放兼容。当前agent_runs只有input JSON/base_hash等，没有独立base_scene列；应核现表及所有RPC当前定义，不根据报告简称猜新约束。

期限澄清依据已冻API/SQL和原研究：TaskDTO expiresAt取90秒运行deadline，仅queued/running到期失败，不是已complete建议的新确认TTL。完成后同账号刷新重新取得lease，可在同API/user/local/remote身份、完整source及当前有效授权重核后接纳同一本机稳定proposal；不重买模型或重造ID，不套Scene proposal的十分钟apply期限。首次确认写入前GET原run仍complete且结果/hash一致，查询失败或服务器取消保原稿不写；await后和布局写前重新核当前有效权限与lease。已saving的恢复仍核本机是否已写，不用后续网络失败回滚事实。此前无时间限定的取消/期限/lease句过宽，不能据此声称永久绑定生成时lease已实现。

验收以真实本机数据库：捕模型消息仅白名单、一次调用；额外字段/非法工具/截断/失联或重复引用整体失败，资产/Scene proposal/活动任务无副作用；结果事务前后故障、原请求GET/replay、cancel/过期/权限/lease及旧Scene全部必要兼容检查。types与Edge检查、精确最终hash交前端。真实模型质量/正式云单列，root/worker不调用付费服务或改主fixture。

前端随后按独立typed方法、POST前持久marker、同run prepare一次稳定IDs、确认后的可等待保存与读回桥接线，保存失败/未知保原proposal，保存核实才闭合。合同面板接入优先，接口与UI可独立并行；没有生产模型入口时不给假“生成”按钮。

## 第一切片验收与下一步

2026-10-10：后端已交六文件固定版。root实际读取 contract、runner、API 分流与 SQL 的 create/claim/check/finish 路径，六文件 SHA 与回执一致；本机新 API 38 项及 helper→共享 schema→prepare 跨层 1 项合计 39 项通过，root 严格类型检查通过。跨层测试已使用仓库内演练 fixture，不依赖 Windows 私人备份绝对路径；另一次本机完整 20 任务／39 物件备份交叉核对通过，但不作为可移植 fixture 发布。

原后端继续仅接 `client/scene-client.ts` 与 `tests/activity-task-client.test.ts`，旧 Scene 方法不变。原前端负责 BackendSession、摘要选择、持久请求 marker、稳定提案与确认后的保存读回，不并行改 client。真实付费模型、云部署和完整任务 UI 尚未验收。

客户端切片已完成：四方法 start/get/byRequest/cancel，严格结果及对应身份核对，未知POST不自动重发；新20与旧7项检查通过。client SHA3eca324ebc63c49e620abdc17baf53449f6a1f49f6a73d82e108151b8fb1248b，测试SHA5177f18092b896c50e1c4a0a19708120eaeefcbb779b2bbb4c52035424a6febd。root读实现及测试边界，真实helper→client→API/PGlite→提交后丢POST→原request GET恢复→prepare→再次GET跨层通过，模型替身只调用一次、本机layout与远端scene/revision均未写。root跨层两项及类型检查通过；summary先经共享schema归一化，不用宽类型强转绕过边界。完整UI保存仍待，不能以查询到complete闭合业务receipt。
