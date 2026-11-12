'use client';

import { Copy, Lock, RotateCcw, Trash2, Unlock, X } from '@/components/solid-icons';
import { useEffect, useRef, useState } from 'react';
import { humanRecipeId } from '@/lib/recipe-display';
import { useRoomEditor, useSelection } from '../contexts';
import { layoutReducer } from '../hooks/layout-reducer';
import { catalogGroupLabel } from '../lib/catalog-taxonomy';
import { MAX_ITEM_DIMENSION, MIN_ITEM_FOOTPRINT, MIN_ITEM_HEIGHT } from '../lib/constants';
import { onlineModelThumb } from '../lib/online-models';
import { editorItemLimit } from '../lib/scene-presets';
import { ENTRANCE_DOOR_ID } from '../lib/street';
import { MaterialGlyph, NumberField } from './scendance-workspace';
import { routeIsLoop, routeLength } from '../lib/person-route';
import { requestComposerPrefill } from './composer-prefill-bus';
import type { FurnitureItem, PersonAction, WalkRoute } from '../lib/types';
import './item-context-popover.css';

export interface ItemContextPopoverProps {
  embedded?: boolean;
  hasCollision: boolean;
  onRemove(id: string): void;
  onDuplicate(id: string): void;
  onRotate(id: string): void;
  onToggleCameraBracket(id: string): void;
  onClose(): void;
  /** 画布路点绘制进行中（room-organizer 持有模式态与草稿）。 */
  routeDrawing?: boolean;
  /** 画布布点被拒时的提示文案；null = 无。 */
  routeDrawHint?: string | null;
  /** 开始/结束画布路点绘制。 */
  onToggleRouteDrawing?(): void;
  /** 撤掉最后一个路点（先撤草稿首点，再撤已提交路线的末点）。 */
  onUndoRoutePoint?(): void;
  /** 正在近景跟拍该人物（PEOPLE-04 后半）。 */
  following?: boolean;
  /** 开始/停止跟拍该人物；镜头推进在渲染循环里（three/person-follow）。 */
  onToggleFollow?(): void;
}

const COLORS = ['#375B4B', '#78958B', '#B5C3B2', '#C9B89D', '#DDD9CA', '#EDEAE1', '#B98067', '#404748'];
const DIMENSIONS = [
  { key: 'width', label: '宽 / 米', min: MIN_ITEM_FOOTPRINT },
  { key: 'depth', label: '深 / 米', min: MIN_ITEM_FOOTPRINT },
  { key: 'height', label: '高 / 米', min: MIN_ITEM_HEIGHT },
] as const;

/** Drafts stay with one item/field; only blur or Enter submits a dimension. */
function DimensionInput({ label, value, min, disabled, onCommit }: {
  label: string; value: number; min: number; disabled: boolean; onCommit(value: number): void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const submitted = useRef<string | null>(null);
  useEffect(() => { setDraft(String(value)); submitted.current = null; setError(''); }, [value]);
  function commit(): void {
    if (disabled || submitted.current === draft) return;
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > MAX_ITEM_DIMENSION) {
      setError(`请填写 ${min}～${MAX_ITEM_DIMENSION} 米之间的尺寸。`); return;
    }
    if (next === value) { setDraft(String(value)); setError(''); return; }
    try { onCommit(next); submitted.current = draft; setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '尺寸未能应用，请重新核对。'); }
  }
  return <label className="sc-field">{label}<input type="number" aria-label={label} min={min} max={MAX_ITEM_DIMENSION} step="any"
    value={draft} disabled={disabled} aria-invalid={!!error} onChange={event => { setDraft(event.target.value); submitted.current = null; setError(''); }}
    onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
    {error && <span className="sc-warning" role="alert">{error}</span>}</label>;
}

/**
 * Keep the public-library origin for both older CDN drafts and registered assets.
 */
export function catalogItemOrigin(item: Pick<FurnitureItem, 'source' | 'glbUrl' | 'assetId' | 'glbNode'>): string {
  if (item.glbNode) return '场景预设物件';
  if (item.source === 'public_library') return '云端模型资产';
  if (item.glbUrl) return item.assetId ? '云端模型资产' : '本地 GLB 验证样例';
  return '内置活动物料';
}

/**
 * The summary picture. An online model has a real render on the CDN; a vector glyph is
 * only a stand-in, and for a white-coloured model it was nearly invisible on the light
 * panel. Falls back to the glyph when there is no catalogue thumbnail or it fails.
 */
