# 提供商配置入口

目标项目：`hrsrrduwbqxnqddkexoy`。最新接口复核与发布归属见 [PLAN_API_RELEASE.md](PLAN_API_RELEASE.md)。用户已授权与图纸三维工作流统一发布，由统一发布任务记录实际部署版本。

## DeepSeek

沿用当前线上 `DEEPSEEK_API_KEY`、`AI_MAX_REQUEST_CENTS`、每日与累计额度。既有文字提案配置和历史调用边界见 [DEEPSEEK_DAILY_LIMIT.md](DEEPSEEK_DAILY_LIMIT.md)。不要为上线这组业务接口重置密钥、提高额度或推送旧 Auth 配置。

图纸重建使用独立 `reconstruction-worker`、`RECONSTRUCTION_WORKER_SECRET` 与请求预留配置，按图纸分支实际共享契约、迁移和服务部署说明接入；不能混用混元的 worker secret 或任务定时器。

## 腾讯混元

本次止于需要用户手工开通和创建密钥的步骤，未启用付费生成。完整可操作步骤、官方资料和费用边界见 [HUNYUAN_ACTIVATION.md](HUNYUAN_ACTIVATION.md)。当前 TokenHub 接口需要 API Key，不需要 SecretId/SecretKey。

已创建仅供本机填写的配置文件（权限 0600，Git 忽略）：

```text
/Users/lwc/.codex/worktrees/fc82/场景规划Agent产品开发/.env.hunyuan.local
```

仅填写 `HUNYUAN_API_MODE`、`HUNYUAN_API_KEY`、`GENERATION_MAX_TASK_CENTS`、`HUNYUAN_TERMS_URL` 与 `HUNYUAN_TERMS_REVIEWED_AT`；密钥不要贴到聊天或放进前端。填好后只提供文件路径和开通确认，再执行定向配置。

不要把历史 `.worktrees/deepseek-launch/.env.edge.local` 整包覆盖云端，也不要用空模板覆盖现有 `PUBLIC_APP_URL`、`ALLOWED_ORIGINS`、DeepSeek 和 worker secret。当前混元 cron 和前端 `NEXT_PUBLIC_GENERATION_ENABLED` 保持关闭；这不代表图纸识别/重建队列也停用。

## 凭据与预检边界

网页只包含 Supabase URL 和公开 anon/publishable key。service_role、提供商密钥和 worker secret 仅在后端。配置预检检查字段和费用范围，不会证明账号模型权限或真实生成效果。启用 worker 前核对未完成任务；提交未知任务不自动更换请求 ID 或切换提供商模式重发。
