# DeepSeek 与混元 3D 配置指南

DeepSeek 已按本次用户要求配置，当前维护目录为 `.worktrees/deepseek-launch`；每日 10 元限额与验证状态见 [专项记录](DEEPSEEK_DAILY_LIMIT.md)。下文腾讯配置仍待提供凭据。

本指南用于工作区根目录后端，目标 Supabase 项目为 `hrsrrduwbqxnqddkexoy`。官方接口和价格核验日期：2026-10-02；最终费用以你实际账号的控制台和账单为准。

根目录 `.env.edge.local` 已生成，文件权限为 `0600`，包含独立的 `GENERATION_WORKER_SECRET`、`PUBLIC_APP_URL=https://scendance.charlestech.org` 和 CORS 配置。**在原文件中填写供应商字段，保留这些已有值，不要用模板覆盖整个文件。** worker 密钥已用于定时器认证，单独更换会导致定时调用失败。

## 1. 开通账号并填写字段

在本次交付的独立 worktree 中打开配置文件（原检出中的私有配置副本保留，本次后续维护以此 worktree 为准）：

```sh
cd '/Users/lwc/Documents/ChatGPT/场景规划Agent产品开发/.worktrees/deepseek-launch'
open -e .env.edge.local
```

DeepSeek：登录 [API Key 页面](https://platform.deepseek.com/api_keys)，创建本项目使用的密钥，确认账户余额和 `deepseek-flash` 调用权限。本后端直连 DeepSeek 官方服务；当前模型名及端点见 [DeepSeek 接入文档](https://api-docs.deepseek.com/)。

腾讯：进入 [TokenHub API Key 页面](https://console.cloud.tencent.com/tokenhub/apikey)，本项目选择广州接入，在账号内开通 HY-3D-3.0 并创建密钥。新开通服务使用 TokenHub；旧平台已停止支持新购模型服务，参见 [官方迁移说明](https://cloud.tencent.com/document/product/1804/120696)。当前代码使用 `hy-3d-3.0`、`LowPoly`、`triangle`，与 [HY-3D 调用指南](https://cloud.tencent.com/document/product/1823/137181) 对应。

找到下面各字段，填入真实值。费用和条款尚未核对时先留空，保留服务未启用状态。

| 字段 | 填写内容 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 官方平台创建的 API Key |
| `AI_MAX_REQUEST_CENTS` | 一次应用内 AI 请求的保守费用上界，单位为人民币分；正整数，当前填写 `40`，最少 `40`、最多 `3000` |
| `HUNYUAN_API_MODE` | `tokenhub` |
| `HUNYUAN_API_KEY` | 广州 TokenHub 账号创建的 API Key |
| `GENERATION_MAX_TASK_CENTS` | 单次三维生成的保守费用上界，单位为人民币分；正整数，最多 `15000` |
| `HUNYUAN_TERMS_URL` | 你已实际阅读、适用于当前账号及生成结果用途的官方条款 HTTPS 链接 |
| `HUNYUAN_TERMS_REVIEWED_AT` | 实际核对条款的日期，格式 `YYYY-MM-DD`，不可填写未来日期 |

存在未完成或提交结果未知的任务时，不要切换 `HUNYUAN_API_MODE`，以免用另一平台查询旧任务或重复提交。

条款需覆盖本项目的模型保存、使用和分享用途；不要用任意产品页代替条款，也不要把本指南的核验日期当作你已完成阅读的记录。密钥直接写入本地文件，无需粘贴到聊天中；仅在终端 `export` 变量不会更新待上传的文件。

## 2. 确认费用上界

一次应用内 AI 请求最多调用 DeepSeek **两次**：首次生成，以及输出未通过校验时的一次修复。`AI_MAX_REQUEST_CENTS` 要覆盖两次输入和输出总和，修复请求还会携带首次输出与校验信息；每次代码设置的输出上限为 `4096` tokens。按 [DeepSeek 当前价格](https://api-docs.deepseek.com/quick_start/pricing/) 核对账户币种、峰谷价格及缓存计费；若账户以美元结算，先按保守汇率换算为人民币分，再向上取整。不要只按一条短提示词估算。

腾讯公开价格页目前列出 HY-3D-3.0 每次消耗 `15–60` 积分、每积分 `0.12` 元，折合公开表范围为 `1.8–7.2` 元。**仅当你的账号与所用参数核对结果不高于此范围时，`720` 分才可作为保守预留示例**；这不表示本次 LowPoly 必然收费 7.2 元，也不表示我们已核验你的账号价格。[TokenHub 模型价格](https://cloud.tencent.com/document/product/1823/130055)

代码的累计预留预算为文本 `3000` 分、三维 `15000` 分。预留不是实际账单；免费额度不应作为必然可用的预算，未知或失败任务也不会自动释放预留。

## 3. 检查并上传到专用项目

保存文件后，在根目录运行：

```sh
npm run check:config:full
```

检查会读取 `.env.local`、`.env.edge.local`，验证完整供应商配置及演示账号。若失败，按输出的字段名修正；通过只代表本地配置格式和配套关系正确，尚未证明账号权限或真实生成可用。

通过后执行下面命令，将文件里的服务端设置上传到指定项目。若 CLI 提示未登录，先执行 `npx supabase login`。

```sh
npx supabase secrets set --project-ref hrsrrduwbqxnqddkexoy --env-file .env.edge.local
```

这一步只更新配置，不提交生成请求。前端只配置 Supabase URL `https://hrsrrduwbqxnqddkexoy.supabase.co` 与 anon/public key；service role、供应商密钥和 worker 密钥保留在服务端。

## 4. 验证后启用轮询

本轮已安装定时器 `scene-generation-poll`，当前 `active=false`。凭据未填齐时保持停用。完成填写和预检后，可以告诉当前助手“供应商配置已填好，预检已通过”，继续进行云端配置验证；真实付费生成验收由你明确提交一项任务后进行，不自动批量测试或重复提交未知结果的付费任务。

确认云端配置可用后，在该项目的 [SQL 编辑器](https://supabase.com/dashboard/project/hrsrrduwbqxnqddkexoy/sql/new) 执行启用：

```sql
select cron.alter_job(jobid, active := true)
from cron.job
where jobname = 'scene-generation-poll';
```

启用定时器不会创建新的生成任务；它会开始处理用户已明确提交的排队任务，并查询、归档现有任务。空队列不会发起生成。若队列已有用户提交的任务，启用后这些任务可能进入付费处理。

检查状态：

```sql
select jobname, schedule, active
from cron.job
where jobname = 'scene-generation-poll';
```

需要停止轮询时执行：

```sql
select cron.alter_job(jobid, active := false)
from cron.job
where jobname = 'scene-generation-poll';
```

停用不会取消已提交给供应商的任务；保留任务记录，用于核对状态和费用。
