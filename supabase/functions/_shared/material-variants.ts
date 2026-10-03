import { z } from 'zod';
import type { GLTF } from '@gltf-transform/core';
// @ts-types="./gltf-validator.d.ts"
import { validateBytes } from 'gltf-validator';
import { ApiError, canonical, sceneHash, sceneSchema, sceneWarnings, sha256 } from './domain.ts';
import { MAX_GLB_BYTES } from './models.ts';
import { assetCustomizationRequestSchema, materialChangeSchema, derivedVariantMetadataSchema, materialVariantProposalRequestSchema, type MaterialChange, type MaterialInspection } from './asset-customization-contract.ts';
import { assetRecord } from './assets.ts';
import { canApplyStructuralChange, dimensionConflicts, structuralWarnings } from './structural-geometry.ts';
import type { Backend } from './backend.ts';

export { assetCustomizationRequestSchema as customizationSchema } from './asset-customization-contract.ts';
const patchSchema=z.strictObject({materialIndices:assetCustomizationRequestSchema.shape.materialIndices,changes:materialChangeSchema});
const allowedRequiredExtensions=new Set(['KHR_mesh_quantization','EXT_texture_webp']);

/** Read-only container parsing: the original binary chunks are kept verbatim. */
function readContainer(bytes:Uint8Array) {
  if(bytes.byteLength<28 || bytes.byteLength>MAX_GLB_BYTES)throw new ApiError('INVALID_GLB_SIZE',422);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==bytes.byteLength || view.getUint32(16,true)!==0x4e4f534a)throw new ApiError('INVALID_GLB',422);
  const jsonLength=view.getUint32(12,true);
  let offset=12,jsonCount=0,binCount=0;
  while(offset<bytes.length) {
    if(offset+8>bytes.length)throw new ApiError('INVALID_GLB',422);
    const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true);
    if(length%4 || offset+8+length>bytes.length)throw new ApiError('INVALID_GLB',422);
    if(type===0x4e4f534a)jsonCount++;
    if(type===0x004e4942)binCount++;
    offset+=8+length;
  }
  if(jsonCount!==1 || binCount>1)throw new ApiError('INVALID_GLB',422);
  let json:GLTF.IGLTF;
  try {json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+jsonLength)));}
  catch {throw new ApiError('INVALID_GLB',422);}
  if(!json || typeof json!=='object' || Array.isArray(json))throw new ApiError('INVALID_GLB',422);
  return {json,tail:bytes.subarray(20+jsonLength)};
}

async function validateMaterialSource(bytes:Uint8Array,json:GLTF.IGLTF) {
  const report=await validateBytes(bytes,{maxIssues:20});
  if(report.issues.numErrors)throw new ApiError('GLTF_VALIDATION_FAILED',422,{errors:report.issues.numErrors});
  if(json.buffers?.some(buffer=>buffer.uri) || json.images?.some(image=>image.uri))throw new ApiError('EXTERNAL_MODEL_RESOURCES',422);
  if(json.extensionsRequired?.some(extension=>!allowedRequiredExtensions.has(extension)))throw new ApiError('UNSUPPORTED_MODEL_FEATURE',422);
  if((json.nodes?.length??0)>500 || (json.materials?.length??0)>64 || (json.images?.length??0)>32)throw new ApiError('MODEL_TOO_COMPLEX',422);
  return report.issues.numWarnings;
}

async function geometryUVSignature(json:GLTF.IGLTF,tail:Uint8Array) {
  const {materials,...unchanged}=json;
  void materials;
  // This also pins scene hierarchy, extension payloads, images and all binary data.
  return sha256(canonical({document:unchanged,binary:await sha256(tail)}));
}
const toLinear=(value:number)=>value<=0.04045?value/12.92:Math.pow((value+0.055)/1.055,2.4);
const toSrgb=(value:number)=>value<=0.0031308?value*12.92:1.055*Math.pow(value,1/2.4)-0.055;
function displayColor(factor:number[]) {
  return '#'+factor.slice(0,3).map(value=>Math.round(Math.min(1,Math.max(0,toSrgb(value)))*255).toString(16).padStart(2,'0')).join('');
}

