# tools/aholo · Aholo 采集 / 重建 / 上传 / 验收脚本

本目录是 Aholo（Lux3D / World / web-scan / OUS）的**离线本机工具集**：把照片、视频、提示词变成资产，
再把产物压到门禁能接受的尺寸推上 R2 与随包库，最后目检复核。**不进产品构建**，产品链路的 Aholo
通道在 `supabase/functions/_shared/providers.ts`（M1 起）。

先读 `BATCH-NOTES-20261119.md`（2026-11-19 批次实录：14 件、净耗 280 credits、未完成清单），
再按下面四段找脚本。所有脚本用 `node tools/aholo/<脚本>.mjs` 在**仓库根目录**运行——
产物路径都是相对仓库根写死的。

## 公共底座（其余脚本共用）

| 文件 | 做什么 | 入口 |
|---|---|---|
| `lux3d-dev-proxy.mjs` | 本机直连代理，密钥只留在后端进程里。`GET /health`；`POST /text-to-3d`、`/image-to-3d`、`/world`；`GET /task`、`/world`；`POST /asset` 把会过期的签名产物落到本机，`GET /asset/<id>.<ext>` 稳定回源 | `node tools/aholo/lux3d-dev-proxy.mjs`（直接运行才读仓库根 `.env.local`，监听 `127.0.0.1:3199`） |
| `lux3d-dev-proxy.test.mjs` | 上面代理的测试（195 pass）。根 `npm test` 的 include 只有 `tests/**`，**跑不到它** | `node --test tools/aholo/lux3d-dev-proxy.test.mjs` |
| `lib/web-scan.mjs` | web-scan v1 公共客户端：鉴权、重试、日志脱敏（key 只打前 6 位）、产物下载 | 非独立入口，被 `scan-chain` / `upload-scan` / `job-scan` / `fetch-artifacts` 复用 |

## 一、采集

把照片、视频、远端素材拿进来，或先把远端任务建起来。

| 脚本 | 做什么 | 入口 |
|---|---|---|
| `scan-chain.mjs` | web-scan（Reality 2.0）全链：建 reconstruction → 逐张 PUT 图片（带 sequence）→ 等预处理 → 建 job → 轮询 → 记录产物。与 `recon-chain.mjs` 的 world/v1 那套互不影响 | `--probe`；`--dir <图片目录> [--limit 20] [--name x] [--mode scene] [--download spz]` |
| `upload-scan.mjs` | 照片上传器：按 sequence 逐张 PUT，带重试、断点续传、并发上限与进度 | `--dir scene-3d --out <目录>`（同目录重跑=续传，`--fresh` 新开重建） |
| `job-scan.mjs` | 作业客户端：建 job → 只按 status/stage 轮询 → 成功列产物，失败原样抛 error | `--pid <reconstructionId> --out <目录> [--quality fast\|high] [--steps 30000] [--timeout-min 90]` |
| `fetch-artifacts.mjs` | 按 `job.json` 里的 href 下载 ply / spz / scale.json，流式打印真实字节与耗时 | `--out <目录> [--only spz,ply]` |
| `fetch-sit-clips.mjs` | 经本机 3199 代理提交 retarget，轮询完成后取回三条坐姿动画 GLB（只与本机代理通信，不接触密钥） | `node tools/aholo/fetch-sit-clips.mjs [--proxy http://127.0.0.1:3200] [--rig <GLB>] [--clips ...]` |

## 二、重建（生成）

