import {describe,expect,it} from 'vitest';
import {parseBriefModelJson} from '../supabase/functions/_shared/brief-model-json.ts';

describe('brief model JSON boundaries',()=>{
 it.each(['{"headcount":30}','  {"headcount":30}\n','```json\n{"headcount":30}\n```','  ```JSON\r\n{"headcount":30}\r\n```  ','```\n{"headcount":30}\n```'])('accepts a complete JSON value: %s',value=>{
  expect(parseBriefModelJson(value)).toEqual({headcount:30});
 });
 it.each(['说明：{"headcount":30}','```json\n{"headcount":30}\n```\n附言','```json\n{"headcount":30}\n```\n```json\n{}\n```','```javascript\n{"headcount":30}\n```','```json\n{"headcount":}\n```','{"headcount":30} PRIVATE_CONTENT'])('rejects extra or malformed content without leaking it: %s',value=>{
  try{parseBriefModelJson(value);throw new Error('unexpected success');}catch(error){expect(error).toBeInstanceOf(SyntaxError);expect((error as Error).message).toBe('Invalid model JSON');}
 });
});
