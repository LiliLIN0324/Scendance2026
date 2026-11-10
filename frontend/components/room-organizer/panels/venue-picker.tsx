'use client';

/**
 * 「换场地 / 新建」弹层本体：卡片栅格（设计规范 v2.5.2 §二.4——选择器一律 icon 优先 + 卡片视觉）。
 * 「从空白开始」走现有立壳链；「从地图开始」（P2-a）建云项目后写本机户外标记并整页跳
 * `/editor/?project=<id>&start=outdoor`——workspace-shell 据此直接进 2D 规划，不挂室内工作台
 * （硬跳避免与已挂载画布的深链/租约状态打架；室内未保存草稿照旧留在本地存储，可回）。
 * 项目卡带俯视缩略预览，选中同标签 router.push（认证在 sessionStorage，新标签会变访客）；
 * 新建只输名字——没有工作室时静默建「个人工作室」。「云」一词不面向用户（§二.4 默认在云上）。模板与导入在下一期。
 */
import { Check, FolderOpen, Globe, Loader2, Plus, SquareDashed } from '@/components/solid-icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../../lib/auth-provider';
import { useBackendSession, type ProjectSummary, type Studio } from '../../../lib/backend-session';
import { emptyProjectScene, listStudioProjects, preferredStudio, rememberStudio } from '../../../lib/workspace-api';
import { createStarterOutdoorPlan, saveOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { BLANK_VENUE } from '../lib/blank-venue';
import type { Scene } from '../../../../supabase/functions/_shared/domain';

type Selection = { kind: 'blank' } | { kind: 'map' } | { kind: 'new' } | { kind: 'project'; id: string };

type CloudState =
  | { status: 'guest' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; studioId: string; projects: ProjectSummary[] };

const NEW_PROJECT_DEFAULT = '我的活动方案';
const PREVIEW_LIMIT = 12;

/** 最近动过的排最前；没有 updated_at 的落在后面，不打乱原序。 */
function byRecent(a: ProjectSummary, b: ProjectSummary): number {
  const stamp = (iso?: string) => { const ms = iso ? Date.parse(iso) : 0; return Number.isFinite(ms) ? ms : 0; };
  return stamp(b.updated_at) - stamp(a.updated_at);
}

/** 俯视草图：墙 = 矩形/多边形，主入口 = 绿点，物件 = 墨块。只给尺度感，不追求精确。 */
function VenuePreview({ scene }: { scene: Scene }): JSX.Element {
  const venue = scene.venue;
  const w = Math.max(1, venue.width);
  const d = Math.max(1, venue.depth);
  const W = 280; const H = 175; const M = 18;
  const k = Math.min((W - M * 2) / w, (H - M * 2) / d);
  const ox = (W - w * k) / 2; const oz = (H - d * k) / 2;
  const X = (x: number) => ox + x * k; const Z = (z: number) => oz + z * k;
  const polygon = venue.shape === 'polygon' && venue.polygon ? venue.polygon : null;
  const objects = scene.objects.slice(0, 200);
  return <svg className="sc-venue-preview" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="场地俯视预览">
    {polygon
      ? <polygon className="vp-venue" points={polygon.map(point => `${X(point.x)},${Z(point.z)}`).join(' ')} />
      : <rect className="vp-venue" x={ox} y={oz} width={w * k} height={d * k} />}
    {(venue.entrances ?? []).map(entrance => <rect key={entrance.id} className="vp-entrance" x={X(entrance.position.x) - 2.5} y={Z(entrance.position.z) - 2.5} width={5} height={5} />)}
    {objects.map(object => <rect key={object.id} className="vp-object"
      x={X(object.position.x - object.size.width / 2)} y={Z(object.position.z - object.size.depth / 2)}
      width={Math.max(2, object.size.width * k)} height={Math.max(2, object.size.depth * k)} />)}
  </svg>;
}

function Card({ selected, onSelect, visual, title, meta }: {
  selected: boolean; onSelect(): void; visual: ReactNode; title: string; meta: string;
}): JSX.Element {
  return <button type="button" className={`sc-venue-card${selected ? ' is-on' : ''}`} aria-pressed={selected} onClick={onSelect}>
    {selected && <Check className="sc-venue-card-check" size={16} aria-hidden="true" />}
    <span className="sc-venue-card-visual">{visual}</span>
    <strong>{title}</strong>
    <small>{meta}</small>
  </button>;
}

export function VenuePicker({ onClose, onBlankVenue }: { onClose(): void; onBlankVenue(): void }): JSX.Element {
  const { controller } = useAuth()!;
  const { user } = useBackendSession(controller);
  const router = useRouter();
  const userId = user?.id ?? '';
  const [selection, setSelection] = useState<Selection>({ kind: 'blank' });
  const [cloud, setCloud] = useState<CloudState>({ status: 'loading' });
  const [previews, setPreviews] = useState<Record<string, Scene | 'failed'>>({});
  const [name, setName] = useState(NEW_PROJECT_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // 列工作室 → 没有就静默建「个人工作室」→ 列项目。访客跳过整段，只留「从空白开始」。
  useEffect(() => {
    if (!userId) { setCloud({ status: 'guest' }); return; }
    let active = true;
    setCloud({ status: 'loading' });
    void (async () => {
      try {
        let studios = await controller.listStudios();
        if (!studios.length) {
          const created = await controller.businessRequest<Studio>('/studios', 'POST', { requestId: crypto.randomUUID(), name: '个人工作室', displayName: '负责人' });
          studios = [created];
        }
        const studioId = preferredStudio(userId, studios);
        rememberStudio(userId, studioId);
        const projects = (await listStudioProjects(controller, studioId)).slice().sort(byRecent);
        if (active) setCloud({ status: 'ready', studioId, projects });
      } catch (error) {
        if (active) setCloud({ status: 'error', message: error instanceof Error ? error.message : '方案列表加载失败，请重开弹层。' });
      }
    })();
    return () => { active = false; };
  }, [controller, userId]);

  // 项目卡各自拉 scene 画俯视缩略；拉不到就用占位图标，不挡打开。
  useEffect(() => {
    if (cloud.status !== 'ready') return;
    let active = true;
    for (const project of cloud.projects.slice(0, PREVIEW_LIMIT)) {
      controller.getProject(project.id)
        .then(full => { if (active) setPreviews(prev => ({ ...prev, [project.id]: full.scene })); })
        .catch(() => { if (active) setPreviews(prev => ({ ...prev, [project.id]: 'failed' })); });
    }
    return () => { active = false; };
  }, [controller, cloud]);

  const projects = cloud.status === 'ready' ? cloud.projects : [];
  const selectedProjectId = selection.kind === 'project' ? selection.id : '';
  const selectedProject = projects.find(project => project.id === selectedProjectId);
  const canStart = !busy && (selection.kind === 'blank'
    || (selection.kind === 'project' && !!selectedProject)
    || ((selection.kind === 'new' || selection.kind === 'map') && !!name.trim() && cloud.status === 'ready'));

  function confirm(): void {
    if (!canStart) return;
    if (selection.kind === 'blank') { onBlankVenue(); return; }
    if (selection.kind === 'project') { router.push(`/editor/?project=${encodeURIComponent(selection.id)}`); return; }
    if (cloud.status !== 'ready') return;
    const studioId = cloud.studioId;
    setBusy(true); setNotice('');
    if (selection.kind === 'map') {
      // 从地图开始（P2-a）：建云项目 → 写本机户外标记（含起步边界）→ 整页跳进 2D 规划。
      void controller.createProject(studioId, name.trim(), emptyProjectScene())
        .then(created => {
          const now = new Date().toISOString();
          saveOutdoorProjectRecord({
            v: 1,
            projectId: created.id,
            name: name.trim() || '户外规划',
            createdAt: now,
            updatedAt: now,
            plan: createStarterOutdoorPlan(),
          });
          window.location.assign(`/editor/?project=${encodeURIComponent(created.id)}&start=outdoor`);
        })
        .catch((error: unknown) => { setNotice(error instanceof Error ? error.message : '新建项目失败，请重试。'); setBusy(false); });
      return;
    }
    void controller.createProject(studioId, name.trim(), emptyProjectScene())
      .then(created => router.push(`/editor/?project=${encodeURIComponent(created.id)}`))
      .catch((error: unknown) => { setNotice(error instanceof Error ? error.message : '新建项目失败，请重试。'); setBusy(false); });
  }

  return <div className="sc-venue-picker">
    <div className="sc-venue-picker-grid" role="group" aria-label="从哪开始">
      <Card selected={selection.kind === 'blank'} onSelect={() => setSelection({ kind: 'blank' })}
        visual={<SquareDashed size={32} />} title="从空白开始" meta={`${BLANK_VENUE.width} × ${BLANK_VENUE.depth} m · 立刻开工`} />
      {cloud.status === 'ready' && (
        <Card selected={selection.kind === 'map'} onSelect={() => setSelection({ kind: 'map' })}
          visual={<Globe size={32} />} title="从地图开始" meta="户外活动 · 直接在地图上规划" />
      )}
      {projects.map(project => {
        const scene = previews[project.id];
        const loaded = scene && scene !== 'failed' ? scene : null;
        return <Card key={project.id}
          selected={selection.kind === 'project' && selection.id === project.id}
          onSelect={() => setSelection({ kind: 'project', id: project.id })}
          visual={loaded ? <VenuePreview scene={loaded} /> : <FolderOpen size={24} />}
          title={project.name}
          meta={loaded ? `${loaded.venue.width} × ${loaded.venue.depth} m · ${loaded.objects.length} 件物料` : `V${project.revision}`} />;
      })}
      {cloud.status === 'ready' && (
        <Card selected={selection.kind === 'new'} onSelect={() => setSelection({ kind: 'new' })}
          visual={<Plus size={32} />} title="新建项目" meta="起个名字就开工" />
      )}
    </div>
    {cloud.status === 'loading' && <p className="sc-venue-picker-note"><Loader2 size={14} className="cr-spin" aria-hidden="true" /> 正在加载你的方案…</p>}
    {cloud.status === 'guest' && <p className="sc-venue-picker-note">登录后可接着上次的方案继续。</p>}
    {cloud.status === 'error' && <p className="sc-venue-picker-note" role="alert">{cloud.message}</p>}
    {selection.kind === 'new' && (
      <label className="sc-venue-picker-name">方案名称
        <input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder={NEW_PROJECT_DEFAULT} />
      </label>
    )}
    {selection.kind === 'map' && (
      <label className="sc-venue-picker-name">活动名称
        <input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder={NEW_PROJECT_DEFAULT} />
      </label>
    )}
    <div className="sc-venue-picker-foot">
      <p className="sc-venue-picker-note" role="status">{notice}</p>
      <button type="button" className="sc-button" onClick={onClose} disabled={busy}>取消</button>
      <button type="button" className="sc-venue-picker-go" onClick={confirm} disabled={!canStart}>{busy ? '创建中…' : selection.kind === 'map' ? '开始规划' : '开始布置'}</button>
    </div>
  </div>;
}
