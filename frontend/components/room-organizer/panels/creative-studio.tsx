'use client';

import { ArrowUp, Check, ImagePlus, Loader2, MessageCircle, Sparkles, Trash2, X } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBackendSession, type BackendSession, type SceneProposal } from '@/lib/backend-session';
import { useSelection } from '../contexts';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { briefInstruction, IDEA_CARDS, INITIAL_BRIEF, mergeProposalPresentation, proposalSummary, type CreativeBrief } from '../lib/creative-brief';
import { ensureGlbAsset } from '../three/glb-assets';
import type { RoomLayout } from '../lib/types';
import './creative-studio.css';

type ReferenceImage = { id: string; name: string; url: string };
type Message = { id: string; role: 'user' | 'assistant'; text: string };
type Preview = { assets: { assetUrls: Record<string,string>; assetNames: Record<string,string> }; proposal: SceneProposal; layout: RoomLayout; base: RoomLayout; briefKey: string };
interface Props { controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout): void; children: ReactNode }
interface StudioValue {
  brief: CreativeBrief; setBrief: React.Dispatch<React.SetStateAction<CreativeBrief>>;
  images: ReferenceImage[]; addImages(files: FileList | null): Promise<void>; removeImage(id: string): void;
  busy: boolean; notice: string; connection: string; generate(message?: string): Promise<void>;
  messages: Message[]; expanded: boolean; setExpanded(value: boolean): void; preview: Preview | null; stale: boolean;
  applyPreview(): Promise<void>; discardPreview(): void;
}
const StudioContext = createContext<StudioValue | null>(null);
function useStudio(): StudioValue { const value=useContext(StudioContext); if(!value) throw new Error('Creative studio unavailable'); return value; }
const initialMessages: Message[] = [{ id:'welcome', role:'assistant', text:'你好，我是场域助手。把客户的活动想法告诉我，我们一起梳理分区、体验亮点和氛围。当前可通过文字请求布置提案；通用问答与图片理解还在接入中。所有修改都先由你确认。' }];

