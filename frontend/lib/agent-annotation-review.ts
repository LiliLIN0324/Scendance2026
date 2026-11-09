import {agentAnnotationObservationSchema} from '../../supabase/functions/_shared/agent-contract';
import {venueSchema,uuid} from '../../supabase/functions/_shared/domain';
import {evaluateKeepOut} from './flow-constraints';
import {reviewLocalRoutes,type LocalRouteInput,type LocalRouteReview} from './local-route-review';
import {sameRecoveryFormValue} from './recovery-form-value';
import {isLowProfile,isTabletopType} from '../components/room-organizer/lib/geometry';
import {mountBand} from '../components/room-organizer/lib/mount-band';
import {isStructuralMarker,layoutGeometryScene} from '../components/room-organizer/lib/structural-layout';
import type {FurnitureItem,RoomLayout} from '../components/room-organizer/lib/types';
import type {PlanAnnotation} from './plan-annotation';
import type {ZoneFurniturePlacement} from './plan-approve';

export type AnnotationProof={id:string;source:'user'|'unknown';floorId:string|null};
/** The host must obtain these from the authenticated controller/lease and
 * geometryProjectId, never from model text or an untrusted candidate. */
export type AnnotationProjectBinding={actorId:string;sessionId:string;leaseGeneration:number;localActivityId:string;projectId:string;mappedProjectId:string};
/** Values must come from the host's frozen generation record and current live
 * tokens. This function cannot authenticate a caller or coordinate other tabs. */
export type AnnotationReviewInput={
  observation:unknown;currentObservation:unknown;provenance:readonly AnnotationProof[];currentProvenance:readonly AnnotationProof[];
  capturedBase:RoomLayout;currentBase:RoomLayout;candidate:RoomLayout;candidateBinding:unknown;
  projectBinding:AnnotationProjectBinding|null;currentProjectBinding:AnnotationProjectBinding|null;proposalProjectId:string|null;
};
export type AnnotationReviewResult={status:'violated'|'unknown';route:LocalRouteReview;reserved:{violations:Array<{zoneId:string;itemId:string}>;existing:Array<{zoneId:string;itemId:string}>};unknown:string[]};
const UNKNOWN=['路线宽度与实际净宽','连续通行、转弯与会车','门扇和出口','消防与无障碍要求','现场实物和固定障碍'];
const emptyRoute=():LocalRouteReview=>({status:'unknown',centerlineCoverage:'incomplete',violations:[],existing:[],contacts:[],unknown:[...UNKNOWN]});
const unknownResult=(message:string):AnnotationReviewResult=>({status:'unknown',route:emptyRoute(),reserved:{violations:[],existing:[]},unknown:[...UNKNOWN,message]});
const validItem=(item:FurnitureItem)=>!!item&&typeof item.id==='string'&&!!item.id.trim()&&typeof item.type==='string'&&!!item.type.trim()&&!!item.position&&
  [item.position.x,item.position.z,item.width,item.depth,item.height,item.rotation??0,item.elevation??0].every(Number.isFinite)&&item.width>0&&item.depth>0&&item.height>0;
const groundItem=(item:FurnitureItem)=>validItem(item)&&!isStructuralMarker(item)&&item.type!=='door'&&item.type!=='window'&&!isLowProfile(item)&&!isTabletopType(item.type)&&Math.abs(mountBand(item).bottom)<1e-7;
const placement=(item:FurnitureItem):ZoneFurniturePlacement=>({spec:{type:item.type,name:item.id,category:'',width:item.width,depth:item.depth,height:item.height,color:item.color,icon:item.icon},x:item.position!.x,z:item.position!.z,rotation:item.rotation??0,zoneId:'',zoneType:'reserved'});
// Keep in sync with evaluateKeepOut's documented 0.02 m core inset; this is
// used solely to compare the same object's before/after core occupancy.
const CORE_INSET=0.02;
function coreArea(item:FurnitureItem,zone:PlanAnnotation):number {
  if(zone.geometry.kind!=='rect')return 0;
  const g=zone.geometry,a=item.rotation??0,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
  const hx=(item.width*c+item.depth*s)/2,hz=(item.width*s+item.depth*c)/2,p=item.position!;
  return Math.max(0,Math.min(p.x+hx,g.x+g.width-CORE_INSET)-Math.max(p.x-hx,g.x+CORE_INSET))*
    Math.max(0,Math.min(p.z+hz,g.z+g.depth-CORE_INSET)-Math.max(p.z-hz,g.z+CORE_INSET));
}

