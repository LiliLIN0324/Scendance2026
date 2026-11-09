import { z } from 'zod';
import { agentEventErrors, agentEventTools } from '../../supabase/functions/_shared/agent-events';

const eventSchema=z.strictObject({
  seq:z.number().int().min(1).max(128),
  tool:z.enum(agentEventTools),
  stage:z.enum(['started','finished']),
  outcome:z.enum(['success','failed','unknown']).nullable(),
  errorCode:z.enum(agentEventErrors).nullable(),
}).superRefine((event,ctx)=>{
  if(event.stage==='started'&&(event.outcome!==null||event.errorCode!==null))ctx.addIssue({code:'custom',message:'invalid started event'});
  if(event.stage==='finished'&&event.outcome===null)ctx.addIssue({code:'custom',message:'invalid finished event'});
  if(event.outcome!=='failed'&&event.errorCode!==null)ctx.addIssue({code:'custom',message:'invalid event error'});
});
const pageSchema=z.strictObject({events:z.array(eventSchema).max(50),nextCursor:z.number().int().min(0).max(128),mayBeIncomplete:z.literal(true)});
export type AgentRunEvent=z.infer<typeof eventSchema>;
export type AgentRunEventPage=z.infer<typeof pageSchema>;

/** Reject malformed/out-of-order pages. Codes are deliberately not surfaced in UI. */
export function parseAgentRunEvents(value:unknown,after:number):AgentRunEventPage {
  const page=pageSchema.parse(value);
  let cursor=after;
  for(const event of page.events){if(event.seq<=cursor)throw new Error('invalid event sequence');cursor=event.seq;}
  if(page.nextCursor!==cursor)throw new Error('invalid event cursor');
  return page;
}
