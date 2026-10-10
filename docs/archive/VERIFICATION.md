# 本轮验证记录

> 归档于 2026-10-09：本文为 2026-10-02 首次后端配置阶段记录，其中的额度与部署状态已作废，仅用于追溯。当前入口见 [README](../../README.md)，后续验收见 [首次上线记录](FIRST_LAUNCH.md)、[DeepSeek Agent 发布](DEEPSEEK_AGENT_RELEASE.md)、[最近修复验收](DEBUG1003_REPAIR_REPORT.md)。


日期：2026-10-02（America/Chicago）。范围为工作区根目录后端及独立 Supabase 项目 `hrsrrduwbqxnqddkexoy`。本轮已部署数据库与 Edge Functions、创建演示账号并完成真实云端 HTTP 验收；未调用付费模型，也未发布前端。服务配置与执行证据以 [云部署记录](CLOUD_DEPLOYMENT.md) 为准。

本轮执行记录：**8 个测试文件、103 项测试全部通过**；TypeScript、两个 Edge Functions 的 Deno 检查和 Deno 运行冒烟通过。真实云端冒烟的 9 组检查全部通过，公共目录推荐和 GLB 导入也通过。核心配置预检成功，完整模式准确报告 6 项供应商配置缺失；未配置的付费能力没有被计为已验收。

## 本地测试与运行验证

| 检查 | 证据与覆盖 |
|---|---|
| TypeScript | `npm run typecheck`，严格类型检查 |
| PostgreSQL 迁移与业务 | `npm test`，在 PGlite 实际 PostgreSQL 引擎中创建 Auth/Storage 最小测试边界，执行全部业务迁移 |
| 成员与服务权限 | 匿名/登录角色不能直接读写业务表，不能直接调用业务/任务 RPC；非成员不可访问项目 |
| 编辑租约 | 第二用户/同用户第二会话拒绝；续期/释放；过期不可复活；代次变化使旧写请求失效 |
| 保存与版本 | 相同 revision 的两次竞争请求仅一次成功；旧版本不能覆盖；失效请求不修改云端场景 |
| AI | 两个布局模板、有限命令、锁定对象、边界校验；最多一次修复；本地版本/哈希、云端版本、租约改变使提案失效；一次应用返回撤销前快照 |
| 资产与分享 | 只有项目引用资源可被成员读取；复制后删除一个实例不删除共享资产；内部备注/私人平面图不出现在客户数据；发布不可变；撤销后的新读取失败 |
| 预算和任务 | 同幂等键复用同任务、不同指纹冲突；全局单并发；额度检查；worker token 防旧认领写入；超时不重新提交付费任务 |
| 模型 | 真实二进制 GLB 的 Khronos 验证、尺寸/偏移计算；格式损坏、扩展不兼容、任意下载域名和超限流拒绝 |
| HTTP | Request → 鉴权边界 → Zod → PostgreSQL RPC → Response 的项目/发布/撤销闭环；CORS、未知字段、缺少服务配置保护 |
| Worker HTTP | 方法、认证、缺配置返回 JSON 405/401/503，包含 no-store；错误认证或 provider 配置不会领取任务；异常响应不泄露凭据 |
| 供应商适配 | TokenHub 默认接口与 legacy 显式选择；合法请求格式、异常响应和一次 AI 修复均通过受控响应测试 |
| 配置预检 | core/full、精确 origin、公私钥混用、worker 密钥、费用与条款日期、演示邮箱/密码；安全解析 env，不执行其中的命令或 NODE_OPTIONS |
| Edge 编译 | `npm run check:edge`，两个 Deno 入口通过检查 |
| Deno 实际运行 | `npm run smoke:edge`，载入生产模块，运行 Khronos GLB 校验器并调用 health handler |

本节测试中的用户认证和 Storage 上传/签名使用测试替身，供应商响应受控。PGlite 单实例会串行执行请求，其竞争保存测试证明版本保护结果；真实平台认证、Storage 和独立 HTTP 请求竞态另在下节记录。尚未进行专门的数据库锁等待、死锁或负载压力验收。

## 真实云端 HTTP 与权限验证

[云端冒烟脚本](../../scripts/smoke-cloud.mjs) 对已部署的 Auth、PostgreSQL、Storage 和 Edge Functions 发起真实请求，不替换网络响应。运行命令为 `npm run smoke:cloud -- --write --remote`；该命令会创建并保留验收项目和资产，不调用付费模型。

