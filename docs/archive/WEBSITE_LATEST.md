# WEBSITE-LATEST 线上源码快照

> 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 [README](../../README.md)，当前部署见 [自有 Supabase 部署](../OWN_SUPABASE_TUTORIAL.md)。

核验日期：2026-10-03。工作分支：`codex/website-latest`。交付目录：`/Users/lwc/Documents/ChatGPT/场景规划Agent产品开发/WEBSITE-LATEST/`。

## 来源与整理范围

- 前端：Cloudflare Pages 生产部署 `8153b386-93b5-45b8-9904-b6caf94472df`，源码提交 `b554910af8a818c08fd440c7787f8eadebc315e8`。定稿前重新查询，生产仍指向此提交。
- 后端：Supabase 项目 `hrsrrduwbqxnqddkexoy`，scene-api v15、generation-worker v6、reconstruction-worker v2。查询前后版本和平台部署标识一致。
- 补入已部署提交 `f77aa2a` 和 `548c48d`，保留原变更的测试和提示词文档；未添加新的产品行为。
- 线上迁移历史共 16 份。恢复前端发布分支缺失的 `20261003133000_studio_project_visibility.sql` 和 `20261003140000_empty_studio_deletion.sql`，并包含已部署的不限额度迁移。全部本地迁移与远端保存的 SQL 在忽略首尾空白后匹配。
- README 改为描述实际线上快照、当前能力和边界、运行与配置方法、发布面和验证范围。模板发布文档补入已有线上部署记录。
- 这不是数据库业务数据备份，不包含用户私有模型、登录会话或服务端密钥。

## 验证

1. 前端产品源码、静态资源、模板及打包脚本相对 `b554910` 无变更。
2. 正式域名 38 项 JS/CSS、模板与目录资源 SHA-256 匹配保留的原发布构建。`/`、`/introduction`、`/reset-password` 返回 200，移除 Cloudflare 注入的挑战脚本后与原构建匹配。这是抽查，不宣称逐个重新请求全部静态文件。
3. 下载的 scene-api 15 个源文件均匹配当前快照。generation-worker 的 16 个下载源文件中，`ai.ts`、`scene-resources.ts` 保留了它独立发布时的旧版本；其余 14 个匹配。reconstruction-worker 的 10 个函数文件均匹配。
4. CLI 下载 scene-api 与 generation-worker 时拒绝向 `supabase/functions` 以外提取资源库 JSON，因此上述源文件比较不是全部依赖的完整提取证明。原始 body 导出请求超时，未交付原始部署包；本地归档仅包含成功下载的函数源文件与平台版本、部署标识，不宣称能够逐字节重建原始部署包。
5. 后端类型检查通过；212 项测试通过。初始沙箱运行中 210 项通过，2 项因回环监听权限失败，允许本地监听后定向复跑两项均通过。
6. 前端生产构建通过，含类型及 lint 检查；保留既有 `scene-preview.tsx` 的一项 import-order 提示及静态导出 rewrite 提示。场景模板的两份定向测试共 15 项通过；本次未重跑整个前端交互测试集，未进行付费 AI 或 HY3 生成测试。

详细版本、源文件和资源哈希见 [website-latest.json](../evidence/website-latest.json)。

## 本地交付与 Git

- Git 克隆包含源码、模型及模板、锁文件、迁移和文档。
- 本地 `frontend/out/` 额外保存抽查匹配的原发布构建，未加入 Git。
- 本地 `production-snapshot/edge/` 保存三个函数成功下载的源码与各自版本、平台部署标识，未加入 Git。共享源码随各函数独立发布而不同，不能将整个当前源码再次部署视为不改变现有运行内容。
- 原发布构建可由 Wrangler Pages 本地预览；后续从远端重新克隆时需依 README 构建。
- 本次只推送专用分支并创建 PR，不合并 main，不重新部署 Pages、Edge 或数据库。
