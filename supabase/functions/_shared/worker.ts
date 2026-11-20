import { compareTextureGeometry, requireTextureSource } from './generation-quality.ts';
import { ApiError } from './domain.ts';
import { assetRecord } from './assets.ts';
import { generatedObjectName } from './generated-object-name.ts';
import { download, required, type Env, type Fetcher } from './http.ts';
import { aholoLux3d, hunyuan } from './providers.ts';
import { MAX_PROVIDER_GLB_BYTES, repairGlb, validateModel } from './models.ts';
import type { Backend } from './backend.ts';

const MAX_PROVIDER_PREVIEW_BYTES = 2 * 1024 * 1024;

/** 预览图只收真图片字节，避免把上游的错误页存成缩略图。 */
function previewImage(bytes: Uint8Array): { ext: 'png' | 'jpg' | 'webp'; mime: string } | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/**
 * 供应商随 GLB 一起给的预览图存进同一个账号目录。
 * 预览只是卡面，取不到或存不下都不该让一次已经付费的模型归档失败。
 */
async function archivePreview(
  backend: Backend,
  job: { id: string; owner_id: string },
  url: string | undefined,
  hosts: string[],
  fetcher: Fetcher,
): Promise<{ previewPath?: string }> {
  if (!url) return {};
  try {
    const bytes = await download(url, hosts, MAX_PROVIDER_PREVIEW_BYTES, fetcher);
    const format = previewImage(bytes);
    if (!format) return {};
    const path = `${job.owner_id}/${job.id}/preview.${format.ext}`;
    await backend.upload(path, bytes, format.mime);
    return { previewPath: path };
  } catch {
    return {};
  }
}

