import type { PlanFacility, PlanPoint, PlanRoute, PlanZone, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { OutdoorBrief, OutdoorLibraryItem } from './outdoor-agent-contract';
import { clearForObject, proposeInventoryObjects, proposeUseZones } from './outdoor-agent-planning';
import { facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';
import { checkBoundaryRing } from './site-plan-editing';
import { outdoorRingsOverlap } from './outdoor-event-logic';
import { eventLayoutPath } from './event-layout-path';

type Role = 'arch' | 'ceremony-chair' | 'banquet-table' | 'banquet-chair' | 'welcome-table' | 'sign' | 'photo' | 'rest-chair' | 'service-table';
type ZoneRole = 'ceremony' | 'banquet' | 'welcome' | 'photo' | 'rest' | 'service';
export const WEDDING_LIBRARY_QUERIES = ['拱门','背景','椅','桌','指示牌','花'];
export interface WeddingLayoutReport {
  plan: SitePlanData; notes: string[];
  quantities: Array<{ role: string; zone: string; requested: number; placed: number; placeholder: boolean }>;
}
const bounds=(ring:PlanPoint[])=>({w:Math.min(...ring.map(p=>p.x)),e:Math.max(...ring.map(p=>p.x)),s:Math.min(...ring.map(p=>p.y)),n:Math.max(...ring.map(p=>p.y))});
const center=(ring:PlanPoint[])=>{const b=bounds(ring);return{x:(b.w+b.e)/2,y:(b.s+b.n)/2};};
const roles:Record<ZoneRole,{name:string;purpose:NonNullable<PlanZone['purpose']>;semantic:PlanZone['semantic']}>= {
  ceremony:{name:'仪式观礼区',purpose:'audience',semantic:'audience'},banquet:{name:'宴席区',purpose:'audience',semantic:'audience'},
  welcome:{name:'迎宾签到区',purpose:'service',semantic:'checkin'},photo:{name:'合影区',purpose:'exhibition',semantic:'reserved'},
  rest:{name:'休息区',purpose:'service',semantic:'vip'},service:{name:'后勤备物区',purpose:'service',semantic:'loading'},
};
const roleOf=(zone:PlanZone):ZoneRole|null=> /宴|餐饮|餐区|用餐/.test(zone.name)?'banquet':/仪式|观礼|舞台|证婚/.test(zone.name)?'ceremony'
  :/签到|迎宾|接待/.test(zone.name)?'welcome':/合影|拍照|摄影/.test(zone.name)?'photo':/休息|长辈|贵宾/.test(zone.name)?'rest':/后勤|备物|备餐|服务/.test(zone.name)?'service':null;

function clipToRect(ring:PlanPoint[],box:{w:number;e:number;s:number;n:number}):PlanPoint[]{
  let result=ring.map(p=>({...p}));
  for(const [axis,value,greater] of [['x',box.w,true],['x',box.e,false],['y',box.s,true],['y',box.n,false]] as const){
    const old=result;result=[];
    for(let i=0;i<old.length;i++){
      const a=old[i],b=old[(i+1)%old.length],insideA=greater?a[axis]>=value:a[axis]<=value,insideB=greater?b[axis]>=value:b[axis]<=value;
      if(insideA)result.push(a);
      if(insideA!==insideB){const t=(value-a[axis])/(b[axis]-a[axis]);result.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)});}
    }
  }
  const unique=result.filter((p,i)=>!i||Math.hypot(p.x-result[i-1].x,p.y-result[i-1].y)>0.001);
  if(unique.length>1&&Math.hypot(unique[0].x-unique.at(-1)!.x,unique[0].y-unique.at(-1)!.y)<0.001)unique.pop();
  return unique;
}

