import { useEffect, useRef, type RefObject, type MutableRefObject } from 'react';
import { captureProjectReviewCanvas, ProjectReviewCaptureError, ProjectReviewChangedError, type ProjectReviewCaptureOptions } from '@/lib/project-review-workflow';
import { ensureFloorPlanImageDecoded, isFloorPlanImageReady, render2DTopDown } from '../canvas-2d/render';
import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import { presetModelUrl } from '../lib/scene-presets';
import { getGlbAssetRevision, getGlbAssetState, glbAssetKey } from '../three/glb-assets';
import type { FurnitureItem, RoomLayout, ViewSettings } from '../lib/types';
import type { ProjectReviewCapture, ProjectReviewSnapshot, ProjectReviewSource } from '@/lib/project-review';
import type { ReferenceImageLayer } from '@/lib/reference-image';
import type * as THREE from 'three';

interface Inputs {
  layout: RoomLayout; getLayout(): RoomLayout; view: ViewSettings; activeFloorIndex: number;
  ready: boolean; peopleReady: boolean; referenceImage?: ReferenceImageLayer;
  selectedItemId: string|null; extraSelectedIds: ReadonlySet<string>;
  hasCollision(item:FurnitureItem): boolean;
  canvas: RefObject<HTMLCanvasElement>; canvas2D: RefObject<HTMLCanvasElement|null>;
  scene: MutableRefObject<THREE.Scene|null>; renderer: MutableRefObject<THREE.WebGLRenderer|null>;
  camera: MutableRefObject<THREE.PerspectiveCamera|null>;
  pendingPreview: boolean; isInteracting(): boolean;
}

/** 2D shows one floor; all-floor 3D can show the ground image from upstairs. */
function visibleReferenceUrl({ layout, view, activeFloorIndex, referenceImage }: Inputs): string | undefined {
  if (view.showReferenceImage === false ||
      (activeFloorIndex !== 0 && (view.view2D || !view.showAllFloors)) ||
      (view.referenceImageOpacity ?? layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY) <= 0) return undefined;
  return referenceImage?.url ?? (!layout.backendSceneV2 ? layout.floorPlanImage : undefined);
}

/** Checks rendered resources, not just download completion or the presence of placeholder meshes. */
export function reviewSceneAssetsReady(scene: THREE.Scene, referenceUrl?:string): boolean {
  let ready=true,referenceReady=!referenceUrl;
  scene.traverse(node=>{
    for(let parent:THREE.Object3D|null=node;parent;parent=parent.parent)if(!parent.visible)return;
    if(node.userData.glbStatus&&node.userData.glbStatus!=='ready')ready=false;
    const mesh=node as THREE.Mesh;
    for(const material of mesh.material?(Array.isArray(mesh.material)?mesh.material:[mesh.material]):[]){
      for(const key of ['map','normalMap','roughnessMap','metalnessMap','alphaMap','displacementMap','emissiveMap']){
        const texture=(material as unknown as Record<string,unknown>)[key] as THREE.Texture|undefined;
        if(!texture)continue;
        const image=texture.image as {width?:number;height?:number;complete?:boolean;naturalWidth?:number}|undefined;
        if(!image||image.complete===false||!image.width||!image.height||image.naturalWidth===0)ready=false;
        else if(node.userData.type==='reference-image'&&key==='map'&&
          (image as {src?:string}).src===referenceUrl)referenceReady=true;
      }
    }
  });
  return ready&&referenceReady;
}

