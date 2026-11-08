// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {groundFromHeight,SITE_CALIBRATION_STORAGE_KEY} from '../lib/site-capture';
const mock=vi.hoisted(()=>({apply:vi.fn(),hud:vi.fn(),start:vi.fn(async()=>({splats:1,meters:{width:10,depth:8,height:3}}))}));
vi.mock('../three/splat-preview',()=>({paintSplatLayers:vi.fn(),createSplatPreview:()=>({shownId:'already',start:mock.start,applyCalibration:mock.apply,dispose:vi.fn(),setPosition:vi.fn(),setRoofCutoff:vi.fn(),setVisible:vi.fn(),setDisplayMode:vi.fn()})}));
vi.mock('../three/calibration-hud',()=>({createCalibrationHud:mock.hud}));
import {useSplatPreview} from './use-splat-preview';
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();mock.apply.mockReset();mock.hud.mockReset();mock.start.mockClear();vi.unstubAllGlobals();});
it('blocks all calibration writes and stays read-only after the flag disappears',async()=>{
 const locks={request(_n:string,_o:unknown,cb:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>cb({}));}} as unknown as LockManager;vi.stubGlobal('navigator',{locks});
 const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const host=document.createElement('div'),canvas=document.createElement('canvas');host.appendChild(canvas);
 const rendererRef={current:{domElement:canvas} as never},cameraRef={current:{} as never},controlsRef={current:{} as never};
 const base={isReady:true,rendererRef,cameraRef,controlsRef,invalidate:vi.fn(),requestShadowUpdate:vi.fn(),sizeMeters:12,roofCutoffY:3,
  position:{x:0,y:0,z:0},transformMode:'off' as const,onPositionChange:vi.fn(),calibrationCapability:lease.capability};
 const hook=renderHook(({readOnly})=>useSplatPreview({...base,calibrationReadOnly:readOnly}),{initialProps:{readOnly:true}});
 await act(async()=>{await hook.result.current.start({assetId:'a',name:'场地'} as never);});
 expect(hook.result.current.state.status).toBe('ready');
 act(()=>{hook.result.current.setYaw(90);hook.result.current.setOrigin({x:1,z:1});hook.result.current.setGround(groundFromHeight(1));});
 expect(hook.result.current.addAnchor({x:1,z:1})).toBeNull();expect(hook.result.current.calibrate({axis:'x',knownMeters:12})).toBeNull();
 expect(localStorage.getItem(SITE_CALIBRATION_STORAGE_KEY)).toBeNull();expect(mock.apply).not.toHaveBeenCalled();expect(mock.hud).not.toHaveBeenCalled();
 hook.rerender({readOnly:false});act(()=>hook.result.current.setYaw(180));
 expect(localStorage.getItem(SITE_CALIBRATION_STORAGE_KEY)).toBeNull();expect(mock.apply).not.toHaveBeenCalled();await lease.release();
});

it('does not load a scan when stored calibration cannot be verified',async()=>{
 const locks={request(_n:string,_o:unknown,cb:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>cb({}));}} as unknown as LockManager;vi.stubGlobal('navigator',{locks});
 const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 localStorage.setItem(SITE_CALIBRATION_STORAGE_KEY,'corrupt');
 const host=document.createElement('div'),canvas=document.createElement('canvas');host.appendChild(canvas);
 const base={isReady:true,rendererRef:{current:{domElement:canvas} as never},cameraRef:{current:{} as never},controlsRef:{current:{} as never},
  invalidate:vi.fn(),requestShadowUpdate:vi.fn(),sizeMeters:12,roofCutoffY:3,position:{x:0,y:0,z:0},transformMode:'off' as const,onPositionChange:vi.fn(),calibrationReadOnly:true,calibrationCapability:lease.capability};
 const hook=renderHook(()=>useSplatPreview(base));
 await act(async()=>{await hook.result.current.start({assetId:'a',name:'场地'} as never);});
 expect(hook.result.current.state.status).toBe('error');expect(mock.start).not.toHaveBeenCalled();
 expect(localStorage.getItem(SITE_CALIBRATION_STORAGE_KEY)).toBe('corrupt');await lease.release();
});
