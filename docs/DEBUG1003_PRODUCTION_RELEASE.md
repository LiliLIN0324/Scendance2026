# debug1003 生产发布记录

2026-10-03（UTC），用户明确授权“将这一版本的改动部署上线”。

## 实际发布

- 正式地址：https://scendance.charlestech.org
- 源码提交：`3b3a2e0c3a05ecec1102a9f7fe1f314e44d783bb`，专属分支 `codex/debug1003-repairs`。
- 发布前发现线上已更新至 `159f53f`（混元入口）。先将它整合进本分支，保留混元生成界面，再发布本次修复；没有合并 Git main/dev。
- Pages 项目：`scendance-scene-planner`；生产部署：`37e321c7-e07b-47cb-bfff-ab122e820a9a`，状态 success。
- 预览部署：https://3d53b85c.scendance-scene-planner.pages.dev
- Supabase：`hrsrrduwbqxnqddkexoy`。先在事务中验证并回滚，再提交 `20261003120000_project_deletion.sql`，记录迁移版本，最后发布 `scene-api` v9（ACTIVE）。
- 保留原有 `verify_jwt=false` 与 API 内部身份校验。generation-worker v5、reconstruction-worker v2 保持原样；未改供应商配置、密钥或定时器。

本次包含文档修复、云项目删除、用户提供的小狗动画、批量移动实时预览/确认/取消/撤销、X/Y 水平与 Z 竖直坐标，以及 Trancy 注入根元素属性的 hydration 兼容修复。

## 验证

- 整合后的前端 1598 项、后端 162 项测试全部通过；前后端类型检查、Edge 类型检查、生产构建、git diff 检查通过。
- lint 无错误，保留已有 `scene-preview.tsx` 的一处 import/order 警告。
- 使用正式 Pages 项目现有公开 Supabase 配置构建。157 个产物文件、74 个文本文件扫描未发现本地测试地址、测试账号密码或私有密钥；`sb_secret_` 字符串仅是已有客户端拒绝私钥的校验前缀。
- 正式域名的 42 项 JS/HTML/小助手资源匹配此次构建；HTML 比较仅移除 Cloudflare 注入的防护脚本，其余内容精确匹配。
- Chromium 实测预览站批量移动：输入即预览，不提前写本机草稿，取消重置，应用后两件物料 Y 对应水平坐标、Z 对应 elevation，撤销恢复。混元入口仍可见。
- 正式域名未登录进入 `/auth`，可经“先体验本地工作台”进入编辑器。正式域名复测移动预览/取消、物料库混元入口、小助手。
- 线上 API：health 200；无认证 projects 401；现有测试账号读取 projects/jobs 200；不存在的项目 DELETE 返回 PROJECT_NOT_FOUND 404；非授权 Origin 403。
- 迁移及发布前后均为 13 个项目，0 个 deleted_at；场景/修订汇总校验值均为 `efee0aceba9cfe609d798a7607314f0f`。

没有删除任何现有云项目，没有为发布测试创建付费 AI 请求。本次验证不代表真实混元生成或计费端到端验收。方案历史与自建图层仍保存在本机，云端保存当前场景。

## 回滚

- 上一生产部署：`bb498375-43a2-468e-9878-0ec7facf2a9c`，源码 `159f53f2dfaec48e0466d11f1b026d36326b7cb7`。
- 如需回滚前端，在 Pages 控制台将上述生产部署设为回滚目标；[官方回滚接口](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/)亦可使用该 deployment ID。
- 保留兼容旧前端的当前 API 和迁移。前端回滚不能撤销数据库变化；不得通过删除 tombstone 字段或恢复旧函数让已删除项目重新出现。
- 忽略目录 `output/playwright/debug1003-release/` 保留前后部署元数据、发布前 API 源码、数据库函数定义、迁移回滚验证/提交结果、资源哈希和浏览器截图。未将凭据写入记录或 Git。

Pages 本次为专属分支源码的直接上传，`--branch main` 仅选择生产环境。后续 GitHub main 自动发布前需先整合本次修复，避免再次覆盖。
