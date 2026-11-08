'use client';

import {useEffect,useRef,useState} from 'react';
import {originalMovableObjects,previewOriginalObjectMove,verifyOriginalMoveSnapshot} from '../lib/original-scene-local-preview';

export interface OriginalSceneRecord { scene:unknown; revision:number; originalSceneHash:string }
export interface OriginalSceneReviewChange { path:string; before:{present:boolean;value?:unknown}; after:{present:boolean;value?:unknown} }
export interface OriginalSceneReviewPreview { baseHash:string; candidateHash:string; changes:OriginalSceneReviewChange[] }
export interface OriginalMoveConfirmation {revision:number;baseHash:string;candidateHash:string;candidateText:string;changes:OriginalSceneReviewChange[]}
export interface OriginalSceneReviewPanelProps {
  /** Stable project identity; the parent should remount this panel on activity changes. */
  scopeKey:string;
  /** Must check the current account, project and monotonic session token synchronously. */
  isCurrent():boolean;
  /** Authorized read of the original record; called only by an explicit user action. */
  loadOriginal():Promise<OriginalSceneRecord>;
  /** Optional read-only candidate for a server-validated review preview. */
  candidate?:unknown;
  prepareReview?:((input:{originalSceneHash:string;revision:number;candidate:unknown})=>Promise<OriginalSceneReviewPreview>) | undefined;
  enableLocalPreview?:boolean;
  allowLocalConfirm?:boolean;
  onConfirmLocal?:((snapshot:OriginalMoveConfirmation,isCandidateCurrent:()=>boolean)=>Promise<'committed'|'unknown'|'blocked'>)|undefined;
}

const hashPattern=/^[a-f0-9]{64}$/i;
const labels:Record<string,string>={objects:'物件',id:'编号',position:'位置',size:'尺寸',rotation:'旋转',width:'宽度',depth:'深度',height:'高度',x:'横向',z:'纵向',color:'颜色',materialId:'物料类型',assetId:'资产',locked:'锁定状态',camera:'视角',lighting:'灯光',elevation:'离地高度',floorColor:'地面颜色',floorPattern:'地面样式',finishes:'表面',wallColors:'墙面颜色'};
const materialLabels:Record<string,string>={chair:'椅子',table:'桌子',reception:'签到台',backdrop:'背景板',display:'展示物',partition:'隔断',carpet:'地毯',decoration:'装饰道具',asset:'资产物件'};
function neutralPath(path:string):string {
  const parts=path.split('/').slice(1).map(value=>value.replaceAll('~1','/').replaceAll('~0','~'));
  const readable=parts.filter(part=>part!=='by-id').map(part=>/^\d+$/.test(part)?`第 ${Number(part)+1} 项`:/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(part)?`编号 ${part}`:labels[part]??'其他字段');
  return readable.length?readable.join(' · '):'场景内容';
}
function neutralValue(part:{present:boolean;value?:unknown},path:string):string {
  if(!part.present)return '未记录';
  const value=part.value;
  if(value===null)return '空值';
  if(typeof value==='number'&&Number.isFinite(value))return String(value);
  if(typeof value==='boolean')return value?'是':'否';
  if(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))return value;
  if(typeof value==='string'&&/\/(?:id|assetId)$/.test(path)&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))return value;
  if(typeof value==='string'&&path.endsWith('/materialId')&&materialLabels[value])return materialLabels[value];
  return '具体内容需在原文中核对';
}
function isReadableChange(change:OriginalSceneReviewChange):boolean {
  return !neutralPath(change.path).includes('其他字段')&&[change.before,change.after].every(part=>neutralValue(part,change.path)!=='具体内容需在原文中核对');
}
function current(check:()=>boolean):boolean {try{return check();}catch{return false;}}
function candidateSnapshot(value:unknown):string|undefined {try{return JSON.stringify(value);}catch{return undefined;}}
function originalText(record:OriginalSceneRecord):string {
  const text=JSON.stringify({scene:record.scene,revision:record.revision,originalSceneHash:record.originalSceneHash},null,2);
  if(!text)throw new Error('原始记录无法读取。');return text;
}
function downloadOriginal(text:string):void {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
  try{const link=document.createElement('a');link.href=url;link.download='原始场景记录.json';link.click();}
  finally{URL.revokeObjectURL(url);}
}

