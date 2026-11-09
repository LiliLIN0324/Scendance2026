// @vitest-environment jsdom
import {act,renderHook} from '@testing-library/react';
import {StrictMode} from 'react';
import {describe,expect,it,vi} from 'vitest';
import {usePlanAnnotations} from '../hooks/use-plan-annotations';
import {createActivitySessionTracker} from './activity-session-epoch';
import {createFloorSessionTracker} from './floor-session-epoch';
import {createVenueFactTracker} from './venue-fact-epoch';
import {createRouteDrawingSession} from './route-drawing-session';
import {makeFloor,makeLayout} from './__testfixtures__/fixtures';

function setup(){
 let state={layout:makeLayout({id:'activity-a',floors:[makeFloor({id:'one'}),makeFloor({id:'two'})]}),activeFloorIndex:0};
 const listeners=new Set<(next:typeof state)=>void>();
 const store={getState:()=>state,subscribe:(listener:(next:typeof state)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);}};
 const activity=createActivitySessionTracker(store as never),floor=createFloorSessionTracker(store as never),venue=createVenueFactTracker(store as never);
 activity.start();floor.start();const offVenue=venue.listen(()=>{});
 const update=(next:typeof state)=>{state=next;for(const listener of listeners)listener(state);};
 return {getState:()=>state,update,store,activity,floor,venue,close:()=>{offVenue();floor.stop();activity.stop();}};
}

describe('route provenance with live activity, floor and venue trackers',()=>{
 it('records the exact committed user route and invalidates it when the venue changes',()=>{
  const f=setup(),{result,unmount}=renderHook(()=>usePlanAnnotations(),{wrapper:StrictMode});
  const route=createRouteDrawingSession(()=>{
   const activity=f.activity.capture(),floor=f.floor.capture(),venue=f.venue.capture();if(!activity||!floor||!venue)return null;
   return {floorId:floor.floorId,isCurrent:()=>f.activity.isCurrent(activity)&&f.floor.isCurrent(floor)&&f.venue.isCurrent(venue)};
  },(points,binding)=>result.current.addUserRouteFromPoints(points,'入口路线',binding));
  route.add({x:0,z:0});route.add({x:2,z:0});act(()=>expect(route.finish()).toBe('committed'));
  const id=result.current.getSnapshot().draft!.annotations[0]!.id;
  expect(result.current.getUserRouteProvenance(id)).toEqual({source:'user',floorId:'one',sourceBasis:'unknown'});
  f.update({...f.getState(),layout:{...f.getState().layout,width:9}});
  expect(result.current.getUserRouteProvenance(id)).toBeNull();unmount();f.close();
 });
 it.each(['activity','floor','venue'] as const)('cancels a partially drawn route on synchronous %s A→B→A',kind=>{
  const f=setup(),commit=vi.fn(()=>true),route=createRouteDrawingSession(()=>{
   const activity=f.activity.capture(),floor=f.floor.capture(),venue=f.venue.capture();if(!activity||!floor||!venue)return null;
   return {floorId:floor.floorId,isCurrent:()=>f.activity.isCurrent(activity)&&f.floor.isCurrent(floor)&&f.venue.isCurrent(venue)};
  },commit);
  const unsub=f.store.subscribe(()=>route.revalidate());const initial=f.getState();
  route.add({x:0,z:0});
  const altered=kind==='activity'?{...initial,layout:{...initial.layout,id:'activity-b'}}:
   kind==='floor'?{...initial,activeFloorIndex:1}:{...initial,layout:{...initial.layout,width:9}};
  f.update(altered);f.update(initial);
  expect(route.finish()).toBe('closed');expect(commit).not.toHaveBeenCalled();unsub();f.close();
 });
 it('does not attach a partially drawn route to a replaced or changed annotation draft',()=>{
  const f=setup(),{result,unmount}=renderHook(()=>usePlanAnnotations(),{wrapper:StrictMode});
  const route=createRouteDrawingSession(()=>{
   const activity=f.activity.capture(),floor=f.floor.capture(),venue=f.venue.capture(),draft=result.current.getSnapshot();
   if(!activity||!floor||!venue)return null;
   return {floorId:floor.floorId,isCurrent:()=>f.activity.isCurrent(activity)&&f.floor.isCurrent(floor)&&f.venue.isCurrent(venue),
    isDrawingCurrent:()=>result.current.getSnapshot().revision===draft.revision};
  },(points,binding)=>result.current.addUserRouteFromPoints(points,'路线',binding));
  route.add({x:0,z:0});route.add({x:2,z:0});
  act(()=>result.current.addZoneRects([{zoneType:'rest',label:'休息',rect:{x:0,z:0,width:2,depth:2}}]));
  act(()=>expect(route.finish()).toBe('invalidated'));
  expect(result.current.getSnapshot().draft!.annotations.map(item=>item.kind)).toEqual(['zone']);
  unmount();f.close();
 });
});
