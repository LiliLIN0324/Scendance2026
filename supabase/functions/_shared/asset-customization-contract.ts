import { z } from 'zod';
import { colorSchema, leaseSchema, sceneSchema, uuid } from './domain.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const changeFields={
  baseColor:colorSchema.optional(),metallic:z.number().min(0).max(1).optional(),
  roughness:z.number().min(0).max(1).optional(),removeBaseColorTexture:z.literal(true).optional(),
};
const hasChange=(change:Partial<Record<keyof typeof changeFields,unknown>>)=>
  Object.keys(changeFields).some(key=>change[key as keyof typeof changeFields]!==undefined);
export const materialChangeSchema=z.strictObject(changeFields).refine(hasChange,'至少选择一项材质修改');
export type MaterialChange=z.infer<typeof materialChangeSchema>;
const materialIndices=z.array(z.number().int().min(0).max(63)).min(1).max(64)
  .refine(indices=>new Set(indices).size===indices.length,'材质槽不能重复');
export const assetCustomizationRequestSchema=z.strictObject({
  requestId:uuid,sourceSha256:hash,materialIndices,...changeFields,
}).refine(hasChange,'至少选择一项材质修改');
export const materialInspectionSchema=z.object({
  id:uuid,name:z.string(),sha256:hash,parentAssetId:uuid.optional(),
  slots:z.array(z.object({
    index:z.number().int().nonnegative(),name:z.string(),baseColor:colorSchema,
    baseColorFactor:z.tuple([z.number(),z.number(),z.number(),z.number()]),
    metallic:z.number(),roughness:z.number(),hasBaseColorTexture:z.boolean(),
    hasMetallicRoughnessTexture:z.boolean(),primitiveCount:z.number().int().nonnegative(),
  })).max(64),
  validation:z.object({hasUV:z.boolean(),geometryUVSignature:hash,validationWarnings:z.number().int().nonnegative()}),
});
export type MaterialInspection=z.infer<typeof materialInspectionSchema>;
export const materialVariantMetadataSchema=z.object({
  parentAssetId:uuid,sourceSha256:hash,changeMode:z.literal('material'),
  materialVariant:z.object({
    materialIndices,changes:materialChangeSchema,
    validation:z.object({geometryUVPreserved:z.literal(true),geometryUVSignature:hash}),
    procurementStatus:z.literal('needs_confirmation'),
  }),
}).passthrough();
export const textureVariantMetadataSchema=z.object({
  parentAssetId:uuid,sourceSha256:hash,changeMode:z.literal('texture'),
  textureVariant:z.object({
    validation:z.object({geometryPreserved:z.literal(true),uvPreserved:z.literal(true),tolerance:z.literal(1e-5),comparison:z.literal('ordered-accessors-and-nodes')}),
    procurementStatus:z.literal('needs_confirmation'),
  }),
}).passthrough();
export const derivedVariantMetadataSchema=z.union([materialVariantMetadataSchema,textureVariantMetadataSchema]);
export const materialVariantAssetSchema=z.object({
  id:uuid,name:z.string(),source:z.string(),format:z.literal('glb'),sha256:hash,
  byte_size:z.number().int().positive(),metadata:materialVariantMetadataSchema,
});
export const materialVariantProposalRequestSchema=z.strictObject({
  ...leaseSchema.shape,requestId:uuid,localRevision:z.number().int().nonnegative(),scene:sceneSchema,
  objectIds:z.array(uuid).min(1).max(50).refine(ids=>new Set(ids).size===ids.length,'物件不能重复'),
  sourceAssetId:uuid,variantAssetId:uuid,
});
