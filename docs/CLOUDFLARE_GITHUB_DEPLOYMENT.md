# Cloudflare Pages 与 GitHub 自动部署

记录日期：2026-10-07（Asia/Seoul）。

## 当前连接

| 项目 | 值 |
| --- | --- |
| Cloudflare Account ID | `f0273e54d22c215389dd6065a802ddae` |
| Pages 项目 | `scendance-scene-planner` |
| GitHub 仓库 | `LiliLIN0324/Scendance2026` |
| 生产分支 | `main` |
| Pages 地址 | `https://scendance-scene-planner-ewz.pages.dev` |

Cloudflare Pages 已通过 GitHub 集成连接到仓库。推送到 `main` 会触发生产构建；推送到其他分支会触发预览构建并更新 GitHub PR 评论。

## 构建设置

| 设置 | 值 |
| --- | --- |
| Root directory | `/` |
| Build command | `npm ci && npm --prefix frontend ci && npm --prefix frontend run build` |
| Build output directory | `frontend/out` |
| Build caching | 启用 |
| Node.js | `NODE_VERSION=24.15.0` |

## 构建环境变量

生产和预览环境都配置了以下变量：

```dotenv
NODE_VERSION=24.15.0
NEXT_PUBLIC_SUPABASE_URL=https://wkhfvnzgopjdzxlmycks.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same publishable key>
NEXT_PUBLIC_GENERATION_ENABLED=false
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` 是兼容 `main` 旧代码的变量名，值与 publishable key 相同。两个 key 都是浏览器公开配置，但仍保存在 Cloudflare 的项目环境中，不写入仓库。`service_role`、`sb_secret_`、AI 供应商密钥和 worker secret 不得加入这些 `NEXT_PUBLIC_*` 变量。

## 验证

1. 在 GitHub 推送一个提交到 `main`。
2. 打开 Cloudflare 控制台中的 Pages 项目，确认出现新的 Production 部署。
3. 检查构建日志中的 `clone_repo`、`build` 和 `deploy` 阶段均为成功。
4. 访问 `https://scendance-scene-planner-ewz.pages.dev/`，确认页面正常。

Cloudflare 只构建和发布前端静态产物。Supabase 数据库迁移和 Edge Functions 仍按 [OWN_SUPABASE_TUTORIAL.md](OWN_SUPABASE_TUTORIAL.md) 单独部署。
