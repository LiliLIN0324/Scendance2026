/** 项目重建只生成探索草案；目前没有可作为现场或规范验收依据的检查。 */
export interface ReconstructionSafetyCheck {
  id:'entrances_exits'|'door_swing'|'scale'|'egress'|'fire'|'accessibility'|'occupancy';
  status:'unknown'; label:string; note:string;
}
export function reconstructionSafetyChecklist(scene:unknown):{state:'draft_unverified';deliverable:false;checks:ReconstructionSafetyCheck[]} {
  const s=scene && typeof scene==='object'&&!Array.isArray(scene)?scene as Record<string,unknown>:null;
  const structure=s?.structure && typeof s.structure==='object'&&!Array.isArray(s.structure)?s.structure as Record<string,unknown>:null;
  const venue=s?.venue && typeof s.venue==='object'&&!Array.isArray(s.venue)?s.venue as Record<string,unknown>:null;
  const hasDoor=Array.isArray(structure?.openings)&&structure.openings.some((item:unknown)=>!!item&&typeof item==='object'&&(item as {kind?:unknown}).kind==='door');
  const hasEntrance=Array.isArray(venue?.entrances)&&venue.entrances.length>0;
  return {state:'draft_unverified',deliverable:false,checks:[
    {id:'entrances_exits',status:'unknown',label:'门与出口',note:hasDoor||hasEntrance?'已有门或入口记录，但出口用途、位置及现场状态未核验。':'未记录门或入口，出口位置和数量未知。'},
    {id:'door_swing',status:'unknown',label:'门扇与净宽',note:'门扇开启方向、铰链与净宽未核验。'},
    {id:'scale',status:'unknown',label:'场地尺度',note:'图中尺寸及其来源、误差与现场一致性尚未完整核验。'},
    {id:'egress',status:'unknown',label:'疏散与通行',note:'疏散路线、人流、排队、通行和转弯空间未核验。'},
    {id:'fire',status:'unknown',label:'消防',note:'适用法规、版本及现场消防条件尚未核验。'},
    {id:'accessibility',status:'unknown',label:'无障碍',note:'适用规则及实际使用条件尚未核验。'},
    {id:'occupancy',status:'unknown',label:'核定人数',note:'场地核定容量及本活动人数限制尚未核验。'},
  ]};
}
