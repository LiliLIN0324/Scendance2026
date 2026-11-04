'use client';

/**
 * 左轨三态卡。
 * T3 封堵（2026-11-04）：评审钉问题卡（ReviewIssuesCard）与三态外壳
 * （WorkbenchModeCard/LayoutVenueCard）随 reviewSlot 死门一并删除——门已封死，
 * 评审只走分享链接。本文件只保留「到场清单」分享抽屉（DeliveryChecklistShell）。
 */
import { materialRows } from './plan-flow';
import './mode-shell.css';

/** 有到场物料算齐，一场空的算缺。真点验下一刀再接。 */
export function dossierStatus(itemCount: number): '齐' | '缺' {
  return itemCount > 0 ? '齐' : '缺';
}

export function DeliveryChecklistShell({ items, onExport, reviewCleared = false }: {
  items: readonly { name: string }[];
  onExport(): void;
  reviewCleared?: boolean;
}): JSX.Element {
  const rows = materialRows(items);
  const status = dossierStatus(rows.length);
  return <section className="sc-mode-card" role="region" aria-label="执行清单">
    <header>
      <strong>到场清单</strong>
      <span role="status">资料状态 · {status}</span>
      <button type="button" onClick={onExport}>导出</button>
    </header>
    {reviewCleared && <p className="sc-issue-note">评审已确认，可以导出。</p>}
    <ul>
      {rows.length === 0
        ? <li><span>还没有到场物料</span><b data-status="缺">缺</b></li>
        : rows.map(row => <li key={row.name}><span>{row.name}</span><span>{row.count} 件</span><b data-status="齐">齐</b></li>)}
    </ul>
  </section>;
}
