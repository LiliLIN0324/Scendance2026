# 登录页访客入口发布

> 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 [README](../../README.md)，当前部署见 [自有 Supabase 部署](../OWN_SUPABASE_TUTORIAL.md)。

日期：2026-10-03（America/Chicago）。

## 行为

登录页新增「访客进入」，通过现有 Supabase 匿名登录建立独立真实身份，再按安全的 next 参数进入工作台。沿用普通用户的业务权限与服务配置；项目、素材仍由服务端按用户与工作室隔离。没有共享账号、硬编码密码或绕过鉴权。

访客身份在默认开放工作台整合版本中增加了此浏览器的持久恢复：关闭标签页后可恢复同一匿名身份和自己的项目；普通账号仍沿用原有会话机制。退出或清除浏览器数据后无法通过邮箱找回该匿名身份。登录页与账户面板显示「访客」。原本地体验入口保留。首次 Agent 使用复用同一匿名登录方法和已有工作室准备逻辑。

下列为独立访客入口的历史发布记录。后续整合发布与验收见 `OPEN_WORKBENCH_RELEASE.md`，访客入口已包含在默认开放工作台版本中。

## 发布

- 专属分支：`codex/guest-login-entry`。
- 功能提交：`1b5fc5b`；最终发布源码：`d93285f`。
- 正式地址：https://scendance.charlestech.org/auth
- 最终生产部署：`52acab6a-436f-4474-98f4-83dfa71ea4c5`。
- 固定部署：https://52acab6a.scendance-scene-planner.pages.dev
- 回滚点：`cf03e33d-ddba-4af8-96ec-d802b47000fd`（源码 `61601b2`）。

第一次上传 `54ede35e` 被并行任务的 `cf03e33d` 覆盖。核实后将新增的预设说明与云保存状态修复整合到本分支，重新构建发布，保留了两个任务的改动。没有合并 Git main/dev；Pages 的 `--branch main` 只用于选择生产环境。

## 验证

- 前端完整 132 个测试文件、1708 项测试通过；沙箱内两项涉及 HTTP 监听的测试受限，使用正常权限重跑后全部通过。
- TypeScript、生产构建、git diff 检查通过。整合最新线上修复后，再次通过相关 38 项测试与生产构建。
- 构建保留已有 `scene-preview.tsx` import/order 警告与静态导出 rewrites 提示。
- 正式域名可见访客入口，15 个登录页脚本与最终构建的 SHA-256 一致。
- 真实浏览器点击访客进入成功导航到工作台，Supabase 返回 `is_anonymous=true`。
- 访客创建自己的测试工作室/项目、获取租约、保存版本 1、释放租约、重读 warm 灯光均成功。
- 页面刷新后恢复同一访客身份。第二个独立浏览器上下文取得不同身份，项目列表为空，读取第一位访客的项目返回 404。
- 测试项目与工作室在验收后清理；未修改既有用户数据。

本次未更改数据库、Edge Functions、供应商密钥或 AI 额度；没有调用付费 AI。混元在本次改动前已停用，真实 capabilities 仍为 textToModel/imageToModel/texture=false，本次没有恢复。访客和普通账号沿用相同可用功能，这不代表混元已恢复。

参考：[Supabase 匿名身份](https://supabase.com/docs/guides/auth/auth-anonymous)、[Cloudflare 直接上传](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)。本地截图和非敏感部署核验位于忽略目录 `output/playwright/guest-entry/`。
