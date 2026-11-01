'use client';

import { ArrowUpRight, FolderOpen, Images, Search, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AssetsPanel } from '@/components/business/assets-panel';
import { createBackendSession, useBackendSession, type BackendSession, type ProjectSummary, type Studio } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { copySourceScope, flushSourceScope } from '@/lib/source-storage';
import { consumeSelfAttachedProject, preferredStudio, rememberStudio } from '@/lib/workspace-api';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { assertNoLocalHandoffCloudTransition, assertNoLocalRecordsCloudTransition, hasLocalHandoff, LOCAL_HANDOFF_CLOUD_MESSAGE } from '../lib/handoff-cloud-guard';
import { ensureGlbAsset } from '../three/glb-assets';
import { AccountTeamDemo } from './account-team-demo';
import { useLocalProjectBackup } from './creative-studio';
import { InfoTip } from './info-tip';
import { LocalActivitiesPanel } from './local-activities-panel';
import type { RoomLayout } from '../lib/types';

interface Props { controller?: BackendSession; layout: RoomLayout; onLoadLayout(layout: RoomLayout): void; onApplyLayout?(layout: RoomLayout): void; onClose?(): void; openRequest?: { serial: number; section: string }; triggerRef?: RefObject<HTMLButtonElement>; draftNote?: { label: string; error?: boolean; title?: string } }

/** 点在对话框边框外（背后遮罩）才关。面板里的点击、按钮都不关。 */
export function closeDialogOnBackdrop(event: MouseEvent<HTMLDialogElement>): void {
  const box = event.currentTarget.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right
    && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) event.currentTarget.close();
}

function isLocalMockBackend(): boolean {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('localhost:3099');
}

