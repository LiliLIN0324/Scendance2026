'use client';

/**
 * 左轨三态只换左栏这张卡。主区 3D 和右轨不换皮。
 * 评审 / 执行的完整批注流和真交付物下一刀；这里先把卡片内容分开。
 */
import { useState } from 'react';
import { useRoomEditor } from '../contexts';
import { useAgent } from './agent-panel';
import { materialRows } from './plan-flow';
import './mode-shell.css';

export type ReviewMark = 'pending' | 'passed' | 'rejected';

export function reviewStatusLabel(mark: ReviewMark | undefined): '待确认' | '通过' | '驳回' {
  if (mark === 'passed') return '通过';
  if (mark === 'rejected') return '驳回';
  return '待确认';
}

/** 有到场物料算齐，一场空的算缺。真点验下一刀再接。 */
export function dossierStatus(itemCount: number): '齐' | '缺' {
  return itemCount > 0 ? '齐' : '缺';
}

export function ReviewAnnotationShell({ items, onFocus }: {
  items: readonly { id: string; name: string }[];
  onFocus(id: string): void;
}): JSX.Element {
  const [marks, setMarks] = useState<Record<string, ReviewMark>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focus = (id: string) => {
    setFocusedId(id);
    onFocus(id);
  };
  const mark = (id: string, next: ReviewMark) => {
    setMarks(current => ({ ...current, [id]: next }));
    focus(id);
  };
  return <section className="sc-mode-card" role="region" aria-label="评审批注">
    <header>
      <strong>待确认</strong>
      <span>点一项，对照这场</span>
    </header>
    {items.length === 0
      ? <div className="sc-mode-shell-empty">
          <p>这一版还没有待确认的物料</p>
          <div className="sc-mode-shell-acts">
            <button type="button" disabled>通过</button>
            <button type="button" disabled>驳回</button>
          </div>
        </div>
      : <ul>
          {items.map(item => {
            const status = reviewStatusLabel(marks[item.id]);
            const on = focusedId === item.id;
            return <li key={item.id} className={on ? 'is-on' : ''}>
              <button type="button" className="sc-mode-shell-item" aria-pressed={on} onClick={() => focus(item.id)}>
                <span>{item.name}</span>
                <b>{status}</b>
              </button>
              <div className="sc-mode-shell-acts">
                <button type="button" aria-pressed={status === '通过'} onClick={() => mark(item.id, 'passed')}>通过</button>
                <button type="button" aria-pressed={status === '驳回'} onClick={() => mark(item.id, 'rejected')}>驳回</button>
              </div>
            </li>;
          })}
        </ul>}
  </section>;
}

export function DeliveryChecklistShell({ items, onExport }: {
  items: readonly { name: string }[];
  onExport(): void;
}): JSX.Element {
  const rows = materialRows(items);
  const status = dossierStatus(rows.length);
  return <section className="sc-mode-card" role="region" aria-label="执行清单">
    <header>
      <strong>到场清单</strong>
      <span role="status">资料状态 · {status}</span>
      <button type="button" onClick={onExport}>导出</button>
    </header>
    <ul>
      {rows.length === 0
        ? <li><span>还没有到场物料</span><b data-status="缺">缺</b></li>
        : rows.map(row => <li key={row.name}><span>{row.name}</span><span>{row.count} 件</span><b data-status="齐">齐</b></li>)}
    </ul>
  </section>;
}

/** 布置左卡：活动、人数、米数。不放「从哪来」。 */
export function LayoutVenueCard({ event, guests, dims }: {
  event: string | null;
  guests: string | null;
  dims: string;
}): JSX.Element {
  return <section className="sc-mode-card" role="region" aria-label="布置">
    <header>
      <strong>场地</strong>
      <span>活动 · 人数 · 米数</span>
    </header>
    <dl>
      <div><dt>活动</dt><dd>{event || '还没说'}</dd></div>
      <div><dt>人数</dt><dd>{guests || '还没说'}</dd></div>
      <div><dt>米数</dt><dd>{dims}</dd></div>
    </dl>
  </section>;
}

/** 挂在左栏：同一张卡位，三态只换里面的字。 */
export function WorkbenchModeCard({ onFocusItem, onExport }: {
  onFocusItem(id: string): void;
  onExport(): void;
}): JSX.Element {
  const agent = useAgent();
  const { activeFloor } = useRoomEditor();
  if (agent.callbacks.workbenchMode === 'review') return <ReviewAnnotationShell items={activeFloor.items} onFocus={onFocusItem} />;
  if (agent.callbacks.workbenchMode === 'delivery') return <DeliveryChecklistShell items={activeFloor.items} onExport={() => { agent.previewExport(); onExport(); }} />;
  return <LayoutVenueCard event={agent.recap.event} guests={agent.recap.guests} dims={agent.recap.dims} />;
}
