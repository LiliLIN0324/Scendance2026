# Aholo Lux3D 真调冒烟自检（2026-10-28）

> 仓：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`  
> 本机 machineId：`b33e3e92-e01a-447e-af22-578ac4323c98`  
> 时区：Asia/Shanghai (UTC+8)  
> 约束：用仓库根 `.env.local` 的 `LUX3D_API_KEY`（**未打印密钥**）；**未** git push / tag / commit。

## 总览

| 项 | 结果 |
|---|---|
| Lux3D API key + query | **PASS** |
| 下载 ZIP + 解包 GLB | **PASS**（task `4425274`） |
| 旧 task ZIP 复下载 | **PARTIAL**（`4424015` COS ZIP 过期；kujiale `textured.glb` 仍可下） |
| 新建 text 任务 | **未建**（优先 query 已知成功 task，省额度/耗时） |
| 产品代码门控 / Lux3D UI / agent 工具 | **PASS（代码在）** |
| `frontend/.env.local` 指向 | **远程 Supabase**（非 mock 3099） |
| mock-e2e（3099） | **PASS** |
| 产品入口「是否亮」真机 | **未证实**（前端指远程；capabilities 匿名探针 401；需登录云项目且 edge 配齐三键） |
| M3 前端（World 3DGS） | **未做**（API 已通，前端 loader/开关仍剩） |

## 1. Lux3D 真调（query 已知成功 task）

命令（仓库根）：

```text
node tools/aholo/lux3d-mvp.mjs query 4424015
node tools/aholo/lux3d-mvp.mjs query 4425274
```

### 1.1 task `4425274` — PASS

- `query` 瞬时 `status=3(成功)` → 证明 **key 有效**。
- 下载 `result.zip` 成功并解包。
- 证据目录：`docs/evidence/aholo/4425274/`
  - `result.zip` ~4.2MB
  - `unpacked/MODEL.glb` **881112** bytes，magic **`glTF`**（`67-6C-54-46`）
  - 另含 6 张 PBR PNG（Diffuse / FresnelIor / Reflect / ReflectGloss / Refract / RefractGloss）
  - `report.json`（含 outputUrls；含 ZIP + kujiale textured.glb）

### 1.2 task `4424015` — PARTIAL（key/query OK，ZIP 过期）

- `query` 同样 `status=3`，key OK。
- COS `result.zip` 签名过期 → 下载体为 XML `AccessDenied` / `Request has expired`（本地 `result.zip` 仅 484B，magic `3C-3F-78-6D` = `<?xm`）。
- 同响应内 kujiale `textured.glb` 仍可直下：`docs/evidence/aholo/4424015/unpacked/textured.glb` **5473124** bytes，magic **`glTF`**。
- 规划文档记载该 task 为 image-to-3D 历史成功证据；本次冒烟未重跑创建。

### 1.3 未新建 text 任务

按任务优先「query 已知成功 task」验证 key+下载+GLB；`4425274` 已完整覆盖，**未**再 `text "<短 prompt>"` 消耗额度。

## 2. 产品侧代码核对

### 2.1 `capabilities.aholoTextToModel` 门控 — 在

- `supabase/functions/_shared/generation-contract.ts`：  
  `aholoConfigured = Boolean(LUX3D_API_KEY && LUX3D_TERMS_URL && LUX3D_TERMS_REVIEWED_AT)` → 映射 `aholoTextToModel` / `aholoImageToModel`。
- 仓库根 `.env.local`：**三键均 PRESENT**（仅记长度，不记值）：API_KEY / TERMS_URL / TERMS_REVIEWED_AT。
- 前端消费：`frontend/lib/backend-session.ts` — `generationCapabilitiesSchema` 含 `aholoTextToModel` / `aholoImageToModel`（缺省 false）。
- 测试：`tests/aholo-lux3d.test.ts`、`tests/generation-lane.test.ts` 等有断言。

### 2.2 GeneratedModelLibrary Lux3D 区块 — 在

- `frontend/components/room-organizer/panels/generated-model-library.tsx`：
  - `luxReady = capabilities?.aholoTextToModel && !disabled && !cloud.writeBlocked`
  - 区块标题「Lux3D 生成（Aholo）」；控件「Lux3D 物料描述」/「Lux3D 参考图（可选）」/「用 Lux3D 生成」
  - 提交：`createGenerationJob(..., { provider: 'aholo' })`（有参考图则 `kind:'image'`）
- 组件测：`generated-model-library.react.test.tsx`（门控隐藏、提交 aholo、图生、空 prompt、失败保留草稿）。

### 2.3 agent `start_lux3d_model` — 在

- `supabase/functions/_shared/agent-runner.ts`：
  - schema / 描述 / progressLabel 均有 `start_lux3d_model`
  - **动态注册**：仅 `generationCapabilities(env).aholoTextToModel` 为真时进入工具列表
  - 执行路径按付费 jobs 创建（与规划一致）

### 2.4 `frontend/.env.local` 指向

| 变量 | 指向 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **远程** `https://wkhfvnzgopjdzxlmycks.supabase.co`（非 `http://localhost:3099`） |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 已配置（值未打印） |
| `NEXT_PUBLIC_GENERATION_ENABLED` / `AGENT_ENABLED` | 已配置 |

