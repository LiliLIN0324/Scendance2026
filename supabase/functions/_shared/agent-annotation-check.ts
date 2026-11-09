import {agentAnnotationObservationSchema} from './agent-contract.ts';
import {canonical,type Scene} from './domain.ts';
import {footprint,polygonPenetration} from './structural-geometry.ts';

/** Checks the supplied planning draft, not the physical venue or provenance. */
export function checkReservedAnnotations(base:Scene,candidate:Scene,observation:unknown){
 const violations:Array<{code:string;ids:string[]}>=[],unknown:Array<{code:string;ids:string[]}>=[{code:'ANNOTATION_PHYSICAL_FACTS_UNKNOWN',ids:[]}];
 const parsed=agentAnnotationObservationSchema.safeParse(observation);
 if(!parsed.success||parsed.data.status!=='ready')return {violations,unknown:[...unknown,{code:'ANNOTATION_UNAVAILABLE',ids:[]}]};
 if(canonical(base.venue)!==canonical(candidate.venue))return {violations,unknown:[...unknown,{code:'ANNOTATION_BASIS_CHANGED',ids:[]}]};
 const old=new Map(base.objects.map(item=>[item.id.toLowerCase(),item]));
 for(const [index,mark] of parsed.data.annotations.entries()){
  // Use the same ordinal as get_scene, never expose local annotation IDs.
  const ref=`annotation-${index+1}`;
  if(mark.kind!=='zone'||mark.zoneType!=='reserved'){unknown.push({code:'ANNOTATION_KIND_NOT_CHECKED',ids:[ref]});continue;}
  const g=mark.geometry,x=g.x+base.venue.width/2,z=g.z+base.venue.depth/2;
  if(base.venue.shape==='polygon'||x<0||z<0||x+g.width>base.venue.width||z+g.depth>base.venue.depth){unknown.push({code:'ANNOTATION_BOUNDS_UNKNOWN',ids:[ref]});continue;}
  // Match the frontend keep-out core tolerance; not a physical clearance rule.
  const inset=0.02;
  if(g.width<=2*inset||g.depth<=2*inset){unknown.push({code:'ANNOTATION_BOUNDS_UNKNOWN',ids:[ref]});continue;}
  const polygon=[{x:x+inset,z:z+inset},{x:x+g.width-inset,z:z+inset},{x:x+g.width-inset,z:z+g.depth-inset},{x:x+inset,z:z+g.depth-inset}];
  for(const item of candidate.objects){
   const prior=old.get(item.id.toLowerCase());
   if(item.materialId==='carpet'||prior?.materialId==='carpet'||(item.elevation??0)!==0||(prior?.elevation??0)!==0){unknown.push({code:'ANNOTATION_HEIGHT_UNKNOWN',ids:[ref,item.id]});continue;}
   const depth=polygonPenetration(footprint(item),polygon);
   if(depth<=1e-6)continue;
   const previous=prior?polygonPenetration(footprint(prior),polygon):0;
   if(depth>previous+1e-6)violations.push({code:'RESERVED_AREA_OCCUPIED',ids:[ref,item.id]});
   else unknown.push({code:'EXISTING_OR_CHANGED_RESERVED_OCCUPANCY',ids:[ref,item.id]});
  }
 }
 return {violations,unknown};
}