/** Registered after the editor's scene effects; capture never changes project or view settings. */
export function useReviewCapture(inputs:Inputs):(
  snapshot:ProjectReviewSnapshot,options:ProjectReviewCaptureOptions,getSource:()=>ProjectReviewSource,
)=>Promise<ProjectReviewCapture> {
  const latest=useRef(inputs);latest.current=inputs;
  const referenceKey=(layer:ReferenceImageLayer|undefined)=>layer?JSON.stringify([layer.url,layer.pixelWidth,layer.pixelHeight,...layer.imageToWorld]):'';
  const committed=useRef<{layout:RoomLayout;view:ViewSettings;floor:number;reference:string;assets:number;revision:number}>();
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const current=latest.current;
    if(!current.ready)return;
    committed.current={layout:current.layout,view:current.view,floor:current.activeFloorIndex,
      reference:referenceKey(current.referenceImage),assets:getGlbAssetRevision(),revision:(committed.current?.revision??0)+1};
  });
  return async(snapshot,options,getSource)=>{
    const start=latest.current;
    const view2D=start.view.view2D,floorIndex=start.activeFloorIndex;
    const valid=()=>{
      const now=latest.current,source=getSource();
      if(!mounted.current||now.getLayout()!==start.layout||now.layout!==start.layout||
        now.view!==start.view||now.activeFloorIndex!==floorIndex||
        source.scope!==snapshot.source.scope||source.revision!==snapshot.source.revision)throw new ProjectReviewChangedError();
      return now;
    };
    const getState=()=>{
      const now=valid(),frame=committed.current;
      const floors=now.view.showAllFloors&&!view2D?now.layout.floors:[now.layout.floors[floorIndex]!];
      const items=floors.flatMap(floor=>floor.items);
      const keys=items.map(glbAssetKey).filter((key):key is string=>!!key);
      if(now.layout.scenePreset)keys.push(presetModelUrl(now.layout.scenePreset));
      const modelsReady=view2D||keys.every(key=>getGlbAssetState(key).status==='ready');
      const referenceUrl=visibleReferenceUrl(now),referenceVisible=!!referenceUrl;
      const committedFrame=!!frame&&frame.layout===now.layout&&frame.view===now.view&&frame.floor===floorIndex&&
        frame.reference===referenceKey(now.referenceImage)&&frame.assets===getGlbAssetRevision();
      return {source:getSource(),canvas:view2D?now.canvas2D.current:now.canvas.current,
        frameRevision:committedFrame?String(frame.revision):'',viewLabel:`${view2D?'二维平面':'三维场景'} · ${now.layout.floors[floorIndex]?.name??'当前楼层'}`,
        ready:now.ready&&committedFrame,assetsReady:modelsReady&&(!view2D||!referenceVisible||!!referenceUrl&&isFloorPlanImageReady(referenceUrl))&&(view2D||
          !!now.scene.current&&reviewSceneAssetsReady(now.scene.current,referenceVisible&&now.referenceImage?now.referenceImage.url:undefined)&&(!items.some(item=>item.type==='person')||now.peopleReady)),
        pendingPreview:now.pendingPreview,interacting:now.isInteracting(),privateReferenceVisible:referenceVisible};
    };
    return captureProjectReviewCanvas(snapshot,{
      getState,
      waitForReady:async()=>{
        const url=visibleReferenceUrl(start);
        if(view2D&&url){
          let timeout:ReturnType<typeof setTimeout>|undefined;
          try{await Promise.race([ensureFloorPlanImageDecoded(url),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new ProjectReviewCaptureError('参考图尚未载入，请稍后重试。')),10000);})]);}
          finally{if(timeout!==undefined)clearTimeout(timeout);}
        }
        const deadline=Date.now()+10000;
        while(true){
          valid();
          // Let scheduled scene effects, image callbacks and the editor's render commit first.
          await new Promise<void>(resolve=>setTimeout(resolve,30));
          const state=getState();
          if(state.ready&&state.assetsReady)return;
          if(Date.now()>=deadline)throw new ProjectReviewCaptureError(state.ready?'画面中的模型或参考图尚未载入完成，请稍后重试。':'场景修改尚未完成绘制，请等待画面稳定后重试。');
        }
      },
      render:()=>{
        const now=valid();
        if(view2D){
          if(!now.canvas2D.current)throw new Error('平面画面尚未准备好。');
          render2DTopDown({canvas:now.canvas2D.current,layout:now.layout,floor:now.layout.floors[floorIndex]!,selectedItemId:now.selectedItemId,extraSelectedIds:now.extraSelectedIds,
            hasCollision:now.hasCollision,
            showMeasurements:now.view.showMeasurements,showWiFiSignals:now.view.showWiFiSignals,showHeatmap:now.view.showHeatmap,
            showFloorPlan:now.view.showReferenceImage!==false,...(now.referenceImage?{referenceImage:now.referenceImage}:{}),
            ...(now.view.referenceImageOpacity!==undefined?{floorPlanOpacity:now.view.referenceImageOpacity}:{})});
        }else{
          if(!now.renderer.current||!now.scene.current||!now.camera.current)throw new Error('三维画面尚未准备好。');
          now.renderer.current.render(now.scene.current,now.camera.current);
        }
      },
    },options);
  };
}