function SelectedPreview({ item }: { item: FurnitureItem }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const thumb = item.source === 'public_library' ? onlineModelThumb(item.glbUrl, item.assetId) : '';
  if (!thumb || failed) return <MaterialGlyph materialId={item.materialId} color={item.color}/>;
  // A catalogue thumbnail straight from the CDN; next/image cannot optimise a remote URL here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="sc-selected-thumb" src={thumb} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}/>;
}

/**
 * 第9批 UI：把 provenance 回显给策划师。opId 是技术标识符，不展示；
 * AI 件如果带 recipeId（hex hash），转成 5 位人话编号一起给。
 */
function provenanceLine(item: FurnitureItem): string | null {
  const p = item.provenance;
  if (!p) return null;
  if (p.source === 'ai') {
    return p.recipeId ? `AI 生成 · ${humanRecipeId(p.recipeId)}` : 'AI 生成';
  }
  if (p.source === 'human') return '手动放置';
  if (p.source === 'procedural') return '系统生成';
  return null;
}

const AI_SCOPE_NAME_LIMIT = 4;

/** 局部动作可点选的保守指令；label 给人看，draft 是预填进 composer 的句子。 */
const LOCAL_ACTION_CHIPS: Array<{ label: string; draft: string }> = [
  { label: '挪开重叠', draft: '把叠在一起的物料挪开' },
  { label: '换成同类物料', draft: '换成同类的其他物料' },
  { label: '评估这块布局', draft: '评估这块布局有没有更合适的摆法' },
];

/**
 * 把主选物件 + 圈选/Shift 加选解析成去重、截断的名称清单。
 * 拖拽中的 marquee 草稿框不会进 selection，只有释放后落进 allSelectedIds 的才算作用域。
 */
