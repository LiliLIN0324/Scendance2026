# Lux3D 生成闭环复核与最小补齐（2026-11-18）

## 一句话结论

代码侧能自己做的缺口今天补完了：**排队卡住时人能看懂原因**、**触发器脚本能装得成且装完能自证**、
**体积分档与账本迁移都确认还在 main 上**。
生产侧仍缺最后一步人工运维——**Vault 放两个 secret + 执行 install-generation-cron.sql**。
本轮**没有开新单**：无凭据进不了正式站账号，且触发器未装的话新单只会再停一次 `queued` 并再扣一次额度。

## 一、今天对正式站的只读核对（未点生成、未建任务）

基线：`origin/main` = `1fdeb367`（含 #155 物料清单报价、#167 落位预览、#166 漫游钮），
新分支 `agent/lux3d-generation-closure` 从它拉出，不基于 #151、不碰丽丽未合并的 PR。

| 项 | 命令 / 做法 | 实测结果 | 判读 |
| --- | --- | --- | --- |
| 正式站可达 | `GET https://scendance-scene-planner-ewz.pages.dev/` | 200 | 站点在线 |
| 编辑器壳可达 | `GET /editor?project=99acd050-…` | 200，标题「活动布置工作台」，正文「正在核对本机恢复状态」 | 路由正常 |
| worker 是否部署 | `POST /functions/v1/generation-worker`（无 Authorization） | **401 `{"error":"UNAUTHENTICATED"}`** | 已部署；且 `GENERATION_WORKER_SECRET` 已配（缺它会先抛 503 `SERVICE_NOT_CONFIGURED`） |
| 能力接口 | `GET /functions/v1/scene-api/generation/capabilities` | 401 | 匿名读不到，必须登录态 |
| 体积上限代码 | `_shared/models.ts` `MAX_PROVIDER_GLB_BYTES` | 32 MiB | 在 main 上 |
| 体积上限迁移 | `supabase/migrations/20261118160000_provider_asset_size_ceiling.sql` | 存在：assets CHECK + storage bucket 一起放宽到 33554432 | 在 main 上；**是否已应用到生产库未验证** |
| 触发器代码 | 全仓 grep `pg_cron` / `pg_net` / `net.http_post` | 只在 `supabase/ops/install-generation-cron.sql` | 触发器是**人工运维脚本**，不会随迁移自动上 |

**没验证到的（如实说明）**：生产库的迁移应用情况、cron 是否已装、有没有卡住的 `queued`、有没有可复用成功产物。
这些都需要 service_role / Dashboard SQL 权限；本轮没有可用凭据，`ci` 也没有对应流水线。

为此新增了一条**只读**体检脚本，把这四问一次问完（见下）。

## 二、本轮改动

1. `frontend/components/room-organizer/lib/generation-failure.ts`
   - 新增 `generationProgressText(job, now)`：排队 ≥3 分钟直接说
     「后台生成服务没有接单（生产环境缺触发器或 worker 未部署）……不是描述写错；先不要重复提交」；
     处理态 ≥40 分钟给一次兜底提示。没有 `created_at` 就不猜。
   - 供应商原话映射补 `BIZ_14001`：国内 key 打到国际网关时，指向 `https://api.aholo.cn`，
     而不是让人误以为「钥匙无效」去换 key。
2. `frontend/components/room-organizer/lib/facility-generated-models.ts`
   - 云端取件原来只显示 `云端生成中 · queued`；现在把上面的判断拼进同一句，
     设施面板能直接看出「这是运维没接单」。终态标记逻辑不变，不会因此重提。
3. `supabase/ops/install-generation-cron.sql`
   - `pg_net` 去掉 `with schema extensions`（pg_net 自身固定 `schema=net`，带 schema 子句会在部分项目
     直接报错中断整个脚本），装完校验 `net` schema 存在。
   - Vault 检查从「行数 = 2」改成「**去重后的 name 数 = 2**」：旧写法同名存两遍也能过，
     随后取不到 `scene_worker_secret`，cron 用空密钥每分钟 401——比装不上更难查。
4. `supabase/ops/verify-generation-closure.sql`（新增，只读）
   - ① 扩展 ② Vault 键名与长度 ③ cron 任务 ④ 最近 5 次 `net._http_response`（200 / 401 / 000 分别代表通、
     secret 不一致、没部署）⑤ 三道体积闸门 ⑥ 任务分布、最近 10 单、卡住 >10 分钟的任务、
     `source='aholo'` 的可复用产物、未结算请求数。
5. 测试：`generation-failure.test.ts` 补排队/处理/无时间/终态/BIZ_14001；
   `facility-generated-models.test.ts` 补「排队卡住不落终态、带人话到面板」。

## 三、还差的运维步骤（给终树，按顺序）

1. **Vault 放两个键**（Dashboard → Project Settings → Vault，或 SQL）：
   - `scene_project_url` = `https://wkhfvnzgopjdzxlmycks.supabase.co`（无尾斜杠、无 path）
   - `scene_worker_secret` = **与 Edge Function 的 `GENERATION_WORKER_SECRET` 完全一致**
2. **执行 `supabase/ops/install-generation-cron.sql`**（Dashboard SQL Editor 全文）。
   末尾会回显 `jobid / schedule='* * * * *' / active=true`；重复执行会先 unschedule 再建，不会堆两条。
3. **应用迁移 `20261118160000_provider_asset_size_ceiling.sql`**（若尚未应用）。
   它同时改 `assets.byte_size` CHECK 与 `storage.buckets.file_size_limit`，缺一个 10.06 MiB 产物仍进不来。
4. **重新部署 `generation-worker` 与前端**，然后执行 `verify-generation-closure.sql` 逐段核对。
5. 再跑一单。判断标准：`state=ready` + `asset_id` 非空 + 户外 3D 里是这件模型而不是灰占位。

## 四、本地验证补记（2026-11-18）

| 跑什么 | 命令 | 结果 | 证明什么 |
| --- | --- | --- | --- |
| worker 全链 | `npx vitest run tests/worker-http.test.ts tests/models.test.ts` | **24 passed**（12 + 12） | 含「供应商产物 10.06 MiB 超过 10 MiB 导入档仍能归档 → 资产入库 → 任务 ready」与 32 MiB 档的拒收边界 |
| 生成面板 | `npx vitest run components/room-organizer/panels/generation-sheet.react.test.tsx` | **8 passed** | `data-testid="generation-sheet"`、属性卡入口「用于「沙滩椅」」、额度确认与 unknown 锁都在 |
| 设施取件 | `npx vitest run components/room-organizer/lib/facility-generated-models.test.ts` | **28 passed** | 含本轮新增的「排队卡住不落终态、带人话到面板」 |

> 这三条在默认 `NODE_OPTIONS` 下会先报 `localStorage is undefined`：Node 26 自带 `localStorage` 全局（未带 `--localstorage-file` 时为 undefined），遮蔽了 jsdom 的实现。
> 本地加 `NODE_OPTIONS=--localstorage-file=<临时文件>` 后全绿；这是运行环境差异，不是本轮代码问题。

## 五、本轮刻意没做

- 没有开新单、没有点生成：无正式站登录凭据，且触发器未装时新单只会再停 `queued` 并可能再扣一次额度。
- 没改 #151/#167/报价/设置页，没碰室内保活容器（R2/R3），没新接 Aholo 其它能力。
- 没把 cron 写成自动迁移：它依赖两个只有运维知道的 Vault 值（其中一个是 Edge Function secret），
  写成迁移会让整个 db push 因为缺 secret 失败，也会绕过 review。
