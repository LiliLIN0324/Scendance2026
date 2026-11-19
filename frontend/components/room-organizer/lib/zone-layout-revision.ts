import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { OutdoorBrief } from './outdoor-agent-contract';
import { clearForObject, validateWorkflowPlan } from './outdoor-agent-planning';
import { facilityFootprintRing } from './site-plan-facilities';
import { outdoorRingsOverlap } from './outdoor-event-logic';
import { checkBoundaryRing, planPointInRing } from './site-plan-editing';

const box=(ring:PlanPoint[])=>({w:Math.min(...ring.map(p=>p.x)),e:Math.max(...ring.map(p=>p.x)),s:Math.min(...ring.map(p=>p.y)),n:Math.max(...ring.map(p=>p.y))});
const center=(ring:PlanPoint[])=>{const b=box(ring);return{x:(b.w+b.e)/2,y:(b.s+b.n)/2};};
const norm=(name:string)=>name.replace(/区域|分区|区/g,'').trim();
const locked=(notes:string)=>/锁定|不可移动|固定位置|保留原位/.test(notes);
function clip(ring:PlanPoint[],b:ReturnType<typeof box>):PlanPoint[]{
  let result=ring;
  for(const [axis,value,greater] of [['x',b.w,true],['x',b.e,false],['y',b.s,true],['y',b.n,false]] as const){
    const old=result;result=[];
    for(let i=0;i<old.length;i++){const a=old[i],z=old[(i+1)%old.length],inside=greater?a[axis]>=value:a[axis]<=value,next=greater?z[axis]>=value:z[axis]<=value;
      if(inside)result.push(a);if(inside!==next){const t=(value-a[axis])/(z[axis]-a[axis]);result.push({x:a.x+t*(z.x-a.x),y:a.y+t*(z.y-a.y)});}}
  }
  const unique=result.filter((p,i)=>!i||Math.hypot(p.x-result[i-1].x,p.y-result[i-1].y)>0.001);
  if(unique.length>1&&Math.hypot(unique[0].x-unique.at(-1)!.x,unique[0].y-unique.at(-1)!.y)<0.001)unique.pop();
  return unique;
}

/** 分区局部修改的输入；由工作流按用户原话填，数字必须有依据。 */
export type ZoneLayoutEdit = {
  relayout?: boolean;
  targetId?: string;
  targetName?: string;
  areaScale?: number;
  widthM?: number;
  depthM?: number;
  shiftEastM?: number;
  shiftNorthM?: number;
};

