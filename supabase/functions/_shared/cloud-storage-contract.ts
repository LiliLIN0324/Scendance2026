import { z } from 'zod';
import { sceneSchema, uuid } from './domain.ts';

export const archiveFormats = ['glb','spz','ply','png','jpeg','webp','pdf','svg','dxf','dwg','zip','json','txt','csv','docx','xlsx','pptx','mp4','mov','insv','osv'] as const;
export const archiveUploadSchema = z.strictObject({
  requestId:uuid, studioId:uuid.optional(), name:z.string().trim().min(1).max(120),
  kind:z.enum(['model','scan','floorplan','photo','attachment']), format:z.enum(archiveFormats),
  byteSize:z.number().int().positive().max(2*1024**3), sha256:z.string().regex(/^[a-f0-9]{64}$/),
});
export type ArchiveUploadInput = z.infer<typeof archiveUploadSchema>;
export interface CloudCapabilities { version:1; superAdmin:boolean; officialStudioId:string|null }
export const cloudCapabilitiesSchema = z.strictObject({
  version: z.literal(1),
  superAdmin: z.boolean(),
  officialStudioId: uuid.nullable(),
});
export interface CloudArchiveAsset {
  id:string; name:string; kind:string; format:string; byteSize:number; sha256:string;
  ownerId:string; studioId:string|null;
  /** full=服务端逐字节复核过哈希；size-only=仅核对对象大小（超过阈值的直传）。 */
  integrity:'full'|'size-only';
  metadata:Record<string,unknown>; createdAt:string;
}
export const archiveAssetViewSchema = z.strictObject({
  id:uuid, name:z.string().min(1), kind:z.string(), format:z.string(),
  byteSize:z.number().int().positive(), sha256:z.string().regex(/^[a-f0-9]{64}$/),
  ownerId:z.string().min(1), studioId:uuid.nullable(),
  integrity:z.enum(['full','size-only']),
  metadata:z.record(z.string(),z.unknown()), createdAt:z.string(),
  reused:z.boolean().optional(),
});
export interface ArchiveUploadReceipt { uploadId:string; assetId:string|null; state:'pending'|'complete'; uploadUrl:string|null; token:string|null; storagePath:string; asset?:CloudArchiveAsset|null|undefined }
export const archiveUploadReceiptSchema = z.strictObject({
  uploadId:uuid, assetId:uuid.nullable(), state:z.enum(['pending','complete']),
  uploadUrl:z.string().nullable(), token:z.string().nullable(), storagePath:z.string().min(1),
  asset:archiveAssetViewSchema.nullable().optional(),
});
export const completeManifestSchema=z.strictObject({
  version:z.literal(1), scene:sceneSchema, outdoor:z.record(z.string(),z.unknown()).nullable(),
  sources:z.record(z.string(),z.unknown()),
  dependencies:z.array(z.strictObject({assetId:uuid,visibility:z.enum(['private','published'])})).max(2000),
}).superRefine((value,ctx)=>{if(new Set(value.dependencies.map(d=>d.assetId.toLowerCase())).size!==value.dependencies.length)ctx.addIssue({code:'custom',message:'依赖不能重复'});});
export const completeSaveSchema=z.strictObject({requestId:uuid,sessionId:uuid,generation:z.number().int().positive(),expectedRevision:z.number().int().nonnegative(),manifest:completeManifestSchema});
export type CompleteManifest=z.infer<typeof completeManifestSchema>;
export type CompleteSaveInput=z.infer<typeof completeSaveSchema>;
export interface CompleteProjectReceipt { projectId:string; revision:number; manifest:CompleteManifest; confirmedAt:string; dependencyCount:number }
export const cloudCaseIdSchema=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const caseWriteSchema=z.strictObject({requestId:uuid,expectedVersion:z.number().int().nonnegative(),title:z.string().trim().min(1).max(120),description:z.string().max(4000),category:z.string().max(120),coverAssetId:uuid.nullable(),sortOrder:z.number().int(),projectId:uuid,provenance:z.string().min(1).max(4000)});
export const casePublishSchema=z.strictObject({requestId:uuid,expectedVersion:z.number().int().nonnegative(),expectedRevision:z.number().int().nonnegative()});
export const caseUnpublishSchema=casePublishSchema.omit({expectedRevision:true});
export const caseRestoreSchema=caseUnpublishSchema.extend({publicationId:uuid});
export type CloudCaseWriteInput=z.infer<typeof caseWriteSchema>;
export type CloudCasePublishInput=z.infer<typeof casePublishSchema>;
export type CloudCaseUnpublishInput=z.infer<typeof caseUnpublishSchema>;
export type CloudCaseRestoreInput=z.infer<typeof caseRestoreSchema>;
export interface CloudCasePublic {
  id:string; title:string; description:string; category:string;
  coverAssetId:string|null; coverUrl:string|null; sortOrder:number; provenance:string;
  publicationId:string; revision:number; version:number; publishedAt:string; updatedAt:string;
}
export const cloudCasePublicSchema = z.strictObject({
  id:z.string().min(1), title:z.string(), description:z.string(), category:z.string(),
  coverAssetId:uuid.nullable(), coverUrl:z.string().nullable(), sortOrder:z.number().int(),
  provenance:z.string(), publicationId:uuid, revision:z.number().int().nonnegative(),
  version:z.number().int().positive(), publishedAt:z.string(), updatedAt:z.string(),
});
export interface CloudCaseDraft extends Omit<CloudCasePublic,'coverUrl'|'publicationId'|'revision'|'publishedAt'|'version'|'updatedAt'> {
  stableId:string; projectId:string; version:number; status:'published'|'unpublished';
  publicationId:string|null; revision:number|null; publishedAt:string|null;
}
export const cloudCaseDraftSchema = z.strictObject({
  id:uuid, stableId:z.string().min(1), title:z.string(), description:z.string(), category:z.string(),
  coverAssetId:uuid.nullable(), sortOrder:z.number().int(), provenance:z.string(),
  projectId:uuid, version:z.number().int().nonnegative(),
  status:z.enum(['published','unpublished']),
  publicationId:uuid.nullable(), revision:z.number().int().nonnegative().nullable(),
  publishedAt:z.string().nullable(),
});
export interface CloudCaseVersion { version:number; publicationId:string; revision:number; createdAt:string; action:'publish'|'restore'|'unpublish'; actorId?:string }
export const cloudCaseVersionSchema = z.strictObject({
  version:z.number().int().positive(), publicationId:uuid, revision:z.number().int().nonnegative(),
  createdAt:z.string(), action:z.enum(['publish','restore','unpublish']), actorId:z.string().optional(),
});
/** 公开发布依赖视图：服务端已换签名地址，无 ownerId/storagePath。 */
export interface CloudPublishedAsset {
  id:string; name:string; kind:string; format:string; byteSize:number; sha256:string;
  integrity:'full'|'size-only'; metadata:Record<string,unknown>; url:string; expiresIn:number;
}
export const cloudPublishedAssetSchema = z.strictObject({
  id:uuid, name:z.string(), kind:z.string(), format:z.string(),
  byteSize:z.number().int().positive(), sha256:z.string(),
  integrity:z.enum(['full','size-only']), metadata:z.record(z.string(),z.unknown()),
  url:z.string(), expiresIn:z.number().int().positive(),
});
export interface CompletePublicRead {
  case?:{ id:string; title:string; description:string; category:string; version:number; publishedAt:string } | undefined;
  projectId?:string | undefined;
  publicationId:string; revision:number;
  manifest:CompleteManifestPublic;
  assets:CloudPublishedAsset[];
}
export type CompleteManifestPublic=z.infer<typeof completeManifestPublicSchema>;
/** 公开发布 manifest：与 completeManifest 同形但无 sources（私有原资料永不出网）。 */
export const completeManifestPublicSchema = z.strictObject({
  version:z.literal(1), scene:sceneSchema, outdoor:z.record(z.string(),z.unknown()).nullable(),
  dependencies:z.array(z.strictObject({assetId:uuid,visibility:z.enum(['private','published'])})),
});
export const completePublicReadSchema = z.strictObject({
  case:z.strictObject({
    id:z.string(), title:z.string(), description:z.string(), category:z.string(),
    version:z.number().int().positive(), publishedAt:z.string(),
  }).optional(),
  projectId:uuid.optional(),
  publicationId:uuid, revision:z.number().int().nonnegative(),
  manifest:completeManifestPublicSchema,
  assets:z.array(cloudPublishedAssetSchema),
});
export const completeShareSchema=z.strictObject({requestId:uuid,expectedRevision:z.number().int().nonnegative()});
export type CompleteShareInput=z.infer<typeof completeShareSchema>;
export interface CompleteShareReceipt { shareId:string; publicationId:string; revision:number; /** 只在首次创建响应中出现；服务端仅存哈希，重试返回 null。 */ token:string|null }
export const completeShareReceiptSchema=z.strictObject({
  shareId:uuid, publicationId:uuid, revision:z.number().int().nonnegative(),
  token:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
export const archiveMime:Record<(typeof archiveFormats)[number],string>={glb:'model/gltf-binary',spz:'application/octet-stream',ply:'application/octet-stream',png:'image/png',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',svg:'image/svg+xml',dxf:'application/dxf',dwg:'application/acad',zip:'application/zip',json:'application/json',txt:'text/plain',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',mp4:'video/mp4',mov:'video/quicktime',insv:'application/octet-stream',osv:'application/octet-stream'};
