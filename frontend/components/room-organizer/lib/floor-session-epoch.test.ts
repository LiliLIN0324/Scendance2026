import {describe,expect,it} from 'vitest';
import {createLayoutStore} from '../hooks/use-layout-store';
import {makeFloor,makeLayout} from './__testfixtures__/fixtures';
import {createFloorSessionTracker} from './floor-session-epoch';

const makeStore=()=>createLayoutStore({layout:makeLayout({id:'activity-a',floors:[makeFloor({id:'floor-a'}),makeFloor({id:'floor-b'})]}),activeFloorIndex:0});
describe('synchronous floor session',()=>{
 it('invalidates a token synchronously across same-batch floor and activity round trips',()=>{
  const store=makeStore(),tracker=createFloorSessionTracker(store);expect(tracker.capture()).toBeNull();expect(tracker.isCurrent(null)).toBe(false);
  tracker.start();const first=tracker.capture()!;
  store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});expect(tracker.isCurrent(first)).toBe(false);
  const second=tracker.capture()!;expect(second.epoch).toBeGreaterThan(first.epoch);expect(tracker.isCurrent(second)).toBe(true);
  const layout=store.getState().layout;store.setState({layout:{...layout,id:'activity-b'}});store.setState({layout});expect(tracker.isCurrent(second)).toBe(false);
  tracker.stop();expect(tracker.isCurrent(tracker.capture())).toBe(false);
 });
 it('detects floor identity changes but ignores ordinary edits and rejects invalid indices',()=>{
  const store=makeStore(),tracker=createFloorSessionTracker(store);tracker.start();const initial=tracker.capture()!;
  store.setState({layout:{...store.getState().layout,name:'更名'}});expect(tracker.isCurrent(initial)).toBe(true);
  const before=store.getState().layout;store.setState({layout:{...before,floors:[{...before.floors[0]!,id:'replacement'},before.floors[1]!]}});
  expect(tracker.isCurrent(initial)).toBe(false);expect(tracker.capture()?.floorId).toBe('replacement');
  const current=tracker.capture();store.setState({activeFloorIndex:9});expect(tracker.capture()).toBeNull();expect(tracker.isCurrent(current)).toBe(false);
  store.setState({activeFloorIndex:0});expect(tracker.isCurrent(current)).toBe(false);tracker.stop();
 });
 it('never accepts a copied or old token after restart or a new tracker',()=>{
  const store=makeStore(),tracker=createFloorSessionTracker(store);tracker.start();const old=tracker.capture()!;
  expect(tracker.isCurrent({...old})).toBe(false);tracker.stop();tracker.start();expect(tracker.isCurrent(old)).toBe(false);
  const current=tracker.capture()!;expect(current.epoch).toBeGreaterThan(old.epoch);
  const other=createFloorSessionTracker(store);other.start();expect(other.isCurrent(current)).toBe(false);expect(other.capture()!.epoch).toBeGreaterThan(current.epoch);
  other.stop();tracker.stop();
 });
});
