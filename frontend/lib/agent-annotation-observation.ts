import {z} from 'zod';
import type {LayoutPlanDraft} from './plan-annotation';

/** Read-only adapter for a future Agent tool. The host must bind isCurrent to
 * the live activity, scene, floor and conversation epochs, including A→B→A.
 * Neither this adapter nor a successful read verifies a site or runs a solver. */
export interface AnnotationObservationSource {
  binding:{activityScope:string;activityEpoch:number;sceneRevision:number;floorId:string;annotationRevision:number};
  read:()=>{revision:number;draft:LayoutPlanDraft|null};
  /** Host-verified current scene dimensions, metres. */
  bounds:{width:number;depth:number}|null;
  /** Return the proven floor for each annotation; absence is not current floor. */
  annotationFloor:(annotationId:string)=>string|null;
  isCurrent:()=>boolean;
}
const id=z.string().min(1).max(200).refine(v=>v===v.trim()&&v.normalize('NFC')===v&&!/[\p{Cc}\p{Cf}]/u.test(v));
const version=z.number().int().nonnegative().safe();
const binding=z.strictObject({activityScope:id.refine(v=>v.startsWith('activity:')&&v.length>9),activityEpoch:version,sceneRevision:version,floorId:id,annotationRevision:version});
const point=z.strictObject({x:z.number().finite(),z:z.number().finite()});
const geometry=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('rect'),x:z.number().finite(),z:z.number().finite(),width:z.number().finite().positive(),depth:z.number().finite().positive()}),
  z.strictObject({kind:z.literal('polyline'),points:z.array(point).min(2).max(100)}),
  z.strictObject({kind:z.literal('measure'),from:point,to:point}),
  z.strictObject({kind:z.literal('door'),wall:z.enum(['north','south','east','west']),position:z.number().finite(),widthM:z.number().finite().positive().nullable(),inferred:z.boolean().optional(),source:z.literal('scene').optional()}),
]);
const annotation=z.object({id,kind:z.enum(['zone','route','measure','door']),geometry,zoneType:z.enum(['roundtable','checkin','photo','rest','desk','reserved']).optional()});

export function readAgentAnnotationObservation(source:AnnotationObservationSource) {
  const unavailable={status:'unavailable' as const};
  try {
    const parsedBinding=binding.safeParse(source.binding);
    if(!parsedBinding.success||!source.isCurrent()||!source.bounds||!Number.isFinite(source.bounds.width)||!Number.isFinite(source.bounds.depth)||source.bounds.width<=0||source.bounds.depth<=0)return unavailable;
    const bounds={...source.bounds};
    const first=source.read();
    if(first.revision!==parsedBinding.data.annotationRevision||!Number.isSafeInteger(first.revision))return unavailable;
    if(first.draft!==null&&(!Array.isArray(first.draft.annotations)||!Array.isArray(first.draft.stages)||first.draft.annotations.length>100))return unavailable;
    const signature=JSON.stringify(first.draft), snapshot=structuredClone(first.draft);
    if(JSON.stringify(first.draft)!==signature)return unavailable;
    const result=[],ids=new Set<string>(),floors=new Map<string,string>();
    const inside=(p:{x:number;z:number})=>Math.abs(p.x)<=bounds.width/2&&Math.abs(p.z)<=bounds.depth/2;
    for(const raw of snapshot?.annotations??[]){
      const parsed=annotation.safeParse(raw);if(!parsed.success)return unavailable;
      const {id:annotationId,kind,geometry:g,zoneType}=parsed.data;
      if(ids.has(annotationId))return unavailable;ids.add(annotationId);
      // Even another-floor annotation needs trustworthy ownership: otherwise
      // silently excluding it would make the returned snapshot look complete.
      const floor=source.annotationFloor(annotationId);if(!floor||!id.safeParse(floor).success)return unavailable;
      floors.set(annotationId,floor);
      if(floor!==parsedBinding.data.floorId)continue;
      if(({zone:'rect',route:'polyline',measure:'measure',door:'door'} as const)[kind]!==g.kind)return unavailable;
      if(g.kind==='rect'&&(!inside({x:g.x,z:g.z})||!inside({x:g.x+g.width,z:g.z+g.depth})))return unavailable;
      if(g.kind==='polyline'&&!g.points.every(inside))return unavailable;
      if(g.kind==='measure'&&(!inside(g.from)||!inside(g.to)))return unavailable;
      if(g.kind==='door'&&Math.abs(g.position)>(g.wall==='north'||g.wall==='south'?bounds.width:bounds.depth)/2)return unavailable;
      if(g.kind==='door')result.push({id:annotationId,kind,geometry:{kind:'door' as const,wall:g.wall,position:g.position},positionStatus:g.inferred?'inferred' as const:'unverified' as const,widthStatus:'unknown' as const,directionStatus:'unknown' as const});
      else result.push({id:annotationId,kind,geometry:g,...(kind==='zone'?{zoneType:zoneType??null}:{}),source:'unverified' as const});
    }
    const second=source.read();
    if(second.revision!==first.revision||JSON.stringify(second.draft)!==signature||source.bounds?.width!==bounds.width||source.bounds?.depth!==bounds.depth||!source.isCurrent())return unavailable;
    for(const [annotationId,floor] of floors)if(source.annotationFloor(annotationId)!==floor)return unavailable;
    if(!source.isCurrent())return unavailable;
    return {status:'ready' as const,binding:parsedBinding.data,annotations:result,
      notice:'标注是待核验的规划草稿；读取不代表已用于排布或完成安全检查。' as const};
  } catch {return unavailable;}
}
