'use client';
/*
 * COLLAB.md 独占区（Qoder 侧只提需求）。本次唯一目的是接手 HANDOFF 第七节第 3 步：
 * 整景区视距下点云退化成锚点 POI，进到 100 m 内再挂/显示 splat。
 * 只做必要接线（LOD hook、primaryVisible、自动挂载门、一个 POI 标记），未重构其他部分。
 */

import { Globe, Info, Layers, Loader2, PanelLeftClose, Scan } from '@/components/solid-icons';
import dynamic from 'next/dynamic';
import '@/components/capture-guide/capture-guide.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {bindPendingCandidateRegistry,createPendingCandidateRegistry} from './lib/pending-candidate-registry';
import type * as ThreeNS from 'three';
import { createBackendSession, type BackendSession } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { commitFreshLocalActivityLayout, commitLocalRestoreLayout, prepareLocalRestoreLayout, type FreshActivityScopeClearance } from '@/lib/local-project-restore';
import { publicationSchema, shareErrorMessage } from '@/lib/share-api';
import { snapshotPreviewContext, decideOnApply, type PreviewContext } from '@/lib/preview-guard';
import { buildGenerationReport } from '@/lib/generation-report';
import { generationMaterialDiff } from './lib/generation-material-diff';
import { getAgentRun } from './panels/agent-chat-store';
import { setGenerationOutcome } from './lib/use-generation-outcome';
import {
  applyLayoutCommandWithRefusals,
  completeLayoutError,
  applyLayoutCommand,
} from '@/lib/build-command';
import { combineOutcomes, hasOutcomeChanges, type GenerationOutcome, type OutcomeEntry } from '@/lib/generation-outcome';
import { isOpening } from './lib/opening-snap';
import { planPointToCanvas } from './lib/review-pins';
import { get2DViewTransform } from './canvas-2d/render';
import { encodeStageCover, registerStageCover } from '@/lib/stage-cover';
import { localPlanKey, reviewPlanKeyForClientUrl, reviewShareHref } from '../review-share-page/load-plan';
import { RoomEditorProvider, type RoomEditorContextValue } from './contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from './contexts/selection-context';
import { layoutReducer } from './hooks/layout-reducer';
import { useCameraPresets } from './hooks/use-camera-presets';
import { useCameraVision } from './hooks/use-camera-vision';
import { useCanvas2DInteraction } from './hooks/use-canvas-2d-interaction';
import { useEventAtmosphere } from './hooks/use-event-atmosphere';
import { useFloorKeepOut } from './hooks/use-floor-keep-out';
import { useHistory } from './hooks/use-history';
import { useImportExport } from './hooks/use-import-export';
import { useItemDrag } from './hooks/use-item-drag';
import { useItemPlacement } from './hooks/use-item-placement';
import { useKeyboardPlacement } from './hooks/use-keyboard-placement';
import { useSilentCloudAttach } from './hooks/use-silent-cloud-attach';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useLayoutPersistence } from './hooks/use-layout-persistence';
import { applyGuardedWorkspaceReplacement, useWorkspaceWriteGuards } from './lib/workspace-write-guards';
import type { WorkspaceWriteSession } from '@/lib/workspace-write-session';
import type { LocalWriteCapability } from '@/lib/local-write-lease';
import { useLayoutState } from './hooks/use-layout-state';
import { layoutStore } from './hooks/use-layout-store';
import { useNpcs } from './hooks/use-npcs';
import { usePeopleModel } from './hooks/use-people-model';
import { useProposalPreview } from './hooks/use-proposal-preview';
import { useRecentColors } from './hooks/use-recent-colors';
import { useReferenceImage } from './hooks/use-reference-image';
import { useReviewCapture } from './hooks/use-review-capture';
import { useSceneEffects, measurementDistance, MAP_VENUE_BOUNDARY } from './hooks/use-scene-effects';
import { useSceneLighting } from './hooks/use-scene-lighting';
import { researchBasemapPlacement, researchGeoToWorld } from './three/research-basemap';
import { DEFAULT_EVENT_LIGHTING } from './three/render-look';
import { useSplatPreview } from './hooks/use-splat-preview';
import { useSplatLod } from './hooks/use-splat-lod';
import type { SplatPosition, SplatTransformMode, SplatWalkBounds } from './three/splat-preview';
import { useThreeScene } from './hooks/use-three-scene';
import { useWalkthrough, type WalkViewMode } from './hooks/use-walkthrough';
import { useWalkAvatar } from './hooks/use-walk-avatar';
import { requestWalkPointerLock } from './lib/walk-engage';
import { useWeather } from './hooks/use-weather';
import { loadAholoSceneSource, storedAholoSceneSource } from './lib/aholo-model-placement';
import { findAholoAsset } from './lib/aholo-assets';
import { DEFAULT_WALK_ROLE_ID, WALK_ROLES, findWalkRole, walkRoleGlbUrl } from './lib/walk-roles';
import { findCatalogEntry } from './lib/catalog-drag';
import { suggestDropPoint } from './lib/drop-zone';
import { captureCatalogPlacement, captureCatalogPlacementBatch, type CatalogPlacementGuard, type CatalogPlacementResult } from './lib/catalog-placement-guard';
import { resolveCatalogPosition } from './lib/catalog-placement-position';
import { buildPasteItems, copyToClipboard } from './lib/clipboard';
import { CAMERA_BRACKET_ARM, EVENT_CATALOG } from './lib/constants';
import { crowdHintsFromLayout } from './lib/crowd-route';
import { saveCustomSet } from './lib/custom-sets';
import { notify } from './lib/editor-notices';
import { clearEnvironment, environmentPreferenceKey, hasEnvironmentPreference, readEnvironments, readEnvironmentsStrict, writeEnvironments, type EnvironmentScope, type StoredEnvironment } from './lib/environment-preference';
import { persistEnvironmentPosition } from './lib/environment-position-transaction';
import { registerReadonlyDraftReader,readLiveReadonlyDraft } from './lib/readonly-draft-registry';
import {createLocalActivitySwitchGuard,LocalActivitySwitchGuardProvider} from './lib/local-activity-switch-guard';
import {unsavedSourceDrafts} from './panels/unsaved-source-drafts';
import { reconcilePendingEnvironmentWrite, type PendingEnvironmentWrite } from './lib/environment-write-reconciliation';
import { downloadTextFile } from './lib/plan-export/download';
import { alignSelection, distributeSelection, type AlignEdge, type DistributeAxis } from './lib/alignment';
import { hasCollisions, totalCost } from './lib/geometry';
import { expandSelection, groupIdsIn, isWholeGroup } from './lib/groups';
import type { GizmoMode } from './lib/transform';
import { randomSuffix } from './lib/ids';
import { LEFT_CARD_WIDTH_DEFAULT, LEFT_CARD_WIDTH_KEY, parseLeftCardWidth } from './lib/left-card-width';
import { isNavExpanded, type RailSidePanel } from './lib/nav-chrome';
import { noteVenueThreeIntent } from './lib/venue-library';
import { loadOnlineCatalogItem } from './lib/online-model-placement';
import { loadOnlineModels } from './lib/online-models';
import { reseatWallMountedItem, settleWallMountedItem } from './lib/opening-snap';
import { snapshotBeforeReplace } from './lib/restore-point';
import { editorItemLimit } from './lib/scene-presets';
import { parseLayoutEventOperations } from './lib/schema';
import { assetCloudStateOf, localAssetIdsInLayout } from './lib/asset-cloud';
import { encodeShareUrl } from './lib/share';
import { rememberReviewLinkMark } from './lib/review-share';
import { DEMO_WORLD_SCENE_ID } from './lib/shipped-assets';
import { playSound, type SoundCue } from './lib/sounds';
import { placeSplatPreview, splatShellKeptNote } from './lib/splat-venue-fit';
import type { ScannedVenue } from './lib/venue-scans';
import { listScannedVenues } from './lib/venue-scans';
import { mapVenueFootprint, sceneAnchorOf } from './lib/scene-anchor';
import { cameraDistanceClamp } from './lib/camera-framing';
import type { SceneAnchor, SceneAnchorSource } from './lib/types';
import { useSceneZoom, SCENE_ZOOM_CLOSER_RATIO } from './hooks/use-scene-zoom';
import { SceneGeoDots } from './panels/scene-geo-dots';
import { SplatLodMarker } from './panels/splat-lod-marker';
import { buildingHeight, floorElevation, storeyHeight } from './lib/storeys';
import { entrancePlanOutline } from './lib/street';
import { canApplyLayoutGeometry, structuralItemCollides, materialCount, isEvidenceProtectedWall } from './lib/structural-layout';
import { snapWallEndpoint } from './lib/wall-snap';
import { ROUTE_WAYPOINT_CLEARANCE_WARN_M, routePointError, routePointErrorInRect } from './lib/person-route';
import { buildWalkColliders, walkerClearanceAt } from './lib/walk-collision';
import { setPersonFollowTarget } from './three/person-follow';
import { WORKBENCH_MODE_DEFAULT, demoteLegacyMode, type WorkbenchMode } from './lib/workbench-mode';
import { ActivityTaskWorkspace } from './panels/activity-task-workspace';
import { CanvasHeading } from './panels/canvas-heading';
import { GeoBasemapInput } from './panels/geo-basemap-input';
import { XIHU_LOCAL_CENTER, XIHU_LOCAL_SPAN_M } from './lib/research-area';
import { AGENT_META, AgentCanvasOverlay, AgentPanel, LayoutAgentProvider, MapRailButton, MapVenueOverlay, VenuePickerOverlay, readonlyComposerDrafts, type AgentId } from './panels/agent-panel';
import { CanvasWorkflow } from './panels/canvas-workflow';
import { settlePlacement } from '@/lib/settle-placement';
import { cloudSeatingAllocation, cloudSeatingSpecs, type BriefMemory } from './lib/brief-agent';
import { projectDialogueHandoff } from './lib/dialogue-handoff';
import { hasBlockingActivityNeeds } from './lib/activity-need-gate';
import { getActiveAssistantSessionId, subscribeActiveAssistantSession } from './hooks/use-assistant-sessions';
import {extractMobilityWidth} from './lib/mobility-export';
import { checkRequiredSeats, checkRestArea } from './lib/seat-requirement';
import { checkFunctionalRequirements } from './lib/functional-requirements';
import { sameLayoutContent } from './lib/persistence';
import { isVenueScaleCurrent, venueDimensionsMismatch } from './lib/venue-scale-basis';
import { extractPlanSizeFacts } from '@/lib/plan-size-facts';
import { readAgentAnnotationObservation } from '@/lib/agent-annotation-observation';
import { agentAnnotationObservationSchema } from '../../../supabase/functions/_shared/agent-contract';
import { isVenueFactMemoryCurrent, useVenueFactTracker } from './lib/venue-fact-epoch';
import { createRouteDrawingSession } from './lib/route-drawing-session';
import { useActivitySessionTracker, type ActivitySessionToken } from './lib/activity-session-epoch';
import { useFloorSessionTracker, type FloorSessionToken } from './lib/floor-session-epoch';
import { validateCandidateApply } from './lib/candidate-apply-validation';
import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { applyVenueHistorySnapshot } from './lib/venue-history';
import { appendPlanZones } from '@/lib/plan-zone-persistence';
import { prepareZonePlan, zonePlanCandidates } from '@/lib/zone-plan-application';
import { AgentChatBridge } from './panels/agent-chat-bridge';
import { BingoAvatarFlight } from './panels/bingo-avatar-flight';
import { BingoRailButton } from './panels/bingo-rail-button';
import { RailLaneDot } from './panels/rail-lane-dot';
import { RailAvatar } from './panels/rail-avatar';
import { RailTeamBlock } from './panels/rail-team-block';
import OutdoorPlanOverlay from './components/outdoor-plan-overlay';
import type { OutdoorPanelKind } from './components/outdoor-plan-overlay';
import { MemberChat } from './panels/member-chat';
import { useTeam } from './lib/team-data';
import { CloudPanel } from './panels/cloud-panel';
import { SettingsMenu } from './panels/settings-menu';
import { CommercialWorkspace } from './panels/commercial-workspace';
import { CreativeStudioProvider, CreativeAssistant, type BusinessToolsApi } from './panels/creative-studio';
import { GeneratedModelLibrary } from './panels/generated-model-library';
import { ItemContextPopover } from './panels/item-context-popover';
import { LeftCardResizer } from './panels/left-card-resizer';
import { Lux3dDirectTest } from './panels/lux3d-direct-test';
import { MobileAgentDock } from './panels/mobile-agent-dock';
import { DeliveryChecklistShell } from './panels/mode-shell';
import { PlacementHint } from './panels/placement-hint';
import { WorkbenchBrandToggle } from './panels/workbench-brand-toggle';
import { ReferenceImageControls } from './panels/reference-image-controls';
import { ScendanceLibrary, ScendanceViewTools } from './panels/scendance-workspace';
import { SpacePanel } from './panels/space-panel';
import { StatusToastHost } from './panels/status-toast';
import { EnvironmentLoad } from './panels/environment-load';
import { Viewport } from './panels/viewport';
import type { HoverInfo } from './hooks/use-three-scene';
import type { GameMode } from './lib/types';
import { ConfirmModal } from './components/ConfirmModal';
import { useF3CoachBubble } from './hooks/use-f3-coach-bubble';
import { F3CoachBubble } from './panels/f3-coach-bubble';
import { usePlanAnnotations, type PlanDrawMode } from './hooks/use-plan-annotations';
import { buildDefaultZoneRects } from '@/lib/auto-zone-apply';
import { PlanOverlay } from './canvas-2d/plan-overlay';
import { AnnotationGuide } from './panels/annotation-guide';
import type { View2DTransform } from './canvas-2d/render';
import { PlanCard } from './panels/plan-card';
import { computeBingoScore } from '@/lib/bingo-score';
import { ANNOTATION_PRESET_LABELS, createEmptyPlanDraft, pickDoorWallFromPoint, ZONE_SEMANTIC_LABELS, type PlanPoint, type ZoneSemanticType } from '@/lib/plan-annotation';
// 第 12 批：三版打分 + 动线约束 + AI 建议（纯函数层，已独立测试）。
import {
  pickRecommendedPlan,
  type ScoredPlan,
  type PlanVariantId,
} from '@/lib/plan-scoring';
import { generateSuggestions, type ActivitySuggestion } from '@/lib/suggestions';

const WorkbenchCaptureGuide = dynamic(() => import('@/components/capture-guide/capture-guide').then(module => module.CaptureGuide));
const ZERO_SPLAT_POSITION: SplatPosition = Object.freeze({ x: 0, y: 0, z: 0 });
import type { CatalogItem, FurnitureItem, RoomLayout, ViewSettings, WallId } from './lib/types';
import type { SplatPaint } from './three/splat-preview';

