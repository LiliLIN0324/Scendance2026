import { describe,it,expect } from 'vitest';
import { MAX_GLB_BYTES,MAX_PROVIDER_GLB_BYTES,packGltf,validateModel } from '../supabase/functions/_shared/models.ts';
import { allowedDownload,download,readBounded, type Fetcher } from '../supabase/functions/_shared/http.ts';
import { inflateGlb,tetrahedron } from './model-fixture.ts';

describe('model archive validation',()=>{
  it('validates a real GLB and computes normalization without rewriting textures',async()=>{
    const {json,resources}=tetrahedron(),bytes=packGltf(json,resources),report=await validateModel(bytes);
    expect(report.triangles).toBe(4);expect(report.sourceSize).toEqual({width:1,height:1,depth:1});expect(report.groundOffset).toEqual([-0.5,-0,-0.5]);
  });
  it('rejects broken files and external resources',async()=>{
    await expect(validateModel(new Uint8Array(50))).rejects.toThrow('INVALID_GLB');
    const {json,resources}=tetrahedron();json.images=[{uri:'https://evil.example/texture.png'}];
    expect(()=>packGltf(json,resources)).toThrow('MISSING_MODEL_RESOURCE');
  });
  it('rejects unsupported required compression instead of declaring success',async()=>{
    const {json,resources}=tetrahedron();json.extensionsRequired=['KHR_draco_mesh_compression'];
    await expect(validateModel(packGltf(json,resources))).rejects.toThrow('UNSUPPORTED_MODEL_FEATURE');
  });
  it('caps streamed bytes, even without Content-Length',async()=>{
    await expect(readBounded(new Response(new Uint8Array(11)),10)).rejects.toThrow('FILE_TOO_LARGE');
  });
  it.each(['http://a.myqcloud.com/x','https://myqcloud.com.evil.test/x','https://127.0.0.1/x','https://user:pass@a.myqcloud.com/x','https://a.myqcloud.com:8443/x'])('rejects untrusted download %s',url=>{
    expect(()=>allowedDownload(url,['.myqcloud.com'])).toThrow('UNTRUSTED_ASSET_URL');
  });
  it('accepts a provider product that is slightly above the 10 MiB import ceiling',async()=>{
    // 2026-11-17 生产 C1 实跑：Lux3D G1 的 textured.glb 实测 10.06 MiB，比通用 10 MiB 上限多 59 KB，
    // 于是供应商生成好的模型被我们自己抛的 FILE_TOO_LARGE 挡在门外——额度花了、模型没入库。
    // 供应商产物这一档（32 MB）必须放行，本机导入那一档（10 MB）必须仍然拦住。
    const {json,resources}=tetrahedron();
    const bytes=inflateGlb(packGltf(json,resources),10*1024*1024+59*1024);
    expect(bytes.byteLength).toBeGreaterThan(MAX_GLB_BYTES);
    await expect(validateModel(bytes)).rejects.toThrow('INVALID_GLB_SIZE');
    await expect(validateModel(bytes,MAX_PROVIDER_GLB_BYTES)).resolves.toMatchObject({triangles:4});
  });
  it('still refuses a provider product above the provider ceiling',async()=>{
    const {json,resources}=tetrahedron();
    const bytes=inflateGlb(packGltf(json,resources),MAX_PROVIDER_GLB_BYTES+1024*1024);
    await expect(validateModel(bytes,MAX_PROVIDER_GLB_BYTES)).rejects.toThrow('INVALID_GLB_SIZE');
  });
  it('downloads a provider product larger than the import ceiling',async()=>{
    // 生产实跑那单的产物就是 10,546,592 字节：供应商那侧给得出来，是我们自己的闸门太小。
    const body=new Uint8Array(10*1024*1024+59*1024);
    const fetcher:Fetcher=async()=>new Response(body);
    const url='https://qhsmodel.kujiale.com/lux3dPbrEmbedResult/f53aa48b4393405fa412a00b1a268b6f/textured.glb';
    await expect(download(url,['.kujiale.com'],MAX_GLB_BYTES,fetcher)).rejects.toThrow('FILE_TOO_LARGE');
    await expect(download(url,['.kujiale.com'],MAX_PROVIDER_GLB_BYTES,fetcher)).resolves.toHaveLength(body.length);
  });
});
