# 场景规划 Agent 后端

按用户提供的 `PLAN.md` v0.2 实现。后端使用 **Supabase Auth / PostgreSQL / 私有 Storage / Edge Functions**，面向活动工作室的项目保存、轮流编辑、AI 提案、三维生成、公共模型导入和客户发布。

这是后端文件。仓库现有前端保持不变；本次未进行前后端接入、云端部署或付费 API 调用。

## 开始

需要 Node.js 24；依赖固定在 `package-lock.json`。无需 Docker 即可运行业务测试：

```sh
npm ci
npm run check
npm run check:edge
npm run smoke:edge
```

`npm run check` 用 PGlite 的真实 PostgreSQL 引擎执行迁移、事务、角色授权、权限和 HTTP 契约测试；它不能替代完整 Supabase Auth/Storage/PostgREST 的联调和多连接并发验收。

完整本地服务需要 Docker：按 [部署说明](docs/DEPLOYMENT.md) 启动 Supabase，再配置真实本地 Auth 账号。付费接口未配置时返回 `503`，不伪造生成结果。

## 开发交接

- [后端设计与数据规则](docs/BACKEND.md)
- [HTTP API、场景格式与前端接入](docs/API.md)
- [本地运行、云端部署与故障恢复](docs/DEPLOYMENT.md)
- [验证记录与剩余验收](docs/VERIFICATION.md)
- [完整 AI 系统提示词](docs/AI_SYSTEM_PROMPT.md)
- [前端请求与旧提案保护辅助代码](client/scene-client.ts)

## 目录

```text
supabase/migrations/                数据表、事务 RPC、Storage 桶、演示初始化
supabase/functions/scene-api/       用户业务与匿名分享 API
supabase/functions/generation-worker/  异步生成提交、查询与归档
supabase/functions/_shared/         契约、AI、提供商、模型校验
supabase/ops/                       部署后手动启用的定时任务
scripts/                           演示账号初始化、Deno 冒烟、公共模型实测
tests/                             数据库、HTTP、领域、生成和模型测试
```
