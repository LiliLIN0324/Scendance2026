# GLB 资产核查与交付边界

日期：2026-10-03。范围：仓库内 5 个实际 GLB；未发起付费生成，未访问腾讯控制台或改变供应商。

使用本工作树锁定依赖 `@gltf-transform/core` 读取真实节点、材质、顶点、UV 和包围盒，使用 `gltf-validator` 验证。完整数据与 SHA-256 见 [JSON 记录](hy3-assets-p0.json)。来源来自随库 catalogue 的来源页及 CC0 许可记录，没有以文件名称推断版权。

|样本|宽 × 高 × 深（m）|面数|节点/网格/材质|UV0|动画|
|---|---|---:|---|---|---|
|[模块会议桌](https://3dassets.dev/assets/hotel-and-resort-operations-conference-table-module-a6abb373)|1.6000 × 0.7420 × 0.8999|1476|7/5/4|无|open, close|
|[可叠放座椅](https://3dassets.dev/assets/office-lobby-and-facilities-canteen-stacking-chair-3440c7d8)|0.4600 × 0.8868 × 0.5137|1022|4/3/3|无|无|
|[椅子](https://3dassets.dev/assets/bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7)|0.4897 × 1.0028 × 0.4713|672|3/2/2|无|无|
|[讲台](https://3dassets.dev/assets/japanese-school-and-city-street-lectern-f8b909de)|0.6200 × 1.5450 × 0.4201|416|3/2/2|完整|无|
|[帐篷](https://3dassets.dev/assets/mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea)|3.7201 × 1.5789 × 3.8151|1840|5/4/4|无|无|

所有样本的文件哈希与原目录相符；glTF Validator 均为 0 errors / 0 warnings。全部使用 `KHR_mesh_quantization`；讲台还使用 `EXT_texture_webp`，含两张 512 × 512 WebP。没有 Draco、Meshopt、KTX2 或骨骼样本，不能据此承诺这些格式已支持。当前 GLTFLoader 未配置这些压缩解码器。

## P3 最小路径

现有实例已通过独立父节点归一化到底面中心，按确认尺寸缩放；每实例复制几何、材质和纹理，适合指定实例的参数调整。旧 tint 为原色乘法，不等于精确白色，也不能独立控制粗糙度/金属度。静态椅子可先做确定性的材质派生版本。两把椅子、会议桌与帐篷均没有 UV，不能称其通过保 UV 纹理生成验收；讲台才适合后续 UV 纹理流程的首轮验证。会议桌有开盖动画，应保留来源和静态姿态，不承诺动画编辑或导出。

## P5 交付边界

现有通用 GLB 下载函数直接复制实时画布，可能包含相机剖切、碰撞着色、幽灵层和未加载占位；新 Agent 交付从当前有效 Scene 重新组装，复用现有模型/结构构建器，导出后重新加载并比较物件标识、几何/UV、材质及变换。原始编辑画布和缓存资产不修改。

场景 JSON 沿用当前规范场景及不可变资产 ID，另附来源和物料统计；不保存签名下载地址。BOM 按资产版本、尺寸和颜色分组，不虚构采购编号、价格或规格已确认状态。生成物料标记为概念物料。

当前规范协议只支持单层场地；完整 GLB 场馆预设、glbNode 子节点预设、未接入协议的建筑结构及骨骼模型会明确拒绝交付，避免输出不完整场景。JSON 中坐标仍是既有规范的场地西北角原点，GLB 沿用编辑器场地中心原点；均为米与 Y 轴向上，并显式记录。环境光、HDR 和后处理不属于 GLB 保真承诺。

本记录是本地结构/文件验证，没有指定移动设备帧率、腾讯真实调用、历史供应商文件失效或多成员生产环境的验收结论。
