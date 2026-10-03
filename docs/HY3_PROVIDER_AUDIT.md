# HY-3D 升级前核查与生成任务约束

核查日期：2026-10-03。DeepSeek 继续策划，HY-3D 负责资产生成。没有执行付费生成、修改云端供应商设置或提高预算。

## 实际生产基线

- Pages：`28d0c30c-52e8-47a3-9bce-20b186a2fd59`，源提交 `9972522`。
- scene-api：ACTIVE v11，bundle SHA-256 `0873d9eb7a62446cf1869a9dd4a1ea3596abc8a91021e0f883fc297883957d5d`。已下载 12 个入口与依赖 TS 文件，均与升级前工作树逐字节一致；CLI 因公共目录 JSON 位于 functions 外拒绝提取该 JSON，不能将此记为完整 bundle 比对。
- generation-worker：ACTIVE v5，bundle SHA-256 `29bca69b04e5ae057160bca8ffd948833391669730893dee6f59b37e5266bea4`。入口、worker、GLB 验证器和资源归档实现与工作树一致；共享依赖存在之后上线的场景 Agent、结构与重建支持，混元调用部分一致。
- reconstruction-worker：ACTIVE v2，未改。
- 云端存在 HUNYUAN_API_KEY、HUNYUAN_API_MODE、条款确认和预算配置。模式摘要与 tokenhub 一致；没有 TENCENTCLOUD_SECRET_ID、TENCENTCLOUD_SECRET_KEY、TENCENTCLOUD_REGION、HUNYUAN_MODEL 或 HUNYUAN_TEXTURE_ENABLED。
- 旧接入记录的 Key 仅授权 3.0。未核验该 Key 现有 3.1/纹理授权，也未查询充值或开启后付费。不能把接口文档支持等同于账户权限。

## 已核对的官方参数

[TokenHub HY-3D](https://cloud.tencent.com/document/product/1823/137181) 支持 hy-3d-3.0 / hy-3d-3.1。文字与 image_url/image_base64 互斥。3.1 不支持 LowPoly；显式选用时发送 Normal、face_count=20000、enable_pbr=true，不指定 result_format，从结果中选择 GLB。默认新任务仍为 3.0 LowPoly。

[TokenHub 纹理](https://cloud.tencent.com/document/product/1823/137183) 使用 hy-3d-texture，输入 file_3d.url 与 image.url；公开文档没有 prompt 参数。提交携带 enable_pbr=true、enable_keep_uv=true、texture_size=1024。查询 model 必须与提交一致。此路径不能通过文字描述直接重绘纹理。

[腾讯原生纹理](https://cloud.tencent.com/document/api/1804/126292) 支持 Model=3.1、GLB/OBJ、Prompt 或 Image，以及保留 UV；[原生生成](https://cloud.tencent.com/document/api/1804/123447) 同样支持 3.1。它们使用 ai3d.tencentcloudapi.com 和 2025-05-13 API，而非 TokenHub Bearer Key。此次不引入未配置的原生鉴权。

## 应用契约与恢复

`POST /jobs` 保留 `{requestId,prompt}`，增加 `kind`（text/image/texture）、`referenceImageAssetId` 与 `sourceAssetId`。image 必须上传本人 PNG/JPEG；texture 还需有访问权的 GLB。图片与源模型以资产 ID 保存，提交时才签名，数据库不保存供应商输入临时 URL。image/texture 的 prompt 是任务名称，不发给仅接受图片的提供商模式。

`GET /generation/capabilities` 根据服务端配置返回 model、textToModel、imageToModel、texture 和 textureRequiresImage。HUNYUAN_MODEL 可显式选择 hy-3d-3.1；HUNYUAN_TEXTURE_ENABLED=true 才开放纹理请求。缺少账户能力核验时不自动写入这两个设置。

新增任务持久化 provider_mode/provider_model，旧生产任务固定 TokenHub 3.0。相同 requestId 重放不改变已保存的提供商身份。新旧任务仍使用原有预算、单并发、超时未知保护和不可自动重复收费规则。

## 纹理验收边界

付费前检查源 GLB 有可用 TEXCOORD_0；动画、骨骼、morph target、必需扩展及超过现有资源预算的模型不进入这条纹理流程。结果先通过现有 GLB 验证器，再比较节点名称/层级/变换、世界坐标顶点、索引与全部 UV。坐标和 UV 容差最多 1e-5；索引和变换严格一致。

比较按既有节点和顶点顺序执行，未实现重排规范化；等价但重排的结果也可能被拒绝。只有 geometryPreserved 和 uvPreserved 均为 true 才注册新独立资产，记录 parentAssetId、源哈希、模型版本及采购待确认状态。不会更新原资产或自动替换场景。

未通过结果记为 rejected / TEXTURE_GEOMETRY_CHANGED，并保存质量证据；不进入可用资产库。本轮未提供待复核候选预览、无 UV 自动展开或拒绝结果的长期文件留存。旧来源没有 UV 时提示该能力限制，不能宣称已经完成保形纹理生成。

实际 TokenHub 3.1/纹理权限、供应商读取私有输入 URL 的时效、真实 GLB 质量和费用仍需使用相应账户进行真实验收。受控接口测试不能替代这些证据。