规划文案曾写「指向本地 mock」——**当前磁盘事实是远程**。本地 mock 联调需进程变量覆盖 `NEXT_PUBLIC_SUPABASE_URL=http://localhost:3099`（及 mock key）启动 frontend。

### 2.5 产品入口是否「亮」

| 环境 | 结论 |
|---|---|
| **代码路径** | 齐：capabilities → UI 区块 → agent 工具 |
| **mock 3099** | `GET .../generation/capabilities` 返回 `aholoTextToModel:true` / `aholoImageToModel:true` → **mock 下入口可亮**（仍受 `writeBlocked`/无云项目影响，规划已记） |
| **当前 frontend→远程** | 匿名 `GET .../generation/capabilities` → **HTTP 401**；未做登录态探针。入口是否亮取决于：**用户已登录云项目** + **Supabase Edge 已配齐三 LUX3D_*** + **非 writeBlocked**。本机根 `.env.local` 有三键 ≠ 远程 edge 一定有。 |

## 3. mock-e2e

本机原无 3099；冒烟中启动：`node mock-server.cjs`（listen 3099）。本机已有 frontend **:3000**，但 `.env.local` 指远程，**未**把 frontend 改绑 mock。

命令：

```text
node tools/aholo/mock-e2e.mjs
```

结果 **PASS**（exit 0）：

```text
create: queued aholo lux3d
poll … → ready
authorize: http://localhost:3099/mock-assets/...
added: added
list: 1 item: added
```

capabilities 探针：`aholoTextToModel:true`, `aholoImageToModel:true`。

（冒烟结束后 mock 进程可能仍在本机 3099；若不需要可自行停掉。）

## 4. 剩什么（尤其 M3 前端）

| 层级 | 状态 | 剩余 |
|---|---|---|
| M0 Lux3D API | 真调通过 | — |
| M1 provider + lane + 契约 | 代码+单测已有 | 远程 edge 密钥/条款是否与本地一致待登录证实 |
| T-AHOLO-UI ①② | 代码+测已有 | 云项目端到端「真额度出图进画布」待登录验收 |
| M2 image UI | 代码已有；API 历史 task 4424015 | 真机一张现场照片 E2E |
| **M3 Aholo World** | API 真调已通过（worldId `3FO4K4QI6N4V`，国内网关 `api.aholo3d.cn`） | **仅剩前端**：3DGS loader（PLY/SPZ）背景层 + 开关；`@mkkellogg/gaussian-splats-3d` 选型已评估 |
| M4 演示收尾 | 脚本草稿有 | M3 后补第③段；条款审阅后填 edge 环境点亮入口 |

## 5. 证据路径速查

- `docs/evidence/aholo/4425274/` — 本次完整 ZIP+GLB+PBR（主 PASS）
- `docs/evidence/aholo/4424015/unpacked/textured.glb` — 过期 ZIP 下的 GLB 兜底
- `docs/evidence/aholo/world-3FO4K4QI6N4V/` — M3 API 既有证据（本次未复跑）
- 本文件：`docs/AHOLO-SMOKE-2026-10-28.md`

## 6. Git

**未**执行 `git commit` / `tag` / `push`（用户要求未完项全过再更新 GitHub）。

---

## Edge secrets（2026-10-28）

项目 wkhfvnzgopjdzxlmycks 已写入 LUX3D_API_KEY / LUX3D_TERMS_URL / LUX3D_TERMS_REVIEWED_AT（值不入库）。云端登录态 E2E 与 M3 前端仍欠。
