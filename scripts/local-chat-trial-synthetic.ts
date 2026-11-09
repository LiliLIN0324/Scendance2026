import {BRIEF_CONVERSATION_PROMPT} from '../supabase/functions/_shared/brief-extract-contract.ts';
import {ASSISTANT_CHAT_PROMPT} from '../supabase/functions/_shared/assistant-chat.ts';
import {AGENT_SYSTEM_PROMPT,MINIMAX_AGENT_SYSTEM_PROMPT} from '../supabase/functions/_shared/agent-runner.ts';

/** Deterministic fixture; never performs network I/O or imitates general model ability. */
export const syntheticChatTransport:typeof fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url!=='https://api.minimax.cn/v1/chat/completions'||typeof init?.body!=='string')return Response.json({error:'invalid_fixture'},{status:403});
 try{
  const body=JSON.parse(init.body) as {messages:Array<{role:string;content:string;tool_call_id?:string}>},system=body.messages[0]!.content;
  if(system===MINIMAX_AGENT_SYSTEM_PROMPT){
   const receipts=body.messages.filter(message=>message.role==='tool');
   let name:string,args:unknown;
   const zeroExercise=body.messages.some(message=>message.role==='user'&&message.content.includes('零放置演练'));
   if(zeroExercise&&receipts.length===0){name='prepare_seating_candidate';args={layout:'one_desk_one_chair',count:30,deskSize:{width:0.5,depth:0.5,height:0.75},chairSize:{width:0.5,depth:0.5,height:0.85},deskChairGap:0.1,columnGap:0.2,rowGap:0.2,edgeClearance:0.2,region:{x1:0,z1:0,x2:0.2,z2:0.2}};}
   else if(zeroExercise){name='submit_candidates';args={candidates:[{title:'讨论草案',explanation:'先讨论活动安排。',commands:[]}]};}
   else if(receipts.length===0){name='get_scene';args={};}
   else if(receipts.length===1){name='find_free_areas';args={width:0.5,depth:0.5,clearance:0.3,limit:1};}
   else{
    const result=JSON.parse(receipts.at(-1)!.content) as {sites?:Array<{x:number;z:number}>};const site=result.sites?.[0];
    name='submit_candidates';args={candidates:[site?{title:'示意座椅',explanation:'只在工具返回的空位放一把示意椅，尚未完成30人布置；场地与实物需核验。',commands:[{op:'add',materialId:'chair',position:{x:site.x,z:site.z},rotation:0,color:'#ffffff'}]}:{title:'暂不摆放',explanation:'没有找到合适的候选位置，需确认场地。',commands:[]}]};
   }
   return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:`synthetic-${receipts.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
  }
  const data=JSON.parse(body.messages[1]!.content) as {message:string;history?:Array<{role:string;text:string}>};const message=data.message;
  // An explicit fixture to exercise redacted error reporting without a provider.
  if(message==='合成诊断故障示例')return new Response('PRIVATE_SYNTHETIC_RESPONSE_DO_NOT_DISPLAY',{status:429});
  if(message==='合成格式故障示例，30人，室内10×8，课桌椅，生成方案')return Response.json({choices:[{finish_reason:'stop',message:{content:'这是模拟格式故障'}}]});
  if(system===ASSISTANT_CHAT_PROMPT)return Response.json({choices:[{finish_reason:'stop',message:{content:'这是本机固定演练回答：活动动线可先结合入口、区域和参与者路径核对。'}}]});
  if(system!==BRIEF_CONVERSATION_PROMPT)throw Error('unsupported');
  const sample='30人，室内，签到尚未决定';
  const output=message==='30人，每3人一桌，采用课桌椅，生成本地草案'?{
   extraction:{headcount:30,layoutMode:'desk-chair'},reply:'我会先核对每3人一桌的课桌椅安排。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'},{key:'layoutMode',evidence:'课桌椅'}],
  }:message==='30人，每2人一桌，采用课桌椅，生成本地草案'?{
   extraction:{headcount:30,layoutMode:'desk-chair'},reply:'我会先核对每2人一桌的课桌椅安排。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'},{key:'layoutMode',evidence:'课桌椅'}],
  }:message==='30人，按一人一套课桌椅生成本地草案'?{
   extraction:{headcount:30,layoutMode:'desk-chair'},reply:'先按30人一人一套课桌椅准备本机草案。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'},{key:'layoutMode',evidence:'一人一套课桌椅'}],
  }:message==='为30人办室内讲座，场地长12米宽10米，采用课桌椅布局，生成方案'?{
   extraction:{event:'讲座',headcount:30,venueIO:'indoor',lengthM:12,widthM:10,layoutMode:'desk-chair'},
   reply:'先按室内30人课桌椅讲座生成待审阅方案。',unhandled:[],factEvidence:[{key:'event',evidence:'讲座'},{key:'headcount',evidence:'30人'},{key:'venueIO',evidence:'室内'},{key:'lengthM',evidence:'长12米'},{key:'widthM',evidence:'宽10米'},{key:'layoutMode',evidence:'课桌椅布局'}],
  }:message==='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案'||message==='这是零放置演练。为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案'||message==='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，椅宽0.5米，生成方案'?{
   extraction:{event:'讲座',headcount:30,venueIO:'indoor',lengthM:10,widthM:8,layoutMode:'desk-chair'},
   reply:'先按室内30人课桌椅讲座生成待审阅方案。',unhandled:[],factEvidence:[{key:'event',evidence:'讲座'},{key:'headcount',evidence:'30人'},{key:'venueIO',evidence:'室内'},{key:'lengthM',evidence:'长10米'},{key:'widthM',evidence:'宽8米'},{key:'layoutMode',evidence:'课桌椅布局'}],
  }:message===sample?{
   extraction:{headcount:30,venueIO:'indoor',activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到尚未决定'}]},
   reply:'签到先保留待定，可以用可修改的假设继续讨论。',unhandled:[],
   factEvidence:[{key:'headcount',evidence:'30人'},{key:'venueIO',evidence:'室内'}],
  }:message==='我们有80把椅子'?{
   extraction:{inventoryMentions:[{evidence:'80把椅子'}]},
   reply:'可先从物料库核对椅子，规格与实际可用量仍需确认。',unhandled:[],factEvidence:[],
  }:message==='我想在养老社区办点活动，还没有场地和人数'?{
   extraction:{},reply:'可以先围绕社区交流、分享或轻活动探索；人数和场地待定，可使用可修改的假设。',unhandled:[],factEvidence:[],
  }:message==='想与杭州养老社区共同探索活动，人数场地未知'?{
   extraction:{},reply:'可以先探索社区分享、兴趣体验或轻互动；合作尚未落实，人数与场地仍待确认。',unhandled:[],factEvidence:[],
  }:message==='先按30人，我有80把椅子'&&data.history?.some(item=>item.role==='user'&&(item.text==='我想在养老社区办点活动，还没有场地和人数'||item.text==='想与杭州养老社区共同探索活动，人数场地未知'))?{
   extraction:{headcount:30,inventoryMentions:[{evidence:'80把椅子'}]},reply:'先按30人讨论，椅子可从物料库核对，也可导入或生成模型；规格、服务可用性和实际数量仍需确认。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}],
  }:message==='这些椅子怎么用？'&&data.history?.some(item=>item.role==='user'&&item.text==='先按30人，我有80把椅子')?{
   extraction:{},reply:'可以从物料库挑选相近椅子核对尺寸，也可导入已有 GLB；实际规格和可用量仍待确认。',unhandled:[],factEvidence:[],materialQueries:[{query:'椅子',evidence:'这些椅子怎么用？'}],
  }:message==='如果没有现成椅子还有什么办法？'&&data.history?.some(item=>item.role==='user'&&item.text==='这些椅子怎么用？')?{
   extraction:{},reply:'可以查看物料库、导入已有 GLB、探索模型生成或先用示意物料；具体规格、费用和可用性需核对。',unhandled:[],factEvidence:[],
  }:{extraction:{},reply:'这是本机固定演练反馈，尚未理解具体需求。',unhandled:[{kind:'other',evidence:message.slice(0,200)}],factEvidence:[]};
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
 }catch{return Response.json({error:'invalid_fixture'},{status:400});}
};

/** Adapter for deterministic local fixtures only; never performs network I/O. */
export const syntheticBailianTransport:typeof fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url!=='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'||typeof init?.body!=='string')return Response.json({error:'invalid_fixture'},{status:403});
 try{
  const body=JSON.parse(init.body);
  if(body.messages?.[0]?.content===AGENT_SYSTEM_PROMPT)body.messages[0].content=MINIMAX_AGENT_SYSTEM_PROMPT;
  return syntheticChatTransport('https://api.minimax.cn/v1/chat/completions',{...init,body:JSON.stringify(body)});
 }catch{return Response.json({error:'invalid_fixture'},{status:400});}
};
