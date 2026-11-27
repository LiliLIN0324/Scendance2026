// @vitest-environment jsdom
import {StrictMode} from 'react';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {createLayoutStore} from '../hooks/use-layout-store';
import {makeFloor,makeLayout} from './__testfixtures__/fixtures';
import {useFloorSessionTracker} from './floor-session-epoch';

afterEach(cleanup);
// T2 单层化：楼层维度已与活动 epoch 恒等化。切楼层不再使楼层 token 失效；
// 失效只随活动 scope 往返、首层身份替换、复制/重启/新 tracker 发生。
// 楼层守卫接线保留到 B5 身份/epoch 收敛。
it('invalidates a session token on an activity round trip, not on a floor switch, across StrictMode remount',async()=>{
 const store=createLayoutStore({layout:makeLayout({id:'A',floors:[makeFloor({id:'a'}),makeFloor({id:'b'})]}),activeFloorIndex:0});
 const view=renderHook(()=>useFloorSessionTracker(store),{wrapper:({children})=><StrictMode>{children}</StrictMode>});
 await waitFor(()=>expect(view.result.current.token?.floorId).toBe('a'));
 const old=view.result.current.token!,isCurrent=view.result.current.isCurrent;
 // 楼层往返不再是失效维度：同活动 scope 下 token 仍有效。
 act(()=>{store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});expect(isCurrent(old)).toBe(true);});
 // 活动 scope 往返仍同步失效。
 act(()=>{store.setState({layout:{...store.getState().layout,id:'B'}});store.setState({layout:store.getState().layout});expect(isCurrent(old)).toBe(false);});
 const latest=view.result.current.capture()!;expect(latest.epoch).toBeGreaterThan(old.epoch);expect(isCurrent(latest)).toBe(true);
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
 // 切楼层不失效；活动 scope 离开才失效。
 act(()=>{store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});expect(second.result.current.isCurrent(token)).toBe(true);});
 const next=second.result.current.capture()!;second.unmount();expect(second.result.current.isCurrent(next)).toBe(false);
});
