'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AssetsPanel } from '@/components/business/assets-panel';
import { AuthCard } from '@/components/intro/auth-card';
import { SettingsPage, type SettingsPane, type SettingsPreferences } from '@/components/room-organizer/panels/settings-page';
import { useAppearanceOptional } from '../contexts/appearance-context';
import { AccountMenu, openShortcutCoach } from '@/components/room-organizer/panels/account-menu';
import type { FeedbackPlanContext } from '@/components/room-organizer/panels/feedback-dialog';
import { rememberStudioSettings } from '../lib/studio-settings-cache';
import { sanitizeStudioSettings, type StudioSettings, type StudioSettingsPatch } from '../../../../supabase/functions/_shared/plan-editor';
import type { PlanEditorSettings } from '../../../../supabase/functions/_shared/plan-editor';
import type { PlanQuote } from '../../../../supabase/functions/_shared/site-plan';
import { Box, FileImage, FolderOpen, Images, MapPin, MoreHorizontal, Mountain, RefreshCw, Settings, Trash2, UserRound, UsersRound, X } from '@/components/solid-icons';
import { safeReturnPath } from '@/lib/auth-provider';
import {sameRecoveryFormValue} from '@/lib/recovery-form-value';
import { backendFailureText, createBackendSession, useBackendSession, type BackendSession, type ProjectSummary, type Studio } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { copySourceScope, flushSourceScope } from '@/lib/source-storage';
import { readProjectCache } from '@/lib/project-cache';
import { captureStageCover } from '@/lib/stage-cover';
import { readActivityCovers, saveActivityCover } from '@/lib/activity-cover';
import { emptyProjectScene, consumeSelfAttachedProject, preferredStudio, rememberStudio } from '@/lib/workspace-api';
import type { Scene } from '../../../../supabase/functions/_shared/domain';
import {projectUnverifiedScene} from '../../../../supabase/functions/_shared/scene-text-projection';
import { assetCloudLabel, cloudAssetIdMap, prepareLayoutAssetsForCloud, useAssetCloudRecords, setAssetCloudScope } from '../lib/asset-cloud';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { fetchArchiveAssetUrl, parseCompleteProjectSnapshot, resolveCompleteProjectTransport, type CloudArchiveAsset } from '../lib/cloud-archive';
import { failCloudSync, finishCloudSync, setPendingCount, startCloudSync, useSaveStatus } from '../lib/save-status';
import { buildCompleteManifest, manifestCompletenessLabel, type ManifestBuildResult } from '../lib/project-manifest';
import { collectArchiveInventory, enqueuePendingInventoryItems, inventoryActionHint, inventoryTone, isReplicaCaseItem, readOutdoorInventoryRecords, type InventoryItem, type InventoryReport, type InventoryTone } from '../lib/local-inventory';
import { sharedArchiveQueue, type ArchiveJob } from '../lib/archive-queue';
import { useCloudArchive } from '../hooks/use-cloud-archive';
import { listStoredSources, type StoredSource } from '@/lib/source-storage';
import { readOutdoorProjectRecord, saveOutdoorProjectRecord } from '../lib/outdoor-project-store';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { notify } from '../lib/editor-notices';
import { assertNoLocalHandoffCloudTransition, assertNoLocalRecordsCloudTransition, hasLocalHandoff, LOCAL_HANDOFF_CLOUD_MESSAGE } from '../lib/handoff-cloud-guard';
import { ensureGlbAsset } from '../three/glb-assets';
import { copyAssistantScope } from '../lib/assistant-scope-registry';
import { projectSessionScope } from '../lib/project-session-scope';
import { copyOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { TeamSection } from './team-section';
import { AVATAR_PRESETS, avatarForSeed, loadAvatar, saveAvatar, type AvatarPreset } from './account-avatars';
import { InfoTip } from './info-tip';
import { ProjectThumb } from './project-thumb';
import {OriginalSceneReviewPanel,type OriginalMoveConfirmation} from './original-scene-review-panel';
import type {LocalWriteCapability} from '@/lib/local-write-lease';
import type {ActivitySessionToken} from '../lib/activity-session-epoch';
import type { DisplayUnit, RoomLayout } from '../lib/types';

interface Props { controller?: BackendSession; layout: RoomLayout; sessionToken?: ActivitySessionToken|null|undefined; isSessionCurrent?: ((token:ActivitySessionToken|null|undefined)=>boolean)|undefined; localWriteCapability?:LocalWriteCapability|undefined; onBeforeActivitySwitch?:((expected?:RoomLayout)=>()=>void)|undefined; getCurrentLayout?:(()=>RoomLayout)|undefined; onLoadLayout(layout: RoomLayout): void; onApplyLayout?(layout: RoomLayout): void; onDeleteCurrentActivity?: () => Promise<string>; onClose?(): void; openRequest?: { serial: number; section: string }; triggerRef?: RefObject<HTMLButtonElement>; draftNote?: { label: string; error?: boolean; title?: string }; preferences?: SettingsPreferences; onPreferenceChange?: (patch: Partial<SettingsPreferences>) => void; onPlanSettingsChange?: (next: PlanEditorSettings | undefined) => void; siteQuote?: PlanQuote | undefined; planContext?: FeedbackPlanContext; onCapturePlan?: () => Promise<string | null> | string | null }

/** 点在对话框边框外（背后遮罩）才关。面板里的点击、按钮都不关。 */
export function closeDialogOnBackdrop(event: MouseEvent<HTMLDialogElement>): void {
  const box = event.currentTarget.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) event.currentTarget.close();
}

type AccountSection = 'projects' | 'assets' | 'team' | 'archive' | 'settings';

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

/** 没有画布快照时用一枚安静的菱形封面，不写字、不铺绿底。 */
function coverMark(): JSX.Element {
  return <span className="sc-file-thumb-mark" aria-hidden="true"><i /></span>;
}

function formatArchiveBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 队列任务的一句人话状态；uploaded 带真实云端资产号前缀，失败带原因。 */
function archiveJobLabel(job: ArchiveJob): string {
  switch (job.state) {
    case 'uploaded': return `已归档 · ${job.assetId?.slice(0, 8) ?? ''}… · ${formatArchiveBytes(job.bytes)}`;
    case 'uploading': return `上传中 ${Math.round(job.progress * 100)}% · ${formatArchiveBytes(job.bytes)}`;
    case 'failed': return `失败（已试 ${job.attempts} 次）：${job.error ?? ''}`;
    case 'needs-file': return job.error ?? '需要原文件补传';
    default: return job.attempts > 0 ? `待补传（已试 ${job.attempts} 次）` : '待补传';
  }
}

/** 归档盘点的展示状态：把现有 archived 再按副本性质拆开，避免「已归档」一锅端。 */
const INVENTORY_TONE_META: Record<InventoryTone, { label: string; badgeClass: string }> = {
  private:  { label: '私有云端已归档', badgeClass: 'sc-archive-badge-private' },
  public:   { label: '公共库副本 · 非个人', badgeClass: 'sc-archive-badge-public' },
  activity: { label: '活动云端副本', badgeClass: 'sc-archive-badge-activity' },
  local:    { label: '仅本机 · 待同步', badgeClass: 'sc-archive-badge-local' },
  error:    { label: '缺原件 / 失败', badgeClass: 'sc-archive-badge-error' },
};

const INVENTORY_GROUPS: ReadonlyArray<{ type: InventoryItem['type']; label: string; Icon: typeof Box }> = [
  { type: 'scan', label: '实景扫描', Icon: Mountain },
  { type: 'outdoor-plan', label: '户外规划', Icon: MapPin },
  { type: 'model', label: '物料模型', Icon: Box },
  { type: 'photo', label: '资料图', Icon: Images },
  { type: 'floorplan', label: '图纸', Icon: FileImage },
  { type: 'attachment', label: '附件', Icon: FolderOpen },
];

function InventoryRow({ item, Icon }: { item: InventoryItem; Icon: typeof Box }) {
  const demo = isReplicaCaseItem(item);
  const tone = inventoryTone(item);
  const meta = INVENTORY_TONE_META[tone];
  const hint = inventoryActionHint(item);
  const size = typeof item.bytes === 'number' && item.bytes ? formatArchiveBytes(item.bytes) : '';
  return (
    <li className="sc-archive-row">
      <span className="sc-archive-row-icon"><Icon size={14} aria-hidden="true" /></span>
      <span className="sc-archive-row-main">
        <strong>{item.name}</strong>
        <small>{item.detail ?? ''}{size ? ` · ${size}` : ''}</small>
      </span>
      <span className="sc-archive-row-side">
        {demo
          ? <span className="sc-archive-badge-demo">内置示例</span>
          : <span className={`sc-archive-badge ${meta.badgeClass}`}>{meta.label}</span>}
        {hint && <span className="sc-archive-hint">{hint}</span>}
      </span>
    </li>
  );
}

type TrashProjectSummary = { id: string; name: string; studio_id: string; revision: number; updated_at: string; deleted_at: string };

