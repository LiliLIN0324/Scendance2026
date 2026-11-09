import {describe,expect,it,vi} from 'vitest';
import {createRouteDrawingSession} from './route-drawing-session';

describe('2D route drawing session',()=>{
 it('captures on the first point and commits the same floor exactly once',()=>{
  const commit=vi.fn(()=>true),binding={floorId:'floor-1',isCurrent:()=>true},capture=vi.fn(()=>binding);
  const route=createRouteDrawingSession(capture,commit);
  expect(route.add({x:0,z:0})).toBe('added');expect(route.add({x:3,z:1})).toBe('added');
  expect(route.finish()).toBe('committed');expect(route.finish()).toBe('closed');
  expect(capture).toHaveBeenCalledOnce();expect(commit).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledWith([{x:0,z:0},{x:3,z:1}],binding);
 });
 it.each(['activity','floor','venue'] as const)('cancels when %s changes even if it changes back',()=>{
  let epoch=0;const commit=vi.fn(()=>true),route=createRouteDrawingSession(()=>{
   const original=epoch;return {floorId:'floor',isCurrent:()=>epoch===original};
  },commit);
  expect(route.add({x:0,z:0})).toBe('added');epoch++;expect(route.revalidate()).toBe(false);epoch++;
  expect(route.add({x:1,z:1})).toBe('unavailable');expect(route.finish()).toBe('closed');expect(commit).not.toHaveBeenCalled();
 });
 it('never commits if scope changes between the last point and completion',()=>{
  let valid=true;const commit=vi.fn(()=>true),route=createRouteDrawingSession(()=>({floorId:'f',isCurrent:()=>valid}),commit);
  route.add({x:0,z:0});route.add({x:1,z:1});valid=false;
  expect(route.finish()).toBe('invalidated');expect(commit).not.toHaveBeenCalled();
 });
 it('does not create a route when the scope is unavailable, a point is invalid, or it has one point',()=>{
  const commit=vi.fn(()=>true),missing=createRouteDrawingSession(()=>null,commit);
  expect(missing.add({x:0,z:0})).toBe('unavailable');expect(commit).not.toHaveBeenCalled();
  const short=createRouteDrawingSession(()=>({floorId:'f',isCurrent:()=>true}),commit);
  expect(short.add({x:Number.NaN,z:0})).toBe('unavailable');short.add({x:0,z:0});expect(short.finish()).toBe('short');expect(commit).not.toHaveBeenCalled();
 });
});
