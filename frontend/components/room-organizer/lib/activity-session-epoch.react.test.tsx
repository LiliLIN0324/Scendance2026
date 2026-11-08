// @vitest-environment jsdom
import {StrictMode} from 'react';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it} from 'vitest';
import {createLayoutStore} from '../hooks/use-layout-store';
import {makeLayout} from './__testfixtures__/fixtures';
import {useActivitySessionTracker} from './activity-session-epoch';

afterEach(cleanup);
describe('活动会话代次的 React 接线',()=>{
 it('rerenders after same-batch A → B → A and invalidates the old callback in Strict Mode',async()=>{
  const store=createLayoutStore({layout:makeLayout({id:'A'}),activeFloorIndex:0});
  const view=renderHook(()=>useActivitySessionTracker(store),{wrapper:({children})=><StrictMode>{children}</StrictMode>});
  await waitFor(()=>expect(view.result.current.token).not.toBeNull());
  const old=view.result.current.token!;const check=view.result.current.isCurrent;
  act(()=>{store.setState({layout:makeLayout({id:'B'})});store.setState({layout:makeLayout({id:'A'})});expect(check(old)).toBe(false);});
  expect(view.result.current.token?.scope).toBe('activity:A');
  expect(view.result.current.token?.epoch).toBeGreaterThan(old.epoch);
  const latest=view.result.current.token;expect(check(latest)).toBe(true);
  view.unmount();expect(check(latest)).toBe(false);
 });
 it('tracks replacement stores without reusing the previous subscription',async()=>{
  const a=createLayoutStore({layout:makeLayout({id:'A'}),activeFloorIndex:0});
  const b=createLayoutStore({layout:makeLayout({id:'B'}),activeFloorIndex:0});
  const view=renderHook(({store})=>useActivitySessionTracker(store),{initialProps:{store:a}});
  await waitFor(()=>expect(view.result.current.token?.scope).toBe('activity:A'));
  const old=view.result.current.token;const previousCheck=view.result.current.isCurrent;
  view.rerender({store:b});await waitFor(()=>expect(view.result.current.token?.scope).toBe('activity:B'));
  expect(previousCheck(old)).toBe(false);act(()=>a.setState({layout:makeLayout({id:'C'})}));
  expect(view.result.current.token?.scope).toBe('activity:B');
 });
});
