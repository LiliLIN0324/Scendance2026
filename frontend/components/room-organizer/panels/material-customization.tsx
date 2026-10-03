'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { assetError } from '@/lib/assets-api';
import { useBackendSession, type AuthorizedAssets, type BackendSession, type Scene, type SceneProposal } from '@/lib/backend-session';
import { materialChangeSchema, materialInspectionSchema, materialVariantAssetSchema, type MaterialChange, type MaterialInspection } from '../../../../supabase/functions/_shared/asset-customization-contract';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { ScenePreview } from '../../business/scene-preview';
import { useSelection } from '../contexts';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { mergeProposalPresentation } from '../lib/creative-brief';
import { ensureGlbAsset } from '../three/glb-assets';
import type { RoomLayout } from '../lib/types';
import './material-customization.css';

export interface MaterialCustomizationSeed {
  id: string; scope: string; userId: string; projectId: string; apiUrl: string; sourceAssetId: string;
  objectIds: string[]; name: string; reason: string; materialScope: 'all_materials'|'choose_materials';
  changes?: MaterialChange | undefined; variantAssetId?: string;
}
interface Props { controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout): void; seed?: MaterialCustomizationSeed | undefined; active?: boolean }
interface Context { scope: string; targetKey: string; base: RoomLayout; revision: number | null; localRevision: number; generation?: number | undefined; sessionId: string }
interface Preview { intent: Intent; context: Context; formKey: string; proposal: SceneProposal; before: AuthorizedAssets; after: AuthorizedAssets }
interface Intent { customizeId: string; proposalId: string; proposalKey?: string; proposalExpiresAt?: number; proposalApplied?: boolean; variantId?: string }

