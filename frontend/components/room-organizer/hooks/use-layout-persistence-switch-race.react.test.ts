// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {makeLayout} from '../lib/__testfixtures__/fixtures';
import {STORAGE_KEY} from '../lib/constants';
import * as persistence from '../lib/persistence';
import {useLayoutPersistence} from './use-layout-persistence';
import {useLayoutState} from './use-layout-state';
import {layoutStore} from './use-layout-store';
import type {RoomLayout} from '../lib/types';

describe('activity transition and pending autosave observation',()=>{
 beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');vi.useFakeTimers();});
 afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
 it('does not write the previous activity after a synchronous store switch and retains its draft',()=>{
  const a=makeLayout({id:'race-a',name:'Activity A'}),b=makeLayout({id:'race-b',name:'Activity B'});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(a));layoutStore.setState({layout:a,activeFloorIndex:0});
  const onHydrate=(saved:RoomLayout)=>layoutStore.getState().actions.applyLayout(saved);
  const hook=renderHook(()=>{const state=useLayoutState();return {...state,persistence:useLayoutPersistence({layout:state.layout,onHydrate,debounceMs:100,layoutSource:layoutStore})};});
  act(()=>hook.result.current.actions.setWidth(a.width+1));
  const write=vi.spyOn(Storage.prototype,'setItem');
  let idDuringTransition:string|null=null;
  act(()=>{
   layoutStore.setState({layout:b,activeFloorIndex:0});
   vi.advanceTimersByTime(100);
   const raw=localStorage.getItem(STORAGE_KEY);idDuringTransition=raw?JSON.parse(raw).id:null;
  });
  const writes=write.mock.calls.filter(([key])=>key===STORAGE_KEY).map(([,value])=>JSON.parse(String(value)).id);
  expect(layoutStore.getState().layout.id).toBe('race-b');
  expect(writes).toEqual([]);expect(idDuringTransition).toBe('race-a');
  expect(hook.result.current.persistence.interruptedDrafts).toEqual([expect.objectContaining({scope:'race-a',name:'Activity A'})]);
  const download=vi.spyOn(persistence,'downloadRawLayout').mockImplementation(()=>{});
  hook.result.current.persistence.downloadInterruptedDraft(hook.result.current.persistence.interruptedDrafts[0]!.key);
  expect(JSON.parse(download.mock.calls[0]![0])).toMatchObject({id:'race-a',width:a.width+1});
 });
 it('does not flush an obsolete layout on pagehide before React handles the switch',()=>{
  const a=makeLayout({id:'race-a',name:'Activity A'}),b=makeLayout({id:'race-b',name:'Activity B'});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(a));layoutStore.setState({layout:a,activeFloorIndex:0});
  const onHydrate=(saved:RoomLayout)=>layoutStore.getState().actions.applyLayout(saved);
  const hook=renderHook(()=>{const state=useLayoutState();return {...state,persistence:useLayoutPersistence({layout:state.layout,onHydrate,debounceMs:100,layoutSource:layoutStore})};});
  act(()=>hook.result.current.actions.setWidth(a.width+1));const write=vi.spyOn(Storage.prototype,'setItem');
  act(()=>{layoutStore.setState({layout:b,activeFloorIndex:0});window.dispatchEvent(new Event('pagehide'));});
  expect(write.mock.calls.filter(([key])=>key===STORAGE_KEY)).toHaveLength(0);
  expect(hook.result.current.persistence.interruptedDrafts[0]?.scope).toBe('race-a');
 });
 it('fences an A → B → A switch even when the same A object is restored before React commits',()=>{
  const a=makeLayout({id:'race-a',name:'Activity A'}),b=makeLayout({id:'race-b',name:'Activity B'});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(a));layoutStore.setState({layout:a,activeFloorIndex:0});
  const onHydrate=(saved:RoomLayout)=>layoutStore.getState().actions.applyLayout(saved);
  const hook=renderHook(()=>{const state=useLayoutState();return {...state,persistence:useLayoutPersistence({layout:state.layout,onHydrate,debounceMs:100,layoutSource:layoutStore})};});
  act(()=>hook.result.current.actions.setWidth(a.width+1));const edited=layoutStore.getState().layout;
  const write=vi.spyOn(Storage.prototype,'setItem');
  act(()=>{layoutStore.setState({layout:b,activeFloorIndex:0});layoutStore.setState({layout:edited,activeFloorIndex:0});vi.advanceTimersByTime(100);});
  expect(write.mock.calls.filter(([key])=>key===STORAGE_KEY)).toHaveLength(0);
  expect(hook.result.current.persistence.interruptedDrafts.some(draft=>draft.scope==='race-a')).toBe(true);
 });
 it('flushes and reads back outgoing edits before a normal switch',()=>{
  const a=makeLayout({id:'race-a',name:'Activity A'}),b=makeLayout({id:'race-b',name:'Activity B'});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(a));layoutStore.setState({layout:a,activeFloorIndex:0});
  const onHydrate=(saved:RoomLayout)=>layoutStore.getState().actions.applyLayout(saved);
  const hook=renderHook(()=>{const state=useLayoutState();return {...state,persistence:useLayoutPersistence({layout:state.layout,onHydrate,debounceMs:100,layoutSource:layoutStore})};});
  act(()=>hook.result.current.actions.setWidth(a.width+1));
  act(()=>{hook.result.current.persistence.flushPendingBeforeSwitch();layoutStore.setState({layout:b,activeFloorIndex:0});});
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)!);expect(saved.id).toBe('race-a');expect(saved.width).toBe(a.width+1);
  expect(hook.result.current.persistence.interruptedDrafts).toEqual([]);
 });
 it('invalidates a flushed switch fence after a synchronous A → B → A',()=>{
  const a=makeLayout({id:'race-a',name:'Activity A'}),b=makeLayout({id:'race-b',name:'Activity B'});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(a));layoutStore.setState({layout:a,activeFloorIndex:0});
  const onHydrate=(saved:RoomLayout)=>layoutStore.getState().actions.applyLayout(saved);
  const hook=renderHook(()=>{const state=useLayoutState();return {...state,persistence:useLayoutPersistence({layout:state.layout,onHydrate,debounceMs:100,layoutSource:layoutStore})};});
  const original=layoutStore.getState().layout;let check!:()=>void;
  act(()=>{check=hook.result.current.persistence.flushPendingBeforeSwitch(original);layoutStore.setState({layout:b});layoutStore.setState({layout:original});});
  expect(()=>check()).toThrow('活动已变化');
 });
 it('does not switch or lose the live draft when saving before switch fails',()=>{
  const a=makeLayout({id:'race-a',name:'Activity A'}),b=makeLayout({id:'race-b',name:'Activity B'});
  localStorage.setItem(STORAGE_KEY,JSON.stringify(a));layoutStore.setState({layout:a,activeFloorIndex:0});
  const onHydrate=(saved:RoomLayout)=>layoutStore.getState().actions.applyLayout(saved);
  const hook=renderHook(()=>{const state=useLayoutState();return {...state,persistence:useLayoutPersistence({layout:state.layout,onHydrate,debounceMs:100,layoutSource:layoutStore})};});
  act(()=>hook.result.current.actions.setWidth(a.width+1));
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
  act(()=>expect(()=>{hook.result.current.persistence.flushPendingBeforeSwitch();layoutStore.setState({layout:b,activeFloorIndex:0});}).toThrow('未保存'));
  expect(layoutStore.getState().layout.id).toBe('race-a');expect(layoutStore.getState().layout.width).toBe(a.width+1);
  expect(hook.result.current.persistence.saveError).not.toBeNull();
 });
});
