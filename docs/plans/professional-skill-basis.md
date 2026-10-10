# 专业能力依据与采用范围

2026-10-09。用户明确要求：专业问题必须先找专业Skill，不由Agent自行编造行业规则。本记录约束后续活动、商务与市场工作；工程实现、演练样本与专业意见分开。

## 已检索并读取的原版Skill

采用固定提交 `ae1513ea94dcb74a7f1505ddcf3b0ec3fab327f1` 的 [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins/tree/ae1513ea94dcb74a7f1505ddcf3b0ec3fab327f1)，Apache-2.0。已通过官方skill-installer放入本项目参考目录 `C:/幕景/professional-skills/anthropic-knowledge-work/`，保留原结构、原文、LICENSE及shared参考文件，不运行外部脚本、不连接其列举的服务、不启用自动发送、付款或定时流程。不是全局插件安装，也不声称因此获得法律或现场工程资质。

| 专业工作 | Skill与实际采用内容 | 范围限制 |
|---|---|---|
| 需求转方案、报价资料 | [proposal-builder](https://github.com/anthropics/knowledge-work-plugins/blob/ae1513ea94dcb74a7f1505ddcf3b0ec3fab327f1/small-business/skills/proposal-builder/SKILL.md)，已读全部5份reference。需求来自原文；明确范围、不含事项、缺失信息、工期依赖；价格依据历史项目、价目表或真实供应报价 | 没有依据的人工费、物料费、分包价、折扣、交期保持未知。reference中的订金30%–50%、net15/30、有效期30天、15%偏差提示都是作者示例，未经本项目确认及本地适用复核不变成默认规则 |
| 执行交接 | [runbook](https://github.com/anthropics/knowledge-work-plugins/blob/ae1513ea94dcb74a7f1505ddcf3b0ec3fab327f1/operations/skills/runbook/SKILL.md)：前提、具体动作、期望结果、失败处理、核验与升级求助；让未参与讨论的人照单演练 | 这是通用运维流程方法，可用于检查交接完整性；不冒充布展消防、承重、供电或大型活动安全专业标准 |
| 变更记录 | [change-request](https://github.com/anthropics/knowledge-work-plugins/blob/ae1513ea94dcb74a7f1505ddcf3b0ec3fab327f1/operations/skills/change-request/SKILL.md)：变更原因、受影响对象、成本/进度影响、负责人、依赖、回退及决策记录 | 不把IT的CAB审批机构套给两人团队，不自动创建外部工单或发消息；只用适合现有项目的检查项 |
| 合同资料核对 | [contract-review](https://github.com/anthropics/knowledge-work-plugins/blob/ae1513ea94dcb74a7f1505ddcf3b0ec3fab327f1/small-business/skills/contract-review/SKILL.md)：先完整读原件及附件、识别双方与我方角色、引用真实条款、标缺失事项、保留原件 | 当前仅据此核资料结构。其net30、责任上限、保密时长等通用判断不直接用于中国境内承办合同；没有真实文本/本地专业依据，不自动红黄绿判定、不生成正式条款、不判断签署效力 |

原目录：`operations/skills/runbook`、`operations/skills/change-request`、`small-business/skills/proposal-builder`、`small-business/skills/contract-review`。支持文件来源见同根`source-manifest.json`。这些是可信维护方提供的工作方法，不等于每项行业断言都有专业证据。

## 未直接采用

- [freestylefly/event-architect-skill](https://github.com/freestylefly/event-architect-skill/blob/5a0d4fded7317f9886c43bf702bd41af931a01f1/SKILL.md)：覆盖活动目标、创意、时间表、物料、预算、风险，主题匹配；但“十年总监”是提示角色，未核实作者资历，也未给固定预算比例/每环节10–15分钟缓冲的来源。不安装为专业规范，不把这些数字写死进产品。
- 官方`operations/vendor-review`已读，但重点为软件供应商的许可证、迁移、SLA、续约等。不能当布展供应商或临时人员管理的完整专业依据。
- [Anthropic Legal README](https://github.com/anthropics/knowledge-work-plugins/blob/ae1513ea94dcb74a7f1505ddcf3b0ec3fab327f1/legal/README.md)明示默认案例以美国法域为主；不直接复制为国内合同立场。
- 搜索也发现中文合同审查第三方Skill，尚未完成作者/规则来源审查，暂不采用。没有可信匹配的细分专业内容应标待核，不用“找到了Skill”替代判断依据。

## 对当前开发的具体约束

1. 合同面板继续做已有事实的记录、原件、草稿、固定版本和恢复；不把固定版本称已签署/生效。人工签署报告只表示用户记录的观察，不代替验签。
2. 金额与节点均需实际来源或用户输入，缺失不填零、不用演练经济测算或上述Skill示例作报价。只有文档总金额时不虚构逐项成本。
3. 约定范围、不含事项、待核信息可依据proposal-builder组织；source原件及引用必须能追溯。没有客户文本时不预填“标准合同条款”。
4. 图纸/照片的尺度、数量、现场条件各自注明来源；读取不清或无尺度依据不能作为已经核实的尺寸或报价数量。
5. 后续执行交接按runbook检查缺口：谁操作、条件、怎样核对、失败找谁。现场技术阈值仍需合格专业来源；不随意生成安全数字。
6. 市场调研里的市场规模、价格与客户意向依然要原始证据；任何Skill都不是新的事实来源。

这份映射作为实施入口，不代表上述产品检查都已完成。用户的新要求已同步前端、商务面板执行者；正式接入前须回报具体引用哪项Skill、采纳什么、哪些规则不适用或仍待专业核对。
