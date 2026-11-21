# 人物 / 载具 GLB 资产管线（2026-11-16）

## 一句话结论

原始人物 GLB **39.93 MB / 382,720 三角面**，可压到 **hero 3.52 MB（零削面）**、
**far 2.46 MB（削到 236,326 面）**，两档骨架（52 关节）与两个动画 clip 全部保留。
hero 只比 far 多 1 MB，却保住全部拓扑与 2K 贴图 —— 所以「近景不傻」不必牺牲体积。

## 实测（`LOCAL_WALK_ASSET_IDS` 全量 28 个 ID，线上存在 27 个）

单资产样本（`7a9f1e21-…-b00000000001`）：

| 档位 | 体积 | 三角面 | 关节 | clip | 贴图 | 压缩耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 原始 | 39.93 MB | 382,720 | 52 | Idle_Loop 2.50 s / Walk_Loop 1.33 s | 2× PNG | — |
| **hero（LOD0）** | **3.52 MB**（−91.2%） | **382,720** | 52 | 同上，各 53 通道 | 2× WebP 2048 | 4.0 s |
| **far（LOD1）** | **2.46 MB**（−93.8%） | 236,326 | 52 | 同上，各 53 通道 | 2× WebP 1024 | 4.2 s |

全量 27 个资产：

| 档位 | 体积 | 平均单资产 | 最大单资产 | 结论 |
| --- | --- | --- | --- | --- |
| 原始 | 1004.7 MB | 37.2 MB | 42.44 MB | 现状：每个模型都要下 40 MB |
| **hero（LOD0）** | **66.6 MB**（−93.4%） | 2.47 MB | 3.52 MB | 零削面，骨架/clip 与原始逐项一致 |
| **far（LOD1）** | **41.2 MB**（−95.9%） | 1.53 MB | 2.46 MB | 三角面降到约 50%（256k→约 130k） |

- 下载实测：27 个对象并发 6 路，1004.7 MB / **394 s**（单文件 ≈1.1–1.4 MB/s）；
  hero 单资产首屏约 2–3 s，远低于现有 90 s 超时。
- 压缩实测：far 全量约 2 min、hero 全量约 2 min（单资产 4–5 s）。
- `verify-people-lods.mjs` 对 27 个资产逐项比对：hero 三角面 **100% 等于原始**、
  关节 52、clip 2 个，全部通过；far 只降三角面，骨架与 clip 不变。
- 压缩后 `extensionsRequired = EXT_meshopt_compression, EXT_texture_webp, KHR_mesh_quantization`，
  未挂 MeshoptDecoder 的加载器会直接抛错 —— 这正是「加载器必须单一入口」的原因。

## 两档预设

`tools/aholo/compress-people.mjs` 新增 `--preset hero|far`（默认 far，保持原有行为）：

```bash
# 远景 / 群众：削面 + 1K 贴图（原行为）
node tools/aholo/compress-people.mjs --out .cache/aholo/far --preset far

# 近景 / 主角：不削面 + 2K 贴图
node tools/aholo/compress-people.mjs --out .cache/aholo/hero --preset hero

# 只压指定资产
node tools/aholo/compress-people.mjs --out DIR --preset hero --id <assetId>
```

两档唯一差别是 `--simplify false` 与 `--texture-size 2048`。「原皮很傻」的根因是
**削面 + 1K 贴图**，不是 meshopt（几何压缩本身无损）。

顺带修掉一个 Windows 硬故障：Node 20+ 起 `execFileSync('npx.cmd')` 会抛 `EINVAL`
（禁止不带 shell 启动 `.cmd`，本机 Node 26 复现）。脚本改为
`node <npm-cli.js> exec --yes -- <cli>`，既跨平台也不用给含中文/空格的路径做 shell 转义。

## 路径与清单

| 档位 | 对象键 | 说明 |
| --- | --- | --- |
| LOD0 / hero | `people/<assetId>.glb` | **覆盖现有 URL**，老客户端不改也能拿到高清压缩版 |
| LOD1 / far | `people/lod1/<assetId>.glb` | 新路径，只给按档位取模型的调用方 |

`tools/aholo/people-manifest.mjs` 扫两档目录生成 `people-manifest.json`
（`version: 1` + `assets[assetId]{bytes, hash, lods[]}`），hash 是文件 sha256，
用作前端缓存键；`--check` 复用与前端 `parsePeopleAssetManifest` 同一条不变式做自校验。

