/**
 * GLB 加载器单一入口（2026-11-16 #131）。
 *
 * 为什么必须只有一处：压缩资产（EXT_meshopt_compression）在 `extensionsRequired` 里声明，
 * 没挂解码器时 GLTFLoader 会直接抛错。仓库里原本有三个 `new GLTFLoader()`（资产缓存、
 * 打包内人物、交付场景），只要有一处漏挂，就会出现「同一份资产这里能读、那里读不了」，
 * 而且报错点离压缩动作很远。
 *
 * 失败归类（classify/describe）只做一件事：把底层各种异常翻成**能直接给用户看的一句话**，
 * 并让调用方知道该「待补模型」还是该「重试」。分类不改变任何加载行为。
 */

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** 每次返回新实例：GLTFLoader 内部有解析状态，跨资产共用一个实例容易串。 */
export function createGlbLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/** 失败类别：决定上层显示什么、要不要重试。 */
export type GlbFailureKind = 'too-large' | 'meshopt' | 'not-found' | 'network' | 'parse' | 'aborted';

/**
 * 归类规则按「用户能采取的动作」排序：
 * 超限改成压缩/LOD；缺解码器改代码；404 换资产；网络重试；解析失败换文件；取消重试。
 * 认不出来的一律当解析失败——在这个上下文里，未知异常几乎都来自 glTF 解析或归一化。
 */
export function classifyGlbFailure(error: unknown, aborted = false): GlbFailureKind {
  if (aborted) return 'aborted';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/超过\s*[\d.]+\s*MB/i.test(message)) return 'too-large';
  if (/meshopt|EXT_meshopt_compression/i.test(message)) return 'meshopt';
  if (/\b404\b|not\s*found/i.test(message)) return 'not-found';
  if (/failed to fetch|networkerror|err_[a-z]+|load failed|connection/i.test(message)) return 'network';
  return 'parse';
}

/**
 * 把失败翻成一句人话。`detail` 是底层原始信息，附在括号里便于排查，不替换主句。
 * 超限时主句已经包含上限值（来自 `validateGlbBuffer`），不再二次换算，避免两个数字打架。
 */
export function describeGlbFailure(kind: GlbFailureKind, detail?: string): string {
  const trailing = detail && detail.trim() ? `（${detail.trim()}）` : '';
  switch (kind) {
    case 'too-large':
      return `模型文件超过大小上限，未载入${trailing}；请改用压缩或 LOD 档位。`;
    case 'meshopt':
      return `模型使用 meshopt 压缩但解码失败${trailing}；请确认加载器已挂 MeshoptDecoder。`;
    case 'not-found':
      return `模型不存在或已下线${trailing}。`;
    case 'network':
      return `模型下载失败${trailing}；请检查网络后重试。`;
    case 'aborted':
      return '模型加载超时或请求已取消，请重试。';
    case 'parse':
    default:
      return `模型文件无法解析${trailing}。`;
  }
}
