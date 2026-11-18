'use client';

import {useEffect,useState} from 'react';
import {Box,Info} from '@/components/solid-icons';
import {searchMaterialCandidates,type MaterialCandidate,type MaterialCandidateResult} from '../lib/material-candidates';

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
   {/* 2026-11-19 用户指令：候选不再用文字行——直接铺 3D 模型缩略图（目录 CDN 的 thumb.webp）；
       名称和尺寸挪进 title 悬停提示，加载失败或没有缩略图回退到通用占位图标。 */}
   <ul className="ap-material-grid">{result.items.map(item=><MaterialTile key={item.slug} item={item}/>)}</ul>
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

/** 一格候选：3D 模型缩略图直铺，名称/尺寸进悬停提示；缩略图缺省或加载失败回退占位图标。 */
function MaterialTile({item}:{item:MaterialCandidate}){
 const [failed,setFailed]=useState(false);
 const dims=`${item.dimensions.width} × ${item.dimensions.depth} × ${item.dimensions.height} 米（宽 × 深 × 高）`;
 return <li className="ap-material-tile" title={`${item.name} · ${dims}`} aria-label={`${item.name}，${dims}`}>
  {item.thumb&&!failed
   ?<img src={item.thumb} alt={item.name} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>
   :<Box size={26} aria-hidden="true"/>}
 </li>;
}