| 脚本 | 做什么 | 入口 |
|---|---|---|
| `recon-chain.mjs` | 真实场地重建链：逐文件先入库（拿资产 ID）→ 建 reconstruction → 轮询 → 取 spzPath 落盘；每步 HTTP 状态写 `chain-report.json` 与 `chain.jsonl` | `--video <MP4>`；`--frames <目录> [--limit 20]`；`--query 3FO4K4RKK337` |
| `lux3d-mvp.mjs` | 文生 / 图生 3D 全链（M0 验证）：建任务 → 轮询 → 下载 ZIP → 解包 GLB → 报告 | `text "一张白色圆桌" [--style cartoon] [--version G1]`；`image <URL 或本地路径>` |
| `world-mvp.mjs` | World（3DGS 世界生成）M3 验证。world 服务走国内网关 `api.aholo3d.cn`（国际网关对该 key 返回 `BIZ_14001 user not exists`） | `"<室内场景描述>"` |
| `lux3d-batch.mjs` | 批量文生 3D runner（临期积分批量补库用）：读 manifest → 并发建任务 → 轮询终态 → 下载 GLB/ZIP → 写 `state.json`，可断点续跑。产物落 `.cache/aholo/batch-<date>/`，不登记物料库 | `--dry-run`；`--concurrency 3 --limit 20`；`--only <slug>`；`--shard 1/3` |
| `people02-chain.mjs` | 人物链：多模态生参考图 → 审图 → 单图四视图 → G1 图生 3D。分步执行，参考图要过人审再进下一步 | `refimage --out <dir>`；`fourview --out <dir> --img <文件\|URL>`；`img3d --out <dir> --img <...>`；`get --out <dir> --taskid <id>` |
| `probe-animation-ids.mjs` | 零成本探 LUX3D 动作库里到底有哪些 id：每次提交 [候选, 哨兵]，报错点名谁就能反推候选是否在库；整单必然失败，不生成任务、不扣 credits | `[--words Sit,Seated,SitDown]` |
| `world-probe.mjs` | 一次性探测（国内网关 world 创建 + lux3d 任务列表只读），只打 HTTP 状态与响应体前 400 字符。无可调参数，留着是当时排查 M3 的现场记录 | `node tools/aholo/world-probe.mjs` |

## 三、上传（加工并推出去）

从压缩、合并、清单、LOD 到 R2 与随包库。**顺序有依赖**：`merge-person-clips` / `compress-people` →
`people-manifest`（`build-sit-assets` 把这条加坐姿的线串成一条命令）；`ingest-prep` → `recompress-nomeshopt`（如需）→
`ingest-register`；`make-lod` → `r2-upload-scan-lod`。

