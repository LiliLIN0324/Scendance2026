# Scendance 独立 Cloudflare 项目与域名

> 本文保留首次后端配置阶段记录。2026-10-02 后续已配置并实测 DeepSeek、增加每日限额、发布现有编辑器；最新部署与验收结果见 [DeepSeek 与首次上线记录](DEEPSEEK_DAILY_LIMIT.md)。


记录日期：2026-10-02（America/Chicago）。本次完成独立 Pages 项目与 `scendance.charlestech.org` 的关联和 DNS 配置；没有上传前端或占位页面。

## 实际配置

| 项目 | 实际值与状态 |
| --- | --- |
| Cloudflare Account ID | `fd8c05b7baa3126651103f11bb24fe32` |
| DNS Zone | `charlestech.org`，ID `30d98b8d6cd723f6ac3d01a4af0fdd57`，active |
| 独立 Pages 项目 | `scendance-scene-planner` |
| 项目 ID | `f795edc4-5c78-4659-82bf-acb3a6f300ec` |
| Pages 主机名 | `scendance-scene-planner.pages.dev` |
| 生产分支设置 | `main`，仅 Pages 配置值；本次代码在专属 codex 分支提交，没有合并 main |
| 前端部署 | `canonical_deployment=null`，未上传文件、未创建生产部署 |
| 自定义域名 | `scendance.charlestech.org` |
| 自定义域名 ID | `c8af1c77-b9c5-40a2-832c-2d5012d0372d` |
| 域名验证与证书 | 最终认证 API 返回 `status=active`、`verification_data.status=active`、`validation_data.status=active`，CA 为 Google |
| DNS | 新增一条 CNAME：`scendance` → `scendance-scene-planner.pages.dev`，已代理、TTL 自动 |
| Supabase | 独立 ref `hrsrrduwbqxnqddkexoy`，配置见 [后端部署记录](CLOUD_DEPLOYMENT.md) |

同一账号和 Zone 下，Scendance 使用独立 Pages 项目、专用子域名和独立 Supabase。原 `charlestech.org` 与 `www.charlestech.org` 继续绑定 `charlestech` Worker 的 production，认证 Worker Domains API 与 DNS 控制台均已确认。

## 执行与验证证据

- Wrangler `4.125.0` 的 `whoami` 在正常系统权限下确认 OAuth 登录有效。受限执行环境无法读取 macOS Keychain 时出现的“未认证”，不能代表实际凭据失效；没有清除或更换账号凭据。
- 先创建独立 Pages 项目，再关联自定义域名，最后只新增指定 CNAME。保存前 DNS 控制台共有 4 条原记录（2 条 TXT、apex/www 两条 Worker）；保存后新增 Scendance CNAME，共 5 条，原记录保持不变。
- Pages API 在 CNAME 保存前返回 pending/CNAME record not set；保存后最终只读请求返回域名及验证 active。中间 TLS 请求失败未被记为成功。
- OAuth 没有 DNS 编辑权限，DNS 使用已登录控制台完成；未申请新的 DNS token，未读取或输出凭据。
- 本机代理使部分 DNS 查询返回 `198.18.*` 地址，因此没有将这些本机结果作为权威 DNS 证据；本次以认证管理接口和 DNS 控制台为依据。

配置顺序符合 [Cloudflare Pages 自定义域名说明](https://developers.cloudflare.com/pages/configuration/custom-domains/)；项目、域名、部署属于不同资源，见 [Pages 管理接口](https://developers.cloudflare.com/api/resources/pages/)。

## 首次前端发布前的边界

域名 active 证明域名关联及验证已完成，不代表网站前端已上线。本次按用户要求保持空 Pages 项目。后续真正发布前端后，仍须验证 HTTPS 页面、`/projects/`、`/editor/`、`/view/` 直接刷新，以及独立 Supabase 登录、CORS 和客户端资产展示。

本文件不包含 token、OAuth code、密码或供应商密钥。没有修改原站 Worker、其路由、原站 DNS 或原站数据库。
