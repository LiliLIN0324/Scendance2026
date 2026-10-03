'use client';

/* Source previews use private blob/signed URLs and preserve original image coordinates. */
/* eslint-disable @next/next/no-img-element */

import { Check, Loader2, Ruler, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBackendSession, type BackendSession, type DimensionConstraint, type ReconstructionJob, type SceneProposal, type SceneV2, type SourceImage } from '@/lib/backend-session';
import { updateReviewedWall, openingLine, imageRegistration, mergeRecognizedDimensions } from '@/lib/reconstruction-review';
import { containedImagePoint, parseDimensionText, readSourceForm, storeSourceForm, registerSourceFlush, type ImagePoint } from '@/lib/source-storage';
import { canonical, sceneV2Schema } from '../../../../supabase/functions/_shared/domain';
import { useSelection } from '../contexts';
import { backendSceneToLayout, createMeasuredRoomLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { mergeProposalPresentation, type CreativeBrief } from '../lib/creative-brief';
import { addDesign, MAX_DESIGNS } from '../lib/scene-layers';
import { ensureGlbAsset } from '../three/glb-assets';
import type { VenuePhoto } from './venue-photos-panel';
import type { RoomLayout } from '../lib/types';
import './reconstruction-panel.css';

interface Props { controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout):void; onPreview?: ((layout: RoomLayout|null)=>void)|undefined; images: VenuePhoto[]; updateImage(id:string,patch:Partial<VenuePhoto>):void; brief: CreativeBrief }
interface Form { width:string; depth:string; height:string; text:string; constraints:DimensionConstraint[]; adjustment:string; jobId?:string|undefined; requestId?:string|undefined; requestKey?:string|undefined; jobBase?:string|undefined; jobInput?:string|undefined; fixedIds?:Record<string,string>; jobSources?:string; jobMode?:'restore'|'redesign'; registration?:{sourceId:string;points:ImagePoint[]}; }
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