function LocalMovePreview({record,isCurrent,allowConfirm,onConfirm}:{record:OriginalSceneRecord;isCurrent:()=>boolean;allowConfirm:boolean;onConfirm?:((snapshot:OriginalMoveConfirmation,isCandidateCurrent:()=>boolean)=>Promise<'committed'|'unknown'|'blocked'>)|undefined}):JSX.Element {
  const objects=originalMovableObjects(record.scene);
  const [objectId,setObjectId]=useState(''),[x,setX]=useState(''),[z,setZ]=useState('');
  const [result,setResult]=useState<{snapshotText:string;view:OriginalMoveConfirmation}|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const version=useRef(0),confirming=useRef(false);useEffect(()=>()=>{version.current++;},[]);
  function changed(){version.current++;setResult(null);setNotice('');setBusy(false);}
  function choose(id:string){changed();setObjectId(id);const object=objects.find(item=>item.id===id);setX(object?String(object.x):'');setZ(object?String(object.z):'');}
  async function preview(){
    if(busy||!current(isCurrent)||!objectId||!x.trim()||!z.trim())return;
    const captured=++version.current;setBusy(true);setNotice('');setResult(null);
    try{const output=await previewOriginalObjectMove(record.scene,record.originalSceneHash,objectId,Number(x),Number(z));
      if(version.current!==captured||!current(isCurrent))return;
      const snapshotText=JSON.stringify({...output,revision:record.revision});
      setResult({snapshotText,view:JSON.parse(snapshotText) as OriginalMoveConfirmation});
    }catch{if(version.current===captured&&current(isCurrent))setNotice('无法生成预览，请检查原始记录、物件锁定状态和坐标。');}
    finally{if(version.current===captured&&current(isCurrent))setBusy(false);}
  }
  async function confirm(){
    if(!allowConfirm||!onConfirm||!result||confirming.current||!current(isCurrent)||result.view.changes.some(change=>!isReadableChange(change)))return;
    const captured=version.current;confirming.current=true;setBusy(true);setNotice('');
    try{
      const checked=await verifyOriginalMoveSnapshot({raw:record.scene,revision:record.revision,objectId,x:Number(x),z:Number(z),snapshotText:result.snapshotText,isCurrent:()=>version.current===captured&&current(isCurrent)});
      if(version.current!==captured||!current(isCurrent))return;
      const outcome=await onConfirm({revision:record.revision,...checked},()=>version.current===captured&&current(isCurrent));
      if(version.current!==captured||!current(isCurrent))return;
      setNotice(outcome==='committed'?'云端已提交，仍需核对完成记录。':outcome==='unknown'?'提交结果待核对，请勿重复提交。':'本次未完成提交，请核对当前状态。');
    }catch{if(version.current===captured&&current(isCurrent))setNotice('候选或活动已变化，请重新预览。');}
    finally{confirming.current=false;if(version.current===captured&&current(isCurrent))setBusy(false);}
  }
  return <section aria-label="本机局部修改预览">
    <h4>预览物件位置修改</h4><p>预览仅在当前页面生成，不会保存云端或替换本机草稿。离开页面后预览会消失。</p>
    {objects.length===0?<p>没有可修改的已解锁物件，或原始记录需先核对。</p>:<>
      <label>选择物件 <select aria-label="选择物件" value={objectId} onChange={event=>choose(event.target.value)}><option value="">请选择</option>{objects.map(object=><option key={object.id} value={object.id}>{materialLabels[object.materialId]??'物件'} · {object.id}</option>)}</select></label>
      {objectId&&<><label>横向位置（米） <input aria-label="横向位置（米）" type="number" step="any" value={x} onChange={event=>{changed();setX(event.target.value);}}/></label>
      <label>纵向位置（米） <input aria-label="纵向位置（米）" type="number" step="any" value={z} onChange={event=>{changed();setZ(event.target.value);}}/></label></>}
      <button type="button" className="sc-button" disabled={busy||!objectId||!x.trim()||!z.trim()} onClick={()=>void preview()}>预览位置差异</button>
    </>}
    {result&&<><p>以下是所选物件位置的全部变化；不代表安全或规范验收。</p><ol aria-label="位置差异列表">{result.view.changes.map((change,index)=><li key={index}>{neutralPath(change.path)}：{neutralValue(change.before,change.path)} → {neutralValue(change.after,change.path)}</li>)}</ol><p>原始版本：{record.revision}；候选核对码：{result.view.candidateHash}</p></>}
    <button type="button" className="sc-button" disabled={!allowConfirm||!onConfirm||!result||busy} onClick={()=>void confirm()}>确认提交修改</button>
    {notice&&<p role="status">{notice}</p>}
  </section>;
}

