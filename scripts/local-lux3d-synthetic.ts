/** Offline-only Lux3D fixture. Never forwards a request or accepts real credentials. */
import {packGltf} from '../supabase/functions/_shared/models.ts';
import {startLocalLux3dWorker} from './local-lux3d-live.ts';
import {tetrahedron} from '../tests/model-fixture.ts';
import type {Backend} from '../supabase/functions/_shared/backend.ts';
import type {Env,Fetcher} from '../supabase/functions/_shared/http.ts';

export const SYNTHETIC_LUX3D_CONFIG:Readonly<Record<string,string>>=Object.freeze({
 LUX3D_API_KEY:'synthetic-lux3d-key',LUX3D_BASE_URL:'https://api.aholo3d.cn',
 // Fixture-only placeholders. They are not real terms, dates, prices, or account credits.
 LUX3D_TERMS_URL:'https://example.invalid/synthetic-terms',LUX3D_TERMS_REVIEWED_AT:'2000-01-01',GENERATION_MAX_TASK_CENTS:'100',
});
const assetUrl='https://model.kujiale.com/synthetic-fixture/model.glb';
let nextSyntheticTask=13579;
const syntheticTasks=new Set<string>();

/** The fixed strings exercise the real provider adapter; this function never calls fetch. */
export const syntheticLux3dFetch:Fetcher=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 const method=(init?.method??'GET').toUpperCase();
 const parsed=new URL(url);
 if(parsed.origin==='https://api.aholo3d.cn'){
  const headers=new Headers(init?.headers);if(headers.get('authorization')!==SYNTHETIC_LUX3D_CONFIG.LUX3D_API_KEY)throw Error('synthetic credential required');
  if(method==='POST'&&parsed.pathname==='/lux3d/v1/generate/text-to-3d/task/create'&&!parsed.search){
   const body=JSON.parse(String(init?.body)) as {prompt?:unknown;version?:unknown};
   if(typeof body.prompt!=='string'||!body.prompt.trim()||body.version!=='G1')throw Error('invalid synthetic input');
   const id=nextSyntheticTask++;syntheticTasks.add(String(id));
   return Response.json({c:'0',m:'',d:id});
  }
  if(method==='GET'&&parsed.pathname==='/lux3d/v1/generate/task/get'&&parsed.searchParams.size===1&&syntheticTasks.has(parsed.searchParams.get('taskid')??''))
   return Response.json({c:'0',m:'',d:{status:3,outputs:[{content:assetUrl}]}});
 }
 if(method==='GET'&&url===assetUrl){const model=tetrahedron();return new Response(new Uint8Array(packGltf(model.json,model.resources)));}
 throw Error('synthetic Lux3D route denied');
};

/** A single worker at a time; the real jobs RPC retains claim and duplicate protections. */
export function startSyntheticLux3dWorker(backend:Backend,env:Env,intervalMs=5000){
 return startLocalLux3dWorker(backend,env,syntheticLux3dFetch,intervalMs);
}