export function ReconstructionPanel({controller,layout,onApply,onPreview,images,updateImage,brief}:Props):JSX.Element {
  const cloud=useBackendSession(controller),selection=useSelection();
  const scope=layout.id??'local';
  const [form,setForm]=useState<Form>(EMPTY),[loaded,setLoaded]=useState(false);
  const [mode,setMode]=useState<''|'restore'|'redesign'>('');
  const [reidentify,setReidentify]=useState(false);
  const [job,setJob]=useState<ReconstructionJob|null>(null),[review,setReview]=useState<SceneV2|null>(null),[reviewConfirmed,setReviewConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[pollingPaused,setPollingPaused]=useState(false);
  const [selectedSource,setSelectedSource]=useState(''),[points,setPoints]=useState<ImagePoint[]>([]),[distance,setDistance]=useState('');
  const [selectedWall,setSelectedWall]=useState<string|null>(null);
  const [registering,setRegistering]=useState(false),[opacity,setOpacity]=useState(.55);
  const [preview,setPreview]=useState<{proposal:SceneProposal;layout:RoomLayout;assets:{assetUrls:Record<string,string>;assetNames:Record<string,string>}}|null>(null);
  const [expired,setExpired]=useState(false);
  const formHydration=useRef<Promise<void>>(Promise.resolve());
  const alive=useRef(true),scopeRef=useRef(scope),layoutRef=useRef(layout),formRef=useRef(form),pending=useRef(false);
  scopeRef.current=scope;layoutRef.current=layout;formRef.current=form;
  const hasPhotos=images.some(image=>image.kind!=='floorplan');
  const connected=cloud.configured&&!!cloud.user&&!cloud.writeBlocked&&cloud.project?.id===layout.id;
  const inputKey=canonical({images:images.map(image=>({id:image.id,kind:image.kind??'photo'})),width:form.width,depth:form.depth,height:form.height,constraints:form.constraints,text:form.text,adjustment:form.adjustment,brief,reidentify});
  const inputRef=useRef(inputKey);inputRef.current=inputKey;
  const baseKey=currentSceneKey(layout);
  const reviewStale=!!job&&(form.jobBase!==baseKey||form.jobSources!==canonical(images.map(image=>({id:image.id,kind:image.kind??'photo'}))));
  const stale=!!job&&(form.jobBase!==baseKey||form.jobInput!==inputKey||!!mode&&form.jobMode!==mode||!!preview&&(preview.proposal.base_revision!==cloud.revision||preview.proposal.session_id!==cloud.lease?.sessionId||preview.proposal.generation!==cloud.lease?.generation||expired));
  const source=images.find(image=>image.id===selectedSource&&image.kind==='floorplan')??images.find(image=>image.kind==='floorplan');
  const requestRunning=busy||!!form.jobId&&(!job||ACTIVE.has(job.state));
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let cancelled=false;setLoaded(false);setForm(EMPTY);setJob(null);setReview(null);setPreview(null);setMode('');setReidentify(false);setNotice('');setPoints([]);setReviewConfirmed(false);formHydration.current=readSourceForm<Form>(scope).then(saved=>{if(!cancelled&&saved){formRef.current={...EMPTY,...saved};setForm(formRef.current);}}).catch(()=>{}).finally(()=>{if(!cancelled)setLoaded(true);});return()=>{cancelled=true;};},[scope]);
  useEffect(()=>registerSourceFlush(scope,async()=>{
    await formHydration.current;
    if(!alive.current||scopeRef.current!==scope)throw new Error('尺寸表单正在切换，请稍后重试。');
    await storeSourceForm(scope,formRef.current);
  }),[scope]);
  useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>{void storeSourceForm(scope,form).catch(error=>setNotice(errorText(error)));},250);return()=>clearTimeout(timer);},[form,loaded,scope]);
  useEffect(()=>{setPoints([]);},[source?.id]);
  useEffect(()=>{setReviewConfirmed(false);},[review]);
  useEffect(()=>{setExpired(false);if(!preview)return;const remaining=Date.parse(preview.proposal.expires_at)-Date.now();if(remaining<=0){setExpired(true);return;}const timer=setTimeout(()=>setExpired(true),Math.min(remaining,2_147_000_000));return()=>clearTimeout(timer);},[preview]);
  useEffect(()=>{onPreview?.(preview&&!stale?preview.layout:null);},[preview,stale,onPreview]);
  useEffect(()=>()=>onPreview?.(null),[onPreview]);

  async function acceptJob(result:ReconstructionJob,expectedScope:string):Promise<void> {
    if(!alive.current||scopeRef.current!==expectedScope)return;
    setJob(result);
    if(result.state==='needs_review'&&result.candidate){setReview(result.candidate);setReviewConfirmed(false);const detected=result.candidate.dimensions;setForm(current=>({...current,constraints:mergeRecognizedDimensions(current.constraints,detected,Object.values(current.fixedIds??{}))}));}
    if(result.state==='ready'&&result.proposal){
      const assets=await controller.authorizeAssets(result.proposal.candidate);
      await Promise.all(Object.entries(assets.assetUrls).map(([id,url])=>ensureGlbAsset(id,url)));
      if(!alive.current||scopeRef.current!==expectedScope)return;
      const next=mergeProposalPresentation(layoutRef.current,backendSceneToLayout(result.proposal.candidate,{projectId:layoutRef.current.id!,name:layoutRef.current.name,...assets}));
      setPreview({proposal:result.proposal,layout:next,assets});
    }
  }
  // Resume the same paid task after refresh; status reads never resubmit generation.
  useEffect(()=>{
    if(!loaded||!form.jobId||!cloud.user||cloud.project?.id!==scope||pollingPaused||job&&!ACTIVE.has(job.state))return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;const expectedScope=scope;
    async function poll(){try{const result=await controller.getReconstruction(form.jobId!);if(cancelled)return;await acceptJob(result,expectedScope);if(ACTIVE.has(result.state))timer=setTimeout(poll,2000);}catch(error){if(!cancelled){setNotice(`状态查询暂停：${errorText(error)}。任务编号已保留，可继续查询。`);setPollingPaused(true);}}}
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
    // acceptJob reads current refs; rerendering the form should not restart a polling request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loaded,form.jobId,cloud.user?.id,cloud.project?.id,scope,pollingPaused,job?.state]);

  function patch(patch:Partial<Form>){setForm(current=>({...current,...patch}));}
  function addConstraint(constraint:Omit<DimensionConstraint,'id'|'status'>){patch({constraints:[...form.constraints,{...constraint,id:crypto.randomUUID(),status:'confirmed'}]});}
  function addCalibration(){if(!source||points.length!==2||!(Number(distance)>0))return;if(Math.hypot(points[0].x-points[1].x,points[0].z-points[1].z)<2){setNotice('请选取两个不同位置。');return;}addConstraint({kind:'distance',label:`${source.name} 两点标定`,valueMeters:Number(distance),sourceAssetId:source.id,start:{x:points[0].x/source.width!,z:points[0].z/source.height!},end:{x:points[1].x/source.width!,z:points[1].z/source.height!}});setPoints([]);setDistance('');}
  async function uploadSources():Promise<SourceImage[]>{const sources:SourceImage[]=[];for(const image of images){const kind=image.kind??'photo';if(image.assetId){sources.push({assetId:image.assetId,kind,name:image.name,width:image.width!,height:image.height!});continue;}if(!image.blob)throw new Error(`缺少 ${image.name} 的原始图片，请重新选择。`);const uploaded=await controller.uploadSource(image.blob,image.name,kind);updateImage(image.id,{assetId:uploaded.assetId,uploadedKind:kind});sources.push(uploaded);}return sources;}
  async function generate(continueReview=false):Promise<void>{
    if(pending.current)return;setNotice('');
    if(!connected){setNotice('本机资料已保留。请在云项目中登录、打开当前项目并获取编辑权，才能调用真实识别服务。');return;}
    if(!images.length&&!layout.backendSceneV2){setNotice('请先添加平面图或现场照片。也可以下方按实测尺寸创建矩形场地。');return;}
    const currentStructure=layout.backendSceneV2;
    const sourcesChanged=!!currentStructure&&images.length>0&&(images.length!==currentStructure.sources.length||images.some(image=>!image.assetId||!currentStructure.sources.some(source=>source.assetId===image.assetId&&source.kind===(image.kind??'photo'))));
    if(currentStructure&&sourcesChanged&&!reidentify&&!continueReview){setNotice('来源图片或资料类型发生了变化。请开启「重新识别结构」后生成，已有场景会保留至你确认候选。');return;}
    if(hasPhotos&&!mode){setNotice('本次包含现场照片，请先选择「还原现场」或「重新布置」。');return;}
    const fixed=[['width','总宽',form.width],['depth','总深',form.depth],['height','层高',form.height]] as const;
    if(fixed.some(([, ,value])=>value!==''&&(!Number.isFinite(Number(value))||Number(value)<=0))){setNotice('填写的尺寸须为大于零的米数。');return;}
    if(!(layout.backendSceneV2&&!reidentify&&!sourcesChanged)&&!fixed.some(([kind,,value])=>kind!=='height'&&Number(value)>0)&&!form.constraints.some(d=>d.kind!=='height'&&d.valueMeters>0)){setNotice('请至少提供一项已知平面尺寸；非等比例手绘和照片通常需要多项尺寸。');return;}
    if(continueReview&&(!review||!reviewConfirmed||reviewStale)){setNotice('请先核对并确认候选结构；场景或要求变化后须重新识别。');return;}
    const base=layoutRef.current,submittedInput=inputRef.current,submittedScope=scopeRef.current;
    pending.current=true;setBusy(true);setPreview(null);setPollingPaused(false);
    try{
      const scene=layoutToBackendScene(base),sources=await uploadSources();
      const fixedIds=form.fixedIds??{width:crypto.randomUUID(),depth:crypto.randomUUID(),height:crypto.randomUUID()};
      let dimensions:DimensionConstraint[]=[...fixed.filter(([, ,value])=>value!=='').map(([kind,label,value])=>({id:fixedIds[kind]!,kind,label,valueMeters:Number(value),status:'confirmed' as const})),...form.constraints.map(d=>({...d,...(d.sourceAssetId?{sourceAssetId:sources[images.findIndex(image=>image.id===d.sourceAssetId||image.assetId===d.sourceAssetId)]?.assetId??d.sourceAssetId}:{} )}))];
      if(scene.schemaVersion===2&&!reidentify&&!dimensions.length)dimensions=scene.dimensions;
      if(continueReview)dimensions=dimensions.map(d=>({...d,status:'confirmed'}));
      const selectedIds=[...selection.allSelectedIds].filter(id=>scene.objects.some(object=>object.id===id));
      const instruction=[`活动：${brief.event}；人数：${brief.guests}。`,brief.description||'按资料还原空间，并核对所有尺寸。',brief.mustHave&&`必须满足：${brief.mustHave}`,brief.venueConditions&&`已确认现场条件：${brief.venueConditions}`,brief.style&&`风格：${brief.style}`,brief.palette&&`配色：${brief.palette}`,brief.atmosphere&&`氛围：${brief.atmosphere}`,form.text&&`用户尺寸描述：${form.text}`,form.adjustment&&`本次局部修改要求：${form.adjustment}`,brief.allowIdeas?'直接设计并布置适合活动的创意亮点；每项亮点关联具体物件。':'只实现明确要求。','保留固定结构、锁定物件和用户明确要求；无法满足的条件逐项说明。'].filter(Boolean).join('\n');
      if(instruction.length>3000)throw new Error('需求总长度超过 3000 字，请精简后生成。');
      const reviewedScene=continueReview?sceneV2Schema.parse({...review!,dimensions,structure:{walls:review!.structure.walls.map(w=>({...w,status:'confirmed'})),openings:review!.structure.openings.map(o=>({...o,status:'confirmed'})),columns:review!.structure.columns.map(c=>({...c,status:'confirmed'}))}}):scene.schemaVersion===2&&!reidentify?scene:undefined;
      const requestKey=canonical({reviewedJobId:continueReview?job?.id:undefined,session:controller.getSnapshot().sessionId,leaseGeneration:controller.getSnapshot().lease?.generation,revision:controller.getSnapshot().revision,scene,sources,dimensions:dimensions.map(({id,...dimension})=>dimension),instruction,selectedIds,mode:hasPhotos?mode:'redesign',reviewedScene});
      const requestId=form.requestKey===requestKey&&form.requestId&&job?.state!=='failed'&&job?.state!=='ready'?form.requestId:crypto.randomUUID();
      const nextForm={...form,fixedIds,requestKey,requestId,jobBase:canonical(scene),jobInput:submittedInput,jobSources:canonical(images.map(image=>({id:image.id,kind:image.kind??'photo'}))),jobMode:hasPhotos?mode as 'restore'|'redesign':'redesign' as const,jobId:undefined};
      setForm(nextForm);await storeSourceForm(submittedScope,nextForm).catch(()=>{});
      if(inputRef.current!==submittedInput||layoutRef.current!==base||scopeRef.current!==submittedScope)throw new Error('上传期间资料或场景发生变化，请核对后重新生成。');
      const result=await controller.createReconstruction({requestId,scene,sources,dimensions,mode:hasPhotos?mode as 'restore'|'redesign':'redesign',instruction,selectedIds,...(reviewedScene?{reviewedScene}:{}),...(continueReview&&job?{reviewedJobId:job.id}:{})});
      if(!alive.current||scopeRef.current!==submittedScope)return;
      setForm({...nextForm,jobId:result.id});setMode('');await acceptJob(result,submittedScope);
    }catch(error){if(alive.current&&scopeRef.current===submittedScope)setNotice(errorText(error));}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  async function apply():Promise<void>{if(!preview||pending.current||stale)return;pending.current=true;setBusy(true);const selected=preview,base=layoutRef.current,submittedScope=scopeRef.current;try{if((base.designBook?.variants.length??0)>=MAX_DESIGNS)throw new Error('请先在图层面板移除不再需要的方案，再确认提案。');const result=await controller.applySceneProposal(selected.proposal,layoutToBackendScene(base));if(!alive.current||scopeRef.current!==submittedScope)return;if(!result.acceptedLocally||layoutRef.current!==base)throw new Error('应用期间本地有新修改，已保留草稿；请核对云端新版本。');onApply(addDesign(base,mergeProposalPresentation(base,backendSceneToLayout(result.scene,{projectId:base.id!,name:base.name,...selected.assets}))));setPreview(null);setJob(null);setReview(null);patch({jobId:undefined,requestId:undefined});setNotice('候选已应用并保存，可用一次撤销恢复应用前的本地方案。');}catch(error){setNotice(errorText(error));}finally{pending.current=false;setBusy(false);}}
  const floorplan=useMemo(()=>source&&source.width&&source.height?source:null,[source]);
  const reviewedWall=review?.structure.walls.find(w=>w.id===selectedWall);
  function updateWall(patch:Partial<SceneV2['structure']['walls'][number]>){if(!reviewedWall||!review)return;setReview(updateReviewedWall(review,reviewedWall.id,patch));}

  const registration=review&&floorplan&&form.registration?.sourceId===floorplan.id?imageRegistration(form.registration.points,review.venue.width,review.venue.depth):null;
  const openingShapes=review?.structure.openings.map(opening=>{const line=openingLine(review,opening);return line?<line key={opening.id} x1={line.x1} y1={line.z1} x2={line.x2} y2={line.z2} stroke={opening.kind==='door'?'#64a78b':'#61a5c2'} strokeWidth={.16}><title>{opening.kind==='door'?'门':'窗'} {opening.width}米</title></line>:null;});
  function focusObject(id:string|undefined){
    if(!id)return;selection.selectOnly?.(id);
    const target=(preview?.layout??layout).floors.flatMap(floor=>floor.items).find(item=>item.id===id);
    if(target)window.dispatchEvent(new CustomEvent('scendance:focus-object',{detail:{projectId:layout.id,objectId:id,position:target.position}}));
  }
  const currentDesign=layout.backendSceneV2?.design;
  return <section className="rc-panel" aria-label="图纸与照片重建">
    <header><Ruler size={16}/><h3>图纸与照片重建</h3><span>米制 · 可核对</span></header>
    <p className="cr-hint">输入实测尺寸，图纸和照片共同补充空间信息。照片遮挡处与手绘不确定部分需要核对。</p>
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
    <details><summary>本地手动建模</summary><p className="cr-hint">按实测长宽高创建矩形空间，可离线使用。只转换人工输入，不进行图片识别；已有复杂结构需在场地中逐项编辑。</p><button className="rc-secondary" type="button" disabled={!form.width||!form.depth||!form.height||busy||!!cloud.project&&cloud.writeBlocked} onClick={()=>{try{const next=createMeasuredRoomLayout(layout,{width:Number(form.width),depth:Number(form.depth),height:Number(form.height)});onApply(next);setNotice('已根据人工尺寸创建本地矩形空间；图片尚未识别。');}catch(error){setNotice(errorText(error));}}}>按实测尺寸创建矩形场地</button></details>
    {(images.length>0||!!layout.backendSceneV2)&&<>
      {layout.backendSceneV2&&images.length>0&&<label className="cr-check"><input type="checkbox" checked={reidentify} onChange={event=>setReidentify(event.target.checked)}/><span><strong>重新识别结构</strong><small>默认沿用已确认的墙、门窗与柱子，直接规划风格和布置。换图或需要重测时开启。</small></span></label>}
      {hasPhotos&&<fieldset className="rc-mode"><legend>本次照片生成模式 <small>每次请选择</small></legend>{([['restore','还原现场','保留已有家具与外观'],['redesign','重新布置','保留固定结构与锁定物件']] as const).map(([value,label,hint])=><label key={value}><input type="radio" name={`photo-mode-${scope}`} value={value} checked={mode===value} onChange={()=>setMode(value)}/><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset>}
      <label className="cr-label">局部修改或保留要求<textarea aria-label="局部修改或保留要求" value={form.adjustment} maxLength={1000} rows={2} onChange={e=>patch({adjustment:e.target.value})} placeholder="保留座位和结构，只调整展示区。可在场景中锁定要保留的物件。"/></label>
      <button type="button" className="cr-generate" disabled={requestRunning||!loaded} onClick={()=>void generate()}>{requestRunning?<Loader2 size={16} className="cr-spin"/>:<Sparkles size={16}/>} {requestRunning?'重建任务进行中…':'Generate 重建并设计方案'}</button>
    </>}
    {form.jobId&&!job&&<div className="rc-job" role="status"><strong>正在恢复原重建任务</strong><small>任务 {form.jobId.slice(0,8)}</small>{pollingPaused&&<button type="button" className="rc-secondary" onClick={()=>setPollingPaused(false)}>继续查询原任务</button>}</div>}
    {job&&<div className="rc-job" role="status"><strong>{LABELS[job.state]}</strong><small>任务 {job.id.slice(0,8)}</small>{stale&&<p>场景、资料、要求或编辑会话已变化，旧结果仅供核对。请重新生成后应用。</p>}{job.issues.map((issue,index)=><p key={`${issue.code}-${index}`}>{issue.message}</p>)}{job.error_code&&<p>{errorCodeText(job.error_code)}</p>}{pollingPaused&&<button type="button" className="rc-secondary" onClick={()=>{setPollingPaused(false);setNotice('');}}>继续查询原任务</button>}</div>}
    {review&&job?.state==='needs_review'&&<div className="rc-review"><h4>核对识别结构</h4><p className="cr-hint">结构示意使用米制坐标。点击墙线编辑，核对门窗、柱子与看不到的区域；确认意味着你已根据现场或图纸核实。</p>
      <svg className="rc-plan" viewBox={`-0.5 -0.5 ${review.venue.width+1} ${review.venue.depth+1}`} aria-label="二维结构核对图">{review.venue.polygon&&<polygon points={review.venue.polygon.map(p=>`${p.x},${p.z}`).join(' ')} fill="#f3efe5"/>}{review.structure.walls.map((wall,index)=><g key={wall.id} onClick={()=>setSelectedWall(wall.id)} role="button" aria-label={`编辑墙 ${index+1}`} tabIndex={0} onKeyDown={event=>{if(event.key==='Enter')setSelectedWall(wall.id);}}><line x1={wall.start.x} y1={wall.start.z} x2={wall.end.x} y2={wall.end.z} stroke={wall.id===selectedWall?'#e17637':wall.status==='confirmed'?'#355b4b':'#b48a50'} strokeWidth={Math.max(.08,wall.thickness)}/><text x={(wall.start.x+wall.end.x)/2} y={(wall.start.z+wall.end.z)/2-.12} fontSize=".25">{index+1}</text></g>)}{openingShapes}{review.structure.columns.map(column=><rect key={column.id} x={column.position.x-column.size.width/2} y={column.position.z-column.size.depth/2} width={column.size.width} height={column.size.depth} transform={`rotate(${column.rotation} ${column.position.x} ${column.position.z})`} fill="#7b8574"/> )}</svg>
      {floorplan&&<details><summary>将墙线叠加到原图核对</summary><p className="cr-hint">橙线显示模型提供的原图墙线定位；缺少原图定位时，可建立三个已知对应点：依次点击图上的场地原点 (0,0)、X 轴终点 ({review.venue.width},0)、Z 轴终点 (0,{review.venue.depth})。无法对应这三个点时，请使用独立结构图核对。照片不使用此平面映射。</p><button type="button" className="rc-secondary" onClick={()=>{patch({registration:{sourceId:floorplan.id,points:[]}});setRegistering(true);}}>重新标记三个对应点</button><div className="rc-image-map rc-overlay" role="button" aria-label="标记图纸与场地的三个对应点" tabIndex={0} onClick={event=>{if(!registering)return;const point=containedImagePoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect(),floorplan.width!,floorplan.height!);if(!point)return;const next=[...(form.registration?.points??[]),point];patch({registration:{sourceId:floorplan.id,points:next}});if(next.length===3)setRegistering(false);}}>
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={floorplan.url} alt="原图与识别墙线叠加核对"/><svg viewBox={`0 0 ${floorplan.width} ${floorplan.height}`} preserveAspectRatio="xMidYMid meet">{!registration&&review.structure.walls.flatMap(w=>(w.evidence??[]).filter(e=>e.sourceAssetId===floorplan.assetId).map((e,index)=><line key={`${w.id}-${index}`} x1={e.start.x*floorplan.width!} y1={e.start.z*floorplan.height!} x2={e.end.x*floorplan.width!} y2={e.end.z*floorplan.height!} stroke="#ed7335" opacity={opacity} strokeWidth={floorplan.width!/150}/>))}{registration&&<g transform={registration} opacity={opacity}>{review.structure.walls.map(w=><line key={w.id} x1={w.start.x} y1={w.start.z} x2={w.end.x} y2={w.end.z} stroke="#ed7335" strokeWidth={Math.max(.06,w.thickness)}/>)}{openingShapes}</g>}{form.registration?.sourceId===floorplan.id&&form.registration.points.map((point,index)=><g key={index}><circle cx={point.x} cy={point.z} r={floorplan.width!/70} fill="#355b4b"/><text x={point.x} y={point.z} fill="white" fontSize={floorplan.width!/50}>{index+1}</text></g>)}</svg></div><p className="cr-hint">已标记 {form.registration?.points.length??0}/3 个点。叠加位置依据你的对应点，不代表自动测量。</p><label className="cr-label">墙线透明度<input type="range" aria-label="叠加墙线透明度" min=".1" max="1" step=".05" value={opacity} onChange={event=>setOpacity(Number(event.target.value))}/></label></details>}
      {reviewedWall&&<div className="rc-wall-fields"><strong>墙 {review.structure.walls.findIndex(w=>w.id===reviewedWall.id)+1}</strong><div className="rc-measures"><NumberField label="起点 X" value={reviewedWall.start.x} onChange={x=>updateWall({start:{...reviewedWall.start,x}})}/><NumberField label="起点 Z" value={reviewedWall.start.z} onChange={z=>updateWall({start:{...reviewedWall.start,z}})}/><NumberField label="终点 X" value={reviewedWall.end.x} onChange={x=>updateWall({end:{...reviewedWall.end,x}})}/><NumberField label="终点 Z" value={reviewedWall.end.z} onChange={z=>updateWall({end:{...reviewedWall.end,z}})}/><NumberField label="墙厚" value={reviewedWall.thickness} onChange={thickness=>updateWall({thickness})}/><NumberField label="墙高" value={reviewedWall.height} onChange={height=>updateWall({height})}/></div></div>}
      {review.structure.openings.map((o,index)=><details key={o.id}><summary>{o.kind==='door'?'门':'窗'} {index+1} · 墙 {review.structure.walls.findIndex(w=>w.id===o.wallId)+1} · {o.status==='confirmed'?'已确认':'待核对'}</summary><div className="rc-measures">{(['offset','width','height','sillHeight'] as const).map(key=><NumberField key={key} label={{offset:'距墙起点',width:'宽度',height:'高度',sillHeight:'窗台高度'}[key]} value={o[key]} onChange={value=>setReview({...review,structure:{...review.structure,openings:review.structure.openings.map(item=>item.id===o.id?{...item,[key]:value}:item)}})}/>)}</div></details>)}
      {review.structure.columns.map((c,index)=><details key={c.id}><summary>柱子 {index+1} · {c.status==='confirmed'?'已确认':'待核对'}</summary><div className="rc-measures"><NumberField label="中心 X" value={c.position.x} onChange={x=>setReview({...review,structure:{...review.structure,columns:review.structure.columns.map(item=>item.id===c.id?{...item,position:{...item.position,x}}:item)}})}/><NumberField label="中心 Z" value={c.position.z} onChange={z=>setReview({...review,structure:{...review.structure,columns:review.structure.columns.map(item=>item.id===c.id?{...item,position:{...item.position,z}}:item)}})}/>{(['width','depth','height'] as const).map(key=><NumberField key={key} label={{width:'柱宽',depth:'柱深',height:'柱高'}[key]} value={c.size[key]} onChange={value=>setReview({...review,structure:{...review.structure,columns:review.structure.columns.map(item=>item.id===c.id?{...item,size:{...item.size,[key]:value}}:item)}})}/>)}</div></details>)}
      {review.objects.length>0&&<div className="rc-review-objects"><h4>核对识别物件与碰撞</h4><p className="cr-hint">有冲突的物件会标记为「需调整」。修改位置、旋转或尺寸后，服务会重新校验；锁定物件保留。</p>{review.objects.map((object,index)=><details key={object.id}><summary>{job.issues.some(issue=>issue.targetId===object.id)?'需调整 · ':''}物件 {index+1} · {object.materialId}{object.locked?' · 已锁定':''}</summary>{object.locked?<p>此物件已锁定，请先在主场景中解锁并重新生成。</p>:<><div className="rc-measures"><NumberField label="位置 X" value={object.position.x} onChange={x=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,position:{...o.position,x}}:o)})}/><NumberField label="位置 Z" value={object.position.z} onChange={z=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,position:{...o.position,z}}:o)})}/><NumberField label="旋转角度" value={object.rotation} onChange={rotation=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,rotation}:o)})}/>{(['width','depth','height'] as const).map(key=><NumberField key={key} label={{width:'宽度',depth:'深度',height:'高度'}[key]} value={object.size[key]} onChange={value=>setReview({...review,objects:review.objects.map(o=>o.id===object.id?{...o,size:{...o.size,[key]:value}}:o)})}/>)}</div><button type="button" className="rc-secondary" onClick={()=>setReview({...review,objects:review.objects.filter(o=>o.id!==object.id),...(review.design?{design:{...review.design,highlights:review.design.highlights.map(h=>({...h,objectIds:h.objectIds.filter(id=>id!==object.id)})),requirements:review.design.requirements.map(r=>({...r,objectIds:r.objectIds.filter(id=>id!==object.id)}))}}:{})})}>删除误识别物件</button></>}</details>)}</div>}
      <label className="cr-check"><input type="checkbox" checked={reviewConfirmed} onChange={e=>setReviewConfirmed(e.target.checked)}/><span>我已核对所有墙段、门窗、柱子和不可见区域，确认上述结构与尺寸。</span></label><button className="rc-secondary" type="button" disabled={busy||!reviewConfirmed||reviewStale} onClick={()=>void generate(true)}>确认结构并继续设计</button>
    </div>}
    {preview&&<div className="rc-candidate"><h4>三维候选方案</h4><p>{preview.proposal.explanation}</p>{preview.proposal.candidate.schemaVersion===2&&preview.proposal.candidate.design&&<><strong>{preview.proposal.candidate.design.concept}</strong>{preview.proposal.candidate.design.highlights.map((h,index)=><button key={index} type="button" className="rc-highlight" onClick={()=>focusObject(h.objectIds[0])}><strong>{h.title}</strong><span>{h.description}</span></button>)}{preview.proposal.candidate.design.requirements.map((r,index)=><div className={`rc-requirement is-${r.status}`} key={index}><strong>{{satisfied:'已满足',partial:'部分满足',unmet:'未满足'}[r.status]} · {r.text}</strong><p>{r.reason}</p></div>)}</>}
      <div className="rc-actions"><button type="button" className="cr-generate" disabled={busy||stale||!connected} onClick={()=>void apply()}><Check size={15}/>确认应用并保存</button><button className="rc-secondary" type="button" disabled={busy} onClick={()=>{setPreview(null);setJob(null);patch({jobId:undefined,requestId:undefined});}}>放弃候选</button></div>
    </div>}
    {!preview&&currentDesign&&<details className="rc-candidate"><summary>当前方案的创意与要求核对</summary><p>{currentDesign.concept}</p>{currentDesign.highlights.map((h,index)=><button type="button" key={index} className="rc-highlight" onClick={()=>focusObject(h.objectIds[0])}><strong>{h.title}</strong><span>{h.description}</span></button>)}{currentDesign.requirements.map((r,index)=><div key={index} className={`rc-requirement is-${r.status}`}><strong>{{satisfied:'已满足',partial:'部分满足',unmet:'未满足'}[r.status]} · {r.text}</strong><p>{r.reason}</p></div>)}</details>}
    {notice&&<p className="cr-notice" role="alert">{notice}</p>}
  </section>;
}
