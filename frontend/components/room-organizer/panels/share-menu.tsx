'use client';

/**
 * 画布右上角的「分享」。
 * 2026-11-17 锁定稿：一枚 32×32 线稿箭头，弹出三页（分享 / 发布 / 导出）。
 * 发布走既有 POST /projects/:id/publish，复制的是那次返回的只读页地址；
 * 二维码只在已发布、且点开小键之后出现。评审链接与 Bingo 标记仍走 onIssueReviewLink。
 * 导出只挂已经接到工作台的回调，不新造下载。
 */
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { readBingoSnapshot } from '../lib/bingo-status';
import { catalogGroupLabel } from '../lib/catalog-taxonomy';
import { detectCloudCaseSession } from '../lib/cloud-cases';
import { ensurePublishedArchiveNow } from '../lib/complete-archive';
import { convertMetres } from '../lib/display-units';
import { publishGateSnapshot, type PublishGateSnapshot } from '../lib/project-manifest';
import { evaluatePublishBlockers, hasUnpublishedChanges, type PublishBlockerAction } from '../lib/publish-flow';
import { REVIEW_MARK_CHANGED_EVENT, forgetReviewLinkMark, readReviewMarks } from '../lib/review-share';
import { reviewCodeFromHash, reviewCodeFromPath } from '../../review-share-page/review-link-cloud';
import { appendShareRecord, mergeShareRows, readShareRecords, type ServerShare } from '../lib/share-records';
import { isStructuralMarker } from '../lib/structural-layout';
import { bingoBadgeCount, setBingoSending, useBingoSending } from './bingo-status-mark';
import { CaseAdminSection } from './case-admin';
import { SHARE_READ_ONLY_LINE, SharePanel, type PublishFeedback, type PublishPrecheckState, type PublishRecordsState, type PublishSummaryItem, type ShareBingoStatus, type ShareExportEntry, type ShareTab } from './share-panel';
import type { DisplayUnit, RoomLayout } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

export { SHARE_READ_ONLY_LINE };

export interface PublishedLink {
  /** 手机打开即可看的只读页（云端发布那条）。 */
  url: string;
  revision: number;
  shareId?: string;
  /** 同一版顺手生成的只读场地页（/site#s2=…）：客户拿到的是它，自带快照。 */
  siteUrl?: string;
  /**
   * 发布回执的当前性校验（2026-11-20 P0-A，主计划 §4.1；接口要求 room-organizer 提供）：
   * 发布动作开始时捕获活动/楼层/方案上下文，回执返回时为假表示这次结果对应的是旧快照，
   * 分享卡不再展示或复制它。旧宿主不提供时，分享卡退回项目/会话级的自身校验。
   */
  isCurrent?: () => boolean;
}

/** 发布失败的「结果未知」标记（主计划 §4.6）：请求已发出但回应丢失，服务端可能已成功。 */
export interface PublishAmbiguousError extends Error { publishAmbiguous?: boolean }

/** publishVersion 重抛网络/超时类错误时保留此标记；分享卡据此用服务端分享清单核对，不直接断言失败。 */
export function isAmbiguousPublishFailure(error: unknown): error is PublishAmbiguousError {
  return error instanceof Error && (error as PublishAmbiguousError).publishAmbiguous === true;
}

export interface ShareMenuActions {
  /** 生成一份可留言的方案页链接。 */
  onIssueReviewLink(permissions?: { pins: boolean; levels: boolean; basemap: boolean }): Promise<{ url: string; isCurrent:()=>boolean }>;
  /** 切到 Bingo 审校台。Bingo 是内部去处，不生成第二条评审链接。 */
  onOpenBingo?(): void;
  /** 把当前保存的版本发布成只读页，返回扫码链接。 */
  onPublish(): Promise<PublishedLink>;
  /** 打开既有的完整活动交接确认，不切执行模式。 */
  /** 生成自带快照的只读 3D 查看链接（/view#s1=...），并复制到剪贴板。 */
  onGenerateShareLink?(): Promise<{ url: string; name: string; objects: number; droppedAssets: number } | null>;
  onExportHandoff(): void;
  /** 打开既有的云项目 / 素材库，不新开路由。 */
  onOpenMaterials(): void;
  /** 到场清单抽屉。调用方不得因此把 workbenchMode 设成 delivery。 */
  onOpenChecklist(): void;
  /** 导出当前效果图 PNG（收编到分享面板；原独立导出钮退役）。 */
  onExportImage?(): Promise<boolean> | void;
  /** 导出物料清单 CSV（户外方案；室内无对应链路则不传）。 */
  onExportCsv?: (() => void) | undefined;
  /** 导出场地几何 GeoJSON（户外方案）。 */
  onExportGeoJson?: (() => void) | undefined;
  /** 导出 PDF 演示稿排版（户外方案）。 */
  onPrintDeck?: (() => void) | undefined;
  /** 拉取服务端分享清单（版本/时间/撤回，权威）；没接时卡片只显示本机记录。 */
  onListShares?(): Promise<ServerShare[]>;
  /** 撤回一条已生成的分享链接；服务端作废 token，只读页立即失效。 */
  onRevokeShare?(shareId: string): Promise<void>;
  /** 作废一条评审短链；服务端吊销后原地址立即失效。只接云端短链，长链快照无法远程收回。 */
  onRevokeReviewLink?(code: string): Promise<void>;
  /** 抓当前画布真实一帧当预览（户外 2D/3D、室内各走各的抓帧句柄）；抓不到时卡片退回示意图。 */
  onCapturePreview?(): Promise<string | null>;
  /**
   * P1-A（接口约定 §2）：发布预检阻塞项的既有恢复动作入口。宿主接到真实链路
   * （登录/保存/归档/冲突）后传入；没有时预检只说明不放必失败按钮。
   */
  onPrecheckAction?(action: string): void;
  /**
   * 宿主真实接得上的恢复动作（PublishBlockerAction 取值）。只有列在这里的动作才渲染按钮，
   * 其余只在清单里说明原因——避免「点了去登录却打开物料库」这类假恢复路径（主计划 PUB-03）。
   */
  precheckActions?: string[];
  /**
   * 已登录、方案已挂上项目、但没有编辑权。
   * 未发布页不给绿色「发布并复制链接」，只留只读说明。
   */
  readOnly?: boolean;
}

