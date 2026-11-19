# 场景模板库（已移出本仓）

10 套完整场景模板（体育馆 · 黑客松、青序 · 香氛快闪、琥珀间 · 酒吧、慢调咖啡 · SLOW NOTES、学术会议 · 共知、室外草坪 · 旷野有约、风物市集 · 户外市集、留白之间 · 美术馆展区、办公室 · 留白、留白 · 摄影工作室）已于 **2026-11-19** 整体移出，现由独立仓库维护：

> [`LiliLIN0324/scendance-scene-library`](https://github.com/LiliLIN0324/scendance-scene-library)

## 现在在哪

| 内容 | 位置 |
| --- | --- |
| 10 套原始归档（GLB + `template.json` + 总览图 + `ASSET-SOURCES.md`） | 新仓库 `scene/templates/<key>/` |
| 拆分构建器（`Preset_Structure` / `Preset_Objects`） | 新仓库 `scripts/package-scene-presets.mjs` |
| 每套可编辑范围、分组规则、边界 | 新仓库 `docs/SCENE-PRESETS.md` |
| 构建产物（`<key>.glb` + `preview.jpg`） | `node scripts/build.mjs` 输出到新仓库 `dist/scene-presets/` |
| 公开取用地址 | https://lililin0324.github.io/scendance-scene-library/ |

## 本仓留下了什么

- 编辑器不再有「场景模板库」面板、`scenePreset` 字段与整馆 GLB 加载链路；物件上限统一回 200 件/层（`lib/item-limits.ts`）。
- 官网 `introduction.html` 的十场景查看器仍在，但 GLB 改为直接从上面的公开站点取。
- 云端契约 `supabase/functions/_shared/domain.ts` 中的 `scenePreset` / `presetNode` 字段保留未动（属 Edge Functions 契约，需人工 review 才能改）；旧云端工程里的这类字段在编辑器打开时按普通物件处理，保存时会被明确拒绝并提示。

需要模板数据或新增场景，请到新仓库提改动，不要在本仓恢复 `scene/templates/`。