```bash
node tools/aholo/people-manifest.mjs --hero .cache/aholo/hero --far .cache/aholo/far
node tools/aholo/people-manifest.mjs --check .cache/aholo/people-manifest.json
```

实测产物：

```json
{ "version": 1, "assets": { "7a9f1e21-…-b00000000001": {
  "bytes": 3691976, "hash": "d633b878…",
  "lods": [ { "level": 0, "url": "…/people/<id>.glb",      "bytes": 3691976 },
            { "level": 1, "url": "…/people/lod1/<id>.glb", "bytes": 2574964 } ] } } }
```

## 前端契约

- **单一加载入口**：`three/glb-loader.ts` 的 `createGlbLoader()`（挂 MeshoptDecoder）。
  原先三处 `new GLTFLoader()`（`glb-assets.ts` 资产缓存、`people-model.ts` 打包内人物、
  `scene-delivery.ts` 交付场景）已全部改为调用它，任何一处漏挂都不会再「这里能读、那里读不了」。
- **失败可读**：`classifyGlbFailure` / `describeGlbFailure` 把异常翻成一句人话
  （超限 → 改用压缩或 LOD 档位；meshopt → 检查解码器；404 → 换资产；网络 → 重试）。
- `lib/asset-manifest.ts`：清单解析不抛异常，缺 `hash` 直接拒绝（没有 hash 就无法做缓存失效）。
- `lib/asset-lod.ts`：档位阈值 0.18 / 0.06，`shouldRejectAsset` 决定丢弃还是保留占位。

## 坐姿动作（椅子交互的前置）

现状：椅子交互的**判定与落位已完成**（`lib/seat-placement.ts`：按 slug/模板/中文名关键词认椅凳沙发、
算坐面高度与坐姿眼高 +0.63 m）；**27 个模型现在全部带上了坐姿循环**（每个 3 条 clip，见下节），
点击坐下会真实播放。

clip 词表与上游 id 的对应关系：

| 位置 | 内容 |
| --- | --- |
| 上游动作库 | `Idle_Loop` / `Walk_Loop` / `Idle_Talking_Loop` / **`Sitting_Idle_Loop`** 四条真实存在 |
| `three/people-model.ts` | `sit: 'Sit_Idle_Loop'`（归仓时由 `--as` 从上游 `Sitting_Idle_Loop` 改名） |
| `lib/character-generate.ts` | `CHARACTER_ANIMATION_PRESETS` 只列这四条真实 id |

上游**没有**坐下/起身过渡：`Stand_To_Sit`、`Sit_To_Stand`、`Sit_Down`、`Standing_Up` 等 47 个候选
逐个实探都被拒（`unknown animation_id`）。过渡交给前端交叉淡入，`people-model.ts` 里那两个名字保留但
永远取不到 clip，`applyAction` 的 `if (!clip) return;` 会安静跳过。

### 骨架是可复用的

27 个角色全部是 **Mixamo 标准骨架**：`mixamorig:Hips … mixamorig:RightToeBase`，52 关节。
所以**不必逐个角色去远端重定向**——远端只产一次动作，本地按骨骼名合并进全部角色即可
（27 次 × 6 credits 变成 1 次）。

### 合并工具（已验证）

`tools/aholo/merge-person-clips.mjs`：gltf-transform core API，纯 Node，无浏览器依赖。
按**骨骼名**重定位通道、accessor 整块复制；骨架不匹配超过 20% 直接拒绝；同名 clip 默认跳过。

```bash
node tools/aholo/merge-person-clips.mjs \
  --source .cache/aholo/sit/Sitting_Idle_Loop.glb --clips animation_1 \
  --as animation_1=Sit_Idle_Loop \
  --from <工作副本> --out <工作副本>
```

retarget 产物内部的剪辑名统一是 `animation_1`，不是动作 id，所以 `--as` 这一步不能省。

真实数据验证（把 a001 的 Walk 合并成 a002 的第三条动作）：

