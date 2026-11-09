# 正式站独立对话接口接入

## 已验证

- 使用本机原有百炼加密 Key，向北京标准接口发送一次虚构连接检查。`qwen3.8-max` 返回 HTTP 200、有效回复，19 tokens。这证明 Key 与该模型当前可用，不证明活动理解或工具闭环质量。
- `conversation-api` v1 已独立部署到现有 Supabase 项目。未覆盖 `scene-api`（仍为 v22），未运行数据库迁移。
- 已部署入口在未携带登录凭据时返回 401；正式 Pages 域名的 OPTIONS 返回 204，允许该域名和 POST/OPTIONS。
- 后端定向 45 项、前端相关 102 项、根和前端类型检查通过；启用对话编译开关的前端构建通过。独立复核另外覆盖了窄路由及账号切换。

## 当前阻塞

Supabase Secrets 写入实际返回当前账号没有所需权限。官方要求生产 Secrets 由 Owner 或 Administrator 修改；能部署函数不等于能修改 Secrets。此前自动审批另拒绝了本机解密后批量写云端密钥的命令，没有详细理由；没有重试或绕过该密钥写入命令。

管理员在项目 Edge Functions → Secrets 新增以下变量；密钥只填后台，不发聊天、不写仓库。

| 名称 | 值 |
| --- | --- |
| BAILIAN_PRODUCT_BASE_URL | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| BAILIAN_PRODUCT_MODEL | qwen3.8-max |
| BAILIAN_PRODUCT_KEY | 管理员安全输入的百炼普通 API Key |
| CONVERSATION_API_ENABLED | 1 |

旧 AGENT_CHAT_*、DEEPSEEK_* 和其他服务变量不修改。新 handler 内部启用对话与百炼 purpose=brief，保留 BRIEF_REQUEST_GUARD 原行为。

## 启用顺序

1. 配置上述变量后，用已登录的真实应用会话测试虚构需求；核对响应来自新接口、需求提取及中文回复通过校验。不得用未登录的 401 代替真实模型验证。
2. 合入前端路由代码，保持现有场景请求在 scene-api。
3. 为生产前端设置 NEXT_PUBLIC_AGENT_ENABLED=1、NEXT_PUBLIC_CONVERSATION_API_ENABLED=1、NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED=1，并重新构建。NEXT_PUBLIC_* 在构建时生效，不能只改运行时。
4. 验证对话、需求更正、退出与切账号、故障提示；明确方案生成和真实库存仍是独立验收项。

## 回退

关闭 CONVERSATION_API_ENABLED 会使新接口在认证/CORS后明确返回503，不会调用模型。关闭前端新增开关并重新构建可恢复旧路由。此接入不修改场景数据或数据库结构。

官方依据：https://supabase.com/docs/guides/functions/secrets#production-secrets
