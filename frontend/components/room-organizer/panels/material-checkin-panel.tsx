'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { productionReferenceKey } from '@/lib/production-plan';
import { registerSourceFlush } from '@/lib/source-storage';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { materialCheckinLedgerSchema, materialCheckinLimits, materialCheckinUnits, mergeMaterialCheckinLedgers, projectMaterialCheckinEvents, materialCheckinSummary,
  type MaterialCheckinLedger, type MaterialCheckinSheet, type MaterialCheckinEffectiveEvent, type MaterialCheckinIssueCode } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { fromShanghaiDateTimeInput, toShanghaiDateTimeInput } from '../lib/event-operations';
import { parseCheckinQuantity } from './material-checkin-ui';
import type { RoomLayout } from '../lib/types';
import './material-checkin-panel.css';

interface Props { layout:RoomLayout;projectId:string;ledger:MaterialCheckinLedger|undefined;loading:boolean;error:string|null;disabled?:boolean;onSave?:((nextLedger:MaterialCheckinLedger)=>Promise<void>)|undefined;onExport?:()=>void;exporting?:boolean }
type Action='new'|'receive'|'return'|'correction'|'void'|'agreement';
interface Inputs {
  action:Action;sheetId:string;acquisitionId:string;unit:MaterialCheckinSheet['unit']|'';dataKind:MaterialCheckinLedger['dataKind'];
  acquisitionSnapshot:MaterialCheckinSheet['acquisitionSnapshot']|null;
  agreedQuantity:string;basisNote:string;quantity:string;batchRef:string;checkState:MaterialCheckinEffectiveEvent['checkState'];occurredInput:string;originalOccurredAt:string|null;
  fromPartyName:string;toPartyName:string;evidenceNote:string;evidenceUrls:string;recordedBy:string;reason:string;targetId:string;baseline:string;
}
const unitLabels={piece:'件',set:'套'},stateLabels={pending:'待核',checked:'已核',disputed:'争议'};
const actionLabels:Record<Action,string>={new:'新建点验单',receive:'记录实收',return:'记录归还',correction:'更正有效记录',void:'作废有效记录',agreement:'修订约定'};
const issueLabels:Record<MaterialCheckinIssueCode,string>={
  'agreement-unknown':'约定数量未知','quantity-unknown':'完整收还数量尚未知','disputed':'有争议记录',
  'missing-time':'已核记录缺少发生时间','time-after-recording':'发生时间晚于录入时间','return-before-receipt':'有先还后收的时序问题',
  'recording-time-conflict':'录入时间需核对',
  'over-received':'实收超过约定','over-returned':'归还超过实收','quantity-overflow':'数量合计超过可安全记录范围',
};
const amount=(value:number|null)=>value===null?'未知':String(value);
const sameId=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const ledgerKey=(value:MaterialCheckinLedger|undefined)=>canonical(value??null);
function payloadFields(input:Inputs){
  const occurredAt=input.occurredInput===toShanghaiDateTimeInput(input.originalOccurredAt)?input.originalOccurredAt:fromShanghaiDateTimeInput(input.occurredInput);
  return {batchRef:input.batchRef,quantity:parseCheckinQuantity(input.quantity),checkState:input.checkState,occurredAt,
    fromPartyName:input.fromPartyName,toPartyName:input.toPartyName,evidenceNote:input.evidenceNote,
    evidenceUrls:input.evidenceUrls.split(/\r?\n/).filter(value=>value!== '')};
}
function CheckFields({value}:{value:Pick<MaterialCheckinEffectiveEvent,'batchRef'|'quantity'|'checkState'|'occurredAt'|'fromPartyName'|'toPartyName'|'evidenceNote'|'evidenceUrls'>}):JSX.Element {
  return <dl className="sc-checkin-record"><div><dt>批次</dt><dd>{value.batchRef||'未记录'}</dd></div><div><dt>数量</dt><dd>{amount(value.quantity)} · {stateLabels[value.checkState]}</dd></div><div><dt>发生时间</dt><dd>{value.occurredAt??'未知'}</dd></div><div><dt>交出方 / 接收方</dt><dd>{value.fromPartyName||'未记录'} / {value.toPartyName||'未记录'}</dd></div><div><dt>现场说明</dt><dd>{value.evidenceNote||'未记录'}</dd></div>{value.evidenceUrls.length>0&&<div><dt>证据链接</dt><dd>{value.evidenceUrls.map(url=><p key={url}>{url}</p>)}</dd></div>}</dl>;
}

