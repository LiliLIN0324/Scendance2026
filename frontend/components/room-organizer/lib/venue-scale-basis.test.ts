import {describe,expect,it} from 'vitest';
import {initialBriefMemory} from './brief-agent';
import {isVenueScaleCurrent,venueDimensionsMismatch,venueScaleBasis} from './venue-scale-basis';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import type {RoomLayout} from './types';

const marker=(kind:'door'|'column'|'entrance')=>makeItem({id:kind,type:kind==='column'?'column':'door',
  ...(kind==='door'?{structuralOpeningId:'opening'}:kind==='column'?{structuralColumnId:'column'}:{venueEntranceId:'entrance'})});
const base=()=>makeLayout({id:'venue',floors:[makeFloor({items:[marker('door'),marker('column'),marker('entrance'),makeItem({id:'chair'})]})]});
const confirmed=(layout:RoomLayout)=>({...initialBriefMemory(),lengthM:12,widthM:8,venueScaleBasis:venueScaleBasis(layout)});
describe('venue scale evidence',()=>{
 it('compares explicit dimensions with the actual canvas instead of only trusting the version binding',()=>{
   const original=makeLayout({width:10,height:8}),memory={...initialBriefMemory(),lengthM:12,widthM:10,venueScaleBasis:venueScaleBasis(original)};
   expect(isVenueScaleCurrent(memory,original)).toBe(true);
   expect(venueDimensionsMismatch(memory,original)).toMatch(/12.*10.*10.*8.*没有提交生成/);
   expect(venueDimensionsMismatch(memory,{...original,width:12,height:10})).toBeNull();
   expect(venueDimensionsMismatch(memory,{...original,width:10,height:12})).not.toBeNull();
 });
 it('compares area without inferring dimensions and rejects invalid canvas dimensions',()=>{
   const layout=makeLayout({width:10,height:8});
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:120},layout)).toMatch(/120.*80.*核对/);
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:80},layout)).toBeNull();
   expect(venueDimensionsMismatch({...initialBriefMemory(),lengthM:10,widthM:8},{...layout,width:NaN})).toContain('暂时无法核对');
 });
 it('allows a documented approximate-area tolerance without claiming a real measurement',()=>{
   const layout=makeLayout({width:10,height:8});
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:84},layout)).toBeNull();
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:85},layout)).toContain('核对');
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:80.9},layout)).toBeNull();
 });
 it('uses a validated concave polygon footprint rather than its bounding rectangle',()=>{
   const polygon=[{x:0,z:0},{x:10,z:0},{x:10,z:3},{x:4,z:3},{x:4,z:8},{x:0,z:8}];
   const layout=makeLayout({width:10,height:8,backendVenue:{shape:'polygon',width:10,depth:8,height:3,entrances:[],polygon}});
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:50},layout)).toBeNull();
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:80},layout)).toMatch(/80.*50.*核对/);
 });
 it('treats self-intersection, missing polygon and conflicting structure metadata as unknown',()=>{
   const polygon=[{x:0,z:0},{x:10,z:8},{x:0,z:8},{x:10,z:0}];
   const broken=makeLayout({width:10,height:8,backendVenue:{shape:'polygon',width:10,depth:8,height:3,entrances:[],polygon}});
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:80},broken)).toContain('暂时无法核对');
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:80},{...broken,backendVenue:{...broken.backendVenue!,polygon:undefined}})).toContain('暂时无法核对');
   const conflicting={...broken,backendSceneV2:{venue:{shape:'rectangle'}}} as unknown as RoomLayout;
   expect(venueDimensionsMismatch({...initialBriefMemory(),areaM2:80},conflicting)).toContain('不一致');
 });
 it.each(['door','column','entrance'] as const)('invalidates %s addition, removal and movement or resizing',kind=>{
   const original=base(),memory=confirmed(original),floor=original.floors[0]!;
   expect(isVenueScaleCurrent(memory,original)).toBe(true);
   for(const items of [floor.items.filter(item=>item.id!==kind),floor.items.map(item=>item.id===kind?{...item,position:{x:1,z:0}}:item),
     floor.items.map(item=>item.id===kind?{...item,width:item.width+0.1}:item)]){
     expect(isVenueScaleCurrent(memory,{...original,floors:[{...floor,items}]})).toBe(false);
   }
   const absent={...original,floors:[{...floor,items:floor.items.filter(item=>item.id!==kind)}]};
   expect(isVenueScaleCurrent(confirmed(absent),original)).toBe(false);
 });
 it('ignores normal furniture changes and reordering of structural markers',()=>{
   const original=base(),floor=original.floors[0]!,memory=confirmed(original);
   const items=[...floor.items].reverse().map(item=>item.id==='chair'?{...item,position:{x:5,z:4},width:2}:item);
   expect(isVenueScaleCurrent(memory,{...original,floors:[{...floor,items}]})).toBe(true);
 });
 it('does not reuse a legacy or stale confirmation after a concurrent structural edit',()=>{
   const original=base(),floor=original.floors[0]!,old=confirmed(original);
   const updated={...original,floors:[{...floor,items:floor.items.map(item=>item.id==='door'?{...item,width:2}:item)}]};
   expect(isVenueScaleCurrent({...old,venueScaleBasis:undefined},original)).toBe(false);
   expect(isVenueScaleCurrent(old,updated)).toBe(false);
   expect(isVenueScaleCurrent(confirmed(updated),updated)).toBe(true);
 });
 it('invalidates changes to stored source and dimension records',()=>{
   const original=base();
   original.backendSceneV2={venue:{},structure:{},sources:[{assetId:'drawing-1'}],dimensions:[{id:'measure',valueMeters:12}]} as unknown as NonNullable<RoomLayout['backendSceneV2']>;
   const memory=confirmed(original),scene=original.backendSceneV2;
   expect(isVenueScaleCurrent(memory,{...original,backendSceneV2:{...scene,sources:[{...scene.sources[0]!,name:'replacement'}]}})).toBe(false);
   expect(isVenueScaleCurrent(memory,{...original,backendSceneV2:{...scene,dimensions:[{...scene.dimensions[0]!,valueMeters:13}]}})).toBe(false);
 });
});
