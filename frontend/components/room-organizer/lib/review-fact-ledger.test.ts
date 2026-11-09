import {expect,it} from 'vitest';
import {createReviewFactLedger} from './review-fact-ledger';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import type {RoomLayout} from './types';
function store(initial:RoomLayout){let layout=initial;const listeners=new Set<()=>void>();return {getState:()=>({layout}),subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},set(next:RoomLayout){layout=next;for(const listener of listeners)listener();}};}
it('does not revive an old confirmation after same-batch A→B→A or source invalidation',()=>{
 const a=makeLayout({id:'a',floors:[makeFloor({items:[makeItem({id:'chair'})]})]}),s=store(a),ledger=createReviewFactLedger(s),token=ledger.capture();
 const b={...a,width:a.width+1};s.set(b);s.set(a);expect(ledger.isCurrent(token)).toBe(false);
 const next=ledger.capture();ledger.invalidateSource();expect(ledger.isCurrent(next)).toBe(false);ledger.stop();
});
it('preserves a token for a handoff record change but never across tracker restart',()=>{
 const a=makeLayout({id:'a',floors:[makeFloor({items:[makeItem({id:'chair'})]})]}),s=store(a),ledger=createReviewFactLedger(s),token=ledger.capture();
 const changed={...a,floors:[{...a.floors[0]!,items:[{...a.floors[0]!.items[0]!,handoff:{ownerName:'',dueDate:'',acceptance:'',status:'todo' as const,evidenceUrls:[],evidenceNote:''}}]}]};
 s.set(changed);expect(ledger.isCurrent(token)).toBe(true);ledger.stop();expect(ledger.isCurrent(token)).toBe(false);
 const fresh=createReviewFactLedger(s);expect(fresh.isCurrent(token)).toBe(false);fresh.stop();
});
