# 36 · MP-DEL 交付包规格（v1 冻结）

> 状态：**规格已冻结（2026-11-08，A4）**；B1 版本身份、B2 一键打包均已完成（2026-11-08）。
> 机器可读的一半在 `frontend/components/room-organizer/lib/delivery-package-spec.ts`，测试 `delivery-package-spec.test.ts`（8 例，已进门禁）。
> 本文只写「包长什么样、字段叫什么、失败算什么」；验收判据仍以 [docs/24](24-Web端三个产品问题.md) 1-1～1-6 为准。

## 1. 范围

| 进 v1 | 不进 v1 |
| --- | --- |
| 效果图 3 张、平面 DXF、物料清单 CSV、分享链接说明、manifest、README | 报价单价/小计/损耗（SC-34 拍板前不塞）、库存、排期表、活动安排、GLB、视频 |
| 同一确认版复现同一个包（版本身份、快照号、内容指纹） | 增量包、云端打包、断点续传下载 |
| 逐产物失败可定位、可重试、可续跑 | 自动改价、自动发布、自动分享到外部 |

理由：先锁 docs/24 §1.1 的四件套，把「文件集合」变成「可交付物」；范围一宽就回到无限拼装。

## 2. 包结构（解包即用）

```text
幕景_<项目>_v<主>.<次>/
  01-效果图/效果图-01.png
  01-效果图/效果图-02.png
  01-效果图/效果图-03.png
  02-平面图/平面-<楼层>.dxf
  03-物料清单/物料清单.csv
  04-分享/分享链接.txt
  manifest.json
  README.txt
```

- 目录、文件名、份数由 `DELIVERY_ARTIFACTS` 固定；不要在执行代码里另写字符串。
- 效果图固定 3 份（docs/24 1-2 的「每任务 3 个机位」）；少一张即整包 `incomplete`。
- 平面按楼层出图，文件名带楼层：`平面-B1_夹层.dxf`；本版只取当前确认版的楼层集合。
- 中文名不改拼音；zip 条目统一 UTF-8，Windows 资源管理器、macOS 归档工具、`unzip` 三端解包不乱码。
- 条目顺序按 `DELIVERY_ARTIFACTS` 声明顺序写入，保证同一版两次打包字节可比对。

## 3. 命名与清洗

| 项 | 规则 | 例 |
| --- | --- | --- |
| 非法字符 | `[\\/:*?"<>|\s]+` → `_`，再剥首尾 `_`；结果为空回落到默认名 | `' Hall D5 / 东厅 '` → `Hall_D5_东厅` |
| 包根 | `幕景_<项目>_v<主>.<次>` | `幕景_Hall_D5_东厅_v1.0` |
| 版本号 | `^v\d+\.\d+$`；`1.0`、`v1`、`v1.0-beta` 一律拒绝（包名与清单会不一致） | `v1.0`、`v10.21` |
| 楼层名 | 同一清洗规则，空值回落 `1F` | `平面-B1_夹层.dxf` |

`safeFilePart` 与交付面板现有 `part()` 同一套替换规则，差别只在包名再剥首尾 `_`——避免 `幕景__项目__v1.0` 这种包名。面板的 `part()` 不动（B1 收编时再统一，别夹带重构）。

## 4. 版本身份（B1 必须补的那一块）

现状：`scene-delivery-panel.tsx` 的导出元数据是 `{ id: crypto.randomUUID(), generatedAt }`，在「场景没变」期间复用，一旦改草案就换新号——**这是导出批次号，不是版本身份**（改完再打开，v1 的四件套就复现不出来了）。

v1 规格定为：

| 字段 | 来源 | 语义 |
| --- | --- | --- |
| `deliveryVersion` | 确认版时分配（SC-06），形如 `v1.0` | 人能念、能写在包名上；同一确认版永不改号 |
| `snapshotId` | 确认版时生成一次，之后冻结 | 包内文件、`manifest.json`、分享链接共用同一号；改版必须换号，旧链接仍指旧版（SC-10） |
| `contentFingerprint` | `sha256(规范化场景 JSON)` 前 16 位 | 判断「内容是否变过」；同号不同指纹 = 数据被改写，拒绝打包 |
| `generatedAt` | 本次打包时间 | 只做追溯，不参与身份比较 |

