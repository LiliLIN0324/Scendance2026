'use client';
import {useState} from 'react';
import {prepareReadonlyDraftBundle,type ReadonlyDraftBundle,type ReadonlyDraftInputs} from './lib/readonly-draft-bundle';
import {downloadTextFile} from './lib/plan-export/download';
function downloadBlob(name:string,blob:Blob):void {const url=URL.createObjectURL(blob);try{const link=document.createElement('a');link.href=url;link.download=name;link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}}
export function ReadonlyDraftExport({capture,saveText=downloadTextFile,saveBlob=downloadBlob}:{capture:()=>ReadonlyDraftInputs;saveText?:(name:string,mime:string,text:string)=>void;saveBlob?:(name:string,blob:Blob)=>void}) {
 const [bundle,setBundle]=useState<ReadonlyDraftBundle|null>(null),[notice,setNotice]=useState('');
 return <section aria-label="页面草稿导出"><p>这些文件只用于保全当前页面可读取的草稿，不是完整备份，也不会自动上传。</p>
  <button type="button" onClick={()=>{try{setBundle(prepareReadonlyDraftBundle(capture()));setNotice('已整理可读取内容，请逐项下载。');}catch{setNotice('当前草稿无法完整读取，请保留页面并重新核对。');}}}>整理页面草稿</button>
  {bundle&&<><ul>{bundle.omissions.map((item,index)=><li key={index}>{item}</li>)}</ul>
   <button type="button" onClick={()=>{try{saveText('页面草稿清单.json','application/json;charset=utf-8',bundle.json);setNotice('已请求浏览器下载，请检查文件。');}catch{setNotice('下载未能发起，草稿仍保留在本页。');}}}>下载文字与布局草稿</button>
   {bundle.images.map((image,index)=><button type="button" key={`${image.id}:${index}`} onClick={()=>{try{saveBlob(image.name,image.blob);setNotice('已请求浏览器下载原图，请检查文件。');}catch{setNotice('原图下载未能发起，草稿仍保留在本页。');}}}>下载原图：{image.name}</button>)}
  </>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
