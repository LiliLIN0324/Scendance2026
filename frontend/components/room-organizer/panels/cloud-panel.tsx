'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AssetsPanel } from '@/components/business/assets-panel';
import { AuthCard } from '@/components/intro/auth-card';
import { DoorOpen, FolderOpen, Images, MoreHorizontal, RefreshCw, Settings, UserRound, UsersRound, X } from '@/components/solid-icons';
import { safeReturnPath } from '@/lib/auth-provider';
import {sameRecoveryFormValue} from '@/lib/recovery-form-value';
import { createBackendSession, useBackendSession, type BackendSession, type ProjectSummary, type Studio } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { copySourceScope, flushSourceScope } from '@/lib/source-storage';
import { consumeSelfAttachedProject, preferredStudio, rememberStudio } from '@/lib/workspace-api';
import type { Scene } from '../../../../supabase/functions/_shared/domain';
import {projectUnverifiedScene} from '../../../../supabase/functions/_shared/scene-text-projection';
import { assetCloudLabel, cloudAssetIdMap, prepareLayoutAssetsForCloud, useAssetCloudRecords } from '../lib/asset-cloud';
import { assertCloudZoneSupport, backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { notify } from '../lib/editor-notices';
import { assertNoLocalHandoffCloudTransition, assertNoLocalRecordsCloudTransition, hasLocalHandoff, LOCAL_HANDOFF_CLOUD_MESSAGE } from '../lib/handoff-cloud-guard';
import { ensureGlbAsset } from '../three/glb-assets';
import { AccountTeamPanel } from './account-team-panel';
import { AVATAR_PRESETS, avatarForSeed, loadAvatar, saveAvatar, type AvatarPreset } from './account-avatars';
import { InfoTip } from './info-tip';
import { SceneThumb } from './scene-thumb';
import {OriginalSceneReviewPanel,type OriginalMoveConfirmation} from './original-scene-review-panel';
import type {LocalWriteCapability} from '@/lib/local-write-lease';
import type {ActivitySessionToken} from '../lib/activity-session-epoch';
import type { DisplayUnit, RoomLayout } from '../lib/types';
import { formatLength } from '../lib/display-units';

interface Props { controller?: BackendSession; layout: RoomLayout; sessionToken?: ActivitySessionToken|null|undefined; isSessionCurrent?: ((token:ActivitySessionToken|null|undefined)=>boolean)|undefined; localWriteCapability?:LocalWriteCapability|undefined; onBeforeActivitySwitch?:((expected?:RoomLayout)=>()=>void)|undefined; getCurrentLayout?:(()=>RoomLayout)|undefined; onLoadLayout(layout: RoomLayout): void; onApplyLayout?(layout: RoomLayout): void; onClose?(): void; openRequest?: { serial: number; section: string }; triggerRef?: RefObject<HTMLButtonElement>; draftNote?: { label: string; error?: boolean; title?: string }; preferences?: { lengthUnit: DisplayUnit; showMeasurements: boolean }; onPreferenceChange?: (patch: { lengthUnit?: DisplayUnit; showMeasurements?: boolean }) => void }

/** 点在对话框边框外（背后遮罩）才关。面板里的点击、按钮都不关。 */
export function closeDialogOnBackdrop(event: MouseEvent<HTMLDialogElement>): void {
  const box = event.currentTarget.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) event.currentTarget.close();
}

type AccountSection = 'projects' | 'assets' | 'team' | 'settings';

const PREVIEW_LIMIT = 12;
const ORIGINAL_SCENE_SUBMISSION_ENABLED:boolean=false;

function studioRoleLabel(role: string | undefined): string {
  if (role === 'owner') return '负责人';
  if (role === 'editor') return '编辑';
  if (role === 'viewer') return '只读';
  return '成员';
}

