'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { formatMoneyMinor, parseMoneyMinor } from '@/lib/production-plan';
import { uuid } from '../../../../supabase/functions/_shared/domain';
import { productionAcquisitionMethods, productionStaffSources, productionPlanLimits, productionPlanSchema,
  productionEstimateSummary, resolveProductionPlanReferences, type ProductionPlan, type ProductionReferenceReview } from '../../../../supabase/functions/_shared/production-plan-contract';
import { fromShanghaiDateTimeInput, toShanghaiDateTimeInput } from '../lib/event-operations';
import type { RoomLayout } from '../lib/types';
import './production-plan-panel.css';

interface Props { layout:RoomLayout; disabled?:boolean; onUpdate?:((value:ProductionPlan|undefined)=>void)|undefined; onExport?:()=>void; exporting?:boolean }
interface Draft { plan:ProductionPlan; money:Record<string,string>; counts:Record<string,string>; times:Record<string,{arrival:string;departure:string}> }
const staffLabels={unspecified:'未确定',internal:'内部人员',outsourced:'外包人员'};
const methodLabels={unspecified:'未确定',existing:'已有',rental:'租赁',purchase:'采购',fabrication:'制作'};
const identity=(id:string)=>uuid.safeParse(id).success?id.toLowerCase():id;
const key=(plan:ProductionPlan|undefined)=>JSON.stringify(plan)??'not-recorded';
const copyDraft=(plan:ProductionPlan):Draft=>({plan:structuredClone(plan),money:{},counts:{},times:{}});

