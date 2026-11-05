# 不可变材质与纹理派生资产

纯数据契约：`supabase/functions/_shared/asset-customization-contract.ts`。场景仍使用 `domain.ts`；不扩展场景 schema、不改已有 assetId 内容，不向 DeepSeek 开放存储写入。

| 请求 | 输入 | 返回与约束 |
|---|---|---|
| GET `/assets/:assetId/materials` | 无 | `MaterialInspection`：资产 `id/name/sha256`，可选 `parentAssetId`、真实材质槽和验证摘要；沿用 assets.get 授权 |
| POST `/assets/:assetId/customize` | `{requestId,sourceSha256,materialIndices,baseColor?,metallic?,roughness?,removeBaseColorTexture?:true}` | 新 GLB 资产行，201；同请求与内容重放200。源 SHA 不符409，重复槽/空修改/未知字段400，不存在或未使用槽422 |
| POST `/projects/:id/material-variants` | `{requestId,sessionId,generation,expectedRevision,localRevision,scene,objectIds,sourceAssetId,variantAssetId}` | 普通 SceneProposal，201；同请求重放200。只准备预览，不保存场景、不消费 AI 预算 |

材质槽必须显式选择（1–64 个，不重复）；颜色为 sRGB 十六进制，写入 glTF 时转换成线性 baseColorFactor 并保留 alpha。metallic 和 roughness 均在 0–1。默认保留纹理，baseColor 与现有纹理叠色；只有 `removeBaseColorTexture:true` 明确删除所选槽的 baseColorTexture 引用。模型中的图像、BIN、UV、节点、索引、accessor、变换和所有非 materials JSON 保留。源和结果均经过 glTF validator；允许资源库已有的 KHR_mesh_quantization / EXT_texture_webp required extensions，不改变生成模型质量校验器。

输出是新的个人资产 ID 与内容寻址存储路径，继承源许可、来源和几何元数据。metadata 包含 `parentAssetId/sourceSha256/changeMode:'material'/materialVariant`，后者记录槽、修改参数、`geometryUVPreserved:true`、不变部分的 SHA 签名，以及 `procurementStatus:'needs_confirmation'`。视觉修改不代表实物材质规格已确认。

提案只替换用户选中、未锁定、确实引用 sourceAssetId 的实例的 assetId；尺寸、位置、旋转、颜色、备注、锁定等字段保持不变。对象 color 仍会和 GLB 材质叠色。variant 必须是该源资产的直接派生版本，metadata 源 SHA 与已授权源资产一致；也支持显式恢复到直接父版本。纹理派生只接受 worker 标记 `changeMode:'texture'` 且 `textureVariant.validation` 的 geometryPreserved 和 uvPreserved 都为 true、tolerance=1e-5、comparison=`ordered-accessors-and-nodes` 的版本。

确认后仍调用既有 `/projects/:id/proposals/apply`，使用当前 lease / cloud revision / localRevision / scene hash 校验。应用前后正常执行资产权限与结构检查；预览过期、租约或场景变化不会覆盖新编辑。撤销也可沿用既有场景历史。

迁移 `20261003160000_material_variants.sql` 只增加服务端幂等登记表，包裹并委托此前的 scene_rpc，保留已有删除/授权等分支。浏览器角色不获得表/RPC访问权；不新增模型计费条目。本轮与生成输入迁移 `20261003161000_generation_inputs.sql` 一起发布：两条迁移按序同事务执行，再依次发布 generation-worker、scene-api、前端，避免旧 worker 处理新图片任务。
