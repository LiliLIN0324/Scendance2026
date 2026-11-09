import {describe,expect,it} from 'vitest';
import {createVenueFactTracker,venueFactTrackerFor,isVenueFactMemoryCurrent} from './venue-fact-epoch';
import {initialBriefMemory} from './brief-agent';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import type {RoomLayout} from './types';
function makeStore(initial:RoomLayout){let layout=initial;const listeners=new Set<()=>void>();return {getState:()=>({layout}),subscribe:(cb:()=>void)=>{listeners.add(cb);return()=>{listeners.delete(cb);};},set(next:RoomLayout){layout=next;for(const cb of listeners)cb();}};}
describe('venue facts monotonic revision',()=>{
 it('invalidates same-batch A→B→A even when the final geometry is byte-for-byte identical',()=>{
  const a=makeLayout({width:12,height:9}),b={...a,width:20},store=makeStore(a),tracker=createVenueFactTracker(store as never),off=tracker.listen(()=>{}),old=tracker.capture();
  store.set(b);store.set(a);expect(tracker.isCurrent(old)).toBe(false);expect(tracker.capture()?.epoch).toBe(2);off();
 });
 it('keeps ordinary furniture moves but invalidates door changes and explicit source changes',()=>{
  const door=makeItem({id:'door',type:'door',structuralOpeningId:'opening'}),chair=makeItem({id:'chair'});
  const a=makeLayout({floors:[makeFloor({items:[door,chair]})]}),store=makeStore(a),tracker=createVenueFactTracker(store as never),off=tracker.listen(()=>{}),old=tracker.capture();
  store.set({...a,floors:[{...a.floors[0]!,items:[door,{...chair,position:{x:2,z:2}}]}]});expect(tracker.isCurrent(old)).toBe(true);
  store.set({...a,floors:[{...a.floors[0]!,items:[{...door,width:2},chair]}]});expect(tracker.isCurrent(old)).toBe(false);
  const fresh=tracker.capture();tracker.invalidateSource();expect(tracker.isCurrent(fresh)).toBe(false);off();
 });
 it('does not reuse old sessions and accepts a fresh confirmation only after observation',()=>{
  const layout=makeLayout(),store=makeStore(layout),tracker=venueFactTrackerFor(store as never),off=tracker.listen(()=>{});
  const memory={...initialBriefMemory(),lengthM:12,widthM:9,venueFactToken:tracker.capture()!};
  expect(isVenueFactMemoryCurrent(memory,store as never)).toBe(true);
  expect(isVenueFactMemoryCurrent({...memory,venueFactToken:undefined},store as never)).toBe(false);
  off();expect(isVenueFactMemoryCurrent(memory,store as never)).toBe(false);
  const resubscribe=tracker.listen(()=>{});expect(isVenueFactMemoryCurrent(memory,store as never)).toBe(false);
  expect(isVenueFactMemoryCurrent({...memory,venueFactToken:tracker.capture()!},store as never)).toBe(true);resubscribe();
 });
});