export async function inspectGlbMaterials(bytes:Uint8Array):Promise<Omit<MaterialInspection,'id'|'name'>> {
  const {json,tail}=readContainer(bytes),warnings=await validateMaterialSource(bytes,json);
  const primitives=(json.meshes??[]).flatMap(mesh=>mesh.primitives);
  const slots=(json.materials??[]).map((material,index)=>{
    const pbr=material.pbrMetallicRoughness??{};
    const factor=(pbr.baseColorFactor??[1,1,1,1]) as [number,number,number,number];
    return {index,name:material.name?.slice(0,120)||`材质 ${index+1}`,baseColor:displayColor(factor),baseColorFactor:factor,
      metallic:pbr.metallicFactor??1,roughness:pbr.roughnessFactor??1,
      hasBaseColorTexture:pbr.baseColorTexture!==undefined,hasMetallicRoughnessTexture:pbr.metallicRoughnessTexture!==undefined,
      primitiveCount:primitives.filter(primitive=>primitive.material===index).length};
  });
  return {sha256:await sha256(bytes),slots,validation:{hasUV:primitives.length>0&&primitives.every(primitive=>primitive.attributes.TEXCOORD_0!==undefined),geometryUVSignature:await geometryUVSignature(json,tail),validationWarnings:warnings}};
}

export async function customizeGlbMaterials(bytes:Uint8Array,input:MaterialChange&{materialIndices:number[]}) {
  const {materialIndices,...requested}=input;
  const {changes}=patchSchema.parse({materialIndices,changes:requested});
  const inspection=await inspectGlbMaterials(bytes),source=readContainer(bytes),json=structuredClone(source.json);
  for(const index of materialIndices) {
    const slot=inspection.slots.find(slot=>slot.index===index);
    if(!slot || !slot.primitiveCount)throw new ApiError('MATERIAL_SLOT_NOT_FOUND',422,{index});
    const material=json.materials![index];
    if(material.extensions?.KHR_materials_pbrSpecularGlossiness || material.extensions?.KHR_materials_unlit && (changes.metallic!==undefined||changes.roughness!==undefined))throw new ApiError('MATERIAL_PROPERTY_UNSUPPORTED',422,{index});
    const pbr=material.pbrMetallicRoughness??{};
    if(changes.baseColor!==undefined || changes.metallic!==undefined || changes.roughness!==undefined)material.pbrMetallicRoughness=pbr;
    if(changes.baseColor!==undefined) {
      const rgb=[1,3,5].map(start=>toLinear(parseInt(changes.baseColor!.slice(start,start+2),16)/255));
      pbr.baseColorFactor=[rgb[0],rgb[1],rgb[2],pbr.baseColorFactor?.[3]??1];
    }
    if(changes.metallic!==undefined)pbr.metallicFactor=changes.metallic;
    if(changes.roughness!==undefined)pbr.roughnessFactor=changes.roughness;
    if(changes.removeBaseColorTexture)delete pbr.baseColorTexture;
  }
  if(canonical(json)===canonical(source.json))throw new ApiError('MATERIAL_NO_CHANGE',422);
  const raw=new TextEncoder().encode(JSON.stringify(json)),jsonLength=Math.ceil(raw.length/4)*4;
  const result=new Uint8Array(20+jsonLength+source.tail.length);
  if(result.length>MAX_GLB_BYTES)throw new ApiError('FILE_TOO_LARGE',413);
  result.set(bytes.subarray(0,20));
  const header=new DataView(result.buffer);header.setUint32(8,result.length,true);header.setUint32(12,jsonLength,true);
  result.fill(32,20,20+jsonLength);result.set(raw,20);result.set(source.tail,20+jsonLength);
  const after=await inspectGlbMaterials(result);
  if(after.validation.geometryUVSignature!==inspection.validation.geometryUVSignature)throw new ApiError('MATERIAL_GEOMETRY_CHANGED',422);
  return {bytes:result,changes,validation:{geometryUVPreserved:true as const,geometryUVSignature:after.validation.geometryUVSignature}};
}

