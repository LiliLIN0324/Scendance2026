/** Deterministic local fixture only: this is not a real model or production provider. */
export function createLocalAgentModel(options:{briefMode?:'valid'|'invalid'|'slow';delayMs?:number}={}):typeof fetch {
  return async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(!url.includes('chat/completions'))throw new Error('本地模型桩仅支持聊天接口。');
    const body=JSON.parse(String(init?.body??'{}')) as {messages?:Array<{role?:string;content?:string}>};
    const messages=body.messages??[];
    const brief=messages.some(message=>message.role==='system'&&message.content?.includes('活动布置简报的槽位提取器'));
    if(brief){
      if(options.briefMode==='slow')await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(resolve,options.delayMs??5000);
        if(init?.signal?.aborted){clearTimeout(timer);reject(new DOMException('已取消','AbortError'));return;}
        init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('已取消','AbortError'));},{once:true});
      });
      if(options.briefMode==='invalid')return Response.json({choices:[{finish_reason:'stop',message:{content:'{"bad"'}}]});
      const message=messages.findLast(row=>row.role==='user')?.content??'';
      const guests=message.match(/(\d+)\s*(?:人|位)/),dimensions=message.match(/(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)/);
      const activityNeeds:Array<{kind:'checkin'|'stage';decision:'needed';evidence:string}>=[];
      const checkin='宾客先在入口登记',stage='台上要有供演讲者使用的高台';
      if(message.includes(checkin))activityNeeds.push({kind:'checkin',decision:'needed',evidence:checkin});
      if(message.includes(stage))activityNeeds.push({kind:'stage',decision:'needed',evidence:stage});
      const output={...(guests?{headcount:Number(guests[1])}:{}),...(dimensions?{lengthM:Number(dimensions[1]),widthM:Number(dimensions[2])}:{}),
        ...(/室内/.test(message)?{venueIO:'indoor'}:{}),...(/圆桌/.test(message)?{layoutMode:'dining'}:{}),activityNeeds};
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});
    }
    const hasToolResult=messages.some(message=>message.role==='tool');
    const name=hasToolResult?'submit_candidates':'get_scene';
    const args=hasToolResult?{candidates:[{title:'接待区布置',explanation:'在场地中心放一张接待桌。',commands:[{op:'add',materialId:'table',position:{x:0,z:0},rotation:0,color:'#4A7C59'}]}]}:{};
    return Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  };
}
