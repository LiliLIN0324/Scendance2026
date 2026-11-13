// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { archiveLocalActivity, listLocalActivities } from '@/lib/local-activities';
import { parseLocalProjectBackupJson, serializeLocalProjectBackupV3 } from '@/lib/local-project-backup';
import type { LocalProjectBackupActions } from './creative-studio';
import { LocalActivitiesPanel } from './local-activities-panel';
import { LocalActivitySwitchGuardProvider } from '../lib/local-activity-switch-guard';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { STORAGE_KEY } from '../lib/constants';
import { layoutStore } from '../hooks/use-layout-store';
import { useLayoutState } from '../hooks/use-layout-state';
import { useLayoutPersistence } from '../hooks/use-layout-persistence';
import { applyOutdoorShellVenuePatch, seededPlanFromLayout, shellVenuePatchFromPlanBoundary } from '../lib/outdoor-venue-sync';
import type { RoomLayout } from '../lib/types';
vi.mock('@/lib/local-activities',async original=>({...await original<typeof import('@/lib/local-activities')>(),archiveLocalActivity:vi.fn(),listLocalActivities:vi.fn()}));
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');vi.mocked(listLocalActivities).mockResolvedValue({activities:[],unreadableProjectIds:[]});vi.mocked(archiveLocalActivity).mockImplementation(async(text)=>JSON.parse(text));});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function backup(layout:RoomLayout){const scope=layout.id!;return serializeLocalProjectBackupV3(layout,{state:'ready',scope,brief:{status:'absent'}},{state:'ready',scope,materialCheckins:{status:'absent'}},'2026-11-13T00:00:00Z');}
it.each([false,true])('real startup save guard + new-activity form: diagnostic contamination=%s preserves old activity on refusal, otherwise opens dedicated blank project',async contaminated=>{
 const initial={...structuredClone(INITIAL_LAYOUT),id:'public-original'};
 localStorage.setItem(STORAGE_KEY,JSON.stringify(initial));layoutStore.setState({layout:initial,activeFloorIndex:0});
 const createFreshActivity=vi.fn(async(candidate,guard)=>{guard?.();layoutStore.getState().actions.applyLayout(candidate.layout);});
 function Harness(){
  const state=useLayoutState();const persistence=useLayoutPersistence({layout:state.layout,onHydrate:(saved)=>layoutStore.getState().actions.applyLayout(saved),debounceMs:10000,layoutSource:layoutStore});
  const actions:LocalProjectBackupActions={prepareBackup:async()=>backup(layoutStore.getState().layout),createFreshActivity,restoreBackup:vi.fn(),undoRestore:vi.fn(),backupPending:false,canUndoRestore:false};
  return <LocalActivitySwitchGuardProvider guard={{capture:()=>persistence.flushPendingBeforeSwitch()}}><LocalActivitiesPanel mode="create" layout={state.layout} actions={actions}/></LocalActivitySwitchGuardProvider>;
 }
 render(<Harness/>);
 const base=layoutStore.getState().layout;const patch=shellVenuePatchFromPlanBoundary(base,seededPlanFromLayout(base)!.boundary)!;
 act(()=>layoutStore.getState().actions.applyLayout(contaminated?{...base,...patch}:applyOutdoorShellVenuePatch(base,patch)));
 fireEvent.change(screen.getByRole('textbox',{name:'新活动名称'}),{target:{value:'公网验收-户外讲座测试'}});
 fireEvent.submit(screen.getByRole('form',{name:'新建活动'}));
 if(contaminated){
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','当前活动保存结果无法核对，未切换；请保留草稿。');
  expect(createFreshActivity).not.toHaveBeenCalled();expect(layoutStore.getState().layout.id).toBe(initial.id);
  expect((screen.getByRole('textbox',{name:'新活动名称'}) as HTMLInputElement).value).toBe('公网验收-户外讲座测试');
 }else{
  await waitFor(()=>expect(createFreshActivity).toHaveBeenCalledOnce());
  const next=layoutStore.getState().layout;expect(next.id).not.toBe(initial.id);expect(next.name).toBe('公网验收-户外讲座测试');
  expect(next.floors.flatMap(f=>f.items)).toHaveLength(0);
  expect(archiveLocalActivity).toHaveBeenCalled();
  const archived=parseLocalProjectBackupJson(vi.mocked(archiveLocalActivity).mock.calls[0][0]);
  expect(archived.layout).toMatchObject({id:initial.id,name:initial.name,floors:initial.floors});
 }
});
