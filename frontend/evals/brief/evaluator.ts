import { parseModelBrief, type BriefSlots } from '../../../supabase/functions/_shared/brief-extract-contract';
import {initialBriefMemory} from '../../components/room-organizer/lib/brief-agent';
import {resolveBriefTurn} from '../../lib/agent-resolver';

export interface BriefEvalCase {id:string;message:string;require?:Record<string,unknown>;omit?:string[];needs?:Record<string,string>;evidenceContains?:Record<string,string>;memoryAbsent?:string[];ask?:boolean;review:string}
export interface BriefEvalResult {id:string;status:'pass'|'fail'|'missing';failures:string[];questionForHumanReview:string|null;modelReplyForHumanReview:string|null;manualReview:string}
/** Per-case assertions are human-authored labels. Natural-language question quality remains human-reviewed. */
export async function evaluateBriefCase(test:BriefEvalCase,response:unknown):Promise<BriefEvalResult>{
 const failures:string[]=[];let slots:BriefSlots;
 try{slots=parseModelBrief(response,test.message);}catch{return {id:test.id,status:'fail',failures:['输出未通过结构或原文证据校验'],questionForHumanReview:null,modelReplyForHumanReview:null,manualReview:test.review};}
 const allowed=new Set(['event','headcount','venueIO','lengthM','widthM','areaM2','layoutMode','timeOfDay','audienceTags','mobilityAssistance','proactiveReply','requirements','activityNeeds']);
 if(response && typeof response==='object' && !Array.isArray(response) && Object.keys(response).some(key=>!allowed.has(key)))failures.push('输出包含契约外字段');
 const values=slots as Record<string,unknown>;
 for(const [key,expected] of Object.entries(test.require??{}))if(JSON.stringify(values[key])!==JSON.stringify(expected))failures.push(`字段 ${key} 与标注不符`);
 for(const key of test.omit??[])if(values[key]!==null&&values[key]!==undefined)failures.push(`字段 ${key} 不应被断定`);
 const actual=slots.activityNeeds??[];
 if(new Set(actual.map(x=>x.kind)).size!==actual.length)failures.push('同一功能需求重复');
 for(const [kind,decision] of Object.entries(test.needs??{})){
  const item=actual.find(x=>x.kind===kind);if(!item||item.decision!==decision)failures.push(`需求 ${kind} 与标注不符`);
  const required=test.evidenceContains?.[kind];if(item&&required&&!item.evidence.includes(required))failures.push(`需求 ${kind} 的证据缺少关键语境`);
 }
 for(const item of actual)if(!Object.hasOwn(test.needs??{},item.kind))failures.push(`未标注需求 ${item.kind} 不应被断定`);
 const previous=process.env.NEXT_PUBLIC_AGENT_ENABLED;process.env.NEXT_PUBLIC_AGENT_ENABLED='1';
 try{
  const turn=await resolveBriefTurn(test.message,initialBriefMemory(),{venueUp:false,scaleTyped:false,hasBase:false,command:null},{briefExtract:async()=>({enabled:true,extraction:slots})});
  if(turn.resolution!=='model')failures.push('未运行模型输入对应的对话链路');
  if(test.ask&&turn.kind!=='ask')failures.push('未触发追问');
  const memory=turn.memory as unknown as Record<string,unknown>;
  for(const key of test.memoryAbsent??[])if(memory[key]!==null&&memory[key]!==undefined)failures.push(`未确认的 ${key} 进入可执行记忆`);
  return {id:test.id,status:failures.length?'fail':'pass',failures,questionForHumanReview:turn.kind==='ask'?turn.text:null,modelReplyForHumanReview:slots.proactiveReply??null,manualReview:test.review};
 }finally{if(previous===undefined)delete process.env.NEXT_PUBLIC_AGENT_ENABLED;else process.env.NEXT_PUBLIC_AGENT_ENABLED=previous;}
}
export async function evaluateBriefDataset(cases:BriefEvalCase[],responses:Record<string,unknown>){
 const results:BriefEvalResult[]=[];
 for(const test of cases){
  if(!Object.hasOwn(responses,test.id)){results.push({id:test.id,status:'missing',failures:['未提供模型输出'],questionForHumanReview:null,modelReplyForHumanReview:null,manualReview:test.review});continue;}
  results.push(await evaluateBriefCase(test,responses[test.id]));
 }
 return {automaticOnly:true,humanReviewRequired:true,total:cases.length,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,missing:results.filter(r=>r.status==='missing').length,results};
}