export function MaterialCheckinPanel({layout,projectId,ledger,loading,error,disabled=false,onSave,onExport,exporting=false}:Props):JSX.Element {
  const [selectedId,setSelectedId]=useState(''),[input,setInput]=useState<Inputs|null>(null),[formError,setFormError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[badTime,setBadTime]=useState(false);
  const context=useRef({projectId,layoutId:layout.id,epoch:0});
  if(context.current.projectId!==projectId||context.current.layoutId!==layout.id)context.current={projectId,layoutId:layout.id,epoch:context.current.epoch+1};
  const scopeEpoch=context.current.epoch, mounted=useRef(true),pending=useRef(false),operation=useRef(0);
  const prepared=useRef<{fingerprint:string;ledger:MaterialCheckinLedger;sheetId:string;recordIds:string[]}|null>(null);
  const currentLedger=ledger?.projectId===projectId?ledger:undefined;
  const latest=useRef({layout,projectId,ledger:currentLedger,loading,error,disabled,onSave,input,epoch:scopeEpoch});latest.current={layout,projectId,ledger:currentLedger,loading,error,disabled,onSave,input,epoch:scopeEpoch};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{operation.current++;pending.current=false;prepared.current=null;setInput(null);setSelectedId('');setBusy(false);setBadTime(false);setFormError('');setNotice('');},[scopeEpoch]);
  useEffect(()=>registerSourceFlush(projectId,async()=>{
    if(latest.current.projectId!==projectId)return;
    const message=pending.current?'点验记录正在保存，请稍后再试。':latest.current.input?'请先保存或取消点验记录，再继续。':'';
    if(message){setFormError(message);throw new Error(message);}
  }),[projectId]);
  const identityProblem=projectId!==layout.id||!projectId.trim(),ledgerProblem=!!ledger&&ledger.projectId!==projectId;
  const readOnly=disabled||loading||!!error||identityProblem||ledgerProblem||!onSave;
  const selected=currentLedger?.sheets.find(sheet=>sameId(sheet.id,selectedId))??currentLedger?.sheets[0];
  const acquisitions=layout.productionPlan?.acquisitions??[];
  const chosenAcquisition=input?acquisitions.filter(row=>productionReferenceKey(row.id)===productionReferenceKey(input.acquisitionId)):[];
  const acquisitionSnapshot=chosenAcquisition.length===1?{title:chosenAcquisition[0].title,supplierName:chosenAcquisition[0].supplierName,specificationNote:chosenAcquisition[0].specificationNote}:null;
  const snapshotStale=input?.action==='new'&&!!input.acquisitionId&&canonical(input.acquisitionSnapshot)!==canonical(acquisitionSnapshot);
  const projection=selected?projectMaterialCheckinEvents(selected):null,summary=selected?materialCheckinSummary(selected):null;
  const selectedForDraft=input?currentLedger?.sheets.find(sheet=>sameId(sheet.id,input.sheetId)):undefined;
  const draftProjection=selectedForDraft?projectMaterialCheckinEvents(selectedForDraft):null;
  let ownPayloadObserved=false;
  const readyPayload=prepared.current;
  const currentFingerprint=input?canonical({projectId,input,acquisitionSnapshot:input.action==='new'?input.acquisitionSnapshot:null}):'';
  if(readyPayload&&currentLedger&&readyPayload.fingerprint===currentFingerprint){
    const sheet=currentLedger.sheets.find(row=>sameId(row.id,readyPayload.sheetId));
    if(sheet&&readyPayload.recordIds.every(id=>[sheet.id,...sheet.agreements.map(row=>row.id),...sheet.events.map(row=>row.id)].some(value=>sameId(id,value)))){
      try{mergeMaterialCheckinLedgers(currentLedger,readyPayload.ledger);ownPayloadObserved=true;}catch{ /* Conflicting parent facts stay read-only until reviewed. */ }
    }
  }
  const strictAction=input&&(input.action==='correction'||input.action==='void'||input.action==='agreement');
  const kindStale=!!input&&!!currentLedger&&input.dataKind!==currentLedger.dataKind;
  const stale=!!snapshotStale||kindStale||!!strictAction&&input!.baseline!==ledgerKey(currentLedger)&&!ownPayloadObserved;
  function begin(action:Action):void {
    if(readOnly||pending.current||action!=='new'&&!selected)return;
    prepared.current=null;setBadTime(false);setFormError('');setNotice('');
    const target=projection?.effectiveEvents[0];
    setInput({action,sheetId:selected?.id??'',acquisitionId:'',acquisitionSnapshot:null,unit:'',dataKind:currentLedger?.dataKind??'unspecified',
      agreedQuantity:action==='agreement'?projection?.agreement.agreedQuantity===null?'':String(projection?.agreement.agreedQuantity??''):'',basisNote:action==='agreement'?projection?.agreement.basisNote??'':'',
      quantity:action==='correction'&&target?.quantity!==null?String(target?.quantity??''):'',batchRef:action==='correction'?target?.batchRef??'':'',checkState:action==='correction'?target?.checkState??'pending':'pending',
      occurredInput:action==='correction'?toShanghaiDateTimeInput(target?.occurredAt??null):'',originalOccurredAt:action==='correction'?target?.occurredAt??null:null,
      fromPartyName:action==='correction'?target?.fromPartyName??'':'',toPartyName:action==='correction'?target?.toPartyName??'':'',
      evidenceNote:action==='correction'?target?.evidenceNote??'':'',evidenceUrls:action==='correction'?target?.evidenceUrls.join('\n')??'':'',
      recordedBy:'',reason:'',targetId:action==='correction'||action==='void'?target?.effectiveEventId??'':'',baseline:ledgerKey(currentLedger)});
  }
  function edit<K extends keyof Inputs>(field:K,value:Inputs[K]):void{if(readOnly||pending.current||stale||ownPayloadObserved)return;setInput(current=>current?{...current,[field]:value}:current);setFormError('');setNotice('');}
  function selectTarget(id:string):void{
    if(!input||pending.current||stale||readOnly||ownPayloadObserved)return;
    const target=draftProjection?.effectiveEvents.find(row=>sameId(row.effectiveEventId,id));
    if(!target)return;
    setInput({...input,targetId:id,...(input.action==='correction'?{quantity:target.quantity===null?'':String(target.quantity),batchRef:target.batchRef,checkState:target.checkState,
      occurredInput:toShanghaiDateTimeInput(target.occurredAt),originalOccurredAt:target.occurredAt,fromPartyName:target.fromPartyName,toPartyName:target.toPartyName,evidenceNote:target.evidenceNote,evidenceUrls:target.evidenceUrls.join('\n')}: {})});
    setBadTime(false);setFormError('');
  }
  function selectAcquisition(id:string):void{
    if(!input||pending.current||stale||readOnly||ownPayloadObserved)return;
    const rows=acquisitions.filter(row=>productionReferenceKey(row.id)===productionReferenceKey(id));
    setInput({...input,acquisitionId:id,acquisitionSnapshot:rows.length===1?{title:rows[0].title,supplierName:rows[0].supplierName,specificationNote:rows[0].specificationNote}:null});
  }
  function cancel():void{if(pending.current)return;prepared.current=null;setInput(null);setBadTime(false);setFormError('');setNotice('');}
  async function submit(event:FormEvent):Promise<void>{
    event.preventDefault();const before=latest.current;
    if(!input||readOnly||stale||pending.current||before.projectId!==before.layout.id||!before.onSave)return;
    if(badTime){setFormError('请检查发生时间，原时间与填写内容已保留。');return;}
    const token=++operation.current;
    pending.current=true;setBusy(true);setFormError('');setNotice('');
    const active=()=>mounted.current&&operation.current===token&&context.current.epoch===before.epoch;
    try{
      const acquisition=input.action==='new'?chosenAcquisition[0]:null;
      if(input.action==='new'&&chosenAcquisition.length!==1)throw new Error('请选择唯一的原取得计划，不能按同名记录建立关联。');
      if(input.action==='new'&&!input.unit)throw new Error('请人工选择计数单位，不能从模型或数量推定。');
      const fingerprint=canonical({projectId:before.projectId,input,acquisitionSnapshot:input.action==='new'?input.acquisitionSnapshot:null});
      if(!prepared.current||prepared.current.fingerprint!==fingerprint){
        const recordedAt=new Date().toISOString(),record={id:crypto.randomUUID(),recordedAt,recordedBy:input.recordedBy};
        const base=before.ledger??materialCheckinLedgerSchema.parse({schemaVersion:1,projectId:before.projectId,dataKind:input.dataKind,sheets:[]});
        let next:MaterialCheckinLedger,sheetId=input.sheetId,recordIds:string[];
        if(input.action==='new'){
          const sheet={id:crypto.randomUUID(),acquisitionId:acquisition!.id,acquisitionSnapshot:input.acquisitionSnapshot!,unit:input.unit,
            agreements:[{...record,agreedQuantity:parseCheckinQuantity(input.agreedQuantity),basisNote:input.basisNote}],events:[]};
          sheetId=sheet.id;recordIds=[sheet.id,record.id];next=materialCheckinLedgerSchema.parse({...base,sheets:[...base.sheets,sheet]});
        }else{
          const sheet=base.sheets.find(row=>sameId(row.id,input.sheetId));if(!sheet)throw new Error('当前点验单已变化，请取消记录后重新选择。');
          const current=projectMaterialCheckinEvents(sheet);
          let changed:MaterialCheckinSheet;
          if(input.action==='agreement')changed={...sheet,agreements:[...sheet.agreements,{...record,supersedesId:current.agreement.id,agreedQuantity:parseCheckinQuantity(input.agreedQuantity),basisNote:input.basisNote}]};
          else{
            const target=current.effectiveEvents.find(row=>sameId(row.effectiveEventId,input.targetId));
            if((input.action==='correction'||input.action==='void')&&!target)throw new Error('所选有效记录已变化，请取消记录后重新核对。');
            const addition=input.action==='correction'?{...record,kind:'correction' as const,targetId:target!.effectiveEventId,reason:input.reason,replacement:payloadFields(input)}:
              input.action==='void'?{...record,kind:'void' as const,targetId:target!.effectiveEventId,reason:input.reason,evidenceNote:input.evidenceNote,evidenceUrls:input.evidenceUrls.split(/\r?\n/).filter(value=>value!=='')}:
              {...record,kind:input.action as 'receive'|'return',...payloadFields(input)};
            changed=materialCheckinLedgerSchema.parse({...base,sheets:base.sheets.map(row=>sameId(row.id,sheet.id)?{...row,events:[...row.events,addition]}:row)}).sheets.find(row=>sameId(row.id,sheet.id))!;
          }
          recordIds=[record.id];next=materialCheckinLedgerSchema.parse({...base,sheets:base.sheets.map(row=>sameId(row.id,sheet.id)?changed:row)});
        }
        prepared.current={fingerprint,ledger:next,sheetId,recordIds};
      }
      const proposal=prepared.current;
      const next=before.ledger?mergeMaterialCheckinLedgers(before.ledger,proposal.ledger):proposal.ledger;
      await before.onSave(next);
      if(active()){setSelectedId(proposal.sheetId);setInput(null);prepared.current=null;setNotice('点验记录已保存到本机。');}
    }catch(caught){if(active()){
      const issues=caught&&typeof caught==='object'&&'issues' in caught?caught.issues:undefined;
      const first=Array.isArray(issues)?issues[0]:undefined;
      setFormError(first?first.code==='custom'?first.message:'请检查点验字段、数量、单位和记录人，填写内容已保留。':caught instanceof Error?caught.message:'点验记录未提交，填写内容已保留。');
    }}
    finally{if(active()){pending.current=false;setBusy(false);}}
  }
  const acquisitionState=selected?acquisitions.filter(row=>productionReferenceKey(row.id)===productionReferenceKey(selected.acquisitionId)):[];
  const field=(label:string,key: keyof Inputs,multiline=false,max:number=materialCheckinLimits.note)=> <label className="sc-field">{label}{multiline?<textarea rows={2} value={String(input?.[key]??'')} maxLength={max} onChange={event=>{const value=event.currentTarget.value;edit(key,value);}}/>:<input value={String(input?.[key]??'')} maxLength={max} onChange={event=>{const value=event.currentTarget.value;edit(key,value);}}/>}</label>;
  function occurrence(event:ChangeEvent<HTMLInputElement>):void{const value=event.currentTarget.value;if(event.currentTarget.validity.badInput){setBadTime(true);setFormError('请检查发生时间，原时间已保留。');return;}setBadTime(false);edit('occurredInput',value);}
  return <section className="sc-material-checkin" aria-label="物料数量点验">
    <p className="sc-note">每单独立记录同一单位的分批收还。未知不当零，数量平衡不代表任务完成、遗失认定或合同结清。</p>
    <p className="sc-note">账册资料性质：{currentLedger?currentLedger.dataKind==='rehearsal'?'演练':currentLedger.dataKind==='real'?'真实':'未标注':'未记录'}</p>
    {loading&&<p className="sc-note" role="status">正在读取本机点验记录…</p>}{error&&<p className="sc-handoff-error" role="alert">{error}</p>}
    {identityProblem&&<p className="sc-handoff-error" role="alert">请先打开有明确编号的当前项目，数量点验暂不能保存。</p>}
    {ledgerProblem&&<p className="sc-handoff-error" role="alert">点验账册属于另一个项目，不能在当前项目写入。</p>}
    <label className="sc-field">当前点验单<select value={selected?.id??''} disabled={busy||!!input} onChange={event=>setSelectedId(event.currentTarget.value)}><option value="">选择点验单</option>{currentLedger?.sheets.map((sheet,index)=><option value={sheet.id} key={sheet.id}>{sheet.acquisitionSnapshot.title} · {index+1} · {unitLabels[sheet.unit]}</option>)}</select></label>
    {!currentLedger?.sheets.length&&<p className="sc-note">暂无物料点验单。</p>}
    <div className="sc-checkin-actions"><button className="sc-button" type="button" disabled={readOnly||busy||!!input||(currentLedger?.sheets.length??0)>=materialCheckinLimits.sheets} onClick={()=>begin('new')}>新建点验单</button>{selected&&(['receive','return','correction','void','agreement'] as const).map(action=><button className="sc-button" type="button" key={action} disabled={readOnly||busy||!!input||((action==='correction'||action==='void')&&!projection?.effectiveEvents.length)} onClick={()=>begin(action)}>{actionLabels[action]}</button>)}</div>
    {selected&&projection&&summary&&<>
      <h3>{selected.acquisitionSnapshot.title} · {unitLabels[selected.unit]}</h3><dl className="sc-checkin-record"><div><dt>供应方快照</dt><dd>{selected.acquisitionSnapshot.supplierName||'未记录'}</dd></div><div><dt>规格快照</dt><dd>{selected.acquisitionSnapshot.specificationNote||'未记录'}</dd></div></dl>
      {acquisitionState.length!==1&&<p className="sc-handoff-review">原取得计划{acquisitionState.length?'关联不唯一':'已缺失'}，原编号及快照保留；仍可记录本单归还，不会自动重挂同名计划。</p>}
      <dl className="sc-checkin-summary" aria-label="数量点验摘要">{[
        ['当前约定数量',summary.agreedQuantity],['已核实收小计',summary.knownReceivedQuantity],['完整实收数量',summary.receivedQuantity],['已核归还小计',summary.knownReturnedQuantity],['完整归还数量',summary.returnedQuantity],['约定未实收',summary.notReceivedQuantity],['实收范围待归还',summary.notReturnedQuantity],
        ...(summary.overReceivedQuantity!==null&&summary.overReceivedQuantity>0?[['超收数量',summary.overReceivedQuantity]]:[]),
        ...(summary.overReturnedQuantity!==null&&summary.overReturnedQuantity>0?[['超还数量',summary.overReturnedQuantity]]:[]),
      ].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{amount(value as number|null)} {unitLabels[selected.unit]}</dd></div>)}</dl>
      <p className="sc-note">待核 {summary.pendingEventIds.length} 批 · 争议 {summary.disputedEventIds.length} 批。已核小计不证明全部收还记录完整。</p>
      {!!summary.issues.length&&<ul className="sc-handoff-review">{summary.issues.map(issue=><li key={issue.code}>{issueLabels[issue.code]}</li>)}</ul>}
      <details><summary>当前有效记录</summary>{projection.effectiveEvents.length?projection.effectiveEvents.map((row,index)=><article key={row.effectiveEventId}><h4>{row.kind==='receive'?'实收':'归还'} · {row.batchRef||`批次 ${index+1}`}</h4><CheckFields value={row}/><p className="sc-note">录入留痕 {row.recordedAt} · {row.recordedBy}</p></article>):<p className="sc-note">暂无有效收还记录。</p>}</details>
      <details><summary>原始历史记录</summary>{selected.agreements.map((row,index)=><article key={row.id}><h4>约定版本 {index+1}</h4><p>数量 {amount(row.agreedQuantity)} {unitLabels[selected.unit]}</p><p className="sc-checkin-original">依据 {row.basisNote||'未记录'}</p><p className="sc-note">录入留痕 {row.recordedAt} · {row.recordedBy}</p></article>)}{selected.events.map((row,index)=><article key={row.id}><h4>{row.kind==='receive'?'实收':row.kind==='return'?'归还':row.kind==='correction'?'更正':'作废'} · 历史 {index+1}</h4>{row.kind==='receive'||row.kind==='return'?<CheckFields value={row}/>:row.kind==='correction'?<><p className="sc-checkin-original">理由 {row.reason}</p><CheckFields value={row.replacement}/></>:<><p className="sc-checkin-original">理由 {row.reason}</p><p className="sc-checkin-original">依据 {row.evidenceNote}</p>{row.evidenceUrls.map(url=><p key={url}>{url}</p>)}</>}<p className="sc-note">录入留痕 {row.recordedAt} · {row.recordedBy}</p></article>)}</details>
    </>}
    {input&&<form aria-label="点验记录表单" onSubmit={event=>void submit(event)}>
      <h3>{actionLabels[input.action]}</h3>{stale&&<p className="sc-handoff-error" role="alert">{snapshotStale?'原取得计划依据已变化，当前新单已停用；请取消记录后重新核对。':kindStale?'账册资料性质已变化，当前表单已停用；请取消记录后重新核对。':'点验账册已变化，当前更正、作废或约定修订已停用；请取消记录后重新核对。'}</p>}
      {ownPayloadObserved&&<p className="sc-note">同编号记录已在当前账册中，现有内容只可原样重试。需要修改时请取消记录后重新核对。</p>}
      <fieldset disabled={readOnly||busy||stale||ownPayloadObserved}>
        {input.action==='new'&&<><label className="sc-field">原取得计划<select value={input.acquisitionId} onChange={event=>selectAcquisition(event.currentTarget.value)}><option value="">选择原取得计划</option>{acquisitions.map((row,index)=><option key={`${row.id}:${index}`} value={row.id}>{row.title} · {index+1}</option>)}</select></label>{input.acquisitionSnapshot&&<dl className="sc-checkin-record"><div><dt>标题快照</dt><dd>{input.acquisitionSnapshot.title}</dd></div><div><dt>供应方快照</dt><dd>{input.acquisitionSnapshot.supplierName||'未记录'}</dd></div><div><dt>规格快照</dt><dd>{input.acquisitionSnapshot.specificationNote||'未记录'}</dd></div></dl>}
          <label className="sc-field">计数单位<select value={input.unit} onChange={event=>edit('unit',event.currentTarget.value as Inputs['unit'])}><option value="">请选择计数单位</option>{materialCheckinUnits.map(unit=><option value={unit} key={unit}>{unitLabels[unit]}</option>)}</select></label>
          <label className="sc-field">点验资料类型<select value={input.dataKind} disabled={!!currentLedger} onChange={event=>edit('dataKind',event.currentTarget.value as Inputs['dataKind'])}><option value="unspecified">未标注</option><option value="rehearsal">演练</option><option value="real">真实</option></select></label></>}
        {(input.action==='new'||input.action==='agreement')&&<><label className="sc-field">约定数量<input inputMode="numeric" value={input.agreedQuantity} placeholder="未知" onChange={event=>edit('agreedQuantity',event.currentTarget.value)}/></label>{field('约定依据','basisNote',true)}</>}
        {(input.action==='correction'||input.action==='void')&&<><label className="sc-field">当前有效记录<select value={input.targetId} onChange={event=>selectTarget(event.currentTarget.value)}><option value="">选择有效记录</option>{draftProjection?.effectiveEvents.map((row,index)=><option key={row.effectiveEventId} value={row.effectiveEventId}>{row.kind==='receive'?'实收':'归还'} · {row.batchRef||index+1}</option>)}</select></label>{field('更正或作废理由','reason',true)}</>}
        {(input.action==='receive'||input.action==='return'||input.action==='correction')&&<>{field('批次编号','batchRef',false,materialCheckinLimits.title)}<label className="sc-field">本批数量<input inputMode="numeric" value={input.quantity} placeholder="未知" onChange={event=>edit('quantity',event.currentTarget.value)}/></label><label className="sc-field">核对状态<select value={input.checkState} onChange={event=>edit('checkState',event.currentTarget.value as Inputs['checkState'])}><option value="pending">待核</option><option value="checked">已核</option><option value="disputed">争议</option></select></label><label className="sc-field">发生时间（北京时间）<input type="datetime-local" step="0.001" value={input.occurredInput} onChange={occurrence}/></label><p className="sc-note">发生时间只手填实际情况；未知留空。录入时间由首次提交生成，仅作留痕。</p>{field('交出方','fromPartyName',false,materialCheckinLimits.party)}{field('接收方','toPartyName',false,materialCheckinLimits.party)}</>}
        {(input.action==='receive'||input.action==='return'||input.action==='correction'||input.action==='void')&&<>{field('现场说明','evidenceNote',true)}{field('证据链接','evidenceUrls',true,materialCheckinLimits.note)}</>}
        {field('记录人','recordedBy',false,materialCheckinLimits.party)}
      </fieldset><button className="sc-button" type="submit" disabled={readOnly||busy||stale}>{busy?'正在提交…':'保存点验记录'}</button><button className="sc-button" type="button" disabled={busy} onClick={cancel}>取消记录</button>
    </form>}
    {onExport&&<><button className="sc-button sc-full" type="button" disabled={readOnly||busy||exporting||!!input||!currentLedger} onClick={()=>{if(!readOnly&&!busy&&!exporting&&!input&&currentLedger)onExport();}}>导出点验交接单 HTML</button><p className="sc-note">先保存当前输入，再导出已保存的账册与关联任务。文件含内部交接双方、数量和依据，请仅提供给执行团队。</p></>}
    {formError&&!stale&&<p className="sc-handoff-error" role="alert">{formError}</p>}{notice&&<p className="sc-note" role="status">{notice}</p>}
  </section>;
}
