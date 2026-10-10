import { z } from 'zod';
import type { GLTF } from '@gltf-transform/core';
import { ApiError, sha256, type Scene } from './domain.ts';
import { download, fetchJson, type Fetcher } from './http.ts';
import { MAX_GLB_BYTES, packGltf, validateModel } from './models.ts';

const itemSchema = z.object({ name: z.string(), type: z.number(), categories: z.array(z.string()).default([]), tags: z.array(z.string()).default([]), polycount: z.number().optional(), thumbnail_url: z.string().optional() });
const fileSchema = z.object({ url: z.url(), size: z.number().nonnegative() });
const filesSchema = z.object({ gltf: z.object({ '1k': z.object({ gltf: fileSchema.extend({ include: z.record(z.string(),fileSchema) }) }).optional() }).optional() });
const modelIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const phHeaders = { 'User-Agent': 'ScenePlanner/0.1 (activity scene planning)' };
let cache: { at: number; items: Record<string,z.infer<typeof itemSchema>> } | undefined;
async function phCatalog(fetcher: Fetcher) {
  if (!cache || Date.now()-cache.at>300_000) {
    const items = z.record(z.string(),itemSchema).parse(await fetchJson('https://api.polyhaven.com/assets?t=models',{ headers: phHeaders },fetcher,8_000_000));
    cache={ at:Date.now(),items };
  }
  return cache.items;
}
async function phFiles(id: string, fetcher: Fetcher) {
  const data = filesSchema.parse(await fetchJson(`https://api.polyhaven.com/files/${modelIdSchema.parse(id)}`,{headers:phHeaders},fetcher));
  const file = data.gltf?.['1k']?.gltf;
  if (!file || Object.keys(file.include).length>32 || file.size+Object.values(file.include).reduce((s,f)=>s+f.size,0)>MAX_GLB_BYTES-100_000) throw new ApiError('NO_COMPATIBLE_MODEL',422);
  return file;
}
export async function recommendations(theme: string, scene: Scene, fetcher: Fetcher = fetch) {
  const items=await phCatalog(fetcher);
  const terms=theme.toLowerCase().split(/[\s,，。]+/).filter(Boolean);
  const aliases: Record<string,string>={ 椅:'chair',桌:'table',植物:'plant',装饰:'decoration',木:'wood',沙龙:'chair',工作坊:'table',黑客松:'table',展:'display' };
  for (const [cn,en] of Object.entries(aliases)) if (theme.includes(cn)) terms.push(en);
  if (!terms.length) terms.push('chair','table','plant');
  const selected=new Set(scene.objects.map(o=>o.materialId));
  const candidates=Object.entries(items).filter(([,v])=>v.type===2 && (v.polycount??0)<=100_000).map(([id,v])=>{
    const text=[id,v.name,...v.tags,...v.categories].join(' ').toLowerCase();
    return { id,item:v,score:terms.filter(t=>text.includes(t)).length+(selected.has('chair')&&text.includes('table')?0.5:0) };
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,12);
  const resolved=await Promise.allSettled(candidates.map(async c=>{
    const file=await phFiles(c.id,fetcher);
    return { id:c.id,name:c.item.name,thumbnail:`https://cdn.polyhaven.com/asset_img/thumbs/${c.id}.png?width=256`,source:'Poly Haven',sourceUrl:`https://polyhaven.com/a/${c.id}`,license:'CC0-1.0',estimatedBytes:file.size+Object.values(file.include).reduce((s,f)=>s+f.size,0),reason:'主题/物料匹配，1K 资源预检通过；导入后设定尺寸并检查场地边界',venueSize:scene.venue };
  }));
  return resolved.flatMap(r=>r.status==='fulfilled'?[r.value]:[]).slice(0,8);
}
export async function importPublicModel(id: string, fetcher: Fetcher = fetch) {
  modelIdSchema.parse(id);
  const items=await phCatalog(fetcher), item=items[id];
  if (!item || item.type!==2) throw new ApiError('MODEL_NOT_FOUND',404);
  const file=await phFiles(id,fetcher);
  let total=0;
  const get=async (url:string)=>{const bytes=await download(url,['dl.polyhaven.org'],MAX_GLB_BYTES-total,fetcher); total+=bytes.length; return bytes;};
  const raw=await get(file.url);
  let json: GLTF.IGLTF;
  try { json=JSON.parse(new TextDecoder().decode(raw)); } catch { throw new ApiError('INVALID_GLTF',422); }
  const resources: Record<string,Uint8Array>={};
  for (const [uri,entry] of Object.entries(file.include)) {
    if (uri==='__proto__' || uri==='constructor' || uri.includes('..') || uri.startsWith('/')) throw new ApiError('UNSAFE_RESOURCE_PATH',422);
    resources[uri]=await get(entry.url);
  }
  const bytes=packGltf(json,resources), metadata=await validateModel(bytes);
  return { bytes, metadata, name:item.name, source:'polyhaven', sourceId:id, sourceUrl:`https://polyhaven.com/a/${id}`, license:{ id:'CC0-1.0',url:'https://polyhaven.com/license',attribution:'Poly Haven',retrievedAt:new Date().toISOString() } };
}
export async function assetRecord(owner: string, bytes: Uint8Array, properties: Record<string,unknown>, id=crypto.randomUUID()) {
  const hash=await sha256(bytes), format=(properties.format as string|undefined)??'glb';
  return { ...properties,id,format,byteSize:bytes.length,sha256:hash,storagePath:`${owner}/${id}/${hash}.${format}` };
}
