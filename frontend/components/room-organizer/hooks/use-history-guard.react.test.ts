// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useHistory} from './use-history';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('refuses undo and redo before altering their stacks, then allows the same entries after review',()=>{
 vi.useFakeTimers();let allowed=false;const apply=vi.fn(),a={name:'A'},b={name:'B'};
 const hook=renderHook(({value})=>useHistory(value,apply,{debounceMs:10,canApply:()=>allowed}),{initialProps:{value:a}});
 hook.rerender({value:b});act(()=>vi.advanceTimersByTime(10));expect(hook.result.current.canUndo).toBe(true);
 act(()=>hook.result.current.undo());expect(apply).not.toHaveBeenCalled();expect(hook.result.current.canUndo).toBe(true);
 allowed=true;act(()=>hook.result.current.undo());expect(apply).toHaveBeenLastCalledWith(a);hook.rerender({value:a});
 allowed=false;act(()=>hook.result.current.redo());expect(apply).toHaveBeenCalledTimes(1);expect(hook.result.current.canRedo).toBe(true);
 allowed=true;act(()=>hook.result.current.redo());expect(apply).toHaveBeenLastCalledWith(b);
});
it('does not lose a pending unsaved change when its immediate undo is refused',()=>{
 vi.useFakeTimers();let allowed=false;const apply=vi.fn(),a={name:'A'},b={name:'B'};
 const hook=renderHook(({value})=>useHistory(value,apply,{debounceMs:100,canApply:()=>allowed}),{initialProps:{value:a}});
 hook.rerender({value:b});act(()=>hook.result.current.undo());expect(apply).not.toHaveBeenCalled();expect(hook.result.current.canUndo).toBe(true);
 allowed=true;act(()=>hook.result.current.undo());expect(apply).toHaveBeenCalledWith(a);
});

it('retains history when applying a preflight-approved snapshot throws',()=>{
 vi.useFakeTimers();let fails=true;const apply=vi.fn(()=>{if(fails)throw new Error('rejected');}),a={name:'A'},b={name:'B'};
 const hook=renderHook(({value})=>useHistory(value,apply,{debounceMs:10,canApply:()=>true}),{initialProps:{value:a}});
 hook.rerender({value:b});act(()=>vi.advanceTimersByTime(10));
 act(()=>hook.result.current.undo());expect(hook.result.current.canUndo).toBe(true);expect(hook.result.current.canRedo).toBe(false);
 fails=false;act(()=>hook.result.current.undo());expect(apply).toHaveBeenLastCalledWith(a);hook.rerender({value:a});
 fails=true;act(()=>hook.result.current.redo());expect(hook.result.current.canRedo).toBe(true);
 fails=false;act(()=>hook.result.current.redo());expect(apply).toHaveBeenLastCalledWith(b);
});
