import {canonical,sceneSchema,sceneWarnings,type Scene} from './domain.ts';
import {canApplyStructuralChange,dimensionConflicts} from './structural-geometry.ts';
import {projectUnverifiedScene} from './scene-text-projection.ts';

export interface OriginalSceneChange {path:string;before:{present:boolean;value?:unknown};after:{present:boolean;value?:unknown}}
/** Older JSON may omit defaults or use an unnormalised color. Preserve every raw
 * field and permit at most one unlocked object's x/z change, never normalize it. */
function isLosslessLegacyMove(rawBase:unknown,rawCandidate:unknown,base:Scene):boolean {
 try {
  const a=structuredClone(rawBase) as {objects:Array<{position:{x:number;z:number}}>},b=structuredClone(rawCandidate) as typeof a;
  if(!a||!b||!Array.isArray(a.objects)||!Array.isArray(b.objects)||a.objects.length!==b.objects.length)return false;
  let changed=0;
  for(let index=0;index<a.objects.length;index++){
   const before=a.objects[index],after=b.objects[index];
   if(!before?.position||!after?.position)return false;
   if(before.position.x!==after.position.x||before.position.z!==after.position.z){if(base.objects[index]?.locked)return false;changed++;}
   before.position.x=0;before.position.z=0;after.position.x=0;after.position.z=0;
  }
  return changed===1&&canonical(a)===canonical(b);
 }catch{return false;}
}
/** Pure preflight: preserve every undisclosed field; this is not an authorization or CAS. */
export function prepareOriginalSceneReview(rawBase:unknown,rawCandidate:unknown){
 const base=sceneSchema.parse(rawBase),candidate=sceneSchema.parse(rawCandidate);
 const normalized=canonical(base)===canonical(rawBase)&&canonical(candidate)===canonical(rawCandidate);
 if(base.schemaVersion!==candidate.schemaVersion||(!normalized&&!isLosslessLegacyMove(rawBase,rawCandidate,base)))throw new Error('ORIGINAL_REVIEW_INVALID_SCENE');
 const geometry=(object:Scene['objects'][number])=>canonical({position:object.position,size:object.size,rotation:object.rotation,elevation:object.elevation??0,materialId:object.materialId});
 const originalById=new Map(base.objects.map(object=>[object.id,object]));
 const changedGeometry=new Set(candidate.objects.filter(object=>{const old=originalById.get(object.id);return !old||geometry(old)!==geometry(object);}).map(object=>object.id));
 if(sceneWarnings(candidate).some(warning=>(warning.code==='OVERLAP'||warning.code==='OUT_OF_BOUNDS')&&warning.ids.some(id=>changedGeometry.has(id))))throw new Error('ORIGINAL_REVIEW_GEOMETRY_CONFLICT');
 const nextById=new Map(candidate.objects.map(object=>[object.id,object]));
 for(const old of base.objects){const next=nextById.get(old.id);if(old.locked&&canonical(old)!==canonical(next))throw new Error('ORIGINAL_REVIEW_LOCKED_OBJECT_CHANGED');if(old.notes && (!next||next.notes!==old.notes))throw new Error('ORIGINAL_REVIEW_HIDDEN_FIELD_CHANGED');}
 const oldById=new Map(base.objects.map(object=>[object.id,object]));
 for(const next of candidate.objects)if(next.notes!==(oldById.get(next.id)?.notes??''))throw new Error('ORIGINAL_REVIEW_HIDDEN_FIELD_CHANGED');
 if(canonical(base.venue)!==canonical(candidate.venue))throw new Error('ORIGINAL_REVIEW_STRUCTURE_CHANGED');
 if(base.schemaVersion===2&&candidate.schemaVersion===2){
  if(canonical(base.design)!==canonical(candidate.design))throw new Error('ORIGINAL_REVIEW_HIDDEN_FIELD_CHANGED');
  if(canonical(base.structure)!==canonical(candidate.structure)||canonical(base.sources)!==canonical(candidate.sources)||canonical(base.dimensions)!==canonical(candidate.dimensions))throw new Error('ORIGINAL_REVIEW_STRUCTURE_CHANGED');
 }
 if(dimensionConflicts(candidate).length||!canApplyStructuralChange(base,candidate))throw new Error('ORIGINAL_REVIEW_GEOMETRY_CONFLICT');
 const safe=(scene:Scene)=>{
  const result=projectUnverifiedScene(scene).scene;
  if(result.schemaVersion===2)result.dimensions=result.dimensions.map((d,index)=>({...d,label:`尺寸记录 ${index+1}（来源待核验）`}));
  return result;
 };
 const before=safe(base),after=safe(candidate),changes:OriginalSceneChange[]=[];
 const visit=(a:unknown,b:unknown,path:string):void=>{
  if(canonical(a)===canonical(b))return;
  if(path==='/objects'&&Array.isArray(a)&&Array.isArray(b)){
   const old=a as Array<{id:string}>,next=b as Array<{id:string}>;
   const oldIds=new Set(old.map(item=>item.id)),newIds=new Set(next.map(item=>item.id));
   // Reordering remains unsupported until it has an explicit review surface.
   if(canonical(old.filter(item=>newIds.has(item.id)).map(item=>item.id))!==canonical(next.filter(item=>oldIds.has(item.id)).map(item=>item.id)))throw new Error('ORIGINAL_REVIEW_OBJECT_ORDER_CHANGED');
   const oldMap=new Map(old.map(item=>[item.id,item])),newMap=new Map(next.map(item=>[item.id,item]));
   for(const id of [...new Set([...oldMap.keys(),...newMap.keys()])])visit(oldMap.get(id),newMap.get(id),`${path}/by-id/${id}`);
   return;
  }
  if((Array.isArray(a)||a===undefined)&&(Array.isArray(b)||b===undefined)&&(Array.isArray(a)||Array.isArray(b))){
   const x=Array.isArray(a)?a:[],y=Array.isArray(b)?b:[];
   if(!x.length&&!y.length)changes.push({path:path||'/',before:a===undefined?{present:false}:{present:true,value:a},after:b===undefined?{present:false}:{present:true,value:b}});
   else for(let i=0;i<Math.max(x.length,y.length);i++)visit(x[i],y[i],`${path}/${i}`);
  }
  else if((a===undefined||!!a&&typeof a==='object'&&!Array.isArray(a))&&(b===undefined||!!b&&typeof b==='object'&&!Array.isArray(b))&&(a!==undefined||b!==undefined)){
   const x=(a??{}) as Record<string,unknown>,y=(b??{}) as Record<string,unknown>;
   const keys=[...new Set([...Object.keys(x),...Object.keys(y)])].sort();
   if(!keys.length)changes.push({path:path||'/',before:a===undefined?{present:false}:{present:true,value:a},after:b===undefined?{present:false}:{present:true,value:b}});
   else for(const key of keys)visit(x[key],y[key],`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`);
  }else changes.push({path:path||'/',before:a===undefined?{present:false}:{present:true,value:a},after:b===undefined?{present:false}:{present:true,value:b}});
  if(changes.length>512)throw new Error('ORIGINAL_REVIEW_DIFF_TOO_LARGE');
 };
 visit(before,after,'');
 // The RPC stores the raw candidate so omitted defaults and original colors survive.
 return {base,candidate:(normalized?candidate:rawCandidate as Scene),before,after,changes};
}
