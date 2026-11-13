import {describe,expect,it} from 'vitest';
import {createLayoutStore} from '../hooks/use-layout-store';
import {makeLayout} from './__testfixtures__/fixtures';
import {createActivitySessionTracker} from './activity-session-epoch';

describe('同步活动会话代次',()=>{
 it('invalidates the old callback on an A → B → A transition in one synchronous batch',()=>{
  const store=createLayoutStore({layout:makeLayout({id:'A'}),activeFloorIndex:0});
  const tracker=createActivitySessionTracker(store);tracker.start();const old=tracker.capture();
  store.setState({layout:makeLayout({id:'B'})});store.setState({layout:makeLayout({id:'A'})});
  expect(tracker.isCurrent(old)).toBe(false);expect(tracker.isCurrent(tracker.capture())).toBe(true);tracker.stop();
 });
 it('does not invalidate ordinary same-activity edits, but stopping and restarting never revives old callbacks',()=>{
  const store=createLayoutStore({layout:makeLayout({id:'A'}),activeFloorIndex:0});const tracker=createActivitySessionTracker(store);
  expect(tracker.capture()).toBeNull();tracker.start();tracker.start();const original=tracker.capture();
  store.setState({layout:{...store.getState().layout,name:'修改名称'}});expect(tracker.isCurrent(original)).toBe(true);
  tracker.stop();expect(tracker.isCurrent(original)).toBe(false);store.setState({layout:makeLayout({id:'B'})});
  tracker.start();expect(tracker.isCurrent(original)).toBe(false);expect(tracker.capture()?.scope).toBe('activity:B');
  tracker.stop();tracker.stop();expect(tracker.capture()).toBeNull();
 });
});

describe('注入外部身份源（M3a project 源）',()=>{
 it('scope 取自定义源；切项目旧 token 失效、epoch 前进，同项目不失效',()=>{
  const store=createLayoutStore({layout:makeLayout({id:'A'}),activeFloorIndex:0});
  let scope='project:alpha';
  const listeners=new Set<()=>void>();
  const source={getScope:()=>scope,subscribe:(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};}};
  const tracker=createActivitySessionTracker(store,source);tracker.start();
  const original=tracker.capture();
  expect(original?.scope).toBe('project:alpha');
  expect(tracker.isCurrent(original)).toBe(true);
  // 同项目内普通变化：源 scope 不变，不失效。
  listeners.forEach(l=>l());
  expect(tracker.isCurrent(original)).toBe(true);
  // 切到另一项目：旧 token 失效，新 token epoch 更大。
  scope='project:beta';listeners.forEach(l=>l());
  expect(tracker.isCurrent(original)).toBe(false);
  const latest=tracker.capture();
  expect(latest?.scope).toBe('project:beta');
  expect(tracker.isCurrent(latest)).toBe(true);
  expect(latest!.epoch).toBeGreaterThan(original!.epoch);
  tracker.stop();
 });
});
