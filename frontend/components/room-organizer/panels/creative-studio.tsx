'use client';

import { ArrowUp, Check, Loader2, MessageCircle, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildAssistantInstruction } from '@/lib/assistant-context';
import { useBackendSession, type BackendSession, type SceneProposal } from '@/lib/backend-session';
import { inspectMaterialRequirements, type MaterialCapabilityInspection } from '@/lib/material-capabilities';
import { useSelection } from '../contexts';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { briefInstruction, IDEA_CARDS, INITIAL_BRIEF, mergeProposalPresentation, proposalSummary, type CreativeBrief } from '../lib/creative-brief';
import { ensureGlbAsset } from '../three/glb-assets';
import { proposalDifferences } from '../three/proposal-preview';
import { MaterialCapabilityNote } from './material-capability-note';
import { VenuePhotosPanel, type VenuePhoto } from './venue-photos-panel';
import type { RoomLayout } from '../lib/types';
import './creative-studio.css';

type ReferenceImage = VenuePhoto;
type Message = { id: string; role: 'user' | 'assistant'; text: string };
type Preview = { assets: { assetUrls: Record<string,string>; assetNames: Record<string,string> }; proposal: SceneProposal; layout: RoomLayout; base: RoomLayout; briefKey: string };
interface Props { controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout): void; onPreview?(layout: RoomLayout | null): void; children: ReactNode }
interface StudioValue {
  scope: string;
  capabilities: MaterialCapabilityInspection; choices: Record<string,string>; capabilityAccepted: boolean; chooseMaterial(key:string,value:string):void; acceptCapabilities(value:boolean):void;
  brief: CreativeBrief; setBrief: React.Dispatch<React.SetStateAction<CreativeBrief>>;
  images: ReferenceImage[]; addImages(files: FileList | null): Promise<void>; removeImage(id: string): void;
  busy: boolean; notice: string; connection: string; generate(message?: string): Promise<void>;
  messages: Message[]; expanded: boolean; setExpanded(value: boolean): void; preview: Preview | null; stale: boolean; expired: boolean;
  applyPreview(): Promise<void>; discardPreview(): void;
}
const StudioContext = createContext<StudioValue | null>(null);
function useStudio(): StudioValue { const value=useContext(StudioContext); if(!value) throw new Error('Creative studio unavailable'); return value; }
/** Library consumers can render independently of the creative workspace. */
export function useCreativeBrief(): CreativeBrief | null { return useContext(StudioContext)?.brief ?? null; }
const initialMessages: Message[] = [{ id:'welcome', role:'assistant', text:'你好，我是幕景助手。把客户的活动想法告诉我，我们一起梳理分区、体验亮点和氛围。当前可通过文字请求布置提案；通用问答与图片理解还在接入中。所有修改都先由你确认。' }];

