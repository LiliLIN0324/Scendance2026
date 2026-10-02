# 完整项目交接 · 2026-10-02

本快照汇总已经开发和部署的前端、Supabase 后端、数据库迁移与文档，通过 PR 提交到 `version`。不包含本机密钥、构建产物或运行缓存。

## 当前入口

- 正式站点：https://scendance.charlestech.org/
- 介绍页：https://scendance.charlestech.org/introduction#scene
- 登录/注册：https://scendance.charlestech.org/auth
- Supabase 项目：`hrsrrduwbqxnqddkexoy`，与 CharlesTech 账号和密钥隔离。

## 可用范围与限制

场景工作台支持布置、本地保存、云项目、编辑租约及版本校验。AI 助理支持生成提案、预览与用户确认后应用，真实 DeepSeek 请求与保存已有生产验证。独立登录支持邮箱密码、确认回调、刷新恢复、退出及注册后私人工作室，已验证账号隔离。

公开注册邮件尚需本项目独立 SMTP。Supabase 默认发信只支持组织团队邮箱；当前验证使用管理 API 生成测试确认链接，没有验证实际邮件送达。第三方三维生成与客户分享不应视为已完成全部前端验收。

## 文档索引

| 内容 | 文档 |
| --- | --- |
| 前端启动、构建 | [前端 README](../frontend/README.md) |
| 后端入口 | [后端说明](BACKEND.md) |
| API 与共享协议 | [API](API.md)、[客户端](../client/scene-client.ts) |
| 生产部署 | [部署步骤](DEPLOYMENT.md)、[云端记录](CLOUD_DEPLOYMENT.md)、[Cloudflare](CLOUDFLARE_SETUP.md) |
| 登录、注册与邮件边界 | [登录接入](AUTH_SETUP.md) |
| AI 前端与服务端 | [AI 助理](AI_ASSISTANT.md)、[服务配置](AI_ASSISTANT_SETUP.md)、[提示词](AI_SYSTEM_PROMPT.md) |
| AI 配额与供应商 | [每日限制](DEEPSEEK_DAILY_LIMIT.md)、[供应商配置](PROVIDER_SETUP.md) |
| 验证记录 | [后端验证](VERIFICATION.md)、[前后端联调](INTEGRATION.md)、[首次上线](FIRST_LAUNCH.md) |

## 本地验证

使用 Node.js 24.15+，分别在根目录和 `frontend/` 执行 `npm ci`。

```sh
npm run typecheck
npm test
npm --prefix frontend run typecheck
npm --prefix frontend test -- lib/auth-session.test.ts lib/backend-session.test.ts lib/backend-integration.test.ts components/room-organizer/panels/cloud-panel.react.test.tsx
npm --prefix frontend run build
```

根目录包含完整后端迁移；不要再从其他工作树复制部署文件。生产配置模板为 `supabase/ops/cloud-config.toml`。凭据只进入本地忽略文件或托管平台的秘密配置。
