# Project memory

## 「合到 main」= 提交 + 推送（2026-11-20 用户明确要求）

用户说「合到 main」就是授权**提交并推送到 `origin/main`**，
不要停在本地 commit 再等他补一句「push」。他不接受事后追问「要不要推」。

- 范围仍按仓库规范：不 `git add -A`；只提交任务点名的文件/hunk，别路未完成的改动留在工作副本；
  同一文件混着他人的未完成改动时，只暂存自己的 hunk（`git diff` 取 hunk → `git apply --cached`）。
- 推送被拒（non-fast-forward）时：先 `git fetch` 看清分叉，不要强推、不要用 `--force-with-lease` 绕过；
  无冲突则合并远端后重推，有冲突或远端改了同一批文件就停下来报告。

## 本机开发免登录（2026-11-16 用户明确要求）

用户不想再手填登录卡。凭据由用户在
`.env.local` 里维护，**不要向他索要账号密码，也不要再让他手动登录本机环境**。

- 账号键名：`local_account_id` / `local_account_pw`（本机 Supabase 栈用）、
  `Account_id` / `Account_pw`（云端项目用），另有 `NEXT_PUBLIC_DEMO_*` 作后备。
- 注入：`frontend/next.config.mjs` 的 `localAutoLoginEnv()` 只在
  `NODE_ENV === 'development'` 时把候选账号注入 `NEXT_PUBLIC_SCENDANCE_LOCAL_LOGIN`，
  `next build`（GitHub Pages 静态导出）里没有这段，线上不会自动登录。
- 行为：`frontend/lib/local-auto-login.ts` + `frontend/lib/backend-session.ts`
  的 `localAutoSignIn()`——仅在 `localhost` / `127.0.0.1` 且没有存档会话时代登；
  云端后端时跳过 `local_account_*`（避免一次必然失败的 400）；成功邮箱记在
  localStorage，全候选失败冷却 5 分钟。
- 验收口径：全新浏览器上下文打开 `http://localhost:3000/`，无 `#sc-auth-email`、
  无 `dialog[open]`、cookie 出现 `sb-…-auth-token`、控制台 0 条 400。
- 本机验收/开发端口用 **3000**（Supabase CORS 白名单只放行 3000/3210/3211，3026 会被 403）。