/** Explicit, read-only review surface; this component never submits or writes a scene. */
export function OriginalSceneReviewPanel({scopeKey,isCurrent,loadOriginal,candidate,prepareReview,enableLocalPreview=false,allowLocalConfirm=false,onConfirmLocal}:OriginalSceneReviewPanelProps):JSX.Element {
  const [recordState,setRecordState]=useState<{scope:string;guard:()=>boolean;value:OriginalSceneRecord;text:string}|null>(null);
  const [previewState,setPreviewState]=useState<{scope:string;guard:()=>boolean;candidateText:string;action:NonNullable<OriginalSceneReviewPanelProps['prepareReview']>;value:OriginalSceneReviewPreview}|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const serial=useRef(0),latest=useRef({scopeKey,isCurrent,loadOriginal,candidate,prepareReview});latest.current={scopeKey,isCurrent,loadOriginal,candidate,prepareReview};
  useEffect(()=>()=>{serial.current++;},[]);
  useEffect(()=>{serial.current++;setRecordState(null);setPreviewState(null);setBusy(false);setNotice('');},[scopeKey]);
  const record=current(isCurrent)&&recordState?.scope===scopeKey&&recordState.guard===isCurrent?recordState:null;
  const preview=current(isCurrent)&&previewState?.scope===scopeKey&&previewState.guard===isCurrent&&previewState.action===prepareReview&&previewState.candidateText===candidateSnapshot(candidate)?previewState:null;
  function stillCurrent(id:number,scope:string):boolean {return serial.current===id&&latest.current.scopeKey===scope&&current(latest.current.isCurrent);}
  async function read():Promise<void>{
    if(busy||!current(isCurrent))return;
    const id=++serial.current,scope=scopeKey;setBusy(true);setNotice('');setPreviewState(null);
    try{const value=await loadOriginal();if(!stillCurrent(id,scope)||latest.current.isCurrent!==isCurrent||latest.current.loadOriginal!==loadOriginal)return;
      if(!Number.isSafeInteger(value.revision)||value.revision<0||!hashPattern.test(value.originalSceneHash))throw new Error('原始记录无法核对。');
      setRecordState({scope,guard:isCurrent,value,text:originalText(value)});
    }catch{if(stillCurrent(id,scope))setNotice('原始记录读取失败，请核对项目权限与网络后重试。');}
    finally{if(stillCurrent(id,scope))setBusy(false);}
  }
  async function prepare():Promise<void>{
    if(!record||!prepareReview||candidate===undefined||busy||!current(isCurrent))return;
    const id=++serial.current,scope=scopeKey,original=record.value,action=prepareReview;
    let candidateText:string;
    try{candidateText=JSON.stringify(candidate);if(candidateText===undefined)throw new Error();}catch{setNotice('候选内容无法核对，请重新准备。');return;}
    setBusy(true);setNotice('');setPreviewState(null);
    try{
      const value=await action({originalSceneHash:original.originalSceneHash,revision:original.revision,candidate:JSON.parse(candidateText)});
      if(!stillCurrent(id,scope)||latest.current.isCurrent!==isCurrent||latest.current.prepareReview!==action||candidateSnapshot(latest.current.candidate)!==candidateText)return;
      if(value.baseHash!==original.originalSceneHash||!hashPattern.test(value.candidateHash)||!Array.isArray(value.changes)||value.changes.length>512||value.changes.some(change=>!change||typeof change.path!=='string'||!change.before||typeof change.before.present!=='boolean'||!change.after||typeof change.after.present!=='boolean'))throw new Error('差异无法核对。');
      setPreviewState({scope,guard:isCurrent,candidateText,action,value});
    }catch{if(stillCurrent(id,scope))setNotice('差异预览未能完成，请核对当前记录后重试。');}
    finally{if(stillCurrent(id,scope))setBusy(false);}
  }
  return <section aria-label="原始场景只读核对">
    <h3>原始场景只读核对</h3>
    <p>当前展示是只读视图，不能用它覆盖原始记录。原文可能含敏感信息或未经核验的模型结论。</p>
    {!record&&<button type="button" className="sc-button" disabled={busy} onClick={()=>void read()}>授权读取并查看原文</button>}
    {record&&<>
      <p>已读取原始记录；下载和转发前请检查敏感内容。模型文字不代表安全或规范验收。</p>
      <pre aria-label="授权查看的原始记录">{record.text}</pre>
      <button type="button" className="sc-button" onClick={()=>{if(!current(isCurrent))return;try{downloadOriginal(record.text);setNotice('原始记录下载已发起。');}catch{setNotice('下载未能发起，请检查浏览器设置。');}}}>下载原始记录</button>
      <button type="button" className="sc-button" onClick={()=>{serial.current++;setRecordState(null);setPreviewState(null);setNotice('');}}>收起原文</button>
      {enableLocalPreview&&<LocalMovePreview record={record.value} isCurrent={isCurrent} allowConfirm={allowLocalConfirm} onConfirm={onConfirmLocal}/>}
    </>}
    <h4>候选差异</h4>
    {!prepareReview||candidate===undefined?<p>尚未提供可核对的候选；原始记录保持不变。</p>:<button type="button" className="sc-button" disabled={busy||!record} onClick={()=>void prepare()}>生成差异预览</button>}
    {preview&&<><p>以下仅为场景字段差异，不代表消防、疏散、无障碍或容量已验收。</p>
      {preview.value.changes.some(change=>!isReadableChange(change))&&<p role="alert">部分变更无法清楚显示前后内容，不能确认提交。请在授权原文中核对；当前不支持提交此类变更。</p>}
      {preview.value.changes.length?<><p>新增物件 {preview.value.changes.filter(change=>/^\/objects\/by-id\/[^/]+\/id$/.test(change.path)&&!change.before.present&&change.after.present).length} 件；移除物件 {preview.value.changes.filter(change=>/^\/objects\/by-id\/[^/]+\/id$/.test(change.path)&&change.before.present&&!change.after.present).length} 件。</p><ol aria-label="候选差异列表">{preview.value.changes.map((change,index)=><li key={index}>{neutralPath(change.path)}：{neutralValue(change.before,change.path)} → {neutralValue(change.after,change.path)}</li>)}</ol></>:<p>没有可展示的差异。</p>}</>}
    {(!enableLocalPreview||!record)&&<button type="button" className="sc-button" disabled>确认提交修改</button>}
    <p>安全确认和恢复链路尚未完成验证，当前只能查看和预览，不能提交修改。</p>
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
