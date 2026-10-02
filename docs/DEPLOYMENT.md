# 本地运行、部署与恢复

## 1. 本地测试（不依赖 Docker）

```sh
npm ci
npm run check
npm run check:edge
npm run smoke:edge
```

依赖和 CLI 版本已锁定。`check` 会在临时 PGlite PostgreSQL 实例中运行全部迁移和业务测试，不修改已有项目或云端数据库。

可选执行免费公共素材实测：`npm run check:public-model`。它会通过真实网络读取 Poly Haven 目录和一个椅子模型，打包、校验、计算尺寸，仅输出统计，不调用付费服务或上传文件。

## 2. 完整 Supabase 本地服务（需要 Docker）

```sh
npx supabase start
npx supabase db push --local
npx supabase migration list --local
npx supabase db advisors --local --type security --fail-on warn
npx supabase db lint --local
```

本仓库已生成 `config.toml`：关闭开放注册和匿名登录，PostgreSQL17，业务 schema 不暴露。不要用 `db reset` 清理已有本地数据。

把根目录 `.env.example` 复制为 `.env.local`，填写 `supabase status` 提供的本地 URL/service role key，以及两个不同邮箱、至少12位独立密码、工作室 UUID。真实 Auth 用户初始化：

```sh
npm run demo:seed
```

脚本复用已有同邮箱用户，不重置密码；成员关系不同的已有工作室会拒绝覆盖。若账号创建成功而工作室失败，保留账号供重试，不擅自删除。该脚本默认仅接受 localhost；远端必须显式追加 `-- --remote`。

把 `supabase/functions/.env.example` 复制为 `.env.edge.local`，配置 CORS/应用地址以及需要启用的提供商。然后运行：

```sh
npx supabase functions serve --env-file .env.edge.local
```

Supabase 自动注入函数使用的 `SUPABASE_URL` 与 service role key；不要把根目录含账号密码的 `.env.local` 整体用作云端 secrets 文件。前端仍需单独接入 Supabase Auth 与本后端 API。

若本地未装定时任务，可在开发终端手动以 `Authorization: Bearer <GENERATION_WORKER_SECRET>` 对 `http://127.0.0.1:54321/functions/v1/generation-worker` 发 POST `{}`：首次提交任务，后续间隔至少30秒查询。不要把 worker 密钥交给浏览器。

## 3. 付费接口首次开通

本轮没有真实调用 DeepSeek/Hunyuan。配置前完成：

1. 在真实账号核对 DeepSeek `deepseek-flash` 可用性和价格；`AI_MAX_REQUEST_CENTS` 为一次请求的保守费用上界，包含最多两次调用、每次最多4096输出 tokens及场景输入。
2. 在腾讯当前入口开通并验证 `api.ai3d.cloud.tencent.com` 的 API key；适配器提交 `Model:3.0 / GenerateType:LowPoly / PolygonType:triangle`。新账号迁移到 TokenHub 后是否兼容当前接口，以实际账号测试为准。
3. 核对三维单任务最大积分与人民币上界后，填写 `GENERATION_MAX_TASK_CENTS`，记录生成资产适用条款 URL 与核对日期。不要用免费额度作硬依赖。
4. 填入独立随机 worker secret；可用 `openssl rand -hex 32` 生成。
5. 明确授权后提交一件物件，核对提供商任务记录/积分、Storage GLB、前端预览、加入、保存重开。通过后再批量演示。

应用数据库总预留上限为三维150元、文本30元；不自动释放失败/未知预留。不要未经核对调高额度。真实费用可能和预留不同，详见 BACKEND.md。

## 4. 云端部署（本轮未执行）

选定专用 Supabase 项目并确认允许部署后：

```sh
npx supabase login
npx supabase link --project-ref <明确选择的项目ref>
npx supabase db push --linked --dry-run --skip-vault
npx supabase db push --linked --skip-vault
npx supabase migration list --linked
npx supabase secrets set --env-file .env.edge.local
npx supabase functions deploy scene-api generation-worker --use-api
npx supabase db advisors --linked --type security --fail-on warn
```

第一次部署必须是专用项目，避免与已有业务 schema/桶冲突；先备份既有数据库。迁移新增 `scene_private`、3个服务端 RPC 和 `scene-assets` 私有桶。

在云端 Auth 配置中明确关闭开放注册、匿名登录，并配置正式站点地址。本地 config 不等于云端 Auth 设置已经同步。在 CORS 中仅设置实际前端 origin（逗号分隔），`PUBLIC_APP_URL` 设置正式站点，不带末尾路径。两个函数的 `verify_jwt=false` 已写入 config；业务 JWT 和 worker secret 在函数内部验证。

平台内建 SUPABASE_* 环境变量不需要重复设置。绝不能把 service role、worker secret、DeepSeek/Tencent key 放到 Cloudflare Pages 的公开前端环境变量中。

如需远端演示账号，在单独受控的 `.env.local` 中填入该专用项目并运行 `npm run demo:seed -- --remote`。这是实际创建账号/成员的操作，不是 dry run。

### 定时归档

通过 Supabase Vault 保存两项：

- `scene_project_url`：正式 Supabase URL（不带末尾斜杠）。
- `scene_worker_secret`：与 Edge 的 `GENERATION_WORKER_SECRET` 相同。

随后在数据库运行 `supabase/ops/install-generation-cron.sql`。该文件显式检查 Vault 项，每分钟调用 worker；含 `pg_cron/pg_net` 扩展开通操作，因此没有放进自动业务迁移。不要把密钥粘进版本库或 issue。

检查 `cron.job_run_details` 和 `net._http_response`：定时器存在并不能证明 worker 请求成功。任务在 submitting 状态超过4分钟会标记未知，其他可恢复阶段可重新认领。

## 5. 账务、未知任务与恢复

- `submit_unknown`：先在提供商控制台核对该用户描述、时间和请求记录。**禁止直接改回 queued**。确认已创建任务后，由管理员在一次数据库事务内绑定正确 `provider_job_id` 并改为 submitted，同时把 requests.state 改回 reserved；随后 worker 只查询既有任务。确认根本未创建且没有费用时，可改 failed 后由用户发起新的意图。
- 账单核对后按请求填写 `actual_cents`，保留 provider_usage；若要降低过高预留，必须在同一事务锁定对应 budgets 行并按差额调整 committed_cents，避免重复退款。默认不自动退款。
- `rejected`：模型超过体积/复杂度、格式/纹理不兼容或结构校验失败。不能标记 ready；保留原始提供商 ID，另行优化或选择其他素材。
- `archiving`：Storage/下载临时失败会保留任务，定时器再次查询获取当前临时地址。任务超过23小时仍无法恢复会标记失败，避免永久占位；失败不自动重新付费。
- Storage 上传后 DB 写入失败可能留下无引用对象；短期保留用于恢复，不做激进自动删除。清理前对照 assets 和所有 publications，演示期手工核对。
- 编辑冲突/离线：客户端保持未保存草稿，不自动覆盖服务器，不把超时显示为已保存。重获租约重新加载云端数据后由用户处理本地差异。

## 6. 回滚与正式验收

保留部署前数据库备份和 Edge 版本。函数回滚不能撤销数据库迁移、已发任务或已经签发/下载的文件。紧急停用付费任务时先停 cron 并禁用对应调用配置；不要删除未确认的任务记录。

部署后须实测：两个真实账号登录/交接、非成员隔离、同用户两个标签页、掉线/过期租约、人工编辑使 AI 提案失效、真实三维任务归档并保存重开、复制删除模型、手机分享查看与撤销、大陆普通网络耗时/帧率。当前没有这些云端或设备验收结果。
