'use client';

import { FolderOpen, Plus, RefreshCw } from '@/components/solid-icons';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ensureActivityCover, saveActivityCover } from '@/lib/activity-cover';
import { archiveLocalActivity, createLocalActivityBackup, listLocalActivities, readLocalActivity, LOCAL_ACTIVITIES_NAMESPACE,
  type LocalActivityList, type NewLocalActivityMode } from '@/lib/local-activities';
import { parseLocalProjectBackupJson } from '@/lib/local-project-backup';
import { localRestoreAvailable } from '@/lib/local-project-restore';
import { subscribeSourceNamespace } from '@/lib/source-storage';
import { captureStageCover } from '@/lib/stage-cover';
import { MAX_NAME_LENGTH } from '../lib/schema';
import { dossierStatus } from './mode-shell';
import { InfoTip } from './info-tip';
import { PlanThumb } from './plan-thumb';
import type { LocalProjectBackupActions } from './creative-studio';
import type { RoomLayout } from '../lib/types';
import {useLocalActivitySwitchGuard} from '../lib/local-activity-switch-guard';
import './local-activities-panel.css';

export interface LocalActivitiesPanelProps {
  layout: RoomLayout;
  actions: LocalProjectBackupActions;
  disabled?: boolean;
  /** 'create' is the rail's new-activity popover; 'list' is the account's project list. */
  mode?: 'all' | 'create' | 'list';
  /** Save state printed on the current-activity card, replacing the block that used to sit above the list. */
  currentStatus?: string;
  /** Archive cards the caller wants to show; the account panel hides other teams' activities. Omitted = show every archive. */
  isActivityVisible?: (projectId: string) => boolean;
  onComplete?: (() => void) | undefined;
}
type Working = 'prepare' | 'archive' | 'read' | 'restore';
interface Token { id: number; epoch: number; scope: string; permissionEpoch: number; assertSwitchCurrent():void }