export async function reviseZoneLayout(input:{plan:SitePlanData;edit:ZoneLayoutEdit;brief:OutdoorBrief;hardBlocks:PlanPoint[][];signal:AbortSignal}):Promise<{plan:SitePlanData;notes:string[]}>{
  const base=input.plan,edit=input.edit,notes:string[]=[];
  let targets=edit.relayout?base.zones:base.zones.filter(zone=>edit.targetId?zone.id===edit.targetId:edit.targetName&&(zone.name===edit.targetName||norm(zone.name).includes(norm(edit.targetName))));
  if(!edit.relayout&&targets.length!==1)throw new Error('请说要改哪个分区的名称；这次没有替你猜一个同名区域。');
  const fixed=new Set(base.zones.filter(zone=>locked(zone.notes)||base.facilities.some(facility=>facility.zoneId===zone.id&&locked(facility.notes))).map(zone=>zone.id));
  targets=targets.filter(zone=>!fixed.has(zone.id));
  if(!targets.length)return{plan:base,notes:['目标区域包含明确锁定的位置或物件，先保留现状；可以用聊天解除锁定后继续调整。']};
  let zones=base.zones.map(zone=>({...zone,polygon:zone.polygon.map(p=>({...p}))}));
  if(edit.relayout){
    const boundary=box(base.boundary),cols=Math.ceil(Math.sqrt(targets.length)),rows=Math.ceil(targets.length/cols);
    const margin=Math.min(2,(boundary.e-boundary.w)*0.04,(boundary.n-boundary.s)*0.04),gap=Math.min(2,(boundary.e-boundary.w)*0.03,(boundary.n-boundary.s)*0.03);
    const width=(boundary.e-boundary.w-2*margin)/cols,depth=(boundary.n-boundary.s-2*margin)/rows,occupied:PlanPoint[][]=zones.filter(zone=>fixed.has(zone.id)).map(zone=>zone.polygon);
    const slots=Array.from({length:cols*rows},(_,i)=>({i,col:i%cols,row:Math.floor(i/cols)}));
    for(let index=0;index<targets.length;index++){
      input.signal.throwIfAborted();const zone=targets[index],position=input.brief.zones.find(need=>need.name===zone.name)?.position;
      const col=position?.includes('east')?cols-1:position?.includes('west')?0:index%cols;
      const row=position?.includes('north')?0:position?.includes('south')?rows-1:Math.floor(index/cols);
      const candidates=[...slots].sort((a,z)=>Math.hypot(a.col-col,a.row-row)-Math.hypot(z.col-col,z.row-row));
      let found:PlanPoint[]|null=null;
      for(const slot of candidates){const polygon=clip(base.boundary,{w:boundary.w+margin+slot.col*width+gap/2,e:boundary.w+margin+(slot.col+1)*width-gap/2,
        n:boundary.n-margin-slot.row*depth-gap/2,s:boundary.n-margin-(slot.row+1)*depth+gap/2});
        if(checkBoundaryRing(polygon).ok&&!occupied.some(ring=>outdoorRingsOverlap(ring,polygon))){found=polygon;break;}}
      if(found){occupied.push(found);zones=zones.map(item=>item.id===zone.id?{...item,polygon:found!}:item);}
      else notes.push(`${zone.name}暂时保留原位置，其余可调整部分继续生成草案。`);
    }
    notes.push('重新分配整个活动范围，保留分区身份与用途，按当前条件联动物料；没有沿用“已过分区阶段”的限制。');
  }else{
    const target=targets[0],b=box(target.polygon),cx=(b.w+b.e)/2,cy=(b.s+b.n)/2;
    const scale=Math.sqrt(edit.areaScale??1),sx=edit.widthM?(edit.widthM/(b.e-b.w)):scale,sy=edit.depthM?(edit.depthM/(b.n-b.s)):scale;
    const polygon=target.polygon.map(p=>({x:cx+(p.x-cx)*sx+(edit.shiftEastM??0),y:cy+(p.y-cy)*sy+(edit.shiftNorthM??0)}));
    zones=zones.map(zone=>zone.id===target.id?{...zone,polygon}:zone);
    notes.push(`${target.name}按本次要求调整${edit.areaScale?`，面积比例 ${edit.areaScale}`:''}；其他分区保持原样。`);
  }
  const changed=new Set(zones.filter(zone=>JSON.stringify(zone.polygon)!==JSON.stringify(base.zones.find(old=>old.id===zone.id)?.polygon)).map(zone=>zone.id));
  const moving=base.facilities.filter(facility=>changed.has(facility.zoneId??''));
  const working:SitePlanData={...base,zones,facilities:base.facilities.filter(facility=>!changed.has(facility.zoneId??'')),workers:[...base.workers]};
  const pending:string[]=[];
  for(const facility of [...moving].sort((a,z)=>z.size.width*z.size.depth-a.size.width*a.size.depth)){
    input.signal.throwIfAborted();const zone=zones.find(item=>item.id===facility.zoneId)!,old=base.zones.find(item=>item.id===facility.zoneId)!;
    const a=box(old.polygon),b=box(zone.polygon),preferred={x:b.w+(facility.position.x-a.w)/Math.max(0.01,a.e-a.w)*(b.e-b.w),y:b.s+(facility.position.y-a.s)/Math.max(0.01,a.n-a.s)*(b.n-b.s)};
    const step=Math.max(0.5,Math.min(facility.size.width,facility.size.depth));const points=[preferred,facility.position];
    for(let y=b.s+step/2;y<b.n&&points.length<1800;y+=step)for(let x=b.w+step/2;x<b.e&&points.length<1800;x+=step)points.push({x,y});
    const position=points.find(point=>{const item={...facility,position:point};return clearForObject(item,working,zone)&&!input.hardBlocks.some(ring=>outdoorRingsOverlap(facilityFootprintRing(item),ring));});
    if(position)working.facilities.push({...facility,position});else pending.push(facility.name);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  working.workers=working.workers.map(worker=>{
    if(!worker.zoneId||!changed.has(worker.zoneId))return worker;
    const zone=zones.find(item=>item.id===worker.zoneId)!;
    return planPointInRing(worker.position,zone.polygon)?worker:{...worker,position:center(zone.polygon)};
  });
  let issue=pending.length?`${pending.slice(0,4).join('、')}等 ${pending.length} 件物料尚待重新安排`:'';
  if(!issue){try{validateWorkflowPlan(base,working);}catch(error){issue=error instanceof Error?error.message:'局部几何还有冲突';}}
  if(!issue)return{plan:working,notes:[...notes,`已联动安排 ${moving.length} 件关联物料；原有路线保留，可继续重新排流线。`]};
  // A valid plan plus visible intent is preferable to an opaque retry-only failure.
  const annotations=[...(base.annotations??[])];
  for(const zone of zones.filter(item=>changed.has(item.id))){
    if(annotations.length>497)break;const b=box(zone.polygon);
    annotations.push({id:crypto.randomUUID(),kind:'rect',name:`目标范围：${zone.name}`.slice(0,60),points:[{x:b.w,y:b.s},{x:b.e,y:b.n}],color:'#96651f',strokeWidth:'thin',text:'',notes:'目标范围示意，尚未替换现有分区。'},
      {id:crypto.randomUUID(),kind:'note',name:'分区调整草案',points:[center(zone.polygon)],text:`${zone.name}调整意图：${issue}。保留现有物料，先展示目标范围，可继续用聊天改。`.slice(0,200),notes:'待完善的目标范围；不代表已经完成物理布置。'});
  }
  return{plan:{...base,annotations},notes:[...notes,`已先把目标范围画在方案中：${issue}。现有布置完整保留，可继续缩小改动或调整物料，不需要重走后续阶段。`]};
}
