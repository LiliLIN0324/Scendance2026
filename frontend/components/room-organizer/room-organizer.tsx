'use client';

import { PanelLeftClose } from '@/components/solid-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as ThreeNS from 'three';
import { createBackendSession, type BackendSession } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { commitLocalRestoreLayout, prepareLocalRestoreLayout } from '@/lib/local-project-restore';
import { publicationSchema, shareErrorMessage } from '@/lib/share-api';
import { snapshotPreviewContext, decideOnApply, type PreviewContext } from '@/lib/preview-guard';
import { buildGenerationReport } from '@/lib/generation-report';
import { getAgentRun, getAgentChatThreads } from './panels/agent-chat-store';
import { setGenerationOutcome } from './lib/use-generation-outcome';
import {
  executeSceneCommand,
  applyLayoutCommandWithRefusals,
  placeItemCommand,
  applyLayoutCommand,
} from '@/lib/build-command';
import { settlePlacement } from '@/lib/settle-placement';
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
import { useLayoutState } from './hooks/use-layout-state';
import { layoutStore } from './hooks/use-layout-store';
import { useNpcs } from './hooks/use-npcs';
import { usePeopleModel } from './hooks/use-people-model';
import { useProposalPreview } from './hooks/use-proposal-preview';
import { useRecentColors } from './hooks/use-recent-colors';
import { useReferenceImage } from './hooks/use-reference-image';
import { useReviewCapture } from './hooks/use-review-capture';
import { useSceneEffects, measurementDistance } from './hooks/use-scene-effects';
import { useSceneLighting } from './hooks/use-scene-lighting';
import { researchBasemapPlacement, researchGeoToWorld } from './three/research-basemap';
import { DEFAULT_EVENT_LIGHTING } from './three/render-look';
import { useSplatPreview } from './hooks/use-splat-preview';
import type { SplatPosition, SplatTransformMode } from './three/splat-preview';
import { useThreeScene } from './hooks/use-three-scene';
import { useWalkthrough } from './hooks/use-walkthrough';
import { useWeather } from './hooks/use-weather';
import { loadAholoSceneSource, storedAholoSceneSource } from './lib/aholo-model-placement';
import { findAholoAsset } from './lib/aholo-assets';
import { findCatalogEntry } from './lib/catalog-drag';
import { suggestDropPoint } from './lib/drop-zone';
import { captureCatalogPlacement } from './lib/catalog-placement-guard';
import { buildPasteItems, copyToClipboard } from './lib/clipboard';
import { CAMERA_BRACKET_ARM, EVENT_CATALOG } from './lib/constants';
import { crowdHintsFromLayout } from './lib/crowd-route';
import { saveCustomSet } from './lib/custom-sets';
import { notify } from './lib/editor-notices';
import { clearEnvironment, environmentPreferenceKey, hasEnvironmentPreference, readEnvironments, writeEnvironments, type StoredEnvironment } from './lib/environment-preference';
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
import { sceneAnchorOf } from './lib/scene-anchor';
import { cameraDistanceClamp } from './lib/camera-framing';
import type { SceneAnchor } from './lib/types';
import { useSceneZoom, SCENE_ZOOM_CLOSER_RATIO } from './hooks/use-scene-zoom';
import { SceneGeoDots } from './panels/scene-geo-dots';
import { buildingHeight, floorElevation, storeyHeight } from './lib/storeys';
import { entrancePlanOutline } from './lib/street';
import { canApplyLayoutGeometry, structuralItemCollides, materialCount } from './lib/structural-layout';
import { snapWallEndpoint } from './lib/wall-snap';
import { WORKBENCH_MODE_DEFAULT, demoteLegacyMode, type WorkbenchMode } from './lib/workbench-mode';
import { ActivityTaskWorkspace } from './panels/activity-task-workspace';
import { CanvasHeading } from './panels/canvas-heading';
import { GeoBasemapInput } from './panels/geo-basemap-input';
import { createResearchArea, RESEARCH_SATELLITE_STYLE } from './lib/research-area';
import { AGENT_META, AgentCanvasOverlay, AgentPanel, LayoutAgentProvider, MapVenueOverlay, VenuePickerOverlay, type AgentId } from './panels/agent-panel';
import { AgentChat } from './panels/agent-chat';
import { BingoAvatarFlight } from './panels/bingo-avatar-flight';
import { BingoRailButton } from './panels/bingo-rail-button';
import { RailLaneDot } from './panels/rail-lane-dot';
import { RailAvatar } from './panels/rail-avatar';
import { RailTeamBlock } from './panels/rail-team-block';
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
import { usePlanAnnotations } from './hooks/use-plan-annotations';
import { buildDefaultZoneRects } from '@/lib/auto-zone-apply';
import { PlanOverlay } from './canvas-2d/plan-overlay';
import type { View2DTransform } from './canvas-2d/render';
import { PlanCard } from './panels/plan-card';
import { estimateCapacity } from '@/lib/capacity-meter';
import { computeBingoScore } from '@/lib/bingo-score';
import { ANNOTATION_PRESET_LABELS, createEmptyPlanDraft, ZONE_SEMANTIC_LABELS, type PlanPoint, type ZoneSemanticType } from '@/lib/plan-annotation';
// 第 12 批：三版打分 + 动线约束 + AI 建议（纯函数层，已独立测试）。
import {
  generateScoredPlans,
  pickRecommendedPlan,
  type ScoredPlan,
  type PlanVariantId,
} from '@/lib/plan-scoring';
import { generateSuggestions, type ActivitySuggestion } from '@/lib/suggestions';

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