/** 画廊卡只放相对时间：今天/昨天/N 天前；超过 29 天退回短日期，坏值原样返回。 */
function relativeStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 30) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function LocalActivitiesPanel({ layout, actions, disabled = false, mode = 'all', currentStatus = '', isActivityVisible = () => true, onComplete }: LocalActivitiesPanelProps): JSX.Element {
  const switchGuard=useLocalActivitySwitchGuard();
  const showCreate = mode !== 'list', showList = mode !== 'create';
  const [name, setName] = useState(''), [activityMode, setActivityMode] = useState<NewLocalActivityMode>('empty');
  // 画廊末尾的「＋新建活动」拼贴卡：就地展开极简命名，不走 create 表单/wizard。
  const [tileOpen, setTileOpen] = useState(false), [tileName, setTileName] = useState('');
  const [activities, setActivities] = useState<LocalActivityList>({ activities: [], unreadableProjectIds: [] });
  const [listLoading, setListLoading] = useState(false), [listError, setListError] = useState('');
  const [working, setWorking] = useState<Working | null>(null), [error, setError] = useState('');
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const [still, setStill] = useState<{ scope: string; dataUrl: string } | null>(null);
  const mounted = useRef(true), listRequest = useRef(0), pending = useRef(false), sectionRef = useRef<HTMLElement>(null);
  const operation = useRef({ id: 0, stage: null as Working | null, scope: '', target: '', kind: '' as '' | 'create' | 'open' });
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
    if (!showList || !scope || !localRestoreAvailable()) return undefined;
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
    operation.current = { id: operation.current.id + 1, stage: null, scope: '', target: '', kind: '' };
    pending.current = false; setWorking(null);
    setError(interrupted && sameScope ? '当前场景已变化，操作已停止。请重新核对后再试，输入已保留。' : '');
    setNotice(current => current?.scope === baseline.current.scope ? current : null);
  }, [epoch]);

  const identityMissing = !layout.id?.trim();
  const busy = !!working || actions.backupPending;
  const paused = !localRestoreAvailable();
  const createLocked = disabled || identityMissing || busy;
  const openLocked = createLocked || paused;
  function begin(kind: 'create' | 'open'): Token | null {
    if (disabled || identityMissing || actions.backupPending || pending.current) return null;
    if (kind === 'open' && !localRestoreAvailable()) return null;
    let assertSwitchCurrent:()=>void;
    try {if(!switchGuard)throw new Error('当前页面无法核对未保存草稿，未切换活动。');assertSwitchCurrent=switchGuard.capture();}
    catch(error){setError(error instanceof Error?error.message:'未保存草稿无法核对，未切换活动。');return null;}
    const token = { id: operation.current.id + 1, epoch: baseline.current.epoch, scope: baseline.current.scope,
      permissionEpoch: baseline.current.permissionEpoch,assertSwitchCurrent };
    operation.current = { id: token.id, stage: 'prepare', scope: token.scope, target: '', kind };
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
    token.assertSwitchCurrent();
  }
  function stage(token: Token, value: Working): void {
    assertCurrent(token); operation.current.stage = value; setWorking(value);
  }
  async function switchActivity(targetId?: string, override?: { name?: string; mode?: NewLocalActivityMode }): Promise<void> {
    // 画廊拼贴卡走 override 传名，避免 setName 同帧闭包取旧值；老 create 表单仍读组件 state。
    const nextName = override?.name ?? name;
    const nextMode = override?.mode ?? activityMode;
    if (!targetId && !nextName.trim()) { if (!createLocked) setError('请填写新活动名称。'); return; }
    const token = begin(targetId ? 'open' : 'create'); if (!token) return;
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
      if (targetId) await actions.restoreBackup(candidate, token.assertSwitchCurrent);
      else {
        if (!actions.createFreshActivity) throw new Error('此工作台尚未开放新建活动。');
        await actions.createFreshActivity(candidate, token.assertSwitchCurrent);
      }
      // Provider restore may itself replace the baseline; only its intended activity may receive completion.
      if (active(token) && !baseline.current.disabled && baseline.current.permissionEpoch === token.permissionEpoch &&
          (baseline.current.epoch === token.epoch || baseline.current.scope === targetScope)) {
        setNotice({ scope: targetScope, text: `已打开「${candidate.layout.name}」。` });
        setError('');
        if (!targetId) { setName(''); setTileName(''); setTileOpen(false); }
        onComplete?.();
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
  const archives = activities.activities.filter(activity => activity.projectId !== layout.id && isActivityVisible(activity.projectId));
  // A live still always beats the cover stored when this activity was archived earlier.
  const currentStill = still && still.scope === (layout.id ?? '') ? still.dataUrl : null;
  const currentThumb = currentStill ?? activities.activities.find(activity => activity.projectId === layout.id)?.cover;
  const currentItems = layout.floors.reduce((count, floor) => count + floor.items.length, 0);
  const currentName = layout.name || '未命名活动';

  return <section ref={sectionRef} className="sc-local-activities" aria-label="最近活动">
    {paused && <p className="sc-handoff-error" role="status">打开已有活动或从备份文件恢复暂不可用。新建会先保存当前活动并进入新活动；已保存的活动在恢复保障完成前不能从列表再打开。你仍可导出本机备份。</p>}
    {identityMissing && <p className="sc-handoff-error" role="alert">请先保存有明确编号的当前活动，再新建或打开其他活动。</p>}
    {showCreate && <div className="sc-activity-group">
      <header className="sc-activity-head">
        <div className="sc-settings-title"><h3>新建活动</h3><InfoTip label="新建说明"><strong>切换前自动归档</strong><span>新建前，当前活动会自动存档。新活动不带入原需求、任务、制作计划、方案历史或点验账册。打开已有活动仍等待恢复保障。</span></InfoTip></div>
      </header>
      <form className="sc-activity-form" aria-label="新建活动" onSubmit={create}>
        <fieldset disabled={createLocked}>
          <label className="sc-field"><span>新活动名称</span><input value={name} maxLength={MAX_NAME_LENGTH} placeholder="输入活动名称" onChange={event => { if (!createLocked && !pending.current) setName(event.currentTarget.value); }}/></label>
          <div className="sc-local-activities-modes">
            <label><input type="radio" name="new-local-activity-mode" value="empty" checked={activityMode === 'empty'} onChange={() => { if (!createLocked && !pending.current) setActivityMode('empty'); }}/>空场地（10×8米示例）</label>
            <label><input type="radio" name="new-local-activity-mode" value="reuse-layout" checked={activityMode === 'reuse-layout'} onChange={() => { if (!createLocked && !pending.current) setActivityMode('reuse-layout'); }}/>沿用当前布置</label>
          </div>
          <button type="submit" className="sc-cloud-primary sc-activity-create">新建活动</button>
        </fieldset>
      </form>
    </div>}
    {showList && <div className="sc-activity-group">
      <header className="sc-activity-head">
        <div className="sc-settings-title"><h3>最近活动</h3><span className="sc-settings-count is-chip">{archives.length + 1} 个</span></div>
        <button type="button" className="sc-activity-refresh" aria-label="刷新活动列表" title="刷新活动列表" disabled={disabled || busy || listLoading} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true"/></button>
      </header>
      {listLoading && <p className="sc-activity-status" role="status">正在读取活动列表…</p>}
      {listError && <p className="sc-handoff-error" role="alert">{listError}</p>}
      {activities.unreadableProjectIds.length > 0 && <p className="sc-handoff-error" role="alert">有{activities.unreadableProjectIds.length}份活动无法读取，资料已保留。请先核对备份。</p>}
      <ul className="sc-local-activities-list">
        <li className="is-current" aria-label={`当前活动「${currentName}」`}>
          <div className="sc-activity-thumb">
            {currentThumb
              ? <img className="sc-activity-thumb-image" src={currentThumb} alt="" loading="lazy"/>
              : <PlanThumb layout={layout} width={320} height={190} className="sc-activity-thumb-canvas" style={{ width: '100%', height: 'auto' }}/>}
            <span className="sc-activity-current">当前</span>
          </div>
          <div className="sc-activity-card-body">
            <strong title={currentName}>{currentName}</strong>
            <span className="sc-activity-meta"><em className={dossierStatus(currentItems) === '齐' ? 'is-ready' : 'is-low'}>{dossierStatus(currentItems)}</em>{currentItems} 件{currentStatus ? ` · ${currentStatus}` : ''}</span>
          </div>
        </li>
        {archives.map(activity => <li key={activity.projectId}>
          {/* 整卡就是一颗原生 button：键盘 Enter/Space 与禁用态走浏览器原生行为，li 保留 listitem 语义。 */}
          <button type="button" className="sc-activity-card-clickable" disabled={openLocked} aria-label={`打开活动「${activity.name}」`}
            onClick={() => void switchActivity(activity.projectId)}>
            <div className="sc-activity-thumb">
              {activity.cover
                ? <img className="sc-activity-thumb-image" src={activity.cover} alt="" loading="lazy"/>
                : activity.preview
                  ? <PlanThumb layout={activity.preview} width={320} height={190} className="sc-activity-thumb-canvas" style={{ width: '100%', height: 'auto' }}/>
                  : <span className="sc-activity-thumb-empty" aria-hidden="true"><FolderOpen size={20}/></span>}
            </div>
            <div className="sc-activity-card-body">
              <strong title={activity.name}>{activity.name}</strong>
              <span className="sc-activity-meta"><em className={dossierStatus(activity.itemCount) === '齐' ? 'is-ready' : 'is-low'}>{dossierStatus(activity.itemCount)}</em>{activity.itemCount} 件 · {relativeStamp(activity.archivedAt)}</span>
            </div>
          </button>
        </li>)}
        <li className="sc-activity-tile">
          {tileOpen ? (
            <form className="sc-activity-tile-form" aria-label="画廊内联新建活动" onSubmit={event => { event.preventDefault(); void switchActivity(undefined, { name: tileName, mode: 'empty' }); }}>
              <input value={tileName} maxLength={MAX_NAME_LENGTH} aria-label="画廊新活动名称" placeholder="给新活动起个名" autoFocus
                onChange={event => { if (!createLocked) setTileName(event.currentTarget.value); }}/>
              <div className="sc-activity-tile-actions">
                <button type="submit" className="sc-cloud-primary" disabled={createLocked}>创建并打开</button>
                <button type="button" disabled={createLocked} onClick={() => { setTileOpen(false); setTileName(''); }}>取消</button>
              </div>
            </form>
          ) : (
            <button type="button" className="sc-activity-tile-add" disabled={createLocked} aria-label="新建活动，空白画布直接进入工作台" onClick={() => setTileOpen(true)}>
              <Plus size={18} aria-hidden="true"/><span>新建活动</span>
            </button>
          )}
        </li>
      </ul>
      {!listLoading && !archives.length && !listError && <p className="sc-activity-status">还没有其他归档；点「新建活动」开一张空白画布，当前画布会自动存档。</p>}
    </div>}
    {working && <p className="sc-activity-status" role="status">{working === 'prepare' ? '正在准备当前活动…' : working === 'archive' ? '正在归档并核对当前活动…' : working === 'read' ? '正在读取待打开活动…' : operation.current.kind === 'create' ? '正在保存新活动…' : '正在打开并核实保存…'}</p>}
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && notice.scope === layout.id && <p className="sc-activity-status" role="status">{notice.text}</p>}
  </section>;
}
