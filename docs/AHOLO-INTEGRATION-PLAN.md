# Aholo 集成宏观规划(v1,2026-10-28)

本文是 **Aholo(群核科技)Lux3D / World API 接入幕景 Scendance2026** 的总入口规划,遵循仓库规格纪律:`docs/` 是规格真相,一张卡一次做完,分支开发、合入由人。

## 0. 背景与目标

参赛要求使用群核科技 **Aholo Lux3D**(必选),可选 **Aholo API**(3D 物体生成 / 世界生成 / 云渲染 / 重建)与 **LuxReal**(视频 Agent)。

我们的两个真实需求:

| # | 需求 | 对应 Aholo 能力 | 输出格式 |
|---|---|---|---|
| 1 | 图片场景转模型 + 单物体 3D 资产生成 | **Lux3D**:image-to-3D / text-to-3D | GLB + PBR 贴图(ZIP 下载,URL 有效期 ~2h) |
| 2 | 场景/氛围级生成(一段话生成整个场地) | **Aholo World**:3DGS 世界重建与生成 | 3DGS(高斯泼溅,非 GLB) |

判定:**Lux3D 是主链路**(必选指标 + GLB 直进现有管线);**Aholo World 是加分项**(演示"文字生成整个场地氛围",独立视图呈现,不混入布局编辑场景);LuxReal 暂不接入,留到最终展示视频阶段再评估。

## 1. 现状盘点(接入点)

仓库已有一条云生成链路(见 `docs/3D-GENERATION-UPGRADE-PLAN.md`):

- `supabase/functions/_shared/providers.ts`:HY-3D provider(tokenhub/legacy 双模式),`GenerationProvider` 抽象(submit → query → download)。
- `supabase/functions/_shared/generation-lane.ts`:生成路由 `parametric → offline → library → hy3d(metered)`,免费通道优先。
- 资产语义:`_shared/models.ts` validateModel + 指纹去重 + 质量 门禁。
- 前端:`frontend/components/room-organizer/`,GLB 资产经 backend-adapter 进入画布;`frontend/.env.local` 指向本地 mock(3099)。

**Aholo 的接入形态 = 新增一个 provider(`aholo-lux3d`),挂进现有 lane 路由与资产语义**,不新开平行链路。这是规划的第一原则。

## 2. 关键事实(已核实的官方口径)

- Lux3D API 文档:<https://labs.aholo.ai/api-docs/en/skills/lux3d>;认证 `Authorization: <LUX3D_API_KEY>`(labs.aholo.ai/api-keys 申请)。
- 流程:创建任务(image/text 两个创建端点)→ 轮询 `query_task_status` → 下载 ZIP(GLB + PBR 贴图)。
- text-to-3D 可带 style、参考图(data URL)。
- Aholo World:输出 3DGS,走国际网关 `api.aholo.ai`;前端渲染需 3DGS 查看器(官方 Aholo Viewer / .sog 格式,或社区 three.js 3DGS loader)。
- 定价/额度未公开,需邮件 lux3d@qunhemail.com 咨询 → MVP 阶段顺带验证配额。

## 3. 阶段规划

### M0 — MVP:API 通不通(本卡先做)

- **产物**:`tools/aholo/lux3d-mvp.mjs`——零依赖 Node 脚本,走完 text-to-3D 全链路:创建任务 → 轮询 → 下载 ZIP → 解包 GLB → 打印报告(模型面数/体积/耗时)。
- **验收**:拿到 API key 后一条命令跑通,产出 1 个真实 GLB 存入 `docs/evidence/aholo/`;记录真实耗时、额度、GLB 是否可直接被 three.js 加载。
- **不做**:不改任何产品代码,不接 provider。

### M1 — Lux3D 进 provider 层(需求 1 主链路)**已有(2026-10-28,分支 `feat/aholo-lux3d`)**

