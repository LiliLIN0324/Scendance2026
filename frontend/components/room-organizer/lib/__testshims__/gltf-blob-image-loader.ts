// jsdom 下 GLTFLoader 回读导出 GLB 的挂死修复（仅测试环境加载）：
// GLTFExporter 导出的内嵌纹理走 bufferView → GLTFLoader 用 URL.createObjectURL(blob) 喂
// TextureLoader/ImageLoader；jsdom 的 ResourceLoader 不取 blob: URL，Image 永不触发
// onload/onerror，parseAsync 永久挂起。这里把 createObjectURL 的 Blob 登记下来，
// 并给 ImageLoader 补一条 node-canvas 真解码路径（产出的 Canvas.Image 可被 textureSignature
// 的 drawImage/getImageData 正常采样）。chair.glb 等用 data: URI 的输入不受影响。
import { ImageLoader } from 'three';
import { Image as CanvasImage } from 'canvas';

const blobRegistry = new Map<string, Blob>();
let blobSeq = 0;

// id 带 blob: 前缀，让 GLTFLoader 里的 LoaderUtils.resolveURL 原样放行。
URL.createObjectURL = ((blob: Blob) => {
  const id = `blob:jsdom-shim/${++blobSeq}`;
  blobRegistry.set(id, blob);
  return id;
}) as typeof URL.createObjectURL;
URL.revokeObjectURL = ((id: string) => {
  blobRegistry.delete(id);
}) as typeof URL.revokeObjectURL;

type ImageLoadArgs = [url: string, onLoad?: (image: unknown) => void, onProgress?: unknown, onError?: (error: unknown) => void];
type PatchedLoad = (...args: ImageLoadArgs) => HTMLImageElement;
const originalLoad = ImageLoader.prototype.load as unknown as PatchedLoad;
(ImageLoader.prototype.load as unknown as PatchedLoad) = function (this: ImageLoader, ...args: ImageLoadArgs) {
  const [url, onLoad, , onError] = args;
  const blob = typeof url === 'string' ? blobRegistry.get(url) : undefined;
  if (!blob) return originalLoad.apply(this, args);
  const image = new CanvasImage();
  blob.arrayBuffer().then((buffer) => {
    image.onload = () => { onLoad?.(image); };
    image.onerror = () => { onError?.(new Error('jsdom shim: 内嵌纹理解码失败。')); };
    image.src = Buffer.from(buffer);
  }).catch((error: unknown) => { onError?.(error); });
  return image as unknown as HTMLImageElement;
};
