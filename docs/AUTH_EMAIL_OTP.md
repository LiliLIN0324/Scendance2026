# 邮件注册与六位验证码找回密码

目标项目：`hrsrrduwbqxnqddkexoy`。前端基于用户确认的 `codex/complete-project-version`（`356e06d`），本次分支为 `codex/auth-email-otp`。

## 已准备的流程

- `/auth`：邮箱密码注册 → 邮箱六位验证码 → 自动登录 → 已有数据库触发器创建个人工作室；支持重新发送、修改邮箱和输入已有验证码。
- `/reset-password`：请求恢复邮件 → 验证六位码 → 输入两次新密码（至少 12 位）→ 尝试撤销全部刷新会话 → 返回登录。
- 恢复令牌只保存在内存中，不能作为编辑器登录，也不会进入 sessionStorage。页面刷新后需要重新发码。原有邮件链接仍可通过 `/auth/callback` 识别 recovery 类型并进入改密页。
- 未注册邮箱得到相同的恢复请求提示；不会用返回文案查询账号是否存在。重复注册时也不依赖 Supabase 隐藏用户信息的成功响应判断账号存在性。
- 前端重发倒计时 60 秒；实际防刷和过期时间由 Supabase 强制执行。全局退出失败时单独提示，不把已成功的密码修改报告成失败。已签发 access token 仍可能有效至到期。

## 云端需人工保存的设置

Resend 域名验证与受限密钥已建立，用户报告已保存 SMTP。尚未用真实收信测试确认投递。

认证管理页面被浏览器工具安全检查拒绝访问，因此本任务不会改用其他工具或 API 绕过。以下设置需用户在 Dashboard 保存，仓库配置不是云端已生效的证据。

先发布含验证码表单的前端，再切换云端模板。否则用户收到验证码后没有可输入的页面。

1. Authentication → Emails → Templates：

| 模板 | Subject | Body 文件 |
|---|---|---|
| Confirm signup | 幕景 Scendance · 确认注册验证码 | `supabase/templates/confirmation.html` |
| Reset password | 幕景 Scendance · 重置密码验证码 | `supabase/templates/recovery.html` |
| Password changed（开启） | 幕景 Scendance · 密码已更新 | `supabase/templates/password_changed.html` |

2. Sign In / Providers → Email：邮箱确认开启；Email OTP length = `6`，Email OTP expiration = `600` 秒。
3. Allow new users to sign up = 开启；不启用匿名登录。
4. Rate Limits：Emails = `30`/小时；SMTP Minimum interval per user = `60` 秒。Resend 免费套餐另有每日/月度额度，不等于无限发送。
5. URL Configuration：Site URL = `https://scendance.charlestech.org`，保留精确回调 `https://scendance.charlestech.org/auth/callback`。代码复用这个已允许的回调处理旧模板，不需要通配符。

邮件中的链接只指向普通页面，不带一次性 token，邮箱安全扫描不会自动消耗验证码。不要开启点击跟踪。

## 测试和发布状态

本地验证：52 项相关前端测试通过（其中新增 13 项验证码与页面流程测试），后端 111 项测试通过，包括确认后创建私人工作室和隔离。Node 24.19.0 下 TypeScript、相关文件 ESLint、生产静态构建和 `git diff --check` 通过。浏览器已检查实际静态导出的 `/auth` 和 `/reset-password` 表单；没有把模拟请求当作真实收信。

公开 `/auth/v1/settings` 实测 HTTP 200：email=true、disable_signup=false、mailer_autoconfirm=false。只使用公开 anon key，没有访问认证管理 API。

待完成：部署、云端模板保存以及真实邮箱注册/找回验收。真实邮箱由用户提供并授权测试，地址与测试密码不写入仓库。

发布前生产回滚点：Pages `e782bbd8-dc49-4899-b84e-e070c6f5cad1`，前端源 `0e1b4f2`，URL `https://e782bbd8.scendance-scene-planner.pages.dev`。

测试应覆盖：验证码无效/过期、前导零、60 秒重发限制、重复密码、普通登录不能直接进入恢复改密、验证码验证与退出的竞态、恢复后新密码登录/旧密码失效、个人工作室隔离。模拟请求、数据库测试、服务商 delivered 状态与用户收件箱实收分别记录，不互相替代。

参考：[Supabase 邮件模板](https://supabase.com/docs/guides/auth/auth-email-templates)、[密码认证](https://supabase.com/docs/guides/auth/passwords)、[Resend SMTP](https://resend.com/docs/send-with-supabase-smtp)。
