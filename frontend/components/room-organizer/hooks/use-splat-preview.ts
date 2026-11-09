import type { LocalWriteCapability } from '@/lib/local-write-lease';
import { readSiteCalibrationStrict } from '../lib/site-calibration-capability';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createSplatPreview, paintSplatLayers } from '../three/splat-preview';
import type { SplatDisplayMode, SplatMeters, SplatPaint, SplatPosition, SplatPreview, SplatSource, SplatTransformMode, SplatUpAxis, SplatWalkBounds } from '../three/splat-preview';
export type { SplatTransformMode };
import * as ThreeNS from 'three';
import {
  calibrateScanScale,
  calibrationSummary,
  defaultSiteCalibration,
  groundFromHeight,
  groundFromThreePoints,
  landingCorrections,
  nextAnchorId,
  readSiteCalibration,
  writeSiteCalibration,
  type AnchorKind,
  type CalibrationConfidence,
  type GroundAnchor,
  type GroundPlane,
  type LandingCorrection,
  type LandableItem,
  type ScanAxis,
  type ScanExtent,
  type ScanScaleCalibration,
  type SiteCalibration,
} from '../lib/site-capture';
import { createCalibrationHud } from '../three/calibration-hud';

export type SplatPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
/** 当前场景的标定快照：比例、朝向、基准面、锚点与误差提示。 */
export type SplatCalibrationState = Readonly<{
  assetId: string;
  scale: number;
  yawDeg: number;
  /** 扫描原点相对场地原点的水平平移（米）。 */
  origin: { x: number; z: number };
  ground: GroundPlane;
  anchors: GroundAnchor[];
  reference?: { axis: ScanAxis; knownMeters: number; measuredMeters: number };
  deviationPct?: number;
  confidence?: CalibrationConfidence;
  note: string;
  summary: string;
}>;
export type SplatPreviewState = Readonly<{
  status: SplatPreviewStatus;
  assetId: string;
  name: string;
  progress?: number;
  splats?: number;
  error?: string;
  meters?: SplatMeters;
  walkBounds?: SplatWalkBounds;
  calibration?: SplatCalibrationState;
}>;

