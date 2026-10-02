# DeepSeek 配置与每日限额

日期：2026-10-02（America/Chicago）。目标仍为独立 Supabase 项目 `hrsrrduwbqxnqddkexoy`。用户授权配置 DeepSeek、本站单日消费不超过人民币 10 元，并先上线现有编辑器；AI 提案界面与混元生成不包含在本次前端发布中。

## 限额语义

- 全站所有成员共享 **1000 分/北京时间自然日**，由数据库 `clock_timestamp() at time zone 'Asia/Shanghai'` 决定日期，客户端不能指定日期或额度。
- 每次 DeepSeek HTTP 调用前原子预留 **20 分**，首次调用和一次修复分别计入，最多 50 次调用/日。余量不足时 API 返回 `429 DAILY_BUDGET_EXCEEDED`，不会请求模型。
- 这是保守预留上限，不是实时供应商账单。失败、超时和结果未知仍保留预留，不自动退款；首次与修复分别按实际发起调用时的日界预留。供应商自身记账日期可能不同。
- `deepseek-flash` 使用非思考模式，输入 messages JSON 上限 65,536 UTF-8 字节，输出最多 4,096 tokens；超过输入上限在模型调用前拒绝。按核验当日高峰输入 2 元/百万、输出 8 元/百万，加上消息封装余量，单次费用低于 0.20 元。密钥通过官方接口确认可用且币种为 CNY。
- 原有文本**累计 3000 分**预算仍保留，应用每个请求预留 `AI_MAX_REQUEST_CENTS=40`，覆盖最多两次模型调用。这一额外累计门槛不会每天重置；后续调整需核对实际账单，不会自动提高。
- 日额度只约束本站后端。没有修改 DeepSeek 平台账号级或密钥级限额，也无法阻止同一密钥在其他程序中调用。供应商价格变化后须重新核对单次预留与输入/输出上限。[官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

## 部署顺序与安全边界

1. 本地验证新增每日预算表、按请求和 attempt 去重、成员归属及原子扣减。
2. 通过 Management API 事务执行 `20261002110000_deepseek_daily_budget.sql` 并保存迁移历史，保留旧 `job_rpc` 定义用于恢复。
3. 部署新的 `scene-api`，使每次模型请求必须经过数据库预算预留。
4. 最后仅上传 `DEEPSEEK_API_KEY` 和 `AI_MAX_REQUEST_CENTS` 两项 secrets；不覆盖腾讯配置。

新增两张服务端表启用 RLS、撤销浏览器角色权限。预算拒绝、重复 attempt 或不属于调用者的请求均不能触发模型。生产内不提供浏览器修改预算的入口。

私有配置位于当前 worktree 的 `.env.edge.local`，权限 0600、Git 忽略。前端只有 Supabase URL 和公开 anon key；构建产物扫描没有服务端密钥或演示密码。

## 已完成检查

- 后端：110 项测试、TypeScript、Deno 类型与运行冒烟通过。
- 真实 PostgreSQL：在可回滚事务中将当日预留设为 980 分，一次调用达到 1000 分，第二次被拒绝；整体回滚，没有付费调用或留存测试额度。
- DeepSeek 官方免费余额接口：密钥被接受、账号可用、币种 CNY；不在文档记录余额或密钥。
- 真实受保护 API 验收：返回 201，生成 8 个物件的沙龙提案，未自动应用。requestId 为 `03ae0e97-ff6c-43ea-aec2-b65ed2c99f01`，proposalId 为 `4b81a829-62b5-4c6a-aaa5-88f081d0e063`。数据库确认请求 complete、一次供应商调用；789 input / 68 output tokens，当日保守预留 20 分。
- 云端已执行第五份迁移；`scene-api` 为 ACTIVE v3，`generation-worker` 为 ACTIVE v2。混元未配置，定时任务仍停用。
- 前端 88 个测试文件、1234 项测试、TypeScript、lint、静态构建通过。发布源提交 `b7927291099f6649db7c3349873042e5ead0cd9e`，分支 `codex/scendance-first-launch`。
- Cloudflare 首次部署成功：https://c30c7a99.scendance-scene-planner.pages.dev 。正式域名 https://scendance.charlestech.org/ 与 Pages 主机名均返回 200，JS/CSS/GLB 资源抽查 200。此前没有部署导致的 522 已消失。
- 浏览器已成功登录专用工作室、读取项目列表，打开专用验收项目并取得编辑租约；添加一把椅子后保存为云端版本 1，释放租约并重新打开，椅子正确恢复。验收没有修改既有项目。

恢复时优先停用 DeepSeek secret，不能在密钥保持启用时回滚到无每日限额的 API。保留已发生的调用及预留记录，不为恢复额度删除账务数据。
