import * as THREE from 'three';
import { describe,expect,it } from 'vitest';
import { verifyDeliveryReload } from './scene-delivery';

function object() {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,1,1,0],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));
  geometry.setIndex([0,1,2,1,3,2]);
  const texture=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:texture}));
  mesh.userData.deliveryObjectId='fixture-object';return mesh;
}
describe('export reload integrity covers actual content',()=>{
  it('rejects replacement texture pixels even when dimensions and sampler remain identical',()=>{
    const source=object(),changed=source.clone();changed.material=source.material.clone();
    changed.material.map=new THREE.DataTexture(new Uint8Array([0,0,255,255]),1,1);
    expect(()=>verifyDeliveryReload(source,changed)).toThrow('复检失败');
  });
  it('accepts cyclic triangle rotations but rejects reversed winding',()=>{
    const source=object(),changed=source.clone();changed.geometry=source.geometry.clone();
    changed.geometry.setIndex([1,2,0,3,2,1]);expect(verifyDeliveryReload(source,changed)).toBe(1);
    changed.geometry.setIndex([0,2,1,1,3,2]);expect(()=>verifyDeliveryReload(source,changed)).toThrow('复检失败');
  });
  it('compares the same pixel orientation across a valid export flipY normalization',()=>{
    const source=object(),changed=source.clone();source.material=source.material.clone();changed.material=source.material.clone();
    source.material.map=new THREE.DataTexture(new Uint8Array([255,0,0,255,0,0,255,255]),1,2);source.material.map.flipY=true;
    changed.material.map=new THREE.DataTexture(new Uint8Array([0,0,255,255,255,0,0,255]),1,2);
    expect(verifyDeliveryReload(source,changed)).toBe(1);
  });
  it('refuses a texture that cannot be read rather than reporting a successful material check',()=>{
    const source=object();source.material.map=new THREE.Texture({width:1,height:1});
    expect(()=>verifyDeliveryReload(source,source.clone())).toThrow('纹理像素无法完整读取');
  });
  it('rejects changed triangle connectivity even when sorted vertex frequencies are unchanged',()=>{
    const source=object(),changed=source.clone();changed.geometry=source.geometry.clone();
    changed.geometry.setIndex([0,1,1,2,3,2]);
    expect(()=>verifyDeliveryReload(source,changed)).toThrow('复检失败');
  });
});