const IDLE: SplatPreviewState = { status: 'idle', assetId: '', name: '' };

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 标定记录 → 界面快照。误差提示与 confidence 都从当前比例直接算出来。 */
function calibrationViewOf(record: SiteCalibration | null): SplatCalibrationState | null {
  if (!record) return null;
  const deviationPct = roundPct((record.scale - 1) * 100);
  const abs = Math.abs(deviationPct);
  const confidence: CalibrationConfidence = abs > 40 ? 'suspect' : abs > 10 ? 'coarse' : 'ok';
  const note = record.reference
    ? `扫描${record.reference.axis.toUpperCase()} ${record.reference.measuredMeters} m ↔ 实测 ${record.reference.knownMeters} m：比例 ${record.scale}，偏差 ${deviationPct > 0 ? '+' : ''}${deviationPct}%`
    : '未标定：按上游 1:1 米制放置。';
  return {
    assetId: record.assetId,
    scale: record.scale,
    yawDeg: record.yawDeg,
    origin: { ...record.origin },
    ground: record.ground,
    anchors: record.anchors,
    ...(record.reference ? { reference: { ...record.reference } } : {}),
    deviationPct,
    confidence,
    note,
    summary: calibrationSummary(record),
  };
}

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
  /** Controlled workspace cannot write the legacy calibration map until it is integrated. */
  calibrationReadOnly?: boolean;
  calibrationCapability?: LocalWriteCapability | undefined;
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
  framePrimaryScene(): void;
  /** 用已知长标定比例：知道「场地宽 12 m」时直接给出轴和长度。 */
  calibrate(input: { axis: ScanAxis; knownMeters: number }): ScanScaleCalibration | null;
  /** 给定高度 / 法线的基准面；物件落地与锚点都跟着它。 */
  setGround(ground: GroundPlane): void;
  setYaw(yawDeg: number): void;
  /** 原点标定：把扫描原点平移到场地原点的同一处（米）。 */
  setOrigin(origin: { x: number; z: number }): void;
  addAnchor(input: { label?: string; kind?: AnchorKind; x: number; z: number }): GroundAnchor | null;
  removeAnchor(id: string): void;
  /** 一次性落地清单：只算不动，应用仍走 onApply。 */
  landingPlan(items: readonly LandableItem[], floorY?: number): LandingCorrection[];
}> {
  const { isReady, rendererRef, cameraRef, controlsRef, invalidate, requestShadowUpdate } = deps;
  const calibrationReadOnlyRef=useRef(!!deps.calibrationReadOnly);
  if(deps.calibrationReadOnly)calibrationReadOnlyRef.current=true;
  const calibrationCapabilityRef=useRef<{value:LocalWriteCapability;revoked:boolean}|null>(null);
  if(!calibrationCapabilityRef.current && deps.calibrationCapability)calibrationCapabilityRef.current={value:deps.calibrationCapability,revoked:false};
  else if(calibrationCapabilityRef.current && deps.calibrationCapability!==calibrationCapabilityRef.current.value)calibrationCapabilityRef.current.revoked=true;
  const controllerRef = useRef<SplatPreview | null>(null);
  const otherControllersRef = useRef(new Map<string, SplatPreview>());
  const [state, setState] = useState<SplatPreviewState>(IDLE);
  const [displayMode, setDisplayModeState] = useState<SplatDisplayMode>('gaussian');
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;
  // 当前扫描的标定记录：按 assetId 持久化，刷新页面后原样恢复。
  const recordRef = useRef<SiteCalibration | null>(null);
  const assetIdRef = useRef('');
  const metersRef = useRef<SplatMeters | null>(null);
  const hudRef = useRef<ReturnType<typeof createCalibrationHud> | null>(null);
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

  const framePrimaryScene = useCallback(() => {
    const primary = controllerRef.current;
    const bounds = primary?.worldBounds;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!primary || !bounds || bounds.isEmpty() || !camera || !controls) return;
    const center = bounds.getCenter(new ThreeNS.Vector3());
    const half = bounds.getSize(new ThreeNS.Vector3()).multiplyScalar(0.5);
    const direction = new ThreeNS.Vector3(1, 0.24, 1).normalize();
    const right = new ThreeNS.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new ThreeNS.Vector3().crossVectors(direction, right);
    const vertical = ThreeNS.MathUtils.degToRad(camera.fov / 2);
    const verticalTangent = Math.tan(vertical);
    const horizontalTangent = verticalTangent * Math.min(camera.aspect, 1.6);
    let distance = 2;
    const corner = new ThreeNS.Vector3();
    for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) {
      corner.set(x, y, z);
      const screenFit = Math.max(Math.abs(corner.dot(right)) / horizontalTangent, Math.abs(corner.dot(up)) / verticalTangent);
      distance = Math.max(distance, corner.dot(direction) + screenFit * 1.12);
    }
    controls.target.copy(center);
    if ('maxDistance' in controls && typeof controls.maxDistance === 'number') {
      controls.maxDistance = Math.max(controls.maxDistance, distance);
    }
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.update();
    invalidate();
  }, [cameraRef, controlsRef, invalidate]);

  const persistCalibration = useCallback((mutate: (record: SiteCalibration) => void): SplatCalibrationState | null => {
    const record = recordRef.current;
    if (!record || calibrationReadOnlyRef.current) return null;
    mutate(record);
    record.updatedAt = Date.now();
    writeSiteCalibration(record);
    const applied = controllerRef.current?.applyCalibration({
      scale: record.scale,
      yawDeg: record.yawDeg,
      origin: record.origin,
      ground: record.ground,
      anchors: record.anchors,
    });
    if (applied) metersRef.current = applied.meters;
    const view = calibrationViewOf(record);
    setState(previous => previous.status === 'ready'
      ? {
          ...previous,
          ...(metersRef.current ? { meters: metersRef.current } : {}),
          ...(applied?.walkBounds ? { walkBounds: applied.walkBounds } : {}),
          ...(view ? { calibration: view } : {}),
        }
      : previous);
    invalidate();
    return view;
  }, [invalidate]);

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
    // 标定随场景走：换回同一条扫描，比例 / 朝向 / 基准面 / 锚点原样复原。
    let stored:SiteCalibration;
    if(calibrationReadOnlyRef.current) {
      const bound=calibrationCapabilityRef.current;
      const checked=bound&&!bound.revoked?readSiteCalibrationStrict(bound.value):{status:'unknown' as const};
      if(checked.status!=='ready') { setState({status:'error',assetId:source.assetId,name:source.name,error:'本机场地标定无法核对，原资料已保留；暂不加载扫描。'});return; }
      stored=checked.snapshot.records[source.assetId] ?? defaultSiteCalibration(source.assetId);
    } else stored=readSiteCalibration(source.assetId) ?? defaultSiteCalibration(source.assetId);
    recordRef.current = stored;
    assetIdRef.current = source.assetId;
    metersRef.current = null;
    // 进度回调只在还是这一条请求时才写状态，否则会把已经切走的场景又刷回来。
    setState({ status: 'loading', assetId: source.assetId, name: source.name, progress: 0 });
    try {
      const result = await controller.start(source, {
        sizeMeters: sizeRef.current,
        roofCutoffY: roofCutoffRef.current,
        position: positionRef.current,
        ...(upAxisRef.current ? { upAxis: upAxisRef.current } : {}),
        calibration: {
          scale: stored.scale,
          yawDeg: stored.yawDeg,
          origin: stored.origin,
          ground: stored.ground,
          anchors: stored.anchors,
        },
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
      metersRef.current = result.meters;
      const calibrationView = calibrationViewOf(recordRef.current);
      setState({ status: 'ready', assetId: source.assetId, name: source.name, splats: result.splats,
        ...(result.meters ? { meters: result.meters } : {}),
        ...(result.walkBounds ? { walkBounds: result.walkBounds } : {}),
        ...(calibrationView ? { calibration: calibrationView } : {}) });
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
          calibration: (() => {
            const stored = readSiteCalibration(placement.source.assetId);
            return stored
              ? { scale: stored.scale, yawDeg: stored.yawDeg, origin: stored.origin, ground: stored.ground, anchors: stored.anchors }
              : {};
          })(),
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

  useEffect(() => () => {
    hudRef.current?.dispose();
    hudRef.current = null;
  }, []);

  const renderFrame = useCallback<SplatPaint>((renderer, scene, camera, options) => {
    const controller = controllerRef.current;
    // 这一层才是编辑器真正的每帧入口：LOD 表计与换档由各控制器自己推进。
    controller?.frameTick(camera);
    for (const extra of otherControllersRef.current.values()) extra.frameTick(camera);
    const backs = [controller?.renderScene, ...[...otherControllersRef.current.values()].map(extra => extra.renderScene)]
      .filter((back): back is NonNullable<typeof back> => back !== null && back !== undefined);
    if (backs.length) paintSplatLayers({ renderer, backs, scene, camera, guides: options?.guides });
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

  /**
   * 标定比例 = 已知真实长度 / 扫描里的同一段长度。
   * 扫描落位值本身可能已经含过一次标定，所以先除回 1:1 再重算，避免比例叠乘。
   */
  const calibrate = useCallback((input: { axis: ScanAxis; knownMeters: number }): ScanScaleCalibration | null => {
    const record = recordRef.current;
    const meters = metersRef.current;
    if (!record || !meters) return null;
    const currentScale = record.scale > 0 ? record.scale : 1;
    const rawScan: ScanExtent = {
      width: meters.width / currentScale,
      depth: meters.depth / currentScale,
      height: meters.height / currentScale,
    };
    const result = calibrateScanScale({ axis: input.axis, knownMeters: input.knownMeters, scan: rawScan });
    if (!result) return null;
    if (!persistCalibration(next => {
      next.scale = result.scale;
      next.reference = { ...result.reference };
    })) return null;
    return result;
  }, [persistCalibration]);

  const setGround = useCallback((ground: GroundPlane) => {
    persistCalibration(next => {
      next.ground = groundFromHeight(ground.y, ground.normal);
    });
  }, [persistCalibration]);

  const setYaw = useCallback((yawDeg: number) => {
    if (!Number.isFinite(yawDeg)) return;
    persistCalibration(next => {
      next.yawDeg = Math.round((((yawDeg % 360) + 360) % 360) * 10) / 10;
    });
  }, [persistCalibration]);

  /** 原点：扫描原点相对场地原点的水平平移，随场景持久化。 */
  const setOrigin = useCallback((origin: { x: number; z: number }) => {
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.z)) return;
    persistCalibration(next => {
      next.origin = {
        x: Math.round(origin.x * 100) / 100,
        z: Math.round(origin.z * 100) / 100,
      };
    });
  }, [persistCalibration]);

  const addAnchor = useCallback((input: { label?: string; kind?: AnchorKind; x: number; z: number }): GroundAnchor | null => {
    const record = recordRef.current;
    if (!record || !Number.isFinite(input.x) || !Number.isFinite(input.z)) return null;
    if (record.anchors.length >= 24) return null;
    const kind: AnchorKind = input.kind ?? 'custom';
    const anchor: GroundAnchor = {
      id: nextAnchorId(record.anchors),
      label: (input.label?.trim() || (kind === 'stage' ? '舞台位' : kind === 'entrance' ? '入口' : '锚点')).slice(0, 24),
      kind,
      x: Math.round(input.x * 100) / 100,
      z: Math.round(input.z * 100) / 100,
    };
    if (!persistCalibration(next => {
      next.anchors = [...next.anchors, anchor];
    })) return null;
    return anchor;
  }, [persistCalibration]);

  const removeAnchor = useCallback((id: string) => {
    persistCalibration(next => {
      next.anchors = next.anchors.filter(anchor => anchor.id !== id);
    });
  }, [persistCalibration]);

  const resetCalibration = useCallback(() => {
    persistCalibration(next => {
      next.scale = 1;
      next.yawDeg = 0;
      next.origin = { x: 0, z: 0 };
      next.ground = groundFromHeight(0);
      next.anchors = [];
      delete next.reference;
    });
  }, [persistCalibration]);

  /** 悬空 / 穿地物件的一次性落地清单；应用归 onApply，避免绕过撤销历史。 */
  const landingPlan = useCallback((items: readonly LandableItem[], floorY = 0): LandingCorrection[] =>
    landingCorrections(items, recordRef.current?.ground, { floorY }), []);

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

  // 标定入口：角标常驻（未标定也可点开），展开就是比例 / 朝向 / 原点 / 基准面 / 锚点面板。
  useEffect(() => {
    if (!isReady) return;
    if (calibrationReadOnlyRef.current) { hudRef.current?.update({ visible:false, summary:'',scale:1,yawDeg:0,groundY:0,originX:0,originZ:0,anchors:[] }); return; }
    const container = rendererRef.current?.domElement.parentElement;
    if (!container) return;
    hudRef.current ??= createCalibrationHud(container, {
      calibrate: input => { calibrate(input); },
      setYaw,
      setGround: y => { setGround(groundFromHeight(y)); },
      setOrigin,
      addAnchor: input => { addAnchor(input); },
      removeAnchor,
      reset: resetCalibration,
    });
    const calibration = state.calibration;
    if (!calibration || state.status !== 'ready') {
      hudRef.current.update({ visible: false, summary: '', scale: 1, yawDeg: 0, groundY: 0, originX: 0, originZ: 0, anchors: [] });
      return;
    }
    const custom = calibration.scale !== 1
      || calibration.yawDeg !== 0
      || calibration.origin.x !== 0
      || calibration.origin.z !== 0
      || calibration.anchors.length > 0
      || !!calibration.reference
      || Math.abs(calibration.ground.y) > 1e-6
      || Math.abs(calibration.ground.normal.x) > 1e-6
      || Math.abs(calibration.ground.normal.z) > 1e-6;
    const deviation = calibration.deviationPct;
    const summary = calibration.reference
      ? `比例 ${calibration.scale}× · 偏差 ${deviation !== undefined && deviation > 0 ? '+' : ''}${deviation}%`
      : custom
        ? `空间标定 · 朝向 ${calibration.yawDeg}°${calibration.anchors.length ? ` · ${calibration.anchors.length} 锚点` : ''}`
        : '空间标定 · 未标定（1:1）';
    hudRef.current.update({
      visible: true,
      summary,
      scale: calibration.scale,
      yawDeg: calibration.yawDeg,
      groundY: calibration.ground.y,
      originX: calibration.origin.x,
      originZ: calibration.origin.z,
      ...(state.meters ? { meters: { ...state.meters } } : {}),
      ...(calibration.reference ? { reference: { ...calibration.reference } } : {}),
      ...(deviation !== undefined ? { deviationPct: deviation } : {}),
      ...(calibration.confidence ? { confidence: calibration.confidence } : {}),
      anchors: calibration.anchors,
    });
  }, [state.calibration, state.status, state.meters, isReady, rendererRef,
    calibrate, setYaw, setGround, setOrigin, addAnchor, removeAnchor, resetCalibration, deps.calibrationReadOnly]);

  // 开发态桥：Agent / 测试可直接按语义标定，不必先长出一套表单 UI。
  useEffect(() => {
    if (!isReady || process.env.NODE_ENV === 'production') return undefined;
    const api = {
      state: () => ({
        assetId: assetIdRef.current,
        meters: metersRef.current,
        position: positionRef.current,
        calibration: calibrationViewOf(recordRef.current),
        anchors: recordRef.current?.anchors ?? [],
      }),
      calibrate: (axis: ScanAxis, knownMeters: number) => calibrate({ axis, knownMeters }),
      setGround: (y: number, normal?: { x: number; y: number; z: number }) => setGround(groundFromHeight(y, normal)),
      setGroundFromPoints: (
        a: { x: number; y: number; z: number },
        b: { x: number; y: number; z: number },
        c: { x: number; y: number; z: number },
      ) => {
        if(calibrationReadOnlyRef.current)return null;
        const plane = groundFromThreePoints(a, b, c);
        if (plane) setGround(plane);
        return plane;
      },
      setYaw,
      setOrigin,
      addAnchor,
      removeAnchor,
      landingPlan,
      reset: resetCalibration,
    };
    (window as unknown as Record<string, unknown>).__scendanceSiteCalibration = api;
    return () => {
      delete (window as unknown as Record<string, unknown>).__scendanceSiteCalibration;
    };
  }, [isReady, calibrate, setGround, setYaw, setOrigin, addAnchor, removeAnchor, landingPlan, resetCalibration, persistCalibration]);

  return {
    state, renderFrame, start, stop, setPosition, displayMode, setDisplayMode, setTransformMode, pickScene, framePrimaryScene,
    calibrate, setGround, setYaw, setOrigin, addAnchor, removeAnchor, landingPlan,
  };
}
