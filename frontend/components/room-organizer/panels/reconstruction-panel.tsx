'use client';

/* Source previews use private blob/signed URLs and preserve original image coordinates. */
/* eslint-disable @next/next/no-img-element */

import { Check, Loader2, Ruler, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBackendSession, type BackendSession, type DimensionConstraint, type ReconstructionJob, type SceneProposal, type SceneV2, type SourceImage } from '@/lib/backend-session';
import { assertGeometryActionSource, geometryProjectId, isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { updateReviewedWall, openingLine, imageRegistration, mergeRecognizedDimensions } from '@/lib/reconstruction-review';
import { referenceSceneBasis, referenceStructure, resolveReferenceImage, type ReferenceRegistration } from '@/lib/reference-image';
import { containedImagePoint, parseDimensionText, readSourceForm, storeSourceForm, registerSourceFlush, type ImagePoint } from '@/lib/source-storage';
import { readEditableVenue, previewVenueEdit } from '@/lib/venue-edit';
import { canonical, sceneV2Schema } from '../../../../supabase/functions/_shared/domain';
import { useSelection } from '../contexts';
import { backendSceneToLayout, createMeasuredRoomLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { mergeProposalPresentation, type CreativeBrief } from '../lib/creative-brief';
import { addDesign, MAX_DESIGNS } from '../lib/scene-layers';
import { ensureGlbAsset } from '../three/glb-assets';
import type { VenuePhoto } from './venue-photos-panel';
import type { RoomLayout } from '../lib/types';
import './reconstruction-panel.css';

interface Props { controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout):void; onPreview?: ((layout: RoomLayout|null)=>void)|undefined; images: VenuePhoto[]; updateImage(id:string,patch:Partial<VenuePhoto>):void; brief: CreativeBrief; openReferenceRequest?:number; onAddReferenceImages?:(files:FileList|null)=>Promise<void> }
interface Form { width:string; depth:string; height:string; text:string; constraints:DimensionConstraint[]; adjustment:string; jobId?:string|undefined; requestId?:string|undefined; requestKey?:string|undefined; jobBase?:string|undefined; jobInput?:string|undefined; fixedIds?:Record<string,string>; jobSources?:string; jobMode?:'restore'|'redesign'; jobIdentity?:string; jobSession?:string; registration?:ReferenceRegistration; }
const EMPTY:Form={width:'',depth:'',height:'',text:'',constraints:[],adjustment:''};
const LABELS:Record<ReconstructionJob['state'],string>={queued:'已排队',recognizing:'正在识别空间与尺寸',needs_review:'请核对结构与缺失信息',planning:'正在设计活动方案',validating:'正在校验结构与布置',ready:'候选方案已就绪',failed:'生成未完成'};
const ACTIVE=new Set(['queued','recognizing','planning','validating']);
const ERROR_MESSAGES:Record<string,string>={
  SERVICE_NOT_CONFIGURED:'识别服务尚未配置，资料和当前场景已保留。',
  BILLING_NOT_CONFIGURED:'AI 费用限制尚未配置，请联系工作室管理员；资料和当前场景已保留。',
  DAILY_BUDGET_EXCEEDED:'今天的 AI 额度已用完，请明天再试；资料和当前场景已保留。',
  BUDGET_EXCEEDED:'工作室 AI 总额度已用完，请联系管理员；资料和当前场景已保留。',
  AI_BUSY:'已有方案正在生成，请等待本次任务完成。',
  GENERATION_BUSY:'已有生成任务正在处理，请先查看任务状态。',
  RECONSTRUCTION_BUSY:'已有重建任务正在处理，请先查看任务状态。',
  CLOUD_OPERATION_BUSY:'上一次保存仍在进行，请稍后重试。',
  PROVIDER_TIMEOUT:'识别或设计服务响应超时，资料和当前场景已保留，请稍后重试。',
  PROVIDER_HTTP_ERROR:'识别或设计服务暂时不可用，资料和当前场景已保留，请稍后重试。',
  PROVIDER_REJECTED:'模型服务暂时无法处理这次请求，请核对资料和要求后重试。',
  PROVIDER_INVALID_JSON:'模型返回的内容无法读取，资料和当前场景已保留，请重新生成。',
  AI_INCOMPLETE_OUTPUT:'模型返回的方案不完整，当前场景已保留，请精简要求后重试。',
  AI_INVALID_STRUCTURE:'模型未能生成有效结构，资料和当前场景已保留，请补充资料后重试。',
  AI_MODIFIED_STRUCTURE:'生成方案改变了已确认结构，因此未应用，请重新生成。',
  AI_MODIFIED_PRESERVED_OBJECT:'生成方案改变了要求保留的物件，因此未应用，请重新生成。',
  RECONSTRUCTION_FAILED:'这次重建未能完成，资料和当前场景已保留，请稍后重试。',
};
function errorCodeText(code:string):string{return ERROR_MESSAGES[code]??`生成未完成（${code}），资料和当前场景已保留。`;}
function errorText(error:unknown):string{
  if(error instanceof Error){const code='code' in error&&typeof error.code==='string'?error.code:error.message;return ERROR_MESSAGES[code]??error.message;}
  return '操作未完成，原场景已保留。';
}
function currentSceneKey(layout:RoomLayout):string { try{return canonical(layoutToBackendScene(layout));}catch{return '';}}
function NumberField({label,value,onChange}:{label:string;value:number;onChange(value:number):void}):JSX.Element{return <label>{label}<input type="number" step="0.001" value={Number.isFinite(value)?value:''} onChange={event=>onChange(event.target.valueAsNumber)}/></label>;}

interface VenueEditDraft {
  base: RoomLayout; scene: SceneV2; sceneKey: string; sourceKey: string; images: VenuePhoto[];
  epoch: number; sessionKey: string; width: string; depth: string;
  openings: SceneV2['structure']['openings']; confirmed: boolean;
}
function venueSourceKey(images: VenuePhoto[]): string {
  return canonical(images.map(image=>({id:image.id,kind:image.kind??'photo',assetId:image.assetId,width:image.width,height:image.height})));
}
function geometryIdentity(controller:BackendSession,scope:string):string {
  const current=controller.getSnapshot();
  return canonical({scope,project:geometryProjectId(controller,scope),user:current.user?.id??null,api:controller.config.apiUrl,binding:current.geometryBinding??null});
}
function venueSessionKey(controller: BackendSession, scope: string): string {
  const current=controller.getSnapshot(),lease=current.lease;
  if(current.project&&!isLocalActivityWorkspace(controller)){
    if(geometryProjectId(controller,scope)!==current.project.id||current.writeBlocked||!current.user||!lease||lease.projectId!==scope||
      !Number.isFinite(Date.parse(lease.expiresAt))||Date.parse(lease.expiresAt)<=Date.now())
      throw new Error('当前项目没有有效编辑权，请获取编辑权后重新核对场地。');
    if(current.status==='saving')throw new Error('云端保存正在进行，请完成后重新核对场地。');
  }
  return canonical({identity:geometryIdentity(controller,scope),session:current.sessionId,
    lease:lease?{session:lease.sessionId,generation:lease.generation}:null,revision:current.revision});
}
function VenueEditDrawing({before,after}: {before:SceneV2;after:SceneV2}):JSX.Element {
  const draw=(scene:SceneV2,color:string,dashed=false)=><g stroke={color} strokeDasharray={dashed?'.12 .08':undefined}>
    {scene.structure.walls.map(wall=><line key={wall.id} x1={wall.start.x} y1={wall.start.z} x2={wall.end.x} y2={wall.end.z} strokeWidth={Math.max(.06,wall.thickness)}/>)}
    {scene.structure.openings.map(opening=>{const line=openingLine(scene,opening);return line?<line key={opening.id} x1={line.x1} y1={line.z1} x2={line.x2} y2={line.z2} strokeWidth=".22" stroke={dashed?color:'#d48536'}/>:null;})}
  </g>;
  return <svg className="rc-plan rc-venue-plan" viewBox={`-.5 -.5 ${Math.max(before.venue.width,after.venue.width)+1} ${Math.max(before.venue.depth,after.venue.depth)+1}`} aria-label="当前场地与编辑草稿对比图">
    {before.objects.map(object=><rect key={object.id} x={object.position.x-object.size.width/2} y={object.position.z-object.size.depth/2} width={object.size.width} height={object.size.depth} transform={`rotate(${object.rotation} ${object.position.x} ${object.position.z})`} fill="#cbd4c5"/>)}
    {before.structure.columns.map(column=><rect key={column.id} x={column.position.x-column.size.width/2} y={column.position.z-column.size.depth/2} width={column.size.width} height={column.size.depth} transform={`rotate(${column.rotation} ${column.position.x} ${column.position.z})`} fill="#808979"/>)}
    {draw(before,'#9a9e96',true)}{draw(after,'#355b4b')}
    <circle cx="0" cy="0" r=".08" fill="#263b31"/><text x=".12" y=".3" fontSize=".22">参考角 (0,0)</text>
  </svg>;
}

function ReferenceImageReview({scene,layout,images,registration,onChange,onConfirm,updateImage,onAddImages,applied,openRequest=0}: {
  scene:SceneV2;layout:RoomLayout;images:VenuePhoto[];registration:ReferenceRegistration|undefined;
  onChange(value:ReferenceRegistration):void;onConfirm(value:ReferenceRegistration):Promise<void>;
  updateImage:Props['updateImage'];onAddImages:Props['onAddReferenceImages'];applied:boolean;openRequest?:number;
}):JSX.Element {
  const details=useRef<HTMLDetailsElement>(null),[selected,setSelected]=useState(''),[registering,setRegistering]=useState(false);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[opacity,setOpacity]=useState(.55);
  const [pixelPoint,setPixelPoint]=useState({x:'',z:''}),[pointError,setPointError]=useState('');
  const pointInput=useRef<HTMLInputElement>(null);
  const scope=layout.id??'local',basis=applied?referenceSceneBasis(layout):canonical({venue:scene.venue,structure:scene.structure,sources:scene.sources});
  const choices=images.filter(image=>image.blob instanceof Blob&&image.width&&image.height&&
    (!image.assetId||scene.sources.filter(source=>source.assetId===image.assetId&&source.kind==='floorplan'&&source.width===image.width&&source.height===image.height).length===1));
  const source=choices.find(image=>image.id===selected&&image.kind==='floorplan')??choices.find(image=>image.id===registration?.sourceId&&image.kind==='floorplan')??choices.find(image=>image.kind==='floorplan');
  const session=useRef<{scope:string;sourceId:string;basis:string;points:ImagePoint[]}|null>(null);
  const context=useRef({scope,basis,sourceId:source?.id}),confirming=useRef(false);
  if(context.current.scope!==scope||context.current.basis!==basis||context.current.sourceId!==source?.id)context.current={scope,basis,sourceId:source?.id};
  useEffect(()=>{session.current=null;setRegistering(false);setNotice('');setPixelPoint({x:'',z:''});setPointError('');},[scope,source?.id,basis]);
  useEffect(()=>{if(openRequest>0&&details.current){details.current.open=true;details.current.scrollIntoView?.({block:'nearest'});}},[openRequest]);
  const fixed=registration?.sourceId===source?.id&&registration?.worldWidth===scene.venue.width&&registration?.worldDepth===scene.venue.depth;
  const transform=source&&fixed?imageRegistration(registration!.points,registration!.worldWidth!,registration!.worldDepth!):null;
  const drawnPoints=Array.isArray(registration?.points)?registration.points.filter(point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.z)):[];
  const stored=images.map(image=>({...image,scope,kind:image.kind??'photo',width:image.width??0,height:image.height??0}));
  const resolved=applied?resolveReferenceImage(layout,stored,{registration}):null;
  function addPoint(point:ImagePoint):void {
    const active=session.current;
    if(busy||!source||!registering||!active||active.scope!==scope||active.sourceId!==source.id||active.basis!==basis||active.points.length>=3)return;
    if(!Number.isFinite(point.x)||!Number.isFinite(point.z)||point.x<0||point.z<0||point.x>source.width!||point.z>source.height!)return;
    active.points=[...active.points,point];
    onChange({sourceId:source.id,points:active.points,worldWidth:scene.venue.width,worldDepth:scene.venue.depth});
    setPixelPoint({x:'',z:''});setPointError('');
    if(active.points.length===3){session.current=null;setRegistering(false);}
  }
  function addTypedPoint():void {
    if(!registering||busy||!source)return;
    const x=Number(pixelPoint.x),z=Number(pixelPoint.z);
    if(!pixelPoint.x.trim()||!pixelPoint.z.trim()||!Number.isFinite(x)||!Number.isFinite(z)||x<0||z<0||x>source.width!||z>source.height!){
      setPointError(`请输入图内坐标：横向 0–${source.width}，纵向 0–${source.height} 像素。`);return;
    }
    addPoint({x,z});
  }
  async function confirm():Promise<void>{
    if(confirming.current||busy||!source||!transform||!registration||!basis)return;
    const before=context.current;
    const next:ReferenceRegistration={...registration,sourceId:source.id,worldWidth:scene.venue.width,worldDepth:scene.venue.depth,
      imageWidth:source.width!,imageHeight:source.height!,appliedBasis:basis,confirmationId:crypto.randomUUID(),...(source.assetId?{sourceAssetId:source.assetId}:{})};
    if(!source.assetId)delete next.sourceAssetId;
    const check=resolveReferenceImage(layout,stored,{registration:next});
    if(check.status!=='ready'){setNotice(check.notice);return;}
    confirming.current=true;setBusy(true);setNotice('正在保存本机原图对应…');
    const current=()=>context.current===before;
    try{await onConfirm(next);if(current())setNotice(check.notice);}catch(error){if(current())setNotice(errorText(error));}finally{confirming.current=false;setBusy(false);}
  }
  return <details className={`rc-calibration${applied?' is-applied-reference':''}`} ref={details}><summary>{applied?'核对原图与当前设计':'将墙线叠加到原图核对'}</summary>
    {applied&&<p className="cr-hint">选择本机平面图并人工标记对应点。确认后才用于当前设计，不调用图片识别。</p>}
    {applied&&onAddImages&&<label className="cr-label">上传平面图<input type="file" aria-label="上传核对平面图" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={event=>{const files=event.target.files;void onAddImages(files).catch(error=>setNotice(errorText(error)));event.target.value='';}}/></label>}
    <label className="cr-label">核对平面图<select aria-label="核对平面图" value={source?.id??''} disabled={busy} onChange={event=>{session.current=null;setRegistering(false);setSelected(event.target.value);updateImage(event.target.value,{kind:'floorplan'});}}><option value="">选择本机原图</option>{choices.map(image=><option key={image.id} value={image.id}>{image.name}{image.kind==='floorplan'?'':' · 选择后按平面图核对'}</option>)}</select></label>
    {!source?<p className="cr-hint">没有匹配的本机平面图。请上传或选择原图；已有云端引用不会自动改成本机来源。</p>:<>
      {applied&&<svg className="rc-plan" viewBox={`-0.5 -0.5 ${scene.venue.width+1} ${scene.venue.depth+1}`} aria-label="当前设计结构核对图">{scene.structure.walls.map(w=><line key={w.id} x1={w.start.x} y1={w.start.z} x2={w.end.x} y2={w.end.z} stroke="#355b4b" strokeWidth={Math.max(.08,w.thickness)}/>)}{scene.structure.openings.map(o=>{const line=openingLine(scene,o);return line?<line key={o.id} x1={line.x1} y1={line.z1} x2={line.x2} y2={line.z2} stroke="#61a5c2" strokeWidth={.16}/>:null;})}{scene.structure.columns.map(c=><rect key={c.id} x={c.position.x-c.size.width/2} y={c.position.z-c.size.depth/2} width={c.size.width} height={c.size.depth} fill="#7b8574"/>)}</svg>}
      <p className="cr-hint">依次点击图上的场地原点 (0,0)、X 轴终点 ({scene.venue.width},0)、Z 轴终点 (0,{scene.venue.depth})。无法对应时，请使用独立结构图核对。照片不使用此平面映射。</p>
      {registration&&registration.sourceId===source.id&&!fixed&&<p className="cr-hint">原对应未绑定当前场地尺寸，已停用，请重新标记。</p>}
      {applied&&registration?.appliedBasis&&registration.appliedBasis!==basis&&<p className="cr-hint">项目或场地坐标范围已变化，原图对应已停用，请重新核对。</p>}
      {fixed&&drawnPoints.length===3&&!transform&&<p className="cr-hint">三个点无法稳定对应场地，请重新标记相距较远且不共线的对应点。</p>}
      <button type="button" className="rc-secondary" disabled={busy} onClick={()=>{session.current={scope,sourceId:source.id,basis,points:[]};onChange({sourceId:source.id,points:[],worldWidth:scene.venue.width,worldDepth:scene.venue.depth});setRegistering(true);setNotice('');setPixelPoint({x:'',z:''});setPointError('');}}>重新标记三个对应点</button>
      <p className="cr-hint">也可输入原图像素坐标，左上角为 (0,0)。在图上按回车或空格进入坐标输入。</p>
      <div className="rc-measures rc-venue-measures" onKeyDown={event=>{if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();addTypedPoint();}}}>
        <label className="cr-label">对应点横向像素<input ref={pointInput} type="number" min="0" max={source.width} step="any" readOnly={!registering} disabled={busy} value={pixelPoint.x} onChange={event=>setPixelPoint({...pixelPoint,x:event.target.value})}/></label>
        <label className="cr-label">对应点纵向像素<input type="number" min="0" max={source.height} step="any" readOnly={!registering} disabled={busy} value={pixelPoint.z} onChange={event=>setPixelPoint({...pixelPoint,z:event.target.value})}/></label>
        <button type="button" className="rc-secondary" disabled={!registering||busy} onClick={addTypedPoint}>添加当前对应点</button>
      </div>
      {pointError&&<p className="cr-notice" role="alert">{pointError}</p>}
      <div className="rc-image-map rc-overlay" role="button" aria-label="标记图纸与场地的三个对应点" aria-disabled={!registering||busy} tabIndex={registering&&!busy?0:-1} onKeyDown={event=>{if(registering&&!busy&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();pointInput.current?.focus();}}} onClick={event=>{
        const point=containedImagePoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect(),source.width!,source.height!);if(!point)return;
        addPoint(point);
      }}><img src={source.url} alt="原图与识别墙线叠加核对"/><svg viewBox={`0 0 ${source.width} ${source.height}`} preserveAspectRatio="xMidYMid meet">
        {!transform&&scene.structure.walls.flatMap(w=>(w.evidence??[]).filter(e=>e.sourceAssetId===source.assetId).map((e,index)=><line key={`${w.id}-${index}`} x1={e.start.x*source.width!} y1={e.start.z*source.height!} x2={e.end.x*source.width!} y2={e.end.z*source.height!} stroke="#ed7335" opacity={opacity} strokeWidth={source.width!/150}/>))}
        {transform&&<g transform={transform} opacity={opacity}>{scene.structure.walls.map(w=><line key={w.id} x1={w.start.x} y1={w.start.z} x2={w.end.x} y2={w.end.z} stroke="#ed7335" strokeWidth={Math.max(.06,w.thickness)}/>)}{scene.structure.openings.map(opening=>{const line=openingLine(scene,opening);return line?<line key={opening.id} x1={line.x1} y1={line.z1} x2={line.x2} y2={line.z2} stroke={opening.kind==='door'?'#64a78b':'#61a5c2'} strokeWidth={.16}/>:null;})}</g>}
        {registration?.sourceId===source.id&&drawnPoints.map((point,index)=><g key={index}><circle cx={point.x} cy={point.z} r={source.width!/70} fill="#355b4b"/><text x={point.x} y={point.z} fill="white" fontSize={source.width!/50}>{index+1}</text></g>)}
      </svg></div><p className="cr-hint">已标记 {registration?.sourceId===source.id?drawnPoints.length:0}/3 个点。叠加位置依据人工对应点，不代表自动测量。</p>
      <label className="cr-label">墙线透明度<input type="range" aria-label="叠加墙线透明度" min=".1" max="1" step=".05" value={opacity} onChange={event=>setOpacity(Number(event.target.value))}/></label>
      {applied&&<><p className="cr-hint">{resolved?.notice}</p><button type="button" className="rc-secondary" disabled={busy||!transform} onClick={()=>void confirm()}>在当前设计中使用此对应</button></>}
    </>}
    {notice&&<p className="cr-notice" role="status">{notice}</p>}
  </details>;
}