/**
 * 发布按钮要不要收成只读说明。
 * 跟发布动作的判断同一条：没连上、没登录、方案还没挂项目时仍走各自的提示，不算这条只读。
 */
export function sharePublishReadOnly(snapshot: {
  configured: boolean;
  user: { is_anonymous?: boolean } | null;
  project: { id?: string | null } | null;
  writeBlocked: boolean;
}, layoutId?: string): boolean {
  if (!snapshot.configured || !snapshot.user || snapshot.user.is_anonymous) return false;
  const projectId = snapshot.project?.id || layoutId;
  if (!projectId) return false;
  return snapshot.writeBlocked;
}

/** Bingo 行右侧用产品已有的三态，不另起「已送」。 */
export function shareBingoStatus(
  projectId: string | undefined,
  sentNow: boolean,
  storage: { getItem(key: string): string | null } | null,
): ShareBingoStatus {
  let returned = false;
  let waiting = false;
  try {
    const snap = readBingoSnapshot(storage);
    const mine = projectId ? snap.plans.filter(plan => plan.projectKey === projectId) : [];
    returned = mine.some(plan => plan.returned);
    waiting = mine.length > 0;
  } catch { /* 读不到记录时只看这一次有没有送出 */ }
  if (returned) return '已回执';
  if (waiting || sentNow) return '待评';
  return '待发';
}

/** 这一份方案还没回执的链接数。0 不画进环里。 */
export function shareBingoCount(
  projectId: string | undefined,
  storage: { getItem(key: string): string | null } | null,
): string {
  try {
    const snap = readBingoSnapshot(storage);
    const mine = projectId ? snap.plans.filter(plan => plan.projectKey === projectId && !plan.returned) : [];
    return bingoBadgeCount(mine.length);
  } catch {
    return '';
  }
}

export interface PlanOutline {
  size: string;
  floors: string[];
  itemCount: number;
  categories: { label: string; count: number }[];
  zones: string[];
  variants: { name: string; active: boolean }[];
}

/** 项目大纲：场地、楼层、物料分类、分区、设计簿。只读摘要，不改画布。 */
export function planOutline(layout: RoomLayout, unit: DisplayUnit = 'm'): PlanOutline {
  const floors = layout.floors ?? [];
  const items = floors.flatMap(floor => floor.items.filter(item => !isStructuralMarker(item)));
  const counted = new Map<string, number>();
  for (const item of items) {
    const label = catalogGroupLabel(item.category ?? '');
    counted.set(label, (counted.get(label) ?? 0) + 1);
  }
  const categories = [...counted].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count).slice(0, 3);
  const zones = floors.flatMap(floor => (floor.zones ?? []).map(zone => zone.name?.trim())).filter((name): name is string => !!name);
  const variants = (layout.designBook?.variants ?? []).map(variant => ({ name: variant.name, active: variant.id === layout.designBook?.activeId }));
  return {
    size: unit === 'ft'
      ? `${feet(layout.width)} × ${feet(layout.height)} ft`
      : `${meters(layout.width)} × ${meters(layout.height)} m`,
    floors: floors.map((floor, index) => floor.name?.trim() || `第 ${index + 1} 层`),
    itemCount: items.length,
    categories,
    zones,
    variants,
  };
}

