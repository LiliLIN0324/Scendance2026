# Scendance 登录接入

目标项目：`hrsrrduwbqxnqddkexoy`。与 CharlesTech 的用户、密钥及邮件服务隔离。

## 页面与数据流

- `/introduction#scene` 的「进入场景」进入 `/auth?next=%2F`。
- `/auth` 提供邮箱密码登录、注册；密码至少 12 位。
- 注册邮件回到 `https://scendance.charlestech.org/auth/callback`。浏览器先移除 URL 中的令牌，再向 Supabase 验证身份。
- 邮箱确认时，数据库触发器为无工作室的账号创建一个私人工作室及 owner 成员。已有成员关系保持不变。
- 登录状态保存在当前标签页的 sessionStorage；刷新后向 Auth 验证或刷新令牌。退出清除会话。编辑租约 ID 不持久化。
- 场景入口要求登录，业务 API 继续通过 Supabase JWT 和服务端成员权限验证，前端跳转不替代后端鉴权。

## 已声明的生产配置

`supabase/ops/cloud-config.toml` 只更新注册开关和回调地址，保持邮箱确认开启。不要将 CharlesTech 的配置或凭据复制进此项目。

公开邮件注册还需要**独立 SMTP 服务**。Supabase 内置服务仅向项目组织团队成员发信，当前限每小时 2 封，不适合公开注册；OTP 和 magic link 同样受限。

官方说明：https://supabase.com/docs/guides/auth/auth-smtp

在本项目 Authentication → Email / SMTP 配置专用 host、port、user、password、sender email、sender name。凭据仅写入 Supabase 私密设置，不进入仓库或浏览器。

## 最小验收

1. `npm test -- tests/auth-signup.test.ts tests/database.test.ts`：确认时创建、幂等性、成员隔离和原有数据库契约。
2. 前端运行 `npm test -- lib/auth-session.test.ts lib/backend-session.test.ts components/room-organizer/panels/cloud-panel.react.test.tsx`，再运行 `npm run build`。
3. 线上从介绍页进入登录，登录后打开云项目，刷新恢复，退出后重新要求登录。
4. 独立 SMTP 配置完成后，用自有测试邮箱验证实际收信、确认链接和创建云项目。管理 API 生成的确认链接只验证认证流程，不能替代邮件送达验收。

前端 `npm run build` 自动打包介绍页及 showcase 资源，避免后续部署丢失该入口。

## 2026-10-02 上线记录

- 后端提交 `fc93013`，前端提交 `0e1b4f2`；均在专属 `codex/scendance-auth*` 分支，无 PR、无主分支合并。
- 生产前端：https://e782bbd8.scendance-scene-planner.pages.dev ，正式域名 https://scendance.charlestech.org 。
- `20261002140000_personal_studio` 已以事务方式执行并记录至迁移表；生产触发器存在。通过管理 API 执行是因为数据库直连不可达。
- 53 项相关测试通过，生产构建通过。实际浏览器已验证介绍页 → 登录、确认回调 → 编辑器、刷新恢复、退出、密码再次登录。
- 实际业务 API 已验证新确认账号有独立 owner 工作室，能创建项目，访问演示工作室返回 403。
- 确认链接由管理 API 为临时测试账号生成，**没有发送测试邮件，尚未验证邮件送达**。面向普通用户的邮件注册仍等待该项目独立 SMTP 配置。
- 介绍页与已有展示资源从前端仓库 `20dd37c` 保留，入口改为 `/auth?next=%2F`；以后随前端构建一并发布。
