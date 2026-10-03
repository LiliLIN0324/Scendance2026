# 统一模型库

网站工作台从 `merged.json` 延迟加载统一目录：529 个不重复模型、19 个中文分类，其中 528 项纳入工作台和 Agent，1 项超限完整场景仅保留归档。全部模型和缩略图随网站发布，从本站按需加载。

| 文件 | 用途 |
| --- | --- |
| `merged.json` | 编辑器统一目录：中文名、英文原名、分类、尺寸、文件地址、校验值 |
| `labels.zh.json` | 中文命名与分类真源，可按模型 slug 编辑 |
| `model200.json` | 本次 279 个文件的来源、许可、尺寸及 24 项截断恢复记录 |
| `merge-report.json` | 来源数量、重复合并、恢复及复杂场景限制记录 |
| `registered.json` | 新库云端登记成功回执；未确认的 ID 不进入发布目录 |
| `asset-ids.json` | 已注册云模型的原始地址和经过哈希比对的本站地址，保留原 ID |
| `asset-labels.zh.json` | 云场景重开时使用的中文名称 |
| `model/<slug>.glb` | 529 个完整 GLB；保留稳定的英文 slug，避免破坏旧引用 |
| `thumb/<slug>.webp` | 对应预览图 |
| `online.json` / `catalogue.json` | 原网站 234 条线上、30 条本地记录，保留作来源和兼容依据 |

生成目录：

```sh
node scripts/build-model-library.mjs
```

生成中文文件名的分类压缩包（含模型、预览图、CSV 来源索引）：

```sh
python3 tools/catalog/export_library.py --output output/model-library/幕景模型大库.zip
```

以上命令在仓库根目录运行；生成文件不手工编辑。压缩包不纳入 Git，模型源文件纳入 Git。

尺寸为米，`width / depth / height` 对应 X / Z / Y。上游 `sizeMeters` 在旧清单中的顺序不同，合并脚本显式转换；测试将每项与真实网格包围盒核对。

模型来自 [3DAssets.dev](https://3dassets.dev)，许可为 CC0 1.0。新文件逐项原站许可已核对；`model200.json` 保留许可对象和来源链接。旧来源记录继续保留，见 [ASSET-SOURCES.md](../../ASSET-SOURCES.md)。用户原始 `model200` 目录未修改。

已有 234 项保留云端注册身份和 Agent 资源引用顺序；294 项新增可用模型通过既有 `register_library_asset` RPC 登记后再生成发布目录。`npm run library:check` 只校验本地模型；实际登记需显式 `--write --remote --owner <existing-owner>` 及环境中的服务端凭据。脚本每批 6 项、保留回执、相同内容按确定的 UUID 重试，不改旧资产。网站和 Agent 均从 `merged.json` 选择同一批 528 项，使用原有授权和保存接口。发布与实测状态见 [验收记录](../../docs/MODEL_LIBRARY_MERGE.md)。

“巧克力工坊生产线场景”含 240,036 个三角形，超过当前单件物料 150,000 的上限。完整文件仍在目录和压缩包中，不进入工作台或 Agent 可调用索引；未放宽加载或云端校验规则。

`tools/catalog/build_catalog.py` 仍仅维护历史 30 项精选目录，不能代替新的统一目录生成命令。
