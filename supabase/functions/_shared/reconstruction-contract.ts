import {z} from 'zod';
import {canonical,dimensionSchema,leaseSchema,sceneSchema,sceneV2Schema,sourceSchema,uuid} from './domain.ts';
export {sourceSchema as sourceImageSchema,dimensionSchema as dimensionConstraintSchema} from './domain.ts';
export type {SourceImage,DimensionConstraint,SceneV2} from './domain.ts';
export const reconstructionRequestSchema=z.strictObject({...leaseSchema.shape,requestId:uuid,localRevision:z.number().int().nonnegative(),scene:sceneSchema,sources:z.array(sourceSchema).max(12),dimensions:z.array(dimensionSchema).max(128),mode:z.enum(['restore','redesign']),instruction:z.string().trim().min(1).max(3000),selectedIds:z.array(uuid).max(50).default([]),reviewedScene:sceneV2Schema.optional(),reviewedJobId:uuid.optional()}).superRefine((input,ctx)=>{
 if(input.reviewedJobId&&!input.reviewedScene)ctx.addIssue({code:'custom',message:'继续核对任务须携带修改后的候选结构'});
 if(!input.sources.length){
  if(input.scene.schemaVersion!==2||!input.reviewedScene){ctx.addIssue({code:'custom',message:'没有来源图片时须提供当前已确认的 v2 场地'});return;}
  if(input.reviewedJobId)return; // Server verifies the previous needs_review job, base hash and source identity.
  for(const key of ['venue','structure','sources','dimensions'] as const)if(canonical(input.scene[key])!==canonical(input.reviewedScene[key]))ctx.addIssue({code:'custom',message:'无图片规划须保留当前场地结构和尺寸'});
 }
});
export type ReconstructionRequest=z.infer<typeof reconstructionRequestSchema>;
export const reconstructionIssueSchema=z.object({code:z.string(),message:z.string(),targetId:z.string().optional()});
export type ReconstructionIssue=z.infer<typeof reconstructionIssueSchema>;
export const reconstructionJobSchema=z.object({id:uuid,state:z.enum(['queued','recognizing','needs_review','planning','validating','ready','failed']),candidate:sceneV2Schema.nullable().optional(),proposal:z.object({id:uuid,candidate:sceneSchema}).passthrough().nullable().optional(),issues:z.array(reconstructionIssueSchema).default([]),error_code:z.string().nullable().optional()}).passthrough();
