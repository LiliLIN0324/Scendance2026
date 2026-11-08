// @vitest-environment jsdom
import {StrictMode} from 'react';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {createLayoutStore} from '../hooks/use-layout-store';
import {makeFloor,makeLayout} from './__testfixtures__/fixtures';
import {useFloorSessionTracker} from './floor-session-epoch';

afterEach(cleanup);
it('invalidates a floor token synchronously before React commits and across StrictMode remount',async()=>{
 const store=createLayoutStore({layout:makeLayout({id:'A',floors:[makeFloor({id:'a'}),makeFloor({id:'b'})]}),activeFloorIndex:0});
 const view=renderHook(()=>useFloorSessionTracker(store),{wrapper:({children})=><StrictMode>{children}</StrictMode>});
 await waitFor(()=>expect(view.result.current.token?.floorId).toBe('a'));
 const old=view.result.current.token!,isCurrent=view.result.current.isCurrent;
 act(()=>{store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});expect(isCurrent(old)).toBe(false);});
 const latest=view.result.current.token!;expect(latest.epoch).toBeGreaterThan(old.epoch);expect(isCurrent(latest)).toBe(true);
 view.unmount();expect(isCurrent(latest)).toBe(false);
});
it('switches stores without accepting tokens from the former store',async()=>{
 const a=createLayoutStore({layout:makeLayout({id:'A'}),activeFloorIndex:0}),b=createLayoutStore({layout:makeLayout({id:'B'}),activeFloorIndex:0});
 const view=renderHook(({store})=>useFloorSessionTracker(store),{initialProps:{store:a}});
 await waitFor(()=>expect(view.result.current.token?.scope).toBe('activity:A'));
 const old=view.result.current.token,check=view.result.current.isCurrent;
 view.rerender({store:b});await waitFor(()=>expect(view.result.current.token?.scope).toBe('activity:B'));
 expect(check(old)).toBe(false);expect(view.result.current.isCurrent(old)).toBe(false);
});
it('shares tokens across independently mounted consumers and remains live until the last unsubscribes',async()=>{
 const store=createLayoutStore({layout:makeLayout({id:'A',floors:[makeFloor({id:'a'}),makeFloor({id:'b'})]}),activeFloorIndex:0});
 const first=renderHook(()=>useFloorSessionTracker(store),{wrapper:({children})=><StrictMode>{children}</StrictMode>});
 const second=renderHook(()=>useFloorSessionTracker(store),{wrapper:({children})=><StrictMode>{children}</StrictMode>});
 await waitFor(()=>expect(first.result.current.capture()).not.toBeNull());
 const token=first.result.current.capture()!;expect(second.result.current.isCurrent(token)).toBe(true);
 first.unmount();expect(second.result.current.isCurrent(token)).toBe(true);
 act(()=>{store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});expect(second.result.current.isCurrent(token)).toBe(false);});
 const next=second.result.current.capture()!;second.unmount();expect(second.result.current.isCurrent(next)).toBe(false);
});
