# Aholo 临期积分批量补库 · 2026-11-19 晚

## 背景

账号 2576 credits 当天过期（截图口径；API 无余额查询接口，净消耗以 `task/list` 的 `consumedCredits` 为准）。
密钥读仓库根 `.env.local` 的 `LUX3D_API_KEY`，网关 `https://api.aholo.cn`。今晚只做**本地批量产物落盘**，不改产品代码、不登记物料库、不推送。

### 最终快照（2026-11-20 凌晨，runner 已退出）

- 提交 14 条，**全部成功**，GLB 已落盘；净消耗 **280 credits**（14 × 20）。
- 32 条在提交阶段返回 `no credits`（c=-1），未生成任务、不扣分；第二波 16 条未提交。
- 14 个 GLB 共 146 MB、48.2 万三角面（单件 21k–49k），单 mesh、3 张贴图；ZIP 同目录留存。
- 未完成清单：家具桌椅 5、绿植 6、灯光 5、展位展陈 4、音响数码 3、后勤餐饮 2、人物 5；第二波 16 条。积分续费后可直接重跑，state 不会重复提交已成功条目。

## 产物位置

- 产物目录：`.cache/aholo/batch-20261119/`（gitignore，不入库）
- 状态续跑文件：`state.json`（每条记录 taskId / status / outputs / glb / bytes / error）
- 清单：
  - `tools/aholo/batch-manifest.json`：首波 46 条（活动道具 / 家具 / 绿植 / 灯光 / 展位 / 音响 / 后勤 / 5 条 experimental 人物）
  - `tools/aholo/batch-manifest-wave2.json`：第二波 16 条
- Runner：`tools/aholo/lux3d-batch.mjs`

## 运行与续跑

```bash
# 干跑（不提交任务）
node tools/aholo/lux3d-batch.mjs --dry-run

# 首波（并发 5 = 账号实测生成并发上限）
node tools/aholo/lux3d-batch.mjs --concurrency 5

# 第二波（复用同一 state.json / 产物目录）
node tools/aholo/lux3d-batch.mjs --manifest tools/aholo/batch-manifest-wave2.json --concurrency 5

# 单条重跑 / 分片
node tools/aholo/lux3d-batch.mjs --only aholo-20261119-grand-opening-flower-basket
node tools/aholo/lux3d-batch.mjs --shard 1/3
```

中断后直接重跑同一命令即可：`state.json` 里已有 taskId 的会复用，已成功且 GLB 在盘的跳过。

## 实测口径（今晚验证）

- 图生 / 文生 3D：20 credits/成功任务；失败、取消不扣分（历史任务清单已复核）。
- 账号生成并发上限 **5**；超限返回 `GENERATION_CONCURRENCY_LIMIT_EXCEEDED`，runner 每 20s 退避重试，不判失败。
- G1 单条 3–8 分钟；产物直链 GLB + ZIP；签名 URL 约 2 小时有效，成功后必须尽快下载（runner 已在终态即刻拉取）。
- 原始 GLB 体积 8–15 MB，35k–49k 三角面，3 张 PNG 贴图（2048 级）；单 mesh、无 skin。
- 人物类（experimental）纯文生成型不稳，验收时优先淘汰。

## 2026-11-20 收尾进度（压缩 + 草稿清单，未登记）

- 预处理脚本：`tools/aholo/ingest-prep.mjs`（`--dry-run` / `--preset far|hero` / `--only <slug>` / `--force`）。
- 14 个原件已走 far 预设压缩（meshopt + WebP 贴图 1K + 削面），输出 `.cache/aholo/ingest-20261119/<slug>.glb`：合计 **7.89 MB**，单件 0.19–1.03 MB；三角面 19.4k–48.6k；单节点、0 蒙皮、0 动画；无硬伤。
- 草稿清单：`tools/aholo/aholo-ingest-20261119.json`（每条含 raw/compressed 字节、sha256、三角面、包围盒尺寸、门禁问题与备注）。
- 结构备注：压缩件带 `EXT_meshopt_compression` / `EXT_texture_webp` / `KHR_mesh_quantization` 必需扩展；前端加载器已挂 MeshoptDecoder（`glb-loader.ts`），浏览器原生解 WebP。**云端 `validateModel` 只收 png/jpeg 贴图、拒绝 extensionsRequired**——这批只能走静态随包目录，不能直接登记成云端公开物料。
- 尺寸取原件包围盒（压缩不改几何尺度）；模型质心在原点、未落地，落地偏移由编辑器运行时按 `groundOffset` 处理。

### 仍未完成（登记前的硬门禁）

1. **缩略图 webp**：仓库内没有本地 GLB 渲染出图链路；现有 975 张缩略图来自源 CDN 下载（`scripts/fetch-open-models.mjs`）。构建脚本对 `thumb/<slug>.webp` 有 RIFF/WEBP 格式校验，**不能放占位图**。候选链路：本地 three.js 预览页 + CDP `Page.captureScreenshot`（webp 格式），需要先搭出来并目检角度/背景。
2. **人工目检**：单物件完整、无悬浮碎片、无畸形；提示词的 "no text" 不保证上游遵守。
3. **并入登记**：目检通过后再写 `assets/library/incoming-extra.json` 同构批次 + `labels.zh.json` 中文名与 bucket，跑 `node scripts/build-model-library.mjs` 重建 `merged.json`；assetId 只在哈希一致时复用，不编造。
4. 来源记 `aholo-lux3d-batch-20261119`，与 CC0 开源批次分开标注。
5. 归属分层（这批落静态公开库 / 云端私有 / 内部候选）见 `docs/plans/2026-11-20-生成物可见性权限分层研究.md` §五 问题 4，待拍板。

## 明天入库前必须做的门禁（不要跳过）

1. **归一化**：厘米→米、Z-up、质心落地；面数 ≤150k、尺寸与重量走编辑器现有校验。
2. **压缩**：贴图降尺寸 / 转 JPEG 或 WebP、必要时 LOD（参考 `tools/aholo/compress-people.mjs`、`tools/aholo/make-lod.mjs`），把 13–15 MB 压到物料库常规体积。
3. **人工目检**：单物件完整、无悬浮碎片、无畸形人脸（人物条目重点看）；提示词里的 "no text" 不保证上游完全遵守。
4. **登记**：走 `assets/library/incoming-extra.json` 同构批次 + `labels.zh.json` 中文名 + `node scripts/build-model-library.mjs` 重建 `merged.json`；assetId 只在字节哈希完全一致时复用，不编造云端资产 ID。
5. 本批来源如实记为 `aholo-lux3d-batch-20261119`，与 CC0 开源批次分开标注。

## 今晚刻意没做

- 没登记 catalogue / merged.json，没改 Edge Functions 契约、迁移或根依赖。
- 没跑世界重建（需要 ≥20 张场地照片）、世界生成（室内 Beta、户外不可靠、积分单价未公开）、RenderCloud（要 USDA 场景装配，今晚来不及）。
- 没跑绑骨 / 动作重定向：现有 13 个角色 GLB 11-16 已处理过；新人物条目先静模型入库，绑骨等验收后再排。
- 没提交、没推送 main。
