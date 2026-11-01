'use client';

import { FolderOpen, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ensureActivityCover, saveActivityCover } from '@/lib/activity-cover';
import { archiveLocalActivity, createLocalActivityBackup, listLocalActivities, readLocalActivity, LOCAL_ACTIVITIES_NAMESPACE,
  type LocalActivityList, type NewLocalActivityMode } from '@/lib/local-activities';
import { parseLocalProjectBackupJson } from '@/lib/local-project-backup';
import { subscribeSourceNamespace } from '@/lib/source-storage';
import { captureStageCover } from '@/lib/stage-cover';
import { MAX_NAME_LENGTH } from '../lib/schema';
import { InfoTip } from './info-tip';
import { PlanThumb } from './plan-thumb';
import type { LocalProjectBackupActions } from './creative-studio';
import type { RoomLayout } from '../lib/types';
import './local-activities-panel.css';

export interface LocalActivitiesPanelProps {
  layout: RoomLayout;
  actions: LocalProjectBackupActions;
  disabled?: boolean;
  /** 'create' is the rail's new-activity popover; 'list' is the account's project list. */
  mode?: 'all' | 'create' | 'list';
  /** Save state printed on the current-activity card, replacing the block that used to sit above the list. */
  currentStatus?: string;
  onComplete?: (() => void) | undefined;
}
type Working = 'prepare' | 'archive' | 'read' | 'restore';
interface Token { id: number; epoch: number; scope: string; permissionEpoch: number }

