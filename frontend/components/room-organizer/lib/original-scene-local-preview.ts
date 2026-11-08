import {canonical,sceneSchema,sha256} from '../../../../supabase/functions/_shared/domain';
import {prepareOriginalSceneReview} from '../../../../supabase/functions/_shared/original-scene-review';

/** Construct exactly one position change from the authorized raw record. */
export async function previewOriginalObjectMove(raw:unknown,originalSceneHash:string,objectId:string,x:number,z:number) {
  const snapshot:unknown=JSON.parse(canonical(raw));
  const parsed=sceneSchema.parse(snapshot);
  if(canonical(parsed)!==canonical(snapshot)||await sha256(canonical(snapshot))!==originalSceneHash)throw new Error('原始记录已变化，请重新读取。');
  const object=parsed.objects.find(item=>item.id===objectId);
  if(!object||object.locked||!Number.isFinite(x)||!Number.isFinite(z))throw new Error('物件不可修改，请重新选择。');
  const candidate=structuredClone(parsed),target=candidate.objects.find(item=>item.id===objectId);
  if(!target)throw new Error('物件不存在。');
  target.position={x,z};
  const review=prepareOriginalSceneReview(snapshot,candidate);
  if(!review.changes.length)throw new Error('坐标没有变化。');
  return {baseHash:originalSceneHash,candidateHash:await sha256(canonical(review.candidate)),candidateText:canonical(review.candidate),changes:review.changes};
}

/** Rebuild from the frozen base and compare every candidate field and diff. */
export async function verifyOriginalMoveSnapshot(input:{raw:unknown;revision:number;objectId:string;x:number;z:number;snapshotText:string;isCurrent:()=>boolean}) {
  if(!input.isCurrent())throw new Error('活动已变化。');
  const stored=JSON.parse(input.snapshotText) as {revision:number;baseHash:string;candidateHash:string;candidateText:string;changes:unknown};
  if(stored.revision!==input.revision)throw new Error('原始版本已变化。');
  const rebuilt=await previewOriginalObjectMove(input.raw,stored.baseHash,input.objectId,input.x,input.z);
  if(!input.isCurrent()||stored.candidateHash!==rebuilt.candidateHash||stored.candidateText!==rebuilt.candidateText||canonical(stored.changes)!==canonical(rebuilt.changes))throw new Error('候选已变化。');
  return rebuilt;
}

export function originalMovableObjects(raw:unknown) {
  const parsed=sceneSchema.safeParse(raw);
  if(!parsed.success||canonical(parsed.data)!==canonical(raw))return [];
  return parsed.data.objects.filter(object=>!object.locked).map(object=>({id:object.id,materialId:object.materialId,x:object.position.x,z:object.position.z}));
}
