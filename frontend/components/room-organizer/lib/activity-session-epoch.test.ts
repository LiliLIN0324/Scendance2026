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
