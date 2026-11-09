import {describe,expect,it} from 'vitest';
import {planLocalSharedDeskDraft,type LocalSharedDeskInput} from './local-seating-draft';
import {itemsOverlap} from './geometry';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
const input:LocalSharedDeskInput={floorIndex:0,mode:'two_people_per_desk',count:30,desk:{width:1.8,depth:.6,height:.75},chair:{width:.49,depth:.57,height:.85},deskChairGap:.1,chairGap:.1,columnGap:.3,rowGap:.5,edgeClearance:.3,assumptions:{count:'user',deskSize:'user',chairSize:'user',chairGap:'assumption',deskChairGap:'assumption',columnGap:'assumption',rowGap:'assumption',edgeClearance:'assumption'}};
const ids=()=>{let n=0;return()=>`new-${++n}`};
describe('explicit shared desk local draft',()=>{
 it('creates 15 desks and 30 independent chairs without overlaps',()=>{
  const r=planLocalSharedDeskDraft(makeLayout({width:20,height:20}),input,ids());expect(r).toMatchObject({requested:30,placed:30,shortfall:0,requestedTables:15,placedTables:15,placedObjects:45,limitReason:null});
  const a=r.layout.floors[0]!.items;expect(a.filter(x=>x.type==='desk')).toHaveLength(15);expect(a.filter(x=>x.type==='chair')).toHaveLength(30);for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)expect(itemsOverlap(a[i]!,a[j]!)).toBe(false);expect(r.unknown).toContain('消防规范');
 });
 it('places one chair on the last desk for odd requests',()=>{expect(planLocalSharedDeskDraft(makeLayout({width:20,height:20}),{...input,count:5},ids())).toMatchObject({placed:5,placedTables:3,placedObjects:8})});
 it('reports shortages and rejects insufficient desk width',()=>{const r=planLocalSharedDeskDraft(makeLayout({width:3,height:3}),input,ids());expect(r.placed).toBeLessThan(30);expect(r.shortfall).toBe(30-r.placed);expect(r.limitReason).toBe('no_placement');expect(planLocalSharedDeskDraft(makeLayout(),{...input,desk:{...input.desk,width:.8}},ids()).placed).toBe(0)});
 it('retains locked objects and avoids collisions',()=>{const old=makeItem({id:'old',locked:true,position:{x:-8,z:-8}});const original=makeLayout({width:20,height:20,floors:[makeFloor({items:[old]})]});const r=planLocalSharedDeskDraft(original,input,ids());expect(r.layout.floors[0]!.items[0]).toEqual(old);expect(original.floors[0]!.items).toEqual([old]);expect(r.layout.floors[0]!.items.slice(1).every(x=>!itemsOverlap(x,old))).toBe(true)});
 it('respects concave venue geometry',()=>{const layout=makeLayout({width:20,height:20,backendVenue:{shape:'polygon',width:20,depth:20,height:3,entrances:[],polygon:[{x:0,z:0},{x:20,z:0},{x:20,z:7},{x:8,z:7},{x:8,z:20},{x:0,z:20}]}});const r=planLocalSharedDeskDraft(layout,input,ids());expect(r.placed).toBeGreaterThan(0);for(const x of r.layout.floors[0]!.items)expect(x.position!.x+10+x.width/2<=8+1e-6||x.position!.z+10+x.depth/2<=7+1e-6).toBe(true)});
 it('respects the 200 object limit',()=>{const items=Array.from({length:198},(_,n)=>makeItem({id:`old-${n}`,width:.01,depth:.01,height:.1,position:{x:8+n*.001,z:8}}));const r=planLocalSharedDeskDraft(makeLayout({width:20,height:20,floors:[makeFloor({items})]}),input,ids());expect(r).toMatchObject({placed:0,shortfall:30,limitReason:'object_limit'});expect(r.layout.floors[0]!.items).toHaveLength(198)});
});
