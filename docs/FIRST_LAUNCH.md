# 现有编辑器首次上线

日期：2026-10-02。用户明确选择先上线现有编辑器，DeepSeek 后端可用；不加入 AI 提案界面。

- 正式地址：https://scendance.charlestech.org/
- Pages 项目：scendance-scene-planner；部署：https://c30c7a99.scendance-scene-planner.pages.dev
- 源提交：b7927291099f6649db7c3349873042e5ead0cd9e，专属分支 codex/scendance-first-launch；基于 ceb41a1。
- 独立 Supabase：hrsrrduwbqxnqddkexoy；以工作区根目录后端为准。本仓库内附后端不是本次云端部署源。
- 静态构建：Node 24.15.0，Next export，37 个文件。前端只注入公开 Supabase URL / anon key；无 DeepSeek、service role 或演示密码。
- Pages --branch main 仅选择既有生产环境，没有合并 Git main/dev；未改 CharlesTech 原站和数据库。

## 验证

1234 项前端测试（88 文件）、TypeScript、lint 和生产构建通过。正式域名、Pages 主机名以及 JS/CSS/GLB 抽查均为 HTTP 200；原 522 已解决。

浏览器真实登录预置负责人账号，读取工作室项目，打开本轮专用“DeepSeek 上线验收”项目，取得编辑权，添加一把椅子并保存为云端版本 1，随后释放编辑权并重新打开云端版本，椅子正确恢复。

根目录后端通过 110 项测试和 Deno 检查。真实 DeepSeek 受保护接口返回 201，生成未自动应用的 8 物件提案。限额为北京时间全站 10 元/日的保守预留（每次调用 0.20 元、修复也计入），原累计 30 元门槛仍保留；同密钥在站外使用不受本站限制。

## 当前边界与恢复

现有首页编辑器包含登录、项目、租约与保存。AI 提案、混元任务、公共目录和客户分享页面尚未接入，混元服务及定时轮询保持停用。没有宣称 PLAN 全部产品功能已完成。

此次是 Pages 第一次发布，没有更早的有效前端版本可回滚。可以由上述源提交重建并重新部署；前端恢复不会回滚 Supabase 数据或密钥。后端恢复必须先停用 DeepSeek 凭据再回退无每日限额版本，保留账务数据。
