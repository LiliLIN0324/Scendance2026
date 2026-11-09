import { describe, expect, it } from 'vitest';
import { compactRepeatedValidationArrays } from '../supabase/functions/_shared/agent-runner';

const call=(id:string,name='validate_candidate')=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:'{}'}}]});
const receipt=(id:string,value:unknown)=>({role:'tool',tool_call_id:id,content:JSON.stringify(value)});
const large=(suffix='')=>Array.from({length:48},(_,i)=>({code:`EXISTING_CONFLICT_${i}${suffix}`,ids:[`object-${i.toString().padStart(4,'0')}`]}));
const read=(messages:Record<string,unknown>[],index:number)=>JSON.parse(messages[index]!.content as string);

describe('model-only validation receipt compaction',()=>{
  it('references only identical large arrays, preserving a complete earlier receipt and never mutating input',()=>{
    const warnings=large(),unknown=large('-unknown'),different=large('-different');
    const messages=[call('one'),receipt('one',{valid:true,warnings,independentReview:{status:'unknown',unknown}}),
      call('two'),receipt('two',{valid:true,warnings:structuredClone(warnings),independentReview:{status:'unknown',unknown:structuredClone(unknown)}}),
      call('three'),receipt('three',{valid:true,warnings:different,independentReview:{status:'unknown',unknown:large('-another')}})];
    const original=structuredClone(messages),output=compactRepeatedValidationArrays(messages);
    expect(messages).toEqual(original);
    expect(read(output,1).warnings).toEqual(warnings);
    expect(read(output,1).independentReview.unknown).toEqual(unknown);
    expect(read(output,3).warnings).toEqual({sameAsToolCallId:'one',path:'warnings',itemCount:warnings.length});
    expect(read(output,3).independentReview.unknown).toEqual({sameAsToolCallId:'one',path:'independentReview.unknown',itemCount:unknown.length});
    expect(read(output,5).warnings).toEqual(different);
    expect(read(output,5).independentReview.unknown).toEqual(large('-another'));
  });
  it('does not reference ambiguous IDs, failed checks, non-validation tools or small arrays',()=>{
    const warnings=large();
    const messages=[call('duplicate'),receipt('duplicate',{valid:true,warnings}),call('duplicate'),receipt('duplicate',{valid:true,warnings}),
      call('failed'),receipt('failed',{valid:false,warnings}),call('other','get_bom'),receipt('other',{valid:true,warnings}),
      call('small1'),receipt('small1',{valid:true,warnings:[{code:'FIRE_UNKNOWN',ids:[]}]}),
      call('small2'),receipt('small2',{valid:true,warnings:[{code:'FIRE_UNKNOWN',ids:[]}]})];
    expect(compactRepeatedValidationArrays(messages)).toEqual(messages);
  });
  it('does not create a forward reference even when tool messages arrive out of order',()=>{
    const warnings=large();
    const messages=[call('a'),call('b'),receipt('b',{valid:true,warnings}),receipt('a',{valid:true,warnings})];
    const output=compactRepeatedValidationArrays(messages);
    expect(read(output,2).warnings).toEqual(warnings);
    expect(read(output,3).warnings).toEqual({sameAsToolCallId:'b',path:'warnings',itemCount:warnings.length});
  });
});