| 脚本 | 做什么 | 入口 |
|---|---|---|
| `ingest-prep.mjs` | 批次产物入库预处理（只碰本地缓存）：取有 `model.glb` 的条目 → `@gltf-transform/cli optimize` 压到 `--out` → 复测体积 / sha256 / 三角面 / 世界包围盒 / 结构门禁 → 写草稿清单 `aholo-ingest-20261119.json` | `--dry-run`；`--preset far` |
| `recompress-nomeshopt.mjs` | 把 raw 原件重压成目录门禁能接受的格式：改走 `--compress quantize`（去 meshopt），保留 WebP 与 far 削面，几何尺度不变。**上一版用 meshopt 的产物会被 `scripts/library-model.ts` 判 `UNSUPPORTED_MODEL_FEATURE`** | 无参批量；`--only <slug>` |
| `ingest-register.mjs` | 目检通过后登记进静态随包库：校验 sha256/字节与草稿一致、缩略图 WEBP 魔数 → GLB 复制到 `library/model/`、webp 到 `library/thumb/` → 并入 `incoming-extra.json` 与 `labels.zh.json`（按 slug 去重覆盖，保 `repairs`）。**不重建 `merged.json`**，那一步归 `scripts/build-model-library.mjs` | `--dry-run`（只校验不写库） |
| `compress-people.mjs` | 人物 GLB 批压缩：meshopt + `KHR_mesh_quantization` + WebP + 动画重采样。`hero` 档不削面、贴图 2048；`far` 档削面、贴图 1024 | `--out DIR [--preset hero\|far] [--id <assetId>] [--texture-size 512]` |
| `merge-person-clips.mjs` | 把动作 clip 按**骨骼名逐一匹配**合并进人物 GLB（27 个漫游角色共用 Mixamo 52 骨）。同名 clip 默认跳过，除非 `--overwrite`；只写 `--out`，不动 `--from` 原件 | 用法见脚本头注释 |
| `build-sit-assets.mjs` | 坐姿资产总装：合并 → 两档压缩 → 结构校验 → 重生成清单，一条命令串起 `merge-person-clips` / `compress-people` / `verify-people-lods` / `people-manifest`。前提 `.cache/aholo/sit/` 里已有 `fetch-sit-clips.mjs` 取回的动作 GLB；上游只给循环态（坐下/起身过渡交给前端交叉淡入） | `--check`（只查输入与工具是否齐备）；`--limit 2`（先拿 2 个模型试跑） |
| `people-manifest.mjs` | 生成 `people-manifest.json` 供前端 `parsePeopleAssetManifest` 消费：`people/<id>.glb`（LOD0/hero，覆盖现有 URL）+ `people/lod1/<id>.glb`（LOD1/far）。hash 用内容 sha256，bytes 用**压缩后**真实字节 | `--hero .cache/aholo/hero --far .cache/aholo/far` |
| `make-lod.mjs` | 从 Aholo 单文件 spz 派生 1/4、1/8 两档低模并写 `lod-meta.json`（公开 SPZ 规范，等步长抽点，坐标不重新量化） | `--spz scene.spz --out frontend/public/scans/<dir>` |
| `r2-upload.mjs` | R2 上传（S3 兼容，SigV4 手写签名、零依赖）：只认 `people/*.glb` 两条固定路径。凭据只从环境变量或 `--env-file` 读，任何输出不含密钥 | `--dry-run` 先看要写什么 |
| `r2-upload-file.mjs` | R2 单文件通用上传（`r2-upload.mjs` 的通用版），给报告书这类一次性静态件用 | `--file a.html --key reports/x/index.html --type "text/html; charset=utf-8" [--dry-run]` |
| `r2-upload-scan-lod.mjs` | 把本地 LOD 目录发到 R2，并**单独**给云端写一份「L0 指回云端 `.spz`」的 `lod-meta`：本地那份指本机代理，云端那份指 R2，两边各指自己够得到的地址（布局与 `cloud-assets.ts` 的 `cloudScanLodUrl` / `cloudScanUrl` 严格对齐） | 用法见脚本头注释 |

## 四、验收

不满足就是压坏了 / 没通过，不硬传、不硬报。

| 脚本 | 做什么 | 入口 |
|---|---|---|
| `verify-people-lods.mjs` | 两档 LOD 对照校验：`hero` 的三角面、关节数、clip 名与原始**完全一致**（只允许贴图格式/体积变化）；`far` 关节数与 clip 名一致、三角面 ≤ 原始（可削，不能削没） | `--src .cache/aholo --hero <dir> --far <dir>` |
| `inspect-people-glb.mjs` | GLB 结构速查，不依赖 three / gltf-transform，直接读容器与 JSON chunk：体积、扩展、三角面、蒙皮关节数、clip 名与通道数、贴图 mime 与尺寸——看体积表看不出的「骨架/动画有没有压坏」 | `<a.glb> [b.glb ...]`；`--json <a.glb>` |
| `render-thumbs.mjs` | 单件 GLB → 256×256 webp 缩略图（headless Chrome + three，复用工作台渲染链）。产物先落 `.cache/aholo/thumbs/`，人工目检通过才复制进发布库 `thumb/` | `--slug <slug 片段>`；`--batch` |
| `thumb-preview.mjs` + `thumb-preview.html` | 单件道具棚拍预览页，布光与色彩对齐只读查看器的 `neutral` 预设（`render-look.ts`）；页面暴露 `window.__thumb`（status / meta / error / encode()） | `thumb-preview.html?glb=<file:// 绝对路径>` |
| `cdp-shot.mjs` | 用 CDP 打开页面、等真实时间、读页面内文字、截图。无第三方依赖 | `<url> <out.png> [等待毫秒=9000] [调试端口=9333]` |
| `cdp-views.mjs` | 打开坐姿验证页，依次切几个机位各截一张，挑最能看清「坐在椅子上」的角度 | `<url> <out-prefix> [等待毫秒=12000] [端口=9333]` |
| `lod-analysis.cjs` | 读 `docs/evidence/aholo/world-3FO4K4QI6N4V/lod-meta.json`，算 `forwardBox` 与树根盒三轴比值——「World 产物本身是米制、禁止任何缩放」这条已验收结论的**复算脚本**，不要删 | `node tools/aholo/lod-analysis.cjs` |
| `mock-e2e.mjs` | 对本地 functions（`:3099/functions/v1/scene-api`）跑一遍建 job → 轮询 → 授权 asset URL → added 的冒烟 | `node tools/aholo/mock-e2e.mjs` |
| `walkthrough/` | 3DGS 场景浏览器漫游实验页（`walkthrough.mjs` + `index.html`）。只读随包的三个 `.spz`，不登录不调接口不扣额度；米制口径与 `splat-preview.ts` 一致（Z-up 转 Y-up、底面贴 `y=0`、不缩放） | 见 `walkthrough/README.md`（要起一个最小静态根目录，别把整仓暴露到 localhost） |

