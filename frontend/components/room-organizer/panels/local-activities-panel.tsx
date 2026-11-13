'use client';

import { ChevronDown, ChevronUp, FolderOpen, Plus, RefreshCw } from '@/components/solid-icons';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ensureActivityCover, saveActivityCover } from '@/lib/activity-cover';
import { archiveLocalActivity, createLocalActivityBackup, deleteLocalActivity, listLocalActivities, readLocalActivity, LOCAL_ACTIVITIES_NAMESPACE,
  type LocalActivityList, type NewLocalActivityMode } from '@/lib/local-activities';
import { parseLocalProjectBackupJson } from '@/lib/local-project-backup';
import { localActivitySwitchAvailable, localRestoreAvailable } from '@/lib/local-project-restore';
import { subscribeSourceNamespace } from '@/lib/source-storage';
import { captureStageCover } from '@/lib/stage-cover';
import { MAX_NAME_LENGTH } from '../lib/schema';
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
  /** 「灵动岛」折叠：默认只留一颗小胶囊，点开才铺开卡片墙。轨道画廊用，账户面板不用。 */
  compact?: boolean;
  /** 点击胶囊左侧「图标 + 活动名」时把新名字交给上层写回布局（不传则左侧不可改名）。 */
  onRenameCurrent?: (name: string) => void;
  onComplete?: (() => void) | undefined;
}
type Working = 'prepare' | 'archive' | 'read' | 'restore';
interface Token { id: number; epoch: number; scope: string; permissionEpoch: number; assertSwitchCurrent():void }

/* 画廊卡只画封面 + 名称（2026-11-13 用户两次要求：「缺/齐 X 件 · 时间」这行不要显示）。 */

