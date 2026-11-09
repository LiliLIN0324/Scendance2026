import {describe,expect,it} from 'vitest';
import {parseBriefConversation} from '../supabase/functions/_shared/brief-extract-contract.ts';
import {diagnoseBriefEvidenceMismatch} from '../scripts/local-brief-evidence-diagnostic.ts';

describe('isolated brief evidence diagnostic',()=>{
 const message='为30人办室内讲座，场地长10米宽8米，每2人一桌，采用课桌椅布局，生成方案';
 const secret='PRIVATE_FIXTURE_EVIDENCE_834';
 const base={extraction:{},reply:'先核对需求。',unhandled:[],factEvidence:[]};
 const cases=[
  {value:{...base,extraction:{activityNeeds:[{kind:'stage',decision:'needed',evidence:secret}]}},reason:'evidence_not_in_message',field:'activityNeeds'},
  {value:{...base,extraction:{inventoryMentions:[{evidence:secret}]}},reason:'evidence_not_in_message',field:'inventoryMentions'},
  {value:{...base,extraction:{headcount:30},factEvidence:[{key:'headcount',evidence:'30人'},{key:'headcount',evidence:'30人'}]},reason:'duplicate_field',field:'headcount'},
  {value:{...base,extraction:{headcount:30},factEvidence:[{key:'headcount',evidence:secret}]},reason:'evidence_not_in_message',field:'headcount'},
  {value:{...base,factEvidence:[{key:'headcount',evidence:'30人'}]},reason:'field_without_value',field:'headcount'},
  {value:{...base,extraction:{headcount:30}},reason:'missing_evidence',field:'headcount'},
  {value:{...base,unhandled:[{kind:'action',evidence:secret}]},reason:'evidence_not_in_message',field:'unhandled'},
  {value:{...base,materialQueries:[{query:'测试椅',evidence:'测试椅'}]},reason:'evidence_not_in_message',field:'materialQueries'},
  {value:{...base,extraction:{headcount:30,requirements:[{key:'headcount',value:2,mode:'must'}]},factEvidence:[{key:'headcount',evidence:'30人'}]},reason:'requirement_mismatch',field:'requirements'},
 ] as const;
 it.each(cases)('matches parser failure category $reason / $field',({value,reason,field})=>{
  expect(()=>parseBriefConversation(value,message)).toThrow('MODEL_EVIDENCE_MISMATCH');
  const result=diagnoseBriefEvidenceMismatch(value,message);
  expect(result).toEqual({reason,field,count:1});
  expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify(result)).not.toContain(message);
 });
 it('refuses malformed inputs instead of echoing arbitrary content',()=>{
  expect(diagnoseBriefEvidenceMismatch({extraction:{},factEvidence:[{key:secret,evidence:secret}],unhandled:[]},message)).toBeNull();
 });
});
