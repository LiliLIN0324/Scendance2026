import {z} from 'zod';
import {chatProviderSchema} from './chat-provider.ts';

const chatText=z.string().trim().min(1).max(1200).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
/** 2026-11-19 试点：用户在聊天框附的现场截图（data URL）。最多 10 张、只收 png/jpeg、
 *  data URL 上限 4.5MB（Supabase 函数请求体上限内）；仅 outdoor_v1 理解链路使用，其余模式剥离。 */
const imageDataUrl=z.string().refine(v=>/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)).refine(v=>v.length<=4_500_000);
/** 2026-11-19：工作台当前登记的重建实景（客户端上报）。只收可核实的展示名/资产号与两个
 *  布尔标记，不收容量、价格、档期；仅用于回答里把「地图地点」与「已重建模型」分开说。 */
const rebuiltSceneRef=z.strictObject({displayName:z.string().trim().min(1).max(60),assetId:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),isDemo:z.boolean(),placeConfirmed:z.boolean()});
export const assistantChatRequestSchema=z.strictObject({message:chatText,responseMode:z.literal('outdoor_v1').optional(),includeThought:z.literal(true).optional(),history:z.array(z.strictObject({role:z.enum(['user','assistant']),text:chatText})).max(8),images:z.array(imageDataUrl).max(10).optional(),rebuiltScenes:z.array(rebuiltSceneRef).max(8).optional(),provider:chatProviderSchema.optional(),model:z.string().trim().min(1).max(80).optional()}).superRefine((value,ctx)=>{
 if(value.message.length+value.history.reduce((sum,item)=>sum+item.text.length,0)>6000)ctx.addIssue({code:'custom',message:'context too long'});
 if(value.includeThought&&value.responseMode!=='outdoor_v1')ctx.addIssue({code:'custom',path:['includeThought'],message:'only supported for outdoor_v1'});
 if(value.images?.length&&value.responseMode!=='outdoor_v1')ctx.addIssue({code:'custom',path:['images'],message:'only supported for outdoor_v1'});
 if(value.rebuiltScenes?.length&&value.responseMode!=='outdoor_v1')ctx.addIssue({code:'custom',path:['rebuiltScenes'],message:'only supported for outdoor_v1'});
 if(value.images&&value.images.reduce((sum,item)=>sum+item.length,0)>4_000_000)ctx.addIssue({code:'custom',path:['images'],message:'images payload too large'});
});
export const assistantChatResponseSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('ok'),answer:z.string().trim().min(1).max(3000)}),
 z.strictObject({status:z.enum(['disabled','invalid','unavailable','timeout','provider_error','quota_exhausted']),answer:z.null()}),
]);
export type AssistantChatResult=z.infer<typeof assistantChatResponseSchema>;
