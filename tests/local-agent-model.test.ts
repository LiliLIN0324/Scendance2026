import {describe,expect,it} from 'vitest';
import {createLocalAgentModel} from '../scripts/local-agent-model.ts';

describe('local agent stub',()=>{
 it('preserves the tool loop separately from brief extraction',async()=>{
  const stub=createLocalAgentModel(),url='https://stub.invalid/chat/completions';
  const send=async(messages:unknown[])=>stub(url,{method:'POST',body:JSON.stringify({messages})}).then(response=>response.json());
  const first=await send([{role:'user',content:'出方案'}]);
  expect(first.choices[0].message.tool_calls[0].function.name).toBe('get_scene');
  const second=await send([{role:'user',content:'出方案'},{role:'tool',content:'{}'}]);
  expect(second.choices[0].message.tool_calls[0].function.name).toBe('submit_candidates');
 });
});
