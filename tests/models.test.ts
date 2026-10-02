import { describe,it,expect } from 'vitest';
import { packGltf,validateModel } from '../supabase/functions/_shared/models.ts';
import { allowedDownload,readBounded } from '../supabase/functions/_shared/http.ts';
import { tetrahedron } from './model-fixture.ts';

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
});
