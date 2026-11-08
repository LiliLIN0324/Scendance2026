import { z } from 'zod';
import { ApiError, objectSchema, sceneSchema, sizeSchema, uuid, type Point, type Scene, type SceneObject } from './domain.ts';
import { confirmedDoorwayObstructions, footprint, footprintsIntersect, structuralViolations } from './structural-geometry.ts';

/** All sizes and gaps must be supplied and reported; none is a code-compliance claim. */
export const deskChairLayoutSchema=z.strictObject({
  layout:z.literal('one_desk_one_chair'),
  count:z.number().int().min(1).max(100),
  deskSize:sizeSchema,chairSize:sizeSchema,
  deskChairGap:z.number().min(0.01).max(5),
  columnGap:z.number().min(0).max(10),rowGap:z.number().min(0).max(10),
  edgeClearance:z.number().min(0).max(10),
  region:z.strictObject({x1:z.number().min(0).max(200),z1:z.number().min(0).max(200),x2:z.number().min(0).max(200),z2:z.number().min(0).max(200)}).optional(),
});
export type DeskChairLayoutInput=z.infer<typeof deskChairLayoutSchema>;
export type DeskChairLayoutResult={
  scene:Scene;requested:number;placed:number;shortfall:number;
  assumptions:DeskChairLayoutInput;
  unknown:string[];
  limitReason:'object_limit'|'no_placement'|'scan_limit'|'preset_unverified'|null;
};

const ordinaryObjectLimit=50;
const maximumProbes=5000;
const epsilon=1e-6;
const unknown=['出口位置与用途','门扇开启范围','连续通行及疏散','消防规范','无障碍要求','场地核定人数','实际家具规格和库存','与已有物件的额外净距及现场固定障碍'];

function distanceToSegment(point:Point,a:Point,b:Point):number {
  const dx=b.x-a.x,dz=b.z-a.z,denominator=dx*dx+dz*dz;
  const t=denominator?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/denominator)):0;
  return Math.hypot(point.x-a.x-t*dx,point.z-a.z-t*dz);
}
function polygonFor(scene:Scene):Point[] {
  return scene.venue.polygon??[{x:0,z:0},{x:scene.venue.width,z:0},{x:scene.venue.width,z:scene.venue.depth},{x:0,z:scene.venue.depth}];
}
function clearFromBoundary(object:SceneObject,polygon:Point[],clearance:number):boolean {
  if(clearance<=0)return true;
  const shape=footprint(object);
  return shape.every((p,index)=>{
    const q=shape[(index+1)%shape.length]!;
    return polygon.every((a,edge)=>{const b=polygon[(edge+1)%polygon.length]!;
      return Math.min(distanceToSegment(p,a,b),distanceToSegment(q,a,b),distanceToSegment(a,p,q),distanceToSegment(b,p,q))>=clearance-epsilon;
    });
  });
}
function conflicts(a:SceneObject,b:SceneObject):boolean {
  if(a.materialId==='carpet'||b.materialId==='carpet')return false;
  const bottomA=a.elevation??0,bottomB=b.elevation??0;
  if(bottomA+a.size.height<=bottomB+epsilon||bottomB+b.size.height<=bottomA+epsilon)return false;
  return footprintsIntersect(footprint(a),footprint(b));
}

/**
 * Pure, bounded grid search for an explicitly chosen one-desk/one-chair pattern.
 * Keeps every existing object unchanged. Gaps describe the proposed grid only;
 * they do not certify access routes, unmodelled obstacles or actual inventory.
 */
