import { ApiError, sha256 } from './domain.ts';
import type { Backend } from './backend.ts';
import { required, type Env } from './http.ts';
import { generationCapabilities, generationRequestSchema, type GenerationProvider } from './generation-contract.ts';
import { chooseLane } from './generation-lane.ts';
import { requireTextureSource } from './generation-quality.ts';

async function validateReferenceImage(backend:Backend,actor:string,input:{kind:'text'|'image'|'texture';referenceImageAssetId?:string|undefined}) {
  if(!input.referenceImageAssetId)return;
  const image=await backend.scene(actor,'assets.get',{assetId:input.referenceImageAssetId});
  const min=input.kind==='texture'?129:128,max=input.kind==='texture'?4095:4096;
  if(image.owner_id!==actor||!['png','jpeg'].includes(image.format))throw new ApiError('REFERENCE_IMAGE_FORBIDDEN',403);
  if(image.byte_size>5*1024*1024||!Number.isInteger(image.metadata?.width)||!Number.isInteger(image.metadata?.height)||[image.metadata.width,image.metadata.height].some(n=>n<min||n>max))throw new ApiError('INVALID_REFERENCE_IMAGE',422);
}

function luxConfigured(env:Env) {
  return Boolean(env('LUX3D_API_KEY')&&env('LUX3D_TERMS_URL')&&env('LUX3D_TERMS_REVIEWED_AT'));
}

export async function prepareGenerationRequest(backend:Backend,actor:string,raw:unknown,env:Env) {
  // Keep retirement ahead of payload validation for requests that can only land on HY-3D.
  // Explicit Aholo, and default text/image while Lux3D is configured, must survive it.
  const rawRecord=typeof raw==='object'&&raw!==null?raw as {provider?:unknown;kind?:unknown}:{};
  const declaredProvider=rawRecord.provider;
  const declaredKind=rawRecord.kind??'text';
  const textOrImage=declaredKind==='text'||declaredKind==='image';
  const aholoCanServe=textOrImage&&(declaredProvider==='aholo'||(declaredProvider!=='hy3d'&&luxConfigured(env)));
  if(env('HY3_RETIRED')==='true'&&!aholoCanServe)throw new ApiError('HY3_RETIRED',410);
  const input=generationRequestSchema.parse(raw),capabilities=generationCapabilities(env);
  // Single lane decision keeps the cheap-first rule in one place. The error code and status stay
  // unchanged; `lane`/`reason` only add why no lane could serve the request.
  const decision=chooseLane({kind:input.kind,provider:input.provider},capabilities);
  // Retiring HY-3D must not take the Aholo default down with it.
  if(decision.lane==='hy3d'&&env('HY3_RETIRED')==='true')throw new ApiError('HY3_RETIRED',410,{lane:decision.lane,reason:decision.reason});
  if(decision.lane==='aholo'){
    if(!decision.available)throw new ApiError('SERVICE_NOT_CONFIGURED',503,{setting:'LUX3D_API_KEY',lane:decision.lane,reason:decision.reason});
    required(env,'LUX3D_API_KEY');required(env,'LUX3D_TERMS_REVIEWED_AT');required(env,'LUX3D_TERMS_URL');
    await validateReferenceImage(backend,actor,input);
    const {requestId,...identity}=input;
    // Prefix Aholo text so it does not reuse a same-prompt HY-3D job. HY-3D text stays prompt-only.
    return {...input,fingerprint:await sha256(input.kind==='text'?`aholo\n${input.prompt}`:JSON.stringify(identity)),providerMode:'aholo' as const,providerModel:'lux3d' as const};
  }
  required(env,'HUNYUAN_API_KEY');required(env,'HUNYUAN_TERMS_REVIEWED_AT');required(env,'HUNYUAN_TERMS_URL');
  if(!decision.available)throw new ApiError('SERVICE_NOT_CONFIGURED',503,{setting:input.kind==='texture'?'HUNYUAN_TEXTURE_ENABLED':'HUNYUAN_MODEL',lane:decision.lane,reason:decision.reason});
  await validateReferenceImage(backend,actor,input);
  if(input.sourceAssetId){
    const source=await backend.scene(actor,'assets.get',{assetId:input.sourceAssetId});
    if(source.format!=='glb')throw new ApiError('INVALID_SOURCE_MODEL',422);
    if(!backend.readSourceBytes)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
    await requireTextureSource(await backend.readSourceBytes(source.storage_path));
  }
  const {requestId,...identity}=input;
  return {...input,fingerprint:await sha256(input.kind==='text'?input.prompt:JSON.stringify(identity)),providerMode:(env('HUNYUAN_API_MODE')??'tokenhub') as GenerationProvider['providerMode'],providerModel:(input.kind==='texture'?'hy-3d-texture':capabilities.model) as GenerationProvider['providerModel']};
}
