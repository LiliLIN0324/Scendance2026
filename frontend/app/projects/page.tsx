'use client';

import { Building2, FolderOpen, Users, Settings2, Plus, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { useBackendSession, type Studio, type ProjectSummary } from '@/lib/backend-session';
import { emptyProjectScene, listMembers, listStudioProjects, preferredStudio, rememberStudio, type StudioMember } from '@/lib/workspace-api';
import '../workspace.css';

type Panel = 'projects' | 'members' | 'settings';
interface StudioData { scope: string; projects: ProjectSummary[]; members: StudioMember[] }

export default function ProjectsPage(): JSX.Element {
  const auth = useAuth()!;
  const controller = auth.controller;
  const cloud = useBackendSession(controller);
  const router = useRouter();
  const [studios, setStudios] = useState<Studio[]>([]);
  const [studioId, setStudioId] = useState('');
  const [data, setData] = useState<StudioData | null>(null);
  const [panel, setPanel] = useState<Panel>('projects');
  const [projectId, setProjectId] = useState('');
  const [creatingStudio, setCreatingStudio] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [name, setName] = useState('我的活动方案');
  const [size, setSize] = useState({ width: 12, depth: 10, height: 3 });
  const [studioName, setStudioName] = useState('');
  const [rename, setRename] = useState('');
  const [deleteName, setDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [memberName, setMemberName] = useState('');
  const [removing, setRemoving] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadingStudios, setLoadingStudios] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const studioRequest = useRef({ requestId: crypto.randomUUID(), name: '' });
  const userId = cloud.user?.id;
  const selected = studios.find(studio => studio.id === studioId);
  const scope = `${userId}:${studioId}`;
  const loaded = data?.scope === scope;
  const projects = loaded ? data.projects : [];
  const members = loaded ? data.members : [];
  const project = projects.find(item => item.id === projectId);
  const isOwner = selected?.role === 'owner';

  useEffect(() => {
    if (auth.ready && !userId) router.replace('/auth?next=%2Fprojects%2F');
  }, [auth.ready, userId, router]);
  useEffect(() => {
    setStudios([]); setStudioId(''); setData(null);
    if (!userId) return;
    let active = true;
    setLoadingStudios(true);
    void controller.listStudios().then(next => {
      if (!active) return;
      setStudios(next); setStudioId(preferredStudio(userId, next));
    }).catch(() => { if (active) setNotice('工作室加载失败，请刷新列表重试。'); })
      .finally(() => { if (active) setLoadingStudios(false); });
    return () => { active = false; };
  }, [controller, userId]);
  useEffect(() => {
    setData(null); setLoadError('');
    if (!studioId || !userId) return;
    let active = true;
    void Promise.all([listStudioProjects(controller, studioId), listMembers(controller, studioId)]).then(([nextProjects, nextMembers]) => {
      if (active) setData({ scope: `${userId}:${studioId}`, projects: nextProjects, members: nextMembers });
    }).catch(() => { if (active) setLoadError('工作室内容加载失败，请刷新列表重试。'); });
    return () => { active = false; };
  }, [controller, studioId, userId, refreshKey]);
  useEffect(() => { setRename(selected?.name ?? ''); }, [selected?.name]);

  function selectStudio(id: string): void {
    setStudioId(id); setProjectId(''); setCreatingStudio(false); setCreatingProject(false);
    setDeleting(false); setDeleteName(''); setRemoving(''); setMemberId(''); setMemberName(''); setNotice('');
    if (userId) rememberStudio(userId, id);
  }
  async function run(action: () => Promise<void>): Promise<void> {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice('');
    try { await action(); }
    catch (error) { setNotice(controller.getSnapshot().error?.message ?? (error instanceof Error ? error.message : '操作失败，请重试。')); }
    finally { pending.current = false; setBusy(false); }
  }
  async function refresh(): Promise<void> {
    const next = await controller.listStudios();
    setStudios(next); setLoadingStudios(false);
    if (!next.some(studio => studio.id === studioId)) selectStudio(next[0]?.id ?? '');
    setRefreshKey(key => key + 1);
  }
  function openPanel(next: Panel): void { setPanel(next); setCreatingStudio(false); setProjectId(''); }
  const roleLabel = (role: string) => role === 'owner' ? '负责人' : '编辑成员';

  if (!auth.ready || !cloud.user) return <main className="sc-studio-manager"><p role="status">正在打开你的工作室…</p></main>;
  return <main className="sc-studio-manager">
    <header className="sc-studio-manager-header"><Link className="sc-studio-manager-brand" href="/projects/">幕景 <span>Scendance</span></Link><Link href="/editor/">回到画布 <ArrowUpRight size={16} /></Link></header>
    <div className="sc-studio-manager-layout">
      <aside className="sc-studio-manager-sidebar">
        <label className="sc-studio-manager-switch"><span><Building2 size={16} /> 当前工作室</span><select aria-label="工作室" disabled={busy || loadingStudios} value={studioId} onChange={event => selectStudio(event.target.value)}>
          {!studios.length && <option value="">{loadingStudios ? '正在加载…' : '尚未加入工作室'}</option>}
          {studios.map(studio => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
        </select></label>
        {selected && <p className="sc-studio-manager-role">你是此工作室的{roleLabel(selected.role)}</p>}
        <nav aria-label="工作室管理">{([
          ['projects', '项目', FolderOpen], ['members', '成员', Users], ['settings', '设置', Settings2],
        ] as const).map(([id, label, Icon]) => <button key={id} disabled={busy || !selected} aria-current={panel === id && !creatingStudio ? 'page' : undefined} onClick={() => openPanel(id)}><Icon size={17} />{label}{id !== 'settings' && loaded && <span>{id === 'projects' ? projects.length : members.length}</span>}</button>)}</nav>
        <button className="sc-studio-manager-new" disabled={busy} onClick={() => { setCreatingStudio(true); setNotice(''); }}><Plus size={17} /> 创建工作室</button>
        <p className="sc-studio-manager-sidebar-note">每个工作室独立管理项目与成员。切换工作室，继续对应团队的工作。</p>
      </aside>
      <section className="sc-studio-manager-content" aria-label="工作室内容">
        <div className="sc-studio-manager-toolbar"><nav aria-label="当前位置">工作室{selected && !creatingStudio && <> / <strong>{selected.name}</strong> / {panel === 'projects' ? '项目' : panel === 'members' ? '成员' : '设置'}{project && <> / {project.name}</>}</>}{creatingStudio && ' / 创建工作室'}</nav><button disabled={busy} onClick={() => void run(refresh)}>刷新列表</button></div>
        {(notice || cloud.error) && <p className="sc-studio-manager-notice" role="status">{notice || cloud.error?.message}</p>}
        {!cloud.writeBlocked && <aside className="sc-studio-manager-notice">你仍持有「{cloud.project?.name}」的编辑权。<button disabled={busy} onClick={() => void run(async () => { await controller.releaseLease(); setNotice('编辑权已释放，未保存的画布仍保留在本机。'); })}>释放编辑权</button></aside>}
        {creatingStudio ? <form className="sc-studio-manager-form" onSubmit={event => { event.preventDefault(); if (!studioName.trim()) return; void run(async () => {
          const trimmed = studioName.trim();
          if (studioRequest.current.name !== trimmed) studioRequest.current = { requestId: crypto.randomUUID(), name: trimmed };
          const created = await controller.businessRequest<Studio>('/studios', 'POST', { ...studioRequest.current, displayName: '负责人' });
          setStudios(await controller.listStudios()); selectStudio(created.id); setPanel('projects'); setStudioName('');
          studioRequest.current = { requestId: crypto.randomUUID(), name: '' }; setNotice('新工作室已创建。');
        }); }}><h1>创建工作室</h1><p>为一个团队建立独立的项目空间，你将成为负责人。</p><label>工作室名称<input required maxLength={120} value={studioName} onChange={event => setStudioName(event.target.value)} placeholder="例如：拾光活动工作室" /></label><button className="sc-studio-manager-primary" disabled={busy || !studioName.trim()}>创建并进入</button></form>
        : !selected ? <div className="sc-studio-manager-empty"><Building2 size={30} /><h1>{loadingStudios ? '正在加载工作室…' : '从一个工作室开始'}</h1><p>创建工作室，或将你的账号 ID 提供给负责人以加入团队。</p><label>我的账号 ID<input readOnly value={cloud.user.id} onFocus={event => event.target.select()} /></label></div>
        : <>
          {loadError && <p className="sc-studio-manager-notice" role="alert">{loadError}</p>}
          {!loaded && !loadError && <p role="status">正在加载「{selected.name}」的项目与成员…</p>}
          {panel === 'projects' && <>
            <div className="sc-studio-manager-heading"><div><p className="sc-studio-manager-eyebrow">{selected.name}</p><h1>{project ? project.name : '项目'}</h1><p>项目归属当前工作室，工作室成员共享访问与编辑权限。</p></div><button className="sc-studio-manager-primary" disabled={busy || !loaded} onClick={() => { setCreatingProject(value => !value); setProjectId(''); }}><Plus size={16} /> 新建项目</button></div>
            {creatingProject && <form className="sc-studio-manager-form sc-studio-manager-inset" onSubmit={event => { event.preventDefault(); if (!name.trim() || !loaded) return; void run(async () => {
              const created = await controller.createProject(studioId, name.trim(), emptyProjectScene(size.width, size.depth, size.height));
              router.push(`/editor/?project=${encodeURIComponent(created.id)}`);
            }); }}><h2>新建活动方案</h2><p>归属工作室：<strong>{selected.name}</strong></p><label>方案名称<input maxLength={120} required value={name} onChange={event => setName(event.target.value)} /></label><div className="sc-studio-manager-dimensions">{(['width', 'depth', 'height'] as const).map((axis, index) => <label key={axis}>{['宽', '深', '高'][index]} / 米<input required type="number" min={axis === 'height' ? 1 : 2} max={axis === 'height' ? 6 : 100} step="0.1" value={size[axis]} onChange={event => setSize({ ...size, [axis]: event.target.valueAsNumber })} /></label>)}</div><button className="sc-studio-manager-primary" disabled={busy || !cloud.writeBlocked || !name.trim()}>创建并打开</button></form>}
            {project ? <section className="sc-studio-manager-project-detail"><button onClick={() => setProjectId('')}>← 返回项目列表</button><dl><div><dt>所属工作室</dt><dd>{selected.name}</dd></div><div><dt>云端版本</dt><dd>V{project.revision}</dd></div></dl><h2>参与人员 <span>{members.length}</span></h2><p>继承「{selected.name}」的全部成员，无需为项目单独分配。</p><ul className="sc-studio-manager-members">{members.map(member => <li key={member.userId}><span className="sc-studio-manager-avatar">{member.displayName.slice(0, 1)}</span><strong>{member.displayName}</strong><span>{roleLabel(member.role)}</span></li>)}</ul><button onClick={() => openPanel('members')}>管理工作室成员</button>{cloud.writeBlocked || cloud.project?.id === project.id ? <Link className="sc-studio-manager-open" href={`/editor/?project=${encodeURIComponent(project.id)}`}>打开方案 <ArrowUpRight size={16} /></Link> : <p>请先释放当前项目的编辑权</p>}{isOwner && <button className="sc-studio-manager-delete-project" disabled={busy || !cloud.writeBlocked} onClick={() => {
              if (!window.confirm(`删除「${project.name}」？项目将从工作室移除，客户分享链接立即失效。本机草稿和个人素材仍保留。`)) return;
              void run(async () => {
                await controller.deleteProject(project.id, project.revision);
                setData(current => current?.scope === scope ? { ...current, projects: current.projects.filter(item => item.id !== project.id) } : current);
                setProjectId(''); setNotice(`已删除「${project.name}」，客户分享已撤销。`);
              });
            }}>删除方案</button>}</section>
            : loaded && (projects.length ? <div className="sc-studio-manager-project-list">{projects.map(item => <article key={item.id}><span className="sc-studio-manager-project-icon"><FolderOpen size={22} /></span><div><button className="sc-studio-manager-project-name" onClick={() => setProjectId(item.id)}>{item.name}</button><p>{selected.name} · V{item.revision} · {members.length} 位参与人员</p><small>{item.lease_expires && Date.parse(item.lease_expires) > Date.now() ? `${item.current_editor || '有成员'}正在编辑` : '可接手编辑'}</small></div><button onClick={() => setProjectId(item.id)}>人员与详情</button>{cloud.writeBlocked || cloud.project?.id === item.id ? <Link href={`/editor/?project=${encodeURIComponent(item.id)}`}>打开方案 ↗</Link> : <span className="sc-studio-manager-muted">请先释放当前项目的编辑权</span>}</article>)}</div> : <div className="sc-studio-manager-empty"><FolderOpen size={30} /><h2>这个工作室还没有项目</h2><p>新建的项目将保存在「{selected.name}」，供工作室成员共同参与。</p></div>)}
          </>}
          {panel === 'members' && <>
            <div className="sc-studio-manager-heading"><div><p className="sc-studio-manager-eyebrow">{selected.name}</p><h1>成员</h1><p>这些成员可访问工作室内的全部项目。负责人管理工作室，编辑成员参与方案编辑。</p></div></div>
            <label className="sc-studio-manager-account">我的账号 ID<input readOnly value={cloud.user.id} onFocus={event => event.target.select()} /></label>
            {loaded && <ul className="sc-studio-manager-members">{members.map(member => <li key={member.userId}><span className="sc-studio-manager-avatar">{member.displayName.slice(0, 1)}</span><div><strong>{member.displayName}</strong><small>{member.userId === userId ? '你' : member.userId}</small></div><span>{roleLabel(member.role)}</span>{isOwner && member.role !== 'owner' && <button disabled={busy} onClick={() => setRemoving(member.userId)}>移除</button>}{removing === member.userId && <div className="sc-studio-manager-confirm"><p>移除「{member.displayName}」后，对方将无法访问本工作室的任何项目，当前编辑权也会失效。</p><button disabled={busy} onClick={() => void run(async () => { await controller.businessRequest(`/studios/${studioId}/members/${member.userId}`, 'DELETE'); setRemoving(''); setRefreshKey(key => key + 1); setNotice('成员已移除。'); })}>确认移除</button><button disabled={busy} onClick={() => setRemoving('')}>取消</button></div>}</li>)}</ul>}
            {isOwner && <form className="sc-studio-manager-form sc-studio-manager-inset" onSubmit={event => { event.preventDefault(); if (!memberName.trim() || !memberId.trim()) return; void run(async () => {
              await controller.businessRequest(`/studios/${studioId}/members/${encodeURIComponent(memberId.trim())}`, 'PUT', { displayName: memberName.trim() });
              setRefreshKey(key => key + 1); setMemberId(''); setMemberName(''); setNotice('编辑成员已加入工作室，可参与全部项目。');
            }); }}><h2>添加编辑成员</h2><p>请对方提供已注册账号的 ID。</p><label>成员账号 ID<input required value={memberId} onChange={event => setMemberId(event.target.value)} placeholder="对方提供的账号 UUID" /></label><label>成员显示名<input required maxLength={80} value={memberName} onChange={event => setMemberName(event.target.value)} /></label><button disabled={busy || !loaded || !memberId.trim() || !memberName.trim()}>添加编辑成员</button></form>}
          </>}
          {panel === 'settings' && <>
            <div className="sc-studio-manager-heading"><div><p className="sc-studio-manager-eyebrow">{selected.name}</p><h1>工作室设置</h1><p>管理当前工作室的名称与生命周期。</p></div></div>
            {!isOwner && <p className="sc-studio-manager-notice">只有工作室负责人可以重命名或删除工作室。</p>}
            <form className="sc-studio-manager-form" onSubmit={event => { event.preventDefault(); if (!isOwner || !rename.trim()) return; void run(async () => {
              const updated = await controller.businessRequest<Studio>(`/studios/${studioId}`, 'PATCH', { name: rename.trim() });
              setStudios(current => current.map(studio => studio.id === updated.id ? updated : studio)); setDeleting(false); setDeleteName(''); setNotice('工作室名称已更新，项目归属与成员权限保持不变。');
            }); }}><h2>工作室名称</h2><label>名称<input required maxLength={120} disabled={!isOwner || busy} value={rename} onChange={event => setRename(event.target.value)} /></label>{isOwner && <button disabled={busy || !rename.trim() || rename.trim() === selected.name}>保存名称</button>}</form>
            {isOwner && <section className="sc-studio-manager-danger"><h2>删除工作室</h2><p>{!loaded ? '加载完成后可检查工作室是否为空。' : projects.length ? `工作室内还有 ${projects.length} 个项目，暂时不能删除。请先处理其中的项目。` : '此工作室没有项目。删除后，工作室及成员关系将被移除，成员账号不会被删除。'}</p><button disabled={busy || !loaded || !!projects.length} onClick={() => setDeleting(true)}>删除工作室</button>{deleting && <form onSubmit={event => { event.preventDefault(); if (deleteName !== selected.name || !loaded || projects.length) return; void run(async () => {
              await controller.businessRequest(`/studios/${studioId}`, 'DELETE');
              const remaining = studios.filter(studio => studio.id !== studioId); setStudios(remaining); selectStudio(remaining[0]?.id ?? ''); setPanel('projects'); setNotice(`工作室「${selected.name}」已删除。`);
            }); }}><label>输入工作室名称「{selected.name}」以确认<input autoComplete="off" value={deleteName} onChange={event => setDeleteName(event.target.value)} /></label><button disabled={busy || deleteName !== selected.name || !loaded || !!projects.length}>永久删除</button><button type="button" disabled={busy} onClick={() => { setDeleting(false); setDeleteName(''); }}>取消</button></form>}</section>}
          </>}
        </>}
      </section>
    </div>
  </main>;
}
