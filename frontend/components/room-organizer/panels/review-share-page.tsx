'use client';

/**
 * 对方打开的方案壳：只读平面，在平面上落钉。没有晴光，没有模式轨，没有布置工具。
 * 钉和 `/review/` 用同一套 PlanPin，按 share id 分开存。
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { hitPlanItem } from '../lib/plan-pin-geometry';
import { appendPlanPin, readPlanPins, type PlanPin } from '../lib/review-pin-store';
import { pinSubject } from '../lib/review-pins';
import {
  readReviewShare,
  type ReviewPlanItem,
  type ReviewShareSnapshot,
} from '../lib/review-share';
import { PlanPinComposer } from './plan-pin-composer';

const SHEET_W = 640;
const SHEET_H = 400;
const SHEET_PAD = 28;

export function ReviewSharePage({ shareId }: { shareId: string }): JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [snapshot, setSnapshot] = useState<ReviewShareSnapshot | null>(null);
  const [pins, setPins] = useState<PlanPin[]>([]);
  const [draft, setDraft] = useState<{ x: number; z: number; itemId: string | null } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const found = readReviewShare(shareId);
    setSnapshot(found);
    setPins(found ? readPlanPins(`share:${found.id}`, safeStorage()) : []);
    setPhase(found ? 'ready' : 'missing');
    setDraft(null);
    setActiveId(null);
    setNotice('');
  }, [shareId]);

  const frame = snapshot ? sheetFrame(snapshot) : null;

  const onSheetClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!snapshot || !frame) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, form, input')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const svgX = ((event.clientX - rect.left) / rect.width) * SHEET_W;
    const svgY = ((event.clientY - rect.top) / rect.height) * SHEET_H;
    const x = (svgX - frame.ox) / frame.scale;
    const z = (svgY - frame.oy) / frame.scale;
    const inside = Math.abs(x) <= snapshot.width / 2 && Math.abs(z) <= snapshot.depth / 2;
    const hit = hitPlanItem(snapshot.items.map(asHit), x, z);
    if (!inside && !hit) {
      setNotice('点在场地里面，再钉一条意见。');
      return;
    }
    setDraft({ x, z, itemId: hit?.id ?? null });
    setActiveId(null);
    setNotice('');
  };

  const onCommit = (text: string) => {
    if (!snapshot || !draft) return;
    const storage = safeStorage();
    if (!storage) {
      setNotice('浏览器没有收下这条钉。');
      return;
    }
    const result = appendPlanPin(storage, {
      planKey: `share:${snapshot.id}`,
      id: crypto.randomUUID(),
      text,
      x: draft.x,
      y: 0,
      z: draft.z,
      itemId: draft.itemId,
      floorId: 'plan',
    });
    if (!result.ok) {
      setNotice(result.reason === 'text' ? '写一句意见再钉上。' : '这条钉没有写下。');
      return;
    }
    setPins(result.pins);
    setActiveId(result.pin.id);
    setDraft(null);
    setNotice('钉已留在这台浏览器的平面上。');
  };

  return <main className="sc-share-page sc-review-share" data-storage="local-demo">
    <header className="sc-share-masthead">
      <span>幕景 <small>Scendance</small></span>
      <span>点平面落钉</span>
    </header>
    {phase === 'loading' ? <section className="sc-share-state" role="status"><h1>正在打开方案</h1><p>正在读取这台浏览器里的评审链接。</p></section> : phase === 'missing' || !snapshot || !frame ? <section className="sc-share-state" role="alert">
      <h1>打不开这份方案</h1>
      <p>评审链接存在创建它的那台浏览器里。换设备、无痕窗口或清除站点数据后，这里没有方案可看。这是本机演示，不是云端发布。</p>
    </section> : <>
      <div className="sc-share-title">
        <div>
          <p>本机演示 · 点平面落钉</p>
          <h1>{snapshot.title}</h1>
          <p>{snapshot.width} × {snapshot.depth} 米 · {snapshot.items.length} 件物料</p>
        </div>
      </div>
      <p className="sc-share-notice" role="note">点场地或物件落下钉。不能改布置。钉只存在这台浏览器，不会同步到云端。</p>
      <figure className="sc-review-plan">
        <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} role="img" aria-label={`${snapshot.title} 的只读平面`} onClick={onSheetClick}>
          <rect x={frame.px(-snapshot.width / 2)} y={frame.py(-snapshot.depth / 2)} width={snapshot.width * frame.scale} height={snapshot.depth * frame.scale} className="sc-review-floor"/>
          {snapshot.items.map(item => item.x === null || item.z === null ? null : <ItemMark key={item.id} item={item} scale={frame.scale} cx={frame.px(item.x)} cy={frame.py(item.z)}/>)}
        </svg>
        {pins.map((pin, index) => (
          <button
            key={pin.id}
            type="button"
            className={`rsp-pin sc-share-pin${activeId === pin.id ? ' is-on' : ''}`}
            style={{ left: `${(frame.px(pin.x) / SHEET_W) * 100}%`, top: `${(frame.py(pin.z) / SHEET_H) * 100}%` }}
            aria-label={`议题 ${index + 1}`}
            onClick={() => { setActiveId(pin.id); setDraft(null); }}
          >{index + 1}</button>
        ))}
        {draft && (
          <div className="rsp-pin-anchor sc-share-pin-anchor" style={{ left: `${(frame.px(draft.x) / SHEET_W) * 100}%`, top: `${(frame.py(draft.z) / SHEET_H) * 100}%` }}>
            <PlanPinComposer
              key={`${draft.x}:${draft.z}`}
              label={draft.itemId ? `钉在「${pinSubject(draft.itemId, snapshot.items)}」` : '钉在地面'}
              onCommit={onCommit}
              onCancel={() => setDraft(null)}
            />
          </div>
        )}
      </figure>
      <section className="sc-share-materials" aria-labelledby="sc-review-materials-title">
        <div className="sc-share-heading"><h2 id="sc-review-materials-title">物料</h2><span>共 {snapshot.items.length} 件</span></div>
        {snapshot.items.length === 0 ? <p>这份方案还没有物料。</p> : <div className="sc-share-table-scroll"><table>
          <thead><tr><th scope="col">物料</th><th scope="col">尺寸（宽 × 深 × 高 / 米）</th><th scope="col">位置</th></tr></thead>
          <tbody>
            {snapshot.items.map(item => <tr key={item.id}>
              <td><span className="sc-share-color" style={{ backgroundColor: item.color }}/>{item.name}</td>
              <td>{formatMeters(item.width)} × {formatMeters(item.depth)} × {formatMeters(item.height)}</td>
              <td>{item.x === null || item.z === null ? '未落位' : `${formatMeters(item.x)} , ${formatMeters(item.z)}`}</td>
            </tr>)}
          </tbody>
        </table></div>}
      </section>
      <section className="sc-review-comments" aria-labelledby="sc-review-comments-title">
        <div className="sc-share-heading"><h2 id="sc-review-comments-title">钉</h2><span>{pins.length} 条</span></div>
        {pins.length === 0 ? <p>还没有钉。在平面上点一个位置，写下意见。</p> : <ol className="rsp-pin-list">
          {pins.map((pin, index) => <li key={pin.id}>
            <button type="button" className={activeId === pin.id ? 'is-on' : ''} aria-pressed={activeId === pin.id} onClick={() => setActiveId(pin.id)}>
              <b aria-hidden="true">{index + 1}</b>
              <span><strong>{pin.text}</strong><small>{pinSubject(pin.itemId, snapshot.items)}</small></span>
            </button>
          </li>)}
        </ol>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </>}
  </main>;
}

function sheetFrame(snapshot: ReviewShareSnapshot): { scale: number; ox: number; oy: number; px(x: number): number; py(z: number): number } {
  const scale = Math.min((SHEET_W - SHEET_PAD * 2) / snapshot.width, (SHEET_H - SHEET_PAD * 2) / snapshot.depth);
  const ox = SHEET_W / 2;
  const oy = SHEET_H / 2;
  return { scale, ox, oy, px: (x) => ox + x * scale, py: (z) => oy + z * scale };
}

function asHit(item: ReviewPlanItem): { id: string; name: string; width: number; depth: number; position?: { x: number; z: number }; rotation?: number } {
  return {
    id: item.id,
    name: item.name,
    width: item.width,
    depth: item.depth,
    ...(item.x === null || item.z === null ? {} : { position: { x: item.x, z: item.z } }),
    rotation: item.rotation,
  };
}

function ItemMark({ item, scale, cx, cy }: { item: ReviewPlanItem; scale: number; cx: number; cy: number }): JSX.Element {
  const w = Math.max(item.width * scale, 2);
  const d = Math.max(item.depth * scale, 2);
  const degrees = -(item.rotation * 180) / Math.PI;
  return <g transform={`translate(${cx} ${cy}) rotate(${degrees})`}>
    <title>{item.name}</title>
    <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={item.color} stroke="#243028" strokeWidth="1"/>
  </g>;
}

function formatMeters(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
