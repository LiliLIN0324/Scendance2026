import {z} from 'zod';

/**
 * 首版只覆盖矩形场地里的轴对齐矩形。
 * 多边形场地、多边形区域、路线宽度和消防疏散都不在本版范围内，不能当成已确认的现场事实。
 */
const boundedText=(max:number)=>z.string().refine(value=>Array.from(value).length<=max);
const id=boundedText(128).refine(value=>value.trim().length>0);
const metres=(positive:boolean)=>z.number().finite().min(positive?1e-9:0).max(200).refine(value=>Number(value.toFixed(9))===value,'maximum precision is 1e-9 metres');
export const planningZoneSchema=z.strictObject({
 id,name:boundedText(200),color:boundedText(64),x:metres(false),z:metres(false),
 width:metres(true),depth:metres(true),
 zoneType:z.enum(['roundtable','checkin','photo','rest','desk','reserved']).optional(),source:z.literal('unverified'),
});
export const planningZonesSchema=z.strictObject({version:z.literal(1),zones:z.array(planningZoneSchema).min(1).max(32)}).superRefine((value,ctx)=>{
 const seen=new Set<string>();for(const [index,zone] of value.zones.entries()){
  if(seen.has(zone.id))ctx.addIssue({code:'custom',path:['zones',index,'id'],message:'duplicate zone id'});
  seen.add(zone.id);
 }
});
export const planningZonesEditSchema=z.strictObject({version:z.literal(1),previous:planningZonesSchema.nullable()});
export type PlanningZones=z.infer<typeof planningZonesSchema>;
export type PlanningZone=z.infer<typeof planningZoneSchema>;
export const PLANNING_ZONES_RECTANGLE_V1={
 version:1 as const,
 geometry:'axis_aligned_rectangle' as const,
 polygon:'not_covered' as const,
 coordinateSystem:'scene_corner_metres' as const,
 precisionMetres:1e-9,
 maxZones:32,
 source:'unverified' as const,
};

/** Polygon containment needs its own exact implementation. A bounding box is not a concave boundary. */
export function planningZonesFitVenue(zones:PlanningZones,venue:{shape:'rectangle'|'polygon';width:number;depth:number}):boolean {
 if(venue.shape!=='rectangle')return false;
 return zones.zones.every(zone=>Number((zone.x+zone.width).toFixed(9))<=venue.width&&Number((zone.z+zone.depth).toFixed(9))<=venue.depth);
}

export type PlanningZonesCapability={supported:false}|{supported:true;version:1};
const supportedCapability=z.strictObject({supported:z.literal(true),version:z.literal(1)});

/** Anything other than the exact v1 acknowledgement stays unsupported. Unknown is not confirmed. */
export function parsePlanningZonesCapability(raw:unknown):PlanningZonesCapability {
 return supportedCapability.safeParse(raw).success?{supported:true,version:1}:{supported:false};
}

/** 没有区域时沿用旧保存。有区域时，只有精确的 v1 能力可以写入；否则继续阻断，不能把未知响应当成已支持。 */
export function cloudZoneWriteMode(carriesZones:boolean,capability:PlanningZonesCapability):'omit'|'rectangle-v1'|'blocked' {
 if(!carriesZones)return 'omit';
 return capability.supported?'rectangle-v1':'blocked';
}
export function planningZonesWriteEnvelope(scene:{planningZones?:PlanningZones|undefined},serverScene:{planningZones?:PlanningZones|undefined}|null,capability:PlanningZonesCapability):{planningZonesEdit?:{version:1;previous:PlanningZones|null}} {
 const previous=serverScene?.planningZones??null;
 const next=scene.planningZones??null;
 if(previous===null&&next===null)return {};
 if(!capability.supported)throw Object.assign(new Error('PLANNING_ZONES_UNAVAILABLE'),{code:'PLANNING_ZONES_UNAVAILABLE'});
 return {planningZonesEdit:{version:1,previous}};
}

/**
 * Read the rectangles actually stored on the scene.
 * Activity zones stay activity zones. A reserved label is an unverified keep-out mark, not a fire lane.
 * Route width and fire egress are unknown until a separate measurement exists.
 */
export function savedPlanningZoneFacts(zones:PlanningZones|null|undefined){
 return {
  scope:PLANNING_ZONES_RECTANGLE_V1,
  zones:(zones?.zones??[]).map(zone=>({
   id:zone.id,
   zoneType:zone.zoneType??null,
   source:'unverified' as const,
   role:zone.zoneType==='reserved'?'reserved_unverified' as const:'activity' as const,
  })),
  routeWidth:'unknown' as const,
  fireEgress:'unknown' as const,
  confirmed:false as const,
 };
}

function stableZoneValue(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(stableZoneValue).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>`${JSON.stringify(key)}:${stableZoneValue(entry)}`).join(',')}}`;
 return JSON.stringify(value??null);
}

/** Model output may copy zones. It may not add, drop, retype, or redraw them. */
export function modelPreservesPlanningZones(before:PlanningZones|null|undefined,after:PlanningZones|null|undefined):boolean {
 return stableZoneValue(before??null)===stableZoneValue(after??null);
}
