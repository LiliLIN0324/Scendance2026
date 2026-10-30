import { useCallback, useEffect, useRef, useState } from 'react';
import { createSplatPreview } from '../three/splat-preview';
import type { SplatMeters, SplatPaint, SplatPreview, SplatSource, SplatUpAxis } from '../three/splat-preview';
import type * as ThreeNS from 'three';

export type SplatPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SplatPreviewState = Readonly<{ status: SplatPreviewStatus; assetId: string; name: string; progress?: number; splats?: number; error?: string; meters?: SplatMeters }>;

const IDLE: SplatPreviewState = { status: 'idle', assetId: '', name: '' };

/**
 * 「环境预览」的 React 侧：把 3DGS 场景取回本机、按当前场地尺寸立好，
 * 再交给 splat-preview 那条独立渲染栈去画。换场地尺寸不需要重新解码，
 * 重新点开同一条场景只会重画，不会二次下载。
 */
export function useSplatPreview(deps: {
  isReady: boolean;
  rendererRef: React.MutableRefObject<ThreeNS.WebGLRenderer | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<{ target: ThreeNS.Vector3; update(): void } | null>;
  invalidate(): void;
  requestShadowUpdate(): void;
  /** 场地最长水平边（米）。 */
  sizeMeters: number;
  upAxis?: SplatUpAxis;
}): Readonly<{
  state: SplatPreviewState;
  renderFrame: SplatPaint;
  start(source: SplatSource): Promise<void>;
  stop(): void;
}> {
  const { isReady, rendererRef, cameraRef, controlsRef, invalidate, requestShadowUpdate } = deps;
  const controllerRef = useRef<SplatPreview | null>(null);
  const [state, setState] = useState<SplatPreviewState>(IDLE);
  // 换场景、退出、卸载都会推进它：迟到的回调只配丢掉，不能把界面带回旧场景。
  const attempt = useRef(0);
  const sizeRef = useRef(deps.sizeMeters);
  sizeRef.current = deps.sizeMeters;
  const upAxisRef = useRef(deps.upAxis);
  upAxisRef.current = deps.upAxis;
  const pending = useRef<SplatSource | null>(null);

  const start = useCallback(async (source: SplatSource) => {
    const controller = controllerRef.current;
    if (!controller) {
      // 刚刷新时 WebGL 还没起来：先记下她点的那条，等控制器一出现就补上，不用她再点一次。
      pending.current = source;
      setState({ status: 'loading', assetId: source.assetId, name: source.name, progress: 0 });
      return;
    }
    pending.current = null;
    const current = ++attempt.current;
    // 进度回调只在还是这一条请求时才写状态，否则会把已经切走的场景又刷回来。
    setState({ status: 'loading', assetId: source.assetId, name: source.name, progress: 0 });
    try {
      const result = await controller.start(source, {
        sizeMeters: sizeRef.current,
        ...(upAxisRef.current ? { upAxis: upAxisRef.current } : {}),
        onProgress: ratio => {
          if (attempt.current !== current) return;
          setState(state => state.status === 'loading' ? { ...state, ...(ratio === undefined ? {} : { progress: ratio }) } : state);
        },
      });
      if (attempt.current !== current) return;
      // 站进场内再看：从场外看只会是一块悬空的地板。
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (camera && controls) controller.frame(camera, controls);
      // 壳体在预览里不投影，阴影图是静态的，进出都要补一次。
      requestShadowUpdate();
      setState({ status: 'ready', assetId: source.assetId, name: source.name, splats: result.splats,
        ...(result.meters ? { meters: result.meters } : {}) });
    } catch (failure) {
      if (attempt.current !== current) return;
      setState({
        status: 'error', assetId: source.assetId, name: source.name,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }, [cameraRef, controlsRef, requestShadowUpdate]);

  // 渲染器就绪才建控制器；建好时如果她还挂着一条没起动的场景，立刻补上。
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!isReady || !renderer) return undefined;
    const controller = createSplatPreview({ renderer, invalidate });
    controllerRef.current = controller;
    attempt.current += 1;
    const queued = pending.current;
    pending.current = null;
    if (queued) void start(queued);
    // 控制器是新的，里面还没有点云：状态不能继续谎称「正在预览」。
    else setState(IDLE);
    return () => {
      attempt.current += 1;
      controllerRef.current = null;
      controller.dispose();
    };
  }, [isReady, rendererRef, invalidate, start]);

  const stop = useCallback(() => {
    attempt.current += 1;
    pending.current = null;
    const controller = controllerRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    // 机位是预览借走的，退出要先还给她，再停显示。
    if (controller && camera && controls) controller.restoreView(camera, controls);
    controller?.stop();
    requestShadowUpdate();
    setState(IDLE);
  }, [cameraRef, controlsRef, requestShadowUpdate]);

  const renderFrame = useCallback<SplatPaint>((renderer, scene, camera) => {
    const controller = controllerRef.current;
    if (controller) controller.renderFrame(renderer, scene, camera);
    else renderer.render(scene, camera);
  }, []);

  return { state, renderFrame, start, stop };
}
