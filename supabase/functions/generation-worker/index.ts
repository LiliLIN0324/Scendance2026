import { createBackend } from '../_shared/backend.ts';
import { processGeneration } from '../_shared/worker.ts';
import { required } from '../_shared/http.ts';
import { sha256 } from '../_shared/domain.ts';

const env=(key:string)=>Deno.env.get(key);
const backend=createBackend(env);
Deno.serve(async(request:Request)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
  if(request.method!=='POST') return new Response(null,{status:405,headers});
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(!token || await sha256(token)!==await sha256(required(env,'GENERATION_WORKER_SECRET'))) return new Response(null,{status:401,headers});
  try { return new Response(JSON.stringify(await processGeneration(backend,env)),{headers}); }
  catch { return new Response(JSON.stringify({error:'WORKER_FAILED'}),{status:500,headers}); }
});