export function LocalActivitiesPanel({ layout, actions, disabled = false, mode = 'all', currentStatus = '', isActivityVisible = () => true, compact = false, onRenameCurrent, onComplete }: LocalActivitiesPanelProps): JSX.Element {
  const switchGuard=useLocalActivitySwitchGuard();
  const showCreate = mode !== 'list', showList = mode !== 'create';
  const [name, setName] = useState(''), [activityMode, setActivityMode] = useState<NewLocalActivityMode>('empty');
  const [activities, setActivities] = useState<LocalActivityList>({ activities: [], unreadableProjectIds: [] });
  const [listLoading, setListLoading] = useState(false), [listError, setListError] = useState('');
  const [working, setWorking] = useState<Working | null>(null), [error, setError] = useState('');
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const [still, setStill] = useState<{ scope: string; dataUrl: string } | null>(null);
  // 灵动岛：收起时只留一颗胶囊，点开才铺开卡片墙；切换成功后自动收回。
  const [islandOpen, setIslandOpen] = useState(false);
  // 胶囊左区改名：点开变成输入框，回车保存、Esc 取消，空名/同名不改。
  const [renaming, setRenaming] = useState(false), [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) renameInputRef.current?.focus({ preventScroll: true });
  }, [renaming]);
  const commitRename = (): void => {
    const next = renameDraft.trim();
    setRenaming(false);
    if (!next || next === currentName || !onRenameCurrent) return;
    onRenameCurrent(next);
  };
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
  const paused = !localActivitySwitchAvailable();
  const createLocked = disabled || identityMissing || busy;
  const openLocked = createLocked || paused;
  function begin(kind: 'create' | 'open'): Token | null {
    if (disabled || identityMissing || actions.backupPending || pending.current) return null;
    if (kind === 'open' && !localActivitySwitchAvailable()) return null;
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
      if (targetId) await actions.restoreBackup(candidate, token.assertSwitchCurrent, 'activity-switch');
      else {
        if (!actions.createFreshActivity) throw new Error('此工作台尚未开放新建活动。');
        await actions.createFreshActivity(candidate, token.assertSwitchCurrent);
      }
      // Provider restore may itself replace the baseline; only its intended activity may receive completion.
      if (active(token) && !baseline.current.disabled && baseline.current.permissionEpoch === token.permissionEpoch &&
          (baseline.current.epoch === token.epoch || baseline.current.scope === targetScope)) {
        setNotice({ scope: targetScope, text: `已打开「${candidate.layout.name}」。` });
        setError('');
        if (!targetId) setName('');
        setIslandOpen(false);
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
  const currentName = layout.name || '未命名活动';
  // 「新建活动」自动命名：名字不是重点，先给一个一眼能认出时间、又不会重名的名字。
  const nextActivityName = (): string => {
    const now = new Date();
    const two = (value: number): string => String(value).padStart(2, '0');
    const base = `新活动 ${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
    const taken = new Set([currentName, ...archives.map(activity => activity.name)]);
    let candidate = base;
    for (let index = 2; taken.has(candidate); index += 1) candidate = `${base} (${index})`;
    return candidate;
  };

  const galleryHeader = <header className="sc-activity-head">
    <div className="sc-settings-title"><h3>最近活动</h3><span className="sc-settings-count is-chip">{archives.length + 1} 个</span></div>
    <button type="button" className="sc-activity-refresh" aria-label="刷新活动列表" title="刷新活动列表" disabled={disabled || busy || listLoading} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true"/></button>
  </header>;
  // 读取/异常状态留在折叠区外：收起成胶囊时也必须看得见「读不到」「读失败」。
  const galleryStatus = <>
    {listLoading && <p className="sc-activity-status" role="status">正在读取活动列表…</p>}
    {listError && <p className="sc-handoff-error" role="alert">{listError}</p>}
    {activities.unreadableProjectIds.length > 0 && <p className="sc-handoff-error" role="alert">有{activities.unreadableProjectIds.length}份活动无法读取，资料已保留。请先核对备份。</p>}
  </>;
  const galleryList = <ul className="sc-local-activities-list">
    {/* 2026-11-13 用户指令：多个活动按「左滑翻卡片」排——最左是新建入口，第二张是当前活动，
        再往右是最近的活动（水平滚动，不再换行堆叠）。 */}
    <li className="sc-activity-tile">
      {/* 新建不必先起名（「名字不重要，AI 会快速起名」）：点一下按时间自动命名并进空白画布，
          命名/切换/归档全走原来那条 switchActivity 通道。 */}
      <button type="button" className="sc-activity-tile-add" disabled={createLocked} aria-label="新建活动，自动命名并直接进入空白画布"
        onClick={() => void switchActivity(undefined, { name: nextActivityName(), mode: 'empty' })}>
        <span className="sc-activity-tile-mark" aria-hidden="true"><Plus size={15}/></span>
        <span>新建活动</span>
      </button>
    </li>
    <li className="is-current" aria-label={`当前活动「${currentName}」`}>
      <div className="sc-activity-thumb">
        {currentThumb
          ? <img className="sc-activity-thumb-image" src={currentThumb} alt="" loading="lazy"/>
          : <PlanThumb layout={layout} width={320} height={190} className="sc-activity-thumb-canvas" style={{ width: '100%', height: 'auto' }}/>}
        <span className="sc-activity-current">当前</span>
      </div>
      <div className="sc-activity-card-body">
        <strong title={currentName}>{currentName}</strong>
        {/* 2026-11-13 用户指令：当前卡不再报「缺/齐 X 件」——正在编辑的就是这一张，件数画布上就看得见。
            只保留「有改动待保存」这类真需要提醒的状态。 */}
        {currentStatus && <span className="sc-activity-meta">{currentStatus}</span>}
      </div>
    </li>
    {archives.map(activity => <li key={activity.projectId}>
      {/* 整卡就是一颗原生 button：键盘 Enter/Space 与禁用态走浏览器原生行为，li 保留 listitem 语义。 */}
      <button type="button" className="sc-activity-card-clickable" disabled={openLocked} aria-label={`打开活动「${activity.name}」`}
        onClick={() => void switchActivity(activity.projectId)}
        onContextMenu={event => {
          // 2026-11-14 用户指令：归档卡右键删除（带确认）。只对归档卡生效——当前活动卡不在此列；
          // 删除走「归档记录+封面一并清除」，确认文案说清不可恢复。
          event.preventDefault();
          if (openLocked || pending.current) return;
          if (!window.confirm(`删除本机归档的「${activity.name}」？归档与封面会一并清除，删除后无法恢复；当前活动不受影响。`)) return;
          setListError('');
          deleteLocalActivity(activity.projectId)
            .then(() => { if (mounted.current) void refresh(); })
            .catch(caught => { if (mounted.current) setListError(caught instanceof Error ? caught.message : '归档删除失败，请重试。原归档已保留。'); });
        }}>
        <div className="sc-activity-thumb">
          {activity.cover
            ? <img className="sc-activity-thumb-image" src={activity.cover} alt="" loading="lazy"/>
            : activity.preview
              ? <PlanThumb layout={activity.preview} width={320} height={190} className="sc-activity-thumb-canvas" style={{ width: '100%', height: 'auto' }}/>
              : <span className="sc-activity-thumb-empty" aria-hidden="true"><FolderOpen size={20}/></span>}
        </div>
        <div className="sc-activity-card-body">
          <strong title={activity.name}>{activity.name}</strong>
        </div>
      </button>
    </li>)}
  </ul>;

  return <section ref={sectionRef} className="sc-local-activities" aria-label="最近活动">
    {/* 2026-11-13 用户指令：「已有活动暂不可打开 ⓘ」整条删掉——恢复保障没就绪时归档卡自己就是禁用态，不再在上面叠一行提示。 */}
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
    {showList && <div className={`sc-activity-group${compact ? ' is-island' : ''}${compact && islandOpen ? ' is-open' : ''}`}>
      {compact ? <>
        {/* 2026-11-13 用户指令：胶囊分左右两个区——点左边（图标+活动名）重命名，点右边（N 个 + 箭头）展开/收起。 */}
        <div className={`sc-activity-island-bar${renaming ? ' is-renaming' : ''}`}>
          {renaming ? (
            <input ref={renameInputRef} className="sc-activity-island-rename" value={renameDraft} maxLength={MAX_NAME_LENGTH}
              aria-label="重命名当前活动" onChange={event => setRenameDraft(event.currentTarget.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); commitRename(); }
                if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); }
              }}
              onBlur={commitRename}/>
          ) : (
            <button type="button" className="sc-activity-island-main" aria-label={`重命名当前活动「${currentName}」`} title="点击重命名"
              onClick={() => { if (!onRenameCurrent) return; setRenameDraft(currentName); setRenaming(true); }}>
              <span className="sc-activity-island-mark" aria-hidden="true">
                {currentThumb ? <img src={currentThumb} alt="" loading="lazy"/> : <FolderOpen size={13}/>}
              </span>
              <span className="sc-activity-island-name">{currentName}</span>
            </button>
          )}
          <button type="button" className="sc-activity-island-toggle" aria-expanded={islandOpen} aria-controls="sc-activity-island-body"
            aria-label={`最近活动，当前「${currentName}」，共 ${archives.length + 1} 个，${islandOpen ? '已展开' : '点按展开'}`}
            title={`最近活动 · ${currentName}`} onClick={() => setIslandOpen(value => !value)}>
            <span className="sc-settings-count is-chip">{archives.length + 1} 个</span>
            {islandOpen ? <ChevronUp size={15} aria-hidden="true"/> : <ChevronDown size={15} aria-hidden="true"/>}
          </button>
        </div>
        <div id="sc-activity-island-body" className="sc-activity-island-body">
          {/* 2026-11-13 用户指令：岛展开后直接铺卡片——不再重复一行「最近活动 + N 个 + 刷新」（上面那颗胶囊已经在说同一件事）。 */}
          <div className="sc-activity-island-clip">{galleryList}</div>
        </div>
        {galleryStatus}
      </> : <>{galleryHeader}{galleryStatus}{galleryList}</>}
    </div>}
    {working && <p className="sc-activity-status" role="status">{working === 'prepare' ? '正在准备当前活动…' : working === 'archive' ? '正在归档并核对当前活动…' : working === 'read' ? '正在读取待打开活动…' : operation.current.kind === 'create' ? '正在保存新活动…' : '正在打开并核实保存…'}</p>}
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && notice.scope === layout.id && <p className="sc-activity-status" role="status">{notice.text}</p>}
  </section>;
}