export function CreativeStudioProvider({ controller, layout, onApply, children }: Props): JSX.Element {
  const cloud=useBackendSession(controller);
  const { allSelectedIds }=useSelection();
  const [brief,setBrief]=useState<CreativeBrief>(INITIAL_BRIEF);
  const [images,setImages]=useState<ReferenceImage[]>([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [messages,setMessages]=useState<Message[]>(initialMessages);
  const [expanded,setExpanded]=useState(false);
  const [preview,setPreview]=useState<Preview|null>(null);
  const layoutRef=useRef(layout); layoutRef.current=layout;
  const imageRef=useRef(images); imageRef.current=images;
  const alive=useRef(true);
  const requestPending=useRef(false);
  const uploadEpoch=useRef(0);
  const briefKey=JSON.stringify({brief,images:images.map(i=>i.id)});
  const briefRef=useRef(briefKey); briefRef.current=briefKey;
  const connection=!cloud.configured?'离线引导':!cloud.user?'等待登录':cloud.writeBlocked?'等待项目编辑权':'项目已连接';
  const stale=!!preview && (preview.base!==layout || preview.briefKey!==briefKey || cloud.writeBlocked || preview.proposal.project_id!==cloud.project?.id);
  useEffect(()=>{ alive.current=true; return ()=>{ alive.current=false; for(const img of imageRef.current) URL.revokeObjectURL(img.url); }; },[]);
  function say(text:string):void { setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'assistant',text}]); }

  async function addImages(files: FileList|null):Promise<void> {
    if(!files?.length) return;
    const epoch=++uploadEpoch.current;
    setNotice('');
    const added:ReferenceImage[]=[];
    try {
      if(files.length+imageRef.current.length>3) throw new Error('最多添加 3 张参考图片。');
      for(const file of Array.from(files)) {
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
        if(file.size>5*1024*1024) throw new Error('每张图片不能超过 5 MB。');
        const bitmap=await createImageBitmap(file);
        const valid=bitmap.width>0&&bitmap.height>0&&bitmap.width<=4096&&bitmap.height<=4096;
        bitmap.close();
        if(!valid) throw new Error('图片长宽请控制在 4096 像素以内。');
        added.push({id:crypto.randomUUID(),name:file.name,url:URL.createObjectURL(file)});
      }
      if(!alive.current || epoch!==uploadEpoch.current) { for(const img of added) URL.revokeObjectURL(img.url); return; }
      setImages(current=>[...current,...added]);
    } catch(error) { for(const img of added) URL.revokeObjectURL(img.url); if(alive.current) setNotice(error instanceof Error?error.message:'图片无法读取，请更换文件。'); }
  }
  function removeImage(id:string):void {
    uploadEpoch.current++;
    setImages(current=>current.filter(image=>{if(image.id!==id)return true;URL.revokeObjectURL(image.url);return false;}));
  }
  async function generate(message?:string):Promise<void> {
    if(requestPending.current) return;
    setExpanded(true); setNotice('');
    if(message?.trim()) setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:message.trim()}]);
    if(!cloud.configured || !cloud.user || cloud.writeBlocked || cloud.project?.id!==layout.id) {
      const text=!cloud.configured ? '需求入口已经准备好。当前尚未连接 AI 服务，暂时不能生成真实方案。你可以完善需求、添加参考图，并使用物料库手动布置。'
        : !cloud.user ? '请先登录工作室，再为当前方案创建云项目并获取编辑权。'
        : '请在“云项目”中打开或创建当前方案，并获取编辑权；你的本地草稿会保留。';
      setNotice(text); say(text); return;
    }
    const base=layoutRef.current, submittedBrief=briefRef.current;
    try {
      const scene=layoutToBackendScene(base);
      const instruction=message?.trim() || briefInstruction(brief,base.width,base.height);
      if(instruction.length>3000) throw new Error('本条需求过长，请精简后再发送。');
      if(!message) setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:`生成${brief.event}方案：${brief.description.trim()}`}]);
      requestPending.current=true;setBusy(true);setPreview(null);
      const proposal=await controller.requestProposal({mode:scene.objects.length?'modify':'layout',prompt:instruction,scene,selectedIds:[...allSelectedIds].filter(id=>scene.objects.some(object=>object.id===id))});
      const assets=await controller.authorizeAssets(proposal.candidate);
      await Promise.all(Object.entries(assets.assetUrls).map(([id,url])=>ensureGlbAsset(id,url)));
      if(!alive.current) return;
      if(layoutRef.current!==base || briefRef.current!==submittedBrief) throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
      const next=mergeProposalPresentation(base,backendSceneToLayout(proposal.candidate,{projectId:base.id!,name:base.name,...assets}));
      setPreview({proposal,assets,layout:next,base,briefKey:submittedBrief});
      say(proposal.explanation || '方案提案已返回，请核对修改范围后确认应用。');
    } catch(error) { if(alive.current){ const text=controller.getSnapshot().error?.message ?? (error instanceof Error?error.message:'生成失败，原方案已保留。');setNotice(text);say(text);} }
    finally { requestPending.current=false;if(alive.current)setBusy(false); }
  }
  async function applyPreview():Promise<void> {
    if(!preview || requestPending.current || busy || stale) return;
    const selected=preview;
    requestPending.current=true;setBusy(true);setNotice('');
    try {
      const result=await controller.applySceneProposal(selected.proposal,layoutToBackendScene(layoutRef.current));
      if(!alive.current)return;
      if(!result.acceptedLocally || layoutRef.current!==selected.base) throw new Error('应用期间本地有新修改，已保留本地草稿。云端已有新版本，请核对后重新打开。');
      // Candidate assets were authorized and loaded before presenting this confirmation.
      const next=mergeProposalPresentation(selected.base,backendSceneToLayout(result.scene,{projectId:selected.base.id!,name:selected.base.name,...selected.assets}));
      onApply(next);setPreview(null);say('提案已应用。你可以继续调整，或用撤销返回应用前的本地方案。');
    } catch(error) { if(alive.current)setNotice(error instanceof Error?error.message:'应用失败，原方案已保留。'); }
    finally { requestPending.current=false;if(alive.current)setBusy(false); }
  }
  const value:StudioValue={brief,setBrief,images,addImages,removeImage,busy,notice,connection,generate,messages,expanded,setExpanded,preview,stale,applyPreview,discardPreview:()=>setPreview(null)};
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function CreativeBriefPanel():JSX.Element {
  const studio=useStudio();
  const input=useRef<HTMLInputElement>(null);
  const update=(patch:Partial<CreativeBrief>)=>studio.setBrief(current=>({...current,...patch}));
  return <div className="cr-brief">
    <div className="cr-heading"><span className="cr-kicker">FROM BRIEF TO SPACE</span><h2>先说说，你的想法。</h2><p>一份需求，展开成一整个现场。</p></div>
    <label className="cr-label">活动类型<select value={studio.brief.event} onChange={e=>update({event:e.target.value})}>{['品牌快闪','露营派对','工作坊','小型黑客松','展览市集','婚礼聚会','其他活动'].map(label=><option key={label}>{label}</option>)}</select></label>
    <label className="cr-label">预计人数<input type="number" min={1} max={40} value={studio.brief.guests||''} onChange={e=>update({guests:e.target.valueAsNumber||0})}/></label>
    <label className="cr-label">客户需求<textarea aria-label="客户需求" maxLength={1800} rows={5} placeholder="例如：为 24 位客人办一场自然风品牌聚会。希望有帐篷交流区、产品展示和一处让人想拍照的角落……" value={studio.brief.description} onChange={e=>update({description:e.target.value})}/></label>
    <label className="cr-label">一定要有 <span>选填</span><input maxLength={350} placeholder="帐篷、签到区、无障碍通道……" value={studio.brief.mustHave} onChange={e=>update({mustHave:e.target.value})}/></label>
    <div className="cr-label">参考图片 <span>最多 3 张 · 每张 5 MB</span></div>
    <input type="file" ref={input} hidden accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{void studio.addImages(e.target.files);e.target.value='';}}/>
    <button className="cr-upload" type="button" onClick={()=>input.current?.click()}><ImagePlus size={23}/><strong>添加场地或风格参考</strong><span>PNG / JPG / WebP</span></button>
    {/* Object URLs are local previews; Next image optimization cannot fetch them. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {studio.images.length>0&&<div className="cr-references">{studio.images.map(img=><div key={img.id}><img src={img.url} alt={`参考：${img.name}`}/><button type="button" aria-label={`移除 ${img.name}`} onClick={()=>studio.removeImage(img.id)}><X size={12}/></button><span>{img.name}</span></div>)}</div>}
    <p className="cr-hint">图片当前仅供本机参考；本次生成仅发送文字。图片理解等待后端接入，刷新后需重新选择。</p>
    <label className="cr-check"><input type="checkbox" checked={studio.brief.allowIdeas} onChange={e=>update({allowIdeas:e.target.checked})}/><span><strong>也给我一些意料之外的灵感</strong><small>可以提出建议，由你确认是否采用</small></span></label>
    <button className="cr-generate" type="button" disabled={studio.busy||!studio.brief.description.trim()} onClick={()=>void studio.generate()}>{studio.busy?<Loader2 className="cr-spin" size={18}/>:<Sparkles size={18}/>}<span>{studio.busy?'正在整理方案…':'Generate 生成布置方案'}</span></button>
    <p className="cr-hint">生成后先核对提案，再确认应用到 3D 场景。当前服务支持基础布置与修改；帐篷等更多物料和完整创意规划待接入。</p>
    {studio.notice&&<p className="cr-notice" role="status">{studio.notice}</p>}
    <div className="cr-ideas"><div><h3>可以考虑的布置思路</h3><span>仅供参考</span></div>{IDEA_CARDS.map(idea=><article key={idea.title}><strong>{idea.title}</strong><p>{idea.text}</p></article>)}</div>
  </div>;
}

export function CreativeAssistant():JSX.Element {
  const studio=useStudio(); const {selectedItem}=useSelection();
  const [draft,setDraft]=useState(''); const feed=useRef<HTMLDivElement>(null);
  const messageInput=useRef<HTMLTextAreaElement>(null);
  const launcher=useRef<HTMLButtonElement>(null);
  const wasExpanded=useRef(false);
  useEffect(()=>{
    if(studio.expanded) messageInput.current?.focus();
    else if(wasExpanded.current) launcher.current?.focus();
    wasExpanded.current=studio.expanded;
  },[studio.expanded]);
  useEffect(()=>{feed.current?.scrollTo({top:feed.current.scrollHeight,behavior:'smooth'});},[studio.messages,studio.busy,studio.expanded]);
  const submit=()=>{if(!draft.trim()||studio.busy)return;const text=draft;setDraft('');void studio.generate(text);};
  const summary=studio.preview?proposalSummary(studio.preview.base,studio.preview.layout):null;
  return <div className={`cr-assistant ${studio.expanded?'is-open':''} ${selectedItem?'has-properties':''}`}>
    {studio.expanded&&<section id="creative-assistant" className="cr-chat" aria-label="场域智能助手" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();studio.setExpanded(false);}}}>
      <header><span className="cr-avatar"><Sparkles size={21}/></span><div><strong>场域小助手</strong><small><i/>{studio.connection}</small></div><button type="button" aria-label="收起助手" onClick={()=>studio.setExpanded(false)}><X size={18}/></button></header>
      <div className="cr-chat-feed" ref={feed} aria-live="polite">{studio.messages.map(m=><div key={m.id} className={`cr-message is-${m.role}`}><span>{m.role==='assistant'?'场域':'你'}</span><p>{m.text}</p></div>)}
        {studio.busy&&<div className="cr-chat-working"><Loader2 className="cr-spin" size={15}/> 正在处理，请稍候…</div>}
        {studio.preview&&summary&&<div className="cr-proposal"><span>方案提案 · 尚未应用</span><strong>新增 {summary.added} · 移除 {summary.removed} · 共 {summary.total} 件</strong><p>{studio.preview.proposal.explanation}</p>{studio.preview.proposal.warnings.length>0&&<p role="status">提案包含 {studio.preview.proposal.warnings.length} 项场地检查提示，请核对物件重叠和边界后应用。</p>}<ul>{studio.preview.layout.floors[0]?.items.slice(0,8).map(item=><li key={item.id}>{item.name} <small>{item.width} × {item.depth} m</small></li>)}</ul>{studio.stale?<p role="status">场景、需求或编辑权已变化，请重新生成。</p>:<div><button type="button" onClick={()=>void studio.applyPreview()} disabled={studio.busy}><Check size={14}/>确认应用</button><button type="button" onClick={studio.discardPreview} disabled={studio.busy}><Trash2 size={14}/>放弃</button></div>}</div>}
      </div>

      <form onSubmit={e=>{e.preventDefault();submit();}}><label className="sr-only" htmlFor="creative-message">告诉助手你的想法</label><textarea ref={messageInput} id="creative-message" value={draft} maxLength={1800} onChange={e=>setDraft(e.target.value)} placeholder="告诉我想怎么调整……" rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}}/><button aria-label="发送消息" type="submit" disabled={!draft.trim()||studio.busy}><ArrowUp size={19}/></button></form>
      <footer><span>提案确认后才会修改场景 · 登录请使用顶部云项目</span></footer>
    </section>}
    <button ref={launcher} aria-controls="creative-assistant" className="cr-assistant-launcher" type="button" onClick={()=>studio.setExpanded(!studio.expanded)} aria-expanded={studio.expanded} aria-label={studio.expanded?'关闭场域助手':'打开场域助手'}><span><MessageCircle size={21}/></span>{studio.expanded?'收起助手':'聊聊你的想法'}<i/></button>
  </div>;
}
