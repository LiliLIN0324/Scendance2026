# 对话接入收尾交接（2026-11-09，代码已进 PR #86）

本文件只记录对话接入这一轨。智能建造、区域协议和其它工作树不在范围内。

## 本轨已经做完

- 评论修复和密码恢复修复已提交到 `codex/production-conversation-api`，不再留在本机未提交补丁里。
- 库存中性提及不再否决同一句里明确的圆桌或课桌选择；同类否定和未定仍然否决。
- 「请先给建议，不要改场景」只作为只读边界：可以展示建议，并可以讨论其它 unknown，但不确认、不执行。混合删除/移动/发送、人数冲突和生成命令仍走原确认或拦截。
- 找回密码邮件的 `redirectTo` 改为 `/reset-password`。页面同时说明重置链接和六位验证码。
- recovery hash 落在根路径或旧 `/auth` 时进入设密页，不建立普通登录。没有 access/refresh 的 recovery hash 不会当成成功，也不会拿现有会话顶上。
- 仓库里的重定向白名单模板已补上各站点的 `/reset-password`。这只是文件，没有推到线上 Supabase。

## 明确还没做

- 没有重新部署 `conversation-api`。交接时线上仍是当时的 version 4，bundle 不含这次修复。
- 没有改 Cloudflare 生产变量，也没有用三项 `NEXT_PUBLIC_*` 开关重新构建正式前端。
- 没有做已登录正式页联测，不能说对话接口已在正式页接通。
- 没有合并 main，没有跑 SQL，没有动 `scene-api`。
- 没有改任何真实用户密码，也没有读取或打印 Key、token。

## 下一轨若继续上线

1. 先看本分支新 HEAD 的 CI。不要沿用旧提交 `58144611` 或 Preview `ab3f36e` 的绿灯。
2. 只重新部署本项目的 `conversation-api`。不要部署 `scene-api`，不要跑迁移。
3. 把 `supabase/ops/cloud-config.toml` 里新增的 `/reset-password` 白名单应用到线上 Auth，并核对正式站允许该精确地址。应用前先看差异。不要把整份本地 `config.toml` 推上去。
4. 正式前端重新构建时打开 `NEXT_PUBLIC_AGENT_ENABLED=1`、`NEXT_PUBLIC_CONVERSATION_API_ENABLED=1`、`NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED=1`。这三项是编译期变量。保留现有 Supabase URL 和其它 Cloudflare 变量。
5. 用已登录正式会话和虚构内容核对请求走 `conversation-api`、建议不改场景、库存与待定语义正确。不要从浏览器抄 session token。设新密码由用户自己完成。
6. 用户已授权合 main，但要在新 HEAD 检查和正式页联测之后再合。合完核对生产部署 SHA。
7. 不要把工具生成、真实库存或现场安全说成已经完成。不要动 `intelligent-baseline` 等其它工作树。
