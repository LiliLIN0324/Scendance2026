'use client';

import { PanelLeftClose, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBackendSession, type BackendSession } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { commitLocalRestoreLayout, prepareLocalRestoreLayout } from '@/lib/local-project-restore';
import { reviewShareHref } from '../review-share-page/load-plan';
import { get2DViewTransform } from './canvas-2d/render';
import { RoomEditorProvider, type RoomEditorContextValue } from './contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from './contexts/selection-context';
import { layoutReducer } from './hooks/layout-reducer';
import { useCameraFly } from './hooks/use-camera-fly';
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
import { useSplatPreview } from './hooks/use-splat-preview';
import { useThreeScene } from './hooks/use-three-scene';
import { useWalkthrough } from './hooks/use-walkthrough';
import { useWeather } from './hooks/use-weather';
import { loadAholoSceneSource, storedAholoSceneSource } from './lib/aholo-model-placement';
import { findCatalogEntry } from './lib/catalog-drag';
import { captureCatalogPlacement } from './lib/catalog-placement-guard';
import { buildPasteItems, copyToClipboard } from './lib/clipboard';
import { CAMERA_BRACKET_ARM, EVENT_CATALOG } from './lib/constants';
import { crowdHintsFromLayout } from './lib/crowd-route';
import { saveCustomSet } from './lib/custom-sets';
import { notify } from './lib/editor-notices';
import { hasCollisions, totalCost } from './lib/geometry';
import { expandSelection, groupIdsIn, isWholeGroup } from './lib/groups';
import { randomId, randomSuffix } from './lib/ids';
import { LEFT_CARD_WIDTH_DEFAULT, LEFT_CARD_WIDTH_KEY, parseLeftCardWidth } from './lib/left-card-width';
import { isNavExpanded, toggleNavColumns } from './lib/nav-chrome';
import { loadOnlineCatalogItem } from './lib/online-model-placement';
import { loadOnlineModels } from './lib/online-models';
import { reseatWallMountedItem, settleWallMountedItem } from './lib/opening-snap';
import { snapshotBeforeReplace } from './lib/restore-point';
import { createReviewPin, flyDestination, markPinResolved, pinAnchor, pinSubject, planPointToCanvas, type ReviewPin, type ReviewPinDraft, type ReviewPinFilter } from './lib/review-pins';
import { editorItemLimit } from './lib/scene-presets';
import { parseLayoutEventOperations } from './lib/schema';
import { encodeShareUrl } from './lib/share';
import { DEMO_WORLD_SCENE_ID } from './lib/shipped-assets';
import { playSound, type SoundCue } from './lib/sounds';
import { buildingHeight, floorElevation, storeyHeight } from './lib/storeys';
import { entrancePlanOutline } from './lib/street';
import { canApplyLayoutGeometry, structuralItemCollides, materialCount } from './lib/structural-layout';
import { snapWallEndpoint } from './lib/wall-snap';
import { WORKBENCH_MODE_DEFAULT, demoteLegacyMode, type WorkbenchMode } from './lib/workbench-mode';
import { ActivityTaskWorkspace } from './panels/activity-task-workspace';
import { AgentCanvasOverlay, AgentPanel, LayoutAgentProvider, MapVenueOverlay } from './panels/agent-panel';
import { BingoRailButton } from './panels/bingo-rail-button';
import { BingoReviewPanel } from './panels/bingo-review-panel';
import { useVenueLibrary } from './hooks/use-venue-library';
import { VenueLibraryPanel, VenueRailButton } from './panels/venue-library-panel';
import { CloudPanel } from './panels/cloud-panel';
import { CommercialWorkspace } from './panels/commercial-workspace';
import { CreativeStudioProvider, CreativeAssistant, type BusinessToolsApi } from './panels/creative-studio';
import { GeneratedModelLibrary } from './panels/generated-model-library';
import { ItemContextPopover } from './panels/item-context-popover';
import { LeftCardResizer } from './panels/left-card-resizer';
import { Lux3dDirectTest } from './panels/lux3d-direct-test';
import { DeliveryChecklistShell, ReviewIssuesCard, WorkbenchModeCard } from './panels/mode-shell';
import { PlacementHint } from './panels/placement-hint';
import { PlanFlow } from './panels/plan-flow';
import { QingguangRailButton } from './panels/qingguang-rail-button';
import { ReferenceImageControls } from './panels/reference-image-controls';
import { ReviewPinLayer, type ReviewPinMark } from './panels/review-pin-layer';
import { MaterialDrawerHandle, ScendanceLibrary, ScendanceViewTools } from './panels/scendance-workspace';
import { StatusToastHost } from './panels/status-toast';
import { Viewport } from './panels/viewport';
import { WorkbenchBrandToggle } from './panels/workbench-brand-toggle';
import type { HoverInfo } from './hooks/use-three-scene';
import type { GameMode } from './lib/types';
import type { CatalogItem, RoomLayout, ViewSettings, WallId } from './lib/types';
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
  const liveLayout = useRef(layout); liveLayout.current = layout;
  const [aiPreview, setAiPreview] = useState<{base: RoomLayout; candidate: RoomLayout} | null>(null);
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
  // 工具抽屉和晴光列同时关着，左侧导航才算收起。logo 只写这两扇门。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const venueLibrary = useVenueLibrary();
  const [venueLibraryOpen, setVenueLibraryOpen] = useState(false);
  const [bingoPanelOpen, setBingoPanelOpen] = useState(false);
  const navExpanded = isNavExpanded({ agentCollapsed, sidebarCollapsed });
  const leftColumnOpen = navExpanded || bingoPanelOpen;
  const toggleNav = useCallback(() => {
    setBingoPanelOpen(false);
    setVenueLibraryOpen(false);
    const next = toggleNavColumns({ agentCollapsed, sidebarCollapsed });
    setAgentCollapsed(next.agentCollapsed);
    setSidebarCollapsed(next.sidebarCollapsed);
    const focusSelector = '.sc-mode-rail .sc-nav-brand';
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(focusSelector)?.focus());
  }, [agentCollapsed, sidebarCollapsed]);
  /** 晴光栏在左侧。关掉后再从画布上的晴光浮标打开，回到布置对话。 */
  const [composerGenerate, setComposerGenerate] = useState(false);
  const [planHome, setPlanHome] = useState(true);
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
  // 左轨「观感」默认生产也显示；设 NEXT_PUBLIC_LUX3D_RAIL=0 可关掉。面板内生产走 shipped/云路径，不打 127.0.0.1。
  const luxDirectVisible = process.env.NEXT_PUBLIC_LUX3D_RAIL !== '0';
  // 地图采集单拍完的素材要接进 Aholo 场地重建：带着这块地的名字和应拍张数过去，省得她再填一遍。
  const [aholoReconPreset, setAholoReconPreset] = useState<{ name: string; hint: string } | null>(null);
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>(WORKBENCH_MODE_DEFAULT);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [handoffExportRequest, setHandoffExportRequest] = useState(0);
  const [shareOpenRequest, setShareOpenRequest] = useState(0);
  const [reviewPins, setReviewPins] = useState<ReviewPin[]>([]);
  const [pinFilter, setPinFilter] = useState<ReviewPinFilter>('open');
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState<ReviewPinDraft | null>(null);
  const [reviewCleared, setReviewCleared] = useState(false);
  const reviewPinsRef = useRef(reviewPins);
  reviewPinsRef.current = reviewPins;
  const openPinDraftRef = useRef<(pick: { itemId: string | null; x: number; y: number; z: number }) => void>(() => {});
  const [outdoorVenue, setOutdoorVenue] = useState(false);
  const [workbenchModeSerial, setWorkbenchModeSerial] = useState(0);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [deliveryOpenRequest, setDeliveryOpenRequest] = useState(0);
  const [backupOpenRequest, setBackupOpenRequest] = useState(0);
  const [reviewOpenRequest, setReviewOpenRequest] = useState(0);
  const [publicationOpenRequest, setPublicationOpenRequest] = useState(0);
  const [accountOpenRequest, setAccountOpenRequest] = useState<{ serial: number; section: string }>({ serial: 0, section: 'team' });
  const deliveryEntryRef = useRef<HTMLButtonElement>(null);
  const reviewEntryRef = useRef<HTMLButtonElement>(null);
  const [materialTabRequest, setMaterialTabRequest] = useState<{serial:number;tab:'materials'|'presets'|'environment'|'generated'}>({serial:0,tab:'materials'});
  const [conversationCloseRequest, setConversationCloseRequest] = useState(0);
  const businessHostRef = useRef<HTMLDivElement>(null);
  const businessToolsRef = useRef<BusinessToolsApi | null>(null);
  const toolsEntryRef = useRef<HTMLButtonElement>(null);
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
    if (open && window.innerWidth <= 1080) { setSidebarCollapsed(true); setMaterialsOpen(false); }
  }, []);
  // 深工具打开时左栏让出来；关掉不把简报重新撑开，首屏把宽度留给画布。
  // 图纸、评审资料、执行清单开在画布上，不把左侧晴光换成另一张卡。
  const handleWorkspaceVisibility = useCallback((open: boolean) => {
    setBusinessOpen(open);
    if (open) {
      setLeftMode('business');
      setMaterialsOpen(false);
      setSidebarCollapsed(true);
      setAgentCollapsed(false);
    } else setLeftMode(mode => (mode === 'business' ? 'brief' : mode));
  }, []);
  const workspaceEntryRef = useRef<HTMLButtonElement>(null);
  const closeMaterialsShelf = useCallback(() => {
    setMaterialsOpen(false);
    toolsEntryRef.current?.focus();
  }, []);
  const toggleMaterialsShelf = useCallback(() => {
    if (materialsOpen) {
      setMaterialsOpen(false);
      return;
    }
    if (conversationOpen && window.innerWidth <= 1080) setConversationCloseRequest(value => value + 1);
    setWorkbenchMode('layout');
    setMaterialsOpen(true);
    setBusinessOpen(false);
    if (leftMode === 'business' || leftMode === 'properties') setSidebarCollapsed(true);
  }, [materialsOpen, conversationOpen, leftMode]);
  const openTemplates = useCallback(() => {
    if (window.innerWidth <= 1080) setConversationCloseRequest(value => value + 1);
    setMaterialTabRequest(current => ({serial:current.serial+1,tab:'presets'}));
    setMaterialsOpen(true);
    setBusinessOpen(false);
    if (leftMode === 'business' || leftMode === 'properties') setSidebarCollapsed(true);
    requestAnimationFrame(() => [...document.querySelectorAll<HTMLButtonElement>('#workbench-material-shelf [role="tab"]')].find(button=>button.textContent==='场景模板')?.focus());
  }, [leftMode]);
  const closeLeftPanel = useCallback(() => {
    setBusinessOpen(false);
    setMaterialsOpen(false);
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
    setMaterialsOpen(false);
    setBusinessOpen(false);
    setLeftMode('brief');
    setSidebarCollapsed(true);
    setAgentCollapsed(false);
  }, []);
  const issueReviewLink = useCallback(async () => {
    const encoded = await encodeShareUrl(layoutStore.getState().layout, window.location.origin);
    const url = reviewShareHref(window.location.origin, new URL(encoded.url).hash);
    if (!url) throw new Error('评审链接没有生成。');
    return { url };
  }, []);
  const exportHandoff = useCallback(() => {
    setAgentCollapsed(false);
    setHandoffExportRequest(value => value + 1);
  }, []);
  const openMaterialsFromShare = useCallback(() => {
    document.querySelector<HTMLButtonElement>('.sc-cloud-trigger')?.click();
  }, []);
  const toggleQingguang = useCallback(() => {
    setBingoPanelOpen(false);
    setVenueLibraryOpen(false);
    if (!agentCollapsed) {
      setAgentCollapsed(true);
      return;
    }
    setComposerGenerate(false);
    setSidebarCollapsed(true);
    setLeftMode('brief');
    setBusinessOpen(false);
    setAgentCollapsed(false);
    requestAnimationFrame(() => {
      const panel = document.getElementById('agent-panel');
      const input = document.getElementById('ap-input') ?? document.getElementById('prop-input');
      (input ?? panel)?.focus();
    });
  }, [agentCollapsed]);
  const toggleBingoPanel = useCallback(() => {
    setVenueLibraryOpen(false);
    if (bingoPanelOpen) {
      setBingoPanelOpen(false);
      return;
    }
    setAgentCollapsed(true);
    setSidebarCollapsed(true);
    setBingoPanelOpen(true);
  }, [bingoPanelOpen]);
  const toggleVenueLibrary = useCallback(() => {
    setBingoPanelOpen(false);
    setVenueLibraryOpen(open => {
      const next = !open;
      if (next) {
        setAgentCollapsed(true);
        setSidebarCollapsed(true);
      }
      return next;
    });
  }, []);
  const openQingguang = toggleQingguang;
  const openBusinessWorkspace = useCallback((mode: 'review' | 'delivery') => {
    setBingoPanelOpen(false);
    setVenueLibraryOpen(false);
    // 表单仍浮在画布上。不把晴光切成评审或执行。
    setMaterialsOpen(false);
    setLeftMode('business');
    setBusinessOpen(true);
    setSidebarCollapsed(true);
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
    selectOnly(id);
    setMaterialsOpen(false);
    setLeftMode('properties');
    setSidebarCollapsed(true);
    setAgentCollapsed(false);
  }, [selectOnly]);

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
    [activeFloor.items, selectedItemId, extraSelectedIds, selectOnly]
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
    if (selectedObjectId) { setMaterialsOpen(false); return; }
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
      commitHistoryNow();
      const id = placeCatalogItem(catalogItem, position);
      if (!id) { setPendingCatalog(catalogItem); notify('此处与结构相交，请点击场地中的其他位置放置。', 'info'); }
      else setPendingCatalog(null);
      return id;
    },
    [commitHistoryNow, placeCatalogItem, activeFloor.items, layout]
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
    ...(workbenchMode === 'review' ? { onReviewAnchor: ({ itemId, x, z }: { itemId: string | null; x: number; z: number }) => openPinDraftRef.current({ itemId, x, y: activeFloorY, z }) } : {}),
    onItemSelect: handleSelect,
    onItemDoubleClick: openPropertiesForItem,
    onDeselect: deselectAll,
    snapPosition,
    onItemDragStart: handleDragStart,
    onItemDrag: handleDrag,
    onItemDragEnd: handleDragEnd,
    onItemDragCancel: handleDragCancel,
  });

  // 3DGS 环境预览的渲染入口；useThreeScene 每帧走它，预览关闭时它是空的。
  const splatPaintRef = useRef<SplatPaint | null>(null);

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
      onItemDragEnd: handleDragEnd,
      onItemDragCancel: handleDragCancel,
      onItemHover: setHover,
      onEmptyClick: handleEmptyClick,
      editingLocked: workbenchMode !== 'layout',
      ...(workbenchMode === 'review' ? { onReviewAnchor: (anchor: { itemId: string | null; x: number; y: number; z: number }) => openPinDraftRef.current(anchor) } : {}),
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
    });

  const { state: splatState, renderFrame: paintSplatFrame, start: startSplat, stop: stopSplat } = useSplatPreview({
    isReady,
    rendererRef,
    cameraRef,
    controlsRef,
    invalidate,
    requestShadowUpdate,
    // 兜底缩放：场景没带真实尺度（lod-meta forwardBox）时，才按场地最长水平边等比塞。
    sizeMeters: Math.max(layout.width, layout.height),
  });
  splatPaintRef.current = paintSplatFrame;
  const startStoredScene = useCallback((assetId: string) => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    try {
      void startSplat(storedAholoSceneSource(assetId));
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure), 'error');
    }
  }, [setView, startSplat]);
  /** D0：地图立壳后自动挂历史 World .spz（只读 shipped，不扣额度）。 */
  const hangDemoEnvironment = useCallback(() => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    setMaterialTabRequest(current => ({ serial: current.serial + 1, tab: 'environment' }));
    setMaterialsOpen(true);
    try {
      void startSplat(storedAholoSceneSource(DEMO_WORLD_SCENE_ID));
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : String(failure), 'error');
    }
  }, [setView, startSplat]);

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

  const { lockRefused: walkthroughLockRefused } = useWalkthrough({
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

  const exitPlanView = useCallback(() => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
  }, []);
  const flyToPin = useCameraFly({ cameraRef, controlsRef, invalidate, onExit2D: exitPlanView });
  const itemOrigin = useCallback((itemId: string | null) => {
    if (!itemId) return null;
    const item = activeFloor.items.find(entry => entry.id === itemId);
    return item?.position ? { x: item.position.x, y: activeFloorY, z: item.position.z } : null;
  }, [activeFloor.items, activeFloorY]);
  openPinDraftRef.current = (pick) => {
    if (workbenchMode !== 'review') return;
    const camera = cameraRef.current;
    if (!camera) return;
    const origin = itemOrigin(pick.itemId);
    const offset = origin ? [pick.x - origin.x, pick.y - origin.y, pick.z - origin.z] as const : null;
    const cameraShot = view.view2D
      ? { position: [pick.x + 2.4, pick.y + 2.8, pick.z + 2.4] as const, target: [pick.x, pick.y, pick.z] as const }
      : { position: [camera.position.x, camera.position.y, camera.position.z] as const, target: [pick.x, pick.y, pick.z] as const };
    setPinDraft({ itemId: pick.itemId, x: pick.x, y: pick.y, z: pick.z, offset, camera: cameraShot });
  };
  const focusReviewPin = useCallback((id: string) => {
    const pin = reviewPinsRef.current.find(entry => entry.id === id);
    if (!pin) return;
    setActivePinId(id);
    flyToPin(flyDestination(pin, itemOrigin(pin.itemId)));
  }, [flyToPin, itemOrigin]);
  const commitReviewPin = useCallback((text: string) => {
    const current = pinDraft;
    if (!current) return;
    const pin = createReviewPin({ id: randomId('pin'), text, draft: current });
    if (!pin) return;
    setReviewPins(pins => [...pins, pin]);
    setActivePinId(pin.id);
    setPinFilter('open');
    setPinDraft(null);
  }, [pinDraft]);
  const returnReviewPin = useCallback((id: string) => {
    focusReviewPin(id);
    selectWorkbenchMode('layout');
    notify('回到布置。改完再进评审，标已解决。');
  }, [focusReviewPin, selectWorkbenchMode]);
  const confirmReview = useCallback(() => {
    setReviewCleared(true);
    selectWorkbenchMode('delivery');
  }, [selectWorkbenchMode]);
  const reviewMarks = useMemo<ReviewPinMark[]>(() => reviewPins.map((pin, index) => {
    const point = pinAnchor(pin, itemOrigin(pin.itemId));
    return { id: pin.id, n: index + 1, status: pin.status, x: point.x, y: point.y, z: point.z };
  }), [reviewPins, itemOrigin]);
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

  const { applyPreset, focusOn, fitToRoom, ensureRoomInView } = useCameraPresets({
    cameraRef,
    controlsRef,
    invalidate,
    roomSize: Math.max(layout.width, layout.height),
    roomWidth: layout.width,
    roomDepth: layout.height,
    canvasRef,
    buildingHeight: buildingHeight(layout.floors),
  });
  frameViewportRef.current = () => { if (!view.view2D) ensureRoomInView(); };

  const { handleScreenshot, exportRenderImage } = useImportExport({
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
    onImported: clearTransientSelection,
  });

  // 效果图导出：3D 走高清重渲染；2D 平面按当前分辨率抓取。
  const handleExportImage = useCallback(async (options: { view: 'current' | 'iso' | 'top' | 'front' | 'corner'; scale: number }) => {
    const ok = view.view2D ? (handleScreenshot(), true) : await exportRenderImage(options);
    notify(ok ? '效果图已开始下载。' : '效果图导出失败，请稍后重试。', ok ? 'success' : 'error');
    return ok;
  }, [view.view2D, handleScreenshot, exportRenderImage]);

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
      rotateItem: rotateItemHandler,
      rotateItemBy: (id: string, radians: number) => {
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
      toggleSidebar: () => setMaterialsOpen(current => !current),
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
  useEffect(() => {
    if (workbenchMode !== 'review') setPinDraft(null);
  }, [workbenchMode]);
  useEffect(() => {
    setReviewPins([]);
    setPinDraft(null);
    setActivePinId(null);
    setReviewCleared(false);
  }, [layout.id]);



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
    if (!canApplyLayoutGeometry(layoutStore.getState().layout, next)) throw new Error('候选方案包含新的墙体、柱子或边界冲突，请先修正。');
    commitHistoryNow();
    snapshotBeforeReplace(layout);
    actions.applyLayout({ ...next, ...(layout.designBook && !next.designBook ? { designBook: layout.designBook } : {}) });
    clearTransientSelection();
    initiallyFramed.current = false;
    setView(current => ({ ...current, view2D: false }));
  }, [commitHistoryNow, layout, actions, clearTransientSelection]);

  /** 场景生成/真重建「取回并预览」：先落盘再切到 3D；真成功挂本场 .spz 时同步打开环境预览抽屉，替换当前观感层。 */
  const openScenePreview = useCallback(async (source: { url: string; name?: string; taskid?: string; metaUrl?: string }) => {
    setView(current => (current.view2D ? { ...current, view2D: false } : current));
    setMaterialTabRequest(current => ({ serial: current.serial + 1, tab: 'environment' }));
    setMaterialsOpen(true);
    await startSplat(await loadAholoSceneSource(source));
  }, [setView, startSplat]);
  // 高斯优先（用户裁决）：预览就绪后把场地宽深校到高斯实测值（0.1 m 精度，进撤销历史）；场地跟高斯走，不反过来。
  const calibratedSceneRef = useRef('');
  useEffect(() => {
    if (splatState.status !== 'ready' || !splatState.meters) return;
    if (calibratedSceneRef.current === splatState.assetId) return;
    calibratedSceneRef.current = splatState.assetId;
    const width = Math.round(splatState.meters.width * 10) / 10;
    const height = Math.round(splatState.meters.depth * 10) / 10;
    const current = layoutStore.getState().layout;
    if (Math.abs(width - current.width) <= 0.05 && Math.abs(height - current.height) <= 0.05) return;
    onApplyCreative({ ...current, width, height });
  }, [splatState, onApplyCreative]);

  const onBindProject = useCallback((projectId: string) => {
    actions.applyLayout({ ...layoutStore.getState().layout, id: projectId });
  }, [actions]);

  const onPreviewAi = useCallback((candidate: RoomLayout | null) => {
    setAiPreview(candidate ? { base: liveLayout.current, candidate } : null);
    if (candidate) { setView(current => ({ ...current, view2D: false })); }
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
    lighting: previewCandidate?.backendLighting ?? layout.backendLighting ?? 'warm', width: previewCandidate?.width ?? layout.width, depth: previewCandidate?.height ?? layout.height,
    ceilingHeight: previewCandidate?.floors[0]?.height ?? activeStoreyHeight });

  const captureReview=useReviewCapture({layout,getLayout:()=>layoutStore.getState().layout,view,activeFloorIndex,
    ready:isReady||view.view2D,peopleReady:peopleModelReady,selectedItemId,extraSelectedIds,
    hasCollision:item=>structuralItemCollides(item,layout,activeFloorIndex)||hasCollisions(item,activeFloor.items,layout.width,layout.height,{keepOut,structureValidated:!!layout.backendSceneV2,interiorWalls:layout.backendSceneV2?[]:activeFloor.interiorWalls}),
    ...(referenceImage.layer?{referenceImage:referenceImage.layer}:{}),
    canvas:canvasRef,canvas2D:canvas2DRef,scene:sceneRef,renderer:rendererRef,camera:cameraRef,
    pendingPreview:!!previewCandidate,isInteracting:()=>isDragActive()||!!wallDraft||!!placingId||!!pendingCatalog});
  const reviewContext=JSON.stringify(referenceImage.layer??null);
  const draftLabel = saveError ? '本机保存失败' : isSaving ? '正在保存…' : lastSavedAt ? '已保存到本机' : '本地草稿';
  const draftFoot = saveError ? '未保存' : isSaving ? '保存中' : lastSavedAt ? '已保存' : '草稿';
  const draftTitle = saveError ? '本机保存失败，请导出备份' : draftLabel;
  return (
    <RoomEditorProvider value={roomEditorValue}>
    <SelectionProvider value={selectionValue}>
    <CreativeStudioProvider onUpdateProductionPlan={value=>{commitHistoryNow();actions.setProductionPlan(value);}} reviewContext={reviewContext} controller={controller} layout={layout} onApply={onApplyCreative} prepareRestoreLayout={prepareRestoreLayout} commitRestoredLayout={commitRestoredLayout} onBindProject={onBindProject} onPreview={onPreviewAi} onUpdateItem={(id, patch) => { commitHistoryNow(); actions.updateItem(id, patch); }} onUpdateEventOperations={value => {
      if (!parseLayoutEventOperations({ ...layoutStore.getState().layout, eventOperations: value })) throw new Error('活动安排未保存，请核对任务内容及关联物料是否有重复编号。');
      commitHistoryNow(); actions.setEventOperations(value);
    }}>
      <LayoutAgentProvider handoffExportRequest={handoffExportRequest} onVenueIOChange={io => setOutdoorVenue(io === 'outdoor')} onPreview={onPreviewAi} onApply={onApplyCreative} callbacks={{
        workbenchMode,
        onOpenMaterials: () => { setWorkbenchMode('layout'); setMaterialsOpen(true); setBusinessOpen(false); setSidebarCollapsed(true); },
        onSelectMode: selectWorkbenchMode,
        onOpenReview: () => openBusinessWorkspace('review'),
        onOpenDelivery: () => openBusinessWorkspace('delivery'),
        onFit: fitToRoom,
      }}>
      <div className={`sc-workbench${conversationOpen ? ' has-conversation' : ''}${walkthroughActive ? ' is-walkthrough' : ''}${leftCardResizing ? ' is-left-resizing' : ''}`}>
        <div ref={headerRef} className="sc-header">
          <button ref={conversationEntryRef} type="button" hidden aria-hidden tabIndex={-1} aria-label={conversationOpen ? '关闭助手' : '打开助手'} onClick={()=>{if(conversationOpen)setConversationCloseRequest(value=>value+1);else setConversationOpenRequest(value=>value+1);}}/>
        </div>
        <main data-nav={leftColumnOpen ? 'expanded' : 'collapsed'} className={`sc-workspace is-docked-layout is-mode-rail${leftColumnOpen ? ' has-left-column' : ''}${agentCollapsed?' is-agent-collapsed':''}${bingoPanelOpen?' has-bingo-panel':''}${conversationOpen?' has-conversation':''}${materialsOpen?' has-material-shelf':''}`} style={{ ['--sc-left-card-width' as string]: `${leftCardWidth}px` }}>
          <button ref={reviewEntryRef} type="button" hidden aria-hidden tabIndex={-1}/>
          <button ref={deliveryEntryRef} type="button" hidden aria-hidden tabIndex={-1}/>
          <div className="sc-mode-rail">
            <div className="sc-rail-head">
              <WorkbenchBrandToggle expanded={leftColumnOpen} onToggle={toggleNav} />
              <nav className="sc-mode-rail-top" aria-label="工作台导航">
                <QingguangRailButton open={!agentCollapsed && !bingoPanelOpen} onOpen={toggleQingguang} />
                <BingoRailButton open={bingoPanelOpen} onToggle={toggleBingoPanel} />
                <VenueRailButton open={venueLibraryOpen} lit={venueLibrary.lit} onToggle={toggleVenueLibrary} />
              </nav>
            </div>
            <div className="sc-mode-rail-foot">
              <button ref={workspaceEntryRef} type="button" className="sc-rail-settings" aria-label="设置" data-tip="设置" title="设置" onClick={() => setAccountOpenRequest(current => ({ serial: current.serial + 1, section: 'team' }))}><Settings size={22} aria-hidden="true"/></button>
              <CloudPanel controller={controller} layout={layout} publicationRequest={publicationOpenRequest} openRequest={accountOpenRequest} draftNote={{ label: draftLabel, error: !!saveError, ...(draftTitle ? { title: draftTitle } : {}) }} onLoadLayout={onLoadLayout} onApplyLayout={onApplyCreative} onClose={()=>{if(conversationOpen&&window.innerWidth<=680)headerRef.current?.parentElement?.querySelector<HTMLButtonElement>('.cr-chat-header-actions button')?.focus();}}/>
            </div>
          </div>
          <div id="workbench-nav-column" className={`sc-left-column${sidebarCollapsed ? '' : ' has-tool'}`}>
          <div id="workbench-left-panel" className={`sc-left-drawer sc-float-layer ${sidebarCollapsed ? 'is-collapsed' : ''}${leftMode==='brief'?' has-brief':''}${leftMode==='business'?' has-business':''}${leftMode==='properties'?' has-properties':''}`}>
            <div className="sc-left-heading"><nav className="sc-left-context" aria-label="当前工具内容">
              {selectedItem&&<button type="button" aria-pressed={leftMode==='properties'} onClick={()=>{setLeftMode('properties');setMaterialsOpen(false);setSidebarCollapsed(false);}}>选中物料</button>}
              {luxDirectVisible&&(leftMode==='lux3d'||aholoReconPreset)&&<button type="button" aria-pressed={leftMode==='lux3d'} onClick={()=>{setLeftMode('lux3d');setMaterialsOpen(false);setBusinessOpen(false);setSidebarCollapsed(false);}}>场地观感</button>}
            </nav><button type="button" className="sc-left-close sc-icon-button" aria-label="收起左侧面板" onClick={closeLeftPanel}><PanelLeftClose size={20}/></button></div>
            <div className="sc-left-content sc-mode-card-host" hidden/>
          </div>
          {bingoPanelOpen && <BingoReviewPanel onClose={() => setBingoPanelOpen(false)} />}
          {!agentCollapsed && !bingoPanelOpen && <AgentPanel onClose={()=>setAgentCollapsed(true)} generateOpen={composerGenerate} onGenerateOpen={setComposerGenerate} onOpenDrawings={() => businessToolsRef.current?.openReference()} onOpenFrame={() => businessToolsRef.current?.openRebuild()} onPlaceProp={item => { const id = placeFromCatalog(item); if (id) selectOnly(id, { keepPanel: true }); return !!id; }} onOpenPropFallback={() => { setLeftMode('lux3d'); setMaterialsOpen(false); setBusinessOpen(false); setSidebarCollapsed(true); setAgentCollapsed(false); }} onOpenPropCloud={() => businessToolsRef.current?.openModelTools()} reviewSlot={workbenchMode === 'review' ? <ReviewIssuesCard
              pins={reviewPins}
              items={activeFloor.items}
              filter={pinFilter}
              activeId={activePinId}
              onFilter={setPinFilter}
              onFocus={focusReviewPin}
              onResolve={id => setReviewPins(pins => markPinResolved(pins, id))}
              onReturn={returnReviewPin}
              onConfirm={confirmReview}
            /> : undefined} deliverySlot={workbenchMode === 'delivery' ? <WorkbenchModeCard
              pins={reviewPins}
              pinFilter={pinFilter}
              activePinId={activePinId}
              reviewCleared={reviewCleared}
              onPinFilter={setPinFilter}
              onFocusPin={focusReviewPin}
              onResolvePin={id => setReviewPins(pins => markPinResolved(pins, id))}
              onReturnPin={returnReviewPin}
              onConfirmDelivery={confirmReview}
              onExport={() => { setAgentCollapsed(false); }}
            /> : undefined}/>}
          <LeftCardResizer width={leftCardWidth} onWidth={rememberLeftCardWidth} onDragging={setLeftCardResizing} />
          </div>
          <div className={`sc-canvas-stage has-bottom-drawer ${selectedItem ? 'has-selection' : ''}${materialsOpen ? ' has-material-shelf' : ''}${planHome ? ' is-plan-home' : ''}${workbenchMode === 'review' ? ' is-review' : ''}`} onPointerEnter={() => { if (previewCandidate) setCaptionEpoch(value => value + 1); }} onPointerDownCapture={event => {
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
        showMeasurements={view.showMeasurements}
        showMinimap={view.showMinimap}
        walkthroughActive={walkthroughActive}
        walkthroughLockRefused={walkthroughLockRefused}
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
            const newId = placeDiscrete(item, world);
            if (newId) selectOnly(newId, { keepPanel: true });
          } catch (error) { notify(error instanceof Error ? error.message : '模型加载失败，请重试。', 'error'); }
          finally { placement.dispose(); }
        }}
      />
            <AgentCanvasOverlay/>
            <ReviewPinLayer
              pins={reviewMarks}
              activeId={activePinId}
              draft={pinDraft}
              draftLabel={pinDraft ? (pinDraft.itemId ? `钉在「${pinSubject(pinDraft.itemId, activeFloor.items)}」` : '钉在地面') : ''}
              toScreen={toScreen}
              controlsRef={controlsRef}
              cameraReady={isReady}
              onFocus={focusReviewPin}
              onCommit={commitReviewPin}
              onCancel={() => setPinDraft(null)}
            />
            <MapVenueOverlay onHangDemoEnvironment={hangDemoEnvironment} onReconUpload={luxDirectVisible ? preset => {
              setAholoReconPreset(preset);
              setLeftMode('lux3d'); setMaterialsOpen(false); setBusinessOpen(false); setSidebarCollapsed(true); setAgentCollapsed(false);
            } : undefined}/>
            {checklistOpen && <aside className="sc-checklist-drawer" role="dialog" aria-label="到场清单">
              <button type="button" className="sc-checklist-dismiss" onClick={() => setChecklistOpen(false)}>关闭</button>
              <DeliveryChecklistShell items={activeFloor.items} onExport={exportHandoff}/>
            </aside>}
            {workbenchMode === 'review' && !pinDraft && <p className="sc-review-hint" role="status">点物件或地面，钉一条意见</p>}
            <div ref={businessHostRef} className="sc-canvas-share sc-data-host" hidden={!businessOpen || leftMode !== 'business'}/>
            {leftMode === 'properties' && selectedItem && <div className="sc-canvas-share">
              <ItemContextPopover embedded
                hasCollision={structuralItemCollides(selectedItem, layout, activeFloorIndex) || hasCollisions(selectedItem, activeFloor.items, layout.width, layout.height, { keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls: layout.backendSceneV2 ? [] : activeFloor.interiorWalls })}
                onRotate={id => { if (rotateItemHandler(id)) playCue('rotate'); }} onToggleCameraBracket={toggleCameraBracket} onDuplicate={duplicateSelected} onRemove={removeItem} onClose={() => { selectOnly(null); setLeftMode('brief'); }}/>
            </div>}
            {luxDirectVisible && leftMode === 'lux3d' && <div className="sc-canvas-share">
              <div className="sc-canvas-share-bar"><strong>场地观感</strong><button type="button" aria-label="收起观感" onClick={() => setLeftMode('brief')}>收起</button></div>
              <Lux3dDirectTest reconPreset={aholoReconPreset} onHangMockScene={hangDemoEnvironment} onPreviewShippedScene={startStoredScene} onOpenCloudModels={() => businessToolsRef.current?.openModelTools()} onPlace={item => { const id = placeFromCatalog(item); if (id) selectOnly(id, { keepPanel: true }); return !!id; }} onPreviewScene={openScenePreview}/>
            </div>}
            {venueLibraryOpen && <VenueLibraryPanel onClose={() => setVenueLibraryOpen(false)} />}
            <PlanFlow onOpenAgent={toggleQingguang} onHomeChange={setPlanHome}/>
            {previewCandidate && <div className={`sc-preview-caption${previewCaptionVisible ? '' : ' is-faded'}`} role="status" aria-hidden={!previewCaptionVisible}>AI 修改预览 · 尚未加入场景{view.view2D ? ' · 切回整体视角查看' : ' · 半透明为候选，线框为原位置'}</div>}
            {splatState.status === 'ready' && <div className="sc-local-conflict" role="status"><span>环境预览：{splatState.name} · {splatState.meters ? `已按高斯实测 ${splatState.meters.width} × ${splatState.meters.depth} m 校准场地，` : '场地壳体已让位，'}物料照常摆</span><button type="button" onClick={stopSplat}>退出预览</button></div>}
            {pendingCatalog && <div className="sc-local-conflict" role="status"><span>待放置：{pendingCatalog.name} · 点击场地选择有效位置</span><button type="button" onClick={()=>setPendingCatalog(null)}>取消放置</button></div>}
            {remoteLayout && <div className="sc-local-conflict"><span>另一标签页更新了本地副本</span><button type="button" onClick={adoptRemoteLayout}>采用更新</button><button type="button" onClick={clearRemoteLayout}>保留当前</button></div>}
            <PlacementHint active={placingId !== null}/>
            <StatusToastHost/>
          </div>
            <div className="sc-editor-dock">
            <ScendanceViewTools layoutLocked={workbenchMode !== 'layout'} showAtmosphere={false} shareOpenRequest={shareOpenRequest} shareActions={{ onIssueReviewLink: issueReviewLink, onExportHandoff: exportHandoff, onOpenMaterials: openMaterialsFromShare, onOpenChecklist: () => setChecklistOpen(true) }} onExportImage={handleExportImage} onApplyPreset={applyPreset} onLighting={value=>{ if (workbenchMode !== 'layout') return; commitHistoryNow();actions.applyLayout({...layoutStore.getState().layout,backendLighting:value});setView(current=>({...current,view2D:false}));}} onFit={fitToRoom} onZoom={direction => {
              const camera = cameraRef.current;
              const controls = controlsRef.current;
              if (!camera || !controls) return;
              zoomCamera(camera, controls, direction);
              invalidate();
            }}/>
            <div ref={assistantEntryHostRef} className="sc-assistant-entry-host" hidden aria-hidden="true"/>
            <div id="workbench-material-shelf" className="sc-material-shelf sc-bottom-drawer" hidden={!materialsOpen} onWheel={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();closeMaterialsShelf();}}}>
              {materialsOpen && <ScendanceLibrary openTabRequest={materialTabRequest} onClose={closeMaterialsShelf} capturePlacement={capturePlacement} onLoadPreset={onApplyCreative} controller={controller} placeCatalogItem={placeFromCatalog}
                environment={{ preview: splatState, onStart: startStoredScene, onStop: stopSplat }}/>}
            </div>
            {/* 物料条挂在画布栏底。晴光只从窄轨头像打开，画布上不再留第二颗球。 */}
            {!planHome && <div className="sc-bottom-bar">
              <div className="sc-bottom-bar-center">
                <MaterialDrawerHandle open={materialsOpen} onToggle={toggleMaterialsShelf} buttonRef={toolsEntryRef}/>
              </div>
            </div>}
            </div>
          </div>
          <CreativeAssistant docked autoOpen={false} suppressAgentLauncher hideCategorySelect toolsApiRef={businessToolsRef} workbenchMode={workbenchMode} workbenchModeSerial={workbenchModeSerial} deliveryOpenRequest={deliveryOpenRequest} backupOpenRequest={backupOpenRequest} deliveryEntryRef={deliveryEntryRef} reviewOpenRequest={reviewOpenRequest} reviewEntryRef={reviewEntryRef} assistantEntryHostRef={assistantEntryHostRef} commercialPanel={<CommercialWorkspace controller={controller} layout={layout} isActive={isActive} ensurePersistentIdentity={ensurePersistentIdentity}/>} activityTaskPanel={context=><ActivityTaskWorkspace {...context} controller={controller} isActive={isActive} ensurePersistentIdentity={ensurePersistentIdentity} persistVerifiedLayout={persistVerifiedLayout} onCommitOperations={operations=>{if(!isActive||!isLocalActivityWorkspace(controller))throw new Error('当前活动已变化，未写入任务。');commitHistoryNow();actions.setEventOperations(operations);}}/>} referenceImagePanel={<ReferenceImageControls layout={layout} view={view} ready={referenceImage.ready} notice={referenceImage.notice} onShow={value => setView(current => ({ ...current, showReferenceImage: value }))} onOpacity={value => setView(current => ({ ...current, referenceImageOpacity: value }))} onReview={() => { setLeftMode('business'); setBusinessOpen(true); setSidebarCollapsed(true); setAgentCollapsed(false); setReferenceOpenRequest(value => value + 1); }} onReload={referenceImage.reload} reviewButtonRef={referenceEntryRef}/>} onOpenTemplates={openTemplates} localSaveError={!!saveError} captureReview={captureReview} onOpenPublication={()=>setPublicationOpenRequest(value=>value+1)} businessHostRef={businessHostRef} conversationOpenRequest={conversationOpenRequest} conversationEntryRef={conversationEntryRef} conversationCloseRequest={conversationCloseRequest} onConversationVisibilityChange={handleConversationVisibility} onWorkspaceVisibilityChange={handleWorkspaceVisibility} workspaceEntryRef={workspaceEntryRef} referenceOpenRequest={referenceOpenRequest} referenceEntryRef={referenceEntryRef} generationPanel={context=><GeneratedModelLibrary {...context} controller={controller} disabled={materialCount(activeFloor.items)>=editorItemLimit(layout)} onAdd={item=>{const id=placeFromCatalog(item);if(id)selectOnly(id,{ keepPanel: true });}}/>}/>
        </main>
      </div>
      </LayoutAgentProvider>
    </CreativeStudioProvider>
    </SelectionProvider>
    </RoomEditorProvider>
  );
}

export default RoomOrganizer;
