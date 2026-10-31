'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { layoutToSvg } from '../room-organizer/lib/plan-export/svg';
import {
  hitPlanItem,
  pointInRoom,
  sheetFractionToWorld,
  worldToSheetFraction,
} from '../room-organizer/lib/plan-pin-geometry';
import {
  appendPlanPin,
  PLAN_PIN_STORAGE_KEY,
  readPlanPins,
  type PlanPin,
  type PlanPinFailure,
} from '../room-organizer/lib/review-pin-store';
import { pinSubject, placeComposer } from '../room-organizer/lib/review-pins';
import { PlanPinComposer } from '../room-organizer/panels/plan-pin-composer';
import {
  loadReviewPlan,
  readLocalReviewLayout,
  REVIEW_PLAN_ERRORS,
  type LoadedReviewPlan,
} from './load-plan';
import { markReviewReturned, readReviewReturn } from './review-return';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../room-organizer/lib/types';

const PIN_ERRORS: Record<PlanPinFailure, string> = {
  text: '写一句意见再钉上。',
  point: '这个位置钉不上。点在场地里面再试。',
  full: '这份方案的钉已经有 80 条，新的意见没有保存。',
  storage: '浏览器没有收下这条钉。',
  plan: '这条钉没有对应的方案，没有保存。',
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plan: LoadedReviewPlan };

type PinDraft = { x: number; z: number; itemId: string | null };

