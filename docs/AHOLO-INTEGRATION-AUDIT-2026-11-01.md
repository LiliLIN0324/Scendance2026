# Aholo 集成审计（2026-11-01）

> 范围：`frontend/components/room-organizer/` 下的 Aholo 前端层、`supabase/functions/` 下的 cloud provider 与生成 worker、`tools/aholo/` 本机直连代理、随站点发布的 3DGS 资产，以及 `docs/AHOLO-*` 现有文档与 `docs/evidence/aholo/` 证据。
>
> 方法：只读审计。逐文件读源码与实际行号；跑 Aholo 相关单测；本机启动代理做真实 HTTP 探测（不提交付费任务、不消耗额度）；用两个只读子审计交叉核对后端与工具链。未修改任何代码。
>
> 基线：`HEAD 5c2b6f3`（v3.0.1，合并本机活动列表与实时三维定格）。Aholo 代码本身已提交；工作区当前未提交改动与本审计无关（venue-picker、run-outcome 等）。

## 1. 结论

Aholo 在仓库里不是单个接口，而是**三条并行链路 + 一套本机直连代理 + 一批随站点发布的三维资产**。前端入口在 `/editor` 左轨「观感」（面板标题「场地观感与物料」），默认生产也显示，`NEXT_PUBLIC_LUX3D_RAIL=0` 才关闭。

| 能力 | 本机 dev | 生产 / 云端 |
| --- | --- | --- |
| Lux3D 物件（文字/图片 → GLB+PBR） | 真调可用（本机代理） | 代码有云端 provider；线上能力位与密钥是否配置未验证 |
| World 场景生成（3DGS） | 真调可用 | Edge 后端没有 World provider，只能挂 shipped 样例 |
| 场地重建（视频/照片 → 本场 3DGS） | 默认「干跑」不扣额度；关干跑才真调 | 退化为干跑/mock（本机代理要求 `NODE_ENV === 'development'`） |
| 3DGS 观感层预览 | Spark 渲染，可挂样例或本机产物，不参与碰撞 | shipped 3 个 `.spz` 可挂 |
| 本机生成资产进云端交付 | — | 未做：保存报 `LOCAL_ASSET_NOT_UPLOADED` |

一句话：**演示链路在本机成立且证据充分；云端交付断点（本机资产、World、真场重建）仍未通，属已知欠账。**

## 2. 三条链路

上游两个域名：Lux3D `https://api.aholo.ai/global`（物件），World `https://api.aholo3d.cn`（场景 / 重建）。

### 2.1 本机直连代理 `tools/aholo/lux3d-dev-proxy.mjs`

- 667 行，监听 `127.0.0.1:3199`，唯一真正打印 key 副本的地方就是它。
- 职责：网关转发（Lux3D / OUS 上传 / World 创建与查询）、**签名产物落盘换成稳定地址**（Aholo 产物 URL 是 ~2h 签名，过期即 403）、启动时按任务历史预热本机资产注册表、100 秒内失败只提示一次。
- 安全：`Host` 必须是 `127.0.0.1|localhost:3199`，浏览器 `Origin` 只放行本机 origin；响应里 key 脱敏成 `[REDACTED]`。
- 路由：`GET/POST /health`、`/text-to-3d`、`/image-to-3d`、`/task`（GET）、`/recon-upload`、`/world-recon`、`/world?worldId=`、`/asset/<uuid>.glb|.spz|.json|...`、`/meta?url=`。
- 已知缺口：`/meta` 只接受 `*.aholo3d.cn` / `*.aholo.ai` 的 https 链接；`/asset` 只服务本机已落盘资产；**代理没有本地 token 或频控**，同机任意进程都能借用。

### 2.2 前端层（`frontend/components/room-organizer/`）

