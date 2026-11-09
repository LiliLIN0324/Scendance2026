import {describe,expect,it} from 'vitest';
import {initialBriefMemory} from './brief-agent';
import {hasBlockingActivityNeeds} from './activity-need-gate';

describe('exploration and application activity requirements',()=>{
 it('allows explicit postponement only for exploration',()=>{
  const memory={...initialBriefMemory(),unresolvedActivityNeeds:['checkin'] as const,deferredActivityNeeds:['checkin'] as const};
  expect(hasBlockingActivityNeeds({...memory,unresolvedActivityNeeds:[...memory.unresolvedActivityNeeds],deferredActivityNeeds:[...memory.deferredActivityNeeds]},true)).toBe(false);
  expect(hasBlockingActivityNeeds({...memory,unresolvedActivityNeeds:[...memory.unresolvedActivityNeeds],deferredActivityNeeds:[...memory.deferredActivityNeeds]},false)).toBe(true);
 });
 it('still blocks an ordinary unresolved need alongside a deferred one',()=>{
  const memory=initialBriefMemory();memory.unresolvedActivityNeeds=['checkin','stage'];memory.deferredActivityNeeds=['checkin'];
  expect(hasBlockingActivityNeeds(memory,true)).toBe(true);expect(hasBlockingActivityNeeds(memory,false)).toBe(true);
 });
 it('never bypasses a proposed decision awaiting confirmation',()=>{
  const memory=initialBriefMemory();memory.pendingActivityNeeds=[{kind:'checkin',value:true,evidence:'需要签到'}];
  expect(hasBlockingActivityNeeds(memory,true)).toBe(true);expect(hasBlockingActivityNeeds(memory,false)).toBe(true);
 });
});
