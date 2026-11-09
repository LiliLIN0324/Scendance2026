// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalWriteLeaseManager } from '@/lib/local-write-lease';
import { copySourceScope, deleteSource, deleteSourceForm, flushSourceScope, storeSource, storeSourceForm, updateSourceForm } from '@/lib/source-storage';
import { makeLayout } from './__testfixtures__/fixtures';
import { STORAGE_KEY } from './constants';
import { useLayoutState } from '../hooks/use-layout-state';
import { useLayoutPersistence } from '../hooks/use-layout-persistence';
import { layoutStore } from '../hooks/use-layout-store';
import { useWorkspaceWriteGuards } from './workspace-write-guards';
import { applyGuardedWorkspaceReplacement } from './workspace-write-guards';
import * as restorePoint from './restore-point';

afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

describe('optional workspace lease composition',()=>{
  it('does not alter legacy callers that did not supply a capability',()=>{
    const hook=renderHook(()=>useWorkspaceWriteGuards());expect(hook.result.current).toBeNull();
  });
  it('never falls back to legacy writes after the injected capability disappears or changes',async()=>{
    const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
    const previous=Object.getOwnPropertyDescriptor(navigator,'locks');Object.defineProperty(navigator,'locks',{configurable:true,value:locks});
    const manager=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage});
    const first=await manager.acquire(),second=await manager.acquire();
    try {
      const hook=renderHook(({capability})=>useWorkspaceWriteGuards(capability),{initialProps:{capability:first.capability as typeof first.capability|undefined}});
      const guards=hook.result.current!;guards.assertLayoutWrite();expect(guards.source.signal.aborted).toBe(false);
      hook.rerender({capability:undefined});
      expect(hook.result.current).toBe(guards);expect(guards.source.signal.aborted).toBe(true);
      expect(()=>guards.assertLayoutWrite()).toThrow('保存已暂停');
      hook.rerender({capability:second.capability});expect(()=>hook.result.current!.assertLayoutWrite()).toThrow('保存已暂停');
    } finally {await first.release();await second.release();if(previous)Object.defineProperty(navigator,'locks',previous);else Reflect.deleteProperty(navigator,'locks');}
  });
  it('checks replacement before the snapshot and again before changing the canvas',()=>{
    const apply=vi.fn(),original=makeLayout();let held=true;
    const guard=()=>{if(!held)throw new Error('失锁');};
    vi.spyOn(restorePoint,'snapshotBeforeReplace').mockImplementation((_layout,assertWrite)=>{assertWrite?.();held=false;return true;});
    expect(()=>applyGuardedWorkspaceReplacement(original,guard,apply)).toThrow('失锁');expect(apply).not.toHaveBeenCalled();
    expect(()=>applyGuardedWorkspaceReplacement(original,guard,apply)).toThrow('失锁');expect(apply).not.toHaveBeenCalled();
  });
  it('does not resume layout or source writes when capability prop disappears',async()=>{
    vi.useFakeTimers();const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
    const previous=Object.getOwnPropertyDescriptor(navigator,'locks');Object.defineProperty(navigator,'locks',{configurable:true,value:locks});
    const original=makeLayout({id:'latched',width:8});localStorage.setItem(STORAGE_KEY,JSON.stringify(original));layoutStore.setState({layout:original,activeFloorIndex:0});
    const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
    let guards!:NonNullable<ReturnType<typeof useWorkspaceWriteGuards>>;
    function Editor({capability}:{capability?:typeof lease.capability|undefined}){
      guards=useWorkspaceWriteGuards(capability)!;const editor=useLayoutState();const [draft,setDraft]=useState('');
      useLayoutPersistence({layout:editor.layout,onHydrate:editor.actions.applyLayout,debounceMs:100,assertWriteLease:guards.assertLayoutWrite});
      return <><input aria-label="未保存需求" value={draft} onChange={event=>setDraft(event.target.value)}/><button onClick={()=>editor.actions.setWidth(9)}>修改场地</button></>;
    }
    try{
      const view=render(<Editor capability={lease.capability}/>);fireEvent.change(screen.getByLabelText('未保存需求'),{target:{value:'未保存草稿'}});fireEvent.click(screen.getByRole('button',{name:'修改场地'}));
      view.rerender(<Editor/>);expect(guards.source.signal.aborted).toBe(true);
      await expect(storeSourceForm('latched:brief',{value:'新需求'},guards.source)).rejects.toThrow('保存已暂停');
      act(()=>vi.advanceTimersByTime(100));expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).width).toBe(8);
      expect((screen.getByLabelText('未保存需求') as HTMLInputElement).value).toBe('未保存草稿');
    } finally {await lease.release();if(previous)Object.defineProperty(navigator,'locks',previous);else Reflect.deleteProperty(navigator,'locks');}
  });
  it('keeps the live draft and blocks queued layout and source writes after the shared lease ends',async()=>{
    vi.useFakeTimers();
    const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
    const previous=Object.getOwnPropertyDescriptor(navigator,'locks');Object.defineProperty(navigator,'locks',{configurable:true,value:locks});
    const original=makeLayout({id:'composed-activity',name:'原活动',width:8});
    localStorage.setItem(STORAGE_KEY,JSON.stringify(original));layoutStore.setState({layout:original,activeFloorIndex:0});
    const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
    let guards!:NonNullable<ReturnType<typeof useWorkspaceWriteGuards>>;
    function Editor(){
      guards=useWorkspaceWriteGuards(lease.capability)!;
      const editor=useLayoutState();
      useLayoutPersistence({layout:editor.layout,onHydrate:editor.actions.applyLayout,debounceMs:100,assertWriteLease:guards.assertLayoutWrite});
      const [draft,setDraft]=useState('');
      return <><input aria-label="未保存需求" value={draft} onChange={event=>setDraft(event.target.value)}/><button onClick={()=>editor.actions.setWidth(9)}>修改场地</button></>;
    }
    let completeOpen!:()=>void, signalOpen!:()=>void;const transaction=vi.fn(),close=vi.fn();
    const opened=new Promise<void>(resolve=>{signalOpen=resolve;});
    vi.stubGlobal('indexedDB',{open(){const request={result:{transaction,close},onsuccess:undefined as undefined|(()=>void)};completeOpen=()=>request.onsuccess?.();signalOpen();return request;}});
    try {
      render(<Editor/>);fireEvent.change(screen.getByLabelText('未保存需求'),{target:{value:'保留的草稿'}});fireEvent.click(screen.getByRole('button',{name:'修改场地'}));
      const pending=storeSourceForm('composed-activity:brief',{description:'保留的草稿'},guards.source);
      const rejected=expect(pending).rejects.toThrow('失效');
      await opened;
      await act(async()=>{await lease.release();});completeOpen();await rejected;
      act(()=>vi.advanceTimersByTime(100));
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).width).toBe(8);
      expect((screen.getByLabelText('未保存需求') as HTMLInputElement).value).toBe('保留的草稿');
      expect(transaction).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
      const source={id:'photo',scope:'composed-activity',name:'图纸',kind:'floorplan' as const,width:1,height:1,blob:new Blob(['x'])};
      await expect(storeSource(source,guards.source)).rejects.toThrow('失效');
      await expect(deleteSource('photo',guards.source)).rejects.toThrow('失效');
      await expect(deleteSourceForm('composed-activity',guards.source)).rejects.toThrow('失效');
      await expect(updateSourceForm('composed-activity',()=>({}),guards.source)).rejects.toThrow('失效');
      await expect(flushSourceScope('composed-activity',guards.source)).rejects.toThrow('失效');
      await expect(copySourceScope('composed-activity','other',guards.source)).rejects.toThrow('失效');
      expect(transaction).not.toHaveBeenCalled();
    } finally { await lease.release(); if(previous)Object.defineProperty(navigator,'locks',previous);else Reflect.deleteProperty(navigator,'locks'); }
  });
});