export function ReviewSharePage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [floorIndex, setFloorIndex] = useState(0);
  const [pins, setPins] = useState<PlanPin[]>([]);
  const [draft, setDraft] = useState<PinDraft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [returned, setReturned] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let ticket = 0;
    const load = () => {
      const current = ++ticket;
      setPhase({ kind: 'loading' });
      const localLayout = readLocalReviewLayout(safeStorage());
      void loadReviewPlan({
        hash: window.location.hash,
        search: window.location.search,
        localLayout,
      }).then((result) => {
        if (!active || current !== ticket) return;
        setFloorIndex(0);
        setDraft(null);
        setActiveId(null);
        setFormError('');
        if (!result.ok) {
          setPhase({ kind: 'error', message: REVIEW_PLAN_ERRORS[result.reason] });
          setPins([]);
          return;
        }
        setPins(readStored(result.plan.planKey));
        const receipt = readReviewReturn(safeStorage());
        const already = receipt?.planKey === result.plan.planKey;
        setReturned(already);
        setReturnNote(already ? '这份方案已记下完成。创作者在这台浏览器收起球时，球会带上红环。' : '');
        setPhase({ kind: 'ready', plan: result.plan });
      });
    };
    load();
    window.addEventListener('hashchange', load);
    return () => {
      active = false;
      ticket += 1;
      window.removeEventListener('hashchange', load);
    };
  }, []);

  const plan = phase.kind === 'ready' ? phase.plan : null;
  const floor = plan ? plan.layout.floors[floorIndex] ?? plan.layout.floors[0] : undefined;
  const svg = useMemo(() => (plan && floor ? safeSvg(plan.layout, floor) : null), [plan, floor]);
  const legend = floor ? itemLegend(floor.items) : { rows: [], hidden: 0 };
  const floorPins = floor ? pins.filter((pin) => pin.floorId === floor.id) : [];

  const onSheetClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!plan || !floor) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, form, input')) return;
    const host = stageRef.current ?? event.currentTarget;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const world = sheetFractionToWorld(plan.layout, floor, {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
    if (!world) return;
    const hit = hitPlanItem(floor.items, world.x, world.z);
    if (!hit && !pointInRoom(plan.layout, world)) {
      setFormError('点在场地里面，再钉一条意见。');
      return;
    }
    setDraft({ x: world.x, z: world.z, itemId: hit?.id ?? null });
    setActiveId(null);
    setFormError('');
  };

  const onCommit = (text: string) => {
    if (!plan || !floor || !draft) return;
    const storage = safeStorage();
    if (!storage) {
      setFormError(PIN_ERRORS.storage);
      return;
    }
    const result = appendPlanPin(storage, {
      planKey: plan.planKey,
      id: crypto.randomUUID(),
      text,
      x: draft.x,
      y: 0,
      z: draft.z,
      itemId: draft.itemId,
      floorId: floor.id,
    });
    if (!result.ok) {
      setFormError(PIN_ERRORS[result.reason]);
      return;
    }
    setPins(result.pins);
    setActiveId(result.pin.id);
    setDraft(null);
    setFormError('');
  };

  const onFocus = (id: string) => {
    setActiveId(id);
    setDraft(null);
    document.getElementById(`rsp-pin-${id}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const onComplete = () => {
    if (!plan) return;
    const storage = safeStorage();
    if (!storage) {
      setReturnNote('这台浏览器没有记下完成。');
      return;
    }
    const result = markReviewReturned(storage, { planKey: plan.planKey });
    if (!result.ok) {
      setReturnNote('这台浏览器没有记下完成。');
      return;
    }
    setReturned(true);
    setReturnNote('已记下完成。创作者在这台浏览器打开工作台并收起球时，球会带上红环。');
  };

  return (
    <main className="rsp" data-review-share-page="true" data-review-source={plan?.source ?? phase.kind}>
      <header className="rsp-mast">
        <p className="rsp-brand"><span>幕景</span><small>Scendance</small></p>
        <p className="rsp-mast-status">点平面落钉</p>
      </header>
      {phase.kind === 'loading' ? (
        <section className="rsp-state" role="status"><h1>正在打开方案</h1><p>正在读取平面。</p></section>
      ) : phase.kind === 'error' ? (
        <section className="rsp-state" role="alert"><h1>评审链接没有打开</h1><p>{phase.message}</p></section>
      ) : plan && floor ? (
        <div className="rsp-main">
          <section className="rsp-plan" aria-labelledby="rsp-plan-title">
            <p className="rsp-kicker">平面</p>
            <h1 id="rsp-plan-title">{plan.layout.name}</h1>
            <p className="rsp-meta">{metres(plan.layout.width)} × {metres(plan.layout.height)} 米 · {floor.name} · 平面上 {placedCount(floor.items)} 件</p>
            <p className="rsp-notice">{plan.notice}</p>
            {plan.layout.floors.length > 1 && (
              <div className="rsp-floors" role="group" aria-label="楼层">
                {plan.layout.floors.map((entry, index) => (
                  <button key={entry.id} type="button" aria-pressed={entry.id === floor.id} onClick={() => { setFloorIndex(index); setDraft(null); }}>{entry.name}</button>
                ))}
              </div>
            )}
            <div className="rsp-sheet">
              {svg ? (
                <div ref={stageRef} className="rsp-pin-stage" role="group" aria-label="活动平面" onClick={onSheetClick}>
                  <PlanSheet src={svgSrc(svg)} alt={`${plan.layout.name}，${floor.name}平面`} />
                  {floorPins.map((pin, index) => {
                    const fraction = worldToSheetFraction(plan.layout, floor, pin);
                    if (!fraction) return null;
                    return (
                      <button
                        key={pin.id}
                        id={`rsp-pin-${pin.id}`}
                        type="button"
                        className={`rsp-pin${activeId === pin.id ? ' is-on' : ''}`}
                        style={{ left: `${fraction.x * 100}%`, top: `${fraction.y * 100}%` }}
                        aria-label={`议题 ${index + 1}`}
                        onClick={() => onFocus(pin.id)}
                      >{index + 1}</button>
                    );
                  })}
                  {draft && <PinnedComposer layout={plan.layout} floor={floor} draft={draft} items={floor.items} onCommit={onCommit} onCancel={() => setDraft(null)} />}
                </div>
              ) : (
                <p className="rsp-sheet-fallback" role="status">这层平面暂时画不出来。下面仍列出场内物件。</p>
              )}
            </div>
            <p className="rsp-pin-hint">点场地或物件落下钉，写一句意见。钉会留在平面上。</p>
            {formError && <p className="rsp-form-error" role="alert">{formError}</p>}
            <div className="rsp-legend">
              <h2>场内物件</h2>
              {legend.rows.length === 0 ? <p>这一层平面上还没有物件。</p> : (
                <ul>
                  {legend.rows.map((row) => (
                    <li key={`${row.name}-${row.color}`}>
                      <span className="rsp-swatch" style={{ backgroundColor: swatch(row.color) }} aria-hidden="true" />
                      <span>{row.count > 1 ? `${row.name} × ${row.count}` : row.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {legend.hidden > 0 && <p className="rsp-zones">还有 {legend.hidden} 种物件，都画在平面上。</p>}
              {(floor.zones ?? []).length > 0 && (
                <p className="rsp-zones">分区：{(floor.zones ?? []).map((zone) => zone.name).join('、')}</p>
              )}
            </div>
          </section>
          <section className="rsp-comments" aria-labelledby="rsp-comments-title">
            <div className="rsp-comments-scroll">
              <h2 id="rsp-comments-title">钉</h2>
              <p className="rsp-persist">钉留在这台浏览器，刷新还在，不会同步到其他设备。工作台 Bingo 读的是同一套。</p>
              {floorPins.length === 0 ? <p className="rsp-empty">还没有钉。在平面上点一个位置，写下意见。</p> : (
                <ol className="rsp-pin-list">
                  {floorPins.map((pin, index) => (
                    <li key={pin.id}>
                      <button type="button" className={activeId === pin.id ? 'is-on' : ''} aria-pressed={activeId === pin.id} onClick={() => onFocus(pin.id)}>
                        <b aria-hidden="true">{index + 1}</b>
                        <span>
                          <strong>{pin.text}</strong>
                          <small>{pinSubject(pin.itemId, floor.items)}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <details className="rsp-entry">
                <summary>分享链接怎么进这一页</summary>
                <p>评审链接是 <code>/review/#layout=…</code>。井号后的片段与编辑器里的方案哈希相同，路径用 /review/。对方打开后在平面上落钉。</p>
                <p>钉写在 localStorage，键名 <code>{PLAN_PIN_STORAGE_KEY}</code>。这是演示存储，不进 Supabase。</p>
              </details>
            </div>
            <div className="rsp-finish">
              <button type="button" onClick={onComplete}>{returned ? '已完成评审' : '完成评审'}</button>
              <p role="status">{returnNote || '点完成评审后，创作者这边的球会变红。这一笔只留在这台浏览器。'}</p>
            </div>
          </section>
        </div>
      ) : (
        <section className="rsp-state" role="alert"><h1>方案没有可看的楼层</h1><p>这份快照里没有楼层，平面没有展开。</p></section>
      )}
    </main>
  );
}

function PinnedComposer({
  layout,
  floor,
  draft,
  items,
  onCommit,
  onCancel,
}: {
  layout: RoomLayout;
  floor: FloorLayout;
  draft: PinDraft;
  items: readonly { id: string; name: string }[];
  onCommit(text: string): void;
  onCancel(): void;
}): JSX.Element | null {
  const fraction = worldToSheetFraction(layout, floor, draft);
  if (!fraction) return null;
  const host = typeof document !== 'undefined' ? document.querySelector('.rsp-pin-stage') : null;
  const width = host?.clientWidth || 640;
  const height = host?.clientHeight || 480;
  const placed = placeComposer(
    { x: fraction.x * width, y: fraction.y * height },
    { width, height },
  );
  const label = draft.itemId ? `钉在「${pinSubject(draft.itemId, items)}」` : '钉在地面';
  return (
    <div className="rsp-pin-anchor" style={{ left: placed.left, top: placed.top }}>
      <PlanPinComposer key={`${draft.x}:${draft.z}:${draft.itemId ?? ''}`} label={label} onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

function PlanSheet({ src, alt }: { src: string; alt: string }): JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  );
}

function readStored(planKey: string): PlanPin[] {
  try {
    return readPlanPins(planKey, safeStorage());
  } catch {
    return [];
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeSvg(layout: RoomLayout, floor: FloorLayout): string | null {
  try {
    return layoutToSvg(layout, floor);
  } catch {
    return null;
  }
}

function svgSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function placedCount(items: readonly FurnitureItem[]): number {
  return items.filter((item) => item.position).length;
}

function itemLegend(items: readonly FurnitureItem[]): { rows: { name: string; color: string; count: number }[]; hidden: number } {
  const rows = new Map<string, { name: string; color: string; count: number }>();
  for (const item of items) {
    if (!item.position) continue;
    const name = item.name.trim() || '未命名物件';
    const color = item.color;
    const key = `${name}\0${color}`;
    const current = rows.get(key);
    if (current) current.count += 1;
    else rows.set(key, { name, color, count: 1 });
  }
  const all = [...rows.values()];
  return { rows: all.slice(0, 24), hidden: Math.max(0, all.length - 24) };
}

function swatch(color: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#c8c8c2';
}

function metres(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
