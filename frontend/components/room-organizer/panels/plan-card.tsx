'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { LayoutPlanDraft } from '../../../lib/plan-annotation';
import { planZones } from '../../../lib/plan-approve';

type SkippedZone = { zoneId: string; reason: string };

/**
 * 第 7.5 批「规划草案」计划卡。
 *
 * 受控组件：不订阅 agent-chat 内部状态，全部回调由父组件注入。
 * 对应 Z4/Z5——阶段带空间关系理由，三按钮「批准 / 换一版 / 取消」，
 * 输入框允许口头改方案，页脚常驻「执行前我会先征求你的意见」。
 */
export interface PlanCardProps {
  draft: LayoutPlanDraft | null;
  onApprove(): void;
  onReplace(): void;
  onCancel(): void;
  onComment(text: string): void;
}

const cardStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#fff',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontFamily:
    '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
  color: '#374151',
  fontSize: 13,
  minWidth: 260,
};

const titleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: '#1f2937',
};

const stageStyle: CSSProperties = {
  borderLeft: '3px solid #4A7C59',
  padding: '4px 8px',
  background: '#f9fafb',
  borderRadius: 4,
};

const stageTitleStyle: CSSProperties = {
  fontWeight: 600,
  color: '#1f2937',
};

const rationaleStyle: CSSProperties = {
  color: '#6b7280',
  fontSize: 12,
  marginTop: 2,
};

const metaStyle: CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  marginTop: 2,
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 4,
};

const primaryButtonStyle: CSSProperties = {
  flex: 1,
  background: '#4A7C59',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  flex: 1,
  background: '#F4F5F7',
  color: '#374151',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

const cancelButtonStyle: CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: '#b45309',
  border: 'none',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

const inputStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  color: '#374151',
  outline: 'none',
};

const footerStyle: CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  textAlign: 'center',
  marginTop: 2,
};

export function PlanCard({ draft, onApprove, onReplace, onCancel, onComment }: PlanCardProps): JSX.Element | null {
  const [comment, setComment] = useState('');

  const stages = useMemo(
    () => (draft ? [...draft.stages].sort((a, b) => a.stageNo - b.stageNo) : []),
    [draft],
  );

  // 批准前先把「每个区会落什么」算出来摆给用户看，别让人盲批。
  const preview = useMemo(() => {
    if (!draft) return { byId: new Map<string, string>(), skipped: [] as SkippedZone[] };
    const outcome = planZones(draft.annotations, 0.5);
    const byId = new Map<string, string>();
    for (const zone of draft.annotations.filter((a) => a.kind === 'zone')) {
      const items = outcome.placements.filter((p) => p.zoneId === zone.id);
      if (items.length === 0) continue;
      const counts = new Map<string, number>();
      for (const p of items) counts.set(p.spec.name, (counts.get(p.spec.name) ?? 0) + 1);
      byId.set(zone.id, [...counts.entries()].map(([name, n]) => `${name}×${n}`).join('、'));
    }
    return { byId, skipped: outcome.skipped };
  }, [draft]);

  if (!draft) return null;

  const submitComment = (): void => {
    const text = comment.trim();
    if (!text) return;
    onComment(text);
    setComment('');
  };

  return (
    <section style={cardStyle} aria-label="规划草案">
      <header style={titleStyle}>规划草案</header>

      {stages.length === 0 && (
        <p style={rationaleStyle}>还没有阶段，正在画标注…</p>
      )}

      {stages.map((stage) => {
        const zoneAnnotations = (draft?.annotations ?? []).filter(
          (a) => a.kind === 'zone' && stage.annotationIds.includes(a.id),
        );
        return (
          <div key={stage.stageNo} style={stageStyle}>
            <div style={stageTitleStyle}>
              <span aria-hidden="true">{stage.stageNo}.</span> {stage.title}
            </div>
            <div style={rationaleStyle}>{stage.rationale}</div>
            {zoneAnnotations.map((a) => {
              const planned = preview.byId.get(a.id);
              const missed = preview.skipped.find((s) => s.zoneId === a.id);
              return (
                <div key={a.id} style={metaStyle}>
                  · {a.label}
                  {planned ? ` → ${planned}` : ''}
                  {missed ? `（${missed.reason}）` : ''}
                </div>
              );
            })}
          </div>
        );
      })}

      <div style={buttonRowStyle}>
        <button type="button" style={primaryButtonStyle} onClick={onApprove}>
          批准施工
        </button>
        <button type="button" style={secondaryButtonStyle} onClick={onReplace}>
          换一版
        </button>
        <button type="button" style={cancelButtonStyle} onClick={onCancel}>
          取消
        </button>
      </div>

      <input
        style={inputStyle}
        placeholder="或用文字回答，直接口头改方案…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitComment();
        }}
      />

      <footer style={footerStyle}>执行前我会先征求你的意见</footer>
    </section>
  );
}
