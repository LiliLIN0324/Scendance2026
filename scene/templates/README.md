# 工作台场景预设来源

原始归档来自 `LiliLIN0324/scendance` 的 `codex/gym-scene-template` 分支，固定提交 `f2ec7ebd58094e51b868528b1ff499bcd8ea9b0d`。

10 套模板各占一个目录，统一保留最小可复用集：`<key>.glb`、`template.json`、`ASSET-SOURCES.md`、`previews/<key>-overview.jpg`。总览图已统一命名（源为 PNG 的 market、studio 转成了 JPEG），供 `frontend/public/scene-presets/<key>/preview.jpg` 直接使用；`market` 另带 `LICENSE.md`。

`scripts/package-scene-presets.mjs` 在前端 dev/build 时生成 `frontend/public/scene-presets/<key>/`，不需要外部模型服务。**原始 GLB 不修改**：转换只重组 JSON 节点树，二进制几何与贴图逐字节保留。

- 转换把每套模型拆成 `Preset_Structure`（固定场馆）与 `Preset_Objects`（一件一节点的可编辑物件）。
- 天花板 / 屋面板与顶部悬挂灯架不进入编辑视图；店面玻璃、墙体、地面、入口等外观骨架保留。
- `gym`、`popup` 的物件分组按上游导出序号在脚本里手工复刻；其余 8 套按各自 `template.json` 声明的图层分类，配置见脚本顶部的 `PRESET_SOURCES`。
- 各目录 `template.json` 里的 `status`（`local-ready` / `archived` / `local-validated` 等）与「未接入」字样描述的是原归档状态，不是当前工作台状态。实际接入见 [frontend/docs/SCENE-PRESETS.md](../../frontend/docs/SCENE-PRESETS.md)。
- 原始模型、素材许可及照片来源按各目录 `ASSET-SOURCES.md` / `template.json` 保留；不将整套场景统称为 CC0。

## 目录

| key | 名称 | 场地（概念尺寸） |
|---|---|---|
| bar | 琥珀间 · 酒吧 | 12 × 9 m |
| cafe | 慢调咖啡 · SLOW NOTES | 12 × 9 m |
| conference | 学术会议 · 共知 | 24 × 18 m |
| gym | 体育馆 · 黑客松 | 70 × 76 m |
| lawn | 室外草坪 · 旷野有约 | 28 × 20 m |
| market | 风物市集 · 户外市集 | 30 × 22 m |
| museum | 留白之间 · 美术馆展区 | 20 × 14 m |
| office | 办公室 · 留白 | 14 × 10 m |
| popup | 青序 · 香氛快闪 | 12 × 8 m |
| studio | 留白 · 摄影工作室 | 12 × 10 m |
