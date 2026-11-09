import { z } from 'zod';
import { leaseSchema, sceneSchema, uuid } from './domain.ts';
import { materialSuggestionSchema } from './agent-material-contract.ts';
import { modelSuggestionSchema } from './ai.ts';
import { AGENT_PHASES } from './agent-progress.ts';
import { activityTaskRunRequestSchema, activityTaskRunSchema, modelGeneratedTextNoticeSchema } from './activity-task-contract.ts';

const seatingEvidence=z.string().trim().min(1).max(200);
export const agentSeatingAllocationSchema=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('one_per_desk'),peoplePerDesk:z.literal(1),evidence:seatingEvidence,source:z.literal('user')}),
  z.strictObject({status:z.literal('shared_desk'),peoplePerDesk:z.number().int().min(2).max(100),evidence:seatingEvidence,source:z.literal('user')}),
  z.strictObject({status:z.literal('unknown'),peoplePerDesk:z.null(),evidence:seatingEvidence,source:z.enum(['user','unverified'])}),
]);
const agentSeatingSizeFact=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('reported'),valueM:z.number().finite().min(.01).max(50),evidence:seatingEvidence,source:z.literal('user')}),
  z.strictObject({status:z.literal('unknown'),valueM:z.null(),evidence:seatingEvidence,source:z.enum(['user','unverified'])}),
]);
const agentSeatingItemSpecs=z.strictObject({width:agentSeatingSizeFact.optional(),depth:agentSeatingSizeFact.optional(),height:agentSeatingSizeFact.optional()});
export const agentSeatingSpecsSchema=z.strictObject({desk:agentSeatingItemSpecs.optional(),chair:agentSeatingItemSpecs.optional()});
// Client-supplied planning marks are an observation, never a site fact or a validation result.
const annotationId=z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const coordinate=z.number().finite().min(-1000).max(1000);
const annotationPoint=z.strictObject({x:coordinate,z:coordinate});
const annotationItem=z.discriminatedUnion('kind',[
  z.strictObject({id:annotationId,kind:z.literal('zone'),geometry:z.strictObject({kind:z.literal('rect'),x:coordinate,z:coordinate,width:z.number().finite().positive().max(1000),depth:z.number().finite().positive().max(1000)}),zoneType:z.enum(['roundtable','checkin','photo','rest','desk','reserved']).nullable(),source:z.literal('unverified')}),
  z.strictObject({id:annotationId,kind:z.literal('route'),geometry:z.strictObject({kind:z.literal('polyline'),points:z.array(annotationPoint).min(2).max(100)}),source:z.literal('unverified')}),
  z.strictObject({id:annotationId,kind:z.literal('measure'),geometry:z.strictObject({kind:z.literal('measure'),from:annotationPoint,to:annotationPoint}),source:z.literal('unverified')}),
  z.strictObject({id:annotationId,kind:z.literal('door'),geometry:z.strictObject({kind:z.literal('door'),wall:z.enum(['north','south','east','west']),position:coordinate}),positionStatus:z.enum(['inferred','unverified']),widthStatus:z.literal('unknown'),directionStatus:z.literal('unknown')}),
]);
export const agentAnnotationObservationSchema=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('unavailable')}),
  z.strictObject({status:z.literal('ready'),binding:z.strictObject({activityScope:annotationId.refine(value=>value.startsWith('activity:')&&value.length>9),activityEpoch:z.number().int().nonnegative().safe(),sceneRevision:z.number().int().nonnegative().safe(),floorId:annotationId,annotationRevision:z.number().int().nonnegative().safe()}),annotations:z.array(annotationItem).max(100),notice:z.literal('标注是待核验的规划草稿；读取不代表已用于排布或完成安全检查。')}),
]).superRefine((observation,ctx)=>{
  if(observation.status!=='ready')return;
  const ids=new Set<string>();let points=0;
  for(const item of observation.annotations){
    if(ids.has(item.id))ctx.addIssue({code:'custom',message:'duplicate annotation'});ids.add(item.id);
    if(item.kind==='route')points+=item.geometry.points.length;
    if(item.kind==='zone'&&(Math.abs(item.geometry.x+item.geometry.width)>1000||Math.abs(item.geometry.z+item.geometry.depth)>1000))ctx.addIssue({code:'custom',message:'annotation outside bounds'});
  }
  if(points>1000)ctx.addIssue({code:'custom',message:'too many annotation points'});
});
export const agentContextSchema=z.strictObject({
  brief:z.string().max(12000).default(''),acceptedDecisions:z.array(z.string().max(1000)).max(20).default([]),
  recentMessages:z.array(z.strictObject({role:z.enum(['user','assistant']),text:z.string().max(3000)})).max(12).default([]),
  lastProposalExplanation:z.string().max(1200).optional(),
  seatingAllocation:agentSeatingAllocationSchema.optional(),
  seatingSpecs:agentSeatingSpecsSchema.optional(),
  annotationObservation:agentAnnotationObservationSchema.optional(),
});
export const agentRunRequestSchema=z.strictObject({
  ...leaseSchema.shape,requestId:uuid,localRevision:z.number().int().nonnegative(),scene:sceneSchema,
  selectedIds:z.array(uuid).max(50),instruction:z.string().trim().min(1).max(6000),context:agentContextSchema.default({brief:'',acceptedDecisions:[],recentMessages:[]}),
  jevEnabled:z.boolean().default(false),executionMode:z.enum(['preview','direct']).default('preview'),
});
export type AgentRunRequest=z.infer<typeof agentRunRequestSchema>;
// Keep the Scene parser unchanged: absent kind must not change stored request fingerprints.
export const agentDispatchRequestSchema=z.union([activityTaskRunRequestSchema,agentRunRequestSchema]);
export const agentProposalSchema=z.object({
  id:uuid,project_id:uuid,user_id:z.string().min(1),session_id:uuid,generation:z.number(),base_revision:z.number(),local_revision:z.number(),base_hash:z.string(),
  base_scene:sceneSchema,candidate:sceneSchema,explanation:z.string(),warnings:z.array(z.object({code:z.string(),ids:z.array(z.string())})),
  expires_at:z.string(),applied_at:z.string().nullable(),
  modelSuggestions:z.array(modelSuggestionSchema).optional(),materialSuggestions:z.array(materialSuggestionSchema.extend({sourceAssetId:uuid})).optional(),
});
export const agentEvaluationSchema=z.object({
  status:z.enum(['complete','unavailable','partial']),choice:z.enum(['A','B','C','NONE']).optional(),
  probabilities:z.object({A:z.number().min(0).max(1),B:z.number().min(0).max(1),C:z.number().min(0).max(1),NONE:z.number().min(0).max(1)}).optional(),
  confidence:z.number().min(0).max(1).optional(),message:z.string(),
});
export const agentRunSchema=z.object({
  id:uuid,projectId:uuid,requestId:uuid,state:z.enum(['queued','running','complete','failed','cancelled']),progress:z.string(),
  callCount:z.number().int().nonnegative(),
  modelText:modelGeneratedTextNoticeSchema.optional(),
  /** 这一趟工作推进到哪一段（四段工作）。可空：没有阶段账的老记录与活动任务运行都没有这条，界面就不显示阶段。 */
  phase:z.enum(AGENT_PHASES).nullish(),
  candidates:z.array(z.object({label:z.enum(['A','B','C']),title:z.string(),proposal:agentProposalSchema})).max(3),
  evaluation:agentEvaluationSchema.nullable(),errorCode:z.string().optional(),message:z.string().optional(),
  executionMode:z.enum(['preview','direct']),jevEnabled:z.boolean(),expiresAt:z.string(),
  /** 这趟一共收到过几条运行中改道备注；活动任务运行没有这条通道，缺省为 0。 */
  steerTotal:z.number().int().nonnegative().optional(),
});
export type AgentRun=z.infer<typeof agentRunSchema>;
export const agentDispatchRunSchema=z.preprocess((value,ctx)=>{
  if(value&&typeof value==='object'&&'kind' in value&&value.kind==='activity_tasks'&&!activityTaskRunSchema.safeParse(value).success){
    ctx.addIssue({code:'custom',message:'Invalid activity task run'});
  }
  return value;
},z.union([activityTaskRunSchema,agentRunSchema]));
export type AgentEvaluation=z.infer<typeof agentEvaluationSchema>;
