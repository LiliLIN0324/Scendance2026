import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assetRecord } from '../supabase/functions/_shared/assets.ts';
import { sha256, uuid } from '../supabase/functions/_shared/domain.ts';
import { validateLibraryModel } from './library-model.ts';

const {values}=parseArgs({options:{write:{type:'boolean',default:false},remote:{type:'boolean',default:false},owner:{type:'string'}}});
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('assets/library/merged.json',root),'utf8'));
const models=catalog.models.filter((m:{blockedReason?:string})=>!m.blockedReason);
if(models.length!==catalog.placeableCount || new Set(models.map((m:{slug:string})=>m.slug)).size!==models.length)throw new Error('CATALOG_INCOMPLETE');
const receiptPath=new URL('assets/library/registered.json',root);
const receipts:Record<string,{assetId:string;sha256:string}>=JSON.parse(await readFile(receiptPath,'utf8'));
let client:SupabaseClient|undefined;
if(values.write){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key || !values.owner)throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and --owner are required');
  uuid.parse(values.owner);
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname) && !values.remote)throw new Error('REMOTE_WRITE_REQUIRES_REMOTE_FLAG');
  client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
let checked=0,registered=0;
const failures:{model:string;error:string}[]=[];
// UUIDv5 names pin retries to identical bytes. Publish IDs only after the RPC confirms registration.
function plannedId(slug:string,hash:string):string {
  const bytes=createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8','hex')).update(`scendance/library/${slug}/${hash}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
for(let start=0;start<models.length;start+=6){
  await Promise.all(models.slice(start,start+6).map(async(model:typeof models[number])=>{
  try{
    if(!/^[a-z0-9-]{1,200}$/.test(model.slug) || model.glb!==`/showcase/assets/library/model/${model.slug}.glb` || model.page!==`https://3dassets.dev/assets/${model.slug}`)throw new Error('INVALID_CATALOG_ENTRY');
    const bytes=new Uint8Array(await readFile(new URL(`assets/library/model/${model.slug}.glb`,root)));
    if(bytes.length!==model.bytes || await sha256(bytes)!==model.sha256)throw new Error('CATALOG_BYTES_CHANGED');
    const metadata=await validateLibraryModel(bytes);checked++;
    if(client && !model.assetId && !receipts[model.slug]){
      const id=model.assetId??plannedId(model.slug,model.sha256);
      const record=await assetRecord(values.owner!,bytes,{name:model.name,source:'upload',sourceId:model.slug,sourceUrl:model.page,
        license:{id:'CC0-1.0',url:'https://creativecommons.org/publicdomain/zero/1.0/',attribution:'3DAssets.dev'},
        metadata:{...metadata,catalog:'scendance-v041'}},id);
      const {error:uploadError}=await client.storage.from('scene-assets').upload(record.storagePath,bytes,{contentType:'model/gltf-binary',upsert:false});
      if(uploadError && String((uploadError as {statusCode?:string}).statusCode)!=='409')throw new Error('STORAGE_UPLOAD_FAILED');
      const {data,error}=await client.rpc('register_library_asset',{p_owner:values.owner,p_model_id:model.slug,p_record:record});
      if(error || data?.id!==id)throw new Error(error?.message??'LIBRARY_REGISTRATION_FAILED');
      receipts[model.slug]={assetId:id,sha256:model.sha256};
      registered++;
    }
    else if(client)registered++;
  }catch(error){failures.push({model:model.slug,error:error instanceof Error?error.message:'IMPORT_FAILED'});}
  }));
  if(client)await writeFile(receiptPath,JSON.stringify(receipts,null,2)+'\n');
  if(checked%30===0)console.log(JSON.stringify({checked,registered,total:models.length}));
}
console.log(JSON.stringify({checked,registered,total:models.length,excluded:catalog.count-models.length,failures},null,2));
if(failures.length)process.exitCode=1;
