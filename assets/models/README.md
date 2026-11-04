# `assets/models/` —— 精选 fixture，不是物料库

这里只有 5 个 GLB，是**早期精选的测试/示例固定件（fixture）**，不是素材库。
真正的物料库是 [`assets/library/`](../library/)：**529 个 GLB**，编辑器与 Agent 从 `assets/library/merged.json` 延迟加载。

这 5 个文件在库内都有**逐字节相同**的原件（SHA-256 一致），所以它们属于「库的重复子集」，保留原因只有一个：现有代码路径还钉在这个目录上。

## 文件与库内对应件

| 本地文件 | 字节 | 库内对应件（`assets/library/model/`） |
|---|---|---|
| `chair.glb` | 51,616 | `office-lobby-and-facilities-canteen-stacking-chair-3440c7d8.glb` |
| `laptop.glb` | 75,356 | `computers-and-desk-gadgets-laptop-convertible-flip-068fe56f.glb` |
| `plant.glb` | 40,208 | `tattoo-and-piercing-studio-studio-plant-pot-7ee5b536.glb` |
| `speaker.glb` | 19,788 | `village-hall-and-community-events-pa-speaker-on-stand-7ffa787e.glb` |
| `table.glb` | 75,548 | `hotel-and-resort-operations-conference-table-module-a6abb373.glb` |

合计 262,516 字节。`frontend/public/assets/models/` 是这 5 个文件的逐字节副本，供浏览器以 `/assets/models/*.glb` 访问。

## 谁在真正读这些文件

以下测试**从磁盘直接读取**本目录，删除文件会立即失败：

- [glb-assets.test.ts:8](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/three/glb-assets.test.ts#L8) — `table.glb`
- [proposal-preview.test.ts:22](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/three/proposal-preview.test.ts#L22) — `table.glb`
- [file-io.test.ts:116](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/file-io.test.ts#L116) — `table.glb`
- [scene-delivery.test.ts:25](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/scene-delivery.test.ts#L25) — `chair.glb`

只引用 `/assets/models/*.glb` URL（由 `frontend/public/` 下的副本提供）的测试：

- [backend-adapter.test.ts:107](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/backend-adapter.test.ts#L107)
- [item-context-popover.react.test.tsx:77](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/item-context-popover.react.test.tsx#L77)、[:111](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/item-context-popover.react.test.tsx#L111)
- [schema.test.ts:690](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/schema.test.ts#L690)
- [share.test.ts:52](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/share.test.ts#L52)
- [online-models.test.ts:194](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/online-models.test.ts#L194)
- [file-io.test.ts:78](file:///c:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/lib/file-io.test.ts#L78)

数据与模板侧：

- [assets/catalogue.json:14-237](../catalogue.json) — 5 条 `localPath` 指向本目录，并记录 `bytes` / `sha256`。
- [studio/template.json:254](../../scene/templates/studio/template.json#L254) `laptop.glb`、[cafe/template.json:209](../../scene/templates/cafe/template.json#L209) `plant.glb` 仍按本目录取用。
  注：museum / market 的归档溯源已改为指向 `assets/library/model/` 中与其 SHA-256 相符的原件，因为本目录同名文件后来被换成了另一批模型。

## 删除前必须知道

⚠️ **不要直接删除这 5 个文件。** 至少 4 个测试用 `readFileSync` 读磁盘，`assets/catalogue.json` 也按 `localPath` 校验存在性与哈希，删除会直接导致失败。

如果确实要去重，请按此顺序改引用，再删文件：

1. 把上述 4 个测试的读取路径改为 `assets/library/model/<slug>.glb`；
2. 把 `assets/catalogue.json` 与 `frontend/public/assets/catalogue.json` 的 `localPath` 改为库内路径；
3. 把 `frontend/public/assets/models/` 与浏览器 URL 一并改到库路径；
4. 全仓确认 `/assets/models/` 与 `assets/models/` 无残留引用后，才删除本目录。

参考：`assets/library/README.md`（物料库索引）。
