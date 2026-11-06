import { z } from 'zod';
import { leaseSchema, sceneSchema, uuid } from './domain.ts';
import { materialSuggestionSchema } from './agent-material-contract.ts';
import { modelSuggestionSchema } from './ai.ts';
import { AGENT_PHASES } from './agent-progress.ts';
import { activityTaskRunRequestSchema, activityTaskRunSchema } from './activity-task-contract.ts';

export const agentContextSchema=z.strictObject({
  brief:z.string().max(12000).default(''),acceptedDecisions:z.array(z.string().max(1000)).max(20).default([]),
  recentMessages:z.array(z.strictObject({role:z.enum(['user','assistant']),text:z.string().max(3000)})).max(12).default([]),
  lastProposalExplanation:z.string().max(1200).optional(),
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