| 检查组 | 已通过的实际结果 |
| --- | --- |
| 双账号登录 | 负责人、编辑成员均以独立密码完成真实 Supabase Auth 登录 |
| 基础鉴权 | health 200；匿名业务请求 401；非白名单 Origin 403；两账号均属于演示工作室 |
| 非成员隔离 | 临时非成员账号真实登录后，项目读取与写入被拒绝 |
| 并发租约 | 同一账号的两个独立 HTTP 会话竞争租约仅一方成功；另一成员被拒绝；续期成功 |
| 私有 Storage | PNG 上传与签名下载字节一致；匿名普通下载被拒绝；未引用私人资产被隔离 |
| 保存与资产引用 | 保存重开、旧 revision 拒绝、物料汇总、引用后成员资源授权通过 |
| 发布快照 | 匿名读取发布版本；内部备注与私人底图隐藏；后续草稿不改变已发布快照 |
| 编辑交接 | 释放后另一成员获得最新场景并保存，旧租约不能写入 |
| 分享撤销 | 撤销后匿名新访问返回 404 |

验收项目 ID：`6c59bbb1-b48c-4075-b161-01f288dcf769`。主验收临时非成员已删除、租约已释放、分享已撤销；项目与资产保留为证据。独立 HTTP 会话的竞态结果不替代浏览器两标签页的交互验收。

另已核验数据库权限：`anon`、`authenticated` 无 `scene_rpc` / `job_rpc` 执行权及 `scene_private` 使用权；`service_role` 有权。四份迁移保留原版本，两个 Edge Functions 为 ACTIVE v1，私有桶上限为 `10,485,760` 字节。

## 真实免费素材导入

本地 `npm run check:public-model` 使用真实公开 API 和模型文件，无固定测试返回，已有实测记录如下：

- 来源：[Poly Haven Chinese Armchair](https://polyhaven.com/a/chinese_armchair)。
- glTF + 1K 纹理打包为 GLB：**1,702,284 bytes**。
- 2,675 个三角面，1个 primitive，3张保留纹理。
- 包围盒尺寸 width=0.8482747674、height=1.5874828653、depth=0.7886627614（模型坐标单位）。
- Khronos 校验无 error，1条 warning；成功经 glTF Transform 读取并计算落地/中心偏移。
- 输出同时记录来源、CC0 页面和获取时间；该本地命令自身不上传文件。

本轮另通过真实云端 API 验证公共目录推荐返回 HTTP 200 / 8 项，`chinese_armchair` 导入返回 HTTP 201，`1,702,284` 字节 GLB 已经云端校验并归档到私有 Storage。浏览器 GLTFLoader 绘制、物理尺寸映射，以及模型加入编辑场景后的产品交互仍需前端验收；后续补测结果以云部署记录为准。

## 待完成与保留的验证边界

1. **供应商真实调用**：缺少 `DEEPSEEK_API_KEY`、`AI_MAX_REQUEST_CENTS`、`HUNYUAN_API_KEY`、`GENERATION_MAX_TASK_CENTS`、`HUNYUAN_TERMS_URL`、`HUNYUAN_TERMS_REVIEWED_AT`。TokenHub 适配已有受控测试，真实账号权限、模型生成、账单和结果质量尚未验证；本轮没有真实 AI 提案或 HY-3D 生成成功记录。
2. **定时轮询实际运行**：Vault 两项和每分钟 `scene-generation-poll` 已安装，当前 `active=false`。已实测 Vault→pg_net→worker 手动请求返回预期的缺配置 503，无超时；供应商填齐后再启用并验收实际定时触发、付费流程、异步归档与账单。
3. **前端与设备**：登录页、三维编辑器、客户 `/view/`、浏览器多标签页、离线/过期租约交互、单步撤销、资源释放、手机 FPS 与大陆网络耗时仍待联调。本轮未发布前端；Cloudflare 最终状态见 [独立域名记录](CLOUDFLARE_SETUP.md)。
4. **完整 Docker 本地栈及专项压测**：本轮未复验本地平台服务、Advisors 和数据库直连检查，也未进行锁等待/死锁专项或持续负载测试。该边界与已通过的远端服务验收分别记录。

后续填写凭据和启停 cron 见 [供应商配置指南](../PROVIDER_SETUP.md)，复验命令与恢复方式见 [部署说明](../DEPLOYMENT.md)。文档修订只同步已有执行证据，不代表重新运行这些服务检查。