export function ReconstructionPanel({controller,layout,onApply,onPreview,images,updateImage,brief,openReferenceRequest=0,onAddReferenceImages}:Props):JSX.Element {
  const cloud=useBackendSession(controller),selection=useSelection();
  const scope=layout.id??'local';
  const scopeEpoch=useRef({scope,epoch:0});if(scopeEpoch.current.scope!==scope)scopeEpoch.current={scope,epoch:scopeEpoch.current.epoch+1};
  const sourceImages=useRef(images),sourceVersion=useRef(0),jobSourceVersion=useRef<number|null>(null);
  if(images.length!==sourceImages.current.length||images.some((image,index)=>{const previous=sourceImages.current[index];return image.id!==previous?.id||image.blob!==previous.blob||image.width!==previous.width||image.height!==previous.height||image.kind!==previous.kind;}))sourceVersion.current++;
  sourceImages.current=images;
  const [form,setForm]=useState<Form>(EMPTY),[loaded,setLoaded]=useState(false);
  const [loadError,setLoadError]=useState(''),[loadAttempt,setLoadAttempt]=useState(0);
  const hydratedScope=useRef<string|null>(null);
  const formReady=loaded&&hydratedScope.current===scope;
  const [mode,setMode]=useState<''|'restore'|'redesign'>('');
  const [reidentify,setReidentify]=useState(false);
  const [job,setJob]=useState<ReconstructionJob|null>(null),[review,setReview]=useState<SceneV2|null>(null),[reviewConfirmed,setReviewConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[pollingPaused,setPollingPaused]=useState(false);
  const [selectedSource,setSelectedSource]=useState(''),[points,setPoints]=useState<ImagePoint[]>([]),[distance,setDistance]=useState('');
  const [selectedWall,setSelectedWall]=useState<string|null>(null);
  const inputDetails=useRef<HTMLDetailsElement>(null),formSaveTimer=useRef<ReturnType<typeof setTimeout>>();
  const formWrites=useRef<Promise<void>>(Promise.resolve()),referenceSaving=useRef(false);
  const [preview,setPreview]=useState<{proposal:SceneProposal;layout:RoomLayout;assets:{assetUrls:Record<string,string>;assetNames:Record<string,string>}}|null>(null);
  const [expired,setExpired]=useState(false);
  const [venueEdit,setVenueEdit]=useState<VenueEditDraft|null>(null),[venueNotice,setVenueNotice]=useState<{text:string;sceneKey?:string}|null>(null);
  const [venueLeaseExpired,setVenueLeaseExpired]=useState(false);
  const formHydration=useRef<Promise<void>>(Promise.resolve());
  const alive=useRef(true),scopeRef=useRef(scope),layoutRef=useRef(layout),formRef=useRef(form),pending=useRef(false);
  scopeRef.current=scope;layoutRef.current=layout;formRef.current=form;
  const hasPhotos=images.some(image=>image.kind!=='floorplan');
  const remoteProjectId=geometryProjectId(controller,scope),localActivity=isLocalActivityWorkspace(controller);
  const identityKey=geometryIdentity(controller,scope);
  const sessionKey=canonical({identity:identityKey,session:cloud.sessionId,lease:cloud.lease?{session:cloud.lease.sessionId,generation:cloud.lease.generation}:null,revision:cloud.revision});
  const connected=cloud.configured&&!!cloud.user&&!cloud.writeBlocked&&!!remoteProjectId&&cloud.lease?.projectId===remoteProjectId&&Date.parse(cloud.lease.expiresAt)>Date.now();
  const inputKey=canonical({images:images.map(image=>({id:image.id,kind:image.kind??'photo',width:image.width,height:image.height})),width:form.width,depth:form.depth,height:form.height,constraints:form.constraints,text:form.text,adjustment:form.adjustment,brief,reidentify});
  const inputRef=useRef(inputKey);inputRef.current=inputKey;
  const baseKey=currentSceneKey(layout);
  const generationSizeDifferences=layout.backendSceneV2?([
    ['总宽',form.width,layout.width],['总深',form.depth,layout.height],['层高',form.height,layout.floors[0]?.height],
  ] as const).filter(([,value,current])=>value.trim()!==''&&Number.isFinite(Number(value))&&current!==undefined&&Math.abs(Number(value)-current)>1e-6):[];
  const jobContextStale=!!job&&(jobSourceVersion.current!==null&&jobSourceVersion.current!==sourceVersion.current||venueLeaseExpired||(!!form.jobIdentity&&form.jobIdentity!==identityKey)||(!!form.jobSession&&form.jobSession!==sessionKey)||!remoteProjectId);
  const reviewStale=!!job&&(jobContextStale||form.jobBase!==baseKey||form.jobSources!==canonical(images.map(image=>({id:image.id,kind:image.kind??'photo'}))));
  const stale=!!job&&(jobContextStale||form.jobBase!==baseKey||form.jobInput!==inputKey||!!mode&&form.jobMode!==mode||!!preview&&(preview.proposal.project_id!==remoteProjectId||preview.proposal.base_revision!==cloud.revision||preview.proposal.session_id!==cloud.lease?.sessionId||preview.proposal.generation!==cloud.lease?.generation||expired));
  const source=images.find(image=>image.id===selectedSource&&image.kind==='floorplan')??images.find(image=>image.kind==='floorplan');
  const currentStructure=useMemo(()=>referenceStructure(layout),[layout]);
  const requestRunning=busy||!!form.jobId&&(!job||ACTIVE.has(job.state));
  const sourcesKey=venueSourceKey(images);
  const venueLeaseExpires=cloud.project?cloud.lease?.expiresAt:undefined;
  const venueBlocked=requestRunning||!!preview||job?.state==='needs_review'||!formReady;
  const venueCandidate=useMemo(()=>{
    if(!venueEdit)return {layout:null,error:''};
    try{return {layout:previewVenueEdit(venueEdit.base,{width:venueEdit.width.trim()?Number(venueEdit.width):NaN,depth:venueEdit.depth.trim()?Number(venueEdit.depth):NaN,openings:venueEdit.openings}),error:''};}
    catch(error){return {layout:null,error:errorText(error)};}
  },[venueEdit]);
  const venueStale=(()=>{
    if(!venueEdit)return '';
    if(venueEdit.epoch!==scopeEpoch.current.epoch||venueEdit.sceneKey!==baseKey||venueEdit.sourceKey!==sourcesKey||
      images.some(image=>venueEdit.images.find(old=>old.id===image.id)?.blob!==image.blob))
      return '场景、项目或图纸资料已变化。本次草稿未应用，请取消后重新编辑。';
    if(venueLeaseExpired&&!localActivity)return '编辑权已过期。本次草稿未应用，请重新获取编辑权后核对。';
    try{if(venueEdit.sessionKey!==venueSessionKey(controller,scope))return '编辑会话或版本已变化。本次草稿未应用，请重新核对。';}
    catch(error){return errorText(error);}
    return '';
  })();
  const venueChanged=!!venueEdit&&!!venueCandidate.layout&&currentSceneKey(venueCandidate.layout)!==venueEdit.sceneKey;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let cancelled=false;hydratedScope.current=null;setLoaded(false);setLoadError('');
    formRef.current=EMPTY;setForm(EMPTY);setJob(null);setReview(null);setPreview(null);setVenueEdit(null);setVenueNotice(null);setMode('');setReidentify(false);setPollingPaused(false);setNotice('');setPoints([]);setReviewConfirmed(false);
    formHydration.current=formWrites.current.catch(()=>{}).then(()=>readSourceForm<Form>(scope)).then(saved=>{
      if(cancelled)return;
      if(saved!==undefined){
        if(!saved||typeof saved!=='object'||Array.isArray(saved)||
          (['width','depth','height','text','adjustment'] as const).some(key=>saved[key]!==undefined&&typeof saved[key]!=='string')||
          saved.constraints!==undefined&&!Array.isArray(saved.constraints))throw new Error('Invalid saved form');
        formRef.current={...EMPTY,...saved};setForm(formRef.current);
      }
      hydratedScope.current=scope;setLoaded(true);
    }).catch(()=>{if(!cancelled)setLoadError('本机图纸资料读取失败，自动保存已暂停。请重试读取。');});
    return()=>{cancelled=true;};
  },[scope,loadAttempt]);
  useEffect(()=>{setVenueNotice(current=>current?.sceneKey&&current.sceneKey!==baseKey?null:current);},[baseKey]);
  function notifyVenue(text:string,sceneKey?:string):void {setVenueNotice(text?{text,...(sceneKey?{sceneKey}:{})}:null);}
  function saveForm(saveScope:string,value:Form):Promise<void>{
    if(hydratedScope.current!==saveScope)return Promise.reject(new Error('图纸资料尚未读取成功，请重试读取后再保存。'));
    const write=formWrites.current.catch(()=>{}).then(()=>storeSourceForm(saveScope,value));formWrites.current=write;return write;
  }
  useEffect(()=>registerSourceFlush(scope,async()=>{
    await formHydration.current;
    if(hydratedScope.current!==scope)throw new Error('图纸资料尚未读取成功，请重试读取后再保存。');
    await formWrites.current;
    if(!alive.current||scopeRef.current!==scope)throw new Error('尺寸表单正在切换，请稍后重试。');
    await saveForm(scope,formRef.current);
  }),[scope]);
  useEffect(()=>{if(!formReady||referenceSaving.current)return;formSaveTimer.current=setTimeout(()=>{if(referenceSaving.current||scopeRef.current!==scope||hydratedScope.current!==scope)return;void saveForm(scope,formRef.current).catch(error=>{if(scopeRef.current===scope)setNotice(errorText(error));});},250);return()=>clearTimeout(formSaveTimer.current);},[form,formReady,scope]);
  useEffect(()=>{if(openReferenceRequest>0&&inputDetails.current)inputDetails.current.open=true;},[openReferenceRequest,formReady]);
  useEffect(()=>{setPoints([]);},[source?.id]);
  useEffect(()=>{setReviewConfirmed(false);},[review]);
  useEffect(()=>{setExpired(false);if(!preview)return;const remaining=Date.parse(preview.proposal.expires_at)-Date.now();if(remaining<=0){setExpired(true);return;}const timer=setTimeout(()=>setExpired(true),Math.min(remaining,2_147_000_000));return()=>clearTimeout(timer);},[preview]);
  useEffect(()=>{onPreview?.(venueEdit?(!venueStale?venueCandidate.layout:null):preview&&!stale?preview.layout:null);},[venueEdit,venueStale,venueCandidate.layout,preview,stale,onPreview]);
  useEffect(()=>()=>onPreview?.(null),[onPreview]);
  useEffect(()=>{
    setVenueLeaseExpired(false);
    if(!venueLeaseExpires)return;
    const remaining=Date.parse(venueLeaseExpires)-Date.now();
    if(!Number.isFinite(remaining)||remaining<=0){setVenueLeaseExpired(true);return;}
    const timer=setTimeout(()=>setVenueLeaseExpired(true),Math.min(remaining,2_147_000_000));
    return()=>clearTimeout(timer);
  },[venueLeaseExpires]);

  function startVenueEdit():void {
    notifyVenue('');
    if(venueBlocked||pending.current||referenceSaving.current){notifyVenue('请先完成当前核对或任务，再编辑场地。');return;}
    try{
      const scene=readEditableVenue(layoutRef.current),sessionKey=venueSessionKey(controller,scopeRef.current);
      setVenueEdit({base:layoutRef.current,scene,sceneKey:currentSceneKey(layoutRef.current),sourceKey:venueSourceKey(sourceImages.current),images:[...sourceImages.current],
        epoch:scopeEpoch.current.epoch,sessionKey,width:String(scene.venue.width),depth:String(scene.venue.depth),openings:structuredClone(scene.structure.openings),confirmed:false});
    }catch(error){notifyVenue(errorText(error));}
  }
  function confirmVenueEdit():void {
    if(!venueEdit||!venueEdit.confirmed||!venueChanged||venueStale||venueBlocked||pending.current||referenceSaving.current)return;
    try{
      // Recheck the live scope, sources and editor session immediately before the synchronous commit.
      if(scopeEpoch.current.epoch!==venueEdit.epoch||currentSceneKey(layoutRef.current)!==venueEdit.sceneKey||
        venueSourceKey(sourceImages.current)!==venueEdit.sourceKey||sourceImages.current.some(image=>venueEdit.images.find(old=>old.id===image.id)?.blob!==image.blob)||
        venueSessionKey(controller,scopeRef.current)!==venueEdit.sessionKey)throw new Error('当前场景或编辑会话已变化，草稿未应用，请重新核对。');
      const next=previewVenueEdit(venueEdit.base,{width:Number(venueEdit.width),depth:Number(venueEdit.depth),openings:venueEdit.openings});
      const frameChanged=next.width!==venueEdit.base.width||next.height!==venueEdit.base.height;
      onApply(next);patch({width:String(next.width),depth:String(next.height)});setVenueEdit(null);
      notifyVenue(`场地修改已应用，可撤销，并沿用当前场景的本机保存。${frameChanged?'总宽或总深已变化，请重新核对原图对应。':'原图对应的尺度保持。'}${cloud.project&&!localActivity?'云端保存状态请查看项目面板。':''}`,currentSceneKey(next));
    }catch(error){notifyVenue(errorText(error));}
  }

  async function acceptJob(result:ReconstructionJob,expectedScope:string,isCurrent:()=>boolean):Promise<void> {
    if(!alive.current||scopeRef.current!==expectedScope||!isCurrent())return;
    if(result.proposal&&result.proposal.project_id!==geometryProjectId(controller,expectedScope))throw new Error('候选属于其他场景连接，当前资料已保留，请重新查询原任务。');
    if(result.state==='needs_review'&&result.candidate){setReview(result.candidate);setReviewConfirmed(false);const detected=result.candidate.dimensions;setForm(current=>({...current,constraints:mergeRecognizedDimensions(current.constraints,detected,Object.values(current.fixedIds??{}))}));}
    if(result.state==='ready'&&result.proposal){
      const assets=await controller.authorizeAssets(result.proposal.candidate);
      await Promise.all(Object.entries(assets.assetUrls).map(([id,url])=>ensureGlbAsset(id,url)));
      if(!alive.current||scopeRef.current!==expectedScope||!isCurrent())return;
      const next=mergeProposalPresentation(layoutRef.current,backendSceneToLayout(result.proposal.candidate,{projectId:layoutRef.current.id!,name:layoutRef.current.name,...assets}));
      setPreview({proposal:result.proposal,layout:next,assets});
    }
    jobSourceVersion.current=sourceVersion.current;setJob(result);
  }
  // Only an authenticated, persisted binding can restore this local activity's original job.
  useEffect(()=>{
    if(!formReady||!form.jobId||!form.jobIdentity||!cloud.user||cloud.project||pollingPaused)return;
    let saved:{scope?:string;user?:string;api?:string;binding?:{localActivityId?:string;cloudProjectId?:string;userId?:string;apiUrl?:string}};
    try{saved=JSON.parse(form.jobIdentity);}catch{return;}
    if(saved.scope!==scope||saved.user!==cloud.user.id||saved.api!==controller.config.apiUrl||
      saved.binding?.localActivityId!==scope||saved.binding.userId!==cloud.user.id||saved.binding.apiUrl!==controller.config.apiUrl)return;
    let cancelled=false;
    void controller.resumeGeometryWorkbench(layoutToBackendScene(layoutRef.current),layoutRef.current.name??'本地活动',scope).then(project=>{
      if(cancelled)return;
      if(!project||project.id!==saved.binding?.cloudProjectId){setPollingPaused(true);setNotice('原任务的场景连接未能恢复，任务编号与本机资料已保留。');}
    }).catch(error=>{if(!cancelled){setPollingPaused(true);setNotice(`原任务连接恢复暂停：${errorText(error)}`);}});
    return()=>{cancelled=true;};
  },[controller,formReady,form.jobId,form.jobIdentity,cloud.user,cloud.project,scope,pollingPaused]);
  // Resume the same paid task after refresh; status reads never resubmit generation.
  useEffect(()=>{
    if(busy||!formReady||!form.jobId||!cloud.user||!remoteProjectId||pollingPaused||job&&!ACTIVE.has(job.state))return;
    if(form.jobIdentity?form.jobIdentity!==identityKey:remoteProjectId!==scope)return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;const expectedScope=scope,epoch=scopeEpoch.current.epoch,expectedIdentity=identityKey,expectedSession=sessionKey,expectedSource=sourceVersion.current;
    const current=()=>!cancelled&&scopeEpoch.current.epoch===epoch&&sourceVersion.current===expectedSource&&geometryIdentity(controller,expectedScope)===expectedIdentity&&venueSessionKey(controller,expectedScope)===expectedSession;
    async function poll(){try{const result=await controller.getReconstruction(form.jobId!);if(!current())return;if(result.id!==form.jobId)throw new Error('返回的任务不匹配，原任务编号已保留。');await acceptJob(result,expectedScope,current);if(ACTIVE.has(result.state))timer=setTimeout(poll,2000);}catch(error){if(!cancelled){setNotice(`状态查询暂停：${errorText(error)}。任务编号已保留，可继续查询。`);setPollingPaused(true);}}}
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
    // acceptJob reads current refs; rerendering the form should not restart a polling request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[busy,formReady,form.jobId,form.jobIdentity,cloud.user?.id,remoteProjectId,identityKey,sessionKey,scope,pollingPaused,job?.state]);

  function patch(patch:Partial<Form>){if(hydratedScope.current!==scope)return;formRef.current={...formRef.current,...patch};setForm(formRef.current);}
  async function confirmReference(registration:ReferenceRegistration):Promise<void>{
    if(venueEdit)throw new Error('请先确认或取消场地编辑，再核对原图对应。');
    if(referenceSaving.current||pending.current||!formReady)throw new Error('当前表单仍在读取或保存，请稍后确认原图对应。');
    const expectedScope=scopeRef.current,basis=referenceSceneBasis(layoutRef.current),expectedEpoch=scopeEpoch.current.epoch;
    if(!basis||registration.appliedBasis!==basis)throw new Error('当前设计已变化，请重新核对对应点。');
    referenceSaving.current=true;
    clearTimeout(formSaveTimer.current);
    const check=()=>{if(!alive.current||scopeRef.current!==expectedScope||scopeEpoch.current.epoch!==expectedEpoch||referenceSceneBasis(layoutRef.current)!==basis)throw new Error('项目或场地坐标范围已变化，本次对应不用于当前设计。');};
    const write=formWrites.current.catch(()=>{}).then(async()=>{
      check();
      const sources=sourceImages.current.map(image=>({...image,scope:expectedScope,kind:image.kind??'photo',width:image.width??0,height:image.height??0}));
      const resolved=resolveReferenceImage(layoutRef.current,sources,{registration});if(resolved.status!=='ready')throw new Error(resolved.notice);
      const previous=formRef.current,next={...previous,registration};let stored=false;
      try{
        await storeSourceForm(expectedScope,next);stored=true;
        const saved=await readSourceForm<Form>(expectedScope);check();
        if(!saved?.registration||canonical(saved.registration)!==canonical(registration))throw new Error('本机原图对应保存后未能核实，请重试确认。');
        formRef.current={...formRef.current,registration};setForm(formRef.current);
      }catch(error){
        if(stored){
          const rollback=scopeRef.current===expectedScope&&scopeEpoch.current.epoch===expectedEpoch?{...formRef.current}:{...previous};
          if(previous.registration)rollback.registration=previous.registration;else delete rollback.registration;
          try{await storeSourceForm(expectedScope,rollback);}catch(rollbackError){throw new Error(`${errorText(error)} 原对应回退也失败，请保留此页面并重试。${errorText(rollbackError)}`);}
        }
        throw error;
      }
    });
    formWrites.current=write;
    try{await write;}finally{referenceSaving.current=false;if(alive.current&&scopeRef.current===expectedScope)setForm({...formRef.current});}
  }
  function addConstraint(constraint:Omit<DimensionConstraint,'id'|'status'>){patch({constraints:[...form.constraints,{...constraint,id:crypto.randomUUID(),status:'confirmed'}]});}
  function addCalibration(){if(!source||points.length!==2||!(Number(distance)>0))return;if(Math.hypot(points[0].x-points[1].x,points[0].z-points[1].z)<2){setNotice('请选取两个不同位置。');return;}addConstraint({kind:'distance',label:`${source.name} 两点标定`,valueMeters:Number(distance),sourceAssetId:source.id,start:{x:points[0].x/source.width!,z:points[0].z/source.height!},end:{x:points[1].x/source.width!,z:points[1].z/source.height!}});setPoints([]);setDistance('');}
  async function uploadSources(isCurrent:()=>boolean):Promise<SourceImage[]>{const sources:SourceImage[]=[];for(const image of images){if(!isCurrent())throw new Error('场景连接或图纸已变化，请重新核对。');const kind=image.kind??'photo';if(image.assetId){sources.push({assetId:image.assetId,kind,name:image.name,width:image.width!,height:image.height!});continue;}if(!image.blob)throw new Error(`缺少 ${image.name} 的原始图片，请重新选择。`);const uploaded=await controller.uploadSource(image.blob,image.name,kind);if(!isCurrent())throw new Error('场景连接或图纸已变化，请重新核对。');updateImage(image.id,{assetId:uploaded.assetId,uploadedKind:kind});sources.push(uploaded);}return sources;}
  async function generate(continueReview=false):Promise<void>{
    if(venueEdit){setNotice('请先确认或取消场地编辑，再生成方案。');return;}
    if(pending.current)return;if(referenceSaving.current){setNotice('正在保存原图对应，请完成后再生成。');return;}setNotice('');
    if(!connected){setNotice(localActivity?'本机资料已保留。请先准备场景连接，再生成方案。':'本机资料已保留。请在云项目中登录、打开当前项目并获取编辑权，才能调用真实识别服务。');return;}
    if(!images.length&&!layout.backendSceneV2){setNotice('请先添加平面图或现场照片。也可以下方按实测尺寸创建矩形场地。');return;}
    const currentStructure=layout.backendSceneV2;
    const sourcesChanged=!!currentStructure&&images.length>0&&(images.length!==currentStructure.sources.length||images.some(image=>!image.assetId||!currentStructure.sources.some(source=>source.assetId===image.assetId&&source.kind===(image.kind??'photo'))));
    if(currentStructure&&sourcesChanged&&!reidentify&&!continueReview){setNotice('来源图片或资料类型发生了变化。请开启「重新识别结构」后生成，已有场景会保留至你确认候选。');return;}
    if(hasPhotos&&!mode){setNotice('本次包含现场照片，请先选择「还原现场」或「重新布置」。');return;}
    const fixed=[['width','总宽',form.width],['depth','总深',form.depth],['height','层高',form.height]] as const;
    if(fixed.some(([, ,value])=>value!==''&&(!Number.isFinite(Number(value))||Number(value)<=0))){setNotice('填写的尺寸须为大于零的米数。');return;}
    if(!(layout.backendSceneV2&&!reidentify&&!sourcesChanged)&&!fixed.some(([kind,,value])=>kind!=='height'&&Number(value)>0)&&!form.constraints.some(d=>d.kind!=='height'&&d.valueMeters>0)){setNotice('请至少提供一项已知平面尺寸；非等比例手绘和照片通常需要多项尺寸。');return;}
    if(continueReview&&(!review||!reviewConfirmed||reviewStale)){setNotice('请先核对并确认候选结构；场景或要求变化后须重新识别。');return;}
    const base=layoutRef.current,submittedInput=inputRef.current,submittedScope=scopeRef.current,epoch=scopeEpoch.current.epoch;
    const expectedIdentity=geometryIdentity(controller,submittedScope),expectedSession=sessionKey;
    const submittedImages=[...sourceImages.current];
    const current=()=>alive.current&&scopeEpoch.current.epoch===epoch&&sourceImages.current.every((image,index)=>image.blob===submittedImages[index]?.blob)&&inputRef.current===submittedInput&&layoutRef.current===base&&geometryIdentity(controller,submittedScope)===expectedIdentity&&venueSessionKey(controller,submittedScope)===expectedSession;
    pending.current=true;setBusy(true);setPreview(null);setPollingPaused(false);
    try{
      await assertGeometryActionSource(base,controller);
      if(!current())throw new Error('当前活动或场景连接已变化，请重新核对。');
      const scene=layoutToBackendScene(base),sources=await uploadSources(current);
      if(!current())throw new Error('场景连接或图纸已变化，请重新核对。');
      const fixedIds=form.fixedIds??{width:crypto.randomUUID(),depth:crypto.randomUUID(),height:crypto.randomUUID()};
      let dimensions:DimensionConstraint[]=[...fixed.filter(([, ,value])=>value!=='').map(([kind,label,value])=>({id:fixedIds[kind]!,kind,label,valueMeters:Number(value),status:'confirmed' as const})),...form.constraints.map(d=>({...d,...(d.sourceAssetId?{sourceAssetId:sources[images.findIndex(image=>image.id===d.sourceAssetId||image.assetId===d.sourceAssetId)]?.assetId??d.sourceAssetId}:{} )}))];
      if(scene.schemaVersion===2&&!reidentify&&!dimensions.length)dimensions=scene.dimensions;
      if(continueReview)dimensions=dimensions.map(d=>({...d,status:'confirmed'}));
      const selectedIds=[...selection.allSelectedIds].filter(id=>scene.objects.some(object=>object.id===id));
      const instruction=[`活动：${brief.event}；人数：${brief.guests}。`,brief.description||'按资料还原空间，并核对所有尺寸。',brief.mustHave&&`必须满足：${brief.mustHave}`,brief.venueConditions&&`已确认现场条件：${brief.venueConditions}`,brief.style&&`风格：${brief.style}`,brief.palette&&`配色：${brief.palette}`,brief.atmosphere&&`氛围：${brief.atmosphere}`,form.text&&`用户尺寸描述：${form.text}`,form.adjustment&&`本次局部修改要求：${form.adjustment}`,brief.allowIdeas?'直接设计并布置适合活动的创意亮点；每项亮点关联具体物件。':'只实现明确要求。','保留固定结构、锁定物件和用户明确要求；无法满足的条件逐项说明。'].filter(Boolean).join('\n');
      if(instruction.length>3000)throw new Error('需求总长度超过 3000 字，请精简后生成。');
      const reviewedScene=continueReview?sceneV2Schema.parse({...review!,dimensions,structure:{walls:review!.structure.walls.map(w=>({...w,status:'confirmed'})),openings:review!.structure.openings.map(o=>({...o,status:'confirmed'})),columns:review!.structure.columns.map(c=>({...c,status:'confirmed'}))}}):scene.schemaVersion===2&&!reidentify?scene:undefined;
      const requestKey=canonical({identity:expectedIdentity,reviewedJobId:continueReview?job?.id:undefined,session:controller.getSnapshot().sessionId,leaseGeneration:controller.getSnapshot().lease?.generation,revision:controller.getSnapshot().revision,scene,sources,dimensions:dimensions.map(({id,...dimension})=>dimension),instruction,selectedIds,mode:hasPhotos?mode:'redesign',reviewedScene});
      const requestId=form.requestKey===requestKey&&form.requestId&&job?.state!=='failed'&&job?.state!=='ready'?form.requestId:crypto.randomUUID();
      const nextForm={...form,fixedIds,requestKey,requestId,jobIdentity:expectedIdentity,jobSession:expectedSession,jobBase:canonical(scene),jobInput:submittedInput,jobSources:canonical(images.map(image=>({id:image.id,kind:image.kind??'photo'}))),jobMode:hasPhotos?mode as 'restore'|'redesign':'redesign' as const,jobId:undefined};
      formRef.current=nextForm;setForm(nextForm);await saveForm(submittedScope,nextForm).catch(()=>{});
      if(!current())throw new Error('上传期间资料或场景发生变化，请核对后重新生成。');
      const result=await controller.createReconstruction({requestId,scene,sources,dimensions,mode:hasPhotos?mode as 'restore'|'redesign':'redesign',instruction,selectedIds,...(reviewedScene?{reviewedScene}:{}),...(continueReview&&job?{reviewedJobId:job.id}:{})});
      if(!current())return;
      patch({...nextForm,jobId:result.id});await saveForm(submittedScope,formRef.current);setMode('');await acceptJob(result,submittedScope,current);
    }catch(error){if(alive.current&&scopeRef.current===submittedScope)setNotice(errorText(error));}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  async function prepareConnection():Promise<void>{
    if(pending.current||referenceSaving.current||!formReady)return;
    pending.current=true;setBusy(true);setNotice('');
    const base=layoutRef.current,epoch=scopeEpoch.current.epoch,identity=geometryIdentity(controller,scopeRef.current);
    try{
      await assertGeometryActionSource(base,controller);
      if(scopeEpoch.current.epoch!==epoch||layoutRef.current!==base||geometryIdentity(controller,scopeRef.current)!==identity)throw new Error('当前活动或账户已变化，请重新准备场景连接。');
      await controller.ensureGeometryWorkbenchReady(layoutToBackendScene(base),base.name??'本地活动',scopeRef.current);
      if(alive.current&&scopeEpoch.current.epoch===epoch)setNotice('场景连接已准备好，可以生成方案。本机活动资料已保留。');
    }catch(error){if(alive.current&&scopeEpoch.current.epoch===epoch)setNotice(errorText(error));}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  async function apply():Promise<void>{
    if(!preview||pending.current||stale)return;
    pending.current=true;setBusy(true);
    const selected=preview,base=layoutRef.current,submittedScope=scopeRef.current,epoch=scopeEpoch.current.epoch;
    const identity=geometryIdentity(controller,submittedScope),session=sessionKey,submittedInput=inputRef.current,submittedImages=[...sourceImages.current];
    const lease=controller.getSnapshot().lease;
    const current=()=>alive.current&&scopeEpoch.current.epoch===epoch&&layoutRef.current===base&&inputRef.current===submittedInput&&sourceImages.current.every((image,index)=>image.blob===submittedImages[index]?.blob)&&geometryIdentity(controller,submittedScope)===identity;
    try{
      await assertGeometryActionSource(base,controller);
      if(!current()||venueSessionKey(controller,submittedScope)!==session||selected.proposal.project_id!==geometryProjectId(controller,submittedScope))throw new Error('当前活动或场景连接已变化，候选尚未应用。');
      if((base.designBook?.variants.length??0)>=MAX_DESIGNS)throw new Error('请先在图层面板移除不再需要的方案，再确认提案。');
      const result=await controller.applySceneProposal(selected.proposal,layoutToBackendScene(base));
      if(!current())return;
      const after=controller.getSnapshot();
      if(!result.acceptedLocally||after.lease?.sessionId!==lease?.sessionId||after.lease?.generation!==lease?.generation)throw new Error('应用期间本地有新修改，已保留草稿；请核对云端新版本。');
      onApply(addDesign(base,mergeProposalPresentation(base,backendSceneToLayout(result.scene,{projectId:base.id!,name:base.name,...selected.assets}))));
      setPreview(null);setJob(null);setReview(null);patch({jobId:undefined,requestId:undefined});setNotice('候选已应用并保存，可用一次撤销恢复应用前的本地方案。');
    }catch(error){if(current())setNotice(errorText(error));}finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  const floorplan=useMemo(()=>source&&source.width&&source.height?source:null,[source]);
  const reviewedWall=review?.structure.walls.find(w=>w.id===selectedWall);
  function updateWall(patch:Partial<SceneV2['structure']['walls'][number]>){if(!reviewedWall||!review)return;setReview(updateReviewedWall(review,reviewedWall.id,patch));}

  const openingShapes=review?.structure.openings.map(opening=>{const line=openingLine(review,opening);return line?<line key={opening.id} x1={line.x1} y1={line.z1} x2={line.x2} y2={line.z2} stroke={opening.kind==='door'?'#64a78b':'#61a5c2'} strokeWidth={.16}><title>{opening.kind==='door'?'门':'窗'} {opening.width}米</title></line>:null;});
  function focusObject(id:string|undefined){
    if(!id)return;selection.selectOnly?.(id);
    const target=(preview?.layout??layout).floors.flatMap(floor=>floor.items).find(item=>item.id===id);
    if(target)window.dispatchEvent(new CustomEvent('scendance:focus-object',{detail:{projectId:layout.id,objectId:id,position:target.position}}));
  }
  const currentDesign=layout.backendSceneV2?.design;
  return <section className="rc-panel" aria-label="图纸与照片重建">
    {!formReady&&<p className="cr-hint" role={loadError?'alert':'status'}>{loadError||'正在读取本机图纸资料…'}</p>}
    {loadError&&<button type="button" className="rc-secondary" onClick={()=>setLoadAttempt(value=>value+1)}>重试读取图纸资料</button>}
    {layout.backendSceneV2&&<section className="rc-manual-venue" aria-label="人工编辑当前场地">
      <h4>当前场地 · {layout.width} × {layout.height} 米</h4>
      {!venueEdit?<><p className="cr-hint">可人工修改矩形场地的总宽、总深及现有门窗，先预览，核对后应用。</p><button type="button" className="rc-secondary" disabled={venueBlocked} onClick={startVenueEdit}>编辑当前场地</button></>:<>
        <p className="cr-hint">固定图中参考角 (0,0)，调整对边。物料、内墙和柱子的实际位置、尺寸保持；门窗距离从所属墙的起点计算。</p>
        <fieldset disabled={!!venueStale||venueBlocked} className="rc-venue-fields"><legend>场地编辑草稿 · 尚未应用</legend>
          <div className="rc-measures rc-venue-measures">{([['width','总宽'],['depth','总深']] as const).map(([key,label])=><label key={key}>{label}（米）<input type="number" step="0.001" min="0.02" max="200" aria-label={`编辑${label}（米）`} value={venueEdit[key]} onChange={event=>{const value=event.target.value;setVenueEdit(current=>current?{...current,[key]:value,confirmed:false}:null);notifyVenue('');}}/></label>)}</div>
          {venueEdit.openings.map((opening,index)=><details key={opening.id}><summary>{opening.kind==='door'?'门洞':'窗户'} {index+1} · 墙 {venueEdit.scene.structure.walls.findIndex(wall=>wall.id===opening.wallId)+1}</summary><div className="rc-measures rc-venue-measures">
            {(['offset','width','height','sillHeight'] as const).map(key=><NumberField key={key} label={`${opening.kind==='door'?'门洞':'窗户'} ${index+1} · ${{offset:'距墙起点',width:'宽度',height:'高度',sillHeight:'离地高度'}[key]}（米）`} value={opening[key]} onChange={value=>{setVenueEdit(current=>current?{...current,confirmed:false,openings:current.openings.map(item=>item.id===opening.id?{...item,[key]:value}:item)}:null);notifyVenue('');}}/>)}
          </div></details>)}
          {venueCandidate.layout?.backendSceneV2&&<><VenueEditDrawing before={venueEdit.scene} after={venueCandidate.layout.backendSceneV2}/><p className="cr-hint">灰色虚线为原场地，绿色为草稿，橙色为门窗。所属外墙移动时，门窗位置也会变化，请对照核实。</p><p>总宽 {venueEdit.scene.venue.width} → {venueCandidate.layout.width} 米；总深 {venueEdit.scene.venue.depth} → {venueCandidate.layout.height} 米。</p>{venueCandidate.layout.backendSceneV2.structure.openings.map((opening,index)=>{
            const before=venueEdit.scene.structure.openings.find(item=>item.id===opening.id)!;
            const oldLine=openingLine(venueEdit.scene,before),newLine=openingLine(venueCandidate.layout!.backendSceneV2!,opening);
            const changed=canonical(before)!==canonical(opening)||canonical(oldLine)!==canonical(newLine);
            return changed?<p key={opening.id}>{opening.kind==='door'?'门洞':'窗户'} {index+1} 的位置或尺寸有变化，请核对图中橙色标记。</p>:null;
          })}</>}
          {venueCandidate.error&&<p role="alert" className="cr-notice">{venueCandidate.error} 草稿尚未应用，原场地保持。</p>}
          <label className="cr-check"><input type="checkbox" disabled={!venueCandidate.layout||!venueChanged} checked={venueEdit.confirmed} onChange={event=>{const confirmed=event.target.checked;setVenueEdit(current=>current?{...current,confirmed}:null);}}/><span>我已核对修改后的尺寸、门窗位置和现场条件</span></label>
        </fieldset>
        {venueStale&&<p role="alert" className="cr-notice">{venueStale}</p>}
        <div className="rc-actions"><button type="button" className="rc-secondary" onClick={()=>{setVenueEdit(null);notifyVenue('已取消编辑，原场地保持。');}}>取消场地编辑</button><button type="button" className="rc-secondary" disabled={!venueCandidate.layout||!venueEdit.confirmed||!venueChanged||!!venueStale||venueBlocked} onClick={confirmVenueEdit}>确认应用场地修改</button></div>
      </>}
      {venueNotice&&(!venueNotice.sceneKey||venueNotice.sceneKey===baseKey)&&<p className="cr-notice" role="status">{venueNotice.text}</p>}
    </section>}
    <fieldset className="rc-existing-controls" disabled={!!venueEdit||!formReady}>
    <details className="rc-inputs" ref={inputDetails}><summary><Ruler size={16}/><span>图纸与照片重建</span><small>米制 · 可核对</small></summary>
    <p className="cr-hint">输入实测尺寸，图纸和照片共同补充空间信息。照片遮挡处与手绘不确定部分需要核对。</p>
    {localActivity&&!connected&&<button type="button" className="rc-secondary" disabled={busy||!formReady} onClick={()=>void prepareConnection()}>准备场景连接</button>}
    {layout.backendSceneV2&&<><p className="cr-hint">下方是待提交的生成尺寸，填写不会修改当前场地。当前场地为 {layout.width} × {layout.height} 米。</p>{generationSizeDifferences.length>0&&<p className="cr-notice" aria-live="polite">待提交生成尺寸与当前场地不同：{generationSizeDifferences.map(([label,value,current])=>`${label}输入 ${value} 米，当前 ${current} 米`).join('；')}。输入已保留，生成前请重新核对。</p>}</>}
    <div className="rc-measures">{([['width','总宽'],['depth','总深'],['height','层高']] as const).map(([key,label])=><label key={key}>{label}（米）<input aria-label={`${label}（米）`} type="number" step="0.001" min="0.001" max={key==='height'?30:200} value={form[key]} onChange={e=>patch({[key]:e.target.value})} placeholder="实测值"/></label>)}</div>
    <label className="cr-label">补充尺寸<textarea aria-label="补充尺寸" rows={2} value={form.text} onChange={e=>patch({text:e.target.value})} placeholder="北墙 8 米，入口宽 1.2 米，柱间距 450 厘米"/></label>
    <button type="button" className="rc-secondary" onClick={()=>{const parsed=parseDimensionText(form.text);if(!parsed.length){setNotice('请描述长度及单位，例如「北墙 8 米」。');return;}patch({constraints:[...form.constraints,...parsed.map(item=>({...item,id:crypto.randomUUID(),status:'confirmed' as const}))]});setNotice('已提取数值，请核对下方尺寸并关联对象；文字会同时提交模型理解。');}}>将文字尺寸加入清单</button>
    {floorplan&&<details className="rc-calibration"><summary>在图纸上标定一段实际距离</summary><select aria-label="标定图纸" value={floorplan.id} onChange={e=>setSelectedSource(e.target.value)}>{images.filter(image=>image.kind==='floorplan').map(image=><option key={image.id} value={image.id}>{image.name}</option>)}</select>
      <div className="rc-image-map" role="button" tabIndex={0} aria-label="在图纸上点击两个测量点" onClick={event=>{const point=containedImagePoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect(),floorplan.width!,floorplan.height!);if(point)setPoints(current=>current.length===2?[point]:[...current,point]);}}>
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={floorplan.url} alt="待标定平面图"/>
        <svg viewBox={`0 0 ${floorplan.width} ${floorplan.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{points.length===2&&<line x1={points[0].x} y1={points[0].z} x2={points[1].x} y2={points[1].z} stroke="#e17637" strokeWidth={floorplan.width!/180}/ >}{points.map((point,i)=><circle key={i} cx={point.x} cy={point.z} r={floorplan.width!/65} fill="#e17637"/>)}</svg>
      </div>
      <p className="cr-hint">已选 {points.length}/2 个点。仅用于按比例图纸；照片请填写已知长度或补充多视角。</p><label className="cr-label">两点实际距离（米）<input aria-label="两点实际距离（米）" type="number" step="0.001" min="0.001" value={distance} onChange={e=>setDistance(e.target.value)}/></label><button type="button" className="rc-secondary" disabled={points.length!==2||!(Number(distance)>0)} onClick={addCalibration}>加入标定尺寸</button>
    </details>}
    {form.constraints.length>0&&<div className="rc-constraints" aria-label="尺寸清单">{form.constraints.map(d=><div key={d.id}><input aria-label="尺寸说明" title={d.status==='confirmed'?'用户确认':'模型识别，待核对'} value={d.label} onChange={e=>patch({constraints:form.constraints.map(v=>v.id===d.id?{...v,label:e.target.value}:v)})}/><input aria-label={`${d.label} 米数`} type="number" min="0.001" step="0.001" value={d.valueMeters} onChange={e=>patch({constraints:form.constraints.map(v=>v.id===d.id?{...v,valueMeters:e.target.valueAsNumber,status:'confirmed'}:v)})}/><span>米</span><button type="button" aria-label={`删除尺寸 ${d.label}`} onClick={()=>patch({constraints:form.constraints.filter(v=>v.id!==d.id)})}><X size={12}/></button>{review&&(d.kind==='wall'||d.kind==='distance')&&<><select aria-label={`${d.label} 对应对象`} value={d.targetId??''} onChange={e=>patch({constraints:form.constraints.map(v=>v.id===d.id?{...v,targetId:e.target.value||undefined}:v)})}><option value="">关联墙、门窗或柱子</option>{review.structure.walls.map((w,index)=>({w,index})).filter(({w})=>!d.sourceAssetId||(w.evidence??[]).some(e=>e.sourceAssetId===(images.find(image=>image.id===d.sourceAssetId)?.assetId??d.sourceAssetId))).map(({w,index})=><option value={w.id} key={w.id}>墙 {index+1}</option>)}{review.structure.openings.map((o,index)=><option value={o.id} key={o.id}>{o.kind==='door'?'门':'窗'} {index+1}</option>)}{review.structure.columns.map((c,index)=><option value={c.id} key={c.id}>柱子 {index+1}</option>)}</select>{d.targetId&&<select aria-label={`${d.label} 测量方向`} value={d.measure??'length'} onChange={e=>patch({constraints:form.constraints.map(v=>v.id===d.id?{...v,measure:e.target.value as 'width'|'depth'|'height'|'length'}:v)})}><option value="length">长度 / 两柱中心距</option><option value="width">宽度</option><option value="depth">深度</option><option value="height">高度</option></select>}{review.structure.columns.some(c=>c.id===d.targetId)&&<select aria-label={`${d.label} 另一根柱子`} value={d.targetEndId??''} onChange={e=>patch({constraints:form.constraints.map(v=>v.id===d.id?{...v,targetEndId:e.target.value||undefined}:v)})}><option value="">测量单柱尺寸</option>{review.structure.columns.filter(c=>c.id!==d.targetId).map((c,index)=><option value={c.id} key={c.id}>至柱子 {index+1}</option>)}</select>}</>}</div>)}</div>}
    <details><summary>本地手动建模</summary><p className="cr-hint">按实测长宽高创建矩形空间，可离线使用。只转换人工输入，不进行图片识别；已有复杂结构需在场地中逐项编辑。</p><button className="rc-secondary" type="button" disabled={!form.width||!form.depth||!form.height||busy||!localActivity&&!!cloud.project&&cloud.writeBlocked} onClick={()=>{try{const next=createMeasuredRoomLayout(layout,{width:Number(form.width),depth:Number(form.depth),height:Number(form.height)});onApply(next);setNotice('已根据人工尺寸创建本地矩形空间；图片尚未识别。');}catch(error){setNotice(errorText(error));}}}>按实测尺寸创建矩形场地</button></details>
    {(images.length>0||!!layout.backendSceneV2)&&<>
      {layout.backendSceneV2&&images.length>0&&<label className="cr-check"><input type="checkbox" checked={reidentify} onChange={event=>setReidentify(event.target.checked)}/><span><strong>重新识别结构</strong><small>默认沿用已确认的墙、门窗与柱子，直接规划风格和布置。换图或需要重测时开启。</small></span></label>}
      {hasPhotos&&<fieldset className="rc-mode"><legend>本次照片生成模式 <small>每次请选择</small></legend>{([['restore','还原现场','保留已有家具与外观'],['redesign','重新布置','保留固定结构与锁定物件']] as const).map(([value,label,hint])=><label key={value}><input type="radio" name={`photo-mode-${scope}`} value={value} checked={mode===value} onChange={()=>setMode(value)}/><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset>}
      <label className="cr-label">局部修改或保留要求<textarea aria-label="局部修改或保留要求" value={form.adjustment} maxLength={1000} rows={2} onChange={e=>patch({adjustment:e.target.value})} placeholder="保留座位和结构，只调整展示区。可在场景中锁定要保留的物件。"/></label>
      <button type="button" className="cr-generate" disabled={requestRunning||!formReady} onClick={()=>void generate()}>{requestRunning?<Loader2 size={16} className="cr-spin"/>:<Sparkles size={16}/>} {requestRunning?(busy?'正在处理当前操作…':'重建任务进行中…'):'Generate 重建并设计方案'}</button>
    </>}
    </details>
    {form.jobId&&!job&&<div className="rc-job" role="status"><strong>{form.jobIdentity&&form.jobIdentity!==identityKey?'原任务等待恢复场景连接':'正在恢复原重建任务'}</strong><small>任务 {form.jobId.slice(0,8)}</small>{pollingPaused&&<button type="button" className="rc-secondary" onClick={()=>setPollingPaused(false)}>继续查询原任务</button>}</div>}
    {job&&<div className="rc-job" role="status"><strong>{LABELS[job.state]}</strong><small>任务 {job.id.slice(0,8)}</small>{stale&&<p>场景、资料、要求或编辑会话已变化，旧结果仅供核对。请重新生成后应用。</p>}{job.issues.map((issue,index)=><p key={`${issue.code}-${index}`}>{issue.message}</p>)}{job.error_code&&<p>{errorCodeText(job.error_code)}</p>}{pollingPaused&&<button type="button" className="rc-secondary" onClick={()=>{setPollingPaused(false);setNotice('');}}>继续查询原任务</button>}</div>}
    {review&&job?.state==='needs_review'&&<div className="rc-review"><h4>核对识别结构</h4><p className="cr-hint">结构示意使用米制坐标。点击墙线编辑，核对门窗、柱子与看不到的区域；确认意味着你已根据现场或图纸核实。</p>
      <svg className="rc-plan" viewBox={`-0.5 -0.5 ${review.venue.width+1} ${review.venue.depth+1}`} aria-label="二维结构核对图">{review.venue.polygon&&<polygon points={review.venue.polygon.map(p=>`${p.x},${p.z}`).join(' ')} fill="#f3efe5"/>}{review.structure.walls.map((wall,index)=><g key={wall.id} onClick={()=>setSelectedWall(wall.id)} role="button" aria-label={`编辑墙 ${index+1}`} tabIndex={0} onKeyDown={event=>{if(event.key==='Enter')setSelectedWall(wall.id);}}><line x1={wall.start.x} y1={wall.start.z} x2={wall.end.x} y2={wall.end.z} stroke={wall.id===selectedWall?'#e17637':wall.status==='confirmed'?'#355b4b':'#b48a50'} strokeWidth={Math.max(.08,wall.thickness)}/><text x={(wall.start.x+wall.end.x)/2} y={(wall.start.z+wall.end.z)/2-.12} fontSize=".25">{index+1}</text></g>)}{openingShapes}{review.structure.columns.map(column=><rect key={column.id} x={column.position.x-column.size.width/2} y={column.position.z-column.size.depth/2} width={column.size.width} height={column.size.depth} transform={`rotate(${column.rotation} ${column.position.x} ${column.position.z})`} fill="#7b8574"/> )}</svg>
      <ReferenceImageReview scene={review} layout={layout} images={images} registration={form.registration} onChange={value=>patch({registration:value})} onConfirm={confirmReference} updateImage={updateImage} onAddImages={undefined} applied={false} openRequest={openReferenceRequest}/>
      {reviewedWall&&<div className="rc-wall-fields"><strong>墙 {review.structure.walls.findIndex(w=>w.id===reviewedWall.id)+1}</strong><div className="rc-measures"><NumberField label="起点 X" value={reviewedWall.start.x} onChange={x=>updateWall({start:{...reviewedWall.start,x}})}/><NumberField label="起点 Z" value={reviewedWall.start.z} onChange={z=>updateWall({start:{...reviewedWall.start,z}})}/><NumberField label="终点 X" value={reviewedWall.end.x} onChange={x=>updateWall({end:{...reviewedWall.end,x}})}/><NumberField label="终点 Z" value={reviewedWall.end.z} onChange={z=>updateWall({end:{...reviewedWall.end,z}})}/><NumberField label="墙厚" value={reviewedWall.thickness} onChange={thickness=>updateWall({thickness})}/><NumberField label="墙高" value={reviewedWall.height} onChange={height=>updateWall({height})}/></div></div>}
      {review.structure.openings.map((o,index)=><details key={o.id}><summary>{o.kind==='door'?'门':'窗'} {index+1} · 墙 {review.structure.walls.findIndex(w=>w.id===o.wallId)+1} · {o.status==='confirmed'?'已确认':'待核对'}</summary><div className="rc-measures">{(['offset','width','height','sillHeight'] as const).map(key=><NumberField key={key} label={{offset:'距墙起点',width:'宽度',height:'高度',sillHeight:'窗台高度'}[key]} value={o[key]} onChange={value=>setReview({...review,structure:{...review.structure,openings:review.structure.openings.map(item=>item.id===o.id?{...item,[key]:value}:item)}})}/>)}</div></details>)}
      {review.structure.columns.map((c,index)=><details key={c.id}><summary>柱子 {index+1} · {c.status==='confirmed'?'已确认':'待核对'}</summary><div className="rc-measures"><NumberField label="中心 X" value={c.position.x} onChange={x=>setReview({...review,structure:{...review.structure,columns:review.structure.columns.map(item=>item.id===c.id?{...item,position:{...item.position,x}}:item)}})}/><NumberField label="中心 Z" value={c.position.z} onChange={z=>setReview({...review,structure:{...review.structure,columns:review.structure.columns.map(item=>item.id===c.id?{...item,position:{...item.position,z}}:item)}})}/>{(['width','depth','height'] as const).map(key=><NumberField key={key} label={{width:'柱宽',depth:'柱深',height:'柱高'}[key]} value={c.size[key]} onChange={value=>setReview({...review,structure:{...review.structure,columns:review.structure.columns.map(item=>item.id===c.id?{...item,size:{...item.size,[key]:value}}:item)}})}/>)}</div></details>)}
      {review.objects.length>0&&<div className="rc-review-objects"><h4>核对识别物件与碰撞</h4><p className="cr-hint">有冲突的物件会标记为「需调整」。修改位置、旋转或尺寸后，服务会重新校验；锁定物件保留。</p>{review.objects.map((object,index)=><details key={object.id}><summary>{job.issues.some(issue=>issue.targetId===object.id)?'需调整 · ':''}物件 {index+1} · {object.materialId}{object.locked?' · 已锁定':''}</summary>{object.locked?<p>此物件已锁定，请先在主场景中解锁并重新生成。</p>:<><div className="rc-measures"><NumberField label="位置 X" value={object.position.x} onChange={x=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,position:{...o.position,x}}:o)})}/><NumberField label="位置 Z" value={object.position.z} onChange={z=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,position:{...o.position,z}}:o)})}/><NumberField label="旋转角度" value={object.rotation} onChange={rotation=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,rotation}:o)})}/>{(['width','depth','height'] as const).map(key=><NumberField key={key} label={{width:'宽度',depth:'深度',height:'高度'}[key]} value={object.size[key]} onChange={value=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,size:{...o.size,[key]:value}}:o)})}/>)}</div><button type="button" className="rc-secondary" onClick={()=>setReview({...review,objects:review.objects.filter(o=>o.id!==object.id),...(review.design?{design:{...review.design,highlights:review.design.highlights.map(h=>({...h,objectIds:h.objectIds.filter(id=>id!==object.id)})),requirements:review.design.requirements.map(r=>({...r,objectIds:r.objectIds.filter(id=>id!==object.id)}))}}:{})})}>删除误识别物件</button></>}</details>)}</div>}
      <label className="cr-check"><input type="checkbox" checked={reviewConfirmed} onChange={e=>setReviewConfirmed(e.target.checked)}/><span>我已核对所有墙段、门窗、柱子和不可见区域，确认上述结构与尺寸。</span></label><button className="rc-secondary" type="button" disabled={busy||!reviewConfirmed||reviewStale} onClick={()=>void generate(true)}>确认结构并继续设计</button>
    </div>}
    {formReady&&currentStructure&&!(review&&job?.state==='needs_review')&&<ReferenceImageReview scene={currentStructure} layout={layout} images={images} registration={form.registration} onChange={value=>patch({registration:value})} onConfirm={confirmReference} updateImage={updateImage} onAddImages={onAddReferenceImages} applied openRequest={openReferenceRequest}/>}
    {preview&&<div className="rc-candidate"><h4>三维候选方案</h4><p>{preview.proposal.explanation}</p>{preview.proposal.candidate.schemaVersion===2&&preview.proposal.candidate.design&&<><strong>{preview.proposal.candidate.design.concept}</strong>{preview.proposal.candidate.design.highlights.map((h,index)=><button key={index} type="button" className="rc-highlight" onClick={()=>focusObject(h.objectIds[0])}><strong>{h.title}</strong><span>{h.description}</span></button>)}{preview.proposal.candidate.design.requirements.map((r,index)=><div className={`rc-requirement is-${r.status}`} key={index}><strong>{{satisfied:'已满足',partial:'部分满足',unmet:'未满足'}[r.status]} · {r.text}</strong><p>{r.reason}</p></div>)}</>}
      <div className="rc-actions"><button type="button" className="cr-generate" disabled={busy||stale||!connected} onClick={()=>void apply()}><Check size={15}/>确认应用并保存</button><button className="rc-secondary" type="button" disabled={busy} onClick={()=>{setPreview(null);setJob(null);patch({jobId:undefined,requestId:undefined});}}>放弃候选</button></div>
    </div>}
    {!preview&&currentDesign&&<details className="rc-candidate"><summary>当前方案的创意与要求核对</summary><p>{currentDesign.concept}</p>{currentDesign.highlights.map((h,index)=><button type="button" key={index} className="rc-highlight" onClick={()=>focusObject(h.objectIds[0])}><strong>{h.title}</strong><span>{h.description}</span></button>)}{currentDesign.requirements.map((r,index)=><div key={index} className={`rc-requirement is-${r.status}`}><strong>{{satisfied:'已满足',partial:'部分满足',unmet:'未满足'}[r.status]} · {r.text}</strong><p>{r.reason}</p></div>)}</details>}
    </fieldset>
    {notice&&<p className="cr-notice" role="alert">{notice}</p>}
  </section>;
}
