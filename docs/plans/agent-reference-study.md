# Agent 开源参考与幕景接入记录

2026-10-07。用户明确要求学习 AIHOT、DeepSeek Harness 的开源代码并先推进 Agent。研究使用 agent-reach 的 GitHub CLI/Exa/Jina，实际读取固定提交的README、许可及下列源码。本轮不访问真实凭据或供应商，不安装外部Runtime、不发布、不修改冻结的EventOperations。

## 核验对象

| 项目 | 本次固定源码 | 许可与定位 |
| --- | --- | --- |
| [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT) | `8e34e05feb161cb5838e592ee22715f791c7f814`，提交日期2026-10-07；main | [MIT](https://github.com/KKKKhazix/AIHOT/blob/8e34e05feb161cb5838e592ee22715f791c7f814/LICENSE)，版权主体数字生命卡兹克。它是行业资讯采集、精选、发布和Agent读取接口的网站引擎，原站为aihot.news；不等同于Agent Harness |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，提交日期2026-10-03；master，0.2.1-alpha.1 | [MIT](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/LICENSE)，官网[Harness页](https://deepseek.com/harness/en/)直接链接该仓库，确认官方身份；README明确developer preview，接口可能破坏兼容 |

本机AI HOT技能的旧入口为aihot.virxact.com；本次开源引擎README指向aihot.news，不混用二者的API路径。Skill适用于资讯查询，本次只读取其接口背景，没有把用户请求改成AI日报。未采用同名桌面封装、awesome索引或其他作者仓库的接口说明。

若以后复制实质代码，保留对应版权和MIT许可；本轮仅借鉴机制并在幕景原实现上写校验，没有复制整套上游代码或引入依赖。AIHOT品牌/Logo不用于幕景。源码机制被读到，不代表上游运行性能、实际成本或远端模型能力已由本聊天验证。

## 已验证机制及适用位置

### AIHOT：同一业务内容，受控的模型和Agent读取

- [providers/llm.ts](https://github.com/KKKKhazix/AIHOT/blob/8e34e05feb161cb5838e592ee22715f791c7f814/packages/backend/src/providers/llm.ts) 的 ModelSpec/MODELS将模型地址、密钥、模型名、JSON/视觉能力及额外参数分开，具体任务传schema、purpose、subject、promptVersion。模型输出再按schema校验。幕景可在未来模型适配层借鉴；当前仍固定DeepSeek，不将自定义地址/部署混入本轮。
- [providers/receipts.ts](https://github.com/KKKKhazix/AIHOT/blob/8e34e05feb161cb5838e592ee22715f791c7f814/packages/backend/src/providers/receipts.ts) 在外部付费请求前持久记录attempt/逻辑身份，将明确拒绝、accepted、结果unknown分开，unknown不自动重发。幕景已有requestId、agent_runs和checkpoint，先保持终态重放不重复调用，再按真实需要补receipt；不能把所有HTTP非2xx都泛化为“供应商不会计费”，也不能把应用固定记账当实际账单。
- [routes/agent.ts](https://github.com/KKKKhazix/AIHOT/blob/8e34e05feb161cb5838e592ee22715f791c7f814/apps/api/src/routes/agent.ts) 的Markdown入口复用同一发布查询/渲染函数，与MCP能力共享内容；查询参数严格限定。幕景以后向Agent开放Scene/活动安排时同样复用业务真源，但私人项目要保留成员鉴权，不能照搬资讯站匿名接口。
- [README的行业流程](https://github.com/KKKKhazix/AIHOT/blob/8e34e05feb161cb5838e592ee22715f791c7f814/README.md) 将提示词和行业标准放在industry/prompts，人工改过的内容归属不被自动覆盖。适用到幕景的是“活动要求与事实来源清楚、人工确认不被模型覆盖”；本轮不建设新闻采集、两次评分或另一份活动需求系统。

### DeepSeek Harness：工具生命周期与权限边界

- [core/tools](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/tools/src/index.ts) 与 [agent-loop/tool-calls](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/agent-loop/src/tool-calls.ts) 将调用前guard、schema、dispatch、结果配对与收尾分开；guard只能增加拒绝，工具默认独占，明确安全后才并行。幕景保留现有注册表、逐项Zod/权限/租约检查，先保证模型回复中的调用ID可唯一配对，异常批次在副作用前拒绝。
- [llm-deepseek/config](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/llm/llm-deepseek/src/config.ts) 默认使用Messages协议、api.deepseek.com/anthropic与x-api-key，默认输出与重试上限显著大于幕景。不能把它当作当前chat/completions接口的直接替身；完整Runtime接入必须显式覆盖期限/输出/重试。
- [SDK协议](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/sdk/protocol/src/types.ts) 和 [server限制](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/sdk/server/README.md) 的stdio wire只有initialize、session/prompt、shutdown，prompt返回入队messageId，没有per-prompt cancel/session close。真正接Runtime需以有限工具composition和进程内cancel/dispose边界做桥接，才能对应幕景90秒任务与取消。
- [sdk-minimal](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/sdk-minimal/README.md) 默认持久shell/danger-full-access，[SAFETY](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/SAFETY.md)说明尚未经过安全审计。业务Agent首版不挂载shell、文件、插件安装、任意MCP或SQL；不让模型取得另一个能绕过项目权限的执行入口。

## 幕景当前真实边界

当前checkout的agent-runner.ts已经有8个域工具和最多6轮模型/工具往返，legacy模式才是一次JSON加一次修复。README第41行对默认源码的描述已过时；没有查询生产配置，因此不把源码模式说成线上已经切换。

模型接缝集中在runner的请求/响应处；工具实现继续使用现有readSceneResources、参数化模型、材质检查、BOM、buildProposal和候选提交。项目成员、选中范围、锁定、尺寸、租约、修订、run claim、取消与应用仍由程序及agent_rpc/scene_rpc控制，候选与场景应用分开。JEV始终预览，受控直接应用继续按已有用户指令判断。

当前Agent只处理其已有Scene范围，**活动安排仍是本地元数据，未因本次研究自动送往云端或模型**。未来读取活动安排、生成阶段任务建议，需要明确上下文/隐私与提案应用契约；不绕过当前本地资料保护。自部署、模型配置和钥管理仍按用户此前偏好列后续低优先级。

## 本轮已采用的真实增量

新增 [agent-model-reply.ts](../../supabase/functions/_shared/agent-model-reply.ts) 作为模型回复边界，统一返回content/toolCalls/finishReason/usage。模型的一条回复中，工具调用ID必须非空且唯一；先校验完整批次，再让 [agent-runner.ts](../../supabase/functions/_shared/agent-runner.ts) 派发任何域工具。身份按原字符串配对，不把工具ID误当UUID、不改参数文字，未知工具/参数仍由原注册schema和handler拒绝。

此前，重复ID的一条模型回复可以正常完成并执行参数化资产创建；空ID也可提交候选。两个新集成回归先在旧代码上失败，接入后验证run失败、资产数量不增、场景不变，同requestId终态重放不再次调用模型。错误码为AGENT_INVALID_MODEL_RESPONSE，错误详情只有固定路径和错误类别，不回显模型正文/参数/用量里的敏感内容。

这是采用Harness受控执行思想来增强幕景现有Agent，**不是已经安装或接上官方Harness Runtime**。当前模型端点/密钥接口、6轮上限、12个工具/回复、输出上限、候选修复、部分结果与取消语义保持原边界；没有增加供应商请求自动重试。回复边界负责本条消息的ID配对，下面的运行回执负责跨轮重放；两者都不保证跨进程副作用全局幂等或请求费用可以退款。

### 同一次运行内的工具回执

进一步确认跨轮次重复工具ID会重复建资产：create_parametric_model和customize_material原先每次派发都生成新requestId，已有资产接口按请求身份幂等，不能替runner辨认重复调用。借鉴AIHOT稳定请求身份与Harness未知副作用不自动重发的原则，在runner内使用原生Map记录已执行工具的ID、已校验canonical(name,args)及序列化回执，没有新增依赖或数据库。

相同ID及等价参数（包括schema默认值、JSON键顺序）返回原回执；改工具/参数返回AGENT_TOOL_CALL_CONFLICT，保留首回执。命中前仍执行取消、期限和租约检查，不重新登记资源、写checkpoint或消耗候选repair次数。执行失败也留回执，因为上传或数据库登记可能已成功、只是响应丢失；发生在执行前的JSON/schema参数错误不占用ID，允许模型修正。

这只约束当前run的同一工具ID。新操作/已执行调用的修正应使用新ID；不同ID可能代表不同操作，不按相同模型参数偷偷合并。跨worker恢复继续依赖现有终态围栏，未来若支持重启续跑，须复用稳定的持久请求身份。没有将一次未收到响应的资产标为失败清理或自动再建。

独立审查还发现候选提升顺序的关联风险：内存candidates原先先更新，随后才等待checkpoint；保存失败被回执阻止重发后，可能终结为complete但数据库没有候选。已改为checkpoint确认后才提升内存候选。两项故障注入先失败后通过：提交前失败得到failed/空候选，提交后响应丢失由原fail逻辑保留数据库有效候选并标记DATABASE_ERROR；都不再显示“方案已准备好”，同requestId终态重放不重跑。

实际验证：

- 首个回复边界增量四套共44项通过；随后工具回执及checkpoint确认增量新增10项，当前四套共54项通过。旧实现4项重放回归失败，随后2项checkpoint故障回归失败；均在对应修复后通过。覆盖等价参数重放、冲突不覆盖、参数修正、提交后响应丢失及取消/租约守卫。部分候选提交回归还验证了重放不重复checkpoint或消耗repair，随后新ID可提交完整三方案。
- 根类型检查通过；Edge三函数检查通过，新模块可被实际Edge入口加载。
- 供应商、Auth/Storage均为既有隔离替身/PGlite；没有读取真实密钥、调用真实模型、安装Harness/AIHOT、启动它们的服务、修改生产或提交发布。
- EventOperations冻结摘要仍为c2baae258c8c7f28f592a3cf03efbc94c73b908c47d8d160b313884b1d880831。

## 下一步最多三项

1. 完成活动安排已批准的前端回读，再定义只读活动上下文与任务建议提案；不复制CreativeBrief真源，不把建议自动标为现场完成。
2. 在同一模型接缝内增量支持用户选择的供应商/协议及显式模型配置，保持钥在服务端、token/期限与未知结果不重发；先用假供应商验证，真实调用另获明确授权。
3. 确认确需独立Runtime后，固定Harness提交并构建无shell的有限工具composition，映射取消/完成/释放；未完成这个桥接前继续如实称为幕景既有Agent增强。

相关证据：[回复边界测试](../../tests/agent-model-reply.test.ts)、[持久Agent回归](../../tests/agent-runs.test.ts)、[开发检查点](../DELIVERY-PROGRESS-2026-10-07.md)、[活动契约](event-operations-contract.md)。本记录供相关实现参考，不代替各自的接入验收。

## 检查点后的业务真源对齐

检查点d215af9已上传；本聊天读取远端完整Git tree，14个冻结后端文件的blob与验证版本全匹配。发布冻结解除后，继续采用AIHOT同一业务内容服务不同入口的原则，核Agent的get_bom与原交付采购分组：后者区分场景颜色，前者原来只按物料和尺寸合并。

最小后续修复是在已有Map键及回执中加入color，未增加业务接口/依赖或修改前端；同尺寸红/蓝椅子分开，同色仍合并数量2。工具说明明确GLB颜色是场景乘值，不能承诺供应商实物颜色；库存和报价仍未知。两项真实处理器/隔离数据库回归先失败后通过，同时证明输入取自未保存草稿且不修改云端原场景。当前四套Agent相关56项、根类型和Edge检查通过；该修复纳入工作区重构后的开发分支增量，没有真实模型调用。候选多样性规则及冻结共享契约保持原语义。