- `_shared/providers.ts` 新增 `aholoLux3d(env, fetcher)`,submit/query 与 HY-3D 同形(worker 可互换消费);`generation-lane.ts` 新增 `aholo` metered 通道,**仅当请求显式声明 `provider:'aholo'` 时进入**,默认云通道仍是 HY-3D;`generation-contract.ts` capabilities 新增 `aholoTextToModel/aholoImageToModel`(由 `LUX3D_API_KEY`+terms 配置门控)。
- 迁移 `20261028120000_aholo_lux3d.sql`:generation_jobs 的 provider 约束扩到 `aholo`/`lux3d`(aholo↔lux3d 强绑定,texture 拒绝),assets.source 增 `aholo`;job_rpc 校验包装器重建,直调原始 RPC。
- worker:按 job 上固化的 `provider_mode` 选厂商(任务创建时锁定,配置漂移不影响旧任务);下载域白名单 aholo 任务加 `.kujiale.com`;license/source 记 Aholo 侧条款;资产 metadata.generation 带 `providerMode:'aholo'` 保证参赛可追溯。
- 验收已达成:`npx vitest run` 680/680 全绿(含新增 `tests/aholo-lux3d.test.ts` 7 条:capabilities 门控、lane 显式声明、job 固化、submit/query 形状、状态映射、壳错误、端到端归档),`npm run typecheck` 通过。前端入口(M2 前置)与 mock(3099)接入待做。
- M1 尾款 **已有(2026-10-28)**:前端 lib 层贯通——`createGenerationJob` 接受 `provider` 选项并进请求体(legacy 文本请求体保持不变),`generationCapabilitiesSchema` 消费 `aholoTextToModel/aholoImageToModel`(旧后端缺字段时按 false),job 响应枚举放行 `aholo/lux3d`;`3D-GENERATION-UPGRADE-PLAN.md` 现状表补 `aholo` 通道。`.env.example` 占位已加。mock(3099)不加生成端点——生成是 supabase 后端特性,等 UI 卡一起在 dev 链路验证。
- **T-AHOLO-UI 形态①已有(2026-10-28,用户授权自治执行)**:GeneratedModelLibrary 面板新增独立"Lux3D 生成(Aholo)"区块——仅当 capabilities.aholoTextToModel 亮起时渲染;标签为 `Lux3D 物料描述`/`用 Lux3D 生成`,与已退役的 HY3 控件标签(`生成方式`/`物料描述`/`生成 3D 模型`)刻意区分,原退役裁决测试保持通过;提交走 `createGenerationJob(prompt, requestId, {provider:'aholo'})`,空 prompt 本地拦截,失败不清空草稿、错误上屏。新增 4 条组件测试(13/13 绿);`createGenerationJob` options 放宽为 Partial。
- **T-AHOLO-UI 形态②已有(2026-10-28,用户授权自治执行)**:agent 工具链新增 `start_lux3d_model`——**动态注册**,仅当 capabilities.aholoTextToModel 亮起才进入工具列表,模型永远不会向不可用的厂商许诺;执行走与 `/jobs` 路由完全相同的付费路径(prepareGenerationRequest + jobs.create + GENERATION_MAX_TASK_CENTS 预算预留);系统提示与工具描述钉死诚实性:候选方案不得包含刚提交的物件、不得声称已布置,任务完成后由用户在历史模型面板手动加入。新增 2 条测试(工具可见性门控 + 付费路径落库 aholo/lux3d/queued);全套 682/682 绿。
- **Dev 实测已有(2026-10-28,commit 66d5990)**:mock(3099) 补齐生成端点(GET /generation/capabilities、POST/GET /jobs 生命周期、POST /jobs/:id/added);浏览器真实 UI 验证:任务卡渲染(zod 契约解析通过)、状态机 queued→…→ready→added 流转、无云项目时 writeBlocked 正确隐藏 Lux3D 表单并禁用"加入场地预览"——门控符合设计;HTTP 探针 `tools/aholo/mock-e2e.mjs` 可随时复验。注意 `frontend/.env.local` 现指向远程 Supabase,本地 mock 联调需以进程变量覆盖 `NEXT_PUBLIC_SUPABASE_URL` 启动 dev。

### M2 — 图片转模型入口(需求 1 完整形态)

- **API 前置验证已通过(2026-10-28,task 4424015)**:`img-to-3d` 接受 data URL 直传本地图片(无需先走 Asset 上传接口),~5 分钟出 MODEL.glb(1.2MB)+ 6 张 PBR;证据 `docs/evidence/aholo/4424015/`。后端 provider 的 image 路径与 lane 路由已在 M1 就绪。
- **UI 已有(2026-10-28)**:T-AHOLO-UI 形态①区块加"Lux3D 参考图(可选)"上传入口(PNG/JPEG ≤5MB,走既有 `uploadGenerationReference`),选中后提交即以 `kind:'image' + referenceImageAssetId + provider:'aholo'` 进入图生通道,提交后清空参考图;组件测试覆盖(14/14 绿)。用户上传场地/物件照片 → Lux3D image-to-3D → GLB 入资产库 → "加入场地预览"全链路代码闭环,待云项目环境(条款+额度)做端到端真机验收。
- 验收:一张真实场地照片端到端生成、进入画布、可布置可导出。

### M3 — Aholo World 场景生成(需求 2,加分项)