function people(value:string):number|null {
  const text=value.trim();if(!text)return null;
  if(!/^\d+$/.test(text)||BigInt(text)>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('人数请填写非负整数；留空表示未知。');
  return Number(text);
}
function time(value:string,original:string|null):string|null {
  if(value===toShanghaiDateTimeInput(original))return original;
  const parsed=fromShanghaiDateTimeInput(value);
  if(value&&!parsed)throw new Error('请填写真实的计划到离场时间，按北京时间填写。');
  return parsed;
}
function convert(draft:Draft):ProductionPlan {
  const plan=draft.plan;
  return {...plan,budget:plan.budget?{...plan.budget,limitMinor:parseMoneyMinor(draft.money.budget??formatMoneyMinor(plan.budget.limitMinor))}:null,
    staffing:plan.staffing.map(row=>{const times=draft.times[row.id];return {...row,
      headcount:people(draft.counts[row.id]??(row.headcount===null?'':String(row.headcount))),
      plannedArrivalAt:times?time(times.arrival,row.plannedArrivalAt):row.plannedArrivalAt,
      plannedDepartureAt:times?time(times.departure,row.plannedDepartureAt):row.plannedDepartureAt};}),
    estimates:plan.estimates.map(row=>({...row,amountMinor:parseMoneyMinor(draft.money[row.id]??formatMoneyMinor(row.amountMinor))}))};
}
function TextField({label,value,onChange,limit=productionPlanLimits.note,multiline=false}:{label:string;value:string;onChange(value:string):void;limit?:number;multiline?:boolean}):JSX.Element {
  return <label className="sc-field">{label}{multiline?<textarea rows={2} maxLength={limit} value={value} onChange={event=>onChange(event.target.value)}/>:<input maxLength={limit} value={value} onChange={event=>onChange(event.target.value)}/>}</label>;
}
function References({label,selected,known,onChange,type}:{label:string;selected:string[];known:{id:string;name:string}[];onChange(ids:string[]):void;type:'任务'|'物件'}):JSX.Element {
  const grouped=new Map<string,{id:string;name:string;count:number}>();
  known.forEach(entry=>{const id=identity(entry.id),previous=grouped.get(id);grouped.set(id,{...entry,count:(previous?.count??0)+1});});
  const unavailable=selected.filter(id=>grouped.get(identity(id))?.count!==1);
  const options=[...grouped.entries()].map(([id,entry])=>({...entry,id:selected.find(value=>identity(value)===id)??entry.id}));
  const missing=unavailable.filter(id=>!grouped.has(identity(id)));
  function choose(event:ChangeEvent<HTMLSelectElement>):void {
    const chosen=Array.from(event.currentTarget.selectedOptions,value=>value.value);
    const next=[...chosen];for(const id of unavailable)if(!next.some(value=>identity(value)===identity(id)))next.push(id);
    onChange(next);
  }
  return <div className="sc-production-refs"><label className="sc-field">{label}<select multiple size={Math.min(4,Math.max(2,options.length+missing.length))} value={selected} onChange={choose}>
    {options.map((entry,index)=><option key={identity(entry.id)} value={entry.id} disabled={entry.count!==1}>{entry.name} · {index+1}{entry.count!==1?'（关联不唯一）':''}</option>)}
    {missing.map((id,index)=><option key={id} value={id} disabled>原{type}已缺失 · {index+1}</option>)}
  </select></label>{unavailable.map(id=><button key={id} className="sc-button" type="button" aria-label={`移除${type}关联 ${selected.indexOf(id)+1}`} onClick={()=>onChange(selected.filter(value=>value!==id))}>移除{type}关联 {selected.indexOf(id)+1}</button>)}</div>;
}
function ReferenceNotice({review}:{review:ProductionReferenceReview|undefined}):JSX.Element|null {
  if(!review?.needsReview)return null;
  const missing=review.missingTaskIds.length+review.missingObjectIds.length,ambiguous=review.ambiguousTaskIds.length+review.ambiguousObjectIds.length;
  return <p className="sc-handoff-review">{review.unassigned?'尚未关联原任务或物件。 ':''}{missing?`有 ${missing} 项关联已缺失，原记录已保留。 `:''}{ambiguous?`有 ${ambiguous} 项关联不唯一，请人工核对。`:''}</p>;
}

export function ProductionPlanPanel({layout,disabled=false,onUpdate,onExport,exporting=false}:Props):JSX.Element {
  const [draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState('');
  const [badTimes,setBadTimes]=useState<string[]>([]);
  const [notice,setNotice]=useState<{scope:string;planKey:string;text:string}|null>(null);
  const state=useRef({layout,epoch:0});if(state.current.layout!==layout)state.current={layout,epoch:state.current.epoch+1};
  const baseline=useRef<{epoch:number;scope:string;planKey:string}|null>(null);
  const sourceKey=key(layout.productionPlan),scope=layout.id??'local';
  useEffect(()=>{setNotice(previous=>previous&&(previous.scope!==scope||previous.planKey!==sourceKey)?null:previous);},[scope,sourceKey]);
  const latest=useRef({layout,disabled,onUpdate,scope,sourceKey,epoch:state.current.epoch});latest.current={layout,disabled,onUpdate,scope,sourceKey,epoch:state.current.epoch};
  const stale=!!draft&&(!baseline.current||baseline.current.epoch!==state.current.epoch||baseline.current.scope!==scope||baseline.current.planKey!==sourceKey);
  const readOnly=disabled||!onUpdate;
  function begin(plan:ProductionPlan):void {if(readOnly)return;baseline.current={epoch:state.current.epoch,scope,planKey:sourceKey};setDraft(copyDraft(plan));setBadTimes([]);setError('');setNotice(null);}
  function change(update:(value:Draft)=>Draft):void {if(readOnly||stale)return;setDraft(current=>current?update(current):current);}
  function updatePlan(update:(value:ProductionPlan)=>ProductionPlan):void {change(value=>({...value,plan:update(value.plan)}));}
  function cancel():void {baseline.current=null;setDraft(null);setBadTimes([]);setError('');setNotice(null);}
  function save(event:FormEvent):void {
    event.preventDefault();const before=baseline.current,current=latest.current;
    if(!draft||!before||current.disabled||!current.onUpdate)return;
    if(badTimes.length){setError('请检查计划到离场时间，原记录和草稿已保留。');return;}
    if(current.epoch!==before.epoch||current.scope!==before.scope||current.sourceKey!==before.planKey){setError('当前资料已变化，请取消编辑后重新打开。');return;}
    try{
      const parsed=productionPlanSchema.safeParse(convert(draft));
      if(!parsed.success){const issue=parsed.error.issues[0],field=String(issue?.path.at(-1)??'');const labels:Record<string,string>={roleName:'岗位名称',title:'计划标题',headcount:'人数'};setError(issue?.code==='custom'?issue.message:`请检查${labels[field]??'制作计划内容'}，填写内容已保留。`);return;}
      current.onUpdate(parsed.data);baseline.current=null;setDraft(null);setError('');setNotice({scope:current.scope,planKey:key(parsed.data),text:'制作计划已提交更新，请留意本机保存状态。'});
    }catch(caught){setError(caught instanceof Error?caught.message:'制作计划未保存，填写内容已保留。');}
  }
  function removePlan():void {if(readOnly||draft)return;try{onUpdate?.(undefined);setNotice({scope,planKey:key(undefined),text:'制作计划已移除，可使用场景撤销恢复。'});}catch(caught){setError(caught instanceof Error?caught.message:'制作计划未移除，原资料已保留。');}}
  const shown:Draft|null=draft??(layout.productionPlan?{plan:layout.productionPlan,money:{},counts:{},times:{}}:null);
  const tasks=(layout.eventOperations?.tasks??[]).map(row=>({id:row.id,name:row.title})),objects=layout.floors.flatMap(floor=>floor.items.map(row=>({id:row.id,name:row.name})));
  const referencePlan=shown?productionPlanSchema.safeParse(shown.plan):null;
  const reviews=referencePlan?.success?resolveProductionPlanReferences(referencePlan.data,{taskIds:tasks.map(row=>row.id),objectIds:objects.map(row=>row.id)}):[];
  let summary:ReturnType<typeof productionEstimateSummary>|null=null,converted:ProductionPlan|null=null;
  try{if(shown){converted=convert(shown);summary=productionEstimateSummary(converted);}}catch{ /* Incomplete draft amounts are validated on Save. */ }
  const review=(id:string)=>reviews.find(value=>value.id===id);
  return <section className="sc-production-plan" aria-label="制作计划">
    <p className="sc-note">本地制作计划记录人员、物料取得和人工估算；岗位人数不是来宾人数，估算不代表报价或实付。</p>
    <p className="sc-note">关联可多选，电脑可按 Ctrl / ⌘ 选择多个；缺失关联请逐项移除。</p>
    {!shown?<><p className="sc-note">制作计划未记录。</p><button className="sc-button" type="button" disabled={readOnly} onClick={()=>begin(productionPlanSchema.parse({}))}>创建制作计划</button></>:<>
      {!draft&&<div className="sc-production-actions"><button className="sc-button" type="button" disabled={readOnly} onClick={()=>begin(shown.plan)}>编辑制作计划</button><button className="sc-button" type="button" disabled={readOnly} onClick={removePlan}>移除制作计划</button></div>}
      {stale&&<p className="sc-handoff-error" role="alert">当前项目或制作计划已变化，原草稿已保留；请取消编辑后按当前资料重新打开。</p>}
      <form aria-label={draft?'制作计划草稿':'制作计划记录'} onSubmit={save}><fieldset disabled={!draft||readOnly||stale}>
        <label className="sc-field">制作计划资料类型<select value={shown.plan.dataKind} onChange={event=>updatePlan(plan=>({...plan,dataKind:event.target.value as ProductionPlan['dataKind']}))}><option value="unspecified">未标注</option><option value="rehearsal">演练</option><option value="real">真实</option></select></label>
        <details open className="sc-production-section"><summary>岗位与班次 · {shown.plan.staffing.length} 项</summary>
          {shown.plan.staffing.map(row=>{const dates=shown.times[row.id]??{arrival:toShanghaiDateTimeInput(row.plannedArrivalAt),departure:toShanghaiDateTimeInput(row.plannedDepartureAt)};return <details open className="sc-production-row" key={row.id}><summary>{row.roleName||'新岗位'}</summary><fieldset aria-label={row.roleName||'新岗位'}>
            {(['roleName','shiftLabel','sourceName'] as const).map((field,index)=><TextField key={field} label={['岗位名称','班次','来源名称'][index]!} value={row[field]} limit={field==='sourceName'?productionPlanLimits.party:productionPlanLimits.title} onChange={value=>updatePlan(plan=>({...plan,staffing:plan.staffing.map(item=>item.id===row.id?{...item,[field]:value}:item)}))}/>)}
            <label className="sc-field">人数<input inputMode="numeric" value={shown.counts[row.id]??(row.headcount===null?'':String(row.headcount))} placeholder="未知" onChange={event=>change(value=>({...value,counts:{...value.counts,[row.id]:event.target.value}}))}/></label>
            <label className="sc-field">人员来源<select value={row.sourceType} onChange={event=>updatePlan(plan=>({...plan,staffing:plan.staffing.map(item=>item.id===row.id?{...item,sourceType:event.target.value as typeof row.sourceType}:item)}))}>{productionStaffSources.map(source=><option value={source} key={source}>{staffLabels[source]}</option>)}</select></label>
            <p className="sc-note">计划时间按北京时间填写，留空表示未知。</p>
            {(['arrival','departure'] as const).map((field,index)=><label className="sc-field" key={field}>{['计划到场','计划离场'][index]}<input type="datetime-local" step=".001" value={dates[field]} onChange={event=>{const id=`${row.id}:${field}`,inputValue=event.currentTarget.value,badInput=event.currentTarget.validity.badInput;if(badInput){setBadTimes(value=>value.includes(id)?value:[...value,id]);setError('请检查计划时间，原时间已保留。');return;}setBadTimes(value=>value.filter(item=>item!==id));change(value=>({...value,times:{...value.times,[row.id]:{...(value.times[row.id]??{arrival:toShanghaiDateTimeInput(row.plannedArrivalAt),departure:toShanghaiDateTimeInput(row.plannedDepartureAt)}),[field]:inputValue}}}));}}/></label>)}
            <References label="关联活动任务" type="任务" selected={row.taskIds} known={tasks} onChange={ids=>updatePlan(plan=>({...plan,staffing:plan.staffing.map(item=>item.id===row.id?{...item,taskIds:ids}:item)}))}/><ReferenceNotice review={review(row.id)}/>
            <button className="sc-button" type="button" onClick={()=>{setBadTimes(value=>value.filter(item=>!item.startsWith(`${row.id}:`)));updatePlan(plan=>({...plan,staffing:plan.staffing.filter(item=>item.id!==row.id)}));}}>移除岗位</button>
          </fieldset></details>;})}
          <button className="sc-button" type="button" disabled={shown.plan.staffing.length>=productionPlanLimits.records} onClick={()=>updatePlan(plan=>({...plan,staffing:[...plan.staffing,{id:crypto.randomUUID(),roleName:'',shiftLabel:'',headcount:null,sourceType:'unspecified',sourceName:'',plannedArrivalAt:null,plannedDepartureAt:null,taskIds:[]}]}))}>添加岗位</button>
        </details>
        <details open className="sc-production-section"><summary>物料取得 · {shown.plan.acquisitions.length} 项</summary>
          {shown.plan.acquisitions.map(row=><details open className="sc-production-row" key={row.id}><summary>{row.title||'新取得计划'}</summary><fieldset aria-label={row.title||'新取得计划'}>
            <TextField label="取得标题" value={row.title} limit={productionPlanLimits.title} onChange={value=>updatePlan(plan=>({...plan,acquisitions:plan.acquisitions.map(item=>item.id===row.id?{...item,title:value}:item)}))}/>
            <label className="sc-field">取得方式<select value={row.method} onChange={event=>updatePlan(plan=>({...plan,acquisitions:plan.acquisitions.map(item=>item.id===row.id?{...item,method:event.target.value as typeof row.method}:item)}))}>{productionAcquisitionMethods.map(method=><option value={method} key={method}>{methodLabels[method]}</option>)}</select></label>
            {(['supplierName','specificationNote','sourceNote','transportScope','installationScope'] as const).map((field,index)=><TextField key={field} label={['供应方','规格说明','来源说明','运输范围','安装范围'][index]!} value={row[field]} limit={field==='supplierName'?productionPlanLimits.party:productionPlanLimits.note} multiline={field!=='supplierName'} onChange={value=>updatePlan(plan=>({...plan,acquisitions:plan.acquisitions.map(item=>item.id===row.id?{...item,[field]:value}:item)}))}/>)}
            <References label="关联活动任务" type="任务" selected={row.taskIds} known={tasks} onChange={ids=>updatePlan(plan=>({...plan,acquisitions:plan.acquisitions.map(item=>item.id===row.id?{...item,taskIds:ids}:item)}))}/>
            <References label="关联场景物件" type="物件" selected={row.objectIds} known={objects} onChange={ids=>updatePlan(plan=>({...plan,acquisitions:plan.acquisitions.map(item=>item.id===row.id?{...item,objectIds:ids}:item)}))}/><ReferenceNotice review={review(row.id)}/>
            <button className="sc-button" type="button" onClick={()=>updatePlan(plan=>({...plan,acquisitions:plan.acquisitions.filter(item=>item.id!==row.id)}))}>移除取得计划</button>
          </fieldset></details>)}
          <button className="sc-button" type="button" disabled={shown.plan.acquisitions.length>=productionPlanLimits.records} onClick={()=>updatePlan(plan=>({...plan,acquisitions:[...plan.acquisitions,{id:crypto.randomUUID(),title:'',taskIds:[],objectIds:[],method:'unspecified',supplierName:'',specificationNote:'',sourceNote:'',transportScope:'',installationScope:''}]}))}>添加取得计划</button>
        </details>
        <details open className="sc-production-section"><summary>人工估算 · {shown.plan.estimates.length} 项</summary>
          {shown.plan.estimates.map(row=><details open className="sc-production-row" key={row.id}><summary>{row.title||'新估算'}</summary><fieldset aria-label={row.title||'新估算'}>
            <TextField label="估算标题" value={row.title} limit={productionPlanLimits.title} onChange={value=>updatePlan(plan=>({...plan,estimates:plan.estimates.map(item=>item.id===row.id?{...item,title:value}:item)}))}/>
            <label className="sc-field">人工估算金额（元）<input inputMode="decimal" value={shown.money[row.id]??formatMoneyMinor(row.amountMinor)} placeholder="未知" onChange={event=>change(value=>({...value,money:{...value.money,[row.id]:event.target.value}}))}/></label>
            <TextField label="估算依据" value={row.basisNote} multiline onChange={value=>updatePlan(plan=>({...plan,estimates:plan.estimates.map(item=>item.id===row.id?{...item,basisNote:value}:item)}))}/>
            <References label="关联活动任务" type="任务" selected={row.taskIds} known={tasks} onChange={ids=>updatePlan(plan=>({...plan,estimates:plan.estimates.map(item=>item.id===row.id?{...item,taskIds:ids}:item)}))}/>
            <References label="关联场景物件" type="物件" selected={row.objectIds} known={objects} onChange={ids=>updatePlan(plan=>({...plan,estimates:plan.estimates.map(item=>item.id===row.id?{...item,objectIds:ids}:item)}))}/><ReferenceNotice review={review(row.id)}/>
            <button className="sc-button" type="button" onClick={()=>updatePlan(plan=>({...plan,estimates:plan.estimates.filter(item=>item.id!==row.id)}))}>移除估算</button>
          </fieldset></details>)}
          <button className="sc-button" type="button" disabled={shown.plan.estimates.length>=productionPlanLimits.records} onClick={()=>updatePlan(plan=>({...plan,estimates:[...plan.estimates,{id:crypto.randomUUID(),title:'',taskIds:[],objectIds:[],amountMinor:null,basisNote:''}]}))}>添加估算</button>
        </details>
        <details open className="sc-production-section"><summary>人工预算上限</summary>{shown.plan.budget?<>
          <label className="sc-field">预算上限（元）<input inputMode="decimal" value={shown.money.budget??formatMoneyMinor(shown.plan.budget.limitMinor)} placeholder="未知" onChange={event=>change(value=>({...value,money:{...value.money,budget:event.target.value}}))}/></label>
          {(['scopeNote','basisNote'] as const).map((field,index)=><TextField key={field} label={['预算范围','预算依据'][index]!} value={shown.plan.budget![field]} multiline onChange={value=>updatePlan(plan=>({...plan,budget:plan.budget?{...plan.budget,[field]:value}:null}))}/>)}
          <button className="sc-button" type="button" onClick={()=>change(value=>{const money={...value.money};delete money.budget;return {...value,money,plan:{...value.plan,budget:null}};})}>移除预算上限</button>
        </>:<button className="sc-button" type="button" onClick={()=>updatePlan(plan=>({...plan,budget:{limitMinor:null,scopeNote:'',basisNote:''}}))}>添加预算上限</button>}</details>
      </fieldset>{draft&&<div className="sc-production-actions"><button className="sc-button" type="submit" disabled={readOnly||stale}>保存制作计划</button><button className="sc-button" type="button" onClick={cancel}>取消编辑</button></div>}</form>
      <div className="sc-production-summary" aria-label="制作估算摘要">{summary&&converted?<><p>已知部分估算合计 ¥{formatMoneyMinor(summary.knownTotalMinor)}</p><p>未知金额 {summary.unknownEstimateIds.length} 项</p><p>人工预算上限 {converted.budget?.limitMinor===null||!converted.budget?'未知':`¥${formatMoneyMinor(converted.budget.limitMinor)}`}</p>{!shown.plan.estimates.length&&<p>尚无估算记录，费用范围仍待填写。</p>}{summary.overLimit===true&&<p className="sc-handoff-review">已录入部分估算已超过人工预算上限，请核对。</p>}<p>仅汇总这些已录入估算；费用范围、重复计入及未知项目仍需人工核对。</p></>:<p>估算金额或依据待核对，填写内容已保留。</p>}</div>
    </>}
    {onExport&&<>
      <button className="sc-button sc-full" type="button" disabled={exporting||!!draft||!layout.productionPlan} onClick={()=>{if(!exporting&&!draft&&layout.productionPlan)onExport();}}>导出制作交接单 HTML</button>
      <p className="sc-note">交接单包含内部人员、供应方和估算资料。编辑后请先保存制作计划，再导出给执行团队。</p>
    </>}
    {error&&!stale&&<p className="sc-handoff-error" role="alert">{error}</p>}
    {notice&&notice.scope===scope&&notice.planKey===sourceKey&&<p className="sc-note" role="status">{notice.text}</p>}
  </section>;
}