| 文件 | 职责 | 关键点 |
| --- | --- | --- |
| `lib/aholo-assets.ts` | 本机资产注册表 + 直连判断 | `DIRECT_BASE = NEXT_PUBLIC_LUX3D_DIRECT_URL ?? http://127.0.0.1:3199`（L4）；`isLux3dLocalProxy()` 要求 `NODE_ENV === 'development'` 且该变量未显式关（L7-L15）；注册表存 localStorage，上限 40，`stashAsset` 只允许 https |
| `lib/aholo-model-placement.ts` | 资产 → 可摆放物料 / 场景源 | 用 lod-meta `forwardBox` 换真实米制尺寸；`scene` 资产走 splat 层而非实体；扁平阈值 0.08–0.06；`rv + velocity` |
| `three/splat-preview.ts` | 独立 Scene 的 Spark 3DGS 背景层 | 进场自动取景、退出还原机位；`LOD 根块截断`刻意未做；`scale = 1`（L207），依赖「World 产物是米制」这一假设 |
| `hooks/use-splat-preview.ts` | 预览生命周期 | 只读 `worldId`/`metaUrl`，不写回文档 |
| `panels/lux3d-direct-test.tsx` | 四页签：文字建模 / 图片建模 / 场景生成 / 场地重建 | 轮询 5s、20 分钟上限、历史只存元数据；「干跑」`useState(true)` 默认开（L544），真调需手动关掉并勾选扣额度确认（L310、L442）；capacity 面（L611-627）在生产只展示"挂样例"与"云链路"两条 |
| `lib/shipped-assets.ts` | 随站点发布资产清单 | 2 GLB + 3 SPZ（`3FO4K4QI6N4V`、`3FO4K4RI3SQE` 等），来自 `docs/evidence/aholo/` 真任务产物 |
| `lib/site-recon-mock.ts` | 干跑用的 mock | 只有确定性数据，不碰网络 |
| `panels/agent-panel.tsx` | 入口挂载 | `SiteCaptureCard`（L1493）、观感页签、点选物件 |

### 2.3 云端后端（Supabase Edge Functions）

取舍：**Aholo 云端 provider 只接入 Lux3D（物件），没有接入 World / 场地重建**；世界与重建在本机由代理直连，云端只服务布置后保存的现场感（shipped 资产）。

- `_shared/providers.ts:61` `aholoLux3d()`：裸 key 认证、25s 超时、2MB 响应上限、拒绝相对 URL。
- `_shared/generation-lane.ts:46`：`provider === 'aholo'` 显式走计量 lane，且按 kind 读 `aholoTextToModel` / `aholoImageToModel` 能力位；默认云 lane 仍是 HY-3D。
- `_shared/worker.ts:17`：任务固化 `provider_mode='aholo'` → 提交 → 30s 轮询 → 归档；**不重试提交**（提交失败进 `submit_unknown`，见缺陷 1）。
- `supabase/migrations/20261028120000_aholo_lux3d.sql`：`jobs.provider_mode`、`provider_job_id`、`usage` 列与唯一活跃索引。
- 生成入口：`lib/backend-generation.ts`（前端 POST `provider:'aholo'`）；`panels/generated-model-library.tsx` 的图片建模入口被 `aholoImageToModel` 门控，文字入口 `aholoTextToModel`。

## 3. 文件地图（Aholo 相关）

前端（`frontend/components/room-organizer/`）：
`lib/`：`aholo-assets.ts`、`aholo-model-placement.ts`、`shipped-assets.ts`、`site-recon-mock.ts`、`splat-venue-fit.ts`、`amd/amap-venue.ts`、`material-generate.ts`、`workbench-agent.ts`、`backend-adapter.ts`、`backend-generation.ts`。
`three/`：`splat-preview.ts`；`hooks/`：`use-splat-preview.ts`。
`panels/`：`lux3d-direct-test.tsx`、`aholo-guide-card.tsx`、`environment-preview.tsx`、`generated-model-library.tsx`、`generated-item-library.tsx`、`material-generate-dock.tsx`、`site-capture-card.tsx`、`amap-venue-picker.tsx`。
`lib/backend-session.ts` 定义 `provider_mode` 与能力位；根级 `frontend/app/` 无 API 路由，站点走 `functions/` Pages Functions + `frontend/wrangler.jsonc`。

后端：`supabase/functions/_shared/{providers,generation-lane,generation-input,generation-contract,agent-runner,worker,models}.ts`、`supabase/functions/generation-worker/`、迁移 `20261028120000_aholo_lux3d.sql`、测试 `tests/aholo-lux3d.test.ts`、`tests/agent-lux3d.test.ts`、`tests/generation-lane.test.ts`。

工具：`tools/aholo/lux3d-dev-proxy.mjs`（+ `lux3d-dev-proxy.test.mjs`）、`lux3d-mvp.mjs`、`world-mvp.mjs`、`mock-e2e.mjs`，以及一次性探测脚本 `ous-probe.mjs`、`ous-status-probe.mjs`、`ous-upload-test.mjs`、`world-probe.mjs`、`world-dl.mjs`、`world-restore.mjs`、`repair-verify.mjs`、`validate-issues.mjs`、`validate-probe.mjs`。

