'use client';

import { useEffect, useRef, useState } from 'react';
import { useBackendSession, type BackendSession } from '@/lib/backend-session';
import type { RoomLayout } from '../lib/types';

/** The parent places delivery actions inside Binggo, with no new global entry point. */
export function SceneDeliveryPanel({ layout, controller }: { layout: RoomLayout; controller: BackendSession }): JSX.Element {
  const cloud=useBackendSession(controller);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const latest=useRef({layout,userId:cloud.user?.id,projectId:cloud.project?.id});
  latest.current={layout,userId:cloud.user?.id,projectId:cloud.project?.id};
  const mounted=useRef(true);
  const pending=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>setNotice(''),[layout.id,cloud.user?.id]);
  async function download(kind:'glb'|'json'|'csv'):Promise<void> {
    if(pending.current)return;
    pending.current=true;setBusy(true);setNotice('');
    const before=latest.current;
    try {
      const {downloadSceneDelivery,exportDeliveryGlb,sceneDeliveryCsv,sceneDeliveryJson}=await import('../lib/scene-delivery');
      if(kind==='glb') {
        const result=await exportDeliveryGlb(layout,controller);
        if(!mounted.current||latest.current.layout!==before.layout||latest.current.userId!==before.userId||latest.current.projectId!==before.projectId)throw new Error('场景或账号已变化，请按当前方案重新导出。');
        downloadSceneDelivery(result.buffer,'model/gltf-binary',layout.name,'glb');
        setNotice(`GLB 已重新加载复检，保留 ${result.objectCount} 个物件节点及场地结构。`);
      } else {
        if(!mounted.current||latest.current.layout!==before.layout||latest.current.userId!==before.userId||latest.current.projectId!==before.projectId)return;
        const text=kind==='json'?sceneDeliveryJson(layout):sceneDeliveryCsv(layout);
        downloadSceneDelivery(text,kind==='json'?'application/json':'text/csv;charset=utf-8',`${layout.name}_${kind==='json'?'场景':'物料清单'}`,kind);
        setNotice(kind==='json'?'场景 JSON 已导出，私有模型重开时仍需授权。':'物料清单已导出，尺寸与采购规格仍需确认。');
      }
    } catch(error) { if(mounted.current&&latest.current.userId===before.userId&&latest.current.projectId===before.projectId)setNotice(error instanceof Error?error.message:'导出失败，请重试。'); }
    finally { pending.current=false;if(mounted.current)setBusy(false); }
  }
  return <section aria-label="场景交付" className="sc-generated-models">
    <div className="sc-section-heading"><div><h2>场景交付</h2><p>导出当前方案；GLB 会先重新加载并核对模型、材质和摆放。</p></div></div>
    <button className="sc-button sc-full" type="button" disabled={busy} onClick={()=>void download('glb')}>{busy?'正在准备交付…':'导出场景 GLB'}</button>
    <button className="sc-button sc-full" type="button" disabled={busy} onClick={()=>void download('json')}>导出场景 JSON</button>
    <button className="sc-button sc-full" type="button" disabled={busy} onClick={()=>void download('csv')}>导出物料清单 CSV</button>
    <p className="sc-note">交付当前单层项目。完整场馆预设需保留原文件；环境光与后处理不会随 GLB 交付。生成物料为概念方案，采购规格待确认。</p>
    {notice&&<p className="sc-note" role="status">{notice}</p>}
  </section>;
}