function initialZones(plan:SitePlanData,brief:OutdoorBrief,strategy:'ceremony-first'|'banquet-first',notes:string[]):PlanZone[]{
  if(plan.zones.length){notes.push('保留已有分区几何和物件，只补充可识别用途的婚礼布置。');return plan.zones;}
  if(brief.zones.length){
    const zones=proposeUseZones(plan,{...brief,zones:brief.zones.map(zone=>({...zone,environment:zone.environment==='unknown'?'outdoor':zone.environment}))}).zones;
    for(const zone of zones){
      if(brief.zones.find(need=>need.name===zone.name)?.environment==='unknown'){
        zone.environment='unknown';zone.notes+='；室内外属性未知，本版只作概念布置，不代表真实室内边界。';
        notes.push(`${zone.name}的室内外属性未确认，保留未知状态并先画概念占位。`);
      }
    }
    notes.push('本轮分区来自已提供的名称、用途和方位；没有照搬默认婚礼分区覆盖它们。');
    return zones;
  }
  const b=bounds(plan.boundary),margin=Math.min(1.5,(b.e-b.w)*0.04,(b.n-b.s)*0.04);
  const w=b.w+margin,e=b.e-margin,s=b.s+margin,n=b.n-margin,h=n-s,width=e-w,gap=Math.min(0.7,h*0.02);
  const split=s+h*(strategy==='ceremony-first'?0.55:0.65),front=s+h*0.18;
  const boxes:Record<ZoneRole,{w:number;e:number;s:number;n:number}>= {
    ceremony:{w,e,s:split+gap,n},banquet:{w,e,s:front+gap,n:split-gap},
    welcome:{w,e:w+width*0.28-gap,s,n:front-gap},rest:{w:w+width*0.28+gap,e:w+width*0.53-gap,s,n:front-gap},
    photo:{w:w+width*0.53+gap,e:w+width*0.79-gap,s,n:front-gap},service:{w:w+width*0.79+gap,e,s,n:front-gap},
  };
  const zones:PlanZone[]=[];
  for(const role of Object.keys(roles) as ZoneRole[]){
    const polygon=clipToRect(plan.boundary,boxes[role]);
    if(!checkBoundaryRing(polygon).ok||facilityPlacementIssues(polygon,plan.boundary).length){
      notes.push(`${roles[role].name}在这块不规则场地内没有形成可用连续区域，本版未伪造边界。`);continue;
    }
    zones.push({id:crypto.randomUUID(),name:roles[role].name,semantic:roles[role].semantic,purpose:roles[role].purpose,
      environment:'outdoor',event:'婚礼',polygon,notes:'Agent 婚礼布局假设；可用聊天调整，不代表场地方已确认可用。'});
  }
  for(const key of Object.keys(roles) as ZoneRole[]){
    const polygon=clipToRect(plan.boundary,boxes[key]);
    if(!checkBoundaryRing(polygon).ok||facilityPlacementIssues(polygon,plan.boundary).length){notes.push(`${roles[key].name}未取得可用的连续区域，未强行绘制。`);continue;}
    zones.push({id:crypto.randomUUID(),...roles[key],polygon,environment:'outdoor',geometrySource:'map-unverified',event:'婚礼',notes:'Agent 婚礼起稿假设；分区不是场地方授权范围。'});
  }
  notes.push(`采用${strategy==='ceremony-first'?'仪式优先':'宴席优先'}布局，迎宾与后勤靠近入场侧，仪式区与宴席区分开；朝向按画布北侧起稿，不推断未知湖景方向。`);
  return zones;
}

const specs:Record<Role,{label:string;match:RegExp;width:number;depth:number}>= {
  arch:{label:'仪式背景',match:/婚礼拱门|花艺拱门|拱门|背景/,width:4,depth:1},
  'ceremony-chair':{label:'观礼椅',match:/椅子|折叠椅|单椅|餐椅/,width:0.5,depth:0.55},
  'banquet-table':{label:'宴席圆桌',match:/圆桌(?!与椅)|宴会桌|餐桌/,width:1.6,depth:1.6},
  'banquet-chair':{label:'宴席座椅',match:/椅子|折叠椅|单椅|餐椅/,width:0.5,depth:0.55},
  'welcome-table':{label:'签到桌',match:/签到台|接待台|长桌|桌子|餐桌/,width:2,depth:0.8},
  sign:{label:'迎宾指示牌',match:/指示牌|导向牌|迎宾牌/,width:0.6,depth:0.4},
  photo:{label:'合影背景',match:/合影|背景墙|背景板/,width:3,depth:0.6},
  'rest-chair':{label:'休息椅',match:/椅子|折叠椅|单椅|餐椅/,width:0.5,depth:0.55},
  'service-table':{label:'后勤备物桌',match:/长桌|桌子|餐桌/,width:1.8,depth:0.8},
};

