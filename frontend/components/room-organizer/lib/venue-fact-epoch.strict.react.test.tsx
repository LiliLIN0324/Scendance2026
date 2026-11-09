// @vitest-environment jsdom
import {StrictMode} from 'react';
import {cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {useVenueFactTracker} from './venue-fact-epoch';
import {makeLayout} from './__testfixtures__/fixtures';
afterEach(cleanup);
it('StrictMode subscribes safely and invalidates pre-unmount tokens',()=>{
 let layout=makeLayout();const listeners=new Set<()=>void>();const store={getState:()=>({layout}),subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},set(value:typeof layout){layout=value;for(const fn of listeners)fn();}};
 const hook=renderHook(()=>useVenueFactTracker(store as never),{wrapper:StrictMode});const token=hook.result.current.capture();
 expect(token).not.toBeNull();expect(hook.result.current.isCurrent(token)).toBe(true);hook.unmount();expect(hook.result.current.isCurrent(token)).toBe(false);
});
