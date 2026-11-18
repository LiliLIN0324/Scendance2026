'use client';

/**
 * 语义三选一的候选条。点一款只通知父组件去出预览，这里不写方案。
 */
import { PLANNING_SURFACE, PLANNING_TYPOGRAPHY } from '@/lib/outdoor-plan-tokens';
import type { CSSProperties } from 'react';

export interface ArrangeChoiceListItem {
  slug: string;
  name: string;
  reason: string;
  count: number;
}

export interface ArrangeChoiceListProps {
  choices: readonly ArrangeChoiceListItem[];
  busy?: boolean;
  onPick(slug: string): void;
  onRefresh(): void;
  onCancel(): void;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const buttonStyle: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: `1px solid ${PLANNING_SURFACE.panelBorder}`,
  background: PLANNING_SURFACE.fieldBg,
  color: PLANNING_SURFACE.panelText,
  cursor: 'pointer',
  fontSize: PLANNING_TYPOGRAPHY.panel,
};

export function ArrangeChoiceList({ choices, busy = false, onPick, onRefresh, onCancel }: ArrangeChoiceListProps) {
  if (choices.length === 0) return null;
  return (
    <div role="group" aria-label="候选方案" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {choices.map(choice => (
        <div key={choice.slug} style={rowStyle}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(choice.slug)}
            style={{ ...buttonStyle, cursor: busy ? 'wait' : 'pointer' }}
          >
            {choice.name}
          </button>
          <span style={{ color: PLANNING_SURFACE.panelText, fontSize: PLANNING_TYPOGRAPHY.hint }}>
            {choice.reason} · {choice.count} 件
          </span>
        </div>
      ))}
      <div style={rowStyle}>
        <button type="button" disabled={busy} onClick={onRefresh} style={{ ...buttonStyle, cursor: busy ? 'wait' : 'pointer' }}>
          换一批
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '2px 6px',
            border: 'none',
            background: 'transparent',
            color: PLANNING_SURFACE.panelText,
            cursor: 'pointer',
            fontSize: PLANNING_TYPOGRAPHY.hint,
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