硬规则：`deliveryVersion` 与 `snapshotId` 一旦写进 `manifest.json` 就不再回写；重新打包只能生成新的 `generatedAt`。

> **已收口（2026-11-08，B1）**：`frontend/components/room-organizer/lib/delivery-version.ts` 算号并记在本机（键 `scendance.deliveryVersions.v1`，按项目 id 一条，无 id 归 `local-draft`）。首版 `v1.0`；内容变了再确认，次版本 +1；同内容重复确认幂等，不换号。分享载荷外层带 `identity`（`deliveryVersion`/`snapshotId`/`contentFingerprint`/`status`），`/review/` 页用同一份规范化 JSON 重算指纹核对；旧链接没有外层，照常打开、不显示版本行。改草案后旧链接仍出旧版，已由 `share.test.ts` 与评审页 DOM 双验。

## 5. manifest.json 字段

`format` `packageVersion` `deliveryVersion` `snapshotId` `layoutId` `projectName` `generatedAt` `sceneFormat` `contentFingerprint` `status` `files` `missing` `share`

- `format`：`scendance-delivery-package`；`packageVersion`：`1`（本规格的版本）。
- `sceneFormat`：`{ format: 'scendance-scene-delivery', version: 2 }`，与 `scene-delivery.ts` 的 `sceneDeliveryJson` 输出对齐——测试直接读源文件核对，任一侧改动会红。
- `files[]`：`{ kind, path, bytes, sha256 }`；`path` 必须等于 `deliveryArtifactPath` 的结果。
- `status`：`complete` 仅当所有产物齐全且 sha256 命中；否则 `incomplete`，并在 `missing[]` 写 `{ kind, code, detail }`。
- `share`：`{ url }` 或 `null`；`null` 时 `missing` 必有 `share` 条目。
- README.txt 是给人看的：项目名、版本、生成时间、四项各自怎么用、哪些内容仍需人工补齐。

## 6. 失败码与重试

| 码 | 含义 | 可重试 |
| --- | --- | --- |
| `network` | 下载/上报网络失败 | 是 |
| `asset-fetch` | 资产（点云贴图、字体、模型）拉取失败 | 是 |
| `timeout` | 单产物超时 | 是 |
| `memory` | 渲染 OOM | 是 |
| `no-floor` | 没有楼层，出不了平面 | 否 |
| `preset-unsupported` | 机位/预设不支持当前场景 | 否 |
| `entrance-unsupported` | 入口类型画不出参照 | 否 |
| `share-over-budget` | 分享快照超预算（当前 50 物料 / 50 资产） | 否 |
| `render-failed` | 渲染器本身报错 | 否 |

- `maxAttempts = 3`，退避 `[1000, 4000] ms`；第 3 次仍失败即判该产物失败。
- 续跑以产物为单位：已成功且 sha256 命中的文件直接复用，不重渲染；失败产物单独重试。
- 分享快照一旦生成不再重建（`shareSnapshot: 'immutable'`）；要改内容就换 `snapshotId`，旧链接继续可用。
- 非可重试码不自动重试，直接进 `missing[]`，界面按「残缺包」展示——不允许把缺件的包标成完整。

## 7. 与 docs/24 验收的对应

