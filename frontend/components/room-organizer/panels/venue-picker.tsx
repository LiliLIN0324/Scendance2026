'use client';

/**
 * 「换场地 / 新建」弹层本体：卡片栅格（设计规范 v2.5.2 §二.4——选择器一律 icon 优先 + 卡片视觉）。
 * 「从空白开始」「新建项目」「从地图开始」统一进地图工作台：登录态建云项目后写本机户外
 * 草稿并整页跳 `/editor/?project=<id>&mode=outdoor`；访客落本机默认地图草稿。workspace-shell
 * 据此直接进 2D 规划，不挂室内工作台（硬跳避免与已挂载画布的深链/租约状态打架）。
 * 项目卡带俯视缩略预览，选中同标签 router.push（认证在 sessionStorage，新标签会变访客）；
 * 新建只输名字——没有工作室时静默建「个人工作室」。「云」一词不面向用户（§二.4 默认在云上）。模板与导入在下一期。
 */
import { Check, FolderOpen, Globe, Loader2, Plus, SquareDashed } from '@/components/solid-icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useAuth } from '../../../lib/auth-provider';
import { useBackendSession, type ProjectSummary, type Studio } from '../../../lib/backend-session';
import { emptyProjectScene, listStudioProjects, preferredStudio, rememberStudio } from '../../../lib/workspace-api';
import { createStarterOutdoorPlan, ensureDefaultOutdoorProject, saveOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { matchRecentPlaces, mergePlaceSuggestions, rememberPlace, searchPlaces, type PlaceSuggestion } from '../lib/place-search';
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

export function VenuePicker({ onClose, studioId, initialSelection }: {
  onClose(): void;
  /** 「新建项目」带过来的工作室：新项目落在这里，不再按最近用的工作室猜。 */
  studioId?: string;
  /** 入口默认选中项：独立的「找场地」页直接落「从地图开始」。 */
  initialSelection?: 'blank' | 'map';
}): JSX.Element {
  const { controller } = useAuth()!;
  const { user } = useBackendSession(controller);
  const router = useRouter();
  const userId = user?.id ?? '';
  const [selection, setSelection] = useState<Selection>({ kind: initialSelection ?? 'blank' });
  const [cloud, setCloud] = useState<CloudState>({ status: 'loading' });
  const [previews, setPreviews] = useState<Record<string, Scene | 'failed'>>({});
  const [name, setName] = useState(NEW_PROJECT_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  // 「从地图开始」的活动地点：输入 → 高德 POI 建议 → 选中拿坐标（写进 plan.anchor）。
  const [placeQuery, setPlaceQuery] = useState('');
  const [place, setPlace] = useState<PlaceSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  // 模糊建议栏：最近选过的地点优先展示；键盘 ↑↓ 选、Enter 落定、Esc 收起。
  const [recentMatches, setRecentMatches] = useState<PlaceSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

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
        // 指定工作室优先（/projects 的「新建项目」会带过来）；失效则回落到最近用的那个。
        const targetStudio = studioId && studios.some(studio => studio.id === studioId) ? studioId : preferredStudio(userId, studios);
        rememberStudio(userId, targetStudio);
        const projects = (await listStudioProjects(controller, targetStudio)).slice().sort(byRecent);
        if (active) setCloud({ status: 'ready', studioId: targetStudio, projects });
      } catch (error) {
        if (active) setCloud({ status: 'error', message: error instanceof Error ? error.message : '方案列表加载失败，请重开弹层。' });
      }
    })();
    return () => { active = false; };
  }, [controller, userId, studioId]);

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

  // 地点建议：输入停顿 350ms 再搜；选中后就不再搜（避免把已选地名又拿去搜一遍）。
  useEffect(() => {
    if (selection.kind !== 'map') return;
    const query = placeQuery.trim();
    if (place || query.length < 2) { setSuggestions([]); setSearchingPlace(false); setActiveIndex(-1); return; }
    const controller = new AbortController();
    setSearchingPlace(true);
    const timer = window.setTimeout(() => {
      void searchPlaces(query, { signal: controller.signal })
        .then(found => {
          if (controller.signal.aborted) return;
          setSuggestions(found);
          setSearchingPlace(false);
          setActiveIndex(-1);
        })
        .catch(() => { if (!controller.signal.aborted) { setSuggestions([]); setSearchingPlace(false); } });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [placeQuery, place, selection.kind]);

  // 最近选过的地点：输入为空也先给建议（刚建过一次活动，下次多半还是常去的那个场地）。
  useEffect(() => {
    if (selection.kind !== 'map' || place) { setRecentMatches([]); return; }
    setRecentMatches(matchRecentPlaces(placeQuery));
  }, [placeQuery, place, selection.kind]);

  // 建议栏 = 最近命中（带「最近」标记）+ 搜索结果（按相关度排好，去重）；
  // 完全命中的新鲜结果压过「最近」（与 plan-place-search 同口径，见 mergePlaceSuggestions）。
  const recentIds = new Set(recentMatches.map(item => item.id));
  const placeOptions: { place: PlaceSuggestion; recent: boolean }[] = mergePlaceSuggestions(
    placeQuery,
    recentMatches,
    suggestions,
  ).map(item => ({ place: item, recent: recentIds.has(item.id) }));
  const showPlaceList = selection.kind === 'map' && !place
    && (searchingPlace || placeOptions.length > 0 || placeQuery.trim().length >= 2);

  function choosePlace(item: PlaceSuggestion): void {
    setPlace(item);
    setPlaceQuery(item.name);
    setSuggestions([]);
    setRecentMatches([]);
    setActiveIndex(-1);
    rememberPlace(item);
  }

  function onPlaceKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!showPlaceList) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!placeOptions.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(index => {
        const base = index < 0 ? (step > 0 ? -1 : 0) : index;
        return (base + step + placeOptions.length) % placeOptions.length;
      });
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0 && placeOptions[activeIndex]) {
      event.preventDefault();
      choosePlace(placeOptions[activeIndex].place);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      setSuggestions([]);
      setRecentMatches([]);
      setActiveIndex(-1);
    }
  }

  const projects = cloud.status === 'ready' ? cloud.projects : [];
  const selectedProjectId = selection.kind === 'project' ? selection.id : '';
  const selectedProject = projects.find(project => project.id === selectedProjectId);
  const nameReady = !!name.trim() && cloud.status === 'ready';
  const canStart = !busy && (
    selection.kind === 'blank'
    || (selection.kind === 'project' && !!selectedProject)
    || (selection.kind === 'new' && nameReady)
    || (selection.kind === 'map' && nameReady && !!place)
  );

  function confirm(): void {
    if (!canStart) return;
    if (selection.kind === 'project') { router.push(`/editor/?project=${encodeURIComponent(selection.id)}`); return; }
    // 访客 / 云列表未就绪：不建云项目，落本机默认地图草稿整页进 2D 规划。
    if (cloud.status !== 'ready') {
      const fallbackId = ensureDefaultOutdoorProject();
      window.location.assign(`/editor/?project=${encodeURIComponent(fallbackId)}&mode=outdoor`);
      return;
    }
    const studioId = cloud.studioId;
    // 所有新项目统一进地图工作台：建云项目 → 写本机地图草稿 → 整页跳进 2D 规划。
    // map 分支带上所选地点锚点；blank / new 分支用默认预置锚点，进地图后再选址。
    const anchor = selection.kind === 'map' && place
      ? { lng: place.lng, lat: place.lat, crs: 'gcj-02' as const, source: 'picker' as const }
      : null;
    const projectName = selection.kind === 'blank' ? NEW_PROJECT_DEFAULT : (name.trim() || NEW_PROJECT_DEFAULT);
    setBusy(true); setNotice('');
    void controller.createProject(studioId, projectName, emptyProjectScene())
      .then(created => {
        const now = new Date().toISOString();
        saveOutdoorProjectRecord({
          v: 1,
          projectId: created.id,
          name: projectName,
          createdAt: now,
          updatedAt: now,
          plan: createStarterOutdoorPlan(anchor ?? undefined),
        });
        window.location.assign(`/editor/?project=${encodeURIComponent(created.id)}&mode=outdoor`);
      })
      .catch((error: unknown) => { setNotice(error instanceof Error ? error.message : '新建项目失败，请重试。'); setBusy(false); });
  }

  return <div className="sc-venue-picker">
    <div className="sc-venue-picker-grid" role="group" aria-label="从哪开始">
      <Card selected={selection.kind === 'blank'} onSelect={() => setSelection({ kind: 'blank' })}
        visual={<SquareDashed size={32} />} title="从空白开始" meta="地图空白选址 · 进 2D 规划后再画边界" />
      {cloud.status === 'ready' && (
        <Card selected={selection.kind === 'map'} onSelect={() => setSelection({ kind: 'map' })}
          visual={<Globe size={32} />} title="从地图开始" meta="户外活动 · 选地点后直接进 2D 规划" />
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
    {selection.kind === 'map' && (<>
      <label className="sc-venue-picker-name">活动名称
        <input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder={NEW_PROJECT_DEFAULT} />
      </label>
      <label className="sc-venue-picker-name">活动地点
        <input value={placeQuery} maxLength={80} aria-label="活动地点"
          role="combobox" aria-expanded={showPlaceList} aria-controls="sc-venue-place-options"
          aria-autocomplete="list" aria-activedescendant={activeIndex >= 0 ? `sc-venue-place-opt-${activeIndex}` : undefined}
          onKeyDown={onPlaceKeyDown}
          onFocus={() => { if (!place) setRecentMatches(matchRecentPlaces(placeQuery)); }}
          onChange={event => { setPlaceQuery(event.target.value); setActiveIndex(-1); if (place) setPlace(null); }}
          placeholder="输入城市 / 场馆 / 地址，如：浙江省杭州 平湖秋月" />
      </label>
      {showPlaceList && (
        <div className="sc-venue-place-list" role="listbox" id="sc-venue-place-options" aria-label="活动地点候选">
          {searchingPlace && <p className="sc-venue-picker-note"><Loader2 size={14} className="cr-spin" aria-hidden="true" /> 正在搜地点…</p>}
          {!searchingPlace && placeOptions.length === 0 && placeQuery.trim().length >= 2 && (
            <p className="sc-venue-picker-note" role="status">没搜到，换个说法试试（先城市再场馆名更好搜）。</p>
          )}
          {placeOptions.map((option, index) => (
            <button key={option.place.id} type="button" role="option" id={`sc-venue-place-opt-${index}`}
              aria-selected={activeIndex === index}
              className={`sc-venue-place${activeIndex === index ? ' is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choosePlace(option.place)}>
              <span className="sc-venue-place-title">
                <strong>{option.place.name}</strong>
                {option.recent && <small className="sc-venue-place-tag">最近</small>}
              </span>
              {option.place.address && <small>{option.place.address}</small>}
            </button>
          ))}
        </div>
      )}
      {place && (
        <p className="sc-venue-picker-note" role="status" data-testid="venue-place-picked">
          已定位：{place.name}{place.address ? ` · ${place.address}` : ''}
        </p>
      )}
    </>)}
    <div className="sc-venue-picker-foot">
      <p className="sc-venue-picker-note" role="status">{notice}</p>
      <button type="button" className="sc-button" onClick={onClose} disabled={busy}>取消</button>
      <button type="button" className="sc-venue-picker-go" onClick={confirm} disabled={!canStart}>{busy ? '创建中…' : '开始规划'}</button>
    </div>
  </div>;
}
