import { WebIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { validateBytes } from 'gltf-validator';
import { MAX_GLB_BYTES } from '../supabase/functions/_shared/models.ts';

// Catalogue-only import validation. Generated/private uploads retain their stricter
// existing validator. The editor displays each catalogue GLB in its initial pose.
export async function validateLibraryModel(bytes: Uint8Array) {
  if(bytes.length<28 || bytes.length>MAX_GLB_BYTES)throw new Error('INVALID_GLB_SIZE');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==bytes.length
    || view.getUint32(16,true)!==0x4e4f534a || 20+view.getUint32(12,true)>bytes.length)throw new Error('INVALID_GLB');
  const json=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+view.getUint32(12,true))));
  if(json.buffers?.some((b:{uri?:string})=>b.uri) || json.images?.some((i:{uri?:string})=>i.uri))throw new Error('EXTERNAL_MODEL_RESOURCES');
  if(json.extensionsRequired?.some((e:string)=>!['KHR_mesh_quantization','EXT_texture_webp'].includes(e)) || json.skins?.length)throw new Error('UNSUPPORTED_MODEL_FEATURE');
  if((json.nodes?.length??0)>500 || (json.materials?.length??0)>64 || (json.images?.length??0)>32)throw new Error('MODEL_TOO_COMPLEX');
  const report=await validateBytes(bytes,{maxIssues:20});
  if(report.issues.numErrors)throw new Error('GLTF_VALIDATION_FAILED');
  const doc=await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
  const root=doc.getRoot();
  if(root.listScenes().length!==1)throw new Error('MODEL_REQUIRES_ONE_SCENE');
  let triangles=0,primitives=0;
  root.listScenes()[0].traverse(node=>{
    for(const p of node.getMesh()?.listPrimitives()??[]){
      if(p.getMode()!==4 || !p.getAttribute('POSITION'))throw new Error('MODEL_REQUIRES_TRIANGLES');
      triangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION')!.getCount())/3;primitives++;
    }
  });
  // The two complete starter scenes include repeated mesh instances (up to
  // 140,330 triangles / 315 draws). This allowance is only for the pinned library.
  if(triangles<1 || triangles>150_000 || primitives>350)throw new Error('MODEL_TOO_COMPLEX');
  for(const texture of root.listTextures()){
    const size=texture.getSize();
    if(!size || size.some(n=>n<=0||n>2048) || !['image/png','image/jpeg','image/webp'].includes(texture.getMimeType()))throw new Error('UNSUPPORTED_TEXTURE');
  }
  const bounds=getBounds(root.listScenes()[0]);
  const size=bounds.max.map((n,i)=>n-bounds.min[i]);
  if(size.some(n=>!Number.isFinite(n)||n<=0))throw new Error('INVALID_MODEL_BOUNDS');
  return {triangles,primitives,textures:root.listTextures().length,bounds,
    sourceSize:{width:size[0],height:size[1],depth:size[2]},animations:root.listAnimations().length,
    groundOffset:[-(bounds.min[0]+bounds.max[0])/2,-bounds.min[1],-(bounds.min[2]+bounds.max[2])/2],validationWarnings:report.issues.numWarnings};
}
