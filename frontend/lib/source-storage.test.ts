import { describe, expect, it, vi } from 'vitest';
import { containedImagePoint, parseDimensionText, suggestSourceKind, registerSourceEditor, withSourceRestoreLock } from './source-storage';
describe('source measurements',()=>{
  it('maps contained-image clicks and rejects horizontal/vertical letterboxing',()=>{
    const rect={left:100,top:50,width:300,height:200};
    expect(containedImagePoint(100,60,rect,1200,600)).toBeNull();
    expect(containedImagePoint(250,150,rect,1200,600)).toEqual({x:600,z:300});
    expect(containedImagePoint(110,150,rect,600,1200)).toBeNull();
    expect(containedImagePoint(250,150,rect,600,1200)).toEqual({x:300,z:600});
    expect(containedImagePoint(1,1,{...rect,width:0},100,100)).toBeNull();
  });
  it('normalizes explicit metric units without treating photo pixels as meters',()=>{
    expect(parseDimensionText('总宽 12 米；北墙 800 厘米，入口 1200mm')).toEqual([
      {label:'总宽',kind:'width',valueMeters:12},{label:'北墙',kind:'wall',valueMeters:8},{label:'入口',kind:'distance',valueMeters:1.2}
    ]);
    expect(parseDimensionText('北墙很长；0米')).toEqual([]);
  });
  it('only suggests source types, favoring photo when no floorplan evidence exists',()=>{
    expect(suggestSourceKind('手绘平面图.png')).toBe('floorplan');
    expect(suggestSourceKind('venue.jpg')).toBe('photo');
    const inkAndPaper=new Uint8ClampedArray(4000).fill(255);inkAndPaper.fill(0,0,40);
    expect(suggestSourceKind('scan.png',inkAndPaper)).toBe('floorplan');
  });
});

describe('native source editor restore protection',()=>{
  it('cancelling a pending shared lease rejects readiness and cannot authorize a late write',async()=>{
    vi.stubGlobal('navigator',{locks:{request:(_name:string,options:LockOptions)=>new Promise((_resolve,reject)=>{options.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});})}});
    const editor=registerSourceEditor('pending');let wrote=false;
    const queued=editor.ready.then(()=>{wrote=true;});void queued.catch(()=>{});
    await editor.release();await expect(queued).rejects.toThrow('取消');expect(wrote).toBe(false);expect(editor.acquired).toBe(false);
    vi.unstubAllGlobals();
  });
  it('rejects unsupported browsers, live editors, and a lock held by another page',async()=>{
    vi.stubGlobal('navigator',{});
    await expect(withSourceRestoreLock(['one'],async()=>1)).rejects.toThrow('Web Locks');
    const request=vi.fn(async(_name:string,options:LockOptions,callback:(lock:Lock|null)=>unknown)=>callback(options.mode==='shared'?{} as Lock:null));
    vi.stubGlobal('navigator',{locks:{request}});
    const editor=registerSourceEditor('one');
    await expect(withSourceRestoreLock(['one'],async()=>1)).rejects.toThrow('另一编辑页面');
    await editor.release();
    await expect(withSourceRestoreLock(['one'],async()=>1)).rejects.toThrow('另一编辑页面');
    expect(request).toHaveBeenCalledWith('scendance:source-editor:one',expect.objectContaining({mode:'exclusive',ifAvailable:true}),expect.any(Function));
    vi.unstubAllGlobals();
  });
  it('locks unique scopes in a stable order and releases them after callback failure',async()=>{
    const names:string[]=[];let released=0;
    vi.stubGlobal('navigator',{locks:{request:async(name:string,_options:LockOptions,callback:(lock:Lock|null)=>unknown)=>{names.push(name);try{return await callback({} as Lock);}finally{released++;}}}});
    await expect(withSourceRestoreLock(['b','a','b'],async()=>{throw new Error('restore refused');})).rejects.toThrow('restore refused');
    expect(names).toEqual(['scendance:source-editor:a','scendance:source-editor:b']);expect(released).toBe(2);
    vi.unstubAllGlobals();
  });
});
