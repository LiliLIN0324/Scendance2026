'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  loadReviewPlan,
  readLocalReviewLayout,
  REVIEW_PLAN_ERRORS,
  type LoadedReviewPlan,
} from './load-plan';
import { markReviewReturned, readReviewReturn } from './review-return';
import { ReviewSharePlanStage } from './review-share-plan-stage';
import {
  addReviewSharePin,
  readReviewSharePins,
  type ReviewSharePin,
} from './review-share-pins';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../room-organizer/lib/types';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plan: LoadedReviewPlan };

const PIN_ERRORS = {
  author: '先填写称呼，再钉上意见。',
  text: '写一句再钉上。',
  full: '这份方案的钉评已满，新的意见没有保存。',
  storage: '浏览器没有收下这条钉评。',
  plan: '这条钉评没有对应的方案，没有保存。',
} as const;

export function ReviewSharePage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [floorIndex, setFloorIndex] = useState(0);
  const [pins, setPins] = useState<ReviewSharePin[]>([]);
  const [author, setAuthor] = useState('');
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const [returnNote, setReturnNote] = useState('');

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
        setActivePinId(null);
        if (!result.ok) {
          setPhase({ kind: 'error', message: REVIEW_PLAN_ERRORS[result.reason] });
          setPins([]);
          return;
        }
        const stored = readReviewSharePins(result.plan.planKey, safeStorage());
        setPins(stored.pins);
        setAuthor(stored.lastAuthor);
        const receipt = readReviewReturn(safeStorage());
        const already = receipt?.planKey === result.plan.planKey;
        setReturned(already);
        setReturnNote(already ? '这份方案已记下完成。创作者在这台浏览器打开 Bingo 时会看到回执。' : '');
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
  const floorPins = useMemo(
    () => (floor ? pins.filter(pin => pin.floorId === floor.id) : []),
    [pins, floor],
  );
  const legend = floor ? itemLegend(floor.items) : { rows: [], hidden: 0 };

  const onAddPin = (input: { itemId: string | null; x: number; z: number; text: string }) => {
    if (!plan || !floor) return;
    const storage = safeStorage();
    if (!storage) return;
    const result = addReviewSharePin(storage, {
      planKey: plan.planKey,
      floorId: floor.id,
      itemId: input.itemId,
      x: input.x,
      z: input.z,
      author,
      text: input.text,
    });
    if (!result.ok) {
      window.alert(PIN_ERRORS[result.reason]);
      return;
    }
    setPins(result.pins);
    setAuthor(result.lastAuthor);
    setActivePinId(result.pin.id);
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
    setReturnNote('已记下完成。创作者在这台浏览器打开 Bingo 时会看到回执。');
  };

  return (
    <main className="rsp" data-review-share-page="true" data-review-side="client" data-review-source={plan?.source ?? phase.kind}>
      <header className="rsp-mast">
        <p className="rsp-brand"><span>幕景</span><small>Scendance</small></p>
        <p className="rsp-mast-status">甲方钉评 · 只读方案</p>
      </header>
      {phase.kind === 'loading' ? (
        <section className="rsp-state" role="status"><h1>正在打开方案</h1><p>正在读取平面。</p></section>
      ) : phase.kind === 'error' ? (
        <section className="rsp-state" role="alert"><h1>评审链接没有打开</h1><p>{phase.message}</p></section>
      ) : plan && floor ? (
        <div className="rsp-main">
          <section className="rsp-plan" aria-labelledby="rsp-plan-title">
            <p className="rsp-kicker">平面预览</p>
            <h1 id="rsp-plan-title">{plan.layout.name}</h1>
            <p className="rsp-meta">{metres(plan.layout.width)} × {metres(plan.layout.height)} 米 · {floor.name} · 平面上 {placedCount(floor.items)} 件</p>
            <p className="rsp-notice">{plan.notice}</p>
            {plan.layout.floors.length > 1 && (
              <div className="rsp-floors" role="group" aria-label="楼层">
                {plan.layout.floors.map((entry, index) => (
                  <button key={entry.id} type="button" aria-pressed={entry.id === floor.id} onClick={() => setFloorIndex(index)}>{entry.name}</button>
                ))}
              </div>
            )}
            <ReviewSharePlanStage
              layout={plan.layout}
              floor={floor}
              pins={floorPins}
              activeId={activePinId}
              author={author}
              onAuthor={setAuthor}
              onAddPin={onAddPin}
            />
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
            </div>
          </section>
          <section className="rsp-comments" aria-labelledby="rsp-pins-title">
            <div className="rsp-comments-scroll">
              <h2 id="rsp-pins-title">钉评列表</h2>
              <p className="rsp-persist">在左侧平面点位置落钉。列表只做汇总，不是唯一评论方式。</p>
              {floorPins.length === 0 ? (
                <p className="rsp-empty">还没有钉评。点平面或物件开始。</p>
              ) : (
                <ol className="rsp-thread">
                  {floorPins.map((pin, index) => (
                    <li key={pin.id}>
                      <button
                        type="button"
                        className={`rsp-pin-row${activePinId === pin.id ? ' is-on' : ''}`}
                        onClick={() => setActivePinId(pin.id)}
                      >
                        <strong>钉 {index + 1} · {pin.author}</strong>
                        <span>{pin.text}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="rsp-finish">
              <button type="button" onClick={onComplete}>{returned ? '已完成评审' : '完成评审'}</button>
              <p role="status">{returnNote || '点完成评审后，创作者在 Bingo 会看到回执。'}</p>
            </div>
          </section>
        </div>
      ) : (
        <section className="rsp-state" role="alert"><h1>方案没有可看的楼层</h1><p>这份快照里没有楼层，平面没有展开。</p></section>
      )}
    </main>
  );
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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
