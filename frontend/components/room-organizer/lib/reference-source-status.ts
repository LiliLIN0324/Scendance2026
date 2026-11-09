/** A presence observation is not proof that a reference file or site is authentic. */
export type ReferenceSourceStatus =
  | {status:'not_applicable';message:string}
  | {status:'unknown';message:string};

/** Current proposal/export paths have no complete, version-bound source read. */
export const REFERENCE_SOURCE_UNVERIFIED = '图纸和照片资料状态、原件版本及其与场地的对应关系尚未核验。';

export function referenceSourceStatus(input:{
  hasReference:boolean;
  localRead:'ready'|'pending'|'failed';
  remoteRead:'ready'|'pending'|'failed'|'not_required';
}):ReferenceSourceStatus {
  if(input.hasReference)return {status:'unknown',message:'图纸或照片原件版本尚未核验，与当前场地的对应关系仍需确认。'};
  if(input.localRead!=='ready'||(input.remoteRead!=='ready'&&input.remoteRead!=='not_required'))return {status:'unknown',message:REFERENCE_SOURCE_UNVERIFIED};
  return {status:'not_applicable',message:'当前工作台已读取的资料中未发现图纸或照片；其他位置的资料未核对。'};
}
