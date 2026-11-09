import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { validateCandidateApply } from './candidate-apply-validation';

const id='candidate-project';
const base=()=>makeLayout({id,width:10,height:8,floors:[makeFloor({id:'floor-1',floorColor:'#ffffff',items:[makeItem({id:'locked',locked:true})]})]});

describe('candidate apply dry run',()=>{
  it('accepts an unchanged preview without mutating either input',()=>{
    const before=base(),candidate=structuredClone(before),original=structuredClone(candidate);
    candidate.floors[0]!.items.push(makeItem({id:'new-item',position:{x:2,z:1}}));
    const expected=structuredClone(candidate);
    expect(validateCandidateApply(before,candidate,0)).toEqual({ok:true});
    expect(candidate).toEqual(expected);expect(before).toEqual(original);
  });
  it('refuses removed or altered locked items on every floor, including non-geometric fields',()=>{
    const before=base();before.floors.push(makeFloor({id:'upper',items:[makeItem({id:'upper-chair',name:'锁定椅',locked:true,position:{x:2,z:1}})]}));
    for(const change of ['remove','move','metadata'] as const){const candidate=structuredClone(before);
      if(change==='remove')candidate.floors[1]!.items=[];
      if(change==='move')candidate.floors[1]!.items[0]!.position={x:3,z:1};
      if(change==='metadata')candidate.floors[1]!.items[0]!.name='换了名称';
      expect(validateCandidateApply(before,candidate,0)).toMatchObject({ok:false,reason:expect.stringContaining('锁定物件')});
    }
  });
  it('refuses disappearing floors or zones regardless of furniture locks',()=>{
    const before=base();before.floors[0]!.zones=[{id:'zone',name:'签到区',x:0,z:0,w:1,d:1,color:'#fff'}];
    before.floors.push(makeFloor({id:'upper',items:[]}));
    const removedFloor=structuredClone(before);removedFloor.floors.pop();
    expect(validateCandidateApply(before,removedFloor,0)).toMatchObject({ok:false,reason:expect.stringContaining('未保留楼层')});
    const removedZone=structuredClone(before);removedZone.floors[0]!.zones=[];
    expect(validateCandidateApply(before,removedZone,0)).toMatchObject({ok:false,reason:expect.stringContaining('未保留区域')});
  });
  it('rejects empty floor color which the reducer would silently replace',()=>{
    const before=base(),candidate=structuredClone(before);candidate.floors[0]!.floorColor='';
    expect(validateCandidateApply(before,candidate,0)).toMatchObject({ok:false,reason:expect.stringContaining('改变预览内容')});
  });
  it('rejects duplicate object IDs even across floors',()=>{
    const before=base(),candidate=structuredClone(before);
    candidate.floors.push(makeFloor({id:'floor-2',items:[makeItem({id:'locked'})]}));
    expect(validateCandidateApply(before,candidate,0)).toMatchObject({ok:false,reason:expect.stringContaining('重复编号')});
  });
  it('rejects duplicate floors and duplicate zone IDs',()=>{
    const before=base(),candidate=structuredClone(before);candidate.floors.push(makeFloor({id:'floor-1'}));
    expect(validateCandidateApply(before,candidate,0)).toMatchObject({ok:false,reason:expect.stringContaining('重复编号')});
    const other=base();other.floors[0]!.zones=[{id:'zone',name:'甲',x:0,z:0,w:1,d:1,color:'#fff'},{id:'zone',name:'乙',x:2,z:2,w:1,d:1,color:'#fff'}];
    expect(validateCandidateApply(before,other,0)).toMatchObject({ok:false,reason:expect.stringContaining('重复编号')});
  });
  it('rejects missing identity and non-finite fields instead of normalizing silently',()=>{
    const before=base(),candidate=structuredClone(before);delete candidate.id;
    expect(validateCandidateApply(before,candidate,0)).toMatchObject({ok:false,reason:expect.stringContaining('活动编号')});
    candidate.id=id;candidate.floors[0]!.items[0]!.position={x:NaN,z:0};
    expect(validateCandidateApply(before,candidate,0).ok).toBe(false);
  });
  it('checks unknown fields and undefined values without normalizing them away',()=>{
    const before=base();
    Object.assign(before.floors[0]!.items[0]!,{additionalUnknown:{explicitUndefined:undefined}});
    const candidate=structuredClone(before);
    expect(validateCandidateApply(before,candidate,0)).toEqual({ok:true});
    expect(Object.hasOwn((candidate.floors[0]!.items[0]! as unknown as {additionalUnknown:object}).additionalUnknown,'explicitUndefined')).toBe(true);
  });
});