| 指标 | 原件 a002 | 合并后 |
| --- | --- | --- |
| 体积 | 37.90 MB | 29.84 MB（bufferViews 228→6，对齐填充被合并，不是丢数据） |
| 顶点属性 | 206,192 × 5 | 一致；三角面 321,276 不变 |
| 贴图 | 2× PNG，7.32 MB | 2× PNG，7.32 MB |
| 关节 / clip | 52 / 2 | 52 / **3**（各 53 通道） |
| 再压 hero 档 | — | **2.75 MB**，3 条 clip 全保留，meshopt+WebP 正常 |

### 动作来源与实跑结果（2026-11-16 收口）

走的是 LUX3D retarget：`POST /lux3d/v1/animations/retarget/task/create`，
`rigModelUrl` 用 R2 上已绑骨的唐女（`people/7a9f1e21-…-a001-….glb`），`animationIds: ["Sitting_Idle_Loop"]`，
约 85 s 完成，产物 39.99 MB / 52 关节 / 1 条 1.67 s 循环。**按文档 6 credits/条计，本次实花 ~6 credits**
（此前三次被拒的 submit 都是 create 阶段失败，`consumedCredits=0`）。

上游返回结构（代理原本只认 `outputs[].content`，会把它读成空）：

```
outputs[0].content = "{\"actions\":[{\"animation_id\":\"Sitting_Idle_Loop\",
                      \"status\":\"success\",\"animationGlbUrl\":\"https://…\"}]}"
```

`tools/aholo/lux3d-dev-proxy.mjs` 的 `/task` 已改成解析这层 JSON，并把 `actions[]` 一并返回；
另加 `?shape=1` 结构探针（只回字段名与类型，URL 打码），以后上游再变形状可以直接定位。

全量结果：

| 档位 | 体积 | 说明 |
| --- | --- | --- |
| 原始 27 个 | 801.7 MB | 平均 29.7 MB |
| hero（→ `people/<id>.glb`） | **67.1 MB** | 最大 3.54 MB，零削面 |
| far（→ `people/lod1/<id>.glb`） | **41.7 MB** | −94.8% |

`verify-people-lods` 27/27 通过：每个资产 52 关节、3 条 clip（Idle_Loop / Walk_Loop / Sit_Idle_Loop），
hero 三角面与原件完全一致。清单已重生成，27 个新 hash。

一条命令复现（`--check` 只做前置校验）：

```bash
node tools/aholo/fetch-sit-clips.mjs --proxy http://127.0.0.1:3200 --clips Sitting_Idle_Loop
node tools/aholo/build-sit-assets.mjs            # 合并 → 两档压缩 → 校验 → 清单
node tools/aholo/probe-animation-ids.mjs --proxy http://127.0.0.1:3200   # 零成本查任意 id 是否存在
```

注意：本机 3199 上的代理可能是改代码前启动的旧进程（`/retarget` 会 404 未知接口）。
代理自己从仓库根 `.env.local` 读 key、端口读 `LUX3D_PROXY_PORT`，所以起新实例不需要 `--env-file`：

```bash
$env:LUX3D_PROXY_PORT='3200'; node tools/aholo/lux3d-dev-proxy.mjs
```



## 阈值（已按实测下调）

改动前：`LOCAL_WALK_MAX_FILE_BYTES = 48 MB`、`TIMEOUT_MS = 90_000`。
全量 hero 最大 3.54 MB、平均 2.48 MB，现在两者都已改：

| 常量 | 位置 | 改为 | 依据 |
| --- | --- | --- | --- |
| `LOCAL_WALK_MAX_FILE_BYTES` | `lib/glb-limits.ts` | 48 MB → **12 MB** | 实测最大 3.54 MB 的 3.4 倍；超过它就是未压缩原件，应该报错 |
| `TIMEOUT_MS` | `three/glb-assets.ts` | 90 s → **45 s** | 压缩后单文件最大 3.54 MB，45 s 已是实测耗时的十余倍 |
| `GLB_MAX_FILE_BYTES` | `lib/glb-limits.ts` | **不动**（10 MB） | 普通物件导入路径，与人物资产无关 |

改完 `frontend tsc` 0 错，`in-place-walk` / `asset-lod` / `asset-manifest` / `character-generate`
四个文件 53 项全绿（无测试断言旧值）。

## 上传结果（2026-11-16）

桶 `scendance-assets`（账号 `f0273e54d22c215389dd6065a802ddae`），令牌权限「对象读和写」+ 仅限该桶。