export function MaterialCustomization({ controller, layout, onApply, seed, active=true }: Props): JSX.Element {
  const cloud=useBackendSession(controller);
  const {allSelectedIds}=useSelection();
  const scope=`${controller.config.apiUrl}:${cloud.user?.id??'anonymous'}:${layout.id??'local'}`;
  const target=useMemo(()=>{
    try {
      if(seed&&(seed.scope!==scope||seed.userId!==cloud.user?.id||seed.projectId!==cloud.project?.id||seed.apiUrl!==controller.config.apiUrl))throw new Error('这条材质建议属于其他账号或项目，请重新获取建议。');
      const scene=layoutToBackendScene(layout);
      const ids=seed?.objectIds??[...allSelectedIds];
      if(!ids.length)throw new Error('请在场景中选择一个或多个同款 GLB 物件。');
      if(new Set(ids).size!==ids.length)throw new Error('目标物件重复，请重新获取建议。');
      const objects=ids.map(id=>scene.objects.find(object=>object.id===id));
      if(objects.some(object=>!object))throw new Error('部分目标物件已不存在，请重新选择或获取建议。');
      if(objects.some(object=>object!.locked))throw new Error('目标包含锁定物件，请先解锁；不会自动跳过任何物件。');
      const sourceAssetId=seed?.sourceAssetId??objects[0]!.assetId;
      if(!sourceAssetId||objects.some(object=>object!.materialId!=='asset'||object!.assetId!==sourceAssetId))throw new Error('请只选择同一个来源版本的 GLB 物件；部分目标可能已更换资产。');
      return {scene,ids,sourceAssetId,error:''};
    } catch(error) { return {scene:null,ids:[] as string[],sourceAssetId:'',error:error instanceof Error?error.message:'无法读取目标物件。'}; }
  },[layout,seed,scope,cloud.user?.id,cloud.project?.id,controller.config.apiUrl,allSelectedIds]);
  const targetKey=canonical({scope,source:target.sourceAssetId,ids:target.ids,seed:seed?.id});
  const [inspection,setInspection]=useState<MaterialInspection|null>(null);
  const [slots,setSlots]=useState<number[]>([]);
  const [changes,setChanges]=useState<MaterialChange>(seed?.changes??{});
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [showOriginal,setShowOriginal]=useState(false);
  const firstTargetId=target.ids[0];
  const focusedPreview=useMemo(()=>{
    if(!preview)return null;
    const before=preview.proposal.base_scene.objects.find(object=>object.id===firstTargetId);
    const after=preview.proposal.candidate.objects.find(object=>object.id===firstTargetId);
    if(!before||!after)return null;
    const angle=before.rotation*Math.PI/180,cos=Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle));
    const {width,depth,height}=before.size,padding=Math.max(width,depth,height)*.25;
    const venue={width:width*cos+depth*sin+padding*2,depth:width*sin+depth*cos+padding*2,height,shape:'rectangle' as const,entrances:[]};
    const frame=(object:Scene['objects'][number]):Scene=>({schemaVersion:1,venue,camera:'overview',lighting:preview.proposal.base_scene.lighting,objects:[{...object,position:{x:venue.width/2,z:venue.depth/2},elevation:0}]});
    return {before:frame(before),after:frame(after)};
  },[preview,firstTargetId]);
  const [expired,setExpired]=useState(false);
  const [reload,setReload]=useState(0);
  const latest=useRef({scope,targetKey,layout});latest.current={scope,targetKey,layout};
  const intents=useRef(new Map<string,Intent>());
  const inspectedKey=useRef('');
  const operation=useRef(0),pending=useRef(false),mounted=useRef(true);
  const formKey=canonical({slots,changes});
  const canEdit=cloud.configured&&!!cloud.user&&cloud.project?.id===layout.id&&!cloud.writeBlocked&&!!cloud.lease&&Date.parse(cloud.lease.expiresAt)>Date.now();
  useEffect(()=>{const sequence=operation;mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
  useEffect(()=>{
    operation.current++;pending.current=false;setBusy(false);setLoading(false);setInspection(null);setSlots([]);setChanges(seed?.changes??{});setPreview(null);setNotice('');setShowOriginal(false);intents.current.clear();inspectedKey.current='';
  },[targetKey,seed?.changes]);
  useEffect(()=>{
    const key=`${targetKey}:${reload}`;
    if(!active||!target.sourceAssetId||target.error||!cloud.user||!cloud.configured||inspectedKey.current===key)return;
    let alive=true;setLoading(true);setNotice('');
    void controller.businessRequest<unknown>(`/assets/${target.sourceAssetId}/materials`).then(result=>{
      const data=materialInspectionSchema.parse(result);
      if(data.id!==target.sourceAssetId)throw new Error('材质检查返回了其他资产，已停止预览。');
      if(!alive)return;
      inspectedKey.current=key;setInspection(data);setSlots(seed?.materialScope==='choose_materials'?[]:data.slots.filter(slot=>slot.primitiveCount>0).map(slot=>slot.index));
    }).catch(error=>{if(alive)setNotice(assetError(error));}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[controller,targetKey,target.sourceAssetId,target.error,active,cloud.user,cloud.configured,reload,seed?.materialScope]);
  useEffect(()=>{
    setExpired(false);if(!preview)return;
    const remaining=Date.parse(preview.proposal.expires_at)-Date.now();
    if(remaining<=0){setExpired(true);return;}
    const timer=setTimeout(()=>setExpired(true),Math.min(remaining,2_147_000_000));return()=>clearTimeout(timer);
  },[preview]);

  function context():Context { const current=controller.getSnapshot();return {scope,targetKey,base:layout,revision:current.revision,localRevision:current.localRevision,generation:current.lease?.generation,sessionId:current.sessionId}; }
  function stillCurrent(value:Context):boolean {
    const current=controller.getSnapshot();
    return mounted.current&&latest.current.scope===value.scope&&latest.current.targetKey===value.targetKey&&latest.current.layout===value.base&&`${controller.config.apiUrl}:${current.user?.id??'anonymous'}:${current.project?.id??'local'}`===value.scope&&current.sessionId===value.sessionId&&current.project?.id===value.base.id&&current.lease?.projectId===value.base.id&&!current.writeBlocked&&current.revision===value.revision&&current.localRevision===value.localRevision&&current.lease?.generation===value.generation&&!!current.lease&&Date.parse(current.lease.expiresAt)>Date.now();
  }
  const stale=!!preview&&(!stillCurrent(preview.context)||expired||Date.parse(preview.proposal.expires_at)<=Date.now()||preview.formKey!==formKey);

  async function prepare(existingVariantId?:string):Promise<void> {
    if(pending.current||!canEdit||!target.scene||target.error||!inspection)return;
    const captured=context(),baseScene=target.scene,token=++operation.current;
    pending.current=true;setBusy(true);setNotice('');setPreview(null);
    try {
      if(!stillCurrent(captured))throw new Error('场景或编辑权已变化，请重新选择后预览。');
      const modification=existingVariantId?null:materialChangeSchema.parse(changes);
      if(!existingVariantId&&(!slots.length||slots.some(index=>!inspection.slots.some(slot=>slot.index===index&&slot.primitiveCount>0))))throw new Error('请勾选实际使用的材质槽。');
      const key=canonical({source:target.sourceAssetId,sha256:inspection.sha256,slots,modification,existingVariantId});
      const intent:Intent=intents.current.get(key)??{customizeId:crypto.randomUUID(),proposalId:crypto.randomUUID()};intents.current.set(key,intent);
      if(existingVariantId)intent.variantId=existingVariantId;
      if(!intent.variantId) {
        const variant=materialVariantAssetSchema.parse(await controller.businessRequest<unknown>(`/assets/${target.sourceAssetId}/customize`,'POST',{requestId:intent.customizeId,sourceSha256:inspection.sha256,materialIndices:slots,...modification}));
        if(variant.metadata.parentAssetId!==target.sourceAssetId||variant.metadata.sourceSha256!==inspection.sha256)throw new Error('候选版本与来源不一致，未应用。');
        intent.variantId=variant.id;
      }
      if(!stillCurrent(captured)||token!==operation.current)return;
      const proposalKey=canonical({scene:baseScene,ids:target.ids,revision:captured.revision,localRevision:captured.localRevision,generation:captured.generation,sessionId:captured.sessionId});
      if(intent.proposalKey!==undefined&&(intent.proposalKey!==proposalKey||intent.proposalApplied||intent.proposalExpiresAt!==undefined&&intent.proposalExpiresAt<=Date.now())){intent.proposalId=crypto.randomUUID();delete intent.proposalExpiresAt;delete intent.proposalApplied;}
      intent.proposalKey=proposalKey;
      const proposal=await controller.prepareMaterialVariantProposal({requestId:intent.proposalId,scene:baseScene,objectIds:target.ids,sourceAssetId:target.sourceAssetId,variantAssetId:intent.variantId});
      if(!stillCurrent(captured)||token!==operation.current)return;
      intent.proposalExpiresAt=Date.parse(proposal.expires_at);
      if(proposal.applied_at){intent.proposalApplied=true;throw new Error('此候选已应用，请重新预览。');}
      if(proposal.project_id!==captured.base.id||proposal.base_revision!==captured.revision||proposal.local_revision!==captured.localRevision||proposal.generation!==captured.generation||proposal.session_id!==captured.sessionId)throw new Error('候选版本或编辑权不匹配，请重新预览。');
      const expected={...baseScene,objects:baseScene.objects.map(object=>target.ids.includes(object.id)?{...object,assetId:intent.variantId}:object)};
      if(canonical(proposal.base_scene)!==canonical(baseScene)||canonical(proposal.candidate)!==canonical(expected))throw new Error('候选改变了选定版本以外的场景内容，已停止应用。');
      const [before,after]=await Promise.all([controller.authorizeAssets(baseScene),controller.authorizeAssets(proposal.candidate)]);
      await Promise.all(Object.entries({...before.assetUrls,...after.assetUrls}).map(([id,url])=>ensureGlbAsset(id,url)));
      if(!stillCurrent(captured)||token!==operation.current)return;
      if(!Number.isFinite(Date.parse(proposal.expires_at))||Date.parse(proposal.expires_at)<=Date.now())throw new Error('候选已过期，请重新预览。');
      setPreview({intent,context:captured,formKey,proposal,before,after});setShowOriginal(false);
      setNotice('候选已就绪，尚未修改场景。确认后只替换列出的物件，原资产版本保留。');
    } catch(error) { if(mounted.current&&token===operation.current)setNotice(assetError(error)); }
    finally { if(token===operation.current){pending.current=false;if(mounted.current)setBusy(false);} }
  }
  async function apply():Promise<void> {
    if(!preview||stale||pending.current)return;
    const selected=preview,token=++operation.current;
    pending.current=true;setBusy(true);setNotice('');
    try {
      if(Date.parse(selected.proposal.expires_at)<=Date.now())throw new Error('候选已过期，请重新预览。');
      if(!stillCurrent(selected.context))throw new Error('场景或编辑权已变化，请重新预览。');
      const result=await controller.applySceneProposal(selected.proposal,layoutToBackendScene(selected.context.base));
      selected.intent.proposalApplied=true;
      if(!mounted.current||token!==operation.current||latest.current.scope!==selected.context.scope)return;
      if(!result.acceptedLocally||latest.current.layout!==selected.context.base||latest.current.targetKey!==selected.context.targetKey)throw new Error('应用期间本地已有新修改，已保留本地草稿。请核对云端版本后重新打开。');
      const next=mergeProposalPresentation(selected.context.base,backendSceneToLayout(result.scene,{projectId:selected.context.base.id!,name:selected.context.base.name,...selected.after}));
      onApply(next);setPreview(null);setNotice('已应用到选定物件。原版本保留，可在此预览恢复父版本，也可使用画布撤销。');
    } catch(error) { if(mounted.current&&token===operation.current)setNotice(assetError(error)); }
    finally { if(token===operation.current){pending.current=false;if(mounted.current)setBusy(false);} }
  }
  function setChange(key:keyof MaterialChange,value:MaterialChange[keyof MaterialChange]|undefined):void {
    setChanges(current=>{const next={...current};if(value===undefined)delete next[key];else Object.assign(next,{[key]:value});return next;});
  }
  const tint=target.scene?.objects.filter(object=>target.ids.includes(object.id)&&object.color.toLowerCase()!=='#ffffff');
  return <section className="mc-panel" aria-label="物料个性化">
    <div className="sc-section-heading"><div><h2>物料个性化</h2><p>修改指定材质，保留几何与 UV；先对比，再确认应用。</p></div></div>
    {seed&&<p className="sc-note"><strong>{seed.name}</strong> · {seed.reason}</p>}
    {target.error?<p className="sc-note" role="status">{target.error}</p>:<p className="sc-note">目标：{target.ids.length} 个物件 · {target.ids.map(id=>layout.floors.flatMap(floor=>floor.items).find(item=>item.id===id)?.name??id).join('、')}</p>}
    {!canEdit&&<p className="sc-note">请登录并取得当前项目编辑权后预览和应用。</p>}
    {loading&&<p className="sc-note" role="status">正在读取真实材质槽…</p>}
    {inspection&&<>
      <p className="sc-note">{inspection.name} · {inspection.validation.hasUV?'含 UV':'没有 UV；参数调整不需要生成 UV'}</p>
      {tint&&tint.length>0&&<p className="sc-note">选中物件已有实例颜色，将继续与模型材质相乘；本次保留该颜色，不重置为白色。</p>}
      {!seed?.variantAssetId&&<>
        <fieldset disabled={busy} className="mc-slots"><legend>选择要修改的材质槽</legend>{inspection.slots.map(slot=><label key={slot.index}><input type="checkbox" disabled={slot.primitiveCount===0} checked={slots.includes(slot.index)} onChange={event=>setSlots(current=>event.target.checked?[...current,slot.index]:current.filter(index=>index!==slot.index))}/><span>{slot.name||`材质 ${slot.index+1}`}<small>{slot.primitiveCount} 个网格部件 · {slot.hasBaseColorTexture?'有颜色贴图':'纯色材质'}</small></span></label>)}</fieldset>
        <div className="mc-change"><label><input type="checkbox" disabled={busy} checked={changes.baseColor!==undefined} onChange={event=>setChange('baseColor',event.target.checked?'#ffffff':undefined)}/>修改基础色</label><input aria-label="基础色" type="color" disabled={busy||changes.baseColor===undefined} value={changes.baseColor??'#ffffff'} onChange={event=>setChange('baseColor',event.target.value)}/></div>
        {(['metallic','roughness'] as const).map(key=><div className="mc-change" key={key}><label><input type="checkbox" disabled={busy} checked={changes[key]!==undefined} onChange={event=>setChange(key,event.target.checked?0.5:undefined)}/>{key==='metallic'?'修改金属度':'修改粗糙度'}</label><input aria-label={key==='metallic'?'金属度':'粗糙度'} type="number" min={0} max={1} step={.05} disabled={busy||changes[key]===undefined} value={changes[key]===undefined?0.5:Number.isFinite(changes[key])?changes[key]:''} onChange={event=>setChange(key,event.target.valueAsNumber)}/></div>)}
        <label className="mc-texture"><input type="checkbox" disabled={busy} checked={changes.removeBaseColorTexture===true} onChange={event=>setChange('removeBaseColorTexture',event.target.checked?true:undefined)}/>移除选中材质的原颜色贴图</label>
        <p className="sc-note">默认保留原贴图，基础色会叠加在贴图上。移除贴图后才会显示纯基础色；采购材质仍待确认。</p>
      </>}
      <button type="button" className="sc-button sc-full" disabled={busy||!canEdit||!!target.error} onClick={()=>void prepare(seed?.variantAssetId)}>{busy?'正在准备…':seed?.variantAssetId?'预览候选版本':'制作并预览材质版本'}</button>
      {inspection.parentAssetId&&<button type="button" className="sc-button sc-full" disabled={busy||!canEdit||!!target.error} onClick={()=>void prepare(inspection.parentAssetId)}>预览恢复父版本</button>}
    </>}
    {!inspection&&!loading&&target.sourceAssetId&&<button type="button" className="sc-button" onClick={()=>setReload(value=>value+1)}>重新读取材质槽</button>}
    {preview&&<div className="mc-preview"><div className="mc-comparison" role="group" aria-label="版本对比"><button type="button" aria-pressed={showOriginal} onClick={()=>setShowOriginal(true)}>原版本</button><button type="button" aria-pressed={!showOriginal} onClick={()=>setShowOriginal(false)}>候选版本</button></div>
      <p className="sc-note">预览首个目标；将应用到 {target.ids.length} 件。保留实际尺寸、旋转与实例颜色。</p>
      {active&&!stale&&focusedPreview&&<ScenePreview scene={showOriginal?focusedPreview.before:focusedPreview.after} assetUrls={showOriginal?preview.before.assetUrls:preview.after.assetUrls} assetNames={showOriginal?preview.before.assetNames:preview.after.assetNames}/>}
      {stale?<p className="sc-note" role="status">场景、材质选择或编辑权已变化，或候选已过期；请重新预览。</p>:<p className="sc-note">{preview.proposal.explanation}</p>}
      <button type="button" className="sc-button sc-full" disabled={busy||stale||!canEdit} onClick={()=>void apply()}>确认应用到选定物件</button>
      <button type="button" className="sc-button sc-full" disabled={busy} onClick={()=>setPreview(null)}>放弃候选</button>
    </div>}
    {notice&&<p className="sc-note" role="status">{notice}</p>}
  </section>;
}
