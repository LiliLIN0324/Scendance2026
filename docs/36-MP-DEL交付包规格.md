# 36 · MP-DEL 交付包规格（v1 冻结）

> 状态：**规格已冻结（2026-11-08，A4）**；实现未开始，B1 做版本身份、B2 做一键打包。
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

| docs/24 | 本规格负责 | 仍需另外验 |
| --- | --- | --- |
| 1-1 一键出交付包 | 包结构、命名、0 人工改名（B2 落地） | 10/10 任务、≤10 分钟——需真实任务批量跑 |
| 1-2 效果图可对外 | 固定 3 张、文件名与版本号进 manifest | 1920×1080、水印、盲评 ≥4/5（渲染侧） |
| 1-3 平面能施工 | 按楼层出 DXF、文件名带楼层 | 5 处尺寸误差 ≤1%、图框标注（SC-08） |
| 1-4 清单能报价 | CSV 结构沿用 `sceneDeliveryCsv` | 单价/小计/损耗——SC-34 拍板后才进包 |
| 1-5 链接免安装可看 | 分享 URL 进包、与包同 `snapshotId` | 首屏 ≤5 秒、≥30 天有效期（分享服务） |
| 1-6 甲方能自答三问 | README 写清四项用途 | 3 人 5 分钟盲测 |

## 8. B1 / B2 要做的事

B1（SC-06 + SC-10）：
1. 确认版分配 `deliveryVersion` / `snapshotId`，落进布局持久化；改草案不改旧号。
2. 导出与分享都从确认版读号，替换现在 `crypto.randomUUID()` 的批次号语义。
3. 改草案后打开旧分享链接，仍出旧版（现成的「免安装只读快照」链路只差绑号）。

B2（MP-DEL 一键打包）：
1. 新增「导出交付包」入口：按 `DELIVERY_ARTIFACTS` 逐产物生成，写 `manifest.json` + `README.txt`。
2. 用 `fflate`/`jszip` 之一在浏览器打包（先看包体积与许可证；不引重型依赖）。
3. 失败按 §6 归码，`missing[]` 可点重试；残缺包明确标「不完整」。
4. 夹具 10/10，`contentFingerprint` 两侧可比对，0 次人工改名。

验收证据落 `docs/evidence/mp-del/`：解包目录树、两份 manifest 的 diff（同版应只差 `generatedAt`）、失败重试一次的真实回执。

## 9. 代码入口

| 位置 | 作用 |
| --- | --- |
| `frontend/components/room-organizer/lib/delivery-package-spec.ts` | 路径、清洗、版本、manifest 字段、失败码与重试策略（纯函数，无 DOM） |
| `frontend/components/room-organizer/lib/delivery-package-spec.test.ts` | 8 例：结构、路径唯一、清洗、版本、字段、与 `scene-delivery.ts` 对齐、重试、快照不可变 |
| `scripts/release-gate.mjs` | 已把该测试纳入核心门禁套件 |
| `frontend/components/room-organizer/panels/scene-delivery-panel.tsx` | 现有逐项导出；B2 在此加入口，不再新增第二套导出逻辑 |
