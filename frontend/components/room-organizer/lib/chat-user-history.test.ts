import {describe,expect,it} from 'vitest';
import {chatUserHistory} from './chat-user-history';

describe('conversation history sent to the model',()=>{
 it('uses only bounded visible user text and excludes obvious links and credentials',()=>{
  const messages=[{role:'user' as const,text:'参加者大概30人'},{role:'agent' as const,text:'内部工具结果'},{role:'agent' as const,text:'收到，人数待核对',modelConversation:true},{role:'user' as const,text:'查看 https://example.com/private'},{role:'user' as const,text:'密钥：do-not-send'},{role:'user' as const,text:'签到尚未决定'}];
  expect(chatUserHistory(messages,'为什么需要签到？')).toEqual([{role:'user',text:'参加者大概30人'},{role:'assistant',text:'收到，人数待核对'},{role:'user',text:'签到尚未决定'}]);
 });
 it('limits count and total length without truncating individual messages',()=>{
  const messages=Array.from({length:10},(_,i)=>({role:'user' as const,text:`${i}:${'x'.repeat(900)}`}));
  const result=chatUserHistory(messages,'q'.repeat(1000));expect(result.length).toBeLessThanOrEqual(8);
  expect(result.reduce((sum,row)=>sum+row.text.length,1000)).toBeLessThanOrEqual(6000);
  expect(result.at(-1)?.text).toBe(messages.at(-1)?.text);
 });
});
