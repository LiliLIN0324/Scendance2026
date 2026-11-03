import { useCallback, useEffect, useRef, useState } from 'react';
import { createSplatPreview, paintSplatLayers } from '../three/splat-preview';
import type { SplatDisplayMode, SplatMeters, SplatPaint, SplatPosition, SplatPreview, SplatSource, SplatTransformMode, SplatUpAxis, SplatWalkBounds } from '../three/splat-preview';
export type { SplatTransformMode };
import * as ThreeNS from 'three';

export type SplatPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SplatPreviewState = Readonly<{ status: SplatPreviewStatus; assetId: string; name: string; progress?: number; splats?: number; error?: string; meters?: SplatMeters; walkBounds?: SplatWalkBounds }>;

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
  controlsRef: React.MutableRefObject<{ target: ThreeNS.Vector3; enabled: boolean; update(): void } | null>;
  invalidate(): void;
  requestShadowUpdate(): void;
  /** 场地最长水平边（米）。 */
  sizeMeters: number;
  /** Upper edge of the active building storey; scanned roof points above it are hidden. */
  roofCutoffY: number;
  position: SplatPosition;
  otherScenes?: readonly Readonly<{ id: string; source: SplatSource; position: SplatPosition; floorIndex: number; roofCutoffY: number }>[];
  activeFloorIndex?: number;
  primaryVisible?: boolean;
  transformMode: SplatTransformMode;
  onPositionChange(position: SplatPosition): void;
  upAxis?: SplatUpAxis;
  /**
   * When the current value is true, leave the camera where first-person walk
   * put it. Framing or restoring the orbit pose calls `controls.update()`,
   * which re-aims the camera and yanks the walker out of eye level.
   */
  preserveCameraRef?: React.RefObject<boolean>;
}): Readonly<{
  state: SplatPreviewState;
  renderFrame: SplatPaint;
  start(source: SplatSource): Promise<void>;
  stop(): void;
  setPosition(position: SplatPosition): void;
  displayMode: SplatDisplayMode;
  setDisplayMode(mode: SplatDisplayMode): void;
  setTransformMode(mode: SplatTransformMode): void;
  pickScene(ray: ThreeNS.Ray): string | null;
}> {
  const { isReady, rendererRef, cameraRef, controlsRef, invalidate, requestShadowUpdate } = deps;
  const controllerRef = useRef<SplatPreview | null>(null);
  const otherControllersRef = useRef(new Map<string, SplatPreview>());
  const [state, setState] = useState<SplatPreviewState>(IDLE);
  const [displayMode, setDisplayModeState] = useState<SplatDisplayMode>('gaussian');
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;
  // 换场景、退出、卸载都会推进它：迟到的回调只配丢掉，不能把界面带回旧场景。
  const attempt = useRef(0);
  const sizeRef = useRef(deps.sizeMeters);
  sizeRef.current = deps.sizeMeters;
  const roofCutoffRef = useRef(deps.roofCutoffY);
  roofCutoffRef.current = deps.roofCutoffY;
  const positionRef = useRef(deps.position);
  positionRef.current = deps.position;
  const activeFloorRef = useRef(deps.activeFloorIndex ?? 0);
  activeFloorRef.current = deps.activeFloorIndex ?? 0;
  const primaryVisibleRef = useRef(deps.primaryVisible ?? true);
  primaryVisibleRef.current = deps.primaryVisible ?? true;
  const otherScenesRef = useRef(deps.otherScenes ?? []);
  otherScenesRef.current = deps.otherScenes ?? [];
  const transformModeRef = useRef(deps.transformMode);
  transformModeRef.current = deps.transformMode;
  const onPositionChangeRef = useRef(deps.onPositionChange);
  onPositionChangeRef.current = deps.onPositionChange;
  const upAxisRef = useRef(deps.upAxis);
  upAxisRef.current = deps.upAxis;
  const pending = useRef<SplatSource | null>(null);
  const preserveCameraRef = useRef(deps.preserveCameraRef);
  preserveCameraRef.current = deps.preserveCameraRef;
  const preserveCamera = () => preserveCameraRef.current?.current === true;
  const frameLoadedScenes = useCallback(() => {
    const primary = controllerRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!primary || !camera || !controls || preserveCamera()) return;
    const bounds = new ThreeNS.Box3();
    let found = false;
    if (primaryVisibleRef.current && primary.worldBounds) { bounds.union(primary.worldBounds); found = true; }
    for (const [id, controller] of otherControllersRef.current) {
      const placement = otherScenesRef.current.find(scene => scene.id === id);
      const box = controller.worldBounds;
      if (placement && placement.floorIndex === activeFloorRef.current && box) { bounds.union(box); found = true; }
    }
    if (!found || bounds.isEmpty()) return;
    primary.frameBounds(bounds, camera, controls);
    invalidate();
  }, [cameraRef, controlsRef, invalidate]);

  const start = useCallback(async (source: SplatSource) => {
    const controller = controllerRef.current;
    if (!controller) {
      // 刚刷新时 WebGL 还没起来：先记下她点的那条，等控制器一出现就补上，不用她再点一次。
      pending.current = source;
      setState({ status: 'loading', assetId: source.assetId, name: source.name, progress: 0 });
      return;
    }
    pending.current = null;
    const hasActiveScene = !!controller.shownId;
    const current = ++attempt.current;
    // 进度回调只在还是这一条请求时才写状态，否则会把已经切走的场景又刷回来。
    setState({ status: 'loading', assetId: source.assetId, name: source.name, progress: 0 });
    try {
      const result = await controller.start(source, {
        sizeMeters: sizeRef.current,
        roofCutoffY: roofCutoffRef.current,
        position: positionRef.current,
        ...(upAxisRef.current ? { upAxis: upAxisRef.current } : {}),
        onProgress: ratio => {
          if (attempt.current !== current) return;
          setState(state => state.status === 'loading' ? { ...state, ...(ratio === undefined ? {} : { progress: ratio }) } : state);
        },
      });
      if (attempt.current !== current) return;
      // 站进场内再看：从场外看只会是一块悬空的地板。
      // 第一人称已经抓住相机时不能再 frame——OrbitControls.update 会把机位拽回环绕目标。
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!hasActiveScene && camera && controls && !preserveCamera()) frameLoadedScenes();
      // 壳体在预览里不投影，阴影图是静态的，进出都要补一次。
      requestShadowUpdate();
      setState({ status: 'ready', assetId: source.assetId, name: source.name, splats: result.splats,
        ...(result.meters ? { meters: result.meters } : {}),
        ...(result.walkBounds ? { walkBounds: result.walkBounds } : {}) });
    } catch (failure) {
      if (attempt.current !== current) return;
      setState({
        status: 'error', assetId: source.assetId, name: source.name,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }, [cameraRef, controlsRef, requestShadowUpdate, frameLoadedScenes]);

  useEffect(() => {
    controllerRef.current?.setRoofCutoff(deps.roofCutoffY);
  }, [deps.roofCutoffY, isReady]);
  useEffect(() => {
    controllerRef.current?.setPosition(deps.position);
  }, [deps.position.x, deps.position.y, deps.position.z, isReady]);
  useEffect(() => {
    void controllerRef.current?.setTransformMode(deps.transformMode);
  }, [deps.transformMode, isReady]);
  useEffect(() => {
    controllerRef.current?.setVisible(deps.primaryVisible ?? true);
  }, [deps.primaryVisible, isReady]);

  const otherScenesKey = (deps.otherScenes ?? []).map(scene => `${scene.id}:${scene.source.assetId}:${scene.floorIndex}:${scene.position.x}:${scene.position.y}:${scene.position.z}:${scene.roofCutoffY}`).join('|');
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!isReady || !renderer || !camera || !controls) return;
    const requested = new Map((deps.otherScenes ?? [])
      .filter(scene => scene.floorIndex === (deps.activeFloorIndex ?? 0))
      .map(scene => [scene.id, scene]));
    for (const [id, controller] of otherControllersRef.current) {
      if (requested.has(id)) continue;
      controller.dispose();
      otherControllersRef.current.delete(id);
    }
    for (const [id, placement] of requested) {
      let controller = otherControllersRef.current.get(id);
      if (!controller) {
        controller = createSplatPreview({ renderer, camera, orbitControls: controls, invalidate });
        otherControllersRef.current.set(id, controller);
        const ownedController = controller;
        void ownedController.start(placement.source, {
          sizeMeters: sizeRef.current,
          roofCutoffY: placement.roofCutoffY,
          position: placement.position,
          ...(upAxisRef.current ? { upAxis: upAxisRef.current } : {}),
        }).then(() => {
          if (otherControllersRef.current.get(id) !== ownedController) return;
          const latestPlacement = otherScenesRef.current.find(scene => scene.id === id);
          if (!latestPlacement) return;
          ownedController.setPosition(latestPlacement.position);
          ownedController.setRoofCutoff(latestPlacement.roofCutoffY);
          ownedController.setDisplayMode(displayModeRef.current);
          ownedController.setVisible(latestPlacement.floorIndex === activeFloorRef.current);
          invalidate();
        }).catch(() => {
          if (otherControllersRef.current.get(id) === ownedController) {
            ownedController.dispose();
            otherControllersRef.current.delete(id);
          }
        });
      } else {
        controller.setPosition(placement.position);
        controller.setRoofCutoff(placement.roofCutoffY);
        controller.setVisible(placement.floorIndex === activeFloorRef.current);
        controller.setDisplayMode(displayModeRef.current);
      }
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, otherScenesKey, rendererRef, cameraRef, controlsRef, invalidate]);
  useEffect(() => {
    for (const [id, controller] of otherControllersRef.current) {
      const placement = (deps.otherScenes ?? []).find(scene => scene.id === id);
      controller.setVisible(!!placement && placement.floorIndex === (deps.activeFloorIndex ?? 0));
      controller.setDisplayMode(displayModeRef.current);
    }
    invalidate();
  }, [deps.activeFloorIndex, otherScenesKey, displayMode, invalidate]);
  // 渲染器就绪才建控制器；建好时如果她还挂着一条没起动的场景，立刻补上。
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!isReady || !renderer) return undefined;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return undefined;
    const controller = createSplatPreview({ renderer, camera, orbitControls: controls, invalidate,
      onPositionChange: position => onPositionChangeRef.current(position) });
    controllerRef.current = controller;
    if (transformModeRef.current !== 'off') void controller.setTransformMode(transformModeRef.current);
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
      for (const extra of otherControllersRef.current.values()) extra.dispose();
      otherControllersRef.current.clear();
    };
  }, [isReady, rendererRef, invalidate, start]);

  const stop = useCallback(() => {
    attempt.current += 1;
    pending.current = null;
    setDisplayModeState('gaussian');
    const controller = controllerRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    // 机位是预览借走的，退出要先还给她，再停显示。走动中相机归漫游，不能还回环绕机位。
    if (preserveCamera()) controller?.discardSavedView();
    else if (controller && camera && controls) controller.restoreView(camera, controls);
    controller?.stop();
    requestShadowUpdate();
    setState(IDLE);
  }, [cameraRef, controlsRef, requestShadowUpdate]);

  const renderFrame = useCallback<SplatPaint>((renderer, scene, camera) => {
    const controller = controllerRef.current;
    const backs = [controller?.renderScene, ...[...otherControllersRef.current.values()].map(extra => extra.renderScene)]
      .filter((back): back is NonNullable<typeof back> => back !== null && back !== undefined);
    if (backs.length) paintSplatLayers({ renderer, backs, scene, camera });
    else renderer.render(scene, camera);
  }, []);

  const setPosition = useCallback((position: SplatPosition) => {
    positionRef.current = position;
    controllerRef.current?.setPosition(position);
  }, []);
  const setDisplayMode = useCallback((mode: SplatDisplayMode) => {
    displayModeRef.current = mode;
    setDisplayModeState(mode);
    controllerRef.current?.setDisplayMode(mode);
    for (const extra of otherControllersRef.current.values()) extra.setDisplayMode(mode);
    invalidate();
  }, [invalidate]);
  const setTransformMode = useCallback((mode: SplatTransformMode) => {
    transformModeRef.current = mode;
    void controllerRef.current?.setTransformMode(mode);
  }, []);

  const pickScene = useCallback((ray: ThreeNS.Ray): string | null => {
    let picked: string | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    const hitDistance = (controller: SplatPreview): number | null => {
      if (!controller.renderScene) return null;
      if (displayModeRef.current === 'footprint') return controller.pickFootprint(ray);
      const bounds = controller.worldBounds;
      const hit = bounds ? ray.intersectBox(bounds, new ThreeNS.Vector3()) : null;
      return hit?.distanceTo(ray.origin) ?? null;
    };
    const primary = controllerRef.current;
    if (primaryVisibleRef.current && primary?.shownId) {
      const distance = hitDistance(primary);
      if (distance !== null) { nearest = distance; picked = primary.shownId; }
    }
    for (const [id, controller] of otherControllersRef.current) {
      const placement = otherScenesRef.current.find(scene => scene.id === id);
      if (!placement || placement.floorIndex !== activeFloorRef.current) continue;
      const distance = hitDistance(controller);
      if (distance === null) continue;
      if (distance < nearest) { nearest = distance; picked = id; }
    }
    return picked;
  }, []);

  return { state, renderFrame, start, stop, setPosition, displayMode, setDisplayMode, setTransformMode, pickScene };
}