export function CreativeStudioProvider({ controller, layout, onApply, onPreview, children }: Props): JSX.Element {
  const cloud=useBackendSession(controller);
  const { allSelectedIds }=useSelection();
  const [brief,setBrief]=useState<CreativeBrief>(INITIAL_BRIEF);
  const [choices,setChoices]=useState<Record<string,string>>({});
  const [acceptedCapabilities,setAcceptedCapabilities]=useState<string|null>(null);
  const capabilities=useMemo(()=>inspectMaterialRequirements([brief.description,brief.mustHave].join('；')),[brief.description,brief.mustHave]);
  const capabilityKey=JSON.stringify({description:brief.description,mustHave:brief.mustHave,choices});
  const capabilityAccepted=acceptedCapabilities===capabilityKey;
  const [images,setImages]=useState<ReferenceImage[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [messages,setMessages]=useState<Message[]>(initialMessages);
  const [lastExplanation,setLastExplanation]=useState('');
  const scope=layout.id??'local';
  const scopeRef=useRef(scope); scopeRef.current=scope;
  useEffect(()=>{setBrief(INITIAL_BRIEF);setChoices({});setAcceptedCapabilities(null);setMessages(initialMessages);setLastExplanation('');setPreview(null);setNotice('');},[scope]);
  const [expanded,setExpanded]=useState(false);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [expired,setExpired]=useState(false);
  const layoutRef=useRef(layout); layoutRef.current=layout;
  const imageRef=useRef(images); imageRef.current=images;
  const alive=useRef(true);
  const requestPending=useRef(false);
  const uploadQueue=useRef<Promise<void>>(Promise.resolve());
  const imageEpoch=useRef(0);
  useEffect(()=>{
    imageEpoch.current++;
    uploadQueue.current=Promise.resolve();
    for(const image of imageRef.current) URL.revokeObjectURL(image.url);
    imageRef.current=[];
    setImages([]);
  },[scope]);
  const briefKey=JSON.stringify({brief,choices,acceptedCapabilities,images:images.map(i=>i.id)});
  const briefRef=useRef(briefKey); briefRef.current=briefKey;
  const connection=!cloud.configured?'离线引导':!cloud.user?'等待登录':cloud.writeBlocked?'等待项目编辑权':'项目已连接';
  const stale=!!preview && (expired || Date.parse(preview.proposal.expires_at)<=Date.now() || preview.base!==layout || preview.briefKey!==briefKey || cloud.writeBlocked || preview.proposal.project_id!==cloud.project?.id || preview.proposal.base_revision!==cloud.revision);
  useEffect(()=>{ alive.current=true; const lifecycleEpoch=imageEpoch; return ()=>{ alive.current=false; lifecycleEpoch.current++; for(const img of imageRef.current) URL.revokeObjectURL(img.url); }; },[]);
  useEffect(()=>{
    setExpired(false);
    if(!preview) return undefined;
    let timeout:ReturnType<typeof setTimeout>;
    const expire=()=>{
      const remaining=Date.parse(preview.proposal.expires_at)-Date.now();
      if(!Number.isFinite(remaining) || remaining<=0) { setExpired(true); return; }
      // Browser timers cap at signed 32-bit milliseconds. Long-lived test or
      // server responses must not accidentally expire on the next tick.
      timeout=setTimeout(expire,Math.min(remaining,2_147_000_000));
    };
    expire();
    return ()=>clearTimeout(timeout);
  },[preview]);
  useEffect(()=>{ onPreview?.(preview&&!stale?preview.layout:null); },[onPreview,preview,stale]);
  useEffect(()=>()=>onPreview?.(null),[onPreview]);
  function say(text:string):void { setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'assistant',text}]); }

  async function addImages(files: FileList|null):Promise<void> {
    if(!files?.length) return;
    // Snapshot before the input is cleared. Every selection is processed in
    // order; a second selection no longer invalidates the first decode.
    const batch=Array.from(files);
    const epoch=imageEpoch.current, imageScope=scopeRef.current;
    const active=()=>alive.current&&epoch===imageEpoch.current&&imageScope===scopeRef.current;
    const task=uploadQueue.current.then(async()=>{
      if(!active()) return;
      setNotice('');
      const added:ReferenceImage[]=[];
      try {
        if(batch.length+imageRef.current.length>3) throw new Error('最多添加 3 张现场照片。');
        for(const file of batch) {
          if(!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
          if(file.size>5*1024*1024) throw new Error('每张图片不能超过 5 MB。');
          const bitmap=await createImageBitmap(file);
          const valid=bitmap.width>0&&bitmap.height>0&&bitmap.width<=4096&&bitmap.height<=4096;
          bitmap.close();
          if(!valid) throw new Error('图片长宽请控制在 4096 像素以内。');
          if(!active()) break;
          added.push({id:crypto.randomUUID(),name:file.name,url:URL.createObjectURL(file)});
        }
        if(!active()) { for(const img of added) URL.revokeObjectURL(img.url); return; }
        // Update the ref immediately: the following queued batch can start
        // before React commits this state, and must still see the new count.
        imageRef.current=[...imageRef.current,...added];
        setImages(imageRef.current);
      } catch(error) { for(const img of added) URL.revokeObjectURL(img.url); if(active()) setNotice(error instanceof Error?error.message:'图片无法读取，请更换文件。'); }
    });
    uploadQueue.current=task;
    return task;
  }
  function removeImage(id:string):void {
    const image=imageRef.current.find(value=>value.id===id);
    if(!image) return;
    URL.revokeObjectURL(image.url);
    imageRef.current=imageRef.current.filter(value=>value.id!==id);
    setImages(imageRef.current);
  }
  async function generate(message?:string):Promise<void> {
    if(requestPending.current) return;
    setExpanded(true); setNotice('');
    if(message?.trim()) setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:message.trim()}]);
    if(!cloud.configured || !cloud.user || cloud.writeBlocked || cloud.project?.id!==layout.id) {
      const text=!cloud.configured ? '需求入口已经准备好。当前尚未连接 AI 服务，暂时不能生成真实方案。你可以完善需求、添加现场照片，并使用物料库手动布置。'
        : !cloud.user ? '请先登录工作室，再为当前方案创建云项目并获取编辑权。'
        : '请在“云项目”中打开或创建当前方案，并获取编辑权；你的本地草稿会保留。';
      setNotice(text); say(text); return;
    }
    const messageCapabilities=message?inspectMaterialRequirements(message):null;
    if (messageCapabilities && ([...messageCapabilities.missing,...messageCapabilities.needsConfirmation].some(finding=>!capabilityAccepted || ![...capabilities.missing,...capabilities.needsConfirmation].some(known=>known.key===finding.key)))) {
      const text='这条消息包含当前物料目录缺项或待核对规格。请将要求填写到物料区，核对提示并明确选择保留缺项或替代，再生成方案。';
      setNotice(text);say(text);return;
    }
    if ((capabilities.missing.length>0 || capabilities.needsConfirmation.length>0) && !capabilityAccepted) {
      const text='请先核对物料能力提示。缺少的物料不会被自动替换。';
      setNotice(text);say(text);return;
    }
    const base=layoutRef.current, submittedBrief=briefRef.current, submittedScope=scopeRef.current;
    try {
      const scene=layoutToBackendScene(base);
      const decisions=(capabilities.missing.length>0 || capabilities.needsConfirmation.length>0)&&capabilityAccepted
        ? [...capabilities.missing,...capabilities.needsConfirmation].map(finding=>{
          const suggestion=finding.suggestions.find(item=>item.materialId===choices[finding.key]);
          return suggestion ? `用户明确同意将「${finding.label}」改用「${suggestion.name}」现有规格，此选择覆盖原要求；请在说明中写出差异。`
            : `「${finding.label}」仍待核对或补资产：用户同意先生成其余可支持部分，不用其他物料冒充。`;
        }).join('\n') : '';
      const activeBrief={...brief,description:brief.description.trim() || message?.trim() || ''};
      const context=buildAssistantInstruction({
        briefInstruction:briefInstruction(activeBrief,base.width,base.height),
        confirmedMaterialDecisions:decisions?[decisions]:[],
        message:message?.trim() || '请按上述需求生成布置方案。',
        recentMessages:message?messages.filter(item=>item.id!=='welcome'):[],
        lastProposalExplanation:message?lastExplanation:'',
      });
      const instruction=context.instruction;
      if(context.omittedHistory) say(`为遵守接口长度限制，已省略 ${context.omittedHistory} 条较早对话；当前需求和确认条件完整保留。`);
      if(!message) setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:`生成${brief.event}方案：${brief.description.trim()}`}]);
      requestPending.current=true;setBusy(true);setPreview(null);
      const proposal=await controller.requestProposal({mode:scene.objects.length?'modify':'layout',prompt:instruction,scene,selectedIds:[...allSelectedIds].filter(id=>scene.objects.some(object=>object.id===id))});
      const assets=await controller.authorizeAssets(proposal.candidate);
      await Promise.all(Object.entries(assets.assetUrls).map(([id,url])=>ensureGlbAsset(id,url)));
      if(!alive.current || scopeRef.current!==submittedScope) return;
      if(layoutRef.current!==base || briefRef.current!==submittedBrief) throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
      if(!Number.isFinite(Date.parse(proposal.expires_at)) || Date.parse(proposal.expires_at)<=Date.now()) throw new Error('提案已过期，请重新生成。');
      const next=mergeProposalPresentation(base,backendSceneToLayout(proposal.candidate,{projectId:base.id!,name:base.name,...assets}));
      setPreview({proposal,assets,layout:next,base,briefKey:submittedBrief});
      setLastExplanation(proposal.explanation);
      say(proposal.explanation || '方案提案已返回，请核对修改范围后确认应用。');
    } catch(error) { if(alive.current && scopeRef.current===submittedScope){ const text=controller.getSnapshot().error?.message ?? (error instanceof Error?error.message:'生成失败，原方案已保留。');setNotice(text);say(text);} }
    finally { requestPending.current=false;if(alive.current)setBusy(false); }
  }
  async function applyPreview():Promise<void> {
    if(!preview || requestPending.current || busy || stale) return;
    if(Date.parse(preview.proposal.expires_at)<=Date.now()) { setExpired(true); return; }
    const selected=preview;
    requestPending.current=true;setBusy(true);setNotice('');
    try {
      const result=await controller.applySceneProposal(selected.proposal,layoutToBackendScene(layoutRef.current));
      if(!alive.current || scopeRef.current!==(selected.base.id??'local'))return;
      if(!result.acceptedLocally || layoutRef.current!==selected.base) throw new Error('应用期间本地有新修改，已保留本地草稿。云端已有新版本，请核对后重新打开。');
      // Candidate assets were authorized and loaded before presenting this confirmation.
      const next=mergeProposalPresentation(selected.base,backendSceneToLayout(result.scene,{projectId:selected.base.id!,name:selected.base.name,...selected.assets}));
      onApply(next);setPreview(null);say('提案已应用。你可以继续调整，或用撤销返回应用前的本地方案。');
    } catch(error) { if(alive.current && scopeRef.current===(selected.base.id??'local'))setNotice(error instanceof Error?error.message:'应用失败，原方案已保留。'); }
    finally { requestPending.current=false;if(alive.current)setBusy(false); }
  }
  const value:StudioValue={scope,capabilities,choices,capabilityAccepted,chooseMaterial:(key,value)=>setChoices(current=>({...current,[key]:value})),acceptCapabilities:value=>setAcceptedCapabilities(value?capabilityKey:null),brief,setBrief,images,addImages,removeImage,busy,notice,connection,generate,messages,expanded,setExpanded,preview,stale,expired,applyPreview,discardPreview:()=>setPreview(null)};
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function CreativeBriefPanel():JSX.Element {
  const studio=useStudio();
  const update=(patch:Partial<CreativeBrief>)=>studio.setBrief(current=>({...current,...patch}));
  // One idea at a time, swapped on demand: three stacked articles were mostly noise.
  const [ideaIndex,setIdeaIndex]=useState(0);
  const idea=IDEA_CARDS[ideaIndex%IDEA_CARDS.length];
  return <div className="cr-brief">
    <div className="cr-heading"><h2>先说说，你的想法。</h2></div>
    <label className="cr-label">活动类型<select value={studio.brief.event} onChange={e=>update({event:e.target.value})}>{['品牌快闪','露营派对','工作坊','小型黑客松','展览市集','婚礼聚会','其他活动'].map(label=><option key={label}>{label}</option>)}</select></label>
    <label className="cr-label">预计人数<input type="number" min={1} max={40} value={studio.brief.guests||''} onChange={e=>update({guests:e.target.valueAsNumber||0})}/></label>
    <label className="cr-label">客户需求<textarea aria-label="客户需求" maxLength={1800} rows={5} placeholder="例如：为 24 位客人办一场自然风品牌聚会。希望有帐篷交流区、产品展示和一处让人想拍照的角落……" value={studio.brief.description} onChange={e=>update({description:e.target.value})}/></label>
    <label className="cr-label">已确认的现场条件 <span>选填</span><textarea aria-label="已确认的现场条件" maxLength={500} rows={3} placeholder="例如：北侧中间是入口，东侧有两根固定柱；入口前保留通道。请填写你确认的信息。" value={studio.brief.venueConditions??''} onChange={e=>update({venueConditions:e.target.value})}/></label>
    <label className="cr-label">风格要求 <span>选填</span><input aria-label="风格要求" maxLength={120} placeholder="自然露营、简约现代、复古市集……" value={studio.brief.style??''} onChange={e=>update({style:e.target.value})}/></label>
    <label className="cr-label">配色要求 <span>选填</span><input aria-label="配色要求" maxLength={120} placeholder="米白与橄榄绿，少量暖橙点缀" value={studio.brief.palette??''} onChange={e=>update({palette:e.target.value})}/></label>
    <label className="cr-label">氛围要求 <span>选填</span><input aria-label="氛围要求" maxLength={120} placeholder="温暖的夜场、明亮交流、安静观展……" value={studio.brief.atmosphere??''} onChange={e=>update({atmosphere:e.target.value})}/></label>
    <p className="cr-hint">以上要求会随文字提案提交。现场照片不会自动转成约束；尚未连接生成服务时，可用“场地”中的灯光氛围直接预览。</p>
    <label className="cr-label">一定要有 <span>选填</span><input maxLength={350} placeholder="帐篷、签到区、无障碍通道……" value={studio.brief.mustHave} onChange={e=>update({mustHave:e.target.value})}/></label>
    <VenuePhotosPanel images={studio.images} addImages={studio.addImages} removeImage={studio.removeImage}/>
    <label className="cr-check"><input type="checkbox" checked={studio.brief.allowIdeas} onChange={e=>update({allowIdeas:e.target.checked})}/><span><strong>也给我一些意料之外的灵感</strong><small>可以提出建议，由你确认是否采用</small></span></label>
    <MaterialCapabilityNote report={studio.capabilities} choices={studio.choices} onChoice={studio.chooseMaterial} accepted={studio.capabilityAccepted} onAccept={studio.acceptCapabilities}/>
    <button className="cr-generate" type="button" disabled={studio.busy||!studio.brief.description.trim()} onClick={()=>void studio.generate()}>{studio.busy?<Loader2 className="cr-spin" size={18}/>:<Sparkles size={18}/>}<span>{studio.busy?'正在整理方案…':'Generate 生成布置方案'}</span></button>
    <p className="cr-hint">生成后先核对提案，再确认应用到 3D 场景。当前服务支持基础布置与修改；帐篷等更多物料和完整创意规划待接入。</p>
    {studio.notice&&<p className="cr-notice" role="status">{studio.notice}</p>}
    <div className="cr-ideas"><div><h3>布置思路</h3><button type="button" aria-label="换一条布置思路" onClick={()=>setIdeaIndex(current=>(current+1)%IDEA_CARDS.length)}><RefreshCw size={13}/></button></div><article><strong>{idea.title}</strong><p>{idea.text}</p></article></div>
  </div>;
}

