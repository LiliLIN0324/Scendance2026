'use client';

import type { MaterialCapabilityInspection } from '@/lib/material-capabilities';

export function MaterialCapabilityNote({ report, choices, onChoice, accepted, onAccept }: {
  report: MaterialCapabilityInspection;
  choices: Readonly<Record<string, string>>;
  onChoice(key: string, value: string): void;
  accepted: boolean;
  onAccept(value: boolean): void;
}): JSX.Element | null {
  if (!report.requiresConfirmation && !report.supported.length && !report.unrecognized.length) return null;
  const findings = [...report.missing, ...report.needsConfirmation];
  return <section className="cr-capability" aria-label="物料能力提示">
    <h3>先核对一下物料</h3>
    {findings.map(finding => <div key={finding.key} className="cr-capability-finding">
      <strong>{finding.label} · {finding.availability === 'unavailable' ? '内置目录暂未提供' : '规格需核对'}</strong>
      <p>{finding.message}</p>
      {finding.suggestions.length > 0 && <label className="cr-label">{finding.label}的处理方式
        <select aria-label={`${finding.label}的处理方式`} value={choices[finding.key] ?? ''} onChange={event => onChoice(finding.key, event.target.value)}>
          <option value="">保留缺项，不替代</option>
          {finding.suggestions.map(suggestion => <option key={suggestion.materialId} value={suggestion.materialId}>同意改用{suggestion.name}（现有规格）</option>)}
        </select>
        {finding.suggestions.map(suggestion => <small key={suggestion.materialId}>{suggestion.reason}</small>)}
      </label>}
    </div>)}
    {findings.length > 0 && <label className="cr-check"><input type="checkbox" checked={accepted} onChange={event => onAccept(event.target.checked)}/><span>已核对以上选择，先生成可支持部分；保留缺项，不擅自替代。</span></label>}
    {report.supported.length > 0 && <p>目录中有：{report.supported.map(item => item.label).join('、')}。具体数量与规格仍需核对。</p>}
    {report.unrecognized.length > 0 && <p>其他需求还需逐项核对，不能据此认为全部物料已具备。</p>}
    <small>{report.notice}</small>
  </section>;
}