/** 分享钮两态：白底线稿。打开只换绿描边和同色箭头，不铺绿底。 */
export function shareTriggerChrome(open: boolean): CSSProperties {
  return {
    width: 32,
    height: 32,
    minWidth: 32,
    minHeight: 32,
    boxSizing: 'border-box',
    padding: 0,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: open ? 1.2 : 0.6,
    borderColor: open ? '#4A7C59' : '#E4E4E7',
    backgroundColor: '#FFFFFF',
    color: open ? '#4A7C59' : '#55585F',
    boxShadow: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

export function ShareMenu({ actions, layout, lengthUnit: _lengthUnit = 'm', openRequest = 0, closeSignal = 0, variant = 'rail', controller }: {
  actions?: ShareMenuActions;
  /** 画布当前方案，用来取标题。 */
  layout?: RoomLayout;
  /** 保留给调用方；大纲不再画进这张卡。 */
  lengthUnit?: DisplayUnit;
  /** 旧「评审」入口改道时递增，用来把菜单打开。 */
  openRequest?: number;
  /** 别的工具菜单打开时递增，用来把发布收起。 */
  closeSignal?: number;
  /**
   * 同一份卡片的两种触发位。外观都是锁定的 32×32 线稿箭头。
   */
  variant?: 'rail' | 'canvas';
  /**
   * 后端会话（任务 C，2026-11-20）：传入后分享卡多一页「案例」，承载官方案例的
   * 草稿/发布/历史/下架维护。没传（旧宿主/测试）不出现这一页；传了但服务端
   * 未接通时该页明确显示不可用，不做本机模拟。
   */
  controller?: BackendSession | null;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ShareTab>('share');
  const [published, setPublished] = useState<PublishedLink | null>(null);
  // 完整只读分享（2026-11-20 集成补齐，C12/C13）：含户外规划与已归档资源的受控链接。
  // 令牌只在生成响应里出现一次（服务端仅存哈希），所以只留在内存里，不落 localStorage。
  // P0-A：绑定生成时的项目，切项目即作废，撤销按绑定项目发请求，不再重读快照。
  const [completeShare, setCompleteShare] = useState<{ projectId: string; shareId: string; revision: number; token: string | null } | null>(null);
  const [reviewLink, setReviewLink] = useState('');
  const [qrSvg, setQrSvg] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [allowPins, setAllowPins] = useState(true);
  const [allowLevels, setAllowLevels] = useState(true);
  const [allowBasemap, setAllowBasemap] = useState(true);
  const [bingoSent, setBingoSent] = useState(false);
  const [bingoRev, setBingoRev] = useState(0);
  // P1-A（接口约定 §2/§4）：发布页打开即预检 + 发布/复制反馈拆分 + 服务端发布记录。
  // 全部由本卡计算，share-panel 只渲染；切项目即清（与 PUB-05 同一出口）。
  const [precheck, setPrecheck] = useState<PublishPrecheckState | null>(null);
  const [publishFeedback, setPublishFeedback] = useState<PublishFeedback | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<PublishFeedback | null>(null);
  const [publishRecords, setPublishRecords] = useState<PublishRecordsState | null>(null);
  const bingoSending = useBingoSending();
  const seenOpen = useRef(openRequest);
  const seenClose = useRef(closeSignal);
  const projectId = layout?.id;
  // P0-A（主计划 §4.1/§4.3）：每个异步动作开始时捕获（项目, 会话, 账号, 任务纪元），
  // 每个等待点后重新核对；切项目或新动作都会推进 taskRun，旧结果一律不再写入状态。
  const taskRun = useRef(0);
  // 预检的运行序号：只允许最新一轮改写「检查中」状态。
  const precheckRun = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  // 完整分享的重试复用同一 requestId（服务端幂等闸按 actor+requestId 去重；
  // 超时但服务端成功时，重试拿回原确认 token=null，而不是再生成一条孤儿分享）。
  const completeShareAttempt = useRef<{ projectId: string; requestId: string } | null>(null);
  const listSharesRef = useRef(actions?.onListShares);
  listSharesRef.current = actions?.onListShares;
  // 案例维护（任务 C）：能力探测到 backendSession 的云端案例方法才给「案例」页；
  // controller 没传时不出现这一页，方法没接通时页内明确说明不可用。
  const caseSession = useMemo(() => detectCloudCaseSession(controller), [controller]);
  const casesNode = controller != null
    ? <CaseAdminSection session={caseSession} controller={controller} layoutId={layout?.id ?? null} layoutName={titleOf(layout)} />
    : null;

  useEffect(() => {
    if (openRequest === seenOpen.current) return;
    seenOpen.current = openRequest;
    // 审校台「发给客户评审」和旧评审入口都从这里打开。分享页才是允许钉评的评审链接，不落在发布或导出。
    if (openRequest > 0) { setOpen(true); setTab('share'); }
  }, [openRequest]);

  useEffect(() => {
    if (closeSignal === seenClose.current) return;
    seenClose.current = closeSignal;
    setOpen(false);
    setQrOpen(false);
  }, [closeSignal]);

  // PUB-05：切项目立即清空链接、二维码、通知、任务态与完整分享卡；在途回执靠
  // shareTaskStale 丢弃，这里先把面板回到新项目的干净状态。
  useEffect(() => {
    taskRun.current += 1;
    completeShareAttempt.current = null;
    setPublished(readPublishedLink(projectId));
    setCompleteShare(null);
    setNotice('');
    setQrOpen(false);
    setTab('share');
    setBusy(false);
    setPrecheck(null);
    setPublishFeedback(null);
    setCopyFeedback(null);
    setPublishRecords(null);
  }, [projectId]);

  // 评审链接也要有“当前状态”：重新打开分享时，先从本机标记恢复最近一条。
  useEffect(() => {
    try {
      const mark = projectId ? readReviewMarks().find(entry => entry.projectKey === projectId) : null;
      setReviewLink((mark as { clientUrl?: string } | null)?.clientUrl?.trim() ?? '');
    } catch {
      setReviewLink('');
    }
  }, [projectId, open]);

  useEffect(() => {
    setBingoSent(false);
    setBingoSending(false);
    setBingoRev(value => value + 1);
    const sync = () => setBingoRev(value => value + 1);
    window.addEventListener(REVIEW_MARK_CHANGED_EVENT, sync);
    return () => window.removeEventListener(REVIEW_MARK_CHANGED_EVENT, sync);
  }, [projectId]);

  // 首屏与服务端都先待发，挂上后再读本机记录，避免注水时状态对不上。
  const bingoStorage = bingoRev > 0 && typeof localStorage !== 'undefined' ? localStorage : null;
  const storedBingoStatus = shareBingoStatus(projectId, bingoSent, bingoStorage);
  const bingoStatus = bingoSending && storedBingoStatus !== '已回执' ? '送出中' : storedBingoStatus;
  const bingoCount = shareBingoCount(projectId, bingoStorage);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setQrOpen(false); }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** 交给客户的那条：有场地页就用场地页，没有就回云端发布链接。 */
  const handedUrl = published?.url;

  useEffect(() => {
    const url = tab === 'publish' ? published?.url : tab === 'share' ? reviewLink : '';
    if (!url) { setQrSvg(''); setQrOpen(false); return undefined; }
    let live = true;
    void QRCode.toString(url, {
      type: 'svg', margin: 0, width: 112, errorCorrectionLevel: 'M',
      color: { dark: '#141416', light: '#FFFFFF' },
    }).then(svg => { if (live) setQrSvg(svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ')); }).catch(() => { if (live) setQrSvg(''); });
    return () => { live = false; };
  }, [published, reviewLink, tab]);

  // 本机记下的链接如果已被服务端撤回，回到未发布，不再把失效地址当成可复制链接。
  useEffect(() => {
    if (!open || !published) return undefined;
    const stored = readPublishedLink(projectId);
    if (!stored || stored.url !== published.url || stored.revision !== published.revision) return undefined;
    const list = listSharesRef.current;
    if (!list) return undefined;
    let live = true;
    void list().then(rows => {
      if (!live) return;
      const matches = rows.filter(row => published.shareId ? row.shareId === published.shareId : row.revision === published.revision);
      const match = matches.length === 1 ? matches[0] : undefined;
      if (match?.revokedAt) {
        clearPublishedLink(projectId);
        setPublished(null);
        setQrOpen(false);
        // 场地页链接自带快照，撤回只能作废云端发布记录，不能把已发出去的链接收回。
        setNotice(stored.siteUrl ? '云端发布已撤回；已经发出去的场地页快照仍能打开。' : '这条链接已撤回。');
      }
    }).catch(() => { /* 清单暂时读不到时，仍用本机记下的链接 */ });
    return () => { live = false; };
  }, [open, published, projectId]);

  const selectTab = (next: ShareTab) => {
    setTab(next);
    setQrOpen(false);
    if (next === 'publish') void runPublishPrecheck();
  };

  /**
   * P1-A 预检（接口约定 §2）：数据源固定 controller.getSnapshot() + publishGateSnapshot()，
   * 不另开探测、不发写请求。动作完成回调由宿主接线（onPrecheckAction），没有就只说明。
   * 预检身份绑定当前 projectId；结果迟到（切项目）时丢弃。
   */
  const runPublishPrecheck = async (): Promise<void> => {
    const snapshotProject = projectIdRef.current;
    const run = ++precheckRun.current;
    // PUB-02：已有预检结果时，重查先回到「检查中」，不提前声称就绪。
    // 首次打开还没结果时保持旧版渲染：首查只差一个微任务，避免主按钮闪一下再被拿走。
    setPrecheck(previous => (previous ? { ...previous, checking: true } : previous));
    try {
      await runPublishPrecheckNow(snapshotProject);
    } catch (error) {
      // 预检写状态之前抛错时不能把面板卡在「检查中」（fail-closed）：如实说明并给重查路径。
      if (projectIdRef.current !== snapshotProject) return;
      console.warn('[publish-precheck] 预检未完成', error);
      setPrecheck({
        checking: false,
        saveLine: '发布检查没有完成。',
        lastPublished: null,
        blockers: [{ id: 'precheck', message: '发布前检查没有跑完；请重新打开发布页重查，或先保存并通过归档检查。' }],
      });
    } finally {
      // 任何提前退出（切项目/迟到丢弃）都不能把面板卡在「检查中」：
      // 仍是最新一轮且检查态未完时，落成可重查的阻塞项，主按钮不被永久遮掉。
      if (precheckRun.current === run && projectIdRef.current === snapshotProject) {
        setPrecheck(current => (current?.checking
          ? {
            ...current,
            checking: false,
            blockers: current.blockers.length ? current.blockers : [{ id: 'precheck', message: '发布前检查没跑完；请重新打开发布页重查。' }],
          }
          : current));
      }
    }
  };

  const runPublishPrecheckNow = async (snapshotProject: string | undefined): Promise<void> => {
    const snapshot = (() => {
      try { return controller?.getSnapshot() ?? null; } catch { return null; }
    })();
    let gate: PublishGateSnapshot;
    try {
      gate = await publishGateSnapshot();
    } catch {
      // 闸门读不到时 fail-closed：说明原因并给重查路径，不把「检查失败」当成「可以发布」。
      if (projectIdRef.current !== snapshotProject) return;
      setPrecheck({ checking: false, saveLine: '发布检查没有完成。', lastPublished: null, blockers: [{ id: 'gate', message: '发布前检查没跑完；请重新打开发布页重查，或先保存并通过归档检查。' }] });
      return;
    }
    if (projectIdRef.current !== snapshotProject) return;
    if (!snapshot || !layout) {
      setPrecheck({ checking: false, saveLine: '会话状态不可用，暂时不能发布。', lastPublished: null, blockers: [{ id: 'session', message: '发布服务还没连上，暂时不能发布。' }] });
      return;
    }
    const blockers = evaluatePublishBlockers({ snapshot, gate, layout });
    const saveLine = snapshot.dirty
      ? '有未保存的修改'
      : Number.isFinite(snapshot.revision) ? `已保存到云端 · 版本 ${snapshot.revision}` : '还没有保存到云端';
    const local = readShareRecords(snapshotProject);
    const lastPublished = local.length
      ? { revision: [...local].sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))[0]!.revision ?? 0, at: [...local].sort((a, b) => b.at - a.at)[0]!.at }
      : null;
    // PUB-11：发布摘要逐类核对，与客户页实际呈现对齐；缺口如实标注，不用「已包含」含糊过去。
    const summary = publishSummaryOf(layout, gate);
    setPrecheck({
      checking: false,
      saveLine,
      lastPublished,
      dirty: hasUnpublishedChanges(snapshot),
      blockers: blockers.map(blocker => {
        const action = blocker.action;
        const supported = action != null && actions?.onPrecheckAction != null
          && (actions.precheckActions == null || actions.precheckActions.includes(action));
        return {
          id: blocker.code,
          message: blocker.message,
          ...(supported ? { action: { label: precheckActionLabel(action), onSelect: () => { actions?.onPrecheckAction?.(action); } } } : {}),
        };
      }),
      summary,
      visibilityLine: '对外范围：本次发布版本的布置与已归档模型；资料原件、实景扫描文件与后台草稿不对外。',
    });
    // P1-A（接口约定 §4）：发布记录以服务端 shares 清单为权威；拉不到时退化为纯本机行并如实标注。
    if (actions?.onListShares) {
      setPublishRecords({ rows: mergeShareRows(local, null), loading: true, onRevoke: undefined });
      void actions.onListShares().then(rows => {
        if (projectIdRef.current !== snapshotProject) return;
        setPublishRecords({ rows: mergeShareRows(local, rows as ServerShare[]), onRevoke: row => { void revokeShareRow(row); } });
      }).catch(() => {
        if (projectIdRef.current !== snapshotProject) return;
        setPublishRecords({ rows: mergeShareRows(local, null), error: '发布记录暂时读不到；先按本机记录操作，网络恢复后自动对齐。' });
      });
    } else {
      setPublishRecords({ rows: mergeShareRows(local, null) });
    }
  };

  const precheckActionLabel = (action: PublishBlockerAction): string => ({
    login: '去登录',
    'save-project': '保存为云项目',
    'save-changes': '保存当前修改',
    'grant-edit': '取回编辑权',
    'archive-page': '去归档页补传',
    'resolve-conflict': '处理版本冲突',
  }[action] ?? '去处理');

  /** 按发布记录行撤销（P1-A）：绑定该行的 shareId/项目，不重读快照。 */
  const revokeShareRow = async (row: { key: string; kind: string; revision: number | null; at: number; url: string | null; shareId: string | null; revoked: boolean }): Promise<void> => {
    if (!actions?.onListShares || !actions.onRevokeShare || !row.shareId) return;
    const run = ++taskRun.current;
    const identity = shareTaskIdentity(controller, projectIdRef.current, run);
    setBusy(true);
    try {
      await actions.onRevokeShare(row.shareId);
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setNotice(`版本 ${row.revision ?? '—'} 的链接已撤回；已下载或离线副本无法收回。`);
      void runPublishPrecheck();
    } catch (error) {
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setNotice(error instanceof Error ? error.message : '撤回失败，请重试。');
    } finally {
      if (taskRun.current === run) setBusy(false);
    }
  };

  const publish = async () => {
    if (actions?.readOnly) {
      setNotice(SHARE_READ_ONLY_LINE);
      return;
    }
    if (!actions || busy) {
      setNotice(actions ? '' : '分享还没接到工作台。');
      return;
    }
    const run = ++taskRun.current;
    const identity = shareTaskIdentity(controller, projectIdRef.current, run);
    const startedAt = Date.now();
    setBusy(true);
    setNotice('');
    setPublishFeedback({ tone: 'ok', text: '正在发布，请稍候…' });
    setCopyFeedback(null);
    try {
      const result = await actions.onPublish();
      // 服务端确实为发布时的项目生成了链接：记录写回该项目名下；展示与复制按当前上下文核对。
      writePublishedLink(identity.projectId, result);
      appendShareRecord(identity.projectId, { kind: 'web', url: result.url, revision: result.revision, at: startedAt });
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      if (result.isCurrent && !result.isCurrent()) {
        // 同一项目内方案/楼层已变（V08）：这次结果对应旧快照，不展示不复制；服务端记录为准。
        setPublishFeedback({ tone: 'warn', text: '方案或版本已变化，这次发布不复制链接；请核对分享记录后按当前版本重发。' });
        throw new Error('方案或版本已变化，这次发布不复制链接；请核对分享记录后按当前版本重发。');
      }
      setPublished(result);
      const copied = await copyText(result.url);
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setPublishFeedback({ tone: 'ok', text: `已发布版本 ${result.revision}。` });
      setCopyFeedback(copied ? { tone: 'ok', text: '链接已复制。' } : { tone: 'warn', text: '发布成功，复制没成功；请点「复制」或在完整地址里手动取走。' });
      setNotice(copied ? '' : '链接已发布。复制没成功，请点「复制」。');
      setQrOpen(false);
      void runPublishPrecheck();
    } catch (error) {
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      if (isAmbiguousPublishFailure(error) && actions.onListShares) {
        // 请求已发出但回应丢失（§4.6）：以服务端分享清单为准，不直接断言失败、不引导重复发布。
        try {
          const rows = await actions.onListShares();
          if (!shareTaskStale(identity, controller, projectIdRef.current, run)) {
            const created = rows.some(row => !row.revokedAt && Date.parse(row.createdAt) >= startedAt);
            const text = created
              ? '发布请求可能已成功（服务端已有新的分享记录），但链接令牌没能取回；请先在分享记录里撤销这条发布，再重新发布。'
              : '网络中断，这次发布是否成功未知；请稍后核对分享记录再重试。';
            setNotice(text);
            setPublishFeedback({ tone: 'warn', text });
          }
          return;
        } catch { /* 清单也读不到时按普通失败提示 */ }
      }
      const text = error instanceof Error ? error.message : '链接没有生成。';
      setNotice(text);
      setPublishFeedback({ tone: 'err', text });
    } finally {
      if (taskRun.current === run) setBusy(false);
    }
  };

  const issue = async () => {
    if (!actions || busy) {
      setNotice(actions ? '' : '分享还没接到工作台。');
      return;
    }
    const run = ++taskRun.current;
    const identity = shareTaskIdentity(controller, projectIdRef.current, run);
    setBusy(true);
    setNotice('');
    setBingoSending(true);
    try {
      const result = await actions.onIssueReviewLink({ pins: allowPins, levels: allowLevels, basemap: allowBasemap });
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      if (!result.isCurrent()) throw new Error('活动、楼层或方案已变化，旧链接未复制。');
      setReviewLink(result.url);
      const copied = await copyText(result.url);
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setBingoSent(true);
      setBingoRev(value => value + 1);
      setNotice(copied ? '评审链接已复制。' : '评审链接已生成，复制没成功，请再试一次。');
    } catch (error) {
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setNotice(error instanceof Error ? error.message : '评审链接没有生成。');
    } finally {
      if (taskRun.current === run) {
        setBingoSending(false);
        setBusy(false);
      }
    }
  };

  const copyPublished = async () => {
    if (!handedUrl) return;
    const copied = await copyText(handedUrl);
    setCopyFeedback(copied ? { tone: 'ok', text: '链接已复制。' } : { tone: 'warn', text: '复制没成功；请再点一次「复制」，或在完整地址里手动取走。' });
    setNotice(copied ? '' : '复制没成功，请再试一次。');
  };

  const revokePublished = async () => {
    if (!published || busy || actions?.readOnly || !actions?.onListShares || !actions.onRevokeShare) return;
    const run = ++taskRun.current;
    const identity = shareTaskIdentity(controller, projectIdRef.current, run);
    const target = published;
    const targetProjectId = projectIdRef.current;
    setBusy(true);
    setNotice('');
    try {
      const rows = await actions.onListShares();
      const matches = rows.filter(row => target.shareId ? row.shareId === target.shareId : row.revision === target.revision);
      if (matches.length !== 1) throw new Error('无法唯一确认这条分享，请从分享记录选择具体链接撤销。');
      if (!matches[0].revokedAt) await actions.onRevokeShare(matches[0].shareId);
      // 本机记录按发布时的项目清；当前面板的状态按当前上下文核对后再动（PUB-05）。
      clearPublishedLink(targetProjectId);
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setPublished(null);
      setQrOpen(false);
      setNotice('这条受控链接已撤回；离线快照和已下载内容无法收回。');
    } catch (error) {
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setNotice(error instanceof Error ? error.message : '撤回失败，请重试。');
    } finally {
      if (taskRun.current === run) setBusy(false);
    }
  };

  /** 完整只读链接：先把清单按 published 口径落库（幂等），再创建受控分享（token 只回一次）。 */
  const createCompleteShare = async () => {
    if (!controller || busy || actions?.readOnly) return;
    const run = ++taskRun.current;
    const identity = shareTaskIdentity(controller, projectIdRef.current, run);
    setBusy(true);
    setNotice('');
    try {
      const ensured = await ensurePublishedArchiveNow(controller);
      if (!ensured.ok) throw new Error(ensured.error ?? '完整归档没有就绪。');
      // PUB-06：绑定归档落库时的项目与版本；不得在等待后重读快照另取项目。
      const shareProjectId = ensured.projectId;
      if (!shareProjectId) throw new Error('完整归档没有返回项目身份，请重试。');
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      const attempt = completeShareAttempt.current;
      const requestId = attempt && attempt.projectId === shareProjectId ? attempt.requestId : crypto.randomUUID();
      completeShareAttempt.current = { projectId: shareProjectId, requestId };
      const result = await controller.createCompleteShare(shareProjectId, { requestId, expectedRevision: ensured.revision ?? 0 });
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      completeShareAttempt.current = null;
      setCompleteShare({ projectId: shareProjectId, shareId: result.shareId, revision: result.revision, token: result.token });
      setNotice(result.token
        ? '完整只读链接已生成；令牌只在这一次显示，请立即复制保存。'
        : '这条完整链接此前已生成过；令牌不重复显示，请使用当时保存的链接，或撤销后重新生成。');
    } catch (error) {
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setNotice(error instanceof Error ? error.message : '完整链接没有生成，请重试。');
    } finally {
      if (taskRun.current === run) setBusy(false);
    }
  };

  const copyCompleteShare = async () => {
    if (!completeShare?.token) return;
    const copied = await copyText(`${window.location.origin}/view/#c${completeShare.token}`);
    setNotice(copied ? '完整只读链接已复制。' : '复制没成功，请再点一次「复制」。');
  };

  const revokeCompleteShare = async () => {
    if (!controller || !completeShare || busy) return;
    const run = ++taskRun.current;
    const identity = shareTaskIdentity(controller, projectIdRef.current, run);
    const target = completeShare;
    setBusy(true);
    setNotice('');
    try {
      // 撤销按生成时绑定的项目发请求，不重读快照（PUB-05/PUB-06）。
      await controller.revokeCompleteShare(target.projectId, target.shareId);
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setCompleteShare(null);
      setNotice('完整只读链接已撤销；新访问将被拒绝，已打开或已下载的副本无法收回。');
    } catch (error) {
      if (shareTaskStale(identity, controller, projectIdRef.current, run)) return;
      setNotice(error instanceof Error ? error.message : '撤销失败，请重试。');
    } finally {
      if (taskRun.current === run) setBusy(false);
    }
  };

  const copyReview = async () => {
    if (!reviewLink) return;
    const copied = await copyText(reviewLink);
    setNotice(copied ? '评审链接已复制。' : '复制没成功，请再试一次。');
  };

  const openReview = () => {
    if (reviewLink) window.open(reviewLink, '_blank', 'noopener,noreferrer');
  };

  /** 从评审地址里取云端短码；快照长链（#layout=）没有短码，不能远程吊销。 */
  const reviewCodeOf = (url: string): string | null => {
    try {
      const parsed = new URL(url, window.location.origin);
      return reviewCodeFromPath(parsed.pathname) ?? reviewCodeFromHash(parsed.hash);
    } catch {
      return null;
    }
  };

  const revokeReview = async () => {
    if (!actions?.onRevokeReviewLink || busy || !reviewLink) return;
    const code = reviewCodeOf(reviewLink);
    if (!code) {
      setNotice('这条是快照长链，没法远程作废；重新生成一条评审链接即可。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await actions.onRevokeReviewLink(code);
      const markKey = (projectId ?? '').trim() || 'local-draft';
      forgetReviewLinkMark(markKey, reviewLink);
      setReviewLink('');
      setQrOpen(false);
      setNotice('评审链接已作废，原来的地址打不开了。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '评审链接没有作废成功。');
    } finally {
      setBusy(false);
    }
  };

  /** Bingo 是内部审校去处：只切面板，不重复生成链接。 */
  const openBingo = () => {
    if (!actions?.onOpenBingo) {
      setNotice('Bingo 还没接到这套工作台。');
      return;
    }
    setOpen(false);
    setQrOpen(false);
    actions.onOpenBingo();
  };

  const exports = exportEntries(actions, () => setOpen(false));
  // 完整只读链接的展示地址；令牌只在生成响应里出现一次，撤销后重建才拿到新的。
  const completeShareUrl = completeShare?.token && typeof window !== 'undefined' ? `${window.location.origin}/view/#c${completeShare.token}` : '';

  return <div className="sc-tool-menu" ref={rootRef}>
    <button
      type="button"
      id={variant === 'canvas' ? 'tool-outdoor-publish' : 'tool-share'}
      {...(variant === 'canvas' ? { 'data-testid': 'outdoor-publish' } : {})}
      data-tour="publish"
      data-tip="分享"
      data-share-chrome={open ? 'open' : 'closed'}
      aria-label="分享"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="tool-share-menu"
      className={`sc-share-trigger${open ? ' is-active' : ''}`}
      style={shareTriggerChrome(open)}
      onClick={() => setOpen(current => !current)}
    >
      <ShareArrow />
    </button>
    {open && <SharePanel
      tab={tab}
      onTab={selectTab}
      title={titleOf(layout)}
      published={published}
      busy={busy}
      notice={notice}
      bingoStatus={bingoStatus}
      bingoCount={bingoCount}
      bingoLive={bingoRev > 0}
      readOnly={Boolean(actions?.readOnly)}
      qrOpen={qrOpen}
      qrSvg={qrSvg}
      exports={exports}
      reviewLink={reviewLink}
      permits={{ pins: allowPins, levels: allowLevels, basemap: allowBasemap }}
      onPermit={(key, value) => {
        if (key === 'pins') setAllowPins(value);
        else if (key === 'levels') setAllowLevels(value);
        else setAllowBasemap(value);
      }}
      onIssueAudience={() => { void issue(); }}
      onSendBingo={openBingo}
      onCopyReview={() => { void copyReview(); }}
      onOpenReview={openReview}
      {...(actions?.onRevokeReviewLink ? { onRevokeReview: () => { void revokeReview(); } } : {})}
      onPublish={() => { void publish(); }}
      onCopy={() => { void copyPublished(); }}
      onRevoke={actions?.onRevokeShare && actions.onListShares && !actions.readOnly ? () => { void revokePublished(); } : undefined}
      completeShare={completeShare ? { url: completeShareUrl, revision: completeShare.revision } : null}
      onCreateCompleteShare={controller && !actions?.readOnly ? () => { void createCompleteShare(); } : undefined}
      onCopyComplete={() => { void copyCompleteShare(); }}
      onRevokeCompleteShare={completeShare ? () => { void revokeCompleteShare(); } : undefined}
      cases={casesNode}
      onToggleQr={() => setQrOpen(current => !current)}
      precheck={precheck}
      publishFeedback={publishFeedback}
      copyFeedback={copyFeedback}
      publishRecords={publishRecords}
    />}
  </div>;
}

function exportEntries(actions: ShareMenuActions | undefined, close: () => void): ShareExportEntry[] {
  if (!actions) return [];
  const entries: ShareExportEntry[] = [];
  if (actions.onExportImage) {
    const run = actions.onExportImage;
    entries.push({ id: 'render', label: '效果图', icon: 'image', onSelect: () => { void run(); close(); } });
  }
  if (actions.onExportCsv) {
    const run = actions.onExportCsv;
    entries.push({ id: 'materials', label: '物料清单', icon: 'list', onSelect: () => { run(); close(); } });
  }
  if (actions.onExportGeoJson) {
    const run = actions.onExportGeoJson;
    entries.push({ id: 'site', label: '场地范围文件', icon: 'site', onSelect: () => { run(); close(); } });
  }
  return entries;
}

function ShareArrow(): JSX.Element {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 10.4V3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5.15 5.85 8 3l2.85 2.85" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.4 8.2v3.3a1.1 1.1 0 0 0 1.1 1.1h7a1.1 1.1 0 0 0 1.1-1.1V8.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

const LINK_KEY = 'scendance.publishedLink.v1.';

function readPublishedLink(projectId?: string): PublishedLink | null {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(LINK_KEY + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PublishedLink>;
    return typeof parsed.url === 'string' && parsed.url && typeof parsed.revision === 'number'
      ? {
        url: parsed.url,
        revision: parsed.revision,
        ...(typeof parsed.shareId === 'string' ? { shareId: parsed.shareId } : {}),
        ...(typeof parsed.siteUrl === 'string' && parsed.siteUrl ? { siteUrl: parsed.siteUrl } : {}),
      }
      : null;
  } catch { return null; }
}

/** 发布链接只在发布时返回一次，记下这一次的链接，重开卡片还能复制。 */
function writePublishedLink(projectId: string | undefined, link: PublishedLink): void {
  if (!projectId) return;
  try { localStorage.setItem(LINK_KEY + projectId, JSON.stringify(link)); } catch { /* 存不下就只保证这一次可复制 */ }
}

function clearPublishedLink(projectId: string | undefined): void {
  if (!projectId) return;
  try { localStorage.removeItem(LINK_KEY + projectId); } catch { /* 清不掉就只在这一次把卡片退回未发布 */ }
}

// ---------------------------------------------------------------------------
// P0-A（主计划 §4 实现约束 1/3）：分享卡异步任务的当前性绑定。
// 身份 = (projectId, sessionId, userId, taskRun)。taskRun 在切项目与每个新动作开始时
// 推进；每个 await 之后用 shareTaskStale 重新核对，不匹配的结果一律不写入本卡状态、
// 不复制、不动通知。sessionId/userId 从 controller 快照实时读取，不缓存。
// ---------------------------------------------------------------------------

interface ShareTaskIdentity {
  projectId?: string | undefined;
  sessionId: string | null;
  userId: string | null;
  run: number;
}

function shareTaskIdentity(controller: BackendSession | null | undefined, projectId: string | undefined, run: number): ShareTaskIdentity {
  let sessionId: string | null = null;
  let userId: string | null = null;
  try {
    const snapshot = controller?.getSnapshot();
    if (snapshot) {
      sessionId = snapshot.sessionId ?? null;
      userId = snapshot.user?.id ?? null;
    }
  } catch { /* 会话不可用时只绑项目与任务纪元 */ }
  return { projectId, sessionId, userId, run };
}

function shareTaskStale(identity: ShareTaskIdentity, controller: BackendSession | null | undefined, projectId: string | undefined, currentRun: number): boolean {
  if (currentRun !== identity.run) return true;
  const now = shareTaskIdentity(controller, projectId, identity.run);
  return now.projectId !== identity.projectId
    || now.sessionId !== identity.sessionId
    || now.userId !== identity.userId;
}

/**
 * PUB-11：发布摘要——场地、楼层、物件、依赖归档、户外规划与缺失项逐类列清。
 * 口径与客户只读页（app/view/page.tsx「对外可见内容」）一致：归档文件存在不等于三维里还原，
 * 户外规划只进只读示意，扫描文件只作为资源下载。
 */
function publishSummaryOf(layout: RoomLayout, gate: PublishGateSnapshot): PublishSummaryItem[] {
  const itemCount = layout.floors.reduce((total, floor) => total + floor.items.length, 0);
  const archived = gate.manifest?.dependencies.length ?? 0;
  const items: PublishSummaryItem[] = [
    { label: '场地与楼层', detail: `${layout.floors.length} 层 · ${itemCount} 件物件 · ${layout.width} × ${layout.height} 米` },
    {
      label: '模型与资料',
      detail: archived > 0 ? `${archived} 项依赖已归档` : '没有需要归档的依赖',
      ...(gate.complete ? {} : { missing: true }),
    },
    { label: '户外规划', detail: gate.manifest?.outdoor ? '含分区、路线与设施（客户只读页展示，不进三维）' : '本次不含户外规划' },
  ];
  if (gate.gaps.length > 0) {
    const labels: Record<string, string> = { model: '模型', scan: '扫描', source: '资料图', attachment: '附件' };
    const byKind = new Map<string, number>();
    for (const gap of gate.gaps) byKind.set(gap.kind, (byKind.get(gap.kind) ?? 0) + 1);
    items.push({
      label: '缺失项',
      detail: [...byKind.entries()].map(([kind, count]) => `${labels[kind] ?? kind} ×${count}`).join('、'),
      missing: true,
    });
  }
  return items;
}

function titleOf(layout?: RoomLayout): string {
  return layout?.name?.trim() || '未命名活动';
}

function meters(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(Number(value.toFixed(2))) : '—';
}

function feet(metres: number): string {
  return Number.isFinite(metres) && metres > 0 ? convertMetres(metres, 'ft').toFixed(1) : '—';
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 剪贴板被拦住时，链接行仍可再点复制 */ }
  return false;
}
