import {isStructuralMarker} from './structural-layout';
import type {CandidateInventory, CandidateInventoryEntry} from './candidate-inventory';
import type {RoomLayout} from './types';

/** In-memory only. The caller supplies an actor/activity/session scope, not a display name. */
export interface SessionCandidateInventory {scope:string;entries:CandidateInventoryEntry[];invalidInputValues?:Record<string,string>}

function entryKey(entry:Pick<CandidateInventoryEntry,'identity'|'dimensions'>):string|null {
 const {identity,dimensions}=entry;
 if(!identity||identity.kind!=='asset_id'||typeof identity.value!=='string'||!identity.value.trim()||identity.value!==identity.value.trim()||identity.value==='asset'||!dimensions||![dimensions.width,dimensions.depth,dimensions.height].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0))return null;
 return JSON.stringify([identity.kind,identity.value,dimensions.width,dimensions.depth,dimensions.height]);
}

/** Same identity precedence as candidate inventory review; never infer identity from a name. */
function candidateKeys(candidate:RoomLayout):Set<string>|null {
 if(!candidate||!Array.isArray(candidate.floors)||candidate.floors.some(f=>!f||!Array.isArray(f.items)))return null;
 const keys=new Set<string>();
 for(const floor of candidate.floors)for(const item of floor.items){
  if(!item||typeof item!=='object')return null;
  if(isStructuralMarker(item))continue;
  const asset=item.assetId,material=item.materialId;
  if((asset!==undefined&&(typeof asset!=='string'||!asset.trim()||asset!==asset.trim()))||(material!==undefined&&(typeof material!=='string'||!material.trim()||material!==material.trim())))continue;
  if(!asset&&(material==='asset'||item.type==='glb-asset'||item.glbUrl||item.source==='generated'||item.source==='public_library'))continue;
  const key=entryKey({identity:{kind:asset?'asset_id':material?'material_id':'type',value:asset||material||item.type},dimensions:{width:item.width,depth:item.depth,height:item.height}});
  if(key)keys.add(key);
 }
 return keys;
}

function copy(entry:CandidateInventoryEntry):CandidateInventoryEntry {
 return {...entry,identity:{...entry.identity},dimensions:{...entry.dimensions}};
}

/** Only an explicit asset identity carries counts between candidates; categories are ambiguous. */
export function inventoryForSessionCandidate(memory:SessionCandidateInventory|null,scope:string,candidate:RoomLayout):CandidateInventory|undefined {
 if(!scope||!memory||memory.scope!==scope)return undefined;
 const keys=candidateKeys(candidate);if(!keys)return undefined;
 const entries=memory.entries.filter(entry=>{const key=entryKey(entry);return key!==null&&keys.has(key);}).map(copy);
 const invalidInputValues=Object.fromEntries(Object.entries(memory.invalidInputValues??{}).filter(([key])=>keys.has(key)));
 const invalidInput=Object.keys(invalidInputValues).length>0;
 return entries.length||invalidInput?{origin:'user_reported',entries,...(invalidInput?{invalidInput:true,invalidInputValues}:{})}:undefined;
}

/** Replace the visible candidate rows, retaining explicit counts for other exact specifications. */
export function rememberSessionCandidateInventory(memory:SessionCandidateInventory|null,scope:string,candidate:RoomLayout,inventory:CandidateInventory|undefined):SessionCandidateInventory|null {
 if(!scope)return null;
 const keys=candidateKeys(candidate);if(!keys)return memory?.scope===scope?memory:null;
 if(inventory&&inventory.origin!=='user_reported')return memory?.scope===scope?memory:null;
 const invalidInputs=inventory?.invalidInputValues??{};
 if(typeof invalidInputs!=='object'||Array.isArray(invalidInputs)||Object.values(invalidInputs).some(value=>typeof value!=='string'))return memory?.scope===scope?memory:null;
 if(inventory?.invalidInput&&!Object.keys(invalidInputs).length)return memory?.scope===scope?memory:null;
 const invalidKeys=new Set(Object.keys(invalidInputs).filter(key=>keys.has(key)));
 const supplied=inventory?.entries??[],next:CandidateInventoryEntry[]=[],seen=new Set<string>();
 for(const entry of supplied){
  // Built-in material IDs are categories, not physical item or SKU IDs.
  if(entry?.identity?.kind==='type'||entry?.identity?.kind==='material_id')continue;
  const key=entryKey(entry);
  if(!key||!keys.has(key)||invalidKeys.has(key)||seen.has(key)||typeof entry.name!=='string'||!entry.name.trim()||!Number.isSafeInteger(entry.available)||entry.available<0)return memory?.scope===scope?memory:null;
  seen.add(key);next.push(entry);
 }
 const retained=memory?.scope===scope?memory.entries.filter(entry=>{const key=entryKey(entry);return key!==null&&(!keys.has(key)||invalidKeys.has(key));}).map(copy):[];
 const invalidInputValues=Object.fromEntries([
  ...Object.entries(memory?.scope===scope?memory.invalidInputValues??{}:{}).filter(([key])=>!keys.has(key)),
  ...Object.entries(invalidInputs).filter(([key])=>invalidKeys.has(key)),
 ]);
 return {scope,entries:[...retained,...next.map(copy)],...(Object.keys(invalidInputValues).length?{invalidInputValues}:{})};
}
