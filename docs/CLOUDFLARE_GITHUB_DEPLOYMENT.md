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
| 自定义域名 | `https://scendance.lilicoding.space` |

`scendance-scene-planner.pages.dev` 与 `scendance.charlestech.org` **不属于本项目**：它们指向另一个 Cloudflare 账号下的同名 Pages 项目，连的是旧 Supabase 项目。本项目实际使用的地址是上表中的 `-ewz.pages.dev` 与自定义域名。

Cloudflare Pages 已通过 GitHub 集成连接到仓库。推送到 `main` 会触发生产构建；推送到其他分支会触发预览构建并更新 GitHub PR 评论。

## 构建设置

| 设置 | 值 |
| --- | --- |
| Root directory | `/` |
| Build command | `npm ci && npm --prefix frontend ci && NEXT_PUBLIC_SUPABASE_URL=<url> NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key> NEXT_PUBLIC_GENERATION_ENABLED=false npm --prefix frontend run build` |
| Build output directory | `frontend/out` |
| Build caching | 关闭 |
| Node.js | 由仓库中的 `.nvmrc`（根目录与 `frontend/` 各一份）固定为 `24.15.0` |

`Root directory` 必须是仓库根目录 `/`：`frontend/lib/backend-session.ts` 会 import 仓库根目录下的 `supabase/functions/_shared/*`，那些文件解析依赖时要找**仓库根目录的 `node_modules`**。若把 root directory 改成 `frontend`，根目录依赖不会被安装，构建会在 `Can't resolve 'zod'` 处失败。

`NEXT_PUBLIC_*` 必须写进 Build command：本项目实测构建镜像不会把 Pages 项目里的环境变量注入构建过程（`NODE_VERSION=24.15.0` 已配置但构建仍使用默认的 Node 22.16.0，日志行为 `Detected the following tools from environment: nodejs@22.16.0`），因此 Node 版本改用 `.nvmrc` 文件、Supabase 公开配置改在 Build command 中内联。这些值都是浏览器公开配置；`service_role`、`sb_secret_`、AI 供应商密钥和 worker secret 不得内联在这里。

`npm ci` 由构建镜像自带的 npm 10 执行，因此 `package-lock.json` 必须与 npm 10 兼容。依赖变动后重新生成锁文件：

```sh
npx npm@10 install --package-lock-only        # 仓库根目录
npx npm@10 install --package-lock-only --prefix frontend
```

仅用 npm 11 生成的锁文件可能缺少 npm 10 要求的可选依赖条目，导致构建报 `npm error Missing: @emnapi/... from lock file`。

## 构建环境变量

Pages 项目里仍保留以下变量（供预览/生产的环境面板与运行时使用），但**构建时以 Build command 中内联的值为准**：

```dotenv
NODE_VERSION=24.15.0
NEXT_PUBLIC_SUPABASE_URL=https://wkhfvnzgopjdzxlmycks.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same publishable key>
NEXT_PUBLIC_GENERATION_ENABLED=false
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` 是兼容 `main` 旧代码的变量名，值与 publishable key 相同。两个 key 都是浏览器公开配置，但仍保存在 Cloudflare 的项目环境中，不写入仓库。

## 自定义域名 `scendance.lilicoding.space`

`lilicoding.space` 的 zone 与本 Pages 项目在同一个 Cloudflare 账号，因此域名直接挂在项目上，由 Cloudflare 自动签发证书（CA 为 Google）：

| 设置 | 值 |
| --- | --- |
| 项目 → Custom domains | `scendance.lilicoding.space`（status/verification/validation 均为 `active`） |
| DNS | `CNAME scendance` → `scendance-scene-planner-ewz.pages.dev`，代理开启 |
| 目标后缀 | 必须带 `-ewz`。不带后缀的 `scendance-scene-planner.pages.dev` 属于另一个账号 |

**Worker 路由会抢占子域。** 该 zone 里存在一条通配路由 `*.lilicoding.space/*`（脚本 `minigame`），它会拦截所有子域，使请求在到达 Pages 之前就被 Worker 处理掉，对外表现为访问域名返回 `200` 且正文只有 `disabled`（`Content-Type: text/plain`），而 DNS、证书、域名状态全部正常。排查时不要被这些「正常」指标误导。

解决办法是在该域名上放一条脚本为空的更具体路由，让请求绕过 Worker；`minigame` 通配路由本身不需要改动：

```sh
# 列出当前路由
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" -H "Authorization: Bearer $CF_TOKEN"
# 为具体主机名建一条无脚本路由（script 为空 = 该主机不经过任何 Worker）
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' \
  --data '{"pattern":"scendance.lilicoding.space/*","script":null}'
```

用 API token 操作时注意权限是分开的：`pages:write` 能加自定义域，但改 DNS 需要 `Zone → DNS → Edit`，改 Worker 路由需要 `Workers Routes → Edit`。

## 验证

1. 在 GitHub 推送一个提交到 `main`。
2. 打开 Cloudflare 控制台中的 Pages 项目，确认出现新的 Production 部署。
3. 检查构建日志中的 `clone_repo`、`build` 和 `deploy` 阶段均为成功。
4. 访问 `https://scendance-scene-planner-ewz.pages.dev/` 与 `https://scendance.lilicoding.space/`，确认页面正常。若自定义域名只返回正文 `disabled`，见上一节的 Worker 路由说明。

Cloudflare 只构建和发布前端静态产物。Supabase 数据库迁移和 Edge Functions 仍按 [OWN_SUPABASE_TUTORIAL.md](OWN_SUPABASE_TUTORIAL.md) 单独部署。
