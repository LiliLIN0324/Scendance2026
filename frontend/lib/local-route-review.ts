import { venueSchema, type Point } from '../../supabase/functions/_shared/domain';
import { pointInPolygon } from '../../supabase/functions/_shared/structural-geometry';
import { isLowProfile, isTabletopType } from '../components/room-organizer/lib/geometry';
import { mountBand } from '../components/room-organizer/lib/mount-band';
import { isStructuralMarker, layoutGeometryScene } from '../components/room-organizer/lib/structural-layout';
import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';
import type { PlanAnnotation, PlanPoint } from './plan-annotation';

/** The annotation has no floor or author field: the caller must supply those facts. */
export type LocalRouteInput = { annotation: PlanAnnotation; floorId: string | null; source: 'user' | 'inferred' | 'unknown' };
export type RouteFootprintHit = { routeId: string; itemId: string; occupiedLengthM: number };
export type LocalRouteReview = {
  status: 'violated' | 'unknown' | 'not_applicable';
  /** Coverage of centreline vs eligible model footprints only; not route or safety approval. */
  centerlineCoverage: 'complete' | 'incomplete' | 'not_applicable';
  /** Candidate newly enters, or occupies more of, a user route centreline. */
  violations: RouteFootprintHit[];
  /** Present already and not provably worsened; do not blame the candidate. */
  existing: RouteFootprintHit[];
  /** Exact boundary contact only; this is not a measured clearance. */
  contacts: Array<{routeId:string;itemId:string}>;
  unknown: string[];
};

const EPS=1e-7, MAX_POINTS=2000, MAX_ITEMS=2000, MAX_ROUTES=100, MAX_COMPARISONS=100_000;
const finitePoint=(p:unknown):p is PlanPoint=>!!p&&typeof p==='object'&&Number.isFinite((p as PlanPoint).x)&&Number.isFinite((p as PlanPoint).z);
const alwaysUnknown=['路线宽度与实际净宽','连续通行、转弯与会车','门扇和出口','消防与无障碍要求','现场实物和固定障碍'];
const isRug=(item:FurnitureItem)=>isLowProfile(item)&&(item.type==='rug'||item.materialId==='carpet');

/** Clip a segment to an oriented model footprint; a tangent is contact, not penetration. */
function clip(a:PlanPoint,b:PlanPoint,item:FurnitureItem):{length:number;contact:boolean} {
  const p=item.position!,angle=item.rotation??0,c=Math.cos(angle),s=Math.sin(angle);
  const local=(v:PlanPoint)=>({x:(v.x-p.x)*c-(v.z-p.z)*s,z:(v.x-p.x)*s+(v.z-p.z)*c});
  const start=local(a),end=local(b),dx=end.x-start.x,dz=end.z-start.z;
  let low=0,high=1;
  for(const [value,delta,half] of [[start.x,dx,item.width/2],[start.z,dz,item.depth/2]] as const){
    if(Math.abs(delta)<EPS){if(value < -half-EPS || value > half+EPS)return {length:0,contact:false};continue;}
    const t1=(-half-value)/delta,t2=(half-value)/delta;
    low=Math.max(low,Math.min(t1,t2));high=Math.min(high,Math.max(t1,t2));
    if(low>high+EPS)return {length:0,contact:false};
  }
  const lo=Math.max(0,low),hi=Math.min(1,high);
  if(lo>hi+EPS)return {length:0,contact:false};
  const middle=(lo+hi)/2,x=start.x+dx*middle,z=start.z+dz*middle;
  if(hi-lo<=EPS||Math.abs(x)>=item.width/2-EPS||Math.abs(z)>=item.depth/2-EPS)return {length:0,contact:true};
  return {length:Math.hypot(b.x-a.x,b.z-a.z)*(hi-lo),contact:false};
}

/** A concave boundary may be exited and re-entered between two inside endpoints. */
function segmentInVenue(a:Point,b:Point,polygon:Point[]):boolean {
  const dx=b.x-a.x,dz=b.z-a.z,breaks=[0,1];
  for(let i=0;i<polygon.length;i++){
    const c=polygon[i]!,d=polygon[(i+1)%polygon.length]!,ex=d.x-c.x,ez=d.z-c.z,den=dx*ez-dz*ex;
    if(Math.abs(den)<EPS)continue;
    const t=((c.x-a.x)*ez-(c.z-a.z)*ex)/den,u=((c.x-a.x)*dz-(c.z-a.z)*dx)/den;
    if(t>EPS&&t<1-EPS&&u>=-EPS&&u<=1+EPS)breaks.push(t);
  }
  breaks.sort((x,y)=>x-y);
  for(let i=0;i<breaks.length;i++){
    const values=[breaks[i]!,...(i?[((breaks[i-1]!+breaks[i]!)/2)]:[])];
    for(const t of values)if(!pointInPolygon({x:a.x+dx*t,z:a.z+dz*t},polygon))return false;
  }
  return true;
}

