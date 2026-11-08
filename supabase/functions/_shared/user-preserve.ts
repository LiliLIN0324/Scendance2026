/** Explicit user requests to retain every item and, separately, its position. */
export type UserPreserve = {keepAll:boolean;keepPositions:boolean};
export function readPreserveExisting(raw:string):UserPreserve|undefined {
  let found:UserPreserve|undefined;
  for(const part of raw.normalize('NFKC').split(/[，,；;。！!\n]/)){
    const clause=part.replace(/\s+/g,'');
    if(!clause||/(?:以前|上次|上一场|之前|历史)/.test(clause))continue;
    if(found?.keepAll&&/^(?:并且|且)?(?:位置不变|原位不动|都不移动|都不挪动)$/.test(clause)){found={keepAll:true,keepPositions:true};continue;}
    const all='(?:(?:所有|全部|全部的|所有的))?';
    const existing='(?:原物|原有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料)|现有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料)|已有(?:的)?(?:物件|物品|家具|桌椅|摆设|物料))';
    if(/(?:是否|要不要|能否|可不可以|[?？]|吗$)/.test(clause))continue;
    if(new RegExp(`(?:不必|无需|不需要|不用|不想|不要|别|取消)保留${all}${existing}`).test(clause)){found={keepAll:false,keepPositions:false};continue;}
    if(new RegExp(`(?:保留|保持)${all}${existing}|(?:不许|不要|不能|不得|别)(?:删除|移除)${all}${existing}`).test(clause)){
      found={keepAll:true,keepPositions:/(?:不动|不移动|不挪动|位置不变|原位)/.test(clause)};continue;
    }
    if(new RegExp(`(?:不许|不要|不能|不得|别)(?:移动|挪动)${all}${existing}`).test(clause))found={keepAll:true,keepPositions:true};
  }
  return found;
}