export function CreativeAssistant():JSX.Element {
  const studio=useStudio(); const {selectedItem}=useSelection();
  const [draft,setDraft]=useState(''); const feed=useRef<HTMLDivElement>(null);
  const messageInput=useRef<HTMLTextAreaElement>(null);
  const launcher=useRef<HTMLButtonElement>(null);
  const wasExpanded=useRef(false);
  useEffect(()=>setDraft(''),[studio.scope]);
  useEffect(()=>{
    if(studio.expanded) messageInput.current?.focus();
    else if(wasExpanded.current) launcher.current?.focus();
    wasExpanded.current=studio.expanded;
  },[studio.expanded]);
  useEffect(()=>{feed.current?.scrollTo({top:feed.current.scrollHeight,behavior:'smooth'});},[studio.messages,studio.busy,studio.expanded]);
  const submit=()=>{if(!draft.trim()||studio.busy)return;const text=draft;setDraft('');void studio.generate(text);};
  const summary=studio.preview?proposalSummary(studio.preview.base,studio.preview.layout):null;
  const differences=studio.preview?proposalDifferences(studio.preview.base,studio.preview.layout):[];
  return <div className={`cr-assistant ${studio.expanded?'is-open':''} ${selectedItem?'has-properties':''}`}>
    {studio.expanded&&<section id="creative-assistant" className="cr-chat" aria-label="幕景智能助手" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();studio.setExpanded(false);}}}>
      <header><span className="cr-avatar"><Sparkles size={21}/></span><div><strong>幕景小助手</strong><small><i/>{studio.connection}</small></div><button type="button" aria-label="收起助手" onClick={()=>studio.setExpanded(false)}><X size={18}/></button></header>
      <div className="cr-chat-feed" ref={feed} aria-live="polite">{studio.messages.map(m=><div key={m.id} className={`cr-message is-${m.role}`}><span>{m.role==='assistant'?'幕景':'你'}</span><p>{m.text}</p></div>)}
        {studio.busy&&<div className="cr-chat-working"><Loader2 className="cr-spin" size={15}/> 正在处理，请稍候…</div>}
        {studio.preview&&summary&&<div className="cr-proposal"><span>方案提案 · 尚未应用</span><strong>新增 {summary.added} · 移除 {summary.removed} · 共 {summary.total} 件</strong><p>{studio.preview.proposal.explanation}</p>{studio.preview.proposal.warnings.length>0&&<div role="status"><p>提案包含 {studio.preview.proposal.warnings.length} 项场地检查提示：</p><ul>{studio.preview.proposal.warnings.map((warning,index)=>{const names=warning.ids.map(id=>studio.preview!.layout.floors.flatMap(floor=>floor.items).find(item=>item.id===id)?.name??'物件');return <li key={`${warning.code}-${index}`}>{warning.code==='OVERLAP'?'物件重叠':warning.code==='OUT_OF_BOUNDS'?'超出场地边界':'待检查事项'}：{names.join('、')}</li>;})}</ul></div>}<ul>{differences.map(change=><li key={change.id}>{({added:'新增',removed:'移除',changed:'调整'} as const)[change.kind]} · {change.after?.item.name ?? change.before?.item.name}<small>{change.after ? ` · ${change.after.item.width} × ${change.after.item.depth} m` : ''}</small></li>)}</ul><p>画布中的半透明模型是候选方案。绿色框为新增，蓝色框为改动，橙色框为原位置，红色框为移除；确认前不会保存。</p>{studio.stale?<p role="status">{studio.expired?'提案已过期，请重新生成。':'场景、需求或编辑权已变化，请重新生成。'}</p>:<div><button type="button" onClick={()=>void studio.applyPreview()} disabled={studio.busy}><Check size={14}/>确认应用</button><button type="button" onClick={studio.discardPreview} disabled={studio.busy}><Trash2 size={14}/>放弃</button></div>}</div>}
      </div>

      <form onSubmit={e=>{e.preventDefault();submit();}}><label className="sr-only" htmlFor="creative-message">告诉助手你的想法</label><textarea ref={messageInput} id="creative-message" value={draft} maxLength={1800} onChange={e=>setDraft(e.target.value)} placeholder="告诉我想怎么调整……" rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}}/><button aria-label="发送消息" type="submit" disabled={!draft.trim()||studio.busy}><ArrowUp size={19}/></button></form>
      <footer><span>提案确认后才会修改场景 · 登录请使用顶部云项目</span></footer>
    </section>}
    <button ref={launcher} aria-controls="creative-assistant" className="cr-assistant-launcher" type="button" onClick={()=>studio.setExpanded(!studio.expanded)} aria-expanded={studio.expanded} aria-label={studio.expanded?'关闭幕景助手':'打开幕景助手'}><span><MessageCircle size={21}/></span>{studio.expanded?'收起助手':'聊聊你的想法'}<i/></button>
  </div>;
}
