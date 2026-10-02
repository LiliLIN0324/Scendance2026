# v0.4.1 兼容修改与验收记录

2026-10-02。实现分支：`codex/scendance-v041-compat`。

## 基线与范围

现有部署对应 `d4d254b48d93565a31bdb3fd54dfd329a2d28c86`；UI 基准为 [v0.4.1 / 3da9090](https://github.com/LiliLIN0324/scendance/commit/3da909042d412e595f138ed1c7b4a29819bb53c1)。采用定向兼容合入，保留现有部署在认证、个人工作室和 AI 额度方面的后端实现。

| 部分 | 本次结果 |
|---|---|
| 品牌与入口 | 幕景品牌、v0.4.1 介绍页、本地体验；工作台返回介绍页时保留本次需求、图片与助手状态 |
| 工作台布局 | 物料库／需求／场地标签、右侧物件属性与浮动助手 |
| 模型库 | 234 个模型、13 类、搜索与逐批显示；完整目录进入前端，点击时加载模型 |
| AI 交互 | 完整文字需求、提案预览、明确确认后应用、过期提案与重复请求保护；继续使用既有服务、提示词与额度规则 |
| 现场照片与灯光 | 照片本地预览、放大、删除；neutral/warm/cool 灯光作用于 3D，沿用既有场景字段 |
| 模型云保存 | 每个目录模型有固定 assetId、文件哈希、字节数；管理员批量归档后可通过原资产授权和项目保存接口保存、重开 |
| 注册与密码找回 | 保留现有六位验证码、回调、密码恢复、sessionStorage 登录恢复；介绍页链接到原入口 |
| 页面与发布打包 | 保留原构建命令、Pages 配置、`package-pages.mjs`、`/introduction` 和 showcase 打包 |

未改 `client/scene-client.ts`、共享 domain、任何 Edge Function、原有 SQL 迁移、Auth 配置、Storage bucket 配置、AI 服务提示词与发布接口。Supabase 唯一增量是下面的资产迁移，依据用户明确授权“允许最小资产接口扩展，其余 Supabase 服务保持不动”。

## 最小资产扩展

`20261002180000_shared_model_library.sql` 新增私有的 `library_assets` 登记表和仅 service_role 可调用的 `register_library_asset` RPC，并在 `can_use_asset` 保留原私人／项目成员授权的基础上，允许工作室成员使用已登记公共模型。普通用户、匿名角色不能登记或改写公共库；无工作室成员资格的账号不能读取公共模型，其他私人模型仍保持原权限。

目录与文件绑定：`assets/library/online.json` 保存来源页、原 GLB URL、assetId、SHA-256 与准确字节数；`asset-ids.json` 是前端读取的 URL→UUID 映射。UUID 按固定命名空间和模型 slug／内容哈希生成，导入脚本必须使用此清单，不能随机分配新 ID。每个资产存入既有 `scene-assets` 私有桶的 `<owner>/<assetId>/<sha256>.glb` 路径。重复导入相同数据幂等；同一 slug 改 ID、哈希或所有者会明确失败。

已登录用户添加模型时走原 `POST /assets/:assetId/url`；本地体验使用原 CDN。云端 scene 只保存 assetId，不存临时授权 URL。重新打开时重新授权，并恢复目录缩略图与来源。旧本地目录模型可按完全一致的已知 CDN URL 转换为 assetId；其他无 ID 的 GLB 继续拒绝云保存。

这批原文件共 **25,528,264 bytes**，已全部下载并逐一核对哈希、GLB 结构、几何与纹理：234 个使用量化坐标，36 个含 WebP 纹理，49 个含动画。保留原文件；编辑器显示初始姿态，不新增动画播放。公共库专用离线校验允许最大的两份整场景模型达到 150,000 三角形／350 绘制单元，原生成与私人模型校验器保持不变。

## 后续上线顺序（本次未执行）

1. 审核并只应用新增的资产迁移，确认没有夹带其他待应用迁移。不需要重新部署现有 Edge Function，也不修改 Auth／SMTP 配置。
2. 选择已有工作室成员作为本批资产的固定 owner；通过本机安全环境提供 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`，不要写入前端环境或提交凭据。
3. 使用 Node 24.15+ 运行校验，再显式执行导入：

   ```sh
   npm ci
   npm run library:check
   node --experimental-transform-types scripts/import-model-library.ts --write --remote --owner <existing-member-uuid>
   ```

   默认缓存为系统临时目录下的 `scendance-v041-library`，可用 `--cache <path>` 指定。无 `--write` 只检查文件，不接触 Supabase；远端写入还必须有 `--remote`。逐项导入，中断或部分失败后以同一个 owner 重跑。完成标准为 `checked:234, registered:234, failures:[]`；当前本地记录是 `checked:234, registered:0`。
4. 用正式账号检查另一工作室可授权公共模型、私人模型仍拒绝、添加后保存并刷新重开；随后用现有发布流程构建和发布前端。公共库未归档完整前，不应上线这版前端，否则已登录用户添加未归档模型会收到资产不存在错误。

回退前端可回到原 Pages 部署 `92f3905f-6dbd-4050-93fb-2b87ded5255e`。已保存项目可能引用新资产，因此回退 UI 时保留新登记和文件，不应删除模型或倒退授权函数而破坏这些项目。回退前端不会回滚数据库与浏览器状态。

## 验证与边界

- 后端 114 项测试通过，包括工作室间公共模型授权、私人资产隔离、幂等登记、浏览器角色拒绝。
- 前端 1,443 项测试通过，包括 234 个模型的场景转换与重开、薄模型尺寸、旧草稿映射、短期 URL 不入云端场景、认证回归、AI 额度失败继续编辑。
- 10 项本地 HTTP 联调包含模型授权→读取真实 GLB→保存→退出→重新登录→重开，以及 AI 预览→确认应用→另账号重开。使用 PGlite 和显式测试 Auth／Storage；AI 返回来自测试 provider，不代表实际生成服务验收。
- TypeScript（前端、后端与新导入脚本）、ESLint、生产构建、`git diff --check` 通过。
- 浏览器已验证 234 件／13 类目录、真实 CDN 模型添加、照片放大、介绍页往返保留需求与图片、灯光切换与撤销、注册／密码找回入口，以及 `/introduction` 输出。工作台无控制台错误；原静态介绍页的默认 `/favicon.ico` 请求为 404，页面功能正常，按范围保持原打包不变。
- 本机浏览器验收截图保存在 `output/playwright/`，不提交生成物。正式账号、真实邮件送达、生产 Storage 写入与线上部署均未执行。

照片仍只在本地内存预览，刷新需重新选择，未增加识图或照片云保存。现有 AI 自动布置仍使用后端八类基础物料契约；234 个公共模型可手动添加和保存，本次没有改 AI 服务去自动选择它们。