/** Cards are narrow: seconds never fit beside the item count. */
function archivedStamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN',
    { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function LocalActivitiesPanel({ layout, actions, disabled = false, mode = 'all', currentStatus = '', onComplete }: LocalActivitiesPanelProps): JSX.Element {
  const showCreate = mode !== 'list', showList = mode !== 'create';
  const [name, setName] = useState(''), [activityMode, setActivityMode] = useState<NewLocalActivityMode>('empty');
  const [activities, setActivities] = useState<LocalActivityList>({ activities: [], unreadableProjectIds: [] });
  const [listLoading, setListLoading] = useState(false), [listError, setListError] = useState('');
  const [working, setWorking] = useState<Working | null>(null), [error, setError] = useState('');
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const [still, setStill] = useState<{ scope: string; dataUrl: string } | null>(null);
  const mounted = useRef(true), listRequest = useRef(0), pending = useRef(false), sectionRef = useRef<HTMLElement>(null);
  const operation = useRef({ id: 0, stage: null as Working | null, scope: '', target: '' });
  const baseline = useRef({ layout, scope: layout.id ?? '', disabled, epoch: 0, permissionEpoch: 0 });
  if (baseline.current.layout !== layout || baseline.current.scope !== (layout.id ?? '') || baseline.current.disabled !== disabled) {
    baseline.current = { layout, scope: layout.id ?? '', disabled, epoch: baseline.current.epoch + 1,
      permissionEpoch: baseline.current.permissionEpoch + (baseline.current.disabled !== disabled ? 1 : 0) };
  }
  const epoch = baseline.current.epoch;
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++listRequest.current;
    setListLoading(true); setListError('');
    try {
      const next = await listLocalActivities();
      if (mounted.current && request === listRequest.current) setActivities(next);
    } catch (caught) {
      if (mounted.current && request === listRequest.current) setListError(caught instanceof Error ? caught.message : '活动列表未能读取，请重试。原归档已保留。');
    } finally {
      if (mounted.current && request === listRequest.current) setListLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (showList) void refresh();
    return () => { mounted.current = false; };
  }, [refresh, showList]);
  // The rail popover archives through another panel instance; keep this list current.
  useEffect(() => showList ? subscribeSourceNamespace(LOCAL_ACTIVITIES_NAMESPACE, () => { void refresh(); }) : undefined, [refresh, showList]);
  // Archives made before covers existed get one while their canvas is the one on screen.
  useEffect(() => {
    const scope = layout.id;
    if (!showList || !scope) return undefined;
    const entry = activities.activities.find(activity => activity.projectId === scope);
    if (!entry || entry.cover) return undefined;
    let cancelled = false;
    void ensureActivityCover(scope).then(saved => { if (saved && !cancelled && mounted.current) void refresh(); });
    return () => { cancelled = true; };
  }, [activities, layout.id, refresh, showList]);
  // The open canvas has no archived cover yet: take one from the live 3D view whenever this panel is on screen.
  useEffect(() => {
    const section = sectionRef.current;
    if (!showList || !section || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      const dataUrl = captureStageCover();
      if (dataUrl) setStill({ scope: layout.id ?? '', dataUrl });
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, [layout, showList]);
  useEffect(() => {
    if (operation.current.stage === 'restore') return;
    const interrupted = operation.current.stage !== null;
    const sameScope = operation.current.scope === baseline.current.scope;
    operation.current = { id: operation.current.id + 1, stage: null, scope: '', target: '' };
    pending.current = false; setWorking(null);
    setError(interrupted && sameScope ? '当前场景已变化，操作已停止。请重新核对后再试，输入已保留。' : '');
    setNotice(current => current?.scope === baseline.current.scope ? current : null);
  }, [epoch]);

  const identityMissing = !layout.id?.trim();
  const busy = !!working || actions.backupPending;
  const locked = disabled || identityMissing || busy;
  function begin(): Token | null {
    if (disabled || identityMissing || actions.backupPending || pending.current) return null;
    const token = { id: operation.current.id + 1, epoch: baseline.current.epoch, scope: baseline.current.scope,
      permissionEpoch: baseline.current.permissionEpoch };
    operation.current = { id: token.id, stage: 'prepare', scope: token.scope, target: '' };
    pending.current = true; setWorking('prepare'); setError(''); setNotice(null);
    return token;
  }
  function active(token: Token): boolean {
    return mounted.current && operation.current.id === token.id;
  }
  function assertCurrent(token: Token): void {
    if (!active(token) || baseline.current.epoch !== token.epoch || baseline.current.disabled || baseline.current.scope !== token.scope) {
      throw new Error('当前活动或场景已变化，未继续切换。输入及原活动已保留，请重新核对。');
    }
  }
  function stage(token: Token, value: Working): void {
    assertCurrent(token); operation.current.stage = value; setWorking(value);
  }
  async function switchActivity(targetId?: string): Promise<void> {
    if (!targetId && !name.trim()) { if (!locked) setError('请填写新活动名称。'); return; }
    const token = begin(); if (!token) return;
    const nextName = name, nextMode = activityMode;
    try {
      const text = await actions.prepareBackup();
      stage(token, 'archive');
      // The canvas still shows the outgoing activity; capture before the scene swaps.
      const cover = captureStageCover();
      const archived = await archiveLocalActivity(text, token.scope, () => assertCurrent(token));
      await saveActivityCover(token.scope, cover);
      assertCurrent(token); if (showList) void refresh();
      let candidate;
      if (targetId) {
        stage(token, 'read');
        candidate = await readLocalActivity(targetId);
      } else {
        const backup = createLocalActivityBackup(archived.layout, nextName, nextMode);
        candidate = parseLocalProjectBackupJson(JSON.stringify(backup));
      }
      assertCurrent(token);
      const targetScope = candidate.layout.id;
      if (!targetScope?.trim()) throw new Error('待打开活动缺少有效编号，当前活动未改变。');
      stage(token, 'restore'); operation.current.target = targetScope;
      await actions.restoreBackup(candidate);
      // Provider restore may itself replace the baseline; only its intended activity may receive completion.
      if (active(token) && !baseline.current.disabled && baseline.current.permissionEpoch === token.permissionEpoch &&
          (baseline.current.epoch === token.epoch || baseline.current.scope === targetScope)) {
        setNotice({ scope: targetScope, text: `已打开「${candidate.layout.name}」，原活动已归档到本机。` });
        setError(''); if (!targetId) setName(''); onComplete?.();
      }
    } catch (caught) {
      if (active(token) && !baseline.current.disabled && baseline.current.permissionEpoch === token.permissionEpoch &&
          (baseline.current.scope === token.scope || baseline.current.scope === operation.current.target)) {
        setError(caught instanceof Error ? caught.message : '活动未切换，请重试。输入及原活动已保留。');
      }
    } finally {
      if (active(token)) {
        operation.current.stage = null; pending.current = false; setWorking(null);
      }
    }
  }
  function create(event: FormEvent): void { event.preventDefault(); void switchActivity(); }

  // Current canvas and archives share one list: the open activity is its first card, archives follow.
  const archives = activities.activities.filter(activity => activity.projectId !== layout.id);
  // A live still always beats the cover stored when this activity was archived earlier.
  const currentStill = still && still.scope === (layout.id ?? '') ? still.dataUrl : null;
  const currentThumb = currentStill ?? activities.activities.find(activity => activity.projectId === layout.id)?.cover;
  const currentItems = layout.floors.reduce((count, floor) => count + floor.items.length, 0);
  const currentName = layout.name || '未命名活动';

  return <section ref={sectionRef} className="sc-local-activities" aria-label="本机活动">
    {identityMissing && <p className="sc-handoff-error" role="alert">请先保存有明确编号的当前活动，再新建或打开其他活动。</p>}
    {showCreate && <div className="sc-activity-group">
      <header className="sc-activity-head">
        <div className="sc-settings-title"><h3>新建本机活动</h3><InfoTip label="本机活动说明"><strong>切换前自动归档</strong><span>新建或打开前，先将当前完整活动归档到本机；照片附件和模型文件仍需另行保留。新活动不带入原需求、任务、制作计划、工作单、备注、方案历史、底图附件或点验账册，空场地尺寸之后可按实际修改。</span></InfoTip></div>
      </header>
      <form className="sc-activity-form" aria-label="新建本机活动" onSubmit={create}>
        <fieldset disabled={locked}>
          <label className="sc-field"><span>新活动名称</span><input value={name} maxLength={MAX_NAME_LENGTH} placeholder="输入活动名称" onChange={event => { if (!locked && !pending.current) setName(event.currentTarget.value); }}/></label>
          <div className="sc-local-activities-modes">
            <label><input type="radio" name="new-local-activity-mode" value="empty" checked={activityMode === 'empty'} onChange={() => { if (!locked && !pending.current) setActivityMode('empty'); }}/>空场地（10×8米示例）</label>
            <label><input type="radio" name="new-local-activity-mode" value="reuse-layout" checked={activityMode === 'reuse-layout'} onChange={() => { if (!locked && !pending.current) setActivityMode('reuse-layout'); }}/>沿用当前布置</label>
          </div>
          <button type="submit" className="sc-cloud-primary sc-activity-create">新建活动</button>
        </fieldset>
      </form>
    </div>}
    {showList && <div className="sc-activity-group">
      <header className="sc-activity-head">
        <div className="sc-settings-title"><h3>本机活动</h3><span className="sc-settings-count is-chip">{archives.length + 1} 个</span></div>
        <button type="button" className="sc-activity-refresh" aria-label="刷新活动列表" title="刷新活动列表" disabled={disabled || busy || listLoading} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true"/></button>
      </header>
      {listLoading && <p className="sc-activity-status" role="status">正在读取活动列表…</p>}
      {listError && <p className="sc-handoff-error" role="alert">{listError}</p>}
      {activities.unreadableProjectIds.length > 0 && <p className="sc-handoff-error" role="alert">有{activities.unreadableProjectIds.length}份本机活动无法读取，原资料已保留。请先核对备份。</p>}
      {!listLoading && !activities.activities.length && !listError && <p className="sc-activity-status">还没有归档活动。新建或切换活动时，当前画布会自动归档到这里。</p>}
      <ul className="sc-local-activities-list">
        <li className="is-current" aria-label={`当前活动「${currentName}」`}>
          <div className="sc-activity-thumb">
            {currentThumb
              ? <img className="sc-activity-thumb-image" src={currentThumb} alt="" loading="lazy"/>
              : <PlanThumb layout={layout} width={320} height={190} className="sc-activity-thumb-canvas" style={{ width: '100%', height: 'auto' }}/>}
            <span className="sc-activity-current">当前</span>
          </div>
          <div className="sc-activity-card-body"><strong title={currentName}>{currentName}</strong><span>{currentItems} 个物件{currentStatus ? ` · ${currentStatus}` : ''}</span></div>
        </li>
        {archives.map(activity => <li key={activity.projectId}>
          <div className="sc-activity-thumb">
            {activity.cover
              ? <img className="sc-activity-thumb-image" src={activity.cover} alt="" loading="lazy"/>
              : activity.preview
                ? <PlanThumb layout={activity.preview} width={320} height={190} className="sc-activity-thumb-canvas" style={{ width: '100%', height: 'auto' }}/>
                : <span className="sc-activity-thumb-empty" aria-hidden="true"><FolderOpen size={20}/></span>}
          </div>
          <div className="sc-activity-card-body"><strong title={activity.name}>{activity.name}</strong><span>{activity.itemCount} 个物件 · {archivedStamp(activity.archivedAt)}</span>
            <button type="button" className="sc-activity-open" disabled={locked} aria-label={`打开活动「${activity.name}」`} onClick={() => void switchActivity(activity.projectId)}>打开</button>
          </div>
        </li>)}
      </ul>
    </div>}
    {working && <p className="sc-activity-status" role="status">{working === 'prepare' ? '正在准备当前活动…' : working === 'archive' ? '正在归档并核对当前活动…' : working === 'read' ? '正在读取待打开活动…' : '正在打开并核实保存…'}</p>}
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && notice.scope === layout.id && <p className="sc-activity-status" role="status">{notice.text}</p>}
  </section>;
}