资产与证据：`frontend/public/showcase/assets/generated/`（manifest、`model/chinese-wood-armchair.glb`、`model/white-round-table.glb`、`scene/scendance-m3-mvp.spz` + `lod-meta.json` + `panorama.jpg`）；`docs/evidence/aholo/`（9 个真任务产物、3 个 World 场景的 ply/spz/lod-meta 全景）；`docs/visual-2026/shots/rail-aholo.png`。

文档：`docs/AHOLO-INTEGRATION-PLAN.md`、`docs/AHOLO-ASSET-AND-SPLAT-PREVIEW-2026-10-30.md`、`docs/AHOLO-CLOUD-E2E-2026-10-30.md`、`docs/T-AHOLO-ENTRY.md`、`docs/D1-CAPTURE-TO-AHOLO-2026-10-30.md`、`docs/D2-AHOLO-UX-2026-10-30.md`、`docs/visual-2026/aholo-product-gap-2026.html`。

## 4. 验证证据

### 4.1 单测（本机跑过，全绿）

| 套件 | 用例数 | 结果 |
| --- | --- | --- |
| 后端 `tests/aholo-lux3d.test.ts` | 7 | pass |
| 后端 `tests/agent-lux3d.test.ts` | 2 | pass |
| 后端 `tests/generation-lane.test.ts` | 10 | pass |
| 前端 `aholo-assets.test.ts` | 11 | pass |
| 前端 `aholo-model-placement.test.ts` | 15 | pass |
| 前端 `lux3d-direct-test.react.test.tsx` | 7 | pass |
| 前端 `site-recon-mock.test.ts` / `material-generate.test.ts` / `splat-preview.test.ts` / `splat-venue-fit.test.ts` | 6 / 3 / 11 / 5 | pass |
| 前端 `site-capture-card.react.test.tsx` / `generated-model-library.react.test.tsx` | 8 / 15 | pass |

合计 **100 项 / 12 个文件全绿**。注：本沙箱里 vitest 默认 forks pool 会因 spawn 受限失败（`EPERM`），需 `--pool=threads` 并加载 `--require .temp/skip-spawn.cjs` 垫片；正常终端直接 `npm test`。全量套件未跑。

### 4.2 本机代理实测（未消耗额度）

启动 `node tools/aholo/lux3d-dev-proxy.mjs` 后探测（探测完即停）：

- `GET /health` → `200 {"ok":true,"keyConfigured":true,"base":"https://api.aholo.ai/global","worldBase":"https://api.aholo3d.cn"}`。
- 伪造 `Origin: http://evil.example` → `403`；本机 origin 放行。
- `GET /task` 无参数 → `400`（taskid 不合法）；`GET /task?taskid=abc` → `502`（上游拒绝，属预期，因非真实任务号）。
- `GET /meta?url=http://example.com` → `400`（只放行 Aholo 域名）。
- `GET /asset/<不存在>.glb` → `404`（不伪造云资产）。

### 4.3 未验证（明确未做，不推断）

- 真实付费提交（任何会扣额度的 Aholo 调用）。
- 线上 Supabase 的 `aholoTextToModel`/`aholoImageToModel` 能力位、`provider_mode='aholo'` 任务实际跑通。
- 真场重建全链路（`/recon-upload` → `/world-recon` → 轮询 → 挂本场 `.spz`）。
- 浏览器端到端交互、生产构建产物中的观感左轨。

## 5. 缺陷清单

### P0（会挡演示或永久锁死用户）

1. **`submit_unknown` 永久锁死**（已修，见 §6；PR #48 + #49 待审）：`_shared/worker.ts:44` 在提交阶段出现任何非 `PROVIDER_REJECTED` 错误都记成 `submit_unknown`；DB 层没有认领该状态的路径，而它又占用「唯一活跃任务」索引 → 该用户此后所有生成请求返回 `GENERATION_BUSY`。修法：为 `submit_unknown` 加可恢复超时（如 5 分钟后允许新任务）或改为 `failed + errorCode='SUBMIT_RESULT_UNKNOWN'` 的可重试语义。
2. **生产没有 World / 真场重建**：Edge 后端无 World provider；`isLux3dLocalProxy()` 生产恒 false，面板在非本机浏览器只剩「样例」与「云链路」。演示在作者机器成立、在客户机器断。
3. **`LUX3D_BASE_URL` 语义冲突**：`_shared/providers.ts:62` 把它当 Lux3D 网关，`tools/aholo/world-mvp.mjs:9` 却当 World 网关（`api.aholo3d.cn`）。同一变量名两个上游，配错任一侧就是 401/404，排查成本高。

### P1