export function CloudPanel({ layout, sessionToken, isSessionCurrent, localWriteCapability, onBeforeActivitySwitch, getCurrentLayout, onLoadLayout, controller: providedController, onApplyLayout, onDeleteCurrentActivity, onClose, openRequest, triggerRef, draftNote, preferences: preferencesProp, onPreferenceChange: onPreferenceChangeProp, onPlanSettingsChange, siteQuote, planContext, onCapturePlan }: Props): JSX.Element {
  const [fallbackController] = useState(() => providedController ?? createBackendSession());
  const controller = providedController ?? fallbackController;
  const preferences = preferencesProp ?? { lengthUnit: 'm' as DisplayUnit, showMeasurements: true, lengthPrecisionM: 0.01 as const, snapToGrid: false, snapToWall: false, snapToItems: false };
  const onPreferenceChange = onPreferenceChangeProp ?? (() => undefined);
  const appearance = useAppearanceOptional();
  const cloud = useBackendSession(controller);
  const requestedProjectId = useSearchParams()?.get('project');
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trash, setTrash] = useState<TrashProjectSummary[]>([]);
  const [cachedProjects, setCachedProjects] = useState<Record<string, boolean>>({});
  const [trashOpen, setTrashOpen] = useState(false);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [studioId, setStudioId] = useState('');
  useEffect(() => { setAssetCloudScope(cloud.user?.id ?? null, studioId || cloud.project?.studio_id || null); }, [cloud.user?.id, studioId, cloud.project?.studio_id]);
  // C03–C05、C14：云端归档队列与能力探测。A 契约未部署时 transport 为 null，这里如实不可用，
  // 队列任务只在本机积累（原件保留），绝不显示虚假的云端成功。
  const archive = useCloudArchive({
    controller,
    userId: cloud.user?.id ?? null,
    ...(studioId ? { studioId } : {}),
    enabled: !!cloud.user && !cloud.user.is_anonymous,
    statusScope: layout.id ?? 'local',
  });
  // C05：统一保存状态（本机/上传中/同步中/云端已保存/失败/冲突）。
  const saveStatusState = useSaveStatus(layout.id ?? 'local');
  const [inventory, setInventory] = useState<InventoryReport | null>(null);
  // 盘点展示口径：内置示例不计入个人归档计数；其余按副本性质分五态。
  const inventoryView = useMemo(() => {
    const items = inventory?.items ?? [];
    const counts = { private: 0, public: 0, activity: 0, local: 0, error: 0, demo: 0 };
    for (const item of items) {
      if (isReplicaCaseItem(item)) { counts.demo += 1; continue; }
      counts[inventoryTone(item)] += 1;
    }
    return { items, counts };
  }, [inventory]);
  const [cloudAssets, setCloudAssets] = useState<CloudArchiveAsset[] | null>(null);
  const [cloudAssetsError, setCloudAssetsError] = useState('');
  const [manifestNote, setManifestNote] = useState('');
  const [completeInfo, setCompleteInfo] = useState<{ revision: number; confirmedAt: string; dependencyCount: number } | null>(null);
  const [completeError, setCompleteError] = useState('');
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
  const [settingsPaneRequest, setSettingsPaneRequest] = useState<{ serial: number; pane: SettingsPane }>({ serial: 0, pane: 'personal' });
  const [menuOpen, setMenuOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const [studioSettings, setStudioSettings] = useState<StudioSettings | null>(null);
  const [studioSettingsStatus, setStudioSettingsStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'signed-out'>('idle');
  const [studioSettingsError, setStudioSettingsError] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [query, setQuery] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [avatar, setAvatar] = useState<AvatarPreset>(() => avatarForSeed('guest'));
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  /** 选择器宽 236px，比左栏（188px、overflow:auto）宽，绝对定位会被裁掉最后一列，所以按视口坐标固定定位。 */
  const [avatarPickerPos, setAvatarPickerPos] = useState<{ left: number; top: number } | null>(null);
  const avatarPickerAnchorRef = useRef<HTMLButtonElement>(null);
  // 2026-11-18 用户：「团队也应该可以任意新建团队」——后端 POST /studios 早就支持，补上左栏入口。
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [teamName, setTeamName] = useState('');
  // 2026-11-22 用户拍板：改名暗门撤掉，改名收进「团队」分区面板顶部；左栏只留切换与新建。
  // 2026-11-18 项目卡预览：本机真实定格（画布翻拍）优先，见 project-thumb.tsx。
  const [projectCovers, setProjectCovers] = useState<Record<string, string>>({});
  // 云项目 → 原本机活动 id（同一个内容两个身份时，规划与封面先按旧 id 找）。
  const [projectAliases, setProjectAliases] = useState<Record<string, string>>({});
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
  // 团队默认在团队分区与设置的本方案报价抬头都要用：两处进弹窗都加载。
  useEffect(() => {
    if ((section !== 'settings' && section !== 'team') || !accountOpen) return undefined;
    if (!cloud.user || cloud.user.is_anonymous) {
      setStudioSettingsStatus('signed-out');
      return undefined;
    }
    if (!studioId) return undefined;
    let cancel = false;
    setStudioSettingsStatus('loading');
    controller.getStudioSettings(studioId).then(value => {
      if (cancel) return;
      const next = sanitizeStudioSettings(value);
      setStudioSettings(next);
      rememberStudioSettings(studioId, next);
      setStudioSettingsStatus('ready');
      setStudioSettingsError('');
    }).catch(error => {
      if (cancel) return;
      setStudioSettingsStatus('error');
      setStudioSettingsError(error instanceof Error ? error.message : '团队默认没有读到。');
    });
    return () => { cancel = true; };
  }, [section, accountOpen, cloud.user, controller, studioId]);
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
    setReadOnlyProjects({});originalReviewRef.current=null;setOriginalReview(null);
    previewRequested.current = new Set();
  }, [studioId]);
  useEffect(() => controller.retain(), [controller]);
  useEffect(() => {
    if (!userId || busy) return;
    const id = requestedProjectId;
    if (!id || openedRequest.current === `${userId}:${id}`) return;
    // 经典案例是本机户外项目（space-panel 用 replica- 伪 id 占住 ?project=，刷新靠本机记录复原），
    // 云端没有它：静默跳过云端绑定，不报「项目链接无效」。
    if (id.startsWith('replica-')) { openedRequest.current = `${userId}:${id}`; return; }
    // 无感挂云自己同步的 ?project=：项目刚建好、画布已是内容本体，重开会清掉撤销历史，凭标记跳过。
    if (consumeSelfAttachedProject(userId, id)) { openedRequest.current = `${userId}:${id}`; return; }
    // 2026-11-18 用户：「能不能稍微早期不要设定这么复杂的门槛」——深链打开不再先要手动释放编辑权，
    // 交接交给 openRequested（先落盘、再放旧租约、打开后顺手拿新的）。
    const timer = window.setTimeout(() => {
      openedRequest.current = `${userId}:${id}`;
      void openRequested.current(id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId, requestedProjectId, busy, cloud.writeBlocked, cloud.project?.id]);
  // /auth 已改成「进工作台 + 自动弹登录浮窗」；标记只在 ?login=1 时置位。
  const loginRequested = useRef(false);
  // 2026-11-14 修复：原生 dialog.showModal() 会把焦点给第一个可聚焦元素（右上关闭钮），
  // 用户按回车=直接关弹层，登录没提交。未登录弹层打开后显式聚焦 AuthCard 邮箱框。
  const focusAuthEmail = () => {
    if (controller.getSnapshot().user) return;
    dialog.current?.querySelector<HTMLInputElement>('#sc-auth-email')?.focus();
  };
  useEffect(()=>{const openLogin=()=>{loginRequested.current=true;setSection('projects');setAccountOpen(true);if(!dialog.current?.open)dialog.current?.showModal();focusAuthEmail();};window.addEventListener('scendance:request-account-login',openLogin);return()=>window.removeEventListener('scendance:request-account-login',openLogin);},[]);
  // 被抢权后的接手入口（creative-studio 的 lease-lost 提示广播）：开「所有方案」卡片墙接手编辑。
  // 独立 /projects 项目页已于 2026-11-22 删除，收进这张卡墙；事件模式沿用上面的登录引导。
  useEffect(()=>{const openProjectsWall=()=>{setSection('projects');setAccountOpen(true);if(!dialog.current?.open)dialog.current?.showModal();focusAuthEmail();};window.addEventListener('scendance:open-account-projects',openProjectsWall);return()=>window.removeEventListener('scendance:open-account-projects',openProjectsWall);},[]);

  useEffect(() => {
    setProjects([]); setTrash([]); setTrashOpen(false); setStudios([]); setStudioId(''); setQuery(''); setProjectsLoaded(false); setSection('projects'); setMenuOpen(false);
    setReadOnlyProjects({});setCachedProjects({});originalReviewRef.current=null;setOriginalReview(null); previewRequested.current = new Set();
    if (!userId) {
      openedRequest.current = ''; showNotice(''); setLoadingProjects(false);
      // 会话从「未恢复」变成「匿名」也会走这里；?login=1 要求开着登录浮窗，别把它关掉。
      if (!loginRequested.current) { setAccountOpen(false); dialog.current?.close(); }
      return;
    }
    let cancelled = false;
    setLoadingProjects(true);
    void Promise.all([controller.listProjects(), controller.listStudios()]).then(([nextProjects, nextStudios]) => {
      if (cancelled) return;
      const initialStudio = preferredStudio(userId, nextStudios, controller.getSnapshot().project?.studio_id);
      setProjects(nextProjects); setStudios(nextStudios); setStudioId(initialStudio); setProjectsLoaded(true);
      // 面板初始展示的工作室也写入「最近使用」：无感挂云与「新方案」建项目时落在同一个工作室，不再各猜各的。
      rememberStudio(userId, initialStudio);
    }).catch(() => { if (!cancelled) showNotice('项目加载失败，请点击刷新重试。', true); }).finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [controller, userId]);
  // 消息钮未登录时打开「设置」；团队成员管理在账户窗的一级团队分区里。
  const openedOpenRequest = useRef(0);
  useEffect(() => {
    if (!openRequest || openRequest.serial <= 0 || openedOpenRequest.current === openRequest.serial) return;
    openedOpenRequest.current = openRequest.serial;
    if (openRequest.section === 'team') {
      if (!controller.getSnapshot().user) {
        setSection('projects');
        setAccountOpen(true);
        if (!dialog.current?.open) dialog.current?.showModal();
        focusAuthEmail();
        return;
      }
      setMenuOpen(false);
      setSection('team');
      setAccountOpen(true);
      if (!dialog.current?.open) dialog.current?.showModal();
      return;
    }
    if (openRequest.section === 'settings') {
      if (!controller.getSnapshot().user) {
        setSection('projects');
        setAccountOpen(true);
        if (!dialog.current?.open) dialog.current?.showModal();
        focusAuthEmail();
        return;
      }
      setMenuOpen(false);
      setSettingsPaneRequest(current => ({ serial: current.serial + 1, pane: 'personal' }));
      setSection('settings');
      setAccountOpen(true);
      if (!dialog.current?.open) dialog.current?.showModal();
      return;
    }
    setSection(openRequest.section === 'assets' ? 'assets' : openRequest.section === 'archive' ? 'archive' : 'projects');
    setMenuOpen(false);
    if (!dialog.current?.open) { setAccountOpen(true); dialog.current?.showModal(); focusAuthEmail(); }
  }, [openRequest, controller]);
  useEffect(() => {
    if (!localHandoff && fingerprint && fingerprint !== lastObserved.current) {
      lastObserved.current = fingerprint;
      if (JSON.stringify(controller.getSnapshot().draft) !== fingerprint) controller.setDraft(JSON.parse(fingerprint));
    }
  }, [controller, fingerprint, localHandoff]);

  function showNotice(text: string, isError = false): void {
    setNoticeError(isError);
    setNotice(text);
  }
  async function run(action: () => Promise<void>): Promise<void> {
    if (actionPending.current) return;
    actionPending.current = true; setBusy(true); showNotice('');
    try { await action(); }
    catch (error) {
      const code=error instanceof Error&&'code' in error?error.code:undefined;
      showNotice(code==='ORIGINAL_SCENE_REVIEW_REQUIRED'?'此项目含未核验原始记录，目前仅可只读核对；本机草稿未替换。':code?backendFailureText(error):error instanceof Error ? error.message : controller.getSnapshot().error?.message ?? '操作失败，请重试。', true);
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
    showNotice('已登录。');
  }
  async function refreshProjects(): Promise<void> {
    const [nextProjects, nextStudios] = await Promise.all([controller.listProjects(), controller.listStudios()]);
    setProjects(nextProjects); setStudios(nextStudios); setProjectsLoaded(true);
    setStudioId(current => nextStudios.some(studio => studio.id === current) ? current : nextStudios[0]?.id ?? '');
  }
  async function assertCloudTransition(value: RoomLayout): Promise<void> {
    try {
      await assertNoLocalRecordsCloudTransition(value);
      setRecordsBlockedScope(current => current === value.id ? undefined : current);
    } catch(error) {
      if (value.id && value.id === layoutRef.current.id) setRecordsBlockedScope(value.id);
      throw error;
    }
  }
  async function flushBeforeReplacement(openingFrom: RoomLayout): Promise<()=>void> {
    assertNoLocalHandoffCloudTransition(openingFrom);
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
    showNotice(message, tone === 'error');
    notify(message, tone);
  }
  /** 换项目前把当前编辑权交还：不再要求用户先去菜单里点「释放」。 */
  async function releaseForSwitch(): Promise<void> {
    if (controller.getSnapshot().writeBlocked) return;
    await controller.releaseLease();
  }

  /**
   * 打开后顺手申请编辑权。拿不到（别人正在改 / 网络）就按只读打开并说清原因，
   * 不把用户拦在「先去点一下获取编辑权」这一步上。
   */
  async function claimEditRight(project: { id: string; name: string; scene: Scene }, checkSwitch: () => void): Promise<string> {
    try {
      await controller.acquireLease(project.id, scene => {
        assertNoLocalHandoffCloudTransition(layoutRef.current);
        checkSwitch(); backendSceneToLayout(scene, { projectId: project.id, name: project.name });
      });
    } catch {
      return '已打开项目。编辑权没拿到（可能有人在改），先按只读打开；稍后可在卡片上再取。';
    }
    return '已打开项目，可以直接修改并保存。';
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
      // 只在换到别的项目时交还编辑权；重新打开同一项目（本机留有未保存改动）不动租约。
      if (openingFrom.id !== id) await releaseForSwitch();
      const project = current.project?.id === id && !current.writeBlocked ? current.project :
        await controller.getProject(id, incoming => { assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(incoming.scene, { projectId: incoming.id, name: incoming.name }); });
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
      // 深链打开给一条画布提示（跟冲突提示同一条道），用户不用回头看账户面板。
      softProjectNotice(await claimEditRight(project, checkSwitch));
    } catch (error) {
      if(controller.getSnapshot().project?.id===id&&layoutRef.current.id!==id){
        suspendFailedReplacement(id);
      }
      const code=error instanceof Error&&'code' in error?error.code:undefined;
      if(code==='PROJECT_NOT_FOUND'){
        // 深链指向的项目已不存在（被删除或无权限）：清掉 URL 残留与会话错误，回到本机草稿，刷新不再反复报错。
        const url=new URL(window.location.href);
        if(url.searchParams.get('project')===id){
          url.searchParams.delete('project');
          window.history.replaceState(null,'',url.pathname+(url.searchParams.toString()?`?${url.searchParams}`:'')+url.hash);
        }
        controller.dismissTransientFailure();
        softProjectNotice('链接中的项目已不存在或已被删除；当前画布仍是本机草稿，可继续编辑。','info');
        return;
      }
      softProjectNotice(code?backendFailureText(error):error instanceof Error ? error.message : '打开项目失败，请重试。', 'error');throw error;
    }
  });
  function confirmReplace(): boolean {
    return !dirty || window.confirm('打开云端版本会替换当前画布。当前草稿将保留为本地恢复点。继续吗？');
  }
  async function saveBoundSceneQuiet(): Promise<void> {
    const currentLayout = layoutRef.current;
    const scopeKey = currentLayout.id ?? 'local';
    // C05：先报「同步中」并拿序号；保存期间的新编辑由指纹口径保持 dirty，旧回执不清空它们。
    const seq = startCloudSync(scopeKey);
    try {
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
      finishCloudSync(scopeKey, seq, { revision: saved.revision, confirmedAt: Date.parse(saved.updatedAt) || Date.now() });
      // C06（2026-11-20 集成接通）：场景确认后把当前画布的完整清单也同步成云端完整归档；
      // 结果（含缺口与失败）落在归档页状态里，不改变「场景已保存」的结论，也不用弹窗打断保存。
      void saveCompleteArchive();
      if (saved.warnings.length) showNotice('已自动保存，请留意场地重叠提示。');
    } catch (error) {
      // C05：失败不冒充已保存；本机草稿仍在，待同步计数保持。
      failCloudSync(scopeKey, seq, error instanceof Error ? error.message : '云端保存失败；本机草稿保留。');
      throw error;
    }
  }
  // 持有编辑权时云端自动保存，卡片上不再放「保存」。
  useEffect(() => {
    if (!accountOpen && !bound) return undefined;
    if (!bound || cloud.writeBlocked || sceneConnection || !dirty || !!conversionError || localHandoff || busy) return undefined;
    if (autosavePending.current) return undefined;
    const timer = window.setTimeout(() => {
      autosavePending.current = true;
      void saveBoundSceneQuiet()
        .catch((error: unknown) => { showNotice(error instanceof Error ? error.message : '自动保存失败，请重试。', true); })
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
    const lease = await controller.acquireLease(active.id, scene => { assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(scene, { projectId: active.id, name: active.name }); });
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
    if (!confirmReplace()) return;
    void run(async () => {
      const openingFrom = layoutRef.current;
      const checkSwitch=await flushBeforeReplacement(openingFrom);
      // 2026-11-18：不再先要求手动释放编辑权；改动落盘后直接换项目，旧租约在这里交还。
      if (openingFrom.id !== project.id) await releaseForSwitch();
      setBoundLayout(undefined);
      let opened;
      try {
        opened=await controller.getProject(project.id, candidate => { assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(candidate.scene, { projectId: candidate.id, name: candidate.name }); });
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
      try{lease=await controller.acquireLease(opened.id, scene => { assertNoLocalHandoffCloudTransition(layoutRef.current);checkSwitch();backendSceneToLayout(scene, { projectId: opened.id, name: opened.name }); });}
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
    // 2026-11-18：自己手里握着别的项目不再锁住其他卡片——点开时自动交接编辑权。
    return !!(project.current_editor && project.lease_expires && Date.parse(project.lease_expires) > Date.now());
  }
  async function duplicateProject(project: ProjectSummary): Promise<void> {
    const original=await controller.peekProject(project.id),scene=original.scene;
    if(original.projection?.requiresOriginalSceneForWrite||projectUnverifiedScene(scene).projection.requiresOriginalSceneForWrite)throw new Error('此项目的普通视图省略了未核验的原始记录，不能直接复制；请先通过授权原始场景核对。');
    await controller.businessRequest('/projects', 'POST', { studioId, name: `${project.name} 副本`, scene });
    await refreshProjects();
    showNotice(`已复制「${project.name}」。`);
  }
  async function shareProject(project: ProjectSummary): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('project', project.id);
    const link = `${url.origin}${url.pathname}${url.search}`;
    await navigator.clipboard.writeText(link);
    showNotice('项目链接已复制。');
  }
  async function removeProject(project: ProjectSummary): Promise<void> {
    if (!window.confirm(`删除「${project.name}」？\n\n影响：\n· 云端项目移入「最近删除」，7 天内可恢复\n· 所有分享链接立即失效，恢复后需要重新分享\n· 本机缓存一并移入回收站`)) return;
    const isCurrent = cloud.project?.id === project.id;
    if (isCurrent && !cloud.writeBlocked) {
      if (dirty) await saveBoundSceneQuiet().catch(() => undefined);
      await controller.releaseLease();
    }
    if (isCurrent) await controller.deleteProject(project.id, project.revision);
    else {
      await controller.businessRequest(`/projects/${encodeURIComponent(project.id)}`, 'DELETE', { expectedRevision: project.revision });
      void import('@/lib/project-cache').then(cache => cache.moveProjectCacheToTrash(project.id)).catch(() => {});
    }
    setProjects(current => current.filter(item => item.id !== project.id));
    if (layoutRef.current.id === project.id) { setBoundLayout(undefined); setSavedFingerprint(null); }
    // 深链不再指向已删项目：刷新/分享都不会反复报“项目不存在”。
    const url = new URL(window.location.href);
    if (url.searchParams.get('project') === project.id) {
      url.searchParams.delete('project');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
    showNotice(`已删除「${project.name}」，7 天内可在「最近删除」恢复。`);
    if (typeof controller.listTrash === 'function' && trashOpen) void controller.listTrash().then(setTrash).catch(() => {});
  }
  async function restoreProject(project: TrashProjectSummary): Promise<void> {
    await controller.restoreProject(project.id, project.revision);
    setTrash(current => current.filter(item => item.id !== project.id));
    await refreshProjects().catch(() => {});
    showNotice(`已恢复「${project.name}」。原有分享链接不会自动恢复，需要重新分享。`);
  }
  /** 断网/云端失败时的只读打开：用本机缓存替换画布，不建立云端绑定。 */
  async function openCachedProject(project: ProjectSummary): Promise<void> {
    const cached = await readProjectCache(project.id);
    if (!cached) { showNotice('本机缓存已不可用，请联网后重试。', true); return; }
    if (dirty && !window.confirm('当前画布有未保存改动。打开本机缓存会替换画布，继续吗？')) return;
    onBeforeActivitySwitch?.(layoutRef.current)?.();
    const next = backendSceneToLayout(cached.scene as Scene, { projectId: project.id, name: project.name });
    onLoadLayout(next);
    setBoundLayout(undefined);
    setSavedFingerprint(null);
    showNotice(`已打开「${project.name}」的本机缓存副本，仅供离线查看；联网后可重新打开云端版本。`);
  }
  /** 把当前本机画布另存为一个云端方案（草稿卡的主操作，不再和“场地出发”混在一起）。 */
  async function saveDraftAsProject(): Promise<void> {
    const current = layoutRef.current;
    if(projectedCreation.current&&sameRecoveryFormValue(projectedCreation.current.base,current)){showNotice(`云端项目已创建（编号 ${projectedCreation.current.projectId}），目前仅供只读核对；本机草稿未替换，请先核对原项目。`);return;}
    assertNoLocalHandoffCloudTransition(current);
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
    const created = await controller.createProject(studioId, current.name, layoutToBackendScene(current), current.id);
    if(created.projection?.requiresOriginalSceneForWrite){
      projectedCreation.current={base:structuredClone(current),projectId:created.id};
      suspendFailedReplacement(created.id);
      await refreshProjects().catch(()=>{});
      showNotice(`云端项目已创建（编号 ${created.id}），但含未核验原始记录，目前仅供只读核对；本机草稿未绑定、未替换，云端写入已暂停。`);return;
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
      // 2026-11-19：存为方案后，这段对话和地图规划跟着新项目走；本机草稿保留一份原记录。
      try { copyAssistantScope(projectSessionScope(current.id), projectSessionScope(created.id)); } catch { /* 会话复制失败不影响建项目 */ }
      try { copyOutdoorProjectRecord(current.id ?? '', created.id); } catch { /* 规划复制失败时新项目仍可用空白规划 */ }
      let nextScene = created.scene;
      try { nextScene = (await controller.acquireLease(created.id)).scene; } catch { /* 建完仍可只读打开，不阻断创建回执 */ }
      await acceptScene(nextScene, created.id, created.name, current,checkSwitch);
    } catch (error) {
      if(controller.getSnapshot().project?.id===created.id)suspendFailedReplacement(created.id);
      throw new Error(`云端创建请求已返回，结果待核对；当前画布未替换。${error instanceof Error ? error.message : '请保留原草稿并核对资料。'}`);
    }
    await refreshProjects(); showNotice(`新项目已保存。${controller.getSnapshot().writeBlocked ? '这份暂时只读，需要改动时在卡片上取回编辑权。' : ''}${sourceNotice}`);
  }
  /**
   * P1（恢复入口，2026-11-20）：发布预检的阻塞动作落到项目卡里既有的真实链路，不新造保存通道。
   * - save-changes → saveBoundSceneQuiet：素材先上云 → controller.saveScene → 统一状态机结算（与自动保存同一条链）；
   * - save-project → saveDraftAsProject：草稿卡上的「存为方案」（创建真实云项目）；
   * - grant-edit  → acquireCurrentEdit：当前项目卡在只读态点开时走的取回编辑权。
   * 三条都只落盘或取权，**绝不触发发布**：发布仍要用户自己在发布页再点一次。
   */
  async function runPublishRecovery(action: string): Promise<void> {
    if (action === 'save-changes') {
      // 没挂云项目时没有可保存的目标：如实说明并指向「保存为云项目」，不假装已保存。
      if (!bound) throw new Error('这份方案还没挂到云项目上；请先点「保存为云项目」把它挂上去，再保存修改。');
      await saveBoundSceneQuiet();
      showNotice('当前修改已保存到云端。回到发布页重新点一次「发布」，会按新版本重新核对。');
      return;
    }
    if (action === 'save-project') {
      await saveDraftAsProject();
      return;
    }
    if (action === 'grant-edit') {
      await acquireCurrentEdit(layoutRef.current);
      showNotice(controller.getSnapshot().writeBlocked
        ? '编辑权还没拿到（可能有人在改），当前仍是只读。'
        : '编辑权已取回。回到发布页重新点一次「发布」，会重新核对授权与版本。');
      return;
    }
    throw new Error('这个恢复动作还没有接到真实链路，请按提示手动处理。');
  }
  /**
   * P1（恢复入口）：宿主（room-organizer）把发布预检的阻塞动作请求转到这里，
   * 与登录卡同款的事件通道（scendance:request-account-login），不新开并行契约。
   * 监听器只注册一次；动作体走 ref（每次渲染刷新），避免把首帧闭包钉死。
   */
  const publishRecoveryRef = useRef<(action: string) => void>(() => undefined);
  publishRecoveryRef.current = (action: string): void => {
    // 动作在账户浮窗里执行：用户看得见成功或失败原因，不装作没发生。
    setSection('projects');
    setMenuOpen(false);
    if (!dialog.current?.open) { setAccountOpen(true); dialog.current?.showModal(); }
    void run(() => runPublishRecovery(action));
  };
  useEffect(() => {
    const onRecovery = (event: Event): void => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action !== 'save-changes' && action !== 'save-project' && action !== 'grant-edit') return;
      publishRecoveryRef.current(action);
    };
    window.addEventListener('scendance:publish-recovery-action', onRecovery);
    return () => window.removeEventListener('scendance:publish-recovery-action', onRecovery);
  }, []);
  /** 丢弃本机草稿：换一个新的空白本机活动，不触碰任何云端项目。 */
  async function discardLocalDraft(): Promise<void> {
    if (!window.confirm('删除当前本机活动？\n\n· 归档与封面\n· 地图规划\n· 活动需求、点验与图纸\n· 这段对话\n都会一并清除，删除后无法恢复。')) return;
    try {
      showNotice(onDeleteCurrentActivity ? await onDeleteCurrentActivity() : discardLocalDraftLegacy());
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '活动未删除，请重试。', true);
    }
  }
  /** 无 Provider 的独立渲染（测试/Story）仍可用的降级：只换画布，不声称删除了资料。 */
  function discardLocalDraftLegacy(): string {
    onBeforeActivitySwitch?.(layoutRef.current)?.();
    const fresh = backendSceneToLayout(emptyProjectScene(), { projectId: crypto.randomUUID(), name: '未命名活动' });
    onLoadLayout(fresh);
    setBoundLayout(undefined);
    setSavedFingerprint(null);
    // 深链不再指向旧草稿，刷新后不会又把它拉回来。
    const url = new URL(window.location.href);
    if (url.searchParams.get('project') === layoutRef.current.id) {
      url.searchParams.delete('project');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
    return '画布已换成新的空白活动；本工作台未接入活动资料清理，旧资料仍保留在本机。';
  }
  function downloadContract(): void {
    try {
      const scene = layoutToBackendScene(layoutRef.current);
      const url = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `scendance-scene-v${scene.schemaVersion}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      showNotice(`已导出通过后端 v${scene.schemaVersion} 校验的场景文件。${hasLocalHandoff(layoutRef.current) ? ' 本地执行信息请在“场景交付”导出交付包。' : ''}`);
    } catch (error) { showNotice(error instanceof Error ? error.message : '场景校验失败。', true); }
  }

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? studioProjects.filter(project => project.name.toLocaleLowerCase().includes(needle)) : studioProjects;
  }, [studioProjects, query]);
  // 画布尚未对应某个已打开的云端项目时，用「草稿」卡占位（类似 Figma Drafts）。
  const draftOnCanvas = !sceneConnection && (!cloud.project || layout.id !== cloud.project.id);
  const floorplanOnlyLocal = !layout.backendSceneV2 && !!(layout.floorPlanImage || layout.backendVenue?.floorplanAssetId);
  const draftCardName = (layout.name || '').trim() || '未命名草稿';
  const showDraftCard = draftOnCanvas && (!query.trim() || draftCardName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // 当前打开的云端项目直接用会话里的 scene；其余卡片按可见名单懒加载。
  useEffect(() => {
    if (!accountOpen || !cloud.user || section !== 'projects') return;
    const openId = cloud.project?.id;
    const openScene = cloud.project?.scene;
    if (openId && openScene) {
      previewRequested.current.add(openId);
      if(cloud.project?.projection?.requiresOriginalSceneForWrite)setReadOnlyProjects(prev=>prev[openId]?prev:{...prev,[openId]:true});
    }
    let active = true;
    for (const project of filteredProjects.slice(0, PREVIEW_LIMIT)) {
      if (previewRequested.current.has(project.id)) continue;
      previewRequested.current.add(project.id);
      void readProjectCache(project.id).then(cached => {
        if (!active || !cached) return;
        setCachedProjects(prev => prev[project.id] ? prev : { ...prev, [project.id]: true });
        // 从本机活动升上云的项目：布局/规划/封面可能还落在旧活动 id 上，卡上要接着用。
        if (cached.localId) setProjectAliases(prev => prev[project.id] ? prev : { ...prev, [project.id]: cached.localId! });
      }).catch(() => {});
      void controller.peekProject(project.id)
        .then(full => {
          if (!active) { previewRequested.current.delete(project.id); return; }
          setCachedProjects(prev => { const next = { ...prev }; delete next[project.id]; return next; });
          if(full.projection?.requiresOriginalSceneForWrite||projectUnverifiedScene(full.scene).projection.requiresOriginalSceneForWrite)setReadOnlyProjects(prev=>({...prev,[project.id]:true}));
        })
        .catch(() => {
          if (!active) { previewRequested.current.delete(project.id); return; }
        });
    }
    return () => { active = false; };
  }, [accountOpen, cloud.user, section, filteredProjects, cloud.project?.id, cloud.project?.scene, controller]);
  // 2026-11-18：面板打开时把当前画布那一版真实定格存成本机封面（元数据旁边存，不进导出包）。
  // 封面是装饰：拍不到（无 WebGL / 二维未就绪）就继续用本机户外规划线稿，不报错也不拦打开。
  const canvasCoverId = layout.id ?? 'local-draft';
  useEffect(() => {
    if (!accountOpen || !cloud.user || section !== 'projects' || sceneConnection) return undefined;
    let active = true;
    const loadCovers = () => readActivityCovers()
      .then(map => { if (active) setProjectCovers(Object.fromEntries(map)); })
      .catch(() => {});
    const frame = captureStageCover();
    if (frame) void saveActivityCover(canvasCoverId, frame).then(saved => saved ? loadCovers() : undefined);
    void loadCovers();
    return () => { active = false; };
  }, [accountOpen, cloud.user, section, sceneConnection, canvasCoverId]);
  // C05：待同步数跟会话 dirty 真值走；未绑定项目没有云端同步，状态清零不残留。
  useEffect(() => {
    if (!bound || sceneConnection) { setPendingCount(layout.id ?? 'local', 0); return; }
    setPendingCount(layout.id ?? 'local', cloud.dirty ? 1 : 0);
  }, [bound, sceneConnection, cloud.dirty, layout.id]);
  // C14：本机存量盘点（队列任务 + 当前活动资料图 + 户外规划记录）。只读，不删任何本机副本。
  useEffect(() => {
    if (!accountOpen || !cloud.user || section !== 'archive') return;
    let cancelled = false;
    void (async () => {
      let sources: StoredSource[] = [];
      try { sources = await listStoredSources(layout.id ?? 'local'); } catch { sources = []; }
      let outdoorRecords: ReturnType<typeof readOutdoorInventoryRecords> = [];
      try { outdoorRecords = readOutdoorInventoryRecords(window.localStorage); } catch { outdoorRecords = []; }
      const report = collectArchiveInventory({ archiveJobs: archive.jobs, sources, outdoorRecords });
      if (!cancelled) setInventory(report);
    })();
    return () => { cancelled = true; };
  }, [accountOpen, cloud.user, section, archive.jobs, layout.id]);
  // 云端资产列表（A 契约 listArchiveAssets）：只在归档页可见且能力确认后读取；
  // transport 未接通时不读、不假装为空。
  useEffect(() => {
    if (section !== 'archive' || !accountOpen || !cloud.user) { setCloudAssets(null); return; }
    if (!archive.transport) return;
    if (!archive.capabilities && !archive.capabilityError) { void archive.queryCapabilities(); return; }
    if (!archive.capabilities) return;
    let cancelled = false;
    setCloudAssets(null); setCloudAssetsError('');
    archive.transport.listArchiveAssets(studioId || undefined)
      .then(list => { if (!cancelled) setCloudAssets(list); })
      .catch(error => { if (!cancelled) setCloudAssetsError(error instanceof Error ? error.message : '云端资产读取失败。'); });
    return () => { cancelled = true; };
  }, [archive.transport, archive.capabilities, archive.capabilityError, archive.queryCapabilities, section, accountOpen, cloud.user, studioId]);
  /** C06：当前画布的依赖清单核对（发布闸门在 room-organizer 注册，这里给面板内自查）。 */
  async function checkCurrentManifest(): Promise<void> {
    const current = layoutRef.current;
    let sources: StoredSource[] = [];
    try { sources = await listStoredSources(current.id ?? 'local'); } catch { sources = []; }
    let scene: ReturnType<typeof layoutToBackendScene> | null = null;
    try { scene = layoutToBackendScene(current, { assetIdMap: cloudAssetIdMap() }); } catch { scene = null; }
    const archiveAssetIds: Record<string, string> = {};
    if (cloud.user) {
      try {
        for (const job of await sharedArchiveQueue.inventoryForUser(cloud.user.id)) {
          if (job.state === 'uploaded' && job.assetId) archiveAssetIds[job.localId] = job.assetId;
        }
      } catch { /* 读不到队列就按缺口处理，不编造已归档 */ }
    }
    const result = buildCompleteManifest({ layout: current, scene, outdoorPlan: null, sources, cloudAssetIds: cloudAssetIdMap(), archiveAssetIds });
    setManifestNote(`${manifestCompletenessLabel(result)}${result.complete ? '' : '；户外规划依赖请在项目卡核对。'}`);
  }
  /**
   * C06（2026-11-20 集成接通）：以指定画布为准构建完整清单（场景 + 户外规划 + 资料图 + 依赖）。
   * 与上面自查不同，这里读当前项目的户外规划记录，让 saveCompleteProject 的 outdoor 字段
   * 是完整 payload（任务 C 的公开案例另存按它消费）；缺口如实返回，不编造云端资产 ID。
   */
  async function buildCompleteManifestFor(current: RoomLayout): Promise<ManifestBuildResult> {
    let sources: StoredSource[] = [];
    try { sources = await listStoredSources(current.id ?? 'local'); } catch { sources = []; }
    let scene: Scene | null = null;
    try { scene = layoutToBackendScene(current, { assetIdMap: cloudAssetIdMap() }); } catch { scene = null; }
    const archiveAssetIds: Record<string, string> = {};
    if (cloud.user) {
      try {
        for (const job of await sharedArchiveQueue.inventoryForUser(cloud.user.id)) {
          if (job.state === 'uploaded' && job.assetId) archiveAssetIds[job.localId] = job.assetId;
        }
      } catch { /* 队列读不到按缺口处理，不编造已归档 */ }
    }
    const outdoorPlan = current.id ? readOutdoorProjectRecord(current.id)?.plan ?? null : null;
    return buildCompleteManifest({ layout: current, scene, outdoorPlan, sources, cloudAssetIds: cloudAssetIdMap(), archiveAssetIds });
  }
  /**
   * C06（2026-11-20 集成接通）：把当前画布的完整清单保存为云端完整归档（saveCompleteProject）。
   * 需要当前项目租约 + 服务器已确认版本（expectedRevision CAS）；依赖未全部归档时不发请求，
   * 缺口如实展示。场景保存已成功与否由 saveBoundSceneQuiet 的状态机负责，这里的结果
   * （含失败原因）只落在归档页状态里，不冒充完整保存成功。
   */
  async function saveCompleteArchive(): Promise<'saved' | 'blocked' | 'failed'> {
    const projectId = cloud.project?.id;
    if (!projectId) { setCompleteError('先打开一个云端项目再保存完整归档。'); return 'blocked'; }
    const transport = resolveCompleteProjectTransport(controller);
    if (!transport) { setCompleteError('完整项目归档接口未接入（后端契约未部署）。'); return 'blocked'; }
    const snapshot = controller.getSnapshot();
    const lease = snapshot.lease;
    if (!lease || lease.projectId !== projectId) { setCompleteError('没有当前项目的编辑租约；先在项目卡取得编辑权，再保存完整归档。'); return 'blocked'; }
    if (!Number.isFinite(snapshot.revision)) { setCompleteError('还有改动没保存；保存成功后再同步完整归档。'); return 'blocked'; }
    const built = await buildCompleteManifestFor(layoutRef.current);
    const { manifest, complete } = built;
    if (!complete || !manifest.scene) {
      setManifestNote(manifestCompletenessLabel(built));
      setCompleteError(!complete ? '依赖未全部归档；完整归档未保存，缺口见上方依赖清单。' : '场景转码失败；完整归档未保存，本机内容未改动。');
      return 'blocked';
    }
    try {
      const receipt = parseCompleteProjectSnapshot(await transport.saveCompleteProject(projectId, {
        requestId: crypto.randomUUID(),
        sessionId: lease.sessionId,
        generation: lease.generation,
        expectedRevision: snapshot.revision ?? 0,
        manifest,
      }));
      setCompleteInfo({ revision: receipt.revision, confirmedAt: receipt.confirmedAt, dependencyCount: receipt.dependencyCount });
      setCompleteError('');
      setManifestNote(`完整归档已保存：服务器确认 v${receipt.revision} · 依赖 ${receipt.dependencyCount} 项。`);
      return 'saved';
    } catch (error) {
      setCompleteInfo(null);
      setCompleteError(error instanceof Error ? error.message : '完整归档保存失败；本机内容未改动。');
      return 'failed';
    }
  }
  /** C06：向服务器核对当前项目的完整归档（依赖数量 + 确认时间 + 版本）。 */
  async function verifyCompleteProject(): Promise<void> {
    const projectId = cloud.project?.id;
    if (!projectId) throw new Error('先打开一个云端项目再核对完整归档。');
    const transport = resolveCompleteProjectTransport(controller);
    if (!transport) throw new Error('完整项目归档接口未接入（后端契约未部署）。');
    try {
      const snapshot = parseCompleteProjectSnapshot(await transport.getCompleteProject(projectId));
      setCompleteInfo({ revision: snapshot.revision, confirmedAt: snapshot.confirmedAt, dependencyCount: snapshot.dependencyCount });
      setCompleteError('');
    } catch (error) {
      setCompleteInfo(null);
      const status = (error as { status?: unknown } | null)?.status;
      setCompleteError(status === 404 ? '云端还没有这个项目的完整归档。' : error instanceof Error ? error.message : '完整归档核对失败。');
    }
  }
  /**
   * C07：把云端完整项目恢复到画布（场景 + 户外规划）。与「打开本机缓存」同一路径：
   * 只换画布、不绑编辑权，冲突交给打开项目流程；本机已有更新的户外规划时不静默覆盖。
   */
  async function restoreCompleteProject(): Promise<void> {
    const projectId = cloud.project?.id;
    const projectName = cloud.project?.name;
    if (!projectId) throw new Error('先打开一个云端项目再恢复。');
    const transport = resolveCompleteProjectTransport(controller);
    if (!transport) throw new Error('完整项目归档接口未接入（后端契约未部署）。');
    await run(async () => {
      const snapshot = parseCompleteProjectSnapshot(await transport.getCompleteProject(projectId));
      const manifest = snapshot.manifest;
      if (!manifest || !manifest.scene) throw new Error('云端完整归档缺少场景，无法恢复。');
      if (dirty && !window.confirm('当前画布有未保存改动。恢复会替换画布（本机恢复点保留），继续吗？')) return;
      const openingFrom = layoutRef.current;
      onBeforeActivitySwitch?.(openingFrom)?.();
      const next = backendSceneToLayout(manifest.scene as Parameters<typeof backendSceneToLayout>[0], { projectId, name: projectName ?? '云端项目' });
      onLoadLayout(next);
      setBoundLayout(undefined);
      setSavedFingerprint(null);
      let outdoorNote = '';
      if (manifest.outdoor) {
        const existing = readOutdoorProjectRecord(projectId);
        const remoteRevision = snapshot.revision;
        if (existing && typeof existing.remoteRevision === 'number' && existing.remoteRevision > remoteRevision) {
          outdoorNote = ' 本机有更新的户外规划（版本更高），未覆盖。';
        } else {
          try {
            saveOutdoorProjectRecord({
              v: 1, projectId,
              name: projectName ?? existing?.name ?? '户外规划',
              createdAt: existing?.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              plan: manifest.outdoor as SitePlanData,
              ...(existing?.remoteActivityId ? { remoteActivityId: existing.remoteActivityId } : {}),
              remoteRevision,
            }, undefined, false);
          } catch { outdoorNote = ' 户外规划写入本机失败，原件未改动。'; }
        }
      }
      showNotice(`已恢复云端完整项目（版本 ${snapshot.revision}，依赖 ${snapshot.dependencyCount} 项）。素材按权限换取地址；要继续编辑请在项目卡获取编辑权。${outdoorNote}`);
    });
  }
  // §二.4 默认在云上：状态只说结果，不解释文件存在哪。
  // C05：待同步数跟会话 dirty 真值走；「已保存」后面缀上素材归档缺口，不把「场景保存」说成「全部归档」。
  const outstandingArchive = archive.counts.pending + archive.counts.failed + archive.counts.needsFile;
  const archiveSuffix = outstandingArchive > 0 ? ` · 素材待归档 ${outstandingArchive}` : '';
  const saveStatus = conversionError ? '本机草稿' : sceneConnection ? '场景已连接' : !cloud.user || !bound ? '草稿' : cloud.writeBlocked ? '只读' : dirty ? `待同步${archiveSuffix}` : `场景已保存 · v${cloud.revision ?? '—'}${archiveSuffix}`;
  const activeStudio = studios.find(studio => studio.id === studioId) ?? studios[0];
  // 左上角只认身份：有邮箱就写邮箱，没有再用显示名 / 访客。角色和团队名在下面列表里已有。
  const signedInAccount = !!cloud.user && !cloud.user.is_anonymous;
  const menuName = !signedInAccount
    ? '访客'
    : (activeStudio?.displayName?.trim() || cloud.user?.email?.trim() || '我的账户');
  const menuStudio = cloud.user ? (activeStudio?.name?.trim() || '') : '';
  const accountIdentity = menuName;
  const readOnlyStudio = (activeStudio?.role as string | undefined) === 'viewer';
  // Figma 式团队切换：记住的默认工作室由 preferredStudio 给出，左栏只负责把它摆出来并允许换一个。
  // 左栏点团队：切换工作室并回到项目列表（物料 / 团队页不必先点「← 项目」）。
  function openStudioProjects(nextStudioId: string): void {
    setStudioId(nextStudioId);
    if (userId) rememberStudio(userId, nextStudioId);
    setSection('projects');
  }
  /** 新建团队：随便建多少个都行，建完直接切过去（后端 studios.create 返回 owner 角色）。 */
  async function createTeam(): Promise<void> {
    const name = teamName.trim();
    if (!name) { showNotice('先给团队起个名字。', true); return; }
    const created = await controller.businessRequest<Studio>('/studios', 'POST', { requestId: crypto.randomUUID(), name, displayName: name });
    setTeamFormOpen(false); setTeamName('');
    await refreshProjects();
    setStudioId(created.id);
    if (userId) rememberStudio(userId, created.id);
    setSection('projects');
    showNotice(`团队「${created.name}」已创建。`);
  }
  /**
   * 2026-11-18 闭环：团队改名收进「团队」分区（面板顶部点团队名），左栏不再留第二套点名字改名的暗门；
   * 左栏只管切换与新建。点当前团队 = 回到它的项目列表（再点一次不切走语义）。
   */
  /**
   * 2026-11-18 闭环：能建就要能删。服务端 DELETE /studios/:id 早就有（非空团队抛 STUDIO_NOT_EMPTY，
   * 文案已在 backend-session 里翻成中文）。删除入口在「团队」分区的危险区（team-section.tsx 管确认框），
   * 这里只管删完后的状态收尾：换到剩下的第一个团队并回到项目列表。
   */
  async function removeStudio(studio: Studio): Promise<void> {
    await controller.businessRequest(`/studios/${encodeURIComponent(studio.id)}`, 'DELETE');
    const remaining = studios.filter(item => item.id !== studio.id);
    await refreshProjects();
    if (studio.id === studioId) {
      const nextId = remaining[0]?.id ?? '';
      setStudioId(nextId);
      if (userId && nextId) rememberStudio(userId, nextId);
    }
    setSection('projects');
    showNotice(`团队「${studio.name}」已删除。`);
  }
  const teamNav = <nav className="sc-account-teams" aria-label="团队切换">
    <p className="sc-account-teams-label">我的团队</p>
    {studios.length > 0 && <ul>{studios.map(studio => {
      const isActive = studio.id === studioId;
      return <li key={studio.id}><button type="button" className="sc-account-team" aria-label={studio.name} aria-pressed={isActive} title={studio.name} onClick={() => {
        openStudioProjects(studio.id);
      }}><span className="sc-account-team-mark" aria-hidden="true">{studio.name.slice(0, 1).toUpperCase()}</span><span className="sc-account-team-name">{studio.name}</span><span className="sc-account-team-role" aria-hidden="true">{studioRoleLabel(studio.role)}</span></button></li>;
    })}</ul>}
    {!teamFormOpen && <button type="button" className="sc-account-team-create" disabled={busy} onClick={() => setTeamFormOpen(true)}>＋ 新建团队</button>}
    {teamFormOpen && <form className="sc-account-team-form" aria-label="新建团队" onSubmit={event => { event.preventDefault(); void run(createTeam); }}>
      {/* 2026-11-18 用户：「就回车就默认创建了啊」——表单里只留取消，回车即建，Esc 退出。 */}
      <input aria-label="新团队名称" type="text" placeholder="团队名称" maxLength={40} value={teamName} autoFocus
        onChange={event => setTeamName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') { setTeamFormOpen(false); setTeamName(''); } }}/>
      <button type="button" disabled={busy} onClick={() => { setTeamFormOpen(false); setTeamName(''); }}>取消</button>
    </form>}
  </nav>;

  function openAccountSection(next: AccountSection): void {
    setMenuOpen(false);
    setSection(next);
    setAccountOpen(true);
    if (!dialog.current?.open) dialog.current?.showModal();
    focusAuthEmail();
  }
  function openSettings(pane: SettingsPane): void {
    setMenuOpen(false);
    setSettingsPaneRequest(current => ({ serial: current.serial + 1, pane }));
    setSection('settings');
    setAccountOpen(true);
    if (!dialog.current?.open) dialog.current?.showModal();
  }
  function signOutFromMenu(): void {
    void run(async () => {
      await flushSourceScope(layoutRef.current.id ?? 'local');
      await controller.signOut();
      setProjects([]);
      setStudios([]);
      setBoundLayout(undefined);
      setSavedFingerprint(null);
      setMenuOpen(false);
      setSection('projects');
      dialog.current?.close();
    });
  }

  return <>
    <button ref={triggerRef ?? avatarButtonRef} className="sc-cloud-trigger" type="button" aria-label="账户菜单" title="账户" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
      <span className="sc-account-trigger-avatar" aria-hidden="true"><img src={avatar.src} alt=""/></span>
    </button>
    <AccountMenu
      open={menuOpen}
      onClose={() => setMenuOpen(false)}
      anchorRef={triggerRef ?? avatarButtonRef}
      displayName={menuName}
      studioName={menuStudio}
      showSignOut={!!cloud.user}
      busy={busy}
      onOpenProjects={() => openAccountSection('projects')}
      onOpenAssets={() => openAccountSection('assets')}
      onOpenTeam={() => openAccountSection('team')}
      onOpenSettings={() => openSettings('personal')}
      onSignOut={signOutFromMenu}
      appearanceMode={appearance?.mode ?? 'system'}
      onAppearanceModeChange={next => appearance?.setMode(next)}
      {...(planContext ? { plan: planContext } : {})}
      {...(onCapturePlan ? { onCapturePlan } : {})}
    />
    {typeof document === 'undefined' ? null : createPortal(<dialog ref={dialog} className={`sc-cloud-dialog sc-account-dialog${cloud.user ? '' : ' is-auth'}`} aria-labelledby={cloud.user && section === 'team' ? 'sc-team-title' : cloud.user && section === 'settings' ? 'sc-settings-title' : 'cloud-title'} onClose={() => { setAccountOpen(false); onClose?.(); }} onClick={closeDialogOnBackdrop} onKeyDown={event => event.stopPropagation()}>
      {cloud.user ? <div className="sc-account-scroll">
      <h2 id="cloud-title" className="sc-account-title-hidden">账户中心</h2>
      <button className="sc-cloud-close sc-account-close-float" type="button" aria-label="关闭账户面板" autoFocus onClick={() => dialog.current?.close()}><X size={18}/></button>
      <div className="sc-account-shell">
      <aside className="sc-account-side" aria-label="账户与团队">
      <div className="sc-account-studio">
        {cloud.user
          ? <button ref={avatarPickerAnchorRef} className="sc-account-avatar" type="button" title={`更换头像 · ${avatar.name}`} aria-label={`更换头像，当前 ${avatar.name}`} aria-expanded={avatarPickerOpen} onClick={() => {
              if (avatarPickerOpen) { setAvatarPickerOpen(false); return; }
              const rect = avatarPickerAnchorRef.current?.getBoundingClientRect();
              // 选择器宽 236px，比左栏（165px 内容宽、overflow:auto）宽，留在左栏会被裁掉最后一列；
              // 改成相对对话框定位。模态 <dialog> 在顶层，fixed 的包含块就是对话框本身，所以坐标减掉对话框原点再夹回框内。
              const host = dialog.current?.getBoundingClientRect();
              setAvatarPickerPos(rect ? {
                left: Math.max(8, Math.min(rect.left - (host?.left ?? 0), (host?.width ?? window.innerWidth) - 244)),
                top: rect.bottom - (host?.top ?? 0) + 6,
              } : null);
              setAvatarPickerOpen(true);
            }}><img src={avatar.src} alt=""/></button>
          : <span className="sc-account-avatar" aria-hidden="true"><UserRound size={20}/></span>}
        <div>
          <strong title={activeStudio?.name || accountIdentity}>{activeStudio?.name || accountIdentity}</strong>
          <span>{activeStudio ? studioRoleLabel(activeStudio.role) : '当前账户'}</span>
        </div>
        {avatarPickerOpen && cloud.user && <div className="sc-account-avatar-picker" style={avatarPickerPos ? { position: 'fixed', left: avatarPickerPos.left, top: avatarPickerPos.top } : undefined} role="group" aria-label="预设头像">
          <span className="sc-account-avatar-picker-title">选择头像</span>
          {AVATAR_PRESETS.map(item => <button key={item.id} type="button" title={item.name} aria-label={item.name} aria-pressed={avatar.id === item.id} onClick={() => { setAvatar(item); saveAvatar(userId, item.id); setAvatarPickerOpen(false); }}><img src={item.src} alt=""/></button>)}
        </div>}
        {/* 未登录时浮窗整块是 AuthCard，这里不再放第二套登录入口。 */}
      </div>
      <nav className="sc-account-nav" aria-label="账户分区">
        <button type="button" aria-pressed={section === 'projects'} onClick={() => setSection('projects')}><FolderOpen size={15} aria-hidden="true"/>所有方案</button>
        <button type="button" aria-pressed={section === 'assets'} onClick={() => setSection('assets')}><Images size={15} aria-hidden="true"/>物料</button>
        <button type="button" aria-pressed={section === 'archive'} onClick={() => setSection('archive')}><Box size={15} aria-hidden="true"/>归档</button>
        {/* 2026-11-22 用户拍板：团队是一级分区（11-18 对标结论「不把成员管理搬进设置页」），不是设置里的页签。 */}
        <button type="button" aria-pressed={section === 'team'} onClick={() => openAccountSection('team')}><UsersRound size={15} aria-hidden="true"/>团队</button>
        <button type="button" aria-pressed={section === 'settings'} onClick={() => openSettings('personal')}><Settings size={15} aria-hidden="true"/>设置</button>
      </nav>
      {teamNav}
      </aside>
      <div className="sc-account-main">
      <div className="sc-account-body">
      <section hidden={section !== 'projects'} aria-label="我的项目">
      {/* 只留项目卡片墙；本机草稿也是其中一张卡，不再叠一层「最近活动」。 */}
      {sceneConnection && <section className="sc-cloud-current" aria-label="当前活动的场景连接">
        <h3>场景助手已连接</h3>
        <p>只用于助手处理当前场景。</p>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await controller.disconnectGeometryWorkbench(); showNotice('场景服务已断开。下次使用助手时会重新连接。'); })}>断开场景服务</button>
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
            {/* 标题带当前团队名：改完名这一行跟着变，不用回左栏确认。 */}
            {activeStudio && <span className="sc-account-team-current" title="当前团队">{activeStudio.name}</span>}
            <button type="button" className="sc-account-icon-btn" disabled={busy || loadingProjects} aria-label="刷新" title="刷新" onClick={() => void run(refreshProjects)}><RefreshCw size={15}/></button>
            {activeStudio?.role === 'owner' && <button type="button" className="sc-account-icon-btn" disabled={busy} aria-label="最近删除" title="最近删除（保留 7 天）" aria-pressed={trashOpen} onClick={() => {
              const next = !trashOpen;
              setTrashOpen(next);
              if (next && typeof controller.listTrash === 'function') {
                void controller.listTrash().then(setTrash).catch(() => showNotice('回收站加载失败，请稍后重试。', true));
              }
            }}><Trash2 size={15}/></button>}
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
              <span className={`sc-file-thumb${projectCovers[canvasCoverId] ? ' has-preview' : ''}`} aria-hidden="true">
                <ProjectThumb projectId={canvasCoverId} cover={projectCovers[canvasCoverId]} fallback={coverMark()} eager/>
                <span className="sc-file-state">当前 · 本机</span>
              </span>
              <span className="sc-file-info"><strong>{draftCardName}</strong><small>本机 · 未上传</small></span>
            </button>
            <details className="sc-file-more">
              <summary aria-label={`${draftCardName} 更多操作`} title="更多"><MoreHorizontal size={16} aria-hidden="true"/></summary>
              <div className="sc-file-more-menu" role="group" aria-label={`${draftCardName} 操作`}>
                <button type="button" disabled={busy || !studioId || !!conversionError} onClick={event => {
                  (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  void run(saveDraftAsProject);
                }}>存为方案</button>
                <button type="button" disabled={busy} onClick={event => {
                  (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                  void discardLocalDraft();
                }}>删除活动</button>
              </div>
            </details>
          </li>}
          {filteredProjects.map(project => {
            const current = project.id === cloud.project?.id;
            const editingElsewhere = !current && project.current_editor && project.lease_expires && Date.parse(project.lease_expires) > Date.now();
            const status = current
              ? `当前 · ${saveStatus}`
              : cachedProjects[project.id] ? '本机缓存' : readOnlyStudio ? '只读' : editingElsewhere ? '他人编辑中' : '';
            // 本机活动升上云的项目：封面/规划留在旧活动 id 上，卡上先按旧 id 找一遍。
            const aliasId = projectAliases[project.id];
            const cover = projectCovers[project.id] ?? (aliasId ? projectCovers[aliasId] : undefined);
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
                <span className={`sc-file-thumb${cover ? ' has-preview' : ''}`} aria-hidden="true">
                  <ProjectThumb projectId={project.id} aliasId={aliasId} cover={cover} fallback={coverMark()}/>
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
                      showNotice('编辑权已释放，队友可以接手。');
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
                  {cachedProjects[project.id] && <button type="button" disabled={busy} onClick={event => {
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    void run(async () => { await openCachedProject(project); });
                  }}>打开本机缓存</button>}
                  {activeStudio?.role === 'owner' && <button type="button" disabled={busy} onClick={event => {
                    (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
                    void run(async () => { await removeProject(project); });
                  }}>删除</button>}
                </div>
              </details>}
            </li>;
          })}
          {!readOnlyStudio && <li className="sc-file-card is-new">
            <button type="button" className="sc-file-new" aria-label="新方案" disabled={busy || sceneConnection || !studioId || !cloud.writeBlocked || !!conversionError} onClick={() => {
              // 场地出发：由工作台的 VenuePicker 统一接管（空白 / 地图 / 复刻 / 现有项目）。
              // 独立渲染（无 VenuePicker 监听）时保留旧的“当前画布另存”兜底。
              const request = new CustomEvent('scendance:start-new-project', { cancelable: true });
              if (!window.dispatchEvent(request)) { setAccountOpen(false); dialog.current?.close(); return; }
              void run(async () => {
              const current = layoutRef.current;
              if(projectedCreation.current&&sameRecoveryFormValue(projectedCreation.current.base,current)){showNotice(`云端项目已创建（编号 ${projectedCreation.current.projectId}），目前仅供只读核对；本机草稿未替换，请先核对原项目。`);return;}
              assertNoLocalHandoffCloudTransition(current);
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
              const created = await controller.createProject(studioId, current.name, layoutToBackendScene(current), current.id);
              if(created.projection?.requiresOriginalSceneForWrite){
                projectedCreation.current={base:structuredClone(current),projectId:created.id};
                suspendFailedReplacement(created.id);
                await refreshProjects().catch(()=>{});
                showNotice(`云端项目已创建（编号 ${created.id}），但含未核验原始记录，目前仅供只读核对；本机草稿未绑定、未替换，云端写入已暂停。`);return;
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
                let nextScene = created.scene;
                try { nextScene = (await controller.acquireLease(created.id)).scene; } catch { /* 建完仍可只读打开，不阻断创建回执 */ }
                await acceptScene(nextScene, created.id, created.name, current,checkSwitch);
              } catch (error) {
                if(controller.getSnapshot().project?.id===created.id)suspendFailedReplacement(created.id);
                throw new Error(`云端创建请求已返回，结果待核对；当前画布未替换。${error instanceof Error ? error.message : '请保留原草稿并核对资料。'}`);
              }
              await refreshProjects(); showNotice(`新项目已保存。${controller.getSnapshot().writeBlocked ? '这份暂时只读，需要改动时在卡片上取回编辑权。' : ''}${sourceNotice}`);
            }); }}>
              <span className="sc-file-new-mark" aria-hidden="true">＋</span>
              <span>新方案</span>
            </button>
          </li>}
        </ul>
        {trashOpen && activeStudio?.role === 'owner' && <section aria-label="最近删除" className="sc-account-trash">
          <div className="sc-account-section-heading"><div className="sc-account-section-title"><h4>最近删除</h4></div><span className="sc-note">保留 7 天 · 只恢复项目本体，分享需重新发布</span></div>
          {!trash.length && <p className="sc-account-empty">回收站为空，项目保留 7 天。</p>}
          <ul className="sc-trash-list">
            {trash.map(item => <li key={item.id} className="sc-trash-item">
              <span><strong>{item.name}</strong><small>删除于 {new Date(item.deleted_at).toLocaleString()}</small></span>
              <button type="button" className="sc-button" disabled={busy} onClick={() => { void run(async () => { await restoreProject(item); }); }}>恢复</button>
            </li>)}
          </ul>
        </section>}
        {originalReview&&originalReviewCurrent()&&<OriginalSceneReviewPanel key={`${originalReview.projectId}:${originalReview.token.epoch}`} scopeKey={`${originalReview.projectId}:${originalReview.token.epoch}`} isCurrent={originalReviewCurrent} loadOriginal={loadOriginal} enableLocalPreview allowLocalConfirm={ORIGINAL_SCENE_SUBMISSION_ENABLED&&!!localWriteCapability} onConfirmLocal={confirmOriginal}/>}
        {!loadingProjects && !!studioProjects.length && !filteredProjects.length && !showDraftCard && <div className="sc-account-empty"><p>没有匹配的项目</p>{query && <button type="button" onClick={() => { setQuery(''); }}>清除筛选</button>}</div>}
        </section>
      </div>}
      </section>
      <section hidden={section !== 'assets'} aria-label="账户物料"><div className="sc-account-section-heading"><div className="sc-account-section-title"><h3>物料</h3><InfoTip label="物料说明"><strong>与物料面板同一套分类</strong><span>我的生成 / 收藏 / 库，和画布里的物料面板保持一致。</span></InfoTip></div></div>{cloud.user ? <AssetsPanel controller={controller} layout={layout} onApplyLayout={onApplyLayout ?? onLoadLayout} bound={bound} busy={busy} /> : <p className="sc-account-empty">登录后查看物料。</p>}</section>
      <section hidden={section !== 'archive'} aria-label="云端归档">
        <div className="sc-account-section-heading"><div className="sc-account-section-title">
          <h3>云端归档</h3>
          <button type="button" className="sc-account-icon-btn" disabled={busy || !archive.transport} aria-label="补传队列" title="补传所有未完成的归档" onClick={() => void run(async () => { await archive.retry(); showNotice('补传已执行；状态见下方队列。'); })}><RefreshCw size={15}/></button>
        </div></div>
        {!cloud.user ? <p className="sc-account-empty">登录后查看云端归档。</p> : <>
          {archive.unavailableMessage && <p className="sc-account-footnote" role="status">{archive.unavailableMessage}</p>}
          {archive.capabilities && <p className="sc-account-footnote" role="status">
            {archive.capabilities.superAdmin
              ? `平台管理员归档通道已接通${archive.capabilities.officialStudioId ? '；官方内容按授权共同归属归档' : ''}。`
              : '归档通道已接通：本账号按普通私有范围归档。'}
          </p>}
          {archive.capabilityError && <p className="sc-account-footnote" role="status">{archive.capabilityError}</p>}
          <p className="sc-account-footnote" role="status">
            {saveStatusState.stage === 'cloud-saved' && saveStatusState.cloudConfirmedAt
              ? `最近云端确认：${saveStatusState.cloudRevision !== null ? `v${saveStatusState.cloudRevision} · ` : ''}${new Date(saveStatusState.cloudConfirmedAt).toLocaleString()}`
              : saveStatusState.stage === 'conflict'
                ? '存在版本冲突，等你在项目卡或户外提示里选择保留哪一版。'
                : saveStatusState.stage === 'failed'
                  ? `云端最近一次同步失败：${saveStatusState.failure ?? ''}`
                  : '云端还没有确认过这个项目的版本。'}
          </p>
          {archive.transport && <>
            <section aria-label="补传队列">
              <div className="sc-account-section-heading"><div className="sc-account-section-title"><h4>补传队列</h4><span className="sc-note">进度与失败原因在这里；刷新/重开后队列继续，原文件保留在本机。</span></div></div>
              <p className="sc-account-footnote" role="status">
                {archive.draining ? '正在补传…' : '队列空闲'}
                {` · 待补传 ${archive.counts.pending} · 失败 ${archive.counts.failed} · 需原文件 ${archive.counts.needsFile} · 已归档 ${archive.counts.uploaded}`}
              </p>
              {archive.jobs.length === 0 ? <p className="sc-account-empty">队列为空，上传后留底可查。</p> : <ul className="sc-trash-list">
                {archive.jobs.slice(0, 8).map(job => <li key={job.key} className="sc-trash-item">
                  <span><strong>{job.name}</strong><small>{archiveJobLabel(job)}</small></span>
                  {job.state !== 'uploaded' && <button type="button" className="sc-button" disabled={busy || !archive.transport} onClick={() => void run(async () => { await archive.retry(); })}>重试</button>}
                </li>)}
              </ul>}
            </section>
            <section aria-label="本机存量盘点" className="sc-archive-section">
              <div className="sc-archive-overview">
                <div className="sc-archive-overview-head">
                  <h4>本机存量盘点</h4>
                  <span className="sc-archive-range">私有空间</span>
                </div>
                <p className="sc-note">只盘点不删除；资料图按当前活动清点，户外规划按本机记录清点。</p>
                {inventory ? (
                  <>
                    {(() => {
                      const c = inventoryView.counts;
                      const nonDemo = inventoryView.items.length - c.demo;
                      const pct = (n: number) => nonDemo > 0 ? `${(n / nonDemo) * 100}%` : '0%';
                      const cloudN = c.private + c.public + c.activity;
                      return (
                        <>
                          <div className="sc-archive-progress" role="img" aria-label={`云端副本 ${cloudN} 项，仅本机 ${c.local} 项`}>
                            {c.private > 0 && <i className="seg-private" style={{ width: pct(c.private) }} />}
                            {c.public > 0 && <i className="seg-public" style={{ width: pct(c.public) }} />}
                            {c.activity > 0 && <i className="seg-activity" style={{ width: pct(c.activity) }} />}
                            {c.local > 0 && <i className="seg-local" style={{ width: pct(c.local) }} />}
                          </div>
                          <div className="sc-archive-legend">
                            <span className="legend-dot"><b className="seg-private" />私有归档 {c.private}</span>
                            <span className="legend-dot"><b className="seg-public" />公共库副本 {c.public}</span>
                            <span className="legend-dot"><b className="seg-activity" />活动副本 {c.activity}</span>
                            <span className="legend-dot"><b className="seg-local" />仅本机 {c.local}</span>
                            <span className="legend-dot">内置示例 {c.demo}（不计入计数）</span>
                          </div>
                        </>
                      );
                    })()}
                  </>
                ) : <p className="sc-account-footnote" role="status">正在盘点…</p>}
              </div>

              {inventoryView.items.length === 0 ? (
                <p className="sc-account-empty is-bare">{inventory ? '本机没有待盘点的素材记录。' : '正在盘点…'}</p>
              ) : INVENTORY_GROUPS.map(group => {
                const groupItems = inventoryView.items.filter(item => item.type === group.type);
                if (groupItems.length === 0) {
                  return (
                    <section className="sc-archive-group" key={group.type}>
                      <div className="sc-archive-group-head">
                        <span className="sc-archive-group-icon"><group.Icon size={14} aria-hidden="true" /></span>
                        <h5>{group.label}</h5>
                        <span className="sc-archive-count">0</span>
                      </div>
                      <p className="sc-account-empty is-bare">本机没有此类记录。</p>
                    </section>
                  );
                }
                const real = groupItems.filter(item => !isReplicaCaseItem(item));
                const demo = groupItems.filter(item => isReplicaCaseItem(item));
                const countLabel = demo.length > 0 ? `${real.length} 草稿 · ${demo.length} 示例` : `${groupItems.length}`;
                return (
                  <section className="sc-archive-group" key={group.type}>
                    <div className="sc-archive-group-head">
                      <span className="sc-archive-group-icon"><group.Icon size={14} aria-hidden="true" /></span>
                      <h5>{group.label}</h5>
                      <span className="sc-archive-count">{countLabel}</span>
                    </div>
                    <ul className="sc-archive-rows">
                      {real.map(item => <InventoryRow key={`${item.type}:${item.localId}`} item={item} Icon={group.Icon} />)}
                    </ul>
                    {demo.length > 0 && (
                      <>
                        <p className="sc-archive-sub-head">内置示例</p>
                        <ul className="sc-archive-rows">
                          {demo.map(item => <InventoryRow key={`${item.type}:${item.localId}`} item={item} Icon={group.Icon} />)}
                        </ul>
                      </>
                    )}
                  </section>
                );
              })}
              <button type="button" className="sc-button" disabled={busy || !archive.scope || !inventory || inventory.summary.pending === 0}
                onClick={() => void run(async () => {
                  if (!archive.scope || !inventory) return;
                  const queued = await enqueuePendingInventoryItems(inventory, archive.scope, async input => { await archive.enqueueAholoAsset(input.localId); });
                  await archive.refresh();
                  showNotice(queued > 0 ? `已把 ${queued} 项加入补传队列。` : '没有可补传的本机原件；需要原文件的项已在清单里列出。');
                })}>补传本机素材</button>
              <div className="sc-account-section-heading"><div className="sc-account-section-title"><h4>依赖清单</h4><span className="sc-note">完整保存 = 场景 + 户外 + 资料图的原文件都在云端可授权访问。</span></div></div>
              <button type="button" className="sc-button" disabled={busy} onClick={() => void run(async () => { await checkCurrentManifest(); })}>核对当前依赖</button>
              <button type="button" className="sc-button" disabled={busy} onClick={() => void run(async () => {
                const outcome = await saveCompleteArchive();
                if (outcome === 'saved') showNotice('完整归档已保存；服务器已确认版本与依赖数量。');
                else if (outcome === 'failed') showNotice('完整归档保存失败；原因见下方状态。');
              })}>保存完整归档</button>
              {manifestNote && <p className="sc-account-footnote" role="status">{manifestNote}</p>}
            </section>
            <section aria-label="云端资产">
              <div className="sc-account-section-heading"><div className="sc-account-section-title"><h4>云端资产</h4><span className="sc-note">未放进任何项目的原文件也能在这里找回；地址按权限临时换取。</span></div></div>
              {cloudAssetsError && <p className="sc-account-error" role="alert">{cloudAssetsError}</p>}
              {cloudAssets === null && !cloudAssetsError ? <p className="sc-account-empty">云端资产列表未读取。</p> : null}
              {cloudAssets?.length === 0 && <p className="sc-account-empty">云端还没有归档资产。</p>}
              {cloudAssets && cloudAssets.length > 0 && <ul className="sc-trash-list">
                {cloudAssets.slice(0, 12).map(asset => <li key={asset.id} className="sc-trash-item">
                  <span><strong>{asset.name}</strong><small>{asset.kind} · {formatArchiveBytes(asset.byteSize)} · {asset.id.slice(0, 8)}…</small></span>
                  <button type="button" className="sc-button" disabled={busy} onClick={() => void run(async () => {
                    const url = await fetchArchiveAssetUrl(archive.transport!, asset.id);
                    await navigator.clipboard.writeText(url.url);
                    showNotice(`已复制「${asset.name}」的临时读取地址（${url.expiresIn} 秒内有效）。`);
                  })}>复制地址</button>
                </li>)}
              </ul>}
            </section>
            <section aria-label="完整项目">
              <div className="sc-account-section-heading"><div className="sc-account-section-title"><h4>完整项目核对与恢复</h4><span className="sc-note">完整归档由服务器确认依赖数量与版本；恢复只换画布，不绑编辑权。</span></div></div>
              {!resolveCompleteProjectTransport(controller) ? <p className="sc-account-footnote" role="status">完整项目归档接口未接入（后端契约未部署）；不能显示虚假的完整保存状态。</p> : <>
                {cloud.project ? <div>
                  <button type="button" className="sc-button" disabled={busy} onClick={() => void run(async () => { await verifyCompleteProject(); })}>核对完整归档</button>
                  <button type="button" className="sc-button" disabled={busy} onClick={() => void restoreCompleteProject()}>恢复到画布</button>
                </div> : <p className="sc-account-empty">打开云端项目后可核对归档。</p>}
                {completeInfo && <p className="sc-account-footnote" role="status">{`服务器确认：v${completeInfo.revision} · 依赖 ${completeInfo.dependencyCount} 项 · ${new Date(completeInfo.confirmedAt).toLocaleString()}`}</p>}
                {completeError && <p className="sc-account-error" role="alert">{completeError}</p>}
              </>}
            </section>
          </>}
        </>}
      </section>
      {cloud.user && section === 'team' ? <section className="sc-account-team-page" aria-label="团队">
        <TeamSection
          controller={controller}
          studioId={studioId}
          {...(activeStudio ? { studioName: activeStudio.name } : {})}
          owner={activeStudio?.role === 'owner'}
          signedIn={!!cloud.user && !cloud.user.is_anonymous}
          studioSettings={studioSettings}
          studioStatus={cloud.user && !cloud.user.is_anonymous ? studioSettingsStatus : 'signed-out'}
          {...(studioSettingsError ? { studioError: studioSettingsError } : {})}
          onSaveStudioSettings={async (patch: StudioSettingsPatch) => {
            if (!studioId) throw new Error('还没有团队。');
            const saved = sanitizeStudioSettings(await controller.saveStudioSettings(studioId, patch));
            setStudioSettings(saved);
            rememberStudioSettings(studioId, saved);
            setStudioSettingsStatus('ready');
          }}
          onStudioRenamed={(targetId, name) => setStudios(current => current.map(item => item.id === targetId ? { ...item, name } : item))}
          {...(activeStudio?.role === 'owner' ? { onDeleteStudio: () => { void run(async () => { await removeStudio(activeStudio); }); } } : {})}
        />
      </section> : null}
      <section hidden={section !== 'settings'} className="sc-account-settings" aria-label="账户设置">
        <SettingsPage
          preferences={preferences}
          onPreferenceChange={onPreferenceChange}
          preferenceStatus={cloud.user && !cloud.user.is_anonymous ? '已登录：本机先记下，再同步到账号。云端失败不挡画布。' : '未登录：只存在这台设备。'}
          layout={layout}
          {...(onPlanSettingsChange ? { onPlanSettingsChange } : {})}
          {...(siteQuote ? { siteQuote } : {})}
          studioSettings={studioSettings}
          paneRequest={settingsPaneRequest}
          onOpenShortcuts={openShortcutCoach}
        />
      </section>
      {/* 项目相关提示只挂在项目页，别跟到团队 / 物料里吵。 */}
      {section === 'projects' && conversionError && <p className="sc-account-error" role="alert">{conversionError}</p>}
      {section === 'projects' && floorplanOnlyLocal && <p className="sc-account-footnote">底图只保留在本机，云端方案不包含底图；本机草稿仍保留原图。</p>}
      {section === 'projects' && localHandoff && !sceneConnection && notice !== LOCAL_HANDOFF_CLOUD_MESSAGE && <p className="sc-account-error" role="alert">{LOCAL_HANDOFF_CLOUD_MESSAGE}</p>}
      {/* 通用操作回执（删除 / 改名失败等 run() 的结果）在项目页与团队分区都要看得见；其余项目提示仍只挂项目页。 */}
      {(section === 'projects' || section === 'team') && notice && <p className={noticeError ? 'sc-account-error' : 'sc-account-footnote'} role={noticeError ? 'alert' : 'status'}>{notice}</p>}
      {section === 'projects' && cloud.error && cloud.error.code !== 'ROUTE_NOT_FOUND' && notice !== cloud.error.message && <p className="sc-account-error" role="alert">{cloud.error.message}</p>}
      {section === 'projects' && cloud.error?.code==='CANVAS_PROJECT_MISMATCH' && cloud.lease && <button type="button" disabled={busy} onClick={()=>void run(async()=>{await controller.releaseLeaseAfterCanvasMismatch(cloud.lease!.projectId);showNotice('原编辑权已释放；请保留当前草稿，重新打开活动核对。');})}>重试释放原编辑权</button>}
      </div>
      </div>
      </div>
      </div> : <>
        <h2 id="cloud-title" className="sc-account-title-hidden">账户中心</h2>
        {/* 2026-11-14 修复：未登录弹层的 autoFocus 原本落在关闭钮上，按回车=直接关弹层；焦点改由 AuthCard 的邮箱框接管。 */}
        <button className="sc-cloud-close sc-account-close-float" type="button" aria-label="关闭账户面板" onClick={() => dialog.current?.close()}><X size={18}/></button>
        <AuthCard controller={controller} onAuthenticated={handleAuthenticated} />
      </>}
    </dialog>, document.body)}
  </>;
}
