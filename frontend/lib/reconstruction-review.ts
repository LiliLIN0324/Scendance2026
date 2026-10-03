import type { ImagePoint } from './source-storage';
import type { SceneV2 } from '../../supabase/functions/_shared/domain';
/** A wall endpoint is a shared vertex. Keep connected walls and venue perimeter aligned. */
export function updateReviewedWall(scene: SceneV2, id: string, patch: Partial<SceneV2['structure']['walls'][number]>): SceneV2 {
  const wall=scene.structure.walls.find(w=>w.id===id);
  if(!wall)return scene;
  const replacements=[...(patch.start?[{before:wall.start,after:patch.start}]:[]),...(patch.end?[{before:wall.end,after:patch.end}]:[])];
  const move=(point:ImagePoint)=>replacements.find(r=>Math.hypot(r.before.x-point.x,r.before.z-point.z)<1e-6)?.after??point;
  const walls=scene.structure.walls.map(w=>({...w,...(w.id===id?patch:{}),start:move(w.start),end:move(w.end)}));
  const polygon=(scene.venue.polygon??[{x:0,z:0},{x:scene.venue.width,z:0},{x:scene.venue.width,z:scene.venue.depth},{x:0,z:scene.venue.depth}]).map(move);
  const movedBoundary=replacements.length>0&&wall.kind==='exterior';
  return {...scene,venue:movedBoundary?{...scene.venue,shape:'polygon',polygon,width:Math.max(...polygon.map(p=>p.x)),depth:Math.max(...polygon.map(p=>p.z))}:scene.venue,structure:{...scene.structure,walls}};
}
/** Three user-confirmed image/world correspondences, including rotation and skew. */
export function imageRegistration(points:ImagePoint[],width:number,depth:number):string|null {
  if(points.length!==3||width<=0||depth<=0)return null;
  const [origin,xEnd,zEnd]=points as [ImagePoint,ImagePoint,ImagePoint];
  const a=(xEnd.x-origin.x)/width,b=(xEnd.z-origin.z)/width,c=(zEnd.x-origin.x)/depth,d=(zEnd.z-origin.z)/depth;
  if(Math.abs(a*d-b*c)<1e-8)return null;
  return `matrix(${a} ${b} ${c} ${d} ${origin.x} ${origin.z})`;
}
export function openingLine(scene:SceneV2,opening:SceneV2['structure']['openings'][number]):{x1:number;z1:number;x2:number;z2:number}|null {
  const wall=scene.structure.walls.find(w=>w.id===opening.wallId);if(!wall)return null;
  const length=Math.hypot(wall.end.x-wall.start.x,wall.end.z-wall.start.z);if(!length)return null;
  const dx=(wall.end.x-wall.start.x)/length,dz=(wall.end.z-wall.start.z)/length;
  return {x1:wall.start.x+dx*opening.offset,z1:wall.start.z+dz*opening.offset,x2:wall.start.x+dx*(opening.offset+opening.width),z2:wall.start.z+dz*(opening.offset+opening.width)};
}

/** Keep user-entered values while retaining associations discovered by recognition. */
export function mergeRecognizedDimensions(existing:SceneV2['dimensions'],recognized:SceneV2['dimensions'],fixedIds:readonly string[]=[]):SceneV2['dimensions'] {
  const merged=existing.map(d=>{
    const found=recognized.find(r=>r.id===d.id);if(!found)return d;
    return {...d,...(!d.targetId&&found.targetId?{targetId:found.targetId}:{}),...(!d.targetEndId&&found.targetEndId?{targetEndId:found.targetEndId}:{}),...(!d.measure&&found.measure?{measure:found.measure}:{})};
  });
  return [...merged,...recognized.filter(d=>!existing.some(old=>old.id===d.id)&&!fixedIds.includes(d.id))];
}