4. **生成状态机/计费一串缺陷**：预算只加不减（`usage` 只写不释放）、未知状态直接归入失败、归档条款缺失时每 30s 重试到 23h、只认 `Type === 'GLB'` 会丢弃 PBR zip、提交无重试上限、`aholoImageToModel` 与 text 同源没有独立门控。
5. **本机资产无法云端交付**：`frontend/components/room-organizer/lib/backend-adapter.ts:171` 抛 `LOCAL_ASSET_NOT_UPLOADED`（`l165` 查 `libraryAssetIds` 映射）→ 本机生成、已摆放的模型保存云项目会被拒。
6. **文档漂移**：`docs/AHOLO-ASSET-AND-SPLAT-PREVIEW-2026-10-30.md:20` 写「代理 195/195」，`tools/aholo/lux3d-dev-proxy.test.mjs` 静态只有 43 个 `test()`、183 条断言；gap 页仍把「生产隐藏观感左轨」列为欠账（当前默认生产显示，`NEXT_PUBLIC_LUX3D_RAIL=0` 才关）；`.env.example` 缺 `NEXT_PUBLIC_LUX3D_DIRECT_URL` 与 `NEXT_PUBLIC_LUX3D_RAIL`。
7. **构建脚本与静态导出不匹配**：`frontend/next.config.mjs` 的 `rewrites()`（`/introduction` → `/introduction.html`）只为 `next dev` 服务，在 `output:'export'` 的静态产物里不生效（注释已说明，属冗余而非错误）；但 `frontend/package.json` 的 `"start": "next start"` 与静态导出冲突，`npm start` 会直接报错，部署应走 Pages 静态托管。
8. **两个同名「重建」入口**：创意工作台的 `panels/reconstruction-panel.tsx`（后台重建 job，与 Aholo 无关）与 Aholo 场地重建都叫「场地重建」，用户与文档都容易混。

### P2

9. 代理无本地 token / 频控，同机任意进程可借用付费额度（唯一闸门是 Host/Origin）。
10. `three/splat-preview.ts:207` 硬编码 `scale = 1`，依赖「World 产物为米制」；真场上限/下限未复核。
11. 重建任务复用 `/world?worldId=` 轮询（代理转 `world/v1/{id}`）；重建详情端点是否同一路径**未跑真场验证**。
12. 10 个一次性脚本未归档；`tools/aholo/world-dl.mjs` 硬编码已过期 COS 链接与 taskid。

## 6. 进展记录

**2026-11-01 晚：P0-1 已修（待审）。**

- 后端 PR [#48](https://github.com/LiliLIN0324/Scendance2026/pull/48)：`supabase/migrations/20261101120000_submit_unknown_recovery.sql` 把 `job_rpc` 改名为 `job_rpc_generation_v2`，新 `job_rpc` 增加两个出口：`jobs.resolve_unknown`（owner 显式释放，供支持按用量页核对后执行）与 `jobs.claim` 的 10 分钟宽限清扫（→ `failed / SUBMIT_RESULT_UNKNOWN_EXPIRED`，对应 `requests` 置 failed）。`tests/jobs.test.ts` +2 例。
- 自动释放依赖 worker 每分钟被调用：`supabase/ops/install-generation-cron.sql:10` 定义了 `scene-generation-poll` 的 `* * * * *` 调度（此前审计误记为「仓库里没有 ops」——该文件存在，但需确认线上 cron 已安装且 `active`）。
- 前端 PR [#49](https://github.com/LiliLIN0324/Scendance2026/pull/49)：任务面板对「11 分钟内的 `submit_unknown`」继续 30s 轮询，后端释放后自动显示「生成失败」，不再需要手动刷新；超过窗口的行仍视为终态，不会无限轮询、不会重试生成。

## 7. 建议的下一步

1. 审并合并 P0-1 的两个 PR（#48 后端、#49 前端；#49 需 #48 才有可见效果）。
2. 由 owner 确认额度后，真场重建跑一次真调，验证 `/recon-upload → /world-recon → /world` 轮询 → 本场 `.spz` 挂载与重建详情端点。
3. 补 World provider，或明确「M3 只做前端演示」并在文档撤销「生产隐藏左轨 / 195 测试」两处过时说法。
4. 若要云交付：把本机 `.glb/.spz` 上传 Supabase Storage → `assetId`（`backend-adapter.ts` 已有映射口子，缺上传端与迁移）。
5. 代理加 `LUX3D_PROXY_TOKEN` / 频控；one-off 脚本归档；删掉无效的 `rewrites()` 与 `start`。

---

审计人：DSH 助理（只读）。本文件只记录事实与证据位置，不含任何付费调用结果。