function validItem(item:FurnitureItem):boolean {
  return typeof item.id==='string'&&!!item.id.trim()&&typeof item.type==='string'&&!!item.type.trim()&&finitePoint(item.position)&&
    [item.width,item.depth,item.height,item.rotation??0,item.elevation??0].every(Number.isFinite)&&item.width>0&&item.depth>0&&item.height>0;
}

/**
 * Compare the exact same user-marked routes against complete base and candidate.
 * Footprints are model bounding rectangles; a result is not a site or safety approval.
 */
export function reviewLocalRoutes(base:RoomLayout|undefined,candidate:RoomLayout|undefined,routes:readonly LocalRouteInput[]|undefined,floorId:string|null):LocalRouteReview {
  const unknown=[...alwaysUnknown,'仅检查模型包围占地，未检查近邻间距或全部结构'];
  const result:LocalRouteReview={status:'unknown',centerlineCoverage:'incomplete',violations:[],existing:[],contacts:[],unknown};
  let incomplete=false;
  const markIncomplete=(message:string)=>{incomplete=true;if(!unknown.includes(message))unknown.push(message);};
  if(!routes||!Array.isArray(routes)){unknown.push('路线资料未提供');return result;}
  if(!routes.length){result.status='not_applicable';result.centerlineCoverage='not_applicable';return result;}
  if(!base||!candidate||!floorId||typeof base.id!=='string'||!base.id.trim()||base.id!==candidate.id||!Array.isArray(base.floors)||!Array.isArray(candidate.floors)){unknown.push('活动、场地或路线楼层未确认');return result;}
  if([...base.floors,...candidate.floors].some(floor=>!floor||typeof floor!=='object')){unknown.push('楼层资料无法读取');return result;}
  const before=base.floors.filter(floor=>floor.id===floorId),after=candidate.floors.filter(floor=>floor.id===floorId);
  if(before.length!==1||after.length!==1||!Array.isArray(before[0]!.items)||!Array.isArray(after[0]!.items)){unknown.push('路线对应楼层无法唯一确定');return result;}
  if(![base.width,base.height,candidate.width,candidate.height].every(n=>Number.isFinite(n)&&n>0)||base.width!==candidate.width||base.height!==candidate.height){unknown.push('候选与原场地尺度不同，无法比较');return result;}
  if(base.mapGroundPolygon?.length&&!base.backendVenue?.polygon||candidate.mapGroundPolygon?.length&&!candidate.backendVenue?.polygon){unknown.push('地图范围尚未转换为场地轮廓');return result;}
  let polygon:Point[];
  try{
    for(const layout of [base,candidate]){
      if(layout.backendSceneV2&&!layout.backendVenue){unknown.push('结构与场地轮廓未建立一致关系');return result;}
      if(layout.backendVenue&&(layout.backendVenue.width!==layout.width||layout.backendVenue.depth!==layout.height)){unknown.push('画布与场地轮廓的尺寸不一致');return result;}
      if(layout.backendSceneV2&&layout.backendVenue){const a=layout.backendSceneV2.venue,b=layout.backendVenue;
        if(a.width!==b.width||a.depth!==b.depth||a.shape!==b.shape||JSON.stringify(a.polygon??null)!==JSON.stringify(b.polygon??null)){unknown.push('结构与场地轮廓不一致');return result;}}
    }
    const a=venueSchema.safeParse(layoutGeometryScene(base,base.floors.indexOf(before[0]!)).venue);
    const b=venueSchema.safeParse(layoutGeometryScene(candidate,candidate.floors.indexOf(after[0]!)).venue);
    if(!a.success||!b.success||JSON.stringify(a.data.polygon??null)!==JSON.stringify(b.data.polygon??null)||a.data.shape!==b.data.shape){unknown.push('原场地与候选轮廓无法一致核对');return result;}
    polygon=a.data.polygon??[{x:0,z:0},{x:base.width,z:0},{x:base.width,z:base.height},{x:0,z:base.height}];
  }catch{unknown.push('场地轮廓无法读取');return result;}
  const old=before[0]!.items,now=after[0]!.items;
  if(old.length>MAX_ITEMS||now.length>MAX_ITEMS){unknown.push('物件数量超过本次检查范围');return result;}
  if([...old,...now].some(item=>!item||typeof item!=='object')){unknown.push('物件资料无法读取');return result;}
  const ids=(items:FurnitureItem[])=>items.map(item=>typeof item.id==='string'?item.id.toLowerCase():'');
  if(ids(old).some(id=>!id)||ids(now).some(id=>!id)||new Set(ids(old)).size!==old.length||new Set(ids(now)).size!==now.length){unknown.push('物件编号缺失或重复');return result;}
  const beforeById=new Map(old.map(item=>[item.id.toLowerCase(),item]));
  const routeIds=routes.map(route=>route?.annotation?.id);
  if(routes.length>MAX_ROUTES||routeIds.some(id=>typeof id!=='string'||!id.trim())||new Set(routeIds.map(id=>typeof id==='string'?id.toLowerCase():'')).size!==routeIds.length){unknown.push('路线数量超出范围或编号缺失、重复');return result;}
  const comparisons=routes.reduce((sum,route)=>sum+(route?.annotation?.geometry?.kind==='polyline'&&Array.isArray(route.annotation.geometry.points)?route.annotation.geometry.points.length:0)*(old.length+now.length),0);
  if(comparisons>MAX_COMPARISONS){unknown.push('路线与物件组合超过本次检查范围');return result;}
  // Missing footprints remain unknown even when the corresponding object was removed.
  for(const [items,side] of [[old,'原场景'],[now,'候选']] as const)for(const item of items){
    if(isStructuralMarker(item))continue;
    if(!validItem(item)){markIncomplete(`${side}物件 ${item.id||'未知'} 的占地信息不完整`);continue;}
  }
  const seenRoutes=new Set<string>();
  for(const route of routes){
    const annotation=route?.annotation,id=annotation?.id;
    if(typeof id!=='string'||!id.trim()||seenRoutes.has(id)){markIncomplete('路线编号缺失或重复');continue;}seenRoutes.add(id);
    if(route.source!=='user'||route.floorId!==floorId){markIncomplete(`路线 ${id} 的来源或楼层未确认`);continue;}
    if(annotation.kind!=='route'||annotation.geometry?.kind!=='polyline'||!Array.isArray(annotation.geometry.points)||annotation.geometry.points.length<2||annotation.geometry.points.length>MAX_POINTS||!annotation.geometry.points.every(finitePoint)){
      markIncomplete(`路线 ${id} 的几何信息不完整`);continue;
    }
    const points:readonly PlanPoint[]=annotation.geometry.points;
    if(!points.some((p,i)=>i>0&&Math.hypot(p.x-points[i-1]!.x,p.z-points[i-1]!.z)>EPS)||points.some((p,i)=>i>0&&!segmentInVenue({x:points[i-1]!.x+base.width/2,z:points[i-1]!.z+base.height/2},{x:p.x+base.width/2,z:p.z+base.height/2},polygon))){
      markIncomplete(`路线 ${id} 超出场地或长度无法核对`);continue;
    }
    const touchesRoute=(item:FurnitureItem):boolean=>points.some((point,index)=>{
      if(index===0)return false;
      const hit=clip(points[index-1]!,point,item);
      return hit.length>0||hit.contact;
    });
    // A known footprint that is far from the centreline needs no assumption
    // about height. Intersecting or touching uncertain-height objects do.
    for(const [items,side] of [[old,'原场景'],[now,'候选']] as const)for(const item of items){
      if(isStructuralMarker(item)||!validItem(item)||isRug(item)||!touchesRoute(item))continue;
      if(item.type==='door'||item.type==='window')markIncomplete(`${side}门窗 ${item.id} 的结构状态尚未核对`);
      else if(Math.abs(mountBand(item).bottom)>EPS)markIncomplete(`${side}物件 ${item.id} 的离地净空尚未核对`);
      else if(isLowProfile(item)||isTabletopType(item.type))markIncomplete(`${side}物件 ${item.id} 的实际高度或支撑关系尚未核对`);
    }
    for(const item of now){
      if(isStructuralMarker(item))continue;
      if(!validItem(item)){markIncomplete(`物件 ${item.id||'未知'} 的占地信息不完整`);continue;}
      if(item.type==='door'||item.type==='window'||Math.abs(mountBand(item).bottom)>EPS)continue;
      if(isRug(item))continue;
      if(isLowProfile(item)||isTabletopType(item.type))continue;
      let length=0,contact=false;
      for(let i=1;i<points.length;i++){const hit=clip(points[i-1]!,points[i]!,item);length+=hit.length;contact||=hit.contact;}
      if(!length){if(contact)result.contacts.push({routeId:id,itemId:item.id});continue;}
      const prior=beforeById.get(item.id.toLowerCase());
      let oldLength=0;
      if(prior&&(isStructuralMarker(prior)||prior.type==='door'||prior.type==='window')){markIncomplete(`原物件 ${item.id} 的结构状态已变化，无法比较`);continue;}
      if(prior&&!isStructuralMarker(prior)){
        if(!validItem(prior)){markIncomplete(`原物件 ${item.id} 的占地信息不完整，无法比较变化`);continue;}
        const priorUnknown=prior.type==='door'||prior.type==='window'||Math.abs(mountBand(prior).bottom)>EPS||(!isRug(prior)&&(isLowProfile(prior)||isTabletopType(prior.type)));
        if(priorUnknown&&touchesRoute(prior)){markIncomplete(`原物件 ${item.id} 的离地或支撑关系尚未核对`);continue;}
        if(!priorUnknown&&!isRug(prior))for(let i=1;i<points.length;i++)oldLength+=clip(points[i-1]!,points[i]!,prior).length;
      }
      const hit={routeId:id,itemId:item.id,occupiedLengthM:length};
      if(length>oldLength+EPS)result.violations.push(hit);else result.existing.push(hit);
    }
  }
  if(result.contacts.length)unknown.push('路线与模型占地边缘接触，实际净宽未知');
  if(result.existing.length)unknown.push('已有路线占用未证明由本次候选新增');
  if(result.violations.length)result.status='violated';
  result.centerlineCoverage=incomplete?'incomplete':'complete';
  return result;
}
