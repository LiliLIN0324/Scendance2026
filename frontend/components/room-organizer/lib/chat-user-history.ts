/** Only visible user text and explicitly marked model replies from the active conversation. */
export function chatUserHistory(messages:readonly {role:'user'|'agent';text:string;modelConversation?:boolean}[],currentMessage:string):Array<{role:'user'|'assistant';text:string}> {
  const sensitive=/(?:https?:\/\/|www\.|\b(?:data|blob|file):|(?:api[_ -]?key|access[_ -]?token|secret|password|密码|密钥)\s*[:=：]\s*\S+|\bbearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,})/i;
  const eligible=messages.filter(item=>(item.role==='user'||item.modelConversation===true)&&item.text.trim()&&item.text.length<=1200&&!sensitive.test(item.text)).slice(-8);
  let remaining=6000-currentMessage.length;
  return eligible.reverse().filter(item=>{if(item.text.length>remaining)return false;remaining-=item.text.length;return true;}).reverse().map(item=>({role:item.role==='user'?'user':'assistant',text:item.text}));
}