export function RoomOrganizer({ controller: providedController, isActive = true }: { controller?: BackendSession; isActive?: boolean } = {}): JSX.Element {
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
  useEffect(() => controller.retain(), [controller]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);
  const assistantEntryHostRef = useRef<HTMLDivElement>(null);
  const frameViewportRef = useRef(() => {});

  const { layout, activeFloor, activeFloorIndex, actions } = useLayoutState();
  // 集成接线：F3 首次吸附教练气泡、规划标注层、确认弹层状态。
  const f3Coach = useF3CoachBubble();
  const planAnnot = usePlanAnnotations();
  // 第 10 批「批注→施工」：正在画但还没落地的临时点（世界坐标），喂给 PlanOverlay 做跟随反馈。
  const [draftPoints, setDraftPoints] = useState<PlanPoint[]>([]);
  // 第 11 批：当前要画的 zone 语义类型（决定批准时落什么家具）。
  const [zoneType, setZoneType] = useState<ZoneSemanticType>('roundtable');
  // 第 12 批：三版打分里用户手动选中的布置版本；默认适中版，批准时按它落家具。
  const [selectedVariantId, setSelectedVariantId] = useState<PlanVariantId>('balanced');
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
  environmentsRef.current = environments;
  // 撤销/重做落回旧布局时，把布局里记着的真实场地也挂回去；具体切换逻辑在下面赋值。
  const restoreVenueFromHistoryRef = useRef<(scan: { assetId: string; name: string }) => void>(() => {});
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
  const columnExpanded = navExpanded || personChat;
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
      (input ?? document.getElementById('agent-panel'))?.focus();
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
    const layout = layoutStore.getState().layout;
    const encoded = await encodeShareUrl(layout, window.location.origin);
    const url = reviewShareHref(window.location.origin, new URL(encoded.url).hash);
    if (!url) throw new Error('评审链接没有生成。');
    const projectKey = (layout.id ?? '').trim() || 'local-draft';
    const reviewPlanKey = reviewPlanKeyForClientUrl(url) ?? localPlanKey(layout);
    rememberReviewLinkMark({
      projectKey,
      title: layout.name?.trim() || '未命名活动',
      shareId: projectKey,
      clientUrl: url,
      reviewPlanKey,
    });
    return { url };
  }, []);
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
    if (agentPanelOpen && activeAgent === id && !chatPeerId) closeBingo();
    else showAgent(id);
  }, [agentPanelOpen, activeAgent, chatPeerId, closeBingo, showAgent]);
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
  const [catalogQuery, setCatalogQuery] = useState('');
  const [gameMode, setGameMode] = useState<GameMode>('build');
  const [measurementPoints, setMeasurementPoints] = useState<ReadonlyArray<{ x: number; z: number }>>([]);
  const [wallDraft, setWallDraft] = useState<{ x: number; z: number } | null>(null);
  const [pointerWorld, setPointerWorld] = useState<{ x: number; z: number } | null>(null);
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
    ]
  );

  const handleFloorPointerMove = useCallback((x: number, z: number) => {
    setPointerWorld({ x, z });
  }, []);

  const handleFloorPointerLeave = useCallback(() => {
    setPointerWorld(null);
  }, []);

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
      actions.applyLayout(snapshot);
      // 布局里的场地标记跟着撤销/重做走：一次撤销就把画布和真实场地一起退回上一套。
      // 换场前的旧快照没有 venueScan，用换场时记下的对象映射补上。
      const scan = venueByLayoutRef.current.get(snapshot) ?? snapshot.venueScan;
      if (scan && scan.assetId !== environmentsRef.current[0]?.assetId) restoreVenueFromHistoryRef.current(scan);
    },
    [actions]
  ));
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
      commitHistoryNow();
      handleDragEnd(id);
    },
    [commitHistoryNow, handleDragEnd]
  );

  const { lastSavedAt, saving: isSaving, saveError, remoteLayout, clearRemoteLayout, acknowledgeRestoredLayout, ensurePersistentIdentity, persistVerifiedLayout } = useLayoutPersistence({
    layout,
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
    snapshotBeforeReplace(layout);
    actions.applyLayout(remoteLayout);
    clearTransientSelection();
    clearRemoteLayout();
  }, [remoteLayout, layout, actions, clearTransientSelection, clearRemoteLayout]);

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
      if (materialCount(activeFloor.items) >= editorItemLimit(layout)) { notify(`当前场景最多支持 ${editorItemLimit(layout)} 件物料。`, 'info'); return ''; }
      // M2 命令门（P0-1）：普通家具在落盘前过一次几何判据；门洞 / 窗 / 摄像机 / 户外件
      // 在 useItemPlacement 内部有自己的 snap 与 canApplyLayoutGeometry 兜底，这里不重复预判。
      const bypassCommandGate = isOpening(catalogItem.type)
        || catalogItem.type === 'security-camera'
        || catalogItem.category === 'outdoor';
      if (!bypassCommandGate) {
        const trialItem: FurnitureItem = {
          ...catalogItem,
          id: `__trial_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          position: position ?? { x: 0, z: 0 },
          rotation: 0,
        } as FurnitureItem;
        const trialResult = executeSceneCommand(
          placeItemCommand({ floorIndex: activeFloorIndex, item: trialItem }),
          { layout },
        );
        if (!trialResult.ok) {
          const entry: OutcomeEntry<FurnitureItem> = {
            item: trialItem,
            reason:
              trialResult.refused[0]?.message
              ?? trialResult.preconditions[0]?.message
              ?? trialResult.shapeIssues.map(s => s.message).join('；')
              ?? '落点不合法',
            code:
              trialResult.refused[0]?.code
              ?? trialResult.preconditions[0]?.code
              ?? 'SHAPE_INVALID',
          };
          notify(`「${catalogItem.name}」没放成：${entry.reason}`, 'info');
          applyOutcome(combineOutcomes(
            lastOutcomeRef.current ?? { placed: [], refused: [], skipped: [] },
            { placed: [], refused: [entry], skipped: [] },
          ));
          setPendingCatalog(catalogItem);
          return '';
        }
      }
      commitHistoryNow();
      const id = placeCatalogItem(catalogItem, position);
      if (!id) { setPendingCatalog(catalogItem); notify('此处与结构相交，请点击场地中的其他位置放置。', 'info'); }
      else {
        setPendingCatalog(null);
        // M6 provenance：手动放的件打上 human 标签，方便 handoff / 审校卡区分 AI 与人工。
        actions.updateItem(id, {
          provenance: { source: 'human', opId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
        });
      }
      return id;
    },
    [commitHistoryNow, placeCatalogItem, activeFloor.items, layout, activeFloorIndex, actions, applyOutcome]
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
    onItemDragStart: handleDragStart,
    onItemDrag: handleDrag,
    onItemDragEnd: handleDragEndWithHistory,
    onItemDragCancel: handleDragCancel,
    gizmoMode,
    onMarqueeSelect: handleMarqueeSelect,
  });

  // 第 10 批「批注→施工」：drawMode != 'off' 时在 2D canvas 上以 capture 阶段接管指针事件。
  // 只在 2D 视图 + 非 off 模式下挂监听；其它时候完全不影响现有点选 / 拖放。
  useEffect(() => {
    const canvas = canvas2DRef.current;
    if (!view.view2D || planAnnot.drawMode === 'off' || !canvas) {
      setDraftPoints([]);
      return;
    }

    let zoneStart: PlanPoint | null = null;
    let measureFrom: PlanPoint | null = null;

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
        zoneStart = w;
        setDraftPoints([w]);
      } else if (planAnnot.drawMode === 'measure') {
        if (!measureFrom) {
          measureFrom = w;
          setDraftPoints([w]);
        } else {
          planAnnot.addAnnotationFromPoints([measureFrom, w], 'measure', '测距');
          measureFrom = null;
          setDraftPoints([]);
          planAnnot.setDrawMode('off');
        }
      } else if (planAnnot.drawMode === 'route') {
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
        planAnnot.addAnnotationFromPoints(
          [zoneStart, w],
          'zone',
          ZONE_SEMANTIC_LABELS[zoneType],
          zoneType,
        );
      }
      zoneStart = null;
      setDraftPoints([]);
      // 不再 setDrawMode('off')——连续画框；退出靠 Esc 或再点一次标注钮。
    };

    const finishRoute = (): void => {
      setDraftPoints((prev) => {
        if (prev.length >= 2) {
          planAnnot.addAnnotationFromPoints(
            prev,
            'route',
            ANNOTATION_PRESET_LABELS.guest_route,
          );
        }
        // 让 setState 落账后再清空 draftPoints / 退出绘制模式。
        window.setTimeout(() => {
          setDraftPoints([]);
          planAnnot.setDrawMode('off');
        }, 0);
        return prev;
      });
    };

    const onDoubleClick = (e: MouseEvent): void => {
      if (planAnnot.drawMode !== 'route') return;
      e.preventDefault();
      e.stopPropagation();
      finishRoute();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (planAnnot.drawMode === 'route' && e.key === 'Enter') {
        finishRoute();
      }
      // 第 11 批：Esc 随时退出绘制（zone 连续画框时用它收尾）。
      if (e.key === 'Escape' && planAnnot.drawMode !== 'off') {
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
    planAnnot.addAnnotationFromPoints,
    planAnnot.setDrawMode,
    zoneType,
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
  }, [view.view2D]);

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
  }, [view.view2D, layout, overlayTick]);

  // 3DGS 环境预览的渲染入口；useThreeScene 每帧走它，预览关闭时它是空的。
  const splatPaintRef = useRef<SplatPaint | null>(null);
  const environmentPickerRef = useRef<((ray: ThreeNS.Ray) => string | null) | null>(null);
  const environmentSelectionRef = useRef<((assetId: string) => void) | null>(null);

  const { isReady, error, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, worldPositionFromClient } =
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
      floorPickOnly: view.drawWallMode || view.measurementMode,
      onItemSelect: handleSelect,
      onItemDoubleClick: openPropertiesForItem,
      selectedIds: allSelectedIds,
      onItemDragStart: handleDragStart,
      onItemDrag: handleDrag,
      onItemDragEnd: handleDragEndWithHistory,
      onItemDragCancel: handleDragCancel,
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

  const preserveSplatCameraRef = useRef(false);
  preserveSplatCameraRef.current = walkthroughActive;
  const onSplatPositionChange = useCallback((position: SplatPosition) => {
    setEnvironments(current => {
      if (!current.length) return current;
      const next = [{ ...current[0]!, position }, ...current.slice(1)];
      environmentsRef.current = next;
      writeEnvironments(layoutStore.getState().layout.id, next);
      return next;
    });
  }, []);
  const otherSplatScenes = useMemo(() => environments.slice(1).flatMap(entry => {
    try {
      return [{ id: entry.assetId, source: storedAholoSceneSource(entry.assetId), position: entry.position ?? ZERO_SPLAT_POSITION,
        floorIndex: entry.floorIndex ?? 0, roofCutoffY: floorElevation(layout.floors, (entry.floorIndex ?? 0) + 1) + (entry.position?.y ?? 0) - floorElevation(layout.floors, entry.floorIndex ?? 0) }];
    } catch { return []; }
  }), [environments, layout.floors]);
  const { state: splatState, renderFrame: paintSplatFrame, start: startSplat, stop: stopSplat,
    setPosition: setSplatPosition, displayMode: splatDisplayMode, setDisplayMode: setSplatDisplayMode,
    setTransformMode: setSplatTransform, pickScene: pickSplatScene } = useSplatPreview({
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
    otherScenes: otherSplatScenes,
    activeFloorIndex,
    primaryVisible: (environment?.floorIndex ?? 0) === activeFloorIndex,
    preserveCameraRef: preserveSplatCameraRef,
  });
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
  const selectEnvironment = useCallback((assetId: string, name: string, options?: { restoreItems?: boolean }) => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    const current = environmentsRef.current;
    if (current[0]?.assetId === assetId) return;
    const liveLayout = layoutStore.getState().layout;
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
  }, [actions, activeFloorIndex, layout.floors, layout.height, layout.width, setView]);
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
  restoreVenueFromHistoryRef.current = (scan) => {
    try {
      selectEnvironment(scan.assetId, scan.name, { restoreItems: false });
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure), 'error');
    }
  };

  // 本场环境按项目记住：新项目首次用 World 高斯样例起步，后续沿用项目选择；
  // 草稿刚绑上云项目时，把草稿里选的那条带过去，不让刚选完就丢。
  const environmentKey = environmentPreferenceKey(layout.id);
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
    if (previousKey === environmentKey) return;
    const carried = previousKey === 'draft' ? environmentsRef.current : [];
    const hasPreference = hasEnvironmentPreference(layout.id);
    restoredEnvironmentRef.current = '';
    if (hasPreference) {
      const stored = readEnvironments(layout.id);
      environmentsRef.current = stored;
      setEnvironments(stored);
      if (!stored.length) stopSplat();
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
  }, [environmentKey, layout.id, stopSplat]);
  // 渲染器还没起来时 startSplat 会自己排队；同一个项目同一条环境只自动挂一次。
  useEffect(() => {
    if (!environment) return;
    const key = `${environmentKey}:${environment.assetId}`;
    if (restoredEnvironmentRef.current === key) return;
    restoredEnvironmentRef.current = key;
    restoreEnvironment(environment);
  }, [environment, environmentKey, restoreEnvironment]);
  const removeEnvironment = useCallback((assetId: string) => {
    const next = environmentsRef.current.filter(entry => entry.assetId !== assetId);
    environmentsRef.current = next;
    setEnvironments(next);
    restoredEnvironmentRef.current = '';
    if (next.length) writeEnvironments(layoutStore.getState().layout.id, next);
    else {
      clearEnvironment(layoutStore.getState().layout.id);
      stopSplat();
    }
  }, [stopSplat]);
  const dropEnvironment = useCallback(() => {
    environmentsRef.current = [];
    setEnvironments([]);
    clearEnvironment(layoutStore.getState().layout.id);
    restoredEnvironmentRef.current = '';
    stopSplat();
  }, [stopSplat]);
  const setEnvironmentFloor = useCallback((assetId: string, floorIndex: number) => {
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
  }, [actions, selectEnvironment, setSplatPosition]);
  useEffect(() => {
    if ((environment?.floorIndex ?? 0) === activeFloorIndex) return;
    const match = environments.find(entry => (entry.floorIndex ?? 0) === activeFloorIndex);
    if (!match) return;
    selectEnvironment(match.assetId, match.name);
  }, [activeFloorIndex, environment?.floorIndex, environments, selectEnvironment]);

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
  const splatWalkBounds = splatState.status === 'ready' ? splatState.walkBounds ?? null : null;

  const { phase: walkthroughPhase } = useWalkthrough({
    enabled: isReady && walkthroughActive,
    invalidate,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef: controlsRef,
    // Eye level, ducking under a low ceiling (a 1.1 m loft, #277).
    eyeHeight: activeFloorY + Math.min(1.6, activeStoreyHeight - 0.2),
    roomWidth: layout.width,
    roomDepth: layout.height,
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

  useSceneEffects({
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
  const sceneLightingAssetId = isReady && !view.view2D && environment !== null &&
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
  frameViewportRef.current = () => { if (!view.view2D) ensureRoomInView(); };

  // docs/49 需求A：点场景 → 600ms 平滑 zoom 到该场景。目标=包围盒中心，
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
    if (lastResearchAreaRef.current === area) return;
    lastResearchAreaRef.current = area;
    setSceneFocus(null);
    setFocusedVenueId(null);
    if (!area || !area.scanAssetId) fitToRoom();
  }, [layout.researchArea, setSceneFocus, fitToRoom]);

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
    paintFrame: paintSplatFrame,
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
    setPendingCatalog(null);
    cancelPlacement();
    setView(current => (current.drawWallMode || current.drawZoneMode || current.measurementMode)
      ? { ...current, drawWallMode: false, drawZoneMode: false, measurementMode: false }
      : current);
  }, [workbenchMode, selectOnly, cancelPlacement, setView]);



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
    snapshotBeforeReplace(layout);
    actions.applyLayout(next);
    clearTransientSelection();
    clearHistory(layoutStore.getState().layout);
  }, [actions, layout, clearTransientSelection, clearHistory]);

  const prepareRestoreLayout = useCallback((next: RoomLayout): RoomLayout => {
    if (controller.getSnapshot().project || new URL(window.location.href).searchParams.has('project')) {
      throw new Error('当前页面已连接或正在打开云项目，请在本地工作台恢复备份。');
    }
    return prepareLocalRestoreLayout(next);
  }, [controller]);
  const commitRestoredLayout = useCallback((candidate: RoomLayout): void => {
    const next = prepareRestoreLayout(candidate);
    const before = layoutStore.getState().layout;
    const json = commitLocalRestoreLayout(next, {
      current: () => layoutStore.getState().layout,
      apply: value => actions.applyLayout(value),
      beforeReplace: () => { commitHistoryNow(); snapshotBeforeReplace(before); },
    });
    const restored = layoutStore.getState().layout;
    acknowledgeRestoredLayout(restored, json);
    clearTransientSelection(); clearHistory(restored);
    initiallyFramed.current = false;
  }, [prepareRestoreLayout, actions, commitHistoryNow, acknowledgeRestoredLayout, clearTransientSelection, clearHistory]);

  const onApplyCreative = useCallback((next: RoomLayout) => {
    const before = layoutStore.getState().layout;
    // 第 7 批收尾：记录本次落盘 + 体检的起始时刻，完成卡上的「落盘耗时」用它算。
    const applyStartedAt = Date.now();
    let forceApply = false;
    if (previewGuard) {
      const decision = decideOnApply(before, previewGuard);
      // 预览卡本身就是确认：prompt 场景不再 window.confirm 阻塞，直接 forceApply 继续，
      // 用户已在预览里看过候选，二次确认由撤销历史兜底。
      forceApply = decision.action === 'prompt';
    }
    if (!canApplyLayoutGeometry(before, next)) throw new Error('候选方案包含新的墙体、柱子或边界冲突，请先修正。');

    // M6 provenance：给 AI 候选里每件打上 ai 标签（map 新数组，不 mutation 原候选）。
    const aiOpId = `ai-${Date.now()}`;
    const provenanceNext: RoomLayout = {
      ...next,
      floors: next.floors.map(f => ({
        ...f,
        items: f.items.map(item => ({
          ...item,
          provenance: {
            source: 'ai' as const,
            opId: aiOpId,
            ...(previewGuard?.recipeId ? { recipeId: previewGuard.recipeId } : {}),
          },
        })),
      })),
    };

    // M2 命令门（P0-2）：逐件分流——合法件进 nextLayout，越界/重叠件进 refused（真记账）。
    // 用户已经在 decideOnApply 里 confirm 过的话，本次跳过 baseFingerprint 再校验。
    const cmd = applyLayoutCommand({
      layout: provenanceNext,
      ...(forceApply || !previewGuard?.baselineFingerprint
        ? {}
        : { baseFingerprint: previewGuard.baselineFingerprint }),
    });
    const result = applyLayoutCommandWithRefusals(cmd, { layout: before });
    if (!result.ok) {
      const msg = result.shapeIssues.map(s => s.message).join('；')
        || result.preconditions.map(p => p.message).join('；')
        || '候选方案无法应用';
      throw new Error(msg);
    }

    // M3 settle 自动体检（P0-2 接线）：AI 摆完立刻跑一遍 BFS 可达性 + 最小平移收敛器，
    // 把堵主通道 / 孤立刻直接挪开；挪不动的留给 UI 标红。
    const settleReport = settlePlacement(result.nextLayout, activeFloorIndex);
    const movedCount = settleReport.steps.reduce((n, s) => n + s.moved.length, 0);
    const stillBad = settleReport.remainingViolations.length;
    if (movedCount > 0 || stillBad > 0) {
      notify(`AI 摆完已自动巡场：挪开 ${movedCount} 处堵点，${stillBad} 处挪不动已标红。`, 'info');
    }
    const finalLayout = settleReport.layout;
    // 集成接线：Bingo 体检分即时 notify，并把同一份数带进「本次报告」卡（第 7 批收尾）。
    const bingoScore = computeBingoScore(finalLayout, settleReport);
    notify(bingoScore.summary, bingoScore.total >= 95 && bingoScore.stuckCount === 0 ? 'success' : 'info');

    commitHistoryNow();
    snapshotBeforeReplace(layout);
    actions.applyLayout({ ...finalLayout, ...(layout.designBook && !finalLayout.designBook ? { designBook: layout.designBook } : {}) });

    // M5：按 id 差分写 Outcome 账本；refused 不再硬编码空数组。
    const beforeIds = new Set(before.floors.flatMap(f => f.items.map(i => i.id)));
    const placedItems = finalLayout.floors.flatMap(f => f.items).filter(i => !beforeIds.has(i.id));
    const finalIds = new Set(finalLayout.floors.flatMap(f => f.items.map(i => i.id)));
    const removedItems = before.floors.flatMap(f => f.items).filter(i => !finalIds.has(i.id));
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
      skipped: removedItems.map(i => ({ item: i, reason: '候选未保留', code: 'REMOVED' })),
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
        skippedCount: removedItems.length,
        fixedCount: bingoScore.fixedCount,
        stuckCount: bingoScore.stuckCount,
        areaM2: finalLayout.width * finalLayout.height,
        durationMs: Date.now() - applyStartedAt,
        ...(rounds === undefined ? {} : { rounds }),
      });
      applyOutcome({ ...outcome, report });
    }
    setPreviewGuard(null);
    clearTransientSelection();
    initiallyFramed.current = false;
    setView(current => ({ ...current, view2D: false }));
  }, [commitHistoryNow, layout, actions, clearTransientSelection, previewGuard, activeFloorIndex, applyOutcome]);

  /**
   * docs/49 地理底图：只动 researchArea 与场景锚点，走正式历史；输入与自动铺图共用这一条路。
   *
   * 架构定案：地图是 3D 场景里的一个渲染层，场景坐标 ↔ 地理坐标的唯一变换是场景锚点。
   * 铺图 = 把场景重新锚到那片真实位置（锚点原点 = 底图中心经纬度）；朝向沿用现有锚点
   * （默认正北朝上），米制沿用壳体缩放（没有壳就是 1）。底图不再读 mapGroundFrame，
   * 场景里不存在第二套地面坐标——因此删掉了旧的「异地框架 >3km 就清掉」补丁：
   * 它是在掩盖两套坐标打架，而不是解决问题。
   */
  const applyResearchArea = useCallback((area: RoomLayout['researchArea'] | null) => {
    const current = layoutStore.getState().layout;
    const next: RoomLayout = (() => {
      if (!area) {
        const { researchArea: _dropped, ...rest } = current;
        return rest as RoomLayout;
      }
      const existing = sceneAnchorOf(current);
      const sceneAnchor: SceneAnchor = {
        lng: area.center.lng,
        lat: area.center.lat,
        orientationDeg: existing?.orientationDeg ?? 0,
        metersPerUnit: existing?.metersPerUnit ?? 1,
      };
      return { ...current, sceneAnchor, researchArea: area };
    })();
    try {
      commitHistoryNow();
      actions.applyLayout(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    }
  }, [actions, commitHistoryNow, notify]);

  /**
   * Golden Path 第 1 步：选中一套已扫描的真实场地，直接换场。
   * 尺寸与场地标记合成一步历史——撤销一次就回到上一套场地（画布与尺寸一起退）。
   * 注册表带米制尺寸就直接按它摆壳体；没带时才等高斯就绪校准。
   */
  const applyRealVenue = useCallback((venue: ScannedVenue) => {
    if (venue.assetId === environmentsRef.current[0]?.assetId) {
      // 点当前场地：已在焦点上的再点推近一档（×0.75），没在焦点上的 zoom 过去。
      zoomToVenue(venue, venue.assetId === focusedVenueId);
      return;
    }
    const active = environmentsRef.current[0];
    const before = layoutStore.getState().layout;
    // 换场前的这份布局就是撤销目标；记下它当时的场地，撤销时画布才能一起退回去。
    if (active) venueByLayoutRef.current.set(before, { assetId: active.assetId, name: active.name });
    // 只换场地，物料不在这里覆盖；下面会把场地自己的物料一起放进同一次布局变更。
    selectEnvironment(venue.assetId, venue.name, { restoreItems: false });
    const live = layoutStore.getState().layout;
    const entry = environmentsRef.current.find(item => item.assetId === venue.assetId);
    // 尺寸未知的扫描也先把场地挂上：尺寸一栏如实写「未标注」，不拿旧场地的数字冒充。
    const size = venue.meters
      ? { width: Math.round(venue.meters.width * 10) / 10, height: Math.round(venue.meters.depth * 10) / 10 }
      : {};
    try {
      onApplyCreative({
        ...live,
        ...size,
        venueScan: { assetId: venue.assetId, name: venue.name },
        ...(entry?.itemsByFloor ? {
          floors: live.floors.map((floor, index) => ({
            ...floor,
            items: entry.itemsByFloor?.[index] ? [...entry.itemsByFloor[index]!] : floor.items,
          })),
        } : {}),
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    }
    // 场地 splat 异步加载，就绪后 zoom 到该场景（pending 效果在 splatState ready 时触发）。
    pendingVenueZoomRef.current = venue;
  }, [notify, onApplyCreative, selectEnvironment, zoomToVenue, focusedVenueId]);

  // 场景点位（docs/49 需求A）：有经纬度的扫描场地在底图上各钉一个点，点一下 zoom 过去。
  const sceneGeoDots = useMemo(() => {
    if (view.view2D || !layout.researchArea) return [];
    return listScannedVenues().flatMap(venue => {
      if (!venue.geo) return [];
      const world = researchGeoToWorld(layout, venue.geo.lng, venue.geo.lat);
      return world ? [{ id: venue.assetId, name: venue.name, x: world.x, z: world.z }] : [];
    });
    // 只看影响投影的字段：锚点/底图/场地尺寸。
  }, [view.view2D, layout.researchArea, layout.sceneAnchor, layout.mapGroundFrame, layout.mapLngLat, layout.width, layout.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickSceneGeoDot = useCallback((assetId: string) => {
    const venue = listScannedVenues().find(item => item.assetId === assetId);
    if (venue) applyRealVenue(venue);
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
  }, [splatState, onApplyCreative]);
  // docs/49 地理底图：场地扫描资产带 geo（拍摄位置）就自动铺卫星底图，重建物落在真实位置上；
  // 手动/调研标的底图（无 scanAssetId 标记）永远不被自动逻辑覆盖；新场地没 geo 就撤掉自己铺的那张。
  const scanBasemapAssetRef = useRef('');
  useEffect(() => {
    const assetId = environments[0]?.assetId ?? '';
    if (!assetId || scanBasemapAssetRef.current === assetId) return;
    scanBasemapAssetRef.current = assetId;
    const asset = findAholoAsset(assetId);
    const existing = layoutStore.getState().layout.researchArea;
    if (existing && !existing.scanAssetId) return; // 手动底图优先，不覆盖
    if (!asset?.geo) {
      if (existing?.scanAssetId) applyResearchArea(null);
      return;
    }
    if (existing?.scanAssetId === assetId) return;
    const span = Math.max(asset.meters?.width ?? 0, asset.meters?.depth ?? 0);
    const radius = asset.geo.radiusM ?? Math.round(Math.max(300, Math.min(1600, span * 12)));
    applyResearchArea({
      ...createResearchArea({ name: asset.name, address: '', lng: asset.geo.lng, lat: asset.geo.lat }, radius, RESEARCH_SATELLITE_STYLE),
      scanAssetId: assetId,
    });
  }, [environments, applyResearchArea]);
  const splatPlacement = splatState.status === 'ready'
    ? placeSplatPreview(layout, splatState.name, splatState.meters ?? null)
    : null;
  const environmentShown = environment !== null && (environment.floorIndex ?? 0) === activeFloorIndex && splatState.status === 'ready' && splatState.assetId === environment.assetId;
  const splatBanner = splatPlacement
    ? (splatShellKeptFor === splatState.assetId && splatPlacement.resize ? splatShellKeptNote(splatState.name) : splatPlacement.note)
    : null;
  // A selected venue is already represented by its space card and transform controls;
  // only temporary previews and a failed shell resize need a canvas notice.
  const splatBannerText = splatBanner && environmentShown ? splatBanner.replace('环境预览：', '环境：') : splatBanner;
  const showSplatBanner = !!splatBannerText && (!environmentShown || splatShellKeptFor === splatState.assetId);
  const updateSplatPosition = (axis: keyof SplatPosition, value: number) => {
    if (!Number.isFinite(value)) return;
    const position = { ...(environment?.position ?? ZERO_SPLAT_POSITION), [axis]: value };
    setSplatPosition(position);
    if (!environment) return;
    const next = [{ ...environment, position }, ...environmentsRef.current.slice(1)];
    environmentsRef.current = next;
    setEnvironments(next);
    writeEnvironments(layout.id, next);
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
    actions.applyLayout({ ...layoutStore.getState().layout, id: projectId });
  }, [actions]);
  // 无感挂云（设计规范 v2.5.2 §二.4）：登录态摆上第一件物料时静默建云项目并接上保存链。
  useSilentCloudAttach({ controller, layout, onBindProject });

  const onPreviewAi = useCallback((candidate: RoomLayout | null) => {
    setAiPreview(candidate ? { base: liveLayout.current, candidate } : null);
    if (candidate) {
      setView(current => ({ ...current, view2D: false }));
      setPreviewGuard(snapshotPreviewContext(liveLayout.current, candidate));
    } else {
      setPreviewGuard(null);
    }
  }, []);
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
  const draftLabel = saveError ? '保存失败' : isSaving ? '正在保存…' : lastSavedAt ? '已保存' : '草稿';
  const draftFoot = saveError ? '未保存' : isSaving ? '保存中' : lastSavedAt ? '已保存' : '';
  const draftTitle = saveError ? '保存失败，请导出备份' : draftLabel;
  // 集成接线：顶栏容量计——从 layout 读宽深（height 字段在本仓库里是深度），调用纯函数估算。
  const capacityPlacedCount = activeFloor.items.length;
  const capacityEstimate = (typeof layout.width === 'number' && typeof layout.height === 'number' && layout.width > 0 && layout.height > 0)
    ? estimateCapacity(layout.width, layout.height, capacityPlacedCount)
    : null;
  const capacityText = capacityEstimate
    ? `本场上限 ${capacityEstimate.maxItems} 件 · 已放 ${capacityEstimate.placedItems} 件`
    : '本场上限 —';
  const capacityOverloaded = !!capacityEstimate && capacityEstimate.ratio > 0.9;

  // 第 12 批：「能摆 → 会摆」三版打分。draft.annotations 里的 zone 标注跑三档密度
  // （松/适中/密），每版独立打分，父组件把分数条 + 推荐版传给 PlanCard。
  // 纯函数，没有副作用，每次 render 重算即可（zone 数量小）。
  const draftAnnotations = planAnnot.draft?.annotations ?? [];
  const zoneAnnotationsForScoring = draftAnnotations.filter((a) => a.kind === 'zone');
  // 第 12 批：把场地尺寸喂给打分层，启用「zone 越出场地边界」整块跳过判定。
  const roomSizeForScoring = (typeof layout.width === 'number' && typeof layout.height === 'number')
    ? { width: layout.width, height: layout.height }
    : undefined;
  const scoredPlans: ScoredPlan[] = zoneAnnotationsForScoring.length > 0
    ? generateScoredPlans(zoneAnnotationsForScoring, roomSizeForScoring ? { roomSize: roomSizeForScoring } : undefined)
    : [];
  const recommendedPlan: ScoredPlan | null = scoredPlans.length > 0
    ? pickRecommendedPlan(scoredPlans)
    : null;
  const effectiveSelectedPlan: ScoredPlan | null =
    scoredPlans.find((p) => p.variantId === selectedVariantId) ?? recommendedPlan;
  // 第 12 批：AI 建议（受众/区类型/场地短边命中式）。
  // audience 从本机对话账本 getAgentChatThreads() 拼所有 'you' 消息文本——
  // 用户在左轨跟空间/物料/活动/Bingo 四条线说过的所有话，就是活动画像的近似来源。
  const zoneTypesForSuggestions = [
    ...new Set(
      zoneAnnotationsForScoring.map((a) => a.zoneType ?? 'roundtable'),
    ),
  ] as ZoneSemanticType[];
  const roomShortSideM = (typeof layout.width === 'number' && typeof layout.height === 'number')
    ? Math.min(layout.width, layout.height)
    : undefined;
  const audienceForSuggestions = (() => {
    try {
      const threads = getAgentChatThreads();
      const parts: string[] = [];
      for (const agent of ['door', 'bingo', 'space', 'material'] as const) {
        for (const m of threads[agent] ?? []) {
          if (m.from === 'you' && typeof m.text === 'string' && m.text.trim()) {
            parts.push(m.text.trim());
          }
        }
      }
      return parts.join(' ');
    } catch {
      return '';
    }
  })();
  const activitySuggestions: ActivitySuggestion[] = zoneAnnotationsForScoring.length > 0
    ? generateSuggestions({
        audience: audienceForSuggestions,
        zoneTypes: zoneTypesForSuggestions,
        ...(typeof roomShortSideM === 'number' ? { roomShortSideM } : {}),
      })
    : [];

  return (
    <RoomEditorProvider value={roomEditorValue}>
    <SelectionProvider value={selectionValue}>
    <CreativeStudioProvider onUpdateProductionPlan={value=>{commitHistoryNow();actions.setProductionPlan(value);}} reviewContext={reviewContext} controller={controller} layout={layout} onApply={onApplyCreative} prepareRestoreLayout={prepareRestoreLayout} commitRestoredLayout={commitRestoredLayout} onBindProject={onBindProject} onPreview={onPreviewAi} onUpdateItem={(id, patch) => { commitHistoryNow(); actions.updateItem(id, patch); }} onUpdateEventOperations={value => {
      if (!parseLayoutEventOperations({ ...layoutStore.getState().layout, eventOperations: value })) throw new Error('活动安排未保存，请核对任务内容及关联物料是否有重复编号。');
      commitHistoryNow(); actions.setEventOperations(value);
    }}>
      <LayoutAgentProvider handoffExportRequest={handoffExportRequest} onVenueIOChange={io => setOutdoorVenue(io === 'outdoor')} onPreview={onPreviewAi} onApply={onApplyCreative} onApplyZoneRects={(zones) => {
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
        onIssueReviewLink: async () => (await issueReviewLink()).url,
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
              color: capacityOverloaded ? '#C0392B' : '#4A7C59',
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
                <a
                  href="/guide/capture"
                  className="sc-rail-tool sc-rail-disc sc-rail-capture"
                  aria-label="拍摄场地：拍完当场判断能不能重建，并出 3D"
                  data-tip="拍摄场地 · 出 3D"
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.1-1.7a1 1 0 0 1 .84-.46h4.72a1 1 0 0 1 .84.46L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-8Z" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="12" cy="12.5" r="3.1" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <span className="sc-rail-label" aria-hidden="true">拍摄场地</span>
                </a>
              </nav>
            </div>
            <RailTeamBlock controller={controller} team={team} onOpenChat={member => setChatPeerId(current => current === member.userId ? null : member.userId)} onOpenTeam={() => setTeamOpenRequest(current => ({ serial: (current?.serial ?? 0) + 1, section: 'team' }))}/>
            <div className="sc-mode-rail-foot">
              {draftFoot && <p role="status" className={`sc-rail-draft${saveError ? ' has-error' : ''}`} title={draftTitle}>{draftFoot}</p>}
              <button
                type="button"
                className={`sc-annotation-toggle${planAnnot.drawMode !== 'off' ? ' is-active' : ''}`}
                aria-label="切换标注模式：区/线/距"
                onClick={() => {
                  // 集成接线：规划标注模式循环 off→zone→route→measure→off；首次点击时开一份空草案。
                  // door 是数据层新增（开门弧遮挡用），暂未接入画布循环按钮，从 UI 入口再开。
                  const order: Array<'off' | 'zone' | 'route' | 'measure'> = ['off', 'zone', 'route', 'measure'];
                  const idx = order.indexOf(planAnnot.drawMode as 'off' | 'zone' | 'route' | 'measure');
                  const next = order[(idx + 1) % order.length];
                  if (!planAnnot.draft) planAnnot.startDraft();
                  planAnnot.setDrawMode(next);
                }}
              >
                <span className="sc-annotation-toggle__label">标注</span>
                {planAnnot.drawMode === 'zone' && <span className="sc-annotation-toggle__suffix">·区</span>}
                {planAnnot.drawMode === 'route' && <span className="sc-annotation-toggle__suffix">·线</span>}
                {planAnnot.drawMode === 'measure' && <span className="sc-annotation-toggle__suffix">·距</span>}
              </button>
              <SettingsMenu buttonRef={workspaceEntryRef} />
              
              <CloudPanel controller={controller} layout={layout} draftNote={{ label: draftLabel, error: !!saveError, ...(draftTitle ? { title: draftTitle } : {}) }} onLoadLayout={onLoadLayout} onApplyLayout={onApplyCreative} {...(teamOpenRequest ? { openRequest: teamOpenRequest } : {})} onClose={()=>{if(conversationOpen&&window.innerWidth<=680)headerRef.current?.parentElement?.querySelector<HTMLButtonElement>('.cr-chat-header-actions button')?.focus();}}/>
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
          <a className="sc-mobile-capture-entry" href="/guide/capture" aria-label="拍摄场地：拍完出 3D">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.1-1.7a1 1 0 0 1 .84-.46h4.72a1 1 0 0 1 .84.46L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-8Z" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="12.5" r="3.1" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            <span>拍摄场地</span>
          </a>
          <div id="workbench-nav-column" className={`sc-left-column${sidebarCollapsed ? '' : ' has-tool'}`}>
          <div id="workbench-left-panel" className={`sc-left-drawer sc-float-layer ${sidebarCollapsed ? 'is-collapsed' : ''}${leftMode==='brief'?' has-brief':''}${leftMode==='business'?' has-business':''}${leftMode==='properties'?' has-properties':''}`}>
            <div className="sc-left-heading"><nav className="sc-left-context" aria-label="当前工具内容">
              {selectedItem&&<button type="button" aria-pressed={leftMode==='properties'} onClick={()=>{setLeftMode('properties');setSidebarCollapsed(false);}}>选中物料</button>}
              {luxDirectVisible&&(leftMode==='lux3d'||aholoReconPreset)&&<button type="button" aria-pressed={leftMode==='lux3d'} onClick={()=>{setLux3dOpenKind(null);setLeftMode('lux3d');setBusinessOpen(false);setSidebarCollapsed(false);}}>场地观感</button>}
            </nav><button type="button" className="sc-left-close sc-icon-button" aria-label="收起左侧面板" onClick={closeLeftPanel}><PanelLeftClose size={20}/></button></div>
            <div className="sc-left-content sc-mode-card-host" hidden/>
          </div>
          {personChat && chatPeerId && <MemberChat key={chatPeerId} controller={controller} team={team} peerId={chatPeerId} onClose={() => setChatPeerId(null)}/>}
          {!personChat && agentPanelVisible && <AgentPanel onClose={closeBingo} activeAgent={activeAgent} spaceSlot={<SpacePanel variant="card" layout={layout} onApply={onApplyCreative} onOpenAholo={luxDirectVisible ? openAholoWorkflow : undefined} workflow={spaceWorkflow} onWorkflowChange={setSpaceWorkflow} onRegisterNew={run => { spaceNewRef.current = run; }} onPickScan={applyRealVenue} currentScanId={environment?.assetId} environment={{ preview: splatState, current: environment, environments, floors: layout.floors.map(floor => ({ id: floor.id, name: floor.name })), onSelect: selectEnvironment, onRemove: removeEnvironment, onSetFloor: setEnvironmentFloor, onClear: dropEnvironment }}/>} materialSlot={<ScendanceLibrary variant="card" capturePlacement={capturePlacement} controller={controller} placeCatalogItem={placeFromCatalog}/>} chatSlot={<AgentChat agent={activeAgent} onNewSpace={mode => spaceNewRef.current?.(mode)} onOpenAholo={luxDirectVisible ? openAholoWorkflow : undefined} onSelectSpaceWorkflow={setSpaceWorkflow}/>} headerAvatarRef={bingoHeaderAvatarRef} headerAvatarVisible={bingoHeaderAvatarVisible}/>}
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
        walkthroughInEnvironment={splatState.status === 'ready'}
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
            <EnvironmentLoad active={splatState.status === 'loading'} name={splatState.name} {...(splatState.progress === undefined ? {} : { progress: splatState.progress })} />
            <AgentCanvasOverlay/>
            <MapVenueOverlay onHangDemoEnvironment={hangDemoEnvironment} onReconUpload={luxDirectVisible ? preset => {
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
                onRotate={id => { commitHistoryNow(); if (rotateItemHandler(id)) playCue('rotate'); }} onToggleCameraBracket={toggleCameraBracket} onDuplicate={duplicateSelected} onRemove={removeItem} onClose={() => { selectOnly(null); setLeftMode('brief'); }}/>
            </div>}
            {luxDirectVisible && leftMode === 'lux3d' && <div className="sc-canvas-share">
              <div className="sc-canvas-share-bar"><strong>场地观感</strong><button type="button" aria-label="收起观感" onClick={() => setLeftMode('brief')}>收起</button></div>
              <Lux3dDirectTest reconPreset={aholoReconPreset} openKind={lux3dOpenKind} onHangMockScene={hangDemoEnvironment} onPreviewShippedScene={startStoredScene} onPlace={item => { const id = placeFromCatalog(item); if (id) selectOnly(id, { keepPanel: true }); return !!id; }} onPreviewScene={openScenePreview}/>
            </div>}
            <CanvasHeading view2D={view.view2D} />
            <GeoBasemapInput area={layout.researchArea} onApply={applyResearchArea} view2D={view.view2D} onFrameOverview={() => { setSceneFocus(null); fitToRoom(); }} />
            <SceneGeoDots
              dots={sceneGeoDots}
              focusedId={focusedVenueId}
              toScreen={toScreen}
              controlsRef={controlsRef}
              cameraReady={isReady}
              onPick={pickSceneGeoDot}
            />
            {previewCandidate && <div className={`sc-preview-caption${previewCaptionVisible ? '' : ' is-faded'}`} role="status" aria-hidden={!previewCaptionVisible}>AI 修改预览 · 尚未加入场景{view.view2D ? ' · 切回整体视角查看' : ' · 半透明为候选，线框为原位置'}</div>}
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
            {pendingCatalog && <div className="sc-local-conflict" role="status"><span>待放置：{pendingCatalog.name} · 点击场地选择有效位置</span><button type="button" onClick={()=>setPendingCatalog(null)}>取消放置</button></div>}
            {remoteLayout && <div className="sc-local-conflict"><span>另一标签页更新了本地副本</span><button type="button" onClick={adoptRemoteLayout}>采用更新</button><button type="button" onClick={clearRemoteLayout}>保留当前</button></div>}
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
            {view.view2D && planAnnot.drawMode === 'zone' && (
              <div className="sc-zone-picker" role="toolbar" aria-label="标注区类型">
                {(Object.keys(ZONE_SEMANTIC_LABELS) as ZoneSemanticType[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={zoneType === key}
                    className={zoneType === key ? 'is-active' : ''}
                    onClick={() => setZoneType(key)}
                  >
                    {ZONE_SEMANTIC_LABELS[key]}
                  </button>
                ))}
                <span className="sc-zone-picker__hint">拖框即画，可连续画；Esc 收尾</span>
              </div>
            )}
            {planAnnot.draft && (planAnnot.draft.stages.length > 0 || planAnnot.draft.annotations.length > 0) && (
              <div style={{ position: 'absolute', right: 16, top: 16, zIndex: 40, maxWidth: 320 }}>
                <PlanCard
                  draft={planAnnot.draft}
                  plans={scoredPlans}
                  recommendedId={recommendedPlan?.variantId}
                  selectedId={effectiveSelectedPlan?.variantId}
                  onSelectVariant={setSelectedVariantId}
                  suggestions={activitySuggestions}
                  onApprove={() => {
                    const draft = planAnnot.draft;
                    if (!draft) return;
                    const zoneAnnotations = draft.annotations.filter((a) => a.kind === 'zone');
                    if (zoneAnnotations.length === 0) {
                      notify('还没画任何区，请先拖框画一个签到/休息/圆桌区', 'info');
                      planAnnot.clearDraft();
                      return;
                    }
                    // 第 12 批：按用户选中的版本（默认推荐版）落家具，不再写死 0.5 密度。
                    const plan = effectiveSelectedPlan;
                    if (!plan) {
                      notify('三版打分未生成，请重新画标注', 'error');
                      return;
                    }
                    const placements = plan.placements;
                    const skipped = plan.skipped;
                    if (placements.length === 0) {
                      notify(
                        skipped.map((s) => s.reason).join('；') || '标注区太小，摆不下家具，请扩大标注范围',
                        'error',
                      );
                      return;
                    }
                    const opId = `approve-${Date.now()}`;
                    const stamp = { source: 'ai' as const, opId };
                    const newItems: FurnitureItem[] = placements.map((p, idx) => {
                      const baseId = `approve-${p.spec.type}-${idx}-${Date.now().toString(36)}`;
                      return {
                        id: baseId,
                        type: p.spec.type,
                        name: p.spec.name,
                        width: p.spec.width,
                        depth: p.spec.depth,
                        height: p.spec.height,
                        color: p.spec.color,
                        icon: p.spec.icon,
                        position: { x: p.x, z: p.z },
                        rotation: p.rotation,
                        category: p.spec.category,
                        provenance: stamp,
                      } as FurnitureItem;
                    });
                    const before = layout;
                    const candidate: RoomLayout = {
                      ...before,
                      floors: before.floors.map((f, i) =>
                        i === activeFloorIndex ? { ...f, items: [...f.items, ...newItems] } : f,
                      ),
                    };
                    const cmd = applyLayoutCommand({ layout: candidate });
                    const result = applyLayoutCommandWithRefusals(cmd, { layout: before });
                    if (!result.ok) {
                      const msg =
                        result.shapeIssues.map((s) => s.message).join('；') ||
                        result.preconditions.map((p) => p.message).join('；') ||
                        '候选方案无法应用';
                      notify(msg, 'error');
                      return;
                    }
                    const settleReport = settlePlacement(result.nextLayout, activeFloorIndex);
                    commitHistoryNow();
                    actions.applyLayout(settleReport.layout);
                    const placedCount = newItems.length - result.refused.length;
                    const movedCount = settleReport.steps.reduce((n, s) => n + s.moved.length, 0);
                    // 第 11 批：回执说人话——按名统计落了什么、被拒为什么、哪个区没摆下。
                    const nameCounts = new Map<string, number>();
                    for (const p of placements) {
                      nameCounts.set(p.spec.name, (nameCounts.get(p.spec.name) ?? 0) + 1);
                    }
                    const doneText = [...nameCounts.entries()].map(([name, n]) => `${name} ${n} 件`).join('、');
                    const REFUSED_HUMAN: Record<string, string> = {
                      OUT_OF_BOUNDS: '超出场地边界',
                      WALL_INTERSECTION: '压住墙体',
                      BBOX_OVERLAP: '压住现有家具',
                      FLOOR_OUT_OF_RANGE: '不在本层',
                    };
                    const refusedText = result.refused.length
                      ? `；${result.refused.length} 件未放（${[
                          ...new Set(result.refused.map((r) => REFUSED_HUMAN[r.code] ?? r.code)),
                        ].join('、')}）`
                      : '';
                    const skippedText = skipped.length ? `；${skipped.map((s) => s.reason).join('；')}` : '';
                    // 第 12 批：回执带上推荐版标签 + 前两条打分理由，让用户知道为什么是这版。
                    const recommendTag = recommendedPlan
                      ? `；推荐${recommendedPlan.label}版（${recommendedPlan.reasons.slice(0, 2).join('；')}）`
                      : '';
                    notify(
                      `已按 ${zoneAnnotations.length} 个标注区布置 ${placedCount} 件（${doneText}）${recommendTag}；${movedCount} 处堵点已自动挪开${refusedText}${skippedText}`,
                      'success',
                    );
                    planAnnot.clearDraft();
                  }}
                  onReplace={() => planAnnot.replaceDraft(createEmptyPlanDraft())}
                  onCancel={() => planAnnot.clearDraft()}
                  onComment={(text) => notify(`已记下反馈：${text}`, 'info')}
                />
              </div>
            )}
          </div>
            <div className="sc-editor-dock">
            <ScendanceViewTools environmentView={splatDisplayMode} environmentViewEnabled={environmentShown && !view.view2D} onEnvironmentViewChange={mode => { if (mode === 'footprint') setSplatTransformMode('off'); setSplatDisplayMode(mode); }} sceneMoveEnabled={environmentShown && splatDisplayMode === 'gaussian' && !view.view2D} sceneMoveMode={splatTransformMode} onSceneMoveModeChange={setSplatTransformMode} layoutLocked={workbenchMode !== 'layout'} showAtmosphere={false} shareOpenRequest={shareOpenRequest} shareActions={{ onIssueReviewLink: issueReviewLink, onPublish: publishVersion, onExportHandoff: exportHandoff, onGenerateShareLink: handleShareLink, onOpenMaterials: openMaterialsFromShare, onOpenChecklist: () => setChecklistOpen(true) }} onExportImage={handleExportImage} onCaptureImage={captureRenderImage} onExportAlbum={handleExportAlbum} onApplyPreset={applyPreset} onLighting={value=>{ if (workbenchMode !== 'layout') return; commitHistoryNow();actions.applyLayout({...layoutStore.getState().layout,backendLighting:value});setView(current=>({...current,view2D:false}));}} onZoom={direction => {
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
  );
}

export default RoomOrganizer;