| 项 | 结果 |
| --- | --- |
| 对象数 | 54（hero 27 → `people/<id>.glb` 覆盖；far 27 → `people/lod1/<id>.glb` 新增） |
| 体积 | 108.88 MB |
| 上传 | 全部 200，回读 Content-Length 与本地字节逐一相等 |
| 独立回读 | `--verify-only` 54/54 OK |

中途遇到 `ECONNRESET` 打断整批，已在 `r2-upload.mjs` 加逐条容错：网络错误与 5xx 退避重试 4 次（800/1600/3200 ms），
单条失败只跳过不中断；`headPublic` 也用 try/catch 包住，避免回读抖动把整批弄挂。

后端脚本默认自己读仓库根 `.r2.env`（不传 `--env-file` 时），命令行里不出现凭据路径；
`.gitignore` 已加 `.r2.env` / `!.r2.env.example`，`git status --ignored` 确认该文件被忽略。

## 运行手册（发布顺序）

```bash
# 1. 探活：哪些资产在线、有没有 404（默认汉服那个就是 404）
#    HEAD https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev/people/<assetId>.glb

# 2. 下载原始（并发 6 路，1 GB 约 6.5 分钟）
curl.exe -Z --parallel-max 6 -o .cache/aholo/<id>.glb https://pub-…/people/<id>.glb

# 3. 两档压缩（全量各约 2 分钟）
node tools/aholo/compress-people.mjs --out .cache/aholo/far  --preset far
node tools/aholo/compress-people.mjs --out .cache/aholo/hero --preset hero

# 4. 结构校验（骨架/clip 一致、hero 零削面）
node tools/aholo/verify-people-lods.mjs

# 5. 生成清单 + 自校验
node tools/aholo/people-manifest.mjs --hero .cache/aholo/hero --far .cache/aholo/far
node tools/aholo/people-manifest.mjs --check .cache/aholo/people-manifest.json

# 6. 上传（凭据只从环境变量/--env-file 读取，输出不含密钥）
node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far --dry-run
node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far --env-file .env.local

# 7. 回读校验：线上 Content-Length 必须等于本地字节数
node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far --verify-only
```

下载后必做一步：**校验 GLB magic**。本次 `curl` 把汉服的 404 错误页存成了 27 KB 的
`9b9bb4da-….glb`（HTML），已删除；批量下载必须挡住这种「假资产」。

## 未完成 / 阻塞

- **R2 上传**：当前登录的 Cloudflare 账号（账号 ID `913b868b…`）**未开通 R2**，
  访问 `scendance-assets` 会被重定向到 `/r2/plans`；该 S3 端点 TLS 也不通。
  上传器已写好并用假凭据验证到「请求能发出、缺的是有效签名」，但没有可用凭据就无法完成上传与回读。
  需要：属于该桶账号的 R2 API Token（Access Key ID / Secret），或换到拥有该桶的账号登录。
- **默认汉服 GLB 404（已定位，但**不是**运行时故障）**：`9b9bb4da-3f30-4cfa-8e15-483038000001`
  在公开基址返回 404（6 个候选路径 + 8 个 ID 变体全探过），全仓历史、18 个 worktree、主工作区都没有这个文件；
  唯一的汉服产物 `docs/evidence/aholo/people02-hanfu/g1/model-2.glb`（16.64 MB，2026-11-21 已清出 `docs/`，登记见 `docs/evidence/_purged-2026-11-21.txt`）是 **0 骨骼 / 0 动画**的静态模型，当不了漫游角色。
  代码里它只出现在 `LOCAL_WALK_ASSET_IDS` 的 48 MB 白名单，`WALK_ROLES` 的 11 个角色全是 `a001`–`a00b` 且全部在线，
  所以去掉或重指这个 ID 都不会影响漫游。另外 `walk-roles.ts` 注释指向的
  `docs/evidence/aholo/people04-hanfu-batch/_merge-walk.mjs` 从未进过 git、任何 worktree 里也没有——
  汉服合并那批产物没落盘，这是它缺失的直接原因。
- **清单未进仓库**：`people-manifest.json` 只生成在 `.cache/aholo/`，等对象真正上云后再随前端一起提交，
  否则会出现「清单指向不存在的文件」。
