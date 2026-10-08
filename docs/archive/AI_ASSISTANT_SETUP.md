# AI 助理配置与前端交接

> 归档于 2026-10-09：本文是 1.0 之前的发布或验收记录，内容以记录当日为准，仅用于追溯。当前入口见 [README](../../README.md)，当前部署见 [自有 Supabase 部署](../OWN_SUPABASE_TUTORIAL.md)。

> 本文为原交付过程记录，所述分离工作树路径属于历史环境。当前完整仓库的入口与部署边界见 [项目交接](PROJECT_STATUS.md)（已归档）。

2026-10-02。本任务在 `codex/deepseek-assistant` 后端工作树进行配置检查，前端位于本目录下独立 Git 工作树 `scendance/`，分支为 `codex/deepseek-assistant-ui`，起点为已上线前端 `c727f00`，实现提交 `c790c45`，窄屏修正提交 `8fe040c`。未合并 main 或 dev。

已完成前端的需求输入、提案预览、明确确认、云保存及本地撤销，并接入现有版本、租约、场景哈希和本地修订号保护。完整实现和验收说明见前端仓库 `docs/AI_ASSISTANT.md`。后端接口、数据库和完整系统提示词均保持原有协议。

用户提供的 DeepSeek key 已存入本工作树私有 `.env.deepseek.local`（0600、Git 忽略），仅含 `DEEPSEEK_API_KEY` 与 `AI_MAX_REQUEST_CENTS=40`。DeepSeek 官方免费余额接口返回 HTTP 200、账号可用；源码和构建产物密钥扫描通过。该结果不等于真实模型生成验收。

**未完成的外部操作：** 自动审批拒绝向专用 Supabase 项目 `hrsrrduwbqxnqddkexoy` 写入该 key，原因为尚无对这一具体凭据目的地的明确用户授权。没有绕过拒绝。新前端尚未发布；尚未用新助理完成真实模型端到端验收。

用户明确授权后执行：仅将 `.env.deepseek.local` 两项上传到上述项目，保持现有其他 secrets 与每日预算；用独立验收项目测试生成→预览→确认保存→重新打开；再将前端 `frontend/out/` 发布到独立 Pages 项目 `scendance-scene-planner`，目标域名 `scendance.charlestech.org`。不要从前端仓库部署其较旧的后端副本。

## 后续已授权执行

用户已明确授权将 key 存入指定 Supabase 项目并部署上线。两项服务端 secrets 已成功写入 `hrsrrduwbqxnqddkexoy`。一次最小真实验收通过：账号登录、DeepSeek 提案生成、确认应用、重新读取场景；生成 6 件物料，保存为版本 1，并释放编辑权。验收项目 `92989c6c-2fa7-4683-8534-f1ae8848f679`，提案 `1f34b550-e462-407a-931d-9d96ad3a1bb4`。前述审批阻塞已解除。

新版前端已直接发布到生产 Pages 项目，源提交 `8fe040c`，部署地址 https://7a6a6794.scendance-scene-planner.pages.dev ，正式域名 https://scendance.charlestech.org 。没有创建 PR，也没有合并 main/dev。
