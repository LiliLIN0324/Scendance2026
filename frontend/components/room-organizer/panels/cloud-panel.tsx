'use client';

import { ArrowUpRight, FolderOpen, Search, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AssetsPanel } from '@/components/business/assets-panel';
import { PublicationPanel } from '@/components/business/publication-panel';
import { createBackendSession, useBackendSession, type BackendSession, type ProjectSummary, type Studio } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { copySourceScope, flushSourceScope } from '@/lib/source-storage';
import { preferredStudio, rememberStudio } from '@/lib/workspace-api';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { assertNoLocalHandoffCloudTransition, assertNoLocalRecordsCloudTransition, hasLocalHandoff, LOCAL_HANDOFF_CLOUD_MESSAGE } from '../lib/handoff-cloud-guard';
import { ensureGlbAsset } from '../three/glb-assets';
import { AccountTeamDemo } from './account-team-demo';
import { useLocalProjectBackup } from './creative-studio';
import { LocalActivitiesPanel } from './local-activities-panel';
import type { RoomLayout } from '../lib/types';

interface Props { controller?: BackendSession; layout: RoomLayout; onLoadLayout(layout: RoomLayout): void; onApplyLayout?(layout: RoomLayout): void; onClose?(): void }

export function CloudPanel({ layout, onLoadLayout, controller: providedController, onApplyLayout, onClose }: Props): JSX.Element {
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
  const selectedStudio = studios.find(studio => studio.id === studioId);
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
    if (!cloud.writeBlocked && cloud.project?.id !== id) {
      setNotice('请先释放当前项目的编辑权，再打开链接中的项目。');
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
    setProjects([]); setStudios([]); setStudioId(''); setQuery(''); setProjectsLoaded(false); setSection('projects');
    if (!userId) { openedRequest.current = ''; setNotice(''); setLoadingProjects(false); dialog.current?.close(); return; }
    let cancelled = false;
    setLoadingProjects(true);
    void Promise.all([controller.listProjects(), controller.listStudios()]).then(([nextProjects, nextStudios]) => {
      if (cancelled) return;
      setProjects(nextProjects); setStudios(nextStudios); setStudioId(preferredStudio(userId, nextStudios, controller.getSnapshot().project?.studio_id)); setProjectsLoaded(true);
    }).catch(() => { if (!cancelled) setNotice('项目加载失败，请点击刷新列表重试。'); }).finally(() => { if (!cancelled) setLoadingProjects(false); });
    return () => { cancelled = true; };
  }, [controller, userId]);
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
  openRequested.current = id => run(async () => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      dialog.current?.showModal(); throw new Error('项目链接无效。');
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
        dialog.current?.showModal(); return;
      }
      await acceptScene(project.scene, project.id, project.name, openingFrom);
      setNotice('已打开项目。获取编辑权后可以保存修改。');
    } catch (error) { dialog.current?.showModal(); throw error; }
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
  const saveStatus = sceneConnection ? '场景已连接 · 活动存本机' : !cloud.user || !bound ? '本地草稿' : cloud.writeBlocked ? '云项目 · 只读' : dirty ? '有改动待保存' : '云端已保存';
  const accountName = cloud.user?.is_anonymous ? '访客' : cloud.user?.email?.split('@')[0] || (cloud.user ? '我的账户' : '本地体验');

  return <>
    <button className="sc-cloud-trigger" type="button" aria-label="账户与项目" title="账户与项目" aria-haspopup="dialog" onClick={() => { setSection('projects'); dialog.current?.showModal(); }}>
      <span className="sc-account-trigger-avatar" aria-hidden="true"><UserRound size={17}/></span>
    </button>
    <dialog ref={dialog} className="sc-cloud-dialog sc-account-dialog" aria-labelledby="cloud-title" onClose={onClose} onKeyDown={event => event.stopPropagation()}>
      <div className="sc-account-scroll">
      <div className="sc-cloud-heading"><div><span className="sc-cloud-eyebrow">SCENDANCE / 账户中心</span><h2 id="cloud-title">你的创作，从这里继续。</h2></div><button className="sc-cloud-close" type="button" aria-label="关闭账户面板" autoFocus onClick={() => dialog.current?.close()}><X size={21}/></button></div>
      <div className="sc-account-profile"><span className="sc-account-avatar" aria-hidden="true">{accountName.slice(0, 1).toUpperCase()}</span><div><strong>{accountName}</strong><span>{cloud.user?.is_anonymous ? '独立访客身份 · 普通用户权限' : cloud.user?.email ?? '在本机布置场地，也可以探索团队演示。'}</span></div>{cloud.user ? <button type="button" disabled={busy} onClick={() => void run(async () => { await flushSourceScope(layoutRef.current.id ?? 'local'); await controller.signOut(); setProjects([]); setStudios([]); setBoundLayout(undefined); setSavedFingerprint(null); })}>退出登录</button> : <Link className="sc-cloud-primary" href="/auth" aria-disabled={busy} onClick={event => { event.preventDefault(); void navigateFromWorkspace('/auth'); }}>前往登录</Link>}</div>
      <nav className="sc-account-nav" aria-label="账户导航">{[
        ['projects', '我的项目'], ['team', '团队演示'], ['permissions', '权限演示'], ['assets', '素材库'], ['publication', '发布管理'],
      ].map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}</nav>
      <div className="sc-account-body">
      <section hidden={section !== 'projects'} aria-label="我的项目">
      <div className="sc-account-canvas"><span className="sc-account-project-icon" aria-hidden="true"><FolderOpen size={21}/></span><div><small>当前画布</small><strong>{layout.name || '未命名活动'}</strong></div><span className="sc-cloud-badge">{saveStatus}</span></div>
      {localActivities && localWorkspace && <LocalActivitiesPanel layout={layout} actions={localActivities} disabled={busy} onComplete={() => dialog.current?.close()}/>}
      {sceneConnection && <section className="sc-cloud-current" aria-label="当前活动的场景连接">
        <h3>当前只连接场景服务</h3>
        <p>活动编号保持不变。场景和本次需求用于助手处理；任务、制作计划与点验继续保存在本机，不随场景连接上传。</p>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await controller.disconnectGeometryWorkbench(); setNotice('场景服务已断开，本机活动和原连接记录已保留。下次使用助手时会重新核对连接。'); })}>断开场景服务</button>
      </section>}
      {!cloud.configured ? <div className="sc-cloud-offline">
        <span className="sc-cloud-badge">本地工作台</span>
        <h3>当前使用本地工作台</h3>
        <p>当前环境尚未连接云服务。草稿保留在此浏览器，连接后可在账户中统一管理云项目。</p>
        <p className="sc-cloud-muted">当前画布支持导出符合后端格式的场景文件，便于交接和检查。</p>
        <button type="button" onClick={downloadContract} disabled={!!conversionError}>导出场景数据</button>
      </div> : !cloud.user ? <div className="sc-cloud-form">
        <p>登录你的工作室，继续连接云项目。</p>
      </div> : <div className="sc-cloud-content">
        <div className="sc-account-section-heading"><div><h3>{sceneConnection?'其他云项目':'我的项目'}</h3><p className="sc-cloud-muted">{sceneConnection?'当前活动的场景连接已显示在上方。':'在工作室之间切换，继续你的场地方案。'}</p></div><button type="button" disabled={busy || loadingProjects} onClick={() => void run(refreshProjects)}>刷新列表</button></div>
        <div className="sc-account-project-grid"><section aria-label="项目列表">
        <div className="sc-account-filters"><label className="sc-account-search"><Search size={16} aria-hidden="true"/><input aria-label="搜索项目" type="search" placeholder="搜索项目名称" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="当前工作室" disabled={busy || loadingProjects} value={studioId} onChange={event => { setStudioId(event.target.value); if (userId) rememberStudio(userId, event.target.value); }}>{!studios.length && <option value="">尚未加入工作室</option>}{studios.map(studio => <option key={studio.id} value={studio.id}>{studio.name}</option>)}</select></div>
        <div className="sc-account-list-caption"><span>项目 / 工作室</span><span>{loadingProjects ? '加载中…' : projectsLoaded ? `${filteredProjects.length} 个项目` : '尚未加载'}</span></div>
        {loadingProjects && <p className="sc-account-empty" role="status">正在加载你的项目…</p>}
        <ul className="sc-cloud-projects">{filteredProjects.map(project => <li key={project.id}>
          <span className="sc-account-project-icon" aria-hidden="true"><FolderOpen size={21}/></span>
          <div className="sc-account-project-info"><strong>{project.name}</strong><small>{studios.find(studio => studio.id === project.studio_id)?.name ?? '工作室'} · 版本 {project.revision}</small><small>{project.id === cloud.project?.id ? '当前项目' : project.current_editor && project.lease_expires && Date.parse(project.lease_expires) > Date.now() ? '有成员正在编辑' : '可打开查看'}</small></div><button type="button" disabled={busy || !cloud.writeBlocked} onClick={() => {
          if (!confirmReplace()) return;
          void run(async () => {
            const openingFrom = layoutRef.current;
            await assertCloudTransition(openingFrom);
            await flushBeforeReplacement(openingFrom);
            setBoundLayout(undefined);
            const opened = await controller.getProject(project.id, candidate => { assertNoLocalHandoffCloudTransition(layoutRef.current); backendSceneToLayout(candidate.scene, { projectId: candidate.id, name: candidate.name }); });
            await acceptScene(opened.scene, opened.id, opened.name, openingFrom);
            setNotice('已打开云端方案；获取编辑权后可以保存修改。');
          });
        }}>打开</button></li>)}</ul>
        {!loadingProjects && projectsLoaded && !filteredProjects.length && <div className="sc-account-empty"><FolderOpen size={28} aria-hidden="true"/><h3>{studioProjects.length ? '没有匹配的项目' : sceneConnection?'暂无其他云项目':'这个工作室还没有项目'}</h3><p>{studioProjects.length ? '试试其他名称。' : sceneConnection?'当前活动的完整资料仍保存在本机。':'把当前画布存为新项目，或切换工作室。'}</p>{query && <button type="button" onClick={() => { setQuery(''); }}>清除筛选</button>}</div>}
        {!cloud.writeBlocked && <p className="sc-cloud-muted">{sceneConnection?'打开其他云项目前，请先断开场景服务并保留本机备份。':'切换项目或新建前，请先保存修改并释放当前项目的编辑权。'}</p>}
        <div className="sc-cloud-new">
          <p className="sc-cloud-muted">{selectedStudio ? `新项目将归属「${selectedStudio.name}」` : '请先创建或加入工作室。'}</p>
          <button type="button" disabled={busy || sceneConnection || !studioId || !cloud.writeBlocked || !!conversionError} onClick={() => void run(async () => {
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
              catch { sourceNotice = ' 本机资料未能复制到新项目；请回到原草稿核对，或重新选择来源图片。'; }
              await acceptScene(created.scene, created.id, created.name, current);
            } catch(error) {
              throw new Error(`云端创建请求已返回，结果待核对；当前画布未替换。${error instanceof Error ? error.message : '请保留原草稿并核对本机资料。'}`);
            }
            await refreshProjects(); setNotice(`新项目已保存，获取编辑权后可继续云端编辑。${sourceNotice}`);
          })}>把当前画布创建为新项目</button>
        </div>
        </section><aside aria-label="当前项目管理">
        {cloud.project && !sceneConnection && <section className="sc-cloud-current">
          <span className="sc-cloud-eyebrow">{studios.find(studio => studio.id === cloud.project?.studio_id)?.name ?? '所属工作室加载中'} / 当前云项目</span><h3>{cloud.project.name}</h3>
          <p>版本 {cloud.revision} · {cloud.writeBlocked ? '尚未持有有效编辑权，改动只保留在本地' : '你正在编辑，每 30 秒续期'}{dirty ? ' · 画布有未保存改动' : ''}</p>
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
            }}>获取编辑权</button>
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
            })}>保存到云端</button>
            <button type="button" disabled={busy || cloud.writeBlocked} onClick={() => {
              if (dirty && !window.confirm('画布还有未保存到云端的改动。释放编辑权不会保存这些改动，确认交接吗？')) return;
              void run(async () => { await controller.releaseLease(); setNotice('编辑权已释放，队友可以接手。'); });
            }}>释放编辑权</button>
          </div>
          {!bound && <p className="sc-cloud-muted">画布已切换到另一份本地草稿。请重新获取编辑权，或将当前草稿创建为新项目。</p>}
        </section>}
        <Link className="sc-account-manage-link" href="/projects/" aria-disabled={busy} onClick={event => { event.preventDefault(); void navigateFromWorkspace('/projects/'); }}>管理工作室、项目与成员 <ArrowUpRight size={14} aria-hidden="true"/></Link>
        </aside></div>
      </div>}
      </section>
      <div hidden={section !== 'team' && section !== 'permissions'}><AccountTeamDemo key={userId ?? 'local'} view={section === 'permissions' ? 'permissions' : 'team'} /></div>
      <section hidden={section !== 'assets'} aria-label="账户素材库"><div className="sc-account-section-heading"><div><h3>素材库</h3><p className="sc-cloud-muted">管理可复用的场景物料。</p></div></div>{cloud.user ? <AssetsPanel controller={controller} layout={layout} onApplyLayout={onApplyLayout ?? onLoadLayout} bound={bound} busy={busy} /> : <p className="sc-account-empty">登录账户后查看云端素材。</p>}</section>
      <section hidden={section !== 'publication'} aria-label="发布管理"><div className="sc-account-section-heading"><div><h3>发布管理</h3><p className="sc-cloud-muted">为当前项目管理客户查看链接。</p></div></div>{sceneConnection ? <p className="sc-account-empty">当前连接用于场景处理。需要交给客户的资料，请从“方案评审”核对并导出。</p> : cloud.user && cloud.project && cloud.revision !== null ? <PublicationPanel controller={controller} projectId={cloud.project.id} revision={cloud.revision} dirty={dirty || !bound || busy || !!conversionError} /> : <p className="sc-account-empty">在「我的项目」中打开一个云项目后，即可管理发布。</p>}</section>
      {conversionError && <p className="sc-cloud-message" role="status">{conversionError}</p>}
      {localHandoff && !sceneConnection && notice !== LOCAL_HANDOFF_CLOUD_MESSAGE && <p className="sc-cloud-message" role="status">{LOCAL_HANDOFF_CLOUD_MESSAGE}</p>}
      {(notice || cloud.error) && <p className="sc-cloud-message" role="status">{notice || cloud.error?.message}</p>}
      </div>
      <div className="sc-cloud-footer">本地草稿与云端版本分别保存。云端写入失败时，当前画布仍然保留。</div>
      </div>
    </dialog>
  </>;
}