export function CloudPanel({ layout, onLoadLayout, controller: providedController, onApplyLayout, onClose, openRequest, triggerRef, draftNote }: Props): JSX.Element {
  const [fallbackController] = useState(() => providedController ?? createBackendSession());
  const controller = providedController ?? fallbackController;
  const cloud = useBackendSession(controller);
  const localActivities = useLocalProjectBackup();
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
  const [projectName, setProjectName] = useState('');
  const [surface, setSurface] = useState<'account' | 'settings'>('account');
  const [section, setSection] = useState('projects');
  const [query, setQuery] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  let fingerprint: string | null = null;
  let conversionError = '';
  try { fingerprint = JSON.stringify(layoutToBackendScene(layout)); }
  catch (error) { conversionError = error instanceof Error ? error.message : '当前场景暂不能保存到云端。'; }
  const localHandoff = hasLocalHandoff(layout);
  const localWorkspace = isLocalActivityWorkspace(controller);
  const sceneConnection = !!cloud.geometryBinding && localWorkspace;
  const bound = !sceneConnection && !!cloud.project && layout.id === cloud.project.id && (boundLayout === layout.id ||
    (!cloud.writeBlocked && cloud.lease?.projectId === layout.id && cloud.lease.sessionId === cloud.sessionId && Date.parse(cloud.lease.expiresAt) > Date.now()));
  const dirty = localHandoff || !!layout.id && recordsBlockedScope === layout.id || (bound ? cloud.dirty : fingerprint !== savedFingerprint);

  const userId = cloud.user?.id;
  const studioProjects = projects.filter(project => project.studio_id === studioId && (!sceneConnection || project.id !== cloud.project?.id));
  useEffect(() => {
    if (!sceneConnection || !cloud.project || !projectsLoaded) return;
    const { id, name, studio_id, revision } = cloud.project;
    // Scene preparation can create a project after the account list was read.
    setProjects(current => current.some(project => project.id === id) ? current : [...current, { id, name, studio_id, revision }]);
  }, [sceneConnection, cloud.project, projectsLoaded]);
  useEffect(() => controller.retain(), [controller]);
  useEffect(() => {
    if (!userId || busy) return;
    const id = requestedProjectId;
    if (!id || openedRequest.current === `${userId}:${id}`) return;
    // 无感挂云自己同步的 ?project=：项目刚建好、画布已是内容本体，重开会清掉撤销历史，凭标记跳过。
    if (consumeSelfAttachedProject(userId, id)) { openedRequest.current = `${userId}:${id}`; return; }
    if (!cloud.writeBlocked && cloud.project?.id !== id) {
      setNotice('请先释放当前项目的编辑权，再打开链接中的项目。');
      setSurface('account'); setSection('projects');
      dialog.current?.showModal(); return;
    }
    const timer = window.setTimeout(() => {
      openedRequest.current = `${userId}:${id}`;
      void openRequested.current(id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId, requestedProjectId, busy, cloud.writeBlocked, cloud.project?.id]);
  useEffect(() => { setProjectName(cloud.project?.name ?? ''); }, [cloud.project?.name]);

  useEffect(() => {
    setProjects([]); setStudios([]); setStudioId(''); setQuery(''); setProjectsLoaded(false); setSurface('account'); setSection('projects');
    if (!userId) { openedRequest.current = ''; setNotice(''); setLoadingProjects(false); dialog.current?.close(); return; }
    let cancelled = false;
    setLoadingProjects(true);
    void Promise.all([controller.listProjects(), controller.listStudios()]).then(([nextProjects, nextStudios]) => {
      if (cancelled) return;
      setProjects(nextProjects); setStudios(nextStudios); setStudioId(preferredStudio(userId, nextStudios, controller.getSnapshot().project?.studio_id)); setProjectsLoaded(true);
    }).catch(() => { if (!cancelled) setNotice('项目加载失败，请点击刷新重试。'); }).finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [controller, userId]);
  // 多入口分区直达：左下「设置」只开团队/权限演示；头像开账户（项目、素材）。
  const openedOpenRequest = useRef(0);
  useEffect(() => {
    if (!openRequest || openRequest.serial <= 0 || openedOpenRequest.current === openRequest.serial) return;
    openedOpenRequest.current = openRequest.serial;
    const settings = openRequest.section === 'team' || openRequest.section === 'permissions';
    setSurface(settings ? 'settings' : 'account');
    setSection(openRequest.section);
    if (!dialog.current?.open) dialog.current?.showModal();
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
      setNotice(error instanceof Error ? error.message : controller.getSnapshot().error?.message ?? '操作失败，请重试。');
    } finally { actionPending.current = false; setBusy(false); }
  }
  async function navigateFromWorkspace(path: '/auth' | '/projects/'): Promise<void> {
    await run(async () => {
      await flushSourceScope(layoutRef.current.id ?? 'local');
      router.push(path);
      dialog.current?.close();
    });
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
  async function flushBeforeReplacement(openingFrom: RoomLayout): Promise<void> {
    await assertCloudTransition(openingFrom);
    await flushSourceScope(openingFrom.id ?? 'local');
    await assertCloudTransition(layoutRef.current);
    if(layoutRef.current!==openingFrom)throw new Error('保存资料期间场景有新改动，原草稿已保留，请重新打开。');
  }
  async function acceptScene(scene: unknown, projectId: string, name: string, openingFrom: RoomLayout): Promise<void> {
    await assertCloudTransition(openingFrom);
    await assertCloudTransition(layoutRef.current);
    // Include the initial project/lease request in the guard, not only GLB loading.
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    const candidate = backendSceneToLayout(scene, { projectId, name });
    await assertCloudTransition(candidate);
    await assertCloudTransition(layoutRef.current);
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    const assets = await controller.authorizeAssets(layoutToBackendScene(candidate));
    await assertCloudTransition(candidate);
    await assertCloudTransition(openingFrom);
    await assertCloudTransition(layoutRef.current);
    if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
    await Promise.all(Object.entries(assets.assetUrls).map(([assetId, url]) => ensureGlbAsset(assetId, url)));
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
    setBoundLayout(next.id);
    setSavedFingerprint(JSON.stringify(layoutToBackendScene(next)));
    lastObserved.current = JSON.stringify(layoutToBackendScene(next));
    onLoadLayout(next);
    syncProjectUrl(projectId);
  }
  function syncProjectUrl(projectId: string): void {
    openedRequest.current = `${userId}:${projectId}`;
    const url = new URL(window.location.href);
    url.searchParams.set('project', projectId);
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  /** 项目操作都在账户面板里反馈，别把错误弹到设置面板上。 */
  function showAccount(): void {
    setSurface('account'); setSection('projects'); dialog.current?.showModal();
  }
  openRequested.current = id => run(async () => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      showAccount(); throw new Error('项目链接无效。');
    }
    const openingFrom = layoutRef.current;
    try {
      await assertCloudTransition(openingFrom);
      const current = controller.getSnapshot();
      if (openingFrom.id && openingFrom.id !== id && current.dirty && !confirmReplace()) return;
      await flushBeforeReplacement(openingFrom);
      const project = current.project?.id === id && !current.writeBlocked ? current.project :
        await controller.getProject(id, incoming => { assertNoLocalHandoffCloudTransition(layoutRef.current); backendSceneToLayout(incoming.scene, { projectId: incoming.id, name: incoming.name }); });
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
        setNotice('已保留这个项目的本地未保存改动。请核对云端版本后继续保存或获取编辑权。');
        showAccount(); return;
      }
      await acceptScene(project.scene, project.id, project.name, openingFrom);
      setNotice('已打开项目。获取编辑权后可以保存修改。');
    } catch (error) { showAccount(); throw error; }
  });
  function confirmReplace(): boolean {
    return !dirty || window.confirm('打开云端版本会替换当前画布。当前草稿将保留为本地恢复点。继续吗？');
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

  const filteredProjects = studioProjects.filter(project => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // §二.4 默认在云上：状态只说结果，不解释文件存在哪。
  const saveStatus = sceneConnection ? '场景已连接' : !cloud.user || !bound ? '草稿' : cloud.writeBlocked ? '只读' : dirty ? '有改动' : '已保存';
  const accountName = cloud.user?.is_anonymous ? '访客' : cloud.user?.email?.split('@')[0] || (cloud.user ? '我的账户' : '访客');
  const accountDetail = cloud.user ? (cloud.user.is_anonymous ? '独立访客身份 · 普通用户权限' : cloud.user.email ?? '我的账户') : null;
  const draftStatus = draftNote?.label ?? (cloud.user ? null : '草稿');
  const settingsSurface = surface === 'settings';
  const navItems: Array<[string, string, string, typeof FolderOpen]> = settingsSurface
    ? [['team', '团队', '团队演示', UsersRound], ['permissions', '权限', '权限演示', ShieldCheck]]
    : [['projects', '我的项目', '我的项目', FolderOpen], ['assets', '素材库', '素材库', Images]];

  return <>
    <button ref={triggerRef} className="sc-cloud-trigger" type="button" aria-label="账户与素材库" title="账户与素材库 · 项目与素材" aria-haspopup="dialog" onClick={() => { setSurface('account'); setSection('assets'); dialog.current?.showModal(); }}>
      <span className="sc-account-trigger-avatar" aria-hidden="true"><UserRound size={20}/></span>
    </button>
    {typeof document === 'undefined' ? null : createPortal(<dialog ref={dialog} className="sc-cloud-dialog sc-account-dialog" aria-labelledby="cloud-title" onClose={onClose} onClick={closeDialogOnBackdrop} onKeyDown={event => event.stopPropagation()}>
      <div className="sc-account-scroll">
      <div className={`sc-cloud-heading${settingsSurface ? ' is-settings' : ''}`}>{settingsSurface
        ? <div><h2 id="cloud-title">团队与权限</h2></div>
        : <div className="sc-account-title"><h2 id="cloud-title">账户中心</h2></div>}<button className="sc-cloud-close" type="button" aria-label={settingsSurface ? '关闭设置面板' : '关闭账户面板'} autoFocus onClick={() => dialog.current?.close()}><X size={20}/></button></div>
      <nav className="sc-account-nav" aria-label={settingsSurface ? '设置导航' : '账户导航'}>{navItems.map(([id, label, name, Icon]) => <button type="button" key={id} aria-label={name} aria-pressed={section === id} onClick={() => setSection(id)}><Icon size={15} aria-hidden="true"/>{label}</button>)}</nav>
      {!settingsSurface && <div className="sc-account-profile"><span className="sc-account-avatar" aria-hidden="true">{cloud.user ? accountName.slice(0, 1).toUpperCase() : <UserRound size={20}/>}</span><div><strong>{accountName}</strong><span>{accountDetail}{accountDetail && draftStatus ? <span aria-hidden="true"> · </span> : null}{draftStatus ? <span className={`sc-account-draft${draftNote?.error ? ' has-error' : ''}`} title={draftNote?.title}>{draftStatus}</span> : null}</span></div>{cloud.user ? <button type="button" disabled={busy} onClick={() => void run(async () => { await flushSourceScope(layoutRef.current.id ?? 'local'); await controller.signOut(); setProjects([]); setStudios([]); setBoundLayout(undefined); setSavedFingerprint(null); })}>退出登录</button> : <>{isLocalMockBackend() && <button type="button" disabled={busy} onClick={() => void run(async () => { await controller.signIn('dev@mock.local', 'mock'); setNotice('已用本地测试账户登录。'); })}>本地测试登录</button>}{cloud.configured && <Link className="sc-cloud-primary" href="/auth" aria-disabled={busy} onClick={event => { event.preventDefault(); void navigateFromWorkspace('/auth'); }}>登录</Link>}</>}</div>}
      <div className="sc-account-body">
      {settingsSurface ? (<div hidden={section !== 'team' && section !== 'permissions'}><AccountTeamDemo key={userId ?? 'local'} view={section === 'permissions' ? 'permissions' : 'team'} /></div>) : (<>
      <section hidden={section !== 'projects'} aria-label="我的项目">
      {localActivities && localWorkspace
        ? <LocalActivitiesPanel mode="list" layout={layout} actions={localActivities} disabled={busy} currentStatus={saveStatus} onComplete={() => dialog.current?.close()}/>
        : <div className="sc-account-canvas"><span className="sc-account-project-icon" aria-hidden="true"><FolderOpen size={20}/></span><div><small>当前画布</small><strong>{layout.name || '未命名活动'}</strong></div><span className="sc-cloud-badge">{saveStatus}</span></div>}
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
        <div className="sc-account-section-heading"><div className="sc-account-section-title"><h3>文件</h3></div><button type="button" disabled={busy || loadingProjects} onClick={() => void run(refreshProjects)}>刷新</button></div>
        <div className="sc-account-project-grid"><section aria-label="项目列表">
        {(loadingProjects || !!filteredProjects.length) && <div className="sc-account-filters"><label className="sc-account-search"><Search size={20} aria-hidden="true"/><input aria-label="搜索项目" type="search" placeholder="搜索文件" value={query} onChange={event => setQuery(event.target.value)} /></label>{studios.length > 1 && <select aria-label="当前工作室" disabled={busy || loadingProjects} value={studioId} onChange={event => { setStudioId(event.target.value); if (userId) rememberStudio(userId, event.target.value); }}>{studios.map(studio => <option key={studio.id} value={studio.id}>{studio.name}</option>)}</select>}</div>}
        {loadingProjects && <p className="sc-account-empty" role="status">正在加载…</p>}
        <ul className="sc-file-grid">{filteredProjects.map(project => {
          const current = project.id === cloud.project?.id;
          const editingElsewhere = !current && project.current_editor && project.lease_expires && Date.parse(project.lease_expires) > Date.now();
          return <li key={project.id} className={`sc-file-card${current ? ' is-current' : ''}`}>
          <span className="sc-file-thumb" aria-hidden="true"><FolderOpen size={26}/></span>
          <div className="sc-file-info"><strong>{project.name}</strong><small>{current ? '当前' : editingElsewhere ? '他人编辑中' : '只读'}</small></div>
          <button type="button" className="sc-file-open" disabled={busy || !cloud.writeBlocked} onClick={() => {
          if (!confirmReplace()) return;
          void run(async () => {
            const openingFrom = layoutRef.current;
            await assertCloudTransition(openingFrom);
            await flushBeforeReplacement(openingFrom);
            setBoundLayout(undefined);
            const opened = await controller.getProject(project.id, candidate => { assertNoLocalHandoffCloudTransition(layoutRef.current); backendSceneToLayout(candidate.scene, { projectId: candidate.id, name: candidate.name }); });
            await acceptScene(opened.scene, opened.id, opened.name, openingFrom);
            setNotice('已打开项目。');
          });
        }}>打开</button></li>;
        })}</ul>
        <button type="button" className="sc-file-new" aria-label="新方案" disabled={busy || sceneConnection || !studioId || !cloud.writeBlocked || !!conversionError} onClick={() => void run(async () => {
            const current = layoutRef.current;
            await assertCloudTransition(current);
            await flushSourceScope(current.id ?? 'local');
            await assertCloudTransition(layoutRef.current);
            if(layoutRef.current!==current)throw new Error('保存资料期间场景有新改动，原草稿已保留，请重新创建。');
            setBoundLayout(undefined);
            const created = await controller.createProject(studioId, current.name, layoutToBackendScene(current));
            let sourceNotice = '';
            try {
              await assertCloudTransition(current);
              await assertCloudTransition(backendSceneToLayout(created.scene, { projectId: created.id, name: created.name }));
              await assertCloudTransition(layoutRef.current);
              if(layoutRef.current!==current)throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
              try { await copySourceScope(current.id ?? 'local', created.id); }
              catch { sourceNotice = ' 资料未能复制到新项目；请回到原草稿核对，或重新选择来源图片。'; }
              await acceptScene(created.scene, created.id, created.name, current);
            } catch(error) {
              throw new Error(`云端创建请求已返回，结果待核对；当前画布未替换。${error instanceof Error ? error.message : '请保留原草稿并核对资料。'}`);
            }
            await refreshProjects(); setNotice(`新项目已保存，获取编辑权后可继续云端编辑。${sourceNotice}`);
          })}>新方案</button>
        {!loadingProjects && !studioProjects.length && <p className="sc-account-empty">还没有其他方案</p>}
        {!loadingProjects && !!studioProjects.length && !filteredProjects.length && <div className="sc-account-empty"><p>没有匹配的文件</p>{query && <button type="button" onClick={() => { setQuery(''); }}>清除筛选</button>}</div>}
        {!cloud.writeBlocked && <p className="sc-cloud-muted">切换项目前，请先保存改动并释放编辑权。</p>}
        </section></div>
        <aside aria-label="当前项目管理">
        {cloud.project && !sceneConnection && <section className="sc-cloud-current">
          <h3>{cloud.project.name}</h3>
          <p>{cloud.writeBlocked ? '只读' : dirty ? '有改动' : '已保存'}</p>
          <label>项目名称<input maxLength={120} value={projectName} onChange={event => setProjectName(event.target.value)} /></label>
          <button type="button" disabled={busy || cloud.writeBlocked || !projectName.trim() || projectName.trim() === cloud.project.name} onClick={() => void run(async () => { await controller.renameProject(projectName.trim()); await refreshProjects(); setNotice('项目名称已更新，画布草稿仍保留。'); })}>保存名称</button>
          <div className="sc-cloud-actions">
            <button type="button" disabled={busy || !cloud.writeBlocked} onClick={() => {
              if (!confirmReplace()) return;
              void run(async () => {
                const openingFrom = layoutRef.current;
                await assertCloudTransition(openingFrom);
                await flushBeforeReplacement(openingFrom);
                setBoundLayout(undefined);
                const project = controller.getSnapshot().project!;
                await assertCloudTransition(backendSceneToLayout(project.scene, { projectId: project.id, name: project.name }));
                await assertCloudTransition(layoutRef.current);
                if (layoutRef.current !== openingFrom) throw new Error('加载期间画布有新改动，当前草稿已保留。请核对后重新打开云端项目。');
                const lease = await controller.acquireLease(project.id, scene => { assertNoLocalHandoffCloudTransition(layoutRef.current); backendSceneToLayout(scene, { projectId: project.id, name: project.name }); });
                try { await acceptScene(lease.scene, project.id, project.name, openingFrom); }
                catch (error) { await controller.releaseLease(); throw error; }
                setNotice('已载入最新版本并获得编辑权。');
              });
            }}>开始编辑</button>
            <button className="sc-cloud-primary" type="button" disabled={busy || cloud.writeBlocked || !bound || !!conversionError} onClick={() => void run(async () => {
              const current = layoutRef.current;
              await assertCloudTransition(current);
              assertNoLocalHandoffCloudTransition(layoutRef.current);
              if (layoutRef.current !== current) throw new Error('保存前画布有新改动，当前草稿已保留。请核对后重新保存。');
              const scene = layoutToBackendScene(current);
              const submitted = JSON.stringify(scene);
              const saved = await controller.saveScene(scene);
              await assertCloudTransition(current);
              await assertCloudTransition(layoutRef.current);
              setSavedFingerprint(submitted);
              setNotice(`已保存云端版本 ${saved.revision}${saved.warnings.length ? '，请留意场地重叠提示' : ''}。`);
            })}>保存</button>
            <button type="button" disabled={busy || cloud.writeBlocked} onClick={() => {
              if (dirty && !window.confirm('画布还有未保存到云端的改动。释放编辑权不会保存这些改动，确认交接吗？')) return;
              void run(async () => { await controller.releaseLease(); setNotice('编辑权已释放，队友可以接手。'); });
            }}>完成编辑</button>
          </div>
          {!bound && <p className="sc-cloud-muted">画布已切换到另一份本地草稿。请重新获取编辑权，或将当前草稿创建为新项目。</p>}
        </section>}
        <Link className="sc-account-manage-link" href="/projects/" aria-disabled={busy} onClick={event => { event.preventDefault(); void navigateFromWorkspace('/projects/'); }}>所有文件 <ArrowUpRight size={16} aria-hidden="true"/></Link>
        </aside>
      </div>}
      </section>
      <section hidden={section !== 'assets'} aria-label="账户素材库"><div className="sc-account-section-heading"><div className="sc-account-section-title"><h3>素材库</h3><InfoTip label="素材说明"><strong>可复用的场景物料</strong><span>管理可复用的场景物料。</span></InfoTip></div></div>{cloud.user ? <AssetsPanel controller={controller} layout={layout} onApplyLayout={onApplyLayout ?? onLoadLayout} bound={bound} busy={busy} /> : <p className="sc-account-empty">登录后查看素材。</p>}</section>
      </>)}
      {!settingsSurface && conversionError && <p className="sc-cloud-message" role="status">{conversionError}</p>}
      {!settingsSurface && localHandoff && !sceneConnection && notice !== LOCAL_HANDOFF_CLOUD_MESSAGE && <p className="sc-cloud-message" role="status">{LOCAL_HANDOFF_CLOUD_MESSAGE}</p>}
      {!settingsSurface && (notice || cloud.error) && <p className="sc-cloud-message" role="status">{notice || cloud.error?.message}</p>}
      </div>
      </div>
    </dialog>, document.body)}
  </>;
}
