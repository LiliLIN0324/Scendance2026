// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchPlaceShape } from '../lib/place-area';
import { usePlaceShapeLookup } from './use-place-shape-lookup';
vi.mock('../lib/place-area', () => ({ fetchPlaceShape: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.mocked(fetchPlaceShape).mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const near = { lng: 120, lat: 30 };
const shape = { id: 'new-id', level: '占地范围', lng:120,lat:30,name: 'new', kind: 'area' as const, polygon: [[120,30],[121,30],[121,31]] as [number,number][], bounds: [120,30,121,31] as [number,number,number,number] };
it('clear cancels a scheduled retry rather than merely ignoring its eventual response', async () => {
 vi.mocked(fetchPlaceShape).mockResolvedValue(null);
 const hook=renderHook(()=>usePlaceShapeLookup('project-a',vi.fn()));
 await act(async()=>hook.result.current.start('old',near));
 expect(fetchPlaceShape).toHaveBeenCalledTimes(1);
 const signal=vi.mocked(fetchPlaceShape).mock.calls[0][1]!.signal!;
 act(()=>hook.result.current.cancel()); expect(signal.aborted).toBe(true);
 await act(async()=>vi.advanceTimersByTimeAsync(30000));
 expect(fetchPlaceShape).toHaveBeenCalledTimes(1); expect(hook.result.current.loading).toBe(false);
});
it('selecting a different place aborts the old request; a late result cannot replace the new outline', async () => {
 let finish!:(value:typeof shape)=>void; const received=vi.fn();
 vi.mocked(fetchPlaceShape).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(shape);
 const hook=renderHook(()=>usePlaceShapeLookup('a',received));
 act(()=>hook.result.current.start('old',near)); const signal=vi.mocked(fetchPlaceShape).mock.calls[0][1]!.signal!;
 await act(async()=>hook.result.current.start('new',near));
 expect(signal.aborted).toBe(true);
 await act(async()=>finish({...shape,name:'old'}));
 expect(received).toHaveBeenCalledTimes(1);expect(received).toHaveBeenCalledWith(shape,'new');
});
it.each(['timer','in-flight'])('project switch and unmount cancel %s work, with no later network or callbacks', async mode => {
 const received=vi.fn();let finish!:(value:typeof shape)=>void;
 if(mode==='timer') vi.mocked(fetchPlaceShape).mockResolvedValue(null);
 else vi.mocked(fetchPlaceShape).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(({project})=>usePlaceShapeLookup(project,received),{initialProps:{project:'a'}});
 await act(async()=>hook.result.current.start('old',near)); const first=vi.mocked(fetchPlaceShape).mock.calls[0][1]!.signal!;
 hook.rerender({project:'b'});expect(first.aborted).toBe(true);
 if(mode==='in-flight') await act(async()=>finish(shape));
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(fetchPlaceShape).toHaveBeenCalledTimes(1);expect(received).not.toHaveBeenCalled();
 await act(async()=>hook.result.current.start('second',near));const second=vi.mocked(fetchPlaceShape).mock.calls[1][1]!.signal!;
 hook.unmount();expect(second.aborted).toBe(true);
 if(mode==='in-flight') await act(async()=>finish(shape));
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(fetchPlaceShape).toHaveBeenCalledTimes(2);expect(received).not.toHaveBeenCalled();
});
it('a cache hit never shows the network loading state', async()=>{
  vi.mocked(fetchPlaceShape).mockResolvedValue(shape);
  const hook=renderHook(()=>usePlaceShapeLookup('cache-hit',vi.fn()));
  await act(async()=>hook.result.current.start('cached-place',near));
  expect(fetchPlaceShape).toHaveBeenCalledWith('cached-place',expect.objectContaining({onRequestStart:expect.any(Function)}));
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.unavailable).toBe(false);
});
it('network lookup shows loading only after the request-start callback', async()=>{
  let finish!:(value:typeof shape)=>void;
  let readLoading = () => false;
  vi.mocked(fetchPlaceShape).mockImplementation((_name, options) => new Promise(resolve => {
    options?.onRequestStart?.();
    expect(readLoading()).toBe(false);
    finish=resolve;
  }));
  const hook=renderHook(()=>usePlaceShapeLookup('network-miss',vi.fn()));
  readLoading=()=>hook.result.current.loading;
  act(()=>hook.result.current.start('uncached-place',near));
  expect(hook.result.current.loading).toBe(true);
  await act(async()=>finish(shape));
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.unavailable).toBe(false);
});
it('a miss stops immediately without silently repeating the lookup', async()=>{
 vi.mocked(fetchPlaceShape).mockResolvedValue(null);const hook=renderHook(()=>usePlaceShapeLookup('a',vi.fn()));
 await act(async()=>hook.result.current.start('current',near));
 await act(async()=>vi.advanceTimersByTimeAsync(18000));
 expect(fetchPlaceShape).toHaveBeenCalledTimes(1);expect(hook.result.current.loading).toBe(false);
 expect(hook.result.current.unavailable).toBe(true);
});
it('a stalled lookup stops within its total budget and cannot apply a late outline', async()=>{
 let finish!:(value:typeof shape)=>void;const received=vi.fn();
 vi.mocked(fetchPlaceShape).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(()=>usePlaceShapeLookup('slow',received));
 act(()=>hook.result.current.start('植物园',near));
 const signal=vi.mocked(fetchPlaceShape).mock.calls[0][1]!.signal!;
 await act(async()=>vi.advanceTimersByTimeAsync(21000));
 expect(signal.aborted).toBe(true);expect(hook.result.current.loading).toBe(false);
 expect(hook.result.current.unavailable).toBe(true);
 await act(async()=>finish(shape));
 expect(received).not.toHaveBeenCalled();expect(fetchPlaceShape).toHaveBeenCalledTimes(1);
});

it.each(['timer','in-flight'])('manual boundary replacement stops %s lookup and its loading pill',async mode=>{
 let finish!:(value:typeof shape)=>void;const received=vi.fn();
 if(mode==='timer')vi.mocked(fetchPlaceShape).mockResolvedValue(null);
 else vi.mocked(fetchPlaceShape).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(({boundary})=>usePlaceShapeLookup('same-project',received,boundary),{initialProps:{boundary:'old-ring'}});
 await act(async()=>hook.result.current.start('IN77',near));const signal=vi.mocked(fetchPlaceShape).mock.calls[0][1]!.signal!;
 hook.rerender({boundary:'hand-drawn-ring'});expect(signal.aborted).toBe(true);expect(hook.result.current.loading).toBe(false);
 if(mode==='in-flight')await act(async()=>finish(shape));
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(fetchPlaceShape).toHaveBeenCalledTimes(1);expect(received).not.toHaveBeenCalled();
});
