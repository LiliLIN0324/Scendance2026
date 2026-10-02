import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assetRecord } from '../supabase/functions/_shared/assets.ts';
import { sha256 } from '../supabase/functions/_shared/domain.ts';
import { download } from '../supabase/functions/_shared/http.ts';
import { MAX_GLB_BYTES } from '../supabase/functions/_shared/models.ts';
import { validateLibraryModel } from './library-model.ts';

const {values}=parseArgs({options:{write:{type:'boolean',default:false},remote:{type:'boolean',default:false},
  owner:{type:'string'},cache:{type:'string',default:join(tmpdir(),'scendance-v041-library')}}});
const catalog=JSON.parse(await readFile(new URL('../assets/library/online.json',import.meta.url),'utf8'));
if(catalog.models.length!==234 || new Set(catalog.models.map((m:{assetId:string})=>m.assetId)).size!==234)throw new Error('CATALOG_INCOMPLETE');
let client:SupabaseClient|undefined;
if(values.write){
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key || !values.owner || !/^[0-9a-f-]{36}$/.test(values.owner))throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and --owner are required');
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname) && !values.remote)throw new Error('REMOTE_WRITE_REQUIRES_REMOTE_FLAG');
  client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
await mkdir(values.cache!,{recursive:true});
let checked=0,registered=0;
const failures:{model:string;error:string}[]=[];
// Sequential processing bounds memory, upload pressure and restart scope. Each
// record is content-addressed; retrying the script never duplicates assets.
for(const model of catalog.models){
  try{
    if(!/^[a-z0-9-]{1,200}$/.test(model.slug) || !/^https:\/\/cdn\.3dassets\.dev\/assets\/\d+\/v\d+\/model\.glb$/.test(model.glb))throw new Error('INVALID_CATALOG_ENTRY');
    const path=join(values.cache!,model.slug+'.glb');
    let bytes:Uint8Array;
    try{bytes=new Uint8Array(await readFile(path));}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;bytes=await download(model.glb,['cdn.3dassets.dev'],MAX_GLB_BYTES);await writeFile(path,bytes);}
    if(bytes.length!==model.bytes || await sha256(bytes)!==model.sha256)throw new Error('CATALOG_BYTES_CHANGED');
    const metadata=await validateLibraryModel(bytes);checked++;
    if(client){
      const record=await assetRecord(values.owner!,bytes,{name:model.name,source:'upload',sourceId:model.slug,sourceUrl:model.page,
        license:{id:'CC0-1.0',url:'https://creativecommons.org/publicdomain/zero/1.0/',attribution:'3DAssets.dev'},
        metadata:{...metadata,catalog:'scendance-v041'}},model.assetId);
      const {error:uploadError}=await client.storage.from('scene-assets').upload(record.storagePath,bytes,{contentType:'model/gltf-binary',upsert:false});
      if(uploadError && String((uploadError as {statusCode?:string}).statusCode)!=='409')throw new Error('STORAGE_UPLOAD_FAILED');
      const {data,error}=await client.rpc('register_library_asset',{p_owner:values.owner,p_model_id:model.slug,p_record:record});
      if(error || data?.id!==model.assetId)throw new Error('LIBRARY_REGISTRATION_FAILED');
      registered++;
    }
    if(checked%30===0)console.log(JSON.stringify({checked,registered,total:234}));
  }catch(error){failures.push({model:model.slug,error:error instanceof Error?error.message:'IMPORT_FAILED'});}
}
console.log(JSON.stringify({checked,registered,total:234,failures},null,2));
if(failures.length)process.exitCode=1;
