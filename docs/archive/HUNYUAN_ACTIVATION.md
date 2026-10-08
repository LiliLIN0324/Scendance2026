# Scendance 混元 3D 接入与启用

> 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 [README](../../README.md)，当前部署见 [自有 Supabase 部署](../OWN_SUPABASE_TUTORIAL.md)。

目标网站：<https://scendance.charlestech.org/>。专用 Supabase 项目：`hrsrrduwbqxnqddkexoy`。核对日期：2026-10-03。

## 已完成的接口与界面

物料库增加「生成单件 3D 模型」：明确点击才提交，读取已有任务并每 30 秒查询活跃状态。刷新后通过服务端列表恢复任务；请求响应未知时，在当前浏览器标签页保存请求 ID 与描述，手动继续始终使用同一个 ID，不自动重复生成。供应商 `submit_unknown` 状态需要管理员核对，不会自动重试。

接口沿用现有契约：`POST /jobs` 创建任务，`GET /jobs` 读取任务列表，`POST /assets/:id/url` 获取私有模型短期授权。准备好的模型下载成功后才能加入场地，使用真实 `assetId` 与 `source=generated`；尺寸由用户按实际物料设定。切换账号、项目或失去编辑权后，迟到的模型下载不会加入新的画布。云端已保存的场景包含该资产时，才调用 `POST /jobs/:id/added` 标记已保存。

已部署的 generation-worker 源码实际包含 TokenHub Bearer 鉴权及 `hy-3d-3.0 / LowPoly / triangle` 参数；无需用本分支旧版 scene-api 覆盖云端 v7，也不需要替换已部署的 reconstruction-worker。

## 账号与云端检查结果

- TokenHub HY-3D-3.0 默认接入点为 ACTIVE。
- 已领取免费体验额度 100 积分，查询时已用 0，后付费关闭。
- 已创建 `scendance-3d` 专用普通 TokenHub Key，只授权 `hy-3d-3.0` 默认接入点；服务端使用该 Key。
- Supabase 生成队列为空，三维累计预留为 0 / 15000 分。
- `scene-generation-poll` 每分钟运行一次；配置与空队列核对后已启用。
- 云端五项混元配置已上传，逐项摘要与本机配置一致。API mode 为 tokenhub，单次保守预留为 720 分；条款采用腾讯大模型服务条款，复核记录为用户本次确认日 2026-10-03。

上述是查询时的快照，启用前必须重新读取。免费额度是积分，不是生成次数；Key tokens 限额不能作为 3D 积分或人民币账单硬上限。

## 配置文件与预检

本机独立 checkout：`/Users/sandra/Documents/ChatGPT/国庆黑客松/scendance-hunyuan`，基于生产 main 提交 `edc5341f475e79ee949059f4d45519441912f80f`。配置文件 `.env.hunyuan.local` 已创建为 0600 并由 Git 忽略。

在本机填写这五项，不加入其他服务配置：

```dotenv
HUNYUAN_API_MODE=tokenhub
HUNYUAN_API_KEY=
GENERATION_MAX_TASK_CENTS=
HUNYUAN_TERMS_URL=
HUNYUAN_TERMS_REVIEWED_AT=
```

Key 仅在本机填写，禁止发到聊天、截图、前端环境变量或 Git。普通 TokenHub Key 不需要 SecretId/SecretKey。费用是用户账号核对后的保守单次上界，单位为人民币分；条款日期是真实阅读日期。

公开价格为 15–60 积分/次、0.12 元/积分（1.8–7.2 元/次）。本次用户已确认完成价格与条款核对，并授权助手自行配置；采用 720 分保守预留。[官方价格](https://cloud.tencent.com/document/product/1823/130055)

```sh
npm run check:config:hunyuan -- .env.hunyuan.local
```

专门预检只读取这份独立文件，检查权限、字段、费用和日期，不输出密钥、不调用提供商，也不修改云端。全配置预检默认不读取这份文件。

## 云端启用顺序

1. 用户保存完整配置；助手进行不回显值的预检。
2. 只读检查 `scene_private.generation_jobs` 与 cron；存在未完成或结果未知的任务时，先核对，不切换 API mode，不创建新供应商任务 ID。
3. 只上传五项混元设置，保留 DeepSeek、worker secret、CORS 和 Supabase 内建配置：

   ```sh
   ./node_modules/.bin/supabase secrets set --project-ref hrsrrduwbqxnqddkexoy --env-file .env.hunyuan.local
   ```

4. 核对云端 secrets 摘要与本机文件一致，重新核对任务队列后启用现有定时器。空队列不会创建生成；已有排队任务会开始使用提供商额度，因此不能只根据旧快照启用。
5. 前端改动经审阅后发布到 main 对应的 Cloudflare 站点。公开 Supabase 配置需在构建时注入；本地 `.env.local` 不上传。
6. 用户在网站明确发起一件物料的生成后，核对提供商记录、私有 GLB、场地预览、云端保存和刷新重开。未完成这些实际步骤前，不将模拟响应测试或本地构建记为真实生成成功。

不自动充值、开启后付费、购买套餐或提交测试生成。

## 本次验证边界

Node 24.19.0 下前后端类型检查通过；供应商/队列/worker HTTP 测试 35 项，独立混元配置预检测试 11 项，生成界面与客户端契约测试 40 项通过。配置预检测试覆盖密钥不回显、拒绝其他服务字段和共享可读配置文件，以及错误费用/条款日期。前端生产静态构建通过。

这些结果证明本地代码与受控接口响应通过验证，不证明真实生成、实际计费或线上界面已发布。生成入口当前仅支持文字生成单件物料，不支持从场地照片直接生成完整场景。

## 生产分支整合修正（2026-10-03）

PR #11 的代码来自 Git main，但发布前实际生产是尚未合入 main 的 `codex/floorplan-safe-release`（生产代码 `0644c75`、发布报告 `54475ef`）。合并 #11 后触发自动发布，曾暂时退回 v0.4.1 界面。修复将已经公开且已经发布的 v0.6.0 分支整体合入，同时保留本次混元入口、现有场景物料容量规则和五项云端配置。不重部署 Edge Function、不回滚数据库或已有场景。

用户已明确授权合并上线，并在所有配置完成后验收一次 HY-3D-3.0；仅使用现有免费积分，后付费保持关闭。此记录不代表真实生成已完成。