interface MaterialAsset {
  id:string; name:string; format:string; sha256:string; storage_path:string;
  source:string; source_id:string|null; source_url:string|null; license:unknown; metadata:Record<string,unknown>;
}
async function authorizedModel(backend:Backend,actor:string,id:string):Promise<MaterialAsset> {
  const asset:MaterialAsset=await backend.scene(actor,'assets.get',{assetId:id});
  if(asset.format!=='glb')throw new ApiError('ASSET_NOT_GLB',422);
  return asset;
}
async function sourceBytes(backend:Backend,source:MaterialAsset) {
  if(!backend.readSourceBytes)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
  const bytes=await backend.readSourceBytes(source.storage_path);
  if(await sha256(bytes)!==source.sha256)throw new ApiError('ASSET_CONTENT_MISMATCH',422);
  return bytes;
}
export async function readAssetMaterials(backend:Backend,actor:string,id:string):Promise<MaterialInspection> {
  const source=await authorizedModel(backend,actor,id);
  const derived=derivedVariantMetadataSchema.safeParse(source.metadata);
  return {id:source.id,name:source.name,...(derived.success?{parentAssetId:derived.data.parentAssetId}:{}),...await inspectGlbMaterials(await sourceBytes(backend,source))};
}
export async function createMaterialVariant(backend:Backend,actor:string,assetId:string,body:unknown) {
  const input=assetCustomizationRequestSchema.parse(body),source=await authorizedModel(backend,actor,assetId);
  if(source.sha256!==input.sourceSha256)throw new ApiError('ASSET_VERSION_CONFLICT',409);
  const {requestId,sourceSha256,materialIndices,...changes}=input;
  const parameters={sourceAssetId:assetId,sourceSha256,materialIndices:[...materialIndices].sort((a,b)=>a-b),...changes};
  const fingerprint=await sha256(canonical(parameters));
  const reservation=await backend.scene(actor,'materials.reserve',{requestId,fingerprint,sourceAssetId:assetId,sourceSha256});
  if(reservation.asset)return {asset:reservation.asset,reused:true};
  const modified=await customizeGlbMaterials(await sourceBytes(backend,source),{materialIndices:parameters.materialIndices,...changes});
  const asset=await assetRecord(actor,modified.bytes,{
    name:`${source.name} · 材质变体`.slice(0,120),source:source.source,sourceId:source.source_id,sourceUrl:source.source_url,license:source.license,
    metadata:{...source.metadata,parentAssetId:assetId,sourceSha256,changeMode:'material',materialVariant:{
      materialIndices:parameters.materialIndices,changes:modified.changes,validation:modified.validation,procurementStatus:'needs_confirmation',
    }},
  },reservation.assetId);
  await backend.upload(asset.storagePath,modified.bytes,'model/gltf-binary');
  return backend.scene(actor,'materials.complete',{requestId,fingerprint,asset});
}

export async function prepareMaterialVariant(backend:Backend,actor:string,projectId:string,body:unknown) {
  const input=materialVariantProposalRequestSchema.parse(body);
  await backend.scene(actor,'lease.check',{...input,projectId});
  const selected=input.objectIds.map(id=>input.scene.objects.find(object=>object.id===id));
  if(selected.some(object=>!object || object.assetId!==input.sourceAssetId))throw new ApiError('MATERIAL_VARIANT_SELECTION_INVALID',422);
  if(selected.some(object=>object!.locked))throw new ApiError('OBJECT_LOCKED',422);
  const source=await authorizedModel(backend,actor,input.sourceAssetId),target=await authorizedModel(backend,actor,input.variantAssetId);
  const targetVariant=derivedVariantMetadataSchema.safeParse(target.metadata),sourceVariant=derivedVariantMetadataSchema.safeParse(source.metadata);
  const forward=targetVariant.success && targetVariant.data.parentAssetId===source.id && targetVariant.data.sourceSha256===source.sha256;
  const restore=sourceVariant.success && sourceVariant.data.parentAssetId===target.id && sourceVariant.data.sourceSha256===target.sha256;
  if(!forward && !restore)throw new ApiError('MATERIAL_VARIANT_MISMATCH',422);
  const candidate=sceneSchema.parse({...input.scene,objects:input.scene.objects.map(object=>input.objectIds.includes(object.id)?{...object,assetId:target.id}:object)});
  if(dimensionConflicts(candidate).length)throw new ApiError('DIMENSION_CONFLICT',422);
  if(!canApplyStructuralChange(input.scene,candidate))throw new ApiError('STRUCTURAL_COLLISION',422);
  return backend.scene(actor,'materials.propose',{
    ...input,projectId,fingerprint:await sha256(canonical({...input,projectId})),baseHash:await sceneHash(input.scene),candidate,
    explanation:restore?`预览恢复 ${selected.length} 件选定物件的原版材质，其余物件保持不变。`:`预览更新 ${selected.length} 件选定物件的材质，其余物件保持不变；实物材质规格仍需确认。`,
    warnings:[...sceneWarnings(candidate),...structuralWarnings(candidate)],
  });
}