/** Pure comparison of a frozen same-page candidate; it never returns a safety pass. */
export function reviewAgentAnnotations(input:AnnotationReviewInput):AnnotationReviewResult {
 try {
  const parsed=agentAnnotationObservationSchema.safeParse(input.observation),current=agentAnnotationObservationSchema.safeParse(input.currentObservation);
  if(!parsed.success||parsed.data.status!=='ready'||!current.success||current.data.status!=='ready')return unknownResult('规划草案不可用或未完整读取');
  const snapshot=parsed.data,binding=snapshot.binding;
  if(!sameRecoveryFormValue(snapshot,current.data)||!sameRecoveryFormValue(binding,input.candidateBinding)||!sameRecoveryFormValue(input.provenance,input.currentProvenance)||!sameRecoveryFormValue(input.capturedBase,input.currentBase))return unknownResult('规划草案、场景或候选基线已变化');
  const base=input.capturedBase,candidate=input.candidate,floorId=binding.floorId;
  const project=input.projectBinding;
  if(!project||!input.currentProjectBinding||!sameRecoveryFormValue(project,input.currentProjectBinding)||!uuid.safeParse(project.projectId).success||!uuid.safeParse(project.mappedProjectId).success||!uuid.safeParse(input.proposalProjectId).success||
     project.projectId.toLowerCase()!==project.mappedProjectId.toLowerCase()||project.projectId.toLowerCase()!==input.proposalProjectId!.toLowerCase()||typeof project.actorId!=='string'||!project.actorId.trim()||!uuid.safeParse(project.sessionId).success||
     !Number.isSafeInteger(project.leaseGeneration)||project.leaseGeneration<1||project.localActivityId!==base?.id)return unknownResult('云项目、账号或编辑会话绑定无法核对');
  if(!base||!candidate||`activity:${base.id}`!==binding.activityScope||base.id!==candidate.id||!Number.isFinite(base.width)||!Number.isFinite(base.height)||base.width<=0||base.height<=0||base.width!==candidate.width||base.height!==candidate.height)return unknownResult('活动或场地尺度无法核对');
  const before=base.floors.filter(f=>f.id===floorId),after=candidate.floors.filter(f=>f.id===floorId);
  if(before.length!==1||after.length!==1||!Array.isArray(before[0]!.items)||!Array.isArray(after[0]!.items))return unknownResult('标注楼层无法唯一核对');
  const old=before[0]!.items,now=after[0]!.items;
  const ids=(items:FurnitureItem[])=>items.map(item=>typeof item?.id==='string'?item.id.toLowerCase():'');
  if(old.length>2000||now.length>2000||ids(old).some(id=>!id)||ids(now).some(id=>!id)||new Set(ids(old)).size!==old.length||new Set(ids(now)).size!==now.length)return unknownResult('物件编号或数量无法核对');
  const proofs=new Map<string,AnnotationProof>();
  for(const proof of input.provenance){if(!proof||typeof proof.id!=='string'||proofs.has(proof.id))return unknownResult('标注来源无法核对');proofs.set(proof.id,proof);}
  const asAnnotation=(item:typeof snapshot.annotations[number]):PlanAnnotation=>({id:item.id,kind:item.kind,label:'规划标注',stageNo:1,geometry:item.kind==='door'?{...item.geometry,widthM:null}:item.geometry,...(item.kind==='zone'&&item.zoneType?{zoneType:item.zoneType}:{})});
  const routes:LocalRouteInput[]=snapshot.annotations.filter(item=>item.kind==='route').map(item=>{const proof=proofs.get(item.id);return {annotation:asAnnotation(item),floorId:proof?.floorId??null,source:proof?.source==='user'?'user':'unknown'};});
  const route=reviewLocalRoutes(base,candidate,routes,floorId);
  const unknown=[...new Set([...UNKNOWN,...route.unknown])],reserved:AnnotationReviewResult['reserved']={violations:[],existing:[]};
  if(old.some(item=>!validItem(item))||now.some(item=>!validItem(item)))unknown.push('原场景或候选存在无法核对的物件占地');
  const oldVenue=venueSchema.safeParse(layoutGeometryScene(base,base.floors.indexOf(before[0]!)).venue),newVenue=venueSchema.safeParse(layoutGeometryScene(candidate,candidate.floors.indexOf(after[0]!)).venue);
  const sameVenue=oldVenue.success&&newVenue.success&&oldVenue.data.width===base.width&&oldVenue.data.depth===base.height&&newVenue.data.width===candidate.width&&newVenue.data.depth===candidate.height&&oldVenue.data.shape===newVenue.data.shape&&sameRecoveryFormValue(oldVenue.data.polygon??null,newVenue.data.polygon??null)&&
    sameRecoveryFormValue(base.mapGroundPolygon??null,candidate.mapGroundPolygon??null)&&sameRecoveryFormValue(base.backendSceneV2?.structure??null,candidate.backendSceneV2?.structure??null)&&sameRecoveryFormValue(before[0]!.interiorWalls??[],after[0]!.interiorWalls??[]);
  if(snapshot.annotations.filter(item=>item.kind==='zone'&&item.zoneType==='reserved').length*(old.length+now.length)>100_000)return unknownResult('预留区与物件组合超过本次检查范围');
  const beforeById=new Map(old.map(item=>[item.id.toLowerCase(),item]));
  const sameFootprint=(a:FurnitureItem,b:FurnitureItem)=>sameRecoveryFormValue({position:a.position,width:a.width,depth:a.depth,rotation:a.rotation??0},{position:b.position,width:b.width,depth:b.depth,rotation:b.rotation??0});
  const afterById=new Map(now.map(item=>[item.id.toLowerCase(),item]));
  route.existing=route.existing.filter(hit=>{
    const previous=beforeById.get(hit.itemId.toLowerCase()),next=afterById.get(hit.itemId.toLowerCase());
    if(previous&&next&&!sameFootprint(previous,next)){unknown.push('物件与路线相交的位置已变化，新增占用范围尚需核对');route.centerlineCoverage='incomplete';return false;}
    return true;
  });
  for(const item of snapshot.annotations){
    if(item.kind!=='zone'||item.zoneType!=='reserved')continue;
    const proof=proofs.get(item.id),g=item.geometry;
    if(proof?.source!=='user'||proof.floorId!==floorId){unknown.push('预留区来源或楼层未确认');continue;}
    if(!sameVenue||base.backendVenue?.shape==='polygon'||candidate.backendVenue?.shape==='polygon'||base.mapGroundPolygon?.length||candidate.mapGroundPolygon?.length||
       g.x < -base.width/2||g.z < -base.height/2||g.x+g.width>base.width/2||g.z+g.depth>base.height/2||g.width<=2*CORE_INSET||g.depth<=2*CORE_INSET){unknown.push('预留区边界或场地轮廓未确认');continue;}
    const zone=asAnnotation(item);
    for(const object of now){
      if(!groundItem(object)){unknown.push('物件离地高度、结构或占地尚未核对');continue;}
      const result=evaluateKeepOut([placement(object)],[zone]);
      if(result.some(row=>row.status==='unknown')){unknown.push('旋转物件与预留区关系未确认');continue;}
      if(!result.some(row=>row.severity==='hard'))continue;
      const prior=beforeById.get(object.id.toLowerCase());
      if(prior&&!groundItem(prior)){unknown.push('原物件占地或高度未确认');continue;}
      const previous=prior?evaluateKeepOut([placement(prior)],[zone]):[];
      if(previous.some(row=>row.status==='unknown')){unknown.push('原物件与预留区关系未确认');continue;}
      const hit={zoneId:item.id,itemId:object.id};
      if(!prior||!previous.some(row=>row.severity==='hard')||coreArea(object,zone)>coreArea(prior,zone)+1e-7)reserved.violations.push(hit);
      else if(sameFootprint(prior,object))reserved.existing.push(hit);
      else unknown.push('物件在预留区内的占用位置已变化，新增占用范围尚需核对');
    }
  }
  return {status:route.violations.length||reserved.violations.length?'violated':'unknown',route,reserved,unknown:[...new Set(unknown)]};
 }catch{return unknownResult('规划草案或候选无法完整核对');}
}