export async function proposeWeddingLayout(input:{
  plan:SitePlanData;brief:OutdoorBrief;library:OutdoorLibraryItem[];strategy?:'ceremony-first'|'banquet-first';
  hardBlocks?:PlanPoint[][];signal:AbortSignal;onPhase?:(text:string)=>void;
}):Promise<WeddingLayoutReport>{
  if(!checkBoundaryRing(input.plan.boundary).ok)throw new Error('还没有可用的活动范围；先用聊天确认或调整 Agent 提出的范围。');
  const notes:string[]=[],quantities:WeddingLayoutReport['quantities']=[];
  const plan:SitePlanData={...input.plan,zones:initialZones(input.plan,input.brief,input.strategy??'ceremony-first',notes),facilities:[...input.plan.facilities],routes:[...input.plan.routes],nodes:[...input.plan.nodes]};
  const guests=input.brief.guests??60;
  if(!input.brief.guests)notes.push('人数未给定：暂按 60 人做桌椅需求草案，不写成已确认人数；实际摆下的数量会分别列出。');
  const blocked=[...(input.hardBlocks??[]),...(plan.buildings??[]).map(building=>building.points),...plan.zones.filter(zone=>zone.environment==='indoor').map(zone=>zone.polygon)];
  const zoneFor=(role:ZoneRole)=>plan.zones.find(zone=>roleOf(zone)===role&&zone.environment!=='indoor');
  const ceremony=zoneFor('ceremony'),banquet=zoneFor('banquet');
  const b=bounds(plan.boundary),cx=(b.w+b.e)/2;
  const entry=plan.nodes.find(node=>node.kind!=='exit');
  if(!entry)notes.push('入场路线从范围内的建议接驳点起稿，尚未识别或确认真实入口；不会把它登记成已核验的门。');
  const start=entry?.position??{x:cx,y:b.s+2};
  const routeWidth=Math.min(2.5,Math.max(1.2,(b.e-b.w)*0.06));
  const endpoint=ceremony?{x:center(ceremony.polygon).x,y:bounds(ceremony.polygon).n-4}:center(plan.boundary);
  const addRoute=(name:string,from:PlanPoint,to:PlanPoint,service=false):PlanRoute|null=>{
    const existing=plan.routes.find(route=>route.name===name);if(existing)return existing;
    const path=eventLayoutPath({boundary:plan.boundary,blocked:[...blocked,...plan.facilities.map(facilityFootprintRing)],start:from,end:to,widthM:service?1.5:routeWidth});
    if(!path){notes.push(`${name}未找到可容纳完整线宽的连续路径，未画穿障碍；需要调整分区或已放物件。`);return null;}
    const route:PlanRoute={id:crypto.randomUUID(),kind:service?'service':'pedestrian',carrier:'walk',audiences:service?['service','staff']:['visitors'],name,points:path,oneWay:false,widthM:service?1.5:routeWidth,notes:'婚礼联合草案：设计通道，宽度为假设；不证明现场出入口或疏散条件。'};
    if(entry&&Math.hypot(path[0].x-entry.position.x,path[0].y-entry.position.y)<0.1)route.startNodeId=entry.id;
    plan.routes.push(route);return route;
  };
  input.onPhase?.('先预留宾客主通道与服务通路');
  const main=addRoute('婚礼·宾客主通道',start,endpoint);
  if(!entry)notes.push('入场侧暂按南侧起稿，未新增或确认真实出入口；后续可用聊天指定入口。');
  const nearest=(target:PlanPoint):PlanPoint=>{
    if(!main)return start;
    let best=main.points[0],distance=Infinity;
    for(let i=1;i<main.points.length;i++){const a=main.points[i-1],z=main.points[i],dx=z.x-a.x,dy=z.y-a.y,t=Math.max(0,Math.min(1,((target.x-a.x)*dx+(target.y-a.y)*dy)/(dx*dx+dy*dy||1))),p={x:a.x+t*dx,y:a.y+t*dy},d=Math.hypot(p.x-target.x,p.y-target.y);if(d<distance){distance=d;best=p;}}
    return best;
  };
  for(const role of ['welcome','banquet','photo','rest'] as ZoneRole[]){const zone=zoneFor(role);if(zone&&main){const to=center(zone.polygon),from=nearest(to);if(Math.hypot(to.x-from.x,to.y-from.y)>1)addRoute(`婚礼·${roles[role].name}连接`,from,to);}}
  const service=zoneFor('service');if(service)addRoute('婚礼·后勤服务通路',{x:b.e-2,y:b.s+2},center(service.polygon),true);
  notes.push('通道先于物件预留；宾客与后勤路线是布局提案，交叉位置仍需按实际流程协调。');

  const materialFor=(role:Role)=>input.library.filter(item=>item.available&&!item.id.startsWith('icon:')&&specs[role].match.test(item.name)
    &&(!role.includes('chair')||!/与|组合|套装|连排|排椅|长椅|双人|沙发/.test(item.name))
    &&item.width>0&&item.depth>0&&item.width<=100&&item.depth<=100)
    .sort((a,z)=>(a.source==='personal'?0:1)-(z.source==='personal'?0:1)||a.width*a.depth-z.width*z.depth)[0];
  const handledNeeds=new Set<OutdoorBrief['items'][number]>();
  const globalCounts=new Map<OutdoorBrief['items'][number],number>();
  const wantedCount=(role:Role,zone:PlanZone,defaultCount:number):number=>{
    const need=input.brief.items.find(item=>(!item.zone||item.zone===zone.id||item.zone===zone.name)
      &&(specs[role].match.test(item.query)||item.query===specs[role].label));
    if(!need)return defaultCount;
    handledNeeds.add(need);
    if(!need.zone){
      const remaining=Math.max(0,need.count-(globalCounts.get(need)??0));
      const count=role.includes('chair')?Math.min(defaultCount,remaining):remaining;
      globalCounts.set(need,(globalCounts.get(need)??0)+count);
      return count;
    }
    return need.count;
  };
  const make=(role:Role,zone:PlanZone,n:number,position:PlanPoint,rotationDeg=0):PlanFacility=>{
    const material=materialFor(role),spec=specs[role];
    return{id:crypto.randomUUID(),templateId:material?`oneplan:${material.id}`.slice(0,64):`wedding-placeholder:${role}`,name:`${spec.label} ${n}`,
      zoneId:zone.id,position,rotationDeg,size:{width:material?.width??spec.width,depth:material?.depth??spec.depth},
      allocationKey:`wedding:${zone.id}:${role}:${n}`,
      ...(material?{sourceAssetId:material.id,modelOverride:material.modelSlug}:{}),
      notes:material?`婚礼联合草案；复用真实库物件「${material.name}」及其标称尺寸，实物库存未确认。`:`婚礼联合草案；缺少已匹配模型的尺寸占位件（${spec.width}×${spec.depth}米假设），待选型，不是已生成资产。`};
  };
  const canPlace=(facility:PlanFacility,zone:PlanZone,current:SitePlanData=plan)=>clearForObject(facility,current,zone)
    &&!blocked.some(ring=>outdoorRingsOverlap(facilityFootprintRing(facility),ring));
  const candidates=(zone:PlanZone,spacingX:number,spacingY:number,northFirst=false):PlanPoint[]=>{
    const box=bounds(zone.polygon),out:PlanPoint[]=[];
    for(let row=0;row<80;row++){
      const y=northFirst?box.n-spacingY/2-row*spacingY:box.s+spacingY/2+row*spacingY;
      if(y<box.s||y>box.n)break;
      for(let x=box.w+spacingX/2;x<box.e&&out.length<6500;x+=spacingX)out.push({x,y});
    }
    return out;
  };
  const fill=async(role:Role,zone:PlanZone|undefined,wanted:number,preferTop=false)=>{
    if(!zone){notes.push(`没有识别到${specs[role].label}的适用区域，未擅自另划区域。`);return;}
    wanted=wantedCount(role,zone,wanted);
    const existing=plan.facilities.filter(item=>item.zoneId===zone.id&&item.allocationKey?.startsWith(`wedding:${zone.id}:${role}:`));
    const material=materialFor(role),spec=specs[role];let placed=existing.length;
    const points=candidates(zone,(material?.width??spec.width)+0.3,(material?.depth??spec.depth)+0.5,preferTop);
    if(preferTop){const box=bounds(zone.polygon);points.unshift({x:(box.w+box.e)/2,y:box.n-(material?.depth??spec.depth)/2-0.4});}
    for(const point of points){if(placed>=wanted||plan.facilities.length>=1900)break;input.signal.throwIfAborted();const facility=make(role,zone,placed+1,point);if(canPlace(facility,zone)){plan.facilities.push(facility);placed++;}}
    quantities.push({role:spec.label,zone:zone.name,requested:wanted,placed,placeholder:!material});
    await new Promise(resolve=>setTimeout(resolve,0));input.signal.throwIfAborted();
  };
  input.onPhase?.('布置仪式背景、观礼座椅和迎宾设施');
  await fill('arch',ceremony,1,true);await fill('ceremony-chair',ceremony,guests,true);
  await fill('welcome-table',zoneFor('welcome'),1);await fill('sign',zoneFor('welcome'),2);
  await fill('photo',zoneFor('photo'),1,true);await fill('rest-chair',zoneFor('rest'),4);await fill('service-table',service,2);
  input.onPhase?.('按桌组成宴席桌椅，保留座椅到具体桌号的关联');
  if(banquet){
    const table=materialFor('banquet-table'),chair=materialFor('banquet-chair');
    const tableWidth=table?.width??1.6,tableDepth=table?.depth??1.6,chairWidth=chair?.width??0.5,chairDepth=chair?.depth??0.55;
    const radius=Math.hypot(tableWidth,tableDepth)/2+Math.hypot(chairWidth,chairDepth)/2+0.2,envelope=radius+Math.hypot(chairWidth,chairDepth)/2;
    let tables=plan.facilities.filter(item=>item.zoneId===banquet.id&&item.allocationKey?.startsWith(`wedding:${banquet.id}:banquet-table:`)).length;
    let seats=plan.facilities.filter(item=>item.zoneId===banquet.id&&item.allocationKey?.startsWith(`wedding:${banquet.id}:banquet-chair:`)).length;
    const wantedSeats=wantedCount('banquet-chair',banquet,guests);
    const wantedTables=wantedCount('banquet-table',banquet,Math.ceil(wantedSeats/8));
    for(const point of candidates(banquet,2*envelope+0.6,2*envelope+0.6)){
      if(tables>=wantedTables||plan.facilities.length+9>1900)break;input.signal.throwIfAborted();
      const tableNo=tables+1,group=[make('banquet-table',banquet,tableNo,point)];
      for(let seat=0;seat<Math.min(8,wantedSeats-seats);seat++){
        const angle=seat*Math.PI/4,facility=make('banquet-chair',banquet,seats+seat+1,{x:point.x+radius*Math.cos(angle),y:point.y+radius*Math.sin(angle)},((angle*180/Math.PI+90+180)%360)-180);
        facility.name=`宴席 ${tableNo} 桌 ${seat+1} 座`;facility.notes+=`；所属桌号 ${tableNo}，未分配具体宾客。`;group.push(facility);
      }
      const probe={...plan,facilities:[...plan.facilities]};let fits=true;
      for(const facility of group){if(!canPlace(facility,banquet,probe)){fits=false;break;}probe.facilities.push(facility);}
      if(fits){plan.facilities.push(...group);tables++;seats+=group.length-1;}
    }
    quantities.push({role:'宴席圆桌',zone:banquet.name,requested:wantedTables,placed:tables,placeholder:!table},{role:'宴席座椅',zone:banquet.name,requested:wantedSeats,placed:seats,placeholder:!chair});
  }
  for(const need of input.brief.items.filter(item=>!handledNeeds.has(item))){
    input.signal.throwIfAborted();
    const material=input.library.filter(item=>item.available&&!item.id.startsWith('icon:')&&(item.id===need.query||item.name.includes(need.query)))
      .sort((a,z)=>(a.name===need.query?0:1)-(z.name===need.query?0:1))[0];
    if(!material){notes.push(`另需 ${need.zone||'活动范围'} ${need.query}×${need.count}：库中没有匹配物料，未冒充已放置或已生成。`);continue;}
    try{
      const result=await proposeInventoryObjects(plan,{...input.brief,items:[{...need,query:material.id}]},[material],undefined,
        {hardBlocks:blocked,signal:input.signal,packed:true,softDemand:true});
      plan.facilities=result.plan.facilities;
      const targetZone=plan.zones.find(zone=>zone.id===need.zone||zone.name===need.zone);
      const placed=result.mismatched.length?0:plan.facilities.filter(item=>item.allocationKey?.endsWith(`:${material.id}`)&&(!targetZone||item.zoneId===targetZone.id)).length;
      quantities.push({role:need.query,zone:need.zone||'活动范围',requested:need.count,placed,placeholder:false});
      if(result.mismatched.length)notes.push(`${need.zone} 尚未对应到实际分区，${need.query} 保留为待落实需求。`);
    }catch(error){input.signal.throwIfAborted();notes.push(error instanceof Error?error.message:`${need.query} 暂未落位，原物料保留。`);}
  }
  for(const quantity of quantities){if(quantity.placed<quantity.requested)notes.push(`${quantity.zone}：${quantity.role}需要 ${quantity.requested} 件，实际放入 ${quantity.placed} 件，差 ${quantity.requested-quantity.placed} 件；未降低人数或硬塞。`);}
  for(const quantity of quantities){if(quantity.placed>quantity.requested)notes.push(`${quantity.zone}已有 ${quantity.placed} 件${quantity.role}，多于本轮 ${quantity.requested} 件需求；未擅自删除已有布置。`);}
  for(const role of ['观礼椅','宴席座椅']){
    const count=quantities.find(quantity=>quantity.role===role)?.placed??0;
    if(count<guests)notes.push(`${role}实际 ${count} 席，低于本版 ${guests} 人的安排目标；保留人数目标，需调整范围、物料或活动时段。`);
  }
  notes.push('观礼与宴席座椅分别计数，尚未假定两个环节之间搬运复用；此处只有物理座位，具体宾客分配留到名册安排。');
  const placeholders=plan.facilities.filter(item=>item.templateId.startsWith('wedding-placeholder:')).length;
  if(placeholders)notes.push(`${placeholders} 件为明确标注的尺寸占位件，缺少模型的品类需选型；没有提交生成或采购任务。`);
  if(!input.plan.zones.length)notes.push('草案尚未采用时，可直接说“换成宴席优先”或“换成仪式优先”比较两种分区配比。');
  if(input.brief.items.length)notes.push('明确物料数量优先于默认清单；未落实条目保留并逐项列明，不改写原需求。');
  if(!plan.facilities.length)throw new Error(notes.join(' ')||'当前范围没有可落位的婚礼物件，请用聊天调整尺寸或分区。');
  const annotations=(plan.annotations??[]).filter(annotation=>annotation.notes!=='wedding-layout:assumptions');
  if(annotations.length<500)plan.annotations=[...annotations,{id:crypto.randomUUID(),kind:'note',name:'婚礼起稿假设',points:[center(plan.boundary)],
    text:`${input.strategy==='banquet-first'?'宴席优先':'仪式优先'}；${input.brief.guests?'人数按已提供需求':'人数未提供，暂按60人起稿'}。占位件尺寸是估计，入场路线与真实门的关系需要核对。`,notes:'wedding-layout:assumptions'}];
  return{plan,notes,quantities};
}
