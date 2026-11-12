'use client';

import {useEffect,useState} from 'react';
import {Info} from '@/components/solid-icons';
import {searchMaterialCandidates,type MaterialCandidateResult} from '../lib/material-candidates';

type View={query:string;state:'loading'}|{query:string;state:'result';result:MaterialCandidateResult};

/** Read-only catalogue suggestions. Opening the library never places an item. */
export function MaterialCandidatesPanel({query,onOpenLibrary}:{query:string;onOpenLibrary:(query:string)=>void}):JSX.Element {
 const clean=query.trim();
 const [view,setView]=useState<View|null>(null),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;
  if(!clean){setView(null);return()=>{active=false;};}
  setView({query:clean,state:'loading'});
  void searchMaterialCandidates(clean).then(result=>{if(active)setView({query:clean,state:'result',result});})
   .catch(()=>{if(active)setView({query:clean,state:'result',result:{status:'unavailable',items:[]}});});
  return()=>{active=false;};
 },[clean,attempt]);
 const current=view?.query===clean?view:null;
 const result=current?.state==='result'?current.result:null;
 return <section aria-label="物料候选" className="ap-card ap-material-card">
  <span className="ap-blocked-stamp"><Info size={12} aria-hidden="true"/>物料库</span>
  <strong>物料候选</strong>
  <p className="ap-blocked-note">这些是可查看的模型，展示的是模型标称尺寸。实物规格、库存和价格还需核实。</p>
  {!clean?<p className="ap-blocked-note">先告诉我想找什么物料。</p>:!current||current.state==='loading'?<p className="ap-blocked-note" role="status">正在查找物料…</p>:null}
  {result?.status==='ok'&&(result.items.length===0?<p className="ap-blocked-note">没有找到“{clean}”，试试其他名称。</p>:<>
   <p className="ap-blocked-note">找到 {result.total} 个模型，先看这 {result.items.length} 个：</p>
   <ul className="ap-material-list">{result.items.map(item=><li key={item.slug}><strong>{item.name}</strong><span>{item.dimensions.width} × {item.dimensions.depth} × {item.dimensions.height} 米（宽 × 深 × 高）</span></li>)}</ul>
  </>)}
  {result?.status==='unavailable'&&<p className="ap-blocked-note" role="alert">暂时无法读取物料，请重试。</p>}
  {result?.status==='invalid'&&<p className="ap-blocked-note" role="alert">物料名称无法识别，请换个简短名称。</p>}
  {result?.status==='needs_query'&&<p className="ap-blocked-note">先告诉我想找什么物料。</p>}
  <div className="ap-error-actions">
   {result?.status==='unavailable'&&<button type="button" className="chip" onClick={()=>setAttempt(value=>value+1)}>重试</button>}
   <button type="button" className="chip btn-outline" onClick={()=>onOpenLibrary(clean)}>打开物料库</button>
  </div>
 </section>;
}
