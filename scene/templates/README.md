# 工作台场景预设来源

原始归档来自 `LiliLIN0324/scendance` 的 `codex/gym-scene-template` 分支，固定提交 `f2ec7ebd58094e51b868528b1ff499bcd8ea9b0d`。

仅引入两个 GLB、总览截图、素材来源和原始 manifest。各目录的 `template.json` 保留上游归档时的说明；其中的「未接入」状态描述原归档，并非当前工作台状态。实际接入见 `frontend/docs/SCENE-PRESETS.md`。

`scripts/package-scene-presets.mjs`在前端 dev/build 时生成 `frontend/public/scene-presets/`，不需要外部模型服务。原始 GLB 不修改；转换只重组节点，二进制几何和贴图保持一致。屋顶/顶部灯架不进入编辑视图，场馆结构固定，家具与人物分别进入工作台物件列表。

- 体育馆：207 件家具、100 位参与者，保留原始坐标和概念比例。70 × 76 的内部编辑范围用于容纳周边布景，不作为实测尺寸或可用面积展示。
- 快闪：将跨图层的桌腿、饰条、台面、产品与标识按上游建模序列组合为完整物件；16 件陈设、24 位来访者、2 位店员，共 42 件。
- 原始模型、素材许可及照片来源按各目录 `ASSET-SOURCES.md` / `template.json` 保留；不将整个场景统称为 CC0。
