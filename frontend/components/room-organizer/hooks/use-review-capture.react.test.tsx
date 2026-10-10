// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { startTransition, Suspense, useState } from 'react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectReviewSnapshot } from '@/lib/project-review';
import { ensureFloorPlanImageDecoded, render2DTopDown } from '../canvas-2d/render';
import { makeFloor, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { reviewSceneAssetsReady, useReviewCapture } from './use-review-capture';

vi.mock('../canvas-2d/render',()=>({render2DTopDown:vi.fn(),ensureFloorPlanImageDecoded:vi.fn(async()=>{}),isFloorPlanImageReady:()=>true}));
vi.mock('../three/glb-assets',()=>({getGlbAssetRevision:()=>1,getGlbAssetState:()=>({status:'ready'}),glbAssetKey:(item:{assetId?:string;glbUrl?:string})=>item.assetId??item.glbUrl}));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII=';
function fixture(){
  const layout=makeLayout({id:'review-capture',roof:{style:'none'}}),view=makeViewSettings({view2D:true});
  const canvas=document.createElement('canvas');canvas.toDataURL=vi.fn(()=>png);
  const source={scope:layout.id!,revision:'epoch:1'};
  const snapshot=createProjectReviewSnapshot({layout,source,briefSnapshot:{state:'ready',scope:source.scope,brief:{status:'absent'}},
    snapshot:{id:'capture-1',generatedAt:'2026-10-08T00:00:00Z'},dataState:'unsaved-draft',dataKind:'unspecified',disclosure:{brief:false,design:false}});
  const inputs:Parameters<typeof useReviewCapture>[0]={layout,getLayout:()=>layout,view,activeFloorIndex:0,
    ready:true,peopleReady:true,selectedItemId:null,extraSelectedIds:new Set(),hasCollision:()=>false,
    canvas:{current:canvas},canvas2D:{current:canvas},scene:{current:new THREE.Scene()},renderer:{current:null},camera:{current:null},
    pendingPreview:false,isInteracting:()=>false};
  return {inputs,source,snapshot,canvas};
}
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('editor review capture binding',()=>{
  it.each(['legacy','registered'] as const)('requires permission for a ground-floor %s reference in upstairs all-floor 3D',async kind=>{
    const f=fixture();
    f.inputs.layout.floors.push(makeFloor({id:'upper',name:'上层'}));
    f.inputs.activeFloorIndex=1;f.inputs.view=makeViewSettings({view2D:false,showAllFloors:true});
    if(kind==='legacy')f.inputs.layout.floorPlanImage=png;
    else f.inputs.referenceImage={url:'blob:current',pixelWidth:10,pixelHeight:10,imageToWorld:[1,0,0,1,0,0]};
    f.inputs.renderer.current={render:vi.fn()} as unknown as THREE.WebGLRenderer;
    f.inputs.camera.current=new THREE.PerspectiveCamera();
    const {result}=renderHook(()=>useReviewCapture(f.inputs));
    await expect(result.current(f.snapshot,{includeReference:false},()=>f.source)).rejects.toThrow('参考图');
    expect(f.canvas.toDataURL).not.toHaveBeenCalled();
  });
  it.each(['upper-2d','upper-only-3d','hidden','transparent'] as const)('does not request or decode a reference absent from the %s capture',async mode=>{
    const f=fixture();f.inputs.layout.floorPlanImage=png;
    f.inputs.layout.floors.push(makeFloor({id:'upper',name:'上层'}));
    f.inputs.activeFloorIndex=mode==='hidden'||mode==='transparent'?0:1;
    f.inputs.view=makeViewSettings({view2D:mode!=='upper-only-3d',showAllFloors:mode!=='upper-only-3d',
      ...(mode==='hidden'?{showReferenceImage:false}:{}),...(mode==='transparent'?{referenceImageOpacity:0}:{})});
    f.inputs.renderer.current={render:vi.fn()} as unknown as THREE.WebGLRenderer;
    f.inputs.camera.current=new THREE.PerspectiveCamera();
    const {result}=renderHook(()=>useReviewCapture(f.inputs));
    const capture=await result.current(f.snapshot,{includeReference:false},()=>f.source);
    expect(capture.caption).not.toContain('含已允许公开');
    expect(ensureFloorPlanImageDecoded).not.toHaveBeenCalled();
    expect(f.canvas.toDataURL).toHaveBeenCalledOnce();
  });
  it('waits for and labels an approved registered ground reference in all-floor 3D',async()=>{
    const f=fixture();f.inputs.layout.floors.push(makeFloor({id:'upper',name:'上层'}));
    f.inputs.activeFloorIndex=1;f.inputs.view=makeViewSettings({view2D:false,showAllFloors:true});
    f.inputs.referenceImage={url:'blob:current',pixelWidth:10,pixelHeight:10,imageToWorld:[1,0,0,1,0,0]};
    f.inputs.renderer.current={render:vi.fn()} as unknown as THREE.WebGLRenderer;
    f.inputs.camera.current=new THREE.PerspectiveCamera();
    const {result}=renderHook(()=>useReviewCapture(f.inputs));
    const pending=result.current(f.snapshot,{includeReference:true},()=>f.source);
    await new Promise(resolve=>setTimeout(resolve,40));
    expect(f.canvas.toDataURL).not.toHaveBeenCalled();
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({map:new THREE.Texture({width:10,height:10,src:'blob:current'})}));
    mesh.userData.type='reference-image';f.inputs.scene.current!.add(mesh);
    expect((await pending).caption).toContain('含已允许公开的参考底图');
    expect(f.canvas.toDataURL).toHaveBeenCalledOnce();
  });
  it('renders the committed 2D layout and encodes it before yielding',async()=>{
    const f=fixture(),{result}=renderHook(()=>useReviewCapture(f.inputs));
    const captured=await result.current(f.snapshot,{includeReference:false},()=>f.source);
    expect(captured.dataUrl).toBe(png);expect(captured.sourceLabel).toContain('二维平面');
    expect(render2DTopDown).toHaveBeenCalledWith(expect.objectContaining({canvas:f.canvas,layout:f.inputs.layout}));
    expect(vi.mocked(render2DTopDown).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.canvas.toDataURL).mock.invocationCallOrder[0]!);
  });
  it.each(['pendingPreview','dragging'] as const)('does not encode a %s frame',async kind=>{
    const f=fixture();f.inputs.pendingPreview=kind==='pendingPreview';f.inputs.isInteracting=()=>kind==='dragging';
    const {result}=renderHook(()=>useReviewCapture(f.inputs));
    await expect(result.current(f.snapshot,{includeReference:false},()=>f.source)).rejects.toThrow();
    expect(f.canvas.toDataURL).not.toHaveBeenCalled();
  });
  it('rejects changed layout or view while waiting for a committed frame',async()=>{
    const f=fixture();let current=f.inputs.layout;
    f.inputs.getLayout=()=>current;
    const {result}=renderHook(()=>useReviewCapture(f.inputs));
    const pending=result.current(f.snapshot,{includeReference:false},()=>f.source);
    current={...current,width:current.width+1};
    await expect(pending).rejects.toThrow('内容已变化');expect(f.canvas.toDataURL).not.toHaveBeenCalled();
  });
  it('rejects a view switch without expiring the caller content source',async()=>{
    const f=fixture();
    const {result,rerender}=renderHook(({inputs})=>useReviewCapture(inputs),{initialProps:{inputs:f.inputs}});
    const pending=result.current(f.snapshot,{includeReference:false},()=>f.source);
    rerender({inputs:{...f.inputs,view:{...f.inputs.view,showMeasurements:false}}});
    await expect(pending).rejects.toThrow('内容已变化');expect(f.canvas.toDataURL).not.toHaveBeenCalled();
  });
  it('requires explicit reference permission and preserves the source image in the allowed frame',async()=>{
    const f=fixture();f.inputs.layout.floorPlanImage=png;
    const {result}=renderHook(()=>useReviewCapture(f.inputs));
    await expect(result.current(f.snapshot,{includeReference:false},()=>f.source)).rejects.toThrow('参考图');
    await result.current(f.snapshot,{includeReference:true},()=>f.source);
    expect(render2DTopDown).toHaveBeenCalledWith(expect.objectContaining({showFloorPlan:true}));
  });
  it('does not finish capture after unmount',async()=>{
    const f=fixture(),{result,unmount}=renderHook(()=>useReviewCapture(f.inputs));
    const pending=result.current(f.snapshot,{includeReference:false},()=>f.source);
    act(()=>unmount());await expect(pending).rejects.toThrow('内容已变化');expect(f.canvas.toDataURL).not.toHaveBeenCalled();
  });
  it('treats rendered placeholders and unfinished textures as not ready',()=>{
    const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());scene.add(mesh);
    expect(reviewSceneAssetsReady(scene)).toBe(true);
    mesh.userData.glbStatus='loading';expect(reviewSceneAssetsReady(scene)).toBe(false);
    mesh.userData.glbStatus='ready';mesh.material.map=new THREE.Texture();expect(reviewSceneAssetsReady(scene)).toBe(false);
    mesh.material.map.image={width:10,height:10};expect(reviewSceneAssetsReady(scene)).toBe(true);
    mesh.material.map.image=undefined;const hidden=new THREE.Group();hidden.visible=false;scene.add(hidden);hidden.add(mesh);
    expect(reviewSceneAssetsReady(scene)).toBe(true);
  });
  it('waits for the expected reference mesh, not an empty scene or an earlier image',()=>{
    const scene=new THREE.Scene();expect(reviewSceneAssetsReady(scene,'blob:current')).toBe(false);
    const texture=new THREE.Texture({width:10,height:10,src:'blob:previous'});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({map:texture}));
    mesh.userData.type='reference-image';scene.add(mesh);
    expect(reviewSceneAssetsReady(scene,'blob:current')).toBe(false);
    texture.image={width:10,height:10,src:'blob:current'};expect(reviewSceneAssetsReady(scene,'blob:current')).toBe(true);
    mesh.visible=false;expect(reviewSceneAssetsReady(scene,'blob:current')).toBe(false);
  });
  it('captures the first 3D reference frame only after its asynchronous mesh arrives, without switching views',async()=>{
    const f=fixture();f.inputs.view=makeViewSettings({view2D:false});
    f.inputs.referenceImage={url:'blob:current',pixelWidth:10,pixelHeight:10,imageToWorld:[1,0,0,1,0,0]};
    const render=vi.fn();f.inputs.renderer.current={render} as unknown as THREE.WebGLRenderer;
    f.inputs.camera.current=new THREE.PerspectiveCamera();
    const {result}=renderHook(()=>useReviewCapture(f.inputs));
    const pending=result.current(f.snapshot,{includeReference:true},()=>f.source);
    await new Promise(resolve=>setTimeout(resolve,40));
    expect(f.canvas.toDataURL).not.toHaveBeenCalled();
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({map:new THREE.Texture({width:10,height:10,src:'blob:current'})}));
    mesh.userData.type='reference-image';f.inputs.scene.current!.add(mesh);
    const captured=await pending;expect(captured.dataUrl).toBe(png);expect(render).toHaveBeenCalledOnce();
    expect(render2DTopDown).not.toHaveBeenCalled();
  });
  it.each([false,true])('checks reference content after an uncommitted render (changed=%s)',async changed=>{
    const f=fixture();f.inputs.referenceImage={url:'blob:current',pixelWidth:10,pixelHeight:10,imageToWorld:[1,0,0,1,0,0]};
    let capture!:ReturnType<typeof useReviewCapture>,suspend!:(value:boolean)=>void;
    const pendingRender=new Promise<void>(()=>{});
    function Trial(){
      const [waiting,setWaiting]=useState(false);suspend=setWaiting;
      capture=useReviewCapture({...f.inputs,referenceImage:{...f.inputs.referenceImage!,...(waiting&&changed?{imageToWorld:[2,0,0,1,0,0] as [number,number,number,number,number,number]}:{})}});
      if(waiting)throw pendingRender;
      return null;
    }
    render(<Suspense fallback={null}><Trial/></Suspense>);
    await act(async()=>{startTransition(()=>suspend(true));});
    const operation=capture(f.snapshot,{includeReference:true},()=>f.source).catch(()=>null);
    const result=await Promise.race([operation,new Promise<null>(resolve=>setTimeout(()=>resolve(null),200))]);
    if(changed){expect(result).toBeNull();expect(f.canvas.toDataURL).not.toHaveBeenCalled();}
    else expect(result?.dataUrl).toBe(png);
  });
});
