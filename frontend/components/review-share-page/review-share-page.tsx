'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { randomId } from '../room-organizer/lib/ids';
import {
  pinSubject,
  type ReviewPin,
  type ReviewPinDraft,
} from '../room-organizer/lib/review-pins';
import { floorElevation } from '../room-organizer/lib/storeys';
import {
  loadReviewPlan,
  readLocalReviewLayout,
  REVIEW_PLAN_ERRORS,
  type LoadedReviewPlan,
} from './load-plan';
import { itemNames, ReviewPlanSheet } from './review-plan-sheet';
import { markReviewReturned, readReviewReturn } from './review-return';
import {
  appendReviewSharePin,
  readReviewSharePins,
  REVIEW_SHARE_PIN_STORAGE_KEY,
} from './share-pins';
import type { FurnitureItem } from '../room-organizer/lib/types';

const PIN_ERRORS = {
  text: '请写一句意见，最多 80 个字。',
  full: '这份方案的演示钉已有 80 条，新的钉没有保存。',
  storage: '浏览器没有收下这条钉。',
  plan: '这条钉没有对应的方案，没有保存。',
  draft: '落钉位置无效，请再点一次平面。',
} as const;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plan: LoadedReviewPlan };

export function ReviewSharePage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [floorIndex, setFloorIndex] = useState(0);
  const [pins, setPins] = useState<ReviewPin[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState<ReviewPinDraft | null>(null);
  const [pinError, setPinError] = useState('');
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
        setPinDraft(null);
        setActivePinId(null);
        setPinError('');
        if (!result.ok) {
          setPhase({ kind: 'error', message: REVIEW_PLAN_ERRORS[result.reason] });
          setPins([]);
          return;
        }
        setPins(readReviewSharePins(result.plan.planKey, safeStorage()));
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
  const legend = floor ? itemLegend(floor.items) : { rows: [], hidden: 0 };
  const pinNumbers = useMemo(() => new Map(pins.map((pin, index) => [pin.id, index + 1])), [pins]);

  const openPinDraft = useCallback((pick: { itemId: string | null; x: number; z: number }) => {
    if (!plan || !floor) return;
    const floorY = floorElevation(plan.layout.floors, floorIndex);
    const item = pick.itemId ? floor.items.find((entry) => entry.id === pick.itemId) : null;
    const origin = item?.position ? { x: item.position.x, y: floorY, z: item.position.z } : null;
    const offset = origin ? [pick.x - origin.x, floorY - origin.y, pick.z - origin.z] as const : null;
    const camera = {
      position: [pick.x + 2.4, floorY + 2.8, pick.z + 2.4] as const,
      target: [pick.x, floorY, pick.z] as const,
    };
    setPinError('');
    setPinDraft({ itemId: pick.itemId, x: pick.x, y: floorY, z: pick.z, offset, camera });
  }, [plan, floor, floorIndex]);

  const commitPin = useCallback((text: string) => {
    if (!plan || !pinDraft) return;
    const storage = safeStorage();
    if (!storage) {
      setPinError(PIN_ERRORS.storage);
      return;
    }
    const result = appendReviewSharePin(storage, {
      planKey: plan.planKey,
      text,
      draft: pinDraft,
      id: randomId('pin'),
    });
    if (!result.ok) {
      setPinError(PIN_ERRORS[result.reason] ?? PIN_ERRORS.text);
      return;
    }
    setPins(result.pins);
    setActivePinId(result.pin.id);
    setPinDraft(null);
    setPinError('');
  }, [plan, pinDraft]);

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
        <p className="rsp-mast-status">可评论方案 · 只读 · 画内落钉</p>
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
            {!pinDraft && pins.length === 0 && (
              <p className="rsp-review-hint" role="status">点物件或地面，钉一条意见</p>
            )}
            {plan.layout.floors.length > 1 && (
              <div className="rsp-floors" role="group" aria-label="楼层">
                {plan.layout.floors.map((entry, index) => (
                  <button key={entry.id} type="button" aria-pressed={entry.id === floor.id} onClick={() => { setFloorIndex(index); setPinDraft(null); }}>{entry.name}</button>
                ))}
              </div>
            )}
            <div className="rsp-sheet rsp-sheet-interactive">
              <ReviewPlanSheet
                layout={plan.layout}
                floor={floor}
                floorIndex={floorIndex}
                pins={pins}
                activePinId={activePinId}
                pinDraft={pinDraft}
                onAnchor={openPinDraft}
                onFocusPin={setActivePinId}
                onCommitPin={commitPin}
                onCancelPin={() => setPinDraft(null)}
              />
            </div>
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
              <h2 id="rsp-comments-title">钉汇总</h2>
              <p className="rsp-persist">钉留在这台浏览器，刷新还在，不会同步到其他设备。与工作台评审钉同一套短文案。</p>
              {pins.length === 0 ? (
                <p className="rsp-empty">还没有钉。在左侧平面上点选位置即可落钉。</p>
              ) : (
                <ol className="rsp-pin-list">
                  {pins.map((pin) => {
                    const on = activePinId === pin.id;
                    return (
                      <li key={pin.id} className={on ? 'is-on' : ''}>
                        <button
                          type="button"
                          className="rsp-pin-go"
                          aria-pressed={on}
                          onClick={() => setActivePinId(pin.id)}
                        >
                          <b aria-hidden="true">{pinNumbers.get(pin.id)}</b>
                          <span>
                            <strong>{pin.text}</strong>
                            <small>{pinSubject(pin.itemId, itemNames(floor.items))}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {pinError && <p className="rsp-form-error" role="alert">{pinError}</p>}
              <details className="rsp-entry">
                <summary>分享链接怎么进这一页</summary>
                <p>评审链接是 <code>/review/#layout=…</code>。井号后的片段与编辑器里的方案哈希相同，路径用 /review/。对方打开后就是这一页：平面和画内钉。</p>
                <p>钉写在 localStorage，键名 <code>{REVIEW_SHARE_PIN_STORAGE_KEY}</code>。这是演示存储，不进 Supabase。</p>
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