| docs/24 | 本规格负责 | B3 结果（2026-11-08） |
| --- | --- | --- |
| 1-1 一键出交付包 | 包结构、命名、0 人工改名（B2 落地） | ✅ 夹具 10/10 `complete`、0 改名、52 ms；真机单包下载 8 文件也对。真机整批出图耗时仍未压测 |
| 1-2 效果图可对外 | 固定 3 张、文件名与版本号进 manifest | ⚠️ 3/3 真为 1920×1080；**图内无水印/版号/项目名**；3 人盲评未做（渲染侧） |
| 1-3 平面能施工 | 按楼层出 DXF、文件名带楼层 | ✅ 夹具 10/10 的房间宽深、门宽、窗宽、家具间距与真值一致；6 图层、2 标注、标题带楼层；施工方实读未做 |
| 1-4 清单能报价 | CSV 结构沿用 `sceneDeliveryCsv` | ⚠️ 行数与数量对、带快照与生成时间；**无单价/小计**，报价合计无法核；等 SC-34 |
| 1-5 链接免安装可看 | 分享 URL 进包、与包同 `snapshotId` | ⚠️ 无登录无安装可看、页内版本行自校通过；生产静态首屏 ≤5 s 与 ≥30 天有效期未测 |
| 1-6 甲方能自答三问 | README 写清四项用途 | ⏳ 尺寸可答；价格未进包、进场时间无字段；需 3 人实测 |

证据与复现命令见 `docs/evidence/SC-16/README.md`；批量夹具已进 `npm run gate`（`delivery-acceptance.test.ts`）。

## 8. B1 / B2 要做的事

B1（SC-06 + SC-10）——**已完成（2026-11-08）**：
1. ~~确认版分配 `deliveryVersion` / `snapshotId`，落进布局持久化；改草案不改旧号。~~ 已落：本机 `scendance.deliveryVersions.v1` 侧车记录（不写布局，撤销/云端发布不受影响）。
2. ~~导出与分享都从确认版读号，替换现在 `crypto.randomUUID()` 的批次号语义。~~ 已落：交付面板「确认这一版」；确认后导出 `metadata.id` 用 `snapshotId`，草案仍用导出批次号；分享载荷绑号。
3. ~~改草案后打开旧分享链接，仍出旧版。~~ 已验：`share.test.ts` 旧链接回读 v1.0 + `/review/` 页版本行 DOM。

证据：`delivery-version.test.ts` 9 例、`share.test.ts` +3 例、`load-plan.test.ts` +1 例、评审页 +1 例、交付面板 +1 例，全部在 `npm run gate` 核心套件内。

B2（MP-DEL 一键打包）——**已完成（2026-11-08）**：
1. ~~新增「导出交付包」入口：按 `DELIVERY_ARTIFACTS` 逐产物生成，写 `manifest.json` + `README.txt`。~~ 已落：交付面板版本条下新增「导出交付包」，仅确认版可点；效果图走工作台注入的 `captureImage`（三个机位），平面/物料/分享按 §2 顺序写入。
2. ~~用 `fflate`/`jszip` 之一在浏览器打包（先看包体积与许可证；不引重型依赖）。~~ 改落：`lib/delivery-zip.ts` 自写 store-only zip，固定 DOS 时间戳与 UTF-8 标志，条目顺序即写入顺序，不新增依赖。
3. ~~失败按 §6 归码，`missing[]` 可点重试；残缺包明确标「不完整」。~~ 已落：`classifyDeliveryFailure` 归码，`missing[]` 在面板逐条列出并标注可重试/需先处理；「重试缺件」复用已成功且 sha256 命中的产物。分享快照超预算不自动重试。
4. ~~夹具 10/10，`contentFingerprint` 两侧可比对，0 次人工改名。~~ 已验：`delivery-package.test.ts` 18 例（F01–F10 + 身份/复现/续跑/归码），打包前用当前布局重算指纹，与确认版不一致直接拒绝。

验收证据落 `docs/evidence/mp-del/`：`unpacked-tree.txt`（解包目录树）、`manifest-a.json`/`manifest-b.json` + `manifest-diff.txt`（同版两次打包只差 `generatedAt`）、`retry-receipt.json`（一次 `asset-fetch` 失败后 1 s 重试成功）。