function describeSelectionScope(
  floorItems: readonly FurnitureItem[],
  primary: FurnitureItem,
  extraIds: ReadonlySet<string>,
): { count: number; names: string[] } {
  const byId = new Map(floorItems.map(entry => [entry.id, entry]));
  const ids: string[] = [primary.id];
  for (const id of extraIds) {
    if (id !== primary.id) ids.push(id);
  }
  const seen = new Set<string>();
  const names: string[] = [];
  for (const id of ids) {
    const name = (byId.get(id)?.name ?? (id === primary.id ? primary.name : '')).trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return { count: ids.length, names };
}

/** 作用域备注：单件 / 多选 / 无名兜底三种写法；名称最多列 4 件，超出补「等 N 件」。 */
function buildScopeNote(scope: { count: number; names: string[] }): string {
  if (scope.names.length === 0) return '针对当前选中的物料。';
  const shown = scope.names.slice(0, AI_SCOPE_NAME_LIMIT);
  const more = scope.count - shown.length;
  const list = shown.join('、');
  return `针对选中的 ${scope.count} 件物料：${more > 0 ? `${list} 等 ${scope.count} 件` : list}。`;
}

export function ItemContextPopover(props: ItemContextPopoverProps): JSX.Element {
  const { layout, actions, pushColor, activeFloor, activeFloorIndex, history } = useRoomEditor();
  const { selectedItem: item, extraSelectedIds, allSelectedIds } = useSelection();
  // 名称草稿：与尺寸草稿同一套「回车/失焦才提交」的习惯（#P0-3）
  const [nameDraft, setNameDraft] = useState(item?.name ?? '');
  // 局部 AI 动作的内联说明草稿；只经总线预填到既有 composer，不在弹层里发送。
  const [aiDraft, setAiDraft] = useState('');
  useEffect(() => {
    setNameDraft(item?.name ?? '');
    setAiDraft('');
  }, [item?.id, item?.name]);
  if (!item) return <></>;
  const commitName = (): void => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === item.name) {
      setNameDraft(item.name);
      return;
    }
    history.commitNow();
    actions.updateItem(item.id, { name: trimmed });
  };
  const locked = item.locked === true;
  const structuralSize = !!item.structuralOpeningId || !!item.structuralColumnId;
  const entranceSize = !!item.venueEntranceId || item.id === ENTRANCE_DOOR_ID;
  const protectedStructure = !!layout.backendSceneV2 && structuralSize;
  // 局部 AI 动作作用域：主选 + 已落定的圈选/加选；marquee 草稿框此刻还没进 selection。
  const scopeIds = allSelectedIds.size > 0 ? allSelectedIds : extraSelectedIds;
  const scope = describeSelectionScope(activeFloor.items, item, scopeIds);
  const scopeNote = buildScopeNote(scope);
  const scopeMissing = scope.names.length === 0;
  const aiEntryDisabled = locked || protectedStructure;
  const submitAiAction = (instruction: string): void => {
    if (aiEntryDisabled || scopeMissing) return;
    const trimmed = instruction.trim();
    if (!trimmed) return;
    // 只预填：作用域备注 + 指令，经总线进既有 composer；不自动发送，仍走原提案审批链。
    requestComposerPrefill(`${scopeNote}${trimmed}`);
    setAiDraft('');
  };
  const isPerson = item.type === 'person';
  const position = item.position ?? { x: 0, z: 0 };
  const rotation = ((item.rotation ?? 0) * 180 / Math.PI % 360 + 360) % 360;
  return <aside className={`sc-properties${props.embedded?' is-embedded':''}`} aria-label={`${item.name}属性`}>
    <header><div><h2>物料属性</h2></div><button type="button" className="sc-icon-button" onClick={props.onClose} aria-label="关闭物料属性"><X size={20}/></button></header>
    <div className="sc-properties-content">
      <div className="sc-selected-summary"><div><SelectedPreview item={item}/></div><input
          aria-label="物料名称"
          value={nameDraft}
          maxLength={40}
          disabled={locked}
          style={{
            display: 'block', width: '100%', padding: '4px 8px', textAlign: 'center',
            fontSize: 'var(--fs-p1)', fontWeight: 500, fontFamily: 'inherit', color: 'var(--sc-ink)',
            background: 'var(--paper)', border: '1px solid var(--sc-line)',
            borderRadius: 'var(--r-md)', opacity: locked ? 0.6 : 1,
          }}
          onChange={event => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitName();
              event.currentTarget.blur();
            }
          }}
        /><span>{catalogItemOrigin(item)}</span>{item.category && <span>分类 · {catalogGroupLabel(item.category)}</span>}</div>
      <button type="button" className={`sc-lock-button ${locked ? 'is-locked' : ''}`} aria-pressed={locked} onClick={() => actions.setLocked(item.id, !locked)}>{locked ? <Lock size={16}/> : <Unlock size={16}/>}<span>{locked ? '已锁定 · 点击解锁' : '允许编辑 · 点击锁定'}</span></button>
      {protectedStructure && <p className="sc-warning">门窗和柱子的尺寸、位置请在结构面板中核对修改。</p>}
      {props.hasCollision && <p className="sc-warning">物料可能重叠或超出场地，请检查位置。</p>}
      <section className="sc-ai-local" aria-label="局部 AI 动作">
        <h3>让 AI 按这块调整</h3>
        {scopeMissing ? <p className="sc-warning" role="alert">没有可识别的选中物件，先在画布上点选一件再试。</p> : <>
          <div className="sc-ai-local-row">
            <input
              aria-label="局部调整说明"
              className="sc-ai-local-input"
              placeholder="只调整选中的物件…"
              maxLength={120}
              value={aiDraft}
              disabled={aiEntryDisabled}
              onChange={event => setAiDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); submitAiAction(aiDraft); }
              }}
            />
            <button type="button" className="sc-button" disabled={aiEntryDisabled || !aiDraft.trim()} onClick={() => submitAiAction(aiDraft)}>预填</button>
          </div>
          <div className="sc-ai-chips" role="group" aria-label="局部动作">
            {LOCAL_ACTION_CHIPS.map(chip => <button
              key={chip.label}
              type="button"
              className="chip btn-outline sc-ai-chip"
              disabled={aiEntryDisabled}
              onClick={() => submitAiAction(chip.draft)}
            >{chip.label}</button>)}
          </div>
          <p className="sc-note">指令只预填到对话框，复核后再发送；改动仍走提案确认，不降低确认档位。</p>
        </>}
      </section>
      <section><h3>物料尺寸</h3><div className="sc-dimension-grid">
        {DIMENSIONS.map(dimension => <DimensionInput key={`${layout.id ?? 'local'}:${activeFloor.id}:${item.id}:${dimension.key}:${locked}`}
          label={dimension.label} value={item[dimension.key]} min={dimension.min} disabled={locked || structuralSize || entranceSize} onCommit={value => {
            const current = layout.floors[activeFloorIndex]?.items.find(value => value.id === item.id);
            if (!current) throw new Error('所选物料已变化，请重新填写尺寸。');
            const checked = layoutReducer({ layout, activeFloorIndex }, { type: 'resizeItem', id: item.id, dimension: dimension.key, value });
            if (checked.layout.floors[activeFloorIndex]?.items.find(value => value.id === item.id)?.[dimension.key] !== value) {
              throw new Error('这个尺寸无法应用，请先核对场地边界、墙体和柱子，并调整物料位置。');
            }
            history.commitNow(); actions.resizeItem(item.id, dimension.key, value);
          }}/>) }
      </div>
        {structuralSize ? <p className="sc-note">门窗宽、高和柱子尺寸请到“空间 → 结构”中调整。门窗深度随所在墙厚变化。</p>
          : entranceSize ? <p className="sc-note">该出入口目前只显示尺寸，请在“补充尺寸”中记录实测值并核对场地资料。</p>
          : <p className="sc-note">输入后按回车或离开字段应用。{item.glbUrl || item.assetId || item.glbNode ? '只调整当前物件尺寸，原模型保持不变。' : ''}</p>}
      </section>
      <section><h3>位置与角度</h3><div className="sc-dimension-grid">
        <NumberField label="X / m" value={position.x} min={-100} max={100} disabled={locked || protectedStructure} onChange={value => actions.moveItem(item.id, value, position.z)}/>
        <NumberField label="Y / m" value={position.z} min={-100} max={100} disabled={locked || protectedStructure} onChange={value => actions.moveItem(item.id, position.x, value)}/>
        <NumberField label="Z / m" value={item.elevation ?? 0} min={item.glbNode ? -100 : 0} max={item.glbNode ? 100 : 30} disabled={locked || !!item.venueEntranceId || !!item.structuralOpeningId || !!item.structuralColumnId} onChange={value => actions.updateItem(item.id, { elevation: value })}/>
      </div><div className="sc-property-actions">
        <NumberField label="旋转 / °" value={rotation} min={0} max={360} step={15} disabled={locked} onChange={value => actions.setRotation(item.id, value * Math.PI / 180)}/>
        <button type="button" className="sc-button" disabled={locked} onClick={() => props.onRotate(item.id)}><RotateCcw size={16}/>旋转 90°</button>
      </div></section>
      {isPerson && <PersonSections item={item} locked={locked} routeDrawing={props.routeDrawing} routeDrawHint={props.routeDrawHint}
        onToggleRouteDrawing={props.onToggleRouteDrawing} onUndoRoutePoint={props.onUndoRoutePoint}
        following={props.following} onToggleFollow={props.onToggleFollow} />}
      {item.glbUrl || item.assetId
        ? <p className="sc-note">{item.assetId?'该模型保留原材质。需要调整时，请到“资料 → 物料工具 → 材质调整”核对材质槽并预览新版本。':'该模型保留自身材质，暂不支持改色。'}</p>
        : <section><h3>物料颜色 <input type="color" aria-label="物料颜色" value={item.color} disabled={locked} onChange={event => { actions.setColor(item.id, event.target.value); pushColor(event.target.value); }}/></h3><div className="sc-color-swatches">{COLORS.map(color => <button type="button" key={color} style={{ background: color }} aria-label={`颜色 ${color}`} aria-pressed={item.color.toUpperCase() === color} disabled={locked} onClick={() => { actions.setColor(item.id, color); pushColor(color); }}/>)}</div></section>}
      <section><h3>物料备注</h3><textarea className="sc-notes" aria-label="物料备注" placeholder="例如：预留电源 / 实物待确认" maxLength={500} disabled={locked} value={item.notes ?? ''} onChange={event => actions.updateItem(item.id, { notes: event.target.value })}/></section>
      {provenanceLine(item) && <p className="sc-note" data-testid="item-provenance">{provenanceLine(item)}</p>}
      <div className="sc-property-actions"><button type="button" className="sc-button" disabled={protectedStructure || activeFloor.items.length >= editorItemLimit(layout)} onClick={() => props.onDuplicate(item.id)}><Copy size={16}/>复制</button></div>
      <button type="button" className="sc-delete-button" disabled={locked || protectedStructure} onClick={() => props.onRemove(item.id)}><Trash2 size={16}/>删除物料</button>
    </div>
  </aside>;
}

