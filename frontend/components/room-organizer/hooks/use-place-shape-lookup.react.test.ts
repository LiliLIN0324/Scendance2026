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
it('current request still retries three times and stops loading after a miss', async()=>{
 vi.mocked(fetchPlaceShape).mockResolvedValue(null);const hook=renderHook(()=>usePlaceShapeLookup('a',vi.fn()));
 await act(async()=>hook.result.current.start('current',near));
 await act(async()=>vi.advanceTimersByTimeAsync(18000));
 expect(fetchPlaceShape).toHaveBeenCalledTimes(3);expect(hook.result.current.loading).toBe(false);
});
