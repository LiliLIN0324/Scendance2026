'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { useBackendSession, type Studio, type ProjectSummary } from '@/lib/backend-session';
import { emptyProjectScene, listMembers, type StudioMember } from '@/lib/workspace-api';
import '../workspace.css';

export default function ProjectsPage(): JSX.Element {
  const auth = useAuth()!;
  const controller = auth.controller;
  const cloud = useBackendSession(controller);
  const router = useRouter();
  const [studios, setStudios] = useState<Studio[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [studioId, setStudioId] = useState('');
  const [members, setMembers] = useState<StudioMember[]>([]);
  const [name, setName] = useState('我的活动方案');
  const [size, setSize] = useState({ width: 12, depth: 10, height: 3 });
  const [studioName, setStudioName] = useState('');
  const [memberId, setMemberId] = useState('');
  const [memberName, setMemberName] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const studioRequest = useRef({ requestId: crypto.randomUUID(), name: '' });
  const userId = cloud.user?.id;
  const selected = studios.find(studio => studio.id === studioId);

  useEffect(() => {
    if (auth.ready && !userId) router.replace('/auth?next=%2Fprojects%2F');
  }, [auth.ready, userId, router]);
  useEffect(() => {
    if (!userId) { setProjects([]); setStudios([]); setMembers([]); return; }
    let active = true;
    void Promise.all([controller.listStudios(), controller.listProjects()]).then(([nextStudios, nextProjects]) => {
      if (!active) return;
      setStudios(nextStudios); setProjects(nextProjects); setStudioId(nextStudios[0]?.id ?? '');
    }).catch(() => { if (active) setNotice('工作室加载失败，请刷新列表重试。'); });
    return () => { active = false; };
  }, [controller, userId]);
  useEffect(() => {
    setMembers([]);
    if (!studioId || !userId) return;
    let active = true;
    void listMembers(controller, studioId).then(result => { if (active) setMembers(result); })
      .catch(() => { if (active) setNotice('成员列表加载失败，请刷新重试。'); });
    return () => { active = false; };
  }, [controller, studioId, userId]);

  async function run(action: () => Promise<void>): Promise<void> {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice('');
    try { await action(); }
    catch (error) { setNotice(controller.getSnapshot().error?.message ?? (error instanceof Error ? error.message : '操作失败，请重试。')); }
    finally { pending.current = false; setBusy(false); }
  }
  async function refresh(): Promise<void> {
    const [nextStudios, nextProjects] = await Promise.all([controller.listStudios(), controller.listProjects()]);
    setStudios(nextStudios); setProjects(nextProjects);
    const nextId = nextStudios.some(studio => studio.id === studioId) ? studioId : nextStudios[0]?.id ?? '';
    setStudioId(nextId);
    setMembers(nextId ? await listMembers(controller, nextId) : []);
  }
  if (!auth.ready || !cloud.user) return <main className="sc-projects"><p role="status">正在打开你的项目…</p></main>;
  return <main className="sc-projects">
    <header><Link className="sc-projects-brand" href="/projects/">幕景 <span>Scendance</span></Link><Link href="/editor/">回到画布 ↗</Link></header>
    <div className="sc-projects-title"><div><p>YOUR WORKSPACE</p><h1>让每个方案，都有下一步。</h1><span>项目、团队和交付，在这里继续。</span></div><button disabled={busy} onClick={() => void run(refresh)}>刷新列表</button></div>
    {(notice || cloud.error) && <p className="sc-projects-notice" role="status">{notice || cloud.error?.message}</p>}
    {!cloud.writeBlocked && <aside className="sc-projects-notice">你仍持有「{cloud.project?.name}」的编辑权。<button disabled={busy} onClick={() => void run(async () => { await controller.releaseLease(); setNotice('编辑权已释放。未保存的画布仍保留在本机。'); })}>释放编辑权</button></aside>}
    <div className="sc-projects-grid"><section>
      <label className="sc-projects-select">工作室<select disabled={busy} value={studioId} onChange={event => setStudioId(event.target.value)}>{studios.map(studio => <option key={studio.id} value={studio.id}>{studio.name}</option>)}</select></label>
      <div className="sc-project-grid">{projects.filter(project => project.studio_id === studioId).map(project => <article className="sc-project-card" key={project.id}>
        <span>SCENE / V{project.revision}</span><h2>{project.name}</h2><p>{project.lease_expires && Date.parse(project.lease_expires) > Date.now() ? '有成员正在编辑' : '可接手编辑'}</p>
        {!cloud.writeBlocked && cloud.project?.id !== project.id ? <p>请先释放当前项目的编辑权</p> : <Link href={`/editor/?project=${encodeURIComponent(project.id)}`}>打开方案 ↗</Link>}
        {selected?.role === 'owner' && <button className="sc-project-delete" disabled={busy || !cloud.writeBlocked} onClick={() => {
          if (!window.confirm(`删除「${project.name}」？项目将从工作室移除，客户分享链接立即失效。本机草稿和个人素材仍保留。`)) return;
          void run(async () => {
            await controller.deleteProject(project.id, project.revision);
            setProjects(current => current.filter(entry => entry.id !== project.id));
            setNotice(`已删除「${project.name}」，客户分享已撤销。`);
          });
        }}>删除方案</button>}
      </article>)}</div>
      {!projects.some(project => project.studio_id === studioId) && <p className="sc-projects-empty">这里还没有方案。创建一个场地，从空白开始。</p>}
      <form className="sc-projects-card" onSubmit={event => { event.preventDefault(); void run(async () => {
        const project = await controller.createProject(studioId, name.trim(), emptyProjectScene(size.width, size.depth, size.height));
        router.push(`/editor/?project=${encodeURIComponent(project.id)}`);
      }); }}>
        <h2>新建活动方案</h2><label>方案名称<input maxLength={120} required value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="sc-projects-dimensions">{(['width', 'depth', 'height'] as const).map((axis, index) => <label key={axis}>{['宽', '深', '高'][index]} / 米<input required type="number" min={axis === 'height' ? 1 : 2} max={axis === 'height' ? 6 : 100} step="0.1" value={size[axis]} onChange={event => setSize({ ...size, [axis]: event.target.valueAsNumber })} /></label>)}</div>
        <button className="sc-projects-primary" disabled={busy || !studioId || !cloud.writeBlocked}>创建并打开</button>
      </form>
    </section><aside>
      <section className="sc-projects-card"><h2>工作室成员</h2><p className="sc-projects-caption">将账号 ID 提供给负责人即可加入团队。</p><label>我的账号 ID<input readOnly value={cloud.user.id} onFocus={event => event.target.select()} /></label>
        <ul className="sc-member-list">{members.map(member => <li key={member.userId}><div><strong>{member.displayName}</strong><small>{member.role === 'owner' ? '负责人' : '编辑成员'}</small></div>{selected?.role === 'owner' && member.role !== 'owner' && <button disabled={busy} onClick={() => {
          if (!window.confirm(`移除「${member.displayName}」后，对方将失去这个工作室的编辑权。继续吗？`)) return;
          void run(async () => { await controller.businessRequest(`/studios/${studioId}/members/${member.userId}`, 'DELETE'); setMembers(await listMembers(controller, studioId)); });
        }}>移除</button>}</li>)}</ul>
        {selected?.role === 'owner' && <form onSubmit={event => { event.preventDefault(); void run(async () => {
          await controller.businessRequest(`/studios/${studioId}/members/${encodeURIComponent(memberId.trim())}`, 'PUT', { displayName: memberName.trim() });
          setMembers(await listMembers(controller, studioId)); setMemberId(''); setMemberName(''); setNotice('编辑成员已加入工作室。');
        }); }}><label>成员账号 ID<input required value={memberId} onChange={event => setMemberId(event.target.value)} placeholder="对方提供的账号 UUID" /></label><label>成员显示名<input required maxLength={80} value={memberName} onChange={event => setMemberName(event.target.value)} /></label><button disabled={busy || !studioId}>添加编辑成员</button></form>}
      </section>
      <form className="sc-projects-card" onSubmit={event => { event.preventDefault(); void run(async () => {
        const trimmed = studioName.trim();
        if (studioRequest.current.name !== trimmed) studioRequest.current = { requestId: crypto.randomUUID(), name: trimmed };
        const created = await controller.businessRequest<Studio>('/studios', 'POST', { ...studioRequest.current, displayName: '负责人' });
        setStudios(await controller.listStudios()); setStudioId(created.id); setStudioName(''); studioRequest.current = { requestId: crypto.randomUUID(), name: '' };
        setNotice('新工作室已创建。');
      }); }}><h2>建立新工作室</h2><p className="sc-projects-caption">将不同团队的成员和项目分别管理。</p><label>工作室名称<input required maxLength={120} value={studioName} onChange={event => setStudioName(event.target.value)} /></label><button disabled={busy}>创建工作室</button></form>
    </aside></div>
  </main>;
}