const PERSON_ACTIONS: Array<[PersonAction, string]> = [['idle', '待机'], ['talk', '交谈'], ['walk', '行走']];

/**
 * 人物动画与行走路线（PEOPLE-01/04）。路线数据存放在 item.walkRoute：
 * 点位来自画布布点（room-organizer 转发），本面板负责撤销、清除与巡游参数。
 */
function PersonSections({ item, locked, routeDrawing, routeDrawHint, onToggleRouteDrawing, onUndoRoutePoint, following, onToggleFollow }: {
  item: FurnitureItem;
  locked: boolean;
  routeDrawing?: boolean | undefined;
  routeDrawHint?: string | null | undefined;
  onToggleRouteDrawing?: (() => void) | undefined;
  onUndoRoutePoint?: (() => void) | undefined;
  following?: boolean | undefined;
  onToggleFollow?: (() => void) | undefined;
}): JSX.Element {
  const { actions, history } = useRoomEditor();
  const route = item.walkRoute;
  const commitRoute = (next: WalkRoute | undefined): void => {
    history.commitNow();
    // 「清除路线」传 undefined：exactOptionalPropertyTypes 下 patch 不收 undefined，此处断言。
    actions.updateItem(item.id, (next === undefined ? { walkRoute: undefined } : { walkRoute: next }) as Partial<FurnitureItem>);
  };
  const patchRoute = (patch: Partial<WalkRoute>): void => {
    if (!route) return;
    commitRoute({ ...route, ...patch });
  };
  const points = route?.points ?? [];
  const currentAction: PersonAction = item.personAction ?? 'idle';
  const paused = item.personPaused === true;
  return <>
    <section><h3>人物动画</h3>
      <div className="sc-property-actions" role="group" aria-label="人物动作">
        {PERSON_ACTIONS.map(([action, label]) => <button type="button" key={action} className="sc-button" aria-pressed={currentAction === action}
          disabled={locked || !!route}
          onClick={() => { history.commitNow(); actions.updateItem(item.id, { personAction: action }); }}>{label}</button>)}
      </div>
      <div className="sc-property-actions">
        <button type="button" className="sc-button" aria-pressed={paused} disabled={locked || !route && currentAction === 'idle'}
          onClick={() => { history.commitNow(); actions.updateItem(item.id, { personPaused: !paused }); }}>{paused ? '继续播放' : '暂停动作'}</button>
        {onToggleFollow && <button type="button" className="sc-button" aria-pressed={!!following} disabled={locked}
          onClick={onToggleFollow}>{following ? '退出跟拍' : '跟拍镜头'}</button>}
      </div>
      <p className="sc-note">{route
        ? '人物正沿路线行走：走动时播「行走」，在途经点停留时回「待机」。'
        : '选「交谈 / 行走」让人物在原地做动作；画路线后人物会沿路线巡游。'}</p>
    </section>
    <section><h3>行走路线</h3>
      {route || routeDrawing
        ? <>
          <p className="sc-note">{points.length > 0
            ? `已画 ${points.length} 个途经点 · 全程约 ${routeLength(points, routeIsLoop(route ?? { points })).toFixed(1)} m`
            : '在画布上点击，放下第一个途经点。'}</p>
          <div className="sc-property-actions">
            {onToggleRouteDrawing && <button type="button" className="sc-button" aria-pressed={!!routeDrawing} disabled={locked}
              onClick={onToggleRouteDrawing}>{routeDrawing ? '完成绘制' : (route ? '改画路线' : '开始画路线')}</button>}
            {onUndoRoutePoint && <button type="button" className="sc-button" disabled={locked || points.length === 0 && !routeDrawing} onClick={onUndoRoutePoint}>撤销上一点</button>}
            {route && <button type="button" className="sc-button" disabled={locked} onClick={() => commitRoute(undefined)}>清除路线</button>}
          </div>
          {routeDrawing && <p className="sc-note" role="status">{routeDrawHint ?? '点击画布添加途经点（至少 2 个），Esc 或「完成绘制」结束。'}</p>}
          {route && <>
            <div className="sc-property-actions" role="group" aria-label="巡游方式">
              <button type="button" className="sc-button" aria-pressed={routeIsLoop(route)} disabled={locked}
                onClick={() => patchRoute({ loop: true })}>环形巡游</button>
              <button type="button" className="sc-button" aria-pressed={route.loop === false} disabled={locked}
                onClick={() => patchRoute({ loop: false })}>折返巡游</button>
            </div>
            <div className="sc-dimension-grid">
              <NumberField label="步速 / m·s" value={route.speed ?? 1.05} min={0.3} max={2.5} step={0.05} disabled={locked}
                onChange={value => patchRoute({ speed: Math.min(2.5, Math.max(0.3, value)) })}/>
              <NumberField label="停留 / s" value={(route.pauseMs ?? 900) / 1000} min={0} max={30} step={0.5} disabled={locked}
                onChange={value => patchRoute({ pauseMs: Math.round(Math.min(30, Math.max(0, value)) * 1000) })}/>
            </div>
          </>}
        </>
        : <p className="sc-note">给这位人物画一条巡游路线：至少 2 个途经点，人物沿米制路线行走、转向并在途经点停留。</p>}
    </section>
  </>;
}