B3（SC-16 四件套验收）——**已完成（2026-11-08）**：
1. ~~用夹具跑 docs/24 1-1～1-6，10/10、0 人工改名、同版四件套一致。~~ 已落：`delivery-acceptance.test.ts` 建 10 份确认版布局、逐份打包解包，校验 8 文件、包根、路径、快照、分享 URL 自校、DXF 五项尺寸与标题、CSV 行数与数量；已进 `npm run gate`。
2. ~~真机走一遍「确认版 → 下载 zip → 开分享链接」。~~ 已验：Chrome 实点下载 8 文件包，3 张真 1920×1080；分享页显示 v1.0 + 同快照并自校指纹（dev 热启 7.2 s）。
3. 未闭环项按事实记在 §7：水印/版号（渲染侧）、单价（SC-34）、生产首屏与 30 天有效期（服务侧）、3 人盲评与甲方三问（真人）。

证据与复现命令：`docs/evidence/SC-16/README.md`，数据文件 `acceptance-run.json`、`browser-package.json`、`browser-review.json` 与三张实拍图。

## 9. 代码入口

| 位置 | 作用 |
| --- | --- |
| `frontend/components/room-organizer/lib/delivery-package-spec.ts` | 路径、清洗、版本、manifest 字段、失败码与重试策略（纯函数，无 DOM） |
| `frontend/components/room-organizer/lib/delivery-package-spec.test.ts` | 8 例：结构、路径唯一、清洗、版本、字段、与 `scene-delivery.ts` 对齐、重试、快照不可变 |
| `frontend/components/room-organizer/lib/delivery-version.ts` | 版本身份：内容指纹（规范化公开快照）、`snapshotId`、次版本递进、本机确认记录、面板文案（纯函数 + localStorage 侧车） |
| `frontend/components/room-organizer/lib/delivery-version.test.ts` | 9 例：指纹稳定/忽略不公开字段、换位变指纹、版本递进、项目隔离、确认幂等、坏存储、写失败 |
| `frontend/components/room-organizer/lib/share.ts` | `#layout=2.` 载荷外层 `{ kind, identity, layout }`；解码兼容无外层的旧链接，读页重算指纹核对 |
| `frontend/components/room-organizer/lib/delivery-package.ts` | B2 打包主流程：校验确认版指纹 → 逐产物生成（效果图/平面/物料/分享）→ 写 README 与 manifest → zip；失败归码、逐产物重试与续跑 |
| `frontend/components/room-organizer/lib/delivery-package.test.ts` | 18 例：F01–F10 夹具、版本身份绑定、同版复现（只差 `generatedAt`）、zip 字节复现、续跑复用、失败码分类 |
| `frontend/components/room-organizer/lib/delivery-acceptance.test.ts` | B3 验收夹具：10 份确认版布局逐份出包并解包，核对四件套同版、DXF 五项尺寸、CSV 行数与数量；设 `DELIVERY_ACCEPTANCE_OUT` 时把结果写回证据目录 |
| `frontend/components/room-organizer/lib/delivery-zip.ts` | 确定性 store-only zip：固定时间戳、UTF-8 标志、唯一/非绝对路径校验，不引第三方压缩库 |
| `frontend/components/review-share-page/`（`load-plan.ts` / `review-share-page.tsx`） | 把 `identity` 带到 `/review/` 页并显示版本行；旧链接与示例场地不显示 |
| `frontend/components/room-organizer/panels/scene-delivery-panel.tsx` | 「确认这一版」条 + 版本状态；确认后导出复用 `snapshotId`；B2「导出交付包 / 重试缺件」入口、进度与缺件清单 |
| `scripts/release-gate.mjs` | 已把规格、版本身份、打包三套测试纳入核心门禁套件 |
| `docs/evidence/mp-del/` | B2 验收证据：解包目录树、两份 manifest 的 diff、失败重试回执 |
| `docs/evidence/SC-16/` | B3 验收证据：10 任务批量结果、真机包与分享页数据、三张实拍图、结论与复现说明 |