function zoomCamera(
  camera: import('three').PerspectiveCamera,
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls,
  direction: '+' | '-'
): void {
  const offset = camera.position.clone().sub(controls.target);
  const factor = direction === '+' ? 0.85 : 1.18;
  offset.multiplyScalar(factor);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

const INITIAL_VIEW_SETTINGS: ViewSettings = {
  view2D: false,
  showMeasurements: true,
  showWiFiSignals: false,
  snapToGrid: false,
  snapToWall: false,
  snapToItems: false,
  showMinimap: false,
  floorPlan3DEffect: false,
  timeOfDay: 12,
  weather: 'clear',
  walkthroughMode: false,
  showOutdoor: false,
  showAllFloors: false,
  wallDisplay: 'cutaway',
  measurementMode: false,
  soundsEnabled: false,
  drawWallMode: false,
  drawZoneMode: false,
  selectMode: true,
  showHeatmap: false,
  showItemLabels: false,
  showNpcs: false,
  showCameraVision: false,
};

export function RoomOrganizer({ controller: providedController, isActive = true, localWriteCapability, isolatedWriteSession }: { controller?: BackendSession; isActive?: boolean; localWriteCapability?: LocalWriteCapability; isolatedWriteSession?: WorkspaceWriteSession } = {}): JSX.Element {
  const isolatedRef=useRef<{session:WorkspaceWriteSession;revoked:boolean}|null>(null);
  if(!isolatedRef.current&&isolatedWriteSession)isolatedRef.current={session:isolatedWriteSession,revoked:false};
  else if(isolatedRef.current&&isolatedWriteSession!==isolatedRef.current.session)isolatedRef.current.revoked=true;
  const assertIsolatedSession=isolatedRef.current?()=>{const current=isolatedRef.current!;if(current.revoked)throw new Error('本机编辑会话已变化。');current.session.assertCapability(localWriteCapability);}:undefined;
  const workspaceWriteGuards = useWorkspaceWriteGuards(localWriteCapability,assertIsolatedSession);
  const dropActive = useRef(isActive);
  useEffect(() => { dropActive.current = isActive; return () => { dropActive.current = false; }; }, [isActive]);
  const [fallbackController] = useState(() => providedController ?? createBackendSession());
  const controller = providedController ?? fallbackController;
  const placementIdentity = useRef({ controller, apiUrl: controller.config.apiUrl, isActive, epoch: 0 });
  if (placementIdentity.current.controller !== controller || placementIdentity.current.apiUrl !== controller.config.apiUrl || placementIdentity.current.isActive !== isActive) {
    placementIdentity.current = { controller, apiUrl: controller.config.apiUrl, isActive, epoch: placementIdentity.current.epoch + 1 };
  }
  const capturePlacement = useCallback(() => {
    const guard = captureCatalogPlacement(placementIdentity.current.controller, () => placementIdentity.current.epoch);
    return { assertCurrent: () => {
      guard.assertCurrent();
      if (!placementIdentity.current.isActive) throw new Error('工作台已关闭，请返回后重新添加模型。');
    }, dispose: guard.dispose };
  }, []);
  const capturePlacementBatch = useCallback(() => {
    const guard = captureCatalogPlacementBatch(placementIdentity.current.controller, () => placementIdentity.current.epoch);
    const assertCurrent=()=>{guard.assertCurrent();if(!placementIdentity.current.isActive)throw new Error('工作台已关闭，剩余物料未添加。');};
    return {assertCurrent,dispose:guard.dispose,runOwnMutation:(action:()=>CatalogPlacementResult|void)=>{assertCurrent();const result=guard.runOwnMutation(action);assertCurrent();return result;}};
  }, []);
  useEffect(() => controller.retain(), [controller]);
  const assistantEntryHostRef = useRef<HTMLDivElement>(null);
  const frameViewportRef = useRef(() => {});

  const { layout, activeFloor, activeFloorIndex, actions } = useLayoutState();
  const sessionScope = layout.id ? `activity:${layout.id}` : 'draft:unidentified';
  const activitySession = useActivitySessionTracker(layoutStore);
  const sessionToken = activitySession.token;
  const pendingCandidateRegistry=useMemo(()=>createPendingCandidateRegistry(),[]);
  const pendingCandidates=useMemo(()=>bindPendingCandidateRegistry(pendingCandidateRegistry,sessionToken,()=>activitySession.isCurrent(sessionToken)),[pendingCandidateRegistry,sessionToken,activitySession.isCurrent]);
  // The session guard below temporarily unmounts the viewport on a switch.
  // A fresh ref identity makes the existing canvas effects detach from the old
  // DOM node and bind the new one without changing the renderer pipeline.
  const canvasRef = useMemo<React.MutableRefObject<HTMLCanvasElement | null>>(()=>({current:null}),[sessionToken?.scope,sessionToken?.epoch]);
  const canvas2DRef = useMemo<React.MutableRefObject<HTMLCanvasElement | null>>(()=>({current:null}),[sessionToken?.scope,sessionToken?.epoch]);
  const floorSession = useFloorSessionTracker(layoutStore);
  const floorToken = floorSession.token;
  const routeVenueFacts = useVenueFactTracker(layoutStore);
  // 集成接线：F3 首次吸附教练气泡、规划标注层、确认弹层状态。
  const f3Coach = useF3CoachBubble();
  const planAnnot = usePlanAnnotations();
  // 第 10 批「批注→施工」：正在画但还没落地的临时点（世界坐标），喂给 PlanOverlay 做跟随反馈。
  const [draftPoints, setDraftPoints] = useState<PlanPoint[]>([]);
  // 第 11 批：当前要画的 zone 语义类型（决定批准时落什么家具）。
  const [zoneType, setZoneType] = useState<ZoneSemanticType>('roundtable');
  // 第 12 批：三版打分里用户手动选中的布置版本；默认适中版，批准时按它落家具。
  const [selectedVariantId, setSelectedVariantId] = useState<PlanVariantId>('balanced');
  const chatTransitionEpoch=useRef(0);
  const briefCaptureEpoch=useRef(0);
  // A completed originating turn is not a new requirement; later inputs are.
  const briefIntentEpoch=useRef(0);
  // A submitted message invalidates existing captures immediately, before any
  // model or queue await. Independent tokens prevent concurrent turns from
  // making the export appear idle when only one has finished.
  const pendingDialogueTurns=useRef(new Set<symbol>());
  // Session-local, in-memory warning only. It is not a persistent audit log.
  const incompleteDialogueSessions=useRef(new Set<string>());
  // Recovered conversation history may omit unresolved requirements. Nothing is
  // trusted until this exact activity/session has been explicitly rechecked.
  const reviewedDialogueHistory=useRef<{scope:string;sessionId:string;chatEpoch:number;activityEpoch:number|null}|null>(null);
  const dialogueSessionKey=(sessionId:string)=>JSON.stringify([sessionScope,sessionId]);
  const setDialogueIncomplete=(sessionId:string|null,incomplete:boolean)=>{
    if(!sessionId)return;const key=dialogueSessionKey(sessionId),had=incompleteDialogueSessions.current.has(key);
    if(incomplete)incompleteDialogueSessions.current.add(key);else incompleteDialogueSessions.current.delete(key);
    if(had!==incomplete){briefCaptureEpoch.current++;briefIntentEpoch.current++;}
  };
  const beginDialogueTurn=()=>{
    const token=Symbol('dialogue-turn');pendingDialogueTurns.current.add(token);briefCaptureEpoch.current++;briefIntentEpoch.current++;
    let released=false;return()=>{if(released)return;released=true;if(pendingDialogueTurns.current.delete(token))briefCaptureEpoch.current++;};
  };
  useEffect(()=>subscribeActiveAssistantSession(sessionScope,(id)=>{
    const reviewed=reviewedDialogueHistory.current;
    // Initial store hydration may emit the same session immediately after an
    // explicit review. A genuine away-and-back still increments on the away.
    if(reviewed&&reviewed.scope===sessionScope&&reviewed.sessionId===id&&reviewed.activityEpoch===(sessionToken?.epoch??null)&&reviewed.chatEpoch===chatTransitionEpoch.current)return;
    chatTransitionEpoch.current++;
  }),[sessionScope,sessionToken?.epoch]);
  const [agentBriefRecord, setAgentBriefRecord] = useState<{ scope: string; epoch: number; chatEpoch:number; sessionId:string|null; memory: BriefMemory } | null>(null);
  const agentBriefRef = useRef<{ scope: string; epoch: number; chatEpoch:number; sessionId:string|null; memory: BriefMemory } | null>(null);
  const agentBriefMemory = agentBriefRecord?.scope === sessionScope && agentBriefRecord.epoch === sessionToken?.epoch && agentBriefRecord.chatEpoch===chatTransitionEpoch.current && agentBriefRecord.sessionId!==null && agentBriefRecord.sessionId===getActiveAssistantSessionId(sessionScope) ? agentBriefRecord.memory : null;
  const getStoreSessionScope = () => {
    const id = layoutStore.getState().layout.id;
    return id ? `activity:${id}` : 'draft:unidentified';
  };
  const getActiveBrief = () => {
    const scope = getStoreSessionScope();
    return activitySession.isCurrent(sessionToken) && agentBriefRef.current?.scope === scope && agentBriefRef.current.epoch === sessionToken?.epoch && agentBriefRef.current.chatEpoch===chatTransitionEpoch.current && agentBriefRef.current.sessionId!==null && agentBriefRef.current.sessionId===getActiveAssistantSessionId(scope)
      ? agentBriefRef.current.memory : null;
  };
  // canvas 尺寸变化（view 切到 2D / 窗口缩放）时 bump，触发 overlay 重算 transform。
  const [overlayTick, setOverlayTick] = useState(0);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; description: string; confirmText?: string }>({ open: false, title: '', description: '' });
  useEffect(() => { setSpaceWorkflow('aholo'); }, [layout.id]);
  const liveLayout = useRef(layout); liveLayout.current = layout;
  const [aiPreview, setAiPreview] = useState<{base: RoomLayout; candidate: RoomLayout} | null>(null);
  const [previewGuard, setPreviewGuard] = useState<PreviewContext | null>(null);
  // M5 欠债②：Outcome.refused 之前恒空。这里在组件侧镜像最近一次 Outcome，
  // 让手动拖放被拒的单件也能合并进同一份账本，而不是把上一份 AI 账本直接覆盖掉。
  const lastOutcomeRef = useRef<GenerationOutcome<FurnitureItem> | null>(null);
  const applyOutcome = useCallback((outcome: GenerationOutcome<FurnitureItem>) => {
    lastOutcomeRef.current = outcome;
    setGenerationOutcome(outcome);
  }, []);
  const [captionEpoch, setCaptionEpoch] = useState(0);
  const [previewCaptionVisible, setPreviewCaptionVisible] = useState(false);
  const activeFloorY = floorElevation(layout.floors, activeFloorIndex);
  const activeStoreyHeight = storeyHeight(activeFloor);
  const { recent: recentColors, pushColor } = useRecentColors();
  const [view, setView] = useState<ViewSettings>(INITIAL_VIEW_SETTINGS);
  const referenceImage = useReferenceImage(layout);
  const [referenceOpenRequest, setReferenceOpenRequest] = useState(0);
  const referenceEntryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setView(current => { const { referenceImageOpacity: _opacity, ...rest } = current; return { ...rest, showReferenceImage: true }; });
  }, [layout.id]);

  // First-person walkthrough only runs in the 3D view; the 2D top-down renderer
  // has no PointerLockControls. This single signal gates walkthrough-aware
  // behaviour: canvas select/drag/hover, single-key shortcuts and the hook.
  const walkthroughActive = isActive && view.walkthroughMode && !view.view2D;

  const playCue = useCallback(
    (cue: SoundCue) => {
      if (view.soundsEnabled) playSound(cue);
    },
    [view.soundsEnabled]
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedWall, setSelectedWall] = useState<{ id: string; kind: 'exterior' | 'interior' } | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [autoCycleLighting, setAutoCycleLighting] = useState(false);
  // 工具抽屉和 Bingo 列同时关着，左侧导航才算收起。logo 只写这两扇门。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [agentClosing, setAgentClosing] = useState(false);
  const [sidePanel, setSidePanel] = useState<RailSidePanel | null>(null);
  const bingoRailRef = useRef<HTMLButtonElement>(null);
  // 顶栏的同类门洞落回左轨最上面那格（同一张门洞图），不是 Bingo 的球。
  const brandRailRef = useRef<HTMLButtonElement>(null);
  // 对话顶栏那颗门洞头像：飞行层从它起飞，落地后再显形。
  const bingoHeaderAvatarRef = useRef<HTMLSpanElement>(null);
  const [bingoHeaderAvatarVisible, setBingoHeaderAvatarVisible] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentId>('door');
  // 手机端左轨收成一颗入口钮；点开后是四格弹层，选一个 agent 就收起。
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [spaceWorkflow, setSpaceWorkflow] = useState<'aholo' | 'traditional'>('aholo');
  const agentPanelVisible = (!agentCollapsed || agentClosing) && !sidePanel;
  const navExpanded = isNavExpanded({ agentCollapsed, sidebarCollapsed, sidePanel });
  const agentPanelOpen = !agentCollapsed && !agentClosing && !sidePanel;
  useEffect(() => {
    if (agentCollapsed || agentClosing || sidePanel) {
      setBingoHeaderAvatarVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setBingoHeaderAvatarVisible(true), 280);
    return () => window.clearTimeout(timer);
  }, [agentCollapsed, agentClosing, sidePanel]);
  /** Bingo 栏在左侧。关掉后再从画布上的 Bingo 浮标打开，回到布置对话。 */
  const spaceNewRef = useRef<((mode?: 'blank' | 'template') => void) | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [conversationOpenRequest, setConversationOpenRequest] = useState(0);
  const conversationEntryRef = useRef<HTMLButtonElement>(null);
  const [compactViewport, setCompactViewport] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [businessOpen, setBusinessOpen] = useState(false);
  const [leftMode, setLeftMode] = useState<'brief'|'properties'|'business'|'lux3d'>('brief');
  const [leftCardWidth, setLeftCardWidth] = useState(() => {
    if (typeof window === 'undefined') return LEFT_CARD_WIDTH_DEFAULT;
    try { return parseLeftCardWidth(localStorage.getItem(LEFT_CARD_WIDTH_KEY)); } catch { return LEFT_CARD_WIDTH_DEFAULT; }
  });
  const [leftCardResizing, setLeftCardResizing] = useState(false);
  const rememberLeftCardWidth = useCallback((next: number) => {
    setLeftCardWidth(next);
    try { localStorage.setItem(LEFT_CARD_WIDTH_KEY, String(next)); } catch { /* 隐私模式写不进就只留在这一页 */ }
  }, []);
  /** 空间和物料是整张库卡，比对话要宽一档；切回 Bingo 仍用她拖出来的宽度。 */
  const leftColumnWidth = leftCardWidth;
  // 左轨「观感」默认生产也显示；设 NEXT_PUBLIC_LUX3D_RAIL=0 可关掉。面板内生产走 shipped/云路径，不打 127.0.0.1。
  const luxDirectVisible = process.env.NEXT_PUBLIC_LUX3D_RAIL !== '0';
  // 地图采集单拍完的素材要接进 Aholo 场地重建：带着这块地的名字和应拍张数过去，省得她再填一遍。
  const [aholoReconPreset, setAholoReconPreset] = useState<{ name: string; hint: string } | null>(null);
  // 生成轨点「物料生成 / 场地生成」：观感面板落到对应那组标签；nonce 让同一入口连点也生效。
  const [lux3dOpenKind, setLux3dOpenKind] = useState<{ kind: 'world' | 'recon'; nonce: number; prompt?: string } | null>(null);
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>(WORKBENCH_MODE_DEFAULT);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [handoffExportRequest, setHandoffExportRequest] = useState(0);
  const [shareOpenRequest, setShareOpenRequest] = useState(0);
  // T3 封堵：制作侧画布钉（reviewPins/pinFilter/pinDraft/reviewCleared）整簇删除——门已封死，评审只走分享链接。
  const [outdoorVenue, setOutdoorVenue] = useState(false);
  const [workbenchModeSerial, setWorkbenchModeSerial] = useState(0);
  const [environments, setEnvironments] = useState<StoredEnvironment[]>([]);
  const environment = environments[0] ?? null;
  const environmentsRef = useRef(environments);
  const environmentPreferenceReadyRef=useRef(false);
  const pendingEnvironmentPositionRef=useRef<PendingEnvironmentWrite|null>(null);
  environmentsRef.current = environments;
  // 撤销/重做落回旧布局时，把布局里记着的真实场地也挂回去；具体切换逻辑在下面赋值。
  const restoreVenueFromHistoryRef = useRef<(scan: { assetId: string; name: string }, previousLayout: RoomLayout) => void>(() => {});
  // 换场前那份布局没有 venueScan，撤销回到它时靠这份按对象身份的记录找回原场地。
  const venueByLayoutRef = useRef(new WeakMap<RoomLayout, { assetId: string; name: string }>());
  // 高斯校准只做一次；换场时若已按扫描自带尺寸设好壳体，预览就绪后不再二次改尺寸。
  const calibratedSceneRef = useRef('');
  const [splatTransformMode, setSplatTransformModeState] = useState<SplatTransformMode>('off');
  const [deliveryOpenRequest, setDeliveryOpenRequest] = useState(0);
  const [backupOpenRequest, setBackupOpenRequest] = useState(0);
  const [reviewOpenRequest, setReviewOpenRequest] = useState(0);
  const deliveryEntryRef = useRef<HTMLButtonElement>(null);
  const reviewEntryRef = useRef<HTMLButtonElement>(null);
  const [conversationCloseRequest, setConversationCloseRequest] = useState(0);
  // 左轨成员位与「团队与权限」读同一份团队。
  const team = useTeam(controller);
  const [teamOpenRequest, setTeamOpenRequest] = useState<{ serial: number; section: string } | undefined>();
  // 左轨点头像，左栏整栏换成那个人的私信；再点同一颗收起。换成员或换团队时窗子跟着换/关。
  const [chatPeerId, setChatPeerId] = useState<string | null>(null);
  const personChat = !!chatPeerId && team.members.some(member => member.userId === chatPeerId);
  // 私信压在栏里的时候，四格不算开着：栏中此刻不是它们的卡，按压态与高亮跟着让开。
  const isLaneOpen = (id: AgentId): boolean => agentPanelOpen && activeAgent === id && !personChat;
  // 私信开着，左栏就必须撑着——哪怕四格都收着，栏里此刻装的是这场对话。
  const [capturePanel, setCapturePanel] = useState<'new' | 'open' | 'hidden'>('new');
  const captureOpen = capturePanel === 'open';
  const columnExpanded = navExpanded || personChat || captureOpen;
  const capturePanelRef = useRef<HTMLElement>(null);
  const captureReturnFocusRef = useRef<HTMLElement | null>(null);
  const openCapturePanel = () => {
    captureReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCapturePanel('open');
  };
  const closeCapturePanel = () => {
    setCapturePanel('hidden');
    requestAnimationFrame(() => {
      const previous = captureReturnFocusRef.current;
      if (previous?.isConnected) previous.focus();
    });
  };
  useEffect(() => { if (captureOpen) capturePanelRef.current?.focus(); }, [captureOpen]);
  // 户外 2D 规划覆盖层（P2-c）：同一页面内的户外面——开启后满幅盖在 3D 画布上，关闭即回。
  // 数据同态：草稿按 layout.id 存本机（outdoor-project-store），底图定位继承活动点位。
  // P2-d：左栏卡片（图层/信息）由左轨钮切换，浮窗经 panelsHostId portal 进左栏。
  const [outdoor2DOpen, setOutdoor2DOpen] = useState(false);
  const [outdoorPanel, setOutdoorPanel] = useState<OutdoorPanelKind | null>('layers');
  // 手机端：抽屉一打开（任一路 lane 或私信），入口弹层就收起，避免两层叠着。
  useEffect(() => {
    if (columnExpanded) setMobileRailOpen(false);
  }, [columnExpanded]);
  // 手机端首屏先收起对话：画布吃满，底部只留一条最新消息 + 一行输入。
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 768px)').matches) return;
    setAgentCollapsed(true);
    setSidebarCollapsed(true);
  }, []);
  const businessHostRef = useRef<HTMLDivElement>(null);
  const businessToolsRef = useRef<BusinessToolsApi | null>(null);
  const toolsEntryRef = useRef<HTMLButtonElement>(null);
  const spaceEntryRef = useRef<HTMLButtonElement>(null);
  const agentRailRefs = { door: brandRailRef, bingo: bingoRailRef, space: spaceEntryRef, material: toolsEntryRef } as const;
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width:1080px)');
    const collapseTools = () => {
      if (!media.matches) return;
      if (businessHostRef.current?.parentElement?.contains(document.activeElement)) toolsEntryRef.current?.focus();
      setSidebarCollapsed(true);
    };
    collapseTools(); media.addEventListener('change', collapseTools);
    return () => media.removeEventListener('change', collapseTools);
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width:680px)');
    const update = () => setCompactViewport(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const active = document.activeElement;
    if (compactViewport && conversationOpen && headerRef.current?.contains(active) && !active?.closest('dialog[open]')) {
      headerRef.current.parentElement?.querySelector<HTMLTextAreaElement>('.cr-chat-composer textarea')?.focus();
    }
  }, [compactViewport, conversationOpen]);
  const handleConversationVisibility = useCallback((open: boolean) => {
    setConversationOpen(open);
    if (open && window.innerWidth <= 1080) { setSidebarCollapsed(true); }
  }, []);
  // 深工具打开时左栏让出来；关掉不把简报重新撑开，首屏把宽度留给画布。
  // 图纸、评审资料、执行清单开在画布上，不把左侧Bingo换成另一张卡。
  const handleWorkspaceVisibility = useCallback((open: boolean) => {
    setBusinessOpen(open);
    if (open) {
      setLeftMode('business');
      setSidebarCollapsed(true);
      setSidePanel(null);
      setAgentCollapsed(false);
    } else setLeftMode(mode => (mode === 'business' ? 'brief' : mode));
  }, []);
  const workspaceEntryRef = useRef<HTMLButtonElement>(null);
  /** 左轨四格共用一个面板：切到哪一格，整栏就变成那个 agent 的卡。 */
  const showAgent = useCallback((id: AgentId) => {
    setCapturePanel(value => value === 'open' ? 'hidden' : value);
    if (id === 'material') setWorkbenchMode('layout');
    // 点四格任意一格 = 栏里换回那个 agent 的卡，私信先收起。
    setChatPeerId(null);
    setActiveAgent(id);
    setAgentClosing(false);
    setAgentCollapsed(false);
    setSidePanel(null);
    setSidebarCollapsed(true);
    setBusinessOpen(false);
    requestAnimationFrame(() => {
      const input = document.getElementById('ap-input') ?? document.getElementById('prop-input');
      (input ?? document.getElementById('agent-panel'))?.focus({ preventScroll: true });
    });
  }, []);
  const openTemplates = useCallback(() => {
    if (window.innerWidth <= 1080) setConversationCloseRequest(value => value + 1);
    showAgent('space');
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#agent-panel section[aria-label="场景模板"] button')?.focus());
  }, [showAgent]);
  const closeLeftPanel = useCallback(() => {
    setBusinessOpen(false);
    setSidebarCollapsed(true);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.sc-mode-rail button[aria-pressed="true"]')?.focus());
  }, []);
  // 左轨只留布置。旧的评审/执行不切模式：评审打开分享，执行打开到场清单。
  const selectWorkbenchMode = useCallback((mode: WorkbenchMode) => {
    const next = demoteLegacyMode(mode);
    if (next === 'open-checklist') { setChecklistOpen(true); return; }
    if (next === 'open-share') { setShareOpenRequest(value => value + 1); return; }
    setWorkbenchMode('layout');
    setWorkbenchModeSerial(value => value + 1);
    setBusinessOpen(false);
    setLeftMode('brief');
    setSidebarCollapsed(true);
    setSidePanel(null);
    setAgentCollapsed(false);
  }, []);
  const issueReviewLink = useCallback(async () => {
    const token=sessionToken,selectedFloor=floorToken,initial=layoutStore.getState();
    if(!activitySession.isCurrent(token)||!floorSession.isCurrent(selectedFloor))throw new Error('活动或楼层正在切换，请重新生成评审链接。');
    const layout=structuredClone(initial.layout);
    if(!sameRecoveryFormValue(layout,initial.layout))throw new Error('当前方案无法完整核对，未生成评审链接。');
    const isCurrent=()=>activitySession.isCurrent(token)&&floorSession.isCurrent(selectedFloor)&&layoutStore.getState().revision===initial.revision&&sameRecoveryFormValue(layoutStore.getState().layout,layout);
    const check=()=>{if(!isCurrent())throw new Error('活动、楼层或方案已变化；旧评审记录如已写入会保留，链接未复制。');};
    const encoded = await encodeShareUrl(layout, window.location.origin);
    check();
    const url = reviewShareHref(window.location.origin, new URL(encoded.url).hash);
    if (!url) throw new Error('评审链接没有生成。');
    const projectKey = (layout.id ?? '').trim() || 'local-draft';
    const reviewPlanKey = reviewPlanKeyForClientUrl(url) ?? localPlanKey(layout);
    await rememberReviewLinkMark({
      projectKey,
      title: layout.name?.trim() || '未命名活动',
      shareId: projectKey,
      clientUrl: url,
      reviewPlanKey,
    },{isCurrent});
    check();
    return { url,isCurrent };
  }, [activitySession.isCurrent,sessionToken,floorSession.isCurrent,floorToken]);
  // 发布：把已保存的这一版冻成只读页，链接既是二维码内容也是复制出去的地址。
  const publishVersion = useCallback(async () => {
    const snapshot = controller.getSnapshot();
    if (!snapshot.configured) throw new Error('发布服务还没连上。');
    if (!snapshot.user || snapshot.user.is_anonymous) throw new Error('登录后再发布。');
    const projectId = snapshot.project?.id ?? layoutStore.getState().layout.id;
    if (!projectId) throw new Error('这份方案还没挂到项目上，稍后再试。');
    if (snapshot.writeBlocked) throw new Error('这个项目现在是只读，取回编辑权后再发布。');
    if (!Number.isFinite(snapshot.revision)) throw new Error('还有改动没保存，保存后再发布。');
    if (snapshot.dirty) {
      const pendingLocal = [...localAssetIdsInLayout(layoutStore.getState().layout)]
        .filter(id => assetCloudStateOf(id).state !== 'uploaded');
      throw new Error(pendingLocal.length
        ? '画布里的本机模型还没上云，保存成功后才能发布；本机副本还在，网络恢复后重试保存即可。'
        : '还有改动没保存，保存后再发布。');
    }
    try {
      const publication = publicationSchema.parse(await controller.businessRequest<unknown>(
        `/projects/${encodeURIComponent(projectId)}/publish`, 'POST', { expectedRevision: snapshot.revision },
      ));
      return { url: publication.url, revision: publication.revision };
    } catch (error) {
      throw new Error(shareErrorMessage(error));
    }
  }, [controller]);
  const exportHandoff = useCallback(() => {
    setSidePanel(null);
    setAgentCollapsed(false);
    setHandoffExportRequest(value => value + 1);
  }, []);
  const openMaterialsFromShare = useCallback(() => {
    document.querySelector<HTMLButtonElement>('.sc-cloud-trigger')?.click();
  }, []);
  const closeBingo = useCallback(() => {
    setAgentClosing(true);
    window.setTimeout(() => {
      setAgentCollapsed(true);
      setAgentClosing(false);
      const rail = activeAgent === 'door' ? brandRailRef : activeAgent === 'bingo' ? bingoRailRef : activeAgent === 'space' ? spaceEntryRef : toolsEntryRef;
      rail.current?.focus();
    }, 280);
  }, [activeAgent]);
  /** 点同一格收起，点别的格就地换成那个 agent 的卡。私信开着时点格子 = 换回那一格，不是收起整栏。 */
  const toggleAgent = useCallback((id: AgentId) => {
    if (!captureOpen && agentPanelOpen && activeAgent === id && !chatPeerId) closeBingo();
    else showAgent(id);
  }, [captureOpen, agentPanelOpen, activeAgent, chatPeerId, closeBingo, showAgent]);
  const openBusinessWorkspace = useCallback((mode: 'review' | 'delivery') => {
    // 表单仍浮在画布上。不把Bingo切成评审或执行。
    setLeftMode('business');
    setBusinessOpen(true);
    setSidebarCollapsed(true);
    setSidePanel(null);
    setAgentCollapsed(false);
    if (mode === 'review') setReviewOpenRequest(value => value + 1);
    else setDeliveryOpenRequest(value => value + 1);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('restore') !== 'backup') return;
    url.searchParams.delete('restore');
    window.history.replaceState(window.history.state, '', url);
    openBusinessWorkspace('delivery');
    setBackupOpenRequest(value => value + 1);
  }, [openBusinessWorkspace]);
  const [pendingCatalog, setPendingCatalog] = useState<CatalogItem | null>(null);
  const pendingPlacement = useRef<{item:CatalogItem;guard:CatalogPlacementGuard;unsubscribe:()=>void}|null>(null);
  const clearPendingPlacement=useCallback(()=>{
    const pending=pendingPlacement.current;pendingPlacement.current=null;
    pending?.unsubscribe();pending?.guard.dispose();setPendingCatalog(null);
  },[]);
  const armPendingPlacement=useCallback((item:CatalogItem):boolean=>{
    if(pendingPlacement.current)return false;
    const guard=capturePlacement();
    const observe=()=>{
      if(pendingPlacement.current?.guard!==guard)return;
      try{guard.assertCurrent();}catch{clearPendingPlacement();notify('场景、楼层或登录状态已变化，待放置物料已取消，请重新选择。','info');}
    };
    const stopLayout=layoutStore.subscribe(observe),stopSession=controller.subscribe(observe);
    pendingPlacement.current={item,guard,unsubscribe:()=>{stopLayout();stopSession();}};
    setPendingCatalog(item);return true;
  },[capturePlacement,clearPendingPlacement,controller]);
  useEffect(()=>()=>{const pending=pendingPlacement.current;pendingPlacement.current=null;pending?.unsubscribe();pending?.guard.dispose();},[]);
  useEffect(()=>{const pending=pendingPlacement.current;if(!pending)return;try{pending.guard.assertCurrent();}catch{clearPendingPlacement();notify('场景、楼层或登录状态已变化，待放置物料已取消，请重新选择。','info');}},[layout,activeFloorIndex,isActive,clearPendingPlacement]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [gameMode, setGameMode] = useState<GameMode>('build');
  const [measurementPoints, setMeasurementPoints] = useState<ReadonlyArray<{ x: number; z: number }>>([]);
  const [wallDraft, setWallDraft] = useState<{ x: number; z: number } | null>(null);
  const [pointerWorld, setPointerWorld] = useState<{ x: number; z: number } | null>(null);
  // 人物路线布点（PEOPLE-04）：画布点击喂给选中人物的 walkRoute。首个路点先落
  // 草稿（单点路线过不了 schema 校验，不能提前写进 item），第二个点起直接提交。
  const [routeDrawItemId, setRouteDrawItemId] = useState<string | null>(null);
  const [routeDraft, setRouteDraft] = useState<{ itemId: string; points: Array<{ x: number; z: number }> } | null>(null);
  const [routeDrawHint, setRouteDrawHint] = useState<string | null>(null);
  // 近景跟拍（PEOPLE-04 后半）：目标 id 只是 UI 态；镜头推进在渲染循环里
  // （three/person-follow），人物被删时由 follow 模块回调收摊。
  const [followPersonId, setFollowPersonId] = useState<string | null>(null);
  // 实景点云实测四至（茶亭实景接线）：splatState 声明在 handleEmptyClick 之后，
  // 布点校验经 ref 读现值（每渲染同步），渲染进 useSceneEffects 时直接传值。
  const splatWalkBoundsRef = useRef<SplatWalkBounds | null>(null);
  // Active transform tool: move (plain drag), rotate or scale dial (#P0-3).
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('move');

  const wallSnapResult = useMemo(() => {
    if (!view.drawWallMode || !pointerWorld) return null;
    return snapWallEndpoint({
      point: pointerWorld,
      existingWalls: activeFloor.interiorWalls ?? [],
      fromPoint: wallDraft,
      roomWidth: layout.width,
      roomDepth: layout.height,
    });
  }, [view.drawWallMode, pointerWorld, activeFloor.interiorWalls, wallDraft, layout.width, layout.height]);

  const highlightedIds = useMemo(() => {
    const normalised = catalogQuery.trim().toLowerCase();
    if (!normalised) return new Set<string>();
    const matches = new Set<string>();
    for (const item of activeFloor.items) {
      if (item.name.toLowerCase().includes(normalised) || item.type.toLowerCase().includes(normalised)) {
        matches.add(item.id);
      }
    }
    return matches;
  }, [catalogQuery, activeFloor.items]);

  const keepOut = useFloorKeepOut(layout, activeFloorIndex);
  const collidingIds = useMemo(() => {
    const matches = new Set<string>();
    for (const item of activeFloor.items) {
      if (structuralItemCollides(item, layout, activeFloorIndex) || hasCollisions(item, activeFloor.items, layout.width, layout.height, { keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls: layout.backendSceneV2 ? [] : activeFloor.interiorWalls })) {
        matches.add(item.id);
      }
    }
    return matches;
  }, [activeFloor.items, activeFloor.interiorWalls, layout, activeFloorIndex, keepOut]);

  const handleEmptyClick = useCallback(
    (x: number, z: number) => {
      if (routeDrawItemId) {
        // 人物路线布点（PEOPLE-04）：与画墙同款「点击布点」。第一个点存草稿，
        // 第二个点起写进 item.walkRoute（路线可视化随布局重建自动出现）。
        // 撤销边界由 useHistory 的自动快照负责（同 addInteriorWall）。
        const item = activeFloor.items.find((candidate) => candidate.id === routeDrawItemId);
        if (!item) {
          setRouteDrawItemId(null);
          setRouteDraft(null);
          setRouteDrawHint(null);
          return;
        }
        const points = routeDraft?.itemId === routeDrawItemId
          ? routeDraft.points
          : item.walkRoute?.points ?? [];
        // 真实景（点云就绪）按点云实测四至校验，与巡游夹取框同一围栏；
        // 无实景退回布局名义矩形（房间中心原点）。
        const problem = splatWalkBoundsRef.current
          ? routePointErrorInRect(points, { x, z }, splatWalkBoundsRef.current)
          : routePointError(points, { x, z }, { width: layout.width, depth: layout.height });
        if (problem) {
          setRouteDrawHint(problem);
          return;
        }
        // 贴障预检（PEOPLE-04 E2E 实踩：距桌沿 0.2m 的路线点会被碰撞推挤钉死、
        // 来回徘徊）：途经点离障碍太近时提示但不阻断——1.2s 受阻掉头仍兜底，
        // 用户可能就是想要贴着桌边走。排除本人（首点尚无路线时自己是静态碰撞盒）。
        const colliders = buildWalkColliders(
          activeFloor.items.filter((candidate) => candidate.id !== routeDrawItemId),
          activeFloor.interiorWalls ?? [],
          { roomWidth: layout.width, roomDepth: layout.height }
        );
        const clearance = walkerClearanceAt(colliders, { x, z }, { roomWidth: layout.width, roomDepth: layout.height });
        setRouteDrawHint(
          clearance < ROUTE_WAYPOINT_CLEARANCE_WARN_M
            ? `途经点距最近障碍约 ${clearance.toFixed(1)}m，行走时可能被推挤折返徘徊，建议离障碍 ${ROUTE_WAYPOINT_CLEARANCE_WARN_M}m 以上。`
            : null
        );
        const next = [...points, { x, z }];
        if (next.length >= 2) {
          actions.updateItem(routeDrawItemId, { walkRoute: { ...(item.walkRoute ?? {}), points: next } });
          setRouteDraft(null);
        } else {
          setRouteDraft({ itemId: routeDrawItemId, points: next });
        }
        return;
      }
      if (view.drawWallMode) {
        const snapped = snapWallEndpoint({
          point: { x, z },
          existingWalls: activeFloor.interiorWalls ?? [],
          fromPoint: wallDraft,
          roomWidth: layout.width,
          roomDepth: layout.height,
        });
        if (!wallDraft) {
          setWallDraft(snapped.point);
          return;
        }
        // Reject zero-length walls (two clicks on the same vertex).
        const length = Math.hypot(snapped.point.x - wallDraft.x, snapped.point.z - wallDraft.z);
        if (length < 0.1) {
          setWallDraft(null);
          return;
        }
        const id = crypto.randomUUID();
        actions.addInteriorWall({
          id,
          x1: wallDraft.x,
          z1: wallDraft.z,
          x2: snapped.point.x,
          z2: snapped.point.z,
        });
        // Chain: keep the just-placed endpoint as the start of the next wall.
        setWallDraft(snapped.point);
        return;
      }
      if (view.measurementMode) {
        setMeasurementPoints((current) => {
          if (current.length >= 2) return [{ x, z }];
          return [...current, { x, z }];
        });
      }
    },
    [
      view.measurementMode,
      view.drawWallMode,
      wallDraft,
      actions,
      activeFloor.interiorWalls,
      layout.width,
      layout.height,
      routeDrawItemId,
      routeDraft,
    ]
  );

  const handleFloorPointerMove = useCallback((x: number, z: number) => {
    setPointerWorld({ x, z });
  }, []);

  const handleFloorPointerLeave = useCallback(() => {
    setPointerWorld(null);
  }, []);

  const stopRouteDraw = useCallback(() => {
    setRouteDrawItemId(null);
    setRouteDraft(null);
    setRouteDrawHint(null);
  }, []);

  // Esc 结束布点；离开属性面板或取消选中时同样收摊（未满两点的草稿直接丢弃）。
  useEffect(() => {
    if (!routeDrawItemId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopRouteDraw();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [routeDrawItemId, stopRouteDraw]);
  useEffect(() => {
    if (routeDrawItemId && leftMode !== 'properties') stopRouteDraw();
  }, [routeDrawItemId, leftMode, stopRouteDraw]);
  useEffect(() => {
    if (routeDrawItemId && selectedItemId !== routeDrawItemId) stopRouteDraw();
  }, [routeDrawItemId, selectedItemId, stopRouteDraw]);

  const toggleRouteDraw = useCallback(() => {
    if (routeDrawItemId) {
      stopRouteDraw();
      return;
    }
    if (!selectedItemId) return;
    const item = activeFloor.items.find((candidate) => candidate.id === selectedItemId);
    if (!item || item.type !== 'person') return;
    setRouteDrawItemId(selectedItemId);
    // 已有路线就在末点续画；无路线从空草稿起步。
    setRouteDraft(item.walkRoute ? null : { itemId: selectedItemId, points: [] });
    setRouteDrawHint(null);
  }, [routeDrawItemId, selectedItemId, activeFloor.items, stopRouteDraw]);

  const undoRoutePoint = useCallback(() => {
    if (!routeDrawItemId) return;
    const item = activeFloor.items.find((candidate) => candidate.id === routeDrawItemId);
    if (!item) {
      stopRouteDraw();
      return;
    }
    if (routeDraft?.itemId === routeDrawItemId && routeDraft.points.length > 0) {
      setRouteDraft({ itemId: routeDrawItemId, points: routeDraft.points.slice(0, -1) });
      return;
    }
    const points = item.walkRoute?.points ?? [];
    if (points.length === 0) return;
    if (points.length <= 2) {
      // 撤到不足两点：整条路线随存档规则一起撤销，首点退回草稿方便重画。
      actions.updateItem(routeDrawItemId, { walkRoute: undefined } as unknown as Partial<FurnitureItem>);
      setRouteDraft({ itemId: routeDrawItemId, points: [points[0]!] });
    } else {
      actions.updateItem(routeDrawItemId, { walkRoute: { ...(item.walkRoute ?? {}), points: points.slice(0, -1) } });
    }
  }, [routeDrawItemId, routeDraft, activeFloor.items, actions, stopRouteDraw]);

  // 近景跟拍（PEOPLE-04 后半）：toggle 一名人物的跟随镜头。人物被删时
  // three/person-follow 检测到目标消失自动退出并回调清 UI 态。
  const toggleFollowPerson = useCallback((itemId: string) => {
    if (followPersonId === itemId) {
      setPersonFollowTarget(null);
      setFollowPersonId(null);
      return;
    }
    setPersonFollowTarget(itemId, () => setFollowPersonId(null));
    setFollowPersonId(itemId);
    // 跟拍是 3D 视角的事：停在 2D 平面图上看不到，切回 3D。
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
  }, [followPersonId]);

  // Reset wall draft + wall selection whenever draw mode flips off.
  useEffect(() => {
    if (!view.drawWallMode) {
      setWallDraft(null);
      setSelectedWall(null);
      setPointerWorld(null);
    }
  }, [view.drawWallMode]);

  // Floor switch: drop any in-progress wall draft and selection (those live on
  // the previous floor).
  useEffect(() => {
    setWallDraft(null);
    setSelectedItemId(null);
    setSelectedWall(null);
    setExtraSelectedIds(new Set());
    // Points are floor-plane coordinates; kept, they'd float on the new floor
    // showing a distance measured on the old one (#224).
    setMeasurementPoints([]);
    // activeFloor.id: removing floor 0 (or reordering) can change WHICH floor
    // is active while the index stays 0 — keying on the index alone carried
    // the deleted floor's selection onto its replacement (#117).
  }, [activeFloorIndex, activeFloor.id]);

  // Slide the camera target to mid-height of the active storey — on a floor
  // switch, and when a storey height below or on it changes (#202), without
  // the selection reset above.
  const cameraTargetY = activeFloorY + activeStoreyHeight / 2;
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const newTargetY = cameraTargetY;
    const dy = newTargetY - controls.target.y;
    if (Math.abs(dy) < 0.01) return;
    // Keep the orbit target on the new storey even mid-walkthrough, so the
    // orbit camera aims right after an exit — but never touch the camera or
    // run controls.update() while walkthrough owns it: update() has no
    // `enabled` guard, so it re-aims the first-person camera at the orbit
    // target and clamps it back into the polar cone (#114/#216). Walkthrough
    // owns its own eye height.
    controls.target.y = newTargetY;
    if (!walkthroughActive) {
      camera.position.y += dy;
      controls.update();
    }
    // Defer painting to the next frame via invalidate(): a synchronous
    // renderer.render here ran BEFORE the scene effects rebuilt the new
    // floor, flashing the old floor's contents from the new camera (#216).
    invalidate();
    // The scene refs/invalidate are declared below (useThreeScene) so they
    // can't appear in this dep array without a TDZ error; they're stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraTargetY, walkthroughActive]);

  // Ghost-selection guard: whenever the floor's items change (undo/redo,
  // import, clear floor, deletes from any path), drop selected ids that no
  // longer exist; a vanished primary promotes the first surviving extra (#117).
  useEffect(() => {
    const ids = new Set(activeFloor.items.map((item) => item.id));
    const primaryGone = selectedItemId !== null && !ids.has(selectedItemId);
    const hasStaleExtras = Array.from(extraSelectedIds).some((id) => !ids.has(id));
    if (!primaryGone && !hasStaleExtras) return;
    const liveExtras = Array.from(extraSelectedIds).filter((id) => ids.has(id));
    if (primaryGone) setSelectedItemId(liveExtras.shift() ?? null);
    setExtraSelectedIds(new Set(liveExtras));
  }, [activeFloor.items, selectedItemId, extraSelectedIds]);

  // Same guard for a selected interior wall: undo/redo past its creation (or
  // any path that removes it) would otherwise leave the paint panel open and
  // dispatching against a wall that no longer exists (#224).
  useEffect(() => {
    if (selectedWall?.kind !== 'interior') return;
    const exists = (activeFloor.interiorWalls ?? []).some((wall) => wall.id === selectedWall.id);
    if (!exists) setSelectedWall(null);
  }, [activeFloor.interiorWalls, selectedWall]);

  // Make `id` the sole selection (null clears). The one way panels set a
  // primary — pairing the two setters at every call site is how stale extras
  // leaked into later group operations (#117).
  // 属性面板只由明确的动作打开：画布上双击物料、工具轨的「选中物料」、
  // 图层里点物料行、「定位」这类「跳到这一件」的入口。普通单击选中与从物料库
  // 放置都只改选中态，不掀左栏（左栏本身也只由按钮开合，见 closeLeftPanel）。
  const inspectSelection = useCallback(() => {
    setLeftMode('properties');
    if (window.innerWidth <= 1080) setConversationCloseRequest(value => value + 1);
  }, []);
  const selectOnly = useCallback<SelectionContextValue['selectOnly']>((id, options) => {
    setSelectedItemId(id);
    setExtraSelectedIds((extras) => (extras.size === 0 ? extras : new Set()));
    if (id && !options?.keepPanel) inspectSelection();
  }, [inspectSelection]);

  // 双击画布里的物料才打开属性面板：先把这件设成唯一选中（双击落在多选里时，
  // 面板要显示的是被点的那一件），再掀左栏。两个视图的命中都由拾取层报上来。
  const openPropertiesForItem = useCallback((id: string) => {
    if (!view.selectMode) return;
    selectOnly(id);
    setLeftMode('properties');
    setSidebarCollapsed(true);
    setSidePanel(null);
    setAgentCollapsed(false);
  }, [selectOnly, view.selectMode]);

  // A whole-layout replacement (import, share/local hydration, adopting
  // another tab's save) invalidates every piece of transient selection state,
  // not just the item ids (#224).
  const clearTransientSelection = useCallback(() => {
    selectOnly(null);
    setSelectedWall(null);
    setMeasurementPoints([]);
  }, [selectOnly]);

  // Plain reads + flat setter calls. The previous version computed the
  // promotion inside a nested setState updater and read the result back
  // synchronously — that only works on React's eager-evaluation path, and
  // StrictMode's double-invoked updaters ran the toggle twice (#117).
  //
  // Persistent groups (#154) expand HERE, not in the canvas handlers: both
  // the 3D raycast and the 2D hit-test report the clicked id and modifier,
  // and this one place turns a grouped id into its whole group, so the two
  // views can't drift. 'replace' selects the group with the clicked member
  // as primary; 'toggle' adds or removes the whole group; 'single'
  // (Alt+click) is the escape hatch that picks one member on its own.
  const handleSelect = useCallback(
    (id: string, mode: 'replace' | 'toggle' | 'single') => {
      // 选择工具被关掉时画布只浏览，不抓物料。
      if (!view.selectMode) return;
      const members = mode === 'single' ? new Set([id]) : expandSelection(activeFloor.items, id);
      if (mode !== 'toggle') {
        if (members.size === 1) {
          selectOnly(id, { keepPanel: true });
          return;
        }
        setSelectedItemId(id);
        const extras = new Set(members);
        extras.delete(id);
        setExtraSelectedIds(extras);
        return;
      }
      if (selectedItemId === null) {
        setSelectedItemId(id);
        const extras = new Set(members);
        extras.delete(id);
        setExtraSelectedIds(extras);
        return;
      }
      const allIn = Array.from(members).every(
        (member) => member === selectedItemId || extraSelectedIds.has(member)
      );
      const next = new Set(extraSelectedIds);
      if (allIn) {
        // Toggling off: drop every member. If the primary was among them,
        // promote a surviving extra (keeping the rest of the multi-select
        // intact) or clear the selection entirely.
        for (const member of members) next.delete(member);
        if (members.has(selectedItemId)) {
          const [promoted] = next;
          if (promoted === undefined) {
            setSelectedItemId(null);
            setExtraSelectedIds(new Set());
            return;
          }
          next.delete(promoted);
          setSelectedItemId(promoted);
        }
        setExtraSelectedIds(next);
        return;
      }
      for (const member of members) {
        if (member !== selectedItemId) next.add(member);
      }
      setExtraSelectedIds(next);
    },
    [activeFloor.items, selectedItemId, extraSelectedIds, selectOnly, view.selectMode]
  );

  const allSelectedIds = useMemo(() => {
    const set = new Set(extraSelectedIds);
    if (selectedItemId) set.add(selectedItemId);
    return set;
  }, [selectedItemId, extraSelectedIds]);

  // Persistent groups (#154). Group merges whatever is selected — members of
  // other groups included — into one fresh group; Ungroup frees every
  // selected item. The selection itself is untouched either way, so a
  // freshly grouped set stays selected and draggable.
  const selectionIsGroup = useMemo(
    () => isWholeGroup(activeFloor.items, allSelectedIds),
    [activeFloor.items, allSelectedIds]
  );
  const selectionHasGroups = useMemo(
    () => groupIdsIn(activeFloor.items, allSelectedIds).size > 0,
    [activeFloor.items, allSelectedIds]
  );
  const groupSelection = useCallback(() => {
    if (allSelectedIds.size < 2) return;
    actions.setGroup(allSelectedIds);
  }, [actions, allSelectedIds]);
  const ungroupSelection = useCallback(() => {
    actions.clearGroup(allSelectedIds);
  }, [actions, allSelectedIds]);

  // Custom sets (#302): the selection, normalised around its centroid, under
  // a name the user picks — typed into the selection chip (#374). Groups
  // inside it are kept and come back as fresh groups when the set is placed.
  const saveSelectionAsSet = useCallback((name: string) => {
    const items = activeFloor.items.filter((item) => allSelectedIds.has(item.id));
    if (items.length < 2 || !name.trim()) return false;
    const saved = saveCustomSet(items, name, { idTag: randomSuffix() });
    if (!saved) {
      notify('浏览器本机存储已满，组合没能保存。', 'error');
      return false;
    }
    notify(`已把「${saved.name}」存为组合。`, 'success');
    playCue('success');
    return true;
  }, [activeFloor.items, allSelectedIds, playCue]);

  // The recess's span of the front wall on this storey; openings settle on
  // its piers (#394). Memoised on what the recess is fitted to.
  const { width: lotWidth, height: lotDepth, terrain, entrance, floors } = layout;
  const frontGap = useMemo(
    () => entrancePlanOutline({ width: lotWidth, height: lotDepth, terrain, entrance, floors }, activeFloorIndex),
    [lotWidth, lotDepth, terrain, entrance, floors, activeFloorIndex]
  );

  const {
    sceneBoxRef,
    invalidateBoxRef,
    handleDragStart,
    handleDrag,
    handleDragEnd,
    handleDragCancel,
    isDragActive,
  } = useItemDrag({
    layout,
    activeFloor,
    activeFloorIndex,
    roomWidth: layout.width,
    roomDepth: layout.height,
    keepOut,
    frontGap,
    actions,
    allSelectedIds,
    gizmoMode,
    onScaleLimit: (limit) =>
      notify(
        limit === 'max'
          ? '已到放大上限（5×），继续拖动不会再变大。'
          : '已到缩小下限（0.2×），继续拖动不会再变小。'
      ),
  });

  // Canvas gestures can outlive the DOM node until React effect cleanup.
  // Never let a late pointer event from a previous activity/floor reach the
  // state-changing drag callbacks, even before the next render is committed.
  const dragAuthority=useRef<{id:string;activity:ActivitySessionToken;floor:FloorSessionToken}|null>(null);
  const dragCancelRef=useRef(handleDragCancel);dragCancelRef.current=handleDragCancel;
  const scopedDragStart=useCallback((id:string)=>{
    const floor=floorSession.capture();
    if(!sessionToken||!activitySession.isCurrent(sessionToken)||!floor||!floorSession.isCurrent(floor))return;
    dragAuthority.current={id,activity:sessionToken,floor};handleDragStart(id);
  },[sessionToken,activitySession.isCurrent,floorSession.capture,floorSession.isCurrent,handleDragStart]);
  const scopedDragMove=useCallback((id:string,x:number,z:number)=>{
    const authority=dragAuthority.current;if(!authority||authority.id!==id)return;
    if(!activitySession.isCurrent(authority.activity)||!floorSession.isCurrent(authority.floor)){
      dragAuthority.current=null;handleDragCancel(id);return;
    }
    handleDrag(id,x,z);
  },[activitySession.isCurrent,floorSession.isCurrent,handleDrag,handleDragCancel]);
  const scopedDragCancel=useCallback((id:string,options?:Parameters<typeof handleDragCancel>[1])=>{
    const authority=dragAuthority.current;if(!authority||authority.id!==id)return;
    const current=activitySession.isCurrent(authority.activity)&&floorSession.isCurrent(authority.floor);
    dragAuthority.current=null;handleDragCancel(id,current?options:undefined);
  },[activitySession.isCurrent,floorSession.isCurrent,handleDragCancel]);
  useEffect(()=>{
    const token=sessionToken;
    return ()=>{const authority=dragAuthority.current;if(!token||!authority||authority.activity.scope!==token.scope||authority.activity.epoch!==token.epoch)return;dragAuthority.current=null;dragCancelRef.current(authority.id);};
  },[sessionToken?.scope,sessionToken?.epoch]);

  // Re-seat a wall-mounted camera against its wall. A flush camera's body moves
  // to whichever side it faces (so the body + cone start at the wall surface
  // instead of passing through it); a bracketed camera stands off the wall by a
  // fixed arm, independent of facing, so it can pan freely. `bracket` overrides
  // the stored flag for the moment a user toggles the mount style.
  const reseatCamera = useCallback(
    (id: string, rotation: number, bracket?: boolean) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type !== 'security-camera' || !item.position) return;
      const bracketed = bracket ?? item.cameraBracket ?? false;
      const pos = reseatWallMountedItem({
        position: item.position,
        itemWidth: item.width,
        itemDepth: item.depth,
        roomWidth: layout.width,
        roomDepth: layout.height,
        interiorWalls: activeFloor.interiorWalls ?? [],
        rotation,
        ...(bracketed ? { bracketArm: CAMERA_BRACKET_ARM } : {}),
      });
      actions.moveItem(id, pos.x, pos.z);
    },
    [activeFloor.items, activeFloor.interiorWalls, layout.width, layout.height, actions]
  );

  // Locked items are immune to rotation — group rotates orbit items around
  // the centroid, so rotating a set containing a locked item would move it
  // (#115). The unlocked subset still rotates about its own centroid.
  const unlockedSelectedIds = useCallback(() => {
    const lockedIds = new Set(activeFloor.items.filter((item) => item.locked).map((item) => item.id));
    return new Set(Array.from(allSelectedIds).filter((id) => !lockedIds.has(id)));
  }, [activeFloor.items, allSelectedIds]);

  // Returns whether anything actually rotated, so callers only play the
  // rotate cue for a real rotation — a locked item's no-op used to chime
  // anyway, audibly lying about what happened (#209).
  const rotateItemHandler = useCallback(
    (id: string): boolean => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
        const unlocked = unlockedSelectedIds();
        if (unlocked.size === 0) return false;
        actions.rotateSelection(unlocked, Math.PI / 2);
        return true;
      }
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (!item || item.locked) return false;
      if (item.type === 'security-camera') {
        // A flush camera can only face into the room or straight out, so Rotate
        // flips 180° along its wall's in/out axis. A bracketed camera pans freely.
        const step = item.cameraBracket ? Math.PI / 2 : Math.PI;
        const next = ((item.rotation ?? 0) + step) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
        return true;
      }
      const next = ((item.rotation ?? 0) + Math.PI / 2) % (Math.PI * 2);
      actions.setRotation(id, next);
      return true;
    },
    [allSelectedIds, unlockedSelectedIds, activeFloor.items, actions, reseatCamera]
  );

  // Toggle a camera's stand-off bracket. Enabling it keeps the current facing
  // and lifts the camera onto the arm; disabling it snaps the camera back flush
  // and re-locks facing to the wall's inward normal.
  const toggleCameraBracket = useCallback(
    (id: string) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type !== 'security-camera') return;
      // The toggle moves the camera on/off its arm; a locked camera must not
      // move — and the reducer would now refuse the setRotation/moveItem half
      // anyway, leaving the bracket flag desynced from the position (#209).
      if (item.locked) return;
      const next = !item.cameraBracket;
      actions.updateItem(id, { cameraBracket: next });
      const rotation = next ? item.rotation ?? 0 : item.wallRotation ?? item.rotation ?? 0;
      if (!next) actions.setRotation(id, rotation);
      reseatCamera(id, rotation, next);
    },
    [activeFloor.items, actions, reseatCamera]
  );

  const history = useHistory(layout, useCallback(
    (snapshot: RoomLayout) => {
      applyVenueHistorySnapshot(snapshot, venueByLayoutRef.current, () => layoutStore.getState().layout,
        actions.applyLayout, () => environmentsRef.current[0]?.assetId,
        (scan, previousLayout) => restoreVenueFromHistoryRef.current(scan, previousLayout));
    },
    [actions]
  ), {canApply: snapshot => {
    if(!workspaceWriteGuards)return true;
    try { workspaceWriteGuards.assertLayoutWrite(); } catch { notify('本机编辑权已失效，历史方案未应用。','error');return false; }
    if(!environmentPreferenceReadyRef.current || pendingEnvironmentPositionRef.current){notify('场地资料尚待核对，历史方案未应用。','error');return false;}
    const venue=venueByLayoutRef.current.get(snapshot) ?? snapshot.venueScan;
    const current=environmentsRef.current[0];
    if((venue?.assetId ?? null)!==(current?.assetId ?? null)) {
      notify('历史方案涉及不同场地或场地来源不明，暂不能切换；当前布局与历史已保留。','error');return false;
    }
    return true;
  }});
  // The stable callbacks, so the wrappers below don't change identity every
  // time canUndo/canRedo flips.
  const { commitNow: commitHistoryNow, clear: clearHistory } = history;

  // Wrap layout actions with the side-effect of clearing the selection when
  // the targeted item disappears. Discrete actions (delete, duplicate, add,
  // paste) each get an undo step of their own (#425).
  const removeItem = useCallback(
    (id: string) => {
      if (activeFloor.items.find(item => item.id === id)?.locked) return;
      commitHistoryNow();
      actions.removeItem(id);
      playCue('remove');
      setSelectedItemId((current) => (current === id ? null : current));
      setExtraSelectedIds((extras) => {
        if (!extras.has(id)) return extras;
        const next = new Set(extras);
        next.delete(id);
        return next;
      });
    },
    [actions, activeFloor.items, commitHistoryNow, playCue]
  );

  const removeSelected = useCallback(() => {
    if (allSelectedIds.size === 0) return;
    const remaining = activeFloor.items.filter((item) => item.locked || !allSelectedIds.has(item.id));
    if (remaining.length === activeFloor.items.length) return;
    commitHistoryNow();
    actions.replaceItems(remaining);
    setSelectedItemId(null);
    setExtraSelectedIds(new Set());
  }, [actions, commitHistoryNow, activeFloor.items, allSelectedIds]);

  // Duplicate the current selection. For a multi-select every selected item is
  // copied (each offset by the reducer) and the copies become the new
  // selection, so the result is a clean set of duplicates rather than one new
  // copy mixed in with the stale originals' ids.
  const duplicateSelected = useCallback(
    (primaryId: string) => {
      const originals = allSelectedIds.has(primaryId) ? [primaryId, ...Array.from(allSelectedIds).filter(id => id !== primaryId)] : [primaryId];
      const ids = originals.map(() => crypto.randomUUID());
      const extra = activeFloor.items.filter(item => originals.includes(item.id));
      if (materialCount(activeFloor.items) + materialCount(extra) > editorItemLimit(layout)) { notify(`当前场景最多支持 ${editorItemLimit(layout)} 件物料。`, 'info'); return; }
      let candidate = { layout, activeFloorIndex };
      for (let index = 0; index < originals.length; index++) {
        const next = layoutReducer(candidate, {type:'duplicateItem',sourceId:originals[index]!,newId:ids[index]!});
        if (next === candidate) { notify('复制位置与结构冲突，整组未复制。', 'info'); return; }
        candidate = next;
      }
      commitHistoryNow();
      actions.replaceItems(candidate.layout.floors[activeFloorIndex]!.items);
      selectOnly(ids[0]!);
      setExtraSelectedIds(new Set(ids.slice(1)));
    },
    [actions, activeFloor.items, layout, activeFloorIndex, commitHistoryNow, allSelectedIds, selectOnly]
  );

  // Align / distribute the current multi-select (#P0-3). Candidate geometry is
  // checked first so an align that would push a piece out of bounds fails
  // loudly instead of silently clipping it.
  const applyAlignedPositions = useCallback(
    (positions: Map<string, { x: number; z: number }>) => {
      // Distribute only moves the in-between items, so a valid 3-item
      // distribute yields a single entry; only an empty map means "nothing to
      // do" (already evenly spaced).
      if (positions.size === 0) return;
      const candidate = {
        ...layout,
        floors: layout.floors.map((floor, index) =>
          index === activeFloorIndex
            ? {
                ...floor,
                items: floor.items.map((item) => {
                  const next = positions.get(item.id);
                  return next ? { ...item, position: next } : item;
                }),
              }
            : floor
        ),
      };
      if (!canApplyLayoutGeometry(layout, candidate)) {
        notify('对齐后超出场地范围，已取消。', 'info');
        return;
      }
      commitHistoryNow();
      actions.bulkSetPositions(positions);
    },
    [layout, activeFloorIndex, commitHistoryNow, actions]
  );

  const alignSelected = useCallback(
    (edge: AlignEdge) => {
      const positions = alignSelection(activeFloor.items, allSelectedIds, edge);
      applyAlignedPositions(positions);
    },
    [activeFloor.items, allSelectedIds, applyAlignedPositions]
  );

  const distributeSelected = useCallback(
    (axis: DistributeAxis) => {
      // The guard counts the selection, not the result: three items distribute
      // to one moved (the middle), which used to be rejected as "too few".
      const eligible = activeFloor.items.filter(
        (item) => allSelectedIds.has(item.id) && item.position
      ).length;
      if (eligible < 3) {
        notify('等距分布至少需要三件物料。', 'info');
        return;
      }
      const positions = distributeSelection(activeFloor.items, allSelectedIds, axis);
      // Already evenly spaced: don't open an undo entry that changes nothing.
      if (positions.size === 0) return;
      applyAlignedPositions(positions);
    },
    [activeFloor.items, allSelectedIds, applyAlignedPositions]
  );

  // 2D marquee: enters through one call so the selection state stays in one
  // place (the same handleSelect path Shift-click uses).
  const handleMarqueeSelect = useCallback(
    (ids: string[], additive: boolean) => {
      if (ids.length === 0) {
        if (!additive) {
          setSelectedItemId(null);
          setExtraSelectedIds(new Set());
        }
        return;
      }
      if (additive && selectedItemId) {
        if (ids.includes(selectedItemId)) return;
        setExtraSelectedIds((extras) => {
          const next = new Set(extras);
          for (const id of ids) next.add(id);
          return next;
        });
        return;
      }
      selectOnly(ids[0]!, { keepPanel: true });
      setExtraSelectedIds(new Set(ids.slice(1)));
    },
    [selectedItemId, selectOnly]
  );

  // Every gesture ends with its own undo step: the pre-gesture snapshot is
  // forced before the committed change lands. That keeps a quick drag right
  // after placing from merging with the placement (#P0-3).
  const handleDragEndWithHistory = useCallback(
    (id: string) => {
      const authority=dragAuthority.current;if(!authority||authority.id!==id)return;
      if(!activitySession.isCurrent(authority.activity)||!floorSession.isCurrent(authority.floor)){
        dragAuthority.current=null;handleDragCancel(id);return;
      }
      dragAuthority.current=null;
      commitHistoryNow();
      handleDragEnd(id);
    },
    [activitySession.isCurrent,floorSession.isCurrent,commitHistoryNow,handleDragEnd,handleDragCancel]
  );

  const { lastSavedAt, saving: isSaving, saveError, remoteLayout, clearRemoteLayout, reopenRemoteLayout, externalConflict, hasRemoteCandidate, acknowledgeRestoredLayout, ensurePersistentIdentity, persistVerifiedLayout, flushPendingBeforeSwitch, interruptedDrafts, downloadInterruptedDraft } = useLayoutPersistence({
    layout,
    layoutSource:layoutStore,
    ...(workspaceWriteGuards ? { assertWriteLease: workspaceWriteGuards.assertLayoutWrite, localWriteCapability: workspaceWriteGuards.capability } : {}),
    onHydrate: useCallback(
      (saved: RoomLayout) => {
        actions.applyLayout(saved);
        clearTransientSelection();
        // The store dispatch is synchronous, so this is the exact (normalised)
        // layout the next render shows — an explicit baseline (#354).
        clearHistory(layoutStore.getState().layout);
      },
      [actions, clearHistory, clearTransientSelection]
    ),
  });

  // Adopt the snapshot another tab saved (#123). Deliberately a plain
  // applyLayout, not the hydrate path: it lands as a normal history entry, so
  // switching to the other tab's version is one Ctrl+Z away from being undone.
  const adoptRemoteLayout = useCallback(() => {
    if (!remoteLayout) return;
    if(!activitySession.isCurrent(sessionToken)||layoutStore.getState().layout!==layout){notify('活动已变化，请重新核对更新。','error');return;}
    try { applyGuardedWorkspaceReplacement(layout, workspaceWriteGuards?.assertLayoutWrite, () => actions.applyLayout(remoteLayout), workspaceWriteGuards?.capability); }
    catch (error) { notify(error instanceof Error ? error.message : '本机编辑权不可用，未切换布局。', 'error'); return; }
    clearTransientSelection();
    clearRemoteLayout();
  }, [remoteLayout, layout, actions, clearTransientSelection, clearRemoteLayout, workspaceWriteGuards,activitySession.isCurrent,sessionToken]);

  const selectedItem = useMemo(
    () => (selectedItemId ? activeFloor.items.find((item) => item.id === selectedItemId) ?? null : null),
    [activeFloor.items, selectedItemId]
  );
  const selectedObjectId = selectedItem?.id;
  // 选中变化只负责让开物料库抽屉，不再把左栏拧到「选中物料」——属性面板由双击、
  // 工具轨那颗按钮或图层/定位入口打开，面板已经开着时它自然跟着当前选中项走。
  // 以前这个 effect 也听 leftMode，于是点工具轨的「活动需求」刚把左栏切成活动资料，
  // 它就又按着选中项拧回「选中物料」——那颗按钮等于没接上。
  const lastSelectedObjectId = useRef<string | null | undefined>(null);
  useEffect(() => {
    if (lastSelectedObjectId.current === selectedObjectId) return;
    lastSelectedObjectId.current = selectedObjectId;
    if (selectedObjectId) return;
    // 取消选中后属性面板没有内容。简报已挂顶栏，左栏收起，不再退回那张卡。
    if (leftMode === 'properties') { setLeftMode('brief'); setSidebarCollapsed(true); }
  }, [selectedObjectId, leftMode]);

  const hasSignalItems = useMemo(
    () => activeFloor.items.some((item) => item.isWiFiAccessPoint || item.isCCTV),
    [activeFloor.items]
  );

  const buildingCost = useMemo(
    () => totalCost(layout.floors.flatMap((floor) => floor.items)),
    [layout.floors]
  );

  const { snapPosition, getDragPlaneY, placeCatalogItem } = useItemPlacement({
    layout,
    activeFloor,
    activeFloorY,
    roomWidth: layout.width,
    roomDepth: layout.height,
    buildingCost,
    actions,
    view,
    allSelectedIds,
    frontGap,
  });

  const deselectAll = useCallback(() => selectOnly(null), [selectOnly]);

  const placeDiscrete = useCallback(
    (catalogItem: CatalogItem, position?: { x: number; z: number }): string => {
      const pending=pendingPlacement.current;
      if(pending){
        try{pending.guard.assertCurrent();}catch{clearPendingPlacement();notify('场景、楼层或登录状态已变化，待放置物料已取消，请重新选择。','info');return '';}
        if(!position||pending.item!==catalogItem){notify('请先放置或取消当前待放置物料。','info');return '';}
      }
      const current=layoutStore.getState(),currentLayout=current.layout,currentFloor=currentLayout.floors[current.activeFloorIndex];
      if(!currentFloor){notify('当前楼层无法读取，请重新选择。','info');return '';}
      if (materialCount(currentFloor.items) >= editorItemLimit(currentLayout)) { notify(`当前场景最多支持 ${editorItemLimit(currentLayout)} 件物料。`, 'info'); return ''; }
      // M2 命令门（P0-1）：普通家具在落盘前过一次几何判据；门洞 / 窗 / 摄像机 / 户外件
      // 在 useItemPlacement 内部有自己的 snap 与 canApplyLayoutGeometry 兜底，这里不重复预判。
      const bypassCommandGate = isOpening(catalogItem.type)
        || catalogItem.type === 'security-camera'
        || catalogItem.category === 'outdoor';
      if (!bypassCommandGate) {
        const resolved=resolveCatalogPosition(currentLayout,current.activeFloorIndex,catalogItem,`__trial_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,position);
        if (!resolved.ok) {
          const entry: OutcomeEntry<FurnitureItem> = {
            item: resolved.item,reason:resolved.reason,code:resolved.code,
          };
          notify(`「${catalogItem.name}」没放成：${entry.reason}`, 'info');
          applyOutcome(combineOutcomes(
            lastOutcomeRef.current ?? { placed: [], refused: [], skipped: [] },
            { placed: [], refused: [entry], skipped: [] },
          ));
          if(!pending)armPendingPlacement(catalogItem);
          return '';
        }
        if(layoutStore.getState()!==current){notify('场景已变化，请重新选择放置位置。','info');return '';}
        if(pending)clearPendingPlacement();
        commitHistoryNow();
        const id=actions.addCatalogItem(catalogItem,resolved.position);
        if(!layoutStore.getState().layout.floors[current.activeFloorIndex]?.items.some(item=>item.id===id)){
          if(!pendingPlacement.current)armPendingPlacement(catalogItem);
          notify('物料未放入画布，请点击场地选择位置。','info');return '';
        }
        actions.setLocked(id,false);
        actions.updateItem(id,{provenance:{source:'human',opId:`manual-${Date.now()}-${Math.random().toString(36).slice(2,7)}`}});
        return id;
      }
      // Wall-mounted/outdoor placement uses the hook's render-bound geometry;
      // do not let a stale closure place into a newer scene.
      if(currentLayout!==layout||current.activeFloorIndex!==activeFloorIndex){notify('场景已变化，请重新选择物料。','info');return '';}
      if(pending)clearPendingPlacement();
      commitHistoryNow();
      const id = placeCatalogItem(catalogItem, position);
      if (!id) { armPendingPlacement(catalogItem); notify('此处与结构相交，请点击场地中的其他位置放置。', 'info'); }
      else {
        // M6 provenance：手动放的件打上 human 标签，方便 handoff / 审校卡区分 AI 与人工。
        actions.updateItem(id, {
          provenance: { source: 'human', opId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
        });
      }
      return id;
    },
    [commitHistoryNow, placeCatalogItem, layout, activeFloorIndex, actions, applyOutcome,armPendingPlacement,clearPendingPlacement]
  );

  // Keyboard placement (#168): Enter on a catalog tile places through the
  // wrapped `placeCatalogItem` and keeps the item unlocked until Enter/Escape.
  const {
    placingId,
    placeCatalogItem: placeFromCatalog,
    confirmPlacement,
    cancelPlacement,
  } = useKeyboardPlacement({
    layout,
    selectedItemId,
    actions,
    history,
    selectOnly,
    placeCatalogItem: placeDiscrete,
  });
  const placeCatalogItemResult=useCallback((item:CatalogItem):CatalogPlacementResult=>{
    const id=placeFromCatalog(item);
    if(id)return {status:'placed',id};
    if(pendingPlacement.current?.item===item)return {status:'pending'};
    return {status:'failed',message:pendingPlacement.current?'请先放置或取消当前待放置物料。':'物料未添加，请检查场地后重试。'};
  },[placeFromCatalog]);

  // 2D plan select/drag (#219). Reuses use-item-drag's session, so the commit
  // semantics (single dispatch, lock-on-release, wall settling, isDragActive
  // keyboard gate) are identical to a 3D drag.
  const { clientToWorld2D } = useCanvas2DInteraction({
    enabled: view.view2D,
    canvasRef: canvas2DRef,
    layout,
    activeFloor,
    view,
    ...(referenceImage.layer ? { referenceImage: referenceImage.layer } : {}),
    selectedItemId,
    extraSelectedIds,
    allSelectedIds,
    editingLocked: workbenchMode !== 'layout',
    onItemSelect: handleSelect,
    onItemDoubleClick: openPropertiesForItem,
    onDeselect: deselectAll,
    snapPosition,
    onItemDragStart: scopedDragStart,
    onItemDrag: scopedDragMove,
    onItemDragEnd: handleDragEndWithHistory,
    onItemDragCancel: scopedDragCancel,
    gizmoMode,
    onMarqueeSelect: handleMarqueeSelect,
  });

  // 第 10 批「批注→施工」：drawMode != 'off' 时在 2D canvas 上以 capture 阶段接管指针事件。
  // 只在 2D 视图 + 非 off 模式下挂监听；其它时候完全不影响现有点选 / 拖放。
  useEffect(() => {
    const canvas = canvas2DRef.current;
    if (!view.view2D || planAnnot.drawMode === 'off' || !canvas) {
      setDraftPoints(current => current.length ? [] : current);
      return;
    }
    setDraftPoints(current => current.length ? [] : current);

    let zoneStart: PlanPoint | null = null;
    let measureFrom: PlanPoint | null = null;
    const observeAnnotations=process.env.NEXT_PUBLIC_AGENT_ANNOTATION_OBSERVATION==='1';
    let drawingBinding: import('./hooks/use-plan-annotations').UserRouteBinding | null = null;
    const captureDrawingBinding=() => {
      try {
      const activity=sessionToken, floor=floorSession.capture(), venue=routeVenueFacts.capture();
      if(!activity||!floor||!venue||!activitySession.isCurrent(activity)||!floorSession.isCurrent(floor)||!routeVenueFacts.isCurrent(venue))return null;
      const draft=planAnnot.getSnapshot(),draftSignature=JSON.stringify(draft.draft);
      return {floorId:floor.floorId,isCurrent:()=>activitySession.isCurrent(activity)&&floorSession.isCurrent(floor)&&routeVenueFacts.isCurrent(venue),
        isDrawingCurrent:()=>{const now=planAnnot.getSnapshot();return now.revision===draft.revision&&JSON.stringify(now.draft)===draftSignature;}};
      }catch{return null;}
    };
    const route = planAnnot.drawMode === 'route' ? createRouteDrawingSession(captureDrawingBinding,(points,binding)=>planAnnot.addUserRouteFromPoints(points,ANNOTATION_PRESET_LABELS.guest_route,binding)) : null;
    const clearInvalidRoute=()=>{if(route&&!route.revalidate()){setDraftPoints([]);planAnnot.setDrawMode('off');notify('活动、楼层或场地已变化，未完成的路线已取消，请重新绘制。','info');}};
    const unsubscribe=route?layoutStore.subscribe(clearInvalidRoute):()=>{};

    const toWorld = (clientX: number, clientY: number): PlanPoint | null => {
      const p = clientToWorld2D(clientX, clientY);
      if (!p) return null;
      return { x: p.x, z: p.z };
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      e.preventDefault();
      e.stopPropagation();
      if (planAnnot.drawMode === 'zone') {
        if(observeAnnotations){drawingBinding=captureDrawingBinding();
          if(!drawingBinding){notify('活动、楼层或场地无法核对，请重新绘制。','info');return;}}
        zoneStart = w;
        setDraftPoints([w]);
      } else if (planAnnot.drawMode === 'measure') {
        if (!measureFrom) {
          if(observeAnnotations){drawingBinding=captureDrawingBinding();
            if(!drawingBinding){notify('活动、楼层或场地无法核对，请重新绘制。','info');return;}}
          measureFrom = w;
          setDraftPoints([w]);
        } else {
          if(!observeAnnotations)planAnnot.addAnnotationFromPoints([measureFrom,w],'measure','测距');
          else if(!drawingBinding||!planAnnot.addUserAnnotationFromPoints([measureFrom, w], 'measure', '测距',drawingBinding))notify('活动、楼层或场地已变化，测距未保存，请重新绘制。','info');
          drawingBinding=null;
          measureFrom = null;
          setDraftPoints([]);
          planAnnot.setDrawMode('off');
        }
      } else if (planAnnot.drawMode === 'door') {
        // 用户在墙边标注入口位置；门宽与开启方向仍需现场核验。
        // 离四墙都太远时静默不落（保持绘制模式，用户点到墙边再落）；
        // 单击即收（同 measure 的单段语义），Esc/再点标注钮退出。
        const door = pickDoorWallFromPoint(w, { width: layout.width, height: layout.height });
        if (door) {
          if(!observeAnnotations)planAnnot.addDoorAnnotation(door);
          else {const binding=captureDrawingBinding();
            if(!binding||!planAnnot.addUserDoorAnnotation(door,binding))notify('活动、楼层或场地无法核对，入口未保存。','info');}
          setDraftPoints([]);
          planAnnot.setDrawMode('off');
        }
      } else if (planAnnot.drawMode === 'route') {
        const added=route?.add(w);
        if(added==='added')setDraftPoints(route!.points());
        else {setDraftPoints([]);planAnnot.setDrawMode('off');notify('活动、楼层或场地无法核对，路线未保存，请重新绘制。','info');}
      } else if (planAnnot.drawMode === 'fire-route') {
        setDraftPoints((prev) => [...prev, w]);
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (planAnnot.drawMode !== 'zone' || !zoneStart) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      e.preventDefault();
      e.stopPropagation();
      setDraftPoints([zoneStart, w]);
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (planAnnot.drawMode !== 'zone' || !zoneStart) return;
      const w = toWorld(e.clientX, e.clientY);
      e.preventDefault();
      e.stopPropagation();
      if (w && Math.hypot(w.x - zoneStart.x, w.z - zoneStart.z) > 0.1) {
        // 第 11 批：按当前选中的语义类型落标签；画完不退出，可连续画多个框。
        if(!observeAnnotations)planAnnot.addAnnotationFromPoints([zoneStart,w],'zone',ZONE_SEMANTIC_LABELS[zoneType],zoneType);
        else if(!drawingBinding||!planAnnot.addUserAnnotationFromPoints(
          [zoneStart, w],
          'zone',
          ZONE_SEMANTIC_LABELS[zoneType],
          drawingBinding,
          zoneType,
        ))notify('活动、楼层或场地已变化，区域未保存，请重新绘制。','info');
      }
      zoneStart = null;
      drawingBinding=null;
      setDraftPoints([]);
      // 不再 setDrawMode('off')——连续画框；退出靠 Esc 或再点一次标注钮。
    };

    const finishRoute = (): void => {
      if (planAnnot.drawMode === 'fire-route') {
        // 疏散线不走会话制：本机直接落标注（评分层走 GEN-03），落账后退出。
        setDraftPoints((prev) => {
          if (prev.length >= 2) {
            planAnnot.addAnnotationFromPoints(prev, 'route', ANNOTATION_PRESET_LABELS.fire_route);
          }
          // 让 setState 落账后再清空 draftPoints / 退出绘制模式。
          window.setTimeout(() => {
            setDraftPoints([]);
            planAnnot.setDrawMode('off');
          }, 0);
          return prev;
        });
        return;
      }
      const result=route?.finish();
      if(result==='invalidated'||result==='failed')notify('路线的活动、楼层或场地无法核对，请重新绘制。','info');
      setDraftPoints([]);planAnnot.setDrawMode('off');
    };

    const onDoubleClick = (e: MouseEvent): void => {
      if (planAnnot.drawMode !== 'route' && planAnnot.drawMode !== 'fire-route') return;
      e.preventDefault();
      e.stopPropagation();
      finishRoute();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if ((planAnnot.drawMode === 'route' || planAnnot.drawMode === 'fire-route') && e.key === 'Enter') {
        finishRoute();
      }
      // 第 11 批：Esc 随时退出绘制（zone 连续画框时用它收尾）。
      if (e.key === 'Escape' && planAnnot.drawMode !== 'off') {
        route?.cancel();
        planAnnot.setDrawMode('off');
        setDraftPoints([]);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', onPointerUp, true);
    canvas.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      unsubscribe();
      if(route?.points().length){route.cancel();notify('画布状态已变化，未完成的路线已取消，请重新绘制。','info');}
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerup', onPointerUp, true);
      canvas.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [
    view.view2D,
    planAnnot.drawMode,
    clientToWorld2D,
    planAnnot.addUserAnnotationFromPoints,
    planAnnot.addAnnotationFromPoints,
    planAnnot.addUserRouteFromPoints,
    planAnnot.getSnapshot,
    planAnnot.addUserDoorAnnotation,
    planAnnot.addDoorAnnotation,
    planAnnot.setDrawMode,
    sessionToken,
    activitySession.isCurrent,
    floorSession.capture,
    floorSession.isCurrent,
    routeVenueFacts.capture,
    routeVenueFacts.isCurrent,
    zoneType,
    layout.width,
    layout.height,
  ]);

  // canvas 挂载 / 尺寸变化时 bump overlayTick，让 PlanOverlay 用真实 transform 重算。
  useEffect(() => {
    if (!view.view2D) return;
    const canvas = canvas2DRef.current;
    if (!canvas) return;
    setOverlayTick((t) => t + 1);
    const ro = new ResizeObserver(() => setOverlayTick((t) => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [view.view2D,canvas2DRef]);

  // 第 10 批：PlanOverlay 用的真实 fit-and-center 变换（与 render2DTopDown 同源）。
  const overlayTransform: View2DTransform | null = useMemo(() => {
    if (!view.view2D) return null;
    const canvas = canvas2DRef.current;
    if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return null;
    // overlayTick 仅作依赖：canvas 尺寸变化时强制重算。
    void overlayTick;
    try {
      return get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout);
    } catch {
      return null;
    }
  }, [view.view2D, layout, overlayTick, canvas2DRef]);

  // 3DGS 环境预览的渲染入口；useThreeScene 每帧走它，预览关闭时它是空的。
  const splatPaintRef = useRef<SplatPaint | null>(null);
  const environmentPickerRef = useRef<((ray: ThreeNS.Ray) => string | null) | null>(null);
  const environmentSelectionRef = useRef<((assetId: string) => void) | null>(null);

  const { isReady: rendererReady, error, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, worldPositionFromClient } =
    useThreeScene({
      canvasRef,
      // 环境预览开着时，这一帧由点云那条渲染栈先画背景再画本场景；关掉时它自己退回默认渲染。
      renderFrame: (renderer, scene, camera) => {
        const paint = splatPaintRef.current;
        if (paint) paint(renderer, scene, camera);
        else renderer.render(scene, camera);
      },
      onViewportResize: () => frameViewportRef.current(),
      walkthroughActive,
      // The distance tool measures across furniture, so its clicks go to the floor (#341).
      // 人物路线布点同理：绘制中所有点击都落到地面坐标（PEOPLE-04）。
      floorPickOnly: view.drawWallMode || view.measurementMode || routeDrawItemId !== null,
      onItemSelect: handleSelect,
      onItemDoubleClick: openPropertiesForItem,
      selectedIds: allSelectedIds,
      onItemDragStart: scopedDragStart,
      onItemDrag: scopedDragMove,
      onItemDragEnd: handleDragEndWithHistory,
      onItemDragCancel: scopedDragCancel,
      onItemHover: setHover,
      onEmptyClick: handleEmptyClick,
      onEnvironmentPick: ray => {
        const assetId = environmentPickerRef.current?.(ray);
        if (!assetId || assetId === environmentsRef.current[0]?.assetId) return false;
        environmentSelectionRef.current?.(assetId);
        return true;
      },
      editingLocked: workbenchMode !== 'layout',
      onWallSelect: ({ wallId, kind }) => {
        setSelectedWall({ id: wallId, kind });
      },
      // Only track the floor pointer while wall-draw mode consumes it — the
      // handler writes React state per mousemove, re-rendering the whole tree,
      // and the hook skips the floor raycast when the handler is absent.
      ...(view.drawWallMode ? { onFloorPointerMove: handleFloorPointerMove } : {}),
      onFloorPointerLeave: handleFloorPointerLeave,
      snapPosition,
      getDragPlaneY,
      transformMode: gizmoMode,
    });

  // `rendererReady` can briefly describe the previous, now detached canvas
  // while the session-scoped ref has not yet bound to its replacement.
  // Recheck after the canvas commits so React observes the new binding even
  // when the renderer's internal false/true state updates are batched.
  const [,refreshCanvasBinding]=useState(0);
  useEffect(()=>{
    if(!rendererReady)return undefined;
    const frame=requestAnimationFrame(()=>refreshCanvasBinding(value=>value+1));
    return ()=>cancelAnimationFrame(frame);
  },[canvasRef,rendererReady]);
  const isReady=activitySession.isCurrent(sessionToken)&&rendererReady&&!!canvasRef.current&&rendererRef.current?.domElement===canvasRef.current;

  const preserveSplatCameraRef = useRef(false);
  preserveSplatCameraRef.current = walkthroughActive;
  const splatPositionSetterRef=useRef<(position:SplatPosition)=>void>(()=>{});
  const [pendingEnvironmentPosition,setPendingEnvironmentPosition]=useState<PendingEnvironmentWrite|null>(null);
  useEffect(()=>{
    const scope=layout.id??'local';
    return registerReadonlyDraftReader(scope,'environment',()=>{
      const pending=pendingEnvironmentPositionRef.current;
      if(!pending)return {status:'none'};
      const pendingScope=pending.scope.kind==='project'?pending.scope.id:'local';
      return pendingScope===scope?{status:'captured',value:pending.intended}:{status:'none'};
    });
  },[layout.id]);
  // Map geometry and project-library scene positions use different coordinate frames.
  // The library stores display offsets, with no verified map registration yet.
  const mappedWorkspace = !!layout.researchArea || (layout.mapGroundPolygon?.length ?? 0) >= 3;
  const onSplatPositionChange = useCallback((position: SplatPosition) => {
    const current=environmentsRef.current, active=current[0];
    if(!active)return;
    const reset=(value: SplatPosition)=>splatPositionSetterRef.current(value);
    if(!workspaceWriteGuards){
      const next=[{...active,position},...current.slice(1)];environmentsRef.current=next;setEnvironments(next);
      writeEnvironments(layoutStore.getState().layout.id,next);return;
    }
    if(pendingEnvironmentPositionRef.current){
      reset((pendingEnvironmentPositionRef.current.intended?.[0]?.position ?? active.position ?? ZERO_SPLAT_POSITION));
      notify('上次场地位置保存结果尚待核对，请先保留候选，不能重复写入。','error');return;
    }
    const id=layoutStore.getState().layout.id;
    const scope:EnvironmentScope=id?{kind:'project',id}:{kind:'draft'};
    const token=sessionToken;
    const assertCurrent=()=>{
      workspaceWriteGuards.assertLayoutWrite();
      if(!token||!activitySession.isCurrent(token)||layoutStore.getState().layout.id!==id)throw new Error('活动已变化');
    };
    const result=persistEnvironmentPosition({scope,generation:token?.epoch ?? -1,environments:current,assetId:active.assetId,
      position,capability:workspaceWriteGuards.capability,assertCurrent});
    if(result.status==='saved'){
      environmentsRef.current=result.next;setEnvironments(result.next);reset(position);return;
    }
    if(result.status==='uncertain'&&result.pending&&result.next){
      pendingEnvironmentPositionRef.current=result.pending;setPendingEnvironmentPosition(result.pending);
      environmentsRef.current=result.next;setEnvironments(result.next);reset(position);
      notify('场地位置保存结果待核对，已保留候选，暂不重复写入。','error');return;
    }
    reset(active.position ?? ZERO_SPLAT_POSITION);notify(result.reason,'error');
  }, [workspaceWriteGuards,sessionToken,activitySession.isCurrent]);
  const otherSplatScenes = useMemo(() => mappedWorkspace ? [] : environments.slice(1).flatMap(entry => {
    try {
      return [{ id: entry.assetId, source: storedAholoSceneSource(entry.assetId), position: entry.position ?? ZERO_SPLAT_POSITION,
        floorIndex: entry.floorIndex ?? 0, roofCutoffY: floorElevation(layout.floors, (entry.floorIndex ?? 0) + 1) + (entry.position?.y ?? 0) - floorElevation(layout.floors, entry.floorIndex ?? 0) }];
    } catch { return []; }
  }), [mappedWorkspace, environments, layout.floors]);
  // 第 3 步：整景区视距 LOD。锚点 = 点云落位（geo 锚点投影到世界后即环境位移），
  // 距离按锚点 metersPerUnit 折回真实米。MAP-03：凡铺了调研底图（整景区预设、
  // 地名定位、scanAssetId 自动铺图）都启用——概览视距下点云一样不该解码；室内照旧。
  const splatLodAnchor = environment ? {
    x: environment.position?.x ?? 0,
    z: environment.position?.z ?? 0,
  } : null;
  const [isolatedScanId, setIsolatedScanId] = useState<string>();
  const scanIsolated = !!environment && environment.assetId === isolatedScanId;
  const showGaussianInCanvas = !mappedWorkspace || scanIsolated;
  // 左侧「漫游角色」只改 walkRoleId；右侧 tool-walk 用它进出漫游，两边是同一套状态。
  const [walkRoleId, setWalkRoleId] = useState(DEFAULT_WALK_ROLE_ID);
  const walkRole = findWalkRole(walkRoleId);
  const walkRoleUrl = walkRoleGlbUrl(walkRole.assetId);
  const walkRoleReady = walkRole.walkable;
  const canTryHanfuWalk = process.env.NODE_ENV === 'development' && scanIsolated
    && environment.assetId === 'c338f720-3f60-4adb-8f3b-023300000001';
  const [walkViewMode, setWalkViewMode] = useState<WalkViewMode>('third');
  const cycleWalkView = useCallback(() => {
    setWalkViewMode(mode => mode === 'third' ? 'shoulder' : mode === 'shoulder' ? 'first' : 'third');
  }, []);
  // 漫游时左侧物料库是收起的，控制条上留一个换人键，走的时候也能切角色。
  const cycleWalkRole = useCallback(() => {
    const walkable = WALK_ROLES.filter(role => role.walkable);
    const index = walkable.findIndex(role => role.assetId === walkRoleId);
    const next = walkable[(index + 1) % walkable.length];
    if (next) setWalkRoleId(next.assetId);
  }, [walkRoleId]);
  /** 进漫游只有这一条路：右侧按钮、场地卡里的入口都用它。 */
  function startWalk() {
    if (scanIsolated && (splatState.assetId !== isolatedScanId || splatState.status !== 'ready')) {
      notify('等场景加载完成后再试走。', 'error');
      return;
    }
    setWalkViewMode('third');
    if (!scanIsolated && mappedWorkspace) {
      tryMapVenue();
      return;
    }
    requestWalkPointerLock();
    setView(current => ({ ...current, view2D: false, measurementMode: false, drawWallMode: false, drawZoneMode: false, walkthroughMode: true }));
  }
  /** 右侧 tool-walk 与场地卡共用：进 = startWalk（带当前角色），出 = 收漫游。 */
  function toggleWalkthrough(on: boolean) {
    if (on) { startWalk(); return; }
    setView(current => ({ ...current, walkthroughMode: false }));
  }
  const splatLodEnabled = showGaussianInCanvas && !!layout.researchArea && !!environment && !scanIsolated;
  const splatLodMetersPerUnit = sceneAnchorOf(layout)?.metersPerUnit ?? 1;
  const { mode: splatLod, measured: splatLodMeasured } = useSplatLod({
    isReady,
    cameraRef,
    controlsRef,
    anchor: splatLodAnchor,
    metersPerUnit: splatLodMetersPerUnit,
    enabled: splatLodEnabled,
  });
  const { state: splatState, renderFrame: paintSplatFrame, start: startSplat, stop: stopSplat,
    setPosition: setSplatPosition, displayMode: splatDisplayMode, setDisplayMode: setSplatDisplayMode,
    setTransformMode: setSplatTransform, pickScene: pickSplatScene, framePrimaryScene } = useSplatPreview({
    isReady,
    rendererRef,
    cameraRef,
    controlsRef,
    invalidate,
    requestShadowUpdate,
    // 兜底缩放：场景没带真实尺度（lod-meta forwardBox）时，才按场地最长水平边等比塞。
    sizeMeters: Math.max(layout.width, layout.height),
    // 1F exposes the scan by cutting away its roof at the top of 1F; 2F
    // raises the same live cut plane to the top of 2F.
    roofCutoffY: floorElevation(layout.floors, (environment?.floorIndex ?? 0) + 1) + (environment?.position?.y ?? 0) - floorElevation(layout.floors, environment?.floorIndex ?? 0),
    position: environment?.position ?? ZERO_SPLAT_POSITION,
    transformMode: splatTransformMode,
    onPositionChange: onSplatPositionChange,
    calibrationReadOnly: !!workspaceWriteGuards,
    calibrationCapability: workspaceWriteGuards?.capability,
    ...(!scanIsolated ? { otherScenes: otherSplatScenes } : {}),
    activeFloorIndex,
    primaryVisible: showGaussianInCanvas && (environment?.floorIndex ?? 0) === activeFloorIndex && (scanIsolated || splatLod !== 'poi'),
    preserveCameraRef: preserveSplatCameraRef,
  });
  splatPositionSetterRef.current = setSplatPosition;
  const hanfuWalkDisabledReason = splatState.status === 'error' ? '西湖实景加载失败，先重试'
    : splatState.status === 'ready' ? undefined : '等西湖实景加载完成后再试';
  const isolatedScanFailed = scanIsolated && splatState.status === 'error' && splatState.assetId === isolatedScanId;
  const isolatedScanLoading = scanIsolated && splatState.status === 'loading' && splatState.assetId === isolatedScanId;
  useEffect(() => {
    if (scanIsolated && splatState.status === 'ready' && splatState.assetId === isolatedScanId) framePrimaryScene();
  }, [scanIsolated, isolatedScanId, splatState.status, splatState.assetId, framePrimaryScene]);
  environmentPickerRef.current = pickSplatScene;
  // The Gaussian venue and its editable room layout form one placed unit.
  // Apply the venue offset to the main scene too, so walls, floors, furniture,
  // and routes keep their relative positions while the venue is moved.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const position = environment?.position ?? ZERO_SPLAT_POSITION;
    scene.position.set(position.x, position.y, position.z);
    invalidate();
  }, [environment?.position?.x, environment?.position?.y, environment?.position?.z, isReady, sceneRef, invalidate]);
  splatPaintRef.current = paintSplatFrame;
  const restoredEnvironmentRef = useRef('');
  // 遥远视距先记录场景，进入范围后再加载。
  const deferredEnvironmentRef = useRef<StoredEnvironment | null>(null);
  const selectEnvironment = useCallback((assetId: string, name: string, options?: { restoreItems?: boolean; previousLayout?: RoomLayout }) => {
    if(workspaceWriteGuards)throw new Error('当前编辑权模式暂不支持切换场地及其物料，请保留现有资料。');
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    const current = environmentsRef.current;
    if (current[0]?.assetId === assetId) return;
    deferredEnvironmentRef.current = null;
    const liveLayout = options?.previousLayout ?? layoutStore.getState().layout;
    const currentItems = liveLayout.floors.map(floor => floor.items.map(item => ({
      ...item,
      ...(item.position ? { position: { ...item.position } } : {}),
    })));
    const activeAssetId = current[0]?.assetId;
    const withSavedCurrent = current.map(entry => entry.assetId === activeAssetId
      ? { ...entry, itemsByFloor: currentItems }
      : entry);
    const existing = withSavedCurrent.find(entry => entry.assetId === assetId);
    const floorIndex = existing?.floorIndex ?? activeFloorIndex;
    const sameFloorCount = current.filter(entry => (entry.floorIndex ?? 0) === floorIndex && entry.assetId !== assetId).length;
    const stride = Math.max(layout.width, layout.height) + 4;
    const value: StoredEnvironment = existing ?? {
      assetId,
      name,
      floorIndex,
      position: { x: sameFloorCount * stride, y: floorElevation(layout.floors, floorIndex), z: 0 },
      itemsByFloor: currentItems,
    };
    if (existing?.itemsByFloor && options?.restoreItems !== false) {
      actions.applyLayout({
        ...liveLayout,
        floors: liveLayout.floors.map((floor, index) => ({
          ...floor,
          items: existing.itemsByFloor?.[index] ? [...existing.itemsByFloor[index]!] : floor.items,
        })),
      });
    }
    const next = [value, ...withSavedCurrent.filter(entry => entry.assetId !== assetId)];
    actions.setActiveFloorIndex(floorIndex);
    environmentsRef.current = next;
    setEnvironments(next);
    writeEnvironments(liveLayout.id, next);
    restoredEnvironmentRef.current = '';
  }, [actions, activeFloorIndex, layout.floors, layout.height, layout.width, setView, workspaceWriteGuards]);
  const startStoredScene = useCallback((assetId: string) => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    try {
      const source = storedAholoSceneSource(assetId);
      selectEnvironment(assetId, source.name);
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure), 'error');
    }
  }, [selectEnvironment, setView]);
  environmentSelectionRef.current = startStoredScene;
  /** D0：地图立壳后自动挂历史 World .spz（只读 shipped，不扣额度）。 */
  const hangDemoEnvironment = useCallback(() => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    showAgent('space');
    try {
      const source = storedAholoSceneSource(DEMO_WORLD_SCENE_ID);
      selectEnvironment(DEMO_WORLD_SCENE_ID, source.name);
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure), 'error');
    }
  }, [selectEnvironment, setView, showAgent]);
  // 撤销/重做恢复场地：只换场地，物料已经在布局快照里一起退回去了，不再二次覆盖。
  restoreVenueFromHistoryRef.current = (scan, previousLayout) => {
    try {
      selectEnvironment(scan.assetId, scan.name, { restoreItems: false, previousLayout });
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure), 'error');
    }
  };

  // 本场环境按项目记住：新项目首次用 World 高斯样例起步，后续沿用项目选择；
  // 草稿刚绑上云项目时，把草稿里选的那条带过去，不让刚选完就丢。
  const environmentKey = environmentPreferenceKey(layout.id);
  const hasMapVenue = (layout.mapGroundPolygon?.length ?? 0) >= 3;
  environmentsRef.current = environments;
  const environmentKeyRef = useRef<string | null>(null);
  const restoreEnvironment = useCallback((value: StoredEnvironment) => {
    try {
      void startSplat(storedAholoSceneSource(value.assetId));
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure), 'error');
    }
  }, [startSplat]);
  useEffect(() => {
    const previousKey = environmentKeyRef.current;
    environmentKeyRef.current = environmentKey;
    if(previousKey!==environmentKey)environmentPreferenceReadyRef.current=false;
    if (previousKey === environmentKey) return;
    const carried = previousKey === 'draft' ? environmentsRef.current : [];
    if(workspaceWriteGuards){
      const scope:EnvironmentScope=layout.id?{kind:'project',id:layout.id}:{kind:'draft'};
      const result=readEnvironmentsStrict(scope,workspaceWriteGuards.capability);
      if(!result.ok){notify('本机场地资料暂时无法核对，原资料已保留。','error');return;}
      environmentPreferenceReadyRef.current=true;
      const stored=result.snapshot.value;
      const list=Array.isArray(stored)?stored:stored?[stored]:[];
      environmentsRef.current=list;setEnvironments(list);if(!list.length)stopSplat();
      return;
    }
    const hasPreference = hasEnvironmentPreference(layout.id);
    restoredEnvironmentRef.current = '';
    deferredEnvironmentRef.current = null;
    if (hasPreference) {
      const saved = readEnvironments(layout.id);
      const stored = hasMapVenue ? saved.filter(entry => entry.assetId !== DEMO_WORLD_SCENE_ID) : saved;
      if (stored.length !== saved.length) writeEnvironments(layout.id, stored);
      environmentsRef.current = stored;
      setEnvironments(stored);
      if (!stored.length) stopSplat();
      return;
    }
    if (hasMapVenue) {
      environmentsRef.current = [];
      setEnvironments([]);
      stopSplat();
      return;
    }
    if (carried.length) {
      writeEnvironments(layout.id, carried);
      environmentsRef.current = carried;
      setEnvironments(carried);
      return;
    }
    const defaults: StoredEnvironment[] = [{ assetId: DEMO_WORLD_SCENE_ID, name: 'World 高斯空间 · 宴会厅 A', floorIndex: 0,
      position: { x: 0, y: 0, z: 0 } }];
    writeEnvironments(layout.id, defaults);
    environmentsRef.current = defaults;
    setEnvironments(defaults);
  }, [environmentKey, hasMapVenue, layout.id, stopSplat, workspaceWriteGuards]);
  // 渲染器还没起来时 startSplat 会自己排队；同一个项目同一条环境只自动挂一次。
  // 第 3 步：整景区视距（>200 m）下不解码点云，先挂锚点 POI；等到 <100 m 再补挂。
  // 等 splatLodMeasured 才判断，避免相机/控件尚未就绪时把「还没量」误当成近景。
  useEffect(() => {
    if (!environment || !showGaussianInCanvas) return;
    if (!isReady || !splatLodMeasured) return;
    const key = `${environmentKey}:${environment.assetId}`;
    if (restoredEnvironmentRef.current === key) return;
    if (splatLod === 'poi') {
      deferredEnvironmentRef.current = environment;
      return;
    }
    restoredEnvironmentRef.current = key;
    deferredEnvironmentRef.current = null;
    restoreEnvironment(environment);
  }, [environment, environmentKey, restoreEnvironment, isReady, splatLodMeasured, splatLod, showGaussianInCanvas]);
  // 从整景区视距回到 100 m 内：把先前压住的自动挂载补上（只补一次）。
  useEffect(() => {
    if (!showGaussianInCanvas || !isReady || !splatLodMeasured || splatLod !== 'splat') return;
    const deferred = deferredEnvironmentRef.current;
    if (!deferred) return;
    deferredEnvironmentRef.current = null;
    restoredEnvironmentRef.current = `${environmentKey}:${deferred.assetId}`;
    restoreEnvironment(deferred);
  }, [isReady, splatLodMeasured, splatLod, environmentKey, restoreEnvironment, showGaussianInCanvas]);
  const removeEnvironment = useCallback((assetId: string) => {
    if(workspaceWriteGuards){notify('当前编辑权模式暂不支持删除场地，请保留现有资料。','error');return;}
    const next = environmentsRef.current.filter(entry => entry.assetId !== assetId);
    environmentsRef.current = next;
    setEnvironments(next);
    restoredEnvironmentRef.current = '';
    if (deferredEnvironmentRef.current?.assetId === assetId) deferredEnvironmentRef.current = null;
    if (next.length) writeEnvironments(layoutStore.getState().layout.id, next);
    else {
      clearEnvironment(layoutStore.getState().layout.id);
      stopSplat();
    }
  }, [stopSplat,workspaceWriteGuards]);
  const dropEnvironment = useCallback(() => {
    if(workspaceWriteGuards){notify('当前编辑权模式暂不支持删除场地，请保留现有资料。','error');return;}
    environmentsRef.current = [];
    setEnvironments([]);
    clearEnvironment(layoutStore.getState().layout.id);
    restoredEnvironmentRef.current = '';
    deferredEnvironmentRef.current = null;
    stopSplat();
  }, [stopSplat,workspaceWriteGuards]);
  const setEnvironmentFloor = useCallback((assetId: string, floorIndex: number) => {
    if(workspaceWriteGuards){notify('当前编辑权模式暂不支持更换场地楼层，请保留现有资料。','error');return;}
    let current = environmentsRef.current;
    let entry = current.find(value => value.assetId === assetId);
    if (!entry) return;
    if (current[0]?.assetId !== assetId) {
      selectEnvironment(assetId, entry.name);
      current = environmentsRef.current;
      entry = current.find(value => value.assetId === assetId);
      if (!entry) return;
    }
    const position = { ...(entry.position ?? ZERO_SPLAT_POSITION), y: floorElevation(layoutStore.getState().layout.floors, floorIndex) };
    const updated = current.map(value => value.assetId === assetId ? { ...value, floorIndex, position } : value);
    const next = [{ ...entry, floorIndex, position }, ...updated.filter(value => value.assetId !== assetId)];
    environmentsRef.current = next;
    setEnvironments(next);
    writeEnvironments(layoutStore.getState().layout.id, next);
    actions.setActiveFloorIndex(floorIndex);
    if (current[0]?.assetId === assetId) setSplatPosition(position);
  }, [actions, selectEnvironment, setSplatPosition, workspaceWriteGuards]);
  useEffect(() => {
    if (workspaceWriteGuards || (environment?.floorIndex ?? 0) === activeFloorIndex) return;
    const match = environments.find(entry => (entry.floorIndex ?? 0) === activeFloorIndex);
    if (!match) return;
    selectEnvironment(match.assetId, match.name);
  }, [activeFloorIndex, environment?.floorIndex, environments, selectEnvironment, workspaceWriteGuards]);

  useEffect(() => {
    const focusObject = (event: Event) => {
      const detail = (event as CustomEvent<{projectId?: string; objectId: string; position: {x: number; z: number}}>).detail;
      if (!detail || detail.projectId !== layout.id || !Number.isFinite(detail.position?.x) || !Number.isFinite(detail.position?.z)) return;
      const camera = cameraRef.current, controls = controlsRef.current;
      if (!camera || !controls) return;
      const dx = detail.position.x - controls.target.x, dz = detail.position.z - controls.target.z;
      camera.position.x += dx; camera.position.z += dz;
      controls.target.x = detail.position.x; controls.target.z = detail.position.z;
      controls.update(); setView(current => ({...current, view2D:false})); invalidate();
    };
    window.addEventListener('scendance:focus-object', focusObject);
    return () => window.removeEventListener('scendance:focus-object', focusObject);
  }, [layout.id, cameraRef, controlsRef, invalidate]);

  sceneBoxRef.current = sceneRef;
  invalidateBoxRef.current = invalidate;

  // 环境预览就绪时，围栏换成点云真实范围：1:1 实景漫游（不再被 12×9 的场地板困住）。
  const splatWalkBounds = showGaussianInCanvas && splatState.status === 'ready' ? splatState.walkBounds ?? null : null;
  splatWalkBoundsRef.current = splatWalkBounds;

  // 进漫游就带当前角色；左侧换人时 url 变了，这里会热切到新模型。
  const walkAvatarOn = walkthroughActive && walkRoleReady;
  const walkAvatar = useWalkAvatar(walkAvatarOn, walkRoleUrl, sceneRef, walkRole.name);
  const greetRef = useRef(walkAvatar.greet);
  greetRef.current = walkAvatar.greet;
  useEffect(() => {
    if (!walkAvatarOn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || (event.target instanceof HTMLElement && event.target.matches('input, textarea, [contenteditable=true]'))) return;
      if (event.code === 'F5') {
        event.preventDefault();
        cycleWalkView();
      } else if (event.code === 'KeyE') {
        greetRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walkAvatarOn, cycleWalkView]);

  const { phase: walkthroughPhase, nearSeat: walkNearSeat, seated: walkSeated } = useWalkthrough({
    enabled: isReady && walkthroughActive,
    ...(walkAvatarOn ? { viewMode: walkViewMode, onWalkFrame: walkAvatar.frame, walkSpeed: 1.2 } : {}),
    invalidate,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef: controlsRef,
    // Eye level, ducking under a low ceiling (a 1.1 m loft, #277).
    eyeHeight: activeFloorY + Math.min(1.6, activeStoreyHeight - 0.2),
    roomWidth: layout.width,
    roomDepth: layout.height,
    floorY: activeFloorY,
    ...(splatWalkBounds ? { walkBounds: splatWalkBounds } : {}),
    items: activeFloor.items,
    ...(activeFloor.interiorWalls ? { interiorWalls: activeFloor.interiorWalls } : {}),
    onExit: useCallback(() => {
      setView((v) => (v.walkthroughMode ? { ...v, walkthroughMode: false } : v));
      setGameMode((mode) => (mode === 'live' ? 'build' : mode));
    }, []),
  });

  // people.glb is fetched only once a person is placed; wandering NPCs keep
  // their procedural, brightly coloured figures.
  const layoutHasPeople = useMemo(
    () => layout.floors.some((floor) => floor.items.some((item) => item.type === 'person')),
    [layout.floors]
  );
  const peopleModelReady = usePeopleModel(threeModuleRef, isReady, layoutHasPeople);

  const [isoStatus, setIsoStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [isoRetry, setIsoRetry] = useState(0);
  const [showIso, setShowIso] = useState(true);
  useSceneEffects({
    showBasemap: !scanIsolated,
    isoRetry,
    showIso,
    onIsoStatus: setIsoStatus,
    isReady,
    peopleModelReady,
    invalidate,
    requestShadowUpdate,
    threeModuleRef,
    sceneRef,
    rendererRef,
    cameraRef,
    controlsRef,
    canvas2DRef,
    layout,
    activeFloor,
    activeFloorIndex,
    ...(splatWalkBounds ? { personRouteBounds: splatWalkBounds } : {}),
    view,
    ...(referenceImage.layer ? { referenceImage: referenceImage.layer } : {}),
    selectedItemId,
    extraSelectedIds,
    highlightedIds,
    selectedWall,
    wallDraft,
    wallSnapResult,
    measurementPoints,
  });

  // 只有点云就绪且当前展示的就是它时，才用实拍光照覆盖预设光照。
  const sceneLightingAssetId = showGaussianInCanvas && isReady && !view.view2D && environment !== null &&
    splatState.status === 'ready' && splatState.assetId === environment.assetId
    ? environment.assetId
    : '';
  const { sceneLighting } = useSceneLighting({
    enabled: sceneLightingAssetId !== '',
    assetId: sceneLightingAssetId,
    isReady,
    rendererRef,
    invalidate,
  });

  const crowdHints = crowdHintsFromLayout(layout);
  useNpcs({
    enabled: isReady && view.showNpcs && !view.view2D,
    invalidate,
    requestShadowUpdate,
    threeModuleRef,
    sceneRef,
    roomWidth: layout.width,
    roomDepth: layout.height,
    floorY: activeFloorY,
    items: activeFloor.items,
    ...(activeFloor.interiorWalls ? { interiorWalls: activeFloor.interiorWalls } : {}),
    ...(crowdHints.polygon ? { polygon: crowdHints.polygon } : {}),
    ...(crowdHints.mainEntranceId ? { mainEntranceId: crowdHints.mainEntranceId } : {}),
  });

  useWeather({
    weather: view.weather,
    enabled: isReady && !view.view2D,
    invalidate,
    threeModuleRef,
    sceneRef,
    // v2.4 户外场地：不画顶（雨的干燥区清零），默认视角就能看到场地里在下雨。仅预览，不写入场景。
    roomWidth: outdoorVenue ? 0 : layout.width,
    roomDepth: outdoorVenue ? 0 : layout.height,
  });

  useCameraVision({
    enabled: isReady && view.showCameraVision && !view.view2D,
    invalidate,
    threeModuleRef,
    sceneRef,
  });

  // 调研底图在场时，取景框换成底图那片区域：底图铺在哪，镜头就框哪。
  const researchPlacement = researchBasemapPlacement(layout);
  const { applyPreset, focusOn, fitToRoom, ensureRoomInView, setSceneFocus } = useCameraPresets({
    cameraRef,
    controlsRef,
    invalidate,
    roomSize: Math.max(layout.width, layout.height),
    roomWidth: layout.width,
    roomDepth: layout.height,
    ...(researchPlacement ? {
      overview: {
        width: researchPlacement.widthM,
        depth: researchPlacement.depthM,
        centerX: researchPlacement.centerX,
        centerZ: researchPlacement.centerZ,
      },
    } : {}),
    canvasRef,
    buildingHeight: buildingHeight(layout.floors),
  });
  // MAP-03 走查实测：清焦点后同步调 fitToRoom，闭包里还是旧焦点框，取景会停在场地
  // 而不是全湖。回概览/底图重置统一走 ref+rAF，等焦点态真的清掉再取景。
  const fitToRoomRef = useRef(fitToRoom);
  fitToRoomRef.current = fitToRoom;
  const [pendingMapVenueFrame, setPendingMapVenueFrame] = useState<RoomLayout['mapGroundPolygon']>();
  // 取景请求：焦点框是 useCameraPresets 的内部 state，setSceneFocus 之后立刻调 fitToRoom
  // 读到的仍是旧闭包（会框到全湖）。这里把「该取景了」当成一次状态提交，等新焦点真正
  // 渲染完再取景，别用 rAF 抢在 React 提交之前跑。
  const [frameRequest, setFrameRequest] = useState(0);
  const requestFitToRoom = useCallback(() => setFrameRequest(value => value + 1), []);
  useEffect(() => {
    if (frameRequest === 0) return;
    fitToRoomRef.current();
  }, [frameRequest]);
  const fitOverviewAfterFocusClear = useCallback(() => {
    setSceneFocus(null);
    requestFitToRoom();
  }, [setSceneFocus, requestFitToRoom]);
  frameViewportRef.current = () => { if (!view.view2D) ensureRoomInView(); };
  // 暂时只做西湖这一小片：铺底图后的默认镜头落在平湖秋月周边，不给全湖。
  const framePinghuQiuYue = useCallback(() => {
    const world = researchGeoToWorld(layoutStore.getState().layout, XIHU_LOCAL_CENTER.lng, XIHU_LOCAL_CENTER.lat);
    if (!world) return fitOverviewAfterFocusClear();
    setSceneFocus({ width: XIHU_LOCAL_SPAN_M, depth: XIHU_LOCAL_SPAN_M, centerX: world.x, centerZ: world.z });
    requestFitToRoom();
  }, [setSceneFocus, fitOverviewAfterFocusClear, requestFitToRoom]);

  // docs/19 需求A：点场景 → 600ms 平滑 zoom 到该场景。目标=包围盒中心，
  // 距离=max(8m, 包围盒最长边×2.5)，俯角 42.5°；打断与推近规则在 use-scene-zoom 里。
  const { zoomToScene } = useSceneZoom({ cameraRef, controlsRef, invalidate });
  const [focusedVenueId, setFocusedVenueId] = useState<string | null>(null);
  const zoomToVenue = useCallback((venue: ScannedVenue, closer: boolean) => {
    if (view.walkthroughMode) return; // 漫游里相机归第一人称，不抢
    const controls = controlsRef.current;
    if (!controls) return;
    const current = layoutStore.getState().layout;
    const world = (venue.geo ? researchGeoToWorld(current, venue.geo.lng, venue.geo.lat) : null) ?? { x: 0, z: 0 };
    const width = venue.meters && venue.meters.width > 0 ? venue.meters.width : 8;
    const depth = venue.meters && venue.meters.depth > 0 ? venue.meters.depth : 8;
    const height = venue.meters?.height ?? 0;
    setSceneFocus({ width, depth, centerX: world.x, centerZ: world.z });
    setFocusedVenueId(venue.assetId);
    if (closer) {
      // 已在焦点上的场景再点一次：保持当前方位，距离推近一档。
      const clamp = cameraDistanceClamp(width, depth);
      const distance = Math.max(clamp.minDistance, controls.getDistance() * SCENE_ZOOM_CLOSER_RATIO);
      zoomToScene({ target: { x: world.x, y: height / 2, z: world.z }, distance });
      return;
    }
    const longest = Math.max(width, depth, height);
    zoomToScene({
      target: { x: world.x, y: height / 2, z: world.z },
      distance: Math.max(8, longest * 2.5),
      clamp: cameraDistanceClamp(width, depth),
    });
  }, [view.walkthroughMode, controlsRef, setSceneFocus, zoomToScene]);
  // 换场地时 splat 是异步加载的：等它就绪再 zoom（load 完成会先框一遍场地，zoom 随后带到定点机位）。
  const pendingVenueZoomRef = useRef<ScannedVenue | null>(null);
  const mapVenueTrialRef = useRef(false);
  const tryMapVenue = () => {
    mapVenueTrialRef.current = true;
    setView(value => ({ ...value, view2D: false, walkthroughMode: true }));
  };
  const focusMapVenue = useCallback(() => {
    const current = layoutStore.getState().layout;
    const points = mapVenueFootprint(current);
    if (points.length < 3) return;
    const xs = points.map(point => point.x);
    const zs = points.map(point => point.z);
    const west = Math.min(...xs), east = Math.max(...xs);
    const north = Math.min(...zs), south = Math.max(...zs);
    pendingVenueZoomRef.current = null;
    setIsolatedScanId(undefined);
    setFocusedVenueId(null);
    setView(value => ({ ...value, view2D: false, walkthroughMode: false }));
    setSceneFocus({ width: east - west, depth: south - north, centerX: (west + east) / 2, centerZ: (north + south) / 2 });
    setPendingMapVenueFrame(current.mapGroundPolygon);
  }, [setView, setSceneFocus]);
  useEffect(() => {
    if (walkthroughActive || !mapVenueTrialRef.current) return;
    mapVenueTrialRef.current = false;
    focusMapVenue();
  }, [focusMapVenue, walkthroughActive]);
  useEffect(() => {
    const pending = pendingVenueZoomRef.current;
    if (!pending) return;
    if (splatState.status === 'ready' && splatState.assetId === pending.assetId) {
      pendingVenueZoomRef.current = null;
      zoomToVenue(pending, false);
    } else if (splatState.status === 'error') {
      pendingVenueZoomRef.current = null;
    }
  }, [splatState, zoomToVenue]);

  // 底图变化（手动铺图/撤图）时焦点重置：手动铺图框整片给人看；自动铺图（scanAssetId）的相机归场地取景管。
  const lastResearchAreaRef = useRef<RoomLayout['researchArea']>();
  useEffect(() => {
    const area = layout.researchArea;
    if (lastResearchAreaRef.current === area) return undefined;
    lastResearchAreaRef.current = area;
    setFocusedVenueId(null);
    if (pendingMapVenueFrame === layout.mapGroundPolygon && pendingMapVenueFrame) return undefined;
    // 焦点清掉后下一帧再取景（同步调 fitToRoom 会读到旧焦点闭包，停在场地框）。
    if (!area) return fitOverviewAfterFocusClear();
    // 西湖整景区底图只作垫图，默认取景收在平湖秋月这一小片，不再摊全湖。
    if (area.presetId === 'xihu-scenic' && !area.scanAssetId) return framePinghuQiuYue();
    if (!area.scanAssetId) return fitOverviewAfterFocusClear();
    setSceneFocus(null);
    return undefined;
  }, [layout.researchArea, layout.mapGroundPolygon, pendingMapVenueFrame, setSceneFocus, fitOverviewAfterFocusClear, framePinghuQiuYue]);

  useEffect(() => {
    if (!pendingMapVenueFrame || !isReady || view.view2D) return;
    if (pendingMapVenueFrame !== layout.mapGroundPolygon) {
      setPendingMapVenueFrame(undefined);
      return;
    }
    const raf = requestAnimationFrame(() => {
      fitToRoomRef.current();
      setPendingMapVenueFrame(undefined);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingMapVenueFrame, layout.mapGroundPolygon, isReady, view.view2D]);

  const { captureRenderImage, exportRenderImage, exportRenderAlbum, handleShareLink } = useImportExport({
    layout,
    actions,
    view2D: view.view2D,
    canvasRef,
    canvas2DRef,
    rendererRef,
    sceneRef,
    cameraRef,
    controlsRef,
    applyPreset,
    // 导出走实时那条渲染栈（点云背景 + 布置前景），否则成图里只剩布置。
    paintFrame: (renderer, scene, camera) => {
      const boundary = scene.getObjectByName(MAP_VENUE_BOUNDARY);
      const visible = boundary?.visible ?? false;
      if (boundary) boundary.visible = false;
      try {
        paintSplatFrame(renderer, scene, camera, { guides: false });
      } finally {
        if (boundary) boundary.visible = visible;
      }
    },
    onImported: clearTransientSelection,
  });

  // 世界坐标 → 屏幕像素：2D 走平面变换，3D 走相机投影。卫星底图钉点/取景标记共用。
  const toScreen = useCallback((point: { x: number; y: number; z: number }) => {
    if (view.view2D) {
      const canvas = canvas2DRef.current;
      if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return null;
      return planPointToCanvas(point, layout, get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout));
    }
    const THREE = threeModuleRef.current;
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!THREE || !camera || !canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return null;
    const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
    if (projected.z > 1) return null;
    return {
      x: (projected.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * canvas.clientHeight,
    };
  }, [view.view2D, layout, cameraRef, canvasRef, canvas2DRef, threeModuleRef]);

  // 效果图导出：先出预览，确认后下载同一帧；2D 平面按当前分辨率抓取。
  const handleExportImage = useCallback(async (options: { view: 'current' | 'iso' | 'top' | 'front' | 'corner'; scale: number }) => {
    const ok = await exportRenderImage(options);
    notify(ok ? '效果图已开始下载。' : '效果图导出失败，请稍后重试。', ok ? 'success' : 'error');
    return ok;
  }, [exportRenderImage]);

  // 机位册：四张机位逐张下载，再落一份可离线打开的图册；2D 不提供。
  const handleExportAlbum = useCallback(async (options: { scale: number }) => {
    if (view.view2D) return { ok: false, count: 0 };
    const result = await exportRenderAlbum(options);
    notify(result.ok ? `已导出 ${result.count} 张机位效果图与图册。` : '机位册导出失败，请稍后重试。', result.ok ? 'success' : 'error');
    return result;
  }, [view.view2D, exportRenderAlbum]);

  // Advance the time-of-day at roughly 1 in-game hour per second when on.
  useEffect(() => {
    if (!autoCycleLighting) return undefined;
    const intervalId = window.setInterval(() => {
      setView((v) => ({ ...v, timeOfDay: (v.timeOfDay + 0.25) % 24 }));
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [autoCycleLighting]);

  // Reset measurements whenever the user exits the mode.
  useEffect(() => {
    if (!view.measurementMode) setMeasurementPoints([]);
  }, [view.measurementMode]);

  const toggle = useCallback(<K extends keyof ViewSettings>(key: K) => {
    setView((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  // Furniture clipboard (#153): copy normalizes the selection around its
  // centroid; paste rebuilds it on the ACTIVE floor (cross-floor paste is the
  // point), settled/clamped, unlocked, and selected — one undo entry.
  const copySelectionToClipboard = useCallback(() => {
    const items = activeFloor.items.filter((item) => allSelectedIds.has(item.id));
    return copyToClipboard(items) > 0;
  }, [activeFloor.items, allSelectedIds]);

  const pasteFromClipboard = useCallback(() => {
    const built = buildPasteItems({
      roomWidth: layout.width,
      roomDepth: layout.height,
      interiorWalls: activeFloor.interiorWalls ?? [],
      idTag: randomSuffix(),
      floorIndex: activeFloorIndex,
    });
    if (built.length === 0) return false;
    if (materialCount(activeFloor.items) + materialCount(built) > editorItemLimit(layout)) { notify(`当前场景最多支持 ${editorItemLimit(layout)} 件物料。`, 'info'); return false; }
    const pasted = built.map(item => { const id = crypto.randomUUID(); return { ...item, id, ...(item.structuralOpeningId ? {structuralOpeningId:id} : {}), ...(item.structuralColumnId ? {structuralColumnId:id} : {}) }; });
    const next = {...layout, floors:layout.floors.map((floor,index)=>index===activeFloorIndex ? {...floor,items:[...floor.items,...pasted]} : floor)};
    if (!canApplyLayoutGeometry(layout,next)) { notify('粘贴位置与结构冲突，整组未放置。', 'info'); return false; }
    commitHistoryNow();
    actions.addItems(pasted);
    selectOnly(pasted[0]!.id);
    if (built.length > 1) {
      setExtraSelectedIds(new Set(pasted.slice(1).map((item) => item.id)));
    }
    playCue('place');
    return true;
  }, [layout, activeFloor.interiorWalls, activeFloor.items, activeFloorIndex, actions, commitHistoryNow, selectOnly, playCue]);

  const shortcutHandlers = useMemo(
    () => ({
      removeItem: (id: string) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          removeSelected();
          return;
        }
        removeItem(id);
      },
      duplicateItem: duplicateSelected,
      copySelection: copySelectionToClipboard,
      pasteClipboard: pasteFromClipboard,
      rotateItem: (id: string) => {
        // Each keypress is a discrete edit: keep one undo step per press.
        commitHistoryNow();
        return rotateItemHandler(id);
      },
      rotateItemBy: (id: string, radians: number) => {
        commitHistoryNow();
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          const unlocked = unlockedSelectedIds();
          if (unlocked.size > 0) actions.rotateSelection(unlocked, radians);
          return;
        }
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (!item || item.locked) return;
        const next = ((item.rotation ?? 0) + radians) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
      },
      moveItem: (id: string, x: number, z: number) => {
        // Arrow nudges settle wall-mounted items back onto their wall the way
        // drag release does — a nudged door slides along its wall instead of
        // translating into the room as a free slab (#116).
        const item = activeFloor.items.find((entry) => entry.id === id);
        const settled = item
          ? settleWallMountedItem(
              item,
              { x, z },
              layout.width,
              layout.height,
              activeFloor.interiorWalls ?? [],
              frontGap
            )
          : null;
        if (settled) actions.updateItem(id, settled);
        else actions.moveItem(id, x, z);
      },
      toggle2D: () => toggle('view2D'),
      toggleMeasurements: () => toggle('showMeasurements'),
      toggleSnap: () => toggle('snapToGrid'),
      toggleSignals: () => toggle('showWiFiSignals'),
      undo: history.undo,
      redo: history.redo,
      deselect: () => {
        if (wallDraft) {
          setWallDraft(null);
          return;
        }
        // A second Escape, with no draft pending, leaves wall-draw mode (#349).
        if (view.drawWallMode) {
          toggle('drawWallMode');
          return;
        }
        // Likewise for the distance tool (#341).
        if (view.measurementMode) {
          toggle('measurementMode');
          return;
        }
        setSelectedItemId(null);
        setExtraSelectedIds(new Set());
      },
      focusOnSelection: () => {
        if (selectedItem?.position) focusOn(selectedItem.position, undefined, activeFloorY);
      },
      advanceTime: (deltaHours: number) => {
        setView((v) => ({ ...v, timeOfDay: (((v.timeOfDay + deltaHours) % 24) + 24) % 24 }));
      },
      changeFloor: (delta: number) => {
        const next = activeFloorIndex + delta;
        if (next < 0 || next >= layout.floors.length) return;
        actions.setActiveFloorIndex(next);
      },
      toggleSidebar: () => toggleAgent('material'),
      setGizmoMode: (next: GizmoMode) => setGizmoMode(next),
      removeInteriorWall: (id: string) => {
        if (isEvidenceProtectedWall(layoutStore.getState().layout, id)) {
          notify('墙体有关联图纸或已确认依据，请先在结构面板重新核对。', 'info');
          return;
        }
        actions.removeInteriorWall(id);
        setSelectedWall(null);
      },
      // Keep the selection (and the auto-opened paint panel) after hiding an
      // exterior wall so the Wall Visibility toggles stay reachable to restore it.
      toggleExteriorWall: (id: string) => {
        actions.toggleExteriorWall(id as WallId);
      },
      // Only while a keyboard placement is pending, so Enter/Escape otherwise
      // keep their ordinary meaning (#168).
      ...(placingId ? { confirmPlacement, cancelPlacement } : {}),
    }),
    [
      placingId,
      confirmPlacement,
      cancelPlacement,
      frontGap,
      removeItem,
      removeSelected,
      duplicateSelected,
      copySelectionToClipboard,
      pasteFromClipboard,
      allSelectedIds,
      actions,
      activeFloor.items,
      activeFloor.interiorWalls,
      activeFloorIndex,
      activeFloorY,
      layout.floors.length,
      layout.width,
      layout.height,
      unlockedSelectedIds,
      toggle,
      history.undo,
      history.redo,
      selectedItem,
      focusOn,
      rotateItemHandler,
      reseatCamera,
      wallDraft,
      view.drawWallMode,
      view.measurementMode,
      setGizmoMode,
    ]
  );

  useKeyboardShortcuts({
    enabled: isActive,
    selectedItem,
    selectedWall,
    hasSignalItems,
    walkthroughActive,
    layoutLocked: workbenchMode !== 'layout',
    isDragActive,
    handlers: shortcutHandlers,
  });

  useEffect(() => {
    if (workbenchMode === 'layout') return;
    selectOnly(null);
    setSelectedWall(null);
    clearPendingPlacement();
    cancelPlacement();
    setView(current => (current.drawWallMode || current.drawZoneMode || current.measurementMode)
      ? { ...current, drawWallMode: false, drawZoneMode: false, measurementMode: false }
      : current);
  }, [workbenchMode, selectOnly, cancelPlacement, setView,clearPendingPlacement]);



  const roomEditorValue = useMemo<RoomEditorContextValue>(
    () => ({
      layout,
      activeFloor,
      activeFloorIndex,
      actions,
      view,
      setView,
      toggle,
      collidingIds,
      highlightedIds,
      catalogQuery,
      setCatalogQuery,
      recentColors,
      pushColor,
      playCue,
      history,
      isReady,
      error,
      gameMode,
      setGameMode,
      autoCycleLighting,
      setAutoCycleLighting,
    }),
    [
      layout, activeFloor, activeFloorIndex, actions,
      view, setView, toggle,
      collidingIds, highlightedIds, catalogQuery, setCatalogQuery,
      recentColors, pushColor, playCue,
      history, isReady, error,
      gameMode, setGameMode, autoCycleLighting, setAutoCycleLighting,
    ]
  );

  const selectionValue = useMemo<SelectionContextValue>(
    () => ({
      selectedItemId,
      setSelectedItemId,
      selectedItem,
      extraSelectedIds,
      setExtraSelectedIds,
      allSelectedIds,
      selectOnly,
    }),
    [selectedItemId, setSelectedItemId, selectedItem, extraSelectedIds, setExtraSelectedIds, allSelectedIds, selectOnly]
  );

  const initiallyFramed = useRef(false);
  useEffect(() => {
    if (isReady && !initiallyFramed.current) {
      initiallyFramed.current = true;
      fitToRoom();
    }
  }, [isReady, fitToRoom]);

  const onLoadLayout = useCallback((next: RoomLayout) => {
    const before=layoutStore.getState().layout;
    if (!activitySession.isCurrent(sessionToken) || before!==layout) throw new Error('活动已变化，请重新打开。');
    if((before.id??null)!==(next.id??null))flushPendingBeforeSwitch();
    if(layoutStore.getState().layout!==before)throw new Error('保存期间活动已变化，请重新打开。');
    applyGuardedWorkspaceReplacement(layout, workspaceWriteGuards?.assertLayoutWrite, () => actions.applyLayout(next), workspaceWriteGuards?.capability);
    clearTransientSelection();
    clearHistory(layoutStore.getState().layout);
  }, [actions, layout, clearTransientSelection, clearHistory, workspaceWriteGuards,activitySession.isCurrent,sessionToken,flushPendingBeforeSwitch]);

  const prepareRestoreLayout = useCallback((next: RoomLayout): RoomLayout => {
    if (controller.getSnapshot().project || new URL(window.location.href).searchParams.has('project')) {
      throw new Error('当前页面已连接或正在打开云项目，请在本地工作台恢复备份。');
    }
    return prepareLocalRestoreLayout(next);
  }, [controller]);
  const commitRestoredLayout = useCallback((candidate: RoomLayout): void => {
    workspaceWriteGuards?.assertLayoutWrite();
    if(!activitySession.isCurrent(sessionToken))throw new Error('活动已变化，未恢复备份。');
    const next = prepareRestoreLayout(candidate);
    const before = layoutStore.getState().layout;
    if((before.id??null)!==(next.id??null))flushPendingBeforeSwitch();
    if(layoutStore.getState().layout!==before)throw new Error('保存期间活动已变化，未恢复备份。');
    const json = commitLocalRestoreLayout(next, {
      current: () => layoutStore.getState().layout,
      apply: value => actions.applyLayout(value),
      beforeReplace: () => { workspaceWriteGuards?.assertLayoutWrite(); commitHistoryNow(); snapshotBeforeReplace(before, workspaceWriteGuards?.assertLayoutWrite); workspaceWriteGuards?.assertLayoutWrite(); },
    });
    const restored = layoutStore.getState().layout;
    acknowledgeRestoredLayout(restored, json);
    clearTransientSelection(); clearHistory(restored);
    initiallyFramed.current = false;
  }, [prepareRestoreLayout, actions, commitHistoryNow, acknowledgeRestoredLayout, clearTransientSelection, clearHistory, workspaceWriteGuards,flushPendingBeforeSwitch,activitySession.isCurrent,sessionToken]);

  const commitFreshActivityLayout = useCallback((candidate: RoomLayout, clearance: FreshActivityScopeClearance): void => {
    workspaceWriteGuards?.assertLayoutWrite();
    if (!activitySession.isCurrent(sessionToken)) throw new Error('活动已变化，未新建活动。');
    if (controller.getSnapshot().project || new URL(window.location.href).searchParams.has('project')) {
      throw new Error('当前页面已连接或正在打开云项目，请在本地工作台新建活动。');
    }
    const before = layoutStore.getState().layout;
    if ((before.id ?? null) !== (candidate.id ?? null)) flushPendingBeforeSwitch();
    if (layoutStore.getState().layout !== before) throw new Error('保存期间活动已变化，未新建活动。');
    const json = commitFreshLocalActivityLayout(candidate, {
      current: () => layoutStore.getState().layout,
      apply: value => actions.applyLayout(value),
      beforeReplace: () => { workspaceWriteGuards?.assertLayoutWrite(); commitHistoryNow(); snapshotBeforeReplace(before, workspaceWriteGuards?.assertLayoutWrite); workspaceWriteGuards?.assertLayoutWrite(); },
    }, clearance);
    const created = layoutStore.getState().layout;
    acknowledgeRestoredLayout(created, json);
    clearTransientSelection(); clearHistory(created);
    initiallyFramed.current = false;
  }, [actions, commitHistoryNow, acknowledgeRestoredLayout, clearTransientSelection, clearHistory, workspaceWriteGuards, flushPendingBeforeSwitch, activitySession.isCurrent, sessionToken, controller]);

  const onApplyCreative = useCallback((next: RoomLayout, options?: { preserveProvenance?: boolean; expectedBase?: RoomLayout; expectedFloor?: FloorSessionToken }) => {
    workspaceWriteGuards?.assertLayoutWrite();
    if(!activitySession.isCurrent(sessionToken))throw new Error('活动已变化，请重新核对方案。');
    const initialState = layoutStore.getState();
    const before = initialState.layout;
    if((before.id??null)!==(next.id??null))flushPendingBeforeSwitch();
    if(layoutStore.getState().layout!==before)throw new Error('保存期间活动已变化，请重新核对方案。');
    if (options?.expectedFloor && !floorSession.isCurrent(options.expectedFloor)) {
      throw new Error('楼层已变化，请重新核对方案。');
    }
    // 第 7 批收尾：记录本次落盘 + 体检的起始时刻，完成卡上的「落盘耗时」用它算。
    const applyStartedAt = Date.now();
    const expectedBase = options?.expectedBase;
    if (expectedBase && (before.id !== expectedBase.id || !sameLayoutContent(before, expectedBase))) {
      throw new Error('场景在预览期间已变化，请重新生成并核对方案。');
    }
    if (previewGuard && decideOnApply(before, previewGuard).action === 'prompt') {
      throw new Error('场景在预览期间已变化，请重新生成并核对方案。');
    }
    if (!canApplyLayoutGeometry(before, next)) throw new Error('候选方案包含新的墙体、柱子或边界冲突，请先修正。');

    // 只给新物件记录来源，已有物件的来源不能被这次预览覆盖。
    const aiOpId = `ai-${Date.now()}`;
    const existingIds = new Set(before.floors.flatMap(f => f.items.map(item => item.id)));
    const provenanceNext: RoomLayout = {
      ...next,
      floors: next.floors.map(f => ({
        ...f,
        items: f.items.map(item => options?.preserveProvenance || existingIds.has(item.id) ? item : ({
          ...item, provenance: {
            source: 'ai' as const,
            opId: aiOpId,
            ...(previewGuard?.recipeId ? { recipeId: previewGuard.recipeId } : {}),
          },
        })),
      })),
    };

    // M2 命令门（P0-2）：逐件分流——合法件进 nextLayout，越界/重叠件进 refused（真记账）。
    const cmd = applyLayoutCommand({
      layout: provenanceNext,
      ...(!previewGuard?.baselineFingerprint
        ? {}
        : { baseFingerprint: previewGuard.baselineFingerprint }),
    });
    const result = applyLayoutCommandWithRefusals(cmd, { layout: before });
    const applicationError = completeLayoutError(result);
    if (applicationError) throw new Error(applicationError);

    // 确认的候选即最终落盘内容；不在确认后悄悄移动家具。
    const finalLayout: RoomLayout = { ...result.nextLayout, ...(before.designBook && !result.nextLayout.designBook ? { designBook: before.designBook } : {}) };
    // M3 settle 自动体检（P0-2 接线）：AI 摆完立刻跑一遍 BFS 可达性 + 最小平移收敛器，
    // 把堵主通道 / 孤立刻直接挪开；挪不动的留给 UI 标红。
    const settleReport = settlePlacement(finalLayout, activeFloorIndex);
    const movedCount = settleReport.steps.reduce((n, s) => n + s.moved.length, 0);
    const stillBad = settleReport.remainingViolations.length;
    if (movedCount > 0 || stillBad > 0) {
      notify(`AI 摆完已自动巡场：挪开 ${movedCount} 处堵点，${stillBad} 处挪不动已标红。`, 'info');
    }
    const settledLayout = settleReport.layout;
    const appliedLayout: RoomLayout = { ...settledLayout, ...(layout.designBook && !settledLayout.designBook ? { designBook: layout.designBook } : {}) };
    const candidateValidation = validateCandidateApply(before, settledLayout, activeFloorIndex);
    if (!candidateValidation.ok) throw new Error(candidateValidation.reason);
    // 集成接线：Bingo 体检分即时 notify，并把同一份数带进「本次报告」卡（第 7 批收尾）。
    const bingoScore = computeBingoScore(settledLayout, settleReport);
    applyGuardedWorkspaceReplacement(before, workspaceWriteGuards?.assertLayoutWrite, () => {
      const latestState = layoutStore.getState();
      const current = latestState.layout;
      if ((options?.expectedFloor && !floorSession.isCurrent(options.expectedFloor)) || current.id !== before.id || !sameLayoutContent(current, before)) {
        throw new Error('场景在应用前已变化，请重新生成并核对方案。');
      }
      commitHistoryNow();
      snapshotBeforeReplace(layout);
      actions.applyLayout(appliedLayout);
      if (!sameRecoveryFormValue(layoutStore.getState().layout, settledLayout)) {
        throw new Error('应用后的布局与预览不一致，请先撤销并重新核对。');
      }
    }, workspaceWriteGuards?.capability);
    if (bingoScore.itemCount > 0) {
      notify(bingoScore.summary, bingoScore.total >= 95 && bingoScore.stuckCount === 0 ? 'success' : 'info');
    }

    // M5：按 id 差分写 Outcome 账本；refused 不再硬编码空数组。
    const {added:placedItems,removed:removedItems}=generationMaterialDiff(before,settledLayout);
    const candidateById = new Map(provenanceNext.floors.flatMap(f => f.items.map(i => [i.id, i])));
    const refusedEntries: OutcomeEntry<FurnitureItem>[] = result.refused.map(r => ({
      item: candidateById.get(r.itemId) ?? ({ id: r.itemId, name: r.itemId } as unknown as FurnitureItem),
      reason: r.message,
      code: r.code,
    }));
    // 第 7 批收尾：把体检分、被拒/跳过件数、落盘耗时写进本次账本，
    // 让 Bingo「本次报告」卡上真的能看到这次跑出来的数（而不是只弹一条 toast）。
    // 思考轮数拿不到就不写 —— 不用别的数字冒充。
    //
    // 只有「真动了东西」才写账：onApplyCreative 也是场地壳体改尺寸的入口
    // （splat 预览就绪时按真实尺寸 resize），那种操作一件家具都没变，
    // 写进去只会让「本次结果」变成「放了 0 件」，把上一次真的生成结果冲掉。
    const outcome: GenerationOutcome<FurnitureItem> = {
      placed: placedItems,
      refused: refusedEntries,
      skipped: [], removed: removedItems,
    };
    if (hasOutcomeChanges(outcome)) {
      // 第 8 批：模型轮数取云端那一趟的真值（AgentRun.call_count），
      // 拿不到就不写 —— 完成卡不编数字。
      const lastRun = getAgentRun();
      const rounds = lastRun.scope === 'layout' && lastRun.thoughtCount > 0 ? lastRun.thoughtCount : undefined;
      const report = buildGenerationReport({
        score: bingoScore,
        placedCount: placedItems.length,
        refusedCount: refusedEntries.length,
        skippedCount: 0,
        removedCount: removedItems.length,
        fixedCount: bingoScore.fixedCount,
        stuckCount: bingoScore.stuckCount,
        areaM2: finalLayout.width * finalLayout.height,
        durationMs: Date.now() - applyStartedAt,
        ...(rounds === undefined ? {} : { rounds }),
      });
      let appliedAuditLayout: RoomLayout | undefined;
      try { appliedAuditLayout = structuredClone(appliedLayout); } catch { /* 无可靠快照时只能显示历史结果。 */ }
      applyOutcome({ ...outcome, report, ...(appliedAuditLayout ? {appliedLayout: appliedAuditLayout,appliedRevision:layoutStore.getState().revision} : {}) });
    }
    setPreviewGuard(null);
    clearTransientSelection();
    initiallyFramed.current = false;
    setView(current => ({ ...current, view2D: false }));
  }, [commitHistoryNow, layout, actions, clearTransientSelection, previewGuard, activeFloorIndex, applyOutcome, workspaceWriteGuards, floorSession.isCurrent,flushPendingBeforeSwitch,activitySession.isCurrent,sessionToken]);

  /**
   * docs/19 地理底图：只动 researchArea 与场景锚点，走正式历史；输入与自动铺图共用这一条路。
   *
   * 架构定案：地图是 3D 场景里的一个渲染层，场景坐标 ↔ 地理坐标的唯一变换是场景锚点。
   * 铺图 = 把场景重新锚到那片真实位置（锚点原点 = 底图中心经纬度）；朝向沿用现有锚点
   * （默认正北朝上），米制沿用壳体缩放（没有壳就是 1）。底图不再读 mapGroundFrame，
   * 场景里不存在第二套地面坐标——因此删掉了旧的「异地框架 >3km 就清掉」补丁：
   * 它是在掩盖两套坐标打架，而不是解决问题。
   */
  const applyResearchArea = useCallback((area: RoomLayout['researchArea'] | null, meta?: {
    /** 锚点定位来源（MAP-04 元数据）：缺省视为人工底图定位。 */
    source?: SceneAnchorSource;
    /** 锚点朝向（度，正北顺时针）：scanAssetId 自动铺图带资产采集朝向时写入；缺省沿用现有锚点。 */
    orientationDeg?: number;
  }) => {
    if (!activitySession.isCurrent(sessionToken) || getStoreSessionScope() !== sessionScope) {
      notify('活动已变化，请重新核对底图。', 'error');
      return false;
    }
    const current = layoutStore.getState().layout;
    const next: RoomLayout = (() => {
      if (!area) {
        const { researchArea: _dropped, ...rest } = current;
        return rest as RoomLayout;
      }
      const existing = sceneAnchorOf(current);
      // 静态整景区底图是「给已有锚点的场景垫一张大图」：锚点必须留在原扫描位置，
      // 底图中心由 bounds 经 anchorGeoToWorld 投出来，不能把锚点搬到 bbox 中心去。
      const sceneAnchor: SceneAnchor = area.presetId
        ? existing ?? { lng: area.center.lng, lat: area.center.lat, orientationDeg: 0, metersPerUnit: 1, source: 'preset' }
        : {
          lng: area.center.lng,
          lat: area.center.lat,
          orientationDeg: meta?.orientationDeg ?? existing?.orientationDeg ?? 0,
          metersPerUnit: existing?.metersPerUnit ?? 1,
          source: meta?.source ?? 'manual',
        };
      return { ...current, sceneAnchor, researchArea: area };
    })();
    try {
      workspaceWriteGuards?.assertLayoutWrite();
      commitHistoryNow();
      workspaceWriteGuards?.assertLayoutWrite();
      if (!activitySession.isCurrent(sessionToken) || getStoreSessionScope() !== sessionScope || layoutStore.getState().layout !== current) throw new Error('活动或场景已变化，请重新核对底图。');
      actions.applyLayout(next);
      if (!sameLayoutContent(layoutStore.getState().layout, next)) throw new Error('底图结果未能读回，请重新核对。');
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
      return false;
    }
  }, [actions, commitHistoryNow, notify, workspaceWriteGuards, activitySession.isCurrent, sessionToken, sessionScope]);

  /**
   * Golden Path 第 1 步：选中一套已扫描的真实场地，直接换场。
   * 尺寸与场地标记合成一步历史——撤销一次就回到上一套场地（画布与尺寸一起退）。
   * 注册表带米制尺寸就直接按它摆壳体；没带时才等高斯就绪校准。
   */
  const applyRealVenue = useCallback((venue: ScannedVenue, isolate = false) => {
    setIsolatedScanId(isolate ? venue.assetId : undefined);
    if (venue.assetId === environmentsRef.current[0]?.assetId) {
      if (isolate) {
        const active = environmentsRef.current[0];
        if (splatState.assetId !== venue.assetId || splatState.status === 'idle' || splatState.status === 'error') {
          restoredEnvironmentRef.current = `${environmentKey}:${venue.assetId}`;
          deferredEnvironmentRef.current = null;
          restoreEnvironment(active);
        } else if (isolatedScanId === venue.assetId && splatState.status === 'ready') {
          framePrimaryScene();
        }
        return;
      }
      // 点当前场地：已在焦点上的再点推近一档（×0.75），没在焦点上的 zoom 过去。
      zoomToVenue(venue, venue.assetId === focusedVenueId);
      return;
    }
    if(workspaceWriteGuards){notify('当前编辑权模式暂不支持切换场地及其布局，请保留现有资料。','error');return;}
    if (!venue.meters || !Number.isFinite(venue.meters.width) || !Number.isFinite(venue.meters.depth)
      || venue.meters.width <= 0 || venue.meters.depth <= 0) {
      notify('这个场地的实际尺寸尚未确认，暂不能切换并沿用当前布局；请先核实场地尺寸。', 'error');
      return;
    }
    const active = environmentsRef.current[0];
    const before = layoutStore.getState().layout;
    const entry = environmentsRef.current.find(item => item.assetId === venue.assetId);
    const size = { width: Math.round(venue.meters.width * 10) / 10, height: Math.round(venue.meters.depth * 10) / 10 };
    try {
      onApplyCreative({
        ...before,
        ...size,
        venueScan: { assetId: venue.assetId, name: venue.name },
        ...(entry?.itemsByFloor ? {
          floors: before.floors.map((floor, index) => ({
            ...floor,
            items: entry.itemsByFloor?.[index] ? [...entry.itemsByFloor[index]!] : floor.items,
          })),
        } : {}),
      }, { preserveProvenance: true });
      if (active) venueByLayoutRef.current.set(before, { assetId: active.assetId, name: active.name });
      selectEnvironment(venue.assetId, venue.name, { restoreItems: false, previousLayout: before });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
      return;
    }
    if (isolate) return;
    // MAP-03：整景区视距（POI）下点云被延后挂载，等 splat ready 再 zoom 会永远等不到——
    // 先把相机推到场地，推近途中视距翻回 splat（<100 m），延后的挂载自动补上。
    if (splatLod === 'poi') {
      zoomToVenue(venue, false);
      return;
    }
    // 场地 splat 异步加载，就绪后 zoom 到该场景（pending 效果在 splatState ready 时触发）。
    pendingVenueZoomRef.current = venue;
  }, [notify, onApplyCreative, selectEnvironment, zoomToVenue, focusedVenueId, workspaceWriteGuards, splatLod, isolatedScanId, framePrimaryScene, environmentKey, restoreEnvironment, splatState.assetId, splatState.status]);

  // 单场查看失败后在画布上直接重试：重新挂载同一套扫描，不离开单场。
  const retryIsolatedScan = useCallback(() => {
    const active = environmentsRef.current[0];
    if (!active || active.assetId !== isolatedScanId) {
      setIsolatedScanId(undefined);
      notify('这个场地已不在清单里，已回到全部场景。', 'error');
      return;
    }
    restoreEnvironment(active);
  }, [isolatedScanId, notify, restoreEnvironment]);

  const previewProjectScene = (assetId: string, name: string) => {
    if (!mappedWorkspace && !listScannedVenues().some(venue => venue.assetId === assetId)) {
      setIsolatedScanId(undefined);
      selectEnvironment(assetId, name, { restoreItems: false });
      return;
    }
    setView(current => current.view2D ? { ...current, view2D: false } : current);
    setIsolatedScanId(assetId);
    if (environmentsRef.current[0]?.assetId !== assetId) {
      selectEnvironment(assetId, name, { restoreItems: false });
    } else if (splatState.assetId === assetId && splatState.status === 'ready') {
      framePrimaryScene();
    } else if (splatState.status !== 'loading') {
      const active = environmentsRef.current[0];
      deferredEnvironmentRef.current = null;
      restoreEnvironment(active);
    }
  };

  const [projectSceneThumbnails, setProjectSceneThumbnails] = useState<Record<string, string>>({});
  const thumbnailCacheKey = 'scendance.project-scene-thumbnails.v3';
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(thumbnailCacheKey) ?? '{}') as Record<string, unknown> | null;
      if (saved) setProjectSceneThumbnails(Object.fromEntries(Object.entries(saved)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].startsWith('data:image/png;base64,'))));
    } catch { /* Preview images are optional. */ }
  }, []);
  useEffect(() => {
    const assetId = isolatedScanId;
    if (!assetId || view.view2D || walkthroughActive || splatState.status !== 'ready'
      || splatState.assetId !== assetId || projectSceneThumbnails[assetId]) return;
    let cancelled = false;
    // Let the preview camera finish framing the scan before saving the cover.
    const timer = window.setTimeout(() => {
      void captureRenderImage({ view: 'current', scale: 1, resolution: { width: 320, height: 200 } }).then(image => {
        if (cancelled || !image) return;
        const next = Object.fromEntries(Object.entries({ ...projectSceneThumbnails, [assetId]: image }).slice(-18));
        setProjectSceneThumbnails(next);
        try { localStorage.setItem(thumbnailCacheKey, JSON.stringify(next)); } catch { /* Keep the in-memory image. */ }
      });
    }, 1000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [isolatedScanId, view.view2D, walkthroughActive, splatState.status, splatState.assetId, projectSceneThumbnails, captureRenderImage]);

  // 场景点位（docs/19 需求A）：有经纬度的扫描场地在底图上各钉一个点，点一下 zoom 过去。
  const sceneGeoDots = useMemo(() => {
    if (view.view2D || !layout.researchArea) return [];
    return listScannedVenues().flatMap(venue => {
      if (venue.geo?.source !== 'telemetry') return [];
      const world = researchGeoToWorld(layout, venue.geo.lng, venue.geo.lat);
      return world ? [{ id: venue.assetId, name: venue.name, x: world.x, z: world.z }] : [];
    });
    // 只看影响投影的字段：锚点/底图/场地尺寸。
  }, [view.view2D, layout.researchArea, layout.sceneAnchor, layout.mapGroundFrame, layout.mapLngLat, layout.width, layout.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickSceneGeoDot = useCallback((assetId: string) => {
    const venue = listScannedVenues().find(item => item.assetId === assetId);
    if (venue) applyRealVenue(venue, true);
  }, [applyRealVenue]);

  /** 场景生成/真重建「取回并预览」：先落盘再切到 3D；真成功挂本场 .spz 时同步打开环境预览抽屉，替换当前观感层。 */
  const openScenePreview = useCallback(async (source: { url: string; name?: string; taskid?: string; metaUrl?: string }) => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    showAgent('space');
    await startSplat(await loadAholoSceneSource(source));
  }, [setView, startSplat, showAgent]);
  // 高斯优先（用户裁决）：室内预览就绪后把场地宽深校到高斯实测值（0.1 m 精度，进撤销历史）。
  // 地图户外（盐官一类）和过不了几何闸的壳不改尺寸——以前直接 throw，整页工作台会塌。
  const [splatShellKeptFor, setSplatShellKeptFor] = useState('');
  useEffect(() => {
    if (mappedWorkspace) return;
    if (splatState.status !== 'ready') {
      if (splatState.status === 'idle' || splatState.status === 'error') setSplatShellKeptFor('');
      return;
    }
    if (calibratedSceneRef.current === splatState.assetId) return;
    calibratedSceneRef.current = splatState.assetId;
    const current = layoutStore.getState().layout;
    // 壳体已经是按这套扫描登记的尺寸摆好；预览读数可能还是样例或旧缓存，不再覆盖，
    // 否则会多出一条历史，撤销一次就退不回原场地。
    if (current.venueScan?.assetId === splatState.assetId && findAholoAsset(splatState.assetId)?.meters) return;
    const placement = placeSplatPreview(current, splatState.name, splatState.meters ?? null);
    if (!placement.resize) return;
    try {
      onApplyCreative({
        ...current,
        width: placement.resize.width,
        height: placement.resize.height,
      });
    } catch (error) {
      console.error('环境预览没有改场地尺寸', error);
      setSplatShellKeptFor(splatState.assetId);
    }
  }, [mappedWorkspace, splatState, onApplyCreative]);
  const splatPlacement = splatState.status === 'ready'
    ? placeSplatPreview(layout, splatState.name, splatState.meters ?? null)
    : null;
  const environmentShown = showGaussianInCanvas && environment !== null && (environment.floorIndex ?? 0) === activeFloorIndex && splatState.status === 'ready' && splatState.assetId === environment.assetId;
  const splatBanner = splatPlacement
    ? (splatShellKeptFor === splatState.assetId && splatPlacement.resize ? splatShellKeptNote(splatState.name) : splatPlacement.note)
    : null;
  // A selected venue is already represented by its space card and transform controls;
  // only temporary previews and a failed shell resize need a canvas notice.
  const splatBannerText = splatBanner && environmentShown ? splatBanner.replace('环境预览：', '环境：') : splatBanner;
  const showSplatBanner = showGaussianInCanvas && !!splatBannerText && (!environmentShown || splatShellKeptFor === splatState.assetId);
  const updateSplatPosition = (axis: keyof SplatPosition, value: number) => {
    if (!Number.isFinite(value)) return;
    const position = { ...(environment?.position ?? ZERO_SPLAT_POSITION), [axis]: value };
    if (!environment) return;
    onSplatPositionChange(position);
  };
  const setSplatTransformMode = useCallback((mode: SplatTransformMode) => {
    setSplatTransformModeState(mode);
    setSplatTransform(mode);
    if (mode !== 'off') setView(current => ({ ...current, selectMode: false, measurementMode: false, drawWallMode: false, drawZoneMode: false, walkthroughMode: false }));
  }, [setSplatTransform, setView]);
  useEffect(() => {
    if (environment) return;
    setSplatTransformModeState('off');
    setSplatTransform('off');
  }, [environment, setSplatTransform]);

  const onBindProject = useCallback((projectId: string) => {
    const before=layoutStore.getState().layout;
    if(!activitySession.isCurrent(sessionToken))throw new Error('活动已变化，未绑定项目。');
    if(before.id!==projectId)flushPendingBeforeSwitch();
    if(layoutStore.getState().layout!==before)throw new Error('保存期间活动已变化，未绑定项目。');
    actions.applyLayout({ ...before, id: projectId });
  }, [actions,activitySession.isCurrent,sessionToken,flushPendingBeforeSwitch]);
  // 无感挂云（设计规范 v2.5.2 §二.4）：登录态摆上第一件物料时静默建云项目并接上保存链。
  useSilentCloudAttach({ controller, layout, onBindProject });

  const onPreviewAi = useCallback((candidate: RoomLayout | null) => {
    const current = layoutStore.getState().layout;
    setAiPreview(candidate ? { base: current, candidate } : null);
    if (candidate) {
      setView(current => ({ ...current, view2D: false }));
      setPreviewGuard(snapshotPreviewContext(current, candidate));
    } else {
      setPreviewGuard(null);
    }
  }, []);
  const isScopedSessionCurrent = useCallback(() => {
    const id = layoutStore.getState().layout.id;
    return activitySession.isCurrent(sessionToken) && (id ? `activity:${id}` : 'draft:unidentified') === sessionScope;
  }, [activitySession.isCurrent, sessionToken, sessionScope]);
  const captureSeatingAllocation = () => {
    const record=agentBriefRef.current,chatId=getActiveAssistantSessionId(sessionScope),epoch=chatTransitionEpoch.current;
    if(!isScopedSessionCurrent()||!record||!chatId||record.scope!==sessionScope||record.epoch!==sessionToken?.epoch||record.chatEpoch!==epoch||record.sessionId!==chatId)return {status:'unavailable' as const};
    const value=cloudSeatingAllocation(record.memory),specs=cloudSeatingSpecs(record.memory),defaults=record.memory.localSeatingSpecs?.defaults,fingerprint=JSON.stringify([value??null,specs??null,defaults??null]),token=JSON.stringify([sessionScope,chatId,epoch,fingerprint]);
    const seatingIsCurrent=()=>{
      const latest=agentBriefRef.current;
      return isScopedSessionCurrent()&&chatTransitionEpoch.current===epoch&&getActiveAssistantSessionId(sessionScope)===chatId&&!!latest&&
        latest.scope===sessionScope&&latest.epoch===sessionToken?.epoch&&latest.chatEpoch===epoch&&latest.sessionId===chatId&&JSON.stringify([cloudSeatingAllocation(latest.memory)??null,cloudSeatingSpecs(latest.memory)??null,latest.memory.localSeatingSpecs?.defaults??null])===fingerprint;
    };
    if(process.env.NEXT_PUBLIC_AGENT_ANNOTATION_OBSERVATION!=='1')return {status:'ready' as const,value,specs,defaults,token,isCurrent:seatingIsCurrent};
    const floor=floorSession.capture(),activity=sessionToken,scene=layoutStore.getState(),draft=planAnnot.getSnapshot(),venue=routeVenueFacts.capture();
    const actor=controller.getSnapshot().user?.id??null,briefEpoch=briefIntentEpoch.current;
    const authorityVersion=controller.localDraftAuthorityVersion(),placementEpoch=placementIdentity.current.epoch;
    if(!floor||!activity||!venue||!actor||!seatingIsCurrent()||!floorSession.isCurrent(floor)||!routeVenueFacts.isCurrent(venue))return {status:'unavailable' as const};
    const annotationIsCurrent=()=>{
      try{
        const now=layoutStore.getState(),currentDraft=planAnnot.getSnapshot();
        return seatingIsCurrent()&&activitySession.isCurrent(activity)&&floorSession.isCurrent(floor)&&routeVenueFacts.isCurrent(venue)&&
          placementIdentity.current.controller===controller&&placementIdentity.current.isActive&&placementIdentity.current.epoch===placementEpoch&&
          controller.localDraftAuthorityVersion()===authorityVersion&&(controller.getSnapshot().user?.id??null)===actor&&briefIntentEpoch.current===briefEpoch&&now.revision===scene.revision&&
          now.activeFloorIndex===floor.floorIndex&&currentDraft.revision===draft.revision&&sameRecoveryFormValue(currentDraft.draft,draft.draft);
      }catch{return false;}
    };
    const observation=readAgentAnnotationObservation({binding:{activityScope:sessionScope,activityEpoch:activity.epoch,sceneRevision:scene.revision,floorId:floor.floorId,annotationRevision:draft.revision},
      read:planAnnot.getSnapshot,bounds:{width:scene.layout.width,depth:scene.layout.height},annotationFloor:planAnnot.getUserAnnotationFloor,isCurrent:annotationIsCurrent});
    const parsed=agentAnnotationObservationSchema.safeParse(observation);
    const annotationObservation=parsed.success?parsed.data:{status:'unavailable' as const};
    const annotationProvenance=annotationObservation.status==='ready'?annotationObservation.annotations.map(item=>{
      const floorId=planAnnot.getUserAnnotationFloor(item.id);
      return {id:item.id,source:floorId?'user' as const:'unknown' as const,floorId};
    }):[];
    if(!annotationIsCurrent())return {status:'unavailable' as const};
    return {status:'ready' as const,value,specs,defaults,token,annotationObservation,annotationProvenance,
      readAnnotationReview:()=>{
        if(!annotationIsCurrent())return null;
        const latest=readAgentAnnotationObservation({binding:{activityScope:sessionScope,activityEpoch:activity.epoch,sceneRevision:scene.revision,floorId:floor.floorId,annotationRevision:draft.revision},
          read:planAnnot.getSnapshot,bounds:{width:scene.layout.width,depth:scene.layout.height},annotationFloor:planAnnot.getUserAnnotationFloor,isCurrent:annotationIsCurrent});
        const checked=agentAnnotationObservationSchema.safeParse(latest);
        if(!checked.success||!annotationIsCurrent())return null;
        const provenance=checked.data.status==='ready'?checked.data.annotations.map(item=>{
          const floorId=planAnnot.getUserAnnotationFloor(item.id);
          return {id:item.id,source:floorId?'user' as const:'unknown' as const,floorId};
        }):[];
        return annotationIsCurrent()?{observation:checked.data,provenance}:null;
      },isCurrent:()=>seatingIsCurrent()&&annotationIsCurrent()};
  };
  const captureDialogue = () => {
    const token=sessionToken, selectedFloor=floorToken, chatId=getActiveAssistantSessionId(sessionScope);
    if(pendingDialogueTurns.current.size||!activitySession.isCurrent(token)||!floorSession.isCurrent(selectedFloor)||!isScopedSessionCurrent())return null;
    const chatEpoch=chatTransitionEpoch.current, briefEpoch=briefCaptureEpoch.current;
    const reviewed=reviewedDialogueHistory.current;
    if(!chatId||!reviewed||reviewed.scope!==sessionScope||reviewed.sessionId!==chatId||reviewed.activityEpoch!==(token?.epoch??null)||reviewed.chatEpoch!==chatEpoch)return null;
    let memory:BriefMemory|null;
    try{memory=chatId&&incompleteDialogueSessions.current.has(dialogueSessionKey(chatId))?null:structuredClone(getActiveBrief());}catch{return null;}
    let released=false;
    return {
      project:(reference?:{event?:string|null;guests?:number|null})=>projectDialogueHandoff(memory,reference),
      isCurrent:()=>!released&&reviewedDialogueHistory.current===reviewed&&pendingDialogueTurns.current.size===0&&activitySession.isCurrent(token)&&floorSession.isCurrent(selectedFloor)&&isScopedSessionCurrent()&&
        chatTransitionEpoch.current===chatEpoch&&briefCaptureEpoch.current===briefEpoch&&getActiveAssistantSessionId(sessionScope)===chatId,
      release:()=>{released=true;},
    };
  };
  const reviewDialogueHistory=(sessionId:string):boolean=>{
    if(!isScopedSessionCurrent()||!activitySession.isCurrent(sessionToken)||!floorSession.isCurrent(floorToken)||pendingDialogueTurns.current.size||getActiveAssistantSessionId(sessionScope)!==sessionId||incompleteDialogueSessions.current.has(dialogueSessionKey(sessionId)))return false;
    pendingCandidates.invalidate();briefCaptureEpoch.current++;briefIntentEpoch.current++;
    reviewedDialogueHistory.current={scope:sessionScope,sessionId,chatEpoch:chatTransitionEpoch.current,activityEpoch:sessionToken?.epoch??null};
    return true;
  };
  const scopedPreview = useCallback((candidate: RoomLayout | null) => {
    const id = layoutStore.getState().layout.id;
    if (activitySession.isCurrent(sessionToken) && (id ? `activity:${id}` : 'draft:unidentified') === sessionScope) onPreviewAi(candidate);
  }, [onPreviewAi, sessionScope, activitySession.isCurrent, sessionToken]);
  const scopedApply = useCallback((next: RoomLayout, options?: { expectedBase?: RoomLayout; preserveProvenance?: boolean; expectedFloor?: FloorSessionToken }) => {
    const id = layoutStore.getState().layout.id;
    if (!activitySession.isCurrent(sessionToken) || (id ? `activity:${id}` : 'draft:unidentified') !== sessionScope) throw new Error('活动已切换，请重新核对方案。');
    onApplyCreative(next, options);
  }, [onApplyCreative, sessionScope, activitySession.isCurrent, sessionToken]);
  const openAholoWorkflow = useCallback((kind: 'world' | 'recon' = 'world', prompt?: string) => {
    noteVenueThreeIntent();
    setSpaceWorkflow('aholo');
    setLux3dOpenKind(current => ({ kind, nonce: (current?.nonce ?? 0) + 1, prompt: prompt ?? '' }));
    setLeftMode('lux3d');
    setBusinessOpen(false);
    setSidebarCollapsed(true);
    setSidePanel(null);
    setAgentClosing(false);
    setAgentCollapsed(false);
  }, []);
  const validAiPreview = aiPreview?.base === layout ? aiPreview.candidate : null;
  const previewCandidate = validAiPreview;
  // 预览说明只闪一下：候选出现时提示约 2 秒，之后淡出；重新回到画布才再闪一次。
  useEffect(() => {
    if (!previewCandidate) { setPreviewCaptionVisible(false); return undefined; }
    setPreviewCaptionVisible(true);
    const timer = window.setTimeout(() => setPreviewCaptionVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [previewCandidate, captionEpoch]);
  useProposalPreview({ isReady, threeModuleRef, sceneRef, layout,
    candidate: isActive ? previewCandidate : null, activeFloorIndex, invalidate, requestShadowUpdate });

  useEventAtmosphere({ isReady, threeModuleRef, sceneRef, rendererRef, invalidate,
    lighting: previewCandidate?.backendLighting ?? layout.backendLighting ?? DEFAULT_EVENT_LIGHTING, width: previewCandidate?.width ?? layout.width, depth: previewCandidate?.height ?? layout.height,
    ceilingHeight: previewCandidate?.floors[0]?.height ?? activeStoreyHeight,
    ...(sceneLighting ? { sceneLighting } : {}) });

  const captureReview=useReviewCapture({layout,getLayout:()=>layoutStore.getState().layout,view,activeFloorIndex,
    ready:isReady||view.view2D,peopleReady:peopleModelReady,selectedItemId,extraSelectedIds,
    hasCollision:item=>structuralItemCollides(item,layout,activeFloorIndex)||hasCollisions(item,activeFloor.items,layout.width,layout.height,{keepOut,structureValidated:!!layout.backendSceneV2,interiorWalls:layout.backendSceneV2?[]:activeFloor.interiorWalls}),
    ...(referenceImage.layer?{referenceImage:referenceImage.layer}:{}),
    canvas:canvasRef,canvas2D:canvas2DRef,scene:sceneRef,renderer:rendererRef,camera:cameraRef,
    pendingPreview:!!previewCandidate,isInteracting:()=>isDragActive()||!!wallDraft||!!placingId||!!pendingCatalog});
  // 活动封面取当前三维画面；归档面板通过注册表取图，不直接持有 WebGL 场景。
  useEffect(() => registerStageCover(() => {
    const renderer = rendererRef.current, scene = sceneRef.current, camera = cameraRef.current, canvas = canvasRef.current;
    if (!isReady || view.view2D || !renderer || !scene || !camera || !canvas) return null;
    renderer.render(scene, camera);
    return encodeStageCover(canvas);
  }), [isReady, view.view2D]);
  const reviewContext=JSON.stringify(referenceImage.layer??null);
  // §二.4 默认在云上：保存态只说「已保存」，不出现云/本地二元说法。
  const hasLocalZones = layout.floors.some(floor => (floor.zones?.length ?? 0) > 0);
  const draftLabel = saveError ? '保存失败' : isSaving ? '正在保存…' : hasLocalZones ? '本机草稿' : lastSavedAt ? '已保存' : '草稿';
  const draftFoot = saveError ? '未保存' : isSaving ? '保存中' : hasLocalZones ? '本机草稿' : lastSavedAt ? '已保存' : '';
  const draftTitle = saveError ? '保存失败，请导出备份' : hasLocalZones ? '区域标注仅在本机保留，云端暂不支持；请备份。' : draftLabel;
  // 集成接线：顶栏容量计——从 layout 读宽深（height 字段在本仓库里是深度），调用纯函数估算。
  // A heuristic object density is neither the venue's approved capacity nor
  // a physical upper bound. Show the observable count and keep capacity unknown.
  const capacityText = `当前物料 ${materialCount(activeFloor.items)} 件 · 场地容量待核验`;

  // 第 12 批：「能摆 → 会摆」三版打分。draft.annotations 里的 zone 标注跑三档密度
  // （松/适中/密），每版独立打分，父组件把分数条 + 推荐版传给 PlanCard。
  // 纯函数，没有副作用，每次 render 重算即可（zone 数量小）。
  const draftAnnotations = planAnnot.draft?.annotations ?? [];
  const zonePreparation = planAnnot.draft ? appendPlanZones(layout, activeFloorIndex, planAnnot.draft) : null;
  const zoneAnnotationsForScoring = draftAnnotations.filter((a) => a.kind === 'zone');
  const scoredPlans: ScoredPlan[] = planAnnot.draft
    ? zonePlanCandidates(layout, activeFloorIndex, planAnnot.draft, agentBriefMemory) : [];
  const recommendedPlan: ScoredPlan | null = scoredPlans.length > 0
    ? pickRecommendedPlan(scoredPlans)
    : null;
  const effectiveSelectedPlan: ScoredPlan | null =
    scoredPlans.find((p) => p.variantId === selectedVariantId) ?? recommendedPlan;
  // 只根据本活动已绘制区域和场地尺寸提示，不读取其他活动的对话。
  const zoneTypesForSuggestions = [
    ...new Set(
      zoneAnnotationsForScoring
        .filter((a): a is typeof a & { zoneType: ZoneSemanticType } => typeof a.zoneType === 'string')
        .map((a) => a.zoneType),
    ),
  ];
  const roomShortSideM = (typeof layout.width === 'number' && typeof layout.height === 'number')
    ? Math.min(layout.width, layout.height)
    : undefined;
  const activitySuggestions: ActivitySuggestion[] = zoneAnnotationsForScoring.length > 0
    ? generateSuggestions({
        audience: '',
        zoneTypes: zoneTypesForSuggestions,
        ...(typeof roomShortSideM === 'number' ? { roomShortSideM } : {}),
      })
    : [];

  const localSwitchGuard=useMemo(()=>createLocalActivitySwitchGuard({
    identity:()=>{const current=layoutStore.getState();return {scope:current.layout.id??'',layoutRevision:current.revision};},
    snapshot:planAnnot.getSnapshot,
    blocker:scope=>{
      if(pendingEnvironmentPositionRef.current)return '场地位置尚待核对，请先保留并处理候选，再切换活动。';
      if(unsavedSourceDrafts(scope).length)return '有未保存的图片原件，请先保存或导出，再切换活动。';
      if(readonlyComposerDrafts(`activity:${scope}`).length)return '有未发送的活动对话，请先发送或保留草稿，再切换活动。';
      for(const [kind,label] of [['brief','活动需求'],['creative-conversation','未发送对话']] as const){
        const draft=readLiveReadonlyDraft(scope,kind);
        if(draft.status==='unavailable')return `${label}当前无法完整核对，未切换活动。`;
        if(draft.status==='captured')return `${label}尚有未保存内容，请先保存或保留草稿，再切换活动。`;
      }
      if(!activitySession.isCurrent(sessionToken)||getStoreSessionScope()!==sessionScope)return '活动已变化，未切换。';
      try{flushPendingBeforeSwitch();}catch(error){return error instanceof Error?error.message:'当前活动未保存，未切换。';}
      return null;
    },
  }),[planAnnot.getSnapshot,activitySession.isCurrent,sessionToken,sessionScope,flushPendingBeforeSwitch]);
  if (!activitySession.isCurrent(sessionToken)) return <div role="status">正在核对活动会话，请稍候。</div>;

  return (
    <LocalActivitySwitchGuardProvider guard={localSwitchGuard}>
    <RoomEditorProvider value={roomEditorValue}>
    <SelectionProvider value={selectionValue}>
    <CreativeStudioProvider pendingCandidates={pendingCandidates} captureImage={view => captureRenderImage({ view, scale: 1 })} floorToken={floorToken} isFloorCurrent={floorSession.isCurrent} sessionToken={sessionToken} isSessionCurrent={activitySession.isCurrent} captureSeatingAllocation={captureSeatingAllocation} captureDialogue={captureDialogue} captureMobility={()=>{
      const token=sessionToken,selectedFloor=floorToken;if(!activitySession.isCurrent(token)||!floorSession.isCurrent(selectedFloor))throw new Error('活动或楼层已切换，请重新核对后导出。');
      const snapshot=()=>{const memory=getActiveBrief();return {present:!!memory,requirement:memory?.mobilityRequirement??null,needsClarification:memory?.mobilityNeedsClarification===true};};
      const basis=structuredClone(snapshot()),requirement=basis.requirement;
      const decision=!basis.needsClarification&&(requirement?.decision==='needed'||requirement?.decision==='not_needed')?requirement.decision:null;
      const width=extractMobilityWidth(requirement,basis.needsClarification);
      return {decision,width,isCurrent:()=>activitySession.isCurrent(token)&&floorSession.isCurrent(selectedFloor)&&sameRecoveryFormValue(snapshot(),basis)};
    }} sourceWriteGuard={workspaceWriteGuards?.source} writeCapability={workspaceWriteGuards?.capability} onUpdateProductionPlan={value=>{if(!activitySession.isCurrent(sessionToken)||getStoreSessionScope()!==sessionScope)throw new Error('活动已切换，请重新核对。');commitHistoryNow();actions.setProductionPlan(value);}} reviewContext={reviewContext} controller={controller} layout={layout} getCurrentLayout={() => layoutStore.getState().layout} onApply={scopedApply} validateGenerationIntent={() => {
      const brief = getActiveBrief();
      if (!brief) return '活动需求正在切换，请稍后再试。';
      if (brief.headcount === null) return '请先确认本场活动人数，再生成方案。';
      if ((!isVenueScaleCurrent(brief, layoutStore.getState().layout) || !isVenueFactMemoryCurrent(brief, layoutStore))) return '场地已变化，请重新核对当前场地尺寸。';
      const dimensionsMismatch = venueDimensionsMismatch(brief, layoutStore.getState().layout);
      if (dimensionsMismatch) return dimensionsMismatch;
      if (brief && brief.layoutModeConfirmed !== true) return '布置方式尚未确认，请先选择圆桌或课桌椅。';
      return brief && (hasBlockingActivityNeeds(brief,true) || brief.layoutModeUnresolved || brief.mobilityNeedsClarification || brief.mobilityRequirement?.decision === 'unknown' || brief.pendingBasicFacts?.length)
        ? '活动需求仍有待确认的内容，请先核对再生成。' : null;
    }} preflightApply={(base, candidate) => {
      const current = layoutStore.getState().layout;
      if (!sameLayoutContent(current, base)) return '当前画布已经变化，请重新生成方案。';
      if (candidate.floors.some(floor => (floor.zones?.length ?? 0) > 0)) return '当前云端场景不能保存区域标注，请先备份本地方案并处理标注。';
      if (!canApplyLayoutGeometry(current, candidate)) return '候选方案与墙体、柱子或边界冲突，请先修正。';
      return completeLayoutError(applyLayoutCommandWithRefusals(applyLayoutCommand({ layout: candidate }), { layout: current }));
    }} validateCandidateRequirements={(_base, candidate) => {
      const memory = getActiveBrief();
      const issues: string[] = [];
      if (!memory) issues.push('活动需求正在切换，请稍后再试。');
      else if (memory.headcount === null) issues.push('请先确认本场活动人数，再应用方案。');
      if (memory && (!isVenueScaleCurrent(memory, layoutStore.getState().layout) || !isVenueFactMemoryCurrent(memory, layoutStore))) issues.push('场地已变化，请重新核对当前场地尺寸。');
      if (memory) { const mismatch = venueDimensionsMismatch(memory, candidate, 'candidate'); if (mismatch) issues.push(mismatch); }
      if (memory && memory.layoutModeConfirmed !== true) issues.push('布置方式尚未确认，请先选择圆桌或课桌椅。');
      if (memory && (hasBlockingActivityNeeds(memory,false) || memory.layoutModeUnresolved || memory.mobilityNeedsClarification || memory.mobilityRequirement?.decision === 'unknown' || memory.pendingBasicFacts?.length)) issues.push('活动需求仍有待确认的内容，请先核对。');
      if (candidate.floors.some(floor => (floor.zones?.length ?? 0) > 0)) issues.push('当前云端场景不能保存区域标注，请先备份本地方案并处理标注。');
      const seats = checkRequiredSeats(candidate, activeFloorIndex, memory?.headcount,
        memory?.allGuestsSeated === true);
      if (seats.status === 'unknown' && seats.message) issues.push(seats.message);
      const rest = checkRestArea(candidate, activeFloorIndex, memory?.zoneNeeds.rest === true);
      if (rest.status === 'unknown' && rest.message) issues.push(rest.message);
      issues.push(...checkFunctionalRequirements(candidate, activeFloorIndex, { checkin: memory?.zoneNeeds.checkin ?? null, stage: memory?.zoneNeeds.stage ?? null })
        .filter(check => check.status === 'unknown' && memory?.zoneNeeds[check.kind] != null).map(check => check.message));
      return issues.length ? issues.join(' ') : null;
    }} prepareRestoreLayout={prepareRestoreLayout} commitRestoredLayout={commitRestoredLayout} commitFreshActivityLayout={commitFreshActivityLayout} onBindProject={projectId => { if (!activitySession.isCurrent(sessionToken) || getStoreSessionScope() !== sessionScope) throw new Error('活动已切换，请重新核对。'); onBindProject(projectId); }} onPreview={scopedPreview} onUpdateItem={(id, patch) => { if (!activitySession.isCurrent(sessionToken) || getStoreSessionScope() !== sessionScope) throw new Error('活动已切换，请重新核对。'); commitHistoryNow(); actions.updateItem(id, patch); }} onUpdateEventOperations={value => {
      if (!activitySession.isCurrent(sessionToken) || getStoreSessionScope() !== sessionScope) throw new Error('活动已切换，请重新核对。');
      if (!parseLayoutEventOperations({ ...layoutStore.getState().layout, eventOperations: value })) throw new Error('活动安排未保存，请核对任务内容及关联物料是否有重复编号。');
      commitHistoryNow(); actions.setEventOperations(value);
    }}>
      <LayoutAgentProvider pendingCandidates={pendingCandidates} key={`${sessionScope}:${sessionToken?.epoch ?? 'starting'}`} sessionScope={sessionScope} isSessionCurrent={isScopedSessionCurrent} onDialogueTurnStart={beginDialogueTurn} onDialogueIncompleteChange={setDialogueIncomplete} onDialogueHistoryReview={reviewDialogueHistory} assertSessionWrite={isolatedRef.current ? () => { assertIsolatedSession?.(); isolatedRef.current!.session.assertSessionWrite(); } : workspaceWriteGuards?.assertLayoutWrite} handoffExportRequest={handoffExportRequest} zoneDraftRevision={planAnnot.revision} getPlanAnnotationSnapshot={planAnnot.getSnapshot} getUserRouteProvenance={planAnnot.getUserRouteProvenance} onBriefMemoryChange={(memory,sessionId) => {
        if (!activitySession.isCurrent(sessionToken) || getStoreSessionScope() !== sessionScope || !sessionToken) return;
        briefCaptureEpoch.current++;
        const prior=agentBriefRef.current;
        if(!prior || prior.scope!==sessionScope || prior.epoch!==sessionToken.epoch || prior.chatEpoch!==chatTransitionEpoch.current || prior.sessionId!==sessionId || !sameRecoveryFormValue(prior.memory,memory))briefIntentEpoch.current++;
        const record = { scope: sessionScope, epoch: sessionToken.epoch, chatEpoch:chatTransitionEpoch.current, sessionId, memory };
        agentBriefRef.current = record;
        setAgentBriefRecord(record);
      }} onVenueIOChange={io => { if (activitySession.isCurrent(sessionToken) && getStoreSessionScope() === sessionScope) setOutdoorVenue(io === 'outdoor'); }}
      onPreview={scopedPreview}
      onApply={scopedApply} onApplyResearchArea={area=>{if(!applyResearchArea(area))throw new Error('当前活动无法写入调研底图。');}} onApplyZoneRects={(zones) => {
        if (!activitySession.isCurrent(sessionToken) || getStoreSessionScope() !== sessionScope) { notify('活动已切换，请重新核对区域建议。', 'info'); return null; }
        const brief = getActiveBrief();
        if (!brief) { notify('活动需求正在切换，请稍后再试。', 'info'); return null; }
        if ((!isVenueScaleCurrent(brief, layoutStore.getState().layout) || !isVenueFactMemoryCurrent(brief, layoutStore))) { notify('场地已变化，请重新核对当前场地尺寸。', 'info'); return null; }
        if (brief && (brief.pendingActivityNeeds.length || brief.unresolvedActivityNeeds.length || brief.layoutModeUnresolved || brief.mobilityNeedsClarification || brief.mobilityRequirement?.decision === 'unknown' || brief.pendingBasicFacts?.length)) {
          notify('活动需求仍有待确认内容，请先核对再规划区域。', 'error');
          return null;
        }
        if (zones.some(zone => (zone === 'checkin' || zone === 'rest') && brief?.zoneNeeds[zone] !== true)) {
          notify('区域建议已过期或需求尚未确认，请重新说明需要的区域。', 'error');
          return null;
        }
        // 「回好自动落区」：把 AI 提议的 zone 类型按 defaultZoneRect 排到 2D 草案。
        // drawMode 保持 off，不强迫用户进绘制模式；reducer 内部没有 draft 时自动建一份。
        const rects = buildDefaultZoneRects(zones, { width: layout.width, height: layout.height });
        if (rects.length === 0) return null;
        planAnnot.addZoneRects(rects);
        return rects.map(r => r.label).join('、');
      }} callbacks={{
        workbenchMode,
        onOpenMaterials: () => { setWorkbenchMode('layout'); showAgent('material'); },
        onSelectMode: selectWorkbenchMode,
        onOpenReview: () => openBusinessWorkspace('review'),
        onOpenDelivery: () => openBusinessWorkspace('delivery'),
        onIssueReviewLink: issueReviewLink,
        onFit: fitToRoom,
        onOpenReference: () => businessToolsRef.current?.openReference(),
        onOpenRebuild: () => businessToolsRef.current?.openRebuild(),
        onOpenLux3d: openAholoWorkflow,
        luxToolsVisible: luxDirectVisible,
      }}>
      <div className={`sc-workbench${conversationOpen ? ' has-conversation' : ''}${walkthroughActive ? ' is-walkthrough' : ''}${leftCardResizing ? ' is-left-resizing' : ''}`}>
        <div ref={headerRef} className="sc-header">
          <button ref={conversationEntryRef} type="button" hidden aria-hidden tabIndex={-1} aria-label={conversationOpen ? '关闭助手' : '打开助手'} onClick={()=>{if(conversationOpen)setConversationCloseRequest(value=>value+1);else setConversationOpenRequest(value=>value+1);}}/>
          <span
            role="status"
            style={{
              marginLeft: 'auto',
              marginRight: 12,
              padding: '2px 8px',
              borderRadius: 4,
              background: '#F4F5F7',
              color: '#4A7C59',
              fontSize: 11,
              lineHeight: '18px',
              fontFamily: 'inherit',
            }}
          >
            {capacityText}
          </span>
        </div>
        <main data-nav={columnExpanded ? 'expanded' : 'collapsed'} className={`sc-workspace is-docked-layout is-mode-rail${columnExpanded ? ' has-left-column' : ''}${agentCollapsed?' is-agent-collapsed':''}${conversationOpen?' has-conversation':''}`} style={{ ['--sc-left-card-width' as string]: `${leftColumnWidth}px` }}>
          <button ref={reviewEntryRef} type="button" hidden aria-hidden tabIndex={-1}/>
          <button ref={deliveryEntryRef} type="button" hidden aria-hidden tabIndex={-1}/>
          <div className="sc-mode-rail" id="sc-agent-rail" data-mobile-open={mobileRailOpen ? 'true' : 'false'}>
            <div className="sc-rail-head">
              <WorkbenchBrandToggle expanded={columnExpanded} active={isLaneOpen('door')} onToggle={() => toggleAgent('door')} buttonRef={brandRailRef} />
              <nav className="sc-mode-rail-primary" aria-label="活动、Bingo、空间、物料">
                <BingoRailButton open={isLaneOpen('bingo')} onOpen={() => toggleAgent('bingo')} buttonRef={bingoRailRef} />
                <button
                  type="button"
                  ref={spaceEntryRef}
                  className={`sc-rail-tool sc-rail-disc${isLaneOpen('space') ? ' is-active' : ''}`}
                  aria-pressed={isLaneOpen('space')}
                  aria-expanded={isLaneOpen('space')}
                  aria-controls="agent-panel"
                  aria-label="空间"
                  data-tip="空间"
                  onClick={() => toggleAgent('space')}
                >
                  <RailAvatar form="cube" size={28} />
                  <RailLaneDot lane="space" open={isLaneOpen('space')}/>
                  <span className="sc-rail-label" aria-hidden="true">空间</span>
                </button>
                <button
                  type="button"
                  ref={toolsEntryRef}
                  className={`sc-rail-tool sc-rail-disc${isLaneOpen('material') ? ' is-active' : ''}`}
                  aria-pressed={isLaneOpen('material')}
                  aria-expanded={isLaneOpen('material')}
                  aria-controls="agent-panel"
                  aria-label="物料"
                  data-tip="物料"
                  onClick={() => toggleAgent('material')}
                >
                  <RailAvatar form="pyramid" size={28} />
                  <RailLaneDot lane="material" open={isLaneOpen('material')}/>
                  <span className="sc-rail-label" aria-hidden="true">物料</span>
                </button>
                <button type="button"
                  className={`sc-rail-tool sc-rail-disc sc-rail-capture${captureOpen ? ' is-active' : ''}`}
                  aria-label="拍摄场地：拍完当场判断能不能重建，并出 3D"
                  data-tip="拍摄场地 · 出 3D"
                  aria-expanded={captureOpen}
                  onClick={captureOpen ? closeCapturePanel : openCapturePanel}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.1-1.7a1 1 0 0 1 .84-.46h4.72a1 1 0 0 1 .84.46L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-8Z" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="12" cy="12.5" r="3.1" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <span className="sc-rail-label" aria-hidden="true">拍摄场地</span>
                </button>
                <button
                  type="button"
                  className={`sc-rail-tool sc-rail-disc${outdoor2DOpen ? ' is-active' : ''}`}
                  aria-pressed={outdoor2DOpen}
                  aria-label="户外规划：在地图上画边界分区动线"
                  data-tip="户外规划 · 地图上画边界分区动线"
                  onClick={() => setOutdoor2DOpen(current => {
                    const next = !current;
                    if (next) setOutdoorPanel(current1 => current1 ?? 'layers'); // 开启默认亮图层卡（浮窗进左栏）。
                    return next;
                  })}
                >
                  <Globe size={26} aria-hidden="true" />
                  <span className="sc-rail-label" aria-hidden="true">户外规划</span>
                </button>
                {outdoor2DOpen && (
                  <>
                    <button
                      type="button"
                      className={`sc-rail-tool sc-rail-disc${outdoorPanel === 'layers' ? ' is-active' : ''}`}
                      aria-pressed={outdoorPanel === 'layers'}
                      aria-label="图层：图层开关与编辑模式"
                      data-tip="图层 · 开关与编辑模式"
                      onClick={() => setOutdoorPanel(current2 => current2 === 'layers' ? null : 'layers')}
                    >
                      <Layers size={26} aria-hidden="true" />
                      <span className="sc-rail-label" aria-hidden="true">图层</span>
                    </button>
                    <button
                      type="button"
                      className={`sc-rail-tool sc-rail-disc${outdoorPanel === 'info' ? ' is-active' : ''}`}
                      aria-pressed={outdoorPanel === 'info'}
                      aria-label="规划信息：统计清单问题图例"
                      data-tip="规划信息 · 统计/清单/问题"
                      onClick={() => setOutdoorPanel(current3 => current3 === 'info' ? null : 'info')}
                    >
                      <Info size={26} aria-hidden="true" />
                      <span className="sc-rail-label" aria-hidden="true">信息</span>
                    </button>
                  </>
                )}
              </nav>
            </div>
            <RailTeamBlock controller={controller} team={team} onOpenChat={member => setChatPeerId(current => current === member.userId ? null : member.userId)} onOpenTeam={() => setTeamOpenRequest(current => ({ serial: (current?.serial ?? 0) + 1, section: 'team' }))}/>
            <div className="sc-mode-rail-foot">
              {draftFoot && <p role="status" className={`sc-rail-draft${saveError ? ' has-error' : ''}`} title={draftTitle}>{draftFoot}</p>}
              <button
                type="button"
                className={`sc-annotation-toggle${planAnnot.drawMode !== 'off' ? ' is-active' : ''}`}
                aria-label={planAnnot.drawMode === 'off' ? '规划活动区域' : '结束规划绘制'}
                aria-pressed={planAnnot.drawMode !== 'off'}
                data-tip="标注：区/线/疏散/距/门循环切换"
                onClick={() => {
                  // 首次点击时开一份空草案。
                  // door（真门标注）已接入：点墙边落一扇真门（inferred 缺省），评分层走 verified 门弧检查。
                  const order: PlanDrawMode[] = ['off', 'zone', 'route', 'fire-route', 'measure', 'door'];
                  const idx = order.indexOf(planAnnot.drawMode);
                  const next = order[(idx + 1) % order.length];
                  if (!planAnnot.draft) planAnnot.startDraft();
                  setView(current => ({ ...current, view2D: true, walkthroughMode: false }));
                  planAnnot.setDrawMode(next);
                }}
              >
                <span className="sc-annotation-toggle__label">标注</span>
                {planAnnot.drawMode === 'zone' && <span className="sc-annotation-toggle__suffix">·区</span>}
                {planAnnot.drawMode === 'route' && <span className="sc-annotation-toggle__suffix">·线</span>}
                {planAnnot.drawMode === 'fire-route' && <span className="sc-annotation-toggle__suffix">·疏散</span>}
                {planAnnot.drawMode === 'measure' && <span className="sc-annotation-toggle__suffix">·距</span>}
                {planAnnot.drawMode === 'door' && <span className="sc-annotation-toggle__suffix">·门</span>}
              </button>
              <SettingsMenu buttonRef={workspaceEntryRef} />
              
              <CloudPanel sessionToken={sessionToken} isSessionCurrent={activitySession.isCurrent} onBeforeActivitySwitch={flushPendingBeforeSwitch} getCurrentLayout={()=>layoutStore.getState().layout} controller={controller} layout={layout} draftNote={{ label: draftLabel, error: !!saveError, ...(draftTitle ? { title: draftTitle } : {}) }} onLoadLayout={onLoadLayout} onApplyLayout={onApplyCreative} {...(teamOpenRequest ? { openRequest: teamOpenRequest } : {})} onClose={()=>{if(conversationOpen&&window.innerWidth<=680)headerRef.current?.parentElement?.querySelector<HTMLButtonElement>('.cr-chat-header-actions button')?.focus();}}/>
            </div>
          </div>
          {/* 手机端左轨唯一入口；桌面由 CSS 隐藏，不影响三栏。 */}
          <button
            type="button"
            className="sc-mobile-agent-entry"
            aria-label="Agent 菜单"
            aria-expanded={mobileRailOpen}
            aria-controls="sc-agent-rail"
            onClick={() => setMobileRailOpen(value => !value)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="6.6" height="6.6" rx="2" fill="currentColor" />
              <rect x="10.4" y="1" width="6.6" height="6.6" rx="2" fill="currentColor" opacity=".45" />
              <rect x="1" y="10.4" width="6.6" height="6.6" rx="2" fill="currentColor" opacity=".45" />
              <rect x="10.4" y="10.4" width="6.6" height="6.6" rx="2" fill="currentColor" />
            </svg>
          </button>
          {!columnExpanded && <MobileAgentDock agentId={activeAgent} onOpen={() => toggleAgent(activeAgent)} />}
          {!captureOpen && <button type="button" className="sc-mobile-capture-entry" onClick={openCapturePanel} aria-expanded={false} aria-label="拍摄场地：拍完出 3D">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.1-1.7a1 1 0 0 1 .84-.46h4.72a1 1 0 0 1 .84.46L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-8Z" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="12.5" r="3.1" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            <span>拍摄场地</span>
          </button>}
          <div id="workbench-nav-column" className={`sc-left-column${sidebarCollapsed ? '' : ' has-tool'}`}>
          {capturePanel !== 'new' && <aside ref={capturePanelRef} className="sc-workbench-capture" aria-label="场地采集" tabIndex={-1} hidden={!captureOpen}
            onKeyDown={event => {
              if (event.key !== 'Escape' || event.defaultPrevented) return;
              event.stopPropagation();
              closeCapturePanel();
            }}>
            <WorkbenchCaptureGuide key={layout.id ?? layout.name} venueName={hasMapVenue ? layout.name?.split(' · ')[0] : undefined} onClose={closeCapturePanel} />
          </aside>}
          <div id="workbench-left-panel" className={`sc-left-drawer sc-float-layer ${sidebarCollapsed || captureOpen ? 'is-collapsed' : ''}${leftMode==='brief'?' has-brief':''}${leftMode==='business'?' has-business':''}${leftMode==='properties'?' has-properties':''}`}>
            <div className="sc-left-heading"><nav className="sc-left-context" aria-label="当前工具内容">
              {selectedItem&&<button type="button" aria-pressed={leftMode==='properties'} onClick={()=>{setLeftMode('properties');setSidebarCollapsed(false);}}>选中物料</button>}
              {luxDirectVisible&&(leftMode==='lux3d'||aholoReconPreset)&&<button type="button" aria-pressed={leftMode==='lux3d'} onClick={()=>{setLux3dOpenKind(null);setLeftMode('lux3d');setBusinessOpen(false);setSidebarCollapsed(false);}}>场地观感</button>}
            </nav><button type="button" className="sc-left-close sc-icon-button" aria-label="收起左侧面板" onClick={closeLeftPanel}><PanelLeftClose size={20}/></button></div>
            <div className="sc-left-content sc-mode-card-host" hidden/>
          </div>
          {!captureOpen && personChat && chatPeerId && <MemberChat key={chatPeerId} controller={controller} team={team} peerId={chatPeerId} onClose={() => setChatPeerId(null)}/>}
          {!captureOpen && !personChat && agentPanelVisible && <AgentPanel onClose={closeBingo} activeAgent={activeAgent} spaceSlot={<SpacePanel variant="card" onOpenCapture={openCapturePanel} {...(luxDirectVisible ? { onGenerate: () => { setSpaceWorkflow('aholo'); openAholoWorkflow('world'); }, onReconstruct: () => openAholoWorkflow('recon') } : {})} onAddSampleScene={startStoredScene} layout={layout} {...(sessionScope.startsWith("activity:") ? { venueFactScope: sessionScope } : {})} isVenueFactScopeCurrent={isScopedSessionCurrent} onApply={scopedApply} workflow={spaceWorkflow} onRegisterNew={run => { spaceNewRef.current = run; }} onPickScan={venue => mappedWorkspace ? previewProjectScene(venue.assetId, venue.name) : applyRealVenue(venue, true)} {...(canTryHanfuWalk ? { onTryHanfuWalk: startWalk, ...(hanfuWalkDisabledReason ? { hanfuWalkDisabledReason } : {}) } : {})} {...(scanIsolated ? { onShowScanContext: hasMapVenue ? focusMapVenue : () => setIsolatedScanId(undefined) } : {})} currentScanId={environment?.assetId} environment={{ preview: splatState, current: environment, environments, floors: layout.floors.map(floor => ({ id: floor.id, name: floor.name })), onSelect: selectEnvironment, onRemove: removeEnvironment, onSetFloor: setEnvironmentFloor, onClear: dropEnvironment, thumbnails: projectSceneThumbnails, onPreview: previewProjectScene }}/>} materialSlot={<ScendanceLibrary variant="card" capturePlacement={capturePlacement} capturePlacementBatch={capturePlacementBatch} controller={controller} placeCatalogItem={placeFromCatalog} placeCatalogItemResult={placeCatalogItemResult} walkRoles={WALK_ROLES.map(role => ({ id: role.assetId, name: role.name, image: role.image, walkable: role.walkable, ...(role.note ? { note: role.note } : {}), selected: role.assetId === walkRoleId, onSelect: () => setWalkRoleId(role.assetId) }))}/>} chatSlot={<AgentChatBridge controller={controller} agent={activeAgent} hideLibraryActions onNewSpace={mode => spaceNewRef.current?.(mode)} onOpenAholo={luxDirectVisible ? openAholoWorkflow : undefined} onSelectSpaceWorkflow={setSpaceWorkflow} onOpenActivity={() => showAgent("door")}/>} headerAvatarRef={bingoHeaderAvatarRef} headerAvatarVisible={bingoHeaderAvatarVisible}/>}
          <BingoAvatarFlight open={agentPanelOpen} form={AGENT_META[activeAgent].form} railRef={agentRailRefs[activeAgent]} headerAvatarRef={bingoHeaderAvatarRef} />
          <LeftCardResizer width={leftColumnWidth} onWidth={rememberLeftCardWidth} onDragging={setLeftCardResizing} />
          </div>
          <div className={`sc-canvas-stage ${selectedItem ? 'has-selection' : ''}${workbenchMode === 'review' ? ' is-review' : ''}`} onPointerEnter={() => { if (previewCandidate) setCaptionEpoch(value => value + 1); }} onPointerDownCapture={event => {
            if (workbenchMode !== 'layout' || !pendingCatalog || !(event.target instanceof HTMLCanvasElement)) return;
            event.preventDefault(); event.stopPropagation();
            const point = view.view2D ? clientToWorld2D(event.clientX,event.clientY) : worldPositionFromClient(event.clientX,event.clientY);
            if (!point) return;
            const id = placeDiscrete(pendingCatalog,point);
            if (id) selectOnly(id, { keepPanel: true });
          }}>
          {outdoor2DOpen && (
            <OutdoorPlanOverlay
              projectId={layout.id ?? null}
              anchor={layout.sceneAnchor ?? layout.mapLngLat ?? null}
              activityName={layout.name}
              activePanel={outdoorPanel}
              onClose={() => setOutdoor2DOpen(false)}
            />
          )}
      <div className="sc-scene-viewport"><Viewport
        isReady={isReady}
        error={error}
        view2D={view.view2D}
        layout={layout}
        activeFloor={activeFloor}
        selectedItem={selectedItem}
        selectionCount={allSelectedIds.size}
        onCopySelection={copySelectionToClipboard}
        selectionGrouped={selectionIsGroup}
        onGroupSelection={selectionIsGroup ? undefined : groupSelection}
        onUngroupSelection={selectionHasGroups ? ungroupSelection : undefined}
        onSaveSelectionAsSet={saveSelectionAsSet}
        gizmoMode={gizmoMode}
        onGizmoModeChange={setGizmoMode}
        onAlignSelection={alignSelected}
        onDistributeSelection={distributeSelected}
        showMeasurements={view.showMeasurements}
        showMinimap={view.showMinimap}
        walkthroughActive={walkthroughActive}
        walkthroughPhase={walkthroughPhase}
        walkthroughSeat={walkNearSeat?.name ?? null}
        walkthroughSeated={walkSeated}
        walkthroughInEnvironment={environmentShown}
        walkthroughMetric={splatWalkBounds !== null}
        measurementDistance={measurementDistance(measurementPoints)}
        {...(view.measurementMode ? { measurementPointsPlaced: measurementPoints.length } : {})}
        wallDrawStatus={
          view.drawWallMode
            ? {
                hasAnchor: wallDraft !== null,
                ...(wallSnapResult ? { snapKind: wallSnapResult.kind } : {}),
                currentLength:
                  wallDraft && wallSnapResult
                    ? Math.hypot(
                        wallSnapResult.point.x - wallDraft.x,
                        wallSnapResult.point.z - wallDraft.z
                      )
                    : null,
              }
            : null
        }
        canvasRef={canvasRef}
        canvas2DRef={canvas2DRef}
        hover={
          hover &&
          (() => {
            const item = activeFloor.items.find((entry) => entry.id === hover.id);
            return item ? { item, clientX: hover.clientX, clientY: hover.clientY } : null;
          })()
        }
        onCatalogDrop={async (clientX, clientY, key) => {
          if (workbenchMode !== 'layout' || !dropActive.current) return;
          const base = layoutStore.getState();
          const world = view.view2D
            ? clientToWorld2D(clientX, clientY)
            : worldPositionFromClient(clientX, clientY);
          if (!world) return;
          const placement = capturePlacement();
          try {
            let item = findCatalogEntry(EVENT_CATALOG, key);
            if (key.startsWith('online:')) {
              const model = (await loadOnlineModels()).models.find(entry => entry.slug === key.slice(7));
              if (!model) return;
              item = await loadOnlineCatalogItem(model, controller);
            }
            if (!item) return;
            if (!dropActive.current) return;
            if (layoutStore.getState() !== base) throw new Error('下载期间画布已有变化，请重新拖入物料。');
            placement.assertCurrent();
            // F3 智能落点：拖到已有物件附近自动吸附到旁侧，避免重叠。
            const anchors = activeFloor.items.filter(e => e.position).map(entry => ({ id: entry.id, name: entry.name, x: entry.position!.x, z: entry.position!.z, width: entry.width, depth: entry.depth }));
            const suggested = suggestDropPoint(world, anchors, { width: item.width, depth: item.depth });
            const newId = placeDiscrete(item, suggested.point);
            if (newId) {
              selectOnly(newId, { keepPanel: true });
              if (suggested.anchor) notify(`已紧挨「${suggested.anchor.name}」摆放`, 'info');
            }
          } catch (error) { notify(error instanceof Error ? error.message : '模型加载失败，请重试。', 'error'); }
          finally { placement.dispose(); }
        }}
      />
            {walkAvatarOn && <div className="sc-walk-avatar-controls" aria-label="漫游角色">
              <button type="button" onClick={cycleWalkView}>{walkViewMode === 'third' ? '第三人称' : walkViewMode === 'shoulder' ? '近肩视角' : '第一人称'} · F5 切换</button>
              <button type="button" onClick={cycleWalkRole} title="和左侧「漫游角色」是同一份选择">{walkRole.name} · 换角色</button>
              <span>WASD 行走 · F 坐下 · 左侧「漫游角色」可换人</span>
              {walkAvatar.loading && <span className="sc-walk-avatar-state" role="status"><Loader2 size={12} className="cr-spin" aria-hidden="true"/>{walkRole.name}加载中…</span>}
              {!walkAvatar.loading && !walkAvatar.error && !walkAvatar.near && !walkAvatar.greeted && <span className="sc-walk-avatar-state">走近游客按 E 打招呼</span>}
              {walkAvatar.error && <><span role="alert">{walkAvatar.error}</span><button type="button" onClick={walkAvatar.retry}>重试</button></>}
              {walkAvatar.near && <button type="button" onClick={walkAvatar.greet}>E 打招呼</button>}
              {walkAvatar.greeted && <span role="status">游客：你好！也来逛西湖呀？</span>}
            </div>}
            <EnvironmentLoad active={splatState.status === 'loading'} name={splatState.name} {...(splatState.progress === undefined ? {} : { progress: splatState.progress })} />
            <AgentCanvasOverlay/>
            <MapVenueOverlay onVenueSaved={() => {
              if (environmentsRef.current.some(entry => entry.assetId === DEMO_WORLD_SCENE_ID)) {
                removeEnvironment(DEMO_WORLD_SCENE_ID);
              }
              const current = layoutStore.getState().layout;
              if (current.researchArea?.presetId === 'xihu-scenic') setShowIso(true);
              focusMapVenue();
            }} onReconUpload={luxDirectVisible ? preset => {
              noteVenueThreeIntent();
              setSpaceWorkflow('aholo');
              setAholoReconPreset(preset);
              setLeftMode('lux3d'); setBusinessOpen(false); setSidebarCollapsed(true); setSidePanel(null); setAgentCollapsed(false);
            } : undefined}/>
            <VenuePickerOverlay/>
            {checklistOpen && <aside className="sc-checklist-drawer" role="dialog" aria-label="到场清单">
              <button type="button" className="sc-checklist-dismiss" onClick={() => setChecklistOpen(false)}>关闭</button>
              <DeliveryChecklistShell items={activeFloor.items} onExport={exportHandoff}/>
            </aside>}
            <div ref={businessHostRef} className="sc-canvas-share sc-data-host" hidden={!businessOpen || leftMode !== 'business'}/>
            {leftMode === 'properties' && selectedItem && <div className="sc-canvas-share">
              <ItemContextPopover embedded
                hasCollision={structuralItemCollides(selectedItem, layout, activeFloorIndex) || hasCollisions(selectedItem, activeFloor.items, layout.width, layout.height, { keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls: layout.backendSceneV2 ? [] : activeFloor.interiorWalls })}
                routeDrawing={routeDrawItemId !== null && routeDrawItemId === selectedItem.id}
                routeDrawHint={routeDrawHint}
                onToggleRouteDrawing={toggleRouteDraw}
                onUndoRoutePoint={undoRoutePoint}
                following={followPersonId === selectedItem.id}
                onToggleFollow={() => toggleFollowPerson(selectedItem.id)}
                onRotate={id => { commitHistoryNow(); if (rotateItemHandler(id)) playCue('rotate'); }} onToggleCameraBracket={toggleCameraBracket} onDuplicate={duplicateSelected} onRemove={removeItem} onClose={() => { selectOnly(null); setLeftMode('brief'); }}/>
            </div>}
            {luxDirectVisible && leftMode === 'lux3d' && <div className="sc-canvas-share">
              <div className="sc-canvas-share-bar"><strong>场地观感</strong><button type="button" aria-label="收起观感" onClick={() => setLeftMode('brief')}>收起</button></div>
              <Lux3dDirectTest reconPreset={aholoReconPreset} openKind={lux3dOpenKind} onHangMockScene={hangDemoEnvironment} onPreviewShippedScene={startStoredScene} onPlace={item => { const id = placeFromCatalog(item); if (id) selectOnly(id, { keepPanel: true }); return !!id; }} onPreviewScene={openScenePreview}/>
            </div>}
            <CanvasHeading view2D={view.view2D} />
            <GeoBasemapInput area={layout.researchArea} onApply={applyResearchArea} view2D={view.view2D} onFrameLocal={framePinghuQiuYue}
              venuePicker={!walkthroughActive && (hasMapVenue || scanIsolated || pendingCatalog || selectedItem || captureOpen || previewCandidate || workbenchMode !== 'layout') && <MapRailButton variant="canvas" />}
              isoStatus={isoStatus} onRetryIso={() => setIsoRetry(value => value + 1)} />
            {!scanIsolated && !walkthroughActive && !pendingCatalog && !selectedItem && !captureOpen && !previewCandidate && workbenchMode === 'layout' &&
              <CanvasWorkflow placedCount={materialCount(activeFloor.items)} onMaterials={() => showAgent('material')}
                onSpace={() => showAgent('space')} onReview={() => showAgent('bingo')}
                {...(hasMapVenue ? { venue: { name: layout.name?.split(' · ')[0] || '本场区域',
                  length: layout.width, width: layout.height, onFocus: focusMapVenue, onWalk: tryMapVenue } } : {})}/>}
            {scanIsolated && environment && <div className={`sc-canvas-mode${isolatedScanFailed ? ' is-error' : ''}`}
              role={isolatedScanFailed ? 'alert' : 'status'} aria-live="polite">
              <Scan size={13} aria-hidden="true"/>
              {isolatedScanFailed
                ? <><strong title={splatState.error || undefined}>「{environment.name}」没打开</strong>
                  <button type="button" onClick={retryIsolatedScan}>重试</button></>
                : <><strong>只看「{environment.name}」</strong>
                  {mappedWorkspace && <span>地图位置未校准</span>}
                  {isolatedScanLoading && <><Loader2 size={12} className="cr-spin" aria-hidden="true"/><span>加载中…</span></>}</>}
              <button type="button" onClick={hasMapVenue ? focusMapVenue : () => setIsolatedScanId(undefined)}>{mappedWorkspace ? '返回地图' : '看其他场景'}</button>
            </div>}
            <SceneGeoDots
              dots={sceneGeoDots}
              focusedId={focusedVenueId}
              toScreen={toScreen}
              controlsRef={controlsRef}
              cameraReady={isReady}
              onPick={pickSceneGeoDot}
            />
            <SplatLodMarker
              visible={splatLodEnabled && splatLod === 'poi'}
              name={environment?.name ?? '扫描场地'}
              anchor={splatLodAnchor}
              metersPerUnit={splatLodMetersPerUnit}
              cameraRef={cameraRef}
              controlsRef={controlsRef}
              toScreen={toScreen}
              cameraReady={isReady}
            />
            {previewCandidate && <div className={`sc-preview-caption${previewCaptionVisible ? '' : ' is-faded'}`} role="status" aria-hidden={!previewCaptionVisible}>AI 修改预览 · 尚未加入场景{view.view2D ? ' · 切回整体视角查看' : ' · 半透明为候选，线框为原位置'}</div>}
            {workspaceWriteGuards && environmentShown && <div className="sc-local-conflict" role="status"><span>当前编辑权模式暂不支持修改场地标定；标定结果仍需现场核对。</span></div>}
            {showSplatBanner && !(agentPanelVisible && activeAgent === 'space' && environmentShown) && <div className="sc-local-conflict" role="status"><span>{splatBannerText}</span>
              {environmentShown
                ? <button type="button" aria-label="收起场地提示" onClick={() => setSplatShellKeptFor('')}>收起</button>
                : <button type="button" onClick={stopSplat}>退出预览</button>}
            </div>}
            {environmentShown && splatDisplayMode === 'gaussian' && !view.view2D && splatTransformMode !== 'off' && <div className="sc-splat-transform-tools is-active" role="group" aria-label="高斯场景坐标与移动">
              <div className="sc-splat-transform-heading">
                <strong>移动整体场景</strong>
                <div className="sc-splat-transform-modes" role="group" aria-label="移动模式">
                  <button type="button" aria-pressed={splatTransformMode === 'gizmo'} className={splatTransformMode === 'gizmo' ? 'is-active' : ''} onClick={() => setSplatTransformMode('gizmo')}>坐标轴</button>
                  <button type="button" aria-pressed={splatTransformMode === 'numeric'} className={splatTransformMode === 'numeric' ? 'is-active' : ''} onClick={() => setSplatTransformMode('numeric')}>无轴</button>
                  <button type="button" aria-label="完成移动整体场景" onClick={() => setSplatTransformMode('off')}>完成</button>
                </div>
              </div>
              <div className="sc-splat-transform-fields">
                {(['x', 'y', 'z'] as const).map(axis => <label key={axis}>
                  <span>{axis.toUpperCase()}</span>
                  <input aria-label={`高斯场景 ${axis.toUpperCase()} 坐标，米`} type="number" step="0.1" value={(environment?.position?.[axis] ?? 0).toFixed(1)} onChange={event => updateSplatPosition(axis, event.currentTarget.valueAsNumber)}/>
                </label>)}
                <button type="button" onClick={() => updateSplatPosition('y', floorElevation(layout.floors, activeFloorIndex))}>对齐 {activeFloorIndex + 1}F</button>
              </div>
              <span className="sc-splat-transform-hint">{splatTransformMode === 'gizmo' ? '拖动红 X、绿 Y、蓝 Z 轴调整位置' : '用上方数值调整位置，场景中不显示坐标轴'}</span>
            </div>}
            {pendingEnvironmentPosition && <div className="sc-local-conflict" role="status"><span>场地位置保存结果待核对，候选暂留本页；关闭前请导出，核对前不能重复保存。</span><button type="button" onClick={()=>downloadTextFile('场地位置待核对草稿.json','application/json;charset=utf-8',JSON.stringify({version:1,scope:pendingEnvironmentPosition.scope,candidate:pendingEnvironmentPosition.intended},null,2))}>导出候选</button><button type="button" onClick={()=>{
              if(!workspaceWriteGuards||!sessionToken)return;
              try { workspaceWriteGuards.assertLayoutWrite(); if(!activitySession.isCurrent(sessionToken))throw new Error(); }
              catch { notify('本机编辑权或活动已变化，请保留候选并重新核对。','error');return; }
              const id=layoutStore.getState().layout.id,scope:EnvironmentScope=id?{kind:'project',id}:{kind:'draft'};
              const result=reconcilePendingEnvironmentWrite(pendingEnvironmentPosition,scope,sessionToken.epoch,readEnvironmentsStrict(scope,workspaceWriteGuards.capability));
              if(result.status==='confirmed'&&pendingEnvironmentPosition.intended){environmentsRef.current=pendingEnvironmentPosition.intended;setEnvironments(pendingEnvironmentPosition.intended);pendingEnvironmentPositionRef.current=null;setPendingEnvironmentPosition(null);notify('已核对本机场地位置。','success');}
              else notify(result.status==='retryable'?'候选尚未保存，请保留本页并重新核对。':'场地位置仍无法确认，请保留本页和原资料。','error');
            }}>核对保存结果</button></div>}
            {pendingCatalog && <div className="sc-local-conflict" role="status"><span>待放置：{pendingCatalog.name} · 点击场地选择有效位置</span><button type="button" onClick={clearPendingPlacement}>取消放置</button></div>}
            {interruptedDrafts.length>0&&<div className="sc-local-conflict" role="alert"><span>切换时保留了未保存的活动布局，仅暂留本页，关闭后会丢失。请先下载并核对；布局草稿可能不包含原图，模型可能需要重新关联，并非完整备份。</span>{interruptedDrafts.map(draft=><button key={draft.key} type="button" onClick={()=>{try{downloadInterruptedDraft(draft.key);}catch(error){notify(error instanceof Error?error.message:'草稿暂时无法下载，请保留本页。','error');}}}>下载「{draft.name}」布局草稿</button>)}</div>}
            {externalConflict && <div className="sc-local-conflict" role="status"><span>另一标签页更新了本地副本，自动保存已暂停。请先备份当前内容，再核对更新。</span>{remoteLayout ? <><button type="button" onClick={adoptRemoteLayout}>采用更新</button><button type="button" onClick={clearRemoteLayout}>稍后核对</button></> : hasRemoteCandidate ? <button type="button" onClick={reopenRemoteLayout}>重新核对更新</button> : <span>当前无法读取另一版本，请保留本页并检查本机存档。</span>}</div>}
            <PlacementHint active={placingId !== null}/>
            <StatusToastHost/>
            {/* 集成接线：F3 首次吸附教练气泡，固定锚点（画布中央偏左），不追求精确吸附位置。 */}
            <F3CoachBubble anchor={{ x: 240, y: 260 }} visible={f3Coach.shouldShow} onDismiss={f3Coach.dismiss} />
            {/* 集成接线：2D 视图下渲染规划标注层；transform 与 render2DTopDown 同源，避免错位。 */}
            {view.view2D && (
              <PlanOverlay
                annotations={planAnnot.draft?.annotations ?? []}
                transform={overlayTransform}
                layout={layout}
                visible={planAnnot.annotationsVisible}
                draftPoints={draftPoints}
              />
            )}
            {/* 第 11 批：正在画区时，底部浮出语义类型选择条（连续画框中随时切换）。 */}
            {view.view2D && (planAnnot.drawMode === 'zone' || planAnnot.drawMode === 'route' || planAnnot.drawMode === 'measure') && (
              <AnnotationGuide mode={planAnnot.drawMode} zoneType={zoneType} onModeChange={planAnnot.setDrawMode}
                onZoneTypeChange={setZoneType} onFinish={() => planAnnot.setDrawMode('off')} />
            )}
            {planAnnot.draft && (planAnnot.draft.stages.length > 0 || planAnnot.draft.annotations.length > 0) && (
              <div style={{ position: 'absolute', right: 16, top: 16, zIndex: 40, maxWidth: 320 }}>
                <PlanCard
                  draft={planAnnot.draft}
                  plans={scoredPlans}
                  recommendedId={recommendedPlan?.variantId}
                  selectedId={effectiveSelectedPlan?.variantId}
                  {...(zonePreparation && !zonePreparation.ok ? { blockedReason: zonePreparation.reason } : {})}
                  {...(zonePreparation?.ok && zonePreparation.warnings.length ? { zoneWarnings: zonePreparation.warnings } : {})}
                  onSelectVariant={setSelectedVariantId}
                  suggestions={activitySuggestions}
                  functionalNeeds={agentBriefMemory?.zoneNeeds ?? { checkin: null, stage: null }}
                  {...(activitySession.isCurrent(sessionToken) && layoutStore.getState().layout === layout
                    ? { sizeFacts: extractPlanSizeFacts(layout, activeFloorIndex) } : {})}
                  onApprove={() => {
                    if (!floorSession.isCurrent(floorToken) || layoutStore.getState().activeFloorIndex !== activeFloorIndex) {
                      notify('楼层已切换，请重新核对当前区域方案。', 'info');
                      return;
                    }
                    try { workspaceWriteGuards?.assertLayoutWrite(); }
                    catch { notify('本机编辑权不可用，区域草案已保留。', 'error'); return; }
                    const reviewedDraft = planAnnot.draft;
                    const snapshot = planAnnot.getSnapshot();
                    const draft = snapshot.draft;
                    const plan = effectiveSelectedPlan;
                    if (snapshot.revision !== planAnnot.revision) {
                      notify('区域草案已经变化，请重新核对。', 'error');
                      return;
                    }
                    if (!draft || !reviewedDraft || !plan) {
                      notify('请先绘制区域并选择方案。', 'info');
                      return;
                    }
                    if (plan.placements.length === 0) {
                      const onlyReserved = draft.annotations.filter(a => a.kind === 'zone').every(a => a.zoneType === 'reserved');
                      notify(plan.skipped.map(item => item.reason).join('；') || (onlyReserved ? '预留区不摆家具；请再画至少一个要落家具的区。' : '本次未能排入家具，请检查区域与可用物料。'), 'error');
                      return;
                    }
                    if ((!isVenueScaleCurrent(getActiveBrief(), layoutStore.getState().layout) || !isVenueFactMemoryCurrent(getActiveBrief(), layoutStore))) {
                      notify('场地已变化，请重新核对当前场地尺寸。', 'error');
                      return;
                    }
                    const prepared = prepareZonePlan({
                      layout: layoutStore.getState().layout,
                      reviewedLayout: layout,
                      draft,
                      reviewedDraft,
                      floorIndex: activeFloorIndex,
                      reviewedPlan: plan,
                      brief: getActiveBrief(),
                      reviewedBrief: agentBriefMemory,
                    });
                    if (!prepared.ok) { notify(prepared.reason, 'error'); return; }
                    const current = layoutStore.getState().layout;
                    const candidateValidation = validateCandidateApply(current, prepared.layout, activeFloorIndex);
                    if (!candidateValidation.ok) { notify(candidateValidation.reason, 'error'); return; }
                    try {
                      workspaceWriteGuards?.assertLayoutWrite();
                      const latestState = layoutStore.getState();
                      const latest = latestState.layout;
                      if (!floorSession.isCurrent(floorToken) || latestState.activeFloorIndex !== activeFloorIndex || latest.id !== current.id || !sameLayoutContent(latest, current)) {
                        notify('场景已经变化，请重新核对区域草案。', 'error');
                        return;
                      }
                      commitHistoryNow();
                      workspaceWriteGuards?.assertLayoutWrite();
                      actions.applyLayout(prepared.layout);
                    } catch { notify('本机编辑权不可用，区域草案已保留。', 'error'); return; }
                    if (!sameRecoveryFormValue(layoutStore.getState().layout, prepared.layout)) {
                      notify('应用后的布局与预览不一致，请先撤销并重新核对。', 'error');
                      return;
                    }
                    const consumed = planAnnot.consumeZonesIfRevision(snapshot.revision);
                    if (!consumed) {
                      notify('布局已应用；新添加的标注已保留，请重新核对。', 'info');
                      return;
                    }
                    const nameCounts = new Map<string, number>();
                    for (const item of prepared.items) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
                    const itemsText = [...nameCounts.entries()].map(([name, n]) => `${name} ${n} 件`).join('、');
                    const remainingNote = prepared.remainingDraft ? '；门、路线或测距仍在当前草案中，尚未保存' : '';
                    notify(`已按 ${prepared.addedZones.length} 个标注区布置 ${prepared.items.length} 件（${itemsText}）；${prepared.warnings.join('；')}${remainingNote}`, 'success');
                  }}
                  onReplace={() => planAnnot.replaceDraft(createEmptyPlanDraft())}
                  onCancel={() => planAnnot.clearDraft()}
                  onComment={(text) => notify(`已记下反馈：${text}`, 'info')}
                />
              </div>
            )}
          </div>
            <div className="sc-editor-dock">
            <ScendanceViewTools environmentView={splatDisplayMode} environmentViewEnabled={environmentShown && !view.view2D} onEnvironmentViewChange={mode => { if (mode === 'footprint') setSplatTransformMode('off'); setSplatDisplayMode(mode); }} sceneMoveEnabled={environmentShown && splatDisplayMode === 'gaussian' && !view.view2D} sceneMoveMode={splatTransformMode} onSceneMoveModeChange={setSplatTransformMode} layoutLocked={workbenchMode !== 'layout'} showAtmosphere={false} shareOpenRequest={shareOpenRequest} shareActions={{ onIssueReviewLink: issueReviewLink, onPublish: publishVersion, onExportHandoff: exportHandoff, onGenerateShareLink: handleShareLink, onOpenMaterials: openMaterialsFromShare, onOpenChecklist: () => setChecklistOpen(true) }} onExportImage={handleExportImage} onCaptureImage={captureRenderImage} onExportAlbum={handleExportAlbum} onApplyPreset={applyPreset} onLighting={value=>{ if (workbenchMode !== 'layout') return; commitHistoryNow();actions.applyLayout({...layoutStore.getState().layout,backendLighting:value});setView(current=>({...current,view2D:false}));}} onToggleWalkthrough={toggleWalkthrough} onZoom={direction => {
              const camera = cameraRef.current;
              const controls = controlsRef.current;
              if (!camera || !controls) return;
              zoomCamera(camera, controls, direction);
              invalidate();
            }}/>
            <div ref={assistantEntryHostRef} className="sc-assistant-entry-host" hidden aria-hidden="true"/>
            </div>
          </div>
          <CreativeAssistant docked autoOpen={false} suppressAgentLauncher hideCategorySelect toolsApiRef={businessToolsRef} workbenchMode={workbenchMode} workbenchModeSerial={workbenchModeSerial} deliveryOpenRequest={deliveryOpenRequest} backupOpenRequest={backupOpenRequest} deliveryEntryRef={deliveryEntryRef} reviewOpenRequest={reviewOpenRequest} reviewEntryRef={reviewEntryRef} assistantEntryHostRef={assistantEntryHostRef} commercialPanel={<CommercialWorkspace controller={controller} layout={layout} isActive={isActive} ensurePersistentIdentity={ensurePersistentIdentity}/>} activityTaskPanel={context=><ActivityTaskWorkspace {...context} controller={controller} isActive={isActive} ensurePersistentIdentity={ensurePersistentIdentity} persistVerifiedLayout={persistVerifiedLayout} onCommitOperations={operations=>{if(!isActive||!isLocalActivityWorkspace(controller))throw new Error('当前活动已变化，未写入任务。');commitHistoryNow();actions.setEventOperations(operations);}}/>} referenceImagePanel={<ReferenceImageControls layout={layout} view={view} ready={referenceImage.ready} notice={referenceImage.notice} onShow={value => setView(current => ({ ...current, showReferenceImage: value }))} onOpacity={value => setView(current => ({ ...current, referenceImageOpacity: value }))} onReview={() => { setLeftMode('business'); setBusinessOpen(true); setSidebarCollapsed(true); setSidePanel(null); setAgentCollapsed(false); setReferenceOpenRequest(value => value + 1); }} onReload={referenceImage.reload} reviewButtonRef={referenceEntryRef}/>} onOpenTemplates={openTemplates} localSaveError={!!saveError} captureReview={captureReview} businessHostRef={businessHostRef} conversationOpenRequest={conversationOpenRequest} conversationEntryRef={conversationEntryRef} conversationCloseRequest={conversationCloseRequest} onConversationVisibilityChange={handleConversationVisibility} onWorkspaceVisibilityChange={handleWorkspaceVisibility} workspaceEntryRef={workspaceEntryRef} referenceOpenRequest={referenceOpenRequest} referenceEntryRef={referenceEntryRef} generationPanel={context=><GeneratedModelLibrary {...context} controller={controller} disabled={materialCount(activeFloor.items)>=editorItemLimit(layout)} onAdd={item=>{const id=placeFromCatalog(item);if(id)selectOnly(id,{ keepPanel: true });}}/>}/>
        </main>
      </div>
      </LayoutAgentProvider>
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        description={confirmModal.description}
        {...(confirmModal.confirmText ? { confirmText: confirmModal.confirmText } : {})}
        onConfirm={() => setConfirmModal(s => ({ ...s, open: false }))}
        onCancel={() => setConfirmModal(s => ({ ...s, open: false }))}
      />
    </CreativeStudioProvider>
    </SelectionProvider>
    </RoomEditorProvider>
    </LocalActivitySwitchGuardProvider>
  );
}

export default RoomOrganizer;
