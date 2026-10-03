import { WebIO, type Accessor, type Node } from '@gltf-transform/core';
import { ApiError } from './domain.ts';
import { validateModel } from './models.ts';

const EPSILON=1e-5;
export async function requireTextureSource(bytes:Uint8Array) {
  await validateModel(bytes);
  const document=await new WebIO().readBinary(bytes);
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
    const uv=primitive.getAttribute('TEXCOORD_0'),positions=primitive.getAttribute('POSITION');
    if(primitive.listTargets().length)throw new ApiError('UNSUPPORTED_TEXTURE_SOURCE',422);
    if(!uv||uv.getCount()!==positions?.getCount()||!uv.getArray()?.every(Number.isFinite))throw new ApiError('SOURCE_UV_REQUIRED',422);
  }
  return document;
}
export async function compareTextureGeometry(source:Uint8Array,candidate:Uint8Array) {
  const original=await requireTextureSource(source),result=await requireTextureSource(candidate);
  let geometryPreserved=true,uvPreserved=true;
  const equal=(a:ArrayLike<number>|null,b:ArrayLike<number>|null,tolerance:number)=>Boolean(a&&b&&a.length===b.length&&Array.from(a).every((n,i)=>Number.isFinite(n)&&Number.isFinite(b[i])&&Math.abs(n-b[i])<=tolerance));
  const accessorEqual=(a:Accessor|null,b:Accessor|null,tolerance:number)=>!a&&!b||Boolean(a&&b&&a.getType()===b.getType()&&a.getCount()===b.getCount()&&equal(a.getArray(),b.getArray(),tolerance));
  const worldPositions=(accessor:Accessor|null,node:Node)=>{
    if(!accessor)return null;
    const matrix=node.getWorldMatrix(),values:number[]=[],point:number[]=[];
    for(let i=0;i<accessor.getCount();i++){accessor.getElement(i,point);const [x,y,z]=point;values.push(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]);}
    return values;
  };
  const compare=(a:Node,b:Node)=>{
    if(a.getName()!==b.getName()||!equal(a.getMatrix(),b.getMatrix(),0)||a.listChildren().length!==b.listChildren().length)geometryPreserved=false;
    const ap=a.getMesh()?.listPrimitives()??[],bp=b.getMesh()?.listPrimitives()??[];
    if(ap.length!==bp.length)geometryPreserved=false;
    for(let i=0;i<ap.length;i++){
      if(!bp[i]){geometryPreserved=false;uvPreserved=false;continue;}
      if(ap[i].getMode()!==bp[i].getMode()||!accessorEqual(ap[i].getIndices(),bp[i].getIndices(),0)||!equal(worldPositions(ap[i].getAttribute('POSITION'),a),worldPositions(bp[i].getAttribute('POSITION'),b),EPSILON)||ap[i].listTargets().length!==bp[i].listTargets().length)geometryPreserved=false;
      const auv=ap[i].listSemantics().filter(s=>s.startsWith('TEXCOORD_')).sort(),buv=bp[i].listSemantics().filter(s=>s.startsWith('TEXCOORD_')).sort();
      if(JSON.stringify(auv)!==JSON.stringify(buv)||auv.some(s=>!accessorEqual(ap[i].getAttribute(s),bp[i].getAttribute(s),EPSILON)))uvPreserved=false;
    }
    a.listChildren().forEach((child,i)=>{const other=b.listChildren()[i];if(other)compare(child,other);});
  };
  const a=original.getRoot().listScenes()[0].listChildren(),b=result.getRoot().listScenes()[0].listChildren();
  if(a.length!==b.length)geometryPreserved=false;
  a.forEach((node,i)=>{if(b[i])compare(node,b[i]);});
  return {geometryPreserved,uvPreserved,tolerance:EPSILON,comparison:'ordered-accessors-and-nodes' as const};
}