export function planDeskChairGroups(original:Scene,raw:DeskChairLayoutInput,idFactory:(index:number)=>string):DeskChairLayoutResult {
  const scene=sceneSchema.parse(original),input=deskChairLayoutSchema.parse(raw);
  if(typeof idFactory!=='function')throw new ApiError('SEATING_ID_FACTORY_REQUIRED',422);
  const next=structuredClone(scene);
  const base={scene:next,requested:input.count,placed:0,shortfall:input.count,assumptions:input,unknown:[...unknown],limitReason:null as DeskChairLayoutResult['limitReason']};
  if(scene.schemaVersion===1||scene.structure.walls.some(w=>w.status!=='confirmed')||scene.structure.columns.some(c=>c.status!=='confirmed'))base.unknown.push('场地结构来源或确认状态');
  // A preset can include fixed geometry outside Scene.objects, which this helper cannot inspect.
  if(scene.scenePreset)return {...base,limitReason:'preset_unverified'};
  const region=input.region??{x1:0,z1:0,x2:scene.venue.width,z2:scene.venue.depth};
  if(region.x1>=region.x2||region.z1>=region.z2||region.x2>scene.venue.width||region.z2>scene.venue.depth)throw new ApiError('INVALID_SEATING_REGION',422);
  const maxGroups=Math.max(0,Math.floor((ordinaryObjectLimit-scene.objects.length)/2));
  if(maxGroups===0)return {...base,limitReason:'object_limit'};
  const maxWidth=Math.max(input.deskSize.width,input.chairSize.width),groupDepth=input.deskSize.depth+input.deskChairGap+input.chairSize.depth;
  const startX=region.x1+input.edgeClearance+maxWidth/2, endX=region.x2-input.edgeClearance-maxWidth/2;
  const startZ=region.z1+input.edgeClearance, endZ=region.z2-input.edgeClearance-groupDepth;
  const pitchX=maxWidth+input.columnGap,pitchZ=groupDepth+input.rowGap;
  if(startX>endX+epsilon||startZ>endZ+epsilon)return {...base,limitReason:'no_placement'};
  const polygon=polygonFor(scene),usedIds=new Set<string>([...scene.objects.flatMap(item=>[item.id,...(item.assetId?[item.assetId]:[])]),...scene.venue.entrances.map(item=>item.id),...(scene.venue.floorplanAssetId?[scene.venue.floorplanAssetId]:[])].map(id=>id.toLowerCase()));
  if(scene.schemaVersion===2){for(const item of [...scene.structure.walls,...scene.structure.openings,...scene.structure.columns,...scene.dimensions])usedIds.add(item.id.toLowerCase());for(const source of scene.sources)usedIds.add(source.assetId.toLowerCase());}
  let nextId=0;
  const newId=()=>{
    for(let attempts=0;attempts<100;attempts++){
      const candidate=uuid.safeParse(idFactory(nextId++));
      if(!candidate.success)throw new ApiError('SEATING_ID_INVALID',422);
      const id=candidate.data.toLowerCase();if(!usedIds.has(id)){usedIds.add(id);return id;}
    }
    throw new ApiError('SEATING_ID_COLLISION',422);
  };
  let placed=0,probes=0,exhausted=false,bestScene=next;
  // Try the original origin first, then a small fixed set of phase offsets.
  // All trials share the same probe budget and preserve the best result;
  // this is a heuristic, not a proof of maximum venue capacity.
  const offsets=[0,0.5,0.25,0.75];
  search:for(const zPhase of offsets)for(const xPhase of offsets){
    const xOrigin=startX+xPhase*pitchX,zOrigin=startZ+zPhase*pitchZ;
    if(xOrigin>endX+epsilon||zOrigin>endZ+epsilon)continue;
    const columns=Math.floor((endX-xOrigin+epsilon)/pitchX)+1,rows=Math.floor((endZ-zOrigin+epsilon)/pitchZ)+1;
    const trial=structuredClone(scene);let trialPlaced=0;
    for(let row=0;row<rows&&trialPlaced<input.count&&trialPlaced<maxGroups;row++){
      for(let column=0;column<columns&&trialPlaced<input.count&&trialPlaced<maxGroups;column++){
      if(probes++>=maximumProbes){exhausted=true;break;}
      const x=xOrigin+column*pitchX,z=zOrigin+row*pitchZ;
      // Probe IDs are unique within the complete candidate; generation is deterministic for this input.
      const desk=objectSchema.parse({id:newId(),materialId:'table',position:{x,z:z+input.deskSize.depth/2},rotation:0,size:input.deskSize,color:'#ffffff',locked:false,notes:''});
      const chair=objectSchema.parse({id:newId(),materialId:'chair',position:{x,z:z+input.deskSize.depth+input.deskChairGap+input.chairSize.depth/2},rotation:0,size:input.chairSize,color:'#ffffff',locked:false,notes:''});
      if(conflicts(desk,chair)||!clearFromBoundary(desk,polygon,input.edgeClearance)||!clearFromBoundary(chair,polygon,input.edgeClearance))continue;
      if(trial.objects.some(object=>conflicts(desk,object)||conflicts(chair,object)))continue;
      const issues=structuralViolations({...scene,objects:[desk,chair]} as Scene);
      if(issues.some(issue=>issue.objectId===desk.id||issue.objectId===chair.id))continue;
      if(confirmedDoorwayObstructions({...scene,objects:[desk,chair]} as Scene).length)continue;
      trial.objects.push(desk,chair);trialPlaced++;
      }
      if(exhausted)break;
    }
    if(trialPlaced>placed){placed=trialPlaced;bestScene=trial;}
    if(exhausted||placed>=input.count||placed>=maxGroups)break search;
  }
  const checked=sceneSchema.parse(bestScene),shortfall=input.count-placed;
  return {...base,scene:checked,placed,shortfall,limitReason:shortfall===0?null:placed>=maxGroups?'object_limit':exhausted?'scan_limit':'no_placement'};
}
