'use client';

import { useState } from 'react';
import { MAX_DESIGNS, removeDesignVariant, saveDesignSnapshot, switchDesign } from '../lib/scene-layers';
import type { DesignVariant, RoomLayout } from '../lib/types';
import './design-history-panel.css';

export interface DesignHistoryPanelProps {
  layout: RoomLayout;
  onApply: (next: RoomLayout) => void;
  disabled?: boolean;
}

function formatSavedAt(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function variantKind(variant: DesignVariant): string {
  if (variant.id === 'original') return '原始方案';
  if (variant.origin === 'manual') return '过程态';
  return 'AI 提案';
}

/** 本机方案过程态存档：把当前整包布局另存、载入或移除。不跨设备、不替业务落盘。 */
export function DesignHistoryPanel({ layout, onApply, disabled = false }: DesignHistoryPanelProps): JSX.Element {
  const book = layout.designBook;
  const variants = book?.variants ?? [];
  const activeId = book?.activeId;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const atLimit = variants.length >= MAX_DESIGNS;

  function saveCurrent(): void {
    setError('');
    if (disabled) return;
    try {
      const next = saveDesignSnapshot(layout, { name, note });
      onApply(next);
      setName('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存过程态失败，请重试。');
    }
  }

  return (
    <div className="dh-history-panel">
      <div className="dh-save-form">
        <label className="dh-field">
          <span>过程态名称</span>
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={`如：迎宾区先落位`}
            disabled={disabled || atLimit}
            maxLength={40}
          />
        </label>
        <label className="dh-field">
          <span>备注（可选）</span>
          <input
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="这一版保留了什么、下一步改什么"
            disabled={disabled || atLimit}
            maxLength={120}
          />
        </label>
        <button type="button" className="sc-button" onClick={saveCurrent} disabled={disabled || atLimit}>
          保存当前方案
        </button>
        {atLimit && <p className="dh-note">本机已保留 {MAX_DESIGNS} 个方案，请先移除不再需要的过程态。</p>}
        {error && <p className="dh-error" role="alert">{error}</p>}
      </div>

      {variants.length === 0 ? (
        <p className="dh-empty">还没有存档。到阶段版本时存一次。</p>
      ) : (
        <ul className="dh-list">
          {variants.map(variant => {
            const isActive = variant.id === activeId;
            const isOriginal = variant.id === 'original';
            const savedAt = formatSavedAt(variant.savedAt);
            return (
              <li key={variant.id} className={`dh-item${isActive ? ' is-active' : ''}`}>
                <div className="dh-item-head">
                  <span className="dh-item-name">{variant.name}</span>
                  <span className="dh-item-meta">
                    {variantKind(variant)}
                    {savedAt ? ` · ${savedAt}` : ''}
                  </span>
                </div>
                {variant.note && <p className="dh-item-note">{variant.note}</p>}
                <div className="dh-item-actions">
                  {!isActive && !isOriginal && (
                    <button type="button" className="sc-button" onClick={() => onApply(switchDesign(layout, variant.id))} disabled={disabled}>
                      载入这一版
                    </button>
                  )}
                  {isActive && <span className="dh-current">当前方案</span>}
                  {!isActive && !isOriginal && (
                    <button type="button" className="dh-remove" onClick={() => onApply(removeDesignVariant(layout, variant.id))} disabled={disabled}>
                      移除
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
