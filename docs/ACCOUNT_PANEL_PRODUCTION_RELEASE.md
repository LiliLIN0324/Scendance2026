# 账户面板生产发布记录

2026-10-03，用户明确授权「部署上线」。

## 发布版本

- 正式地址：https://scendance.charlestech.org
- 应用源码：`7c9125c86af6db52e4be7696a9f20f5c8f58bb27`，专属分支 `codex/account-management-panel`。
- Pages 项目：`scendance-scene-planner`；生产部署：`5a50ff84-fa07-4746-8d02-659ca6024b2c`。
- 生产快照：https://5a50ff84.scendance-scene-planner.pages.dev
- 预览验收：https://8c43317c.scendance-scene-planner.pages.dev
- 发布前核对到实际生产源码为 `3b3a2e0`，领先于 Git main。将账户面板变更重放到包含该版本的 `09d8481`，保留此前的项目删除、批量移动、小狗助手和混元入口修复。
- 使用 Pages 现有公开 Supabase 配置构建，同一份静态产物先发布预览、通过验收后再发布生产。本次没有后端、数据库或密钥变更。

右上角统一为「账户与项目」，提供项目搜索与工作室筛选，以及团队演示、权限演示、素材库和发布管理。虚构团队与权限仅用于本次页面会话的交互演示，不发送邀请或修改真实云端权限。

## 验证

- 整合后的前端 127 个测试文件、1,602 项测试通过；后端 17 个测试文件、162 项测试通过。
- 生产构建、构建中的类型检查和 `git diff --check` 通过；仅保留已有 `scene-preview.tsx` import/order 警告与静态导出 rewrites 提示。
- 157 个构建文件、74 个文本文件完成配置与敏感信息扫描；包含正式公开配置，不含本地测试地址、测试密码或服务端私钥。
- 预览站与正式域名均完成 Chromium 桌面 1440×1000、手机 390×844 验收：添加演示成员、修改权限、角色预览、重置、无横向溢出、Escape 关闭及焦点恢复。
- 正式域名使用现有演示账号真实登录，读取 4 个既有项目；搜索无匹配项目后清除筛选，列表恢复；随后退出登录。浏览器运行错误为 0，对业务 API 的写请求为 0。
- 正式域名的 45 个 JavaScript、CSS 和小狗助手资源 SHA-256 与发布产物全部一致；`/`、`/auth/`、`/projects/`、`/view/`、`/introduction/`、`/reset-password/` 均返回 HTTP 200。普通脚本首次收到 403 后，以浏览器请求头及真实 Chromium 页面分别复核，均通过。
- 此次线上验收覆盖账户面板、登录和项目列表读取；没有新建、修改或删除云项目，没有发起付费生成请求。

截图、浏览器结果、部署记录、测试日志及产物清单保存在本工作树忽略目录 `output/playwright/account-release/`。凭据未写入发布记录或 Git。

## 回滚与后续发布

- 上一生产部署：`37e321c7-e07b-47cb-bfff-ab122e820a9a`，源码 `3b3a2e0c3a05ecec1102a9f7fe1f314e44d783bb`。
- 回滚快照：https://37e321c7.scendance-scene-planner.pages.dev
- 如需回滚，在 Pages 控制台选择上述生产部署并执行回滚；操作方式见 [Cloudflare Pages 回滚文档](https://developers.cloudflare.com/pages/configuration/rollbacks/)。此次仅发布前端，不涉及数据库回滚。
- 本次直接上传专属分支源码，`--branch main` 只选择 Pages 生产环境，没有合并 Git main/dev。后续 Git main 自动发布前须整合当前生产修复和账户面板变更，避免覆盖。
- 本发布记录在应用部署后另行提交；线上应用源码仍为上面记录的 `7c9125c`。