- **真调已通过(2026-10-28,worldId 3FO4K4QI6N4V)**:world 服务**走国内网关 `api.aholo3d.cn`**(国际网关对该 key 返回 BIZ_14001——key 本是国内平台账号,重要环境事实)。室内宴会厅提示词 → 约 15 分钟 SUCCEEDED → 产物 PLY 17MB / **SPZ 4.3MB(web 友好)** / LOD 元数据 / **全景图 panoUrl** / upAxis=Z,全景图质量佳(证据 `docs/evidence/aholo/world-3FO4K4QI6N4V/`,含 panorama.jpg)。续查:`node tools/aholo/world-mvp.mjs query <worldId>`。**M3 剩余工作仅剩前端接入**(3DGS loader 背景层 + 开关),API 侧无任何阻碍。
- 前置评估(卡内第一步):**已确认两项(2026-10-28)**——①loader 兼容:前端 three 0.186.0,`@mkkellogg/gaussian-splats-3d` 0.4.7(peer three>=0.160)兼容,且 World 输出是 **PLY/SPZ**(非 sog),该 loader 原生都吃;②**真调被账号挡住**:key 认证通过、资产服务正常签发 ousToken,但 `POST /world/v/generations` 返回 `BIZ_14001 user not exists`——World/SpatialGen 后端没有该账号的用户记录,**需开通**(诊断脚本 `tools/aholo/world-probe.mjs`,生成脚本 `tools/aholo/world-mvp.mjs` 已就绪,开通后一条命令复验)。另:官方明确室内场景成熟、非室内为 Beta,与我方场景吻合。
- **给用户/官方的行动项**:用同一账号登录 www.aholo.ai 消费端一次(可能补建用户画像)或邮件 lux3d@qunhemail.com 申请开通 world 生成权限;开通后跑 `node tools/aholo/world-mvp.mjs "<室内场景描述>"` 完成验证。
- 验收:一段场景文案生成 3DGS 背景并在画布上可见;有开关可关闭。

### M4 — 收尾(参赛交付)

- 演示链路串词:①文字生成物件(Lux3D text-to-3D)→ ②照片转模型(image-to-3D)→ ③文字生成场地氛围(Aholo World)→ ④布置/评审/交付。
- 视频需求出现时再评估 LuxReal。
- **演示脚本(2026-10-28 起草,待 M3 后补第③段)**:
  1. **一句话生成物件**(形态①/②):晴光对话说"给我生成一个雕花木质讲台"→ agent 调 `start_lux3d_model`(或物料工具面板直接填"Lux3D 物料描述")→ 数分钟后历史模型面板出现任务 → 设尺寸 → "加入场地预览"。话术点:展示了 Lux3D 深度集成进产品决策流(agent 只在能力位亮起时才承诺该能力)。
  2. **照片转模型**(M2):物料工具 → Lux3D 区块 → 传一张现场桌椅照片 + 一句补充描述 → 提交 → 同链路加入场地。话术点:image-to-3D 真链路已验证(task 4424015,~5 分钟)。
  3. **参赛可追溯性**:资产元数据带 `providerMode:'aholo'`/`providerModel:'lux3d'`、`source:'aholo'`——评审可查证"确实用了 Lux3D",不是贴牌。
  4. (M3 后)文字生成场地氛围 3DGS 背景层。
- **条款 URL 已核实**:<https://www.aholo.ai/agreement/termsofuse>(隐私政策:https://www.aholo.ai/agreement/privacypolicy)。用户审阅后将其填入 `LUX3D_TERMS_URL`、审阅日期填入 `LUX3D_TERMS_REVIEWED_AT` 即可点亮全部产品入口。

## 4. 硬钉(沿用并新增)

- 沿用:规格真相在本地 docs;一次一张卡;分支开发合入由人;不伪造成功(失败返回真实错误码);provider key 只在服务端。
- 新增:参赛指标要求"用了 Lux3D"必须**可追溯**——生成资产元数据必须带 `lane: 'aholo'` + `providerModel`;Aholo World 的 3DGS 永远是背景/展示层,禁止参与布局几何与碰撞;M0 未验证通过前,M1 不动 providers.ts。

## 5. 风险与预案

| 风险 | 预案 |
|---|---|
| LUX3D_API_KEY 拿不到 / 无额度 | 邮件申请尽早发;M1 的 provider 代码可先行 + 单测 mock,真实调用延后 |
| Lux3D 生成质量不达"布置级" | MVP 阶段多测 3 类物件(桌/椅/装饰),不行就只用于氛围装饰件 |
| 3DGS 渲染成本高 | M3 首日先做 loader 技术验证,不达标降级静态查看器 |
| 结果 URL 2h 过期 | provider 下载后立即转存自有存储(现有落库路径),不存外链 |
