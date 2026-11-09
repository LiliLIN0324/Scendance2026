import {z} from 'zod';

const chatText=z.string().trim().min(1).max(1200).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
export const assistantChatRequestSchema=z.strictObject({message:chatText,history:z.array(z.strictObject({role:z.enum(['user','assistant']),text:chatText})).max(8)}).superRefine((value,ctx)=>{
 if(value.message.length+value.history.reduce((sum,item)=>sum+item.text.length,0)>6000)ctx.addIssue({code:'custom',message:'context too long'});
});
export const assistantChatResponseSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('ok'),answer:z.string().trim().min(1).max(3000)}),
 z.strictObject({status:z.enum(['disabled','invalid','unavailable','timeout','provider_error']),answer:z.null()}),
]);
export type AssistantChatResult=z.infer<typeof assistantChatResponseSchema>;