export async function processGeneration(backend:Backend,env:Env,fetcher:Fetcher=fetch) {
  // Pre-claim guard: without any vendor credential there is no work we could do. The exact
  // vendor key is re-checked after the claim, once the pinned provider is known.
  if(!env('HUNYUAN_API_KEY')&&!env('LUX3D_API_KEY')) required(env,'HUNYUAN_API_KEY');
  const job=await backend.jobs(null,'jobs.claim');
  if(!job) return {processed:0};
  // Provider identity is pinned on the job row at creation time; the worker never re-reads config
  // to pick the vendor, only the vendor's own credentials.
  const aholo=job.provider_mode==='aholo';
  const provider=aholo?aholoLux3d(env,fetcher):hunyuan(env,fetcher,{providerMode:job.provider_mode,providerModel:job.provider_model});
  const update=(state:string,extra:Record<string,unknown>={})=>backend.jobs(null,'jobs.update',{id:job.id,workerToken:job.worker_token,state,...extra});
  if(Date.now()-Date.parse(job.created_at)>23*60*60*1000) {
    await update('failed',{errorCode:'PROVIDER_TASK_EXPIRED'});
    return {processed:1};
  }
  if(job.state==='submitting') {
    let dispatched=false;
    try {
      let imageUrl:string|undefined,sourceUrl:string|undefined;
      if(job.reference_image_asset_id){
        const image=await backend.scene(job.owner_id,'assets.get',{assetId:job.reference_image_asset_id});
        if(image.owner_id!==job.owner_id||!['png','jpeg'].includes(image.format))throw new ApiError('REFERENCE_IMAGE_FORBIDDEN',403);
        imageUrl=await backend.sign(image.storage_path);
      }
      if(job.source_asset_id){
        const source=await backend.scene(job.owner_id,'assets.get',{assetId:job.source_asset_id});
        if(source.format!=='glb'||!backend.readSourceBytes)throw new ApiError('INVALID_SOURCE_MODEL',422);
        await requireTextureSource(await backend.readSourceBytes(source.storage_path));
        sourceUrl=await backend.sign(source.storage_path);
      }
      dispatched=true;
      const submitted=await provider.submit(job.prompt,{imageUrl,sourceUrl});
      await update('submitted',{providerJobId:submitted.JobId,usage:{requestId:submitted.RequestId}});
    } catch(error) {
      // HTTP 5xx, invalid response, network timeout, or lost DB acknowledgement may all follow a charged submission.
      const rejected=error instanceof ApiError&&error.code==='PROVIDER_REJECTED';
      // 2026-11-17：供应商自己的拒绝码与文案要落库。之前它被整个丢掉，
      // 于是「供应商明确拒了」和「供应商自己挂了」在库里长得一模一样，只能靠猜——
      // 生产 C1 实跑就卡在这里：任务 failed、error_code=PROVIDER_REJECTED，
      // 但没人说得清是 key 不认、额度不够还是内容被拦。
      const vendorError=rejected&&error.details
        ? {vendorCode:String((error.details as {code?:unknown}).code??''),vendorMessage:String((error.details as {message?:unknown}).message??'')}
        : undefined;
      await update(!dispatched||rejected?'failed':'submit_unknown',{
        errorCode:error instanceof ApiError?error.code:'SUBMIT_RESULT_UNKNOWN',
        ...(vendorError?{usage:{vendorError}}:{}),
      });
    }
    return {processed:1};
  }
  let archiving=job.state==='archiving';
  try {
    const result=await provider.query(job.provider_job_id);
    const usage={credits:result.ResultCreditConsumed,details:result.ResultCreditDetails,requestId:result.RequestId};
    if(result.Status==='FAIL') await update('failed',{errorCode:result.ErrorCode||'PROVIDER_FAILED',usage});
    else if(result.Status!=='DONE') await update('processing',{usage});
    else {
      await backend.jobs(null,'jobs.archive_start',{id:job.id,workerToken:job.worker_token});
      archiving=true;
      const file=result.ResultFile3Ds?.find(f=>f.Type.toUpperCase()==='GLB');
      if(!file) throw new ApiError('PROVIDER_NO_GLB',422);
      // Accept only known object-storage domains; never proxy arbitrary URLs or redirects.
      // Lux3D serves its direct GLB from kujiale.com; HY-3D from Tencent COS.
      const raw=await download(file.Url,aholo?['.kujiale.com','.myqcloud.com','.tencentcos.cn','.tencentcos.com']:['.myqcloud.com','.tencentcos.cn','.tencentcos.com'],MAX_PROVIDER_GLB_BYTES,fetcher);
      // Lux3D 产物带 bufferView 缺 target 与零法线两类瑕疵，先修复再过质量门（几何与 UV 不动）。
      const bytes=aholo?repairGlb(raw,MAX_PROVIDER_GLB_BYTES):raw;
      const metadata:Record<string,unknown>=await validateModel(bytes,MAX_PROVIDER_GLB_BYTES);
      metadata.generation={kind:job.kind??'text',providerMode:job.provider_mode,providerModel:job.provider_model,referenceImageAssetId:job.reference_image_asset_id??undefined};
      // 名字只取短对象名；完整描述留在 metadata 里，物料详情才能还原用户当时写了什么。
      metadata.originalPrompt=job.prompt;
      Object.assign(metadata,await archivePreview(backend,job,result.ResultFile3Ds?.find(f=>f.PreviewImageUrl)?.PreviewImageUrl,aholo?['.kujiale.com','.myqcloud.com','.tencentcos.cn','.tencentcos.com']:['.myqcloud.com','.tencentcos.cn','.tencentcos.com'],fetcher));
      if(job.kind==='texture'){
        const source=await backend.scene(job.owner_id,'assets.get',{assetId:job.source_asset_id});
        if(!backend.readSourceBytes)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
        const quality=await compareTextureGeometry(await backend.readSourceBytes(source.storage_path),bytes);
        if(!quality.geometryPreserved||!quality.uvPreserved)throw new ApiError('TEXTURE_GEOMETRY_CHANGED',422,{quality});
        metadata.parentAssetId=job.source_asset_id;metadata.sourceSha256=source.sha256;metadata.changeMode='texture';
        metadata.textureVariant={validation:quality,procurementStatus:'needs_confirmation'};
      }
      const asset=await assetRecord(job.owner_id,bytes,{
        // 描述是提示词，不是物件名：入库先收成短名，整段原话留在任务记录里。
        name:generatedObjectName(job.prompt),source:aholo?'aholo':'hunyuan',sourceId:job.provider_job_id,
        sourceUrl:aholo?'https://labs.aholo.ai':'https://cloud.tencent.com/product/ai3d',metadata,
        license:aholo
          ?{type:'provider-terms',reviewedAt:required(env,'LUX3D_TERMS_REVIEWED_AT'),url:required(env,'LUX3D_TERMS_URL')}
          :{type:'provider-terms',reviewedAt:required(env,'HUNYUAN_TERMS_REVIEWED_AT'),url:required(env,'HUNYUAN_TERMS_URL')},
      },job.id);
      await backend.upload(asset.storagePath,bytes,'model/gltf-binary');
      await backend.jobs(null,'jobs.complete',{id:job.id,workerToken:job.worker_token,asset,usage});
    }
  } catch(error) {
    const invalid=error instanceof ApiError && [413,422].includes(error.status);
    const expired=Date.now()-Date.parse(job.created_at)>23*60*60*1000;
    await update(invalid?'rejected':expired?'failed':archiving?'archiving':'processing',{errorCode:error instanceof ApiError?error.code:'GENERATION_POLL_FAILED',...(error instanceof ApiError&&error.code==='TEXTURE_GEOMETRY_CHANGED'?{usage:{quality:error.details}}:{})});
  }
  return {processed:1};
}
