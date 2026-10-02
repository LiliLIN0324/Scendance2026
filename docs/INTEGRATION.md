# 前后端合并与本地联调

2026-10-02，集成分支 `codex/integrate-editor-backend`。

已下载 `codex/a-a01-editor` 的 `a1dd33708a45643e6cdda8273fe15ba019ca9c99`。其历史已经包含后端提交 `f4296f3dc77b661f6f7e8dac3310a3fbc75ebee3`，所以直接在该基线上联调，无需覆盖或重复合并后端。根目录保留原展示原型，当前工作台位于 `frontend/`。

## 本次修复

本地 Supabase 使用 `http://127.0.0.1` 等回环地址。前端会话层允许它们，GLB 下载和本地场景校验却只接受 HTTPS 或相对地址，导致模型项目提示“模型地址无效”，无法加载或保存重开。

`lib/glb-url.ts` 现在统一下载和持久化的 URL 校验，接受 HTTPS、相对路径，以及 `localhost`、`127.0.0.1`、`[::1]` 的 HTTP 地址；其他主机的 HTTP、凭据、反斜线和协议相对地址仍拒绝。先用实际授权 URL 复现失败，再修复并验证模型下载、Three.js 解析和本地序列化往返。生产后端接口及数据库迁移没有改变。

## 环境与验证边界

- 使用 Node.js **24.15.0**，版本记录在根目录 `.nvmrc`；前后端依赖均按原有锁文件安装。
- 当前机器没有 Docker 或运行中的完整本地 Supabase。联调服务器显式绑定 `127.0.0.1`，运行正式 `createApi` 处理器，以及由全部正式迁移初始化的 PGlite PostgreSQL 数据库。
- Auth 的登录/刷新/退出及 Storage 的文件/限时链接使用测试实现。没有调用真实 Supabase Auth、Storage、PostgREST 或网关；不能据此宣布真实云端验收完成。
- 不需要任何真实密钥，不调用 DeepSeek、混元等付费接口；未配置付费服务时测试确认返回 503，且不会创建生成任务。
- 测试服务重启后数据清空；不用于部署或保存正式方案。生产环境继续按 [部署说明](DEPLOYMENT.md) 配置。

## 可复现命令

先使用 `.nvmrc` 指定的 Node，分别安装两套依赖：

```sh
npm ci
npm --prefix frontend ci
```

从仓库根目录检查：

```sh
npm run check
npm run check:edge
npm run smoke:edge
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

仅运行跨层 HTTP 联调：

```sh
npm run test:integration
```

浏览器联调需要三个终端。终端一在仓库根目录启动测试服务器：

```sh
npm run dev:integration
```

终端二构建带本地测试配置的生产页面。这两个公开值只用于测试，不含真实密钥：

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_local_integration_only \
npm --prefix frontend run build
```

终端三从仓库根目录启动静态预览：

```sh
python3 -m http.server 3018 --bind 127.0.0.1 --directory frontend/out
```

打开 `http://127.0.0.1:3018`，点击“连接云项目”。这是显式测试环境，没有自动伪造登录或云保存回退。

| 测试邮箱 | 测试密码 | 权限 |
| --- | --- | --- |
| `owner@scendance.test` | `local-integration-only` | 工作室所有者 |
| `editor@scendance.test` | `local-integration-only` | 同工作室编辑者 |
| `outsider@scendance.test` | `local-integration-only` | 不属于工作室 |

测试服务预置“GLB 跨账号联调项目”，包含程序生成、经过正式模型校验器检查的四面体 GLB。它用于验证私有授权、解析和尺寸；不冒充第三方生成结果。原前端桌子样例仍是本地素材，含后端尚未支持的 `KHR_mesh_quantization` required extension 和动画，不能替代归档模型验收。

## 实际结果

| 检查 | 结果 |
| --- | --- |
| 后端回归 | 6 个文件，54 项通过 |
| 前端完整回归 | 88 个文件，1,234 项通过，包含新增 8 项跨层联调和 10 项 GLB URL 回归 |
| 前后端 TypeScript | 均通过 |
| 前端 ESLint | 通过，无新增告警 |
| Next.js 静态生产构建 | 通过，输出 `frontend/out/` |
| Deno Edge 类型检查与冒烟 | API health 和 Khronos GLB validator 通过 |
| HTTP 与 SQL 跨层验证 | 两个账号/两个会话编辑权竞争、续期/交接、过期 fencing、旧版本写入拒绝并保留草稿通过 |
| 私有模型 | 工作室成员授权 → HTTP 下载 → Three.js 解析 → 本地序列化重开通过；外部账号拒绝；过期限时链接拒绝 |
| 分享 API | 发布快照后编辑草稿不会改变公开版本，私有备注不泄露，撤销后不可读取 |
| 浏览器项目操作 | 所有者登录，当前 5 件物料画布创建项目，获取编辑权，添加第 6 件椅子，设置 X=2.5m/Z=1m/旋转=30°/备注/锁定，保存返回版本 1，然后释放编辑权 |
| 浏览器刷新和第二账号交接 | 刷新后编辑者登录、打开项目、获取编辑权；6 件物料、位置、角度、备注及锁定均保留 |
| 浏览器 GLB | 编辑者打开所有者项目，经私有授权加载实际 GLB 网格，尺寸 1.8×0.9×0.75m，保留原材质 |

浏览器使用 Playwright CLI 控制 Chrome，截图保存在本机 `output/playwright/`。无头 Chrome 在画布尺寸变化后曾捕获空白帧，触发适应场地/重绘后恢复；可见 Chrome 的稳定截图另行复核过真实网格。因此不把首次空白截图或仅有接口成功当作渲染通过。未针对这一截图现象改动渲染器。浏览器另有既存 `PCFSoftShadowMap` 降级告警和首次 favicon 404，未影响本轮操作。

## 尚未完成的产品范围

这次合并没有补写 A01 分支尚未交付的 AI 提案 UI、真实生成 UI、公共库推荐 UI、平面图标定、多边形编辑、共享物料汇总或客户发布页。分享结果目前只验收后端 API。真实 Supabase 双账号、付费供应商、手机真机和外网部署仍需在对应环境验证。
