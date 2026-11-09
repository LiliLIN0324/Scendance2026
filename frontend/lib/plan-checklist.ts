import type { PlanAnnotation } from './plan-annotation';
import type { ZoneFurniturePlacement } from './plan-approve';
import { evaluateHumanFactors, type CheckStatus } from './human-factors';
import { evaluateReachability } from './flow-constraints';

export interface PlanChecklistEntry {
  id: string;
  status: CheckStatus;
  applicability: string;
  evidence: string[];
  ruleScope: string;
}
export interface PlanChecklistInput {
  placements: readonly ZoneFurniturePlacement[];
  annotations: readonly PlanAnnotation[];
  roomSize?: {width:number;height:number};
  /** 仅明确选择不设签到时可传 false；缺失代表未知。 */
  checkinRequired?: boolean;
}

/** 草案检查清单；不是规范审查，也不能作为交付或验收凭证。 */
export function buildPlanChecklist(input:PlanChecklistInput):PlanChecklistEntry[] {
  const {placements,annotations,roomSize}=input;
  const sizeOK=!!roomSize&&Number.isFinite(roomSize.width)&&Number.isFinite(roomSize.height)&&roomSize.width>0&&roomSize.height>0;
  const rects=annotations.filter(a=>a.kind==='zone'&&a.geometry.kind==='rect');
  const doors=annotations.filter(a=>a.kind==='door'&&a.geometry.kind==='door');
  const checkins=rects.filter(a=>a.zoneType==='checkin');
  const desks=placements.filter(p=>p.spec.type==='table'&&p.zoneType==='checkin');
  const chairs=placements.filter(p=>p.spec.type==='dining-chair');
  const benches=placements.filter(p=>p.spec.type==='bench');
  const human=evaluateHumanFactors(placements,annotations);
  const reach=evaluateReachability(placements,annotations,roomSize);
  const checks:PlanChecklistEntry[]=[];
  const add=(id:string,status:CheckStatus,applicability:string,evidence:string[],ruleScope:string)=>checks.push({id,status,applicability,evidence,ruleScope});
  add('room-size','unknown',sizeOK?'已提供宽深数值；来源、测量误差和现场一致性未由本检查核实。':'缺少有效场地宽深，无法执行可靠几何检查。',sizeOK?[`宽 ${roomSize!.width} 米，深 ${roomSize!.height} 米`]:[],'仅记录矩形数值；不核验比例尺、形状或规范。');
  add('door','unknown',doors.length?'已有门标注，真实位置、净宽和开向仍未核验。':'没有门标注，不能判定出入口或门扇。',doors.map(d=>`门标注 ${d.id}`),'不判断消防出口或门扇通过。');
  const coincident:string[]=[];
  for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
    const a=placements[i]!,b=placements[j]!;
    if([a.x,a.z,a.spec.width,a.spec.depth,b.x,b.z,b.spec.width,b.spec.depth].every(Number.isFinite)
      &&a.spec.width>0&&a.spec.depth>0&&b.spec.width>0&&b.spec.depth>0&&a.x===b.x&&a.z===b.z){
      coincident.push(`候选物料 ${i+1}（区域 ${a.zoneId}）与 ${j+1}（区域 ${b.zoneId}）中心重合`);
    }
  }
  add('coincident-centres',coincident.length?'violated':'unknown',coincident.length?'发现正尺寸物料中心重合，需要调整。':'未发现中心完全重合；不代表没有其他碰撞。',coincident,'仅检查本次候选正尺寸矩形的相同中心，不覆盖其他相交或既有物料。');
  for(const [id,objects,code,label] of [['chair-gap',chairs,'CHAIR_GAP','餐椅'],['bench-gap',benches,'AISLE_CLEARANCE','长椅']] as const){
    const warnings=human.filter(v=>v.code===code).map(v=>v.message);
    add(id,objects.length<2?'not_applicable':'unknown',objects.length<2?`本次候选少于两把${label}，该两两中心距估算不适用。`:`本次候选有 ${objects.length} 件${label}；中心距不能证明实际使用安全。`,warnings,'只针对本次候选中同类物件的中心距；不覆盖既有物件、方向或人体空间。');
  }
  const noCheckin=input.checkinRequired===false&&checkins.length===0&&desks.length===0;
  const queueEvidence=human.filter(v=>v.code==='CHECKIN_QUEUE').map(v=>v.message);
  add('checkin-queue',noCheckin?'not_applicable':'unknown',noCheckin?'已明确不设签到，且本次候选未标注签到区或签到台。':!checkins.length?'签到需求或区域尚未确认，无法核对排队。':!desks.length?'已有签到区但未找到签到台，无法核对排队。':'已有签到区与签到台；排队方向、人数和服务能力未核验。',queueEvidence,'仅估算区域一侧距离，不模拟排队或核验通行。');
  add('boundary-reachability','unknown',sizeOK?'边界网格采样不能代表真实入口和疏散路线。':'缺少有效场地尺寸，边界网格未运行。',reach.violations.filter(v=>v.code==='ZONE_UNREACHABLE'||v.code==='FLOW_ANALYSIS_LIMIT').map(v=>v.message),'0.3 米网格边界采样，未包含人体轮廓和转弯。');
  for(const [from,to] of [['checkin','roundtable'],['roundtable','rest'],['photo','rest']] as const){
    const fromZones=rects.filter(z=>z.zoneType===from),toZones=rects.filter(z=>z.zoneType===to);
    const ids=new Set(fromZones.map(z=>z.id)), targets=new Set(toZones.map(z=>z.id));
    const results=reach.pairReachability.filter(p=>ids.has(p.from)&&targets.has(p.to));
    add(`pair:${from}:${to}`,'unknown',!sizeOK?'缺少有效场地尺寸，未运行区域对采样。':!fromZones.length||!toZones.length?'区域对标注不完整，尚无法确定是否适用或采样。':!results.length?'区域对采样点不可用，未运行该项。':'采样仅覆盖每类首个区域，真实路线与使用者仍需核对。',results.map(p=>`${p.from} → ${p.to}：${p.connected?'采样点网格连通':'采样点网格未连通'}`),'固定区域对的采样点网格，不代表真实通道可用。');
  }
  for(const [id,label] of [['egress','出口与疏散'],['fire','消防'],['accessibility','无障碍'],['occupancy','核定人数']] as const){
    add(id,'unknown',`${label}缺少可核验的现场事实及适用规则。`,[],'本检查未覆盖该项；无规则版本及专业验收结论。');
  }
  return checks;
}

/** 导出时无候选快照，逐项标未知，不以空数组冒充没有区域或物件。 */
export function unavailablePlanChecklist():PlanChecklistEntry[] {
  return buildPlanChecklist({placements:[],annotations:[]}).map(entry=>({
    ...entry,status:'unknown',applicability:'导出时未提供本次候选及活动需求，无法核对此项。',evidence:[],
  }));
}
