import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout,makeUnplacedItem} from '../components/room-organizer/lib/__testfixtures__/fixtures';
import {reviewLocalRoutes,type LocalRouteInput} from './local-route-review';
import type {FurnitureItem} from '../components/room-organizer/lib/types';

const route=(points:{x:number;z:number}[],overrides:Partial<LocalRouteInput>={}):LocalRouteInput=>({
  annotation:{id:'route-1',kind:'route',label:'路线',stageNo:1,geometry:{kind:'polyline',points}},floorId:'ground',source:'user',...overrides,
});
const horizontal=route([{x:-3,z:0},{x:3,z:0}]);
const layout=(items:FurnitureItem[]=[])=>makeLayout({id:'activity-1',floors:[makeFloor({items})]});

describe('local route centreline comparison',()=>{
 it('reports a new model-footprint intersection without claiming wider passage',()=>{
  const base=layout(),candidate=layout([makeItem()]);
  const result=reviewLocalRoutes(base,candidate,[horizontal],'ground');
  expect(result.status).toBe('violated');expect(result.centerlineCoverage).toBe('complete');expect(result.violations).toMatchObject([{routeId:'route-1',itemId:'item-1',occupiedLengthM:1}]);
  expect(result.unknown).toContain('路线宽度与实际净宽');expect(result.unknown).toContain('消防与无障碍要求');
 });
 it('keeps existing and improved intersections separate and flags only increased occupancy',()=>{
  const base=layout([makeItem({width:2})]),same=layout([makeItem({width:2})]),smaller=layout([makeItem({width:1})]),larger=layout([makeItem({width:3})]);
  expect(reviewLocalRoutes(base,same,[horizontal],'ground')).toMatchObject({status:'unknown',violations:[],existing:[{itemId:'item-1'}]});
  expect(reviewLocalRoutes(base,smaller,[horizontal],'ground')).toMatchObject({status:'unknown',violations:[],existing:[{itemId:'item-1'}]});
  expect(reviewLocalRoutes(base,larger,[horizontal],'ground')).toMatchObject({status:'violated',violations:[{itemId:'item-1'}]});
 });
 it('does not call touching or a nearby but separate object blocked',()=>{
  const candidate=layout([makeItem({position:{x:0,z:0.5}}),makeItem({id:'near',position:{x:2,z:0.6}})]);
  expect(reviewLocalRoutes(layout(),candidate,[horizontal],'ground')).toMatchObject({status:'unknown',centerlineCoverage:'complete',violations:[],contacts:[{itemId:'item-1'}]});
 });
 it('marks a checked, clear centreline complete while safety remains unknown',()=>{
  const result=reviewLocalRoutes(layout(),layout([makeItem({position:{x:0,z:2}})]),[horizontal],'ground');
  expect(result).toMatchObject({status:'unknown',centerlineCoverage:'complete',violations:[],contacts:[]});
  expect(result.unknown).toEqual(expect.arrayContaining(['路线宽度与实际净宽','消防与无障碍要求','现场实物和固定障碍']));
 });
 it('uses the same rotation convention as the editor',()=>{
  const candidate=layout([makeItem({width:2,depth:0.4,rotation:Math.PI/2,position:{x:0,z:0.8}})]);
  expect(reviewLocalRoutes(layout(),candidate,[horizontal],'ground').status).toBe('violated');
  expect(reviewLocalRoutes(layout(),layout([makeItem({width:2,depth:0.4,position:{x:0,z:0.8}})]),[horizontal],'ground').violations).toEqual([]);
 });
 it('ignores only low items and structural markers, and keeps other invalid data unknown',()=>{
  const candidate=layout([makeItem({id:'rug',type:'rug',height:.02}),makeItem({id:'marker',structuralColumnId:'column'}),makeUnplacedItem({id:'unknown'})]);
  const result=reviewLocalRoutes(layout(),candidate,[horizontal],'ground');
  expect(result.violations).toEqual([]);expect(result.centerlineCoverage).toBe('incomplete');expect(result.unknown.join(' ')).toContain('unknown');
 });
 it('does not assume a thin non-rug or tabletop object is safe to cross',()=>{
  const result=reviewLocalRoutes(layout(),layout([makeItem({id:'thin',height:.02}),makeItem({id:'lamp',type:'lamp'})]),[horizontal],'ground');
  expect(result.violations).toEqual([]);expect(result.unknown.join(' ')).toContain('支撑关系');
 });
 it('does not confuse wall-hung or raised items with confirmed floor obstruction',()=>{
  const result=reviewLocalRoutes(layout(),layout([makeItem({id:'picture',type:'painting'}),makeItem({id:'raised',height:.02,elevation:1})]),[horizontal],'ground');
  expect(result.violations).toEqual([]);expect(result.unknown.join(' ')).toContain('离地净空');
 });
 it('does not let an elevated or support-unknown footprint far from every segment block centreline coverage',()=>{
  const bent=route([{x:-3,z:0},{x:0,z:0},{x:0,z:3}]);
  const items=[makeItem({id:'plant',type:'plant',position:{x:2,z:2},rotation:Math.PI/4}),
    makeItem({id:'raised',elevation:1,position:{x:-2,z:2}}),makeItem({id:'thin',height:.02,position:{x:2,z:-2}})];
  const result=reviewLocalRoutes(layout(items),layout(items),[bent],'ground');
  expect(result).toMatchObject({status:'unknown',centerlineCoverage:'complete',violations:[]});
  expect(result.unknown).toContain('路线宽度与实际净宽');
  expect(result.unknown.join(' ')).not.toMatch(/支撑关系|离地净空/);
 });
 it('keeps intersecting or tangent uncertain footprints unknown in either base or candidate',()=>{
  const atEdge=makeItem({id:'thin',height:.02,position:{x:0,z:.5}});
  for(const [before,after] of [[layout(),layout([atEdge])],[layout([atEdge]),layout()]] as const){
    const result=reviewLocalRoutes(before,after,[horizontal],'ground');
    expect(result).toMatchObject({status:'unknown',centerlineCoverage:'incomplete',violations:[]});
    expect(result.unknown.join(' ')).toContain('支撑关系');
  }
  const raised=makeItem({id:'raised',elevation:1,position:{x:0,z:0},rotation:Math.PI/4});
  expect(reviewLocalRoutes(layout(),layout([raised]),[horizontal],'ground')).toMatchObject({status:'unknown',centerlineCoverage:'incomplete',violations:[]});
 });
 it('can prove a new grounded intersection when the same previously raised footprint was far away',()=>{
  const previous=makeItem({id:'moved',elevation:1,position:{x:0,z:2}}),next=makeItem({id:'moved',position:{x:0,z:0}});
  expect(reviewLocalRoutes(layout([previous]),layout([next]),[horizontal],'ground')).toMatchObject({status:'violated',centerlineCoverage:'complete',violations:[{itemId:'moved'}]});
 });
 it('does not treat an unmapped door or a changed structural identity as furniture obstruction',()=>{
  const door=makeItem({id:'opening',type:'door'}),chair=makeItem({id:'opening'});
  expect(reviewLocalRoutes(layout(),layout([door]),[horizontal],'ground')).toMatchObject({status:'unknown',violations:[]});
  expect(reviewLocalRoutes(layout([door]),layout([chair]),[horizontal],'ground')).toMatchObject({status:'unknown',violations:[]});
 });
 it('requires explicitly supplied user source and exact floor binding',()=>{
  const candidate=layout([makeItem()]);
  for(const input of [{source:'unknown' as const},{source:'inferred' as const},{floorId:null},{floorId:'other'}]){
    const result=reviewLocalRoutes(layout(),candidate,[{...horizontal,...input}],'ground');
    expect(result.status).toBe('unknown');expect(result.centerlineCoverage).toBe('incomplete');expect(result.violations).toEqual([]);
  }
  const two=makeLayout({id:'activity-1',floors:[makeFloor(),makeFloor({id:'upper',items:[makeItem()]})]});
  expect(reviewLocalRoutes(makeLayout({id:'activity-1',floors:[makeFloor(),makeFloor({id:'upper'})]}),two,[{...horizontal,floorId:'ground'}],'upper').violations).toEqual([]);
 });
 it('rejects routes crossing the missing portion of a concave venue',()=>{
  const shape={shape:'polygon' as const,width:8,depth:8,height:3,entrances:[],polygon:[{x:0,z:0},{x:8,z:0},{x:8,z:3},{x:3,z:3},{x:3,z:8},{x:0,z:8}]};
  const base=makeLayout({id:'activity-1',backendVenue:shape,floors:[makeFloor()]}),candidate=makeLayout({id:'activity-1',backendVenue:shape,floors:[makeFloor({items:[makeItem({position:{x:-2,z:-2}})]})]});
  const inside=route([{x:-3,z:-2},{x:3,z:-2}]);
  expect(reviewLocalRoutes(base,candidate,[inside],'ground').status).toBe('violated');
  const throughNotch=route([{x:3,z:-2},{x:-2,z:3}]);
  const result=reviewLocalRoutes(base,candidate,[throughNotch],'ground');
  expect(result.status).toBe('unknown');expect(result.centerlineCoverage).toBe('incomplete');expect(result.violations).toEqual([]);
 });
 it('keeps malformed routes, unplaced previous objects, changed geometry and missing floor unknown',()=>{
  const invalid=route([{x:0,z:0},{x:Number.NaN,z:0}]);
  expect(reviewLocalRoutes(layout(),layout([makeItem()]),[invalid],'ground').status).toBe('unknown');
  expect(reviewLocalRoutes(layout([makeUnplacedItem()]),layout([makeItem()]),[horizontal],'ground').violations).toEqual([]);
  expect(reviewLocalRoutes(layout(),makeLayout({id:'activity-1',width:10,floors:[makeFloor({items:[makeItem()]})]}),[horizontal],'ground').violations).toEqual([]);
  expect(reviewLocalRoutes(layout(),layout([makeItem()]),[horizontal],null).violations).toEqual([]);
  expect(reviewLocalRoutes(layout(),layout(),[],null)).toMatchObject({status:'not_applicable',centerlineCoverage:'not_applicable'});
 });
 it('does not count missing input as an empty valid route list',()=>{
  expect(reviewLocalRoutes(layout(),layout(),undefined,'ground')).toMatchObject({status:'unknown',centerlineCoverage:'incomplete'});
 });
 it('keeps coverage incomplete when an original unknown item is removed or does not intersect',()=>{
  const old=layout([makeUnplacedItem({id:'unplaced'})]);
  const empty=reviewLocalRoutes(old,layout(),[horizontal],'ground');
  expect(empty).toMatchObject({status:'unknown',centerlineCoverage:'incomplete'});
  expect(empty.unknown.join(' ')).toContain('unplaced');
 });
 it('reports a proved digital intersection and incomplete coverage simultaneously',()=>{
  const result=reviewLocalRoutes(layout(),layout([makeItem(),makeUnplacedItem({id:'unplaced'})]),[horizontal],'ground');
  expect(result).toMatchObject({status:'violated',centerlineCoverage:'incomplete',violations:[{itemId:'item-1'}]});
 });
 it('does not silently coerce a mismatched scene footprint into the canvas bounds',()=>{
  const inconsistent=makeLayout({id:'activity-1',backendVenue:{shape:'rectangle',width:10,depth:8,height:3,entrances:[]},floors:[makeFloor({items:[makeItem()]})]});
  expect(reviewLocalRoutes(layout(),inconsistent,[horizontal],'ground')).toMatchObject({status:'unknown',violations:[]});
 });
 it('does not compare routes across activities or a missing activity identity',()=>{
  const candidate=makeLayout({id:'other-activity',floors:[makeFloor({items:[makeItem()]})]});
  expect(reviewLocalRoutes(layout(),candidate,[horizontal],'ground')).toMatchObject({status:'unknown',violations:[]});
  expect(reviewLocalRoutes(makeLayout(),makeLayout({floors:[makeFloor({items:[makeItem()]})]}),[horizontal],'ground')).toMatchObject({status:'unknown',violations:[]});
 });
 it('fails safely for malformed IDs, repeated routes and excessive work',()=>{
  const item=makeItem();(item as unknown as {id:number}).id=42;
  expect(reviewLocalRoutes(layout(),layout([item]),[horizontal],'ground')).toMatchObject({status:'unknown',violations:[]});
  expect(reviewLocalRoutes(layout(),layout([makeItem()]),[horizontal,horizontal],'ground')).toMatchObject({status:'unknown',violations:[]});
  const large=Array.from({length:150},(_,i)=>makeItem({id:`item-${i}`}));
  const longRoute=route(Array.from({length:1000},(_,i)=>({x:-3+i*.006,z:0})));
  expect(reviewLocalRoutes(layout(),layout(large),[longRoute],'ground')).toMatchObject({status:'unknown',violations:[]});
 });
});