/** 项目卡把最近改动说成人话；缺字段时明确说未记录，不假装有数据。 */
function updatedLabel(value: string | undefined): string {
  if (!value) return '未记录更新时间';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '未记录更新时间';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return '刚刚更新';
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} 天前更新`;
  return `${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)} 更新`;
}

export function CloudPanel({ layout, sessionToken, isSessionCurrent, localWriteCapability, onBeforeActivitySwitch, getCurrentLayout, onLoadLayout, controller: providedController, onApplyLayout, onClose, openRequest, triggerRef, draftNote, preferences: preferencesProp, onPreferenceChange: onPreferenceChangeProp }: Props): JSX.Element {
  const [fallbackController] = useState(() => providedController ?? createBackendSession());
  const controller = providedController ?? fallbackController;
  const preferences = preferencesProp ?? { lengthUnit: 'm' as DisplayUnit, showMeasurements: true };
  const onPreferenceChange = onPreferenceChangeProp ?? (() => undefined);
  const cloud = useBackendSession(controller);
  const requestedProjectId = useSearchParams()?.get('project');
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [studioId, setStudioId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [boundLayout, setBoundLayout] = useState<string | undefined>();
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [recordsBlockedScope, setRecordsBlockedScope] = useState<string | undefined>();
  const lastObserved = useRef('');
  const openRequested = useRef<(id: string) => Promise<void>>(async () => {});
  const openedRequest = useRef('');
  const actionPending = useRef(false);
  const projectedCreation=useRef<{base:RoomLayout;projectId:string}|null>(null);
  const [section, setSection] = useState<AccountSection>('projects');
  // 成员页要取云端团队数据：第一次点开才挂载，之后一直留着，避免反复打列表。
  const [teamMounted, setTeamMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [avatar, setAvatar] = useState<AvatarPreset>(() => avatarForSeed('guest'));
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  // 卡片三维缩略：仅在账户面板打开时拉 scene，失败记 'failed'，不挡打开。
  const [scenePreviews, setScenePreviews] = useState<Record<string, Scene | 'failed'>>({});
  const [readOnlyProjects,setReadOnlyProjects]=useState<Record<string,boolean>>({});
  const [originalReview,setOriginalReview]=useState<{projectId:string;userId:string;activeProjectId:string|null;token:ActivitySessionToken;authority:()=>boolean}|null>(null);
  const originalReviewRef=useRef(originalReview);originalReviewRef.current=originalReview;
  const originalReviewCurrent=useCallback(()=>{
    if(!originalReview||originalReviewRef.current!==originalReview||!isSessionCurrent)return false;
    const current=controller.getSnapshot();
    return !!dialog.current?.open&&!!current.user&&current.user.id===originalReview.userId&&(current.project?.id??null)===originalReview.activeProjectId&&originalReview.authority()&&isSessionCurrent(originalReview.token);
  },[controller,isSessionCurrent,originalReview]);
  const loadOriginal=useCallback(async()=>{if(!originalReview||!originalReviewCurrent())throw new Error('活动或账户已变化');return controller.readOriginalScene(originalReview.projectId);},[controller,originalReview,originalReviewCurrent]);
  const originalConfirmPending=useRef(false);
  const confirmOriginal=useCallback(async(snapshot:OriginalMoveConfirmation,isCandidateCurrent:()=>boolean):Promise<'committed'|'unknown'|'blocked'>=>{
    if(!ORIGINAL_SCENE_SUBMISSION_ENABLED||!localWriteCapability||!originalReview||!originalReviewCurrent()||!isCandidateCurrent()||originalConfirmPending.current)return 'blocked';
    const target=originalReview;originalConfirmPending.current=true;
    try{
      const stillCurrent=()=>originalReviewRef.current===target&&originalReviewCurrent()&&isCandidateCurrent();
      const lease=await controller.beginOriginalReview(target.projectId,{revision:snapshot.revision,originalSceneHash:snapshot.baseHash});
      if(!stillCurrent())return 'blocked';
      const review=await controller.prepareOriginalReview(target.projectId,lease,JSON.parse(snapshot.candidateText),crypto.randomUUID());
      if(!stillCurrent()||review.baseHash!==snapshot.baseHash||review.candidateHash!==snapshot.candidateHash||!sameRecoveryFormValue(review.changes,snapshot.changes))return 'blocked';
      return await controller.commitAuthorizedOriginalReview({version:1,projectId:target.projectId,reviewId:review.id,baseHash:review.baseHash,candidateHash:review.candidateHash,baseRevision:review.baseRevision},lease,localWriteCapability,stillCurrent);
    }catch{return 'blocked';}finally{originalConfirmPending.current=false;}
  },[controller,localWriteCapability,originalReview,originalReviewCurrent]);
  const previewRequested = useRef(new Set<string>());
  const [accountOpen, setAccountOpen] = useState(false);
  const autosavePending = useRef(false);
  // 上传状态变化要触发重算 fingerprint；本机资产换到云端号后，草稿才算真正可保存。
  useAssetCloudRecords();

  let fingerprint: string | null = null;
  let conversionError = '';
  try { fingerprint = JSON.stringify(layoutToBackendScene(layout, { assetIdMap: cloudAssetIdMap() })); }
  catch (error) { conversionError = error instanceof Error ? error.message : '当前场景暂不能保存到云端。'; }
  const localHandoff = hasLocalHandoff(layout);
  const localWorkspace = isLocalActivityWorkspace(controller);
  const sceneConnection = !!cloud.geometryBinding && localWorkspace;
  const bound = !sceneConnection && !!cloud.project && layout.id === cloud.project.id && (boundLayout === layout.id ||
    (!cloud.writeBlocked && cloud.lease?.projectId === layout.id && cloud.lease.sessionId === cloud.sessionId && Date.parse(cloud.lease.expiresAt) > Date.now()));
  const dirty = localHandoff || !!layout.id && recordsBlockedScope === layout.id || (bound ? cloud.dirty : fingerprint !== savedFingerprint);

  const userId = cloud.user?.id;
  useEffect(() => { setAvatar(loadAvatar(userId)); setAvatarPickerOpen(false); }, [userId]);
  const studioProjects = useMemo(
    () => projects.filter(project => project.studio_id === studioId && (!sceneConnection || project.id !== cloud.project?.id)),
    [projects, studioId, sceneConnection, cloud.project?.id],
  );
  useEffect(() => {
    if (!cloud.project || !projectsLoaded || sceneConnection) return;
    const { id, name, studio_id, revision } = cloud.project;
    // 列表接口偶发漏掉当前打开项时仍补进卡片墙，编辑权按钮才能挂在「当前」卡上。
    setProjects(current => current.some(project => project.id === id) ? current : [...current, { id, name, studio_id, revision }]);
  }, [sceneConnection, cloud.project, projectsLoaded]);
  useEffect(() => {
    setScenePreviews({});
    setReadOnlyProjects({});originalReviewRef.current=null;setOriginalReview(null);
    previewRequested.current = new Set();
  }, [studioId]);
  useEffect(() => controller.retain(), [controller]);
  useEffect(() => {
    if (!userId || busy) return;
    const id = requestedProjectId;
    if (!id || openedRequest.current === `${userId}:${id}`) return;
    // 无感挂云自己同步的 ?project=：项目刚建好、画布已是内容本体，重开会清掉撤销历史，凭标记跳过。
    if (consumeSelfAttachedProject(userId, id)) { openedRequest.current = `${userId}:${id}`; return; }
    if (!cloud.writeBlocked && cloud.project?.id !== id) {
      // 深链冲突只提示，不自动弹出账户面板——每次刷新都抢焦点很烦。
      softProjectNotice('请先释放当前项目的编辑权，再打开链接中的项目。');
      return;
    }
    const timer = window.setTimeout(() => {
      openedRequest.current = `${userId}:${id}`;
      void openRequested.current(id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId, requestedProjectId, busy, cloud.writeBlocked, cloud.project?.id]);
  useEffect(() => { if (section === 'team') setTeamMounted(true); }, [section]);

  // /auth 已改成「进工作台 + 自动弹登录浮窗」；标记只在 ?login=1 时置位。
  const loginRequested = useRef(false);
  useEffect(() => {
    setProjects([]); setStudios([]); setStudioId(''); setQuery(''); setProjectsLoaded(false); setSection('projects'); setTeamMounted(false);
    setScenePreviews({});setReadOnlyProjects({});originalReviewRef.current=null;setOriginalReview(null); previewRequested.current = new Set();
    if (!userId) {
      openedRequest.current = ''; setNotice(''); setLoadingProjects(false);
      // 会话从「未恢复」变成「匿名」也会走这里；?login=1 要求开着登录浮窗，别把它关掉。
      if (!loginRequested.current) { setAccountOpen(false); dialog.current?.close(); }
      return;
    }
    let cancelled = false;
    setLoadingProjects(true);
    void Promise.all([controller.listProjects(), controller.listStudios()]).then(([nextProjects, nextStudios]) => {
      if (cancelled) return;
      setProjects(nextProjects); setStudios(nextStudios); setStudioId(preferredStudio(userId, nextStudios, controller.getSnapshot().project?.studio_id)); setProjectsLoaded(true);
    }).catch(() => { if (!cancelled) setNotice('项目加载失败，请点击刷新重试。'); }).finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [controller, userId]);
  // 左轨成员位、分区直达都用 openRequest 指定落在哪一格（projects / assets / team）。
  const openedOpenRequest = useRef(0);
  useEffect(() => {
    if (!openRequest || openRequest.serial <= 0 || openedOpenRequest.current === openRequest.serial) return;
    openedOpenRequest.current = openRequest.serial;
    setSection(openRequest.section as AccountSection);
    if (!dialog.current?.open) { setAccountOpen(true); dialog.current?.showModal(); }
  }, [openRequest]);
  useEffect(() => {
    if (!localHandoff && fingerprint && fingerprint !== lastObserved.current) {
      lastObserved.current = fingerprint;
      if (JSON.stringify(controller.getSnapshot().draft) !== fingerprint) controller.setDraft(JSON.parse(fingerprint));
    }
  }, [controller, fingerprint, localHandoff]);

  async function run(action: () => Promise<void>): Promise<void> {
    if (actionPending.current) return;
    actionPending.current = true; setBusy(true); setNotice('');
    try { await action(); }
    catch (error) {
      const code=error instanceof Error&&'code' in error?error.code:undefined;
      setNotice(code==='ORIGINAL_SCENE_REVIEW_REQUIRED'?'此项目含未核验原始记录，目前仅可只读核对；本机草稿未替换。':error instanceof Error ? error.message : controller.getSnapshot().error?.message ?? '操作失败，请重试。');
    } finally { actionPending.current = false; setBusy(false); }
  }
  // 一次性：/auth 跳过来时把浮窗打开，后续交给账户中心自己管开关。
  useEffect(() => {
    if (loginRequested.current) return;
    if (new URLSearchParams(window.location.search).get('login') !== '1') return;
    loginRequested.current = true;
    setSection('projects');
    setAccountOpen(true);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  /** 登录成功后浮窗就地变账户中心；带 ?next 才跳转，否则只清掉 login 标记。 */
  function handleAuthenticated(): void {
    loginRequested.current = false;
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (next) { router.replace(safeReturnPath(next)); return; }
    if (params.get('login') === '1') {
      params.delete('login');
      const search = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
    }
    setNotice('已登录。');
  }
  async function refreshProjects(): Promise<void> {
    const [nextProjects, nextStudios] = await Promise.all([controller.listProjects(), controller.listStudios()]);
    setProjects(nextProjects); setStudios(nextStudios); setProjectsLoaded(true);
    setStudioId(current => nextStudios.some(studio => studio.id === current) ? current : nextStudios[0]?.id ?? '');
  }
  async function assertCloudTransition(value: RoomLayout): Promise<void> {
    try {
      assertCloudZoneSupport(value);
      await assertNoLocalRecordsCloudTransition(value);
      assertCloudZoneSupport(value);
      setRecordsBlockedScope(current => current === value.id ? undefined : current);
    } catch(error) {
      if (value.id && value.id === layoutRef.current.id) setRecordsBlockedScope(value.id);
      throw error;
    }
  }
  async function flushBeforeReplacement(openingFrom: RoomLayout): Promise<()=>void> {
    assertCloudZoneSupport(openingFrom);assertNoLocalHandoffCloudTransition(openingFrom);
    const check=onBeforeActivitySwitch?.(openingFrom)??(()=>{if(layoutRef.current!==openingFrom)throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');});
    check();
    await assertCloudTransition(openingFrom);
    check();
    await flushSourceScope(openingFrom.id ?? 'local');
    check();
    await assertCloudTransition(layoutRef.current);
    check();
    if(layoutRef.current!==openingFrom)throw new Error('保存资料期间场景有新改动，原草稿已保留，请重新打开。');
    return check;
  }
  function suspendFailedReplacement(projectId:string):void {
    if(controller.getSnapshot().project?.id!==projectId)return;
    setBoundLayout(undefined);controller.suspendForCanvasProjectMismatch(projectId);
  }
  async function acceptScene(scene: unknown, projectId: string, name: string, openingFrom: RoomLayout,checkSwitch?:()=>void): Promise<void> {
   try {
    await assertCloudTransition(openingFrom);
    checkSwitch?.();
    await assertCloudTransition(layoutRef.current);
    checkSwitch?.();
    // Include the initial project/lease request in the guard, not only GLB loading.
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    const candidate = backendSceneToLayout(scene, { projectId, name });
    await assertCloudTransition(candidate);
    checkSwitch?.();
    await assertCloudTransition(layoutRef.current);
    checkSwitch?.();
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    const assets = await controller.authorizeAssets(layoutToBackendScene(candidate));
    checkSwitch?.();
    await assertCloudTransition(candidate);
    await assertCloudTransition(openingFrom);
    await assertCloudTransition(layoutRef.current);
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    await Promise.all(Object.entries(assets.assetUrls).map(([assetId, url]) => ensureGlbAsset(assetId, url)));
    checkSwitch?.();
    await assertCloudTransition(candidate);
    await assertCloudTransition(openingFrom);
    await assertCloudTransition(layoutRef.current);
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    const next = backendSceneToLayout(scene, { projectId, name, ...assets });
    if (openingFrom.id === projectId) {
      if (openingFrom.designBook) next.designBook = openingFrom.designBook;
      if (openingFrom.itemLayers) {
        const ids = new Set(next.floors.flatMap(floor => floor.items.map(item => item.id)));
        next.itemLayers = openingFrom.itemLayers.map(layer => ({ ...layer, itemIds: layer.itemIds.filter(id => ids.has(id)) }));
      }
    }
    checkSwitch?.();
    onLoadLayout(next);
    if(getCurrentLayout){
      const applied=getCurrentLayout();
      if(applied.id!==projectId||!sameRecoveryFormValue(layoutToBackendScene(applied),layoutToBackendScene(next)))throw new Error('画布应用结果无法核对。');
      controller.acknowledgeCanvasProjectMatch(projectId);
    }
    setBoundLayout(next.id);
    setSavedFingerprint(JSON.stringify(layoutToBackendScene(next)));
    lastObserved.current = JSON.stringify(layoutToBackendScene(next));
    syncProjectUrl(projectId);
   }catch(error){
    if(controller.getSnapshot().project?.id===projectId){
      suspendFailedReplacement(projectId);
    }
    throw error;
   }
  }
  function syncProjectUrl(projectId: string): void {
    openedRequest.current = `${userId}:${projectId}`;
    const url = new URL(window.location.href);
    url.searchParams.set('project', projectId);
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  /** 深链 / 后台加载：画布轻提示，不自动弹出账户面板。手动点头像仍进项目页。 */
  function softProjectNotice(message: string, tone: 'info' | 'error' = 'info'): void {
    setSection('projects');
    setNotice(message);
    notify(message, tone);
  }
  openRequested.current = id => run(async () => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      softProjectNotice('项目链接无效。', 'error'); throw new Error('项目链接无效。');
    }
    const openingFrom = layoutRef.current;
    try {
      const current = controller.getSnapshot();
      if (openingFrom.id && openingFrom.id !== id && current.dirty && !confirmReplace()) return;
      const checkSwitch=await flushBeforeReplacement(openingFrom);
      const project = current.project?.id === id && !current.writeBlocked ? current.project :
        await controller.getProject(id, incoming => { assertCloudZoneSupport(layoutRef.current); assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(incoming.scene, { projectId: incoming.id, name: incoming.name }); });
      checkSwitch();
      await assertCloudTransition(openingFrom);
      await assertCloudTransition(layoutRef.current);
      if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
      const localScene = openingFrom.id === id ? layoutToBackendScene(openingFrom) : null;
      if (localScene && JSON.stringify(localScene) !== JSON.stringify(project.scene)) {
        controller.setDraft(localScene);
        // Restored private GLB URLs may have expired while the tab was closed.
        // Refresh the UUID-keyed cache without replacing the draft or its history.
        await assertCloudTransition(backendSceneToLayout(project.scene, { projectId: project.id, name: project.name }));
        await assertCloudTransition(layoutRef.current);
        if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
        const assets = await controller.authorizeAssets(localScene);
        await assertCloudTransition(openingFrom);
        await assertCloudTransition(layoutRef.current);
        if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
        await Promise.all(Object.entries(assets.assetUrls).map(([assetId, url]) => ensureGlbAsset(assetId, url)));
        await assertCloudTransition(openingFrom);
        await assertCloudTransition(layoutRef.current);
        if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
        setBoundLayout(id); setSavedFingerprint(JSON.stringify(project.scene));
        syncProjectUrl(id);
        softProjectNotice('已保留这个项目的本地未保存改动。请核对云端版本后继续保存或获取编辑权。');
        return;
      }
      await acceptScene(project.scene, project.id, project.name, openingFrom,checkSwitch);
      setNotice('已打开项目。获取编辑权后可以保存修改。');
    } catch (error) {
      if(controller.getSnapshot().project?.id===id&&layoutRef.current.id!==id){
        suspendFailedReplacement(id);
      }
      softProjectNotice(error instanceof Error ? error.message : '打开项目失败，请重试。', 'error');throw error;
    }
  });
  function confirmReplace(): boolean {
    return !dirty || window.confirm('打开云端版本会替换当前画布。当前草稿将保留为本地恢复点。继续吗？');
  }
  async function saveBoundSceneQuiet(): Promise<void> {
    const currentLayout = layoutRef.current;
    await assertCloudTransition(currentLayout);
    assertNoLocalHandoffCloudTransition(layoutRef.current);
    if (layoutRef.current !== currentLayout) throw new Error('保存前画布有新改动，当前草稿已保留。请稍后再试。');
    // 先让本机生成的 GLB 上云并拿到 asset_id，再把本机号换成云端号；失败就停下来报状态，不只报「不能做什么」。
    const prepared = await prepareLayoutAssetsForCloud(currentLayout, (file, meta, onProgress) => controller.uploadLocalAsset(file, meta, onProgress));
    if (prepared.failures.length) {
      const names = prepared.failures.map(failure => `“${failure.name}”（${assetCloudLabel(failure.state)}）`).join('、');
      throw new Error(`本机模型还没上传成功：${names}。${prepared.failures[0]?.message ?? ''} 本机副本保留着，下次保存会继续重试。`);
    }
    const scene = layoutToBackendScene(currentLayout, { assetIdMap: prepared.assetIdMap, localAssetIds: prepared.localAssetIds });
    const submitted = JSON.stringify(scene);
    const saved = await controller.saveScene(scene);
    await assertCloudTransition(currentLayout);
    await assertCloudTransition(layoutRef.current);
    setSavedFingerprint(submitted);
    if (saved.warnings.length) setNotice('已自动保存，请留意场地重叠提示。');
  }
  // 持有编辑权时云端自动保存，卡片上不再放「保存」。
  useEffect(() => {
    if (!accountOpen && !bound) return undefined;
    if (!bound || cloud.writeBlocked || sceneConnection || !dirty || !!conversionError || localHandoff || busy) return undefined;
    if (autosavePending.current) return undefined;
    const timer = window.setTimeout(() => {
      autosavePending.current = true;
      void saveBoundSceneQuiet()
        .catch((error: unknown) => { setNotice(error instanceof Error ? error.message : '自动保存失败，请重试。'); })
        .finally(() => { autosavePending.current = false; });
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on dirty fingerprint only
  }, [bound, cloud.writeBlocked, sceneConnection, dirty, fingerprint, conversionError, localHandoff, busy, accountOpen]);
  async function acquireCurrentEdit(openingFrom: RoomLayout): Promise<void> {
    const active = controller.getSnapshot().project;
    if (!active) throw new Error('当前没有可编辑的云端项目。');
    const checkSwitch=await flushBeforeReplacement(openingFrom);
    setBoundLayout(undefined);
    await assertCloudTransition(backendSceneToLayout(active.scene, { projectId: active.id, name: active.name }));
    await assertCloudTransition(layoutRef.current);
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    const lease = await controller.acquireLease(active.id, scene => { assertCloudZoneSupport(layoutRef.current); assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(scene, { projectId: active.id, name: active.name }); });
    try { await acceptScene(lease.scene, active.id, active.name, openingFrom,checkSwitch); }
    catch (error) {
      try{if(controller.getSnapshot().writeBlocked)await controller.releaseLeaseAfterCanvasMismatch(active.id);else await controller.releaseLease();}
      catch{throw new Error(`${error instanceof Error?error.message:'画布未替换。'} 云端编辑权未能确认释放，请核对后重试。`);}
      throw error;
    }
  }
  async function enterProject(project: ProjectSummary, current: boolean): Promise<void> {
    if (readOnlyStudio || busy || editingBlocked(project, current)) return;
    if (current) {
      void run(async () => {
        const openingFrom = layoutRef.current;
        if (cloud.writeBlocked) {
          if (!confirmReplace()) return;
          await acquireCurrentEdit(openingFrom);
        }
        setAccountOpen(false); dialog.current?.close();
      });
      return;
    }
    if (!cloud.writeBlocked) {
      setNotice('请先释放当前项目的编辑权，再打开其他项目。');
      return;
    }
    if (!confirmReplace()) return;
    void run(async () => {
      const openingFrom = layoutRef.current;
      const checkSwitch=await flushBeforeReplacement(openingFrom);
      setBoundLayout(undefined);
      let opened;
      try {
        opened=await controller.getProject(project.id, candidate => { assertCloudZoneSupport(layoutRef.current); assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(candidate.scene, { projectId: candidate.id, name: candidate.name }); });
        checkSwitch();
      }catch(error){
        if(controller.getSnapshot().project?.id===project.id&&layoutRef.current.id!==project.id){
          suspendFailedReplacement(project.id);
        }
        throw error;
      }
      try{
        await assertCloudTransition(openingFrom);await assertCloudTransition(layoutRef.current);
        await assertCloudTransition(backendSceneToLayout(opened.scene,{projectId:opened.id,name:opened.name}));checkSwitch();
      }catch(error){suspendFailedReplacement(opened.id);throw error;}
      let lease;
      try{lease=await controller.acquireLease(opened.id, scene => { assertCloudZoneSupport(layoutRef.current); assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(scene, { projectId: opened.id, name: opened.name }); });}
      catch(error){
        if(controller.getSnapshot().project?.id===opened.id&&layoutRef.current.id!==opened.id){
          suspendFailedReplacement(opened.id);
        }
        throw error;
      }
      try { await acceptScene(lease.scene, opened.id, opened.name, openingFrom,checkSwitch); }
      catch (error) {
        try{if(controller.getSnapshot().writeBlocked)await controller.releaseLeaseAfterCanvasMismatch(opened.id);else await controller.releaseLease();}
        catch{throw new Error(`${error instanceof Error?error.message:'画布未替换。'} 云端编辑权未能确认释放，请核对后重试。`);}
        throw error;
      }
      setAccountOpen(false); dialog.current?.close();
    });
  }
  function editingBlocked(project: ProjectSummary, current: boolean): boolean {
    if (current) return false;
    const editingElsewhere = !!(project.current_editor && project.lease_expires && Date.parse(project.lease_expires) > Date.now());
    return editingElsewhere || !cloud.writeBlocked;
  }
  async function duplicateProject(project: ProjectSummary): Promise<void> {
    const original=await controller.peekProject(project.id),scene=original.scene;
    if(original.projection?.requiresOriginalSceneForWrite||projectUnverifiedScene(scene).projection.requiresOriginalSceneForWrite)throw new Error('此项目的普通视图省略了未核验的原始记录，不能直接复制；请先通过授权原始场景核对。');
    await controller.businessRequest('/projects', 'POST', { studioId, name: `${project.name} 副本`, scene });
    await refreshProjects();
    setNotice(`已复制「${project.name}」。`);
  }
  async function shareProject(project: ProjectSummary): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('project', project.id);
    const link = `${url.origin}${url.pathname}${url.search}`;
    await navigator.clipboard.writeText(link);
    setNotice('项目链接已复制。');
  }
  async function removeProject(project: ProjectSummary): Promise<void> {
    if (!window.confirm(`删除「${project.name}」？删除后无法恢复，相关分享也会失效。`)) return;
    const isCurrent = cloud.project?.id === project.id;
    if (isCurrent && !cloud.writeBlocked) {
      if (dirty) await saveBoundSceneQuiet().catch(() => undefined);
      await controller.releaseLease();
    }
    if (isCurrent) await controller.deleteProject(project.id, project.revision);
    else await controller.businessRequest(`/projects/${encodeURIComponent(project.id)}`, 'DELETE', { expectedRevision: project.revision });
    setProjects(current => current.filter(item => item.id !== project.id));
    if (layoutRef.current.id === project.id) { setBoundLayout(undefined); setSavedFingerprint(null); }
    setNotice(`已删除「${project.name}」。`);
  }
  function downloadContract(): void {
    try {
      const scene = layoutToBackendScene(layoutRef.current);
      const url = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `scendance-scene-v${scene.schemaVersion}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`已导出通过后端 v${scene.schemaVersion} 校验的场景文件。${hasLocalHandoff(layoutRef.current) ? ' 本地执行信息请在“场景交付”导出交付包。' : ''}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '场景校验失败。'); }
  }

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? studioProjects.filter(project => project.name.toLocaleLowerCase().includes(needle)) : studioProjects;
  }, [studioProjects, query]);
  // 画布尚未对应某个已打开的云端项目时，用「草稿」卡占位（类似 Figma Drafts）。
  const draftOnCanvas = !sceneConnection && (!cloud.project || layout.id !== cloud.project.id);
  const draftCardName = (layout.name || '').trim() || '未命名草稿';
  const showDraftCard = draftOnCanvas && (!query.trim() || draftCardName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const draftScene = useMemo(() => {
    if (!showDraftCard) return null;
    try { return layoutToBackendScene(layout); }
    catch { return null; }
  }, [showDraftCard, layout]);
  // 当前打开的云端项目直接用会话里的 scene；其余卡片按可见名单懒加载。
  useEffect(() => {
    if (!accountOpen || !cloud.user || section !== 'projects') return;
    const openId = cloud.project?.id;
    const openScene = cloud.project?.scene;
    if (openId && openScene) {
      previewRequested.current.add(openId);
      setScenePreviews(prev => prev[openId] === openScene ? prev : { ...prev, [openId]: openScene });
      if(cloud.project?.projection?.requiresOriginalSceneForWrite)setReadOnlyProjects(prev=>prev[openId]?prev:{...prev,[openId]:true});
    }
    let active = true;
    for (const project of filteredProjects.slice(0, PREVIEW_LIMIT)) {
      if (previewRequested.current.has(project.id)) continue;
      previewRequested.current.add(project.id);
      void controller.peekProject(project.id)
        .then(full => {
          if (!active) { previewRequested.current.delete(project.id); return; }
          setScenePreviews(prev => ({ ...prev, [project.id]: full.scene }));
          if(full.projection?.requiresOriginalSceneForWrite||projectUnverifiedScene(full.scene).projection.requiresOriginalSceneForWrite)setReadOnlyProjects(prev=>({...prev,[project.id]:true}));
        })
        .catch(() => {
          if (!active) { previewRequested.current.delete(project.id); return; }
          setScenePreviews(prev => ({ ...prev, [project.id]: 'failed' }));
        });
    }
    return () => { active = false; };
  }, [accountOpen, cloud.user, section, filteredProjects, cloud.project?.id, cloud.project?.scene, controller]);
  // §二.4 默认在云上：状态只说结果，不解释文件存在哪。
  const saveStatus = conversionError ? '本机草稿' : sceneConnection ? '场景已连接' : !cloud.user || !bound ? '草稿' : cloud.writeBlocked ? '只读' : dirty ? '有改动' : '已保存';
  const activeStudio = studios.find(studio => studio.id === studioId) ?? studios[0];
  // 左上角只认身份：有邮箱就写邮箱，没有再用显示名 / 访客。角色和团队名在下面列表里已有。
  const accountIdentity = cloud.user?.email?.trim()
    || activeStudio?.displayName?.trim()
    || (cloud.user?.is_anonymous ? '访客' : cloud.user ? '我的账户' : '访客');
  const readOnlyStudio = (activeStudio?.role as string | undefined) === 'viewer';
  // Figma 式团队切换：记住的默认工作室由 preferredStudio 给出，左栏只负责把它摆出来并允许换一个。
  // 左栏点团队：切换工作室并回到项目列表（物料 / 团队页不必先点「← 项目」）。
  function openStudioProjects(nextStudioId: string): void {
    setStudioId(nextStudioId);
    if (userId) rememberStudio(userId, nextStudioId);
    setSection('projects');
  }
  const teamNav = studios.length > 0 ? <nav className="sc-account-teams" aria-label="团队">
    <h3>团队</h3>
    <ul>{studios.map(studio => <li key={studio.id}><button type="button" className="sc-account-team" aria-label={studio.name} aria-pressed={studio.id === studioId} onClick={() => openStudioProjects(studio.id)}><span className="sc-account-team-mark" aria-hidden="true">{studio.name.slice(0, 1).toUpperCase()}</span><span className="sc-account-team-name">{studio.name}</span><span className="sc-account-team-role" aria-hidden="true">{studioRoleLabel(studio.role)}</span></button></li>)}</ul>
  </nav> : null;

  return <>
    <button ref={triggerRef} className="sc-cloud-trigger" type="button" aria-label="账户中心" title="账户中心 · 身份、团队与项目" aria-haspopup="dialog" onClick={() => { setSection('projects'); setAccountOpen(true); dialog.current?.showModal(); }}>
      <span className="sc-account-trigger-avatar" aria-hidden="true"><img src={avatar.src} alt=""/></span>
    </button>
    {typeof document === 'undefined' ? null : createPortal(<dialog ref={dialog} className={`sc-cloud-dialog sc-account-dialog${cloud.user ? '' : ' is-auth'}`} aria-labelledby="cloud-title" onClose={() => { setAccountOpen(false); onClose?.(); }} onClick={closeDialogOnBackdrop} onKeyDown={event => event.stopPropagation()}>
      {cloud.user ? <div className="sc-account-scroll">
      <h2 id="cloud-title" className="sc-account-title-hidden">账户中心</h2>
      <button className="sc-cloud-close sc-account-close-float" type="button" aria-label="关闭账户面板" autoFocus onClick={() => dialog.current?.close()}><X size={18}/></button>
      <div className="sc-account-shell">
      <aside className="sc-account-side" aria-label="账户与团队">
      <div className="sc-account-profile">
        {cloud.user
          ? <button className="sc-account-avatar" type="button" title={`更换头像 · ${avatar.name}`} aria-label={`更换头像，当前 ${avatar.name}`} aria-expanded={avatarPickerOpen} onClick={() => setAvatarPickerOpen(open => !open)}><img src={avatar.src} alt=""/></button>
          : <span className="sc-account-avatar" aria-hidden="true"><UserRound size={20}/></span>}
        <div>
          <strong title={accountIdentity}>{accountIdentity}</strong>
          {!cloud.user && <span>登录后同步项目与团队</span>}
        </div>
        {/* 退出收在三点；物料 / 团队管理落在左栏团队列表下方。 */}
        {cloud.user && <details className="sc-account-more sc-account-profile-more">
          <summary aria-label="更多" title="更多"><MoreHorizontal size={16} aria-hidden="true"/></summary>
          <div className="sc-account-more-menu" role="group" aria-label="更多账户操作">
            <button type="button" aria-label="退出登录" disabled={busy} onClick={event => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); void run(async () => { await flushSourceScope(layoutRef.current.id ?? 'local'); await controller.signOut(); setProjects([]); setStudios([]); setBoundLayout(undefined); setSavedFingerprint(null); }); }}><DoorOpen size={14} aria-hidden="true"/>退出登录</button>
          </div>
        </details>}
        {avatarPickerOpen && cloud.user && <div className="sc-account-avatar-picker" role="group" aria-label="预设头像">
          <span className="sc-account-avatar-picker-title">选择头像</span>
          {AVATAR_PRESETS.map(item => <button key={item.id} type="button" title={item.name} aria-label={item.name} aria-pressed={avatar.id === item.id} onClick={() => { setAvatar(item); saveAvatar(userId, item.id); setAvatarPickerOpen(false); }}><img src={item.src} alt=""/></button>)}
        </div>}
        {/* 未登录时浮窗整块是 AuthCard，这里不再放第二套登录入口。 */}
      </div>
      {teamNav}
      {cloud.user && <nav className="sc-account-side-links" aria-label="账户分区">
        <button type="button" aria-label="设置" aria-pressed={section === 'settings'} onClick={() => setSection('settings')}><Settings size={14} aria-hidden="true"/>设置</button>
        <button type="button" aria-label="物料" aria-pressed={section === 'assets'} onClick={() => setSection('assets')}><Images size={14} aria-hidden="true"/>物料</button>
        <button type="button" aria-label="团队与权限" aria-pressed={section === 'team'} onClick={() => setSection('team')}><UsersRound size={14} aria-hidden="true"/>团队与权限</button>
      </nav>}
      </aside>
      <div className="sc-account-main">
      {section !== 'projects' && <nav className="sc-account-subnav" aria-label="账户导航">
        <button type="button" aria-label="我的项目" onClick={() => setSection('projects')}>← 项目</button>
        <span className="sc-account-subnav-current">{section === 'assets' ? '物料' : section === 'team' ? '团队与权限' : section === 'settings' ? '设置' : ''}</span>
      </nav>}
      <div className="sc-account-body">
      <section hidden={section !== 'projects'} aria-label="我的项目">
      {/* 只留项目卡片墙；本机草稿也是其中一张卡，不再叠一层「最近活动」。 */}
      {sceneConnection && <section className="sc-cloud-current" aria-label="当前活动的场景连接">
        <h3>场景助手已连接</h3>
        <p>只用于助手处理当前场景。</p>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await controller.disconnectGeometryWorkbench(); setNotice('场景服务已断开。下次使用助手时会重新连接。'); })}>断开场景服务</button>
      </section>}
      {!cloud.configured ? <div className="sc-cloud-offline">
        <span className="sc-cloud-badge">离线</span>
        <h3>暂时无法连接</h3>
        <p>请检查网络后重试。</p>
        <button type="button" onClick={downloadContract} disabled={!!conversionError}>导出场景数据</button>
      </div> : !cloud.user ? null : <div className="sc-cloud-content">
        {/* 切换项目是主路径：Figma 式卡片墙。编辑权只挂在「当前」那一张上，不另开管理侧栏。 */}
        <div className="sc-account-section-heading">
          <div className="sc-account-section-title">
            <h3>项目</h3>
            <button type="button" className="sc-account-icon-btn" disabled={busy || loadingProjects} aria-label="刷新" title="刷新" onClick={() => void run(refreshProjects)}><RefreshCw size={15}/></button>
          </div>
        </div>
        {/* 草稿保存失败才在列表上方提醒；日常「草稿 / 已保存到本机」看项目卡状态，别跟关闭按钮挤在一起。 */}
        {draftNote?.error && <p className="sc-account-draft-note has-error" role="status" title={draftNote.title}>{draftNote.label}</p>}
        <section aria-label="项目列表">
        {(loadingProjects || !!studioProjects.length || draftOnCanvas) && <div className="sc-account-filters"><label className="sc-account-search"><svg className="sc-account-search-icon" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.25" /><path d="M15.2 15.2 20 20" /></svg><input aria-label="搜索项目" type="search" placeholder="搜索项目" value={query} onChange={event => setQuery(event.target.value)} /></label></div>}
        {loadingProjects && <p className="sc-account-empty" role="status">正在加载…</p>}
        <ul className="sc-file-grid">
          {showDraftCard && <li className="sc-file-card is-current is-draft">
            <button type="button" className="sc-file-hit" disabled aria-current="true" aria-label={`当前草稿 ${draftCardName}`}>
              <span className={`sc-file-thumb${draftScene ? ' has-preview' : ''}`} aria-hidden="true">
                {draftScene ? <SceneThumb scene={draftScene} eager/> : <FolderOpen size={26}/>}
                <span className="sc-file-state">当前 · 草稿</span>
              </span>
              <span className="sc-file-info"><strong>{draftCardName}</strong><small>仅本机 · 未存为云端方案</small></span>
            </button>
          </li>}
          {filteredProjects.map(project => {
            const current = project.id === cloud.project?.id;
            const editingElsewhere = !current && project.current_editor && project.lease_expires && Date.parse(project.lease_expires) > Date.now();
            const status = current
              ? `当前 · ${saveStatus}`
              : readOnlyStudio ? '只读' : editingElsewhere ? '他人编辑中' : '';
            const preview = scenePreviews[project.id];
            const previewScene = preview && preview !== 'failed' ? preview : null;
            const canEnter = !busy && !readOnlyStudio && !editingBlocked(project, current);
            return <li key={project.id} className={`sc-file-card${current ? ' is-current' : ''}`}>
              <button
                type="button"
                className="sc-file-hit"
                disabled={!canEnter}
                aria-current={current ? 'true' : undefined}
                aria-label={current ? `当前项目 ${project.name}，双击进入` : `打开 ${project.name}，双击进入`}
                onDoubleClick={() => { if (canEnter) void enterProject(project, current); }}
                onKeyDown={event => {
                  if (!canEnter) return;
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void enterProject(project, current); }
                }}
              >
                <span className={`sc-file-thumb${previewScene ? ' has-preview' : ''}`} aria-hidden="true">
                  {previewScene ? <SceneThumb scene={previewScene}/> : <FolderOpen size={26}/>}
                  {status && <span className="sc-file-state">{status}</span>}
                </span>
                <span className="sc-file-info"><strong>{project.name}</strong><small>{updatedLabel(project.updated_at)}</small></span>
              </button>
              {!sceneConnection && !readOnlyStudio && <details className="sc-file-more">
                <summary aria-label={`${project.name} 更多操作`} title="更多"><MoreHorizontal size={16} aria-hidden="true"/></summary>
                <div className="sc-file-more-menu" role="group" aria-label={`${project.name} 操作`}>
                  {current && !cloud.writeBlocked && <button type="button" disabled={busy} onClick={event => {
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    if (dirty && !window.confirm('还有未同步到云端的改动。释放前会先自动保存；若保存失败可取消。继续吗？')) return;
                    void run(async () => {
                      if (dirty) await saveBoundSceneQuiet();
                      await controller.releaseLease();
                      setNotice('编辑权已释放，队友可以接手。');
                    });
                  }}>释放编辑权</button>}
                  <button type="button" disabled={busy || !studioId} onClick={event => {
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    void run(async () => { await duplicateProject(project); });
                  }}>复制</button>
                  {readOnlyProjects[project.id]&&sessionToken&&isSessionCurrent&&<button type="button" disabled={busy} onClick={event=>{
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    const current=controller.getSnapshot();if(!current.user||!isSessionCurrent(sessionToken))return;
                    const target={projectId:project.id,userId:current.user.id,activeProjectId:current.project?.id??null,token:sessionToken,authority:controller.captureOriginalSceneReadGuard()};
                    originalReviewRef.current=target;setOriginalReview(target);
                  }}>核对原始记录</button>}
                  <button type="button" disabled={busy} onClick={event => {
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    void run(async () => { await shareProject(project); });
                  }}>分享</button>
                  <button type="button" disabled={busy} onClick={event => {
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    void run(async () => { await removeProject(project); });
                  }}>删除</button>
                </div>
              </details>}
            </li>;
          })}
          {!readOnlyStudio && <li className="sc-file-card is-new">
            <button type="button" className="sc-file-new" aria-label="新方案" disabled={busy || sceneConnection || !studioId || !cloud.writeBlocked || !!conversionError} onClick={() => void run(async () => {
              const current = layoutRef.current;
              if(projectedCreation.current&&sameRecoveryFormValue(projectedCreation.current.base,current)){setNotice(`云端项目已创建（编号 ${projectedCreation.current.projectId}），目前仅供只读核对；本机草稿未替换，请先核对原项目。`);return;}
              assertCloudZoneSupport(current);assertNoLocalHandoffCloudTransition(current);
              const checkSwitch=onBeforeActivitySwitch?.(current)??(()=>{if(layoutRef.current!==current)throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');});
              checkSwitch();
              await assertCloudTransition(current);
              checkSwitch();
              await flushSourceScope(current.id ?? 'local');
              checkSwitch();
              await assertCloudTransition(layoutRef.current);
              checkSwitch();
              if (layoutRef.current !== current) throw new Error('保存资料期间场景有新改动，原草稿已保留，请重新创建。');
              setBoundLayout(undefined);
              const created = await controller.createProject(studioId, current.name, layoutToBackendScene(current));
              if(created.projection?.requiresOriginalSceneForWrite){
                projectedCreation.current={base:structuredClone(current),projectId:created.id};
                suspendFailedReplacement(created.id);
                await refreshProjects().catch(()=>{});
                setNotice(`云端项目已创建（编号 ${created.id}），但含未核验原始记录，目前仅供只读核对；本机草稿未绑定、未替换，云端写入已暂停。`);return;
              }
              let sourceNotice = '';
              try {
                await assertCloudTransition(current);
                await assertCloudTransition(backendSceneToLayout(created.scene, { projectId: created.id, name: created.name }));
                await assertCloudTransition(layoutRef.current);
                checkSwitch();
                if (layoutRef.current !== current) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
                try { await copySourceScope(current.id ?? 'local', created.id); }
                catch { sourceNotice = ' 资料未能复制到新项目；请回到原草稿核对，或重新选择来源图片。'; }
                await acceptScene(created.scene, created.id, created.name, current,checkSwitch);
              } catch (error) {
                if(controller.getSnapshot().project?.id===created.id)suspendFailedReplacement(created.id);
                throw new Error(`云端创建请求已返回，结果待核对；当前画布未替换。${error instanceof Error ? error.message : '请保留原草稿并核对资料。'}`);
              }
              await refreshProjects(); setNotice(`新项目已保存，获取编辑权后可继续云端编辑。${sourceNotice}`);
            })}>
              <span className="sc-file-new-mark" aria-hidden="true">＋</span>
              <span>新方案</span>
            </button>
          </li>}
        </ul>
        {originalReview&&originalReviewCurrent()&&<OriginalSceneReviewPanel key={`${originalReview.projectId}:${originalReview.token.epoch}`} scopeKey={`${originalReview.projectId}:${originalReview.token.epoch}`} isCurrent={originalReviewCurrent} loadOriginal={loadOriginal} enableLocalPreview allowLocalConfirm={ORIGINAL_SCENE_SUBMISSION_ENABLED&&!!localWriteCapability} onConfirmLocal={confirmOriginal}/>}
        {!loadingProjects && !!studioProjects.length && !filteredProjects.length && !showDraftCard && <div className="sc-account-empty"><p>没有匹配的项目</p>{query && <button type="button" onClick={() => { setQuery(''); }}>清除筛选</button>}</div>}
        </section>
      </div>}
      </section>
      <section hidden={section !== 'assets'} aria-label="账户物料"><div className="sc-account-section-heading"><div className="sc-account-section-title"><h3>物料</h3><InfoTip label="物料说明"><strong>与物料面板同一套分类</strong><span>我的生成 / 收藏 / 库，和画布里的物料面板保持一致。</span></InfoTip></div></div>{cloud.user ? <AssetsPanel controller={controller} layout={layout} onApplyLayout={onApplyLayout ?? onLoadLayout} bound={bound} busy={busy} /> : <p className="sc-account-empty">登录后查看物料。</p>}</section>
      <section hidden={section !== 'team'} aria-label="团队与权限">
        {teamMounted && <AccountTeamPanel key={`team-${userId ?? 'local'}`} controller={controller}/>}
      </section>
      <section hidden={section !== 'settings'} aria-label="设置">
        <div className="sc-account-section-heading"><div className="sc-account-section-title"><h3>设置</h3></div></div>
        <div className="sc-settings-prefs">
          <div className="sc-settings-group">
            <div className="sc-settings-row">
              <div className="sc-settings-row-main"><strong>显示单位</strong><small>标注、属性面板与导出清单的尺寸读数跟随；场景数据仍按米存储。</small></div>
              <div className="sc-settings-row-actions">
                <div className="sc-unit-seg" role="group" aria-label="显示单位">
                  <button type="button" aria-pressed={preferences.lengthUnit === 'm'} onClick={() => onPreferenceChange({ lengthUnit: 'm' })}>米 · m</button>
                  <button type="button" aria-pressed={preferences.lengthUnit === 'ft'} onClick={() => onPreferenceChange({ lengthUnit: 'ft' })}>英尺 · ft</button>
                </div>
              </div>
            </div>
            <div className="sc-settings-row">
              <div className="sc-settings-row-main"><strong>换算示例</strong><small>{formatLength(12, 'm')} ≈ {formatLength(12, 'ft')}（英尺保留一位小数）。</small></div>
            </div>
          </div>
          <div className="sc-settings-group">
            <div className="sc-settings-row">
              <div className="sc-settings-row-main"><strong>尺寸标注</strong><small>在画布上显示场地与物件的尺寸读数。</small></div>
              <div className="sc-settings-row-actions">
                <label className="sc-switch">
                  <input type="checkbox" checked={preferences.showMeasurements} onChange={event => onPreferenceChange({ showMeasurements: event.target.checked })} />
                  <i></i>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* 项目相关提示只挂在项目页，别跟到团队 / 物料里吵。 */}
      {section === 'projects' && conversionError && <p className="sc-cloud-message" role="status">{conversionError}</p>}
      {section === 'projects' && localHandoff && !sceneConnection && notice !== LOCAL_HANDOFF_CLOUD_MESSAGE && <p className="sc-cloud-message" role="status">{LOCAL_HANDOFF_CLOUD_MESSAGE}</p>}
      {section === 'projects' && (notice || cloud.error) && <p className="sc-cloud-message" role="status">{notice || cloud.error?.message}</p>}
      {section === 'projects' && cloud.error?.code==='CANVAS_PROJECT_MISMATCH' && notice!==cloud.error.message && <p className="sc-cloud-message" role="alert">{cloud.error.message}</p>}
      {section === 'projects' && cloud.error?.code==='CANVAS_PROJECT_MISMATCH' && cloud.lease && <button type="button" disabled={busy} onClick={()=>void run(async()=>{await controller.releaseLeaseAfterCanvasMismatch(cloud.lease!.projectId);setNotice('原编辑权已释放；请保留当前草稿，重新打开活动核对。');})}>重试释放原编辑权</button>}
      </div>
      </div>
      </div>
      </div> : <>
        <h2 id="cloud-title" className="sc-account-title-hidden">账户中心</h2>
        <button className="sc-cloud-close sc-account-close-float" type="button" aria-label="关闭账户面板" autoFocus onClick={() => dialog.current?.close()}><X size={18}/></button>
        <AuthCard controller={controller} onAuthenticated={handleAuthenticated} />
      </>}
    </dialog>, document.body)}
  </>;
}
