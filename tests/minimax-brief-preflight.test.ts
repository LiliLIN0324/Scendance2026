import {expect,it,vi} from 'vitest';
import {minimaxBriefPreflight} from '../scripts/minimax-brief-preflight.ts';

it('reviews one synthetic request offline without reading environment or making a network request',async()=>{
 const fetchSpy=vi.spyOn(globalThis,'fetch');
 try{
  const result=await minimaxBriefPreflight();
  expect(result).toMatchObject({mode:'offline-only',requestsSent:0,sampleCount:1,sampleKind:'synthetic',fixtureModel:true,profile:'minimax',outputTokenParameter:2048});
  expect(result.bodyFields).toContain('reasoning_split');expect(result.bodyFields).not.toContain('response_format');
  expect(result.messagesSent).toEqual(['system prompt','one synthetic user message']);
  expect(result.systemPromptSha256).toMatch(/^[a-f0-9]{64}$/);expect(fetchSpy).not.toHaveBeenCalled();
 }finally{fetchSpy.mockRestore();}
});