## 数据文件

| 文件 | 是什么 | 谁产 / 谁消费 |
|---|---|---|
| `BATCH-NOTES-20261119.md` | 11-19 批次实录：14 件成功、280 credits、32 条 `no credits`、未完成清单与产物位置 | 人写；下次续跑前先读 |
| `aholo-ingest-20261119.json` | 入库草稿清单（体积 / sha256 / 三角面 / 包围盒 / 门禁结果） | `ingest-prep.mjs` 产 → 人工审 → `ingest-register.mjs` 消费 |
| `thumb-review-20261119.json` | 缩略图目检记录 | `render-thumbs.mjs` 环节产 |

## 凭据与产物约定

- **凭据三处，都不落盘、不打印**：仓库根 `.env.local` 的 `LUX3D_API_KEY`（recon / world / lux3d / people02 / 代理）；
  环境变量 `AHOLO_SCAN_KEY`（web-scan 那一套，`lib/web-scan.mjs` 只读环境变量）；
  `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`（`r2-upload*.mjs`，只从环境变量或 `--env-file`）。
- **产物三个落点**：`.cache/aholo/`（批量与压缩中间物，本地）、`docs/evidence/aholo/`（证据，按白名单入库）、
  `frontend/public/scans/`（LOD，`.gitignore` 整目录忽略——所以派生 LOD 必须走 `r2-upload-scan-lod.mjs` 才能上线）。
- 派生件、下载件、截图一律不进版控；`docs/evidence/*` 默认不提交，只有白名单目录例外。

## 已清理（2026-11-21）

下列一次性探针已删除。它们当时解决的坑写进了提交说明与 `docs/`，删掉不丢结论：

- `replica-geo/_probe.py`、`_probe2.py`、`_google_probe.py`、`_google_fit.py`（未跟踪；硬编码本机绝对路径，读的 `.local/tmp/` 目录已空）
- `ous-probe.mjs`、`ous-status-probe.mjs`、`ous-upload-test.mjs`（同一探针的三个版本）
- `world-dl.mjs`（硬编码的 holo-cos 签名 URL 早已过期）、`world-restore.mjs`
- `validate-probe.mjs`、`validate-issues.mjs`、`repair-verify.mjs`
- `replica-geo/fix_head.py`（对单个 HTML 做字符串替换）、`replica-geo/mosaic.py`（拼图逻辑已由 `align_search.py` 的 `build_mosaic` 取代）

## 相关文档

- `tools/aholo/BATCH-NOTES-20261119.md` — 批次实录
- `tools/aholo/walkthrough/README.md` — 3DGS 漫游实验页
- `docs/39-Aholo能力与用途评估-20261108.md` — 能力与用途评估
- `docs/19-西湖户外重建接力.md` — 重建接力的需求与口径
- `docs/29-重建样本归档.md` — 样本归档
- `docs/archive/report/17-Aholo重建真调排查.md` — 真调排查（token / 状态码 / OUS 会话）
